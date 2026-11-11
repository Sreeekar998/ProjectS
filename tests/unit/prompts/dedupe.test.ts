import { describe, it, expect } from "vitest";
import { dedupeCandidates, type DedupableItem } from "@/lib/prompts/dedupe";

describe("dedupeCandidates", () => {
  it("marks byte-identical text in the same cohort as a duplicate", () => {
    const items: DedupableItem[] = [
      { id: "a", text: "What are the best running shoes?", cohort: "neutral_discovery" },
      { id: "b", text: "What are the best running shoes?", cohort: "neutral_discovery" },
    ];
    const { survivors, duplicateOf } = dedupeCandidates(items);
    expect(survivors).toEqual(["a"]);
    expect(duplicateOf.get("b")).toBe("a");
  });

  it("does not cross-cohort dedupe even when text is identical", () => {
    const items: DedupableItem[] = [
      { id: "a", text: "Is this a good choice?", cohort: "neutral_discovery" },
      { id: "b", text: "Is this a good choice?", cohort: "branded_accuracy" },
    ];
    const { survivors } = dedupeCandidates(items);
    expect(survivors).toEqual(["a", "b"]);
  });

  it("marks near-duplicate (high textual overlap) as a duplicate", () => {
    const items: DedupableItem[] = [
      { id: "a", text: "What are the best running shoes for beginners in Austin?", cohort: "neutral_discovery" },
      { id: "b", text: "What are the best running shoes for beginners near Austin?", cohort: "neutral_discovery" },
    ];
    const { survivors, duplicateOf } = dedupeCandidates(items);
    expect(survivors.length).toBe(1);
    expect(duplicateOf.size).toBe(1);
  });

  it("keeps genuinely distinct questions as separate survivors", () => {
    const items: DedupableItem[] = [
      { id: "a", text: "What are the best running shoes for beginners?", cohort: "neutral_discovery" },
      { id: "b", text: "Where can I buy trail running gear locally?", cohort: "neutral_discovery" },
    ];
    const { survivors } = dedupeCandidates(items);
    expect(survivors.length).toBe(2);
  });

  it("checks new items against anchors from a prior pass without ever marking an anchor itself a duplicate", () => {
    const anchors: DedupableItem[] = [{ id: "anchor1", text: "What are the best running shoes?", cohort: "neutral_discovery" }];
    const items: DedupableItem[] = [{ id: "new1", text: "What are the best running shoes?", cohort: "neutral_discovery" }];
    const { survivors, duplicateOf } = dedupeCandidates(items, anchors);
    expect(survivors).toEqual([]);
    expect(duplicateOf.get("new1")).toBe("anchor1");
  });

  it("lets a genuinely new item survive even when anchors exist", () => {
    const anchors: DedupableItem[] = [{ id: "anchor1", text: "What are the best running shoes?", cohort: "neutral_discovery" }];
    const items: DedupableItem[] = [{ id: "new1", text: "Where can I find a running gear specialist?", cohort: "neutral_discovery" }];
    const { survivors } = dedupeCandidates(items, anchors);
    expect(survivors).toEqual(["new1"]);
  });
});
