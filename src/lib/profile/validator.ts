// Validation of model output against the evidence it claims to rest on.
//
// The model is not trusted. Every field it returns is checked:
//   * evidence ids must exist in the pack — an invented id drops the field;
//   * the industry id must exist in the closed taxonomy;
//   * offerings must survive the same noise rules the deterministic resolver
//     applies, so the model cannot smuggle back "Products" or a blog title;
//   * identity traits must be specific;
//   * confidence is recomputed from the cited evidence, never taken from the
//     model.
//
// Anything rejected falls back to the deterministic baseline for that field,
// which means a bad model response degrades the profile to "evidence-only"
// rather than corrupting it.

import type { EvidencePack, EvidenceItem } from "@/lib/evidence/types";
import { INDUSTRY_BY_ID, industryLabel } from "./taxonomy";
import { computeConfidence } from "./confidence";
import { normalizeOfferingName, titleCase } from "./offering-resolver";
import { MARKET_LEVELS, OFFERING_TYPES, type BusinessProfile, type MarketLevel, type OfferingType } from "./schema";

export interface SynthesisDraft {
  brandName?: { value?: string; evidenceIds?: string[] };
  description?: { value?: string; evidenceIds?: string[] };
  industryTaxonomyId?: string;
  industryEvidenceIds?: string[];
  offerings?: Array<{ name?: string; type?: string; evidenceIds?: string[] }>;
  brandIdentity?: Array<{ value?: string; evidenceIds?: string[] }>;
  targetAudience?: Array<{ value?: string; evidenceIds?: string[] }>;
  markets?: Array<{ name?: string; level?: string; evidenceIds?: string[] }>;
}

export interface ValidationResult {
  profile: BusinessProfile;
  warnings: string[];
  rejected: string[];
}

/** Offering names that are true of every business and therefore useless. */
const USELESS_OFFERING = new Set([
  "product",
  "service",
  "solution",
  "offering",
  "item",
  "category",
  "brand",
  "other",
  "misc",
  "general",
  "various",
]);

/** Identity traits so generic they describe every company. */
const GENERIC_TRAIT =
  /^(innovative|trusted|customer[- ]focused|customer[- ]centric|high[- ]quality|quality|modern|reliable|professional|experienced|leading|passionate|dedicated|committed|excellent|best|great|friendly|efficient|dynamic|flexible|scalable|robust|world[- ]class)$/i;

