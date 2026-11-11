// Rival order for Trade Offs, mixed across geographic tiers.
//
// Trade Offs took the top five confirmed rivals by confidence, and every rival
// usually came from one level: a DIFC salon compared itself only with DIFC
// salons even after the operator confirmed city-wide and national names.
// Rivals are now ranked within their tier by the same key as before
// (confidence, +8 when direct, then name) and taken round-robin area → city →
// country. Rows without a tier (sets frozen before tiers) form one group, which
// reproduces the old order exactly.
//
// Client-safe.

import type { CompetitorTier } from "./tier-types";

export interface TierOrderedRival {
  canonicalName: string;
  confidence: number | null;
  competitorType: string | null;
  candidateProfile?: unknown;
}

const ORDER: Array<CompetitorTier | "none"> = ["area", "city", "country", "none"];

function tierOf(entity: TierOrderedRival): CompetitorTier | "none" {
  const profile = entity.candidateProfile;
  if (!profile || typeof profile !== "object") return "none";
  const tier = (profile as { tier?: { tier?: unknown } | null }).tier?.tier;
  return tier === "area" || tier === "city" || tier === "country" ? tier : "none";
}

function rank(a: TierOrderedRival, b: TierOrderedRival): number {
  return (
    (b.confidence ?? 0) + (b.competitorType === "direct" ? 8 : 0) - ((a.confidence ?? 0) + (a.competitorType === "direct" ? 8 : 0)) ||
    a.canonicalName.localeCompare(b.canonicalName)
  );
}

export function orderRivalsByTierMix<T extends TierOrderedRival>(entities: T[], maxRivals: number = entities.length): T[] {
  const groups = new Map<CompetitorTier | "none", T[]>();
  for (const entity of entities) {
    const tier = tierOf(entity);
    groups.set(tier, [...(groups.get(tier) ?? []), entity]);
  }
  const queues = ORDER.map((tier) => (groups.get(tier) ?? []).sort(rank)).filter((queue) => queue.length > 0);
  const out: T[] = [];
  for (let index = 0; out.length < maxRivals; index += 1) {
    let added = false;
    for (const queue of queues) {
      const next = queue[index];
      if (!next) continue;
      out.push(next);
      added = true;
      if (out.length >= maxRivals) break;
    }
    if (!added) break;
  }
  return out;
}

/** True when any rival carries a tier, i.e. the set was frozen with tiers. */
export function hasTieredRivals(entities: TierOrderedRival[]): boolean {
  return entities.some((entity) => tierOf(entity) !== "none");
}
