import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { eq } from "drizzle-orm";
import type { RunCrawlOptions } from "@/lib/crawler/orchestrator";
import type { GscMetricRow, GscPullResult, GscSnapshot } from "@/lib/search-console/types";
import type { SearchConsoleSyncInput } from "@/lib/search-console/pipeline";

// Search Console and the operator hint inside runWebsiteIntelligence, keyless
// and offline. The crawl itself is replaced by a fake (runCrawl refuses
// loopback and would otherwise need the internet); one test runs the real
// runCrawl up to its seed check, which is stubbed to refuse the host.

const state = vi.hoisted(() => ({ fakeCrawl: true, searchRows: null as GscMetricRow[] | null, understanding: null as null | Array<Record<string, unknown>> }));

// Off by default (tests run keyless). A test that sets `state.understanding`
// to an array sees the understanding call as available and captures its input;
// the call then fails, so the rules profile ships as it would after an outage.
vi.mock("@/lib/understanding", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/understanding")>();
  return {
    ...actual,
    isUnderstandingAvailable: vi.fn(() => (state.understanding ? true : actual.isUnderstandingAvailable())),
    runBusinessUnderstanding: vi.fn(async (input: Parameters<typeof actual.runBusinessUnderstanding>[0]) => {
      if (!state.understanding) return actual.runBusinessUnderstanding(input);
      state.understanding.push(input as unknown as Record<string, unknown>);
      return { error: "stubbed" };
    }),
  };
});

vi.mock("@/lib/security/url-safety", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/security/url-safety")>();
  return {
    ...actual,
    assertResolvesToPublicAddress: vi.fn(async () => {
      throw new actual.UnsafeUrlError("DNS is not used in tests", "dns_resolution_failed");
    }),
  };
});

vi.mock("@/lib/crawler/orchestrator", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/crawler/orchestrator")>();
  async function fakeCrawl(projectId: string, startUrl: string, _language: string, options: RunCrawlOptions = {}) {
    const { createCrawlRun, updateCrawlRun } = await import("@/lib/crawler/repository");
    const { appendEvent } = await import("@/lib/events/bus");
    const { makeEvidenceSet } = await import("../helpers/profile-fixtures");
    const run = await createCrawlRun(projectId, options.searchConsoleRequested === undefined ? {} : { metrics: { searchConsoleRequested: options.searchConsoleRequested ? "yes" : "no" } });
    options.onRunCreated?.(run.id);
    appendEvent(projectId, "crawl.started", { crawlRunId: run.id, startUrl, targetLanguage: "en" });
    state.searchRows = options.searchPages ? await options.searchPages : null;
    const evidence = makeEvidenceSet([
      { id: `ev_${run.id}_name`, text: "Organization name: Zeta Studio", sourceType: "jsonld", fieldHint: "brand_name", crawlPageId: "pg_zeta_home" },
      { id: `ev_${run.id}_copy`, text: "Zeta Studio offers balayage, gel manicures and brow lamination.", sourceType: "main_content", fieldHint: "offering", crawlPageId: "pg_zeta_home" },
    ]);
    const page = {
      id: "pg_zeta_home",
      url: startUrl,
      canonicalUrl: null,
      pageType: "home" as const,
      title: "Zeta Studio",
      metaDescription: null,
      extracted: { mainText: "Zeta Studio offers balayage, gel manicures and brow lamination.", headings: ["Hair"], navLabels: ["Hair", "Nails"] } as never,
      isSelected: true,
    };
    await options.onPageEvidence?.(page, evidence, evidence);
    await updateCrawlRun(run.id, { status: "completed", completedAt: new Date(), metrics: { ...(options.searchConsoleRequested === undefined ? {} : { searchConsoleRequested: options.searchConsoleRequested ? "yes" : "no" }), pagesFetched: 1 } });
    appendEvent(projectId, "crawl.completed", { crawlRunId: run.id, fetched: 1, selected: 1, evidence: evidence.length, durationMs: 1 });
    return { crawlRunId: run.id, status: "completed" as const, registrableDomain: "zeta-studio.example", seedUrl: startUrl, pages: [page], evidence, metrics: {} as never };
  }
  return {
    ...actual,
    runCrawl: vi.fn((...args: Parameters<typeof actual.runCrawl>) => (state.fakeCrawl ? fakeCrawl(...args) : actual.runCrawl(...args))),
  };
});

const { createProject } = await import("@/lib/projects/repository");
const { runWebsiteIntelligence } = await import("@/lib/profile/orchestrator");
const { getEventsSince, appendEvent } = await import("@/lib/events/bus");
const { getLatestCrawlRun } = await import("@/lib/crawler/repository");
const { buildMarketHint, serializeMarketHint } = await import("@/lib/projects/market-hint");
const { getDb } = await import("@/lib/db/client");
const { projects } = await import("@/lib/db/schema");

const metric = (key: string, clicks: number, impressions: number): GscMetricRow => ({ key, clicks, impressions, ctr: clicks / Math.max(1, impressions), position: 4 });

