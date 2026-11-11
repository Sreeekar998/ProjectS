import { describe, expect, it } from "vitest";
import type { SunEventPayload } from "@/lib/client/use-project-events";
import { currentCrawlCycle, cycleTerminal, NOT_STARTED_AFTER_MS, restartAnswered, STALLED_AFTER_MS, TERMINAL_EVENT_GRACE_MS, understandPhase, type UnderstandPhaseInput } from "@/lib/client/understand-phase";

const T0 = 1_800_000_000_000;

function log(...entries: Array<[string, Record<string, unknown>?, number?]>): SunEventPayload[] {
  return entries.map(([type, payload = {}, offsetMs], index) => ({
    id: `evt_${index + 1}`,
    projectId: "prj_test",
    sequence: index + 1,
    type,
    payload,
    createdAt: T0 + (offsetMs ?? index * 1_000),
  }));
}

function phase(overrides: Partial<UnderstandPhaseInput>) {
  return understandPhase({ fetched: true, version: null, events: [], hydrated: true, mountedAt: T0, now: T0 + 5_000, ...overrides });
}

const openCycle = () =>
  log(["profile.synthesis.started", { mode: "llm_grounded" }], ["crawl.started", { startUrl: "https://example.test/" }], ["crawl.page.discovered", { domain: "example.test", count: 1 }]);

describe("currentCrawlCycle", () => {
  it("starts at the last profile.synthesis.started, which precedes the Search Console sync and crawl.started", () => {
    const events = log(
      ["profile.synthesis.started", { mode: "deterministic" }],
      ["crawl.started"],
      ["profile.ready"],
      ["profile.synthesis.started", { mode: "llm_grounded" }],
      ["search_console.sync.started"],
      ["search_console.sync.skipped", { reason: "oauth_not_configured" }],
      ["crawl.started"],
    );
    const cycle = currentCrawlCycle(events);
    expect(cycle.map((e) => e.sequence)).toEqual([4, 5, 6, 7]);
    expect(cycle.map((e) => e.type)).toContain("search_console.sync.started");
    expect(cycleTerminal(cycle)).toBeNull();
  });

  it("falls back to crawl.started when there is no synthesis event", () => {
    const events = log(["crawl.started"], ["crawl.completed"], ["profile.ready"], ["crawl.started"]);
    expect(currentCrawlCycle(events).map((e) => e.sequence)).toEqual([4]);
  });

  it("starts a new cycle at a crawl.started that follows a finished cycle", () => {
    const events = log(["profile.synthesis.started"], ["crawl.started"], ["profile.failed"], ["crawl.started"]);
    expect(currentCrawlCycle(events).map((e) => e.sequence)).toEqual([4]);
  });

  it("is empty for a project that never ran an analysis", () => {
    expect(currentCrawlCycle(log(["profile.confirmed", { manual: true }]))).toEqual([]);
  });
});

