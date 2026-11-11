// Deliberate attempts to make the dashboard lie.
//
// Each case is a way a measurement system can flatter or defame a brand
// without anyone editing a number: inflate the headline by adding branded
// prompts, deflate it by losing observations, move history by changing the
// competitive set, or invent a trend by swapping the instrument.

import { describe, expect, it } from "vitest";
import { computeMeasure, type EngineInput } from "@/lib/measure/engine";
import { comparability, type MeasurementFacts } from "@/lib/measure/compare";
import type { MeasureLineage } from "@/lib/measure/types";
import type { NormalizedObservation } from "@/lib/analysis/types";

const TARGET = "t";
const A = "a";
const NEW = "n";

function obs(p: Partial<NormalizedObservation> & { observationId: string }): NormalizedObservation {
  return {
    promptCandidateId: "pc", section: "Discovery", providerExperience: "chatgpt_plus_manual",
    analysisVersion: "v1", analysedAt: 0, eligibility: "ELIGIBLE", sourceHash: "h",
    occurrences: [], comparisons: [], positions: [], rankEligibility: "not_rankable",
    sentiment: [], citations: [], sourceCaptureState: "complete", emergingCandidates: [],
    warnings: [], reviewedBy: null, supersedesAnalysisId: null, ...p,
  } as NormalizedObservation;
}
function hit(entityId: string) {
  return {
    entityId, name: entityId, surfaceForm: "exact_name" as const, relation: "target" as const,
    productSurface: null, role: "RECOMMENDED" as const,
    evidence: { start: 0, end: 1, text: "x" }, mention: { start: 0, end: 1, text: "x" },
    roleBasis: "t", confidence: "strong" as const,
  };
}
function input(analyses: NormalizedObservation[], competitors = [{ entityId: A, name: "Alpha" }]): EngineInput {
  return {
    projectId: "p", collectionRunId: "r", analyses, plannedCount: analyses.length,
    plannedByProvider: {}, targetEntityId: TARGET, targetName: "Target",
    competitors, topics: [], topicByPrompt: new Map(),
    lineage: lineage(),
  };
}

/** A complete lineage, overridable per test. */
function lineage(overrides: Partial<MeasureLineage> = {}): MeasureLineage {
  return {
    promptSetId: "ps", promptSetVersion: 1, competitiveSetVersionId: "cs1", competitiveSetVersion: 1, competitiveSetSource: "pinned",
    analysisVersion: "v1", analysisVersions: ["v1"], currentAnalysisVersion: "v1", staleAnalyses: 0,
    metricPolicyVersion: "measure-policy@1", providerExperiences: ["chatgpt_plus_manual"], engines: ["chatgpt"], samplesPerPrompt: 1,
    observerRegions: ["IN"], models: [], ...overrides,
  };
}

/** Two complete runs on one engine; comparability reads lineage AND coverage. */
function facts(overrides: Partial<MeasureLineage> = {}, coverage: MeasurementFacts["coverage"] = { planned: 10, analysable: 10, byEngine: { chatgpt: { planned: 10, captured: 10, analysable: 10 } } }): MeasurementFacts {
  return { lineage: lineage(overrides), coverage };
}

describe("ADVERSARIAL: inflate the headline with branded prompts", () => {
  it("adding ten branded observations does not move Discovery Visibility", () => {
    const discovery = Array.from({ length: 10 }, (_, i) =>
      obs({ observationId: `d${i}`, occurrences: i < 3 ? [hit(TARGET)] : [hit(A)] }),
    );
    const before = computeMeasure(input(discovery)).metrics.combined!.discovery_visibility!;

    // Every branded prompt names the target and the target appears in all of them.
    const branded = Array.from({ length: 10 }, (_, i) =>
      obs({ observationId: `b${i}`, section: i < 5 ? "Trade Offs" : "Sentiment Analysis", occurrences: [hit(TARGET)] }),
    );
    const after = computeMeasure(input([...discovery, ...branded])).metrics.combined!.discovery_visibility!;

    expect(after.numerator).toBe(before.numerator);
    expect(after.denominator).toBe(before.denominator);
    expect(after.value).toBeCloseTo(0.3);
  });
});

