"use client";

// Observation console — where evidence enters Measure.
//
// Every answer is collected from the assistant's own website (chatgpt.com,
// gemini.google.com) through a collection connection that opens the site in a
// signed-out browser session and returns what the page showed. Each
// connection is a lane that reports what it is doing right now — checking,
// asking, waiting on a rate limit, paused and why, or handed over to the next
// connection — so a long run reads as progress rather than a frozen spinner.
//
// Which vendor a connection is is internal: the reader sees ChatGPT and
// Gemini, never the infrastructure. Keys come from `.env.local` or the
// credentials API; no page in the app names a vendor.
//
// Answers appear in a live feed as they land, and the page re-measures on
// every new answer so metrics fill in progressively.

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import { Card, CardBody, Notice, Spinner, StatusDot } from "@/components/ui/primitives";
import { SkeletonCard } from "@/components/ui/loading-stage";
import { api, ApiError, type CredentialStatusResponse } from "@/lib/client/api";
import { ENGINE_LABEL, engineOf, isByHandRoute, isConsumerWebRoute } from "@/lib/providers/engines";
import { COLLECTION_VENDOR_IDS, CONSUMER_WEB_ROUTES, pausedReasonOf, ROUTE_LABEL, VENDORS, type PausedReason } from "@/lib/providers/catalog";

export interface ActivityState {
  running: boolean;
  planned: number;
  captured: number;
  etaMs: number | null;
  /** Routes whose lane stopped, by engine name. */
  pausedRoutes: string[];
  /** When the latest paused route said it can be asked again, if it said. */
  resumesAt: number | null;
  /** Why each paused route stopped. */
  pausedReasons?: Record<string, PausedReason>;
  /** When the run will check its providers again by itself. */
  recheckAt?: number | null;
}

function formatWait(ms: number): string {
  const seconds = Math.max(0, Math.round(ms / 1000));
  if (seconds < 60) return `${seconds}s`;
  const minutes = Math.floor(seconds / 60);
  const rest = seconds % 60;
  return rest === 0 ? `${minutes} min` : `${minutes} min ${rest}s`;
}

function timeAgo(value: string | number | Date, now: number): string {
  const diff = Math.max(0, now - new Date(value).getTime());
  if (diff < 15_000) return "just now";
  if (diff < 60_000) return `${Math.round(diff / 1000)}s ago`;
  if (diff < 3_600_000) return `${Math.round(diff / 60_000)} min ago`;
  return new Date(value).toLocaleTimeString();
}

function clockTime(at: number): string {
  return new Date(at).toLocaleTimeString([], { hour: "numeric", minute: "2-digit" });
}

const TONE_TEXT = { brand: "text-sun-800", warn: "text-warn-600", ok: "text-ok-600", neutral: "text-ink-500" } as const;

/**
 * A readable preview of an answer. Answers are markdown — headings, bold,
 * tables — and shown raw in a two-line preview they read as noise. The stored
 * answer is untouched; this is display.
 */
