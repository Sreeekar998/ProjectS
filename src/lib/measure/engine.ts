// The measurement engine.
//
// Deterministic and pure: given the same normalized observations, the same
// frozen competitive set and the same policy version, it returns the same
// numbers. No model is consulted; every value is a counted ratio whose
// numerator, denominator and contributing observation ids are all returned so
// the dashboard can show its working.
//
// Two rules run through everything:
//   1. Sections are never blended. Discovery, Trade Offs and Sentiment measure
//      different constructs, and a brand named in the QUESTION is not evidence
//      that the assistant volunteered it.
//   2. Missing evidence is excluded, never counted as a zero. A failed capture
//      is missing coverage; "the provider showed no sources" is a finding.

import { engineOf } from "@/lib/providers/engines";
import type { NormalizedObservation } from "@/lib/analysis/types";
import { AGGREGATABLE_CONFIDENCE } from "@/lib/analysis/types";
import { METRIC_POLICY_VERSION, type MetricKey } from "./policy";
import { guessSourceKind } from "./source-kind";
import type {
  AspectTally,
  BrandRow,
  CoverageResult,
  DomainRow,
  EntityPresence,
  MeasureLineage,
  MeasureResult,
  MetricValue,
  Opportunity,
  PromptRow,
  SectionScope,
  SentimentResult,
  SourcesResult,
  TradeOffOutcome,
  TradeOffResult,
  UrlRow,
} from "./types";

export interface PromptInfo {
  id: string;
  text: string;
  section: string | null;
  topicId: string | null;
  /** The rival a Trade Off question names, when it names one. */
  competitorEntityId: string | null;
  /** The place the question names ("Dubai", "DIFC"), when it names one. */
  place?: string | null;
}

export interface ObservationProvenance {
  observedAt: number | null;
  model: string | null;
  country: string | null;
  searchState: string | null;
}

export interface EngineInput {
  projectId: string;
  collectionRunId: string;
  /** Every analysis for the run, including NOT_CAPTURED ones. */
  analyses: NormalizedObservation[];
  /** Planned observation count = prompts x providers x samples. */
  plannedCount: number;
  plannedByProvider: Record<string, number>;
  /** The FROZEN competitive set. Controls every denominator. */
  targetEntityId: string;
  targetName: string;
  competitors: Array<{ entityId: string; name: string }>;
  topics: Array<{ id: string; name: string }>;
  /** Maps prompt candidate id -> topic id, for the topic breakdown. */
  topicByPrompt: Map<string, string | null>;
  /** The planned questions, for the prompt table. Optional so older callers still work. */
  prompts?: Map<string, PromptInfo>;
  /** Per captured observation: when, which model, from where. */
  provenance?: Map<string, ObservationProvenance>;
  lineage: Omit<MeasureLineage, "metricPolicyVersion" | "engines" | "observerRegions" | "models"> &
    Partial<Pick<MeasureLineage, "metricPolicyVersion" | "engines" | "observerRegions" | "models">>;
}

const EMPTY_OUTCOMES: Record<TradeOffOutcome, number> = {
  TARGET_PREFERRED: 0,
  COMPETITOR_PREFERRED: 0,
  TIE: 0,
  UNCLEAR: 0,
  NO_COMPARISON: 0,
};

const RANKABLE = ["explicit_ordered_list", "ordered_prose"];

function metric(key: MetricKey, numerator: string[], denominator: string[]): MetricValue {
  // A zero denominator yields null, never 0. "No rank-eligible answers" and
  // "never ranked first" are different facts and must not render alike.
  const value = denominator.length === 0 ? null : numerator.length / denominator.length;
  return {
    key,
    numerator: numerator.length,
    denominator: denominator.length,
    value,
    numeratorObservationIds: numerator,
    denominatorObservationIds: denominator,
  };
}

/**
 * Whether an analysis may contribute to aggregation at all.
 *
 * NOT_CAPTURED never can — that is operational missingness. NEEDS_REVIEW is
 * also excluded from headline metrics: an analysis the parser itself flagged
 * as uncertain should not quietly become a brand fact. Both remain visible in
 * coverage so the exclusion is legible rather than silent.
 */
function isAggregatable(analysis: NormalizedObservation): boolean {
  return analysis.eligibility === "ELIGIBLE";
}

/** A collected answer whose analysis never ran, as opposed to one never collected. */
function isAwaitingAnalysis(analysis: NormalizedObservation): boolean {
  return analysis.eligibility === "NOT_CAPTURED" && analysis.warnings.some((w) => w.code === "analysis_missing");
}

/** Response-level presence: does this entity appear in the answer text? */
function presentEntityIds(analysis: NormalizedObservation): Set<string> {
  const ids = new Set<string>();
  for (const occurrence of analysis.occurrences) {
    if (!occurrence.entityId) continue;
    // A weak surface match is not strong enough to count as brand presence;
    // counting it would inflate visibility on ambiguous name collisions.
    if (!AGGREGATABLE_CONFIDENCE.includes(occurrence.confidence)) continue;
    ids.add(occurrence.entityId);
  }
  return ids;
}

/**
 * One untracked business however an answer capitalised or punctuated it:
 * "ALKEMY Salons" and "Alkemy Salons", "It's Beauty" and "Its Beauty" are one
 * salon. Counted as two, a DIFC salon's list split its most-named rivals
 * (measure-policy@4).
 */
