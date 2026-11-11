import { describe, expect, it } from "vitest";
import type { SunEventPayload } from "@/lib/client/use-project-events";
import { cycleAfter, deriveLandscapeProgress, derivePromptProgress, landscapeJoinSince, lastIndex, openLandscapeCycle, promptCycle } from "@/lib/client/stage-progress";

const T0 = 1_800_000_000_000;

function log(...entries: Array<[string, Record<string, unknown>?]>): SunEventPayload[] {
  return entries.map(([type, payload = {}], index) => ({ id: `evt_${index + 1}`, projectId: "prj_test", sequence: index + 1, type, payload, createdAt: T0 + index * 1_000 }));
}

const states = (steps: Array<{ state: string }>) => steps.map((step) => step.state);

describe("cycle helpers", () => {
  it("cycleAfter keeps events after the 202 sinceSequence; lastIndex finds the last match", () => {
    const events = log(["landscape.ready"], ["landscape.topic.candidate", { status: "discovering" }], ["landscape.ready"]);
    expect(cycleAfter(events, 1).map((e) => e.sequence)).toEqual([2, 3]);
    expect(lastIndex(events, (e) => e.type === "landscape.ready")).toBe(2);
    expect(lastIndex(events, (e) => e.type === "nope")).toBe(-1);
  });
});

