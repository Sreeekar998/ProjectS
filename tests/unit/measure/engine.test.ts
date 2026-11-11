import { describe, expect, it } from "vitest";
import { computeMeasure, type EngineInput } from "@/lib/measure/engine";
import type { NormalizedObservation } from "@/lib/analysis/types";

const TARGET = "e_target";
const A = "e_a";
const B = "e_b";

function obs(partial: Partial<NormalizedObservation> & { observationId: string }): NormalizedObservation {
  return {
    promptCandidateId: "pc1",
    section: "Discovery",
    providerExperience: "chatgpt_plus_manual",
    analysisVersion: "observation-analysis@1",
    analysedAt: 0,
    eligibility: "ELIGIBLE",
    sourceHash: "h",
    occurrences: [],
    comparisons: [],
    positions: [],
    rankEligibility: "not_rankable",
    sentiment: [],
    citations: [],
    sourceCaptureState: "complete",
    emergingCandidates: [],
    warnings: [],
    reviewedBy: null,
    supersedesAnalysisId: null,
    ...partial,
  } as NormalizedObservation;
}

/** A present, aggregatable occurrence of one entity. */
function present(entityId: string, name: string, extra: Partial<NormalizedObservation["occurrences"][number]> = {}) {
  return {
    entityId, name, surfaceForm: "exact_name" as const, relation: "target" as const,
    productSurface: null, role: "RECOMMENDED" as const,
    evidence: { start: 0, end: 1, text: "x" }, mention: { start: 0, end: 1, text: "x" },
    roleBasis: "test", confidence: "strong" as const, ...extra,
  };
}

function input(analyses: NormalizedObservation[], overrides: Partial<EngineInput> = {}): EngineInput {
  return {
    projectId: "p", collectionRunId: "r", analyses,
    plannedCount: analyses.length,
    plannedByProvider: { chatgpt_plus_manual: analyses.length },
    targetEntityId: TARGET, targetName: "Target",
    competitors: [{ entityId: A, name: "Alpha" }, { entityId: B, name: "Beta" }],
    topics: [], topicByPrompt: new Map(),
    lineage: {
      promptSetId: "ps", promptSetVersion: 1, competitiveSetVersionId: "cs", competitiveSetVersion: 1, competitiveSetSource: "pinned",
      analysisVersion: "observation-analysis@1", analysisVersions: ["observation-analysis@1"], currentAnalysisVersion: "observation-analysis@1", staleAnalyses: 0,
      metricPolicyVersion: "measure-policy@1", providerExperiences: ["chatgpt_plus_manual"], samplesPerPrompt: 1,
    },
    ...overrides,
  };
}

describe("Discovery Visibility — known arithmetic", () => {
  it("6 of 10 eligible Discovery observations = 60%", () => {
    const analyses = Array.from({ length: 10 }, (_, i) =>
      obs({ observationId: `o${i}`, occurrences: i < 6 ? [present(TARGET, "Target")] : [present(A, "Alpha")] }),
    );
    const m = computeMeasure(input(analyses)).metrics.combined!.discovery_visibility!;
    expect(m.numerator).toBe(6);
    expect(m.denominator).toBe(10);
    expect(m.value).toBeCloseTo(0.6);
    expect(m.numeratorObservationIds).toHaveLength(6);
  });

  it("counts an answer naming the brand many times exactly once", () => {
    const analyses = [
      obs({ observationId: "o1", occurrences: [present(TARGET, "Target"), present(TARGET, "Target"), present(TARGET, "Target")] }),
      obs({ observationId: "o2", occurrences: [present(A, "Alpha")] }),
    ];
    const m = computeMeasure(input(analyses)).metrics.combined!.discovery_visibility!;
    expect(m.numerator).toBe(1);
    expect(m.denominator).toBe(2);
  });

  it("excludes failed and uncertain observations from BOTH sides", () => {
    const analyses = [
      obs({ observationId: "o1", occurrences: [present(TARGET, "Target")] }),
      obs({ observationId: "o2", occurrences: [present(A, "Alpha")] }),
      obs({ observationId: "o3", eligibility: "NOT_CAPTURED" }),
      obs({ observationId: "o4", eligibility: "NEEDS_REVIEW", occurrences: [present(A, "Alpha")] }),
    ];
    const m = computeMeasure(input(analyses)).metrics.combined!.discovery_visibility!;
    // A failed capture must never read as "target absent".
    expect(m.denominator).toBe(2);
    expect(m.value).toBeCloseTo(0.5);
  });

  it("never counts branded sections toward Discovery", () => {
    const analyses = [
      obs({ observationId: "o1", section: "Discovery", occurrences: [present(A, "Alpha")] }),
      obs({ observationId: "o2", section: "Trade Offs", occurrences: [present(TARGET, "Target")] }),
      obs({ observationId: "o3", section: "Sentiment Analysis", occurrences: [present(TARGET, "Target")] }),
    ];
    const m = computeMeasure(input(analyses)).metrics.combined!.discovery_visibility!;
    expect(m.denominator).toBe(1);
    expect(m.numerator).toBe(0);
    expect(m.value).toBe(0);
  });
});

