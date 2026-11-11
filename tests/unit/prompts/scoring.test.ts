import { describe, it, expect } from "vitest";
import { scoreCandidate } from "@/lib/prompts/scoring";
import type { CandidatePromptDraft } from "@/lib/prompts/types";

function draft(overrides: Partial<CandidatePromptDraft> = {}): CandidatePromptDraft {
  return {
    text: "What are the best running shoes for beginners?",
    cohort: "neutral_discovery",
    section: "Discovery",
    intent: "discover",
    journeyStage: "awareness",
    topicId: "topic1",
    persona: null,
    useCaseConstraint: null,
    evaluationCriterion: null,
    competitorEntityId: null,
    sentimentTheme: null,
    geographyScope: "none",
    geographyText: null,
    locationId: null,
    language: "en",
    brandPolicy: "TARGET_FORBIDDEN",
    coverageCellKey: "test",
    evidenceBasis: ["ev1", "ev2"],
    contextBasis: ["topic:Running shoes"],
    generationMethod: "template",
    ...overrides,
  };
}

describe("scoreCandidate", () => {
  it("scores a well-formed, evidence-backed, distinct candidate highly", () => {
    const result = scoreCandidate(draft(), 0);
    expect(result.total).toBeGreaterThan(70);
  });

  it("penalizes a candidate with high similarity to another survivor via redundancyPenalty", () => {
    const distinct = scoreCandidate(draft(), 0);
    const similar = scoreCandidate(draft(), 0.9);
    expect(similar.total).toBeLessThan(distinct.total);
    expect(similar.redundancyPenalty).toBeGreaterThan(0);
  });

  it("scores lower for a candidate with no evidence basis", () => {
    const withEvidence = scoreCandidate(draft({ evidenceBasis: ["ev1", "ev2"] }), 0);
    const withoutEvidence = scoreCandidate(draft({ evidenceBasis: [] }), 0);
    expect(withoutEvidence.evidenceSupport).toBeLessThan(withEvidence.evidenceSupport);
  });

  it("still credits business relevance for a branded candidate with no topic", () => {
    const result = scoreCandidate(draft({ brandPolicy: "TARGET_REQUIRED", topicId: null }), 0);
    expect(result.businessRelevance).toBeGreaterThan(0);
    expect(result.businessRelevance).toBeLessThanOrEqual(15);
  });

  // The defect this rubric exists to prevent: the previous scorer graded
  // metadata completeness, so these exact sentences — every field populated,
  // one question mark, a reasonable word count — scored in the nineties.
  it.each([
    ["Can you suggest a reliable running for a buyer?", "activity used as a purchasable noun"],
    ["Which running options are available for Jordan in India?", "unfilled category placeholder"],
    ["What kinds of running are best suited to Running in India?", "semantic role conflict"],
    ["What balanced picture emerges about Nike and authenticity?", "analyst voice"],
    ["Which providers are worth considering for find the right option for running?", "internal job placeholder"],
  ])("caps the score for a malformed prompt: %s", (text) => {
    const result = scoreCandidate(
      draft({
        text,
        topicId: "topic1",
        persona: "a buyer",
        evaluationCriterion: "overall value",
        evidenceBasis: ["ev1", "ev2", "ev3"],
        contextBasis: ["topic:Running", "audience:a buyer"],
      }),
      0,
    );
    expect(result.total).toBeLessThan(55);
    expect(result.cappedReason).toBeTruthy();
  });

  it("ranks a natural buyer question far above a metadata-complete malformed one", () => {
    const natural = scoreCandidate(draft({ text: "What are the best running shoe brands for beginners?" }), 0);
    const malformed = scoreCandidate(
      draft({
        text: "Can you suggest a reliable running for a buyer?",
        persona: "a buyer",
        evaluationCriterion: "overall value",
        evidenceBasis: ["ev1", "ev2", "ev3"],
      }),
      0,
    );
    expect(natural.total - malformed.total).toBeGreaterThan(25);
  });

  it("scores semantic coherence and natural language as the dominant dimensions", () => {
    const result = scoreCandidate(draft(), 0);
    expect(result.semanticCoherence).toBeGreaterThan(0);
    expect(result.naturalBuyerLanguage).toBeGreaterThan(0);
    // Together they are worth 45 of the 100 available points.
    expect(result.semanticCoherence + result.naturalBuyerLanguage).toBeGreaterThan(result.businessRelevance + result.intentClarity);
  });

  it("keeps the total score within [0, 100]", () => {
    const result = scoreCandidate(draft(), 1); // maximum possible similarity
    expect(result.total).toBeGreaterThanOrEqual(0);
    expect(result.total).toBeLessThanOrEqual(100);
  });
});
