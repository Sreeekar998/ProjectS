// The Measure workspace builders: prompt rows, brands, sources, opportunities
// and run-to-run comparison. Known arithmetic on hand-built observations.

import { describe, expect, it } from "vitest";
import { computeMeasure, type EngineInput } from "@/lib/measure/engine";
import { compareMeasurements } from "@/lib/measure/compare";
import { guessSourceKind } from "@/lib/measure/source-kind";
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
    evidence: { start, end: start + 1, text: "x" }, mention: { start, end: start + 1, text: "x" },
    roleBasis: "t", confidence: "strong" as const,
  };
}
function cite(url: string, ownership: "TARGET_OWNED" | "COMPETITOR_OWNED" | "THIRD_PARTY", ownerEntityId: string | null = null) {
  return { url, domain: new URL(url).hostname.replace(/^www\./, ""), ownership, ownerEntityId, ownerMentionedInText: false };
}
function comparison(subject: string, object: string, preference: "SUBJECT" | "OBJECT" | "TIE" | "UNCLEAR", aspect: string | null = null) {
  return { subjectEntityId: subject, subjectName: subject, objectEntityId: object, objectName: object, aspect, opinion: null, preference, evidence: { start: 0, end: 1, text: "x" }, confidence: "strong" as const };
}
function lineage(overrides: Partial<MeasureLineage> = {}): MeasureLineage {
  return {
    promptSetId: "ps", promptSetVersion: 1, competitiveSetVersionId: "cs1", competitiveSetVersion: 1, competitiveSetSource: "pinned",
    analysisVersion: "v1", analysisVersions: ["v1"], currentAnalysisVersion: "v1", staleAnalyses: 0,
    metricPolicyVersion: "measure-policy@2", providerExperiences: ["chatgpt_oxylabs_web"], engines: ["chatgpt"], samplesPerPrompt: 1,
    observerRegions: ["IN"], models: ["gpt-5-6"], ...overrides,
  };
}
function input(analyses: NormalizedObservation[], overrides: Partial<EngineInput> = {}): EngineInput {
  return {
    projectId: "p", collectionRunId: "r", analyses, plannedCount: analyses.length,
    plannedByProvider: { chatgpt_oxylabs_web: analyses.length }, targetEntityId: TARGET, targetName: "Target",
    competitors: [{ entityId: A, name: "Alpha" }, { entityId: B, name: "Beta" }],
    topics: [{ id: "top1", name: "Shoes" }], topicByPrompt: new Map([["pc", "top1"]]),
    prompts: new Map([["pc", { id: "pc", text: "best shoes?", section: "Discovery", topicId: "top1", competitorEntityId: null }]]),
    lineage: lineage(), ...overrides,
  };
}

describe("By-rival head-to-head rows", () => {
  it("books only comparisons that involve the target; rival-vs-rival never lands in a rival's row", () => {
    const analyses = [
      // Target beats Alpha; the answer also compares Alpha with Beta.
      obs({ observationId: "o1", section: "Trade Offs", comparisons: [comparison(TARGET, A, "SUBJECT", "weight"), comparison(A, B, "SUBJECT")] }),
      // Only Alpha vs Beta: says nothing about the target.
      obs({ observationId: "o2", section: "Trade Offs", comparisons: [comparison(A, B, "OBJECT")] }),
    ];
    const result = computeMeasure(input(analyses));
    const alpha = result.tradeOffs.combined!.byCompetitor.find((row) => row.entityId === A)!;
    const beta = result.tradeOffs.combined!.byCompetitor.find((row) => row.entityId === B)!;
    expect(alpha).toMatchObject({ targetPreferred: 1, competitorPreferred: 0, undecided: 0, observationIds: ["o1"] });
    expect(beta).toMatchObject({ targetPreferred: 0, competitorPreferred: 0, undecided: 0, observationIds: [] });
    expect(result.tradeOffs.combined!.outcomes.NO_COMPARISON).toBe(1);
    // The rival-only answer is "didn't compare them", so it is outside the decisiveness denominator too.
    expect(result.metrics.combined!.tradeoff_decisiveness).toMatchObject({ numerator: 1, denominator: 1 });
  });
});

