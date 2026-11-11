import { engineOf, surfaceOf, type AnswerEngine } from "@/lib/providers/engines";
import { eq } from "drizzle-orm";
import { getDb } from "@/lib/db/client";
import { collectionRuns as collectionRunsTable, routePolicies as routePoliciesTable } from "@/lib/db/schema";
import { newId } from "@/lib/ids";
import { sha256Hex } from "@/lib/text/similarity";
import { getPromptSet, listCandidates } from "@/lib/prompts/repository";
import {
  createCollectionRunRow,
  getCollectionRun,
  insertPromptRun,
  getPromptRunByIdempotencyKey,
  getPromptRun,
  listPromptRuns,
  updatePromptRun,
  insertProviderResponse,
  insertManualCaptureEvent,
  type CollectionRun,
  type PromptRun,
} from "./repository";
import { canTransition, InvalidStateTransitionError, type PromptRunState } from "./state-machine";
import { storeEvidence } from "@/lib/evidence/store";
import { storeArtifact } from "@/lib/evidence/artifacts";
import { appendEvent } from "@/lib/events/bus";
import { isManualRoute } from "@/lib/providers/route-policy-seed";
import { enabledEngines, engineEnabled, orderedCollectionRoutes } from "@/lib/providers/engine-scope";
import { CONSUMER_WEB_ROUTES, consumerWebRoute, VENDORS, type CollectionVendor } from "@/lib/providers/catalog";
import { getCredential, loadCredentials } from "@/lib/providers/credentials";
import { getProject } from "@/lib/projects/repository";
import { describeMarketHint, hintCountry, parseMarketHint } from "@/lib/projects/market-hint";
import { brightDataCollector } from "@/lib/brightdata/client";
import { cloroCollector } from "@/lib/cloro/client";
import { decodoCollector } from "@/lib/decodo/client";
import { oxylabsCollector } from "@/lib/oxylabs/client";
import { normalizeProviderResponse } from "@/lib/metrics/orchestrator";
import { analyseObservationById } from "@/lib/analysis/service";
import {
  type AnswerCaptureState,
  type SearchState,
  type SessionProfile,
  type SourcesCaptureState,
} from "./evidence-quality";
import type { ExecutionOriginSource } from "./geography";
import { CANARY_PROMPT, markersPass, type ConsumerAnswer, type ConsumerCollector } from "./consumer-collector";
import { isRouteHealthy } from "./vendor-health";

const MANUAL_ADAPTER_VERSION = "manual-consumer-adapter@1";
const POLICY_VERSION = "route-policy@2";
const LEASE_DURATION_MS = 15 * 60 * 1000;

async function getRoutePolicyEnabled(providerExperience: string): Promise<"true" | "false" | "optional"> {
  const db = getDb();
  const row = await db.select().from(routePoliciesTable).where(eq(routePoliciesTable.providerExperience, providerExperience)).get();
  return (row?.enabled as "true" | "false" | "optional") ?? "false";
}

/** No collection provider key is configured, so nothing can be collected yet. */
export class NoCollectionRouteError extends Error {
  constructor() {
    super("No collection provider is connected. In the collection panel, connect an Oxylabs, cloro, Bright Data or Decodo key; each has a free tier.");
    this.name = "NoCollectionRouteError";
  }
}

const COLLECTORS: Record<CollectionVendor, ConsumerCollector> = { cloro: cloroCollector, brightdata: brightDataCollector, oxylabs: oxylabsCollector, decodo: decodoCollector };

/** The key for a consumer-web route is present in this process. */
export function routeCredentialPresent(providerExperience: string): boolean {
  const route = consumerWebRoute(providerExperience);
  return route ? Boolean(getCredential(route.vendor)) : false;
}

/**
 * The next consumer-web route for an engine that has a key, is healthy, and is
 * not excluded (already used or paused in this run). Preference order is
 * `orderedCollectionRoutes()` (SUN_PREFERRED_ROUTES first, then the seed
 * order); a hidden engine (SUN_ENGINES) never gets a route.
 */
export function nextRouteForEngine(engine: string, exclude: readonly string[] = []): string | null {
  if (!engineEnabled(engine)) return null;
  for (const id of orderedCollectionRoutes()) {
    if (engineOf(id) !== engine || exclude.includes(id)) continue;
    if (!routeCredentialPresent(id) || !isRouteHealthy(id)) continue;
    return id;
  }
  return null;
}

