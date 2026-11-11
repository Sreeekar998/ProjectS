import { describe, expect, it } from "vitest";
import type { SunEventPayload } from "@/lib/client/use-project-events";
import { currentCrawlCycle } from "@/lib/client/understand-phase";
import { cycleSyncEvents, deriveUnderstandProgress, lastCycleSyncEvent, understandSubtitle } from "@/lib/client/understand-progress";

const T0 = 1_800_000_000_000;

function log(...entries: Array<[string, Record<string, unknown>?]>): SunEventPayload[] {
  return entries.map(([type, payload = {}], index) => ({ id: `evt_${index + 1}`, projectId: "prj_test", sequence: index + 1, type, payload, createdAt: T0 + index * 1_000 }));
}

/** A full LLM-mode run, in pipeline order. */
function llmRun(): Array<[string, Record<string, unknown>?]> {
  return [
    ["profile.synthesis.started", { mode: "llm_grounded" }],
    ["crawl.started", { crawlRunId: "crw_1", startUrl: "https://books.example.test/", targetLanguage: "en" }],
    ["crawl.page.discovered", { crawlRunId: "crw_1", domain: "example.test", count: 1 }],
    ["crawl.sitemap.discovered", { urls: 40 }],
    ["crawl.page.discovered", { crawlRunId: "crw_1", count: 42 }],
    ["crawl.page.selected", { url: "https://books.example.test/a" }],
    ["crawl.page.selected", { url: "https://books.example.test/b" }],
    ["profile.field.updated", { field: "brandName" }],
    ["crawl.evidence.extracted", { pagesProcessed: 1, pagesPlanned: 4, totalItems: 10 }],
    ["crawl.evidence.extracted", { pagesProcessed: 2, pagesPlanned: 8, totalItems: 18 }],
    ["crawl.evidence.extracted", { pagesProcessed: 8, pagesPlanned: 8, totalItems: 60 }],
    ["crawl.completed", { fetched: 8, selected: 8 }],
    ["profile.understanding.stage", { stage: "reading", pages: 8 }],
    ["profile.understanding.stage", { stage: "locating" }],
    ["profile.understanding.stage", { stage: "finalizing" }],
    ["profile.understanding.stage", { stage: "done", droppedClaims: 3 }],
    ["profile.field.updated", { field: "description" }],
    ["profile.ready", { version: 1 }],
  ];
}

