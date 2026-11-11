import { describe, expect, it } from "vitest";
import { openingKeys, selectSection, type ScoredCandidate } from "@/lib/prompts/selector";
import { validateNaturalQuery } from "@/lib/prompts/natural-validator";

function candidate(index: number, text: string, category: string, extra: string[] = []): ScoredCandidate {
  return {
    id: `c${index}`,
    section: "Discovery",
    qualityScore: 92,
    coverageKeys: [`category:${category}`, ...extra],
    competitorEntityId: null,
    topicId: null,
    sentimentTheme: null,
    evaluationCriterion: null,
    register: "question",
    categoryKey: `category:${category}`,
    maxSimilarity: 0.2,
    sequence: index,
    capKeys: [...openingKeys(text), ...extra.filter((key) => /^(budget|shape|style|placeRole):/.test(key))],
  };
}

describe("Discovery selection caps", () => {
  it("keeps openings, stock first words, money and each need from filling the section", () => {
    const needs = ["a", "b", "c", "d", "e", "f"];
    const pool: ScoredCandidate[] = [];
    let index = 0;
    for (const need of needs) {
      pool.push(candidate(index++, `Which ${need} shop is good?`, need));
      pool.push(candidate(index++, `best ${need} shops in leeds`, need, ["budget:stated"]));
      pool.push(candidate(index++, `where can i get ${need} in leeds`, need));
      pool.push(candidate(index++, `my ${need} broke, who fixes it in leeds`, need));
    }
    const { selected } = selectSection("Discovery", pool);
    expect(selected).toHaveLength(10);
    const texts = selected.map((item) => pool.find((c) => c.id === item.id)!);
    expect(texts.filter((item) => item.capKeys!.includes("first:which")).length).toBeLessThanOrEqual(1);
    expect(texts.filter((item) => item.capKeys!.includes("budget:stated")).length).toBeLessThanOrEqual(1);
    const perNeed = new Map<string, number>();
    for (const item of texts) perNeed.set(item.categoryKey!, (perNeed.get(item.categoryKey!) ?? 0) + 1);
    expect(Math.max(...perNeed.values())).toBeLessThanOrEqual(2);
  });
});

describe("relaxing caps on a thin pool", () => {
  it("drops style and opening caps before letting one need take more than two slots", () => {
    // Five needs, one of them with many passing prompts, all opening alike.
    const pool: ScoredCandidate[] = [];
    let index = 0;
    for (const need of ["a", "b", "c", "d", "e"]) for (let copy = 0; copy < 3; copy += 1) pool.push(candidate(index++, `which ${need} place ${copy}`, need));
    const { selected } = selectSection("Discovery", pool);
    expect(selected).toHaveLength(10);
    const perNeed = new Map<string, number>();
    for (const item of selected) perNeed.set(item.categoryKey!, (perNeed.get(item.categoryKey!) ?? 0) + 1);
    expect(Math.max(...perNeed.values())).toBe(2);
  });

  it("never lets a second price prompt in, even when other caps relax", () => {
    const pool: ScoredCandidate[] = [];
    let index = 0;
    for (const need of ["a", "b", "c"]) for (let copy = 0; copy < 4; copy += 1) pool.push(candidate(index++, `best ${need} under $${copy}0`, need, ["budget:stated"]));
    for (const need of ["d", "e"]) pool.push(candidate(index++, `good ${need} shops`, need));
    const { selected } = selectSection("Discovery", pool);
    expect(selected.filter((item) => item.capKeys!.includes("budget:stated"))).toHaveLength(1);
  });
});

describe("natural-language gate on real phrasing", () => {
  // In LMArena's Search Arena logs 57% of English recommendation prompts end
  // without punctuation and only 26% with "?".
  it.each([
    "what are the best nail salons in leeds",
    "is there a decent spanish course online that isn't just flashcards",
    "My dog panics at the vet. Is there a clinic in Leeds that's good with nervous pets",
    "Where in Leeds should I go for frizzy hair?",
    "Our invoices are a mess. What accounting software should we try?",
    "find us a moving company in Porto for next month",
  ])("accepts %s", (text) => {
    expect(validateNaturalQuery({ text, section: "Discovery" }).ok).toBe(true);
  });

  it.each(["how does a water heater work", "what should I look for in a plumber", "salons in leeds"])("still rejects %s", (text) => {
    expect(validateNaturalQuery({ text, section: "Discovery" }).ok).toBe(false);
  });
});