describe("Brand-free rate and Share of Voice", () => {
  it("reports the brand-free rate that makes the denominator interpretable", () => {
    const analyses = [
      obs({ observationId: "o1", occurrences: [present(TARGET, "Target")] }),
      obs({ observationId: "o2", occurrences: [present(A, "Alpha")] }),
      obs({ observationId: "o3", occurrences: [] }),
      obs({ observationId: "o4", occurrences: [] }),
    ];
    const m = computeMeasure(input(analyses)).metrics.combined!;
    expect(m.answer_brand_free_rate!.numerator).toBe(2);
    expect(m.answer_brand_free_rate!.value).toBeCloseTo(0.5);
    // Visibility uses ALL eligible answers, so the two brand-free answers count
    // against it. Publishing both lets a reader derive the other definition.
    expect(m.discovery_visibility!.value).toBeCloseTo(0.25);
  });

  it("SoV counts one presence event per entity per observation", () => {
    // Target in 6, Alpha in 8, Beta in 4 → 6 / 18
    const analyses = Array.from({ length: 10 }, (_, i) => {
      const occurrences = [];
      if (i < 6) occurrences.push(present(TARGET, "Target"));
      if (i < 8) occurrences.push(present(A, "Alpha"));
      if (i < 4) occurrences.push(present(B, "Beta"));
      return obs({ observationId: `o${i}`, occurrences });
    });
    const m = computeMeasure(input(analyses)).metrics.combined!.discovery_share_of_voice!;
    expect(m.numerator).toBe(6);
    expect(m.denominator).toBe(18);
    expect(m.value).toBeCloseTo(6 / 18);
  });

  it("keeps the SoV denominator frozen when an untracked brand appears", () => {
    const analyses = [
      obs({ observationId: "o1", occurrences: [present(TARGET, "Target"), present("e_untracked", "Gamma", { relation: "emerging" })] }),
    ];
    const m = computeMeasure(input(analyses)).metrics.combined!.discovery_share_of_voice!;
    // Gamma is not in the frozen set, so it must not dilute the share.
    expect(m.denominator).toBe(1);
    expect(m.value).toBe(1);
  });
});

describe("First Choice Rate — rank eligibility", () => {
  it("excludes unordered answers from the denominator entirely", () => {
    const analyses = [
      obs({ observationId: "o1", rankEligibility: "not_rankable", occurrences: [present(TARGET, "Target")] }),
      obs({ observationId: "o2", rankEligibility: "not_rankable", occurrences: [present(TARGET, "Target")] }),
    ];
    const m = computeMeasure(input(analyses)).metrics.combined!.first_choice_rate!;
    expect(m.denominator).toBe(0);
    // N/A, not 0% — the answers were never ranked.
    expect(m.value).toBeNull();
  });

  it("counts rank 1 only on rank-eligible answers", () => {
    const analyses = [
      obs({
        observationId: "o1", rankEligibility: "explicit_ordered_list",
        occurrences: [present(TARGET, "Target")],
        positions: [{ entityId: TARGET, name: "Target", firstMentionOrder: 1, positionBucket: "top", explicitRank: 1, evidence: { start: 0, end: 1, text: "x" } }],
      }),
      obs({
        observationId: "o2", rankEligibility: "explicit_ordered_list",
        occurrences: [present(TARGET, "Target")],
        positions: [{ entityId: TARGET, name: "Target", firstMentionOrder: 2, positionBucket: "middle", explicitRank: 2, evidence: { start: 0, end: 1, text: "x" } }],
      }),
    ];
    const m = computeMeasure(input(analyses)).metrics.combined!.first_choice_rate!;
    expect(m.numerator).toBe(1);
    expect(m.denominator).toBe(2);
  });
});

