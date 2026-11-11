import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { listSites, querySearchAnalytics } from "@/lib/search-console/google-client";
import { gscMemory, resetSearchConsoleMemory } from "@/lib/search-console/memory";
import { searchConsoleStatus } from "@/lib/search-console/status";
import { deleteGoogleTokens, readGoogleTokens, saveGoogleTokens } from "@/lib/search-console/token-store";
import { clearOAuthEnv, fixture, json, setFakeOAuthEnv, stubGoogle } from "../../fixtures/search-console/google-stub";

const fast = { retryDelayMs: 0 };
const body = { startDate: "2026-06-13", endDate: "2026-09-10", dimensions: ["query" as const], rowLimit: 10 };

async function connect(accessToken: string | null = "ya29.fixture-access-token") {
  await saveGoogleTokens({ v: 1, refreshToken: "1//fixture-refresh-token", scope: "https://www.googleapis.com/auth/webmasters.readonly", connectedAt: Date.now(), lastRefreshedAt: null });
  if (accessToken) gscMemory().accessToken = { token: accessToken, expiresAt: Date.now() + 3_600_000 };
}

describe("Search Console Google client", () => {
  beforeEach(async () => {
    setFakeOAuthEnv();
    resetSearchConsoleMemory();
    await deleteGoogleTokens();
  });
  afterEach(() => {
    vi.unstubAllGlobals();
    clearOAuthEnv();
    resetSearchConsoleMemory();
  });

  it("refreshes an expired access token first and sends it as a bearer token", async () => {
    await connect(null);
    const google = stubGoogle({
      token: (form) => {
        expect(Object.fromEntries(form)).toMatchObject({ grant_type: "refresh_token", refresh_token: "1//fixture-refresh-token" });
        return json(200, fixture("refresh.json"));
      },
      sites: () => json(200, fixture("sites-list.json")),
    });
    const sites = await listSites(fast);
    expect(Array.isArray(sites) && sites.map((site) => site.siteUrl)).toEqual(["https://www.lumenstudio.test/", "sc-domain:lumenstudio.test", "sc-domain:other.test", "https://unverified.test/"]);
    expect(google.calls.map((call) => call.host)).toEqual(["oauth2.googleapis.com", "www.googleapis.com"]);
    expect(google.calls[1]!.authorization).toBe("Bearer ya29.fixture-refreshed-token");
    expect(await readGoogleTokens()).toMatchObject({ refreshToken: "1//fixture-refresh-token", lastRefreshedAt: expect.any(Number) });
  });

  it("shares one refresh between parallel requests", async () => {
    await connect(null);
    const google = stubGoogle({ token: () => json(200, fixture("refresh.json")), query: () => json(200, fixture("query-queries.json")) });
    await Promise.all([querySearchAnalytics("sc-domain:lumenstudio.test", body, fast), querySearchAnalytics("sc-domain:lumenstudio.test", body, fast), querySearchAnalytics("sc-domain:lumenstudio.test", body, fast)]);
    expect(google.calls.filter((call) => call.host === "oauth2.googleapis.com")).toHaveLength(1);
  });

  it("on a 401 refreshes once and retries once", async () => {
    await connect("ya29.stale");
    let sitesCalls = 0;
    const google = stubGoogle({
      token: () => json(200, fixture("refresh.json")),
      sites: (call) => {
        sitesCalls += 1;
        return call.authorization === "Bearer ya29.stale" ? json(401, { error: { code: 401 } }) : json(200, fixture("sites-list.json"));
      },
    });
    expect(Array.isArray(await listSites(fast))).toBe(true);
    expect(sitesCalls).toBe(2);
    expect(google.calls.filter((call) => call.host === "oauth2.googleapis.com")).toHaveLength(1);

    stubGoogle({ token: () => json(200, fixture("refresh.json")), sites: () => json(401, { error: { code: 401 } }) });
    expect(await listSites(fast)).toEqual({ ok: false, kind: "failed", reason: "token_refresh_failed", httpStatus: 401 });
  });

  it("deletes the stored connection on invalid_grant and reports reconnect_required", async () => {
    await connect(null);
    const google = stubGoogle({ token: () => json(400, fixture("error-invalid-grant.json")), sites: () => json(200, fixture("sites-list.json")) });
    expect(await listSites(fast)).toEqual({ ok: false, kind: "skipped", reason: "reconnect_required" });
    expect(google.calls.filter((call) => call.host === "www.googleapis.com")).toHaveLength(0);
    expect(await readGoogleTokens()).toBeNull();
    expect(await searchConsoleStatus("http://localhost:3000")).toMatchObject({ configured: true, connected: false, reason: "reconnect_required" });
  });

  it("maps a 403 without a quota reason to permission_denied", async () => {
    await connect();
    stubGoogle({ query: () => json(403, fixture("error-permission.json")) });
    expect(await querySearchAnalytics("sc-domain:lumenstudio.test", body, fast)).toEqual({ ok: false, kind: "failed", reason: "permission_denied", httpStatus: 403 });
  });

  it("returns quota errors at once without retrying", async () => {
    await connect();
    const quota403 = stubGoogle({ query: () => json(403, fixture("error-quota.json")) });
    expect(await querySearchAnalytics("sc-domain:lumenstudio.test", body, fast)).toEqual({ ok: false, kind: "failed", reason: "quota_exceeded", httpStatus: 403 });
    expect(quota403.calls).toHaveLength(1);

    const quota429 = stubGoogle({ query: () => json(429, { error: { code: 429, status: "RESOURCE_EXHAUSTED" } }) });
    expect(await querySearchAnalytics("sc-domain:lumenstudio.test", body, fast)).toEqual({ ok: false, kind: "failed", reason: "quota_exceeded", httpStatus: 429 });
    expect(quota429.calls).toHaveLength(1);
  });

  it("retries a 5xx exactly once", async () => {
    await connect();
    const down = stubGoogle({ query: () => json(503, { error: { code: 503 } }) });
    expect(await querySearchAnalytics("sc-domain:lumenstudio.test", body, fast)).toEqual({ ok: false, kind: "failed", reason: "google_unavailable", httpStatus: 503 });
    expect(down.calls).toHaveLength(2);

    let attempts = 0;
    stubGoogle({ query: () => (++attempts === 1 ? json(500, {}) : json(200, fixture("query-queries.json"))) });
    const rows = await querySearchAnalytics("sc-domain:lumenstudio.test", body, fast);
    expect(Array.isArray(rows) && rows[0]).toEqual({ key: "lumen studio", clicks: 900, impressions: 5000, ctr: 0.18, position: 1.1 });
    expect(attempts).toBe(2);
  });

  it("maps a timeout to network_error after one retry", async () => {
    await connect();
    let attempts = 0;
    vi.stubGlobal("fetch", async () => {
      attempts += 1;
      throw new DOMException("The operation was aborted due to timeout", "TimeoutError");
    });
    expect(await querySearchAnalytics("sc-domain:lumenstudio.test", body, fast)).toEqual({ ok: false, kind: "failed", reason: "network_error" });
    expect(attempts).toBe(2);
  });

  it("maps malformed JSON to invalid_response", async () => {
    await connect();
    stubGoogle({ query: () => new Response("<html>not json</html>", { status: 200, headers: { "content-type": "text/html" } }) });
    expect(await querySearchAnalytics("sc-domain:lumenstudio.test", body, fast)).toMatchObject({ ok: false, kind: "failed", reason: "invalid_response" });
    stubGoogle({ query: () => json(200, { rows: "nope" }) });
    expect(await querySearchAnalytics("sc-domain:lumenstudio.test", body, fast)).toMatchObject({ ok: false, kind: "failed", reason: "invalid_response" });
  });

  it("encodes the property in the path and makes no request without a stored connection", async () => {
    await connect();
    const google = stubGoogle({ query: () => json(200, { rows: [] }) });
    expect(await querySearchAnalytics("sc-domain:lumenstudio.test", body, fast)).toEqual([]);
    expect(google.calls[0]!.url).toBe("https://www.googleapis.com/webmasters/v3/sites/sc-domain%3Alumenstudio.test/searchAnalytics/query");
    expect(google.calls[0]!.json).toEqual(body);

    resetSearchConsoleMemory();
    await deleteGoogleTokens();
    const none = stubGoogle({});
    expect(await listSites(fast)).toEqual({ ok: false, kind: "skipped", reason: "not_connected" });
    expect(none.calls).toHaveLength(0);
  });
});
