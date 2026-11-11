// Assembles the deterministic (evidence-only) baseline profile.
//
// This runs before any model call and is the profile shown when no AI provider
// is configured. It composes the field resolvers; the resolvers hold the
// domain logic, this file holds the wiring and the cross-field bookkeeping
// (legacy mirrors, regulated-domain detection, overall confidence).

import type { EvidenceItem } from "@/lib/evidence/types";
import type { PageType } from "@/lib/crawler/page-classifier";
import { resolveIdentity } from "./identity-resolver";
import { resolveOfferings } from "./offering-resolver";
import { resolveMarkets } from "./market-resolver";
import { resolveBrandIdentity, resolveTargetAudience } from "./identity-traits";
import { classifyArchetype, classifyIndustry } from "./industry-classifier";
import { computeConfidence, overallConfidence } from "./confidence";
import { emptyProfile, type BusinessProfile } from "./schema";

export interface PageSummary {
  id: string;
  url: string;
  pageType: PageType;
  title: string | null;
}

export interface BuildBaselineInput {
  evidence: EvidenceItem[];
  pages: PageSummary[];
  canonicalDomain: string;
  seedUrl: string;
  seedHostname: string;
}

const REGULATED_KEYWORDS: Record<"healthcare" | "finance" | "legal", RegExp> = {
  // Bare "clinical" matched "clinically proven" skincare copy on salon and
  // beauty sites and flagged them as regulated healthcare.
  healthcare: /\b(diagnosis|treatment plan|prescription|medical advice|patient care|clinical (trial|care|practice|services)|consultant physician|telehealth)\b/i,
  finance: /\b(investment advice|financial advis|loan approval|credit decision|underwriting|regulated by|sebi|fca|sec registered|apr)\b/i,
  legal: /\b(legal advice|attorney-client|law firm|legal counsel|bar council|solicitors regulation)\b/i,
};

const CUSTOMER_JOB_PATTERN = /^(how (to|do|can|does)|what (is|are|does)|why|can i|should i|where (can|do)|when (should|do))\b/i;

const CONSTRAINT_KEYWORDS = [
  "warranty",
  "certified",
  "certification",
  "accredited",
  "compliance",
  "gluten-free",
  "vegan",
  "halal",
  "kosher",
  "dietary",
  "hipaa",
  "gdpr",
  "iso 9001",
  "iso 27001",
  "soc 2",
  "licensed",
  "insured",
  "financing available",
  "free returns",
  "money-back",
  "free shipping",
  "free cancellation",
  "no hidden fees",
];

export function buildDeterministicProfile(input: BuildBaselineInput): BusinessProfile {
  const { evidence, pages, canonicalDomain, seedUrl, seedHostname } = input;
  const profile = emptyProfile(canonicalDomain);

  // --- Identity -----------------------------------------------------------
  const identity = resolveIdentity(evidence, canonicalDomain);
  profile.identity.brandName = {
    value: identity.brandName.value,
    source: identity.brandName.source,
    evidenceIds: identity.brandName.evidenceIds,
    confidence: identity.brandName.confidence,
  };
  profile.identity.aliases = {
    values: identity.aliases.values,
    source: identity.aliases.values.length > 0 ? "evidence" : "inferred_needs_review",
    evidenceIds: identity.aliases.evidenceIds,
    confidence: identity.aliases.confidence,
  };

  // --- Industry and archetype ---------------------------------------------
  const industry = classifyIndustry(evidence);
  profile.industry = {
    value: industry.label,
    taxonomyId: industry.taxonomyId,
    primary: industry.primary,
    secondary: industry.secondary,
    source: industry.taxonomyId ? "evidence" : "inferred_needs_review",
    evidenceIds: industry.evidenceIds,
    confidence: industry.confidence,
  };

  const locationPageCount = pages.filter((p) => p.pageType === "location" || p.pageType === "store_locator").length;
  const archetype = classifyArchetype(evidence, industry, locationPageCount);
  profile.archetype = {
    value: archetype.value,
    source: archetype.confidence >= 40 ? "evidence" : "inferred_needs_review",
    evidenceIds: archetype.evidenceIds,
    confidence: archetype.confidence,
    scores: archetype.scores,
  };

  // --- Offerings ----------------------------------------------------------
  const { offerings } = resolveOfferings(evidence, { archetype: archetype.value });
  profile.offerings = {
    values: offerings.map((o) => o.name),
    items: offerings,
    source: offerings.length > 0 ? "evidence" : "inferred_needs_review",
    evidenceIds: [...new Set(offerings.flatMap((o) => o.evidenceIds))].slice(0, 10),
    confidence: offerings.length > 0 ? Math.round(offerings.reduce((sum, o) => sum + o.confidence, 0) / offerings.length) : 0,
  };

  // --- Identity traits and audience ---------------------------------------
  profile.brandIdentity = resolveBrandIdentity(evidence);
  profile.targetAudience = resolveTargetAudience(evidence);
  // Legacy mirror: the prompt layer reads `personas.values`.
  profile.personas = {
    values: profile.targetAudience.map((a) => a.value),
    source: profile.targetAudience.length > 0 ? "evidence" : "inferred_needs_review",
    evidenceIds: profile.targetAudience.flatMap((a) => a.evidenceIds).slice(0, 8),
    confidence: profile.targetAudience.length > 0 ? Math.round(profile.targetAudience.reduce((s, a) => s + a.confidence, 0) / profile.targetAudience.length) : 0,
  };

  // --- Markets ------------------------------------------------------------
  const marketResolution = resolveMarkets({ evidence, seedHostname, seedUrl });
  profile.markets = marketResolution.markets;
  profile.marketScope = {
    value: marketResolution.scope.value,
    source: marketResolution.scope.value === "unknown" ? "inferred_needs_review" : "evidence",
    evidenceIds: marketResolution.scope.evidenceIds,
    confidence: marketResolution.scope.confidence,
  };
  profile.geography = {
    countries: marketResolution.countries,
    regions: marketResolution.regions,
    cities: marketResolution.cities,
    serviceAreaDescription: marketResolution.serviceAreaDescription,
    languages: marketResolution.languages,
    source: marketResolution.markets.length > 0 ? "evidence" : "inferred_needs_review",
    evidenceIds: marketResolution.markets.flatMap((m) => m.evidenceIds).slice(0, 6),
  };

  // --- Customer jobs and decision constraints (downstream inputs) ----------
  profile.customerJobs = extractCustomerJobs(evidence);
  profile.decisionConstraints = extractDecisionConstraints(evidence);

  // --- Regulated domain ---------------------------------------------------
  const regulatedCategories = new Set<"healthcare" | "finance" | "legal">();
  if (archetype.value === "healthcare") regulatedCategories.add("healthcare");
  if (archetype.value === "finance") regulatedCategories.add("finance");
  // Gyms, yoga studios and spas sit under healthcare in the taxonomy but are not regulated care.
  if (industry.taxonomyId?.startsWith("healthcare.") && industry.taxonomyId !== "healthcare.wellness_fitness") regulatedCategories.add("healthcare");
  if (industry.taxonomyId?.startsWith("finance.")) regulatedCategories.add("finance");
  if (industry.taxonomyId === "services.legal") regulatedCategories.add("legal");
  for (const item of evidence) {
    for (const [category, pattern] of Object.entries(REGULATED_KEYWORDS) as Array<["healthcare" | "finance" | "legal", RegExp]>) {
      if (pattern.test(item.text)) regulatedCategories.add(category);
    }
  }
  profile.regulatedDomain = {
    isRegulated: regulatedCategories.size > 0,
    categories: [...regulatedCategories],
    source: regulatedCategories.size > 0 ? "evidence" : "inferred_needs_review",
  };

  // --- Quality summary ----------------------------------------------------
  profile.quality = {
    overallConfidence: overallConfidence([
      { confidence: profile.identity.brandName.confidence, weight: 2 },
      { confidence: profile.industry.confidence, weight: 2 },
      { confidence: profile.offerings.confidence, weight: 2 },
      { confidence: profile.archetype.confidence, weight: 1 },
      { confidence: profile.marketScope.confidence, weight: 1 },
      { confidence: profile.brandIdentity.length > 0 ? Math.round(profile.brandIdentity.reduce((s, t) => s + t.confidence, 0) / profile.brandIdentity.length) : 0, weight: 1 },
    ]),
    evidenceItemCount: evidence.length,
    pagesAnalyzed: pages.length,
    synthesisMode: "deterministic",
    warnings: marketResolution.warnings,
  };

  return profile;
}

