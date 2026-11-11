import type { LoadingStep } from "@/components/ui/loading-stage";
import type { SunEventPayload } from "@/lib/client/use-project-events";
import { SECTION_SELECT_COUNT } from "@/lib/prompts/types";

// Loading steps for Landscape and Prompts, derived from one generation cycle's
// events. Pure and client-safe (unit-tested).
//
// Both pages used to show partial results while they worked: Landscape an empty
// Topics card and "No verified suggestions yet" during topic generation, which
// read as a failure, and Prompts "0 / 30 selected" with empty sections. They now
// show these steps and reveal results when the cycle's terminal event arrives.
//
// Details are counts only. Candidate names are never shown while discovery runs
// (some are rejected later), and rejected or duplicate counts are never shown.

export type StageTerminal = "ready" | "failed" | null;

export function lastIndex(events: SunEventPayload[], pred: (event: SunEventPayload) => boolean): number {
  for (let i = events.length - 1; i >= 0; i--) if (pred(events[i]!)) return i;
  return -1;
}

/** Events after `sinceSequence` (the 202 body's `sinceSequence`). */
export function cycleAfter(events: SunEventPayload[], sinceSequence: number): SunEventPayload[] {
  return events.filter((event) => event.sequence > sinceSequence);
}

/** Steps where everything before `reached` is done and `reached` itself is active. */
function stepsUpTo(labels: Array<{ key: string; label: string; detail?: string }>, reached: number, complete: boolean): LoadingStep[] {
  return labels.map((step, index) => ({
    ...step,
    state: complete || index < reached ? "done" : index === reached ? "active" : "pending",
  }));
}

// --- Landscape ------------------------------------------------------------------

const LANDSCAPE_TERMINAL = new Set(["landscape.ready", "landscape.competitor.discovery_failed"]);

function isLandscapeStart(event: SunEventPayload): boolean {
  return (event.type === "landscape.topic.candidate" && event.payload.status === "discovering") || event.type === "landscape.competitor.discovery_started";
}

function isDiscoveryStart(event: SunEventPayload): boolean {
  return event.type === "landscape.competitor.discovery_started";
}

function isTopicDraftStart(event: SunEventPayload): boolean {
  return event.type === "landscape.topic.candidate" && event.payload.status === "discovering";
}

/**
 * The generation cycle still running (started after the last terminal event, not yet ended), if any.
 *
 * It starts at the latest run's start. A run stranded by a restart ends with no
 * terminal event, and taking the first start after the last terminal merged
 * that run's candidates and start time into the restarted run's progress
 * (review 2026-09-14). A topic draft start belongs to the run only when no other
 * discovery_started comes between the two.
 */
export function openLandscapeCycle(events: SunEventPayload[]): { events: SunEventPayload[]; startedAt: number; startSequence: number } | null {
  const lastTerminal = lastIndex(events, (event) => LANDSCAPE_TERMINAL.has(event.type));
  let start = lastIndex(events, (event) => isLandscapeStart(event));
  if (start <= lastTerminal) return null;
  if (isDiscoveryStart(events[start]!)) {
    let index = start - 1;
    while (index > lastTerminal && !isDiscoveryStart(events[index]!)) {
      if (isTopicDraftStart(events[index]!)) {
        start = index;
        break;
      }
      index -= 1;
    }
  }
  const cycle = events.slice(start).filter((event) => event.type.startsWith("landscape."));
  return { events: cycle, startedAt: events[start]!.createdAt, startSequence: events[start]!.sequence };
}

/**
 * The sequence a joined generation's events come after, or null while the event
 * log has not loaded.
 *
 * Landscape used to join after a 3 s wait for the log whether or not it had
 * loaded; an empty log fell back to 0, the whole history, and an older
 * landscape.ready revealed half-built lists mid-run (review 2026-09-14). Never 0
 * from an unloaded log.
 */
export function landscapeJoinSince(events: SunEventPayload[], hydrated: boolean): number | null {
  if (!hydrated) return null;
  const open = openLandscapeCycle(events);
  return open ? open.startSequence - 1 : (events.at(-1)?.sequence ?? 0);
}

export interface LandscapeProgress {
  steps: LoadingStep[];
  terminal: StageTerminal;
  activeIndex: number;
  failedMessage?: string;
}