export async function createCollectionRun(projectId: string, providerExperiences?: string[]): Promise<CollectionRun> {
  await loadCredentials();
  // Default to one consumer-web route per enabled engine: the first with a key
  // whose vendor is healthy. Asking two providers the same question would
  // double-weight the engine; the second provider is the fallback, not a
  // second vote.
  if (!providerExperiences) {
    const chosen: string[] = [];
    for (const engine of enabledEngines()) {
      const route = nextRouteForEngine(engine);
      if (route) chosen.push(route);
    }
    providerExperiences = chosen;
  }
  if (providerExperiences.length === 0) throw new NoCollectionRouteError();
  const promptSet = await getLatestApprovedPromptSet(projectId);
  if (!promptSet) throw new Error("No approved prompt set for this project. Approve exactly 30 prompts first.");

  const candidates = await listCandidates(promptSet.id);
  const approved = candidates.filter((c) => c.lifecycleState === "USER_APPROVED");
  if (approved.length !== 30) throw new Error(`Approved prompt set has ${approved.length} prompts, expected exactly 30.`);

  const run = await createCollectionRunRow(projectId, promptSet.id, providerExperiences);

  await planPromptRuns(projectId, promptSet.id, run.id, providerExperiences, approved);
  appendEvent(projectId, "collection_run.progress", { collectionRunId: run.id, status: "created", providerExperiences });
  return run;
}

/** A route can run right now: policy allows it and its key (where one is needed) is present. */
function routeRuntimeAvailable(providerExperience: string): boolean {
  if (consumerWebRoute(providerExperience)) return routeCredentialPresent(providerExperience);
  return true;
}

/**
 * Plans one prompt run per approved prompt per route. Idempotent: a prompt
 * already planned on a route is skipped, so adding routes never duplicates.
 */
async function planPromptRuns(
  projectId: string,
  promptSetId: string,
  runId: string,
  providerExperiences: string[],
  approved: Array<{ id: string }>,
): Promise<void> {
  const run = { id: runId };
  void projectId;
  void promptSetId;
  for (const provider of providerExperiences) {
    const enabled = await getRoutePolicyEnabled(provider);
    // A keyless consumer-web route is planned as policy_disabled rather than
    // left "planned" forever with nothing able to run it.
    const effectivelyEnabled = enabled === "true" || (enabled === "optional" && routeRuntimeAvailable(provider));
    // A manual route is planned as "awaiting_import" from the start: there is
    // nothing to execute, only an answer to be pasted in.
    const initialState: PromptRunState = effectivelyEnabled ? (isManualRoute(provider) ? "awaiting_import" : "planned") : "policy_disabled";

    for (const candidate of approved) {
      // Scoped to the RUN. The key used to be global to the prompt set, which
      // made a second run on the same approved questions plan nothing at all
      // (docs/KNOWN_ISSUES.md, "Second run is empty"). Within a run it still
      // stops a route added twice from planning a question twice.
      const idempotencyKey = sha256Hex(`${run.id}|${candidate.id}|${provider}|1`);
      const existing = await getPromptRunByIdempotencyKey(idempotencyKey);
      if (existing) continue;
      const now = new Date();
      await insertPromptRun({
        id: newId("prun"),
        collectionRunId: run.id,
        promptCandidateId: candidate.id,
        providerExperience: provider,
        sampleIndex: 1,
        idempotencyKey,
        state: initialState,
        leaseOwner: null,
        leaseExpiresAt: null,
        attempts: 0,
        attemptHistory: [{ at: now.getTime(), state: initialState }],
        lastError: effectivelyEnabled ? null : "route_disabled_by_policy",
        createdAt: now,
        updatedAt: now,
      });
    }
  }
}

/**
 * Adds routes to an existing collection run, so a second engine or a
 * replacement provider joins the same measurement instead of starting a new
 * run with its own denominators.
 */
export async function addRoutesToCollectionRun(collectionRunId: string, providerExperiences: string[]): Promise<CollectionRun> {
  const run = await getCollectionRun(collectionRunId);
  if (!run) throw new Error(`collection_run ${collectionRunId} not found`);
  const candidates = await listCandidates(run.promptSetId);
  const approved = candidates.filter((c) => c.lifecycleState === "USER_APPROVED");
  await planPromptRuns(run.projectId, run.promptSetId, run.id, providerExperiences, approved);
  const merged = [...new Set([...((run.providerExperiences as string[]) ?? []), ...providerExperiences])];
  await getDb().update(collectionRunsTable).set({ providerExperiences: merged }).where(eq(collectionRunsTable.id, run.id)).run();
  appendEvent(run.projectId, "collection_run.progress", { collectionRunId: run.id, status: "routes_added", providerExperiences });
  return (await getCollectionRun(run.id))!;
}

