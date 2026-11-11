import type { BusinessArchetype } from "@/lib/profile/schema";

export type Cohort = "neutral_discovery" | "neutral_problem" | "neutral_evaluation" | "branded_accuracy" | "target_comparison";
export type PromptSection = "Discovery" | "Trade Offs" | "Sentiment Analysis";
export type Intent = "discover" | "recommend" | "solve_problem" | "compare" | "alternatives" | "evaluate" | "verify" | "purchase" | "visit_contact";
export type JourneyStage = "awareness" | "consideration" | "decision";
export type GeographyScope = "none" | "country" | "region" | "city" | "branch" | "district" | "neighborhood";
export type BrandPolicy = "TARGET_FORBIDDEN" | "COMPETITOR_ALLOWED" | "TARGET_REQUIRED" | "CONTROLLED";
export type LifecycleState = "GENERATING" | "CANDIDATE" | "VALIDATED" | "SHORTLISTED" | "SELECTED" | "USER_APPROVED" | "REJECTED";

/**
 * The user-facing selection policy: ten prompts in each of the three
 * sections. This replaced an earlier 21/4/5 split. Historical approved sets
 * keep whatever split they were frozen with — they are immutable — but every
 * new set is planned and validated against these numbers.
 */
export const SECTION_SELECT_COUNT: Record<PromptSection, number> = {
  Discovery: 10,
  "Trade Offs": 10,
  "Sentiment Analysis": 10,
};

/** Oversupply targets: generate many, select few. */
export const SECTION_CANDIDATE_TARGET: Record<PromptSection, number> = {
  Discovery: 32,
  "Trade Offs": 26,
  "Sentiment Analysis": 26,
};

/** A stored `generationSource` that a language model wrote ("model", or the legacy "gemini" label). */
export function isModelSource(source: string | null | undefined): boolean {
  return source === "model" || source === "gemini";
}

/** The stored `generationSource` as a draft's generation method. */
export function generationMethodOf(source: string | null | undefined): CandidatePromptDraft["generationMethod"] {
  if (source === "user") return "user";
  return isModelSource(source) ? "model" : "template";
}

export const NEUTRAL_TOTAL = SECTION_SELECT_COUNT.Discovery;
export const APPROVED_TOTAL = SECTION_SELECT_COUNT.Discovery + SECTION_SELECT_COUNT["Trade Offs"] + SECTION_SELECT_COUNT["Sentiment Analysis"];

export interface CoverageCell {
  key: string;
  /** Position of this cell among its cohort's cells with the same intent
   * (e.g. the 2nd of 4 target_comparison cells). */
  cellIndex: number;
  cohort: Cohort;
  section: PromptSection;
  intent: Intent;
  journeyStage: JourneyStage;
  topicId: string | null;
  topicName: string | null;
  persona: string | null;
  useCaseConstraint: string | null;
  evaluationCriterion: string | null;
  sentimentTheme: string | null;
  geographyScope: GeographyScope;
  brandPolicy: BrandPolicy;
  competitorEntityId: string | null; // set for target_comparison cells
  generateCount: number;
  selectCount: number;
}

export interface CoveragePolicy {
  archetype: BusinessArchetype;
  cells: CoverageCell[];
  version: string;
}

export interface CandidatePromptDraft {
  text: string;
  cohort: Cohort;
  section: PromptSection;
  intent: Intent;
  journeyStage: JourneyStage;
  topicId: string | null;
  persona: string | null;
  useCaseConstraint: string | null;
  evaluationCriterion: string | null;
  competitorEntityId: string | null;
  sentimentTheme: string | null;
  geographyScope: GeographyScope;
  geographyText: string | null;
  locationId: string | null;
  language: string;
  brandPolicy: BrandPolicy;
  coverageCellKey: string;
  evidenceBasis: string[];
  contextBasis: string[];
  /**
   * "model" for any language-model draft; the provider and model that wrote it
   * are recorded as a `model:<provider>:<model>` context key. Rows written
   * before 2026-09-16 carry the legacy value "gemini" whatever model wrote
   * them; readers treat it as "model" (see isModelSource).
   */
  generationMethod: "template" | "model" | "user";
  /** The semantic frame this text was realized from, when there was one.
   * A draft without a frame was typed by the user or predates the frame
   * pipeline; it still passes every validator, but it cannot claim the
   * slot-type guarantee a frame-backed draft carries. */
  frameId?: string | null;
  /** Set for user-authored prompts so provenance survives approval. */
  authoredBy?: "system" | "user";
  /** Grammatical register the text was written in; validation depends on it. */
  register?: "keyword" | "imperative" | "question";
}
