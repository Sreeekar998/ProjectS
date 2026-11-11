// Background collection runner.
//
// WHY THIS EXISTS
//
// Collection used to be one sequential loop inside one HTTP request. Every
// observation waited for the previous one and the page refreshed only when the
// request finally returned. Now:
//   1. Each route is an independent LANE and lanes run concurrently.
//   2. Pacing follows what the provider reports rather than a guess.
//   3. The run executes in the background. The route returns at once, and the
//      page reads progress and partial measurement while work continues.
//
// COLLECTION PROVIDERS (2026-09-14)
//
// Every active lane observes a consumer website through a collection provider
// (Bright Data, cloro, Decodo). A provider can stop working with no change on
// our side, so a lane now:
//   * asks a CANARY prompt first, unless the vendor passed one recently, and
//     hands the run to the next vendor for the same engine if it fails;
//   * trips a BREAKER after three blocked or blank answers in a row and hands
//     the rest of the run to the next vendor;
//   * stops at a per-lane REQUEST CAP and when the vendor reports that credits
//     are nearly gone, so a run never crosses from free into paid by accident;
//   * when no vendor is left, pauses honestly and re-checks every half hour
//     for a day. The rows stay "not collected", never "absent".
// A fallback changes the ROUTE, never the label: the replacement is always the
// same engine on the same surface, and every row keeps its own route id.
//
// One local process owns the runner. State lives on globalThis so a dev hot
// reload cannot start a second runner for the same collection run.

import { appendEvent } from "@/lib/events/bus";
import { loadCredentials } from "@/lib/providers/credentials";
import { listCandidates } from "@/lib/prompts/repository";
import { engineOf, isConsumerWebRoute } from "@/lib/providers/engines";
import { consumerWebRoute } from "@/lib/providers/catalog";
import { getCollectionRun, listPromptRuns, updatePromptRun } from "./repository";
import { finaliseCollectionRun, RunFinalisedError, runFullyAnalysed } from "./finalise";
import {
  automatedRouteAvailable,
  isPermanentFailure,
  isTargetFailure,
  nextRouteForEngine,
  NO_RATE_SIGNAL,
  observationGeography,
  retryPromptRun,
  runAutomatedPromptRun,
  runVendorCanary,
  switchAutomatedRoute,
  type AutomatedRunOutcome,
} from "./orchestrator";
import { canaryDue, isRouteHealthy, markCanaryPassed, markUnhealthy, UNHEALTHY_AFTER_BREAKER_MS, UNHEALTHY_AFTER_CANARY_MS } from "./vendor-health";

export type LaneStatus = "waiting" | "checking" | "running" | "paced" | "paused" | "done";

export interface LaneProgress {
  provider: string;
  total: number;
  succeeded: number;
  failed: number;
  retries: number;
  inFlight: number;
  status: LaneStatus;
  /** While paced: when the lane resumes, and why it is waiting. */
  resumesAt: number | null;
  paceReason: string | null;
  avgCycleMs: number | null;
  etaMs: number | null;
  /** The route this lane's unfinished prompts moved to, when it handed over. */
  continuedOn: string | null;
  /** Vendor requests this lane made in this run (successes, failures and the canary). */
  requests: number;
}

export interface RunnerProgress {
  collectionRunId: string;
  projectId: string;
  status: "running" | "completed";
  startedAt: number;
  finishedAt: number | null;
  lanes: LaneProgress[];
  /** Set when a paused run will be re-checked automatically. */
  recheckAt: number | null;
}

interface Pacer {
  /** Resolves when the next call may start; reports any wait through onWait. */
  acquire(onWait: (untilMs: number, reason: string) => void): Promise<void>;
  record(outcome: AutomatedRunOutcome): void;
}

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, Math.max(0, ms)));

/**
 * Paces a lane against a tokens-per-minute budget the provider reports.
 * Kept for providers that meter tokens; no active lane uses it today.
 */
export class TokenBudgetPacer implements Pacer {
  private remaining: number | null = null;
  private limit = 8000;
  private observedAt = 0;
  private resetAt = 0;
  private blockedUntil = 0;

  constructor(private readonly costEstimate = 2600) {}

