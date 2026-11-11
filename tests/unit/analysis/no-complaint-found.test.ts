import { describe, expect, it } from "vitest";
import { analyzeObservation } from "@/lib/analysis/analyzer";

// observation-analysis@18. The only negative reading of a DIFC salon's run on
// 2026-10-15 was an answer reporting that it found no complaint.
const entities = [
  { id: "t", projectId: "p", kind: "target", canonicalName: "Atelier 10 Salon", entityType: "company", parentEntityId: null, domains: ["atelier10.ae"], canonicalDomain: "atelier10.ae", status: "confirmed" },
];

function portrayal(text: string): string {
  const result = analyzeObservation({
    observationId: "o", promptCandidateId: "pc", section: "Sentiment Analysis", providerExperience: "chatgpt_cloro_web",
    responseText: text, sourceUrls: [], captured: true, entities: entities as never, aliasesByEntity: new Map([["t", ["Atelier 10"]]]),
  });
  return result.sentiment.find((s) => s.entityId === "t")?.overallPortrayal ?? "NO_SENTIMENT";
}

describe("Reporting that no complaint was found", () => {
  it("is not a negative opinion", () => {
    expect(portrayal("I looked into Atelier 10 Salon in DIFC, Dubai, and I couldn't find a clearly documented public complaint specifically about unexpected charges for keratin treatments at this salon.")).toBe("NO_SENTIMENT");
    expect(portrayal("No public complaints about Atelier 10 Salon were found in recent reviews.")).toBe("NO_SENTIMENT");
  });

  it("is not read into a restatement of what was searched for, or a caveat about the lack of complaints", () => {
    expect(portrayal("I looked into **Atelier 10 in Dubai’s DIFC** to see whether anyone has reported safety problems with their lash extensions.")).toBe("NO_SENTIMENT");
    expect(portrayal("Atelier 10 Salon has no public record of colour damage, but I also wouldn't interpret the lack of complaints as proof that it never happens.")).toBe("NO_SENTIMENT");
  });

  it("reads praise with a condition, and leaves a real offer to search alone", () => {
    expect(portrayal("Yes — **Atelier 10 Salon is a solid choice for a fresh colour**, especially if you like soft, lived-in blondes.")).toBe("POSITIVE");
    expect(portrayal("If you'd like, I can dig through reviews of Atelier 10 Salon for complaints about pricing.")).toBe("NO_SENTIMENT");
  });

  it("still reads a real complaint as negative", () => {
    expect(portrayal("Several customers complain that Atelier 10 Salon adds unexpected charges.")).toBe("NEGATIVE");
  });
});
