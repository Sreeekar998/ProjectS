// Observation Analysis — the normalized evidence schema.
//
// This layer answers "what measurable evidence is present in this answer?"
// It never answers "how visible is the brand?" — that is Measure's job, and
// keeping the boundary sharp is what lets Measure be recomputed, or corrected,
// without re-collecting anything.
//
// Three commitments shape every type here:
//
//   1. The raw answer is untouched. An Analysis is evidence ABOUT a response,
//      stored beside it, versioned, and re-derivable.
//   2. Every derived claim carries the span that supports it. A fact with no
//      quotable span is not a fact we will assert.
//   3. Unknown is a first-class value. Nothing is rounded toward a decision
//      the text does not support.

import type { PromptSection } from "@/lib/prompts/types";
import type { SourcesCaptureState } from "@/lib/collection/evidence-quality";

/** Bumped whenever interpretation changes in a way that alters output. */
// @10 (2026-09-15): mentions are linked against the run's FROZEN competitive
// set (plus the target and parented products) instead of live confirmed
// entities, so a rival confirmed later never changes an earlier analysis.
// @11 (2026-09-16): untracked names are businesses of the measured kind, never places or sentence fragments.
// @12 (2026-09-16): nor examples the answer asks about, lead-source channels, jargon (B2B, SaaS), flow steps, features or modules.
// @13 (2026-09-19): coded heads link ("Y12" for "Y12 Salon"); a Trade Off
// verdict naming one side is read; hedged comparatives are unclear; a noun
// ending in -er is no longer a comparative.
// @14 (2026-09-19): the @13 rules finished (brand names are masked before the
// comparative check, so "Atelier" is not an -er word; the asker's own
// "issue"/"problem" is not a negative opinion). Rows written as @13 while
// those rules were half-applied are superseded by re-analysis.
// @15 (2026-09-19): untracked businesses are read from whole option labels
// (map entries, "* **Name** — Area." bullets), so five-word names and names
// with "&" count, a branch's area is cut ("N.Bar … Emirates Towers" and
// "… Gate Avenue" are one salon), and the area after an option's dash is
// never a business ("— Azizi Riviera.", "— Carlton Downtown Hotel.").
// @16 (2026-09-19): a verdict written after the chosen name ("X has the
// stronger documented case") is read; "depending on where you are" is a
// condition, not a verdict; the asker's condition ("if your nails are weak")
// and an offer to look for complaints are not opinions of the business.
// @17 (2026-10-15): in a Trade Off answer the question's two businesses link by
// their leading words ("1847", "Chaps & Co"; a digit start counts as a
// capital); verdicts read "I’d" with a curly apostrophe, "my initial pick would
// be X", "My verdict: X" and "X would be my first choice"; "Choose A for …;
// choose B if …" and "A if …, and B if …" are a split (no winner) that a later
// lean under one condition does not overturn; "if you're choosing between" is
// framing, not a condition; a caveat after ", but" no longer voids a lean.
// @18 (2026-11-09): options are read from numbered lines and headings that
// carry only a name ("1. Maria Dowling", "## 1. ELAN Lash & Brow Beauty
// Lounge") when the lines below look like a listing (a rating, a phone
// number, "Area · kind", a website link); a tracked business written as an
// option's label is recommended, not a bare mention; an answer's options
// include untracked businesses, so a numbered list of untracked salons can
// carry a rank and its first pick is recorded; a tracked name written with
// "and" for "&" (or the reverse) links to the tracked business; a shorter
// reference to a listed name ("UB Grooming" for "UB Grooming Salon") is the
// same business; reporting that no complaint was found ("I couldn't find a
// clearly documented public complaint…") is not a negative opinion.
// ChatGPT's October 2026 answers
// use that layout, and a DIFC salon's "best lash extension salons" answer
// listing six ranked salons read as naming no business at all.
export const ANALYSIS_VERSION = "observation-analysis@18";

// ---------------------------------------------------------------------------
// Spans — the provenance primitive
// ---------------------------------------------------------------------------

/**
 * A verbatim slice of the raw response.
 *
 * `text` is stored redundantly with the offsets on purpose: it is what makes an
 * analysis auditable without re-reading the response, and it lets validation
 * prove after the fact that the offsets still resolve to the same characters.
 */
export interface Span {
  start: number;
  end: number;
  text: string;
}

// ---------------------------------------------------------------------------
// Entity occurrence
// ---------------------------------------------------------------------------

/**
 * How an entity was named in the text, relative to the entity we linked it to.
 *
 * The distinction matters for measurement policy: "Pegasus 41 is a great daily
 * trainer" is evidence about Nike, but it is not the same evidence as "Nike
 * makes great daily trainers", and a headline brand-presence number should be
 * able to choose whether to count it.
 */