describe("Prompt rows", () => {
  it("carries the analysis facts per question and never invents them for gaps", () => {
    const analyses = [
      obs({ observationId: "o1", rankEligibility: "explicit_ordered_list", occurrences: [hit(A, "Alpha", 0), hit(TARGET, "Target", 5)], positions: [
        { entityId: A, name: "Alpha", firstMentionOrder: 1, positionBucket: "top", explicitRank: 1, evidence: { start: 0, end: 1, text: "x" } },
        { entityId: TARGET, name: "Target", firstMentionOrder: 2, positionBucket: "top", explicitRank: 2, evidence: { start: 5, end: 6, text: "x" } },
      ], citations: [cite("https://target.example/p", "TARGET_OWNED", TARGET)] }),
      obs({ observationId: "o2", eligibility: "NOT_CAPTURED", warnings: [{ code: "not_captured", detail: "" }], sourceCaptureState: "unknown" }),
      obs({ observationId: "o3", eligibility: "NOT_CAPTURED", warnings: [{ code: "analysis_missing", detail: "" }], sourceCaptureState: "unknown" }),
      obs({ observationId: "o4", eligibility: "NEEDS_REVIEW", occurrences: [hit(TARGET)] }),
    ];
    const result = computeMeasure(input(analyses, { provenance: new Map([["o1", { observedAt: 1, model: "gpt-5-6", country: "IN", searchState: "on" }]]) }));
    const rows = new Map(result.prompts.map((row) => [row.observationId ?? row.status, row]));
    expect(rows.get("o1")).toMatchObject({ status: "analysable", targetNamed: true, brandsNamed: ["Alpha", "Target"], targetRank: 2, firstChoiceName: "Alpha", ownedCited: true, rivalCited: false, citedDomains: ["target.example"], model: "gpt-5-6", country: "IN", text: "best shoes?", topicName: "Shoes" });
    const notCollected = result.prompts.find((row) => row.status === "not_collected")!;
    const awaiting = result.prompts.find((row) => row.status === "awaiting_analysis")!;
    const review = result.prompts.find((row) => row.status === "needs_review")!;
    expect(notCollected.targetNamed).toBeNull();
    expect(notCollected.observationId).toBeNull();
    expect(awaiting.targetNamed).toBeNull();
    // Flagged for review: named in the text, but the row must not claim a fact.
    expect(review.targetNamed).toBeNull();
    // Captured counts the collected answer that is awaiting analysis; analysable does not.
    expect(result.coverage).toMatchObject({ planned: 4, captured: 3, analysable: 1, needsReview: 1, notCollected: 1, awaitingAnalysis: 1 });
    expect(result.scopes.discovery.excluded).toEqual([
      { reason: "not captured", count: 1 },
      { reason: "awaiting analysis", count: 1 },
      { reason: "analysis uncertain", count: 1 },
    ]);
  });
});

describe("Brands table", () => {
  it("counts discovery presence, explicit ranks, head-to-heads against the target and own-site citations; untracked names get no share", () => {
    const ranked = (id: string, rank: number, order: number) => ({ entityId: id, name: id, firstMentionOrder: order, positionBucket: "top" as const, explicitRank: rank, evidence: { start: 0, end: 1, text: "x" } });
    const analyses = [
      obs({ observationId: "d1", rankEligibility: "explicit_ordered_list", occurrences: [hit(TARGET), hit(A)], positions: [ranked(TARGET, 1, 1), ranked(A, 2, 2)] }),
      obs({ observationId: "d2", rankEligibility: "explicit_ordered_list", occurrences: [hit(A), hit(TARGET)], positions: [ranked(A, 1, 1), ranked(TARGET, 3, 2)], emergingCandidates: [{ name: "Newco", mentions: [], role: "RECOMMENDED" }] }),
      obs({ observationId: "d3", occurrences: [hit(A)], emergingCandidates: [{ name: "Newco", mentions: [], role: "RECOMMENDED" }] }),
      obs({ observationId: "t1", section: "Trade Offs", comparisons: [comparison(A, TARGET, "SUBJECT")], citations: [cite("https://alpha.example/x", "COMPETITOR_OWNED", A)] }),
      obs({ observationId: "t2", section: "Trade Offs", comparisons: [comparison(TARGET, A, "TIE")] }),
    ];
    const result = computeMeasure(input(analyses));
    const target = result.brands.find((row) => row.relation === "target")!;
    const alpha = result.brands.find((row) => row.name === "Alpha")!;
    const newco = result.brands.find((row) => row.name === "Newco")!;
    expect(target).toMatchObject({ discoveryNamed: 2, discoveryEligible: 3, firstChoice: 1, rankedCount: 2, averageRank: 2, headToHead: null, ownDomainsCited: 0 });
    expect(target.shareOfVoice).toBeCloseTo(2 / 5);
    expect(alpha).toMatchObject({ discoveryNamed: 3, firstChoice: 1, rankedCount: 2, averageRank: 1.5, ownDomainsCited: 1 });
    expect(alpha.headToHead).toMatchObject({ won: 0, lost: 1, undecided: 1 });
    expect(newco).toMatchObject({ relation: "emerging", discoveryNamed: 2, namedAnywhere: 2, shareOfVoice: null, firstChoice: 0, headToHead: null });
    // The untracked name never touches a tracked denominator.
    expect(result.metrics.combined!.discovery_share_of_voice!.denominator).toBe(5);
  });
});