  async acquire(onWait: (untilMs: number, reason: string) => void): Promise<void> {
    for (;;) {
      const now = Date.now();
      let waitUntil = this.blockedUntil;
      let reason = "the provider asked us to retry later";
      if (this.remaining !== null && now < this.resetAt) {
        const perMs = this.limit / 60_000;
        const projected = this.remaining + (now - this.observedAt) * perMs;
        if (projected < this.costEstimate) {
          const refillAt = Math.min(now + Math.ceil((this.costEstimate - projected) / perMs), this.resetAt);
          if (refillAt > waitUntil) {
            waitUntil = refillAt;
            reason = "token-per-minute budget refilling";
          }
        }
      }
      if (waitUntil <= now) return;
      onWait(waitUntil, reason);
      await sleep(waitUntil - now);
    }
  }

  record(outcome: AutomatedRunOutcome): void {
    const rate = outcome.rate;
    if (rate.limitTokens) this.limit = rate.limitTokens;
    if (rate.remainingTokens !== null) {
      this.remaining = rate.remainingTokens;
      this.observedAt = Date.now();
    }
    if (rate.resetTokensMs !== null) this.resetAt = Date.now() + rate.resetTokensMs;
    if (outcome.state === "rate_limited") {
      this.blockedUntil = Date.now() + (rate.retryAfterMs ?? Math.max(rate.resetTokensMs ?? 0, 10_000));
    }
  }
}

/**
 * Paces a lane against a requests-per-minute window.
 *
 * For providers that do not report remaining quota. The window is kept below
 * the published rate so a normal run never meets a 429, and a stated retry
 * delay overrides the window when one does arrive.
 */
export class RequestWindowPacer implements Pacer {
  private starts: number[] = [];
  private blockedUntil = 0;

  constructor(private readonly perMinute: number) {}

  async acquire(onWait: (untilMs: number, reason: string) => void): Promise<void> {
    for (;;) {
      const now = Date.now();
      this.starts = this.starts.filter((startedAt) => now - startedAt < 60_000);
      let waitUntil = this.blockedUntil;
      let reason = "the provider asked us to retry later";
      if (this.starts.length >= this.perMinute) {
        const windowOpens = this.starts[0]! + 60_000 + 50;
        if (windowOpens > waitUntil) {
          waitUntil = windowOpens;
          reason = `request window full (${this.perMinute} per minute)`;
        }
      }
      if (waitUntil <= now) {
        // Recorded before any await, so concurrent workers cannot both take
        // the last slot in the window.
        this.starts.push(now);
        return;
      }
      onWait(waitUntil, reason);
      await sleep(waitUntil - now);
    }
  }

  record(outcome: AutomatedRunOutcome): void {
    if (outcome.state === "rate_limited") this.blockedUntil = Date.now() + (outcome.rate.retryAfterMs ?? 20_000);
  }
}

interface LaneConfig {
  concurrency: number;
  pacer: () => Pacer;
  maxRateLimitRetries: number;
  maxTransientRetries: number;
  /** Credits one answer costs on this vendor, for the low-credit check. */
  creditsPerAnswer: number;
}

/**
 * Order observations are collected in, per lane.
 *
 * Discovery Visibility is the headline metric and is built only from Discovery
 * prompts. Collecting them first means the numbers a reader looks at first
 * stop moving earliest, instead of shifting until the last answer of the run.
 */
const SECTION_PRIORITY: Record<string, number> = { Discovery: 0, "Trade Offs": 1, "Sentiment Analysis": 2 };

function envInt(name: string, fallback: number): number {
  const raw = Number(process.env[name]);
  return Number.isFinite(raw) && raw >= 1 ? Math.floor(raw) : fallback;
}