export type SurfaceForm =
  | "exact_name" // the entity's own canonical name
  | "alias" // a known alias of the entity
  | "product_of" // a product/sub-brand resolved up to its parent entity
  | "unlinked"; // a brand-like string we could not resolve

/** The entity's standing in this project, at analysis time. */
export type EntityRelation =
  | "target"
  | "confirmed_competitor"
  | "target_product" // product/sub-brand belonging to the target
  | "competitor_product"
  | "emerging" // plausible brand outside the frozen set — never a denominator
  | "unknown";

/**
 * What the response actually did with this entity.
 *
 * Deliberately small. The brief's starting taxonomy had eight roles; three of
 * them (SHORTLISTED, PREFERRED, RECOMMENDED) turned out not to be separable
 * from text with any consistency, and a distinction an annotator cannot apply
 * reliably is not one a parser should assert. Preference is captured properly
 * in a comparison quintuple instead, where it has a subject, an object and an
 * aspect to hang on.
 *
 * SOURCE_ONLY is not here either: a brand appearing only in a citation is not
 * an occurrence in the answer text at all, so it lives in the citation record.
 */
export type OccurrenceRole =
  | "RECOMMENDED" // presented as an option to choose
  | "DISCOURAGED" // explicitly advised against
  | "COMPARED" // set against another entity without a verdict
  | "BACKGROUND" // factual/historical reference, not a buying option
  | "MENTION_ONLY" // named, with nothing further supportable
  | "UNCLEAR"; // named, and the role genuinely cannot be decided

export interface EntityOccurrence {
  /** Null when the surface form could not be linked to a known entity. */
  entityId: string | null;
  /** The linked entity's display name, or the raw surface string if unlinked. */
  name: string;
  surfaceForm: SurfaceForm;
  relation: EntityRelation;
  /** When surfaceForm is product_of: the product string as written. */
  productSurface: string | null;
  role: OccurrenceRole;
  /** The sentence (or clause) that justifies the role. */
  evidence: Span;
  /** The mention span itself, inside `evidence`. */
  mention: Span;
  /** Why this role was assigned — a rule name, readable in the UI. */
  roleBasis: string;
  confidence: Confidence;
}

// ---------------------------------------------------------------------------
// Confidence — evidence-typed, not model-reported
// ---------------------------------------------------------------------------

/**
 * Confidence as a category of evidence rather than a probability.
 *
 * A self-reported 0.96 from a language model is not a calibrated probability,
 * and treating it as one is a documented failure mode. What is defensible is
 * saying WHAT KIND of evidence produced a claim, because that is checkable:
 * an exact string match is a different kind of fact from a clause inferred
 * across a contrast marker, and a reader can audit which they are looking at.
 */
export type Confidence =
  | "exact" // literal match / explicit structure; no interpretation
  | "strong" // unambiguous linguistic signal in the same clause
  | "weak" // signal present but distant, hedged, or partially blocked
  | "uncertain"; // recorded so it can be reviewed, not aggregated

export const AGGREGATABLE_CONFIDENCE: Confidence[] = ["exact", "strong"];

// ---------------------------------------------------------------------------
// Comparison — COQE-style quintuple
// ---------------------------------------------------------------------------

/**
 * A comparative opinion, in the shape the comparative-opinion-mining
 * literature settled on: (subject, object, aspect, opinion, preference).
 *
 * Using the established quintuple rather than an ad-hoc "winner" field keeps
 * the hard cases representable — a comparison with no verdict, or one that
 * favours different sides on different aspects, both of which occur constantly
 * in Trade Off answers.
 */
export type ComparativePreference = "SUBJECT" | "OBJECT" | "NEITHER" | "TIE" | "UNCLEAR";

export interface Comparison {
  subjectEntityId: string | null;
  subjectName: string;
  objectEntityId: string | null;
  objectName: string;
  /** What is being compared on, when the text names it. */
  aspect: string | null;
  /** The comparative expression itself ("lighter", "better cushioning"). */
  opinion: string | null;
  preference: ComparativePreference;
  evidence: Span;
  confidence: Confidence;
  /** The answer chose each side under its own condition or for its own purpose ("A if …, and B if …"): a deliberate no-winner, not a missing verdict. */
  split?: boolean;
}

// ---------------------------------------------------------------------------
// Position and rank — two different questions
// ---------------------------------------------------------------------------

/**
 * Coarse placement of the first mention within the response body.
 * Separate from rank because placement always exists and rank often does not.
 */
export type PositionBucket = "top" | "middle" | "bottom";

