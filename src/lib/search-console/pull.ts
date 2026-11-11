// One Search Console pull for a project: match the property, then read the
// last 90 days in at most six requests.
//
// No query×page combination (Google's most expensive form) and no paging: the
// top rows are what the analysis uses, and Google caps rows anyway. The four
// independent queries run in parallel so the pull usually lands inside
// Understand's wait. Google asks clients not to re-query identical data, so a
// same-day re-crawl of the same site is served from a 12 h in-memory cache and
// makes no request at all.
//
// Server-only.

import { storeEvidence } from "@/lib/evidence/store";
import { gscDisabled, lookbackDays, oauthClient } from "./config";
import { isPullFailure, listSites, querySearchAnalytics, type GoogleClientOptions } from "./google-client";
import { gscMemory, readCache, writeCache } from "./memory";
import { matchProperty } from "./property-match";
import { readGoogleTokens } from "./token-store";
import type { GscFilter, GscMetricRow, GscPropertyMatch, GscPullResult, GscSearchAnalyticsRequest, GscSnapshot } from "./types";
import { reportingWindow } from "./window";

export { reportingWindow } from "./window";

const CACHE_TTL_MS = 12 * 60 * 60 * 1000;
export const QUERY_ROW_LIMIT = 1000;
export const PAGE_ROW_LIMIT = 500;
export const COUNTRY_ROW_LIMIT = 250;
/** When one country already holds this share of impressions, its own query rows add nothing. */
export const SINGLE_COUNTRY_SHARE = 0.9;

export interface PullInput {
  projectId: string;
  projectUrl: string;
  registrableDomain: string;
  siteUrl?: string;
  now?: Date;
  /** Called as soon as the page query returns, so the crawl planner can use top pages early. */
  onPages?: (pages: GscMetricRow[]) => void;
  client?: GoogleClientOptions;
}

type Failure = Extract<GscPullResult, { ok: false }>;

function queryBody(window: { startDate: string; endDate: string }, pageFilter: string | null, extra: Partial<GscSearchAnalyticsRequest> & { filters?: GscFilter[] }): GscSearchAnalyticsRequest {
  const filters: GscFilter[] = [...(extra.filters ?? [])];
  if (pageFilter) filters.unshift({ dimension: "page", operator: "includingRegex", expression: pageFilter });
  const body: GscSearchAnalyticsRequest = {
    startDate: window.startDate,
    endDate: window.endDate,
    dimensions: extra.dimensions ?? [],
    type: "web",
    dataState: "final",
    rowLimit: extra.rowLimit ?? 1,
  };
  if (filters.length > 0) body.dimensionFilterGroups = [{ groupType: "and", filters }];
  return body;
}

// A pull that outlived a disconnect or reconnect read the previous connection's
// data: it must not refill the caches the change just cleared, nor be used.
const CONNECTION_CHANGED: Failure = { ok: false, kind: "skipped", reason: "not_connected" };

async function resolveMatch(input: PullInput, options: GoogleClientOptions, generation: number): Promise<{ match: GscPropertyMatch; propertyCount: number } | Failure> {
  const memory = gscMemory();
  const key = `${input.projectUrl}|${input.registrableDomain}|${input.siteUrl ?? ""}`;
  const cached = readCache(memory.matches, key);
  if (cached) return cached;
  const sites = await listSites(options);
  // A failure keeps its own reason (invalid_grant bumps the generation itself).
  if (isPullFailure(sites)) return sites;
  if (memory.generation !== generation) return CONNECTION_CHANGED;
  const readable = (sites as Array<{ permissionLevel: string }>).filter((site) => site.permissionLevel !== "siteUnverifiedUser").length;
  memory.propertyCount = readable;
  const match = matchProperty(sites as Parameters<typeof matchProperty>[0], { url: input.projectUrl, registrableDomain: input.registrableDomain }, input.siteUrl);
  if (!match) {
    return { ok: false, kind: "skipped", reason: input.siteUrl ? "property_not_accessible" : "no_matching_property", propertyCount: readable };
  }
  const value = { match, propertyCount: readable };
  writeCache(memory.matches, key, value, CACHE_TTL_MS);
  return value;
}

function storeSnapshot(projectId: string, snapshot: GscSnapshot): string | null {
  try {
    return storeEvidence(projectId, JSON.stringify(snapshot)).hash;
  } catch {
    return null;
  }
}

