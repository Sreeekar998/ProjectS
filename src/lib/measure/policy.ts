// Measurement policy — the published definition of every Project Sun metric.
//
// Vendors do not agree on these formulas, and at least one contradicts itself:
// Profound's glossary divides brand mentions by ALL tracked responses, while
// its Answer Engine Insights page divides by responses containing at least one
// brand. Published analysis of 96 answers across four engines puts the
// divergence between those two denominators at 2.18x — "a brand scoring 20%
// under one published definition scores 44% under the other, with not one
// answer having changed".
//
// So the denominator is not a detail. Project Sun therefore publishes each
// metric's event, eligibility, denominator and missing-data rule as data, next
// to the number, and versions the whole policy.

// @2 (2026-09-15): by-rival head-to-head rows count only comparisons that
// involve the target; brand, source and opportunity tables added with their
// own published definitions below. Headline formulas unchanged.
// @3 (2026-09-19): "Share of every business named" added beside share of
// voice. Share of voice counts only the tracked rivals, so a DIFC salon read
// 88% while ChatGPT named 27 businesses in the same answers and the salon took
// about 15% of those mentions. Discovery answers are also broken down by the
// place the question named.
// @4 (2026-11-09): an untracked business is one business however the answers
// spelled it ("ALKEMY Salons" = "Alkemy Salons"); "no business named" counts
// answers naming no business at all, tracked or not (it counted answers
// naming no TRACKED brand, so a list of six untracked salons was
// "brand-free"); topic leaders count every business, as place leaders did;
// the missing-from-discovery and head-to-head-loss findings are one finding
// each instead of one per topic and per rival, and the "rival sites cited"
// and "your site not cited" findings are retired; sources gain an
// answer-level mix (yours / a rival's / third-party only / none).
export const METRIC_POLICY_VERSION = "measure-policy@4";

export type MetricKey =
  | "discovery_visibility"
  | "answer_brand_free_rate"
  | "discovery_share_of_voice"
  | "discovery_share_all_names"
  | "first_choice_rate"
  | "tradeoff_decisiveness"
  | "tradeoff_target_win_rate"
  | "owned_citation_rate"
  | "owned_citation_rate_when_sourced"
  | "citation_share"
  | "observation_coverage"
  | "source_capture_coverage";

export interface MetricDefinition {
  key: MetricKey;
  label: string;
  /** One sentence a marketing lead can read. */
  plain: string;
  /** The countable event in the numerator. */
  event: string;
  /** Exactly what the denominator is. */
  denominator: string;
  /** Which prompt sections contribute. */
  sections: string;
  /** What happens to failures, uncertainty and missing capture. */
  missingData: string;
  /** The unit being counted — observations or URLs. Never mix them. */
  unit: "observations" | "presence_events" | "urls";
}

