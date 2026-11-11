// Google OAuth 2.0 web-server flow for read-only Search Console access.
//
// Only `webmasters.readonly` is requested: no openid/email scopes, so nothing
// about the operator's Google account is stored. `prompt=consent` makes Google
// return a refresh token on every connect, because a reconnect after the 7-day
// Testing-mode expiry otherwise came back without one. CSRF protection is a
// random `state` echoed through a short-lived HMAC-signed cookie.
//
// Server-only.

import crypto from "node:crypto";
import { gscDisabled, oauthClient, resolveRedirectUri } from "./config";
import { bumpConnectionGeneration, clearSearchConsoleCaches, gscMemory } from "./memory";
import { deleteGoogleTokens, readGoogleTokenRow, saveGoogleTokens, updateGoogleTokens } from "./token-store";
import { googleFetch, readJson } from "./transport";
import { GSC_SCOPE, type SearchConsoleStatus } from "./types";

export const GOOGLE_AUTHORIZE_URL = "https://accounts.google.com/o/oauth2/v2/auth";
export const GOOGLE_TOKEN_URL = "https://oauth2.googleapis.com/token";
export const GOOGLE_REVOKE_URL = "https://oauth2.googleapis.com/revoke";

export const OAUTH_COOKIE_NAME = "sun_gsc_oauth";
export const OAUTH_COOKIE_PATH = "/api/integrations/search-console";
export const OAUTH_COOKIE_MAX_AGE_S = 600;

const DEFAULT_RETURN_TO = "/trial/new";
// Parsing base for return paths; never sent to the browser.
const RETURN_BASE = "http://return.invalid";
// Refresh a little before Google's expiry so a request never goes out with a token that dies mid-flight.
const ACCESS_TOKEN_SKEW_MS = 60_000;
const CONTROL_CHARS = /[\p{Cc}]/u;

type UnavailableReason = Extract<SearchConsoleStatus, { configured: false }>["reason"];

export function gscConfig(origin?: string): { clientId: string; clientSecret: string; redirectUri: string } | { unavailable: UnavailableReason } {
  if (gscDisabled()) return { unavailable: "disabled" };
  const client = oauthClient();
  if (!client) return { unavailable: "oauth_not_configured" };
  const redirectUri = resolveRedirectUri(origin);
  if (!redirectUri) return { unavailable: "redirect_uri_unavailable" };
  return { ...client, redirectUri };
}

export function buildAuthorizeUrl(input: { state: string; redirectUri: string }): string {
  const client = oauthClient();
  if (!client) throw new Error("Search Console OAuth client is not configured");
  const params = new URLSearchParams({
    client_id: client.clientId,
    redirect_uri: input.redirectUri,
    response_type: "code",
    scope: GSC_SCOPE,
    access_type: "offline",
    prompt: "consent",
    include_granted_scopes: "false",
    state: input.state,
  });
  return `${GOOGLE_AUTHORIZE_URL}?${params.toString()}`;
}

/** Google's granular consent lets the user untick a scope, so the granted list is checked, not assumed. */
export function scopeGranted(scope: string | null | undefined): boolean {
  return (scope ?? "").split(/\s+/).includes(GSC_SCOPE);
}

// ---------------------------------------------------------------------------
// Token endpoint
// ---------------------------------------------------------------------------

function formBody(values: Record<string, string>): { body: string; headers: Record<string, string> } {
  return { body: new URLSearchParams(values).toString(), headers: { "content-type": "application/x-www-form-urlencoded" } };
}

function googleErrorCode(json: unknown): string | null {
  if (!json || typeof json !== "object") return null;
  const error = (json as Record<string, unknown>).error;
  return typeof error === "string" ? error : null;
}

export async function exchangeCode(code: string, redirectUri: string): Promise<{ ok: true; tokens: { accessToken: string; expiresIn: number; refreshToken: string | null; scope: string } } | { ok: false; error: string }> {
  const client = oauthClient();
  if (!client) return { ok: false, error: "not_configured" };
  const result = await googleFetch(GOOGLE_TOKEN_URL, {
    method: "POST",
    ...formBody({ code, client_id: client.clientId, client_secret: client.clientSecret, redirect_uri: redirectUri, grant_type: "authorization_code" }),
  });
  if (!result.ok) return { ok: false, error: "network_error" };
  const json = await readJson(result.response);
  if (!result.response.ok) return { ok: false, error: googleErrorCode(json) ?? "token_exchange_failed" };
  const record = (json ?? {}) as Record<string, unknown>;
  if (typeof record.access_token !== "string" || record.access_token.length === 0) return { ok: false, error: "token_exchange_failed" };
  return {
    ok: true,
    tokens: {
      accessToken: record.access_token,
      expiresIn: typeof record.expires_in === "number" ? record.expires_in : 3600,
      refreshToken: typeof record.refresh_token === "string" && record.refresh_token.length > 0 ? record.refresh_token : null,
      scope: typeof record.scope === "string" ? record.scope : "",
    },
  };
}