describe("Trade Offs — denominators", () => {
  function cmp(subject: string, object: string, preference: string) {
    return {
      subjectEntityId: subject, subjectName: subject, objectEntityId: object, objectName: object,
      aspect: null, opinion: null, preference: preference as never,
      evidence: { start: 0, end: 1, text: "x" }, confidence: "strong" as const,
    };
  }

  it("4 target / 3 competitor / 2 tie / 1 uncaptured", () => {
    const analyses = [
      ...Array.from({ length: 4 }, (_, i) => obs({ observationId: `t${i}`, section: "Trade Offs", comparisons: [cmp(TARGET, A, "SUBJECT")] })),
      ...Array.from({ length: 3 }, (_, i) => obs({ observationId: `c${i}`, section: "Trade Offs", comparisons: [cmp(TARGET, A, "OBJECT")] })),
      ...Array.from({ length: 2 }, (_, i) => obs({ observationId: `x${i}`, section: "Trade Offs", comparisons: [cmp(TARGET, A, "TIE")] })),
      obs({ observationId: "f1", section: "Trade Offs", eligibility: "NOT_CAPTURED" }),
    ];
    const result = computeMeasure(input(analyses));
    const t = result.tradeOffs.combined!;
    expect(t.outcomes.TARGET_PREFERRED).toBe(4);
    expect(t.outcomes.COMPETITOR_PREFERRED).toBe(3);
    expect(t.outcomes.TIE).toBe(2);

    const m = result.metrics.combined!;
    // Decisiveness: 7 decisive of 9 answers carrying a comparison.
    expect(m.tradeoff_decisiveness!.numerator).toBe(7);
    expect(m.tradeoff_decisiveness!.denominator).toBe(9);
    // Win rate is over DECISIVE answers only: 4 of 7.
    expect(m.tradeoff_target_win_rate!.numerator).toBe(4);
    expect(m.tradeoff_target_win_rate!.denominator).toBe(7);
    expect(m.tradeoff_target_win_rate!.value).toBeCloseTo(4 / 7);
  });

  it("an undecided comparison is never recorded as a loss", () => {
    const analyses = [obs({ observationId: "t1", section: "Trade Offs", comparisons: [cmp(TARGET, A, "UNCLEAR")] })];
    const result = computeMeasure(input(analyses));
    expect(result.tradeOffs.combined!.outcomes.COMPETITOR_PREFERRED).toBe(0);
    expect(result.tradeOffs.combined!.outcomes.UNCLEAR).toBe(1);
    expect(result.metrics.combined!.tradeoff_target_win_rate!.denominator).toBe(0);
    expect(result.metrics.combined!.tradeoff_target_win_rate!.value).toBeNull();
  });
});

describe("Citations — missing capture is never a zero", () => {
  function cite(domain: string, ownership: string) {
    return { url: `https://${domain}/x`, domain, ownership: ownership as never, ownerEntityId: ownership === "TARGET_OWNED" ? TARGET : null, ownerMentionedInText: false };
  }

  it("8 capture-complete: 3 own, 2 none-shown, 2 competitor, 1 third-party", () => {
    const analyses = [
      ...Array.from({ length: 3 }, (_, i) => obs({ observationId: `own${i}`, citations: [cite("target.com", "TARGET_OWNED")] })),
      ...Array.from({ length: 2 }, (_, i) => obs({ observationId: `none${i}`, sourceCaptureState: "none_present", citations: [] })),
      ...Array.from({ length: 2 }, (_, i) => obs({ observationId: `comp${i}`, citations: [cite("alpha.com", "COMPETITOR_OWNED")] })),
      obs({ observationId: "third", citations: [cite("review.com", "THIRD_PARTY")] }),
      // Excluded: sources were never captured, which says nothing either way.
      obs({ observationId: "nocap", sourceCaptureState: "not_captured", citations: [] }),
    ];
    const m = computeMeasure(input(analyses)).metrics.combined!.owned_citation_rate!;
    expect(m.denominator).toBe(8);
    expect(m.numerator).toBe(3);
    expect(m.value).toBeCloseTo(3 / 8);
  });

  it("returns N/A when nothing had trustworthy source capture", () => {
    const analyses = [obs({ observationId: "o1", sourceCaptureState: "not_captured" })];
    const m = computeMeasure(input(analyses)).metrics.combined!.owned_citation_rate!;
    expect(m.denominator).toBe(0);
    expect(m.value).toBeNull();
  });

  it("citation share counts URLs, not responses", () => {
    const analyses = [
      obs({ observationId: "o1", citations: [cite("target.com", "TARGET_OWNED"), cite("t2.com", "TARGET_OWNED"), cite("alpha.com", "COMPETITOR_OWNED")] }),
    ];
    const m = computeMeasure(input(analyses)).metrics.combined!.citation_share!;
    expect(m.numerator).toBe(2);
    expect(m.denominator).toBe(3);
  });
});

