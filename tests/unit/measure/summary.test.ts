// The plain-language summary and the tracked-brand rank: written from the
// engine's fractions, honest below LOW_N, and silent where there is nothing
// to count.

import { describe, expect, it } from "vitest";
import { computeMeasure, type EngineInput } from "@/lib/measure/engine";
import { rankAmongTracked, summariseMeasurement } from "@/lib/measure/summary";
import type { MeasureLineage } from "@/lib/measure/types";
import type { NormalizedObservation } from "@/lib/analysis/types";

const TARGET = "t";
const A = "a";
const B = "b";

function obs(p: Partial<NormalizedObservation> & { observationId: string }): NormalizedObservation {
  return {
    promptCandidateId: "pc", section: "Discovery", providerExperience: "chatgpt_oxylabs_web",
    analysisVersion: "v1", analysedAt: 0, eligibility: "ELIGIBLE", sourceHash: "h",
    occurrences: [], comparisons: [], positions: [], rankEligibility: "not_rankable",
    sentiment: [], citations: [], sourceCaptureState: "complete", emergingCandidates: [],
    warnings: [], reviewedBy: null, supersedesAnalysisId: null, ...p,
  } as NormalizedObservation;
}
function hit(entityId: string, name = entityId, start = 0) {
  return {
    entityId, name, surfaceForm: "exact_name" as const, relation: "target" as const,
    productSurface: null, role: "RECOMMENDED" as const,
    evidence: { start, end: start + 1, text: `${name} is a solid pick.` }, mention: { start, end: start + 1, text: name },
    roleBasis: "t", confidence: "strong" as const,
  };
}
function comparison(subject: string, object: string, preference: "SUBJECT" | "OBJECT" | "TIE", aspect: string | null = null) {
  return { subjectEntityId: subject, subjectName: subject, objectEntityId: object, objectName: object, aspect, opinion: null, preference, evidence: { start: 0, end: 1, text: `${object} grips better than ${subject}.` }, confidence: "strong" as const };
}
function lineage(): MeasureLineage {
  return {
    promptSetId: "ps", promptSetVersion: 1, competitiveSetVersionId: "cs1", competitiveSetVersion: 1, competitiveSetSource: "pinned",
    analysisVersion: "v1", analysisVersions: ["v1"], currentAnalysisVersion: "v1", staleAnalyses: 0,
    metricPolicyVersion: "measure-policy@2", providerExperiences: ["chatgpt_oxylabs_web"], engines: ["chatgpt"], samplesPerPrompt: 1,
    observerRegions: ["IN"], models: ["gpt-5-6"],
  };
}
function input(analyses: NormalizedObservation[], plannedCount = analyses.length): EngineInput {
  return {
    projectId: "p", collectionRunId: "r", analyses, plannedCount,
    plannedByProvider: { chatgpt_oxylabs_web: plannedCount }, targetEntityId: TARGET, targetName: "Target",
    competitors: [{ entityId: A, name: "Alpha" }, { entityId: B, name: "Beta" }],
    topics: [], topicByPrompt: new Map(), prompts: new Map(), lineage: lineage(),
  };
}