export function validateSynthesis(draft: SynthesisDraft, pack: EvidencePack, baseline: BusinessProfile): ValidationResult {
  const profile = structuredClone(baseline);
  const warnings: string[] = [];
  const rejected: string[] = [];

  const byId = new Map(pack.items.map((item) => [item.id, item]));
  /** Keeps only ids that actually exist in the pack. */
  const validIds = (ids: string[] | undefined): string[] => {
    if (!ids) return [];
    const valid: string[] = [];
    let invalid = 0;
    for (const id of ids) {
      if (byId.has(id)) valid.push(id);
      else invalid++;
    }
    if (invalid > 0) rejected.push(`${invalid} invalid evidence id(s)`);
    return [...new Set(valid)];
  };
  const itemsFor = (ids: string[]): EvidenceItem[] => ids.map((id) => byId.get(id)).filter((i): i is EvidenceItem => Boolean(i));

  // --- Brand name ---------------------------------------------------------
  const brandIds = validIds(draft.brandName?.evidenceIds);
  const brandValue = draft.brandName?.value?.trim();
  if (brandValue && brandValue.length >= 2 && brandValue.length <= 60 && brandIds.length > 0) {
    // Only accept a model rename when the deterministic pass was itself unsure;
    // structured-data-backed names are not up for debate.
    if (baseline.identity.brandName.confidence < 70) {
      profile.identity.brandName = {
        value: brandValue,
        source: "evidence",
        evidenceIds: brandIds,
        confidence: computeConfidence({ items: itemsFor(brandIds), ceiling: 85 }),
      };
    }
  } else if (brandValue && brandIds.length === 0) {
    rejected.push("brandName (no valid evidence)");
  }

  // --- Description --------------------------------------------------------
  const descIds = validIds(draft.description?.evidenceIds);
  const descValue = draft.description?.value?.trim();
  if (descValue && descValue.length >= 20 && descValue.length <= 600) {
    if (descIds.length === 0) {
      rejected.push("description (no valid evidence)");
      warnings.push("The AI description cited no valid evidence and was discarded.");
    } else {
      profile.description = {
        value: descValue,
        source: "evidence",
        evidenceIds: descIds.slice(0, 8),
        confidence: computeConfidence({ items: itemsFor(descIds), ceiling: 90 }),
      };
    }
  }

  // --- Industry -----------------------------------------------------------
  const industryId = draft.industryTaxonomyId?.trim();
  if (industryId && INDUSTRY_BY_ID.has(industryId)) {
    const category = INDUSTRY_BY_ID.get(industryId)!;
    const industryIds = validIds(draft.industryEvidenceIds);
    const ids = industryIds.length > 0 ? industryIds : baseline.industry.evidenceIds;
    if (ids.length > 0) {
      profile.industry = {
        value: industryLabel(industryId),
        taxonomyId: industryId,
        primary: category.sector,
        secondary: category.category,
        source: "evidence",
        evidenceIds: ids.slice(0, 6),
        confidence: computeConfidence({ items: itemsFor(ids), ceiling: 92 }),
      };
    } else {
      rejected.push("industry (no valid evidence)");
    }
  } else if (industryId) {
    rejected.push(`industry id "${industryId}" is not in the taxonomy`);
    warnings.push("The AI proposed an industry outside the taxonomy; kept the rules-based classification.");
  }

  // --- Offerings ----------------------------------------------------------
  if (Array.isArray(draft.offerings) && draft.offerings.length > 0) {
    const seen = new Set<string>();
    const accepted = [];
    for (const raw of draft.offerings) {
      const name = raw.name?.trim();
      if (!name || name.length < 3 || name.length > 80) continue;
      const normalized = normalizeOfferingName(name);
      if (!normalized || USELESS_OFFERING.has(normalized) || seen.has(normalized)) continue;
      const ids = validIds(raw.evidenceIds);
      if (ids.length === 0) {
        rejected.push(`offering "${name}" (no valid evidence)`);
        continue;
      }
      seen.add(normalized);
      const type: OfferingType = (OFFERING_TYPES as readonly string[]).includes(raw.type ?? "") ? (raw.type as OfferingType) : "category";
      const items = itemsFor(ids);
      accepted.push({
        name: titleCase(name).slice(0, 80),
        type,
        confidence: computeConfidence({ items, ceiling: 92 }),
        evidenceIds: ids.slice(0, 6),
        pageCount: new Set(items.map((i) => i.crawlPageId ?? i.url)).size,
      });
    }
    if (accepted.length >= 2) {
      profile.offerings = {
        values: accepted.map((o) => o.name),
        items: accepted.slice(0, 12),
        source: "evidence",
        evidenceIds: [...new Set(accepted.flatMap((o) => o.evidenceIds))].slice(0, 10),
        confidence: Math.round(accepted.reduce((sum, o) => sum + o.confidence, 0) / accepted.length),
      };
    } else if (baseline.offerings.items.length > 0) {
      warnings.push("The AI returned too few usable offerings; kept the evidence-extracted list.");
    }
  }

  // --- Brand identity -----------------------------------------------------
  if (Array.isArray(draft.brandIdentity)) {
    const accepted = [];
    for (const raw of draft.brandIdentity) {
      const value = raw.value?.trim();
      if (!value || value.length < 3 || value.length > 60) continue;
      if (GENERIC_TRAIT.test(value)) {
        rejected.push(`identity trait "${value}" (too generic)`);
        continue;
      }
      const ids = validIds(raw.evidenceIds);
      if (ids.length === 0) {
        rejected.push(`identity trait "${value}" (no valid evidence)`);
        continue;
      }
      const items = itemsFor(ids);
      const pageCount = new Set(items.map((i) => i.crawlPageId ?? i.url)).size;
      accepted.push({
        value: value.slice(0, 60),
        confidence: computeConfidence({ items, ceiling: pageCount >= 2 ? 90 : 45 }),
        evidenceIds: ids.slice(0, 6),
        pageCount,
        needsCheck: pageCount < 2,
      });
    }
    if (accepted.length > 0) profile.brandIdentity = accepted.slice(0, 6);
  }

  // --- Target audience ----------------------------------------------------
  if (Array.isArray(draft.targetAudience)) {
    const accepted = [];
    for (const raw of draft.targetAudience) {
      const value = raw.value?.trim();
      if (!value || value.length < 3 || value.length > 80) continue;
      const ids = validIds(raw.evidenceIds);
      if (ids.length === 0) {
        rejected.push(`audience "${value}" (no valid evidence)`);
        continue;
      }
      const items = itemsFor(ids);
      const pageCount = new Set(items.map((i) => i.crawlPageId ?? i.url)).size;
      accepted.push({ value, confidence: computeConfidence({ items, ceiling: pageCount >= 2 ? 88 : 50 }), evidenceIds: ids.slice(0, 5), pageCount });
    }
    if (accepted.length > 0) profile.targetAudience = accepted.slice(0, 5);
  }

  // --- Markets ------------------------------------------------------------
  if (Array.isArray(draft.markets)) {
    const accepted = [];
    for (const [index, raw] of draft.markets.entries()) {
      const name = raw.name?.trim();
      if (!name || name.length < 2 || name.length > 80) continue;
      const level: MarketLevel = (MARKET_LEVELS as readonly string[]).includes(raw.level ?? "") ? (raw.level as MarketLevel) : "country";
      const ids = validIds(raw.evidenceIds);
      if (ids.length === 0) {
        // A market is the single easiest field to invent, so this rejection is
        // deliberately unforgiving.
        rejected.push(`market "${name}" (no valid evidence)`);
        continue;
      }
      const existing = baseline.markets.find((m) => m.name.toLowerCase() === name.toLowerCase());
      accepted.push({
        name,
        level,
        countryCode: existing?.countryCode ?? null,
        confidence: computeConfidence({ items: itemsFor(ids), ceiling: 90 }),
        evidenceIds: ids.slice(0, 5),
        isPrimary: index === 0,
      });
    }
    if (accepted.length > 0) {
      profile.markets = accepted.slice(0, 8);
      profile.geography = {
        ...profile.geography,
        countries: accepted.filter((m) => m.level === "country").map((m) => m.name),
        cities: accepted.filter((m) => m.level === "city").map((m) => m.name),
        regions: accepted.filter((m) => m.level === "region").map((m) => m.name),
        source: "evidence",
        evidenceIds: accepted.flatMap((m) => m.evidenceIds).slice(0, 6),
      };
    } else if (draft.markets.length > 0) {
      warnings.push("The AI proposed markets with no supporting evidence; kept the evidence-derived markets.");
    }
  }

  if (rejected.length > 0) {
    warnings.push(`Validation rejected ${rejected.length} unsupported AI claim(s).`);
  }

  return { profile, warnings, rejected };
}