describe("Sources at domain and URL grain", () => {
  it("counts answers once per domain, links by volume, and discovery answers without the target as an answer-level fact", () => {
    const analyses = [
      obs({ observationId: "d1", occurrences: [hit(A)], citations: [cite("https://www.reviews.example/best", "THIRD_PARTY"), cite("https://www.reviews.example/top", "THIRD_PARTY")] }),
      obs({ observationId: "d2", occurrences: [hit(TARGET)], citations: [cite("https://www.reviews.example/best", "THIRD_PARTY"), cite("https://target.example/p", "TARGET_OWNED", TARGET)] }),
      obs({ observationId: "s1", section: "Sentiment Analysis", citations: [cite("https://www.reviews.example/best", "THIRD_PARTY")] }),
      // Sources not captured: contributes nothing.
      obs({ observationId: "d3", sourceCaptureState: "not_captured", citations: [cite("https://www.reviews.example/best", "THIRD_PARTY")] }),
    ];
    const result = computeMeasure(input(analyses));
    const reviews = result.sources.domains.find((row) => row.domain === "reviews.example")!;
    expect(reviews).toMatchObject({ responsesCiting: 3, totalCitations: 4, discoveryWithoutTarget: 1, discoveryWithoutTargetIds: ["d1"], bySection: { Discovery: 2, "Sentiment Analysis": 1 } });
    const best = result.sources.urls.find((row) => row.url === "https://www.reviews.example/best")!;
    expect(best).toMatchObject({ responsesCiting: 3, discoveryWithoutTarget: 1 });
    expect(result.sources.totals).toEqual({ trustworthy: 3, withSources: 3, citations: 5, uniqueUrls: 3, uniqueDomains: 2 });
    expect(result.domains).toEqual(result.sources.domains);
  });

  it("guesses a kind from the address and never overrides ownership", () => {
    expect(guessSourceKind("reddit.com", ["https://www.reddit.com/r/running/x"])).toBe("community");
    expect(guessSourceKind("amazon.in", ["https://www.amazon.in/dp/B0X"])).toBe("marketplace");
    expect(guessSourceKind("wikipedia.org", [])).toBe("reference");
    expect(guessSourceKind("youtube.com", [])).toBe("social_video");
    expect(guessSourceKind("runnersworld.com", ["https://www.runnersworld.com/gear/best-trail-shoes"])).toBe("editorial");
    expect(guessSourceKind("example.org", ["https://example.org/about"])).toBe("other");
    expect(guessSourceKind("reddit.com", [], "TARGET_OWNED")).toBe("yours");
    expect(guessSourceKind("amazon.in", [], "COMPETITOR_OWNED")).toBe("rival");
  });
});

