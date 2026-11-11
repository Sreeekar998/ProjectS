"use client";
import { useEffect, useMemo, useRef, useState, use as usePromise } from "react";
import Link from "next/link";
import { JourneyNav } from "@/components/features/journey-nav";
import { LinkPending } from "@/components/features/link-pending";
import { EvidencePanel } from "@/components/features/profile-fields";
import { StageHeader } from "@/components/features/stage-header";
import { PromptsSkeleton, StageStopped } from "@/components/features/stage-skeletons";
import { StickyActions } from "@/components/features/sticky-actions";
import { Button, buttonVariants } from "@/components/ui/button";
import { LoadingStage } from "@/components/ui/loading-stage";
import { Card, CardBody, CardHeader, Badge, EmptyState, Input, Notice, Select, Spinner, StatusDot, Textarea } from "@/components/ui/primitives";
import { cn } from "@/lib/cn";
import { api, ApiError } from "@/lib/client/api";
import { derivePromptProgress, promptCycle } from "@/lib/client/stage-progress";
import { SLOW_AFTER_MS, STALLED_AFTER_MS } from "@/lib/client/understand-phase";
import { SECTION_SELECT_COUNT } from "@/lib/prompts/types";
import { useProjectEvents, type SunEventPayload } from "@/lib/client/use-project-events";

// Targets come from the one place that decides them, so the header can never
// drift from what the selector actually fills. These were hardcoded as 21/4/5
// from an earlier split and rendered as "Trade Offs 10 / 4" after the set
// moved to an even 10/10/10.
const SECTIONS = [
  {
    name: "Discovery",
    target: SECTION_SELECT_COUNT.Discovery,
    description: "Brand-neutral buyer questions that test whether AI independently chooses the target.",
    question: "Is the brand recommended when the buyer names no brand?",
    rule: "Names no brand and no competitor",
    measured: "Named unprompted, share of every business named",
  },
  {
    name: "Trade Offs",
    target: SECTION_SELECT_COUNT["Trade Offs"],
    description: "Buying-decision comparisons against confirmed competitors (never marketplaces).",
    question: "When a buyer compares the brand with a rival, who wins, and on what?",
    rule: "Names the brand and one confirmed rival",
    measured: "Head-to-head verdicts, by rival",
  },
  {
    name: "Sentiment Analysis",
    target: SECTION_SELECT_COUNT["Sentiment Analysis"],
    description: "Neutral branded questions about business-appropriate reputation themes.",
    question: "When a buyer asks about the brand by name, how is it described?",
    rule: "Names the brand, never a competitor",
    measured: "Reputation: portrayal and themes",
  },
] as const;

// While the set is being written the page shows only a staged loading panel;
// the 30 prompts appear when generation finishes. It used to show "0 / 30
// selected" and empty sections that filled in over a 1.5 s refetch loop, and a
// background failure (a policy.status event the page ignored) left a spinner
// that never ended.
type Phase = "loading" | "generating" | "stalled" | "failed" | "ready" | "error";

/** Refetch triggers once the set is ready (generation itself is followed through its events). */
const READY_REFRESH_EVENTS = new Set(["prompt_set.ready", "prompt_set.approved", "prompt.custom.added", "prompt.shortlist.updated"]);

function sectionFor(candidate: any): string {
  if (candidate.section) return candidate.section;
  if (candidate.cohort === "target_comparison") return "Trade Offs";
  if (candidate.cohort === "branded_accuracy") return "Sentiment Analysis";
  return "Discovery";
}