const LANES: Record<string, LaneConfig> = {
  // Bright Data's synchronous endpoint answers 202 after about a minute and
  // the snapshot then takes five to twelve minutes (measured 2026-09-15), so
  // five in flight keeps a 30-prompt run near an hour; the account allows far
  // more concurrency than that.
  chatgpt_brightdata_web: { concurrency: envInt("SUN_BRIGHTDATA_CONCURRENCY", 5), pacer: () => new RequestWindowPacer(20), maxRateLimitRetries: 3, maxTransientRetries: 2, creditsPerAnswer: 1 },
  // cloro allows one concurrent job on the free tier and meters it per key;
  // the client gates concurrency itself, so the lane count only sets how many
  // prompts wait at that gate.
  chatgpt_cloro_web: { concurrency: envInt("SUN_CLORO_CONCURRENCY", 1), pacer: () => new RequestWindowPacer(30), maxRateLimitRetries: 3, maxTransientRetries: 2, creditsPerAnswer: 7 },
  gemini_cloro_web: { concurrency: envInt("SUN_CLORO_CONCURRENCY", 1), pacer: () => new RequestWindowPacer(30), maxRateLimitRetries: 3, maxTransientRetries: 2, creditsPerAnswer: 7 },
  // Decodo renders every ChatGPT request; two at a time stays well inside the
  // free plan's rate limits.
  chatgpt_decodo_web: { concurrency: 2, pacer: () => new RequestWindowPacer(20), maxRateLimitRetries: 3, maxTransientRetries: 2, creditsPerAnswer: 1 },
  // Oxylabs jobs are polled and take about 45 s each (measured 2026-09-15);
  // the free trial allows 3 rendered jobs a second, so five in flight is well
  // inside it and a 30-prompt run finishes in about five minutes.
  chatgpt_oxylabs_web: { concurrency: envInt("SUN_OXYLABS_CONCURRENCY", 5), pacer: () => new RequestWindowPacer(20), maxRateLimitRetries: 3, maxTransientRetries: 2, creditsPerAnswer: 1 },
};

/** Vendor requests one lane may make in one run: 30 prompts, a canary and a retry allowance. */
function laneRequestCap(): number {
  return envInt("SUN_COLLECTION_MAX_REQUESTS_PER_LANE", 60);
}

/** After a run pauses with no vendor left, how often and for how long it re-checks. */
const RECHECK_INTERVAL_MS = 30 * 60_000;
const RECHECK_ATTEMPTS = 48;

interface Registry {
  runs: Map<string, RunnerProgress>;
  done: Map<string, Promise<void>>;
  lastEmit: Map<string, number>;
  rechecks: Map<string, { timer: ReturnType<typeof setTimeout>; attempts: number }>;
}

const registry: Registry = ((globalThis as unknown as { __sunCollectionRunner?: Registry }).__sunCollectionRunner ??= {
  runs: new Map(),
  done: new Map(),
  lastEmit: new Map(),
  rechecks: new Map(),
});
// Older hot-reloaded registries predate the recheck map.
registry.rechecks ??= new Map();

function emit(progress: RunnerProgress, force = false): void {
  const now = Date.now();
  if (!force && now - (registry.lastEmit.get(progress.collectionRunId) ?? 0) < 750) return;
  registry.lastEmit.set(progress.collectionRunId, now);
  appendEvent(progress.projectId, "collection_run.progress", {
    collectionRunId: progress.collectionRunId,
    status: progress.status,
    lanes: progress.lanes,
    recheckAt: progress.recheckAt,
  });
}

/** Live progress for a run this process is executing or has just finished. */
export function getRunnerProgress(collectionRunId: string): RunnerProgress | null {
  return registry.runs.get(collectionRunId) ?? null;
}

function newLane(provider: string, rows: Array<{ providerExperience: string; state: string }>): LaneProgress {
  const own = rows.filter((row) => row.providerExperience === provider && row.state !== "policy_disabled");
  return {
    provider,
    total: own.length,
    succeeded: own.filter((row) => row.state === "succeeded").length,
    failed: 0,
    retries: 0,
    inFlight: 0,
    status: "waiting",
    resumesAt: null,
    paceReason: null,
    avgCycleMs: null,
    etaMs: null,
    continuedOn: null,
    requests: 0,
  };
}

/**
 * Starts collecting a run in the background and returns immediately.
 *
 * Idempotent: a run already in progress returns its live progress rather than
 * starting a second runner. Failed and rate-limited observations from an
 * earlier attempt are re-queued, so "collect the rest" fills real gaps.
 */
