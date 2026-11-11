import { describe, it, expect } from "vitest";
import { parseMentions, parseCitations } from "@/lib/metrics/normalization";
import type { Entity } from "@/lib/landscape/repository";

function entity(id: string, name: string, kind: "target" | "competitor", domains: string[] = []): Entity {
  return {
    id,
    projectId: "p1",
    kind,
    competitorType: kind === "competitor" ? "direct" : null,
    canonicalName: name,
    domains,
    status: "confirmed",
    confidence: 100,
    reason: "",
    geographyRelevance: null,
    evidenceIds: [],
    source: "system",
    createdAt: new Date(),
  } as unknown as Entity;
}

describe("parseMentions", () => {
  const target = entity("target1", "Acme Running", "target");
  const competitor = entity("comp1", "RivalRun", "competitor");
  const entities = [target, competitor];
  const aliases = new Map<string, string[]>([[target.id, ["Acme"]]]);

  it("finds a target-brand mention", () => {
    const mentions = parseMentions("I'd recommend checking out Acme Running for trail shoes.", entities, aliases);
    expect(mentions.some((m) => m.entityId === target.id)).toBe(true);
  });

  it("finds a competitor-only mention with no target mention (no-mention case for target)", () => {
    const mentions = parseMentions("RivalRun is a solid choice for beginners.", entities, aliases);
    expect(mentions.some((m) => m.entityId === competitor.id)).toBe(true);
    expect(mentions.some((m) => m.entityId === target.id)).toBe(false);
  });

  it("finds an alias mention", () => {
    const mentions = parseMentions("Acme is well known for quality.", entities, aliases);
    expect(mentions.some((m) => m.entityId === target.id && m.aliasMatched === "Acme")).toBe(true);
  });

  it("assigns explicit rank from a numbered list", () => {
    const text = "Here are some options:\n1. Acme Running\n2. RivalRun\n3. Some Other Brand";
    const mentions = parseMentions(text, entities, aliases);
    const targetMention = mentions.find((m) => m.entityId === target.id);
    const competitorMention = mentions.find((m) => m.entityId === competitor.id);
    expect(targetMention?.rankPosition).toBe(1);
    expect(competitorMention?.rankPosition).toBe(2);
  });

  it("does not fabricate a rank from ambiguous prose", () => {
    const text = "Both Acme Running and RivalRun are popular choices, depending on your needs.";
    const mentions = parseMentions(text, entities, aliases);
    for (const m of mentions) expect(m.rankPosition).toBeNull();
  });

  it("marks a list-item mention as a recommendation", () => {
    const text = "Top picks:\n1. Acme Running — great for trails";
    const mentions = parseMentions(text, entities, aliases);
    const targetMention = mentions.find((m) => m.entityId === target.id);
    expect(targetMention?.isRecommendation).toBe(true);
  });

  it("does not match a substring that is not a whole word", () => {
    // "Acme" should not match inside "Academy"
    const mentions = parseMentions("Check out the Running Academy downtown.", entities, aliases);
    expect(mentions.some((m) => m.entityId === target.id)).toBe(false);
  });

  it("returns no mentions for text with neither brand present (true no-mention case)", () => {
    const mentions = parseMentions("You could try a local sporting goods store.", entities, aliases);
    expect(mentions.length).toBe(0);
  });
});

describe("parseCitations", () => {
  const target = entity("target1", "Acme Running", "target", ["acmerunning.com"]);
  const competitor = entity("comp1", "RivalRun", "competitor", ["rivalrun.com"]);
  const entities = [target, competitor];

  it("marks a citation to the target's own domain as owned", () => {
    const citations = parseCitations(["https://acmerunning.com/shoes"], entities);
    expect(citations[0]!.isOwnedDomain).toBe(true);
    expect(citations[0]!.matchedEntityId).toBe(target.id);
  });

  it("marks a citation to a competitor domain as not owned", () => {
    const citations = parseCitations(["https://rivalrun.com/shoes"], entities);
    expect(citations[0]!.isOwnedDomain).toBe(false);
    expect(citations[0]!.matchedEntityId).toBe(competitor.id);
  });

  it("leaves an unrelated domain unmatched", () => {
    const citations = parseCitations(["https://runnersworld.com/review"], entities);
    expect(citations[0]!.matchedEntityId).toBeNull();
    expect(citations[0]!.isOwnedDomain).toBe(false);
  });

  it("handles a malformed URL without throwing", () => {
    const citations = parseCitations(["not a url"], entities);
    expect(citations[0]!.domain).toBe("");
    expect(citations[0]!.matchedEntityId).toBeNull();
  });
});
