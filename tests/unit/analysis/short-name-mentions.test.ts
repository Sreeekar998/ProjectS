import { describe, expect, it } from "vitest";
import { buildLinkTargets, detectMentions } from "@/lib/analysis/mentions";
import type { Entity } from "@/lib/landscape/repository";

function competitor(id: string, canonicalName: string, domains: string[]): Entity {
  return { id, canonicalName, domains, canonicalDomain: domains[0] ?? null, kind: "competitor", status: "confirmed", parentEntityId: null, entityType: "company" } as unknown as Entity;
}

describe("mentions written with a company's shorter name", () => {
  const targets = buildLinkTargets(
    [competitor("brooks", "Brooks Sports", ["brooksrunning.com"]), competitor("ua", "Under Armour", ["underarmour.com"]), competitor("pancheros", "Pancheros Mexican Grill", ["pancheros.com"])],
    new Map(),
  );

  it("credits a proper-noun short name to the recorded company", () => {
    const found = detectMentions("For a first marathon the Brooks Ghost is a safe pick, and Pancheros does a decent burrito.", targets);
    expect(found.map((mention) => mention.entityId)).toEqual(["brooks", "pancheros"]);
    expect(found.every((mention) => mention.surfaceForm === "alias")).toBe(true);
  });

  it("ignores the same letters written as an ordinary word", () => {
    expect(detectMentions("Trails that follow babbling brooks are soft underfoot.", targets)).toEqual([]);
  });

  it("never shortens a name whose second word is part of the brand", () => {
    expect(detectMentions("Under $100, look at last season's models.", targets)).toEqual([]);
  });

  it("still prefers the full recorded name when it is written", () => {
    const found = detectMentions("Pancheros Mexican Grill opened nearby.", targets);
    expect(found).toHaveLength(1);
    expect(found[0]!.surfaceForm).toBe("exact_name");
  });
});
