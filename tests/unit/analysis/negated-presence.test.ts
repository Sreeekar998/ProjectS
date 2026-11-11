import { describe, expect, it } from "vitest";
import { analyzeObservation } from "@/lib/analysis/analyzer";
import { AGGREGATABLE_CONFIDENCE } from "@/lib/analysis/types";

const entities = [
  { id: "t", projectId: "p", kind: "target", canonicalName: "Nike", entityType: "company", parentEntityId: null, domains: ["nike.com"], canonicalDomain: "nike.com", status: "confirmed" },
  { id: "c", projectId: "p", kind: "competitor", canonicalName: "Asics", entityType: "company", parentEntityId: null, domains: ["asics.com"], canonicalDomain: "asics.com", status: "confirmed" },
];

function analyse(section: "Discovery" | "Sentiment Analysis", responseText: string) {
  return analyzeObservation({
    observationId: "o",
    promptCandidateId: "pc",
    section,
    providerExperience: "gemini_free_api",
    responseText,
    sourceUrls: [],
    captured: true,
    entities: entities as never,
    aliasesByEntity: new Map(),
  });
}

describe("a brand named inside a negated clause", () => {
  it("is still present, and the answer stays measurable", () => {
    const result = analyse("Sentiment Analysis", "No, Nike does not charge for return shipping. Returns are free for members within 60 days.");
    const nike = result.occurrences.find((occurrence) => occurrence.name === "Nike");
    expect(nike?.role).toBe("UNCLEAR");
    expect(AGGREGATABLE_CONFIDENCE).toContain(nike!.confidence);
    expect(result.eligibility).toBe("ELIGIBLE");
  });

  it("counts toward presence without being credited as a recommendation", () => {
    const result = analyse("Discovery", "Nike isn't a budget brand, but Asics is a solid pick for new runners.");
    expect(result.eligibility).toBe("ELIGIBLE");
    expect(result.occurrences.find((occurrence) => occurrence.name === "Nike")?.role).not.toBe("RECOMMENDED");
    expect(result.occurrences.find((occurrence) => occurrence.name === "Asics")?.role).toBe("RECOMMENDED");
  });
});