/** Stores a fresh connection: the encrypted refresh token plus the in-memory access token. */
export async function completeConnection(tokens: { accessToken: string; expiresIn: number; refreshToken: string; scope: string }, now = Date.now()): Promise<void> {
  const memory = gscMemory();
  // A refresh or pull for the previous account still in flight must not land on
  // this one. Bumped in the same tick as the save, so nothing reads between them.
  bumpConnectionGeneration();
  memory.refreshInFlight = null;
  await saveGoogleTokens({ v: 1, refreshToken: tokens.refreshToken, scope: tokens.scope, connectedAt: now, lastRefreshedAt: null });
  memory.accessToken = { token: tokens.accessToken, expiresAt: now + tokens.expiresIn * 1000 };
  memory.reconnectRequired = false;
  clearSearchConsoleCaches();
}

export type AccessTokenResult = { ok: true; token: string } | { ok: false; reason: "not_connected" | "reconnect_required" | "token_refresh_failed" };

async function refreshAccessToken(): Promise<AccessTokenResult> {
  const memory = gscMemory();
  const client = oauthClient();
  if (!client) return { ok: false, reason: "not_connected" };
  // Disconnect and reconnect can't cancel the token request below, so its result
  // is dropped when the connection changed while it waited (see memory.generation).
  const generation = memory.generation;
  const row = await readGoogleTokenRow();
  if (row === null) return { ok: false, reason: memory.reconnectRequired ? "reconnect_required" : "not_connected" };
  if (row === "unreadable") {
    memory.reconnectRequired = true;
    return { ok: false, reason: "reconnect_required" };
  }
  const stored = row.envelope;
  const result = await googleFetch(GOOGLE_TOKEN_URL, {
    method: "POST",
    ...formBody({ client_id: client.clientId, client_secret: client.clientSecret, refresh_token: stored.refreshToken, grant_type: "refresh_token" }),
  });
  if (!result.ok) return { ok: false, reason: "token_refresh_failed" };
  const json = await readJson(result.response);
  if (memory.generation !== generation) return { ok: false, reason: "not_connected" };
  if (!result.response.ok) {
    // invalid_grant: revoked, expired (7 days in Testing mode), idle for 6 months
    // or over the per-account token limit. Only a new consent fixes it.
    if (googleErrorCode(json) === "invalid_grant") {
      // Memory first, synchronously: a connect landing during the delete's await must win.
      bumpConnectionGeneration();
      memory.accessToken = null;
      memory.reconnectRequired = true;
      clearSearchConsoleCaches();
      await deleteGoogleTokens(row.ciphertext);
      return { ok: false, reason: "reconnect_required" };
    }
    return { ok: false, reason: "token_refresh_failed" };
  }
  const record = (json ?? {}) as Record<string, unknown>;
  if (typeof record.access_token !== "string" || record.access_token.length === 0) return { ok: false, reason: "token_refresh_failed" };
  const now = Date.now();
  const accessToken = { token: record.access_token, expiresAt: now + (typeof record.expires_in === "number" ? record.expires_in : 3600) * 1000 };
  memory.accessToken = accessToken;
  const rotated = typeof record.refresh_token === "string" && record.refresh_token.length > 0 ? record.refresh_token : null;
  let stillStored = true;
  try {
    // Update-only, and only the row this refresh read: never re-creates or overwrites a connection.
    stillStored = await updateGoogleTokens({ ...stored, refreshToken: rotated ?? stored.refreshToken, lastRefreshedAt: now }, row.ciphertext);
  } catch {
    // Bookkeeping only; the refresh itself succeeded.
  }
  if (!stillStored || memory.generation !== generation) {
    // The row was deleted or replaced since it was read (e.g. by another process).
    if (memory.accessToken === accessToken) memory.accessToken = null;
    return { ok: false, reason: "not_connected" };
  }
  return { ok: true, token: record.access_token };
}

/**
 * A usable access token. Concurrent callers share one refresh, because the
 * pull fires its Search Analytics queries in parallel and each would otherwise
 * refresh on its own.
 */
