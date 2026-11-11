// Search Console API calls: `sites.list` and `searchAnalytics.query`.
//
// Plain `fetch` (no `googleapis` dependency). Error handling follows Google's
// limits page: a quota error means "wait 15 minutes", so 429 and quota-flavoured
// 403s are returned at once and never retried (retrying only burns more of the
// load quota). A 401 gets exactly one refresh-and-retry; a 5xx or network
// error gets exactly one retry after a short pause.
//
// Server-only.

import { getAccessToken } from "./oauth";
import { googleFetch, readJson } from "./transport";
import type { GscApiRow, GscMetricRow, GscPermissionLevel, GscPullResult, GscSearchAnalyticsRequest, GscSite } from "./types";

export const SEARCH_CONSOLE_API = "https://www.googleapis.com/webmasters/v3";

const PERMISSION_LEVELS: ReadonlySet<string> = new Set<GscPermissionLevel>(["siteOwner", "siteFullUser", "siteRestrictedUser", "siteUnverifiedUser"]);

export interface GoogleClientOptions {
  /** Pause before the single 5xx/network retry. */
  retryDelayMs?: number;
  timeoutMs?: number;
}

type Failure = Extract<GscPullResult, { ok: false }>;

function skipped(reason: Extract<Failure, { kind: "skipped" }>["reason"]): Failure {
  return { ok: false, kind: "skipped", reason };
}

function failed(reason: Extract<Failure, { kind: "failed" }>["reason"], httpStatus?: number): Failure {
  return httpStatus === undefined ? { ok: false, kind: "failed", reason } : { ok: false, kind: "failed", reason, httpStatus };
}

export function isPullFailure(value: unknown): value is Failure {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value) && (value as { ok?: unknown }).ok === false;
}

function errorReasons(json: unknown): string[] {
  if (!json || typeof json !== "object") return [];
  const error = (json as Record<string, unknown>).error;
  if (!error || typeof error !== "object") return [];
  const record = error as Record<string, unknown>;
  const reasons: string[] = [];
  if (typeof record.status === "string") reasons.push(record.status);
  if (Array.isArray(record.errors)) {
    for (const item of record.errors) {
      const reason = item && typeof item === "object" ? (item as Record<string, unknown>).reason : undefined;
      if (typeof reason === "string") reasons.push(reason);
    }
  }
  return reasons;
}

function sleep(ms: number): Promise<void> {
  return ms > 0 ? new Promise((resolve) => setTimeout(resolve, ms)) : Promise.resolve();
}

/** One authorized JSON call with the retry rules above. */
async function authorizedJson(url: string, init: RequestInit, options: GoogleClientOptions): Promise<unknown | Failure> {
  const retryDelayMs = options.retryDelayMs ?? 1_000;
  let refreshed = false;
  let forceRefresh = false;
  let retried = false;
  for (;;) {
    const token = await getAccessToken({ forceRefresh });
    forceRefresh = false;
    if (!token.ok) {
      if (token.reason === "token_refresh_failed") return failed("token_refresh_failed");
      return skipped(token.reason);
    }
    const headers = { ...(init.headers as Record<string, string> | undefined), authorization: `Bearer ${token.token}`, accept: "application/json" };
    const result = await googleFetch(url, { ...init, headers }, options.timeoutMs);
    if (!result.ok) {
      if (!retried) {
        retried = true;
        await sleep(retryDelayMs);
        continue;
      }
      return failed("network_error");
    }
    const { response } = result;
    if (response.status === 401) {
      if (!refreshed) {
        refreshed = true;
        forceRefresh = true;
        continue;
      }
      return failed("token_refresh_failed", 401);
    }
    if (response.status === 429) return failed("quota_exceeded", 429);
    if (response.status === 403) {
      const reasons = errorReasons(await readJson(response));
      const quota = reasons.some((reason) => /quota|rateLimit|RESOURCE_EXHAUSTED/i.test(reason));
      return failed(quota ? "quota_exceeded" : "permission_denied", 403);
    }
    if (response.status >= 500) {
      if (!retried) {
        retried = true;
        await sleep(retryDelayMs);
        continue;
      }
      return failed("google_unavailable", response.status);
    }
    if (!response.ok) return failed("invalid_response", response.status);
    const json = await readJson(response);
    if (json === null || typeof json !== "object") return failed("invalid_response", response.status);
    return json;
  }
}

/** Properties the connected account can see, or a skipped/failed result. */
export async function listSites(options: GoogleClientOptions = {}): Promise<GscSite[] | GscPullResult> {
  const json = await authorizedJson(`${SEARCH_CONSOLE_API}/sites`, { method: "GET" }, options);
  if (isPullFailure(json)) return json;
  const entries = (json as { siteEntry?: unknown }).siteEntry;
  if (entries !== undefined && !Array.isArray(entries)) return failed("invalid_response");
  const sites: GscSite[] = [];
  for (const entry of entries ?? []) {
    if (!entry || typeof entry !== "object") continue;
    const record = entry as Record<string, unknown>;
    if (typeof record.siteUrl !== "string" || typeof record.permissionLevel !== "string" || !PERMISSION_LEVELS.has(record.permissionLevel)) continue;
    sites.push({ siteUrl: record.siteUrl, permissionLevel: record.permissionLevel as GscPermissionLevel });
  }
  return sites;
}

function finite(value: unknown): number {
  return typeof value === "number" && Number.isFinite(value) ? value : 0;
}

/**
 * Search Analytics rows keyed by their first dimension. A second dimension is
 * only ever requested together with an `equals` filter on it (query rows inside
 * the top country), so the first key is the whole identity.
 */
export async function querySearchAnalytics(siteUrl: string, body: GscSearchAnalyticsRequest, options: GoogleClientOptions = {}): Promise<GscMetricRow[] | GscPullResult> {
  const url = `${SEARCH_CONSOLE_API}/sites/${encodeURIComponent(siteUrl)}/searchAnalytics/query`;
  const json = await authorizedJson(url, { method: "POST", body: JSON.stringify(body), headers: { "content-type": "application/json" } }, options);
  if (isPullFailure(json)) return json;
  const rows = (json as { rows?: unknown }).rows;
  if (rows !== undefined && !Array.isArray(rows)) return failed("invalid_response");
  return ((rows ?? []) as GscApiRow[])
    .filter((row) => row && typeof row === "object")
    .map((row) => ({
      key: Array.isArray(row.keys) && typeof row.keys[0] === "string" ? row.keys[0] : "",
      clicks: finite(row.clicks),
      impressions: finite(row.impressions),
      ctr: finite(row.ctr),
      position: finite(row.position),
    }));
}