export function deriveLandscapeProgress(cycle: SunEventPayload[], opts: { topicsExisted: boolean }): LandscapeProgress {
  const events = cycle.filter((event) => event.type.startsWith("landscape."));
  const terminalEvent = events.find((event) => LANDSCAPE_TERMINAL.has(event.type));
  const terminal: StageTerminal = terminalEvent ? (terminalEvent.type === "landscape.ready" ? "ready" : "failed") : null;
  const untilTerminal = terminalEvent ? events.slice(0, events.indexOf(terminalEvent) + 1) : events;
  // Competitor events count only for the latest run: a run stranded by a
  // restart leaves candidates with no terminal event in front of the new run's.
  const lastStart = untilTerminal[lastIndex(untilTerminal, (event) => event.type === "landscape.competitor.discovery_started")];
  const runId = typeof lastStart?.payload.runId === "string" ? lastStart.payload.runId : null;
  const scoped = untilTerminal.filter(
    (event) =>
      !runId ||
      !event.type.startsWith("landscape.competitor.") ||
      LANDSCAPE_TERMINAL.has(event.type) ||
      typeof event.payload.runId !== "string" ||
      event.payload.runId === runId,
  );

  const discovering = scoped.some((event) => event.type === "landscape.topic.candidate" && event.payload.status === "discovering");
  const topicsDrafted = scoped.filter((event) => event.type === "landscape.topic.candidate" && typeof event.payload.topicId === "string").length;
  const discoveryStarted = scoped.some((event) => event.type === "landscape.competitor.discovery_started");
  const found = new Set(
    scoped
      .filter((event) => event.type === "landscape.competitor.candidate_found")
      .map((event) => String(event.payload.name ?? "").trim().toLowerCase())
      .filter(Boolean),
  ).size;
  const verifying = scoped.some((event) => event.type === "landscape.competitor.verifying");
  const checkedRaw = scoped.filter((event) => event.type === "landscape.competitor.suggestion_ready" || event.type === "landscape.competitor.rejected").length;
  const checked = Math.min(checkedRaw, found);
  const completed = scoped.some((event) => event.type === "landscape.competitor.discovery_completed");
  const ready = scoped.find((event) => event.type === "landscape.ready");

  // The furthest step reached. Any cycle event means the profile was read.
  let reached = 0;
  if (scoped.length > 0) reached = 1;
  if (topicsDrafted > 0 || discoveryStarted) reached = 2;
  if (verifying) reached = 3;
  if (completed) reached = 4;

  const topicDetail = topicsDrafted > 0 ? `${topicsDrafted} topic${topicsDrafted === 1 ? "" : "s"} drafted` : opts.topicsExisted && !discovering ? "Using your existing topics" : undefined;
  const readyCount = ready ? Number(ready.payload.competitorCount) : NaN;

  const steps = stepsUpTo(
    [
      { key: "profile", label: "Reading your confirmed profile" },
      { key: "topics", label: "Choosing the topics buyers ask about", detail: topicDetail },
      { key: "search", label: "Searching for competitors", detail: found > 0 ? `${found} possible competitor${found === 1 ? "" : "s"} found` : undefined },
      { key: "verify", label: "Checking their websites and locations", detail: verifying && found > 0 ? `${checked} of ${found} checked` : undefined },
      {
        key: "rank",
        label: "Ranking the closest competitors",
        detail: Number.isFinite(readyCount) && readyCount >= 0 ? `${readyCount} suggestion${readyCount === 1 ? "" : "s"} ready` : undefined,
      },
    ],
    reached,
    terminal === "ready",
  );
  return {
    steps,
    terminal,
    activeIndex: terminal === "ready" ? -1 : reached,
    ...(terminal === "failed" && typeof terminalEvent?.payload.error === "string" ? { failedMessage: terminalEvent.payload.error } : {}),
  };
}

// --- Prompts --------------------------------------------------------------------

function isPromptGenerationEvent(event: SunEventPayload): boolean {
  if (event.type === "policy.status") return event.payload.stage === "prompt_generation";
  return event.type.startsWith("prompt.") || event.type === "prompt_set.ready";
}

/**
 * One prompt generation's events: those carrying `promptSetId`, plus the ones
 * that don't (the first `prompt.context.ready` is emitted before the set row
 * exists, and a background failure is a `policy.status`). With a
 * `sinceSequence` from the generate route the cut is exact; otherwise the cycle
 * starts at the set's first event.
 */