/**
 * Final gate before persistence: guarantees the invariant the whole design
 * rests on — no substantive field carries an evidence id that does not exist.
 */
export function assertEvidenceIntegrity(profile: BusinessProfile, knownIds: Set<string>): { ok: boolean; problems: string[] } {
  const problems: string[] = [];
  const check = (path: string, ids: string[]) => {
    for (const id of ids) if (!knownIds.has(id)) problems.push(`${path}: unknown evidence id ${id}`);
  };
  check("identity.brandName", profile.identity.brandName.evidenceIds);
  check("identity.aliases", profile.identity.aliases.evidenceIds);
  check("description", profile.description.evidenceIds);
  check("industry", profile.industry.evidenceIds);
  check("archetype", profile.archetype.evidenceIds);
  check("offerings", profile.offerings.evidenceIds);
  profile.offerings.items.forEach((o, i) => check(`offerings.items[${i}]`, o.evidenceIds));
  profile.brandIdentity.forEach((t, i) => check(`brandIdentity[${i}]`, t.evidenceIds));
  profile.targetAudience.forEach((a, i) => check(`targetAudience[${i}]`, a.evidenceIds));
  profile.markets.forEach((m, i) => check(`markets[${i}]`, m.evidenceIds));
  check("geography", profile.geography.evidenceIds);
  return { ok: problems.length === 0, problems };
}

/**
 * Coverage report: what fraction of populated substantive fields cite at least
 * one evidence id. The benchmark asserts this stays at 100%.
 */
export function evidenceCoverage(profile: BusinessProfile): { populated: number; withEvidence: number; ratio: number; gaps: string[] } {
  const fields: Array<{ path: string; populated: boolean; ids: string[] }> = [
    { path: "identity.brandName", populated: profile.identity.brandName.value.length > 0 && profile.identity.brandName.source !== "inferred_needs_review", ids: profile.identity.brandName.evidenceIds },
    { path: "description", populated: profile.description.value.length > 0, ids: profile.description.evidenceIds },
    { path: "industry", populated: profile.industry.value.length > 0, ids: profile.industry.evidenceIds },
    { path: "archetype", populated: profile.archetype.value !== "other", ids: profile.archetype.evidenceIds },
    ...profile.offerings.items.map((o, i) => ({ path: `offerings[${i}] ${o.name}`, populated: true, ids: o.evidenceIds })),
    ...profile.brandIdentity.map((t, i) => ({ path: `brandIdentity[${i}] ${t.value}`, populated: true, ids: t.evidenceIds })),
    ...profile.targetAudience.map((a, i) => ({ path: `targetAudience[${i}] ${a.value}`, populated: true, ids: a.evidenceIds })),
    ...profile.markets.map((m, i) => ({ path: `markets[${i}] ${m.name}`, populated: true, ids: m.evidenceIds })),
  ];
  const populatedFields = fields.filter((f) => f.populated);
  const gaps = populatedFields.filter((f) => f.ids.length === 0).map((f) => f.path);
  const withEvidence = populatedFields.length - gaps.length;
  return {
    populated: populatedFields.length,
    withEvidence,
    ratio: populatedFields.length === 0 ? 1 : withEvidence / populatedFields.length,
    gaps,
  };
}