export const METRIC_DEFINITIONS: Record<MetricKey, MetricDefinition> = {
  discovery_visibility: {
    key: "discovery_visibility",
    label: "Visibility",
    plain: "How often the brand is named when a buyer asks a question that does not name it.",
    event: "One eligible Discovery observation in which the target is present in the answer text. Presence is binary: an answer naming the brand six times counts once.",
    denominator: "All eligible Discovery observations, including those naming no brand at all.",
    sections: "Discovery only. Trade Off and Sentiment prompts contain the brand name in the question, so the brand appearing in the answer is not evidence that the assistant volunteered it.",
    missingData: "Failed, uncaptured and analysis-uncertain observations are excluded from BOTH numerator and denominator. They are missing coverage, never brand absence.",
    unit: "observations",
  },
  answer_brand_free_rate: {
    key: "answer_brand_free_rate",
    label: "No business named",
    plain: "How often the assistant answered with general advice and named no business at all, so no business could be recommended in that answer.",
    event: "One eligible Discovery observation naming no business: not the target, no frozen competitor and no untracked business the analysis detected as an option.",
    denominator: "All eligible Discovery observations.",
    sections: "Discovery only.",
    missingData: "Same exclusions as Visibility. It rests on the untracked-business detection: a business the analysis did not recognise is not counted as named.",
    unit: "observations",
  },
  discovery_share_of_voice: {
    key: "discovery_share_of_voice",
    label: "Share among tracked brands",
    plain: "Of every time you or a tracked competitor was named in discovery answers, how many times it was you. Untracked names are not counted, so when no tracked competitor is named the share is 100% by construction and is shown as not comparable. Kept in exports for run-to-run comparison; the workspace shows the share of every business named.",
    event: "One presence event per (observation, entity) pair — response-level, not word-level. A verbose answer repeating a brand does not earn extra weight.",
    denominator: "Presence events for the target plus every competitor in the frozen CompetitiveSetVersion. Emerging entities are excluded so the denominator stays reproducible.",
    sections: "Discovery only.",
    missingData: "Observations excluded from Discovery Visibility contribute no presence events to any brand.",
    unit: "presence_events",
  },
  discovery_share_all_names: {
    key: "discovery_share_all_names",
    label: "Share of voice",
    plain: "Of every business the assistant named in answers to questions that named none, how many times it was you. Businesses you do not track count too, so this is your share of the whole answer, not only of your tracked rivals.",
    event: "One presence event per (observation, business) pair — the target, a frozen competitor, or an untracked business the analysis detected as an option. Binary per answer; one business however the answers spelled it.",
    denominator: "Presence events of every business named in eligible Discovery observations. Untracked businesses are detected automatically and listed by name, so the denominator can be checked; it is specific to one run and is not a reproducible competitive set, and a business the detection missed is not in it.",
    sections: "Discovery only.",
    missingData: "Observations excluded from Discovery Visibility contribute no presence events. An answer naming no business adds nothing to either side.",
    unit: "presence_events",
  },
  first_choice_rate: {
    key: "first_choice_rate",
    label: "Ranked first",
    plain: "When the assistant put options in a definite order, how often we were first.",
    event: "One eligible Discovery observation where the target holds explicit rank 1.",
    denominator: "Discovery observations that are RANK-ELIGIBLE — a numbered list or explicit ordinal prose. Unordered sets are excluded entirely rather than assigned a first place.",
    sections: "Discovery only.",
    missingData: "Not-rankable, single-option and no-option answers are excluded from the denominator. With no rank-eligible answers the metric is N/A, never 0%.",
    unit: "observations",
  },
  tradeoff_decisiveness: {
    key: "tradeoff_decisiveness",
    label: "Gave a verdict",
    plain: "How often a head-to-head answer actually picked a side.",
    event: "One eligible Trade Off observation whose comparison names a preferred entity.",
    denominator: "All eligible Trade Off observations carrying a comparison that involves the target. An answer that only compares two rivals with each other is 'didn't compare them' and is excluded, as in the verdict distribution.",
    sections: "Trade Offs only.",
    missingData: "Ties, mixed verdicts and unclear preferences count in the denominator but not the numerator — they are real outcomes, not gaps.",
    unit: "observations",
  },
  tradeoff_target_win_rate: {
    key: "tradeoff_target_win_rate",
    label: "Won when decided",
    plain: "Of the head-to-heads that did pick a side, how often it was us.",
    event: "One eligible Trade Off observation preferring the target.",
    denominator: "Only DECISIVE Trade Off observations. Reported alongside decisiveness so the undecided answers stay visible rather than being hidden in a denominator.",
    sections: "Trade Offs only.",
    missingData: "Undecided answers are excluded here and shown in the outcome distribution instead.",
    unit: "observations",
  },
  owned_citation_rate: {
    key: "owned_citation_rate",
    label: "Your site cited",
    plain: "How often an answer cited one of our own pages.",
    event: "One observation citing at least one target-owned URL.",
    denominator: "Observations with TRUSTWORTHY source capture only — where the operator confirmed every source was captured, or confirmed the page displayed none. Partial and uncaptured sources are excluded.",
    sections: "All sections, because citation behaviour is not section-specific. Reported separately from brand presence: a brand cited as a source has not necessarily been named to the reader.",
    missingData: "'Sources not captured' is excluded from the denominator. 'Page showed no sources' stays in the denominator and contributes zero — it is a real observation about the assistant.",
    unit: "observations",
  },
  owned_citation_rate_when_sourced: {
    key: "owned_citation_rate_when_sourced",
    label: "Your site cited, when sources were shown",
    plain: "When the assistant cited anything at all, how often one of the sources was ours.",
    event: "One observation citing at least one target-owned URL.",
    denominator: "Capture-complete observations where the page actually displayed at least one source.",
    sections: "All sections, capture-complete observations only.",
    missingData: "Answers where the page showed no sources are excluded here — they are in the all-answers rate instead. The two denominators answer different questions and are shown together deliberately: the wider one is dragged down by answers that never cite anything, and the narrower one cannot see that effect at all.",
    unit: "observations",
  },
  citation_share: {
    key: "citation_share",
    label: "Share of tracked-brand links",
    plain: "Of all the URLs cited that belong to a tracked brand, how many were ours. Kept in exports; for most local businesses the tracked rivals' own sites are rarely cited, so the workspace shows the answer-level mix of sources instead.",
    event: "One cited URL. Counted by URL VOLUME, not by response — four of our pages in one answer count four times.",
    denominator: "All cited URLs owned by the target or a frozen-set competitor. Third-party and unattributable domains are excluded from the share but shown in the domain table.",
    sections: "All sections, capture-complete observations only.",
    missingData: "Same capture rule as Owned Citation Rate.",
    unit: "urls",
  },
  observation_coverage: {
    key: "observation_coverage",
    label: "Observation Coverage",
    plain: "How much of the planned run actually produced usable evidence.",
    event: "One captured, analysable observation.",
    denominator: "All planned observations for the run (prompts x engines x samples).",
    sections: "All.",
    missingData: "This metric exists to make missingness visible rather than absorb it.",
    unit: "observations",
  },
  source_capture_coverage: {
    key: "source_capture_coverage",
    label: "Source Capture Coverage",
    plain: "How many captured answers have source information solid enough to measure citations from.",
    event: "One observation whose source capture is complete or confirmed-none.",
    denominator: "All captured observations.",
    sections: "All.",
    missingData: "Low coverage here is why a citation metric may be N/A or carry a small sample.",
    unit: "observations",
  },
};