/**
 * Moves a run's unfinished questions from one automatic route to another for
 * the same assistant AND the same surface, e.g. ChatGPT on the web continuing
 * from Bright Data to cloro when Bright Data is blocked.
 *
 * Answers already collected stay. The unfinished rows are retired as
 * policy_disabled, with the move recorded in their history, so they are neither
 * asked again nor counted as planned; the new route is planned for exactly
 * those questions. A move across surfaces (web to API, API to by hand) is
 * refused: it would change what the engine's numbers mean mid-run.
 */
export async function switchAutomatedRoute(collectionRunId: string, fromRoute: string, toRoute: string): Promise<CollectionRun> {
  if (engineOf(fromRoute) !== engineOf(toRoute)) throw new Error("A route can only be replaced by a route for the same assistant.");
  if (surfaceOf(fromRoute) !== surfaceOf(toRoute)) throw new Error("A route can only be replaced by a route that observes the same surface.");
  const run = await getCollectionRun(collectionRunId);
  if (!run) throw new Error(`collection_run ${collectionRunId} not found`);
  const unfinished = (await listPromptRuns(collectionRunId)).filter(
    (row) => row.providerExperience === fromRoute && ["planned", "rate_limited", "failed", "incomplete"].includes(row.state),
  );
  for (const row of unfinished) {
    let current = row;
    if (current.state !== "planned") {
      await transition(current, "planned");
      current = (await getPromptRun(row.id))!;
    }
    await transition(current, "policy_disabled", { lastError: `moved_to_${toRoute}` });
  }
  const moving = new Set(unfinished.map((row) => row.promptCandidateId));
  const candidates = (await listCandidates(run.promptSetId)).filter((candidate) => moving.has(candidate.id));
  await planPromptRuns(run.projectId, run.promptSetId, run.id, [toRoute], candidates);
  const merged = [...new Set([...((run.providerExperiences as string[]) ?? []), toRoute])];
  await getDb().update(collectionRunsTable).set({ providerExperiences: merged }).where(eq(collectionRunsTable.id, run.id)).run();
  appendEvent(run.projectId, "collection_run.progress", { collectionRunId: run.id, status: "route_switched", from: fromRoute, to: toRoute, moved: unfinished.length });
  return (await getCollectionRun(run.id))!;
}

async function getLatestApprovedPromptSet(projectId: string) {
  const { getLatestPromptSet } = await import("@/lib/prompts/repository");
  const latest = await getLatestPromptSet(projectId);
  if (latest && latest.status === "approved") return latest;
  return undefined;
}

async function transition(run: PromptRun, to: PromptRunState, extra: Partial<typeof run> = {}): Promise<void> {
  if (!canTransition(run.state as PromptRunState, to)) {
    throw new InvalidStateTransitionError(run.state as PromptRunState, to);
  }
  const history = [...((run.attemptHistory as Array<{ at: number; state: string; note?: string }>) ?? []), { at: Date.now(), state: to }];
  await updatePromptRun(run.id, { state: to, attemptHistory: history, ...extra });
  const collectionRun = await getCollectionRun(run.collectionRunId);
  if (collectionRun) appendEvent(collectionRun.projectId, "prompt_run.state_changed", { promptRunId: run.id, from: run.state, to });
}

/**
 * Records one answer an operator observed by hand in ChatGPT or Gemini.
 *
 * By-hand capture left the product on 2026-09-14; this path stays for the
 * stored rows and for QA fixtures. Nothing here automates a consumer surface:
 * the operator runs the prompt in their own session, pastes the answer, and
 * ASSERTS what they captured. Those assertions are recorded rather than
 * inferred, because the capture-state fields are what every citation
 * denominator depends on.
 */