describe("summariseMeasurement", () => {
  it("writes every sentence from the fractions, with a percentage only above LOW_N", () => {
    const discovery = Array.from({ length: 6 }, (_, i) => obs({ observationId: `d${i}`, occurrences: i < 2 ? [hit(TARGET, "Target"), hit(A, "Alpha", 10)] : [hit(A, "Alpha")] }));
    const tradeOffs = [
      obs({ observationId: "t1", section: "Trade Offs", comparisons: [comparison(TARGET, A, "OBJECT", "grip")] }),
      obs({ observationId: "t2", section: "Trade Offs", comparisons: [comparison(TARGET, A, "SUBJECT")] }),
      obs({ observationId: "t3", section: "Trade Offs", comparisons: [comparison(TARGET, B, "TIE")] }),
    ];
    const sentiment = [
      obs({ observationId: "s1", section: "Sentiment Analysis", sentiment: [{ entityId: TARGET, entityName: "Target", overallPortrayal: "NEGATIVE", aspects: [{ entityId: TARGET, entityName: "Target", aspectTerm: null, aspectCategory: "returns", opinionTerm: null, polarity: "NEGATIVE", evidence: { start: 0, end: 1, text: "Returns are slow." }, confidence: "strong" }] }] }),
      obs({ observationId: "s2", section: "Sentiment Analysis", sentiment: [{ entityId: TARGET, entityName: "Target", overallPortrayal: "POSITIVE", aspects: [] }] }),
    ];
    const missing = obs({ observationId: "m1", eligibility: "NOT_CAPTURED", warnings: [{ code: "not_captured", detail: "" }], sourceCaptureState: "unknown" });
    const measure = computeMeasure(input([...discovery, ...tradeOffs, ...sentiment, missing], 12));
    const sentences = summariseMeasurement({ measure, brand: "Target", engineNames: ["ChatGPT"], lowN: 5 });
    const byKey = Object.fromEntries(sentences.map((s) => [s.key, s.text]));

    expect(byKey.coverage).toContain("11 analysable answers out of 12 planned so far");
    expect(byKey.coverage).toContain("1 answer is outside every figure (1 not collected)");
    expect(byKey.coverage).toContain("none of them counts as Target being absent");
    // Six discovery answers: enough for a percentage, and the leader is named with its own fraction.
    expect(byKey.discovery).toBe("When buyers asked without naming a brand, Target was named in 2 of 6 (33%) answers; Alpha was named most often, in 6 of 6. Those answers named 2 different businesses; Target took 2 of 8 mentions (25%).");
    // No rank-eligible answer: no first-choice sentence at all, never "0%".
    expect(byKey.first_choice).toBeUndefined();
    expect(byKey.tradeoffs).toBe("In head-to-head questions, Target was preferred in 1, a rival in 1, and 1 reached no clear winner. Alpha was the rival preferred most often, in 1 of 2 decided comparisons against it.");
    // Opinions are counted among the answers that gave one (measure-policy@4).
    expect(byKey.reputation).toBe("Asked about Target by name, 2 of 2 answers gave an opinion: 1 positive, 0 mixed and 1 negative. The concerns were about returns.");
    expect(byKey.change).toContain("first measurement");
    // Below LOW_N the fraction stands alone.
    expect(byKey.sources).toBeUndefined();
  });

  it("describes a break instead of a change, and a small-sample change as counts", () => {
    const measure = computeMeasure(input([obs({ observationId: "d1", occurrences: [hit(TARGET)] }), obs({ observationId: "d2", occurrences: [hit(A)] })]));
    const broken = summariseMeasurement({
      measure, brand: "Target", engineNames: ["ChatGPT"], lowN: 5,
      previous: { label: "1 Sept 2026", comparison: { previousRunId: "x", comparability: { level: "break", breaks: ["the approved questions changed, so the two runs asked different things"], cautions: [] }, metrics: {}, tradeOffs: {}, sentiment: {} } },
    });
    expect(broken.find((s) => s.key === "change")!.text).toBe("Not compared with the measurement of 1 Sept 2026: the approved questions changed, so the two runs asked different things.");
    const small = summariseMeasurement({
      measure, brand: "Target", engineNames: ["ChatGPT"], lowN: 5,
      previous: {
        label: "1 Sept 2026",
        comparison: {
          previousRunId: "x", comparability: { level: "caution", breaks: [], cautions: ["collected through a different provider for the same engine"] },
          metrics: { combined: { discovery_visibility: { key: "discovery_visibility", from: { numerator: 0, denominator: 2, value: 0 }, to: { numerator: 1, denominator: 2, value: 0.5 }, points: null, countsOnly: true, direction: "up" } } },
          tradeOffs: {}, sentiment: {},
        },
      },
    });
    expect(small.find((s) => s.key === "change")!.text).toBe("Compared with 1 Sept 2026, visibility went from 0 of 2 to 1 of 2. Read with care: collected through a different provider for the same engine.");
    // A tie with the most-named rival is called a tie, never "more than any rival".
    expect(small.find((s) => s.key === "discovery")!.text).toBe("When buyers asked without naming a brand, Target was named in 1 of 2 answers, level with Alpha. Those answers named 2 different businesses; Target took 1 of 2 mentions.");
    const behind = computeMeasure(input([obs({ observationId: "d1", occurrences: [hit(TARGET), hit(A, "Alpha", 5)] }), obs({ observationId: "d2", occurrences: [hit(A)] })]));
    expect(summariseMeasurement({ measure: behind, brand: "Target", engineNames: ["ChatGPT"], lowN: 5 }).find((s) => s.key === "discovery")!.text).toBe(
      "When buyers asked without naming a brand, Target was named in 1 of 2 answers; Alpha was named most often, in 2 of 2. Those answers named 2 different businesses; Target took 1 of 3 mentions.",
    );
    const ahead = computeMeasure(input([obs({ observationId: "d1", occurrences: [hit(TARGET), hit(A, "Alpha", 5)] }), obs({ observationId: "d2", occurrences: [hit(TARGET)] })]));
    expect(summariseMeasurement({ measure: ahead, brand: "Target", engineNames: ["ChatGPT"], lowN: 5 }).find((s) => s.key === "discovery")!.text).toBe(
      "When buyers asked without naming a brand, Target was named in 2 of 2 answers, more often than any other business. Those answers named 2 different businesses; Target took 2 of 3 mentions.",
    );
  });

  it("says when nothing can be counted rather than printing a zero", () => {
    const measure = computeMeasure(input([obs({ observationId: "d1", eligibility: "NOT_CAPTURED", warnings: [{ code: "not_captured", detail: "" }] })]));
    const sentences = summariseMeasurement({ measure, brand: "Target", engineNames: ["ChatGPT"], lowN: 5 });
    expect(sentences.map((s) => s.key)).toEqual(["coverage", "discovery", "change"]);
    expect(sentences[1]!.text).toContain("No Discovery answer can be counted yet");
    expect(sentences.map((s) => s.text).join(" ")).not.toMatch(/0%/);
  });
});

