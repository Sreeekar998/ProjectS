// Drizzle ORM schema (SQLite dialect). Kept close to a normalized relational
// model on purpose: a Postgres port later only needs a dialect swap plus
// `text({mode:'json'})` -> `jsonb`, not a domain redesign. All access to
// these tables happens through src/lib/db/repositories/*, never directly
// from route handlers, so that seam stays real rather than aspirational.
import { sqliteTable, text, integer, index, uniqueIndex } from "drizzle-orm/sqlite-core";

const id = (name = "id") => text(name).primaryKey();
const ts = (name: string) => integer(name, { mode: "timestamp_ms" });
const json = <T>(name: string) => text(name, { mode: "json" }).$type<T>();

// ---------------------------------------------------------------------------
// Project / trial
// ---------------------------------------------------------------------------
export const projects = sqliteTable("projects", {
  id: id(),
  url: text("url").notNull(),
  registrableDomain: text("registrable_domain").notNull(),
  marketScope: text("market_scope").notNull(), // e.g. "AE", "global"
  language: text("language").notNull(), // BCP-47, e.g. "en"
  status: text("status").notNull().default("created"),
  // Startup capability gates frozen at project creation time (section 2.2).
  capabilityGates: json<Record<string, boolean>>("capability_gates").notNull(),
  createdAt: ts("created_at").notNull(),
  updatedAt: ts("updated_at").notNull(),
});

// ---------------------------------------------------------------------------
// Crawl
// ---------------------------------------------------------------------------
export const crawlRuns = sqliteTable(
  "crawl_runs",
  {
    id: id(),
    projectId: text("project_id").notNull(),
    status: text("status").notNull().default("running"), // running|completed|blocked|failed
    startedAt: ts("started_at").notNull(),
    completedAt: ts("completed_at"),
    robotsAllowed: integer("robots_allowed", { mode: "boolean" }),
    robotsCheckedAt: ts("robots_checked_at"),
    sitemapUrls: json<string[]>("sitemap_urls"),
    discoveredCount: integer("discovered_count").notNull().default(0),
    fetchedCount: integer("fetched_count").notNull().default(0),
    selectedCount: integer("selected_count").notNull().default(0),
    blockReason: text("block_reason"),
    usedPlaywrightFallback: integer("used_playwright_fallback", { mode: "boolean" }).notNull().default(false),
    // Planner + timing telemetry: how the budget was actually spent. Read by
    // the benchmark harness and the "Why?" panel; never shown raw to a
    // marketing user.
    metrics: json<Record<string, number | string | Record<string, number>>>("metrics"),
  },
  (t) => [index("crawl_runs_project_idx").on(t.projectId)],
);

export const crawlPages = sqliteTable(
  "crawl_pages",
  {
    id: id(),
    crawlRunId: text("crawl_run_id").notNull(),
    url: text("url").notNull(),
    normalizedUrl: text("normalized_url").notNull(),
    pageType: text("page_type"), // home|about|products|pricing|locations|faq|contact|policy|other
    httpStatus: integer("http_status"),
    fetchMethod: text("fetch_method").notNull().default("http"), // http|playwright
    contentHash: text("content_hash"),
    score: integer("score"),
    selectedReason: text("selected_reason"),
    title: text("title"),
    metaDescription: text("meta_description"),
    canonicalUrl: text("canonical_url"),
    headings: json<string[]>("headings"),
    jsonLd: json<unknown[]>("json_ld"),
    structuredSignals: json<Record<string, unknown>>("structured_signals"),
    // Planner bookkeeping, kept per page so selection quality is auditable.
    slotKey: text("slot_key"),
    familyKey: text("family_key"),
    scoreBreakdown: json<Record<string, number>>("score_breakdown"),
    isSelected: integer("is_selected", { mode: "boolean" }).notNull().default(false),
    schemaTypes: json<string[]>("schema_types"),
    hreflang: json<Array<{ lang: string; href: string }>>("hreflang"),
    breadcrumb: json<string[]>("breadcrumb"),
    htmlLang: text("html_lang"),
    ogSiteName: text("og_site_name"),
    wordCount: integer("word_count"),
    fetchMs: integer("fetch_ms"),
    fetchedAt: ts("fetched_at").notNull(),
    error: text("error"),
  },
  (t) => [
    index("crawl_pages_run_idx").on(t.crawlRunId),
    uniqueIndex("crawl_pages_run_url_idx").on(t.crawlRunId, t.normalizedUrl),
  ],
);