describe("Providers stay separable", () => {
  it("ChatGPT 8/10 and Gemini 3/10 pool to 11/20 without hiding either", () => {
    const analyses = [
      ...Array.from({ length: 10 }, (_, i) => obs({ observationId: `g${i}`, providerExperience: "chatgpt_plus_manual", occurrences: i < 8 ? [present(TARGET, "Target")] : [] })),
      ...Array.from({ length: 10 }, (_, i) => obs({ observationId: `m${i}`, providerExperience: "gemini_apps_manual", occurrences: i < 3 ? [present(TARGET, "Target")] : [] })),
    ];
    const result = computeMeasure(input(analyses, { plannedCount: 20, plannedByProvider: { chatgpt_plus_manual: 10, gemini_apps_manual: 10 } }));
    expect(result.metrics.chatgpt!.discovery_visibility!.value).toBeCloseTo(0.8);
    expect(result.metrics.gemini!.discovery_visibility!.value).toBeCloseTo(0.3);
    expect(result.metrics.combined!.discovery_visibility!.numerator).toBe(11);
    expect(result.metrics.combined!.discovery_visibility!.denominator).toBe(20);
  });

  it("pooling gives the better-covered provider more weight, as documented", () => {
    // ChatGPT 10 obs all present; Gemini 2 obs none present.
    const analyses = [
      ...Array.from({ length: 10 }, (_, i) => obs({ observationId: `g${i}`, providerExperience: "chatgpt_plus_manual", occurrences: [present(TARGET, "Target")] })),
      ...Array.from({ length: 2 }, (_, i) => obs({ observationId: `m${i}`, providerExperience: "gemini_apps_manual", occurrences: [] })),
    ];
    const result = computeMeasure(input(analyses));
    // Pooled = 10/12 = 83%, not the 50% an equal-provider average would give.
    expect(result.metrics.combined!.discovery_visibility!.value).toBeCloseTo(10 / 12);
  });
});

describe("Sentiment never manufactures positivity", () => {
  it("counts absent sentiment evidence as NO_SENTIMENT", () => {
    const analyses = [
      obs({ observationId: "s1", section: "Sentiment Analysis", occurrences: [present(TARGET, "Target")], sentiment: [] }),
      obs({ observationId: "s2", section: "Sentiment Analysis", sentiment: [{ entityId: TARGET, entityName: "Target", overallPortrayal: "NEGATIVE", aspects: [] }] }),
    ];
    const s = computeMeasure(input(analyses)).sentiment.combined!;
    expect(s.distribution.NO_SENTIMENT).toBe(1);
    expect(s.distribution.NEGATIVE).toBe(1);
    expect(s.distribution.POSITIVE).toBe(0);
  });
});

describe("Coverage is reported, not absorbed", () => {
  it("distinguishes planned, captured and analysable", () => {
    const analyses = [
      obs({ observationId: "o1" }),
      obs({ observationId: "o2", eligibility: "NEEDS_REVIEW" }),
      obs({ observationId: "o3", eligibility: "NOT_CAPTURED" }),
    ];
    const c = computeMeasure(input(analyses, { plannedCount: 5 })).coverage;
    expect(c.planned).toBe(5);
    expect(c.captured).toBe(2);
    expect(c.analysable).toBe(1);
    expect(c.needsReview).toBe(1);
  });
});