describe("Reputation sentence", () => {
  const portrayal = (id: string, overallPortrayal: string, aspects: Array<{ category: string; polarity: string }> = []) =>
    obs({
      observationId: id, section: "Sentiment Analysis",
      sentiment: [{ entityId: TARGET, entityName: "Target", overallPortrayal, aspects: aspects.map((a) => ({ entityId: TARGET, entityName: "Target", aspectTerm: null, aspectCategory: a.category, opinionTerm: null, polarity: a.polarity, evidence: { start: 0, end: 1, text: "x" }, confidence: "strong" })) }] as never,
    });

  it("reads opinions among the answers that gave one, and never names the theme-less 'overall' as a concern", () => {
    const measure = computeMeasure(input([
      portrayal("s1", "POSITIVE"), portrayal("s2", "NEGATIVE", [{ category: "overall", polarity: "NEGATIVE" }]),
      obs({ observationId: "s3", section: "Sentiment Analysis" }), obs({ observationId: "s4", section: "Sentiment Analysis" }),
    ]));
    const text = summariseMeasurement({ measure, brand: "Target", engineNames: ["ChatGPT"], lowN: 5 }).find((s) => s.key === "reputation")!.text;
    expect(text).toBe("Asked about Target by name, 2 of 4 answers gave an opinion: 1 positive, 0 mixed and 1 negative; 2 stated facts without one.");
    expect(text).not.toContain("about overall");
  });

  it("says when no by-name answer gave an opinion rather than reading facts as a poor score", () => {
    const measure = computeMeasure(input([obs({ observationId: "s1", section: "Sentiment Analysis" }), obs({ observationId: "s2", section: "Sentiment Analysis" })]));
    const text = summariseMeasurement({ measure, brand: "Target", engineNames: ["ChatGPT"], lowN: 5 }).find((s) => s.key === "reputation")!.text;
    expect(text).toBe("Asked about Target by name, none of the 2 answers gave an opinion; they stated facts.");
  });
});

describe("rankAmongTracked", () => {
  it("places the target among tracked brands by discovery answers naming them, sharing a place on ties", () => {
    const measure = computeMeasure(input([
      obs({ observationId: "d1", occurrences: [hit(A), hit(B, "Beta", 5)] }),
      obs({ observationId: "d2", occurrences: [hit(A), hit(TARGET, "Target", 5)] }),
      obs({ observationId: "d3", occurrences: [hit(B)] }),
    ]));
    // Alpha 2, Beta 2, Target 1 → the target is third of three; Beta ties Alpha for first.
    expect(rankAmongTracked(measure.brands)).toEqual({ rank: 3, of: 3 });
    const tie = computeMeasure(input([obs({ observationId: "d1", occurrences: [hit(A), hit(TARGET, "Target", 5)] })]));
    expect(rankAmongTracked(tie.brands)).toEqual({ rank: 1, of: 3 });
    expect(rankAmongTracked([])).toBeNull();
  });
});