export async function recordManualObservation(promptRunId: string, input: ManualObservationInput): Promise<{ providerResponseId: string }> {
  const run = await getPromptRun(promptRunId);
  if (!run) throw new Error(`prompt_run ${promptRunId} not found`);
  if (!isManualRoute(run.providerExperience)) {
    throw new Error(`prompt_run ${promptRunId} is on automated route ${run.providerExperience}; manual capture is not permitted for it.`);
  }
  const collectionRun = await getCollectionRun(run.collectionRunId);
  if (!collectionRun) throw new Error(`collection_run ${run.collectionRunId} not found`);
  const candidate = await getCandidateForRun(run);

  let current = run;
  if (current.state === "planned") {
    await transition(current, "claimed");
    current = (await getPromptRun(promptRunId))!;
  }
  if (current.state === "claimed") {
    await transition(current, "awaiting_import");
    current = (await getPromptRun(promptRunId))!;
  }
  if (current.state !== "awaiting_import") {
    throw new InvalidStateTransitionError(current.state as PromptRunState, "awaiting_import");
  }

  const stored = storeEvidence(collectionRun.projectId, input.responseText);
  const responseId = newId("pres");
  await insertProviderResponse({
    id: responseId,
    promptRunId,
    providerExperience: run.providerExperience,
    route: "consumer_app",
    method: "manual",
    visibleModelMode: input.visibleModelMode ?? null,
    searchState: input.searchState ?? "unknown",
    accountTier: input.accountTier ?? "unknown",
    locale: input.locale ?? candidate.language,
    observerRegion: input.observerRegion ?? null,
    responseText: input.responseText,
    sourceUrls: input.sourceUrls,
    sourcesCaptureState: input.sourcesCaptureState ?? (input.sourceUrls.length > 0 ? "complete" : "not_captured"),
    answerCaptureState: input.answerCaptureState ?? "complete",
    rawHash: stored.hash,
    latencyMs: null,
    observedAt: new Date(),
    adapterVersion: MANUAL_ADAPTER_VERSION,
    parserVersion: null,
    policyVersion: POLICY_VERSION,
    isFixture: false,
    fixtureLabel: null,
  });

  await insertManualCaptureEvent({
    id: newId("mcap"),
    promptRunId,
    operator: input.operator,
    action: "imported_response",
    at: new Date(),
    checklist: {
      answerComplete: (input.answerCaptureState ?? "complete") === "complete",
      sourcesCaptured: (input.sourcesCaptureState ?? (input.sourceUrls.length > 0 ? "complete" : "not_captured")) === "complete",
      sourcesConfirmedNone: input.sourcesCaptureState === "none_present",
    },
  });

  try {
    await normalizeProviderResponse(responseId, collectionRun.projectId);
    await analyseObservationById(collectionRun.projectId, responseId);
  } catch (error) {
    appendEvent(collectionRun.projectId, "collection_run.progress", {
      collectionRunId: run.collectionRunId,
      promptRunId,
      status: "analysis_failed",
      detail: error instanceof Error ? error.message : String(error),
    });
  }

  await transition((await getPromptRun(promptRunId))!, "succeeded");
  return { providerResponseId: responseId };
}

export interface ManualObservationInput {
  operator: string;
  responseText: string;
  sourceUrls: string[];
  /** URLs cited inline in the answer body, where distinguishable from the list. */
  inlineCitationUrls?: string[];
  visibleModelMode?: string;
  searchState?: SearchState;
  accountTier?: string;
  locale?: string;
  observerRegion?: string;
  sampleIndex?: number;
  /** Evidence-quality assertions. Absent means unknown, never "none". */
  answerCaptureState?: AnswerCaptureState;
  sourcesCaptureState?: SourcesCaptureState;
  sessionProfile?: Partial<SessionProfile>;
  intendedMarket?: string | null;
  observerRegionSource?: ExecutionOriginSource;
  note?: string;
}

export type TypedNonSuccessOutcome = "rate_limited" | "incomplete" | "failed";

