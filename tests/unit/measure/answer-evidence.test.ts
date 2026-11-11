// What an answer view marks: only confidently linked brands, and every
// listed source with the ownership the analysis recorded.

import { describe, expect, it } from "vitest";
import { highlightsFor, sourcesFor } from "@/lib/measure/answer-evidence";

describe("highlightsFor", () => {
  it("marks exact and strong links by relation, untracked names by their spans, and skips weak matches", () => {
    const highlights = highlightsFor(
      {
        occurrences: [
          { entityId: "t", confidence: "exact", relation: "target", name: "TrailStride", mention: { text: "TrailStride" } },
          { entityId: "tp", confidence: "strong", relation: "target_product", name: "TrailStride", mention: { text: "Ridge" } },
          { entityId: "a", confidence: "strong", relation: "confirmed_competitor", name: "Salomon", mention: { text: "Salomon" } },
          { entityId: "b", confidence: "weak", relation: "confirmed_competitor", name: "Hoka", mention: { text: "Hoka" } },
          { entityId: null, confidence: "exact", relation: "unknown", name: "Nobody", mention: { text: "Nobody" } },
        ],
        emergingCandidates: [{ name: "Brooks", mentions: [{ text: "Brooks" }, null] }],
      },
      "t",
    );
    expect(highlights).toEqual([
      { surface: "TrailStride", tone: "target" },
      { surface: "Ridge", tone: "target" },
      { surface: "Salomon", tone: "rival" },
      { surface: "Brooks", tone: "untracked" },
      { surface: "Brooks", tone: "untracked" },
    ]);
    expect(highlightsFor(null, "t")).toEqual([]);
  });
});

describe("sourcesFor", () => {
  it("keeps the page's order and labels each URL with the recorded owner, unknown when the analysis did not see it", () => {
    const sources = sourcesFor(
      ["https://salomon.com/x", "https://trailstride.example/shoes", "https://reddit.com/r/x", "https://new.example/"],
      [
        { url: "https://salomon.com/x", ownership: "COMPETITOR_OWNED", ownerEntityId: "a" },
        { url: "https://trailstride.example/shoes", ownership: "TARGET_OWNED", ownerEntityId: "t" },
        { url: "https://reddit.com/r/x", ownership: "THIRD_PARTY", ownerEntityId: null },
      ],
      new Map([["a", "Salomon"], ["t", "TrailStride"]]),
    );
    expect(sources).toEqual([
      { url: "https://salomon.com/x", ownership: "COMPETITOR_OWNED", ownerName: "Salomon" },
      { url: "https://trailstride.example/shoes", ownership: "TARGET_OWNED", ownerName: "TrailStride" },
      { url: "https://reddit.com/r/x", ownership: "THIRD_PARTY", ownerName: null },
      { url: "https://new.example/", ownership: "UNKNOWN", ownerName: null },
    ]);
  });
});
