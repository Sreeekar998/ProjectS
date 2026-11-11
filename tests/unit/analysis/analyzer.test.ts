import { describe, expect, it } from "vitest";
import { analyzeObservation } from "@/lib/analysis/analyzer";
import { GOLD_CASES } from "../../fixtures/analysis/gold-cases";
import { HOLDOUT_CASES } from "../../fixtures/analysis/holdout-cases";
import type { GoldCase } from "../../fixtures/analysis/gold-cases";

function run(c: GoldCase) {
  const entities = c.entities.map((e) => ({
    id: e.id, projectId: "p", kind: e.kind, canonicalName: e.canonicalName,
    entityType: e.entityType ?? "company", parentEntityId: e.parentEntityId ?? null,
    domains: e.domains ?? [], canonicalDomain: e.domains?.[0] ?? null, status: "confirmed",
  }));
  const aliases = new Map<string, string[]>();
  for (const e of c.entities) if (e.aliases) aliases.set(e.id, e.aliases);
  return analyzeObservation({
    observationId: c.id, promptCandidateId: "pc", section: c.section,
    providerExperience: "chatgpt_plus_manual", responseText: c.responseText,
    sourceUrls: c.sourceUrls ?? [], captured: true,
    entities: entities as never, aliasesByEntity: aliases,
  });
}

describe("observation analysis — labelled cases", () => {
  for (const c of [...GOLD_CASES, ...HOLDOUT_CASES]) {
    it(`${c.id}: ${c.note}`, () => {
      const result = run(c);

      // Presence, in both directions. A brand reported present when it is not
      // inflates visibility; a missed brand deflates it.
      const present = new Set(result.occurrences.map((o) => o.name));
      for (const name of Object.keys(c.expect.roles)) expect(present, `missing ${name}`).toContain(name);
      for (const name of c.expect.absent ?? []) expect(present, `falsely present ${name}`).not.toContain(name);

      // Strongest role per entity.
      const order = { RECOMMENDED: 0, DISCOURAGED: 1, COMPARED: 2, BACKGROUND: 3, MENTION_ONLY: 4, UNCLEAR: 5 };
      const roles = new Map<string, string>();
      for (const o of result.occurrences) {
        const current = roles.get(o.name);
        if (!current || order[o.role] < order[current as keyof typeof order]) roles.set(o.name, o.role);
      }
      for (const [name, role] of Object.entries(c.expect.roles)) expect(roles.get(name), `role of ${name}`).toBe(role);

      expect(result.rankEligibility).toBe(c.expect.rankEligibility);

      // A rank may never exist on a response that cannot carry one.
      if (!["explicit_ordered_list", "ordered_prose"].includes(result.rankEligibility)) {
        for (const p of result.positions) expect(p.explicitRank, `invented rank for ${p.name}`).toBeNull();
      }
      for (const [name, rank] of Object.entries(c.expect.ranks ?? {})) {
        expect(result.positions.find((p) => p.name === name)?.explicitRank).toBe(rank);
      }

      for (const expected of c.expect.comparisons ?? []) {
        const found = result.comparisons.find(
          (x) => x.subjectName === expected.subject && x.objectName === expected.object && x.preference === expected.preference,
        );
        expect(found, `comparison ${expected.subject} vs ${expected.object} => ${expected.preference}`).toBeTruthy();
      }

      for (const [name, expected] of Object.entries(c.expect.sentiment ?? {})) {
        expect(result.sentiment.find((s) => s.entityName === name)?.overallPortrayal, `sentiment of ${name}`).toBe(expected.overall);
      }

      for (const expected of c.expect.citations ?? []) {
        const found = result.citations.find((x) => x.domain === expected.domain);
        expect(found?.ownership).toBe(expected.ownership);
        expect(found?.ownerMentionedInText).toBe(expected.ownerMentionedInText);
      }

      for (const name of c.expect.emerging ?? []) {
        expect(result.emergingCandidates.map((e) => e.name), `emerging ${name}`).toContain(name);
      }

      // Every span must resolve to the text it claims.
      expect(result.warnings.filter((w) => w.code === "span_mismatch")).toHaveLength(0);
    });
  }
});

describe("analysis eligibility", () => {
  it("never turns a failed capture into an absent brand", () => {
    const result = analyzeObservation({
      observationId: "o1", promptCandidateId: "pc", section: "Discovery",
      providerExperience: "chatgpt_plus_manual", responseText: "", sourceUrls: [],
      captured: false, entities: [], aliasesByEntity: new Map(),
    });
    expect(result.eligibility).toBe("NOT_CAPTURED");
    expect(result.occurrences).toHaveLength(0);
    expect(result.warnings[0]?.code).toBe("not_captured");
  });
});
