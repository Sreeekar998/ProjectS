"use client";

// Measure: how ChatGPT and Gemini answer the approved buyer questions.
//
// One measurement (a collection run) at a time, four views and a report:
//   Overview      how visible the brand is, who is recommended instead, what needs attention, what changed
//   Competitors   every business the answers named, tracked or not (URL key "brands")
//   Questions     every answer at a glance, then every question × engine (URL key "performance")
//   Sources       whose sites the answers cited, and which sites shape them
// The Opportunities tab was folded into the Overview's "What needs attention"
// with measure-policy@4: every finding restated a figure another view showed,
// so it read as a second dashboard. Old ?view=opportunities links land there.
//
// Kept from the first version, because they are what make the numbers honest:
// no percentage without its fraction (small samples lead with the fraction),
// sections never blend, every figure opens the answers behind it, partial
// results say "so far" until every planned answer is in, and a later run is
// compared only when the instrument is the same.

import { Suspense, useCallback, useEffect, useState, use as usePromise } from "react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { JourneyNav } from "@/components/features/journey-nav";
import { Button } from "@/components/ui/button";
import { Notice, SegmentedControl, Select, StatusDot } from "@/components/ui/primitives";
import { cn } from "@/lib/cn";
import { api, ApiError, type MeasureHistoryEntry, type MeasureResponse } from "@/lib/client/api";
import { ObservationConsole, type ActivityState } from "@/components/features/observation-console";
// The loading frame is shared with measure/loading.tsx.
import { MeasureSkeleton } from "@/components/features/stage-skeletons";
import { MeasureContext, EvidenceDrawer, ExplainDrawer, engineName, engineNames, formatDate, sum, type ExplainContent } from "@/components/features/measure/shared";
import { Eyebrow } from "@/components/ui/primitives";
import { OverviewView } from "@/components/features/measure/overview-view";
import { PerformanceView } from "@/components/features/measure/performance-view";
import { BrandsView } from "@/components/features/measure/brands-view";
import { SourcesView } from "@/components/features/measure/sources-view";
import { ReportView } from "@/components/features/measure/report-view";
import { AnswersView } from "@/components/features/measure/answers-view";
import { ExportMenu } from "@/components/features/measure/export-menu";
import { isByHandRoute } from "@/lib/providers/engines";

type Counts = { planned: number; captured: number; analysable: number };
type ViewKey = "overview" | "performance" | "brands" | "sources" | "report" | "answers";

const VIEWS: Array<{ key: ViewKey; label: string }> = [
  { key: "overview", label: "Overview" },
  { key: "brands", label: "Competitors" },
  { key: "performance", label: "Questions" },
  { key: "sources", label: "Sources" },
  { key: "report", label: "Report" },
];
// Reachable from the report and the Export menu; not a tab.
const HIDDEN_VIEWS: ViewKey[] = ["answers"];

function formatEta(ms: number): string {
  const seconds = Math.round(ms / 1000);
  if (seconds < 60) return "under a minute";
  const minutes = Math.round(seconds / 60);
  return `about ${minutes} minute${minutes === 1 ? "" : "s"}`;
}

export default function MeasurePage({ params }: { params: Promise<{ id: string }> }) {
  const { id: projectId } = usePromise(params);
  return (
    <Suspense fallback={<MeasureSkeleton projectId={projectId} />}>
      <MeasureWorkspace projectId={projectId} />
    </Suspense>
  );
}