/**
 * Whether this response can carry a rank at all.
 *
 * The single most damaging thing this layer could do is turn prose order into
 * a ranking. "Nike, Adidas and ASICS are all worth considering" has an order
 * and no ranking; emitting rank=1 for Nike would manufacture a competitive
 * finding out of sentence structure.
 */
export type RankEligibility =
  | "explicit_ordered_list" // numbered, or "first… second…"
  | "ordered_prose" // "my top choice is X, then Y"
  | "not_rankable" // unordered set, or explicitly disclaimed as unranked
  | "single_option" // only one candidate offered
  | "no_options"; // nothing recommended

export interface PositionEvidence {
  entityId: string | null;
  name: string;
  /** Order of first textual appearance among linked entities, 1-based. */
  firstMentionOrder: number;
  positionBucket: PositionBucket;
  /** Only set when rankEligibility admits a rank. Null otherwise, always. */
  explicitRank: number | null;
  evidence: Span;
}

// ---------------------------------------------------------------------------
// Sentiment — ACOS-style quadruple
// ---------------------------------------------------------------------------

export type Polarity = "POSITIVE" | "NEGATIVE" | "MIXED" | "NEUTRAL" | "NO_SENTIMENT";

/**
 * One aspect-level opinion: (aspect expression, category, opinion, polarity).
 *
 * `aspectTerm` may be null for an implicit aspect — the ACOS formulation makes
 * that explicit, and AI answers use implicit aspects constantly ("Nike is
 * excellent" carries polarity with no aspect term at all).
 */
export interface AspectSentiment {
  entityId: string | null;
  entityName: string;
  aspectTerm: string | null;
  aspectCategory: string;
  opinionTerm: string | null;
  polarity: Polarity;
  evidence: Span;
  confidence: Confidence;
}

export interface EntitySentiment {
  entityId: string | null;
  entityName: string;
  /** Rolled up from aspects; NO_SENTIMENT when the text carries no opinion. */
  overallPortrayal: Polarity;
  aspects: AspectSentiment[];
}

// ---------------------------------------------------------------------------
// Citations
// ---------------------------------------------------------------------------

export type SourceOwnership = "TARGET_OWNED" | "COMPETITOR_OWNED" | "THIRD_PARTY" | "UNKNOWN";

export interface NormalizedCitation {
  url: string;
  /** Registrable domain, lowercased, without "www.". */
  domain: string;
  ownership: SourceOwnership;
  ownerEntityId: string | null;
  /**
   * Whether this domain's owner is ALSO named in the answer text. Keeping the
   * two apart is the point: a brand cited as a source has not necessarily been
   * mentioned to the reader.
   */
  ownerMentionedInText: boolean;
}

// ---------------------------------------------------------------------------
// Analysis eligibility
// ---------------------------------------------------------------------------

/**
 * Whether this observation may be aggregated, and if not, why.
 *
 * A failed capture must never reach Measure as "target absent" — that converts
 * a coverage gap into a competitive finding. This is the same principle the
 * Observe stage applies to source capture, enforced one layer further on.
 */
export type AnalysisEligibility =
  | "ELIGIBLE" // successfully captured and analysed
  | "NOT_CAPTURED" // observation never succeeded; says nothing about the brand
  | "NEEDS_REVIEW"; // analysed, but something material is uncertain

export interface AnalysisWarning {
  code: string;
  detail: string;
  span?: Span;
}

// ---------------------------------------------------------------------------
// The normalized observation
// ---------------------------------------------------------------------------

export interface NormalizedObservation {
  observationId: string; // provider_response id
  promptCandidateId: string;
  section: PromptSection | null;
  providerExperience: string;
  analysisVersion: string;
  analysedAt: number;
  eligibility: AnalysisEligibility;

  /** Hash of the exact text analysed, so drift is detectable. */
  sourceHash: string;

  occurrences: EntityOccurrence[];
  comparisons: Comparison[];
  positions: PositionEvidence[];
  rankEligibility: RankEligibility;
  sentiment: EntitySentiment[];
  citations: NormalizedCitation[];
  /**
   * The operator's source-capture assertion, carried forward from Observe.
   *
   * Measure needs this to build a citation denominator that excludes
   * observations whose sources were never captured. Without it, a capture gap
   * would look exactly like a provider that cited nothing.
   */
  sourceCaptureState: SourcesCaptureState;

  /** Brand-like strings that resolved to nothing known. Never a denominator. */
  emergingCandidates: Array<{ name: string; mentions: Span[]; role: OccurrenceRole }>;

  warnings: AnalysisWarning[];
  /** Set by a human correction; the machine result is kept beside it. */
  reviewedBy: string | null;
  supersedesAnalysisId: string | null;
}