export const evidenceChunks = sqliteTable(
  "evidence_chunks",
  {
    id: id(),
    crawlPageId: text("crawl_page_id").notNull(),
    projectId: text("project_id").notNull(),
    chunkIndex: integer("chunk_index").notNull(),
    text: text("text").notNull(),
    charOffsetStart: integer("char_offset_start").notNull(),
    charOffsetEnd: integer("char_offset_end").notNull(),
    hash: text("hash").notNull(),
  },
  (t) => [index("evidence_chunks_page_idx").on(t.crawlPageId), index("evidence_chunks_project_idx").on(t.projectId)],
);

// Typed evidence: the unit every inferred profile field must cite. Unlike
// `evidence_chunks` (fixed-size slices of page text, used by downstream
// prompt generation), an evidence item is a single observation with a known
// source type and page type, which is what makes confidence computable and
// hallucinated citations detectable.
export const evidenceItems = sqliteTable(
  "evidence_items",
  {
    id: id(),
    runId: text("run_id").notNull(),
    projectId: text("project_id").notNull(),
    crawlPageId: text("crawl_page_id"),
    url: text("url").notNull(),
    canonicalUrl: text("canonical_url"),
    pageType: text("page_type").notNull(),
    sourceType: text("source_type").notNull(),
    text: text("text").notNull(),
    fieldHint: text("field_hint"),
    data: json<Record<string, unknown>>("data"),
    extractedAt: ts("extracted_at").notNull(),
  },
  (t) => [
    index("evidence_items_run_idx").on(t.runId),
    index("evidence_items_project_idx").on(t.projectId),
    index("evidence_items_hint_idx").on(t.runId, t.fieldHint),
  ],
);

// ---------------------------------------------------------------------------
// Business profile (immutable versions)
// ---------------------------------------------------------------------------
export const businessProfileVersions = sqliteTable(
  "business_profile_versions",
  {
    id: id(),
    projectId: text("project_id").notNull(),
    version: integer("version").notNull(),
    crawlRunId: text("crawl_run_id"),
    profile: json<Record<string, unknown>>("profile").notNull(),
    fieldProvenance: json<Record<string, { source: "evidence" | "user" | "inferred_needs_review"; evidenceIds?: string[] }>>(
      "field_provenance",
    ).notNull(),
    confirmedAt: ts("confirmed_at"),
    confirmedBy: text("confirmed_by"),
    // partial | complete | failed — a profile is written progressively, so a
    // reader must be able to tell "still filling in" from "this is all there is".
    status: text("status").notNull().default("complete"),
    // Field paths the user has edited. Re-running analysis must not silently
    // overwrite these, so the merge step consults this list.
    userEditedFields: json<string[]>("user_edited_fields"),
    synthesisMode: text("synthesis_mode"), // deterministic | llm_grounded
    createdAt: ts("created_at").notNull(),
  },
  (t) => [
    index("business_profile_versions_project_idx").on(t.projectId),
    uniqueIndex("business_profile_versions_project_version_idx").on(t.projectId, t.version),
  ],
);

// ---------------------------------------------------------------------------
// Geography
// ---------------------------------------------------------------------------
export const locations = sqliteTable(
  "locations",
  {
    id: id(),
    projectId: text("project_id").notNull(),
    level: text("level").notNull(), // country|region|city|branch|service_area
    name: text("name").notNull(),
    parentId: text("parent_id"),
    countryCode: text("country_code"),
    evidenceIds: json<string[]>("evidence_ids"),
    isPrimary: integer("is_primary", { mode: "boolean" }).notNull().default(false),
  },
  (t) => [index("locations_project_idx").on(t.projectId)],
);

// ---------------------------------------------------------------------------
// Topics
// ---------------------------------------------------------------------------
export const topics = sqliteTable(
  "topics",
  {
    id: id(),
    projectId: text("project_id").notNull(),
    businessProfileVersionId: text("business_profile_version_id").notNull(),
    name: text("name").notNull(),
    discoveryConcept: text("discovery_concept"),
    description: text("description"),
    priority: integer("priority").notNull().default(0),
    status: text("status").notNull().default("candidate"), // candidate|confirmed|removed
    source: text("source").notNull().default("system"), // system|user
    evidenceIds: json<string[]>("evidence_ids"),
    createdAt: ts("created_at").notNull(),
  },
  (t) => [index("topics_project_idx").on(t.projectId)],
);

