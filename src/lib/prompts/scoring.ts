// Prompt quality scoring.
//
// The previous scorer graded metadata completeness and word count, so
// "Can you suggest a reliable running for a buyer?" scored in the nineties:
// it had a topic id, a persona, one question mark and eight words. Nothing in
// it looked at the sentence.
//
// This rubric is dominated by two dimensions the old one had no notion of —
// semantic coherence and buyer-natural language — and both carry a hard
// minimum. A prompt that fails either cannot reach a usable score no matter
// how complete its metadata is.

import type { CandidatePromptDraft } from "./types";
import { contextDensity, validateNaturalQuery } from "./natural-validator";

export interface QualityBreakdown {
  semanticCoherence: number; // 0-25
  naturalBuyerLanguage: number; // 0-20
  businessRelevance: number; // 0-15
  intentClarity: number; // 0-10
  measurementUsefulness: number; // 0-10
  contextAppropriateness: number; // 0-10
  specificityBalance: number; // 0-5
  evidenceSupport: number; // 0-5
  redundancyPenalty: number;
  total: number;
  /** Set when a hard minimum was missed; the total is then capped. */
  cappedReason: string | null;
}

const AWKWARD_CONSTRUCTIONS: RegExp[] = [
  /\bthe strongest\b.*\boptions\b/i,
  /\bwhat kinds of\b.*\bare best suited to\b/i,
  /\bwhere should i start when researching\b/i,
  /\bwhat is a practical way to get started with\b/i,
  /\bwhich providers are worth considering for\b/i,
  /\bwhat other ways can\b/i,
  /\bhow should .* approach\b/i,
  /\bwhat options can address\b/i,
];

