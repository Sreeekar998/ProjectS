// Measure result shapes.

import type { MetricKey } from "./policy";

/**
 * One metric value.
 *
 * `value` is null when the denominator is zero. That is not the same as 0% and
 * is never rendered as one: "no rank-eligible answers" and "never ranked first"
 * are different facts about the world.
 *
 * `contributingObservationIds` is what makes the number auditable — the drill-
 * down reads it directly rather than re-deriving which observations counted.
 */
export interface MetricValue {
  key: MetricKey;
  numerator: number;
  denominator: number;
  /** Proportion 0-1, or null when the denominator is zero. */
  value: number | null;
  numeratorObservationIds: string[];
  denominatorObservationIds: string[];
}

export type ProviderScope = "combined" | string;

export interface EntityPresence {
  entityId: string | null;
  name: string;
  relation: string;
  /** Observations in which this entity was present (response-level). */
  presenceEvents: number;
  observationIds: string[];
  /** Share of tracked presence events, 0-1. Null when nothing was tracked. */
  shareOfVoice: number | null;
  firstChoiceCount: number;
}

export type TradeOffOutcome = "TARGET_PREFERRED" | "COMPETITOR_PREFERRED" | "TIE" | "UNCLEAR" | "NO_COMPARISON";

export interface TradeOffResult {
  outcomes: Record<TradeOffOutcome, number>;
  observationIdsByOutcome: Record<TradeOffOutcome, string[]>;
  /** Per confirmed competitor: how the head-to-heads against the TARGET went. */
  byCompetitor: Array<{
    entityId: string | null;
    name: string;
    targetPreferred: number;
    competitorPreferred: number;
    undecided: number;
    observationIds: string[];
  }>;
}

export interface AspectTally {
  category: string;
  positive: number;
  negative: number;
  mixed: number;
  neutral: number;
  observationIds: string[];
}

export interface SentimentResult {
  /** Portrayal of the TARGET across eligible Sentiment observations. */
  distribution: Record<string, number>;
  observationIdsByPolarity: Record<string, string[]>;
  aspects: AspectTally[];
}

/**
 * What kind of site a source is. Ownership comes from the frozen competitive
 * set; every other kind is GUESSED from the address and labelled as such.
 */
export type SourceKind = "yours" | "rival" | "marketplace" | "community" | "reference" | "social_video" | "editorial" | "other";

export interface DomainRow {
  domain: string;
  ownership: string;
  ownerName: string | null;
  kind: SourceKind;
  /** Observations citing this domain at least once. */
  responsesCiting: number;
  /** Total cited URLs on this domain — a different unit from the above. */
  totalCitations: number;
  observationIds: string[];
  /** Observations citing this domain, by answer engine. */
  byEngine: Record<string, number>;
  /** Observations citing this domain, by prompt section. */
  bySection: Record<string, number>;
  /** Discovery answers citing this domain in which the target was NOT named. An answer-level fact only. */
  discoveryWithoutTarget: number;
  discoveryWithoutTargetIds: string[];
}

export interface UrlRow {
  url: string;
  domain: string;
  ownership: string;
  ownerName: string | null;
  kind: SourceKind;
  responsesCiting: number;
  observationIds: string[];
  byEngine: Record<string, number>;
  bySection: Record<string, number>;
  discoveryWithoutTarget: number;
}

export interface SourcesResult {
  domains: DomainRow[];
  urls: UrlRow[];
  /**
   * Each answer with trustworthy sources once, by whose site it cited: yours,
   * else a tracked rival's, else only third-party sites, else none. Absent in
   * snapshots written before measure-policy@4.
   */
  answerMix?: { yours: string[]; rivalNotYours: string[]; thirdPartyOnly: string[]; noSources: string[] };
  totals: {
    /** Analysable answers whose source capture is trustworthy (complete or confirmed none). */
    trustworthy: number;
    /** Of those, answers that showed at least one source. */
    withSources: number;
    /** Cited URLs, counted by volume. */
    citations: number;
    uniqueUrls: number;
    uniqueDomains: number;
  };
}

export interface CoverageResult {
  planned: number;
  captured: number;
  analysable: number;
  /** Captured but flagged NEEDS_REVIEW. */
  needsReview: number;
  /** Planned but never collected (failed, paused, not attempted). */
  notCollected: number;
  /** Collected, but no analysis row exists at any version (analysis failed). */
  awaitingAnalysis: number;
  byProvider: Record<string, { planned: number; captured: number; analysable: number }>;
  /** The same counts grouped by answer engine (ChatGPT, Gemini). */
  byEngine: Record<string, { planned: number; captured: number; analysable: number }>;
  sourceCaptureComplete: number;
}

export interface SectionScope {
  eligible: number;
  /** Observations excluded, with the reason, so nothing vanishes silently. */
  excluded: Array<{ reason: string; count: number }>;
}

export type PromptRowStatus = "analysable" | "needs_review" | "not_collected" | "awaiting_analysis";

