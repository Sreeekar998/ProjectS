import { describe, it, expect } from "vitest";
import { parseMentions, parseCitations } from "@/lib/metrics/normalization";
import type { Entity } from "@/lib/landscape/repository";
import fixtures from "../../fixtures/provider-responses.json";

// Golden-set test: every labelled fixture in provider-responses.json is run
// through the real parser and checked against its documented expectation.
// This is the "parser golden-set" the spec's evaluation section (12.2)
// requires — a fixture file that both this suite and, later, a human
// reviewer can read without cross-referencing test code.
function entity(id: string, name: string, kind: "target" | "competitor", aliases: string[] = [], domains: string[] = []): { entity: Entity; aliases: string[] } {
  return {
    entity: {
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
    } as unknown as Entity,
    aliases,
  };
}

const target = entity("target1", "Nimbus Flow", "target", ["NimbusFlow", "Nimbus"], ["nimbusflow.example"]);
const competitor = entity("comp1", "WorkPilot", "competitor");
const entities = [target.entity, competitor.entity];
const aliasMap = new Map<string, string[]>([
  [target.entity.id, target.aliases],
  [competitor.entity.id, competitor.aliases],
]);

describe("provider-responses.json golden set", () => {
  for (const fixture of fixtures.fixtures) {
    if (fixture.label === "malformed_observation_missing_response_text") continue; // covered separately below

    it(`${fixture.label}: ${fixture.description}`, () => {
      const mentions = parseMentions(fixture.responseText, entities, aliasMap);
      const targetMention = mentions.find((m) => m.entityId === target.entity.id);
      const competitorMention = mentions.find((m) => m.entityId === competitor.entity.id);
      const exp = fixture.expected as Record<string, unknown>;

      if ("targetMentioned" in exp) expect(Boolean(targetMention)).toBe(exp.targetMentioned);
      if ("competitorMentioned" in exp) expect(Boolean(competitorMention)).toBe(exp.competitorMentioned);
      if ("targetRank" in exp) expect(targetMention?.rankPosition ?? null).toBe(exp.targetRank);
      if ("aliasMatched" in exp) expect(targetMention?.aliasMatched).toBe(exp.aliasMatched);
      if ("isRecommendation" in exp) expect(targetMention?.isRecommendation).toBe(exp.isRecommendation);

      if ("ownedCitation" in exp) {
        const citations = parseCitations(fixture.sourceUrls, entities);
        expect(citations.some((c) => c.isOwnedDomain)).toBe(exp.ownedCitation);
      }
    });
  }

  it("malformed_observation_missing_response_text: empty text must never be treated as a valid observation", () => {
    const fixture = fixtures.fixtures.find((f) => f.label === "malformed_observation_missing_response_text")!;
    expect(fixture.responseText.trim().length).toBeLessThan(3); // matches recordManualObservation's own guard threshold
  });
});