describe("Landscape progress", () => {
  it("topic generation before any discovery row: step 2 active, no terminal", () => {
    const events = log(["profile.confirmed"], ["landscape.topic.candidate", { status: "discovering" }]);
    const open = openLandscapeCycle(events);
    expect(open?.startSequence).toBe(2);
    const progress = deriveLandscapeProgress(open!.events, { topicsExisted: false });
    expect(progress.terminal).toBeNull();
    expect(progress.activeIndex).toBe(1);
    expect(states(progress.steps)).toEqual(["done", "active", "pending", "pending", "pending"]);
  });

  it("with nothing yet in the cycle, step 1 is active", () => {
    const progress = deriveLandscapeProgress([], { topicsExisted: true });
    expect(states(progress.steps)).toEqual(["active", "pending", "pending", "pending", "pending"]);
  });

  it("walks through discovery to ready with counts only", () => {
    const events = log(
      ["landscape.topic.candidate", { status: "discovering" }],
      ["landscape.topic.candidate", { topicId: "top_1", name: "Topic one" }],
      ["landscape.topic.candidate", { topicId: "top_2", name: "Topic two" }],
      ["landscape.competitor.discovery_started", { runId: "run_1" }],
      ["landscape.competitor.candidate_found", { runId: "run_1", name: "Alpha Rival" }],
      ["landscape.competitor.candidate_found", { runId: "run_1", name: "Beta Rival" }],
      ["landscape.competitor.candidate_found", { runId: "run_1", name: "alpha rival" }],
    );
    const searching = deriveLandscapeProgress(events, { topicsExisted: false });
    expect(states(searching.steps)).toEqual(["done", "done", "active", "pending", "pending"]);
    expect(searching.steps[1]!.detail).toBe("2 topics drafted");
    expect(searching.steps[2]!.detail).toBe("2 possible competitors found");

    const verifying = log(
      ...events.map((e) => [e.type, e.payload] as [string, Record<string, unknown>]),
      ["landscape.competitor.verifying", { runId: "run_1", name: "Alpha Rival" }],
      ["landscape.competitor.suggestion_ready", { runId: "run_1", name: "Alpha Rival" }],
      ["landscape.competitor.rejected", { runId: "run_1", name: "Beta Rival", reason: "Not a like-for-like rival" }],
      ["landscape.competitor.rejected", { runId: "run_1", name: "Gamma", reason: "elsewhere" }],
    );
    const checking = deriveLandscapeProgress(verifying, { topicsExisted: false });
    expect(states(checking.steps)).toEqual(["done", "done", "done", "active", "pending"]);
    // checked is clamped to found (3 checked events, 2 found).
    expect(checking.steps[3]!.detail).toBe("2 of 2 checked");

    const done = deriveLandscapeProgress(
      log(...verifying.map((e) => [e.type, e.payload] as [string, Record<string, unknown>]), ["landscape.competitor.discovery_completed", { runId: "run_1" }], ["landscape.ready", { topicCount: 2, competitorCount: 1 }]),
      { topicsExisted: false },
    );
    expect(done.terminal).toBe("ready");
    expect(states(done.steps)).toEqual(["done", "done", "done", "done", "done"]);
    expect(done.steps[4]!.detail).toBe("1 suggestion ready");

    // Never a candidate name, a rejection reason or a rejected count.
    const text = JSON.stringify([searching.steps, checking.steps, done.steps]);
    expect(text).not.toMatch(/Alpha|Beta|Gamma|like-for-like|reject/i);
  });

  it("uses the existing topics when topics were already there", () => {
    const progress = deriveLandscapeProgress(log(["landscape.competitor.discovery_started", { runId: "run_2" }]), { topicsExisted: true });
    expect(progress.steps[1]).toMatchObject({ state: "done", detail: "Using your existing topics" });
    expect(progress.activeIndex).toBe(2);
  });

  it("discovery_failed without a runId (the route's catch) is failed", () => {
    const progress = deriveLandscapeProgress(log(["landscape.competitor.discovery_failed", { error: "Confirm the profile first" }]), { topicsExisted: true });
    expect(progress.terminal).toBe("failed");
    expect(progress.failedMessage).toBe("Confirm the profile first");
  });

  it("a second cycle after landscape.ready ignores the older terminal", () => {
    const events = log(
      ["landscape.topic.candidate", { status: "discovering" }],
      ["landscape.ready", { competitorCount: 4 }],
      ["landscape.competitor.discovery_started", { runId: "run_3" }],
    );
    const open = openLandscapeCycle(events);
    expect(open?.startSequence).toBe(3);
    expect(deriveLandscapeProgress(open!.events, { topicsExisted: true }).terminal).toBeNull();
    expect(deriveLandscapeProgress(cycleAfter(events, 2), { topicsExisted: true }).terminal).toBeNull();
    expect(openLandscapeCycle(events.slice(0, 2))).toBeNull();
  });

  it("a run stranded by a restart (no terminal) is not merged into the restarted run's cycle", () => {
    const events = log(
      ["landscape.topic.candidate", { status: "discovering" }],
      ["landscape.topic.candidate", { topicId: "top_1", name: "Topic one" }],
      ["landscape.competitor.discovery_started", { runId: "run_old" }],
      ["landscape.competitor.candidate_found", { runId: "run_old", name: "Alpha" }],
      ["landscape.competitor.candidate_found", { runId: "run_old", name: "Beta" }],
      ["landscape.competitor.candidate_found", { runId: "run_old", name: "Gamma" }],
      ["landscape.competitor.discovery_started", { runId: "run_new" }],
    );
    const open = openLandscapeCycle(events)!;
    expect(open.startSequence).toBe(7);
    expect(open.startedAt).toBe(events[6]!.createdAt);
    const progress = deriveLandscapeProgress(open.events, { topicsExisted: true });
    expect(progress.steps[2]).toMatchObject({ key: "search", state: "active" });
    expect(progress.steps[2]!.detail).toBeUndefined();

    // Even a slice that still holds the stranded run counts only the latest run's competitors.
    const joined = log(
      ...events.map((e) => [e.type, e.payload] as [string, Record<string, unknown>]),
      ["landscape.competitor.candidate_found", { runId: "run_new", name: "Delta" }],
      ["landscape.competitor.verifying", { runId: "run_new", name: "Delta" }],
      ["landscape.competitor.suggestion_ready", { runId: "run_new", name: "Delta" }],
    );
    const whole = deriveLandscapeProgress(joined, { topicsExisted: true });
    expect(whole.steps[2]!.detail).toBe("1 possible competitor found");
    expect(whole.steps[3]!.detail).toBe("1 of 1 checked");
  });

  it("keeps a topic draft start only when no other discovery_started comes between it and the run", () => {
    const fresh = log(
      ["landscape.competitor.discovery_started", { runId: "run_old" }],
      ["landscape.competitor.candidate_found", { runId: "run_old", name: "Alpha" }],
      ["landscape.topic.candidate", { status: "discovering" }],
      ["landscape.topic.candidate", { topicId: "top_1", name: "Topic one" }],
    );
    expect(openLandscapeCycle(fresh)?.startSequence).toBe(3);
    const discovering = log(...fresh.map((e) => [e.type, e.payload] as [string, Record<string, unknown>]), ["landscape.competitor.discovery_started", { runId: "run_new" }]);
    const open = openLandscapeCycle(discovering)!;
    expect(open.startSequence).toBe(3);
    expect(deriveLandscapeProgress(open.events, { topicsExisted: false }).steps[1]!.detail).toBe("1 topic drafted");
  });

  it("landscapeJoinSince never scopes a joined cycle from a log that has not loaded", () => {
    const events = log(
      ["landscape.topic.candidate", { status: "discovering" }],
      ["landscape.competitor.discovery_started", { runId: "run_1" }],
      ["landscape.ready", { competitorCount: 3 }],
      ["profile.confirmed"],
      ["landscape.topic.candidate", { status: "discovering" }],
      ["landscape.competitor.discovery_started", { runId: "run_2" }],
    );
    // Before the fix an unloaded log fell back to 0, and the old ready ended the running cycle.
    expect(deriveLandscapeProgress(cycleAfter(events, 0), { topicsExisted: true }).terminal).toBe("ready");
    expect(landscapeJoinSince([], false)).toBeNull();
    expect(landscapeJoinSince(events, false)).toBeNull();
    const since = landscapeJoinSince(events, true)!;
    expect(since).toBe(4);
    expect(deriveLandscapeProgress(cycleAfter(events, since), { topicsExisted: true }).terminal).toBeNull();
    // Loaded with nothing open: events after the last one belong to the next run.
    expect(landscapeJoinSince(events.slice(0, 4), true)).toBe(4);
    expect(landscapeJoinSince([], true)).toBe(0);
  });

  it("an early-return landscape.ready {reused} ends the cycle with every step done", () => {
    const progress = deriveLandscapeProgress(log(["landscape.ready", { topicCount: 5, competitorCount: 3, reused: true }]), { topicsExisted: true });
    expect(progress.terminal).toBe("ready");
    expect(states(progress.steps)).toEqual(["done", "done", "done", "done", "done"]);
  });
});