/**
 * How ChatGPT and Gemini are combined.
 *
 * POOLED means every eligible observation counts once regardless of engine.
 * That is the simplest reproducible rule, and it is stated rather than
 * implied — when engine coverage differs, pooling gives the engine with
 * more successful observations proportionally more influence, which is a real
 * property a reader is entitled to know about.
 */
export const COMBINED_AGGREGATION = {
  method: "pooled_observations" as const,
  description:
    "Combined pools every eligible observation from both engines with equal weight per observation. When one engine has fewer successful observations it therefore contributes proportionally less. Per-engine values are always shown beside the combined figure.",
};

/**
 * Sampling posture.
 *
 * One observation per prompt per engine is a directional baseline. Published
 * repeated-query work found engines answering WITHOUT web search were still
 * producing never-before-seen brands at run fifteen in 86-92% of cases, while
 * a retrieval-enabled engine's brand list saturated by about run ten — so how
 * far a single sample can be trusted depends on whether the assistant searched.
 * Cited-domain accumulation did not saturate at any horizon tested, which makes
 * citation-based metrics the least stable of all under single sampling.
 */
// "Exploratory" since measure-policy@4: the IAB guideline (August 2026) calls
// fewer than 50 queries exploratory and reserves "directional" for several
// answers per query; thirty questions asked once is the former.
export const SAMPLING_POSTURE = {
  label: "Exploratory baseline",
  samplesPerPromptProvider: 1,
  caveat:
    "One answer per question per engine, ten questions per section. One answer moves a section's rate by ten points, so each rate is shown with a plausible range (Wilson 95%) and a change inside that range is not read as a gain or a loss. Brand sets and especially cited domains vary between identical runs; answers where the assistant did not search the web are the least stable.",
};

/** How many answers a rate needs before a percentage leads; below it the fraction leads. */
export const LOW_N = 5;