describe("Opportunities", () => {
  it("are built from analysable answers only and say what they rest on", () => {
    const analyses = [
      obs({ observationId: "d1", occurrences: [hit(A)], citations: [cite("https://www.reviews.example/best", "THIRD_PARTY")] }),
      obs({ observationId: "d2", occurrences: [hit(A), hit(B)] }),
      obs({ observationId: "d3", eligibility: "NOT_CAPTURED", warnings: [{ code: "not_captured", detail: "" }] }),
      obs({ observationId: "d4", occurrences: [hit(TARGET)], citations: [cite("https://www.reviews.example/best", "THIRD_PARTY")] }),
      obs({ observationId: "t1", section: "Trade Offs", comparisons: [comparison(A, TARGET, "SUBJECT", "durability")] }),
      obs({ observationId: "s1", section: "Sentiment Analysis", sentiment: [{ entityId: TARGET, entityName: "Target", overallPortrayal: "NEGATIVE", aspects: [{ entityId: TARGET, entityName: "Target", aspectTerm: null, aspectCategory: "support", opinionTerm: null, polarity: "NEGATIVE", evidence: { start: 0, end: 1, text: "x" }, confidence: "strong" }] }] }),
      obs({ observationId: "s2", section: "Sentiment Analysis", sentiment: [{ entityId: TARGET, entityName: "Target", overallPortrayal: "POSITIVE", aspects: [] }], emergingCandidates: [{ name: "Newco", mentions: [], role: "RECOMMENDED" }] }),
      obs({ observationId: "s3", section: "Sentiment Analysis", emergingCandidates: [{ name: "Newco", mentions: [], role: "RECOMMENDED" }] }),
    ];
    const result = computeMeasure(input(analyses));
    const byType = Object.fromEntries(result.opportunities.map((row) => [row.type, row]));

    expect(byType.discovery_gap).toMatchObject({ count: 2, outOf: 3, observationIds: ["d1", "d2"] });
    expect(byType.discovery_gap!.items.map((item) => [item.label, item.count])).toEqual([["Alpha", 2], ["Beta", 1]]);
    expect(byType.tradeoff_loss).toMatchObject({ count: 1, outOf: 1, observationIds: ["t1"] });
    // One finding for every lost head-to-head, listed by rival with the aspects named (measure-policy@4).
    expect(byType.tradeoff_loss!.items).toEqual([{ label: "Alpha (durability)", count: 1, observationIds: ["t1"] }]);
    expect(byType.reputation_concern).toMatchObject({ count: 1, outOf: 3, observationIds: ["s1"] });
    // The third-party site cited in the gap answer, counted at the answer level only.
    expect(byType.source_gap).toMatchObject({ count: 1, outOf: 2, observationIds: ["d1"] });
    expect(byType.source_gap!.detail).toContain("pages were not fetched");
    // Retired in measure-policy@4: they restated figures the Sources view shows.
    expect(byType.owned_uncited).toBeUndefined();
    expect(byType.rival_source).toBeUndefined();
    // One missing-from-discovery finding, never one per topic.
    expect(result.opportunities.filter((row) => row.type === "discovery_gap")).toHaveLength(1);
    expect(byType.untracked_brand).toMatchObject({ count: 1 });
    expect(byType.untracked_brand!.items).toEqual([{ label: "Newco", count: 2, observationIds: ["s2", "s3"] }]);
    expect(byType.coverage_gap).toMatchObject({ count: 1, outOf: 8 });
    // Not captured answers never appear as a gap's evidence.
    for (const row of result.opportunities) expect(row.observationIds).not.toContain("d3");
  });

  it("quotes the sentence the analysis read behind a gap, a loss and a concern, naming the answer it came from", () => {
    const rivalHit = { ...hit(A, "Alpha"), relation: "confirmed_competitor" as const, evidence: { start: 0, end: 30, text: "  Alpha is the safest all-round   choice.  " } };
    const analyses = [
      obs({ observationId: "d1", occurrences: [rivalHit] }),
      obs({ observationId: "d2", occurrences: [{ ...rivalHit, evidence: { start: 0, end: 5, text: "Alpha again, for longer runs." } }] }),
      obs({ observationId: "d3", occurrences: [{ ...rivalHit, evidence: { start: 0, end: 5, text: "Alpha a third time." } }] }),
      obs({ observationId: "t1", section: "Trade Offs", comparisons: [{ ...comparison(TARGET, A, "OBJECT", "durability"), evidence: { start: 0, end: 10, text: "Alpha lasts longer than Target." } }] }),
      // A win: its comparison sentence must not be quoted as a loss.
      obs({ observationId: "t2", section: "Trade Offs", comparisons: [{ ...comparison(A, TARGET, "OBJECT", "weight"), evidence: { start: 0, end: 10, text: "Target is lighter than Alpha." } }] }),
      obs({ observationId: "s1", section: "Sentiment Analysis", sentiment: [{ entityId: TARGET, entityName: "Target", overallPortrayal: "MIXED", aspects: [
        { entityId: TARGET, entityName: "Target", aspectTerm: null, aspectCategory: "comfort", opinionTerm: null, polarity: "POSITIVE", evidence: { start: 0, end: 1, text: "Target is comfortable." }, confidence: "strong" },
        { entityId: TARGET, entityName: "Target", aspectTerm: null, aspectCategory: "durability", opinionTerm: null, polarity: "NEGATIVE", evidence: { start: 0, end: 1, text: "But the outsole wears out within months." }, confidence: "strong" },
      ] }] }),
    ];
    const result = computeMeasure(input(analyses));
    const byType = Object.fromEntries(result.opportunities.map((row) => [row.type, row]));
    // Whitespace is normalised, at most two examples, in answer order.
    expect(byType.discovery_gap!.examples).toEqual([
      { observationId: "d1", text: "Alpha is the safest all-round choice." },
      { observationId: "d2", text: "Alpha again, for longer runs." },
    ]);
    expect(byType.tradeoff_loss!.examples).toEqual([{ observationId: "t1", text: "Alpha lasts longer than Target." }]);
    // Only the negative or mixed sentence is quoted, not the positive one beside it.
    expect(byType.reputation_concern!.examples).toEqual([{ observationId: "s1", text: "But the outsole wears out within months." }]);
    // Findings that quote nothing carry no examples.
    expect(byType.owned_uncited?.examples ?? []).toEqual([]);
  });

  it("never quotes a bare name as what the assistant said", () => {
    const label = { ...hit(A, "Alpha"), relation: "confirmed_competitor" as const, mention: { start: 0, end: 5, text: "Alpha Beauty Salon" }, evidence: { start: 0, end: 18, text: "Alpha Beauty Salon" } };
    const result = computeMeasure(input([obs({ observationId: "d1", occurrences: [label] })]));
    expect(result.opportunities.find((row) => row.type === "discovery_gap")!.examples).toEqual([]);
  });

  it("quotes markdown as prose, truncates a long sentence, and skips blank spans", () => {
    // A long sentence, in words: a bare token run ("4.9", "xxxx") is not quoted at all.
    const long = `Alpha ${"is a longer sentence ".repeat(20)}`.trim();
    const result = computeMeasure(input([
      obs({ observationId: "d0", occurrences: [{ ...hit(A, "Alpha"), relation: "confirmed_competitor" as const, evidence: { start: 0, end: 60, text: "2. **Alpha Speedcross 6** — see [the review](https://r.example/x) for `details`." } }] }),
      obs({ observationId: "d1", occurrences: [{ ...hit(A, "Alpha"), relation: "confirmed_competitor" as const, evidence: { start: 0, end: 300, text: long } }] }),
      obs({ observationId: "d2", occurrences: [{ ...hit(A, "Alpha"), relation: "confirmed_competitor" as const, evidence: { start: 0, end: 1, text: "   " } }] }),
    ]));
    const gap = result.opportunities.find((row) => row.type === "discovery_gap")!;
    expect(gap.examples).toHaveLength(2);
    expect(gap.examples![0]).toEqual({ observationId: "d0", text: "Alpha Speedcross 6 — see the review for details." });
    expect(gap.examples![1]!.text).toHaveLength(240);
    expect(gap.examples![1]!.text.endsWith("…")).toBe(true);
  });

  it("produces nothing from a run with no analysable answers", () => {
    const result = computeMeasure(input([obs({ observationId: "d1", eligibility: "NOT_CAPTURED", warnings: [{ code: "not_captured", detail: "" }] })]));
    expect(result.opportunities.map((row) => row.type)).toEqual(["coverage_gap"]);
  });
});