/** One planned question on one engine, with every fact the analysis established about its answer. */
export interface PromptRow {
  promptCandidateId: string;
  text: string;
  section: string | null;
  topicId: string | null;
  topicName: string | null;
  engine: string;
  route: string;
  /** provider_response id when an answer was collected. */
  observationId: string | null;
  status: PromptRowStatus;
  /** Target named in the answer text (aggregatable occurrence). Null when not analysable. */
  targetNamed: boolean | null;
  /** Tracked brands named, in order of first mention. */
  brandsNamed: string[];
  /** Brand-like names outside the frozen set. */
  untrackedNamed: string[];
  targetRole: string | null;
  rankEligibility: string | null;
  /** The target's explicit rank, only on rank-eligible answers. */
  targetRank: number | null;
  /** Whoever holds explicit rank 1, tracked or not. */
  firstChoiceName: string | null;
  verdict: TradeOffOutcome | null;
  /** The rival the question named (Trade Offs), or the one compared in the answer. */
  rivalName: string | null;
  aspects: string[];
  portrayal: string | null;
  themes: Array<{ category: string; polarity: string }>;
  sourceState: string;
  sourceCount: number;
  /** Null when sources were not captured well enough to say. */
  ownedCited: boolean | null;
  rivalCited: boolean | null;
  citedDomains: string[];
  observedAt: number | null;
  model: string | null;
  country: string | null;
  searchState: string | null;
}

export interface BrandRow {
  entityId: string | null;
  name: string;
  relation: "target" | "confirmed_competitor" | "emerging";
  /** Discovery answers naming the brand (analysable). */
  discoveryNamed: number;
  discoveryEligible: number;
  discoveryObservationIds: string[];
  shareOfVoice: number | null;
  /** Explicit rank 1 on rank-eligible Discovery answers. */
  firstChoice: number;
  /** Rank-eligible Discovery answers where the brand holds an explicit rank. */
  rankedCount: number;
  averageRank: number | null;
  /** Head-to-head record against the target. Null for the target itself and for untracked brands. */
  headToHead: { won: number; lost: number; undecided: number; observationIds: string[] } | null;
  /** Analysable answers with trustworthy sources citing a domain this brand owns. */
  ownDomainsCited: number;
  ownDomainsCitedIds: string[];
  namedByEngine: Record<string, { named: number; eligible: number }>;
  /** Answers naming the brand in ANY section; untracked brands only have this. */
  namedAnywhere: number;
  namedAnywhereIds: string[];
}

export type OpportunityType =
  | "discovery_gap"
  | "tradeoff_loss"
  | "reputation_concern"
  | "source_gap"
  | "rival_source"
  | "owned_uncited"
  | "untracked_brand"
  | "coverage_gap";

export interface Opportunity {
  id: string;
  type: OpportunityType;
  title: string;
  /** One plain sentence with the counts. */
  detail: string;
  count: number;
  outOf: number | null;
  observationIds: string[];
  engines: string[];
  /** Breakdown behind the count: rivals named, aspects, themes, domains… */
  items: Array<{ label: string; count: number; observationIds: string[] }>;
  /**
   * Up to two verbatim sentences from the answers behind the finding, so a
   * card can quote the evidence rather than describe it. Absent in snapshots
   * written before 2026-09-15; readers treat a missing list as empty.
   */
  examples?: Array<{ observationId: string; text: string }>;
}

export interface MeasureLineage {
  promptSetId: string;
  promptSetVersion: number | null;
  competitiveSetVersionId: string | null;
  competitiveSetVersion: number | null;
  /** Where the competitive set came from: the prompt set's pinned version, or the latest as a legacy fallback. */
  competitiveSetSource: "pinned" | "latest_fallback" | "none";
  /** The single analysis version served, or "mixed" when stored rows differ. */
  analysisVersion: string;
  /** Every analysis version actually served, sorted. */
  analysisVersions: string[];
  /** The analyzer's current version. */
  currentAnalysisVersion: string;
  /** Captured answers whose served analysis is older than the current version. */
  staleAnalyses: number;
  metricPolicyVersion: string;
  providerExperiences: string[];
  /** Engines with at least one planned answer, sorted. */
  engines: string[];
  samplesPerPrompt: number;
  /** Observer countries the providers declared, sorted; "unknown" when a provider declared none. */
  observerRegions: string[];
  /** Models the page named, sorted. */
  models: string[];
}

export interface MeasureResult {
  projectId: string;
  collectionRunId: string;
  computedAt: number;

  /** Lineage — what this measurement is OF. Comparability depends on it. */
  lineage: MeasureLineage;

  coverage: CoverageResult;
  scopes: { discovery: SectionScope; tradeOffs: SectionScope; sentiment: SectionScope };

  /** Metrics per provider scope: "combined", then each provider. */
  metrics: Record<ProviderScope, Partial<Record<MetricKey, MetricValue>>>;

  presence: Record<ProviderScope, EntityPresence[]>;
  tradeOffs: Record<ProviderScope, TradeOffResult>;
  sentiment: Record<ProviderScope, SentimentResult>;
  /** Kept as the domain table; `sources` carries the URL grain and totals. */
  domains: DomainRow[];
  sources: SourcesResult;

  /** Untracked brands seen in answers. Never in any denominator. */
  emerging: Array<{ name: string; observations: number; observationIds: string[] }>;

  /**
   * Discovery presence by confirmed topic, with the business other than the
   * target named most often there (tracked or not). Counts, because N is tiny.
   * `targetIds` and `leaderCount` are absent in snapshots written before
   * measure-policy@4, whose leader counted tracked brands only.
   */
  byTopic: Array<{ topicId: string | null; topicName: string; eligible: number; targetPresent: number; targetIds?: string[]; leaderName: string | null; leaderCount?: number }>;

  /**
   * Discovery presence by the place the question named ("in Dubai", "in
   * DIFC"), with the business named most often in those answers, tracked or
   * not. Absent in snapshots written before measure-policy@3.
   */
  byPlace?: Array<{ place: string | null; eligible: number; targetPresent: number; targetIds: string[]; leaderName: string | null; leaderCount: number }>;

  prompts: PromptRow[];
  brands: BrandRow[];
  opportunities: Opportunity[];
}