export async function startCollection(collectionRunId: string): Promise<RunnerProgress> {
  const existing = registry.runs.get(collectionRunId);
  if (existing?.status === "running") return existing;
  cancelRecheck(collectionRunId);

  await loadCredentials();
  const run = await getCollectionRun(collectionRunId);
  if (!run) throw new Error(`collection_run ${collectionRunId} not found`);
  // A finalised run is a measurement; it never gains answers afterwards.
  if (run.status === "completed") throw new RunFinalisedError(collectionRunId);
  const promptRuns = await listPromptRuns(collectionRunId);
  const providers = [...new Set(promptRuns.map((row) => row.providerExperience))].filter(
    (provider) => LANES[provider] && automatedRouteAvailable(provider),
  );

  const progress: RunnerProgress = {
    collectionRunId,
    projectId: run.projectId,
    status: "running",
    startedAt: Date.now(),
    finishedAt: null,
    lanes: providers.map((provider) => newLane(provider, promptRuns)),
    recheckAt: null,
  };
  registry.runs.set(collectionRunId, progress);
  emit(progress, true);

  const done = execute(progress);
  registry.done.set(collectionRunId, done);
  return progress;
}

/** Starts (or joins) a run and waits for it to finish. For scripts and tests. */
export async function runCollectionToCompletion(
  collectionRunId: string,
): Promise<{ attempted: number; succeeded: number; rateLimited: number; failed: number }> {
  const before = await listPromptRuns(collectionRunId);
  const succeededBefore = before.filter((row) => row.state === "succeeded").length;
  const attempted = before.filter((row) => row.state !== "succeeded" && row.state !== "policy_disabled").length;
  await startCollection(collectionRunId);
  await registry.done.get(collectionRunId);
  const after = await listPromptRuns(collectionRunId);
  return {
    attempted,
    succeeded: after.filter((row) => row.state === "succeeded").length - succeededBefore,
    rateLimited: after.filter((row) => row.state === "rate_limited").length,
    failed: after.filter((row) => row.state === "failed").length,
  };
}

async function execute(progress: RunnerProgress): Promise<void> {
  // Lanes can be appended while others run (a handover to the next vendor),
  // so the loop re-reads the list until every lane has finished.
  const started = new Set<LaneProgress>();
  for (;;) {
    const pending = progress.lanes.filter((lane) => !started.has(lane));
    if (pending.length === 0) break;
    await Promise.all(
      pending.map(async (lane) => {
        started.add(lane);
        try {
          await runLane(progress, lane);
        } catch (error) {
          appendEvent(progress.projectId, "collection_run.progress", {
            collectionRunId: progress.collectionRunId,
            provider: lane.provider,
            status: "lane_failed",
            detail: error instanceof Error ? error.message : String(error),
          });
        } finally {
          // A paused lane keeps its reason so the console can say why it stopped.
          if (lane.status !== "paused") {
            lane.status = "done";
            lane.resumesAt = null;
            lane.paceReason = null;
          }
          lane.inFlight = 0;
          lane.etaMs = 0;
        }
      }),
    );
  }
  progress.status = "completed";
  progress.finishedAt = Date.now();
  scheduleRecheckIfStranded(progress);
  emit(progress, true);
  // Every planned answer collected and analysed: the run is a measurement.
  // A partial run stays open for "collect the rest" or the operator's close.
  try {
    if (await runFullyAnalysed(progress.collectionRunId)) await finaliseCollectionRun(progress.collectionRunId, "auto");
  } catch (error) {
    appendEvent(progress.projectId, "collection_run.progress", {
      collectionRunId: progress.collectionRunId,
      status: "finalise_failed",
      detail: error instanceof Error ? error.message : String(error),
    });
  }
}

/**
 * When every vendor for an engine is unreachable the run pauses. It is
 * re-checked every half hour for a day: a login wall or a format change on the
 * site usually clears within hours, and the operator should not have to keep
 * pressing Collect to find out.
 */
