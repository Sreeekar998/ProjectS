import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";
import { GET as statusRoute } from "@/app/api/integrations/search-console/route";
import { GET as startRoute } from "@/app/api/integrations/search-console/start/route";
import { GET as callbackRoute } from "@/app/api/integrations/search-console/callback/route";
import { POST as disconnectRoute } from "@/app/api/integrations/search-console/disconnect/route";
import { gscMemory, resetSearchConsoleMemory } from "@/lib/search-console/memory";
import { completeConnection, getAccessToken } from "@/lib/search-console/oauth";
import { deleteGoogleTokens, readGoogleTokens, saveGoogleTokens } from "@/lib/search-console/token-store";
import { FAKE_CLIENT_SECRET, clearOAuthEnv, fixture, json, setFakeOAuthEnv, stubGoogle } from "../fixtures/search-console/google-stub";

const ORIGIN = "http://localhost:3000";
const SECRET_MARKERS = ["ya29.", "1//", FAKE_CLIENT_SECRET];

function request(path: string, init: { method?: string; headers?: Record<string, string> } = {}) {
  return new NextRequest(`${ORIGIN}${path}`, { method: init.method ?? "GET", headers: init.headers });
}

async function everything(response: Response): Promise<string> {
  return [await response.clone().text(), response.headers.get("location") ?? "", response.headers.get("set-cookie") ?? ""].join("\n");
}

function expectNoSecrets(text: string) {
  for (const marker of SECRET_MARKERS) expect(text).not.toContain(marker);
}

/** Runs /start and returns the state Google would echo plus the cookie header the browser would send back. */
async function beginConsent(returnTo = "/trial/new?gsc_return=1&url=https%3A%2F%2Flumenstudio.test%2F") {
  const response = await startRoute(request(`/api/integrations/search-console/start?returnTo=${encodeURIComponent(returnTo)}`));
  const location = new URL(response.headers.get("location")!);
  const setCookie = response.headers.get("set-cookie")!;
  const cookie = setCookie.split(";")[0]!;
  return { response, location, state: location.searchParams.get("state")!, cookie, setCookie };
}

function callback(query: string, cookie?: string) {
  return callbackRoute(request(`/api/integrations/search-console/callback?${query}`, { headers: cookie ? { cookie } : {} }));
}

/** The 303 back to the app. Its Location is a path, so the browser keeps the host it used. */
function outcome(response: Response, browserOrigin = ORIGIN): URL {
  expect(response.status).toBe(303);
  const location = response.headers.get("location")!;
  expect(location).toMatch(/^\/(?!\/)/);
  return new URL(location, browserOrigin);
}

