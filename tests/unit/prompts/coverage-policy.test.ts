import { describe, it, expect } from "vitest";
import { buildCoveragePolicy } from "@/lib/prompts/coverage-policy";
import type { BusinessArchetype } from "@/lib/profile/schema";
import type { Topic, Entity } from "@/lib/landscape/repository";

function makeTopics(n: number): Topic[] {
  return Array.from({ length: n }, (_, i) => ({
    id: `topic${i}`,
    projectId: "p1",
    businessProfileVersionId: "bpv1",
    name: `Topic ${i}`,
    description: "",
    priority: i,
    status: "confirmed",
    source: "system",
    evidenceIds: [],
    createdAt: new Date(),
  })) as unknown as Topic[];
}

function makeCompetitors(n: number): Entity[] {
  return Array.from({ length: n }, (_, i) => ({
    id: `comp${i}`,
    projectId: "p1",
    kind: "competitor",
    competitorType: "direct",
    canonicalName: `Competitor ${i}`,
    domains: [],
    status: "confirmed",
    confidence: 80,
    reason: "",
    geographyRelevance: null,
    evidenceIds: [],
    source: "system",
    createdAt: new Date(),
  })) as unknown as Entity[];
}

const ARCHETYPES: BusinessArchetype[] = [
  "b2b_saas_enterprise",
  "ecommerce_dtc_retail",
  "local_service",
  "dealership",
  "restaurant_food_chain",
  "multi_location_chain",
  "healthcare",
  "finance",
  "marketplace",
  "travel_hospitality",
  "education",
  "other",
];

describe("buildCoveragePolicy", () => {
  it.each(ARCHETYPES)("produces exactly 30 cells (10/10/10 split) for archetype %s with 4 topics", (archetype) => {
    const policy = buildCoveragePolicy(archetype, makeTopics(4), makeCompetitors(2));
    expect(policy.cells.length).toBe(30);
    const neutral = policy.cells.filter((c) => c.cohort.startsWith("neutral"));
    const branded = policy.cells.filter((c) => c.cohort === "branded_accuracy");
    const comparison = policy.cells.filter((c) => c.cohort === "target_comparison");
    expect(neutral.length).toBe(10);
    expect(branded.length).toBe(10);
    expect(comparison.length).toBe(10);
  });

  it("still produces exactly 30 cells with 6 topics and zero confirmed competitors", () => {
    const policy = buildCoveragePolicy("ecommerce_dtc_retail", makeTopics(6), []);
    expect(policy.cells.length).toBe(30);
  });

  it("assigns every Discovery cell TARGET_FORBIDDEN", () => {
    const policy = buildCoveragePolicy("b2b_saas_enterprise", makeTopics(5), makeCompetitors(1));
    const neutral = policy.cells.filter((c) => c.cohort.startsWith("neutral"));
    for (const cell of neutral) {
      expect(cell.brandPolicy).toBe("TARGET_FORBIDDEN");
      expect(cell.section).toBe("Discovery");
    }
  });

  it("assigns every branded_accuracy and target_comparison cell TARGET_REQUIRED", () => {
    const policy = buildCoveragePolicy("b2b_saas_enterprise", makeTopics(5), makeCompetitors(1));
    const branded = policy.cells.filter((c) => c.cohort === "branded_accuracy" || c.cohort === "target_comparison");
    for (const cell of branded) {
      expect(cell.brandPolicy).toBe("TARGET_REQUIRED");
    }
  });

  it("exposes exactly the three required prompt sections with a 21/4/5 policy", () => {
    const policy = buildCoveragePolicy("finance", makeTopics(5), makeCompetitors(3));
    const counts = policy.cells.reduce((map, cell) => map.set(cell.section, (map.get(cell.section) ?? 0) + 1), new Map<string, number>());
    expect([...counts.keys()].sort()).toEqual(["Discovery", "Sentiment Analysis", "Trade Offs"]);
    expect(counts.get("Discovery")).toBe(10);
    expect(counts.get("Trade Offs")).toBe(10);
    expect(counts.get("Sentiment Analysis")).toBe(10);
  });

  it("never binds geography to a cell when no location evidence is available", () => {
    const policy = buildCoveragePolicy("local_service", makeTopics(4), makeCompetitors(1), []);
    const geoCells = policy.cells.filter((c) => c.geographyScope !== "none");
    expect(geoCells.length).toBe(0);
  });

  it("gives each cell within a (cohort, intent) family a distinct cellIndex", () => {
    const policy = buildCoveragePolicy("b2b_saas_enterprise", makeTopics(4), makeCompetitors(1));
    const branded = policy.cells.filter((c) => c.cohort === "branded_accuracy");
    const indices = branded.map((c) => c.cellIndex).sort((a, b) => a - b);
    expect(indices).toEqual([0, 1, 2, 3, 4, 5, 6, 7, 8, 9]);
  });
});