/**
 * Columns of the Brands table, each defined the way a metric is.
 */
export const BRAND_COLUMN_DEFINITIONS: Record<string, { label: string; plain: string; rule: string }> = {
  discoveryNamed: {
    label: "Named in discovery answers",
    plain: "Analysable Discovery answers in which the brand is named at least once.",
    rule: "Binary per answer; only exact or strong name matches count. Trade Off and Sentiment answers are excluded because the question already names a brand.",
  },
  shareOfVoice: {
    label: "Share of voice",
    plain: "The business's share of every business mention in Discovery answers: answers naming it, out of all answer-and-business pairs, tracked or not.",
    rule: "Binary per answer: an answer naming a business five times counts once. Untracked businesses are detected automatically, so the share is specific to this run; a business the detection missed is not counted.",
  },
  firstChoice: {
    label: "Ranked first",
    plain: "Discovery answers where the brand holds explicit rank 1.",
    rule: "Only answers with a numbered list or explicit ordinal prose can carry a rank. Order of appearance in prose is never a rank.",
  },
  averageRank: {
    label: "Average position",
    plain: "Mean explicit rank over rank-eligible Discovery answers where the business holds a rank, tracked or not (an untracked option holds its number on a numbered list since observation-analysis@18).",
    rule: "Answers where the brand is absent or unranked are excluded, so a brand ranked once at #1 averages 1.0: read it with the count beside it.",
  },
  headToHead: {
    label: "Head-to-head",
    plain: "How Trade Off answers comparing this rival with you were decided.",
    rule: "Only comparisons involving the target count. Ties, unclear verdicts and answers comparing on both sides are undecided, never losses.",
  },
  ownDomainsCited: {
    label: "Own site cited",
    plain: "Answers, in any section, citing a page on a domain this brand owns.",
    rule: "Counted only over answers whose sources were captured completely or confirmed absent. Being cited is not the same as being named.",
  },
};

export const SOURCE_KIND_LABEL: Record<string, string> = {
  yours: "Your site",
  rival: "Rival site",
  marketplace: "Retailer or marketplace",
  community: "Community or forum",
  reference: "Reference or official",
  social_video: "Social or video",
  editorial: "Editorial or review",
  other: "Other",
};

export const SOURCE_DEFINITIONS = {
  ownership: "Yours and rival come from the domains recorded for the target and the frozen competitors. Third party only means the domain is not attributable to a tracked brand.",
  kind: "Guessed from the address with a short rule table (well-known hosts and path words such as /review or /forum). A guess, shown as one; it never enters a metric.",
  responsesCiting: "Answers citing the domain at least once. An answer citing three pages on one domain counts once.",
  totalCitations: "Cited URLs on the domain, counted by volume. A different unit from answers citing.",
  discoveryWithoutTarget:
    "Discovery answers that cite this domain and do not name the target. This says the answer omitted you, not that the page does: the pages were not fetched.",
  trustworthy: "Only answers whose sources were captured completely, or where the page confirmed there were none, take part in source figures.",
  answerMix:
    "Each answer counted once, by the best-owned site it cited: your site; else a tracked rival's site; else only third-party sites; else no sources at all. Ownership comes from the domains recorded for you and the frozen competitors, so a second domain of yours that was never recorded counts as third party.",
  leaders:
    "The business other than you named in the most answers of that topic or place, tracked or not, with its count. One answer per question, so a leader named once is a hint, not a pattern.",
};

/**
 * Opportunity types. Each states what it is evidence OF and what it is NOT,
 * because the same count reads very differently with and without that line.
 */
export const OPPORTUNITY_DEFINITIONS: Record<
  string,
  { label: string; plain: string; evidenceOf: string; notEvidenceOf: string; nextStep: string }