describe.sequential("Search Console OAuth routes", () => {
  beforeEach(async () => {
    resetSearchConsoleMemory();
    await deleteGoogleTokens();
  });
  afterEach(() => {
    vi.unstubAllGlobals();
    clearOAuthEnv();
    resetSearchConsoleMemory();
  });

  it("status reports each env state without secrets", async () => {
    const google = stubGoogle({});
    const bare = await statusRoute(request("/api/integrations/search-console"));
    expect(await bare.json()).toEqual({ status: { configured: false, connected: false, reason: "oauth_not_configured", redirectUri: `${ORIGIN}/api/integrations/search-console/callback` } });

    setFakeOAuthEnv();
    expect((await (await statusRoute(request("/api/integrations/search-console"))).json()).status).toEqual({ configured: true, connected: false, reason: "not_connected", redirectUri: `${ORIGIN}/api/integrations/search-console/callback` });

    const remote = await statusRoute(new NextRequest("http://192.168.1.20:3000/api/integrations/search-console"));
    expect((await remote.json()).status).toEqual({ configured: false, connected: false, reason: "redirect_uri_unavailable", redirectUri: null });

    await saveGoogleTokens({ v: 1, refreshToken: "1//fixture-refresh-token", scope: "https://www.googleapis.com/auth/webmasters.readonly", connectedAt: 1234, lastRefreshedAt: null });
    const connected = await statusRoute(request("/api/integrations/search-console"));
    const text = await everything(connected);
    expect(JSON.parse(text.split("\n")[0]!).status).toEqual({ configured: true, connected: true, connectedAt: 1234, propertyCount: null, redirectUri: `${ORIGIN}/api/integrations/search-console/callback` });
    expectNoSecrets(text);

    process.env.SUN_GSC_DISABLED = "1";
    expect((await (await statusRoute(request("/api/integrations/search-console"))).json()).status).toMatchObject({ configured: false, reason: "disabled" });
    expect(google.calls).toHaveLength(0);
  });

  it("start without env sends the browser back with an error instead of to Google", async () => {
    const response = await startRoute(request("/api/integrations/search-console/start?returnTo=%2Ftrial%2Fnew%3Fgsc_return%3D1"));
    const back = outcome(response);
    expect(`${back.pathname}${back.search}`).toBe("/trial/new?gsc_return=1&gsc_status=error&gsc_reason=not_configured");
  });

  it("start sets a signed httpOnly state cookie and redirects to Google consent", async () => {
    setFakeOAuthEnv();
    const { response, location, state, setCookie } = await beginConsent();
    expect(response.status).toBe(302);
    expect(`${location.origin}${location.pathname}`).toBe("https://accounts.google.com/o/oauth2/v2/auth");
    expect(location.searchParams.get("scope")).toBe("https://www.googleapis.com/auth/webmasters.readonly");
    expect(location.searchParams.get("redirect_uri")).toBe(`${ORIGIN}/api/integrations/search-console/callback`);
    expect(location.searchParams.get("access_type")).toBe("offline");
    expect(state).toMatch(/^[A-Za-z0-9_-]{43}$/);
    expect(setCookie).toMatch(/^sun_gsc_oauth=/);
    expect(setCookie).toMatch(/HttpOnly/i);
    expect(setCookie).toMatch(/SameSite=lax/i);
    expect(setCookie).toMatch(/Path=\/api\/integrations\/search-console/);
    expect(setCookie).toMatch(/Max-Age=600/);
    expect(setCookie).not.toMatch(/Secure/);
    expectNoSecrets(await everything(response));
  });

  it("callback stores the encrypted connection and returns to the intake page as connected", async () => {
    setFakeOAuthEnv();
    const { state, cookie } = await beginConsent();
    const google = stubGoogle({
      token: (form) => {
        expect(Object.fromEntries(form)).toMatchObject({ grant_type: "authorization_code", code: "auth-code-1", redirect_uri: `${ORIGIN}/api/integrations/search-console/callback` });
        return json(200, fixture("token-exchange.json"));
      },
    });
    const response = await callback(`state=${state}&code=auth-code-1&scope=${encodeURIComponent("https://www.googleapis.com/auth/webmasters.readonly")}`, cookie);
    const back = outcome(response);
    expect(`${back.pathname}${back.search}`).toBe("/trial/new?gsc_return=1&url=https%3A%2F%2Flumenstudio.test%2F&gsc_status=connected");
    expect(response.headers.get("set-cookie")).toMatch(/sun_gsc_oauth=;.*Max-Age=0/i);
    expectNoSecrets(await everything(response));
    expect(google.calls).toHaveLength(1);
    expect(await readGoogleTokens()).toMatchObject({ refreshToken: "1//fixture-refresh-token" });
    expect(gscMemory().accessToken?.token).toBe("ya29.fixture-access-token");

    const status = await statusRoute(request("/api/integrations/search-console"));
    expect((await status.json()).status).toMatchObject({ configured: true, connected: true });
  });

  it("callback refuses a missing or mismatched state and stores nothing", async () => {
    setFakeOAuthEnv();
    const google = stubGoogle({ token: () => json(200, fixture("token-exchange.json")) });
    const { cookie } = await beginConsent();
    for (const response of [await callback("state=wrong&code=c", cookie), await callback("code=c", cookie), await callback("state=anything&code=c")]) {
      const back = outcome(response);
      expect(back.searchParams.get("gsc_status")).toBe("error");
      expect(back.searchParams.get("gsc_reason")).toBe("state_mismatch");
      expect(back.pathname).toBe("/trial/new");
    }
    expect(google.calls).toHaveLength(0);
    expect(await readGoogleTokens()).toBeNull();
  });

  it("callback maps a cancelled consent to denied and other Google errors to an allowlisted reason", async () => {
    setFakeOAuthEnv();
    stubGoogle({});
    const { state, cookie } = await beginConsent();
    expect(outcome(await callback(`state=${state}&error=access_denied`, cookie)).searchParams.get("gsc_status")).toBe("denied");
    const odd = outcome(await callback(`state=${state}&error=${encodeURIComponent("<script>alert(1)</script>")}`, cookie));
    expect(odd.searchParams.get("gsc_reason")).toBe("oauth_error");
    expect(outcome(await callback(`state=${state}&error=admin_policy_enforced`, cookie)).searchParams.get("gsc_reason")).toBe("admin_policy_enforced");
  });

  it("callback stores nothing without a refresh token or without the read-only scope", async () => {
    setFakeOAuthEnv();
    const { state, cookie } = await beginConsent();
    stubGoogle({ token: () => json(200, { ...fixture<Record<string, unknown>>("token-exchange.json"), refresh_token: undefined }) });
    expect(outcome(await callback(`state=${state}&code=c`, cookie)).searchParams.get("gsc_reason")).toBe("no_refresh_token");
    stubGoogle({ token: () => json(200, { ...fixture<Record<string, unknown>>("token-exchange.json"), scope: "openid" }) });
    expect(outcome(await callback(`state=${state}&code=c`, cookie)).searchParams.get("gsc_reason")).toBe("scope_not_granted");
    stubGoogle({ token: () => json(400, { error: "invalid_grant" }) });
    expect(outcome(await callback(`state=${state}&code=c`, cookie)).searchParams.get("gsc_reason")).toBe("invalid_grant");
    expect(await readGoogleTokens()).toBeNull();
  });

  it("disconnect requires this app's Origin, revokes at Google and deletes the row", async () => {
    setFakeOAuthEnv();
    await saveGoogleTokens({ v: 1, refreshToken: "1//fixture-refresh-token", scope: "https://www.googleapis.com/auth/webmasters.readonly", connectedAt: 1, lastRefreshedAt: null });
    gscMemory().accessToken = { token: "ya29.fixture-access-token", expiresAt: Date.now() + 3_600_000 };
    const revoked: string[] = [];
    const google = stubGoogle({ revoke: (form) => { revoked.push(form.get("token") ?? ""); return json(200, {}); } });

    expect((await disconnectRoute(request("/api/integrations/search-console/disconnect", { method: "POST" }))).status).toBe(403);
    expect((await disconnectRoute(request("/api/integrations/search-console/disconnect", { method: "POST", headers: { origin: "https://evil.test" } }))).status).toBe(403);
    expect(await readGoogleTokens()).not.toBeNull();
    expect(google.calls).toHaveLength(0);

    const response = await disconnectRoute(request("/api/integrations/search-console/disconnect", { method: "POST", headers: { origin: ORIGIN } }));
    expect(response.status).toBe(200);
    const text = await everything(response);
    expectNoSecrets(text);
    expect(JSON.parse(text.split("\n")[0]!).status).toEqual({ configured: true, connected: false, reason: "not_connected", redirectUri: `${ORIGIN}/api/integrations/search-console/callback` });
    expect(revoked).toEqual(["1//fixture-refresh-token"]);
    expect(google.calls[0]!.url).toBe("https://oauth2.googleapis.com/revoke");
    expect(await readGoogleTokens()).toBeNull();
    expect(gscMemory().accessToken).toBeNull();
  });

  // Next builds req.nextUrl from its bind host (localhost), not the Host header, so
  // these requests reproduce a browser on 127.0.0.1 or the LAN talking to `next dev`.
  describe("when the browser used another host than Next's bind address", () => {
    const LOOPBACK = "http://127.0.0.1:3000";
    const viaLoopback = (path: string, init: { method?: string; headers?: Record<string, string> } = {}) =>
      new NextRequest(`${ORIGIN}${path}`, { method: init.method ?? "GET", headers: { host: "127.0.0.1:3000", ...init.headers } });

    it("derives the redirect URI and every redirect from 127.0.0.1, so the state cookie comes back", async () => {
      setFakeOAuthEnv();
      const redirectUri = `${LOOPBACK}/api/integrations/search-console/callback`;
      expect((await (await statusRoute(viaLoopback("/api/integrations/search-console"))).json()).status).toMatchObject({ configured: true, redirectUri });

      const start = await startRoute(viaLoopback(`/api/integrations/search-console/start?returnTo=${encodeURIComponent("/trial/new?gsc_return=1")}`));
      const consent = new URL(start.headers.get("location")!);
      expect(consent.searchParams.get("redirect_uri")).toBe(redirectUri);
      const cookie = start.headers.get("set-cookie")!.split(";")[0]!;

      stubGoogle({
        token: (form) => {
          expect(form.get("redirect_uri")).toBe(redirectUri);
          return json(200, fixture("token-exchange.json"));
        },
      });
      const back = await callbackRoute(viaLoopback(`/api/integrations/search-console/callback?state=${consent.searchParams.get("state")}&code=c`, { headers: { cookie } }));
      const landed = outcome(back, LOOPBACK);
      expect(landed.origin).toBe(LOOPBACK);
      expect(`${landed.pathname}${landed.search}`).toBe("/trial/new?gsc_return=1&gsc_status=connected");

      stubGoogle({ revoke: () => json(200, {}) });
      const disconnect = await disconnectRoute(viaLoopback("/api/integrations/search-console/disconnect", { method: "POST", headers: { origin: LOOPBACK } }));
      expect(disconnect.status).toBe(200);
      expect((await disconnect.json()).status).toMatchObject({ connected: false, redirectUri });
      expect(await readGoogleTokens()).toBeNull();
    });

    it("start without env returns to 127.0.0.1, not localhost", async () => {
      const back = outcome(await startRoute(viaLoopback("/api/integrations/search-console/start?returnTo=%2Ftrial%2Fnew%3Fgsc_return%3D1")), LOOPBACK);
      expect(back.origin).toBe(LOOPBACK);
      expect(back.searchParams.get("gsc_reason")).toBe("not_configured");
    });

    it("trusts a non-loopback Host only when it is the configured redirect URI's host", async () => {
      setFakeOAuthEnv();
      const lan = (path: string, headers: Record<string, string> = {}) => new NextRequest(`${ORIGIN}${path}`, { method: "POST", headers: { host: "192.168.1.20:3000", ...headers } });
      expect((await (await statusRoute(new NextRequest(`${ORIGIN}/api/integrations/search-console`, { headers: { host: "192.168.1.20:3000" } }))).json()).status).toEqual({
        configured: false,
        connected: false,
        reason: "redirect_uri_unavailable",
        redirectUri: null,
      });
      await saveGoogleTokens({ v: 1, refreshToken: "1//fixture-refresh-token", scope: "https://www.googleapis.com/auth/webmasters.readonly", connectedAt: 1, lastRefreshedAt: null });
      const google = stubGoogle({ revoke: () => json(200, {}) });
      // A DNS-rebinding page carries its own name in both Host and Origin.
      expect((await disconnectRoute(lan("/api/integrations/search-console/disconnect", { host: "rebind.evil.test:3000", origin: "http://rebind.evil.test:3000" }))).status).toBe(403);
      expect((await disconnectRoute(lan("/api/integrations/search-console/disconnect", { origin: "http://192.168.1.20:3000" }))).status).toBe(403);
      expect(google.calls).toHaveLength(0);

      process.env.GOOGLE_OAUTH_REDIRECT_URI = "http://192.168.1.20:3000/api/integrations/search-console/callback";
      expect((await disconnectRoute(lan("/api/integrations/search-console/disconnect", { origin: "http://192.168.1.20:3000" }))).status).toBe(200);
      expect(await readGoogleTokens()).toBeNull();
    });
  });

  it("disconnect still deletes the row when Google's revoke fails", async () => {
    setFakeOAuthEnv();
    await saveGoogleTokens({ v: 1, refreshToken: "1//fixture-refresh-token", scope: "https://www.googleapis.com/auth/webmasters.readonly", connectedAt: 1, lastRefreshedAt: null });
    stubGoogle({ revoke: () => json(503, {}) });
    const response = await disconnectRoute(request("/api/integrations/search-console/disconnect", { method: "POST", headers: { origin: ORIGIN } }));
    expect(response.status).toBe(200);
    expect(await readGoogleTokens()).toBeNull();
  });

  // Disconnect and reconnect can't cancel a token refresh already waiting on Google.
  describe("a token refresh still in flight when the connection changes", () => {
    const SCOPE = "https://www.googleapis.com/auth/webmasters.readonly";

    /** Stores account A with an expired access token and starts a refresh whose response the test releases. */
    async function heldRefresh(handlers: Parameters<typeof stubGoogle>[0] = {}) {
      setFakeOAuthEnv();
      await saveGoogleTokens({ v: 1, refreshToken: "1//account-A", scope: SCOPE, connectedAt: 1, lastRefreshedAt: null });
      let release!: (response: Response) => void;
      const held = new Promise<Response>((resolve) => {
        release = resolve;
      });
      const google = stubGoogle({ token: () => held, ...handlers });
      const pending = getAccessToken();
      await vi.waitFor(() => expect(google.calls.some((call) => call.url === "https://oauth2.googleapis.com/token")).toBe(true));
      return { pending, release };
    }

    it("does not bring back a connection after Disconnect, even when Google's revoke failed", async () => {
      const { pending, release } = await heldRefresh({ revoke: () => json(503, {}) });
      expect((await disconnectRoute(request("/api/integrations/search-console/disconnect", { method: "POST", headers: { origin: ORIGIN } }))).status).toBe(200);
      expect(await readGoogleTokens()).toBeNull();

      release(json(200, { access_token: "ya29.late", expires_in: 3599, refresh_token: "1//account-A-rotated" }));
      expect(await pending).toEqual({ ok: false, reason: "not_connected" });
      expect(await readGoogleTokens()).toBeNull();
      expect(gscMemory().accessToken).toBeNull();
      expect((await (await statusRoute(request("/api/integrations/search-console"))).json()).status).toMatchObject({ connected: false, reason: "not_connected" });
    });

    it("does not swap a reconnect to another account back to the previous one", async () => {
      const { pending, release } = await heldRefresh();
      await completeConnection({ accessToken: "ya29.account-B", expiresIn: 3599, refreshToken: "1//account-B", scope: SCOPE });

      release(json(200, { access_token: "ya29.account-A", expires_in: 3599, refresh_token: "1//account-A-rotated" }));
      expect(await pending).toEqual({ ok: false, reason: "not_connected" });
      expect(await readGoogleTokens()).toMatchObject({ refreshToken: "1//account-B" });
      expect(gscMemory().accessToken?.token).toBe("ya29.account-B");
      // The next caller uses the new account without another refresh.
      expect(await getAccessToken()).toEqual({ ok: true, token: "ya29.account-B" });
    });

    it("does not delete a newer connection when the previous account's refresh comes back invalid_grant", async () => {
      const { pending, release } = await heldRefresh();
      await completeConnection({ accessToken: "ya29.account-B", expiresIn: 3599, refreshToken: "1//account-B", scope: SCOPE });

      release(json(400, fixture("error-invalid-grant.json")));
      expect(await pending).toEqual({ ok: false, reason: "not_connected" });
      expect(await readGoogleTokens()).toMatchObject({ refreshToken: "1//account-B" });
      expect(gscMemory()).toMatchObject({ reconnectRequired: false, accessToken: { token: "ya29.account-B" } });
    });

    it("never re-inserts or overwrites a row changed behind this process's back", async () => {
      const deleted = await heldRefresh();
      await deleteGoogleTokens();
      deleted.release(json(200, fixture("refresh.json")));
      expect(await deleted.pending).toEqual({ ok: false, reason: "not_connected" });
      expect(await readGoogleTokens()).toBeNull();
      expect(gscMemory().accessToken).toBeNull();

      const replaced = await heldRefresh();
      await saveGoogleTokens({ v: 1, refreshToken: "1//account-C", scope: SCOPE, connectedAt: 2, lastRefreshedAt: null });
      replaced.release(json(200, fixture("refresh.json")));
      expect(await replaced.pending).toEqual({ ok: false, reason: "not_connected" });
      expect(await readGoogleTokens()).toMatchObject({ refreshToken: "1//account-C", lastRefreshedAt: null });
      expect(gscMemory().accessToken).toBeNull();
    });

    it("still records a normal refresh on the stored row", async () => {
      const { pending, release } = await heldRefresh();
      release(json(200, { ...fixture<Record<string, unknown>>("refresh.json"), refresh_token: "1//account-A-rotated" }));
      expect(await pending).toEqual({ ok: true, token: "ya29.fixture-refreshed-token" });
      expect(await readGoogleTokens()).toMatchObject({ refreshToken: "1//account-A-rotated", connectedAt: 1, lastRefreshedAt: expect.any(Number) });
    });
  });
});