export function promptCycle(events: SunEventPayload[], opts: { promptSetId?: string | null; sinceSequence?: number | null }): SunEventPayload[] {
  const promptSetId = opts.promptSetId ?? null;
  let start: number;
  if (typeof opts.sinceSequence === "number") {
    start = events.findIndex((event) => event.sequence > opts.sinceSequence!);
    if (start < 0) return [];
  } else if (promptSetId) {
    start = events.findIndex((event) => event.payload.promptSetId === promptSetId);
    if (start < 0) return [];
    const previous = events[start - 1];
    if (previous?.type === "prompt.context.ready" && !previous.payload.promptSetId) start -= 1;
  } else {
    return [];
  }
  return events.slice(start).filter((event) => {
    if (!isPromptGenerationEvent(event)) return false;
    const id = event.payload.promptSetId;
    return !(promptSetId && typeof id === "string" && id !== promptSetId);
  });
}

export interface PromptProgress {
  steps: LoadingStep[];
  terminal: StageTerminal;
  selected: number;
}

const TOTAL_PROMPTS = SECTION_SELECT_COUNT.Discovery + SECTION_SELECT_COUNT["Trade Offs"] + SECTION_SELECT_COUNT["Sentiment Analysis"];

export function derivePromptProgress(cycle: SunEventPayload[]): PromptProgress {
  const events = cycle.filter(isPromptGenerationEvent);
  const readyIndex = events.findIndex((event) => event.type === "prompt_set.ready");
  const failedIndex = events.findIndex((event) => event.type === "policy.status" && event.payload.stage === "prompt_generation");
  // `prompt.generation.section_failed` is a template fallback, not a failure.
  const terminal: StageTerminal = readyIndex >= 0 && (failedIndex < 0 || readyIndex < failedIndex) ? "ready" : failedIndex >= 0 ? "failed" : null;
  const scoped = terminal === "ready" ? events.slice(0, readyIndex + 1) : terminal === "failed" ? events.slice(0, failedIndex + 1) : events;

  const contextReady = scoped.some((event) => event.type === "prompt.context.ready");
  const planned = scoped.find((event) => event.type === "prompt.generation.started" && typeof event.payload.framesPlanned === "number");
  let validated = 0;
  for (const event of scoped) {
    if (event.type !== "prompt.counters.updated") continue;
    const counters = event.payload.counters as Record<string, unknown> | undefined;
    const value = Number(counters?.validated);
    if (Number.isFinite(value)) validated = Math.max(validated, value);
  }
  const scoring = scoped.some((event) => ["prompt.candidate.clustered", "prompt.candidate.scored", "prompt.candidate.shortlisted"].includes(event.type));
  const shortlisted = new Set(scoped.filter((event) => event.type === "prompt.candidate.shortlisted").map((event) => String(event.payload.candidateId ?? ""))).size;
  const selectedIds = new Set(scoped.filter((event) => event.type === "prompt.candidate.selected").map((event) => String(event.payload.candidateId ?? "")));
  const selected = selectedIds.size;

  // The furthest step reached. Retries re-emit earlier events, but a step never
  // moves backwards.
  let reached = 0;
  if (contextReady) reached = 1;
  if (planned) reached = 2;
  if (scoring) reached = 3;
  if (selected > 0) reached = 4;

  const framesPlanned = planned ? Number(planned.payload.framesPlanned) : 0;
  const steps = stepsUpTo(
    [
      { key: "context", label: "Reading your confirmed business, topics and competitors" },
      {
        key: "plan",
        label: `Planning the questions: ${SECTION_SELECT_COUNT.Discovery} Discovery, ${SECTION_SELECT_COUNT["Trade Offs"]} Trade Offs, ${SECTION_SELECT_COUNT["Sentiment Analysis"]} Sentiment`,
        detail: framesPlanned > 0 ? `${framesPlanned} question idea${framesPlanned === 1 ? "" : "s"} planned` : undefined,
      },
      { key: "write", label: "Writing and checking candidate questions", detail: validated > 0 ? `${validated} passed the checks` : undefined },
      { key: "score", label: "Removing near-duplicates and scoring", detail: shortlisted > 0 ? `${shortlisted} strong candidate${shortlisted === 1 ? "" : "s"}` : undefined },
      { key: "select", label: `Choosing the final ${TOTAL_PROMPTS}`, detail: selected > 0 ? `${Math.min(selected, TOTAL_PROMPTS)} of ${TOTAL_PROMPTS} chosen` : undefined },
    ],
    reached,
    terminal === "ready",
  );
  return { steps, terminal, selected };
}
