import { describe, expect, it } from "vitest";
import { orderRivalsByTierMix, type TierOrderedRival } from "@/lib/landscape/competitor-tier-order";
import { snapshotEntities } from "@/lib/prompts/orchestrator";
import type { FrozenCompetitorSnapshotV2 } from "@/lib/landscape/competitor-types";

function rival(name: string, confidence: number, tier?: "area" | "city" | "country", competitorType = "direct"): TierOrderedRival {
  return { canonicalName: name, confidence, competitorType, candidateProfile: tier ? { tier: { tier, place: "x" } } : null };
}

/** The ranking Trade Offs used before tiers (intent-generation competitorsFor). */
function legacyOrder(entities: TierOrderedRival[], max: number): TierOrderedRival[] {
  return [...entities]
    .sort((a, b) => (b.confidence ?? 0) + (b.competitorType === "direct" ? 8 : 0) - ((a.confidence ?? 0) + (a.competitorType === "direct" ? 8 : 0)) || a.canonicalName.localeCompare(b.canonicalName))
    .slice(0, max);
}

describe("orderRivalsByTierMix", () => {
  it("takes rivals round-robin area → city → country, each tier ranked by confidence", () => {
    const entities = [
      ...[90, 80, 70, 60, 50, 40].map((c, i) => rival(`Area ${i + 1}`, c, "area")),
      ...[88, 78, 68, 58, 48, 38].map((c, i) => rival(`City ${i + 1}`, c, "city")),
      ...[99, 89, 79].map((c, i) => rival(`Country ${i + 1}`, c, "country")),
    ];
    expect(orderRivalsByTierMix(entities, 5).map((e) => e.canonicalName)).toEqual(["Area 1", "City 1", "Country 1", "Area 2", "City 2"]);
  });

  it("skips empty tiers and keeps directness as a bonus inside a tier", () => {
    const entities = [rival("Adjacent High", 80, "city", "adjacent"), rival("Direct Lower", 75, "city"), rival("Only Country", 50, "country")];
    expect(orderRivalsByTierMix(entities, 5).map((e) => e.canonicalName)).toEqual(["Direct Lower", "Only Country", "Adjacent High"]);
  });

  it("orders a set frozen before tiers exactly as before", () => {
    const entities = [rival("Pret", 83, undefined, "adjacent"), rival("Costa", 80), rival("Subway", 76), rival("Beef Chain", 70), rival("Alpha", 78), rival("Beta", 78), rival("Gamma", 60, undefined, "substitute")];
    expect(orderRivalsByTierMix(entities, 5)).toEqual(legacyOrder(entities, 5));
    expect(orderRivalsByTierMix(entities)).toEqual(legacyOrder(entities, entities.length));
  });

  it("puts untiered rows of a mixed set after the tiered ones in each round", () => {
    const entities = [rival("Manual", 100), rival("Area", 50, "area"), rival("Country", 40, "country")];
    expect(orderRivalsByTierMix(entities, 3).map((e) => e.canonicalName)).toEqual(["Area", "Country", "Manual"]);
  });
});

describe("snapshotEntities", () => {
  const base = { normalizedName: "x", canonicalDomain: null, aliases: [], competitorType: "direct", entityType: "company", confidence: 80, reason: null, provenance: ["web_search"], matchedDimensions: [], scoreBreakdown: {}, evidenceIds: [], verificationStatus: null };

  it("carries each frozen rival's tier into the generation entities, and nothing for older sets", () => {
    const snapshot: FrozenCompetitorSnapshotV2[] = [
      { ...base, entityId: "ent_1", canonicalName: "Salon Near", tier: "area", tierPlace: "DIFC" },
      { ...base, entityId: "ent_2", canonicalName: "Old Rival" },
    ];
    const [tiered, legacy] = snapshotEntities("prj_1", snapshot);
    expect(tiered!.candidateProfile).toEqual({ tier: { tier: "area", place: "DIFC" } });
    expect(legacy!.candidateProfile).toBeNull();
    expect(orderRivalsByTierMix([legacy!, tiered!]).map((e) => e.canonicalName)).toEqual(["Salon Near", "Old Rival"]);
  });
});