describe("Comparing two measurements", () => {
  const ten = (present: number, id: string) => Array.from({ length: 10 }, (_, i) => obs({ observationId: `${id}${i}`, occurrences: i < present ? [hit(TARGET)] : [hit(A)] }));

  it("gives points only for a comparable pair with enough answers on both sides", () => {
    const before = computeMeasure(input(ten(3, "a"), { collectionRunId: "r1" }));
    const after = computeMeasure(input(ten(5, "b"), { collectionRunId: "r2" }));
    const comparison = compareMeasurements(after, before);
    expect(comparison.comparability.level).toBe("comparable");
    const delta = comparison.metrics.combined!.discovery_visibility!;
    expect(delta).toMatchObject({ from: { numerator: 3, denominator: 10 }, to: { numerator: 5, denominator: 10 }, points: 20, direction: "up", countsOnly: false });
  });

  it("shows counts, not points, when either side is a small sample", () => {
    // 1 of 4 before, 5 of 10 after: up, but four answers cannot carry points.
    const before = computeMeasure(input(ten(1, "a").slice(0, 4), { collectionRunId: "r1" }));
    const after = computeMeasure(input(ten(5, "b"), { collectionRunId: "r2" }));
    const delta = compareMeasurements(after, before).metrics.combined!.discovery_visibility!;
    expect(delta.points).toBeNull();
    expect(delta.countsOnly).toBe(true);
    expect(delta.direction).toBe("up");
  });

  it("refuses every delta across a methodology break", () => {
    const before = computeMeasure(input(ten(3, "a"), { collectionRunId: "r1", lineage: lineage({ promptSetId: "ps1" }) }));
    const after = computeMeasure(input(ten(5, "b"), { collectionRunId: "r2", lineage: lineage({ promptSetId: "ps2" }) }));
    const comparison = compareMeasurements(after, before);
    expect(comparison.comparability.level).toBe("break");
    expect(comparison.metrics).toEqual({});
    expect(comparison.tradeOffs).toEqual({});
  });

  it("keeps a null value out of every delta", () => {
    const before = computeMeasure(input(ten(3, "a"), { collectionRunId: "r1" }));
    const after = computeMeasure(input(ten(5, "b"), { collectionRunId: "r2" }));
    const delta = compareMeasurements(after, before).metrics.combined!.first_choice_rate!;
    expect(delta.from.value).toBeNull();
    expect(delta.direction).toBeNull();
    expect(delta.points).toBeNull();
  });
});