export default function PromptsPage({ params }: { params: Promise<{ id: string }> }) {
  const { id: projectId } = usePromise(params);
  const { events, hydrated } = useProjectEvents(projectId);
  const [promptSet, setPromptSet] = useState<any>(null);
  const [candidates, setCandidates] = useState<any[]>([]);
  const [topicNames, setTopicNames] = useState<Record<string, string>>({});
  const [inProgress, setInProgress] = useState<boolean | null>(null);
  const [loaded, setLoaded] = useState(false);
  // This page asked for a generation: follow the events after `cycleSince`
  // until the new set is ready (with `force`, the old set is still the latest
  // row until the new one is created).
  const [requested, setRequested] = useState(false);
  const [cycleSince, setCycleSince] = useState<number | null>(null);
  const [requestedAt, setRequestedAt] = useState<number | null>(null);
  const [startError, setStartError] = useState<string | null>(null);
  const [starting, setStarting] = useState(false);
  const [mountedAt] = useState(() => Date.now());
  const [now, setNow] = useState(() => Date.now());
  const [approving, setApproving] = useState(false);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [whyId, setWhyId] = useState<string | null>(null);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editText, setEditText] = useState("");
  const [search, setSearch] = useState("");
  const [topicFilter, setTopicFilter] = useState("");
  const [intentFilter, setIntentFilter] = useState("");
  const [showAlternatives, setShowAlternatives] = useState<Record<string, boolean>>({});
  const [addingSection, setAddingSection] = useState<string | null>(null);
  // Feedback for a row action is shown inside the section it happened in; an
  // error at the foot of a long page read as "the button does nothing".
  const [notice, setNotice] = useState<{ section: string; tone: "ok" | "error"; text: string } | null>(null);
  const initStartedRef = useRef(false);
  const generateInFlightRef = useRef(false);
  const eventsRef = useRef<SunEventPayload[]>(events);
  useEffect(() => {
    eventsRef.current = events;
  }, [events]);

  async function refetch() {
    try {
      const result = await api.getPrompts(projectId);
      setPromptSet(result.promptSet);
      setCandidates(result.candidates);
      if (result.topics) setTopicNames(Object.fromEntries(result.topics.map((topic) => [topic.id, topic.name])));
      setInProgress(typeof result.inProgress === "boolean" ? result.inProgress : null);
      return result;
    } catch {
      return null;
    }
  }

  async function startGeneration(force: boolean) {
    if (generateInFlightRef.current) return;
    generateInFlightRef.current = true;
    setStarting(true);
    const before = eventsRef.current.at(-1)?.sequence ?? 0;
    setStartError(null);
    setError(null);
    setCycleSince(before);
    setRequested(true);
    setRequestedAt(Date.now());
    setNow(Date.now());
    try {
      const started = await api.generatePrompts(projectId, force ? { force: true } : undefined);
      if (started?.status === "already_running") {
        // Join the running generation: follow the generating set's own events.
        setCycleSince(null);
      } else if (typeof started?.sinceSequence === "number") {
        setCycleSince(started.sinceSequence);
      }
      await refetch();
    } catch (err) {
      setStartError(err instanceof ApiError ? err.message : "Prompt generation could not start from the frozen Landscape context.");
      setRequested(false);
    } finally {
      generateInFlightRef.current = false;
      setStarting(false);
    }
  }

  useEffect(() => {
    // One init per visit (React StrictMode runs effects twice in dev).
    if (initStartedRef.current) return;
    initStartedRef.current = true;
    void (async () => {
      const result = await refetch();
      setLoaded(true);
      if (result && !result.promptSet) await startGeneration(false);
      if (!result) setStartError("Could not load the prompts.");
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [projectId]);

  const isGeneratingSet = promptSet?.status === "generating";
  const scopeBySince = requested && cycleSince !== null;
  const cycle = useMemo(
    () => promptCycle(events, scopeBySince ? { sinceSequence: cycleSince } : { promptSetId: isGeneratingSet ? promptSet.id : null }),
    [events, scopeBySince, cycleSince, isGeneratingSet, promptSet?.id],
  );
  const progress = useMemo(() => derivePromptProgress(cycle), [cycle]);
  const lastCycleEventAt = cycle.at(-1)?.createdAt ?? null;
  const quietSince = lastCycleEventAt ?? requestedAt ?? mountedAt;

  let phase: Phase;
  if (!loaded) phase = "loading";
  else if (startError && !promptSet) phase = "error";
  else if (progress.terminal === "failed") phase = "failed";
  else if (requested || isGeneratingSet || !promptSet) {
    const stranded = hydrated && inProgress === false && progress.terminal !== "ready" && !starting && now - quietSince > 3_000;
    phase = stranded || now - quietSince > STALLED_AFTER_MS ? "stalled" : "generating";
  } else phase = "ready";

  // The set is written: read it, then show it.
  useEffect(() => {
    if (progress.terminal !== "ready" || !(requested || isGeneratingSet)) return;
    void refetch().then((result) => {
      if (result?.promptSet && result.promptSet.status !== "generating") setRequested(false);
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [progress.terminal]);

  // Once ready, other tabs' and actions' changes refetch.
  const readyEventCount = useMemo(() => events.filter((event) => READY_REFRESH_EVENTS.has(event.type)).length, [events]);
  useEffect(() => {
    if (!readyEventCount || phase !== "ready") return;
    void refetch();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [readyEventCount]);

  // While generating: a clock for the slow note and stall detection, and a
  // 15 s safety read in case the ready event was missed.
  const waiting = phase === "generating";
  useEffect(() => {
    if (!waiting) return;
    const clock = setInterval(() => setNow(Date.now()), 5_000);
    const poll = setInterval(() => {
      void refetch().then((result) => {
        if (result?.promptSet && result.promptSet.status !== "generating" && eventsRef.current.some((event) => event.type === "prompt_set.ready" && event.payload.promptSetId === result.promptSet.id)) {
          setRequested(false);
        }
      });
    }, 15_000);
    return () => {
      clearInterval(clock);
      clearInterval(poll);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [waiting]);

  async function saveEdit(id: string) {
    setBusyId(id);
    setError(null);
    try {
      await api.patchPromptSet(promptSet.id, { candidateEdits: [{ id, editedText: editText }] });
      setEditingId(null);
      await refetch();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "The edit did not pass the prompt policy checks.");
    } finally {
      setBusyId(null);
    }
  }

  async function act(id: string, action: "select" | "deselect" | "reject" | "replace" | "regenerate") {
    const row = candidates.find((candidate) => candidate.id === id);
    const section = row ? sectionFor(row) : null;
    setBusyId(id);
    setError(null);
    setNotice(null);
    try {
      await api.patchPromptSet(promptSet.id, { actions: [{ id, action }] });
      await refetch();
      if (section && action === "regenerate") {
        setShowAlternatives((state) => ({ ...state, [section]: true }));
        setNotice({ section, tone: "ok", text: "New wordings were added to the alternatives below. Select one to use it." });
      } else if (section && action === "replace") {
        setNotice({ section, tone: "ok", text: "Replaced with the closest validated alternative." });
      } else if (section && (action === "deselect" || action === "reject")) {
        setNotice({ section, tone: "ok", text: "Removed. Select an alternative below to bring this section back to its full count." });
        setShowAlternatives((state) => ({ ...state, [section]: true }));
      }
    } catch (err) {
      const text = err instanceof ApiError ? err.message : "The prompt action could not be completed.";
      if (section) setNotice({ section, tone: "error", text });
      else setError(text);
    } finally {
      setBusyId(null);
    }
  }

  /** Returns the problem to show in the form, or null once the prompt is added. */
  async function addOwnPrompt(section: string, text: string, replacesCandidateId: string | null): Promise<string | null> {
    setNotice(null);
    try {
      const result = await api.addCustomPrompt(promptSet.id, { text, section, replacesCandidateId });
      const replaced = result.replacedId ? candidates.find((candidate) => candidate.id === result.replacedId) : null;
      setCandidates(result.candidates);
      setAddingSection(null);
      setNotice({
        section,
        tone: "ok",
        text: replaced
          ? `Your prompt was added in place of “${clip(replaced.editedText ?? replaced.text)}”, which is now under the alternatives. It is measured once you approve the set.`
          : "Your prompt was added. It is measured once you approve the set.",
      });
      return null;
    } catch (err) {
      return err instanceof ApiError ? err.message : "Your prompt could not be added.";
    }
  }

  async function approve() {
    setApproving(true);
    setError(null);
    try {
      await api.approvePromptSet(promptSet.id, "interview_operator");
      await refetch();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Approval requires exactly 10 prompts in each section.");
    } finally {
      setApproving(false);
    }
  }

  const selected = candidates.filter((candidate) => ["SELECTED", "USER_APPROVED"].includes(candidate.lifecycleState));
  const ownCount = selected.filter((candidate) => candidate.generationSource === "user").length;
  const shortlisted = candidates.filter((candidate) => candidate.lifecycleState === "SHORTLISTED");
  const topics = [...new Map(candidates.filter((candidate) => candidate.topicId && topicNames[candidate.topicId]).map((candidate) => [candidate.topicId, topicNames[candidate.topicId]])).entries()];
  const intents = [...new Set(candidates.map((candidate) => candidate.intent).filter(Boolean))].sort();
  const filtered = (rows: any[]) => rows.filter((candidate) => {
    const text = (candidate.editedText ?? candidate.text).toLowerCase();
    return (!search || text.includes(search.toLowerCase())) && (!topicFilter || candidate.topicId === topicFilter) && (!intentFilter || candidate.intent === intentFilter);
  });
  const isApproved = promptSet?.status === "approved";
  const slow = phase === "generating" && now - quietSince > SLOW_AFTER_MS;

  const lede =
    phase === "generating"
      ? "We're writing and checking the 30 questions from your confirmed business, topics and competitors. They appear here when they're ready to review."
      : "Review the balanced 30-question measurement instrument built from the frozen business, topic, competitor, audience, and market context. You can also add prompts of your own to any section.";
  const filtering = Boolean(search || topicFilter || intentFilter);
  const sectionCounts = SECTIONS.map((section) => ({ section, count: selected.filter((candidate) => sectionFor(candidate) === section.name).length }));

  if (phase !== "ready") {
    return (
      <main className="min-h-screen">
        <JourneyNav projectId={projectId} current="prompts" />
        <div className="mx-auto max-w-5xl px-4 py-8 sm:px-6">
          <StageHeader stage="prompts" title="Prompt Intelligence" lede={lede} />
          {phase === "loading" && (
            <>
              <LoadingStage className="mt-6" title="Loading your prompts" />
              <PromptsSkeleton className="mt-6" />
            </>
          )}
          {phase === "generating" && (
            <>
              {startError && (
                <Notice tone="danger" role="alert" className="mt-6">
                  {startError}
                </Notice>
              )}
              <LoadingStage
                className="mt-6"
                title="Writing your 30 prompts"
                steps={progress.steps}
                complete={progress.terminal === "ready"}
                startedAt={cycle[0]?.createdAt ?? requestedAt}
                note={slow ? "This is taking longer than usual. The page updates by itself." : undefined}
              />
              <PromptsSkeleton className="mt-6" />
            </>
          )}
          {(phase === "failed" || phase === "stalled") && (
            <StageStopped
              className="mt-6"
              title={phase === "failed" ? "We couldn't finish writing the prompts" : "Prompt generation stopped before it finished"}
              description={phase === "failed" ? "Something went wrong while the prompts were being written. Your confirmed topics and competitors are unchanged." : "This can happen if the app restarted while it was working."}
              steps={progress.steps}
            >
              {/* A failed POST drops the page straight back here; without the
                  message "Try again" looked like it did nothing. */}
              {startError && (
                <Notice tone="danger" role="alert" className="w-full">
                  {startError}
                </Notice>
              )}
              <Button onClick={() => void startGeneration(true)} disabled={starting}>
                {phase === "failed" ? "Try again" : "Generate again"}
              </Button>
              <Link href={`/projects/${projectId}/landscape`} className={buttonVariants({ variant: "secondary" })}>
                Back to Landscape
              </Link>
            </StageStopped>
          )}
          {phase === "error" && (
            <div className="mt-6">
              <EmptyState
                title="Prompts aren't available yet"
                description={startError ?? undefined}
                action={
                  <Link href={`/projects/${projectId}/landscape`} className={buttonVariants({ variant: "secondary" })}>
                    Back to Landscape
                  </Link>
                }
              />
            </div>
          )}
        </div>
      </main>
    );
  }

  return (
    <main className="min-h-screen pb-6">
      <JourneyNav projectId={projectId} current="prompts" />
      <div className="mx-auto max-w-5xl px-4 py-8 sm:px-6">
        <StageHeader
          stage="prompts"
          title="Prompt Intelligence"
          lede={lede}
          aside={
            <Badge tone={isApproved ? "ok" : selected.length === 30 ? "ok" : "warn"} className="gap-1.5 text-sm">
              <StatusDot tone={isApproved || selected.length === 30 ? "ok" : "warn"} />
              {selected.length} / 30 selected
            </Badge>
          }
        />

        {/* A retry that could not start falls back to the previous set; say so. */}
        {startError && (
          <Notice tone="danger" role="alert" className="mt-4">
            {startError}
          </Notice>
        )}

        {/* The instrument: three lenses, what each asks and what it feeds. */}
        <div className="mt-6 grid gap-3 sm:grid-cols-3 motion-safe:animate-fade-in">
          {sectionCounts.map(({ section, count }) => (
            <LensTile key={section.name} name={section.name} question={section.question} rule={section.rule} measured={section.measured} value={count} target={section.target} />
          ))}
        </div>

        {isApproved && (
          <Card tone="ink" className="mt-4 p-5 sm:p-6">
            <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
              <div className="flex min-w-0 gap-3">
                <span aria-hidden="true" className="mt-0.5 grid h-8 w-8 shrink-0 place-items-center rounded-lg bg-white/10 text-sun-300">
                  <svg viewBox="0 0 20 20" className="h-4 w-4" fill="currentColor">
                    <path fillRule="evenodd" d="M10 1a4.5 4.5 0 0 0-4.5 4.5V9H5a2 2 0 0 0-2 2v6a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2v-6a2 2 0 0 0-2-2h-.5V5.5A4.5 4.5 0 0 0 10 1Zm3 8V5.5a3 3 0 1 0-6 0V9h6Z" clipRule="evenodd" />
                  </svg>
                </span>
                <div className="min-w-0">
                  <p className="text-sm font-semibold text-white">
                    Prompt set approved and frozen.
                    {promptSet?.version ? <span className="ml-2 rounded-full bg-white/10 px-2 py-px text-[11px] font-medium text-white/80">v{promptSet.version}</span> : null}
                  </p>
                  <p className="mt-1 text-sm leading-6 text-white/65">
                    Future edits create a new version; this exact cohort will not change.{ownCount > 0 && ` It includes ${ownCount} ${ownCount === 1 ? "prompt" : "prompts"} you wrote.`} Measure asks the assistants every one of these
                    questions and reports on the answers.
                  </p>
                </div>
              </div>
              {/* A link styled as a button: a <button> nested in <a> is invalid and unreliable to click. */}
              <Link href={`/projects/${projectId}/measure`} className={buttonVariants({ variant: "accent", className: "shrink-0" })}>
                Continue to Measure →
                <LinkPending className="bg-ink-950" />
              </Link>
            </div>
          </Card>
        )}

        <div className="mt-6 flex flex-col gap-2 sm:flex-row sm:items-center">
          <Input aria-label="Search prompts" placeholder="Search prompts…" value={search} onChange={(event) => setSearch(event.target.value)} className="sm:max-w-xs" />
          <div className="grid flex-1 gap-2 sm:max-w-md sm:grid-cols-2">
            <Select aria-label="Filter by topic" value={topicFilter} onChange={(event) => setTopicFilter(event.target.value)}>
              <option value="">All topics</option>
              {topics.map(([id, label]) => (
                <option key={id} value={id}>
                  {label}
                </option>
              ))}
            </Select>
            <Select aria-label="Filter by intent" value={intentFilter} onChange={(event) => setIntentFilter(event.target.value)}>
              <option value="">All intents</option>
              {intents.map((intent) => (
                <option key={intent} value={intent}>
                  {intent.replaceAll("_", " ")}
                </option>
              ))}
            </Select>
          </div>
          {filtering && (
            <button
              type="button"
              onClick={() => {
                setSearch("");
                setTopicFilter("");
                setIntentFilter("");
              }}
              className="focus-ring self-start rounded text-sm font-medium text-brand-600 hover:underline sm:self-auto"
            >
              Clear filters
            </button>
          )}
        </div>

        <div className="mt-5 space-y-5">
          {SECTIONS.map((section) => {
            const inSection = selected.filter((candidate) => sectionFor(candidate) === section.name);
            const rows = filtered(inSection);
            const alternatives = filtered(shortlisted.filter((candidate) => sectionFor(candidate) === section.name));
            return (
              <Card key={section.name} id={`section-${section.name.replace(/\s+/g, "-").toLowerCase()}`}>
                <CardHeader className="flex flex-col gap-2 sm:flex-row sm:items-start sm:justify-between">
                  <div className="min-w-0">
                    <div className="text-base font-semibold text-ink-950">{section.name}</div>
                    <div className="mt-0.5 text-xs leading-5 text-ink-500">{section.description}</div>
                  </div>
                  <Badge tone={rows.length === section.target && !filtering ? "ok" : "neutral"} className="shrink-0 tabular-nums">
                    {rows.length}
                    {filtering ? " shown" : ` / ${section.target}`}
                  </Badge>
                </CardHeader>
                <CardBody className="pt-1">
                  {notice?.section === section.name && (
                    <Notice tone={notice.tone === "error" ? "danger" : "ok"} className="my-3">
                      {notice.text}
                    </Notice>
                  )}
                  {rows.length === 0 && <div className="my-3 rounded-xl border border-dashed border-ink-300 bg-paper px-4 py-8 text-center text-sm text-ink-500">No selected prompts match these filters.</div>}
                  <ol className="divide-y divide-ink-100">
                    {rows.map((candidate, index) => (
                      <PromptRow
                        key={candidate.id}
                        index={index + 1}
                        candidate={candidate}
                        approved={isApproved}
                        busy={busyId === candidate.id}
                        whyOpen={whyId === candidate.id}
                        editing={editingId === candidate.id}
                        editText={editText}
                        onWhy={() => setWhyId(whyId === candidate.id ? null : candidate.id)}
                        onEdit={() => {
                          setEditingId(candidate.id);
                          setEditText(candidate.editedText ?? candidate.text);
                        }}
                        onEditText={setEditText}
                        onSave={() => saveEdit(candidate.id)}
                        onCancel={() => setEditingId(null)}
                        onAction={(action) => act(candidate.id, action)}
                      />
                    ))}
                  </ol>
                  {!isApproved && (
                    <div className="flex flex-wrap items-center gap-2 border-t border-ink-100 pt-3">
                      {addingSection !== section.name && (
                        <Button
                          size="sm"
                          variant="secondary"
                          onClick={() => {
                            setAddingSection(section.name);
                            setNotice(null);
                          }}
                        >
                          Add your own prompt
                        </Button>
                      )}
                      {alternatives.length > 0 && (
                        <Button size="sm" variant="ghost" onClick={() => setShowAlternatives((state) => ({ ...state, [section.name]: !state[section.name] }))}>
                          {showAlternatives[section.name] ? "Hide" : "Review"} validated alternatives
                        </Button>
                      )}
                    </div>
                  )}
                  {!isApproved && addingSection === section.name && (
                    <AddPromptForm
                      key={section.name}
                      section={section.name}
                      inSection={inSection}
                      target={section.target}
                      onSubmit={(text, replacesCandidateId) => addOwnPrompt(section.name, text, replacesCandidateId)}
                      onCancel={() => setAddingSection(null)}
                    />
                  )}
                  {!isApproved && showAlternatives[section.name] && alternatives.length > 0 && (
                    <div className="sun-inset mt-3 space-y-2 p-2">
                      <p className="px-2 pt-1 text-xs font-medium text-ink-700">Validated alternatives</p>
                      {alternatives.slice(0, 12).map((candidate) => (
                        <div key={candidate.id} className="flex flex-col gap-2 rounded-lg bg-white px-3 py-2.5 ring-1 ring-ink-100 sm:flex-row sm:items-start sm:justify-between">
                          <div>
                            <div className="text-sm leading-6 text-ink-900">{candidate.editedText ?? candidate.text}</div>
                            <div className="mt-1 text-xs text-ink-500">{[candidate.generationSource === "user" ? "Your prompt" : null, candidate.intent?.replaceAll("_", " ")].filter(Boolean).join(" · ")}</div>
                          </div>
                          <Button size="sm" variant="secondary" disabled={busyId === candidate.id} onClick={() => act(candidate.id, "select")}>
                            Select
                          </Button>
                        </div>
                      ))}
                    </div>
                  )}
                </CardBody>
              </Card>
            );
          })}
        </div>

        {error && (
          <Notice tone="danger" role="alert" className="mt-4 whitespace-pre-wrap">
            {error}
          </Notice>
        )}

        <StickyActions
          status={
            isApproved ? (
              <span>
                <span className="font-medium text-ink-900">Approved and frozen.</span> Measure walks you through collecting the answers, then reports on them.
              </span>
            ) : (
              <span className="flex flex-wrap items-center gap-x-3 gap-y-1">
                <span className="font-medium text-ink-900">{selected.length === 30 ? "Ready to approve." : `${30 - selected.length} more to select.`}</span>
                {sectionCounts.map(({ section, count }) => (
                  <span key={section.name} className="tabular-nums text-ink-500">
                    {section.name} <b className={count === section.target ? "font-semibold text-ink-900" : "font-semibold text-warn-600"}>{count}</b>/{section.target}
                  </span>
                ))}
              </span>
            )
          }
        >
          {isApproved ? (
            <Link href={`/projects/${projectId}/measure`} className={buttonVariants({ variant: "accent" })}>
              Continue to Measure →
              <LinkPending className="bg-ink-950" />
            </Link>
          ) : (
            <Button variant="accent" onClick={approve} disabled={selected.length !== 30 || approving}>
              {approving ? <Spinner /> : `Approve ${selected.length} / 30 prompts`}
            </Button>
          )}
        </StickyActions>
      </div>
    </main>
  );
}

/** One lens of the instrument: what it asks, the rule every prompt in it obeys, and what Measure reads from it. */
function LensTile({ name, question, rule, measured, value, target }: { name: string; question: string; rule: string; measured: string; value: number; target: number }) {
  const full = value === target;
  return (
    <div className="sun-sheet flex flex-col p-4">
      <div className="flex items-start justify-between gap-3">
        <p className="text-sm font-semibold text-ink-950">{name}</p>
        <p className="sun-figure text-xl text-ink-950">
          {value}
          <span className="text-sm font-normal text-ink-400"> / {target}</span>
        </p>
      </div>
      <p className="mt-1.5 text-xs leading-5 text-ink-600">{question}</p>
      <div className="mt-3 h-1 overflow-hidden rounded-full bg-ink-100" aria-hidden="true">
        <div className={cn("h-full rounded-full transition-[width] duration-500", full ? "bg-sun-500" : "bg-warn-500")} style={{ width: `${Math.min(100, (value / Math.max(1, target)) * 100)}%` }} />
      </div>
      <dl className="mt-3 space-y-1 text-[11px] leading-4 text-ink-500">
        <div className="flex gap-2">
          <dt className="w-14 shrink-0 font-medium uppercase tracking-wide text-ink-400">Rule</dt>
          <dd>{rule}</dd>
        </div>
        <div className="flex gap-2">
          <dt className="w-14 shrink-0 font-medium uppercase tracking-wide text-ink-400">Reads</dt>
          <dd>{measured}</dd>
        </div>
      </dl>
    </div>
  );
}

function PromptRow({ index, candidate, approved, busy, whyOpen, editing, editText, onWhy, onEdit, onEditText, onSave, onCancel, onAction }: {
  index: number;
  candidate: any;
  approved: boolean;
  busy: boolean;
  whyOpen: boolean;
  editing: boolean;
  editText: string;
  onWhy: () => void;
  onEdit: () => void;
  onEditText: (value: string) => void;
  onSave: () => void;
  onCancel: () => void;
  onAction: (action: "deselect" | "reject" | "replace" | "regenerate") => void;
}) {
  const mine = candidate.generationSource === "user";
  const meta = [candidate.intent?.replaceAll("_", " "), candidate.geographyText, candidate.sentimentTheme].filter(Boolean) as string[];
  return (
    <li className="group flex gap-3 py-3">
      <span aria-hidden="true" className="w-6 shrink-0 pt-1 text-right text-xs tabular-nums text-ink-400">
        {index}
      </span>
      <div className="min-w-0 flex-1">
        {editing ? (
          <div className="space-y-2">
            <Textarea aria-label="Edit prompt" rows={3} value={editText} onChange={(event) => onEditText(event.target.value)} />
            <div className="flex gap-2">
              <Button size="sm" onClick={onSave} disabled={busy}>
                {busy ? <Spinner /> : "Save and revalidate"}
              </Button>
              <Button size="sm" variant="secondary" onClick={onCancel}>
                Cancel
              </Button>
            </div>
          </div>
        ) : (
          <>
            <div className="flex flex-col gap-2 sm:flex-row sm:items-start sm:justify-between">
              <div className="min-w-0">
                <div className="text-[15px] leading-6 text-ink-950">{candidate.editedText ?? candidate.text}</div>
                <div className="mt-1 flex flex-wrap items-center gap-x-2 gap-y-1 text-xs text-ink-500">
                  {mine && <Badge tone="brand">Your prompt</Badge>}
                  {meta.map((item, position) => (
                    <span key={`${item}-${position}`} className="flex items-center gap-2">
                      {position > 0 && <span aria-hidden="true" className="text-ink-300">·</span>}
                      {item}
                    </span>
                  ))}
                </div>
              </div>
              <div className="flex shrink-0 flex-wrap gap-0.5 sm:justify-end sm:pl-3">
                <Button size="xs" variant="ghost" aria-expanded={whyOpen} onClick={onWhy} className={whyOpen ? "bg-sun-100 text-sun-900" : undefined}>
                  Why?
                </Button>
                {!approved && (
                  <>
                    <Button size="xs" variant="ghost" onClick={onEdit}>
                      Edit
                    </Button>
                    {!mine && (
                      <Button size="xs" variant="ghost" disabled={busy} onClick={() => onAction("regenerate")}>
                        {busy ? <Spinner className="h-3.5 w-3.5" /> : "Regenerate"}
                      </Button>
                    )}
                    <Button size="xs" variant="ghost" disabled={busy} onClick={() => onAction("replace")}>
                      Replace
                    </Button>
                    <Button size="xs" variant="ghost" disabled={busy} onClick={() => onAction("deselect")}>
                      Deselect
                    </Button>
                    <Button size="xs" variant="ghost" disabled={busy} onClick={() => onAction("reject")} className="hover:text-danger-600">
                      Reject
                    </Button>
                  </>
                )}
              </div>
            </div>
            {whyOpen && (
              <EvidencePanel label="Why this prompt is here" className="mt-2.5">
                <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
                  <Why label="Context" value={mine ? "Written by you" : [candidate.contextBasis?.join(" · "), candidate.intent].filter(Boolean).join(" · ")} />
                  <Why label="Brand policy" value={candidate.brandPolicy === "TARGET_FORBIDDEN" ? "Target and confirmed competitors forbidden" : candidate.brandPolicy === "TARGET_REQUIRED" ? "Target required" : candidate.brandPolicy} />
                  <Why label="Scoring" value={mine ? "Not scored. Checked against this section’s rules instead." : `Quality ${candidate.qualityScore ?? "—"}/100 · Coverage ${asPercentOfHundred(candidate.coverageGain)}/100 · Diversity ${asPercentOfHundred(candidate.diversityGain)}/100`} />
                  <Why label="Selected because" value={candidate.selectionReason || "Validated for this coverage slot."} />
                </div>
              </EvidencePanel>
            )}
          </>
        )}
      </div>
    </li>
  );
}

/** Coverage and diversity gains are stored as 0–1 fractions; the panel read "Coverage 0.6667/100". */
function asPercentOfHundred(value: unknown): string {
  return typeof value === "number" && Number.isFinite(value) ? String(Math.round(value * 100)) : "—";
}

function Why({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <div className="font-semibold text-ink-800">{label}</div>
      <div className="mt-0.5 leading-5">{value || "—"}</div>
    </div>
  );
}

const OWN_PROMPT_RULE: Record<string, string> = {
  Discovery: "Ask the way a customer would, without naming your brand or a competitor. This checks whether assistants recommend you on their own.",
  "Trade Offs": "Mention your brand and one confirmed competitor, the way someone deciding between the two would ask.",
  "Sentiment Analysis": "Mention your brand. This checks what assistants say about you.",
};

function clip(value: string, max = 90) {
  return value.length > max ? `${value.slice(0, max - 1)}…` : value;
}

function AddPromptForm({ section, inSection, target, onSubmit, onCancel }: {
  section: string;
  inSection: any[];
  target: number;
  onSubmit: (text: string, replacesCandidateId: string | null) => Promise<string | null>;
  onCancel: () => void;
}) {
  const full = inSection.length >= target;
  // Suggest replacing the lowest-scoring generated prompt; the reviewer can pick another.
  const suggested = [...inSection].sort(
    (a, b) => Number(a.generationSource === "user") - Number(b.generationSource === "user") || (a.qualityScore ?? 0) - (b.qualityScore ?? 0),
  )[0];
  const [text, setText] = useState("");
  const [replacesId, setReplacesId] = useState<string>(suggested?.id ?? "");
  const [saving, setSaving] = useState(false);
  const [problem, setProblem] = useState<string | null>(null);
  const fieldId = `own-prompt-${section.replace(/\s+/g, "-").toLowerCase()}`;

  async function submit() {
    setSaving(true);
    setProblem(null);
    const failure = await onSubmit(text.trim(), full ? replacesId || null : null);
    setSaving(false);
    if (failure) setProblem(failure);
  }

  return (
    <div className="sun-inset mt-3 space-y-3 p-4">
      <div>
        <label htmlFor={fieldId} className="text-sm font-semibold text-ink-950">
          Your prompt for {section}
        </label>
        <p className="mt-0.5 text-xs leading-5 text-ink-500">{OWN_PROMPT_RULE[section]}</p>
      </div>
      <Textarea id={fieldId} rows={2} maxLength={300} value={text} placeholder="Type it exactly as you would ask ChatGPT or Gemini" onChange={(event) => setText(event.target.value)} />
      {full && (
        <div>
          <label htmlFor={`${fieldId}-replaces`} className="text-xs font-medium text-ink-700">
            Replaces
          </label>
          <Select id={`${fieldId}-replaces`} className="mt-1" value={replacesId} onChange={(event) => setReplacesId(event.target.value)}>
            {inSection.map((candidate) => (
              <option key={candidate.id} value={candidate.id}>{clip(candidate.editedText ?? candidate.text)}</option>
            ))}
          </Select>
          <p className="mt-1 text-xs text-ink-400">{section} keeps {target} prompts. The one you replace moves to the alternatives.</p>
        </div>
      )}
      {problem && (
        <Notice tone="danger" role="alert">
          {problem}
        </Notice>
      )}
      <div className="flex gap-2">
        <Button size="sm" onClick={submit} disabled={saving || text.trim().length < 8}>
          {saving ? <Spinner /> : "Check and add"}
        </Button>
        <Button size="sm" variant="secondary" onClick={onCancel} disabled={saving}>
          Cancel
        </Button>
      </div>
    </div>
  );
}