describe("understandPhase", () => {
  it("is loading until GET /profile resolves", () => {
    expect(phase({ fetched: false, version: { status: "complete" } })).toBe("loading");
  });

  it("fresh crawl from intake: loading before events hydrate, then analysing", () => {
    expect(phase({ version: null, events: [], hydrated: false })).toBe("loading");
    expect(phase({ version: null, events: log(["profile.synthesis.started"]), hydrated: true })).toBe("analysing");
    expect(phase({ version: null, events: openCycle(), hydrated: true })).toBe("analysing");
  });

  it("refresh mid-crawl: a partial version is analysing, before and after the history replays", () => {
    expect(phase({ version: { status: "partial" }, events: [], hydrated: false })).toBe("analysing");
    expect(phase({ version: { status: "partial" }, events: openCycle(), hydrated: true })).toBe("analysing");
  });

  it("an older complete project opens on results straight away, with no rail flash", () => {
    expect(phase({ version: { status: "complete" }, events: [], hydrated: false })).toBe("ready");
    const finished = log(["profile.synthesis.started"], ["crawl.started"], ["crawl.completed"], ["profile.ready"]);
    expect(phase({ version: { status: "complete" }, events: finished, hydrated: true })).toBe("ready");
  });

  it("a manual profile (no crawl events) is ready", () => {
    expect(phase({ version: { status: "complete" }, events: log(["profile.confirmed", { manual: true }]), hydrated: true })).toBe("ready");
  });

  it("an edited version is ready", () => {
    const events = log(["profile.synthesis.started"], ["crawl.started"], ["profile.ready"], ["profile.edited"], ["profile.confirmed"]);
    expect(phase({ version: { status: "complete" }, events })).toBe("ready");
  });

  it("a blocked or unreachable site is failed", () => {
    const events = log(["profile.synthesis.started"], ["crawl.started"], ["crawl.blocked", { reason: "dns_resolution_failed" }], ["profile.failed", { reason: "dns_resolution_failed" }]);
    expect(phase({ version: { status: "failed" }, events })).toBe("failed");
  });

  it("an exception after the first partial version is failed, not a stale partial profile", () => {
    const events = log(["profile.synthesis.started"], ["crawl.started"], ["crawl.evidence.extracted"], ["profile.failed", { stage: "pipeline", reason: "boom" }]);
    expect(phase({ version: { status: "partial" }, events })).toBe("failed");
  });

  it("an exception before any version is failed, not a wait that never ends", () => {
    const events = log(["profile.synthesis.started"], ["crawl.started"], ["profile.failed", { stage: "pipeline", reason: "boom" }]);
    expect(phase({ version: null, events })).toBe("failed");
    expect(phase({ version: null, events: log(["profile.failed", { stage: "pipeline", reason: "project missing" }]) })).toBe("failed");
  });

  it("a server restart mid-crawl is stalled once the cycle has been silent too long", () => {
    const events = openCycle();
    const last = events.at(-1)!.createdAt;
    expect(phase({ version: { status: "partial" }, events, now: last + STALLED_AFTER_MS - 1_000 })).toBe("analysing");
    expect(phase({ version: { status: "partial" }, events, now: last + STALLED_AFTER_MS + 1_000 })).toBe("stalled");
  });

  it("is stalled at once when the server reports no crawl job running (inProgress: false)", () => {
    expect(phase({ version: { status: "partial" }, events: openCycle(), inProgress: false })).toBe("stalled");
    expect(phase({ version: null, events: openCycle(), inProgress: false })).toBe("stalled");
    // Unknown (an older server) falls back to the silence timer.
    expect(phase({ version: { status: "partial" }, events: openCycle(), inProgress: null })).toBe("analysing");
    expect(phase({ version: { status: "partial" }, events: openCycle(), inProgress: true })).toBe("analysing");
  });

  it("waits for the events before calling a partial version stalled", () => {
    expect(phase({ version: { status: "partial" }, events: [], hydrated: false, inProgress: false })).toBe("analysing");
  });

  it("holds analysing while the page re-reads the version after profile.ready (no stalled flash)", () => {
    const events = log(["profile.synthesis.started"], ["crawl.started"], ["profile.ready"]);
    expect(phase({ version: { status: "partial" }, events, inProgress: false })).toBe("analysing");
    expect(phase({ version: null, events, inProgress: false })).toBe("analysing");
  });

  it("a crawl that never started is not_started after the grace period", () => {
    expect(phase({ version: null, events: [], now: T0 + NOT_STARTED_AFTER_MS - 1_000 })).toBe("analysing");
    expect(phase({ version: null, events: [], now: T0 + NOT_STARTED_AFTER_MS + 1_000 })).toBe("not_started");
  });

  it("re-analysis of a complete project is analysing once the new cycle is visible", () => {
    const events = log(["profile.synthesis.started"], ["crawl.started"], ["profile.ready"], ["profile.synthesis.started"], ["crawl.started"]);
    expect(phase({ version: { status: "complete" }, events, hydrated: true })).toBe("analysing");
    // An older profile.ready never marks the new run complete.
    expect(phase({ version: { status: "failed" }, events, hydrated: true })).toBe("analysing");
  });

  it("counts a Search Console sync that starts before crawl.started as part of the running cycle", () => {
    const events = log(["profile.synthesis.started", { mode: "llm_grounded" }], ["search_console.sync.started", { crawlRunId: null }]);
    expect(phase({ version: null, events })).toBe("analysing");
    expect(currentCrawlCycle(events)).toHaveLength(2);
  });

  it("a re-read between the job release and the terminal event is not stalled (the run just finished)", () => {
    // The pipeline stores the final version, emits profile.ready, then frees the
    // crawl job; the page can read inProgress:false before the event arrives.
    const events = log(["profile.synthesis.started", { mode: "llm_grounded" }], ["crawl.started", { crawlRunId: "crr_new" }], ["crawl.completed", { crawlRunId: "crr_new" }]);
    const last = events.at(-1)!.createdAt;
    expect(phase({ version: { status: "complete", crawlRunId: "crr_new" }, events, inProgress: false, now: last + 1_000 })).toBe("analysing");
    expect(phase({ version: { status: "failed", crawlRunId: "crr_new" }, events, inProgress: false, now: last + 1_000 })).toBe("failed");
    // If the event never reaches the page, the finished version is shown anyway.
    expect(phase({ version: { status: "complete", crawlRunId: "crr_new" }, events, inProgress: false, now: last + TERMINAL_EVENT_GRACE_MS + 1_000 })).toBe("ready");
    // Once profile.ready arrives it is ready.
    const finished = log(["profile.synthesis.started"], ["crawl.started", { crawlRunId: "crr_new" }], ["profile.ready", { crawlRunId: "crr_new" }]);
    expect(phase({ version: { status: "complete", crawlRunId: "crr_new" }, events: finished, inProgress: false })).toBe("ready");
  });

  it("a stored result from an older crawl run never ends a stranded new run", () => {
    const events = log(["profile.synthesis.started"], ["crawl.started", { crawlRunId: "crr_new" }]);
    expect(phase({ version: { status: "complete", crawlRunId: "crr_old" }, events, inProgress: false })).toBe("stalled");
    expect(phase({ version: { status: "failed", crawlRunId: "crr_old" }, events, inProgress: false })).toBe("stalled");
    expect(phase({ version: { status: "complete", crawlRunId: null }, events, inProgress: false })).toBe("stalled");
    // A cycle that has not reached crawl.started yet has no run to match.
    expect(phase({ version: { status: "complete", crawlRunId: "crr_old" }, events: log(["profile.synthesis.started"]), inProgress: false })).toBe("stalled");
  });

  it("a failed analysis completed by hand afterwards is ready", () => {
    const events = log(["profile.synthesis.started"], ["crawl.started"], ["profile.failed"], ["profile.edited"], ["profile.confirmed"]);
    expect(phase({ version: { status: "complete" }, events })).toBe("ready");
  });
});

describe("restartAnswered", () => {
  const finished = () => log(["profile.synthesis.started"], ["crawl.started", { crawlRunId: "crr_1" }], ["profile.ready", { crawlRunId: "crr_1" }]);

  it("waits while nothing has happened after the restart", () => {
    expect(restartAnswered(finished(), 3)).toBe(false);
  });

  it("is answered once the new cycle starts", () => {
    const events = [...finished(), ...log(["profile.synthesis.started"]).map((e) => ({ ...e, id: "evt_4", sequence: 4 }))];
    expect(restartAnswered(events, 3)).toBe(true);
  });

  it("is answered by a profile.failed the new run reported into the previous cycle (threw before synthesis)", () => {
    const events = [...finished(), ...log(["profile.failed", { stage: "pipeline", reason: "boom" }]).map((e) => ({ ...e, id: "evt_4", sequence: 4 }))];
    expect(currentCrawlCycle(events)[0]!.sequence).toBe(1);
    expect(restartAnswered(events, 3)).toBe(true);
    // A failure from before the restart does not count.
    expect(restartAnswered(events, 4)).toBe(false);
  });
});