function scheduleRecheckIfStranded(progress: RunnerProgress): void {
  const stranded = progress.lanes.some((lane) => lane.status === "paused" && (lane.paceReason === "vendor_unhealthy" || lane.paceReason === "target_blocked") && lane.continuedOn === null);
  if (!stranded) return;
  const previous = registry.rechecks.get(progress.collectionRunId);
  const attempts = (previous?.attempts ?? 0) + 1;
  if (attempts > RECHECK_ATTEMPTS) return;
  if (previous) clearTimeout(previous.timer);
  const timer = setTimeout(() => {
    registry.rechecks.delete(progress.collectionRunId);
    startCollection(progress.collectionRunId).catch(() => undefined);
  }, RECHECK_INTERVAL_MS);
  // Never keep the process alive only to re-check a run.
  (timer as { unref?: () => void }).unref?.();
  registry.rechecks.set(progress.collectionRunId, { timer, attempts });
  progress.recheckAt = Date.now() + RECHECK_INTERVAL_MS;
}

export function cancelRecheck(collectionRunId: string): void {
  const previous = registry.rechecks.get(collectionRunId);
  if (!previous) return;
  clearTimeout(previous.timer);
  // Attempts are kept so a stranded run still stops re-checking after a day.
  registry.rechecks.set(collectionRunId, { timer: previous.timer, attempts: previous.attempts });
}

/**
 * When a lane stops waiting and pauses. A per-minute limit states a retry-after
 * under a minute; anything much longer is a daily quota, which does not refill
 * within a run. A provider that refuses several requests in a row without one
 * success is treated the same way.
 */
const QUOTA_PAUSE_MS = 3 * 60_000;
const LIMITS_BEFORE_PAUSE = 4;
/** Blocked or blank answers in a row before the lane hands over to the next vendor. */
const TARGET_FAILURES_BEFORE_HANDOVER = 3;

function pause(progress: RunnerProgress, lane: LaneProgress, reason: string, resumesAt: number | null = null): void {
  lane.status = "paused";
  lane.paceReason = reason;
  lane.resumesAt = resumesAt;
  lane.etaMs = null;
  emit(progress, true);
}

/**
 * Hands a paused lane's unfinished prompts to the next healthy vendor for the
 * same engine and surface, and runs that lane. Returns false when no vendor is
 * left, in which case the lane stays paused and the run re-checks later.
 */
async function handOver(progress: RunnerProgress, lane: LaneProgress): Promise<boolean> {
  if (!isConsumerWebRoute(lane.provider)) return false;
  const used = progress.lanes.map((item) => item.provider);
  const next = nextRouteForEngine(engineOf(lane.provider), used);
  if (!next) return false;
  try {
    await switchAutomatedRoute(progress.collectionRunId, lane.provider, next);
  } catch (error) {
    appendEvent(progress.projectId, "collection_run.progress", {
      collectionRunId: progress.collectionRunId,
      provider: lane.provider,
      status: "handover_failed",
      detail: error instanceof Error ? error.message : String(error),
    });
    return false;
  }
  lane.continuedOn = next;
  const rows = await listPromptRuns(progress.collectionRunId);
  const replacement = newLane(next, rows);
  progress.lanes.push(replacement);
  appendEvent(progress.projectId, "collection_run.progress", { collectionRunId: progress.collectionRunId, status: "handover", from: lane.provider, to: next });
  emit(progress, true);
  // execute() picks the new lane up on its next pass; nothing to await here.
  return true;
}

