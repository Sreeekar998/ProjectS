import { describe, expect, it } from "vitest";
import { brandModifierTokens, brandTerms, classifyQuery, domainLabel, normalizeSearchText, splitBrandQueries, squash } from "@/lib/search-console/brand-split";

const row = (key: string, impressions = 10) => ({ key, clicks: 1, impressions, ctr: 0.1, position: 3 });

describe("brand terms", () => {
  it("come from the business's names and domain only", () => {
    const terms = brandTerms({ brandName: "Atelier 10 Salon", aliases: ["A10"], domain: "https://www.atelier10.test/" });
    expect(terms).toContain("atelier 10 salon");
    // "Atelier 10" (the short name the domain confirms) and the domain label squash to one term.
    expect(terms.map(squash)).toContain("atelier10");
    expect(terms).toContain("atelier10 test");
    expect(domainLabel("https://www.atelier10.co.uk/en")).toBe("atelier10");
    // Too short to be a safe brand term.
    expect(terms).not.toContain("a10");
  });
});

describe("splitBrandQueries", () => {
  const terms = brandTerms({ brandName: "Atelier 10", aliases: [], domain: "atelier10.test" });

  it("matches the squashed name however it is spaced or punctuated", () => {
    for (const query of ["atelier10", "atelier 10 prices", "Atelier-10 booking", "atelier10salon"]) {
      expect(classifyQuery(query, terms, []), query).toBe("branded");
    }
  });

  it("matches a one-letter misspelling of a longer name", () => {
    expect(classifyQuery("ateleir 10 reviews", terms, [])).toBe("branded");
    expect(classifyQuery("atelir10", terms, [])).toBe("branded");
    expect(classifyQuery("hair salon near me", terms, [])).toBe("non_brand");
  });

  it("counts domain-with-TLD searches as branded", () => {
    expect(classifyQuery("atelier10.test", terms, [])).toBe("branded");
    expect(classifyQuery("www atelier10 test", terms, [])).toBe("branded");
  });

  it("marks a short brand that is also an offering word as ambiguous, not branded", () => {
    const glow = brandTerms({ brandName: "Glow", aliases: [], domain: "glowbeauty.test" });
    const split = splitBrandQueries([row("glow facial"), row("glowbeauty"), row("eyebrow threading")], glow, ["Glow facial", "Brow shaping"]);
    expect(split.ambiguous.map((r) => r.key)).toEqual(["glow facial"]);
    expect(split.branded.map((r) => r.key)).toEqual(["glowbeauty"]);
    expect(split.nonBrand.map((r) => r.key)).toEqual(["eyebrow threading"]);
  });

  it("never lets a short name match inside another word", () => {
    const vela = brandTerms({ brandName: "Vela", aliases: [], domain: "" });
    expect(classifyQuery("novelas online", vela, [])).toBe("non_brand");
    expect(classifyQuery("vela spa", vela, [])).toBe("branded");
  });

  it("folds diacritics and keeps non-Latin letters", () => {
    expect(normalizeSearchText("Café Crème — Déjà")).toBe("cafe creme deja");
    const cafe = brandTerms({ brandName: "Café Crème", aliases: ["كافيه كريم"], domain: "" });
    expect(classifyQuery("cafe creme menu", cafe, [])).toBe("branded");
    expect(classifyQuery("كافيه كريم دبي", cafe, [])).toBe("branded");
  });

  it("extracts what searchers add to the brand name", () => {
    expect(brandModifierTokens("atelier 10 prices", terms)).toEqual(["prices"]);
    expect(brandModifierTokens("atelier10 vs", terms)).toEqual(["vs"]);
    expect(brandModifierTokens("ateleir10 reviews 2026", terms)).toEqual(["reviews"]);
  });
});