// Each outcome has exactly one valid predecessor state (see state-machine.ts):
// rate_limited only from "running", incomplete only from "awaiting_import",
// failed from "claimed" or "running". This walks whatever intermediate
// states are needed so the caller can report any typed outcome from any
// starting state without knowing the state machine's shape.
export async function markPromptRunTypedOutcome(promptRunId: string, outcome: TypedNonSuccessOutcome, note?: string): Promise<void> {
  let run = await getPromptRun(promptRunId);
  if (!run) throw new Error(`prompt_run ${promptRunId} not found`);

  const requiredPredecessor: Record<TypedNonSuccessOutcome, PromptRunState> = {
    rate_limited: "running",
    incomplete: "awaiting_import",
    failed: run.state === "running" ? "running" : "claimed",
  };
  const target = requiredPredecessor[outcome];

  if (run.state === "planned" && target !== "planned") {
    await transition(run, "claimed", { leaseOwner: "system", leaseExpiresAt: new Date(Date.now() + LEASE_DURATION_MS) });
    run = (await getPromptRun(promptRunId))!;
  }
  if (run.state === "claimed" && (target === "running" || target === "awaiting_import")) {
    await transition(run, target);
    run = (await getPromptRun(promptRunId))!;
  }
  await transition(run, outcome, { lastError: note ?? null });
}

/** Explicit retry: typed non-success states return to `planned` rather than
 * counting as a target absence — the response is the atomic fact, and there
 * is no response yet. */
export async function retryPromptRun(promptRunId: string, options: { countAttempt?: boolean } = {}): Promise<void> {
  const run = await getPromptRun(promptRunId);
  if (!run) throw new Error(`prompt_run ${promptRunId} not found`);
  // A lane paused for an empty balance or a rejected key never really asked the
  // prompt, so that return to planned does not use up one of its retries.
  const attempts = options.countAttempt === false ? run.attempts : run.attempts + 1;
  await transition(run, "planned", { leaseOwner: null, leaseExpiresAt: null, attempts });
}

// ---------------------------------------------------------------------------
// Automated lanes: consumer-web routes through collection providers.
// ---------------------------------------------------------------------------

/** What a lane hands an adapter for one prompt. */
export interface AdapterArgs {
  userContent: string;
  /** ISO alpha-2 country to observe from; null lets the vendor choose. */
  country: string | null;
  locale: string;
}

/** One provider answer, normalised across adapters, with what the lane pacer needs. */
export interface AdapterResult {
  ok: boolean;
  text?: string;
  error?: string;
  latencyMs: number;
  model: string;
  sources?: Array<{ url: string; title: string | null }>;
  searched?: boolean;
  /** True when the provider stopped because it hit the output cap. */
  truncated: boolean;
  rate: RateSignal;
  /** Retrying cannot fix this failure. */
  permanent?: boolean;
  /** The vendor's own words for a failure, when it gave any. */
  detail?: string;
  /** The full consumer-surface answer, when the route observes one. */
  consumer?: ConsumerAnswer;
  credits?: { charged: number | null; remaining: number | null } | null;
}

/** What a provider told us about its own rate limits on this call. */
export interface RateSignal {
  retryAfterMs: number | null;
  remainingTokens: number | null;
  limitTokens: number | null;
  resetTokensMs: number | null;
}

export const NO_RATE_SIGNAL: RateSignal = { retryAfterMs: null, remainingTokens: null, limitTokens: null, resetTokensMs: null };

interface Adapter {
  available: boolean;
  run: (args: AdapterArgs) => Promise<AdapterResult>;
  adapterVersion: string;
  disabledCode: string;
}

/** Which collector serves a route, and whether its key is present. */
function adapterFor(providerExperience: string): Adapter | null {
  const route = consumerWebRoute(providerExperience);
  if (!route) return null;
  const collector = COLLECTORS[route.vendor];
  return {
    available: collector.isAvailable() && collector.supports(route.engine),
    adapterVersion: collector.adapterVersion,
    disabledCode: `${route.vendor}_disabled`,
    run: async (args) => {
      const result = await collector.collect({ engine: route.engine, prompt: args.userContent, country: args.country, locale: args.locale });
      if (!result.ok) {
        return {
          ok: false,
          error: result.error,
          latencyMs: result.latencyMs,
          model: "unknown",
          truncated: false,
          permanent: result.permanent,
          detail: result.detail,
          rate: { ...NO_RATE_SIGNAL, retryAfterMs: result.retryAfterMs },
          credits: result.credits ?? null,
        };
      }
      return {
        ok: true,
        text: result.text,
        latencyMs: result.latencyMs,
        model: result.model ?? "unknown",
        sources: result.sources.filter((source) => source.kind === "citation").map((source) => ({ url: source.url, title: source.title })),
        searched: result.searched ?? undefined,
        truncated: false,
        rate: NO_RATE_SIGNAL,
        consumer: result,
        credits: result.credits,
      };
    },
  };
}