> = {
  discovery_gap: {
    label: "Left out of recommendations",
    plain: "Discovery answers that named other businesses, tracked or not, and not you, with the businesses named instead.",
    evidenceOf: "Questions where the assistant chose other businesses and had no reason to name you.",
    notEvidenceOf: "That the assistant does not know the brand: one answer per question, and answers vary between runs.",
    nextStep: "Read the answers and note which businesses were named and why. Deciding what to publish belongs to the Actions phase.",
  },
  tradeoff_loss: {
    label: "Head-to-heads lost",
    plain: "Trade Off answers where the assistant preferred a rival over you, by rival, with the aspects it named.",
    evidenceOf: "The grounds on which the answers preferred a rival.",
    notEvidenceOf: "A general verdict: each pairing has one answer per engine.",
    nextStep: "Check whether the aspects the answer cited are accurate and whether your site states your position on them.",
  },
  reputation_concern: {
    label: "Reputation concerns",
    plain: "Answers to by-name questions that described you negatively or with mixed views, with the themes.",
    evidenceOf: "How the assistant described the brand when asked about it directly.",
    notEvidenceOf: "Sentiment across every answer: only by-name questions are counted, and factual answers with no opinion are not negative.",
    nextStep: "Read the sentences behind each theme; a factual error is a different problem from a fair criticism.",
  },
  source_gap: {
    label: "Sites shaping answers you are missing from",
    plain: "Third-party domains cited in Discovery answers that did not name you, ranked by how many such answers cite them.",
    evidenceOf: "Which sites the assistant leaned on when it recommended rivals instead of you.",
    notEvidenceOf: "That those pages omit the brand. The pages were not fetched; only the answers were read.",
    nextStep: "Open the cited pages and check whether you are present on them. A persisted page check is planned for the Actions phase.",
  },
  // Retired in measure-policy@4 (they restated Sources figures); kept so
  // snapshots written before it still render their labels.
  rival_source: {
    label: "Rival sites cited",
    plain: "Tracked rivals' own domains cited as sources, and how often.",
    evidenceOf: "Rivals whose own pages the assistant treats as sources.",
    notEvidenceOf: "Anything about why: it may be the page's structure, its content, or the question.",
    nextStep: "Compare the cited rival pages with your equivalent pages.",
  },
  owned_uncited: {
    label: "Your site not cited",
    plain: "Answers that showed sources, none of which were yours.",
    evidenceOf: "How often the assistant sourced an answer without your pages when it sourced anything at all.",
    notEvidenceOf: "Answers that showed no sources: those are counted separately.",
    nextStep: "See which domains were cited instead, in Sources.",
  },
  untracked_brand: {
    label: "Untracked brands recurring",
    plain: "Names outside the frozen competitive set that appear as options in two or more answers.",
    evidenceOf: "Brands the assistant treats as alternatives that Measure is not tracking.",
    notEvidenceOf: "Anything measurable until they are added to the competitors and a new run is collected; they are in no denominator.",
    nextStep: "Add the ones that matter under Landscape, then collect a new run.",
  },
  coverage_gap: {
    label: "Coverage gaps",
    plain: "Planned answers that were not collected, are awaiting analysis, or need a look before they count.",
    evidenceOf: "How much of the planned run the figures rest on.",
    notEvidenceOf: "Brand absence. Missing answers leave every figure entirely.",
    nextStep: "Continue collecting, or re-analyse, from the collection panel.",
  },
};

/**
 * Comparability rules, published so History can quote them.
 */
export const COMPARABILITY_RULES = {
  breaks: [
    "the approved questions changed (a different prompt set)",
    "the competitive set changed (share-of-voice denominators differ)",
    "the analysis version served differs (evidence extraction changed)",
    "the metric policy differs (formulas changed)",
    "the engines with analysable answers differ",
    "the samples per question differ",
  ],
  cautions: [
    "collected through a different connection for the same engine",
    "the answers were observed from a different country",
    "the page named a different model",
    "coverage differs by more than ten points, or either run is partial",
  ],
  deltas: `A change is shown only for a comparable pair, as percentage points with both fractions beside it. Below ${LOW_N} answers on either side the change is shown as counts, never as points. A change that lands inside the earlier run's plausible range (Wilson 95%) is marked "within range": a different handful of similar questions could produce it, so it is not read as a gain or a loss.`,
};
