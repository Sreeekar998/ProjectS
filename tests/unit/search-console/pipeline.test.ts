import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { getEventsSince } from "@/lib/events/bus";
import { newId } from "@/lib/ids";
import { gscMemory, resetSearchConsoleMemory } from "@/lib/search-console/memory";
import { isSearchConsoleConfigured, startSearchConsoleSync } from "@/lib/search-console/pipeline";
import { deleteGoogleTokens, saveGoogleTokens } from "@/lib/search-console/token-store";
import type { GscPullResult } from "@/lib/search-console/types";
import { clearOAuthEnv, fixture, fixtureQuery, json, setFakeOAuthEnv, stubGoogle } from "../../fixtures/search-console/google-stub";

const NOW = new Date("2026-09-14T12:00:00Z");

function syncInput(projectId = newId("prj")) {
  return { projectId, projectUrl: "https://www.lumenstudio.test/", registrableDomain: "lumenstudio.test", crawlRunId: "crun_1", now: NOW };
}

async function gscEvents(projectId: string) {
  return (await getEventsSince(projectId, 0)).filter((event) => event.type.startsWith("search_console.sync."));
}

describe("startSearchConsoleSync", () => {
  beforeEach(async () => {
    resetSearchConsoleMemory();
    await deleteGoogleTokens();
  });
  afterEach(() => {
    vi.unstubAllGlobals();
    clearOAuthEnv();
    resetSearchConsoleMemory();
  });

  it("without env emits started and skipped{oauth_not_configured} synchronously and never fetches", async () => {
    const google = stubGoogle({});
    const input = syncInput();
    expect(isSearchConsoleConfigured()).toBe(false);
    const handle = startSearchConsoleSync(input);
    const immediate = await gscEvents(input.projectId);
    expect(immediate.map((event) => [event.type, event.payload])).toEqual([
      ["search_console.sync.started", { crawlRunId: "crun_1", startDate: "2026-06-14", endDate: "2026-09-11" }],
      ["search_console.sync.skipped", { crawlRunId: "crun_1", reason: "oauth_not_configured" }],
    ]);
    expect(await handle.pages).toEqual([]);
    expect(await handle.result(20_000)).toEqual({ ok: false, kind: "skipped", reason: "oauth_not_configured" });
    expect(google.calls).toHaveLength(0);
  });

  it("with the integration turned off reports disabled", async () => {
    setFakeOAuthEnv({ SUN_GSC_DISABLED: "1" });
    const input = syncInput();
    startSearchConsoleSync(input);
    expect((await gscEvents(input.projectId)).map((event) => event.payload.reason)).toEqual([undefined, "disabled"]);
    expect(isSearchConsoleConfigured()).toBe(false);
  });

  it("configured but not connected skips without a request", async () => {
    setFakeOAuthEnv();
    const google = stubGoogle({});
    const input = syncInput();
    const handle = startSearchConsoleSync(input);
    expect(await handle.result(5_000)).toEqual({ ok: false, kind: "skipped", reason: "not_connected" });
    expect((await gscEvents(input.projectId)).map((event) => event.type)).toEqual(["search_console.sync.started", "search_console.sync.skipped"]);
    expect(google.calls).toHaveLength(0);
  });

  it("happy path: pages early, one completed event with contract keys and no query text", async () => {
    setFakeOAuthEnv();
    await saveGoogleTokens({ v: 1, refreshToken: "1//fixture-refresh-token", scope: "https://www.googleapis.com/auth/webmasters.readonly", connectedAt: Date.now(), lastRefreshedAt: null });
    gscMemory().accessToken = { token: "ya29.fixture-access-token", expiresAt: Date.now() + 3_600_000 };
    stubGoogle({ sites: () => json(200, fixture("sites-list.json")), query: fixtureQuery() });
    const input = syncInput();
    const handle = startSearchConsoleSync(input);
    expect((await handle.pages).map((row) => row.key)).toContain("https://www.lumenstudio.test/services/gel-manicure");
    const result = await handle.result(20_000);
    expect(result.ok).toBe(true);
    const events = await gscEvents(input.projectId);
    expect(events.map((event) => event.type)).toEqual(["search_console.sync.started", "search_console.sync.completed"]);
    const completed = events[1]!.payload;
    expect(Object.keys(completed).sort()).toEqual(["brandedClickShare", "countries", "crawlRunId", "durationMs", "matchReason", "pages", "queries", "siteUrl", "sufficient"]);
    expect(completed).toMatchObject({ crawlRunId: "crun_1", siteUrl: "sc-domain:lumenstudio.test", matchReason: "domain_property", queries: 15, pages: 4, countries: 5, sufficient: true });
    expect(completed.brandedClickShare).toEqual(expect.any(Number));
    const serialized = JSON.stringify(events);
    for (const secret of ["lumen studio prices", "nail salon", "ya29.", "1//", "GOCSPX-"]) expect(serialized).not.toContain(secret);
    // result() after settling returns the same result and emits nothing more.
    expect(await handle.result(1)).toBe(result);
    expect(await gscEvents(input.projectId)).toHaveLength(2);
  });

  it("settles as skipped{timeout} after the deadline and discards a late pull without another event", async () => {
    let finish!: (result: GscPullResult) => void;
    const late = new Promise<GscPullResult>((resolve) => {
      finish = resolve;
    });
    const input = syncInput();
    const handle = startSearchConsoleSync(input, { pull: () => late });
    expect(await handle.result(10)).toEqual({ ok: false, kind: "skipped", reason: "timeout" });
    finish({ ok: false, kind: "failed", reason: "google_unavailable", httpStatus: 503 });
    await new Promise((resolve) => setTimeout(resolve, 5));
    expect(await handle.result(10)).toEqual({ ok: false, kind: "skipped", reason: "timeout" });
    expect(await handle.pages).toEqual([]);
    const events = await gscEvents(input.projectId);
    expect(events.map((event) => [event.type, event.payload.reason])).toEqual([
      ["search_console.sync.started", undefined],
      ["search_console.sync.skipped", "timeout"],
    ]);
  });

  it("emits the terminal event even if result() is never awaited, and maps a crash to failed", async () => {
    const input = syncInput();
    const handle = startSearchConsoleSync(input, { pull: async () => ({ ok: false, kind: "failed", reason: "quota_exceeded", httpStatus: 429 }) });
    expect(await handle.pages).toEqual([]);
    expect((await gscEvents(input.projectId)).map((event) => [event.type, event.payload])).toEqual([
      ["search_console.sync.started", expect.any(Object)],
      ["search_console.sync.failed", { crawlRunId: "crun_1", reason: "quota_exceeded", httpStatus: 429 }],
    ]);

    const crashed = syncInput();
    const errors = vi.spyOn(console, "error").mockImplementation(() => {});
    const crashHandle = startSearchConsoleSync(crashed, { pull: async () => { throw new Error("boom"); } });
    expect(await crashHandle.result(1_000)).toEqual({ ok: false, kind: "failed", reason: "invalid_response" });
    errors.mockRestore();
    expect((await gscEvents(crashed.projectId)).map((event) => event.type)).toEqual(["search_console.sync.started", "search_console.sync.failed"]);
  });

  it("tags every event with its own run, so a failed run's late pull is told apart from the retry's", async () => {
    // A failed crawl leaves its pull running; "Analyse again" starts a new run
    // before it settles, and its terminal event lands inside the new cycle.
    const projectId = newId("prj");
    let finishFirst!: (result: GscPullResult) => void;
    const firstPull = new Promise<GscPullResult>((resolve) => {
      finishFirst = resolve;
    });
    const first = startSearchConsoleSync({ ...syncInput(projectId), crawlRunId: "crun_failed" }, { pull: () => firstPull });
    const retry = startSearchConsoleSync({ ...syncInput(projectId), crawlRunId: null }, { pull: () => new Promise<GscPullResult>(() => {}) });
    finishFirst({ ok: false, kind: "skipped", reason: "no_matching_property", propertyCount: 2 });
    await first.result(1_000);
    expect(await retry.result(5)).toEqual({ ok: false, kind: "skipped", reason: "timeout" });
    expect((await gscEvents(projectId)).map((event) => [event.type, event.payload.crawlRunId])).toEqual([
      ["search_console.sync.started", "crun_failed"],
      ["search_console.sync.started", null],
      ["search_console.sync.skipped", "crun_failed"],
      ["search_console.sync.skipped", null],
    ]);
  });
});
