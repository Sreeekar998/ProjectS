import type { LoadingStep } from "@/components/ui/loading-stage";
import type { UnderstandPhase } from "@/lib/client/understand-phase";
import type { SunEventPayload } from "@/lib/client/use-project-events";

// The Understand progress rail, derived from one analysis cycle's events. Pure
// and client-safe (unit-tested); `analysis-progress.tsx` renders it.
//
// Payload keys read (a contract with the crawler and profile pipeline):
//   crawl.page.discovered.domain / .count, crawl.started.startUrl,
//   crawl.sitemap.discovered.urls, crawl.evidence.extracted.pagesPlanned /
//   .pagesProcessed / .totalItems, profile.synthesis.started.mode,
//   profile.understanding.stage.stage / .pages, and the event types
//   search_console.sync.* (and their .crawlRunId), crawl.completed, crawl.blocked, crawl.failed,
//   profile.ready, profile.failed.
// Never read: profile.field.updated (the rail streamed field names before the
// analysis finished) or understanding `droppedClaims` (rejected findings are
// not shown in the app).

export interface UnderstandProgress {
  started: boolean;
  domain: string | null;
  sitemapUrls: number | null;
  discovered: number;
  selectedForFetch: number;
  processed: number;
  evidenceItems: number;
  mode: "llm" | "rules";
  completed: boolean;
  failed: { reason: string } | null;
  blocked: { reason: string } | null;
  /** 0–100; monotonic over the cycle and 100 only on profile.ready. */
  percent: number;
  steps: LoadingStep[];
  startedAt: number | null;
  lastEventAt: number | null;
}

const GSC_TERMINAL = new Set(["search_console.sync.completed", "search_console.sync.skipped", "search_console.sync.failed"]);
const STAGE_FLOOR: Record<string, number> = { reading: 75, locating: 85, finalizing: 93, done: 97 };

function last(events: SunEventPayload[], type: string): SunEventPayload | undefined {
  for (let i = events.length - 1; i >= 0; i--) if (events[i]!.type === type) return events[i];
  return undefined;
}

/**
 * The cycle's Search Console sync events, minus those from another analysis run.
 *
 * A failed run leaves its pull running, so after "Analyse again" its late
 * skipped/completed event landed in the new cycle and ticked the step done
 * while the new pull was still working (review 2026-09-14). Terminal events now
 * carry `crawlRunId`; one naming a different run than this cycle's
 * `search_console.sync.started` (or `crawl.started`) is dropped. Events with no
 * `crawlRunId` (older logs) are kept, as before.
 */
export function cycleSyncEvents(cycle: SunEventPayload[]): SunEventPayload[] {
  const runIdOf = (event: SunEventPayload | undefined) => (typeof event?.payload.crawlRunId === "string" ? event.payload.crawlRunId : null);
  const runId = runIdOf(last(cycle, "search_console.sync.started")) ?? runIdOf(cycle.find((e) => e.type === "crawl.started"));
  return cycle.filter((event) => {
    if (!event.type.startsWith("search_console.sync.")) return false;
    const eventRunId = runIdOf(event);
    return eventRunId === null || runId === null || eventRunId === runId;
  });
}

/** The latest sync event of this cycle's own run (SearchDemandCard's notice), if any. */
export function lastCycleSyncEvent(cycle: SunEventPayload[]): SunEventPayload | null {
  return cycleSyncEvents(cycle).at(-1) ?? null;
}

function num(value: unknown): number {
  const n = Number(value);
  return Number.isFinite(n) ? n : 0;
}

function hostnameOf(url: unknown): string | null {
  if (typeof url !== "string" || !url.trim()) return null;
  try {
    return new URL(url).hostname.replace(/^www\./, "") || null;
  } catch {
    return null;
  }
}