describe("deriveUnderstandProgress", () => {
  it("reads only the current cycle when a project was analysed twice", () => {
    const events = log(...llmRun(), ["profile.synthesis.started", { mode: "llm_grounded" }], ["crawl.started", { startUrl: "https://books.example.test/" }]);
    const progress = deriveUnderstandProgress(currentCrawlCycle(events));
    expect(progress.completed).toBe(false);
    expect(progress.processed).toBe(0);
    expect(progress.evidenceItems).toBe(0);
    expect(progress.percent).toBeLessThan(100);
  });

  it("names the site from the start URL and keeps that name once discovery reports the registrable domain", () => {
    const before = deriveUnderstandProgress(log(...llmRun().slice(0, 2)));
    expect(before.domain).toBe("books.example.test");
    expect(before.steps[0]!.label).toBe("Connecting to the website");
    const connected = deriveUnderstandProgress(log(...llmRun().slice(0, 3)));
    expect(connected.domain).toBe("books.example.test");
    expect(connected.steps[0]).toMatchObject({ label: "Website connected — books.example.test", state: "done" });
  });

  it("falls back to crawl.page.discovered.domain when the start URL is missing (crawl.started has no domain key)", () => {
    const progress = deriveUnderstandProgress(log(["profile.synthesis.started"], ["crawl.started", {}], ["crawl.page.discovered", { domain: "example.test", count: 1 }]));
    expect(progress.domain).toBe("example.test");
    expect(progress.steps[0]!.label).toBe("Website connected — example.test");
  });

  it("keeps the percentage monotonic, below 100 until profile.ready, and 97 once understanding is done", () => {
    const run = llmRun();
    let previous = -1;
    for (let length = 1; length <= run.length; length++) {
      const progress = deriveUnderstandProgress(log(...run.slice(0, length)));
      expect(progress.percent, `after ${run[length - 1]![0]}`).toBeGreaterThanOrEqual(previous);
      if (length < run.length) expect(progress.percent).toBeLessThan(100);
      previous = progress.percent;
    }
    const done = deriveUnderstandProgress(log(...run.slice(0, run.findIndex(([type, payload]) => type === "profile.understanding.stage" && payload?.stage === "done") + 1)));
    expect(done.percent).toBe(97);
    expect(deriveUnderstandProgress(log(...run)).percent).toBe(100);
  });

  it("does not reach 100% when every page is read but understanding is still running", () => {
    const run = llmRun();
    const pagesDone = deriveUnderstandProgress(log(...run.slice(0, run.findIndex(([type]) => type === "crawl.completed") + 1)));
    expect(pagesDone.percent).toBe(70);
    expect(pagesDone.completed).toBe(false);
  });

  it("rules-only runs fill 90% from pages and jump to 100 on profile.ready", () => {
    const rules: Array<[string, Record<string, unknown>?]> = [
      ["profile.synthesis.started", { mode: "deterministic" }],
      ["crawl.started", { startUrl: "https://example.test/" }],
      ["crawl.page.discovered", { domain: "example.test", count: 1 }],
      ["crawl.evidence.extracted", { pagesProcessed: 5, pagesPlanned: 5, totalItems: 20 }],
      ["crawl.completed"],
    ];
    const beforeReady = deriveUnderstandProgress(log(...rules));
    expect(beforeReady.percent).toBe(90);
    expect(beforeReady.steps.find((s) => s.key === "understand")).toBeUndefined();
    expect(beforeReady.steps.at(-1)).toMatchObject({ key: "profile", state: "active" });
    expect(deriveUnderstandProgress(log(...rules, ["profile.ready"])).percent).toBe(100);
  });

  it("says exactly Done when understanding finishes, never how many findings were dropped", () => {
    const run = llmRun();
    const progress = deriveUnderstandProgress(log(...run.slice(0, run.length - 2)));
    const understand = progress.steps.find((s) => s.key === "understand")!;
    expect(understand.detail).toBe("Done");
    expect(JSON.stringify(progress.steps)).not.toMatch(/unsupported|left out|dropped/i);
  });

  it("never lists profile field names in the profile step", () => {
    const progress = deriveUnderstandProgress(log(...llmRun().slice(0, -1)));
    const profileStep = progress.steps.find((s) => s.key === "profile")!;
    expect(profileStep.label).toBe("Putting your profile together");
    expect(profileStep.detail).toBeUndefined();
    expect(JSON.stringify(progress.steps)).not.toMatch(/Brand detected|Description|Industry/);
  });

  it("uses pagesPlanned as the denominator when present", () => {
    const progress = deriveUnderstandProgress(log(...llmRun().slice(0, 10)));
    expect(progress.selectedForFetch).toBe(8);
    expect(progress.steps.find((s) => s.key === "read")!.detail).toBe("2 of 8 selected pages processed");
  });

  it("shows a Search Console status step only when a sync started, done on any terminal sync event", () => {
    expect(deriveUnderstandProgress(log(...llmRun().slice(0, 3))).steps.some((s) => s.key === "search-console")).toBe(false);

    const syncing = log(["profile.synthesis.started", { mode: "llm_grounded" }], ["search_console.sync.started", { crawlRunId: null }], ["crawl.started", { startUrl: "https://example.test/" }]);
    const step = deriveUnderstandProgress(syncing).steps.find((s) => s.key === "search-console")!;
    expect(step).toMatchObject({ label: "Reading Google Search Console", state: "active" });
    expect(step.detail).toBeUndefined();

    for (const terminal of ["search_console.sync.completed", "search_console.sync.skipped", "search_console.sync.failed"]) {
      const done = deriveUnderstandProgress(log(["profile.synthesis.started"], ["search_console.sync.started"], [terminal, { reason: "no_matching_property", queries: 12 }]));
      const doneStep = done.steps.find((s) => s.key === "search-console")!;
      expect(doneStep.state).toBe("done");
      // No Search Console data in the rail.
      expect(JSON.stringify(done.steps)).not.toMatch(/no_matching_property|12/);
    }
  });

  it("ignores a Search Console result from another run (a failed run's pull settling after Analyse again)", () => {
    const events = log(
      ["profile.synthesis.started", { mode: "llm_grounded" }],
      ["search_console.sync.started", { crawlRunId: "crw_old" }],
      ["crawl.started", { crawlRunId: "crw_old", startUrl: "https://example.test/" }],
      ["crawl.blocked", { reason: "robots_disallowed" }],
      ["profile.failed", { reason: "blocked" }],
      ["profile.synthesis.started", { mode: "llm_grounded" }],
      ["search_console.sync.started", { crawlRunId: "crw_new" }],
      ["crawl.started", { crawlRunId: "crw_new", startUrl: "https://example.test/" }],
      ["search_console.sync.skipped", { crawlRunId: "crw_old", reason: "no_matching_property" }],
    );
    const cycle = currentCrawlCycle(events);
    expect(deriveUnderstandProgress(cycle).steps.find((s) => s.key === "search-console")!.state).toBe("active");
    expect(lastCycleSyncEvent(cycle)?.type).toBe("search_console.sync.started");
    expect(cycleSyncEvents(cycle).map((e) => e.sequence)).toEqual([7]);

    const settled = log(
      ...events.map((e) => [e.type, e.payload] as [string, Record<string, unknown>]),
      ["search_console.sync.completed", { crawlRunId: "crw_new", queries: 4 }],
    );
    const settledCycle = currentCrawlCycle(settled);
    expect(deriveUnderstandProgress(settledCycle).steps.find((s) => s.key === "search-console")!.state).toBe("done");
    expect(lastCycleSyncEvent(settledCycle)?.sequence).toBe(10);
  });

  it("counts sync events with no crawlRunId as before (older event logs)", () => {
    const older = log(["profile.synthesis.started"], ["search_console.sync.started", { crawlRunId: "crw_1" }], ["search_console.sync.skipped", { reason: "disabled" }]);
    expect(deriveUnderstandProgress(older).steps.find((s) => s.key === "search-console")!.state).toBe("done");
    expect(lastCycleSyncEvent(older)?.type).toBe("search_console.sync.skipped");
    // A cycle with no sync of its own drops another run's result, but keeps an id-less one.
    const noSync = log(["profile.synthesis.started"], ["crawl.started", { crawlRunId: "crw_2" }], ["search_console.sync.completed", { crawlRunId: "crw_1" }]);
    expect(lastCycleSyncEvent(noSync)).toBeNull();
    expect(lastCycleSyncEvent(log(["profile.synthesis.started"], ["search_console.sync.failed", { reason: "http_error" }]))?.type).toBe("search_console.sync.failed");
  });

  it("reports a blocked or failed crawl so the page can switch to its failure view", () => {
    const blocked = deriveUnderstandProgress(log(["profile.synthesis.started"], ["crawl.started"], ["crawl.blocked", { reason: "robots_disallowed" }]));
    expect(blocked.blocked).toEqual({ reason: "robots_disallowed" });
    const failed = deriveUnderstandProgress(log(["profile.synthesis.started"], ["crawl.started"], ["profile.failed", { reason: "no_evidence" }]));
    expect(failed.failed).toEqual({ reason: "no_evidence" });
  });
});

describe("understandSubtitle", () => {
  it("uses neutral copy while the profile request is pending and analysing copy only while a run is going", () => {
    const reading = "We're reading your website. Your profile appears here as soon as the analysis is finished.";
    expect(understandSubtitle("loading")).toBe("Loading your brand profile…");
    for (const view of ["analysing", "starting", "reveal"] as const) expect(understandSubtitle(view)).toBe(reading);
    for (const view of ["loading", "ready", "failed", "not_started", "stalled"] as const) expect(understandSubtitle(view)).not.toBe(reading);
    expect(understandSubtitle("ready")).toMatch(/^Here is what we found on your website/);
  });
});