/** Whether a route can be collected automatically right now. */
export function automatedRouteAvailable(providerExperience: string): boolean {
  return Boolean(adapterFor(providerExperience)?.available);
}

/** A failure retrying cannot fix: no key, rejected credentials, no credits, a payload shape this build does not know. */
export function isPermanentFailure(error: string | null | undefined): boolean {
  return /disabled|auth_failed|model_unavailable|billing_required|schema_unrecognised|engine_unsupported|http_40[0-4]\b/.test(error ?? "");
}

/** A failure that says the site, not the vendor, refused: counts toward the lane breaker. */
export function isTargetFailure(error: string | null | undefined): boolean {
  return /^(target_blocked|empty_response|schema_unrecognised)/.test(error ?? "");
}

export interface AutomatedRunOutcome {
  state: "succeeded" | "rate_limited" | "failed" | "skipped";
  error: string | null;
  permanent: boolean;
  latencyMs: number | null;
  rate: RateSignal;
  credits?: { charged: number | null; remaining: number | null } | null;
}

/**
 * Where an observation is made from, and which market it is about.
 *
 * The execution country is the project's primary market country, so the
 * vendor's proxy sits where the buyer would; a worldwide project falls back to
 * SUN_COLLECTION_DEFAULT_COUNTRY (US). Both facts are stored separately on the
 * row: the country is the provider-declared origin, the market is what the
 * prompt is about. They are never swapped.
 */
export async function observationGeography(projectId: string): Promise<{ country: string; countrySource: "market" | "default"; intendedMarket: string | null }> {
  const project = await getProject(projectId);
  const hint = parseMarketHint(project?.marketScope);
  const fromMarket = hintCountry(hint);
  const fallback = (process.env.SUN_COLLECTION_DEFAULT_COUNTRY ?? "US").trim().toUpperCase();
  return {
    country: fromMarket ?? (/^[A-Z]{2}$/.test(fallback) ? fallback : "US"),
    countrySource: fromMarket ? "market" : "default",
    intendedMarket: hint ? describeMarketHint(hint) : null,
  };
}

function sessionProfileFor(answer: ConsumerAnswer, country: string | null, countrySource: "market" | "default"): SessionProfile {
  const vendor = VENDORS[answer.vendor].name;
  const search = answer.searchMode === "forced" ? "web search forced on by the provider" : answer.searchMode === "permitted" ? "web search permitted, the page decided" : answer.searchMode === "off" ? "web search off" : "web search state not reported";
  const origin = country === null ? "not controlled or reported by the provider" : countrySource === "market" ? "the project's market country" : "the default country (no market set)";
  return {
    signedIn: false,
    accountTier: "none",
    temporaryChat: null,
    personalizationDisabled: true,
    customInstructionsDisabled: true,
    freshConversation: true,
    notes: `Signed-out ${answer.site} session collected by ${vendor}; ${search}; execution country ${country ?? "unknown"} = ${origin}${country ? ", provider-declared proxy exit" : ""}. Surface markers: ${Object.entries(answer.markers)
      .filter(([, value]) => value)
      .map(([key]) => key)
      .join(", ") || "none"}.`,
  };
}

