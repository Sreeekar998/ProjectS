// RealUserQueryFrame — the semantic plan for one question.
//
// The previous pipeline chose wording and meaning in the same step, so a
// grammatically-shaped template could be filled with semantically wrong
// concepts. Here a frame is built and validated *first*: it carries typed
// concept references, not strings. Only a frame that makes sense as a buyer
// question is handed to a realizer.
//
// A frame that cannot be realized is dropped. Nothing is forced into a slot
// to hit a quota.

import type { MeasurementConcept } from "./semantic-concepts";
import type { PromptSection } from "./types";

export type BuyerIntent =
  | "DISCOVER_CATEGORY"
  | "GET_RECOMMENDATION"
  | "SHORTLIST"
  | "SOLVE_PROBLEM"
  | "EVALUATE_OPTIONS"
  | "COMPARE_BRANDS"
  | "CHECK_TRUST"
  | "CHECK_REPUTATION"
  | "CHECK_EXPERIENCE"
  | "PURCHASE_DECISION";

/** How much context the realized question should carry. Real users vary. */
export type FrameDepth = "short" | "medium" | "deep";

/**
 * The grammatical register a prompt is written in.
 *
 * Captured AI-visibility products track a mixture, not one shape. Velova's
 * live Discovery set for Intelegencia opens with the bare phrase
 * "best outsourced AI-native MVP development company for SaaS startups" and
 * continues with imperatives ("Recommend the best…", "Find top…", "Suggest…")
 * alongside interrogatives; Peec's own prompt guide lists "Best electric cars
 * under $50k" and "Tesla vs Rivian" next to "Which EVs have the longest
 * range?". Emitting only well-formed questions reproduces a register real
 * users only sometimes use.
 */
export type PromptRegister = "keyword" | "imperative" | "question";

export interface RealUserQueryFrame {
  id: string;
  section: PromptSection;
  buyerIntent: BuyerIntent;
  depth: FrameDepth;
  register: PromptRegister;

  /** Required for every Discovery frame: the noun phrase being shopped for. */
  categoryConcept: MeasurementConcept | null;
  activityConcept: MeasurementConcept | null;
  audienceConcept: MeasurementConcept | null;
  criterionConcept: MeasurementConcept | null;
  jobConcept: MeasurementConcept | null;
  locationConcept: MeasurementConcept | null;

  targetBrand: string | null;
  competitorName: string | null;
  competitorEntityId: string | null;
  sentimentTheme: string | null;

  topicId: string | null;
  topicName: string | null;

  /** One-line statement of what this question is meant to elicit. */
  conversationalGoal: string;
  sourceConceptIds: string[];
}

export interface FrameValidity {
  valid: boolean;
  reason?: string;
}

/**
 * Structural validity of a frame, checked before any wording exists.
 *
 * These rules are what make "Can you suggest a reliable running?" impossible:
 * a Discovery frame requires a concept with a non-null `neutralLabel`, and an
 * ACTIVITY has one only when the business's own vocabulary supplied a head
 * noun ("running shoes").
 */
export function validateFrame(frame: RealUserQueryFrame): FrameValidity {
  if (frame.section === "Discovery") {
    if (frame.targetBrand) return { valid: false, reason: "Discovery frames must not carry the target brand" };
    if (frame.competitorName) return { valid: false, reason: "Discovery frames must not carry a competitor" };
    if (!frame.categoryConcept?.neutralLabel) {
      return { valid: false, reason: "Discovery needs a purchasable category noun phrase" };
    }
    if (frame.categoryConcept.isProprietary) {
      return { valid: false, reason: "Discovery category must not be a proprietary term" };
    }
  }

  if (frame.section === "Trade Offs") {
    if (!frame.targetBrand) return { valid: false, reason: "Trade Offs require the target brand" };
    if (!frame.competitorName || !frame.competitorEntityId) {
      return { valid: false, reason: "Trade Offs require a confirmed competitor" };
    }
    if (!frame.criterionConcept && !frame.activityConcept && !frame.categoryConcept) {
      return { valid: false, reason: "Trade Offs need a decision dimension" };
    }
  }

  if (frame.section === "Sentiment Analysis") {
    if (!frame.targetBrand) return { valid: false, reason: "Sentiment requires the target brand" };
    if (!frame.sentimentTheme) return { valid: false, reason: "Sentiment requires a theme" };
    if (frame.competitorName) return { valid: false, reason: "Sentiment frames should focus on the target" };
  }

  // Slot-type compatibility: the check the old template system never made.
  if (frame.activityConcept && !["ACTIVITY", "USE_CASE", "JOB_TO_BE_DONE"].includes(frame.activityConcept.kind)) {
    return { valid: false, reason: `activity slot cannot hold a ${frame.activityConcept.kind}` };
  }
  if (frame.audienceConcept && !["AUDIENCE", "PERSONA"].includes(frame.audienceConcept.kind)) {
    return { valid: false, reason: `audience slot cannot hold a ${frame.audienceConcept.kind}` };
  }
  if (frame.criterionConcept && !["EVALUATION_CRITERION", "FEATURE", "PURCHASE_CONSTRAINT"].includes(frame.criterionConcept.kind)) {
    return { valid: false, reason: `criterion slot cannot hold a ${frame.criterionConcept.kind}` };
  }
  if (frame.locationConcept && frame.locationConcept.kind !== "LOCATION") {
    return { valid: false, reason: `location slot cannot hold a ${frame.locationConcept.kind}` };
  }

  // A frame naming the same concept twice reads as a tautology
  // ("running shoes ... for running shoes").
  const slots = [frame.categoryConcept?.id, frame.activityConcept?.id, frame.criterionConcept?.id, frame.audienceConcept?.id].filter(Boolean);
  if (new Set(slots).size !== slots.length) return { valid: false, reason: "the same concept fills two slots" };

  return { valid: true };
}

/** Deduplicates frames that would realize into the same question shape. */
export function frameSignature(frame: RealUserQueryFrame): string {
  return [
    frame.section,
    frame.buyerIntent,
    frame.depth,
    frame.register,
    frame.categoryConcept?.neutralLabel ?? "",
    frame.activityConcept?.activityLabel ?? "",
    frame.audienceConcept?.canonicalLabel ?? "",
    frame.criterionConcept?.canonicalLabel ?? "",
    frame.competitorName ?? "",
    frame.sentimentTheme ?? "",
    frame.locationConcept?.canonicalLabel ?? "",
  ]
    .join("|")
    .toLowerCase();
}

/** Which context dimensions a frame actually covers — feeds selection. */
export function frameCoverageKeys(frame: RealUserQueryFrame): string[] {
  const keys: string[] = [`intent:${frame.buyerIntent}`, `depth:${frame.depth}`, `register:${frame.register}`];
  if (frame.topicId) keys.push(`topic:${frame.topicId}`);
  if (frame.categoryConcept) keys.push(`category:${frame.categoryConcept.id}`);
  if (frame.activityConcept) keys.push(`activity:${frame.activityConcept.id}`);
  if (frame.audienceConcept) keys.push(`audience:${frame.audienceConcept.id}`);
  if (frame.criterionConcept) keys.push(`criterion:${frame.criterionConcept.id}`);
  if (frame.locationConcept) keys.push(`location:${frame.locationConcept.id}`);
  if (frame.competitorEntityId) keys.push(`competitor:${frame.competitorEntityId}`);
  if (frame.sentimentTheme) keys.push(`theme:${frame.sentimentTheme}`);
  return keys;
}
