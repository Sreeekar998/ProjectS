import { describe, expect, it } from "vitest";
import { detectEmergingCandidates } from "@/lib/analysis/mentions";

describe("untracked brand candidates", () => {
  it("ignores words capitalised only by a bullet, heading, bold label or sentence start", () => {
    const answer = [
      "## Budget picks",
      "- **Fit**: snug through the midfoot.",
      "1. Quick drying fabric matters.",
      "Even so, check the return policy.",
      "**Tip:** Even if you run daily, rotate pairs.",
      "### Finding the Right Pair",
      "Most runners want the Right Pair, and the right pair matters.",
    ].join("\n");
    expect(detectEmergingCandidates(answer, []).map((candidate) => candidate.name)).toEqual([]);
  });

  it("keeps a name written capitalised mid-sentence, with every occurrence as evidence", () => {
    const answer = "Hoka is popular.\nMany runners also rate Hoka for long runs.";
    const found = detectEmergingCandidates(answer, []);
    expect(found.map((candidate) => candidate.name)).toEqual(["Hoka"]);
    expect(found[0]!.spans).toHaveLength(2);
  });
});
