// Business Understanding: the model-backed stage of the Understand pipeline.
//
//   crawl evidence ─► site digest ─► one structured extraction call
//        ─► grounding (citations → evidence ids, unsupported claims dropped)
//        ─► location resolution + market scope (multi-signal, geocoder-assisted)
//        ─► profile (open classification + legacy mirrors for downstream readers)
//
// It replaces the old single Gemini synthesis call, which could only choose
// an industry id from a 39-entry list and never saw a page. Confidence is still
// computed from evidence, never taken from the model. If no provider answers,
// the caller keeps the deterministic profile.

import type { EvidenceItem } from "@/lib/evidence/types";
import type { AudienceSegment, BusinessClassification, BusinessProfile, Offering, OfferingType } from "@/lib/profile/schema";
import { computeConfidence } from "@/lib/profile/confidence";
import { containsHype, stripHype } from "@/lib/profile/description-builder";
import { generateStructured, summarizeUsage, availableRoutes } from "@/lib/llm";
import type { MarketHint } from "@/lib/projects/market-hint";
import type { SearchConsoleSignals } from "@/lib/search-console/types";
import { buildSiteDigest, operatorMarketFromHint, withSearchDemand, type DigestPageInput } from "./digest";
import { UNDERSTANDING_INSTRUCTIONS, UNDERSTANDING_SCHEMA, UnderstandingOutput, buildUnderstandingUserContent } from "./extraction";
import { Grounder, supportRatio } from "./grounding";
import { applyLocationResult, resolveLocation, type GroundedAddress } from "./location";
import { archetypeForKind, PLACE_BOUND_KINDS, type BusinessKind, type PhysicalPresence } from "./kinds";

export interface UnderstandingInput {
  projectId: string;
  evidence: EvidenceItem[];
  pages: DigestPageInput[];
  canonicalDomain: string;
  seedHostname: string;
  baseline: BusinessProfile;
  allowNetwork?: boolean;
  /** The operator's intake answer ("Where are your customers?"), when given. */
  marketHint?: MarketHint | null;
  /** Code-computed Google Search Console signals, when the operator connected it. */
  searchConsole?: SearchConsoleSignals | null;
  onStage?: (stage: "reading" | "locating" | "finalizing", detail?: Record<string, unknown>) => void;
}

export interface UnderstandingResult {
  profile: BusinessProfile;
  warnings: string[];
  model: string;
  costUsd: number;
  calls: number;
  rejected: string[];
}

export function isUnderstandingAvailable(): boolean {
  return availableRoutes("extract").length > 0;
}

const NAME_NOISE = /\b(logo|wordmark|icon|favicon|header|footer|cream|white|black|dark|light|png|svg|jpe?g|webp)\b|\.(png|svg|jpe?g|webp)$/i;
const GENERIC_AUDIENCE = /^(customers?|clients?|everyone|people|users?|businesses|professionals|consumers|individuals|public)$/i;