describe("ADVERSARIAL: deflate by losing observations", () => {
  it("failing half of one provider's runs does not lower the visibility RATE", () => {
    const healthy = [
      ...Array.from({ length: 10 }, (_, i) => obs({ observationId: `c${i}`, providerExperience: "chatgpt_plus_manual", occurrences: i < 5 ? [hit(TARGET)] : [hit(A)] })),
      ...Array.from({ length: 10 }, (_, i) => obs({ observationId: `g${i}`, providerExperience: "gemini_apps_manual", occurrences: i < 5 ? [hit(TARGET)] : [hit(A)] })),
    ];
    const before = computeMeasure(input(healthy)).metrics.combined!.discovery_visibility!;
    expect(before.value).toBeCloseTo(0.5);

    // Now five Gemini runs never captured. The rate must hold; only coverage falls.
    const degraded = healthy.map((a, i) =>
      a.providerExperience === "gemini_apps_manual" && i >= 15 ? obs({ ...a, eligibility: "NOT_CAPTURED", occurrences: [] }) : a,
    );
    const result = computeMeasure(input(degraded));
    const after = result.metrics.combined!.discovery_visibility!;

    // 5 of 10 ChatGPT + 5 of 5 remaining Gemini = 10/15, not 10/20.
    expect(after.denominator).toBe(15);
    expect(after.value).toBeGreaterThan(0.5);
    // The loss is reported as coverage, which is where it belongs.
    expect(result.coverage.analysable).toBe(15);
    expect(result.coverage.planned).toBe(20);
  });
});

describe("ADVERSARIAL: move history by changing the competitive set", () => {
  it("an untracked brand in the answers cannot dilute Share of Voice", () => {
    const analyses = [
      obs({ observationId: "o1", occurrences: [hit(TARGET), hit(A), hit(NEW)] }),
      obs({ observationId: "o2", occurrences: [hit(NEW)] }),
    ];
    // Frozen set = target + Alpha only. NEW appears but is not tracked.
    const sov = computeMeasure(input(analyses)).metrics.combined!.discovery_share_of_voice!;
    expect(sov.numerator).toBe(1);
    expect(sov.denominator).toBe(2); // target + Alpha, NOT the untracked brand
    expect(sov.value).toBeCloseTo(0.5);
  });

  it("adding the competitor to the frozen set DOES change SoV — and that is a methodology break", () => {
    const analyses = [
      obs({ observationId: "o1", occurrences: [hit(TARGET), hit(A), hit(NEW)] }),
      obs({ observationId: "o2", occurrences: [hit(NEW)] }),
    ];
    const widened = computeMeasure(input(analyses, [{ entityId: A, name: "Alpha" }, { entityId: NEW, name: "Newcomer" }]));
    const sov = widened.metrics.combined!.discovery_share_of_voice!;
    expect(sov.denominator).toBe(4);
    expect(sov.value).toBeCloseTo(0.25);

    // The two numbers are NOT comparable, and the system must say so.
    const check = comparability(facts({ competitiveSetVersionId: "cs1" }), facts({ competitiveSetVersionId: "cs2" }));
    expect(check.level).toBe("break");
    expect(check.breaks.join(" ")).toContain("competitive set changed");
  });
});

describe("ADVERSARIAL: invent a trend by swapping the instrument", () => {
  it("a different prompt set is a methodology break, not a delta", () => {
    expect(comparability(facts({ promptSetId: "ps3" }), facts({ promptSetId: "ps8" })).level).toBe("break");
    expect(comparability(facts({ promptSetId: "ps3" }), facts({ promptSetId: "ps3" })).level).toBe("comparable");
  });

  it("changing the metric policy, the analysis rules, the engines or the sampling also breaks comparability", () => {
    expect(comparability(facts(), facts({ metricPolicyVersion: "measure-policy@2" })).breaks.join()).toContain("metric formulas");
    expect(comparability(facts(), facts({ analysisVersions: ["v2"] })).breaks.join()).toContain("analysis rules");
    expect(comparability(facts(), facts({ samplesPerPrompt: 3 })).breaks.join()).toContain("samples per question");
    const twoEngines = facts({}, { planned: 20, analysable: 20, byEngine: { chatgpt: { planned: 10, captured: 10, analysable: 10 }, gemini: { planned: 10, captured: 10, analysable: 10 } } });
    expect(comparability(facts(), twoEngines).breaks.join()).toContain("engines with analysable answers");
  });

  it("a different provider for the same engine is a caution, never a break, and partial coverage is flagged", () => {
    const viaCloro = facts({ providerExperiences: ["chatgpt_cloro_web"] });
    const viaOxylabs = facts({ providerExperiences: ["chatgpt_oxylabs_web"] });
    const check = comparability(viaCloro, viaOxylabs);
    expect(check.level).toBe("caution");
    expect(check.breaks).toEqual([]);
    expect(check.cautions.join()).toContain("different provider");

    const partial = facts({}, { planned: 10, analysable: 6, byEngine: { chatgpt: { planned: 10, captured: 6, analysable: 6 } } });
    const partialCheck = comparability(partial, facts());
    expect(partialCheck.level).toBe("caution");
    expect(partialCheck.cautions.join()).toContain("coverage is partial");
  });

  it("an engine planned but never analysable does not count as an engine", () => {
    // Gemini planned, nothing collected: the run is still a one-engine measurement.
    const geminiEmpty = facts({ engines: ["chatgpt", "gemini"] }, { planned: 20, analysable: 10, byEngine: { chatgpt: { planned: 10, captured: 10, analysable: 10 }, gemini: { planned: 10, captured: 0, analysable: 0 } } });
    const check = comparability(geminiEmpty, facts());
    expect(check.breaks.join()).not.toContain("engines");
  });
});

