// Facade the Understand pipeline calls to pull Google Search Console data.
//
// Contract (frozen signatures; the crawl pipeline, the rail and the card rely on it):
// - `started` is appended synchronously, then exactly one terminal
//   `search_console.sync.completed|skipped|failed` per handle;
// - every payload carries the input's `crawlRunId`, so the page can ignore a
//   previous run's pull that settles inside a newer cycle;
// - payloads carry counts and reasons only, never query text, tokens or emails;
// - `pages` resolves as soon as the page query returns and never rejects;
// - `result(t)` never rejects; after `t` ms it settles as `skipped: timeout`, and
//   a pull that lands later is discarded without another event;
// - nothing is fetched when the integration isn't configured or connected.
//
// Server-only: emits events.

import { appendEvent } from "@/lib/events/bus";
import { domainLabel } from "./brand-split";
import { gscDisabled, lookbackDays, oauthClient } from "./config";
import { pullSearchConsoleSnapshot, type PullInput } from "./pull";
import { buildSearchConsoleSignals } from "./signals";
import type {
  GscMetricRow,
  GscPullResult,
  SearchConsoleSyncCompletedPayload,
  SearchConsoleSyncFailedPayload,
  SearchConsoleSyncSkippedPayload,
  SearchConsoleSyncStartedPayload,
} from "./types";
import { reportingWindow } from "./window";

export { buildSearchConsoleSignals, summarizeForProfile } from "./signals";

export interface SearchConsoleSyncInput {
  projectId: string;
  projectUrl: string;
  registrableDomain: string;
  crawlRunId: string | null;
  now?: Date;
}

export interface SearchConsoleSyncHandle {
  /** Never rejects; [] when unavailable. */
  pages: Promise<GscMetricRow[]>;
  /** Never rejects; `skipped:timeout` when the pull outlasts `timeoutMs`. */
  result(timeoutMs: number): Promise<GscPullResult>;
}

/** Test seam: the pull the facade runs (defaults to the real one). */
export interface SearchConsoleSyncDeps {
  pull?: (input: PullInput) => Promise<GscPullResult>;
}

function emit(projectId: string, type: "search_console.sync.started" | "search_console.sync.completed" | "search_console.sync.skipped" | "search_console.sync.failed", payload: object): void {
  try {
    appendEvent(projectId, type, payload as Record<string, unknown>);
  } catch (err) {
    // Progress events are best effort; a failed write must not break the crawl.
    console.error("[search-console] event append failed", err instanceof Error ? err.message : "");
  }
}

function completedPayload(result: Extract<GscPullResult, { ok: true }>, registrableDomain: string, crawlRunId: string | null): SearchConsoleSyncCompletedPayload {
  // The business name isn't known yet (understanding runs later), so the brand
  // split here uses the domain label; the profile summary recomputes it.
  const preliminary = buildSearchConsoleSignals(result.snapshot, { brandName: domainLabel(registrableDomain), aliases: [], domain: registrableDomain, places: [], offeringVocabulary: [] });
  return {
    crawlRunId,
    siteUrl: result.match.siteUrl,
    matchReason: result.match.matchReason,
    queries: result.snapshot.queries.length,
    pages: result.snapshot.pages.length,
    countries: result.snapshot.countries.length,
    sufficient: preliminary.sufficient,
    brandedClickShare: preliminary.brand.brandedClickShare,
    durationMs: result.durationMs,
  };
}

function terminalEvent(input: SearchConsoleSyncInput, result: GscPullResult): void {
  const { projectId, crawlRunId } = input;
  if (result.ok) {
    emit(projectId, "search_console.sync.completed", completedPayload(result, input.registrableDomain, crawlRunId));
  } else if (result.kind === "skipped") {
    const payload: SearchConsoleSyncSkippedPayload = { crawlRunId, reason: result.reason };
    if (typeof result.propertyCount === "number") payload.propertyCount = result.propertyCount;
    emit(projectId, "search_console.sync.skipped", payload);
  } else {
    const payload: SearchConsoleSyncFailedPayload = { crawlRunId, reason: result.reason };
    if (typeof result.httpStatus === "number") payload.httpStatus = result.httpStatus;
    emit(projectId, "search_console.sync.failed", payload);
  }
}

function settledHandle(result: GscPullResult): SearchConsoleSyncHandle {
  return { pages: Promise.resolve([]), result: () => Promise.resolve(result) };
}

/** Emits search_console.sync.started synchronously and exactly one terminal search_console.sync.* event. */
export function startSearchConsoleSync(input: SearchConsoleSyncInput, deps: SearchConsoleSyncDeps = {}): SearchConsoleSyncHandle {
  const window = reportingWindow(input.now ?? new Date(), lookbackDays());
  const started: SearchConsoleSyncStartedPayload = { crawlRunId: input.crawlRunId, startDate: window.startDate, endDate: window.endDate };
  emit(input.projectId, "search_console.sync.started", started);

  // Config is synchronous, so the common "not set up" case settles immediately.
  const unconfigured: GscPullResult | null = gscDisabled()
    ? { ok: false, kind: "skipped", reason: "disabled" }
    : !oauthClient() && !deps.pull
      ? { ok: false, kind: "skipped", reason: "oauth_not_configured" }
      : null;
  if (unconfigured) {
    terminalEvent(input, unconfigured);
    return settledHandle(unconfigured);
  }

  let terminal: GscPullResult | null = null;
  const settle = (result: GscPullResult): GscPullResult => {
    if (terminal) return terminal;
    terminal = result;
    terminalEvent(input, result);
    return result;
  };

  let resolvePages!: (rows: GscMetricRow[]) => void;
  const pages = new Promise<GscMetricRow[]>((resolve) => {
    resolvePages = resolve;
  });

  const pull = deps.pull ?? pullSearchConsoleSnapshot;
  const pulled: Promise<GscPullResult> = Promise.resolve()
    .then(() =>
      pull({
        projectId: input.projectId,
        projectUrl: input.projectUrl,
        registrableDomain: input.registrableDomain,
        now: input.now,
        onPages: (rows) => resolvePages(rows),
      }),
    )
    .catch((err): GscPullResult => {
      console.error("[search-console] pull crashed", err instanceof Error ? err.message : "");
      return { ok: false, kind: "failed", reason: "invalid_response" };
    })
    .then((result) => {
      resolvePages(result.ok ? result.snapshot.pages : []);
      return settle(result);
    });

  return {
    pages,
    result(timeoutMs: number): Promise<GscPullResult> {
      if (terminal) return Promise.resolve(terminal);
      return new Promise<GscPullResult>((resolve) => {
        const timer = setTimeout(() => resolve(settle({ ok: false, kind: "skipped", reason: "timeout" })), Math.max(0, timeoutMs));
        void pulled.then(() => {
          clearTimeout(timer);
          // `terminal` is the timeout result when the pull landed after the deadline.
          resolve(terminal!);
        });
      });
    },
  };
}

/** True when OAuth credentials are present and the integration isn't turned off (no DB or network read). */
export function isSearchConsoleConfigured(): boolean {
  return !gscDisabled() && oauthClient() !== null;
}