// ---------------------------------------------------------------------------
// Entities: target brand, competitors, emerging/unconfirmed mentions
// ---------------------------------------------------------------------------
export const entities = sqliteTable(
  "entities",
  {
    id: id(),
    projectId: text("project_id").notNull(),
    kind: text("kind").notNull(), // target|competitor|emerging
    competitorType: text("competitor_type"), // direct|substitute|marketplace|adjacent (competitor only)
    canonicalName: text("canonical_name").notNull(),
    normalizedName: text("normalized_name"),
    domains: json<string[]>("domains").notNull(),
    canonicalDomain: text("canonical_domain"),
    entityType: text("entity_type").notNull().default("company"), // company|brand|sub_brand|product_line|local_location
    parentEntityId: text("parent_entity_id"),
    relationship: text("relationship"), // parent|sub_brand|product_line|local_location|same_entity
    status: text("status").notNull().default("candidate"), // candidate|confirmed|removed
    discoveryStatus: text("discovery_status").notNull().default("suggested"), // discovering|verifying|suggested|confirmed|rejected|invalid
    confidence: integer("confidence"), // 0-100
    reason: text("reason"),
    geographyRelevance: text("geography_relevance"),
    evidenceIds: json<string[]>("evidence_ids"),
    source: text("source").notNull().default("system"), // website_explicit|ai_hypothesis|authorized_search|open_knowledge|user_manual|observed_ai_response|system
    sourceContributions: json<string[]>("source_contributions"),
    matchedDimensions: json<string[]>("matched_dimensions"),
    scoreBreakdown: json<Record<string, number>>("score_breakdown"),
    verificationStatus: text("verification_status"), // not_applicable|pending|verified|failed|contradicted
    verificationSummary: text("verification_summary"),
    rejectionReason: text("rejection_reason"),
    candidateProfile: json<Record<string, unknown>>("candidate_profile"),
    createdAt: ts("created_at").notNull(),
  },
  (t) => [
    index("entities_project_idx").on(t.projectId),
    index("entities_kind_idx").on(t.projectId, t.kind),
    index("entities_project_normalized_idx").on(t.projectId, t.normalizedName),
    index("entities_project_domain_idx").on(t.projectId, t.canonicalDomain),
  ],
);

export const aliases = sqliteTable(
  "aliases",
  {
    id: id(),
    entityId: text("entity_id").notNull(),
    alias: text("alias").notNull(),
    normalizedAlias: text("normalized_alias").notNull(),
  },
  (t) => [index("aliases_entity_idx").on(t.entityId)],
);

// ---------------------------------------------------------------------------
// Landscape discovery and immutable competitive-set versions
// ---------------------------------------------------------------------------
export const competitorDiscoveryRuns = sqliteTable(
  "competitor_discovery_runs",
  {
    id: id(),
    projectId: text("project_id").notNull(),
    businessProfileVersionId: text("business_profile_version_id").notNull(),
    status: text("status").notNull().default("running"), // running|completed|failed
    sourceStats: json<Record<string, number>>("source_stats"),
    metrics: json<Record<string, number>>("metrics"),
    error: text("error"),
    startedAt: ts("started_at").notNull(),
    completedAt: ts("completed_at"),
  },
  (t) => [index("competitor_discovery_runs_project_idx").on(t.projectId, t.startedAt)],
);

export interface FrozenTopicSnapshot {
  id: string;
  name: string;
  discoveryConcept: string;
  priority: number;
  evidenceIds: string[];
}

export interface FrozenCompetitorSnapshot {
  entityId: string;
  canonicalName: string;
  normalizedName: string;
  canonicalDomain: string | null;
  aliases: string[];
  competitorType: string;
  entityType: string;
  confidence: number | null;
  reason: string | null;
  provenance: string[];
  matchedDimensions: string[];
  scoreBreakdown: Record<string, number>;
  evidenceIds: string[];
  verificationStatus: string | null;
}

