import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { readEvidence } from "@/lib/evidence/store";
import { newId } from "@/lib/ids";
import { gscMemory, resetSearchConsoleMemory } from "@/lib/search-console/memory";
import { completeConnection } from "@/lib/search-console/oauth";
import { pullSearchConsoleSnapshot } from "@/lib/search-console/pull";
import { deleteGoogleTokens, saveGoogleTokens } from "@/lib/search-console/token-store";
import { clearOAuthEnv, fixture, fixtureQuery, json, setFakeOAuthEnv, stubGoogle } from "../../fixtures/search-console/google-stub";

const NOW = new Date("2026-09-14T12:00:00Z");
const input = (overrides: Partial<Parameters<typeof pullSearchConsoleSnapshot>[0]> = {}) => ({
  projectId: newId("prj"),
  projectUrl: "https://www.lumenstudio.test/",
  registrableDomain: "lumenstudio.test",
  now: NOW,
  client: { retryDelayMs: 0 },
  ...overrides,
});

async function connect() {
  await saveGoogleTokens({ v: 1, refreshToken: "1//fixture-refresh-token", scope: "https://www.googleapis.com/auth/webmasters.readonly", connectedAt: Date.now(), lastRefreshedAt: null });
  gscMemory().accessToken = { token: "ya29.fixture-access-token", expiresAt: Date.now() + 3_600_000 };
}