function snapshot(): GscSnapshot {
  return {
    siteUrl: "sc-domain:zeta-studio.example",
    pageFilter: null,
    startDate: "2026-06-13",
    endDate: "2026-09-10",
    searchType: "web",
    fetchedAt: Date.parse("2026-09-13T00:00:00Z"),
    totals: { clicks: 900, impressions: 24000 },
    queries: [metric("balayage near me", 120, 3000), metric("zeta studio", 300, 1500)],
    pages: [metric("https://zeta-studio.example/services", 200, 5000)],
    countries: [metric("are", 700, 20000), metric("ind", 50, 2000)],
    primaryCountryQueries: [],
    truncated: { queries: false, pages: false, countries: false },
  };
}

function fakeSync(result: GscPullResult) {
  return vi.fn((input: SearchConsoleSyncInput) => {
    appendEvent(input.projectId, "search_console.sync.started", { crawlRunId: input.crawlRunId, startDate: "2026-06-13", endDate: "2026-09-10" });
    appendEvent(input.projectId, "search_console.sync.completed", { crawlRunId: input.crawlRunId, siteUrl: "sc-domain:zeta-studio.example", matchReason: "domain_property", queries: 2, pages: 1, countries: 2, sufficient: true, brandedClickShare: 0.7, durationMs: 5 });
    return { pages: Promise.resolve(result.ok ? result.snapshot.pages : []), result: async () => result };
  });
}

const okResult = (): GscPullResult => ({
  ok: true,
  match: { siteUrl: "sc-domain:zeta-studio.example", kind: "domain", permissionLevel: "siteOwner", matchReason: "domain_property", pageFilter: null, alternatives: [] },
  snapshot: snapshot(),
  rawEvidenceHash: null,
  durationMs: 5,
});

async function newProject(slug: string) {
  const project = await createProject({ url: `https://${slug}.example/`, marketScope: "global", language: "en" });
  return project;
}

const fetchStub = vi.fn(async () => {
  throw new Error("network is disabled in this test");
});

beforeEach(() => {
  state.fakeCrawl = true;
  state.searchRows = null;
  state.understanding = null;
  fetchStub.mockClear();
  vi.stubGlobal("fetch", fetchStub);
});
afterEach(() => vi.unstubAllGlobals());

