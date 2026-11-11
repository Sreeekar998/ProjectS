import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { appOrigin, resolveRedirectUri } from "@/lib/search-console/config";
import { buildAuthorizeUrl, gscConfig, safeReturnTo, scopeGranted, signOAuthCookie, verifyOAuthCookie, withGscOutcome } from "@/lib/search-console/oauth";
import { GSC_SCOPE } from "@/lib/search-console/types";
import { FAKE_CLIENT_ID, clearOAuthEnv, setFakeOAuthEnv } from "../../fixtures/search-console/google-stub";

const ORIGIN = "http://localhost:3000";

describe("Search Console OAuth helpers", () => {
  beforeEach(() => setFakeOAuthEnv());
  afterEach(() => clearOAuthEnv());

  it("asks only for read-only Search Console access, offline, with a fresh consent", () => {
    const url = new URL(buildAuthorizeUrl({ state: "state-123", redirectUri: `${ORIGIN}/api/integrations/search-console/callback` }));
    expect(`${url.origin}${url.pathname}`).toBe("https://accounts.google.com/o/oauth2/v2/auth");
    expect(Object.fromEntries(url.searchParams)).toEqual({
      client_id: FAKE_CLIENT_ID,
      redirect_uri: `${ORIGIN}/api/integrations/search-console/callback`,
      response_type: "code",
      scope: GSC_SCOPE,
      access_type: "offline",
      prompt: "consent",
      include_granted_scopes: "false",
      state: "state-123",
    });
    expect(GSC_SCOPE).toBe("https://www.googleapis.com/auth/webmasters.readonly");
  });

  it("checks the granted scope instead of assuming it", () => {
    expect(scopeGranted(`openid ${GSC_SCOPE}`)).toBe(true);
    expect(scopeGranted("https://www.googleapis.com/auth/webmasters")).toBe(false);
    expect(scopeGranted("")).toBe(false);
  });

  it("signs the state cookie and rejects tampering, expiry and another secret", () => {
    const now = Date.now();
    const cookie = signOAuthCookie({ state: "s1", returnTo: "/trial/new?gsc_return=1", iat: now });
    expect(verifyOAuthCookie(cookie, now + 1000)).toEqual({ state: "s1", returnTo: "/trial/new?gsc_return=1" });

    const [body, signature] = cookie.split(".");
    const forged = Buffer.from(JSON.stringify({ state: "s1", returnTo: "https://evil.test/", iat: now })).toString("base64url");
    expect(verifyOAuthCookie(`${forged}.${signature}`, now)).toBeNull();
    expect(verifyOAuthCookie(`${body}.${signature!.slice(0, -2)}xx`, now)).toBeNull();
    expect(verifyOAuthCookie(`${body}`, now)).toBeNull();
    expect(verifyOAuthCookie(undefined, now)).toBeNull();

    expect(verifyOAuthCookie(cookie, now + 11 * 60 * 1000)).toBeNull();

    process.env.GOOGLE_OAUTH_CLIENT_SECRET = "another-secret";
    expect(verifyOAuthCookie(cookie, now)).toBeNull();
  });

  it("allows only same-origin intake and project paths as the return address", () => {
    expect(safeReturnTo("/trial/new?gsc_return=1&url=https%3A%2F%2Flumenstudio.test%2F", ORIGIN)).toBe("/trial/new?gsc_return=1&url=https%3A%2F%2Flumenstudio.test%2F");
    expect(safeReturnTo("/projects/prj_1/understand", ORIGIN)).toBe("/projects/prj_1/understand");
    for (const hostile of ["//evil.test", "https://evil.test", "/\\evil.test", "\\/evil.test", "javascript:alert(1)", "/%2F%2Fevil.test", "/trial/new/../../api/providers/credentials", "/admin", "", null, "/trial/newer", "/trial/new\tx"]) {
      expect(safeReturnTo(hostile, ORIGIN), String(hostile)).toBe("/trial/new");
    }
  });

  it("adds the outcome parameters the intake page reads", () => {
    expect(withGscOutcome("/trial/new?gsc_return=1&url=x", "connected")).toBe("/trial/new?gsc_return=1&url=x&gsc_status=connected");
    expect(withGscOutcome("/trial/new", "error", "state_mismatch")).toBe("/trial/new?gsc_status=error&gsc_reason=state_mismatch");
  });

  it("derives the redirect URI only for loopback hosts unless it is configured", () => {
    expect(resolveRedirectUri("http://localhost:3000")).toBe("http://localhost:3000/api/integrations/search-console/callback");
    expect(resolveRedirectUri("http://127.0.0.1:3100")).toBe("http://127.0.0.1:3100/api/integrations/search-console/callback");
    expect(resolveRedirectUri("http://[::1]:3000")).toBe("http://[::1]:3000/api/integrations/search-console/callback");
    expect(resolveRedirectUri("http://192.168.1.20:3000")).toBeNull();
    expect(resolveRedirectUri("https://sun.example.test")).toBeNull();
    expect(gscConfig("https://sun.example.test")).toEqual({ unavailable: "redirect_uri_unavailable" });

    process.env.GOOGLE_OAUTH_REDIRECT_URI = "https://sun.example.test/api/integrations/search-console/callback";
    expect(gscConfig("https://attacker.test")).toMatchObject({ redirectUri: "https://sun.example.test/api/integrations/search-console/callback" });
  });

  it("takes the app origin from a loopback Host header, not Next's bind host", () => {
    // Next's nextUrl says localhost even when the browser opened 127.0.0.1.
    const req = (host: string | null, protocol = "http:") => ({ headers: new Headers(host === null ? {} : { host }), nextUrl: { protocol, host: "localhost:3000" } });
    expect(appOrigin(req("127.0.0.1:3100"))).toBe("http://127.0.0.1:3100");
    expect(appOrigin(req("[::1]:3000"))).toBe("http://[::1]:3000");
    expect(appOrigin(req("LOCALHOST:3000"))).toBe("http://localhost:3000");
    expect(appOrigin(req(null))).toBe("http://localhost:3000");
    for (const hostile of ["192.168.1.20:3000", "0.0.0.0:3000", "localhost.evil.test", "evil.test@localhost", "localhost/evil", ""]) {
      expect(appOrigin(req(hostile)), hostile).toBeNull();
    }

    // A plain Request (route tests, scripts' handlers) has no nextUrl: its url stands in.
    expect(appOrigin(new Request("http://localhost/api/projects/p/crawl"))).toBe("http://localhost");
    expect(appOrigin(new Request("http://localhost/api/projects/p/crawl", { headers: { host: "rebind.evil.test:3000" } }))).toBeNull();
    expect(appOrigin({ headers: new Headers() })).toBeNull();

    process.env.GOOGLE_OAUTH_REDIRECT_URI = "https://sun.example.test/api/integrations/search-console/callback";
    expect(appOrigin(req("sun.example.test"))).toBe("https://sun.example.test");
    expect(appOrigin(req("192.168.1.20:3000"))).toBeNull();
    expect(appOrigin(req("127.0.0.1:3100"))).toBe("http://127.0.0.1:3100");
  });

  it("reports why the integration is unavailable", () => {
    process.env.SUN_GSC_DISABLED = "1";
    expect(gscConfig(ORIGIN)).toEqual({ unavailable: "disabled" });
    clearOAuthEnv();
    expect(gscConfig(ORIGIN)).toEqual({ unavailable: "oauth_not_configured" });
  });
});