/**
 * Page types where a question-shaped heading is a real customer question.
 * A listing page is excluded on purpose: on a bookshop, "How Can I Be
 * Miserable" is a product title, not something a buyer is asking us.
 */
const JOB_BEARING_PAGE_TYPES = new Set<PageType>(["faq", "solution", "industry", "home", "about", "service_index", "service", "pricing"]);

function extractCustomerJobs(evidence: EvidenceItem[]): BusinessProfile["customerJobs"] {
  const values = new Map<string, string[]>();
  for (const item of evidence) {
    const isFaqSchema = /^FAQ:/.test(item.text);
    if (!isFaqSchema && !JOB_BEARING_PAGE_TYPES.has(item.pageType)) continue;
    if (item.sourceType !== "heading" && !isFaqSchema && item.fieldHint !== "audience") continue;
    const text = item.text.replace(/^(H\d|FAQ):\s*/, "").trim();
    if (!CUSTOMER_JOB_PATTERN.test(text) || text.length > 120) continue;
    // A genuine customer question is phrased as one.
    if (!isFaqSchema && !text.endsWith("?")) continue;
    const key = text.toLowerCase();
    const ids = values.get(key) ?? [];
    if (ids.length < 4) ids.push(item.id);
    values.set(key, ids);
    if (values.size >= 12) break;
  }
  const entries = [...values.entries()];
  return {
    values: entries.map(([text]) => text.charAt(0).toUpperCase() + text.slice(1)),
    source: entries.length > 0 ? "evidence" : "inferred_needs_review",
    evidenceIds: entries.flatMap(([, ids]) => ids).slice(0, 8),
    confidence: entries.length > 0 ? 60 : 0,
  };
}

function extractDecisionConstraints(evidence: EvidenceItem[]): BusinessProfile["decisionConstraints"] {
  const hits = new Map<string, string[]>();
  for (const item of evidence) {
    const lower = item.text.toLowerCase();
    for (const keyword of CONSTRAINT_KEYWORDS) {
      if (!lower.includes(keyword)) continue;
      const ids = hits.get(keyword) ?? [];
      if (ids.length < 3) ids.push(item.id);
      hits.set(keyword, ids);
    }
  }
  const entries = [...hits.entries()].slice(0, 10);
  const byId = new Map(evidence.map((e) => [e.id, e]));
  return {
    values: entries.map(([keyword]) => keyword),
    source: entries.length > 0 ? "evidence" : "inferred_needs_review",
    evidenceIds: entries.flatMap(([, ids]) => ids).slice(0, 8),
    confidence: entries.length > 0 ? computeConfidence({ items: entries.flatMap(([, ids]) => ids).map((id) => byId.get(id)!).filter(Boolean), ceiling: 80 }) : 0,
  };
}