describe("runWebsiteIntelligence with Google Search Console", () => {
  it("starts the sync between synthesis and crawl start, feeds its pages to the crawl and attaches the summary", async () => {
    const project = await newProject("zeta-studio");
    const sync = fakeSync(okResult());
    const { profile, crawl } = await runWebsiteIntelligence(project.id, { searchConsole: { enabled: true }, searchConsoleSync: sync, allowNetwork: false });

    expect(sync).toHaveBeenCalledTimes(1);
    expect(sync.mock.calls[0]![0]).toMatchObject({ projectId: project.id, registrableDomain: "zeta-studio.example", crawlRunId: crawl!.crawlRunId });
    expect(state.searchRows?.map((r) => r.key)).toEqual(["https://zeta-studio.example/services"]);

    const types = (await getEventsSince(project.id, 0)).map((e) => e.type);
    const at = (type: string) => types.indexOf(type as never);
    expect(at("profile.synthesis.started")).toBeGreaterThanOrEqual(0);
    expect(at("profile.synthesis.started")).toBeLessThan(at("search_console.sync.started"));
    expect(at("search_console.sync.started")).toBeLessThan(at("crawl.started"));
    expect(at("crawl.started")).toBeLessThan(at("profile.ready"));

    expect(profile.searchConsole).toMatchObject({ source: "google_search_console", siteUrl: "sc-domain:zeta-studio.example", matchReason: "domain_property" });
    const run = await getLatestCrawlRun(project.id);
    expect(run?.metrics).toMatchObject({ searchConsoleRequested: "yes", searchConsoleStatus: "used", searchConsoleSiteUrl: "sc-domain:zeta-studio.example", searchConsoleRows: 5, pagesFetched: 1 });
    expect(fetchStub).not.toHaveBeenCalled();
  });

  it("records a skipped pull on the run and still completes the profile", async () => {
    const project = await newProject("zeta-skipped");
    const sync = fakeSync({ ok: false, kind: "skipped", reason: "no_matching_property", propertyCount: 3 });
    const { version, profile } = await runWebsiteIntelligence(project.id, { searchConsole: { enabled: true }, searchConsoleSync: sync, allowNetwork: false });
    expect(version.status).toBe("complete");
    expect(profile.searchConsole).toBeUndefined();
    expect((await getLatestCrawlRun(project.id))?.metrics).toMatchObject({ searchConsoleRequested: "yes", searchConsoleStatus: "skipped:no_matching_property" });
  });

  it("makes no sync call and no request when the toggle is off", async () => {
    const project = await newProject("zeta-off");
    const sync = fakeSync(okResult());
    const { profile } = await runWebsiteIntelligence(project.id, { searchConsole: { enabled: false }, searchConsoleSync: sync, allowNetwork: false });
    expect(sync).not.toHaveBeenCalled();
    expect(state.searchRows).toBeNull();
    expect(profile.searchConsole).toBeUndefined();
    const types = (await getEventsSince(project.id, 0)).map((e) => e.type);
    expect(types.some((t) => t.startsWith("search_console."))).toBe(false);
    expect((await getLatestCrawlRun(project.id))?.metrics).toMatchObject({ searchConsoleRequested: "no" });
    expect((await getLatestCrawlRun(project.id))?.metrics?.searchConsoleStatus).toBeUndefined();
    expect(fetchStub).not.toHaveBeenCalled();
  });

  it("reads the intake hint from the project and applies it to the final profile", async () => {
    const project = await newProject("zeta-hinted");
    const hint = buildMarketHint({ countryCodes: ["AE"], worldwide: false, area: { query: "DIFC", place: { label: "", formattedAddress: null, premise: null, street: null, neighborhood: "DIFC", district: null, city: "Dubai", region: null, country: null, countryCode: "AE", postalCode: null, lat: null, lng: null, precision: null, provider: "photon", providerId: null } } });
    getDb().update(projects).set({ marketScope: serializeMarketHint(hint) }).where(eq(projects.id, project.id)).run();
    const { profile } = await runWebsiteIntelligence(project.id, { allowNetwork: false });
    expect(profile.location?.operatorHint).toMatchObject({ outcome: "filled", countryCodes: ["AE"] });
    expect(profile.location?.primary?.neighborhood).toBe("DIFC");
  });

  it("never lets the intake hint shape the Search Console signals the model reads", async () => {
    const project = await newProject("zeta-hint-gsc");
    const hint = buildMarketHint({ countryCodes: ["AE"], worldwide: false, area: { query: "DIFC", place: { label: "", formattedAddress: null, premise: null, street: null, neighborhood: "DIFC", district: null, city: "Dubai", region: null, country: null, countryCode: "AE", postalCode: null, lat: null, lng: null, precision: null, provider: "photon", providerId: null } } });
    getDb().update(projects).set({ marketScope: serializeMarketHint(hint) }).where(eq(projects.id, project.id)).run();
    const result = okResult();
    if (result.ok) result.snapshot.queries.push(metric("gel nails difc", 40, 900));
    state.understanding = [];
    await runWebsiteIntelligence(project.id, { searchConsole: { enabled: true }, searchConsoleSync: fakeSync(result), allowNetwork: false });
    expect(state.understanding).toHaveLength(1);
    const signals = state.understanding[0]!.searchConsole as { nonBrandQueries: Array<{ query: string; placeMentions: string[] }> };
    const difc = signals.nonBrandQueries.find((q) => q.query === "gel nails difc");
    expect(difc).toBeDefined();
    // The hint reaches the model as the operator line, never as Search Console place demand (plan X5).
    expect(difc!.placeMentions).toEqual([]);
    expect(state.understanding[0]!.marketHint).toMatchObject({ countryCodes: ["AE"] });
  });

  it("records the pull's outcome on the run when the crawl fails", async () => {
    state.fakeCrawl = false;
    const project = await newProject("zeta-refused-metrics");
    const sync = fakeSync({ ok: false, kind: "skipped", reason: "no_matching_property", propertyCount: 3 });
    const { version, crawl } = await runWebsiteIntelligence(project.id, { searchConsole: { enabled: true }, searchConsoleSync: sync, allowNetwork: false });
    expect(crawl?.status).toBe("blocked");
    expect(version.status).toBe("failed");
    await vi.waitFor(async () => {
      expect((await getLatestCrawlRun(project.id))?.metrics).toMatchObject({ searchConsoleRequested: "yes", searchConsoleStatus: "skipped:no_matching_property" });
    });
    expect(fetchStub).not.toHaveBeenCalled();
  });

  it("emits the sync start before crawl.started even when the real crawl refuses the seed", async () => {
    state.fakeCrawl = false;
    const project = await newProject("zeta-refused");
    const { version, crawl } = await runWebsiteIntelligence(project.id, { searchConsole: { enabled: true }, allowNetwork: false });
    expect(crawl?.status).toBe("blocked");
    expect(version.status).toBe("failed");
    const events = await getEventsSince(project.id, 0);
    const types = events.map((e) => e.type);
    expect(types.indexOf("profile.synthesis.started")).toBeLessThan(types.indexOf("search_console.sync.started"));
    expect(types.indexOf("search_console.sync.started")).toBeLessThan(types.indexOf("crawl.started"));
    expect(events.find((e) => e.type === "search_console.sync.started")?.payload.crawlRunId).toBe(crawl!.crawlRunId);
    // The terminal event names the same run, so a retry's rail can ignore it.
    expect(events.find((e) => e.type === "search_console.sync.skipped")?.payload).toEqual({ crawlRunId: crawl!.crawlRunId, reason: "oauth_not_configured" });
    // Written at run creation and kept through the crawl's own final metrics write.
    expect((await getLatestCrawlRun(project.id))?.metrics).toMatchObject({ searchConsoleRequested: "yes" });
    expect(fetchStub).not.toHaveBeenCalled();
  });
});