// measure-policy@3: share of every business named. Share of voice counts only
// the tracked set, so a salon read 88% while its answers named 27 businesses.
describe("Share of every business named — known arithmetic", () => {
  const emerging = (...names: string[]) => names.map((name) => ({ name, mentions: [{ start: 0, end: 1, text: "x" }], role: "RECOMMENDED" as const }));

  it("counts tracked and untracked businesses once per answer", () => {
    const analyses = [
      obs({ observationId: "o1", occurrences: [present(TARGET, "Target"), present(A, "Alpha")], emergingCandidates: emerging("Gamma", "Delta") }),
      obs({ observationId: "o2", occurrences: [present(TARGET, "Target")], emergingCandidates: emerging("Gamma") }),
      obs({ observationId: "o3", occurrences: [], emergingCandidates: emerging("Gamma", "Epsilon", "Zeta") }),
      obs({ observationId: "o4", occurrences: [] }),
    ];
    const metrics = computeMeasure(input(analyses)).metrics.combined!;
    const all = metrics.discovery_share_all_names!;
    // Target 2 events; every business: o1 = 4, o2 = 2, o3 = 3, o4 names none.
    expect(all.numerator).toBe(2);
    expect(all.denominator).toBe(9);
    expect(all.value).toBeCloseTo(2 / 9);
    expect(all.denominatorObservationIds).toEqual(["o1", "o2", "o3"]);
    // Share of voice is unchanged: only the target and the frozen rivals.
    const voice = metrics.discovery_share_of_voice!;
    expect(voice.numerator).toBe(2);
    expect(voice.denominator).toBe(3);
  });

  it("is null, never 0%, when no answer named any business", () => {
    const analyses = [obs({ observationId: "o1" }), obs({ observationId: "o2" })];
    const all = computeMeasure(input(analyses)).metrics.combined!.discovery_share_all_names!;
    expect(all.denominator).toBe(0);
    expect(all.value).toBeNull();
  });

  it("leaves uncollected and uncertain answers out of both sides", () => {
    const analyses = [
      obs({ observationId: "o1", occurrences: [present(TARGET, "Target")], emergingCandidates: emerging("Gamma") }),
      obs({ observationId: "o2", eligibility: "NOT_CAPTURED", emergingCandidates: emerging("Gamma", "Delta") }),
      obs({ observationId: "o3", eligibility: "NEEDS_REVIEW", occurrences: [present(TARGET, "Target")] }),
    ];
    const all = computeMeasure(input(analyses)).metrics.combined!.discovery_share_all_names!;
    expect(all.numerator).toBe(1);
    expect(all.denominator).toBe(2);
  });
});

describe("Discovery by place", () => {
  it("groups answers by the place the question named, with the most-named other business", () => {
    const prompts = new Map([
      ["p-dubai-1", { id: "p-dubai-1", text: "salons in Dubai", section: "Discovery", topicId: null, competitorEntityId: null, place: "Dubai" }],
      ["p-dubai-2", { id: "p-dubai-2", text: "best salon in Dubai", section: "Discovery", topicId: null, competitorEntityId: null, place: "Dubai" }],
      ["p-area", { id: "p-area", text: "salon in DIFC", section: "Discovery", topicId: null, competitorEntityId: null, place: "DIFC" }],
    ]);
    const analyses = [
      obs({ observationId: "o1", promptCandidateId: "p-dubai-1", occurrences: [present(A, "Alpha")], emergingCandidates: [{ name: "Gamma", mentions: [], role: "RECOMMENDED" }] }),
      obs({ observationId: "o2", promptCandidateId: "p-dubai-2", occurrences: [present(A, "Alpha")] }),
      obs({ observationId: "o3", promptCandidateId: "p-area", occurrences: [present(TARGET, "Target"), present(B, "Beta")] }),
    ];
    const places = computeMeasure(input(analyses, { prompts })).byPlace!;
    expect(places).toEqual([
      { place: "Dubai", eligible: 2, targetPresent: 0, targetIds: [], leaderName: "Alpha", leaderCount: 2 },
      { place: "DIFC", eligible: 1, targetPresent: 1, targetIds: ["o3"], leaderName: "Beta", leaderCount: 1 },
    ]);
  });
});