function MeasureWorkspace({ projectId }: { projectId: string }) {
  const router = useRouter();
  const searchParams = useSearchParams();
  const viewParam = searchParams.get("view");
  const currentView: ViewKey = VIEWS.some((item) => item.key === viewParam) || HIDDEN_VIEWS.includes(viewParam as ViewKey) ? (viewParam as ViewKey) : "overview";
  // The retired Opportunities tab's links open the Overview at its findings.
  const findingsLink = viewParam === "opportunities";
  const runParam = searchParams.get("run");
  const sectionParam = searchParams.get("section");

  const [data, setData] = useState<MeasureResponse | null>(null);
  const [history, setHistory] = useState<MeasureHistoryEntry[] | null>(null);
  const [status, setStatus] = useState<"loading" | "ready" | "empty" | "missing">("loading");
  const [scope, setScope] = useState("combined");
  const [explain, setExplain] = useState<ExplainContent | null>(null);
  const [drill, setDrill] = useState<{ title: string; ids: string[] } | null>(null);
  const [collectionOpen, setCollectionOpen] = useState<boolean | null>(null);
  const [activity, setActivity] = useState<ActivityState | null>(null);
  const [working, setWorking] = useState<"reanalyse" | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  // Which engines the product measures right now (SUN_ENGINES); the page's
  // copy follows it so a hidden engine is not promised in the headline.
  const [enabledEngines, setEnabledEngines] = useState<string[]>(["chatgpt"]);
  useEffect(() => {
    api
      .getCredentialStatus()
      .then((result) => setEnabledEngines(result.engines))
      .catch(() => undefined);
  }, []);

  const href = useCallback(
    (view: string, run?: string | null) => {
      const query = new URLSearchParams();
      if (view !== "overview") query.set("view", view);
      const runId = run === undefined ? runParam : run;
      if (runId) query.set("run", runId);
      const text = query.toString();
      return `/projects/${projectId}/measure${text ? `?${text}` : ""}`;
    },
    [projectId, runParam],
  );

  const load = useCallback(async () => {
    try {
      const result = await api.getMeasureV2(projectId, runParam);
      setData(result);
      setStatus("ready");
      api
        .getMeasureHistory(projectId, result.run.id)
        .then((entries) => setHistory(entries.history))
        .catch(() => setHistory([]));
    } catch (error) {
      // No collection run yet is a normal state, not an error. A run id that
      // is not this project's is a dead link, shown as such.
      if (error instanceof ApiError && error.status === 404 && runParam) setStatus((current) => (current === "ready" ? current : "missing"));
      else setStatus((current) => (current === "ready" ? current : "empty"));
    }
  }, [projectId, runParam]);

  useEffect(() => {
    setStatus("loading");
    setData(null);
    void load();
  }, [load]);

  useEffect(() => {
    if (findingsLink && status === "ready") document.getElementById("findings")?.scrollIntoView({ block: "start" });
  }, [findingsLink, status]);

  const drillTo = useCallback((title: string, ids: string[]) => setDrill({ title, ids }), []);
  const explainTo = useCallback((content: ExplainContent) => setExplain(content), []);
  const closeDrill = useCallback(() => setDrill(null), []);
  const closeExplain = useCallback(() => setExplain(null), []);
  const goToRun = useCallback((runId: string, view: string = currentView) => router.push(href(view, runId)), [router, href, currentView]);

  const reanalyse = async () => {
    if (!data) return;
    setWorking("reanalyse");
    setNotice(null);
    try {
      const result = await api.reanalyseCollectionRun(data.run.id);
      setNotice(`${result.analysed} answer${result.analysed === 1 ? "" : "s"} re-analysed with the current rules${result.failed > 0 ? `, ${result.failed} failed` : ""}.`);
      await load();
    } catch (error) {
      setNotice(error instanceof ApiError ? error.message : "Re-analysis did not run. Try again.");
    } finally {
      setWorking(null);
    }
  };

  if (status === "loading") return <MeasureSkeleton projectId={projectId} />;

  if (status === "missing") {
    return (
      <main className="min-h-screen pb-24">
        <JourneyNav projectId={projectId} current="measure" />
        <div className="mx-auto max-w-6xl px-4 py-8 sm:px-6">
          <Eyebrow tone="sun">Step 4 of 4 · Measure</Eyebrow>
          <h1 className="sun-title mt-2">That measurement isn’t here</h1>
          <p className="mt-2 max-w-2xl text-sm leading-6 text-ink-600">No measurement with that id belongs to this project. The latest one is a click away.</p>
          <Link href={href("overview", null)} className="focus-ring mt-4 inline-block rounded text-sm font-medium text-brand-600 hover:underline">
            Open the latest measurement →
          </Link>
        </div>
      </main>
    );
  }

  const measure = data?.measure;
  if (!data || !measure) {
    return (
      <main className="min-h-screen pb-24">
        <JourneyNav projectId={projectId} current="measure" />
        <div className="mx-auto max-w-6xl px-4 py-8 sm:px-6">
          <Eyebrow tone="sun">Step 4 of 4 · Measure</Eyebrow>
          <h1 className="sun-title mt-2">Collect the answers</h1>
          <p className="mt-2.5 max-w-2xl text-[15px] leading-6 text-ink-600">
            Ask {engineNames(enabledEngines)} the approved questions. Results appear here as soon as the first answers arrive, and every figure opens the answers behind it.
          </p>
          <div className="mt-6">
            <ObservationConsole projectId={projectId} collectionRunId={null} onEvidence={load} onActivity={setActivity} onRunCreated={(id) => goToRun(id, "overview")} />
          </div>
        </div>
      </main>
    );
  }

  const byProvider = measure.coverage.byProvider as Record<string, Counts>;
  const automatic = Object.entries(byProvider).filter(([route]) => !isByHandRoute(route)).map(([, counts]) => counts);
  const byHand = Object.entries(byProvider).filter(([route]) => isByHandRoute(route)).map(([, counts]) => counts);
  // Asking by hand is optional extra evidence: its unasked questions do not make
  // a finished automatic run look unfinished.
  const planned = automatic.length > 0 ? sum(automatic.map((c) => c.planned)) : sum(byHand.map((c) => c.planned));
  const captured = automatic.length > 0 ? sum(automatic.map((c) => c.captured)) : sum(byHand.map((c) => c.captured));
  const finalised = data.run.status === "completed";
  const incomplete = captured < planned && !finalised;
  // Collection opens by itself only when there is nothing to read yet or a run
  // is active; a paused or partial run is reachable from the banner and header.
  const open = collectionOpen ?? (captured === 0 || Boolean(activity?.running));
  const phase: "collecting" | "partial" | "complete" | "closed" = activity?.running ? "collecting" : finalised && captured < planned ? "closed" : incomplete ? "partial" : "complete";

  const engines = Object.keys(measure.coverage.byEngine);
  const activeScope = scope === "combined" || engines.includes(scope) ? scope : "combined";
  const brand: string = measure.brands.find((row) => row.relation === "target")?.name ?? "your brand";
  const answersIn = (key: string) => (key === "combined" ? measure.coverage.analysable : (measure.coverage.byEngine[key]?.analysable ?? 0));
  const newerPromptSet = Boolean(data.latestApprovedPromptSet?.newerThanRun);
  const isLatestRun = history ? history[0]?.runId === data.run.id : !runParam;

  return (
    <MeasureContext.Provider value={{ data, brand, scope: activeScope, provisional: incomplete, lowN: data.lowN, onExplain: explainTo, onDrill: drillTo }}>
      <main className="min-h-screen pb-24">
        <div className="print:hidden">
          <JourneyNav projectId={projectId} current="measure" />
        </div>

        <header className="border-b border-ink-200/70 bg-paper">
          <div className="mx-auto max-w-6xl px-4 pb-0 pt-7 sm:px-6">
            <div className="flex flex-col gap-5 lg:flex-row lg:items-end lg:justify-between">
              <div className="min-w-0">
                <Eyebrow tone="sun">Step 4 of 4 · Measure</Eyebrow>
                <h1 className="sun-title mt-2">
                  How {engineNames(engines.length > 0 ? engines : enabledEngines)} {(engines.length > 0 ? engines : enabledEngines).length === 1 ? "talks" : "talk"} about {brand}
                </h1>
                <div className="mt-3 flex flex-wrap items-center gap-x-3 gap-y-2 text-sm text-ink-600">
                  <PhaseChip phase={phase} />
                  <span className="tabular-nums">
                    <b className="font-semibold text-ink-950">{captured}</b> of {planned} answers collected
                  </span>
                  <span className="text-ink-300" aria-hidden="true">·</span>
                  <span>{data.sampling.label}</span>
                  <span className="text-ink-300" aria-hidden="true">·</span>
                  <span>
                    measured {formatDate(data.run.createdAt)}
                    {data.snapshot ? "" : finalised ? "" : ", provisional"}
                  </span>
                </div>
              </div>
              <div className="flex flex-wrap items-center gap-2 print:hidden">
                {history && history.length > 1 && (
                  <label className="flex items-center gap-2 text-xs text-ink-500">
                    <span className="sr-only">Measurement</span>
                    <Select aria-label="Measurement" value={data.run.id} onChange={(event) => goToRun(event.target.value)} className="w-auto text-sm">
                      {history.map((entry, index) => (
                        <option key={entry.runId} value={entry.runId}>
                          {formatDate(entry.createdAt)}
                          {index === 0 ? " (latest)" : ""} · v{entry.promptSetVersion ?? "?"} · {entry.coverage.analysable} of {entry.coverage.planned}
                        </option>
                      ))}
                    </Select>
                  </label>
                )}
                {engines.length > 1 && (
                  <SegmentedControl
                    label="Answers from"
                    value={activeScope}
                    onChange={setScope}
                    options={["combined", ...engines].map((key) => ({ value: key, label: key === "combined" ? "All" : engineName(key), count: answersIn(key) }))}
                  />
                )}
                <ExportMenu projectId={projectId} runId={data.run.id} href={(view) => href(view)} />
                <Button variant={!open && incomplete && !activity?.running ? "accent" : "secondary"} onClick={() => setCollectionOpen(!open)} aria-expanded={open} aria-controls="collection">
                  {open ? "Hide collection" : finalised || !incomplete ? "Collect again" : "Continue collecting"}
                </Button>
              </div>
            </div>
            <nav role="tablist" aria-label="Measure views" className="-mx-4 mt-5 flex gap-1 overflow-x-auto px-4 sm:-mx-6 sm:px-6 print:hidden">
              {VIEWS.map((item) => {
                const active = item.key === currentView;
                return (
                  <Link
                    key={item.key}
                    role="tab"
                    aria-selected={active}
                    href={href(item.key)}
                    className={cn(
                      "focus-ring relative shrink-0 px-3 py-2.5 text-sm font-medium transition-colors after:absolute after:inset-x-3 after:-bottom-px after:h-0.5 after:rounded-full after:content-['']",
                      active ? "text-ink-950 after:bg-sun-500" : "text-ink-500 hover:text-ink-900 after:bg-transparent hover:after:bg-ink-200",
                    )}
                  >
                    {item.label}
                  </Link>
                );
              })}
            </nav>
          </div>
        </header>

        <div className="mx-auto max-w-6xl space-y-8 px-4 py-7 sm:px-6">
          {!isLatestRun && history && (
            <Notice
              tone="info"
              className="print:hidden"
              action={
                <Link href={href(currentView, history[0]!.runId)} className="focus-ring rounded text-sm font-medium text-brand-600 hover:underline">
                  Open the latest →
                </Link>
              }
            >
              You are looking at the measurement of {formatDate(data.run.createdAt)}.
            </Notice>
          )}
          {newerPromptSet && isLatestRun && (
            <Notice
              tone="sun"
              className="print:hidden"
              action={
                <button type="button" onClick={() => setCollectionOpen(true)} className="focus-ring rounded text-sm font-medium text-brand-600 hover:underline">
                  Start a new measurement
                </button>
              }
            >
              Your questions changed since this measurement (v{data.latestApprovedPromptSet?.version} was approved). This run keeps measuring the questions it asked; a new run
              measures the new ones and will not be compared with this one.
            </Notice>
          )}
          {incomplete && <ProvisionalBanner captured={captured} planned={planned} activity={activity} onCollect={open ? undefined : () => setCollectionOpen(true)} />}
          {incomplete && !open && (
            <p className="-mt-4 text-xs leading-5 text-ink-600">
              Figures marked “so far” use only the answers collected. Missing answers are left out of every figure, never counted as the brand being absent. You can also
              finish with what was collected from the collection panel; the result is then kept as it is.
            </p>
          )}
          {measure.lineage.staleAnalyses > 0 && (
            <Notice
              tone="info"
              className="print:hidden"
              action={
                <Button size="sm" variant="secondary" onClick={reanalyse} disabled={working === "reanalyse"}>
                  {working === "reanalyse" ? "Updating…" : "Update results"}
                </Button>
              }
            >
              {measure.lineage.staleAnalyses} answer{measure.lineage.staleAnalyses === 1 ? " was" : "s were"} read with older rules. Updating reads them again with the
              current rules; the answers themselves don’t change, but the figures may.
            </Notice>
          )}
          {notice && (
            <Notice tone="info" className="print:hidden">
              {notice}
            </Notice>
          )}

          {/* Mounted even when hidden, so an active run keeps reporting progress. */}
          <section id="collection" hidden={!open} className="scroll-mt-24 print:hidden">
            <ObservationConsole projectId={projectId} collectionRunId={data.run.id} onEvidence={load} onActivity={setActivity} onRunCreated={(id) => goToRun(id, "overview")} newerPromptSet={newerPromptSet} />
          </section>

          {currentView === "overview" && <OverviewView projectId={projectId} view={(name) => href(name)} />}
          {currentView === "performance" && <PerformanceView initialSection={sectionParam} />}
          {currentView === "brands" && <BrandsView />}
          {currentView === "sources" && <SourcesView />}
          {currentView === "report" && <ReportView projectId={projectId} history={history} view={(name) => href(name)} />}
          {currentView === "answers" && <AnswersView projectId={projectId} reportHref={href("report")} />}

        </div>

        {explain && <ExplainDrawer content={explain} onClose={closeExplain} />}
        {drill && <EvidenceDrawer title={drill.title} ids={drill.ids} onClose={closeDrill} />}
      </main>
    </MeasureContext.Provider>
  );
}