describe("ADVERSARIAL: zero denominators must never render as zero performance", () => {
  it("returns N/A, not 0%, for every ratio with nothing eligible", () => {
    const result = computeMeasure(input([obs({ observationId: "o1", eligibility: "NOT_CAPTURED" })]));
    const m = result.metrics.combined!;
    for (const key of ["discovery_visibility", "first_choice_rate", "tradeoff_target_win_rate", "owned_citation_rate", "discovery_share_of_voice"] as const) {
      expect(m[key]!.denominator, key).toBe(0);
      expect(m[key]!.value, key).toBeNull();
    }
  });

  it("a target that is genuinely never mentioned is 0%, not N/A", () => {
    // The distinction that matters: absent-with-evidence vs no-evidence.
    const analyses = Array.from({ length: 5 }, (_, i) => obs({ observationId: `o${i}`, occurrences: [hit(A)] }));
    const m = computeMeasure(input(analyses)).metrics.combined!.discovery_visibility!;
    expect(m.denominator).toBe(5);
    expect(m.value).toBe(0);
  });
});

describe("ADVERSARIAL: small cells must not look authoritative", () => {
  it("topic rows carry their own counts rather than a bare percentage", () => {
    const analyses = [
      obs({ observationId: "o1", promptCandidateId: "p1", occurrences: [hit(TARGET)] }),
      obs({ observationId: "o2", promptCandidateId: "p2", occurrences: [hit(A)] }),
      obs({ observationId: "o3", promptCandidateId: "p2", occurrences: [hit(A)] }),
    ];
    const result = computeMeasure({
      ...input(analyses),
      topics: [{ id: "tA", name: "Topic A" }, { id: "tB", name: "Topic B" }, { id: "tC", name: "Topic C" }],
      topicByPrompt: new Map([["p1", "tA"], ["p2", "tB"]]),
    });
    const [a, b, c] = result.byTopic;
    expect(a!.eligible).toBe(1);
    expect(b!.eligible).toBe(2);
    // A topic with no observations reports zero eligible rather than 0%.
    expect(c!.eligible).toBe(0);
    expect(c!.leaderName).toBeNull();
  });
});

describe("ADVERSARIAL: flatter the share by leaving rivals untracked", () => {
  it("an untracked rival cannot lift the share of every business named", () => {
    // Share of voice reads 100% (the only tracked rival was never named)...
    const analyses = [
      obs({ observationId: "o1", occurrences: [hit(TARGET)], emergingCandidates: [{ name: "Untracked One", mentions: [], role: "RECOMMENDED" }, { name: "Untracked Two", mentions: [], role: "RECOMMENDED" }] }),
      obs({ observationId: "o2", occurrences: [], emergingCandidates: [{ name: "Untracked One", mentions: [], role: "RECOMMENDED" }] }),
    ];
    const metrics = computeMeasure(input(analyses)).metrics.combined!;
    expect(metrics.discovery_share_of_voice!.value).toBeCloseTo(1);
    // ...but against every business the answers named, the target is 1 of 4.
    expect(metrics.discovery_share_all_names!.numerator).toBe(1);
    expect(metrics.discovery_share_all_names!.denominator).toBe(4);
  });

  it("a gap never becomes absence: an uncollected answer adds no untracked names", () => {
    const analyses = [
      obs({ observationId: "o1", occurrences: [hit(TARGET)] }),
      obs({ observationId: "o2", eligibility: "NOT_CAPTURED", emergingCandidates: [{ name: "Untracked One", mentions: [], role: "RECOMMENDED" }] }),
    ];
    const all = computeMeasure(input(analyses)).metrics.combined!.discovery_share_all_names!;
    expect(all.numerator).toBe(1);
    expect(all.denominator).toBe(1);
  });
});

describe("ADVERSARIAL: a list of untracked businesses is not an answer that named nobody", () => {
  it("does not call six untracked salons 'no business named'", () => {
    const six = ["One", "Two", "Three", "Four", "Five", "Six"].map((n) => ({ name: `${n} Salon`, mentions: [], role: "RECOMMENDED" as const }));
    const metric = computeMeasure(input([obs({ observationId: "o1", emergingCandidates: six }), obs({ observationId: "o2", occurrences: [hit(TARGET)] })])).metrics.combined!.answer_brand_free_rate!;
    expect(metric.numerator).toBe(0);
    expect(metric.denominator).toBe(2);
  });
});