export function deriveUnderstandProgress(cycle: SunEventPayload[]): UnderstandProgress {
  const started = cycle.find((e) => e.type === "crawl.started");
  // The header read a `crawl.started.domain` key that is never emitted and said
  // "Understanding ". The start URL's hostname is what the operator typed
  // ("quotes.example.com"); the discovery event's registrable domain
  // ("example.com") is the fallback, so the name doesn't change mid-run.
  const discoveredWithDomain = cycle.find((e) => e.type === "crawl.page.discovered" && typeof e.payload.domain === "string" && e.payload.domain.trim());
  const domain = hostnameOf(started?.payload.startUrl) || (discoveredWithDomain ? String(discoveredWithDomain.payload.domain).trim() : null);
  const sitemap = last(cycle, "crawl.sitemap.discovered");
  const discovered = last(cycle, "crawl.page.discovered");
  const selectedCount = cycle.filter((e) => e.type === "crawl.page.selected").length;
  const lastEvidence = last(cycle, "crawl.evidence.extracted");
  const synthesis = last(cycle, "profile.synthesis.started");
  const mode: "llm" | "rules" = synthesis?.payload.mode === "llm_grounded" ? "llm" : "rules";
  const understanding = last(cycle, "profile.understanding.stage");
  const stage = typeof understanding?.payload.stage === "string" ? understanding.payload.stage : null;
  const crawlCompleted = cycle.some((e) => e.type === "crawl.completed");
  const ready = cycle.some((e) => e.type === "profile.ready");
  const profileFailed = last(cycle, "profile.failed");
  const crawlFailed = last(cycle, "crawl.failed");
  const blocked = last(cycle, "crawl.blocked");
  const syncEvents = cycleSyncEvents(cycle);
  const gscStarted = syncEvents.some((e) => e.type === "search_console.sync.started");
  const gscDone = syncEvents.some((e) => GSC_TERMINAL.has(e.type));

  const planned = lastEvidence && num(lastEvidence.payload.pagesPlanned) > 0 ? num(lastEvidence.payload.pagesPlanned) : selectedCount;
  const processed = num(lastEvidence?.payload.pagesProcessed);
  const evidenceItems = num(lastEvidence?.payload.totalItems);
  const discoveredCount = discovered ? num(discovered.payload.count) : 0;

  // Composite percentage. It used to be pages read ÷ pages planned, which hit
  // 100% while the understanding model was still working. Pages now fill 70%
  // (90% without a model), each understanding stage sets a floor, and only
  // profile.ready reaches 100. The page share is the running maximum, so a
  // growing page plan never moves the bar backwards.
  const crawlShare = mode === "llm" ? 70 : 90;
  let pagePct = 0;
  for (const event of cycle) {
    if (event.type !== "crawl.evidence.extracted") continue;
    const plan = num(event.payload.pagesPlanned);
    if (plan <= 0) continue;
    pagePct = Math.max(pagePct, Math.round(Math.min(1, num(event.payload.pagesProcessed) / plan) * crawlShare));
  }
  let percent = cycle.length > 0 ? Math.max(4, pagePct) : 0;
  if (stage && STAGE_FLOOR[stage]) percent = Math.max(percent, STAGE_FLOOR[stage]!);
  if (mode === "rules" && crawlCompleted) percent = Math.max(percent, crawlShare);
  percent = ready ? 100 : Math.min(percent, 99);

  const connected = Boolean(discoveredWithDomain) || discoveredCount > 0;
  const readingDone = ready || crawlCompleted;
  const showUnderstand = mode === "llm" || Boolean(understanding);
  const understandDone = ready || stage === "done";
  const profileActive = !ready && (stage === "done" || (!showUnderstand && crawlCompleted));

  const steps: LoadingStep[] = [
    {
      key: "connect",
      label: connected && domain ? `Website connected — ${domain}` : "Connecting to the website",
      state: connected || readingDone ? "done" : "active",
    },
  ];
  if (gscStarted) {
    // Status only: Search Console data is never shown before the analysis ends.
    steps.push({ key: "search-console", label: "Reading Google Search Console", state: gscDone || ready ? "done" : "active" });
  }
  steps.push(
    {
      key: "discover",
      label: "Discovering site structure",
      state: discoveredCount > 1 || planned > 0 || readingDone ? "done" : connected ? "active" : "pending",
      detail:
        discoveredCount > 0
          ? `${discoveredCount} URL${discoveredCount === 1 ? "" : "s"} found${sitemap && num(sitemap.payload.urls) > 0 ? ` (${num(sitemap.payload.urls)} from sitemap)` : ""}`
          : undefined,
    },
    {
      key: "read",
      label: "Reading the most useful pages",
      state: readingDone ? "done" : planned > 0 ? "active" : "pending",
      detail: planned > 0 ? `${Math.min(processed, planned)} of ${planned} selected pages processed` : undefined,
    },
    {
      key: "evidence",
      label: "Extracting evidence",
      state: readingDone ? "done" : evidenceItems > 0 ? "active" : "pending",
      detail: evidenceItems > 0 ? `${evidenceItems} observations collected` : undefined,
    },
  );
  if (showUnderstand) {
    steps.push({
      key: "understand",
      label: "Understanding the business",
      state: understandDone ? "done" : understanding ? "active" : "pending",
      detail: understandingDetail(understanding?.payload),
    });
  }
  steps.push({ key: "profile", label: "Putting your profile together", state: ready ? "done" : profileActive ? "active" : "pending" });

  const failedEvent = profileFailed ?? crawlFailed;
  return {
    started: Boolean(started),
    domain: domain || null,
    sitemapUrls: sitemap ? num(sitemap.payload.urls) : null,
    discovered: discoveredCount,
    selectedForFetch: planned,
    processed,
    evidenceItems,
    mode,
    completed: ready,
    failed: failedEvent ? { reason: String(failedEvent.payload.reason ?? "unknown") } : null,
    blocked: blocked ? { reason: String(blocked.payload.reason ?? "unknown") } : null,
    percent,
    steps,
    startedAt: cycle[0]?.createdAt ?? null,
    lastEventAt: cycle.at(-1)?.createdAt ?? null,
  };
}

function understandingDetail(payload: Record<string, unknown> | undefined): string | undefined {
  switch (payload?.stage) {
    case "reading":
      return typeof payload.pages === "number" ? `Reading ${payload.pages} pages the way a customer would` : "Reading the website";
    case "locating":
      return "Working out where the business is and who it serves";
    case "finalizing":
      return "Checking every finding against the website";
    case "done":
      return "Done";
    default:
      return undefined;
  }
}

/**
 * The line under "Your brand profile" for each Understand view.
 *
 * "loading" (GET /profile still pending) fell through to the analysing copy, so
 * every open of a long-finished profile first said "We're reading your website"
 * (review 2026-09-14). That copy is now only for a run that is really going.
 */
export function understandSubtitle(view: UnderstandPhase | "starting" | "reveal"): string {
  switch (view) {
    case "ready":
      return "Here is what we found on your website. Correct anything that is wrong, then confirm — everything downstream is measured against this.";
    case "failed":
      return "We could not finish analysing this website.";
    case "not_started":
      return "Your website hasn't been analysed yet.";
    case "loading":
      return "Loading your brand profile…";
    case "stalled":
      return "Your profile appears here once an analysis finishes.";
    case "analysing":
    case "starting":
    case "reveal":
      return "We're reading your website. Your profile appears here as soon as the analysis is finished.";
  }
}