export function businessKey(name: string): string {
  return name
    .toLowerCase()
    .replace(/['’]/g, "")
    .replace(/\s+&\s+/g, " and ")
    .replace(/[^a-z0-9&]+/g, " ")
    .trim();
}

/**
 * Every business an answer named, tracked or not, keyed so each counts once:
 * tracked entities by id, untracked businesses by `businessKey`. Untracked
 * names are the analysis's emerging candidates, which are kept only when the
 * answer offered them as options.
 */
function businessesNamed(analysis: NormalizedObservation, trackedIds: Set<string>, nameById: Map<string, string>): Map<string, string> {
  const named = new Map<string, string>();
  for (const id of presentEntityIds(analysis)) {
    if (trackedIds.has(id)) named.set(`id:${id}`, nameById.get(id) ?? id);
  }
  for (const candidate of analysis.emergingCandidates) {
    const key = `name:${businessKey(candidate.name)}`;
    if (!named.has(key)) named.set(key, candidate.name);
  }
  return named;
}

/**
 * The written form to show for each untracked business: the one the answers
 * used most often, the earliest on a tie.
 */
function displayNames(analyses: NormalizedObservation[]): Map<string, string> {
  const counts = new Map<string, Map<string, number>>();
  for (const analysis of analyses) {
    for (const candidate of analysis.emergingCandidates) {
      const key = businessKey(candidate.name);
      const forms = counts.get(key) ?? new Map<string, number>();
      forms.set(candidate.name, (forms.get(candidate.name) ?? 0) + 1);
      counts.set(key, forms);
    }
  }
  const out = new Map<string, string>();
  for (const [key, forms] of counts) out.set(key, [...forms.entries()].sort((a, b) => b[1] - a[1])[0]![0]);
  return out;
}

function unique<T>(values: T[]): T[] {
  return [...new Set(values)];
}

function sortedKeys(record: Record<string, number>): Record<string, number> {
  return Object.fromEntries(Object.entries(record).sort(([a], [b]) => a.localeCompare(b)));
}

export function computeMeasure(input: EngineInput): MeasureResult {
  const { analyses } = input;
  const providers = [...new Set(analyses.map((a) => a.providerExperience))].sort();
  // Reported by answer engine, not by collection route: an answer asked by
  // hand in the Gemini app and one collected automatically from Gemini are
  // both evidence about Gemini. Routes stay visible in coverage.
  const engines = [...new Set(analyses.map((a) => engineOf(a.providerExperience)))].sort();
  const scopes = ["combined", ...engines];

  const coverage = buildCoverage(input, providers);
  const aggregatable = analyses.filter(isAggregatable);
  const provenance = input.provenance ?? new Map();

  const result: MeasureResult = {
    projectId: input.projectId,
    collectionRunId: input.collectionRunId,
    computedAt: Date.now(),
    lineage: {
      ...input.lineage,
      metricPolicyVersion: METRIC_POLICY_VERSION,
      engines: input.lineage.engines ?? engines,
      observerRegions: input.lineage.observerRegions ?? unique([...provenance.values()].map((p) => p.country ?? "unknown")).sort(),
      models: input.lineage.models ?? unique([...provenance.values()].map((p) => p.model).filter((m): m is string => Boolean(m && m !== "unknown"))).sort(),
    },
    coverage,
    scopes: {
      discovery: sectionScope(analyses, "Discovery"),
      tradeOffs: sectionScope(analyses, "Trade Offs"),
      sentiment: sectionScope(analyses, "Sentiment Analysis"),
    },
    metrics: {},
    presence: {},
    tradeOffs: {},
    sentiment: {},
    domains: [],
    sources: { domains: [], urls: [], answerMix: { yours: [], rivalNotYours: [], thirdPartyOnly: [], noSources: [] }, totals: { trustworthy: 0, withSources: 0, citations: 0, uniqueUrls: 0, uniqueDomains: 0 } },
    emerging: buildEmerging(aggregatable),
    byTopic: [],
    prompts: [],
    brands: [],
    opportunities: [],
  };

  for (const scope of scopes) {
    const scoped = analyses.filter((a) => (scope === "combined" ? true : engineOf(a.providerExperience) === scope));
    result.metrics[scope] = buildMetrics(scoped, input);
    result.presence[scope] = buildPresence(scoped, input);
    result.tradeOffs[scope] = buildTradeOffs(scoped, input);
    result.sentiment[scope] = buildSentiment(scoped, input);
  }

  result.sources = buildSources(aggregatable, input);
  result.domains = result.sources.domains;
  result.byTopic = buildTopics(analyses, input);
  result.byPlace = buildPlaces(analyses, input);
  result.prompts = buildPromptRows(analyses, input);
  result.brands = buildBrands(aggregatable, input, result.tradeOffs.combined!);
  result.opportunities = buildOpportunities(analyses, input, result);
  return result;
}

// ---------------------------------------------------------------------------
// Coverage
// ---------------------------------------------------------------------------

/** A collected answer, whether or not its analysis ran. */
function isCaptured(analysis: NormalizedObservation): boolean {
  return analysis.eligibility !== "NOT_CAPTURED" || isAwaitingAnalysis(analysis);
}

function buildCoverage(input: EngineInput, providers: string[]): CoverageResult {
  // "Captured" is what was collected; an answer whose analysis never ran is
  // captured and awaiting analysis, not missing. Every metric still treats
  // it as NOT_CAPTURED, because it carries no evidence yet.
  const captured = input.analyses.filter(isCaptured);
  const byProvider: CoverageResult["byProvider"] = {};
  for (const provider of providers) {
    const rows = input.analyses.filter((a) => a.providerExperience === provider);
    byProvider[provider] = {
      planned: input.plannedByProvider[provider] ?? rows.length,
      captured: rows.filter(isCaptured).length,
      analysable: rows.filter(isAggregatable).length,
    };
  }
  const byEngine: CoverageResult["byEngine"] = {};
  for (const [provider, counts] of Object.entries(byProvider)) {
    const engine = engineOf(provider);
    const total = byEngine[engine] ?? { planned: 0, captured: 0, analysable: 0 };
    byEngine[engine] = { planned: total.planned + counts.planned, captured: total.captured + counts.captured, analysable: total.analysable + counts.analysable };
  }
  const awaitingAnalysis = input.analyses.filter(isAwaitingAnalysis).length;
  return {
    planned: input.plannedCount,
    captured: captured.length,
    analysable: input.analyses.filter(isAggregatable).length,
    needsReview: input.analyses.filter((a) => a.eligibility === "NEEDS_REVIEW").length,
    notCollected: input.analyses.filter((a) => !isCaptured(a)).length,
    awaitingAnalysis,
    byProvider,
    byEngine,
    sourceCaptureComplete: captured.filter((a) => a.eligibility !== "NOT_CAPTURED" && hasTrustworthySources(a)).length,
  };
}

/**
 * Source capture solid enough to measure citations from.
 *
 * "complete" and "none_present" both qualify: one says we saw every source,
 * the other says the operator looked and there were none. "not_captured" and
 * "partial" do not — excluding them is what stops missing evidence becoming a
 * zero citation rate.
 */
function hasTrustworthySources(analysis: NormalizedObservation): boolean {
  return analysis.sourceCaptureState === "complete" || analysis.sourceCaptureState === "none_present";
}

function sectionScope(analyses: NormalizedObservation[], section: string): SectionScope {
  const inSection = analyses.filter((a) => a.section === section);
  const eligible = inSection.filter(isAggregatable);
  const excluded: SectionScope["excluded"] = [];
  const awaiting = inSection.filter(isAwaitingAnalysis).length;
  const notCaptured = inSection.filter((a) => a.eligibility === "NOT_CAPTURED").length - awaiting;
  const needsReview = inSection.filter((a) => a.eligibility === "NEEDS_REVIEW").length;
  if (notCaptured > 0) excluded.push({ reason: "not captured", count: notCaptured });
  if (awaiting > 0) excluded.push({ reason: "awaiting analysis", count: awaiting });
  if (needsReview > 0) excluded.push({ reason: "analysis uncertain", count: needsReview });
  return { eligible: eligible.length, excluded };
}

// ---------------------------------------------------------------------------
// Metrics
// ---------------------------------------------------------------------------

function buildMetrics(analyses: NormalizedObservation[], input: EngineInput): Partial<Record<MetricKey, MetricValue>> {
  const discovery = analyses.filter((a) => a.section === "Discovery" && isAggregatable(a));
  const trackedIds = new Set([input.targetEntityId, ...input.competitors.map((c) => c.entityId)]);

  const nameById = new Map<string, string>([[input.targetEntityId, input.targetName], ...input.competitors.map((c) => [c.entityId, c.name] as [string, string])]);
  const discoveryIds = discovery.map((a) => a.observationId);
  const targetPresent = discovery.filter((a) => presentEntityIds(a).has(input.targetEntityId));
  // An answer that named no business at all, tracked or not: general advice
  // with nobody recommended. Counting "no TRACKED brand" instead called an
  // answer listing six untracked salons brand-free (measure-policy@4).
  const brandFree = discovery.filter((a) => businessesNamed(a, trackedIds, nameById).size === 0);

  // Rank eligibility comes from the analysis layer, which already refuses to
  // rank an unordered list. Prose order never becomes a first choice here.
  const rankEligible = discovery.filter((a) => RANKABLE.includes(a.rankEligibility));
  const targetFirst = rankEligible.filter((a) =>
    a.positions.some((p) => p.entityId === input.targetEntityId && p.explicitRank === 1),
  );

  const tradeOff = analyses.filter((a) => a.section === "Trade Offs" && isAggregatable(a));
  // Only comparisons that involve the target count, the same rule the verdict
  // distribution uses: an answer that compares two rivals with each other is
  // "didn't compare them" there and cannot sit in this denominator.
  const withComparison = tradeOff.filter((a) => targetComparisons(a, input).length > 0);
  const decisive = withComparison.filter((a) => outcomeOf(a, input) === "TARGET_PREFERRED" || outcomeOf(a, input) === "COMPETITOR_PREFERRED");
  const targetWins = withComparison.filter((a) => outcomeOf(a, input) === "TARGET_PREFERRED");

  const captureComplete = analyses.filter((a) => isAggregatable(a) && hasTrustworthySources(a));
  const citesOwned = captureComplete.filter((a) => a.citations.some((c) => c.ownership === "TARGET_OWNED"));
  // Answers that actually displayed a source. Reported alongside the wider
  // rate because the two answer different questions: the all-answers rate is
  // pulled down by every answer that cites nothing at all, and the sourced-only
  // rate cannot see that effect.
  const sourced = captureComplete.filter((a) => a.citations.length > 0);

  const metrics: Partial<Record<MetricKey, MetricValue>> = {
    discovery_visibility: metric("discovery_visibility", targetPresent.map((a) => a.observationId), discoveryIds),
    answer_brand_free_rate: metric("answer_brand_free_rate", brandFree.map((a) => a.observationId), discoveryIds),
    first_choice_rate: metric("first_choice_rate", targetFirst.map((a) => a.observationId), rankEligible.map((a) => a.observationId)),
    tradeoff_decisiveness: metric("tradeoff_decisiveness", decisive.map((a) => a.observationId), withComparison.map((a) => a.observationId)),
    tradeoff_target_win_rate: metric("tradeoff_target_win_rate", targetWins.map((a) => a.observationId), decisive.map((a) => a.observationId)),
    owned_citation_rate: metric("owned_citation_rate", citesOwned.map((a) => a.observationId), captureComplete.map((a) => a.observationId)),
    owned_citation_rate_when_sourced: metric("owned_citation_rate_when_sourced", citesOwned.map((a) => a.observationId), sourced.map((a) => a.observationId)),
  };

  // Share of voice counts presence EVENTS, not observations, so it gets its
  // numerator and denominator directly rather than through the id helper.
  let targetEvents = 0;
  let trackedEvents = 0;
  const sovObservations: string[] = [];
  for (const analysis of discovery) {
    const present = presentEntityIds(analysis);
    let contributed = false;
    for (const id of present) {
      if (!trackedIds.has(id)) continue;
      trackedEvents += 1;
      contributed = true;
      if (id === input.targetEntityId) targetEvents += 1;
    }
    if (contributed) sovObservations.push(analysis.observationId);
  }
  metrics.discovery_share_of_voice = {
    key: "discovery_share_of_voice",
    numerator: targetEvents,
    denominator: trackedEvents,
    value: trackedEvents === 0 ? null : targetEvents / trackedEvents,
    numeratorObservationIds: targetPresent.map((a) => a.observationId),
    denominatorObservationIds: sovObservations,
  };

  // Share of every business named: the same presence events, but untracked
  // businesses count too. Share of voice alone read 88% for a salon whose
  // answers named 27 businesses; this is its share of the whole answer.
  let allEvents = 0;
  const allObservations: string[] = [];
  for (const analysis of discovery) {
    const named = businessesNamed(analysis, trackedIds, nameById);
    if (named.size === 0) continue;
    allEvents += named.size;
    allObservations.push(analysis.observationId);
  }
  metrics.discovery_share_all_names = {
    key: "discovery_share_all_names",
    numerator: targetEvents,
    denominator: allEvents,
    value: allEvents === 0 ? null : targetEvents / allEvents,
    numeratorObservationIds: targetPresent.map((a) => a.observationId),
    denominatorObservationIds: allObservations,
  };

  // Citation share counts URLs, a different unit again.
  let ownedUrls = 0;
  let trackedUrls = 0;
  for (const analysis of captureComplete) {
    for (const citation of analysis.citations) {
      if (citation.ownership === "TARGET_OWNED") {
        ownedUrls += 1;
        trackedUrls += 1;
      } else if (citation.ownership === "COMPETITOR_OWNED") {
        trackedUrls += 1;
      }
    }
  }
  metrics.citation_share = {
    key: "citation_share",
    numerator: ownedUrls,
    denominator: trackedUrls,
    value: trackedUrls === 0 ? null : ownedUrls / trackedUrls,
    numeratorObservationIds: citesOwned.map((a) => a.observationId),
    denominatorObservationIds: captureComplete.map((a) => a.observationId),
  };

  return metrics;
}

// ---------------------------------------------------------------------------
// Presence / share of voice per entity
// ---------------------------------------------------------------------------

function buildPresence(analyses: NormalizedObservation[], input: EngineInput): EntityPresence[] {
  const discovery = analyses.filter((a) => a.section === "Discovery" && isAggregatable(a));
  const tracked = [
    { entityId: input.targetEntityId, name: input.targetName, relation: "target" },
    ...input.competitors.map((c) => ({ entityId: c.entityId, name: c.name, relation: "confirmed_competitor" })),
  ];

  const rows = tracked.map((entity) => {
    const observationIds: string[] = [];
    let firstChoiceCount = 0;
    for (const analysis of discovery) {
      if (!presentEntityIds(analysis).has(entity.entityId)) continue;
      observationIds.push(analysis.observationId);
      if (RANKABLE.includes(analysis.rankEligibility) && analysis.positions.some((p) => p.entityId === entity.entityId && p.explicitRank === 1)) {
        firstChoiceCount += 1;
      }
    }
    return { ...entity, presenceEvents: observationIds.length, observationIds, shareOfVoice: null as number | null, firstChoiceCount };
  });

  const total = rows.reduce((sum, row) => sum + row.presenceEvents, 0);
  for (const row of rows) row.shareOfVoice = total === 0 ? null : row.presenceEvents / total;
  return rows.sort((a, b) => b.presenceEvents - a.presenceEvents);
}

// ---------------------------------------------------------------------------
// Trade Offs
// ---------------------------------------------------------------------------

/** Comparisons in which the target is one side. Rival-vs-rival comparisons say nothing about the target. */
function targetComparisons(analysis: NormalizedObservation, input: EngineInput) {
  return analysis.comparisons.filter((c) => c.subjectEntityId === input.targetEntityId || c.objectEntityId === input.targetEntityId);
}

/**
 * The decision a head-to-head answer reached, from the target's point of view.
 *
 * The analysis layer records preference as SUBJECT/OBJECT relative to whichever
 * entity it saw first, so this translates that into target-relative terms.
 */
function outcomeOf(analysis: NormalizedObservation, input: EngineInput): TradeOffOutcome {
  const relevant = targetComparisons(analysis, input);
  if (relevant.length === 0) return "NO_COMPARISON";

  const verdicts = relevant.map((comparison) => {
    const targetIsSubject = comparison.subjectEntityId === input.targetEntityId;
    if (comparison.preference === "TIE") return "TIE";
    if (comparison.preference === "UNCLEAR" || comparison.preference === "NEITHER") return "UNCLEAR";
    const targetWon = (comparison.preference === "SUBJECT") === targetIsSubject;
    return targetWon ? "TARGET_PREFERRED" : "COMPETITOR_PREFERRED";
  });

  // An answer favouring the target on one aspect and the competitor on another
  // is a tie at the level of the decision, not a win for whichever came first.
  const set = new Set(verdicts);
  if (set.has("TARGET_PREFERRED") && set.has("COMPETITOR_PREFERRED")) return "TIE";
  if (set.has("TARGET_PREFERRED")) return "TARGET_PREFERRED";
  if (set.has("COMPETITOR_PREFERRED")) return "COMPETITOR_PREFERRED";
  if (set.has("TIE")) return "TIE";
  return "UNCLEAR";
}

function buildTradeOffs(analyses: NormalizedObservation[], input: EngineInput): TradeOffResult {
  const tradeOff = analyses.filter((a) => a.section === "Trade Offs" && isAggregatable(a));
  const outcomes = { ...EMPTY_OUTCOMES };
  const observationIdsByOutcome: Record<TradeOffOutcome, string[]> = {
    TARGET_PREFERRED: [], COMPETITOR_PREFERRED: [], TIE: [], UNCLEAR: [], NO_COMPARISON: [],
  };

  const byCompetitor = new Map<string, TradeOffResult["byCompetitor"][number]>();
  for (const competitor of input.competitors) {
    byCompetitor.set(competitor.entityId, {
      entityId: competitor.entityId, name: competitor.name,
      targetPreferred: 0, competitorPreferred: 0, undecided: 0, observationIds: [],
    });
  }

  for (const analysis of tradeOff) {
    const outcome = outcomeOf(analysis, input);
    outcomes[outcome] += 1;
    observationIdsByOutcome[outcome].push(analysis.observationId);

    // Only comparisons that involve the target are booked against a rival: a
    // comparison between two rivals used to land in the subject rival's row
    // carrying the answer's target outcome, which it had nothing to do with.
    for (const comparison of targetComparisons(analysis, input)) {
      const otherId = comparison.subjectEntityId === input.targetEntityId ? comparison.objectEntityId : comparison.subjectEntityId;
      const row = otherId ? byCompetitor.get(otherId) : undefined;
      if (!row) continue;
      if (row.observationIds.includes(analysis.observationId)) continue;
      row.observationIds.push(analysis.observationId);
      if (outcome === "TARGET_PREFERRED") row.targetPreferred += 1;
      else if (outcome === "COMPETITOR_PREFERRED") row.competitorPreferred += 1;
      else row.undecided += 1;
    }
  }

  return { outcomes, observationIdsByOutcome, byCompetitor: [...byCompetitor.values()] };
}

// ---------------------------------------------------------------------------
// Sentiment
// ---------------------------------------------------------------------------

function buildSentiment(analyses: NormalizedObservation[], input: EngineInput): SentimentResult {
  const sentimentSection = analyses.filter((a) => a.section === "Sentiment Analysis" && isAggregatable(a));
  const distribution: Record<string, number> = { POSITIVE: 0, MIXED: 0, NEUTRAL: 0, NEGATIVE: 0, NO_SENTIMENT: 0 };
  const observationIdsByPolarity: Record<string, string[]> = { POSITIVE: [], MIXED: [], NEUTRAL: [], NEGATIVE: [], NO_SENTIMENT: [] };
  const aspectMap = new Map<string, AspectTally>();

  for (const analysis of sentimentSection) {
    const targetSentiment = analysis.sentiment.find((s) => s.entityId === input.targetEntityId);
    // No sentiment evidence stays NO_SENTIMENT. It never becomes positive.
    const polarity = targetSentiment?.overallPortrayal ?? "NO_SENTIMENT";
    distribution[polarity] = (distribution[polarity] ?? 0) + 1;
    (observationIdsByPolarity[polarity] ??= []).push(analysis.observationId);

    for (const aspect of targetSentiment?.aspects ?? []) {
      const tally = aspectMap.get(aspect.aspectCategory) ?? {
        category: aspect.aspectCategory, positive: 0, negative: 0, mixed: 0, neutral: 0, observationIds: [],
      };
      if (aspect.polarity === "POSITIVE") tally.positive += 1;
      else if (aspect.polarity === "NEGATIVE") tally.negative += 1;
      else if (aspect.polarity === "MIXED") tally.mixed += 1;
      else tally.neutral += 1;
      if (!tally.observationIds.includes(analysis.observationId)) tally.observationIds.push(analysis.observationId);
      aspectMap.set(aspect.aspectCategory, tally);
    }
  }

  const aspects = [...aspectMap.values()].sort(
    (a, b) => b.positive + b.negative + b.mixed + b.neutral - (a.positive + a.negative + a.mixed + a.neutral),
  );
  return { distribution, observationIdsByPolarity, aspects };
}

// ---------------------------------------------------------------------------
// Sources: domains and URLs
// ---------------------------------------------------------------------------

function buildSources(analyses: NormalizedObservation[], input: EngineInput): SourcesResult {
  const nameById = new Map<string, string>([
    [input.targetEntityId, input.targetName],
    ...input.competitors.map((c) => [c.entityId, c.name] as [string, string]),
  ]);
  const trustworthy = analyses.filter(hasTrustworthySources);
  const domains = new Map<string, DomainRow & { urls: Set<string> }>();
  const urls = new Map<string, UrlRow>();
  let citations = 0;

  for (const analysis of trustworthy) {
    const engine = engineOf(analysis.providerExperience);
    const section = analysis.section ?? "unknown";
    const discoveryAbsent = analysis.section === "Discovery" && !presentEntityIds(analysis).has(input.targetEntityId);
    const seenUrls = new Set<string>();
    for (const citation of analysis.citations) {
      if (!citation.domain) continue;
      citations += 1;
      const ownerName = citation.ownerEntityId ? (nameById.get(citation.ownerEntityId) ?? null) : null;
      const domain = domains.get(citation.domain) ?? {
        domain: citation.domain, ownership: citation.ownership, ownerName, kind: "other" as const,
        responsesCiting: 0, totalCitations: 0, observationIds: [], byEngine: {}, bySection: {},
        discoveryWithoutTarget: 0, discoveryWithoutTargetIds: [], urls: new Set<string>(),
      };
      domain.totalCitations += 1;
      domain.urls.add(citation.url);
      if (!domain.observationIds.includes(analysis.observationId)) {
        domain.observationIds.push(analysis.observationId);
        domain.responsesCiting += 1;
        domain.byEngine[engine] = (domain.byEngine[engine] ?? 0) + 1;
        domain.bySection[section] = (domain.bySection[section] ?? 0) + 1;
        if (discoveryAbsent) {
          domain.discoveryWithoutTarget += 1;
          domain.discoveryWithoutTargetIds.push(analysis.observationId);
        }
      }
      domains.set(citation.domain, domain);

      if (seenUrls.has(citation.url)) continue;
      seenUrls.add(citation.url);
      const url = urls.get(citation.url) ?? {
        url: citation.url, domain: citation.domain, ownership: citation.ownership, ownerName, kind: "other" as const,
        responsesCiting: 0, observationIds: [], byEngine: {}, bySection: {}, discoveryWithoutTarget: 0,
      };
      url.responsesCiting += 1;
      url.observationIds.push(analysis.observationId);
      url.byEngine[engine] = (url.byEngine[engine] ?? 0) + 1;
      url.bySection[section] = (url.bySection[section] ?? 0) + 1;
      if (discoveryAbsent) url.discoveryWithoutTarget += 1;
      urls.set(citation.url, url);
    }
  }

  const domainRows: DomainRow[] = [...domains.values()]
    .map(({ urls: domainUrls, ...row }) => ({ ...row, kind: guessSourceKind(row.domain, [...domainUrls], row.ownership), byEngine: sortedKeys(row.byEngine), bySection: sortedKeys(row.bySection) }))
    .sort((a, b) => b.responsesCiting - a.responsesCiting || b.totalCitations - a.totalCitations || a.domain.localeCompare(b.domain));
  const kindByDomain = new Map(domainRows.map((row) => [row.domain, row.kind]));
  const urlRows: UrlRow[] = [...urls.values()]
    .map((row) => ({ ...row, kind: kindByDomain.get(row.domain) ?? row.kind, byEngine: sortedKeys(row.byEngine), bySection: sortedKeys(row.bySection) }))
    .sort((a, b) => b.responsesCiting - a.responsesCiting || a.url.localeCompare(b.url));

  // Each answer once, by whose site it cited: yours, else a tracked rival's,
  // else only third-party sites, else none. The older "by whose site" bar
  // summed answers per site, so one answer citing three directories counted
  // three times and the bar's 89% had no denominator a reader could check
  // (measure-policy@4).
  const answerMix = { yours: [] as string[], rivalNotYours: [] as string[], thirdPartyOnly: [] as string[], noSources: [] as string[] };
  for (const analysis of trustworthy) {
    const owners = new Set(analysis.citations.filter((citation) => citation.domain).map((citation) => citation.ownership));
    if (owners.has("TARGET_OWNED")) answerMix.yours.push(analysis.observationId);
    else if (owners.has("COMPETITOR_OWNED")) answerMix.rivalNotYours.push(analysis.observationId);
    else if (owners.size > 0) answerMix.thirdPartyOnly.push(analysis.observationId);
    else answerMix.noSources.push(analysis.observationId);
  }

  return {
    domains: domainRows,
    urls: urlRows,
    answerMix,
    totals: {
      trustworthy: trustworthy.length,
      withSources: trustworthy.filter((a) => a.citations.length > 0).length,
      citations,
      uniqueUrls: urlRows.length,
      uniqueDomains: domainRows.length,
    },
  };
}

// ---------------------------------------------------------------------------
// Emerging entities, topics
// ---------------------------------------------------------------------------

function buildEmerging(analyses: NormalizedObservation[]): MeasureResult["emerging"] {
  const shown = displayNames(analyses);
  const map = new Map<string, { name: string; observations: number; observationIds: string[] }>();
  for (const analysis of analyses) {
    for (const candidate of analysis.emergingCandidates) {
      const key = businessKey(candidate.name);
      const row = map.get(key) ?? { name: shown.get(key) ?? candidate.name, observations: 0, observationIds: [] };
      if (!row.observationIds.includes(analysis.observationId)) {
        row.observationIds.push(analysis.observationId);
        row.observations += 1;
      }
      map.set(key, row);
    }
  }
  return [...map.values()].sort((a, b) => b.observations - a.observations || a.name.localeCompare(b.name));
}

/**
 * The business other than the target named in the most answers of a group,
 * tracked or not. Topics used to look at tracked brands only while places
 * counted every business, so the same answers named a different leader in
 * two panels side by side (measure-policy@4).
 */
function leaderOf(rows: NormalizedObservation[], input: EngineInput, trackedIds: Set<string>, nameById: Map<string, string>, shown: Map<string, string>): { name: string; count: number } | null {
  const counts = new Map<string, { name: string; count: number }>();
  for (const analysis of rows) {
    for (const [key, name] of businessesNamed(analysis, trackedIds, nameById)) {
      if (key === `id:${input.targetEntityId}`) continue;
      const entry = counts.get(key) ?? { name: key.startsWith("name:") ? (shown.get(key.slice(5)) ?? name) : name, count: 0 };
      entry.count += 1;
      counts.set(key, entry);
    }
  }
  return [...counts.values()].sort((a, b) => b.count - a.count || a.name.localeCompare(b.name))[0] ?? null;
}

function buildTopics(analyses: NormalizedObservation[], input: EngineInput): MeasureResult["byTopic"] {
  const discovery = analyses.filter((a) => a.section === "Discovery" && isAggregatable(a));
  const trackedIds = new Set([input.targetEntityId, ...input.competitors.map((c) => c.entityId)]);
  const nameById = new Map<string, string>([[input.targetEntityId, input.targetName], ...input.competitors.map((c) => [c.entityId, c.name] as [string, string])]);
  const shown = displayNames(discovery);
  return input.topics.map((topic) => {
    const inTopic = discovery.filter((a) => input.topicByPrompt.get(a.promptCandidateId) === topic.id);
    const present = inTopic.filter((a) => presentEntityIds(a).has(input.targetEntityId));
    const leader = leaderOf(inTopic, input, trackedIds, nameById, shown);
    return {
      topicId: topic.id,
      topicName: topic.name,
      eligible: inTopic.length,
      targetPresent: present.length,
      targetIds: present.map((a) => a.observationId),
      leaderName: leader?.name ?? null,
      leaderCount: leader?.count ?? 0,
    };
  });
}

/**
 * Discovery presence by the place the question named. A single-location
 * salon was named in every DIFC question and in no question naming the block
 * on its own address (2026-09-18); a place breakdown makes that readable
 * without reading the question table.
 */
function buildPlaces(analyses: NormalizedObservation[], input: EngineInput): NonNullable<MeasureResult["byPlace"]> {
  const discovery = analyses.filter((a) => a.section === "Discovery" && isAggregatable(a));
  const prompts = input.prompts ?? new Map<string, PromptInfo>();
  const trackedIds = new Set([input.targetEntityId, ...input.competitors.map((c) => c.entityId)]);
  const nameById = new Map<string, string>([[input.targetEntityId, input.targetName], ...input.competitors.map((c) => [c.entityId, c.name] as [string, string])]);
  const shown = displayNames(discovery);
  const groups = new Map<string, NormalizedObservation[]>();
  for (const analysis of discovery) {
    const place = prompts.get(analysis.promptCandidateId)?.place?.trim() || "";
    groups.set(place, [...(groups.get(place) ?? []), analysis]);
  }
  return [...groups.entries()]
    .map(([place, rows]) => {
      const present = rows.filter((a) => presentEntityIds(a).has(input.targetEntityId));
      const leader = leaderOf(rows, input, trackedIds, nameById, shown);
      return {
        place: place || null,
        eligible: rows.length,
        targetPresent: present.length,
        targetIds: present.map((a) => a.observationId),
        leaderName: leader?.name ?? null,
        leaderCount: leader?.count ?? 0,
      };
    })
    .sort((a, b) => b.eligible - a.eligible || (a.place ?? "~").localeCompare(b.place ?? "~"));
}

// ---------------------------------------------------------------------------
// Prompt rows
// ---------------------------------------------------------------------------

function buildPromptRows(analyses: NormalizedObservation[], input: EngineInput): PromptRow[] {
  const nameById = new Map<string, string>([
    [input.targetEntityId, input.targetName],
    ...input.competitors.map((c) => [c.entityId, c.name] as [string, string]),
  ]);
  const topicName = new Map(input.topics.map((t) => [t.id, t.name]));
  const trackedIds = new Set(nameById.keys());
  const prompts = input.prompts ?? new Map<string, PromptInfo>();
  const provenance = input.provenance ?? new Map<string, ObservationProvenance>();

  const rows = analyses.map((analysis): PromptRow => {
    const info = prompts.get(analysis.promptCandidateId);
    const topicId = input.topicByPrompt.get(analysis.promptCandidateId) ?? info?.topicId ?? null;
    const status: PromptRow["status"] =
      analysis.eligibility === "ELIGIBLE" ? "analysable" : analysis.eligibility === "NEEDS_REVIEW" ? "needs_review" : isAwaitingAnalysis(analysis) ? "awaiting_analysis" : "not_collected";
    const analysable = status === "analysable";
    const captured = analysis.eligibility !== "NOT_CAPTURED";
    const present = presentEntityIds(analysis);
    const trackedOrdered = analysis.occurrences
      .filter((o) => o.entityId && trackedIds.has(o.entityId) && AGGREGATABLE_CONFIDENCE.includes(o.confidence))
      .sort((a, b) => a.mention.start - b.mention.start)
      .map((o) => nameById.get(o.entityId!)!);
    const targetOccurrence = analysis.occurrences.find((o) => o.entityId === input.targetEntityId && AGGREGATABLE_CONFIDENCE.includes(o.confidence));
    const rankable = RANKABLE.includes(analysis.rankEligibility);
    const targetPosition = analysis.positions.find((p) => p.entityId === input.targetEntityId);
    const first = rankable ? analysis.positions.find((p) => p.explicitRank === 1) : undefined;
    const isTradeOff = analysis.section === "Trade Offs";
    const isSentiment = analysis.section === "Sentiment Analysis";
    const comparisons = targetComparisons(analysis, input);
    const rivalFromQuestion = info?.competitorEntityId ? (nameById.get(info.competitorEntityId) ?? null) : null;
    const rivalFromAnswer = comparisons.map((c) => (c.subjectEntityId === input.targetEntityId ? c.objectName : c.subjectName)).find(Boolean) ?? null;
    const targetSentiment = analysis.sentiment.find((s) => s.entityId === input.targetEntityId);
    const trustworthy = hasTrustworthySources(analysis);
    const where = provenance.get(analysis.observationId);

    return {
      promptCandidateId: analysis.promptCandidateId,
      text: info?.text ?? "(question unavailable)",
      section: analysis.section ?? info?.section ?? null,
      topicId,
      topicName: topicId ? (topicName.get(topicId) ?? null) : null,
      engine: engineOf(analysis.providerExperience),
      route: analysis.providerExperience,
      observationId: captured ? analysis.observationId : null,
      status,
      targetNamed: analysable ? present.has(input.targetEntityId) : null,
      brandsNamed: analysable ? unique(trackedOrdered) : [],
      untrackedNamed: analysable ? unique(analysis.emergingCandidates.map((c) => c.name)) : [],
      targetRole: analysable ? (targetOccurrence?.role ?? null) : null,
      rankEligibility: analysable ? analysis.rankEligibility : null,
      targetRank: analysable && rankable ? (targetPosition?.explicitRank ?? null) : null,
      firstChoiceName: analysable && first ? first.name : null,
      verdict: analysable && isTradeOff ? outcomeOf(analysis, input) : null,
      rivalName: isTradeOff ? (rivalFromQuestion ?? rivalFromAnswer) : null,
      aspects: analysable && isTradeOff ? unique(comparisons.map((c) => c.aspect).filter((a): a is string => Boolean(a))) : [],
      portrayal: analysable && isSentiment ? (targetSentiment?.overallPortrayal ?? "NO_SENTIMENT") : null,
      themes: analysable && isSentiment ? (targetSentiment?.aspects ?? []).map((a) => ({ category: a.aspectCategory, polarity: a.polarity })) : [],
      sourceState: analysis.sourceCaptureState,
      sourceCount: captured ? analysis.citations.length : 0,
      ownedCited: analysable && trustworthy ? analysis.citations.some((c) => c.ownership === "TARGET_OWNED") : null,
      rivalCited: analysable && trustworthy ? analysis.citations.some((c) => c.ownership === "COMPETITOR_OWNED") : null,
      citedDomains: captured ? unique(analysis.citations.map((c) => c.domain).filter(Boolean)) : [],
      observedAt: where?.observedAt ?? null,
      model: where?.model ?? null,
      country: where?.country ?? null,
      searchState: where?.searchState ?? null,
    };
  });

  const sectionOrder: Record<string, number> = { Discovery: 0, "Trade Offs": 1, "Sentiment Analysis": 2 };
  return rows.sort(
    (a, b) =>
      (sectionOrder[a.section ?? ""] ?? 3) - (sectionOrder[b.section ?? ""] ?? 3) ||
      a.text.localeCompare(b.text) ||
      a.engine.localeCompare(b.engine),
  );
}

// ---------------------------------------------------------------------------
// Brands
// ---------------------------------------------------------------------------

function buildBrands(analyses: NormalizedObservation[], input: EngineInput, tradeOffs: TradeOffResult): BrandRow[] {
  const discovery = analyses.filter((a) => a.section === "Discovery");
  const trustworthy = analyses.filter(hasTrustworthySources);
  const engines = [...new Set(analyses.map((a) => engineOf(a.providerExperience)))].sort();
  const tracked: Array<{ entityId: string; name: string; relation: BrandRow["relation"] }> = [
    { entityId: input.targetEntityId, name: input.targetName, relation: "target" },
    ...input.competitors.map((c) => ({ entityId: c.entityId, name: c.name, relation: "confirmed_competitor" as const })),
  ];

  const rows: BrandRow[] = tracked.map((brand) => {
    const namedIn = discovery.filter((a) => presentEntityIds(a).has(brand.entityId));
    const ranks = discovery
      .filter((a) => RANKABLE.includes(a.rankEligibility))
      .map((a) => a.positions.find((p) => p.entityId === brand.entityId)?.explicitRank ?? null)
      .filter((rank): rank is number => rank !== null);
    const cited = trustworthy.filter((a) => a.citations.some((c) => c.ownerEntityId === brand.entityId));
    const anywhere = analyses.filter((a) => presentEntityIds(a).has(brand.entityId));
    const rival = tradeOffs.byCompetitor.find((row) => row.entityId === brand.entityId);
    const namedByEngine: BrandRow["namedByEngine"] = {};
    for (const engine of engines) {
      const inEngine = discovery.filter((a) => engineOf(a.providerExperience) === engine);
      namedByEngine[engine] = { named: inEngine.filter((a) => presentEntityIds(a).has(brand.entityId)).length, eligible: inEngine.length };
    }
    return {
      entityId: brand.entityId,
      name: brand.name,
      relation: brand.relation,
      discoveryNamed: namedIn.length,
      discoveryEligible: discovery.length,
      discoveryObservationIds: namedIn.map((a) => a.observationId),
      shareOfVoice: null,
      firstChoice: ranks.filter((rank) => rank === 1).length,
      rankedCount: ranks.length,
      averageRank: ranks.length === 0 ? null : ranks.reduce((sum, rank) => sum + rank, 0) / ranks.length,
      headToHead: brand.relation === "target" || !rival ? null : { won: rival.targetPreferred, lost: rival.competitorPreferred, undecided: rival.undecided, observationIds: rival.observationIds },
      ownDomainsCited: cited.length,
      ownDomainsCitedIds: cited.map((a) => a.observationId),
      namedByEngine,
      namedAnywhere: anywhere.length,
      namedAnywhereIds: anywhere.map((a) => a.observationId),
    };
  });
  const totalEvents = rows.reduce((sum, row) => sum + row.discoveryNamed, 0);
  for (const row of rows) row.shareOfVoice = totalEvents === 0 ? null : row.discoveryNamed / totalEvents;

  // Untracked names: counted, never in a tracked denominator, never given a
  // tracked share. One business however the answers spelled it.
  const shown = displayNames(analyses);
  const emerging = new Map<string, { discovery: string[]; anywhere: string[]; byEngine: Record<string, number> }>();
  for (const analysis of analyses) {
    for (const candidate of analysis.emergingCandidates) {
      const key = businessKey(candidate.name);
      const row = emerging.get(key) ?? { discovery: [], anywhere: [], byEngine: {} };
      if (!row.anywhere.includes(analysis.observationId)) row.anywhere.push(analysis.observationId);
      if (analysis.section === "Discovery" && !row.discovery.includes(analysis.observationId)) {
        row.discovery.push(analysis.observationId);
        const engine = engineOf(analysis.providerExperience);
        row.byEngine[engine] = (row.byEngine[engine] ?? 0) + 1;
      }
      emerging.set(key, row);
    }
  }
  for (const [key, row] of emerging) {
    const name = shown.get(key) ?? key;
    const namedByEngine: BrandRow["namedByEngine"] = {};
    for (const engine of engines) {
      namedByEngine[engine] = { named: row.byEngine[engine] ?? 0, eligible: discovery.filter((a) => engineOf(a.providerExperience) === engine).length };
    }
    // Since observation-analysis@18 an untracked option on a numbered list
    // holds its number, so its ranks are read the same way as a tracked brand's.
    const ranks = discovery
      .filter((a) => RANKABLE.includes(a.rankEligibility))
      .map((a) => a.positions.find((p) => p.entityId === null && businessKey(p.name) === key)?.explicitRank ?? null)
      .filter((rank): rank is number => rank !== null);
    rows.push({
      entityId: null, name, relation: "emerging",
      discoveryNamed: row.discovery.length, discoveryEligible: discovery.length, discoveryObservationIds: row.discovery,
      shareOfVoice: null, firstChoice: ranks.filter((rank) => rank === 1).length, rankedCount: ranks.length,
      averageRank: ranks.length === 0 ? null : ranks.reduce((sum, rank) => sum + rank, 0) / ranks.length, headToHead: null,
      ownDomainsCited: 0, ownDomainsCitedIds: [], namedByEngine,
      namedAnywhere: row.anywhere.length, namedAnywhereIds: row.anywhere,
    });
  }

  const order: Record<BrandRow["relation"], number> = { target: 0, confirmed_competitor: 1, emerging: 2 };
  return rows.sort((a, b) => order[a.relation] - order[b.relation] || b.discoveryNamed - a.discoveryNamed || b.namedAnywhere - a.namedAnywhere || a.name.localeCompare(b.name));
}

// ---------------------------------------------------------------------------
// Opportunities
// ---------------------------------------------------------------------------

/**
 * Up to `limit` verbatim spans from the answers behind a finding. A card
 * quotes the sentence the analysis actually read, never a paraphrase, and
 * names the answer it came from so the quote opens that answer.
 */
/** A span as prose: answers arrive as markdown, and a quote should read like a sentence, not like source. */
function plainQuote(text: string): string {
  return text
    .replace(/\[([^\]]+)\]\([^)]*\)/g, "$1")
    .replace(/\*\*|__|`/g, "")
    .replace(/^\s*(?:#{1,6}\s+|(?:[-*+•]|\d+[.)])\s+)/, "")
    .replace(/\s+/g, " ")
    .trim();
}

function exampleSpans(analyses: NormalizedObservation[], spansOf: (analysis: NormalizedObservation) => string[], limit = 2): NonNullable<Opportunity["examples"]> {
  const out: NonNullable<Opportunity["examples"]> = [];
  for (const analysis of analyses) {
    // Two answers can carry the same sentence (templated answers, a repeated
    // listicle line); quoting it twice would look like more evidence than it is.
    // A map entry's rating line ("4.9") or a bare name is not a sentence
    // anyone can read as what the assistant said (2026-09-19).
    // A quote must say something beyond the names in it: an option's label
    // ("Artistic Trendz Hair and Beauty Salon") is where the name sits, not
    // what the assistant said about it (measure-policy@4).
    const names = [...analysis.occurrences.map((o) => o.mention.text), ...analysis.emergingCandidates.map((c) => c.name)].filter(Boolean);
    const saysMore = (span: string) => {
      let rest = span;
      for (const name of names) rest = rest.split(name).join(" ");
      return (rest.match(/[A-Za-z]{2,}/g) ?? []).length >= 3;
    };
    const text = spansOf(analysis)
      .map(plainQuote)
      .find((span) => (span.match(/[A-Za-z]{2,}/g) ?? []).length >= 2 && saysMore(span) && !/^\d(?:\.\d)?\s*•/.test(span) && !out.some((example) => example.text === span));
    if (!text) continue;
    out.push({ observationId: analysis.observationId, text: text.length > 240 ? `${text.slice(0, 239).trimEnd()}…` : text });
    if (out.length >= limit) break;
  }
  return out;
}

function buildOpportunities(analyses: NormalizedObservation[], input: EngineInput, result: MeasureResult): Opportunity[] {
  const out: Opportunity[] = [];
  const aggregatable = analyses.filter(isAggregatable);
  const nameById = new Map<string, string>([
    [input.targetEntityId, input.targetName],
    ...input.competitors.map((c) => [c.entityId, c.name] as [string, string]),
  ]);
  const competitorIds = new Set(input.competitors.map((c) => c.entityId));
  const enginesOf = (ids: string[]) => unique(analyses.filter((a) => ids.includes(a.observationId)).map((a) => engineOf(a.providerExperience))).sort();
  const topicName = new Map(input.topics.map((t) => [t.id, t.name]));

  // Missing from discovery: other businesses named, target not, by topic.
  // Untracked businesses count (measure-policy@3): with Dubai-wide questions
  // most answers named only untracked salons, so a tracked-rival rule stayed
  // silent exactly where the brand was most absent.
  const discovery = aggregatable.filter((a) => a.section === "Discovery");
  const trackedIds = new Set([input.targetEntityId, ...competitorIds]);
  // One finding for every Discovery answer that named other businesses and
  // not the target, with the businesses named instead. It was one card per
  // topic, which on ten questions meant three cards of "1 of 2" each, and the
  // topic split is already the "where you are missing" breakdown
  // (measure-policy@4).
  const gaps = discovery.filter((a) => !presentEntityIds(a).has(input.targetEntityId) && businessesNamed(a, trackedIds, nameById).size > 0);
  if (gaps.length > 0) {
    const shown = displayNames(discovery);
    const namedInstead = new Map<string, { label: string; ids: string[] }>();
    for (const analysis of gaps) {
      for (const [key, name] of businessesNamed(analysis, trackedIds, nameById)) {
        const entry = namedInstead.get(key) ?? { label: key.startsWith("name:") ? (shown.get(key.slice(5)) ?? name) : name, ids: [] };
        entry.ids.push(analysis.observationId);
        namedInstead.set(key, entry);
      }
    }
    const ids = gaps.map((a) => a.observationId);
    const topicsMissed = unique(gaps.map((a) => topicName.get(input.topicByPrompt.get(a.promptCandidateId) ?? "") ?? null).filter((name): name is string => Boolean(name)));
    out.push({
      id: "discovery_gap",
      type: "discovery_gap",
      title: `Left out of ${gaps.length} of ${discovery.length} answers that named other businesses`,
      detail: `${gaps.length} of ${discovery.length} analysable Discovery answers named other businesses and not ${input.targetName}${topicsMissed.length > 0 ? `, in questions about ${topicsMissed.slice(0, 3).map((name) => name.toLowerCase()).join(", ")}${topicsMissed.length > 3 ? " and more" : ""}` : ""}.`,
      count: gaps.length,
      outOf: discovery.length,
      observationIds: ids,
      engines: enginesOf(ids),
      items: [...namedInstead.values()].map((entry) => ({ label: entry.label, count: entry.ids.length, observationIds: entry.ids })).sort((a, b) => b.count - a.count || a.label.localeCompare(b.label)),
      // The sentence in which a rival was named: what the assistant said instead of naming the target.
      examples: exampleSpans(gaps, (analysis) =>
        analysis.occurrences
          .filter((o) => o.entityId && competitorIds.has(o.entityId) && AGGREGATABLE_CONFIDENCE.includes(o.confidence))
          .map((o) => o.evidence.text),
      ),
    });
  }

  // Head-to-heads a rival won, as one finding with each rival and what the
  // answers preferred it for (one card per rival before measure-policy@4).
  const lossRows = (result.tradeOffs.combined?.byCompetitor ?? []).filter((rival) => rival.competitorPreferred > 0);
  if (lossRows.length > 0) {
    const losses = aggregatable.filter((a) => a.section === "Trade Offs" && outcomeOf(a, input) === "COMPETITOR_PREFERRED");
    const decided = (result.tradeOffs.combined?.outcomes.TARGET_PREFERRED ?? 0) + (result.tradeOffs.combined?.outcomes.COMPETITOR_PREFERRED ?? 0);
    const items = lossRows
      .map((rival) => {
        const rivalLosses = losses.filter((a) => rival.observationIds.includes(a.observationId));
        const aspects = unique(rivalLosses.flatMap((a) => targetComparisons(a, input).map((c) => c.aspect).filter((aspect): aspect is string => Boolean(aspect))));
        return { label: aspects.length > 0 ? `${rival.name} (${aspects.slice(0, 3).join(", ")})` : rival.name, count: rivalLosses.length, observationIds: rivalLosses.map((a) => a.observationId) };
      })
      .sort((a, b) => b.count - a.count || a.label.localeCompare(b.label));
    const ids = losses.map((a) => a.observationId);
    out.push({
      id: "tradeoff_loss",
      type: "tradeoff_loss",
      title: `A rival was preferred in ${losses.length} of ${decided} head-to-heads that reached a verdict`,
      detail: `${losses.length} Trade Off answer${losses.length === 1 ? "" : "s"} preferred a rival over ${input.targetName}: ${items.map((item) => `${item.label} ${item.count}`).join(", ")}.`,
      count: losses.length,
      outOf: decided,
      observationIds: ids,
      engines: enginesOf(ids),
      items,
      // The comparison sentence that preferred the rival.
      examples: exampleSpans(losses, (analysis) =>
        targetComparisons(analysis, input)
          .filter((comparison) => {
            if (comparison.preference !== "SUBJECT" && comparison.preference !== "OBJECT") return false;
            const targetIsSubject = comparison.subjectEntityId === input.targetEntityId;
            return (comparison.preference === "SUBJECT") !== targetIsSubject;
          })
          .map((comparison) => comparison.evidence.text),
      ),
    });
  }

  // Reputation concerns.
  const sentiment = result.sentiment.combined;
  if (sentiment) {
    const negative = sentiment.observationIdsByPolarity.NEGATIVE ?? [];
    const mixed = sentiment.observationIdsByPolarity.MIXED ?? [];
    const concernIds = [...negative, ...mixed];
    if (concernIds.length > 0) {
      const eligible = result.scopes.sentiment.eligible;
      const items = sentiment.aspects
        .filter((aspect) => aspect.negative + aspect.mixed > 0)
        .map((aspect) => ({
          // "overall" is the analysis's name for an opinion with no theme.
          label: aspect.category === "overall" ? "general impression" : aspect.category.replace(/_/g, " "),
          count: aspect.negative + aspect.mixed,
          observationIds: aspect.observationIds.filter((id) => concernIds.includes(id)),
        }))
        .sort((a, b) => b.count - a.count);
      out.push({
        id: "reputation_concern",
        type: "reputation_concern",
        title: `${concernIds.length} of ${eligible} by-name answers described ${input.targetName} negatively or with mixed views`,
        detail: `${negative.length} negative and ${mixed.length} mixed portrayals among ${eligible} analysable answers to questions that asked about ${input.targetName} by name.`,
        count: concernIds.length,
        outOf: eligible,
        observationIds: concernIds,
        engines: enginesOf(concernIds),
        items,
        // The sentence that carried the negative or mixed opinion.
        examples: exampleSpans(
          aggregatable.filter((analysis) => concernIds.includes(analysis.observationId)),
          (analysis) =>
            (analysis.sentiment.find((s) => s.entityId === input.targetEntityId)?.aspects ?? [])
              .filter((aspect) => aspect.polarity === "NEGATIVE" || aspect.polarity === "MIXED")
              .map((aspect) => aspect.evidence.text),
        ),
      });
    }
  }

  // Sites shaping answers the target is missing from.
  const thirdParty = result.sources.domains.filter((row) => row.ownership !== "TARGET_OWNED" && row.ownership !== "COMPETITOR_OWNED" && row.discoveryWithoutTarget > 0);
  if (thirdParty.length > 0) {
    const ids = unique(thirdParty.flatMap((row) => row.discoveryWithoutTargetIds));
    const absent = discovery.filter((a) => !presentEntityIds(a).has(input.targetEntityId)).length;
    out.push({
      id: "source_gap",
      type: "source_gap",
      // The count is answers, so the title leads with answers; the sites are the items.
      title: `${ids.length} of ${absent} Discovery answers that left ${input.targetName} out cited third-party sites (${thirdParty.length} in all)`,
      detail: `${ids.length} of ${absent} Discovery answers without ${input.targetName} cited a third-party site. The pages were not fetched; this says the answers omitted you, not that the pages do.`,
      count: ids.length,
      outOf: absent,
      observationIds: ids,
      engines: enginesOf(ids),
      items: thirdParty.slice(0, 12).map((row) => ({ label: row.domain, count: row.discoveryWithoutTarget, observationIds: row.discoveryWithoutTargetIds })),
    });
  }

  // "Rival sites cited" and "your site not cited" were findings until
  // measure-policy@4. Each restated a figure the Sources view already shows
  // (rival-owned sites in the site table; the share of answers citing your
  // site), so they padded the list without adding evidence.

  // Untracked brands recurring.
  const recurring = result.emerging.filter((row) => row.observations >= 2);
  if (recurring.length > 0) {
    const ids = unique(recurring.flatMap((row) => row.observationIds));
    out.push({
      id: "untracked_brand",
      type: "untracked_brand",
      title: `${recurring.length} untracked brand${recurring.length === 1 ? "" : "s"} named as options in two or more answers`,
      detail: `${recurring.map((row) => row.name).slice(0, 5).join(", ")}${recurring.length > 5 ? " and others" : ""} appear in answers but are outside the competitive set, so they are in no figure.`,
      count: recurring.length,
      outOf: null,
      observationIds: ids,
      engines: enginesOf(ids),
      items: recurring.map((row) => ({ label: row.name, count: row.observations, observationIds: row.observationIds })),
    });
  }

  // Coverage gaps.
  const gapsTotal = result.coverage.notCollected + result.coverage.awaitingAnalysis + result.coverage.needsReview;
  if (gapsTotal > 0) {
    const notCollected = analyses.filter((a) => a.eligibility === "NOT_CAPTURED" && !isAwaitingAnalysis(a)).map((a) => a.observationId);
    const awaiting = analyses.filter(isAwaitingAnalysis).map((a) => a.observationId);
    const review = analyses.filter((a) => a.eligibility === "NEEDS_REVIEW").map((a) => a.observationId);
    const items = [
      { label: "Not collected", count: notCollected.length, observationIds: notCollected },
      { label: "Awaiting analysis", count: awaiting.length, observationIds: awaiting },
      { label: "Needs a look", count: review.length, observationIds: review },
    ].filter((item) => item.count > 0);
    out.push({
      id: "coverage_gap",
      type: "coverage_gap",
      title: `${gapsTotal} of ${result.coverage.planned} planned answers are outside every figure`,
      detail: `${notCollected.length} not collected, ${awaiting.length} awaiting analysis, ${review.length} needing a look. None of them counts as ${input.targetName} being absent.`,
      count: gapsTotal,
      outOf: result.coverage.planned,
      observationIds: [...awaiting, ...review],
      engines: [],
      items,
    });
  }

  return out;
}