export async function runBusinessUnderstanding(input: UnderstandingInput): Promise<UnderstandingResult | { error: string }> {
  const startedAt = Date.now();
  const digest = buildSiteDigest({
    // Insufficient Search Console data biases nothing (gsc §5), and page order
    // decides which pages fit the digest budget.
    pages: input.searchConsole?.sufficient ? withSearchDemand(input.pages, input.searchConsole.topPages) : input.pages,
    evidence: input.evidence,
    seedHostname: input.seedHostname,
    canonicalDomain: input.canonicalDomain,
    operatorMarket: operatorMarketFromHint(input.marketHint ?? null),
    searchConsole: input.searchConsole ?? null,
  });
  input.onStage?.("reading", { pages: digest.pages.length, facts: digest.facts.length });

  const result = await generateStructured<UnderstandingOutput>({
    stage: "extract",
    schemaName: "business_understanding",
    schema: UNDERSTANDING_SCHEMA,
    systemInstruction: UNDERSTANDING_INSTRUCTIONS,
    userContent: buildUnderstandingUserContent(digest.rendered),
    reasoningEffort: "low",
    temperature: 0.1,
    maxOutputTokens: 16_000,
    projectId: input.projectId,
    validate: (data) => {
      const parsed = UnderstandingOutput.safeParse(data);
      return parsed.success ? parsed.data : null;
    },
  });
  if (!result.ok || !result.data) {
    return { error: result.error ?? "understanding_failed" };
  }
  const output = result.data;
  const grounder = new Grounder(digest);
  const rejected: string[] = [];
  const warnings: string[] = [];
  const profile = structuredClone(input.baseline);
  const byId = digest.evidenceById;
  const items = (ids: string[]) => ids.map((id) => byId.get(id)).filter((i): i is EvidenceItem => Boolean(i));

  // --- Brand ----------------------------------------------------------------
  const brandName = output.brand.name.trim().replace(/\s+/g, " ");
  const brandResolved = grounder.resolve(output.brand.citations);
  const brandSupported = brandName.length >= 2 && brandName.length <= 80 && !NAME_NOISE.test(brandName) && (supportRatio(brandName, brandResolved.text) >= 0.99 || grounder.siteSupport(brandName) >= 0.99);
  const nameCandidates = [
    { name: input.baseline.identity.brandName.value, sources: ["rules"], evidenceIds: input.baseline.identity.brandName.evidenceIds },
  ].filter((c) => c.name);
  if (brandSupported) {
    const ids = grounder.evidenceFor(brandName, brandResolved, 4);
    nameCandidates.unshift({ name: brandName, sources: ["model", ...brandResolved.evidenceIds.map((id) => byId.get(id)?.sourceType ?? "page")].slice(0, 4), evidenceIds: ids });
    const brandItems = items(ids);
    profile.identity.brandName = {
      value: brandName,
      source: brandItems.length > 0 ? "evidence" : "inferred_needs_review",
      evidenceIds: ids,
      confidence: Math.max(computeConfidence({ items: brandItems, ceiling: 96 }), sameName(brandName, input.baseline.identity.brandName.value) ? input.baseline.identity.brandName.confidence : 0),
    };
  } else {
    rejected.push(`brand name "${brandName}" is not written on the site`);
  }
  const aliases = [...new Set([...output.brand.alternateNames, ...(output.brand.legalName ? [output.brand.legalName] : [])].map((a) => a.trim()).filter((a) => a && !sameName(a, profile.identity.brandName.value) && !NAME_NOISE.test(a) && grounder.siteSupport(a) >= 0.99))].slice(0, 6);
  if (aliases.length > 0) {
    profile.identity.aliases = { values: aliases, source: "evidence", evidenceIds: grounder.evidenceFor(aliases.join(" "), grounder.resolve(output.brand.citations), 4), confidence: 70 };
  }
  profile.identity.legalName = output.brand.legalName && grounder.siteSupport(output.brand.legalName) >= 0.8 ? output.brand.legalName : null;
  profile.identity.nameCandidates = nameCandidates;

  // --- Classification ---------------------------------------------------------
  const c = output.classification;
  const classificationResolved = grounder.resolve(c.citations);
  const classificationIds = grounder.evidenceFor(`${c.businessType} ${c.subIndustry ?? ""} ${c.localCategory ?? ""}`, classificationResolved, 5, true);
  const kind = c.kind as BusinessKind;
  const presence = c.physicalPresence as PhysicalPresence;
  const path = (c.path.length > 0 ? c.path : [c.industry, c.subIndustry, c.businessType]).map((p) => (p ?? "").trim()).filter(Boolean).slice(0, 4);
  const classificationConfidence = Math.min(92, computeConfidence({ items: items(classificationIds), ceiling: 92 }) + (classificationResolved.valid >= 2 ? 6 : 0));
  const classification: BusinessClassification = {
    industry: c.industry.trim(),
    subIndustry: c.subIndustry,
    businessType: c.businessType.trim(),
    path,
    kind,
    businessModel: c.businessModel,
    customerType: c.customerType,
    physicalPresence: presence,
    pricePositioning: output.positioning.pricePositioning,
    localCategory: PLACE_BOUND_KINDS.has(kind) && presence !== "online_only" ? c.localCategory : null,
    alternatives: c.alternatives.slice(0, 3),
    ruledOut: c.ruledOut.slice(0, 5),
    rationale: c.rationale.slice(0, 500),
    source: classificationIds.length > 0 ? "evidence" : "inferred_needs_review",
    evidenceIds: classificationIds,
    confidence: classificationIds.length > 0 ? Math.max(classificationConfidence, 55) : 35,
  };
  profile.classification = classification;
  profile.industry = {
    value: path.join(" › ") || classification.businessType,
    taxonomyId: input.baseline.industry.taxonomyId,
    primary: classification.industry,
    secondary: classification.subIndustry ?? classification.businessType,
    source: classification.source,
    evidenceIds: classificationIds,
    confidence: classification.confidence,
  };
  const archetype = archetypeForKind(kind, presence);
  profile.archetype = {
    value: archetype,
    source: classification.source,
    evidenceIds: classificationIds,
    confidence: classification.confidence,
    scores: { ...input.baseline.archetype.scores, [`model:${kind}`]: classification.confidence },
  };
  // Regulated-domain handling follows what the business is, not keywords:
  // "clinically proven" on a salon's skincare page is not medical practice.
  const regulated = new Set<"healthcare" | "finance" | "legal">();
  if (kind === "healthcare_medical") regulated.add("healthcare");
  if (kind === "finance_insurance") regulated.add("finance");
  if (kind === "legal_services") regulated.add("legal");
  profile.regulatedDomain = { isRegulated: regulated.size > 0, categories: [...regulated], source: classification.source };

  // --- Description and positioning -------------------------------------------
  const description = stripHype(output.description.text.trim());
  const descriptionResolved = grounder.resolve(output.description.citations);
  const descriptionIds = grounder.evidenceFor(description, descriptionResolved, 6, true);
  if (description.length >= 20 && descriptionIds.length > 0) {
    profile.description = { value: description.slice(0, 600), source: "evidence", evidenceIds: descriptionIds, confidence: computeConfidence({ items: items(descriptionIds), ceiling: 90 }) };
    if (containsHype(output.description.text).length > 0) warnings.push("Removed promotional language from the description.");
  } else {
    rejected.push("description without usable citations");
  }
  const positioningResolved = grounder.resolve(output.positioning.citations);
  const summary = output.positioning.summary ? stripHype(output.positioning.summary) : null;
  profile.positioning = {
    summary: summary ? { value: summary, evidenceIds: grounder.evidenceFor(summary, positioningResolved, 3, true), confidence: 60 } : null,
    differentiators: output.positioning.differentiators.filter((d) => grounder.siteSupport(d) >= 0.5).slice(0, 6),
    priceRange: output.positioning.priceRange && grounder.siteSupport(output.positioning.priceRange) >= 0.5 ? output.positioning.priceRange : null,
  };
  const traits = output.positioning.differentiators
    .map((d) => d.trim())
    .filter((d) => d.length >= 3 && d.length <= 60 && grounder.siteSupport(d) >= 0.6)
    .slice(0, 6);
  if (traits.length > 0) {
    profile.brandIdentity = traits.map((value) => {
      const pages = grounder.findSupportingPages(value, 0.6);
      const ids = grounder.evidenceOnPages(value, pages, 3);
      return { value, confidence: computeConfidence({ items: items(ids), ceiling: pages.length >= 2 ? 88 : 50 }), evidenceIds: ids, pageCount: pages.length, needsCheck: pages.length < 2 };
    });
  }

  // --- Offerings ----------------------------------------------------------------
  const offerings: Offering[] = [];
  const groups = new Map<string, string[]>();
  for (const raw of output.offerings) {
    const name = raw.name.trim().replace(/\s+/g, " ");
    if (name.length < 2 || name.length > 80) continue;
    if (/^(services?|products?|solutions?|offerings?|home|about|contact|blog|book now|shop|menu)$/i.test(name)) continue;
    if (offerings.some((o) => sameName(o.name, name))) continue;
    const resolved = grounder.resolve(raw.citations);
    let ids: string[] = [];
    if (supportRatio(name, resolved.text) >= 0.6) {
      ids = grounder.evidenceFor(name, resolved, 3, true);
    } else {
      const pages = grounder.findSupportingPages(name, 0.6);
      if (pages.length > 0) ids = grounder.evidenceOnPages(name, pages, 3);
    }
    if (ids.length === 0) {
      rejected.push(`offering "${name}" is not on the site`);
      continue;
    }
    const offeringItems = items(ids);
    const pageCount = new Set(offeringItems.map((i) => i.crawlPageId ?? i.url)).size;
    offerings.push({
      name,
      type: mapOfferingType(raw.type),
      confidence: computeConfidence({ items: offeringItems, ceiling: 92 }),
      evidenceIds: ids,
      pageCount,
    });
    const group = raw.group?.trim();
    if (group) groups.set(group, [...(groups.get(group) ?? []), name]);
    if (offerings.length >= 40) break;
  }
  if (offerings.length > 0) {
    profile.offerings = {
      values: offerings.map((o) => o.name),
      items: offerings,
      groups: [...groups.entries()].map(([groupName, names]) => ({ name: groupName, items: names })),
      source: "evidence",
      evidenceIds: [...new Set(offerings.flatMap((o) => o.evidenceIds))].slice(0, 10),
      confidence: Math.round(offerings.reduce((sum, o) => sum + o.confidence, 0) / offerings.length),
    };
  } else {
    warnings.push("No product or service could be confirmed on the site; kept the rules-based list.");
  }

  // --- Audience -----------------------------------------------------------------
  const segments: AudienceSegment[] = [];
  for (const raw of output.audience) {
    const label = raw.label.trim();
    if (label.length < 3 || label.length > 90 || GENERIC_AUDIENCE.test(label)) continue;
    const resolved = grounder.resolve(raw.citations);
    const ids = grounder.evidenceFor(`${label} ${raw.description}`, resolved, 3, true);
    if (ids.length === 0) {
      rejected.push(`audience "${label}" has no supporting page`);
      continue;
    }
    segments.push({ label, description: raw.description.slice(0, 240), geoRelation: raw.geoRelation, evidenceIds: ids, confidence: Math.min(80, computeConfidence({ items: items(ids), ceiling: 80 })) });
    if (segments.length >= 6) break;
  }
  if (segments.length > 0) {
    profile.audienceSegments = segments;
    profile.targetAudience = segments.map((s) => ({ value: s.label.slice(0, 80), confidence: s.confidence, evidenceIds: s.evidenceIds, pageCount: new Set(items(s.evidenceIds).map((i) => i.crawlPageId)).size }));
    profile.personas = { values: segments.map((s) => s.label), source: "evidence", evidenceIds: segments.flatMap((s) => s.evidenceIds).slice(0, 8), confidence: Math.round(segments.reduce((sum, s) => sum + s.confidence, 0) / segments.length) };
  }

  // --- Customer questions -----------------------------------------------------
  const questions = output.customerQuestions.map((q) => q.trim()).filter((q) => q.length >= 8 && q.length <= 160 && grounder.siteSupport(q) >= 0.6).slice(0, 12);
  if (questions.length > 0) {
    profile.customerJobs = {
      values: dedupeText([...questions, ...input.baseline.customerJobs.values]).slice(0, 12),
      source: "evidence",
      evidenceIds: input.baseline.customerJobs.evidenceIds,
      confidence: 65,
    };
  }

  // --- Location -------------------------------------------------------------------
  input.onStage?.("locating");
  const addresses: GroundedAddress[] = [];
  for (const raw of output.location.addresses) {
    const resolved = grounder.resolve(raw.citations);
    const rawSupported = raw.raw ? grounder.siteSupport(raw.raw) >= 0.6 : false;
    // The model's own raw line only grounds its parts when the site supports
    // that line: the digest now carries the operator's area outside <website>,
    // and an address copied from it must not ground itself.
    const haystack = rawSupported ? `${resolved.text}\n${raw.raw}` : resolved.text;
    const supported = (value: string | null) => {
      if (!value) return null;
      return supportRatio(value, haystack) >= 0.6 || grounder.siteSupport(value) >= 0.8 ? value : null;
    };
    const address: GroundedAddress = {
      ...raw,
      premise: supported(raw.premise),
      street: supported(raw.street),
      neighborhood: supported(raw.neighborhood),
      district: supported(raw.district),
      city: supported(raw.city),
      region: supported(raw.region),
      country: raw.country,
      postalCode: supported(raw.postalCode),
      evidenceIds: grounder.evidenceFor(`${raw.raw} ${raw.neighborhood ?? ""} ${raw.city ?? ""}`, resolved, 4, true),
    };
    for (const field of ["neighborhood", "city", "street"] as const) {
      if (raw[field] && !address[field]) rejected.push(`${field} "${raw[field]}" is not on the site`);
    }
    if (!rawSupported && !address.city && !address.street) {
      rejected.push(`address "${raw.raw.slice(0, 60)}" is not on the site`);
      continue;
    }
    addresses.push(address);
  }
  const serviceAreas = output.location.serviceAreas
    // "40+ countries" or "150 cities" is a claim about reach, not a place.
    .filter((a) => !/^\s*\d[\d,+ ]*\s*(countries|cities|locations|markets|regions)\b/i.test(a.name))
    .filter((a) => grounder.siteSupport(a.name) >= 0.8)
    .map((a) => ({ name: a.name.trim(), level: a.level, evidenceIds: grounder.evidenceFor(a.name, grounder.resolve(a.citations), 2, true) }));
  const nearbyAreas = output.location.nearbyAreas.filter((a) => grounder.siteSupport(a) >= 0.8);

  const location = await resolveLocation({
    addresses,
    serviceAreas,
    nearbyAreas,
    countriesServed: output.location.countriesServed,
    llmScope: output.location.marketScope,
    scopeRationale: output.location.scopeRationale,
    locationCount: output.location.locationCount,
    kind,
    presence,
    evidence: input.evidence,
    seedHostname: input.seedHostname,
    allowNetwork: input.allowNetwork ?? true,
    hint: input.marketHint ?? null,
    searchConsole: input.searchConsole ?? null,
  });
  warnings.push(...location.warnings);
  // Also persists `location.locationCount` ("many" shops): competitor tiers read
  // it to tell a chain from a single salon, and it used to be thrown away here.
  applyLocationResult(profile, location);

  // --- Contact --------------------------------------------------------------------
  const contact = { phones: new Set<string>(), emails: new Set<string>(), socialProfiles: new Set<string>(), bookingPlatforms: new Set<string>() };
  for (const item of input.evidence) {
    const data = (item.data ?? {}) as Record<string, unknown>;
    if (item.sourceType === "phone" && typeof data.telephone === "string") {
      const digits = data.telephone.replace(/[^\d]/g, "");
      if (digits.length >= 7 && ![...contact.phones].some((p) => p.replace(/[^\d]/g, "") === digits)) contact.phones.add(data.telephone);
    }
    if (typeof data.email === "string") contact.emails.add(data.email);
    if (typeof data.sameAs === "string") contact.socialProfiles.add(data.sameAs.replace(/\/$/, ""));
    if (typeof data.bookingPlatform === "string") contact.bookingPlatforms.add(data.bookingPlatform);
  }
  profile.contact = {
    phones: [...contact.phones].slice(0, 6),
    emails: [...contact.emails].slice(0, 4),
    socialProfiles: [...contact.socialProfiles].slice(0, 10),
    bookingPlatforms: [...contact.bookingPlatforms].slice(0, 6),
  };

  // --- Quality --------------------------------------------------------------------
  input.onStage?.("finalizing");
  const usage = summarizeUsage(input.projectId, startedAt);
  const uncertainties = output.uncertainties.map((u) => u.trim()).filter(Boolean).slice(0, 4);
  profile.quality = {
    ...profile.quality,
    synthesisMode: "llm_grounded",
    models: usage.models,
    llmCostUsd: usage.costUsd,
    llmCalls: usage.calls,
    schemaVersion: 2,
    overallConfidence: Math.round(
      (profile.identity.brandName.confidence * 2 + classification.confidence * 2 + profile.offerings.confidence * 2 + location.location.confidence * 2 + (profile.description.confidence || 0)) / 9,
    ),
    warnings: [...warnings, ...uncertainties.map((u) => `Not stated on the site: ${u}`)].slice(0, 10),
  };
  if (rejected.length > 0) profile.quality.warnings.push(`${rejected.length} AI claim(s) were dropped because the website does not support them.`);

  return { profile, warnings, model: result.model, costUsd: usage.costUsd, calls: usage.calls, rejected };
}

function dedupeText(values: string[]): string[] {
  const seen = new Set<string>();
  return values.filter((v) => {
    const key = v.toLowerCase().replace(/[^\p{L}\p{N}]+/gu, " ").trim();
    if (!key || seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

function sameName(a: string, b: string): boolean {
  const n = (s: string) => s.toLowerCase().replace(/[^\p{L}\p{N}]+/gu, "");
  return n(a) === n(b);
}

function mapOfferingType(type: string): OfferingType {
  if (type === "product" || type === "menu_item") return "product";
  if (type === "category") return "category";
  if (type === "solution" || type === "plan") return "solution";
  return "service";
}
