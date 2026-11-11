// User edits vs. re-analysis.
//
// The product rule: a user edit is a correction, and a later analysis run must
// not silently undo it. So every edit records its field path on the profile
// version, and a re-run copies those paths back over the fresh inference.

import type { BusinessProfile, EditableFieldPath } from "./schema";

type Applier = (target: BusinessProfile, source: BusinessProfile) => void;

const COPIERS: Record<EditableFieldPath, Applier> = {
  "identity.brandName": (t, s) => {
    t.identity.brandName = { ...s.identity.brandName };
  },
  "identity.aliases": (t, s) => {
    t.identity.aliases = { ...s.identity.aliases, values: [...s.identity.aliases.values] };
  },
  "identity.domains": (t, s) => {
    t.identity.domains = [...s.identity.domains];
  },
  description: (t, s) => {
    t.description = { ...s.description };
  },
  industry: (t, s) => {
    t.industry = { ...s.industry };
  },
  archetype: (t, s) => {
    t.archetype = { ...s.archetype };
  },
  brandIdentity: (t, s) => {
    t.brandIdentity = s.brandIdentity.map((x) => ({ ...x }));
  },
  offerings: (t, s) => {
    t.offerings = { ...s.offerings, values: [...s.offerings.values], items: s.offerings.items.map((x) => ({ ...x })) };
  },
  targetAudience: (t, s) => {
    t.targetAudience = s.targetAudience.map((x) => ({ ...x }));
    t.personas = { values: s.targetAudience.map((a) => a.value), source: "user", evidenceIds: [], confidence: 100 };
  },
  markets: (t, s) => {
    t.markets = s.markets.map((x) => ({ ...x }));
    t.geography = {
      ...t.geography,
      countries: s.markets.filter((m) => m.level === "country").map((m) => m.name),
      regions: s.markets.filter((m) => m.level === "region").map((m) => m.name),
      cities: s.markets.filter((m) => m.level === "city").map((m) => m.name),
      neighborhoods: s.markets.filter((m) => m.level === "neighborhood" || m.level === "district").map((m) => m.name),
      source: "user",
    };
  },
  classification: (t, s) => {
    if (s.classification) t.classification = structuredClone(s.classification);
    t.industry = { ...s.industry };
    t.archetype = { ...s.archetype };
    t.regulatedDomain = { ...s.regulatedDomain };
  },
  location: (t, s) => {
    if (s.location) t.location = structuredClone(s.location);
    t.markets = s.markets.map((x) => ({ ...x }));
    t.geography = structuredClone(s.geography);
  },
  marketScope: (t, s) => {
    t.marketScope = { ...s.marketScope };
  },
};

/** Copies user-edited fields from `edited` onto a freshly inferred profile. */
export function mergeUserEdits(fresh: BusinessProfile, edited: BusinessProfile, editedPaths: string[]): BusinessProfile {
  const merged = structuredClone(fresh);
  const applied: string[] = [];
  for (const path of editedPaths) {
    const copier = COPIERS[path as EditableFieldPath];
    if (!copier) continue;
    copier(merged, edited);
    applied.push(path);
  }
  if (applied.length > 0) {
    merged.quality = {
      ...merged.quality,
      warnings: [...merged.quality.warnings, `Kept your edits to ${applied.length} field(s) from the previous version.`],
    };
  }
  return merged;
}
