import type { SunEventPayload } from "@/lib/client/use-project-events";

// Which view the Understand page shows. Pure and client-safe (unit-tested).
//
// Operators saw "random information" while a website was still being analysed:
// the page re-read the partial profile version on every field event and showed
// rules-only guesses that replaced each other as pages arrived (feedback
// 2026-09-14: "it should only provide results after it is loaded 100%"). The
// page now shows only progress until the current analysis cycle ends, and the
// profile only from a persisted `complete` version.

export type UnderstandPhase = "loading" | "analysing" | "stalled" | "failed" | "not_started" | "ready";

/** Soft "taking longer than usual" note. A guess; calibrate against real runs. */
export const SLOW_AFTER_MS = 3 * 60_000;
/** Offer "Analyse again" when a cycle has been silent this long (fallback when the server can't say). */
export const STALLED_AFTER_MS = 10 * 60_000;
/** A project with no analysis events this long after the page opened never started one. */
export const NOT_STARTED_AFTER_MS = 15_000;
/** How long a version this cycle already finished may wait for its terminal event before the page shows it anyway. */
export const TERMINAL_EVENT_GRACE_MS = 30_000;

const TERMINAL = new Set(["profile.ready", "profile.failed"]);

function lastIndexOfType(events: SunEventPayload[], type: string, before = events.length): number {
  for (let i = Math.min(before, events.length) - 1; i >= 0; i--) if (events[i]!.type === type) return i;
  return -1;
}

/**
 * Events of the latest analysis cycle.
 *
 * A cycle starts at `profile.synthesis.started`, which the pipeline emits before
 * the optional Search Console sync and before `crawl.started`. Cutting at
 * `crawl.started` (the first design) dropped both from the cycle. A
 * `crawl.started` that follows a finished cycle with no new synthesis event
 * starts a cycle of its own.
 */
export function currentCrawlCycle(events: SunEventPayload[]): SunEventPayload[] {
  const synthesis = lastIndexOfType(events, "profile.synthesis.started");
  const crawl = lastIndexOfType(events, "crawl.started");
  if (synthesis < 0 && crawl < 0) return [];
  let start = synthesis >= 0 ? synthesis : crawl;
  if (synthesis >= 0 && crawl > synthesis && events.slice(synthesis, crawl).some((e) => TERMINAL.has(e.type))) start = crawl;
  return events.slice(start);
}

/** The cycle's last `profile.ready` / `profile.failed`, if it has ended. */
export function cycleTerminal(cycle: SunEventPayload[]): SunEventPayload | null {
  for (let i = cycle.length - 1; i >= 0; i--) if (TERMINAL.has(cycle[i]!.type)) return cycle[i]!;
  return null;
}

export interface UnderstandPhaseInput {
  /** GET /profile resolved (200 or 404). */
  fetched: boolean;
  version: { status: "partial" | "complete" | "failed"; crawlRunId?: string | null } | null;
  /** The whole project event log. */
  events: SunEventPayload[];
  /** The first events batch has loaded. */
  hydrated: boolean;
  /** GET /profile `inProgress`: a crawl job is running in the server process. Undefined when unknown. */
  inProgress?: boolean | null;
  mountedAt: number;
  now: number;
}

export function understandPhase(input: UnderstandPhaseInput): UnderstandPhase {
  if (!input.fetched) return "loading";
  const cycle = currentCrawlCycle(input.events);
  const terminal = cycleTerminal(cycle);
  const cycleOpen = cycle.length > 0 && !terminal;
  const status = input.version?.status ?? null;

  const runningOrStalled = (): UnderstandPhase => {
    const last = cycle.at(-1);
    const quietSince = last ? last.createdAt : input.mountedAt;
    // The pipeline stores the final version, emits the terminal event, and only
    // then frees the crawl job. A re-read landing between the release and the
    // event reaching the page saw `inProgress: false` on an open cycle and
    // flashed "stopped" (with "Analyse again") over a run that had just
    // finished. A final version from this cycle's own crawl run means the run
    // ended; wait briefly for the event so the finished rail can be shown.
    const cycleRunId = cycle.find((e) => e.type === "crawl.started")?.payload.crawlRunId;
    if (typeof cycleRunId === "string" && input.version?.crawlRunId === cycleRunId) {
      if (status === "failed") return "failed";
      if (status === "complete") return input.now - quietSince > TERMINAL_EVENT_GRACE_MS ? "ready" : "analysing";
    }
    // After a restart the job registry is empty, so the server says so at once;
    // the silence timer is the fallback for servers that don't report it.
    if (input.inProgress === false) return "stalled";
    return input.now - quietSince > STALLED_AFTER_MS ? "stalled" : "analysing";
  };

  // A run in flight (or stranded) outranks whatever version is stored: an older
  // profile.ready must not mark a new analysis as done.
  if (input.hydrated && cycleOpen) return runningOrStalled();

  if (terminal?.type === "profile.failed") {
    // The operator filled the profile in by hand after the failure.
    const superseded = status === "complete" && input.events.some((e) => e.sequence > terminal.sequence && (e.type === "profile.edited" || e.type === "profile.confirmed"));
    if (!superseded) return "failed";
  }
  if (status === "failed") return "failed";
  // Complete wins straight away, without waiting for events: an older project
  // opens on its results with no progress flash, and so does a manual profile.
  if (status === "complete") return "ready";

  if (status === "partial") {
    if (!input.hydrated) return "analysing";
    // profile.ready arrived and the page is re-reading the version.
    if (terminal?.type === "profile.ready") return "analysing";
    return runningOrStalled();
  }

  // No version yet.
  if (!input.hydrated) return "loading";
  if (cycle.length === 0) {
    // The pipeline threw before it announced a cycle.
    if (input.events.some((e) => e.type === "profile.failed")) return "failed";
    return input.now - input.mountedAt < NOT_STARTED_AFTER_MS ? "analysing" : "not_started";
  }
  return "analysing";
}

/**
 * "Analyse again" was accepted after `since`: the page has heard back once the
 * new cycle has started, or once a `profile.failed` arrived. A run that throws
 * before `profile.synthesis.started` reports its failure into the previous
 * cycle, and waiting only for a new cycle held "Starting the analysis…" for the
 * whole restart wait.
 */
export function restartAnswered(events: SunEventPayload[], since: number): boolean {
  const cycleStart = currentCrawlCycle(events)[0];
  if (cycleStart && cycleStart.sequence > since) return true;
  return events.some((e) => e.type === "profile.failed" && e.sequence > since);
}