describe("measure-policy@4", () => {
  const untracked = (name: string) => ({ name, mentions: [], role: "RECOMMENDED" as const });

  it("counts an untracked business once however the answers spelled it", () => {
    const analyses = [
      obs({ observationId: "d1", emergingCandidates: [untracked("ALKEMY Salons"), untracked("It's Beauty Ladies Salon")] }),
      obs({ observationId: "d2", emergingCandidates: [untracked("Alkemy Salons"), untracked("Its Beauty Ladies Salon")] }),
      obs({ observationId: "d3", occurrences: [hit(TARGET)], emergingCandidates: [untracked("Alkemy Salons")] }),
    ];
    const result = computeMeasure(input(analyses));
    const rows = result.brands.filter((row) => row.relation === "emerging");
    expect(rows.map((row) => [row.name, row.discoveryNamed])).toEqual([["Alkemy Salons", 3], ["It's Beauty Ladies Salon", 2]]);
    expect(result.emerging.map((row) => row.name)).toEqual(["Alkemy Salons", "It's Beauty Ladies Salon"]);
    // Target 1 + Alkemy 3 + It's Beauty 2 = 6 business mentions.
    expect(result.metrics.combined!.discovery_share_all_names).toMatchObject({ numerator: 1, denominator: 6 });
  });

  it("calls an answer 'no business named' only when it named no business at all, tracked or not", () => {
    const analyses = [
      obs({ observationId: "d1", emergingCandidates: [untracked("Glow Salon")] }),
      obs({ observationId: "d2" }),
      obs({ observationId: "d3", occurrences: [hit(A)] }),
    ];
    const metric = computeMeasure(input(analyses)).metrics.combined!.answer_brand_free_rate!;
    expect(metric).toMatchObject({ numerator: 1, denominator: 3, numeratorObservationIds: ["d2"] });
  });

  it("names a topic's leader from every business, with its count and the answers naming the target", () => {
    const analyses = [
      obs({ observationId: "d1", emergingCandidates: [untracked("Glow Salon")], occurrences: [hit(A)] }),
      obs({ observationId: "d2", emergingCandidates: [untracked("Glow Salon")] }),
      obs({ observationId: "d3", occurrences: [hit(TARGET)] }),
    ];
    const [topic] = computeMeasure(input(analyses)).byTopic;
    expect(topic).toMatchObject({ eligible: 3, targetPresent: 1, targetIds: ["d3"], leaderName: "Glow Salon", leaderCount: 2 });
  });

  it("classifies each answer once by whose site it cited", () => {
    const analyses = [
      obs({ observationId: "o1", citations: [cite("https://target.example/a", "TARGET_OWNED", TARGET), cite("https://alpha.example/b", "COMPETITOR_OWNED", A)] }),
      obs({ observationId: "o2", citations: [cite("https://alpha.example/b", "COMPETITOR_OWNED", A), cite("https://dir.example/c", "THIRD_PARTY")] }),
      obs({ observationId: "o3", citations: [cite("https://dir.example/c", "THIRD_PARTY"), cite("https://blog.example/d", "THIRD_PARTY")] }),
      obs({ observationId: "o4", sourceCaptureState: "none_present" }),
      // Untrustworthy capture: in no group.
      obs({ observationId: "o5", sourceCaptureState: "not_captured", citations: [cite("https://target.example/a", "TARGET_OWNED", TARGET)] }),
    ];
    expect(computeMeasure(input(analyses)).sources.answerMix).toEqual({ yours: ["o1"], rivalNotYours: ["o2"], thirdPartyOnly: ["o3"], noSources: ["o4"] });
  });
});