describe("pullSearchConsoleSnapshot", () => {
  beforeEach(async () => {
    setFakeOAuthEnv();
    resetSearchConsoleMemory();
    await deleteGoogleTokens();
  });
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.useRealTimers();
    clearOAuthEnv();
    resetSearchConsoleMemory();
  });

  it("matches the property and reads it in exactly six requests", async () => {
    await connect();
    const google = stubGoogle({ sites: () => json(200, fixture("sites-list.json")), query: fixtureQuery() });
    const pages: string[][] = [];
    const result = await pullSearchConsoleSnapshot(input({ onPages: (rows) => pages.push(rows.map((row) => row.key)) }));
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(google.googleCalls()).toHaveLength(6);
    expect(result.match).toMatchObject({ siteUrl: "sc-domain:lumenstudio.test", matchReason: "domain_property" });
    const bodies = google.calls.filter((call) => call.url.includes("searchAnalytics")).map((call) => call.json);
    expect(bodies.map((b) => (b.dimensions ?? []).join(","))).toEqual(expect.arrayContaining(["", "query", "page", "country", "query,country"]));
    for (const b of bodies) expect(b).toMatchObject({ startDate: "2026-06-14", endDate: "2026-09-11", type: "web", dataState: "final" });
    const perCountry = bodies.find((b) => (b.dimensions ?? []).join(",") === "query,country");
    expect(perCountry.dimensionFilterGroups).toEqual([{ groupType: "and", filters: [{ dimension: "country", operator: "equals", expression: "are" }] }]);
    expect(result.snapshot).toMatchObject({ totals: { clicks: 4210, impressions: 61000 }, searchType: "web", truncated: { queries: false, pages: false, countries: false } });
    expect(result.snapshot.primaryCountryQueries).toHaveLength(5);
    expect(pages).toEqual([["https://www.lumenstudio.test/", "https://www.lumenstudio.test/services/gel-manicure", "https://www.lumenstudio.test/booking", "https://blog.other.test/post"]]);
  });

  it("skips the per-country query when one country already holds 90% of impressions", async () => {
    await connect();
    const google = stubGoogle({ sites: () => json(200, fixture("sites-list.json")), query: fixtureQuery({ countries: "query-countries-single.json" }) });
    const result = await pullSearchConsoleSnapshot(input());
    expect(result.ok).toBe(true);
    expect(google.googleCalls()).toHaveLength(5);
  });

  it("puts the page filter on every query when the property covers more than the project", async () => {
    await connect();
    const google = stubGoogle({ sites: () => json(200, { siteEntry: [{ siteUrl: "sc-domain:lumenstudio.test", permissionLevel: "siteOwner" }] }), query: fixtureQuery() });
    const result = await pullSearchConsoleSnapshot(input({ projectUrl: "https://shop.lumenstudio.test/" }));
    expect(result.ok && result.match.matchReason).toBe("parent_domain_property");
    const bodies = google.calls.filter((call) => call.url.includes("searchAnalytics")).map((call) => call.json);
    expect(bodies).toHaveLength(5);
    for (const b of bodies) {
      expect(b.dimensionFilterGroups[0].filters[0]).toEqual({ dimension: "page", operator: "includingRegex", expression: "^https?://(www\\.)?shop\\.lumenstudio\\.test(/|$)" });
    }
  });

  it("serves a same-day re-pull from the 12 h cache without calling Google, then re-queries after it expires", async () => {
    await connect();
    const first = stubGoogle({ sites: () => json(200, fixture("sites-list.json")), query: fixtureQuery() });
    const projectId = newId("prj");
    expect((await pullSearchConsoleSnapshot(input({ projectId }))).ok).toBe(true);
    expect(first.googleCalls()).toHaveLength(6);

    const second = stubGoogle({ sites: () => json(200, fixture("sites-list.json")), query: fixtureQuery() });
    const again = await pullSearchConsoleSnapshot(input({ projectId }));
    expect(again.ok).toBe(true);
    expect(second.calls).toHaveLength(0);

    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(Date.now() + 13 * 60 * 60 * 1000);
    gscMemory().accessToken = { token: "ya29.fixture-access-token", expiresAt: Date.now() + 3_600_000 };
    const third = stubGoogle({ sites: () => json(200, fixture("sites-list.json")), query: fixtureQuery() });
    expect((await pullSearchConsoleSnapshot(input({ projectId }))).ok).toBe(true);
    expect(third.googleCalls()).toHaveLength(6);
  });

  it("stores the raw snapshot in the evidence store", async () => {
    await connect();
    stubGoogle({ sites: () => json(200, fixture("sites-list.json")), query: fixtureQuery() });
    const projectId = newId("prj");
    const result = await pullSearchConsoleSnapshot(input({ projectId }));
    expect(result.ok && result.rawEvidenceHash).toMatch(/^[0-9a-f]{64}$/);
    if (!result.ok) return;
    expect(JSON.parse(readEvidence(projectId, result.rawEvidenceHash!)!)).toEqual(result.snapshot);
  });

  it("makes no request when not configured or not connected", async () => {
    const google = stubGoogle({});
    expect(await pullSearchConsoleSnapshot(input())).toEqual({ ok: false, kind: "skipped", reason: "not_connected" });
    clearOAuthEnv();
    expect(await pullSearchConsoleSnapshot(input())).toEqual({ ok: false, kind: "skipped", reason: "oauth_not_configured" });
    setFakeOAuthEnv({ SUN_GSC_DISABLED: "1" });
    expect(await pullSearchConsoleSnapshot(input())).toEqual({ ok: false, kind: "skipped", reason: "disabled" });
    expect(google.calls).toHaveLength(0);
  });

  it("reports no matching property with the readable property count", async () => {
    await connect();
    const google = stubGoogle({ sites: () => json(200, fixture("sites-list.json")) });
    expect(await pullSearchConsoleSnapshot(input({ projectUrl: "https://nobody.test/", registrableDomain: "nobody.test" }))).toEqual({ ok: false, kind: "skipped", reason: "no_matching_property", propertyCount: 3 });
    expect(google.googleCalls()).toHaveLength(1);
  });

  it("stops on a quota error without a retry storm", async () => {
    await connect();
    const google = stubGoogle({ sites: () => json(200, fixture("sites-list.json")), query: () => json(429, { error: { code: 429 } }) });
    expect(await pullSearchConsoleSnapshot(input())).toMatchObject({ ok: false, kind: "failed", reason: "quota_exceeded" });
    // sites.list plus the four parallel queries, each tried once.
    expect(google.googleCalls()).toHaveLength(5);
  });

  it("drops a pull that outlived a disconnect or reconnect instead of refilling the caches", async () => {
    // Disconnect: resetSearchConsoleMemory() while sites.list is still out.
    await connect();
    let releaseSites!: (response: Response) => void;
    const heldSites = new Promise<Response>((resolve) => {
      releaseSites = resolve;
    });
    const disconnected = stubGoogle({ sites: () => heldSites, query: fixtureQuery() });
    const pulling = pullSearchConsoleSnapshot(input());
    await vi.waitFor(() => expect(disconnected.calls).toHaveLength(1));
    resetSearchConsoleMemory();
    releaseSites(json(200, fixture("sites-list.json")));
    expect(await pulling).toEqual({ ok: false, kind: "skipped", reason: "not_connected" });
    expect(disconnected.googleCalls()).toHaveLength(1);
    expect(gscMemory()).toMatchObject({ propertyCount: null });
    expect(gscMemory().matches.size).toBe(0);

    // Reconnect: a new account connects while the Search Analytics queries are out.
    await connect();
    let releaseTotals!: (response: Response) => void;
    const heldTotals = new Promise<Response>((resolve) => {
      releaseTotals = resolve;
    });
    const answer = fixtureQuery();
    const reconnected = stubGoogle({ sites: () => json(200, fixture("sites-list.json")), query: (siteUrl, body, call) => ((body.dimensions ?? []).length === 0 ? heldTotals : answer(siteUrl, body, call)) });
    const pages: string[] = [];
    const second = pullSearchConsoleSnapshot(input({ onPages: (rows) => pages.push(...rows.map((row) => row.key)) }));
    await vi.waitFor(() => expect(reconnected.calls.filter((call) => call.url.includes("searchAnalytics")).length).toBe(4));
    await completeConnection({ accessToken: "ya29.account-B", expiresIn: 3599, refreshToken: "1//account-B", scope: "https://www.googleapis.com/auth/webmasters.readonly" });
    releaseTotals(json(200, fixture("query-totals.json")));
    expect(await second).toEqual({ ok: false, kind: "skipped", reason: "not_connected" });
    expect(gscMemory().snapshots.size).toBe(0);
    expect(gscMemory().matches.size).toBe(0);
    expect(gscMemory().propertyCount).toBeNull();
  });
});
