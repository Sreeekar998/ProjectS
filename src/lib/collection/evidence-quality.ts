// Evidence-quality vocabulary for Observe.
//
// The single most important distinction in this stage is between what the
// provider DID and what the operator MANAGED TO CAPTURE. Collapsing the two
// silently converts a collection gap into a measured fact:
//
//   "no sources were captured"   ->   "the provider used no sources"
//
// The first is a hole in our evidence; the second is a finding about the
// provider. A later Measure stage that cannot tell them apart will compute an
// owned-citation rate against a denominator it does not understand.
//
// Every field here is therefore explicit about its own reliability, and every
// one of them can be UNKNOWN. Unknown is a legitimate, final answer — it is
// never rounded to zero.

/** Whether the answer text itself is whole. */
export type AnswerCaptureState =
  | "complete" // operator confirms the full answer was transferred
  | "truncated" // known to be partial (hit a limit, copy cut off)
  | "unknown"; // not asserted

/**
 * What we know about the sources/citations behind an answer.
 *
 * `none_present` is a positive observation about the provider — the operator
 * looked and there were no sources. `not_captured` is a statement about us.
 * They must never be merged.
 */
export type SourcesCaptureState =
  | "complete" // every source the UI showed was transferred
  | "partial" // some transferred, operator knows others existed
  | "none_present" // operator looked; the provider displayed no sources
  | "not_captured" // not transferred; says nothing about the provider
  | "unknown"; // operator did not assert either way

/** Did the consumer product run a web search for this answer? */
export type SearchState =
  | "on" // UI showed search/browsing activity
  | "off" // UI showed none and the operator checked
  | "unknown" // not determinable from the surface
  | "not_applicable"; // route has no consumer search concept

/**
 * The neutral-session attestation for one observation.
 *
 * Recorded per provider because the two products do not offer the same
 * controls: ChatGPT documents a Temporary Chat that excludes memory and custom
 * instructions, while Gemini exposes personalization through a separate
 * Personal Intelligence / memory setting. A single shared "clean session"
 * boolean would assert parity that does not exist, so each field is tri-state
 * and defaults to unknown.
 */
export interface SessionProfile {
  signedIn: boolean | null;
  accountTier: string | null;
  /** ChatGPT: Temporary Chat. Gemini: temporary chat where offered. */
  temporaryChat: boolean | null;
  /** ChatGPT: memory off / Temporary Chat. Gemini: Personal Intelligence off. */
  personalizationDisabled: boolean | null;
  /** ChatGPT custom instructions; null where the surface has no equivalent. */
  customInstructionsDisabled: boolean | null;
  /** A brand-new conversation was opened for this single prompt. */
  freshConversation: boolean | null;
  notes: string | null;
}