export async function runAutomatedPromptRun(promptRunId: string): Promise<AutomatedRunOutcome> {
  const run = await getPromptRun(promptRunId);
  if (!run) throw new Error(`prompt_run ${promptRunId} not found`);
  const adapter = adapterFor(run.providerExperience);
  if (!adapter) throw new Error(`no automated adapter for ${run.providerExperience}`);
  // Only a planned run is ours to execute. Anything else was claimed by
  // another worker or has already finished, and touching it would either
  // double-collect or violate the state machine.
  if (run.state !== "planned") {
    return { state: "skipped", error: `prompt run is ${run.state}`, permanent: false, latencyMs: null, rate: NO_RATE_SIGNAL };
  }
  if (!adapter.available) {
    // planned -> failed is not a legal transition; the previous code attempted
    // it directly and threw whenever a key was missing.
    await transition(run, "running");
    await transition((await getPromptRun(promptRunId))!, "failed", { lastError: adapter.disabledCode });
    return { state: "failed", error: adapter.disabledCode, permanent: true, latencyMs: null, rate: NO_RATE_SIGNAL };
  }

  const collectionRun = await getCollectionRun(run.collectionRunId);
  if (!collectionRun) throw new Error(`collection_run ${run.collectionRunId} not found`);
  const candidate = await getCandidateForRun(run);
  const geography = await observationGeography(collectionRun.projectId);
  await transition(run, "running");
  const started = Date.now();
  const result = await adapter.run({ userContent: candidate.text, country: geography.country, locale: candidate.language });
  const runningRow = (await getPromptRun(promptRunId))!;

  if (!result.ok) {
    if (result.error === "rate_limited") {
      await transition(runningRow, "rate_limited", { lastError: result.error });
      return { state: "rate_limited", error: result.error, permanent: false, latencyMs: result.latencyMs, rate: result.rate, credits: result.credits ?? null };
    }
    const error = result.error ?? "unknown_error";
    await transition(runningRow, "failed", { lastError: error });
    return { state: "failed", error, permanent: result.permanent ?? isPermanentFailure(error), latencyMs: result.latencyMs, rate: result.rate, credits: result.credits ?? null };
  }

  const answer = result.consumer;
  if (!answer) {
    // Every active route observes a consumer surface; an adapter without one is a programming error, not a data state.
    await transition(runningRow, "failed", { lastError: "adapter_without_consumer_answer" });
    return { state: "failed", error: "adapter_without_consumer_answer", permanent: true, latencyMs: result.latencyMs, rate: result.rate };
  }

  const stored = storeEvidence(collectionRun.projectId, answer.text);
  const verified = markersPass(answer.markers);
  const citations = answer.sources.filter((source) => source.kind === "citation").map((source) => source.url);
  const inline = answer.sources.filter((source) => source.kind === "inline_link").map((source) => source.url);
  const responseId = newId("pres");

  // Source capture, honestly:
  //   citations present            -> complete (the page listed them)
  //   search reported off, none    -> none_present (the page had no sources)
  //   search on or unknown, none   -> unknown (a sources panel may have been missed; never a zero)
  //   markers fail                 -> unknown (nothing proves which surface this was)
  const sourcesCaptureState: SourcesCaptureState = !verified ? "unknown" : citations.length > 0 ? "complete" : answer.searched === false ? "none_present" : "unknown";
  const searchState: SearchState = answer.searched === true ? "on" : answer.searched === false ? "off" : "unknown";

  await insertProviderResponse({
    id: responseId,
    promptRunId,
    providerExperience: run.providerExperience,
    route: "consumer_app",
    method: "automated_partner",
    // Only what the page named. cloro and Bright Data usually cannot read it;
    // "unknown" is the honest value, never a guess at what OpenAI serves.
    visibleModelMode: answer.model ?? "unknown",
    searchState,
    accountTier: "signed_out",
    locale: candidate.language,
    // Only the country the vendor confirmed. A vendor that did not take or
    // echo a country (Decodo without geo) leaves the origin unknown; the
    // market country is never written in its place.
    observerRegion: answer.country,
    observerRegionSource: answer.country ? "provider_declared" : "unknown",
    intendedMarket: candidate.geographyText ?? geography.intendedMarket,
    sessionProfile: sessionProfileFor(answer, answer.country, geography.countrySource) as unknown as Record<string, unknown>,
    responseText: answer.text,
    sourceUrls: citations,
    inlineCitationUrls: inline,
    sourcesCaptureState,
    // The provider returns the whole page; a blank one was already rejected as
    // empty_response. Nothing here can tell a cut-off answer from a short one,
    // so "complete" is asserted only when the surface markers held.
    answerCaptureState: verified ? "complete" : "unknown",
    rawHash: stored.hash,
    latencyMs: Date.now() - started,
    observedAt: new Date(),
    adapterVersion: adapter.adapterVersion,
    parserVersion: null,
    policyVersion: POLICY_VERSION,
    isFixture: false,
    fixtureLabel: null,
  });

  // Evidence next to the row: the vendor payload verbatim and the rendered
  // page when the vendor returned it. Losing an artifact never loses the answer.
  storeArtifact(collectionRun.projectId, responseId, "payload.json", JSON.stringify({ vendor: answer.vendor, route: run.providerExperience, requestId: answer.vendorRequestId, country: answer.country, markers: answer.markers, payload: answer.rawPayload }, null, 2));
  if (answer.html) storeArtifact(collectionRun.projectId, responseId, "page.html", answer.html);

  if (!verified) {
    appendEvent(collectionRun.projectId, "collection_run.progress", {
      collectionRunId: run.collectionRunId,
      promptRunId,
      status: "surface_unverified",
      route: run.providerExperience,
      markers: answer.markers,
    });
  }

  // Structured evidence for Measure. The raw observation is already committed
  // and hashed above, so an analysis fault costs an interpretation, never a
  // collected answer.
  try {
    await normalizeProviderResponse(responseId, collectionRun.projectId);
    await analyseObservationById(collectionRun.projectId, responseId);
  } catch (error) {
    appendEvent(collectionRun.projectId, "collection_run.progress", {
      collectionRunId: run.collectionRunId,
      promptRunId,
      status: "analysis_failed",
      detail: error instanceof Error ? error.message : String(error),
    });
  }
  await transition(runningRow, "succeeded");
  return { state: "succeeded", error: null, permanent: false, latencyMs: result.latencyMs, rate: result.rate, credits: result.credits ?? null };
}