export async function pullSearchConsoleSnapshot(input: PullInput): Promise<GscPullResult> {
  const started = Date.now();
  // Checked before anything that could reach Google: without config or a stored
  // connection this makes no request at all.
  if (gscDisabled()) return { ok: false, kind: "skipped", reason: "disabled" };
  if (!oauthClient()) return { ok: false, kind: "skipped", reason: "oauth_not_configured" };
  const generation = gscMemory().generation;
  const stored = await readGoogleTokens();
  if (stored === null) return { ok: false, kind: "skipped", reason: gscMemory().reconnectRequired ? "reconnect_required" : "not_connected" };
  if (stored === "unreadable") return { ok: false, kind: "skipped", reason: "reconnect_required" };

  const options = input.client ?? {};
  const resolved = await resolveMatch(input, options, generation);
  if (isPullFailure(resolved)) return resolved;
  const memory = gscMemory();
  if (memory.generation !== generation) return CONNECTION_CHANGED;
  const { match } = resolved;
  const window = reportingWindow(input.now ?? new Date(), lookbackDays());

  const cacheKey = `${match.siteUrl}|${match.pageFilter ?? ""}|${window.startDate}|${window.endDate}`;
  const cached = readCache(memory.snapshots, cacheKey);
  if (cached) {
    input.onPages?.(cached.pages);
    return { ok: true, match, snapshot: cached, rawEvidenceHash: storeSnapshot(input.projectId, cached), durationMs: Date.now() - started };
  }

  const pagesPromise = querySearchAnalytics(match.siteUrl, queryBody(window, match.pageFilter, { dimensions: ["page"], rowLimit: PAGE_ROW_LIMIT }), options).then((rows) => {
    if (!isPullFailure(rows) && memory.generation === generation) input.onPages?.(rows as GscMetricRow[]);
    return rows;
  });
  const [totals, queries, pages, countries] = await Promise.all([
    querySearchAnalytics(match.siteUrl, queryBody(window, match.pageFilter, { dimensions: [], rowLimit: 1 }), options),
    querySearchAnalytics(match.siteUrl, queryBody(window, match.pageFilter, { dimensions: ["query"], rowLimit: QUERY_ROW_LIMIT }), options),
    pagesPromise,
    querySearchAnalytics(match.siteUrl, queryBody(window, match.pageFilter, { dimensions: ["country"], rowLimit: COUNTRY_ROW_LIMIT }), options),
  ]);
  for (const result of [totals, queries, pages, countries]) {
    if (isPullFailure(result)) return result;
  }
  const totalRows = totals as GscMetricRow[];
  const queryRows = queries as GscMetricRow[];
  const pageRows = pages as GscMetricRow[];
  const countryRows = (countries as GscMetricRow[]).map((row) => ({ ...row, key: row.key.toLowerCase() }));

  let primaryCountryQueries: GscMetricRow[] = [];
  const countryImpressions = countryRows.reduce((total, row) => total + row.impressions, 0);
  const top = [...countryRows].sort((a, b) => b.impressions - a.impressions)[0];
  if (top && /^[a-z]{3}$/.test(top.key) && countryImpressions > 0 && top.impressions / countryImpressions < SINGLE_COUNTRY_SHARE) {
    const rows = await querySearchAnalytics(
      match.siteUrl,
      queryBody(window, match.pageFilter, { dimensions: ["query", "country"], rowLimit: QUERY_ROW_LIMIT, filters: [{ dimension: "country", operator: "equals", expression: top.key }] }),
      options,
    );
    // Optional detail: a failure here keeps the rest of the pull.
    if (!isPullFailure(rows)) primaryCountryQueries = rows as GscMetricRow[];
  }

  if (memory.generation !== generation) return CONNECTION_CHANGED;
  const snapshot: GscSnapshot = {
    siteUrl: match.siteUrl,
    pageFilter: match.pageFilter,
    startDate: window.startDate,
    endDate: window.endDate,
    searchType: "web",
    fetchedAt: Date.now(),
    totals: { clicks: totalRows[0]?.clicks ?? 0, impressions: totalRows[0]?.impressions ?? 0 },
    queries: queryRows,
    pages: pageRows,
    countries: countryRows,
    primaryCountryQueries,
    truncated: { queries: queryRows.length === QUERY_ROW_LIMIT, pages: pageRows.length === PAGE_ROW_LIMIT, countries: countryRows.length === COUNTRY_ROW_LIMIT },
  };
  writeCache(memory.snapshots, cacheKey, snapshot, CACHE_TTL_MS);
  return { ok: true, match, snapshot, rawEvidenceHash: storeSnapshot(input.projectId, snapshot), durationMs: Date.now() - started };
}