export async function getAccessToken(options: { forceRefresh?: boolean } = {}): Promise<AccessTokenResult> {
  const memory = gscMemory();
  if (options.forceRefresh && !memory.refreshInFlight) memory.accessToken = null;
  const cached = memory.accessToken;
  if (cached && cached.expiresAt - ACCESS_TOKEN_SKEW_MS > Date.now()) return { ok: true, token: cached.token };
  if (!memory.refreshInFlight) {
    const refresh: Promise<AccessTokenResult> = refreshAccessToken().finally(() => {
      // Only its own slot: a disconnect or connect may already have cleared it for a newer refresh.
      if (memory.refreshInFlight === refresh) memory.refreshInFlight = null;
    });
    memory.refreshInFlight = refresh;
  }
  return (await memory.refreshInFlight) as AccessTokenResult;
}

/** Best effort: true when Google confirmed the revoke. */
export async function revokeRefreshToken(token: string): Promise<boolean> {
  // The token goes in the form body, not the query string, so it never lands in an access log.
  const result = await googleFetch(GOOGLE_REVOKE_URL, { method: "POST", ...formBody({ token }) }, 5_000);
  return result.ok && result.response.ok;
}

// ---------------------------------------------------------------------------
// State cookie
// ---------------------------------------------------------------------------

function cookieKey(): Buffer | null {
  const client = oauthClient();
  if (!client) return null;
  return Buffer.from(crypto.hkdfSync("sha256", client.clientSecret, "sun/gsc-cookie/v1", "oauth_state", 32));
}

function hmac(key: Buffer, data: string): string {
  return crypto.createHmac("sha256", key).update(data).digest("base64url");
}

export function newOAuthState(): string {
  return crypto.randomBytes(32).toString("base64url");
}

export function signOAuthCookie(payload: { state: string; returnTo: string; iat: number }): string {
  const key = cookieKey();
  if (!key) throw new Error("Search Console OAuth client is not configured");
  const body = Buffer.from(JSON.stringify(payload), "utf8").toString("base64url");
  return `${body}.${hmac(key, body)}`;
}

export function timingSafeEqualText(a: string, b: string): boolean {
  const left = Buffer.from(a, "utf8");
  const right = Buffer.from(b, "utf8");
  return left.length === right.length && crypto.timingSafeEqual(left, right);
}

export function verifyOAuthCookie(raw: string | undefined, now = Date.now()): { state: string; returnTo: string } | null {
  if (!raw) return null;
  const key = cookieKey();
  if (!key) return null;
  const dot = raw.indexOf(".");
  if (dot <= 0 || dot === raw.length - 1) return null;
  const body = raw.slice(0, dot);
  const signature = raw.slice(dot + 1);
  if (!timingSafeEqualText(signature, hmac(key, body))) return null;
  try {
    const payload = JSON.parse(Buffer.from(body, "base64url").toString("utf8")) as Record<string, unknown>;
    if (typeof payload.state !== "string" || typeof payload.returnTo !== "string" || typeof payload.iat !== "number") return null;
    const age = now - payload.iat;
    if (age > OAUTH_COOKIE_MAX_AGE_S * 1000 || age < -60_000) return null;
    return { state: payload.state, returnTo: payload.returnTo };
  } catch {
    return null;
  }
}

/**
 * A same-origin path under `/trial/new` or `/projects/`, else `/trial/new`.
 * The callback redirects here after consent, so anything looser is an open
 * redirect (`//evil.test`, `/\evil.test` and `https://evil.test` all are).
 * `origin` only anchors parsing: the result is always a path, which the routes
 * send as a relative Location so the browser stays on the host it used.
 */
export function safeReturnTo(raw: string | null, origin: string = RETURN_BASE): string {
  if (!raw || !raw.startsWith("/") || raw.startsWith("//") || raw.includes("\\") || CONTROL_CHARS.test(raw)) return DEFAULT_RETURN_TO;
  let base: URL;
  let parsed: URL;
  try {
    base = new URL(origin);
    parsed = new URL(raw, base);
  } catch {
    return DEFAULT_RETURN_TO;
  }
  if (parsed.origin !== base.origin) return DEFAULT_RETURN_TO;
  const path = parsed.pathname;
  if (path !== "/trial/new" && !path.startsWith("/projects/")) return DEFAULT_RETURN_TO;
  return `${path}${parsed.search}`;
}

/** Appends the outcome parameters the intake page reads after the round trip. */
export function withGscOutcome(returnTo: string, status: "connected" | "denied" | "error", reason?: string | null): string {
  const url = new URL(returnTo, RETURN_BASE);
  url.searchParams.set("gsc_status", status);
  if (reason) url.searchParams.set("gsc_reason", reason);
  else url.searchParams.delete("gsc_reason");
  return `${url.pathname}${url.search}`;
}