describe("Prompt progress", () => {
  const generation = (setId: string): Array<[string, Record<string, unknown>?]> => [
    ["prompt.context.ready", { contextSnapshotId: "ctx_1" }],
    ["prompt.coverage_plan.ready", { promptSetId: setId }],
    ["prompt.generation.started", { promptSetId: setId, cellCount: 30 }],
    ["prompt.generation.started", { promptSetId: setId, framesPlanned: 64 }],
    ["prompt.candidate.validated", { promptSetId: setId, candidateId: "c1" }],
    ["prompt.candidate.rejected", { promptSetId: setId, candidateId: "c2", code: "brand_leakage" }],
    ["prompt.counters.updated", { promptSetId: setId, counters: { validated: 40, rejectedBrand: 7, rejectedOther: 3, duplicates: 5 } }],
    ["prompt.generation.section_failed", { sections: ["Discovery"], fallback: "template" }],
    ["prompt.candidate.clustered", { promptSetId: setId, candidateId: "c3" }],
    ["prompt.candidate.scored", { promptSetId: setId, candidateId: "c1" }],
    ["prompt.candidate.shortlisted", { promptSetId: setId, candidateId: "c1" }],
    ["prompt.candidate.shortlisted", { promptSetId: setId, candidateId: "c4" }],
    ["prompt.candidate.selected", { promptSetId: setId, candidateId: "c1" }],
    ["prompt_set.ready", { promptSetId: setId }],
  ];

  it("scopes by promptSetId, including the first context.ready that has no id", () => {
    const events = log(...generation("set_old"), ["prompt_set.approved", { promptSetId: "set_old" }], ...generation("set_new").slice(0, 4));
    const cycle = promptCycle(events, { promptSetId: "set_new" });
    expect(cycle[0]!.type).toBe("prompt.context.ready");
    expect(cycle.every((e) => e.payload.promptSetId === undefined || e.payload.promptSetId === "set_new")).toBe(true);
    expect(derivePromptProgress(cycle).terminal).toBeNull();
    expect(promptCycle(events, { promptSetId: "set_missing" })).toEqual([]);
    expect(promptCycle(events, {})).toEqual([]);
  });

  it("scopes by sinceSequence when the generate route returned one", () => {
    const events = log(...generation("set_old"), ...generation("set_new").slice(0, 2));
    const since = generation("set_old").length;
    const cycle = promptCycle(events, { sinceSequence: since });
    expect(cycle.map((e) => e.sequence)[0]).toBe(since + 1);
    expect(derivePromptProgress(cycle).terminal).toBeNull();
  });

  it("walks the steps in order and never moves backwards", () => {
    const run = generation("set_1");
    let previousDone = 0;
    for (let length = 1; length <= run.length; length++) {
      const progress = derivePromptProgress(log(...run.slice(0, length)));
      const done = progress.steps.filter((s) => s.state === "done").length;
      expect(done).toBeGreaterThanOrEqual(previousDone);
      previousDone = done;
    }
    const mid = derivePromptProgress(log(...run.slice(0, 7)));
    expect(states(mid.steps)).toEqual(["done", "done", "active", "pending", "pending"]);
    expect(mid.steps[1]!.detail).toBe("64 question ideas planned");
    expect(mid.steps[2]!.detail).toBe("40 passed the checks");

    // A retry re-emits validation events after selection started: no step goes back.
    const retried = derivePromptProgress(log(...run.slice(0, 13), ["prompt.candidate.validated", { promptSetId: "set_1", candidateId: "c9" }], ["prompt.counters.updated", { promptSetId: "set_1", counters: { validated: 12 } }]));
    expect(states(retried.steps)).toEqual(["done", "done", "done", "done", "active"]);
    expect(retried.steps[2]!.detail).toBe("40 passed the checks");

    const ready = derivePromptProgress(log(...run));
    expect(ready.terminal).toBe("ready");
    expect(ready.selected).toBe(1);
    expect(states(ready.steps)).toEqual(["done", "done", "done", "done", "done"]);
    expect(ready.steps[3]!.detail).toBe("2 strong candidates");
    expect(ready.steps[4]!.detail).toBe("1 of 30 chosen");
  });

  it("never shows rejected or duplicate counts", () => {
    const progress = derivePromptProgress(log(...generation("set_1")));
    const details = progress.steps.map((step) => step.detail ?? "");
    // counters carry rejectedBrand 7, rejectedOther 3, duplicates 5.
    expect(details.join(" | ")).not.toMatch(/reject|duplicate|\b7\b|\b5\b|\b3\b/i);
    expect(details).toEqual(["", "64 question ideas planned", "40 passed the checks", "2 strong candidates", "1 of 30 chosen"]);
  });

  it("policy.status {stage: prompt_generation} is failed; section_failed and other policy statuses are not", () => {
    expect(derivePromptProgress(log(["prompt.context.ready"], ["policy.status", { stage: "prompt_generation", error: "boom" }])).terminal).toBe("failed");
    expect(derivePromptProgress(log(["prompt.context.ready"], ["prompt.generation.section_failed", { sections: ["Discovery"] }])).terminal).toBeNull();
    expect(derivePromptProgress(log(["prompt.context.ready"], ["policy.status", { stage: "prompt_frame_plan", warning: "x" }])).terminal).toBeNull();
    // A failure is part of a set-scoped cycle even though it carries no promptSetId.
    const events = log(["prompt.context.ready"], ["prompt.coverage_plan.ready", { promptSetId: "set_1" }], ["policy.status", { stage: "prompt_generation", error: "boom" }]);
    expect(derivePromptProgress(promptCycle(events, { promptSetId: "set_1" })).terminal).toBe("failed");
  });
});
