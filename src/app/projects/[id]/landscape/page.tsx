"use client";
import { useEffect, useMemo, useRef, useState, use as usePromise } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { JourneyNav } from "@/components/features/journey-nav";
import { EvidencePanel } from "@/components/features/profile-fields";
import { FactStrip, StageHeader } from "@/components/features/stage-header";
import { LandscapeSkeleton, StageStopped } from "@/components/features/stage-skeletons";
import { StickyActions } from "@/components/features/sticky-actions";
import { Button, buttonVariants } from "@/components/ui/button";
import { LoadingStage } from "@/components/ui/loading-stage";
import { Card, CardBody, CardHeader, Badge, Input, Notice, Select, Spinner, StatusDot, EmptyState } from "@/components/ui/primitives";
import { cn } from "@/lib/cn";
import { api, ApiError } from "@/lib/client/api";
import {
  competitorSourceLabels,
  groupCompetitorsByTier,
  isEligibleCompetitor,
  shouldAutoGenerate,
  tierOptions,
  tradeOffsHint,
  visibleCompetitors,
  type TierGroup,
} from "@/lib/client/landscape-view";
import { cycleAfter, deriveLandscapeProgress, landscapeJoinSince, openLandscapeCycle } from "@/lib/client/stage-progress";
import { SLOW_AFTER_MS, STALLED_AFTER_MS } from "@/lib/client/understand-phase";
import { useProjectEvents, type SunEventPayload } from "@/lib/client/use-project-events";

// Landscape renders at once with a loading panel and reveals topics and
// competitors together when generation finishes. It used to wait for the whole
// request before drawing anything, then streamed an empty Topics card and "No
// verified suggestions yet" while work was still running (feedback 2026-09-14:
// "In Landscape, it is not showing page until it is completed loaded").

const COMPETITOR_TYPE_LABEL: Record<string, string> = {
  direct: "Direct",
  substitute: "Substitute",
  marketplace: "Marketplace / aggregator",
  adjacent: "Adjacent",
};

type Phase = "loading" | "profile_unconfirmed" | "generating" | "stalled" | "ready" | "failed" | "error";

/** With no terminal event for this long after the last cycle event, the safety poll checks whether generation ended silently. */
const QUIET_MS = 8_000;

/** Resolves true once `check` passes, or false if `cancelled` turns true first. */
function waitUntil(check: () => boolean, cancelled: () => boolean): Promise<boolean> {
  return new Promise((resolve) => {
    const tick = () => {
      if (cancelled()) resolve(false);
      else if (check()) resolve(true);
      else setTimeout(tick, 100);
    };
    tick();
  });
}