export const competitiveSetVersions = sqliteTable(
  "competitive_set_versions",
  {
    id: id(),
    projectId: text("project_id").notNull(),
    version: integer("version").notNull(),
    businessProfileVersionId: text("business_profile_version_id").notNull(),
    topicSnapshot: json<FrozenTopicSnapshot[]>("topic_snapshot").notNull(),
    competitorSnapshot: json<FrozenCompetitorSnapshot[]>("competitor_snapshot").notNull(),
    discoveryPolicyVersion: text("discovery_policy_version").notNull(),
    frozenHash: text("frozen_hash").notNull(),
    confirmedAt: ts("confirmed_at").notNull(),
    createdAt: ts("created_at").notNull(),
  },
  (t) => [
    index("competitive_set_versions_project_idx").on(t.projectId),
    uniqueIndex("competitive_set_versions_project_version_idx").on(t.projectId, t.version),
  ],
);

export const promptContextSnapshots = sqliteTable(
  "prompt_context_snapshots",
  {
    id: id(),
    projectId: text("project_id").notNull(),
    businessProfileVersionId: text("business_profile_version_id").notNull(),
    competitiveSetVersionId: text("competitive_set_version_id").notNull(),
    context: json<Record<string, unknown>>("context").notNull(),
    frozenHash: text("frozen_hash").notNull(),
    createdAt: ts("created_at").notNull(),
  },
  (t) => [index("prompt_context_snapshots_project_idx").on(t.projectId, t.createdAt)],
);

// ---------------------------------------------------------------------------
// Prompt sets / candidates
// ---------------------------------------------------------------------------
export const promptSets = sqliteTable(
  "prompt_sets",
  {
    id: id(),
    projectId: text("project_id").notNull(),
    version: integer("version").notNull(),
    businessProfileVersionId: text("business_profile_version_id").notNull(),
    competitiveSetVersionId: text("competitive_set_version_id"),
    promptContextSnapshotId: text("prompt_context_snapshot_id"),
    selectionPolicyVersion: text("selection_policy_version"),
    status: text("status").notNull().default("generating"), // generating|reviewing|approved
    coveragePolicy: json<Record<string, unknown>>("coverage_policy").notNull(),
    generationStats: json<Record<string, number>>("generation_stats"),
    approvedAt: ts("approved_at"),
    approvedBy: text("approved_by"),
    frozenHash: text("frozen_hash"),
    createdAt: ts("created_at").notNull(),
  },
  (t) => [index("prompt_sets_project_idx").on(t.projectId)],
);

export const promptCandidates = sqliteTable(
  "prompt_candidates",
  {
    id: id(),
    promptSetId: text("prompt_set_id").notNull(),
    text: text("text").notNull(),
    editedText: text("edited_text"),
    cohort: text("cohort").notNull(), // neutral_discovery|neutral_problem|neutral_evaluation|branded_accuracy|target_comparison
    section: text("section"), // Discovery|Trade Offs|Sentiment Analysis
    intent: text("intent").notNull(),
    journeyStage: text("journey_stage").notNull(),
    topicId: text("topic_id"),
    persona: text("persona"),
    useCaseConstraint: text("use_case_constraint"),
    evaluationCriterion: text("evaluation_criterion"),
    competitorEntityId: text("competitor_entity_id"),
    sentimentTheme: text("sentiment_theme"),
    geographyScope: text("geography_scope").notNull().default("none"), // none|country|region|city|branch
    geographyText: text("geography_text"),
    locationId: text("location_id"),
    language: text("language").notNull(),
    brandPolicy: text("brand_policy").notNull(), // TARGET_FORBIDDEN|COMPETITOR_ALLOWED|TARGET_REQUIRED|CONTROLLED
    coverageCellKey: text("coverage_cell_key").notNull(),
    evidenceBasis: json<string[]>("evidence_basis"),
    generationSource: text("generation_source"), // template|gemini
    contextBasis: json<string[]>("context_basis"),
    qualityScore: integer("quality_score"), // 0-100
    qualityBreakdown: json<Record<string, number>>("quality_breakdown"),
    coverageGain: integer("coverage_gain"), // 0-100
    diversityGain: integer("diversity_gain"), // 0-100
    selectionScore: integer("selection_score"), // inspectable deterministic utility
    validationResult: json<Record<string, unknown>>("validation_result"),
    semanticClusterId: text("semantic_cluster_id"),
    lifecycleState: text("lifecycle_state").notNull(), // GENERATING|CANDIDATE|VALIDATED|SHORTLISTED|SELECTED|USER_APPROVED|REJECTED
    rejectedReason: text("rejected_reason"),
    duplicateOfId: text("duplicate_of_id"),
    selectionReason: text("selection_reason"),
    sequence: integer("sequence").notNull(),
    createdAt: ts("created_at").notNull(),
    updatedAt: ts("updated_at").notNull(),
  },
  (t) => [
    index("prompt_candidates_set_idx").on(t.promptSetId),
    index("prompt_candidates_state_idx").on(t.promptSetId, t.lifecycleState),
  ],
);