function plainExcerpt(markdown: string): string {
  return markdown
    .replace(/```[\s\S]*?```/g, " ")
    .replace(/^\s*\|?\s*:?-{2,}.*$/gm, " ")
    .replace(/\|/g, " ")
    .replace(/!?\[([^\]]*)\]\([^)]*\)/g, "$1")
    .replace(/^\s{0,3}(#{1,6}|[-*+]|\d+\.)\s+/gm, "")
    .replace(/(\*\*|__|\*|_|`)/g, "")
    .replace(/<https?:\/\/[^>]+>/g, "")
    .replace(/\s+/g, " ")
    .trim();
}


interface Props {
  projectId: string;
  /** The run to show. When null, the latest run for the project is used. */
  collectionRunId: string | null;
  /** Called whenever captured evidence changes, so the page re-measures. */
  onEvidence: () => void;
  onActivity?: (state: ActivityState) => void;
  /** A new run was started (a closed run is never reopened); the page switches to it. */
  onRunCreated?: (collectionRunId: string) => void;
  /** A newer approved prompt set exists than the one this run asked. */
  newerPromptSet?: boolean;
}

interface AnalysisSummary {
  analysed: number;
  needsReview: number;
  missing: number;
  stale: number;
}

export function ObservationConsole({ projectId, collectionRunId, onEvidence, onActivity, onRunCreated, newerPromptSet = false }: Props) {
  const [run, setRun] = useState<any>(null);
  const [runs, setRuns] = useState<any[]>([]);
  const [runner, setRunner] = useState<any>(null);
  const [analysis, setAnalysis] = useState<AnalysisSummary | null>(null);
  const [keys, setKeys] = useState<CredentialStatusResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [working, setWorking] = useState<"auto" | "key" | "finalise" | "reanalyse" | "new" | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [now, setNow] = useState(() => Date.now());
  const capturedRef = useRef<number | null>(null);

  const refresh = useCallback(
    async (id: string) => {
      const detail = await api.getCollectionRun(id);
      setRun(detail.collectionRun);
      setRuns(detail.promptRuns);
      setRunner(detail.runner ?? null);
      setAnalysis(detail.analysisSummary ?? null);
      const captured = detail.promptRuns.filter((row: any) => row.state === "succeeded").length;
      if (capturedRef.current !== null && captured !== capturedRef.current) onEvidence();
      capturedRef.current = captured;
    },
    [onEvidence],
  );

  const refreshKeys = useCallback(async () => {
    const status = await api.getCredentialStatus().catch(() => null);
    setKeys(status);
  }, []);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        let id = collectionRunId;
        if (!id) {
          const { collectionRuns } = await api.listCollectionRuns(projectId);
          const latest = [...collectionRuns].sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime())[0];
          id = latest?.id ?? null;
        }
        if (id && !cancelled) await refresh(id);
        if (!cancelled) await refreshKeys();
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [projectId, collectionRunId, refresh, refreshKeys]);

  const running = runner?.status === "running";

  // Poll while the background runner works; tick the clock for countdowns.
  useEffect(() => {
    const tick = setInterval(() => setNow(Date.now()), running ? 1000 : 30_000);
    if (!running || !run?.id) return () => clearInterval(tick);
    const poll = setInterval(() => {
      refresh(run.id).catch(() => undefined);
    }, 2000);
    return () => {
      clearInterval(poll);
      clearInterval(tick);
    };
  }, [running, run?.id, refresh]);

  const lanes = useMemo(() => {
    const byRoute = new Map<string, { route: string; total: number; done: number; failed: number }>();
    for (const row of runs) {
      // Questions moved to another route belong to that route's lane.
      if (row.state === "policy_disabled") continue;
      const lane = byRoute.get(row.providerExperience) ?? { route: row.providerExperience, total: 0, done: 0, failed: 0 };
      lane.total += 1;
      if (row.state === "succeeded") lane.done += 1;
      else if (["failed", "rate_limited", "incomplete"].includes(row.state)) lane.failed += 1;
      byRoute.set(row.providerExperience, lane);
    }
    return [...byRoute.values()];
  }, [runs]);

  const captured = runs.filter((row) => row.state === "succeeded").length;
  const liveLanes = (runner?.lanes ?? []) as any[];
  const etaMs = running ? Math.max(0, ...liveLanes.filter((lane) => lane.status !== "paused").map((lane) => lane.etaMs ?? 0)) : null;
  // A paused lane will not finish in this run, so it must not hide inside an
  // ETA computed from the lanes that are still working. A lane that handed
  // its prompts to another provider is not paused for the reader either.
  const pausedLanes = liveLanes.filter((lane) => lane.status === "paused" && !lane.continuedOn);
  const pausedKey = pausedLanes.map((lane) => `${lane.provider}:${lane.resumesAt ?? ""}:${pausedReasonOf(lane.paceReason)}`).join("|");
  const recheckAt: number | null = runner?.recheckAt ?? null;

  useEffect(() => {
    const paused = pausedKey ? pausedKey.split("|").map((entry) => entry.split(":")) : [];
    onActivity?.({
      running,
      planned: runs.filter((row) => row.state !== "policy_disabled").length,
      captured,
      etaMs,
      pausedRoutes: paused.map(([provider]) => ROUTE_LABEL[provider!]?.name ?? provider!),
      resumesAt: paused.reduce<number | null>((latest, [, at]) => (at ? Math.max(latest ?? 0, Number(at)) : latest), null),
      pausedReasons: Object.fromEntries(paused.map(([provider, , reason]) => [ROUTE_LABEL[provider!]?.name ?? provider!, reason as PausedReason])),
      recheckAt,
    });
  }, [onActivity, running, runs.length, captured, etaMs, pausedKey, recheckAt]);

  const keyedVendors = COLLECTION_VENDOR_IDS.filter((vendor) => keys?.status?.[vendor]);
  /** Engines the product measures right now; Gemini is hidden unless SUN_ENGINES includes it. */
  const engines = keys?.engines ?? (["chatgpt"] as const);
  const engineNames = engines.map((engine) => ENGINE_LABEL[engine]).join(" and ");
  const siteNames = engines.map((engine) => (engine === "gemini" ? "gemini.google.com" : "chatgpt.com")).join(" or ");
  // Only a key that unlocks an enabled engine counts as connected.
  const hasKey = keyedVendors.some((vendor) => VENDORS[vendor].engines.some((engine) => (engines as readonly string[]).includes(engine)));
  /** The first keyed, healthy route for an engine, in preference order; falls back to any keyed route. */
  const preferredRoute = useCallback(
    (engine: "chatgpt" | "gemini", exclude: string[] = []): string | null => {
      const available = keys?.routes ?? [];
      const candidates = CONSUMER_WEB_ROUTES.filter((route) => route.engine === engine && !exclude.includes(route.id)).map((route) => available.find((item) => item.id === route.id)).filter((item): item is NonNullable<typeof item> => Boolean(item && item.keyed));
      return (candidates.find((item) => item.healthy) ?? candidates[0])?.id ?? null;
    },
    [keys],
  );
  const webLanes = lanes.filter((lane) => isConsumerWebRoute(lane.route));
  const webRemaining = webLanes.reduce((sum, lane) => sum + (lane.total - lane.done), 0);
  const feed = runs
    .filter((row) => row.state === "succeeded" && row.observation)
    .sort((a, b) => new Date(b.observation.observedAt).getTime() - new Date(a.observation.observedAt).getTime())
    .slice(0, 6);
  const activeRows = runs.filter((row) => row.state !== "policy_disabled");
  const finalised = run?.status === "completed";
  const summaryParts = [];
  if (activeRows.length > 0) summaryParts.push(`${activeRows.filter((row) => row.state === "succeeded").length} of ${activeRows.length} answers collected`);
  if (analysis && analysis.missing > 0) summaryParts.push(`${analysis.missing} awaiting analysis`);
  if (analysis && analysis.needsReview > 0) summaryParts.push(`${analysis.needsReview} need${analysis.needsReview === 1 ? "s" : ""} a look`);
  const summary = summaryParts.join(" · ");

  async function act(kind: "auto" | "key" | "finalise" | "reanalyse" | "new", work: () => Promise<void>) {
    setError(null);
    setWorking(kind);
    try {
      await work();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "That did not work. Try again.");
    } finally {
      setWorking(null);
    }
  }

  const startNewRun = () =>
    act("new", async () => {
      // The server picks one consumer-web route per engine and plans the
      // latest approved questions. A closed run is never reopened.
      const created = (await api.createCollectionRun(projectId)).collectionRun;
      await api.runCollection(created.id);
      if (onRunCreated) onRunCreated(created.id);
      else {
        await refresh(created.id);
        onEvidence();
      }
    });

  const finish = () =>
    act("finalise", async () => {
      if (!run) return;
      await api.finaliseCollectionRun(run.id);
      await refresh(run.id);
      onEvidence();
    });

  const reanalyse = () =>
    act("reanalyse", async () => {
      if (!run) return;
      await api.reanalyseCollectionRun(run.id);
      await refresh(run.id);
      onEvidence();
    });

  const startAutomatic = () =>
    act("auto", async () => {
      let active = run;
      if (!active) {
        // The server picks one consumer-web route per engine.
        active = (await api.createCollectionRun(projectId)).collectionRun;
        if (onRunCreated) {
          await api.runCollection(active.id);
          onRunCreated(active.id);
          return;
        }
      } else {
        // An engine with a keyed provider but no lane yet joins the run.
        const missing = engines
          .filter((engine) => !lanes.some((lane) => engineOf(lane.route) === engine && isConsumerWebRoute(lane.route)))
          .map((engine) => preferredRoute(engine))
          .filter((route): route is string => Boolean(route));
        if (missing.length > 0) await api.addCollectionRoutes(active.id, missing);
        // A lane stopped for a reason that will not clear (bad key, no credits,
        // provider down) continues on another keyed provider for the same engine.
        for (const lane of webLanes) {
          const live = liveLanes.find((item) => item.provider === lane.route);
          const reason = live?.status === "paused" ? pausedReasonOf(live.paceReason) : null;
          if (!reason || reason === "quota" || reason === "budget_cap" || live?.continuedOn || lane.done >= lane.total) continue;
          const alternative = preferredRoute(engineOf(lane.route) as "chatgpt" | "gemini", lanes.map((item) => item.route));
          if (alternative) await api.addCollectionRoutes(active.id, [alternative], lane.route);
        }
      }
      await api.runCollection(active.id);
      await refresh(active.id);
      onEvidence();
    });

  if (loading) {
    return (
      <div role="status" aria-label="Loading collection">
        <SkeletonCard rows={3} />
      </div>
    );
  }

  const showCollect = !finalised && (runs.length === 0 || webRemaining > 0 || (webLanes.length === 0 && hasKey));
  const canFinish = !finalised && !running && runs.length > 0 && captured > 0 && webRemaining > 0;
  const canReanalyse = !running && Boolean(analysis && (analysis.missing > 0 || analysis.stale > 0));
  const allStranded = !running && webLanes.length > 0 && pausedLanes.length > 0 && pausedLanes.length === liveLanes.filter((lane) => !lane.continuedOn).length;

  return (
    <Card>
      <CardBody className="space-y-5">
        <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
          <div>
            <h2 className="text-lg font-semibold tracking-[-0.015em] text-ink-950">{runs.length === 0 ? "Collect answers" : summary}</h2>
            <p className="mt-0.5 max-w-2xl text-sm leading-6 text-ink-600">
              Each approved question is asked on the {engineNames} website in a signed-out browser session, and the answer comes back with the sources
              the page showed. Every answer stays marked with the site it came from and when it was collected.
            </p>
          </div>
          <div className="flex shrink-0 flex-wrap gap-2">
            {(finalised || newerPromptSet) && hasKey && (
              <Button onClick={startNewRun} disabled={working !== null || running}>
                {working === "new" ? <Spinner /> : "Start a new measurement"}
              </Button>
            )}
            {canReanalyse && (
              <Button variant="secondary" onClick={reanalyse} disabled={working !== null}>
                {working === "reanalyse" ? <Spinner /> : "Re-analyse"}
              </Button>
            )}
            {canFinish && (
              <Button variant="secondary" onClick={finish} disabled={working !== null} title="Keep the answers collected so far as this measurement; the rest stay uncollected.">
                {working === "finalise" ? <Spinner /> : "Finish with what’s collected"}
              </Button>
            )}
            {showCollect && !newerPromptSet && (
              <Button variant="accent" onClick={startAutomatic} disabled={!hasKey || working !== null || running}>
                {running ? (
                  <>
                    <Spinner /> Collecting
                  </>
                ) : working === "auto" ? (
                  <Spinner />
                ) : runs.length === 0 || webLanes.length === 0 ? (
                  "Collect answers"
                ) : (
                  `Collect ${webRemaining} remaining`
                )}
              </Button>
            )}
          </div>
        </div>

        {keys && !hasKey && (
          <div className="sun-inset px-4 py-4">
            <p className="text-sm font-semibold text-ink-950">Collection is not set up on this computer</p>
            <p className="mt-0.5 text-xs leading-5 text-ink-600">
              Answers are collected from {siteNames} in a signed-out browser session. Add the collection key to <code>.env.local</code> and restart the
              app, then come back and collect.
            </p>
          </div>
        )}

        {finalised && (
          <p className="sun-inset px-3.5 py-2.5 text-xs leading-5 text-ink-600">
            This measurement is closed{run?.finalisedBy === "operator" ? " with the answers collected so far" : ""}: its figures are kept as they are. Collecting again starts a new
            measurement with the latest approved questions{newerPromptSet ? " (they changed since this one)" : ""}.
          </p>
        )}
        {!finalised && newerPromptSet && (
          <p className="rounded-xl border border-sun-200 bg-sun-50 px-3.5 py-2.5 text-xs leading-5 text-ink-800">
            The approved questions changed since this run started. It keeps measuring the questions it asked; start a new measurement for the new ones.
          </p>
        )}

        {lanes.length > 0 && (
          <div className="grid gap-3 sm:grid-cols-2">
            {lanes.map((lane) => {
              const meta = ROUTE_LABEL[lane.route] ?? { name: lane.route, detail: "", kind: "web" as const };
              const live = liveLanes.find((item) => item.provider === lane.route);
              const pct = lane.total > 0 ? Math.round((lane.done / lane.total) * 100) : 0;
              // A second lane for the same engine is a handover (the first connection stopped).
              const continued = lanes.some((other) => other !== lane && engineOf(other.route) === engineOf(lane.route) && lanes.indexOf(other) < lanes.indexOf(lane));
              const title = continued ? `${meta.name} (continued)` : meta.name;
              let status = "";
              let tone: keyof typeof TONE_TEXT = "neutral";
              let active = false;
              if (live?.status === "paused" && live.continuedOn) {
                status = "Handed the remaining questions to another connection.";
                tone = "neutral";
              } else if (live?.status === "paused") {
                const retryAt = live.resumesAt ? ` Collects again after ${clockTime(live.resumesAt)}.` : "";
                const reason = pausedReasonOf(live.paceReason);
                if (reason === "no_credits") status = "Paused: the collection account is out of credits or over its plan. Top it up, then collect again.";
                else if (reason === "key_rejected") status = "Paused: the collection key wasn’t accepted. Check the key on this computer, then collect again.";
                else if (reason === "vendor_unhealthy") status = `Paused: ${meta.name} on the web could not be reached just now.${recheckAt ? ` Checked again at ${clockTime(recheckAt)}.` : " Collect again later."}`;
                else if (reason === "target_blocked") status = `Paused: ${meta.name}’s site refused several requests in a row.${recheckAt ? ` Checked again at ${clockTime(recheckAt)}.` : " Collect again later."}`;
                else if (reason === "budget_cap") status = "Paused: this run reached its request limit. Collect again to continue.";
                else status = `Paused: the collection rate limit is used up.${retryAt || " Collect the rest later."}`;
                tone = "warn";
              } else if (running && live?.status === "checking") {
                status = `Checking ${meta.name} with a test question`;
                tone = "brand";
                active = true;
              } else if (running && live?.status === "paced" && live.resumesAt) {
                status = `Next question in ${formatWait(live.resumesAt - now)}, pacing to the collection limit`;
                tone = "warn";
              } else if (running && live && live.status !== "done") {
                status = live.inFlight > 1 ? `Asking ${live.inFlight} questions now` : "Asking now";
                tone = "brand";
                active = true;
              } else if (lane.done === lane.total) {
                status = "Done";
                tone = "ok";
              } else {
                status = `${lane.total - lane.done} not collected yet`;
              }
              return (
                <div key={lane.route} className="rounded-xl border border-ink-200/75 bg-white px-3.5 py-3 shadow-sheet">
                  <div className="flex items-baseline justify-between gap-2">
                    <span className="flex items-center gap-2 text-sm font-semibold text-ink-950">
                      {title}
                      <span className="rounded bg-ink-100 px-1.5 py-0.5 text-[10px] font-medium uppercase tracking-wide text-ink-600">
                        {meta.kind === "web" ? "web" : meta.kind === "manual" ? "by hand" : "api"}
                      </span>
                    </span>
                    <span className="sun-figure text-sm text-ink-950">
                      {lane.done}/{lane.total}
                    </span>
                  </div>
                  <p className="mt-0.5 text-xs text-ink-500">{meta.detail}</p>
                  <div className="mt-2 h-1.5 overflow-hidden rounded-full bg-ink-100">
                    <div className="h-full rounded-full bg-sun-500 transition-all duration-500" style={{ width: `${pct}%` }} />
                  </div>
                  <div className="mt-1.5 flex items-center justify-between gap-2 text-[11px]">
                    <span className={`flex items-center gap-1.5 ${TONE_TEXT[tone]}`}>
                      {active && <StatusDot tone="sun" pulse />}
                      {status}
                    </span>
                    {running && live?.status === "running" && live.etaMs >= 1000 ? <span className="tabular-nums text-ink-400">about {formatWait(live.etaMs)} left</span> : null}
                  </div>
                  {lane.failed > 0 && (
                    <p className="mt-1 text-[11px] leading-4 text-warn-600">
                      {lane.failed} not collected yet: left out of the results, never counted as a miss
                    </p>
                  )}
                </div>
              );
            })}
          </div>
        )}

        {allStranded && (
          <p className="rounded-xl border border-warn-500/30 bg-warn-100 px-3.5 py-2.5 text-xs leading-5 text-warn-600">
            No connection can reach the site right now. The questions stay uncollected and are left out of every figure; they are never counted as
            the brand being absent.{recheckAt ? ` The run checks again at ${clockTime(recheckAt)}.` : ""}
            {keyedVendors.length < COLLECTION_VENDOR_IDS.length ? " Adding another collection key on this computer gives the run somewhere else to continue." : ""}
          </p>
        )}

        {feed.length > 0 && (
          <div>
            <h3 className="sun-eyebrow text-ink-500">Latest answers</h3>
            <ul className="mt-2 divide-y divide-ink-100 rounded-xl border border-ink-200/75 bg-white shadow-sheet" aria-live="polite">
              {feed.map((row) => (
                <li key={row.id} className="px-3 py-2.5">
                  <div className="flex items-baseline justify-between gap-3">
                    <span className="min-w-0 truncate text-sm font-medium text-ink-950">{row.promptText}</span>
                    <span className="shrink-0 text-[11px] text-ink-500">
                      {ROUTE_LABEL[row.providerExperience]?.name ?? row.providerExperience}
                      {isByHandRoute(row.providerExperience) ? " (by hand)" : isConsumerWebRoute(row.providerExperience) ? " (web)" : ""}
                      {row.observation?.searchState === "on" ? " · searched" : ""} · {timeAgo(row.observation.observedAt, now)}
                    </span>
                  </div>
                  <p className="mt-0.5 line-clamp-2 text-xs leading-5 text-ink-500">{plainExcerpt(row.observation.excerpt)}</p>
                </li>
              ))}
            </ul>
          </div>
        )}

        <p className="sun-inset px-3.5 py-3 text-xs leading-5 text-ink-600">
          <span className="font-semibold text-ink-800">What is collected.</span> Each answer is what the {engineNames} website showed a signed-out
          visitor in a fresh conversation, with web search on, from the project’s market country where that can be chosen. That is the public
          surface, not a signed-in account with memory. When each answer was collected, the model the page named (when it did), the country it was
          asked from (when known) and the sources it showed are recorded on every answer and shown in Measure’s method notes.
        </p>

        {error && (
          <Notice tone="danger" role="alert">
            {error}
          </Notice>
        )}
      </CardBody>
    </Card>
  );
}