export interface CanaryOutcome {
  ok: boolean;
  route: string;
  /** Why it failed: the adapter's error, or `surface_unverified` when the answer lacked site markers. */
  reason: string | null;
  /** The vendor's own words for a failure, when it gave any. */
  detail: string | null;
  latencyMs: number;
  model: string | null;
  searched: boolean | null;
  citations: number;
  markers: ConsumerAnswer["markers"] | null;
  credits: { charged: number | null; remaining: number | null } | null;
}

/**
 * One fixed, brand-neutral prompt through a route, judged the way a real
 * answer would be. Writes nothing. Costs one vendor request.
 */
export async function runVendorCanary(providerExperience: string, country: string | null = null): Promise<CanaryOutcome> {
  const adapter = adapterFor(providerExperience);
  const started = Date.now();
  if (!adapter || !adapter.available) {
    return { ok: false, route: providerExperience, reason: adapter?.disabledCode ?? "no_adapter", detail: null, latencyMs: 0, model: null, searched: null, citations: 0, markers: null, credits: null };
  }
  const result = await adapter.run({ userContent: CANARY_PROMPT, country, locale: "en" });
  if (!result.ok || !result.consumer) {
    return { ok: false, route: providerExperience, reason: result.error ?? "unknown_error", detail: result.detail ?? null, latencyMs: Date.now() - started, model: null, searched: null, citations: 0, markers: null, credits: result.credits ?? null };
  }
  const answer = result.consumer;
  const passed = markersPass(answer.markers);
  return {
    ok: passed,
    route: providerExperience,
    reason: passed ? null : "surface_unverified",
    detail: null,
    latencyMs: Date.now() - started,
    model: answer.model,
    searched: answer.searched,
    citations: answer.sources.filter((source) => source.kind === "citation").length,
    markers: answer.markers,
    credits: answer.credits,
  };
}

/** The consumer-web routes in the order they are tried, with whether each can run now. For the console. */
export function routeAvailability(): Array<{ id: string; engine: AnswerEngine; vendor: CollectionVendor; keyed: boolean; healthy: boolean; enabled: boolean }> {
  const order = orderedCollectionRoutes();
  return [...CONSUMER_WEB_ROUTES]
    .sort((a, b) => (order.indexOf(a.id) === -1 ? 99 : order.indexOf(a.id)) - (order.indexOf(b.id) === -1 ? 99 : order.indexOf(b.id)))
    .map((route) => ({ id: route.id, engine: route.engine, vendor: route.vendor, keyed: routeCredentialPresent(route.id), healthy: isRouteHealthy(route.id), enabled: engineEnabled(route.engine) }));
}

async function getCandidateForRun(run: PromptRun) {
  const promptSet = await getPromptSetForRun(run);
  const candidates = await listCandidates(promptSet.id);
  const candidate = candidates.find((c) => c.id === run.promptCandidateId);
  if (!candidate) throw new Error(`candidate ${run.promptCandidateId} not found`);
  return { text: candidate.editedText ?? candidate.text, language: candidate.language, geographyText: candidate.geographyText ?? null };
}

async function getPromptSetForRun(run: PromptRun) {
  const collectionRun = await getCollectionRun(run.collectionRunId);
  if (!collectionRun) throw new Error(`collection_run ${run.collectionRunId} not found`);
  const promptSet = await getPromptSet(collectionRun.promptSetId);
  if (!promptSet) throw new Error(`prompt_set ${collectionRun.promptSetId} not found`);
  return promptSet;
}