export default function LandscapePage({ params }: { params: Promise<{ id: string }> }) {
  const { id: projectId } = usePromise(params);
  const router = useRouter();
  const { events, hydrated } = useProjectEvents(projectId);
  const [landscape, setLandscape] = useState<any>(null);
  const [phase, setPhase] = useState<Phase>("loading");
  // Generation cycle: events after `cycleSince` belong to the run this page is waiting for.
  const [cycleSince, setCycleSince] = useState<number | null>(null);
  const [requestedAt, setRequestedAt] = useState<number | null>(null);
  const [topicsExisted, setTopicsExisted] = useState(false);
  const [now, setNow] = useState(() => Date.now());
  const [error, setError] = useState<string | null>(null);
  const [newTopic, setNewTopic] = useState("");
  const [newCompetitor, setNewCompetitor] = useState("");
  const [newCompetitorType, setNewCompetitorType] = useState("direct");
  const [newCompetitorTier, setNewCompetitorTier] = useState("");
  const [whyId, setWhyId] = useState<string | null>(null);
  const [mutating, setMutating] = useState(false);
  const [confirming, setConfirming] = useState(false);
  const initStartedRef = useRef(false);
  const generateInFlightRef = useRef(false);
  const mutatingRef = useRef(false);
  const refreshSequenceRef = useRef(0);
  const eventsRef = useRef<SunEventPayload[]>(events);
  const hydratedRef = useRef(hydrated);
  const unmountedRef = useRef(false);
  useEffect(() => {
    eventsRef.current = events;
    hydratedRef.current = hydrated;
  }, [events, hydrated]);
  useEffect(() => {
    unmountedRef.current = false;
    return () => {
      unmountedRef.current = true;
    };
  }, []);

  async function refresh() {
    if (mutatingRef.current) return landscape;
    const sequence = ++refreshSequenceRef.current;
    const { landscape: next } = await api.getLandscape(projectId);
    if (sequence !== refreshSequenceRef.current || mutatingRef.current) return next;
    setLandscape(next);
    return next;
  }

  async function startGeneration() {
    if (generateInFlightRef.current) return;
    generateInFlightRef.current = true;
    // Null until the log has loaded: an empty unloaded log is not "nothing happened".
    const before = hydratedRef.current ? (eventsRef.current.at(-1)?.sequence ?? 0) : null;
    setError(null);
    setCycleSince(before);
    setRequestedAt(Date.now());
    setNow(Date.now());
    setPhase("generating");
    try {
      const started = await api.generateLandscape(projectId);
      if (started?.status === "already_running") {
        setCycleSince(landscapeJoinSince(eventsRef.current, hydratedRef.current) ?? before);
      } else if (typeof started?.sinceSequence === "number") {
        setCycleSince(started.sinceSequence);
      }
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Could not start competitor discovery.");
      setPhase("failed");
    } finally {
      generateInFlightRef.current = false;
    }
  }

  useEffect(() => {
    // One init per page visit (React StrictMode runs effects twice in dev).
    if (initStartedRef.current) return;
    initStartedRef.current = true;
    void (async () => {
      let next: any;
      let profileVersion: any = null;
      try {
        const [landscapeResult, profileResult] = await Promise.all([
          api.getLandscape(projectId),
          api.getProfile(projectId).catch((err) => {
            if (err instanceof ApiError && err.status === 404) return null;
            throw err;
          }),
        ]);
        next = landscapeResult.landscape;
        profileVersion = profileResult?.profileVersion ?? null;
      } catch {
        setError("Could not load the landscape.");
        setPhase("error");
        return;
      }
      setLandscape(next);
      // Generating against an unconfirmed profile only fails on the server.
      if (!profileVersion?.confirmedAt) {
        setPhase("profile_unconfirmed");
        return;
      }

      // Read the event log first, so a generation already running (another tab,
      // or before a reload) is joined rather than started twice. No timeout: the
      // hook marks the log loaded even when its poll fails, and joining from an
      // unloaded log scoped the cycle to the whole history (review 2026-09-14).
      if (!(await waitUntil(() => hydratedRef.current, () => unmountedRef.current))) return;
      const log = eventsRef.current;
      const open = openLandscapeCycle(log);
      const joinSince = landscapeJoinSince(log, true);
      const openFresh = Boolean(open) && Date.now() - (open!.events.at(-1)?.createdAt ?? 0) < STALLED_AFTER_MS;
      const running = next.discovery?.status === "running";
      const liveTopicCount = (next.topics ?? []).filter((topic: any) => topic.status !== "removed").length;
      setTopicsExisted(liveTopicCount > 0);

      if (next.inProgress === false && (running || openFresh)) {
        // The server says nothing is running: the run was stranded by a restart.
        setCycleSince(joinSince);
        setPhase("stalled");
        return;
      }
      if (running || openFresh || next.inProgress === true) {
        setCycleSince(joinSince);
        setRequestedAt(open?.startedAt ?? Date.now());
        setPhase("generating");
        return;
      }
      if (shouldAutoGenerate({ liveTopicCount, hasDiscovery: Boolean(next.discovery), stale: Boolean(next.stale), inFlight: false })) {
        await startGeneration();
        return;
      }
      setPhase(next.discovery?.status === "failed" ? "failed" : "ready");
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [projectId]);

  // A generation started before the log loaded has no cycle yet; scope it once the log arrives.
  useEffect(() => {
    if (cycleSince !== null || !hydrated || (phase !== "generating" && phase !== "stalled")) return;
    setCycleSince(landscapeJoinSince(events, true));
  }, [cycleSince, hydrated, phase, events]);

  const cycle = useMemo(() => (cycleSince === null ? [] : cycleAfter(events, cycleSince)), [events, cycleSince]);
  const progress = useMemo(() => deriveLandscapeProgress(cycle, { topicsExisted }), [cycle, topicsExisted]);
  const lastCycleEventAt = cycle.at(-1)?.createdAt ?? null;

  // Generation ends on the cycle's terminal event: read the finished lists, then reveal them.
  useEffect(() => {
    if (phase !== "generating" || !progress.terminal) return;
    const outcome = progress.terminal;
    void refresh()
      .catch(() => undefined)
      .finally(() => setPhase(outcome === "ready" ? "ready" : "failed"));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [phase, progress.terminal]);

  // A clock for the slow note and stall detection while generating.
  useEffect(() => {
    if (phase !== "generating") return;
    const timer = setInterval(() => setNow(Date.now()), 5_000);
    return () => clearInterval(timer);
  }, [phase]);

  useEffect(() => {
    if (phase !== "generating") return;
    const quietSince = lastCycleEventAt ?? requestedAt ?? now;
    if (now - quietSince > STALLED_AFTER_MS) setPhase("stalled");
  }, [phase, now, lastCycleEventAt, requestedAt]);

  // Safety net while generating: a run that ended without a terminal event
  // (an older server's early return) or was stranded by a restart.
  useEffect(() => {
    if (phase !== "generating") return;
    const timer = setInterval(() => {
      void api
        .getLandscape(projectId)
        .then(({ landscape: next }) => {
          const quietSince = Math.max(lastCycleEventAt ?? 0, requestedAt ?? 0);
          if (Date.now() - quietSince < QUIET_MS || generateInFlightRef.current) return;
          const running = next.discovery?.status === "running";
          if (next.inProgress === false) {
            setLandscape(next);
            setPhase(running ? "stalled" : next.discovery?.status === "failed" ? "failed" : "ready");
            return;
          }
          const liveTopicCount = (next.topics ?? []).filter((topic: any) => topic.status !== "removed").length;
          if (next.inProgress === undefined && !running && liveTopicCount > 0) {
            setLandscape(next);
            setPhase(next.discovery?.status === "failed" ? "failed" : "ready");
          }
        })
        .catch(() => undefined);
    }, 5_000);
    return () => clearInterval(timer);
  }, [phase, projectId, lastCycleEventAt, requestedAt]);

  async function updateTopic(id: string, status: "confirmed" | "removed") {
    await applyLandscapePatch({ action: "update", topicUpdates: [{ id, status }] });
  }

  async function updateCompetitor(id: string, patch: Record<string, unknown>) {
    await applyLandscapePatch({ action: "update", competitorUpdates: [{ id, ...patch }] });
  }

  async function applyLandscapePatch(body: Record<string, unknown>) {
    if (mutatingRef.current) return landscape;
    mutatingRef.current = true;
    setMutating(true);
    ++refreshSequenceRef.current;
    try {
      const { landscape: updated } = await api.patchLandscape(projectId, body);
      setLandscape(updated);
      return updated;
    } finally {
      mutatingRef.current = false;
      setMutating(false);
    }
  }

  async function addTopic() {
    if (!newTopic.trim()) return;
    await applyLandscapePatch({ action: "update", addTopic: { name: newTopic.trim() } });
    setNewTopic("");
  }

  const tierPlan = landscape?.tierPlan ?? null;
  const tierChoices = tierOptions(tierPlan);

  async function addCompetitor() {
    if (!newCompetitor.trim()) return;
    const tier = newCompetitorTier || tierPlan?.primaryTier || tierChoices[0]?.value;
    await applyLandscapePatch({
      action: "update",
      addCompetitor: { canonicalName: newCompetitor.trim(), competitorType: newCompetitorType, ...(tier && tierChoices.length > 0 ? { tier } : {}) },
    });
    setNewCompetitor("");
  }

  async function confirmAndContinue() {
    setError(null);
    setConfirming(true);
    try {
      await api.patchLandscape(projectId, { action: "confirm" });
      // Stays pending until the Prompts route replaces this page.
      router.push(`/projects/${projectId}/prompts`);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Could not freeze the competitive set.");
      setConfirming(false);
    }
  }

  async function retryDiscovery() {
    if (phase === "generating" || mutating) return;
    await startGeneration();
  }

  const visible = visibleCompetitors<any>(landscape?.competitors);
  const groups = useMemo(() => groupCompetitorsByTier<any>(landscape?.competitors ?? [], tierPlan), [landscape, tierPlan]);
  const confirmedTopicCount = landscape?.topics?.filter((topic: any) => topic.status === "confirmed").length ?? 0;
  // Same rule as the API and the frozen competitive set: any confirmed rival
  // except a marketplace. This page still required Direct or Substitute after
  // the server rule changed, which disabled Confirm for a set of confirmed
  // adjacent rivals the server would have accepted.
  const eligibleCompetitors = visible.filter(isEligibleCompetitor);
  const gateMet = confirmedTopicCount >= 4 && confirmedTopicCount <= 6 && eligibleCompetitors.length > 0;
  const nextStepRequirements = [
    ...(confirmedTopicCount < 4 ? [`Confirm ${4 - confirmedTopicCount} more topic${4 - confirmedTopicCount === 1 ? "" : "s"} (4–6 are required).`] : []),
    ...(confirmedTopicCount > 6 ? ["Keep no more than 6 topics before continuing."] : []),
    ...(eligibleCompetitors.length === 0 ? ["Confirm at least one competitor that is not a marketplace for Trade Off prompts."] : []),
  ];
  const tradeOffNote = gateMet ? tradeOffsHint(groups) : null;
  const slow = phase === "generating" && now - (lastCycleEventAt ?? requestedAt ?? now) > SLOW_AFTER_MS;

  useEffect(() => {
    if (gateMet && (phase === "ready" || phase === "failed")) router.prefetch(`/projects/${projectId}/prompts`);
  }, [gateMet, phase, projectId, router]);

  const showLists = phase === "ready" || phase === "failed";

  const tierHeadings: string[] = (tierPlan?.tiers ?? []).map((tier: any) => tier.heading).filter(Boolean);
  const topicsInRange = confirmedTopicCount >= 4 && confirmedTopicCount <= 6;
  const stageAside =
    showLists && landscape ? (
      <>
        <Badge tone={topicsInRange ? "ok" : "warn"} className="gap-1.5">
          <StatusDot tone={topicsInRange ? "ok" : "warn"} />
          {confirmedTopicCount} of 4–6 topics
        </Badge>
        <Badge tone={eligibleCompetitors.length > 0 ? "ok" : "warn"} className="gap-1.5">
          <StatusDot tone={eligibleCompetitors.length > 0 ? "ok" : "warn"} />
          {eligibleCompetitors.length} eligible {eligibleCompetitors.length === 1 ? "rival" : "rivals"}
        </Badge>
      </>
    ) : null;

  return (
    <main className="min-h-screen pb-6">
      <JourneyNav projectId={projectId} current="landscape" />
      <div className="mx-auto max-w-5xl px-4 py-8 sm:px-6">
        <StageHeader
          stage="landscape"
          title="Topics & competitors"
          lede={
            phase === "generating"
              ? "We're finding the topics buyers ask about and the competitors they compare. Your list appears here when the search is finished."
              : "Confirm 4–6 topics and the competitors buyers genuinely compare. This context is frozen before prompts are created."
          }
          aside={stageAside}
        />

        {phase === "loading" && (
          <>
            <LoadingStage className="mt-6" title="Loading topics and competitors" />
            <LandscapeSkeleton className="mt-6" />
          </>
        )}

        {phase === "profile_unconfirmed" && (
          <div className="mt-6">
            <EmptyState
              title="Confirm your brand profile first"
              description="Topics and competitors are built from the confirmed profile."
              action={
                <Link href={`/projects/${projectId}/understand`} className={buttonVariants()}>
                  Back to Understand
                </Link>
              }
            />
          </div>
        )}

        {phase === "error" && (
          <div className="mt-6">
            <EmptyState title="Not ready yet" description={error ?? "Could not load the landscape."} />
          </div>
        )}

        {phase === "generating" && (
          <>
            <LoadingStage
              className="mt-6"
              title="Building your landscape"
              steps={progress.steps}
              complete={progress.terminal === "ready"}
              startedAt={requestedAt}
              note={slow ? "This is taking longer than usual. The page updates by itself." : undefined}
            />
            <LandscapeSkeleton className="mt-6" tierCount={tierPlan?.tiers?.length ?? 0} />
          </>
        )}

        {phase === "stalled" && (
          <StageStopped
            className="mt-6"
            title="Competitor search stopped before it finished"
            description="This can happen if the app restarted while it was working."
            steps={progress.steps}
            note={landscape?.inProgress === undefined ? "Restart the app, then open this page again." : undefined}
          >
            {landscape?.inProgress !== undefined && (
              <Button onClick={retryDiscovery} disabled={mutating}>
                Start again
              </Button>
            )}
          </StageStopped>
        )}

        {showLists && landscape && (
          <div className="mt-6 space-y-5">
            {/* What is fixed here, and what each decision feeds. */}
            <FactStrip
              items={[
                {
                  label: "Measuring",
                  value: landscape.target?.canonicalName ?? "This business",
                  hint: tierHeadings.length > 0 ? `Rivals ${tierHeadings.map(lowerFirst).join(" · ")}` : "Rivals wherever the evidence places them",
                  tone: "sun",
                },
                {
                  label: "Topics",
                  value: `${confirmedTopicCount} of 4–6 confirmed`,
                  hint: "Each becomes Discovery questions that never name a brand.",
                  tone: topicsInRange ? "ok" : "warn",
                },
                {
                  label: "Competitors",
                  value: `${eligibleCompetitors.length} eligible confirmed`,
                  hint: "Named in Trade Off questions and tracked in Measure.",
                  tone: eligibleCompetitors.length > 0 ? "ok" : "warn",
                },
                {
                  label: "Frozen on continue",
                  value: "Topics and competitive set",
                  hint: "Prompts are written from exactly this context; a later change starts a new version.",
                },
              ]}
            />

            <Card>
              <CardHeader className="flex flex-wrap items-center justify-between gap-3">
                <div>
                  <div className="text-base font-semibold text-ink-950">Topics</div>
                  <p className="mt-0.5 text-xs leading-5 text-ink-500">What buyers ask about when they ask about businesses like this one.</p>
                </div>
                <Badge tone={topicsInRange ? "ok" : "warn"}>{confirmedTopicCount}/4–6 confirmed</Badge>
              </CardHeader>
              <CardBody className="space-y-2">
                {landscape.topics
                  .filter((topic: any) => topic.status !== "removed")
                  .map((topic: any) => {
                    const confirmed = topic.status === "confirmed";
                    return (
                      <div key={topic.id} className={cn("flex flex-col gap-3 rounded-xl border px-3.5 py-3 sm:flex-row sm:items-start sm:justify-between", confirmed ? "border-sun-200 bg-sun-50/50" : "border-ink-100 bg-white")}>
                        <div className="flex min-w-0 gap-3">
                          <ChoiceGlyph confirmed={confirmed} />
                          <div className="min-w-0">
                            <div className="text-sm font-medium text-ink-950">{topic.name}</div>
                            <div className="mt-0.5 text-xs leading-5 text-ink-500">{topic.description}</div>
                          </div>
                        </div>
                        <div className="flex shrink-0 items-center gap-1.5 sm:pl-3">
                          {confirmed ? (
                            <Badge tone="ok">Confirmed</Badge>
                          ) : (
                            <Button size="sm" variant="secondary" disabled={mutating} onClick={() => updateTopic(topic.id, "confirmed")}>
                              Confirm
                            </Button>
                          )}
                          <Button size="sm" variant="ghost" disabled={mutating} onClick={() => updateTopic(topic.id, "removed")}>
                            Remove
                          </Button>
                        </div>
                      </div>
                    );
                  })}
                <div className="flex flex-col gap-2 pt-2 sm:flex-row">
                  <Input aria-label="New topic" placeholder="Add a topic…" value={newTopic} onChange={(event) => setNewTopic(event.target.value)} onKeyDown={(event) => event.key === "Enter" && addTopic()} />
                  <Button variant="secondary" disabled={mutating} onClick={addTopic}>
                    Add topic
                  </Button>
                </div>
              </CardBody>
            </Card>

            <Card>
              <CardHeader className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
                <div>
                  <div className="text-base font-semibold text-ink-950">Competitors</div>
                  <p className="mt-0.5 text-xs leading-5 text-ink-500">
                    Who buyers compare <span className="font-medium text-ink-800">{landscape.target?.canonicalName}</span> with, grouped by where they compete.
                  </p>
                </div>
                <Badge tone={eligibleCompetitors.length > 0 ? "ok" : "warn"}>{eligibleCompetitors.length} eligible confirmed</Badge>
              </CardHeader>
              <CardBody className="space-y-3">
                {phase === "failed" && (
                  <div className="space-y-3">
                    <EmptyState title="We couldn't finish finding competitors" description="Add the competitors you know, or try the automatic search again." />
                    <div className="flex justify-center">
                      <Button size="sm" variant="secondary" disabled={mutating} onClick={retryDiscovery}>
                        Retry automatic discovery
                      </Button>
                    </div>
                  </div>
                )}
                {phase === "ready" && visible.length === 0 && (
                  <div className="space-y-3">
                    <EmptyState title="No suggestions yet" description="The automatic search did not find a competitor for this website. Add one you know below, or run the search again. Anything you add is labelled as added by you." />
                    <div className="flex justify-center">
                      <Button size="sm" variant="secondary" disabled={mutating} onClick={retryDiscovery}>
                        Retry automatic discovery
                      </Button>
                    </div>
                  </div>
                )}

                {visible.length > 0 &&
                  groups.map((group) => (
                    <CompetitorGroup
                      key={group.key}
                      group={group}
                      grouped={groups.length > 1 || Boolean(group.heading)}
                      whyId={whyId}
                      mutating={mutating}
                      onWhy={(id) => setWhyId(whyId === id ? null : id)}
                      onUpdate={updateCompetitor}
                    />
                  ))}

                <div className="sun-inset p-3">
                  <p className="mb-2 text-xs font-medium text-ink-700">Add a competitor you know</p>
                  <div className={tierChoices.length > 0 ? "grid gap-2 sm:grid-cols-[1fr_11rem_11rem_auto]" : "grid gap-2 sm:grid-cols-[1fr_13rem_auto]"}>
                    <Input aria-label="New competitor" placeholder="Add a competitor…" value={newCompetitor} onChange={(event) => setNewCompetitor(event.target.value)} onKeyDown={(event) => event.key === "Enter" && addCompetitor()} />
                    <Select aria-label="Competitor relationship" value={newCompetitorType} onChange={(event) => setNewCompetitorType(event.target.value)}>
                      {Object.entries(COMPETITOR_TYPE_LABEL).map(([value, label]) => (
                        <option key={value} value={value}>
                          {label}
                        </option>
                      ))}
                    </Select>
                    {tierChoices.length > 0 && (
                      <Select aria-label="Where it competes" value={newCompetitorTier || tierPlan?.primaryTier || tierChoices[0]!.value} onChange={(event) => setNewCompetitorTier(event.target.value)}>
                        {tierChoices.map((choice) => (
                          <option key={choice.value} value={choice.value}>
                            {choice.label}
                          </option>
                        ))}
                      </Select>
                    )}
                    <Button variant="secondary" disabled={mutating} onClick={addCompetitor}>
                      Add competitor
                    </Button>
                  </div>
                </div>
                <p className="text-xs leading-5 text-ink-500">
                  Confirmed Direct, Substitute and Adjacent competitors are compared in Trade Off prompts and tracked in Measure. Marketplaces are where people buy rather than what they
                  choose between, so they are never compared.
                </p>
              </CardBody>
            </Card>

            {error && (
              <Notice tone="danger" role="alert">
                {error}
              </Notice>
            )}

            <StickyActions
              status={
                nextStepRequirements.length > 0 ? (
                  <ul className="space-y-0.5">
                    {nextStepRequirements.map((requirement) => (
                      <li key={requirement} className="flex gap-2">
                        <span aria-hidden="true" className="mt-2 h-1.5 w-1.5 shrink-0 rounded-full bg-warn-500" />
                        {requirement}
                      </li>
                    ))}
                  </ul>
                ) : (
                  <span>
                    <span className="font-medium text-ink-900">Ready to freeze.</span> {tradeOffNote ?? `${confirmedTopicCount} topics and ${eligibleCompetitors.length} ${eligibleCompetitors.length === 1 ? "rival" : "rivals"} become the context every prompt is written from.`}
                  </span>
                )
              }
            >
              <Button variant="accent" onClick={confirmAndContinue} disabled={confirming || mutating || !gateMet}>
                {confirming ? (
                  <>
                    <Spinner /> Opening Prompts…
                  </>
                ) : (
                  "Confirm & continue to prompts"
                )}
              </Button>
            </StickyActions>
          </div>
        )}
      </div>
    </main>
  );
}

function lowerFirst(value: string): string {
  return value.charAt(0).toLowerCase() + value.slice(1);
}

/** The state of a suggestion at a glance: a filled sun check when confirmed, an empty ring otherwise. */
function ChoiceGlyph({ confirmed }: { confirmed: boolean }) {
  return (
    <span aria-hidden="true" className={cn("mt-0.5 grid h-5 w-5 shrink-0 place-items-center rounded-full border", confirmed ? "border-sun-500 bg-sun-400 text-ink-950" : "border-ink-300 bg-white")}>
      {confirmed && (
        <svg viewBox="0 0 12 12" className="h-3 w-3" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
          <path d="M2.5 6.5l2.3 2.3L9.5 3.8" />
        </svg>
      )}
    </span>
  );
}

/** Initials in a circle: a visual anchor for a rival without fetching a logo from anyone. */
function Initials({ name }: { name: string }) {
  const initials = name
    .split(/[\s.\-_&]+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((part) => part[0]!.toUpperCase())
    .join("");
  return (
    <span aria-hidden="true" className="grid h-9 w-9 shrink-0 place-items-center rounded-lg bg-ink-900 text-xs font-semibold text-white">
      {initials || "?"}
    </span>
  );
}

function CompetitorGroup({
  group,
  grouped,
  whyId,
  mutating,
  onWhy,
  onUpdate,
}: {
  group: TierGroup<any>;
  grouped: boolean;
  whyId: string | null;
  mutating: boolean;
  onWhy: (id: string) => void;
  onUpdate: (id: string, patch: Record<string, unknown>) => Promise<void>;
}) {
  const rows = group.rows.map((competitor: any) => (
    <CompetitorRow key={competitor.id} competitor={competitor} whyOpen={whyId === competitor.id} mutating={mutating} onWhy={() => onWhy(competitor.id)} onUpdate={onUpdate} />
  ));
  if (!grouped) return <div className="space-y-2">{rows}</div>;
  return (
    <section className="space-y-2">
      <div className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-0.5 border-b border-ink-100 pb-1.5">
        <h3 className="text-sm font-semibold text-ink-950">
          {group.heading ?? "Other competitors"}
          {group.subheading && <span className="font-normal text-ink-500"> · {group.subheading}</span>}
        </h3>
        {group.countLine && <span className="text-xs tabular-nums text-ink-500">{group.countLine}</span>}
      </div>
      {group.emptyLine && <p className="text-xs leading-5 text-ink-500">{group.emptyLine}</p>}
      {rows}
    </section>
  );
}

function CompetitorRow({
  competitor,
  whyOpen,
  mutating,
  onWhy,
  onUpdate,
}: {
  competitor: any;
  whyOpen: boolean;
  mutating: boolean;
  onWhy: () => void;
  onUpdate: (id: string, patch: Record<string, unknown>) => Promise<void>;
}) {
  const sourceLabels = competitorSourceLabels(competitor.sourceContributions?.length ? competitor.sourceContributions : [competitor.source]);
  const sourceText = sourceLabels.join(" · ");
  const location = competitor.candidateProfile?.reportedLocation;
  const confirmed = competitor.status === "confirmed";
  return (
    <article className={cn("rounded-xl border px-3.5 py-3", confirmed ? "border-sun-200 bg-sun-50/50" : "border-ink-100 bg-white")}>
      <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
        <div className="flex min-w-0 gap-3">
          <Initials name={competitor.canonicalName} />
          <div className="min-w-0">
            <div className="flex flex-wrap items-center gap-1.5 text-sm font-medium text-ink-950">
              <span>{competitor.canonicalName}</span>
            </div>
            <div className="mt-1 text-sm leading-5 text-ink-600">{competitor.reason}</div>
            <div className="mt-1 flex flex-wrap gap-x-2 text-xs text-ink-500">
              {sourceLabels.map((label) => (
                <span key={label}>{label}</span>
              ))}
            </div>
          </div>
        </div>
        <div className="flex shrink-0 flex-wrap items-center gap-1.5 sm:pl-3">
          <Button size="sm" variant="ghost" aria-expanded={whyOpen} onClick={onWhy} className={whyOpen ? "bg-sun-100 text-sun-900" : undefined}>
            Why?
          </Button>
          {confirmed ? (
            <Badge tone="ok">Confirmed</Badge>
          ) : (
            <Button size="sm" variant="secondary" disabled={mutating} onClick={() => onUpdate(competitor.id, { status: "confirmed" })}>
              Confirm
            </Button>
          )}
          <Button size="sm" variant="ghost" disabled={mutating} onClick={() => onUpdate(competitor.id, { status: "removed" })}>
            {confirmed ? "Remove" : "Reject"}
          </Button>
        </div>
      </div>
      {whyOpen && (
        <EvidencePanel label="Why it is on the list" className="mt-3">
          <div className="grid gap-3 sm:grid-cols-2">
            <div>
              <div className="font-semibold text-ink-800">Matched on</div>
              <div className="mt-0.5 leading-5">{competitor.matchedDimensions?.join(" · ") || "User-confirmed market knowledge"}</div>
            </div>
            <div>
              <div className="font-semibold text-ink-800">Evidence</div>
              {/* Why it is on the list, never why it might not be: a failed verification summary is not shown. */}
              {competitor.tierEvidence && <div className="mt-0.5 leading-5">{competitor.tierEvidence}</div>}
              <div className="mt-0.5 leading-5">{competitor.verificationStatus === "verified" && competitor.verificationSummary ? competitor.verificationSummary : sourceText}</div>
              {(location?.area || location?.city) && <div className="mt-0.5 leading-5">Located in {[location.area, location.city].filter(Boolean).join(", ")}</div>}
              {competitor.candidateProfile?.placeMentions?.length > 0 && <div className="mt-0.5 leading-5">Its website mentions {competitor.candidateProfile.placeMentions.slice(0, 3).join(", ")}</div>}
              {competitor.candidateProfile?.sourceUrls?.[0] && (
                <a className="focus-ring mt-1 block truncate rounded text-brand-600 underline underline-offset-2" href={competitor.candidateProfile.sourceUrls[0]} target="_blank" rel="noopener noreferrer">
                  Source page
                </a>
              )}
            </div>
          </div>
        </EvidencePanel>
      )}
      {competitor.source === "user_manual" && (
        <div className="mt-3 max-w-xs">
          <Select aria-label={`Relationship for ${competitor.canonicalName}`} disabled={mutating} value={competitor.competitorType} onChange={(event) => onUpdate(competitor.id, { competitorType: event.target.value })}>
            {Object.entries(COMPETITOR_TYPE_LABEL).map(([value, label]) => (
              <option key={value} value={value}>
                {label}
              </option>
            ))}
          </Select>
        </div>
      )}
    </article>
  );
}