// ---------------------------------------------------------------------------
// Collection: runs, prompt runs, responses, manual capture
// ---------------------------------------------------------------------------
export const collectionRuns = sqliteTable(
  "collection_runs",
  {
    id: id(),
    projectId: text("project_id").notNull(),
    promptSetId: text("prompt_set_id").notNull(),
    providerExperiences: json<string[]>("provider_experiences").notNull(),
    status: text("status").notNull().default("active"), // active|completed
    // Samples per prompt/provider. One is a directional baseline, not a
    // stable estimate: the repeated-query literature puts even "exploratory"
    // reliability at n=5. Stored so the run can state its own strength.
    samplesPerPrompt: integer("samples_per_prompt").notNull().default(1),
    baselineLabel: text("baseline_label").notNull().default("directional"),
    // A finalised run is a measurement: it accepts no more answers and its
    // result is frozen in measurement_snapshots. "auto" when every planned
    // answer was collected and analysed, "operator" when a partial run was
    // closed by hand ("Finish with what's collected").
    completedAt: ts("completed_at"),
    finalisedBy: text("finalised_by"), // auto|operator
    createdAt: ts("created_at").notNull(),
  },
  (t) => [index("collection_runs_project_idx").on(t.projectId)],
);

export const promptRuns = sqliteTable(
  "prompt_runs",
  {
    id: id(),
    collectionRunId: text("collection_run_id").notNull(),
    promptCandidateId: text("prompt_candidate_id").notNull(),
    providerExperience: text("provider_experience").notNull(), // gemini_free_api|groq_free_api
    sampleIndex: integer("sample_index").notNull().default(1),
    idempotencyKey: text("idempotency_key").notNull(),
    state: text("state").notNull().default("planned"),
    // planned|claimed|awaiting_import|running|succeeded|rate_limited|incomplete|failed|policy_disabled
    leaseOwner: text("lease_owner"),
    leaseExpiresAt: ts("lease_expires_at"),
    attempts: integer("attempts").notNull().default(0),
    attemptHistory: json<Array<{ at: number; state: string; note?: string }>>("attempt_history"),
    lastError: text("last_error"),
    createdAt: ts("created_at").notNull(),
    updatedAt: ts("updated_at").notNull(),
  },
  (t) => [
    index("prompt_runs_collection_idx").on(t.collectionRunId),
    uniqueIndex("prompt_runs_idempotency_idx").on(t.idempotencyKey),
  ],
);

export const providerResponses = sqliteTable(
  "provider_responses",
  {
    id: id(),
    promptRunId: text("prompt_run_id").notNull().unique(),
    providerExperience: text("provider_experience").notNull(),
    route: text("route").notNull(), // manual_consumer|api
    method: text("method").notNull(), // human_paste|automated
    visibleModelMode: text("visible_model_mode"),
    searchState: text("search_state"), // on|off|unknown|not_applicable
    accountTier: text("account_tier"),
    locale: text("locale"),
    observerRegion: text("observer_region"),
    responseText: text("response_text").notNull(),
    sourceUrls: json<string[]>("source_urls").notNull(),
    // Sources the surface listed vs URLs cited inline in the answer body. The
    // two are not the same set and the consumer UIs present them differently,
    // so merging them would lose the distinction before Measure ever sees it.
    inlineCitationUrls: json<string[]>("inline_citation_urls"),
    // Evidence-quality states. See collection/evidence-quality.ts: these are
    // what keep "we captured nothing" from being read as "there was nothing".
    answerCaptureState: text("answer_capture_state").notNull().default("unknown"),
    sourcesCaptureState: text("sources_capture_state").notNull().default("unknown"),
    // Neutral-session attestation, per provider, tri-state throughout.
    sessionProfile: json<Record<string, unknown>>("session_profile"),
    // Semantic market of the prompt, distinct from observerRegion below, which
    // is where the observation was physically made.
    intendedMarket: text("intended_market"),
    observerRegionSource: text("observer_region_source").notNull().default("unknown"),
    rawHash: text("raw_hash").notNull(),
    latencyMs: integer("latency_ms"),
    observedAt: ts("observed_at").notNull(),
    adapterVersion: text("adapter_version").notNull(),
    parserVersion: text("parser_version"),
    policyVersion: text("policy_version").notNull(),
    isFixture: integer("is_fixture", { mode: "boolean" }).notNull().default(false),
    fixtureLabel: text("fixture_label"),
  },
  (t) => [index("provider_responses_provider_idx").on(t.providerExperience)],
);