async function runLane(progress: RunnerProgress, lane: LaneProgress): Promise<void> {
  const config = LANES[lane.provider]!;
  const pacer = config.pacer();
  const route = consumerWebRoute(lane.provider);

  // Re-queue what an earlier attempt could not collect for a transient reason.
  const initial = (await listPromptRuns(progress.collectionRunId)).filter((row) => row.providerExperience === lane.provider);

  // A row left in "running" with no runner behind it was orphaned by a server
  // restart mid-call. The runner only ever picks up planned rows, so without
  // this it would sit in "running" forever. startCollection guarantees no live
  // runner owns this run here, so every running row is an orphan. The state
  // machine has no running -> planned edge, so it is recorded as an
  // interrupted failure first, which keeps the interruption in the history.
  for (const row of initial.filter((candidate) => candidate.state === "running")) {
    const history = [...((row.attemptHistory as Array<{ at: number; state: string; note?: string }>) ?? []), { at: Date.now(), state: "failed", note: "interrupted" }];
    await updatePromptRun(row.id, { state: "failed", lastError: "interrupted", attemptHistory: history });
    row.state = "failed";
    row.lastError = "interrupted";
  }
  for (const row of initial) {
    const retryable = row.state === "rate_limited" || (row.state === "failed" && !isPermanentFailure(row.lastError));
    if (retryable && row.attempts < config.maxRateLimitRetries) await retryPromptRun(row.id);
  }

  const rows = (await listPromptRuns(progress.collectionRunId)).filter((row) => row.providerExperience === lane.provider);
  const run = await getCollectionRun(progress.collectionRunId);
  const sectionOf = new Map((run ? await listCandidates(run.promptSetId) : []).map((candidate) => [candidate.id, candidate.section ?? ""]));
  const rank = (promptCandidateId: string) => SECTION_PRIORITY[sectionOf.get(promptCandidateId) ?? ""] ?? 3;
  const queue = rows
    .filter((row) => row.state === "planned")
    .sort((a, b) => rank(a.promptCandidateId) - rank(b.promptCandidateId))
    .map((row) => row.id);
  lane.failed = rows.filter((row) => row.state === "failed" || row.state === "rate_limited").length;
  if (queue.length === 0) return;

  // A vendor already known to be down is not asked again this run.
  if (route && !isRouteHealthy(lane.provider)) {
    pause(progress, lane, "vendor_unhealthy");
    await handOver(progress, lane);
    return;
  }

  // The canary: one brand-neutral prompt, judged like a real answer. A vendor
  // that cannot pass it would turn thirty credits into thirty gaps.
  if (route && canaryDue(lane.provider)) {
    lane.status = "checking";
    emit(progress, true);
    const geography = run ? await observationGeography(run.projectId) : null;
    const canary = await runVendorCanary(lane.provider, geography?.country ?? null);
    lane.requests += 1;
    appendEvent(progress.projectId, "collection_run.progress", {
      collectionRunId: progress.collectionRunId,
      provider: lane.provider,
      status: canary.ok ? "canary_passed" : "canary_failed",
      reason: canary.reason,
      latencyMs: canary.latencyMs,
      model: canary.model,
      searched: canary.searched,
      citations: canary.citations,
      markers: canary.markers,
    });
    if (!canary.ok) {
      if (/^(billing_required|auth_failed)/.test(canary.reason ?? "")) {
        pause(progress, lane, canary.reason!.startsWith("billing_required") ? "no_credits" : "key_rejected");
        await handOver(progress, lane);
        return;
      }
      markUnhealthy(lane.provider, UNHEALTHY_AFTER_CANARY_MS, canary.reason ?? "canary_failed");
      pause(progress, lane, "vendor_unhealthy");
      await handOver(progress, lane);
      return;
    }
    markCanaryPassed(lane.provider);
  }

  lane.status = "running";
  const cycles: number[] = [];
  const attempts = new Map<string, { rate: number; transient: number }>();
  let consecutiveLimits = 0;
  let consecutiveTargetFailures = 0;
  let paused = false;
  const cap = laneRequestCap();

  const worker = async () => {
    for (;;) {
      const id = queue.shift();
      if (!id) return;
      const cycleStartedAt = Date.now();

      // The request cap is the last line against a runaway lane: a vendor that
      // keeps answering "retry" would otherwise spend the whole free tier on
      // one run.
      if (lane.requests >= cap) {
        // The prompt was never asked, so it is still planned and a later
        // Collect picks it up; clearing the queue stops the other workers.
        queue.length = 0;
        paused = true;
        pause(progress, lane, "budget_cap");
        return;
      }

      await pacer.acquire((untilMs, reason) => {
        lane.status = "paced";
        lane.resumesAt = untilMs;
        lane.paceReason = reason;
        emit(progress);
      });
      // Another worker paused the lane while this one waited; its prompt is
      // still planned and a later Collect picks it up.
      if (paused) return;
      lane.status = "running";
      lane.resumesAt = null;
      lane.paceReason = null;
      lane.inFlight += 1;
      emit(progress);

      let outcome: AutomatedRunOutcome;
      try {
        outcome = await runAutomatedPromptRun(id);
      } catch (error) {
        outcome = { state: "failed", error: error instanceof Error ? error.message : String(error), permanent: false, latencyMs: null, rate: NO_RATE_SIGNAL };
      }
      lane.inFlight -= 1;
      lane.requests += 1;
      pacer.record(outcome);

      if (outcome.state === "rate_limited") {
        // Waiting out a multi-minute retry-after for every remaining prompt, or
        // re-asking a provider that refuses everything, would hold the lane
        // open for hours with nothing to show. The lane pauses instead.
        consecutiveLimits += 1;
        const retryAfterMs = outcome.rate.retryAfterMs ?? 0;
        if (retryAfterMs > QUOTA_PAUSE_MS || consecutiveLimits >= LIMITS_BEFORE_PAUSE) {
          paused = true;
          queue.length = 0;
          pause(progress, lane, retryAfterMs > QUOTA_PAUSE_MS ? "the provider's quota is used up" : "the provider refused every recent request, so its quota is likely used up", retryAfterMs > QUOTA_PAUSE_MS ? Date.now() + retryAfterMs : null);
          return;
        }
      } else if (outcome.state === "succeeded") {
        consecutiveLimits = 0;
        consecutiveTargetFailures = 0;
        lane.succeeded += 1;
        // The vendor says how many credits are left: stop before the last
        // answer would fail, and keep the rest for the next vendor.
        const remaining = outcome.credits?.remaining ?? null;
        if (remaining !== null && remaining < config.creditsPerAnswer && queue.length > 0) {
          paused = true;
          queue.length = 0;
          pause(progress, lane, "no_credits");
          await handOver(progress, lane);
          return;
        }
      } else if (outcome.state === "failed" && /^(billing_required|auth_failed)/.test(outcome.error ?? "")) {
        // No prompt can succeed on an empty balance or a rejected key. The
        // lane pauses, this prompt goes back to planned without counting an
        // attempt, and the rest continues on the next vendor if there is one.
        await retryPromptRun(id, { countAttempt: false }).catch(() => undefined);
        paused = true;
        queue.length = 0;
        pause(progress, lane, outcome.error!.startsWith("billing_required") ? "no_credits" : "key_rejected");
        await handOver(progress, lane);
        return;
      } else if (outcome.state === "failed" && isTargetFailure(outcome.error)) {
        // The site refused or returned a blank page. Once is noise; three in a
        // row is the site or the vendor being down, and the run moves on.
        consecutiveTargetFailures += 1;
        if (consecutiveTargetFailures >= TARGET_FAILURES_BEFORE_HANDOVER) {
          await retryPromptRun(id, { countAttempt: false }).catch(() => undefined);
          markUnhealthy(lane.provider, UNHEALTHY_AFTER_BREAKER_MS, outcome.error ?? "target_blocked");
          paused = true;
          queue.length = 0;
          pause(progress, lane, "target_blocked");
          await handOver(progress, lane);
          return;
        }
      }

      const counts = attempts.get(id) ?? { rate: 0, transient: 0 };
      if (outcome.state === "succeeded") {
        // counted above
      } else if (outcome.state === "rate_limited" && counts.rate < config.maxRateLimitRetries) {
        counts.rate += 1;
        attempts.set(id, counts);
        lane.retries += 1;
        await retryPromptRun(id);
        queue.push(id);
      } else if (outcome.state === "failed" && !outcome.permanent && counts.transient < config.maxTransientRetries) {
        counts.transient += 1;
        attempts.set(id, counts);
        lane.retries += 1;
        await retryPromptRun(id);
        queue.push(id);
      } else if (outcome.state !== "skipped") {
        lane.failed += 1;
      }

      cycles.push(Date.now() - cycleStartedAt);
      const recent = cycles.slice(-6);
      lane.avgCycleMs = Math.round(recent.reduce((sum, value) => sum + value, 0) / recent.length);
      lane.etaMs = Math.round(((queue.length + lane.inFlight) / config.concurrency) * lane.avgCycleMs);
      emit(progress);
    }
  };

  await Promise.all(Array.from({ length: Math.min(config.concurrency, queue.length) }, () => worker()));
}