// --- Page frame -----------------------------------------------------------------

function PhaseChip({ phase }: { phase: "collecting" | "partial" | "complete" | "closed" }) {
  const style = { collecting: "bg-sun-100 text-sun-900", partial: "bg-warn-100 text-warn-600", complete: "bg-ok-100 text-ok-600", closed: "bg-ink-100 text-ink-700" }[phase];
  const dot = { collecting: "sun", partial: "warn", complete: "ok", closed: "neutral" }[phase] as "sun" | "warn" | "ok" | "neutral";
  const label = { collecting: "Collecting", partial: "Partial results", complete: "Complete", closed: "Closed with what was collected" }[phase];
  return (
    <span className={`inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-xs font-semibold ${style}`}>
      <StatusDot tone={dot} pulse={phase === "collecting"} />
      {label}
    </span>
  );
}

/**
 * Pinned while answers are missing. Figures use the answers collected so far,
 * so the reader always knows a number may still move.
 */
function ProvisionalBanner({ captured, planned, activity, onCollect }: { captured: number; planned: number; activity: ActivityState | null; onCollect?: () => void }) {
  const running = Boolean(activity?.running);
  const paused = [...new Set(activity?.pausedRoutes ?? [])];
  // A used-up free quota comes back by itself; an empty balance or a rejected key does not.
  const accountPaused = paused.filter((route) => activity?.pausedReasons?.[route] === "no_credits" || activity?.pausedReasons?.[route] === "key_rejected");
  // The site itself refused, or the provider could not reach it: the run re-checks by itself.
  const sitePaused = paused.filter((route) => activity?.pausedReasons?.[route] === "vendor_unhealthy" || activity?.pausedReasons?.[route] === "target_blocked");
  const quotaPaused = paused.filter((route) => !accountPaused.includes(route) && !sitePaused.includes(route));
  const retryAt = activity?.resumesAt ? new Date(activity.resumesAt).toLocaleTimeString([], { hour: "numeric", minute: "2-digit" }) : null;
  const recheckAt = activity?.recheckAt ? new Date(activity.recheckAt).toLocaleTimeString([], { hour: "numeric", minute: "2-digit" }) : null;
  const done = planned > 0 ? (captured / planned) * 100 : 0;
  return (
    <div role="status" aria-live="polite" className="sticky top-[3.75rem] z-30 rounded-2xl border border-warn-500/30 bg-white/95 px-4 py-2.5 shadow-float backdrop-blur print:hidden lg:top-16">
      <div className="flex flex-wrap items-center justify-between gap-x-4 gap-y-2">
        <p className="flex items-center gap-2 text-sm font-semibold text-ink-950">
          <StatusDot tone={running ? "sun" : "warn"} pulse={running} />
          {running ? "Collecting: results update as each answer arrives" : "Partial results: some answers are not collected yet"}
        </p>
        <p className="flex items-center gap-3 text-sm tabular-nums text-ink-600">
          <span>
            <b className="font-semibold text-ink-900">{captured}</b> of {planned} collected
            {running && activity?.etaMs ? ` · ${formatEta(activity.etaMs)} left` : ""}
          </span>
          {onCollect && (
            <button type="button" onClick={onCollect} className="focus-ring rounded text-sm font-medium text-brand-600 hover:underline">
              Continue collecting
            </button>
          )}
        </p>
      </div>
      <div className="mt-2.5 h-1.5 overflow-hidden rounded-full bg-ink-100" aria-hidden="true">
        <div className="h-full rounded-full bg-sun-500 transition-all duration-700" style={{ width: `${done}%` }} />
      </div>
      {quotaPaused.length > 0 && (
        <p className="mt-2 text-xs font-medium text-warn-600">
          {quotaPaused.join(" and ")} paused: its collection limit is used up for now.{retryAt ? ` It collects the rest after ${retryAt}.` : " Collect the rest later."}
        </p>
      )}
      {accountPaused.length > 0 && (
        <p className="mt-2 text-xs font-medium text-warn-600">
          {accountPaused.join(" and ")} paused: the collection account is out of credits, over its plan, or its key wasn’t accepted. Fix the key on this
          computer, then continue collecting.
        </p>
      )}
      {sitePaused.length > 0 && (
        <p className="mt-2 text-xs font-medium text-warn-600">
          {sitePaused.join(" and ")} paused: the site could not be reached just now.
          {recheckAt ? ` The run checks again at ${recheckAt}.` : " Collect again later."}
        </p>
      )}
    </div>
  );
}