/** Question openings a person actually uses. */
const NATURAL_OPENINGS =
  /^(what|what's|which|who|where|how|is|are|does|do|can|could|should|would|will|has|have|any)\b/i;

/** Requests and need statements: "Help me find…", "Looking for…", "Need…". */
const REQUEST_OPENINGS =
  /^(recommend|suggest|find|compare|list|show|give me|help me|tell me|point me|please|need|i need|i'm looking|i am looking|looking for|searching for|shopping for|i want|want|trying to find|in the market for|i've just|i'm starting|i'm training|planning|thinking)\b/i;

const CONVERSATIONAL_MARKERS =
  /\b(best|good|recommend|worth|reliable|trusted|happy|reputation|reviews?|compare|better|vs|or|need|looking|help|suggest|should|my|i'm|i am)\b/i;

/**
 * Asks that return a generic list whatever the context. "Can you list popular
 * sporting goods options?" and "What are some reliable sports gear brands?"
 * are grammatical and still say nothing about a real customer.
 */
const GENERIC_LIST_ASK =
  /\b(list (some )?popular|popular .{0,30}options|some popular .{0,30}brands|what are some (reliable|popular|good) .{0,30}brands|options available|recommend the best .{0,20}brands$)\b/i;

function wordCount(text: string): number {
  return text.trim().split(/\s+/).filter(Boolean).length;
}

/**
 * Semantic coherence: does the sentence describe a coherent buying situation?
 * Reuses the natural validator as the hard floor, then rewards structural
 * signals that the roles are filled with the right kinds of thing.
 */
function scoreSemanticCoherence(draft: CandidatePromptDraft): { score: number; failed: boolean } {
  const verdict = validateNaturalQuery({ text: draft.text, section: draft.section, register: draft.register });
  if (!verdict.ok) return { score: 0, failed: true };

  let score = 16;
  // A frame-backed draft had its slot types checked before wording existed.
  if (draft.frameId || draft.contextBasis.includes("source:intent_model")) score += 5;
  if (draft.generationMethod === "model") score += 2;
  if (AWKWARD_CONSTRUCTIONS.some((pattern) => pattern.test(draft.text))) score -= 8;
  return { score: Math.max(0, Math.min(25, score)), failed: false };
}

function scoreNaturalLanguage(draft: CandidatePromptDraft): { score: number; failed: boolean } {
  const text = draft.text.trim();
  const words = wordCount(text);
  let score = 0;

  // A keyword or imperative prompt opens differently by design; judging it
  // against interrogative openings would penalise the very register the
  // reference products track most.
  // One test for every register: people open with a question, a request or
  // the need itself, and a keyword phrase opens with its shopping word.
  const opensNaturally =
    NATURAL_OPENINGS.test(text) ||
    REQUEST_OPENINGS.test(text) ||
    /^(best|top|cheapest|cheap|affordable|good)\b/i.test(text) ||
    /\b(vs|worth it|reviews?)\b/i.test(text);
  if (opensNaturally) score += 7;
  if (CONVERSATIONAL_MARKERS.test(text)) score += 5;
  if (GENERIC_LIST_ASK.test(text)) score -= 5;
  // Concrete context is what separates a customer from a category label.
  const contextSlots = draft.contextBasis.filter((key) => /^(situation|attribute|audience|budget):/.test(key)).length;
  score += contextSlots >= 2 ? 3 : contextSlots === 1 ? 2 : 0;
  // Length expectations are per register. A keyword query is SHORT by
  // definition — "Nike product quality reviews" is four words and is exactly
  // what a person types — so grading it against the five-to-twenty-word band
  // that suits interrogatives docked it into the unselectable band and no
  // keyword prompt could ever be chosen. This is the same mistake as
  // requiring a trailing question mark, one layer further down.
  // Questions and requests are preferred at up to seventeen words. Longer
  // ones were being built by stacking situation, attribute and audience into
  // one sentence (Trade Offs averaged 18.6 words against a reference Discovery
  // set's 8.7), which is exactly what makes a prompt read as assembled.
  const [lowWords, highWords] = draft.register === "keyword" ? [3, 14] : [5, 17];
  if (words >= lowWords && words <= highWords) score += 6;
  else if (words <= 22) score += 3;
  // Commas are rare in typed queries; two or more reads like written prose.
  const commas = (text.match(/,/g) ?? []).length;
  if (commas === 0) score += 2;
  else if (commas >= 2) score -= 4;

  if (AWKWARD_CONSTRUCTIONS.some((pattern) => pattern.test(text))) score -= 10;
  if (/\b(utilize|leverage|facilitate|endeavour|endeavor|aforementioned)\b/i.test(text)) score -= 6;

  const bounded = Math.max(0, Math.min(20, score));
  // Below half marks the sentence is not something a person would type.
  return { score: bounded, failed: bounded < 10 };
}

function scoreBusinessRelevance(draft: CandidatePromptDraft): number {
  let score = 0;
  if (draft.topicId) score += 6;
  if (draft.evidenceBasis.length > 0) score += 4;
  if (draft.contextBasis.length > 0) score += 3;
  if (draft.brandPolicy === "TARGET_REQUIRED" || draft.competitorEntityId) score += 2;
  return Math.min(15, score);
}

function scoreIntentClarity(draft: CandidatePromptDraft): number {
  const text = draft.text;
  let score = 10;
  if (/\band\b.*\band\b/i.test(text)) score -= 3;
  if (/\balso\b|\badditionally\b/i.test(text)) score -= 2;
  if (draft.register === "question" && !NATURAL_OPENINGS.test(text.trim()) && !REQUEST_OPENINGS.test(text.trim())) score -= 3;
  return Math.max(0, score);
}

function scoreMeasurementUsefulness(draft: CandidatePromptDraft): number {
  if (draft.section === "Trade Offs") return draft.competitorEntityId && draft.evaluationCriterion ? 10 : draft.competitorEntityId ? 7 : 3;
  if (draft.section === "Sentiment Analysis") return draft.sentimentTheme ? 10 : 4;
  // Discovery is useful in proportion to how likely it is to elicit brands.
  if (/\b(brands?|providers?|companies|options|which|who|best|recommend|suggest|need|looking for|help me find|show me|find me|where can i|any suggestions)\b/i.test(draft.text)) return 10;
  return 5;
}

function scoreContextAppropriateness(draft: CandidatePromptDraft): number {
  const density = contextDensity(draft.text);
  // Two context dimensions is the sweet spot; zero is thin, four is stuffed.
  if (density === 2) return 10;
  if (density === 1 || density === 3) return 8;
  if (density === 0) return 5;
  return 3;
}

function scoreSpecificityBalance(draft: CandidatePromptDraft): number {
  const words = wordCount(draft.text);
  if (draft.register === "keyword") {
    // Same reasoning as the language band: brevity is the register, not a
    // defect in it.
    if (words >= 3 && words <= 10) return 5;
    return words <= 16 ? 3 : 1;
  }
  if (words >= 6 && words <= 16) return 5;
  if (words >= 5 && words <= 22) return 3;
  return 1;
}

function scoreEvidenceSupport(draft: CandidatePromptDraft): number {
  return Math.min(5, draft.evidenceBasis.length * 2 + (draft.contextBasis.length > 0 ? 1 : 0));
}

/** Hard ceiling applied when a quality floor is missed. */
const FAILED_COHERENCE_CEILING = 25;
const FAILED_LANGUAGE_CEILING = 45;

export function scoreCandidate(draft: CandidatePromptDraft, maxSimilarityInSection: number): QualityBreakdown {
  const coherence = scoreSemanticCoherence(draft);
  const language = scoreNaturalLanguage(draft);

  const businessRelevance = scoreBusinessRelevance(draft);
  const intentClarity = scoreIntentClarity(draft);
  const measurementUsefulness = scoreMeasurementUsefulness(draft);
  const contextAppropriateness = scoreContextAppropriateness(draft);
  const specificityBalance = scoreSpecificityBalance(draft);
  const evidenceSupport = scoreEvidenceSupport(draft);

  const redundancyPenalty = maxSimilarityInSection >= 0.85 ? 25 : maxSimilarityInSection >= 0.7 ? 14 : maxSimilarityInSection >= 0.55 ? 6 : 0;

  const raw =
    coherence.score +
    language.score +
    businessRelevance +
    intentClarity +
    measurementUsefulness +
    contextAppropriateness +
    specificityBalance +
    evidenceSupport -
    redundancyPenalty;

  let total = Math.max(0, Math.min(100, raw));
  let cappedReason: string | null = null;

  // The control the old scorer lacked: a sentence that fails the language or
  // coherence floor cannot be rescued by complete metadata.
  if (coherence.failed) {
    total = Math.min(total, FAILED_COHERENCE_CEILING);
    cappedReason = "failed semantic coherence";
  } else if (language.failed) {
    total = Math.min(total, FAILED_LANGUAGE_CEILING);
    cappedReason = "failed natural-language floor";
  }

  return {
    semanticCoherence: coherence.score,
    naturalBuyerLanguage: language.score,
    businessRelevance,
    intentClarity,
    measurementUsefulness,
    contextAppropriateness,
    specificityBalance,
    evidenceSupport,
    redundancyPenalty,
    total,
    cappedReason,
  };
}

/** Below this a candidate is never selectable, only browsable as a reject. */
export const MIN_SELECTABLE_SCORE = 55;