export const manualCaptureEvents = sqliteTable(
  "manual_capture_events",
  {
    id: id(),
    promptRunId: text("prompt_run_id").notNull(),
    operator: text("operator").notNull(),
    action: text("action").notNull(), // copied_prompt|opened_provider|imported_response|validated
    at: ts("at").notNull(),
    checklist: json<Record<string, boolean>>("checklist"),
  },
  (t) => [index("manual_capture_events_run_idx").on(t.promptRunId)],
);

// ---------------------------------------------------------------------------
// Derived facts
// ---------------------------------------------------------------------------
export const mentions = sqliteTable(
  "mentions",
  {
    id: id(),
    providerResponseId: text("provider_response_id").notNull(),
    entityId: text("entity_id").notNull(),
    aliasMatched: text("alias_matched"),
    charStart: integer("char_start"),
    charEnd: integer("char_end"),
    isRecommendation: integer("is_recommendation", { mode: "boolean" }).notNull().default(false),
    rankPosition: integer("rank_position"), // null when order is ambiguous prose
    confidence: integer("confidence").notNull(), // 0-100
    parserVersion: text("parser_version").notNull(),
  },
  (t) => [index("mentions_response_idx").on(t.providerResponseId), index("mentions_entity_idx").on(t.entityId)],
);

export const citations = sqliteTable(
  "citations",
  {
    id: id(),
    providerResponseId: text("provider_response_id").notNull(),
    url: text("url").notNull(),
    domain: text("domain").notNull(),
    matchedEntityId: text("matched_entity_id"),
    isOwnedDomain: integer("is_owned_domain", { mode: "boolean" }).notNull().default(false),
  },
  (t) => [index("citations_response_idx").on(t.providerResponseId)],
);

// ---------------------------------------------------------------------------
// Observation analysis (normalized evidence)
// ---------------------------------------------------------------------------
//
// One row per (observation, analysis version). Analyses are ADDITIVE: a better
// parser writes a new row that supersedes the old one, and the raw response is
// never touched. That is what makes an interpretation re-derivable and a
// metric auditable back to the sentence that produced it.
export const observationAnalyses = sqliteTable(
  "observation_analyses",
  {
    id: id(),
    projectId: text("project_id").notNull(),
    providerResponseId: text("provider_response_id").notNull(),
    promptCandidateId: text("prompt_candidate_id").notNull(),
    section: text("section"),
    providerExperience: text("provider_experience").notNull(),
    analysisVersion: text("analysis_version").notNull(),
    /** ELIGIBLE | NOT_CAPTURED | NEEDS_REVIEW */
    eligibility: text("eligibility").notNull(),
    /** Hash of the exact text analysed, so drift from the raw row is visible. */
    sourceHash: text("source_hash").notNull(),
    /** The full NormalizedObservation, including every evidence span. */
    payload: json<Record<string, unknown>>("payload").notNull(),
    warningCount: integer("warning_count").notNull().default(0),
    supersedesAnalysisId: text("supersedes_analysis_id"),
    reviewedBy: text("reviewed_by"),
    reviewedAt: ts("reviewed_at"),
    analysedAt: ts("analysed_at").notNull(),
  },
  (t) => [
    index("observation_analyses_project_idx").on(t.projectId),
    index("observation_analyses_response_idx").on(t.providerResponseId),
    uniqueIndex("observation_analyses_response_version_idx").on(t.providerResponseId, t.analysisVersion),
  ],
);

// ---------------------------------------------------------------------------
// Measurement snapshots (history)
// ---------------------------------------------------------------------------
//
// One row per finalised collection run per set of versions served. The row
// holds the engine's full result, so History never recomputes a past
// measurement with today's analyses or today's policy, and every past figure
// still opens the answers behind it. A re-analysis or a policy change writes
// a NEW row that supersedes the old one; nothing is overwritten.
//
// Replaces the never-written `metric_snapshots` table (per-metric basis-point
// rows could not hold presence rows, verdicts, sources or lineage).
export const measurementSnapshots = sqliteTable(
  "measurement_snapshots",
  {
    id: id(),
    projectId: text("project_id").notNull(),
    collectionRunId: text("collection_run_id").notNull(),
    promptSetId: text("prompt_set_id").notNull(),
    promptSetVersion: integer("prompt_set_version"),
    competitiveSetVersionId: text("competitive_set_version_id"),
    /** Analysis versions actually served, sorted. */
    analysisVersions: json<string[]>("analysis_versions").notNull(),
    metricPolicyVersion: text("metric_policy_version").notNull(),
    providerExperiences: json<string[]>("provider_experiences").notNull(),
    /** Engines with at least one analysable answer, sorted. */
    engines: json<string[]>("engines").notNull(),
    samplesPerPrompt: integer("samples_per_prompt").notNull().default(1),
    /** sha256 of everything comparability depends on; equal fingerprints compare without a break. */
    fingerprint: text("fingerprint").notNull(),
    coverage: json<{ planned: number; captured: number; analysable: number; needsReview: number; awaitingAnalysis: number }>("coverage").notNull(),
    /** The full MeasureResult as computed at finalisation. */
    result: json<Record<string, unknown>>("result").notNull(),
    supersedesSnapshotId: text("supersedes_snapshot_id"),
    computedAt: ts("computed_at").notNull(),
    createdAt: ts("created_at").notNull(),
  },
  (t) => [
    index("measurement_snapshots_project_idx").on(t.projectId),
    uniqueIndex("measurement_snapshots_run_versions_idx").on(t.collectionRunId, t.analysisVersions, t.metricPolicyVersion),
  ],
);

// ---------------------------------------------------------------------------
// Local provider credentials
// ---------------------------------------------------------------------------
//
// Every free LLM endpoint in 2026 requires a key. Requiring the operator to
// edit .env.local and restart the server to supply one is friction with no
// purpose in a local-first app, so the key can be pasted in the UI and lives
// here instead. Local machine, local SQLite, never sent anywhere but the
// provider it belongs to.
export const providerCredentials = sqliteTable("provider_credentials", {
  id: id(),
  /** "gemini" | "groq" */
  provider: text("provider").notNull().unique(),
  apiKey: text("api_key").notNull(),
  createdAt: ts("created_at").notNull(),
  updatedAt: ts("updated_at").notNull(),
});

// ---------------------------------------------------------------------------
// Route policy / capability registry
// ---------------------------------------------------------------------------
export const routePolicies = sqliteTable("route_policies", {
  id: id(),
  providerExperience: text("provider_experience").notNull().unique(),
  enabled: text("enabled").notNull(), // "true"|"false"|"optional"
  permittedOperations: json<string[]>("permitted_operations").notNull(),
  requiresCard: integer("requires_card", { mode: "boolean" }).notNull().default(false),
  retentionDays: integer("retention_days"),
  officialSourceUrl: text("official_source_url"),
  lastCheckedAt: ts("last_checked_at").notNull(),
  notes: text("notes"),
});

// ---------------------------------------------------------------------------
// Jobs (local SQLite-backed queue) and events (SSE log for resumability)
// ---------------------------------------------------------------------------
export const jobs = sqliteTable(
  "jobs",
  {
    id: id(),
    type: text("type").notNull(),
    projectId: text("project_id"),
    payload: json<Record<string, unknown>>("payload").notNull(),
    lane: text("lane").notNull().default("interactive"), // interactive|background
    status: text("status").notNull().default("queued"), // queued|running|succeeded|failed
    attempts: integer("attempts").notNull().default(0),
    maxAttempts: integer("max_attempts").notNull().default(3),
    leaseOwner: text("lease_owner"),
    leaseExpiresAt: ts("lease_expires_at"),
    runAfter: ts("run_after").notNull(),
    lastError: text("last_error"),
    createdAt: ts("created_at").notNull(),
    updatedAt: ts("updated_at").notNull(),
  },
  (t) => [index("jobs_status_idx").on(t.status, t.runAfter)],
);

export const events = sqliteTable(
  "events",
  {
    id: id(),
    projectId: text("project_id").notNull(),
    sequence: integer("sequence").notNull(),
    type: text("type").notNull(),
    payload: json<Record<string, unknown>>("payload").notNull(),
    createdAt: ts("created_at").notNull(),
  },
  (t) => [
    index("events_project_seq_idx").on(t.projectId, t.sequence),
    uniqueIndex("events_project_seq_unique").on(t.projectId, t.sequence),
  ],
);
