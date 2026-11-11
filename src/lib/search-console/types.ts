// Google Search Console contracts shared by the server integration, the
// Understand pipeline and the UI.
//
// Frozen after Phase 0 of the 2026-09-14 intake change: additions are fine,
// renames are not (the crawl pipeline, the intake toggle and the Understand
// card are built against these names in parallel).
//
// Client-safe: no getDb/fs imports.

export const GSC_SIGNALS_POLICY_VERSION = "gsc-signals@1";
export const GSC_SCOPE = "https://www.googleapis.com/auth/webmasters.readonly";
export const GSC_PROVIDER_ROW = "google_search_console";

export type GscPermissionLevel = "siteOwner" | "siteFullUser" | "siteRestrictedUser" | "siteUnverifiedUser";
export interface GscSite { siteUrl: string; permissionLevel: GscPermissionLevel }

export type GscDimension = "query" | "page" | "country" | "device" | "date" | "searchAppearance" | "hour";
export type GscSearchType = "web" | "image" | "video" | "news" | "discover" | "googleNews";
export interface GscFilter {
  dimension: GscDimension;
  operator: "contains" | "equals" | "notContains" | "notEquals" | "includingRegex" | "excludingRegex";
  expression: string;
}
export interface GscSearchAnalyticsRequest {
  startDate: string; // YYYY-MM-DD, Pacific time
  endDate: string;
  dimensions?: GscDimension[];
  type?: GscSearchType;
  dimensionFilterGroups?: Array<{ groupType?: "and"; filters: GscFilter[] }>;
  aggregationType?: "auto" | "byPage" | "byProperty";
  rowLimit?: number; // 1..25000
  startRow?: number;
  dataState?: "final" | "all" | "hourly_all";
}
export interface GscApiRow { keys?: string[]; clicks: number; impressions: number; ctr: number; position: number }
export interface GscSearchAnalyticsResponse {
  rows?: GscApiRow[];
  responseAggregationType?: string;
  metadata?: { first_incomplete_date?: string; first_incomplete_hour?: string };
}

export interface GscMetricRow { key: string; clicks: number; impressions: number; ctr: number; position: number }

export type GscMatchReason = "user_selected" | "domain_property" | "exact_origin" | "same_host_other_scheme" | "www_variant" | "parent_domain_property" | "path_prefix";
export interface GscPropertyMatch {
  siteUrl: string;
  kind: "domain" | "url_prefix";
  permissionLevel: GscPermissionLevel;
  matchReason: GscMatchReason;
  /** Anchored regex applied as a page filter when the property covers more than the project. */
  pageFilter: string | null;
  alternatives: string[];
}

export interface GscSnapshot {
  siteUrl: string;
  pageFilter: string | null;
  startDate: string;
  endDate: string;
  searchType: "web";
  fetchedAt: number;
  totals: { clicks: number; impressions: number };
  queries: GscMetricRow[];
  pages: GscMetricRow[];
  countries: GscMetricRow[];          // key = alpha-3 lowercase as returned
  primaryCountryQueries: GscMetricRow[]; // query rows within the top country, may be []
  truncated: { queries: boolean; pages: boolean; countries: boolean };
}

export type GscSkipReason =
  | "disabled" | "oauth_not_configured" | "not_connected" | "reconnect_required"
  | "no_matching_property" | "property_not_accessible" | "insufficient_data" | "timeout";
export type GscFailureReason =
  | "quota_exceeded" | "permission_denied" | "google_unavailable" | "network_error"
  | "invalid_response" | "token_refresh_failed";

export type GscPullResult =
  | { ok: true; match: GscPropertyMatch; snapshot: GscSnapshot; rawEvidenceHash: string | null; durationMs: number }
  | { ok: false; kind: "skipped"; reason: GscSkipReason; propertyCount?: number }
  | { ok: false; kind: "failed"; reason: GscFailureReason; httpStatus?: number };

export type SearchConsoleStatus =
  | { configured: false; connected: false; reason: "disabled" | "oauth_not_configured" | "redirect_uri_unavailable"; redirectUri: string | null }
  | { configured: true; connected: false; reason: "not_connected" | "reconnect_required"; redirectUri: string }
  | { configured: true; connected: true; connectedAt: number; propertyCount: number | null; redirectUri: string };

export interface PlaceLevelMix { neighborhood: number; nearby: number; city: number; region: number; country: number; nearMe: number }

/** Code-computed. Fed to understanding (digest + location) at crawl time. */
export interface SearchConsoleSignals {
  siteUrl: string;
  startDate: string;
  endDate: string;
  sufficient: boolean;
  insufficientReason: string | null;
  totals: { clicks: number; impressions: number; visibleQueryImpressions: number; anonymizedShare: number };
  brand: {
    terms: string[];
    brandedClickShare: number | null;
    brandedImpressionShare: number | null;
    ambiguousImpressionShare: number;
    topBranded: Array<{ query: string; clicks: number; impressions: number }>; // ≤20, sanitized
  };
  nonBrandQueries: Array<{ query: string; clicks: number; impressions: number; position: number; placeMentions: string[]; nearMe: boolean }>; // ≤150, sanitized
  countries: Array<{ countryCode: string; clicks: number; impressions: number; share: number }>; // alpha-2, ≤12
  placeDemand: { placeBearingImpressions: number; mix: PlaceLevelMix; unmatchedPlaceMentions: string[] };
  topPages: Array<{ url: string; clicks: number; impressions: number }>; // same-site, ≤50
  /** When Google returned the snapshot (addition: lets the profile summary keep the pull time). */
  fetchedAt?: number;
}

/** Persisted as profile.searchConsole (optional; older versions lack it). */
export interface SearchConsoleProfileSummary {
  source: "google_search_console";
  policyVersion: typeof GSC_SIGNALS_POLICY_VERSION;
  siteUrl: string;
  matchReason: GscMatchReason;
  pageFilter: string | null;
  startDate: string;
  endDate: string;
  fetchedAt: number;
  sufficient: boolean;
  totals: { clicks: number; impressions: number; anonymizedShare: number };
  brandedClickShare: number | null;
  brandedImpressionShare: number | null;
  topNonBrandQueries: Array<{ query: string; clicks: number; impressions: number }>; // ≤50
  brandedModifiers: string[]; // "reviews", "price", "vs" … ≤10
  demandByOffering: Array<{ offering: string; share: number; clicks: number; impressions: number; exampleQueries: string[] }>;
  countries: Array<{ countryCode: string; share: number }>; // ≤8
  placeDemand: { placeBearingImpressions: number; mix: PlaceLevelMix };
  topPages: Array<{ url: string; clicks: number }>; // ≤20
  rawEvidenceHash: string | null;
}

/** What `buildSearchConsoleSignals` needs to know about the business to split brand from non-brand demand. */
export interface SignalsContext {
  brandName: string;
  aliases: string[];
  domain: string;
  places: Array<{ name: string; level: keyof PlaceLevelMix }>;
  offeringVocabulary: string[];
}

// Event payload contracts (additions). The Understand rail and the Search demand
// card read these keys; payloads never carry query text, tokens or account ids.
export interface SearchConsoleSyncStartedPayload { crawlRunId: string | null; startDate: string; endDate: string }
export interface SearchConsoleSyncCompletedPayload {
  /**
   * The run that started this pull (as on `started`). Every terminal event carries
   * it: a failed run's pull settled inside the next "Analyse again" cycle and
   * ticked that run's Search Console step early.
   */
  crawlRunId: string | null;
  siteUrl: string;
  matchReason: GscMatchReason;
  queries: number;
  pages: number;
  countries: number;
  /** Preliminary: computed with the domain name as the brand, before understanding names the business. */
  sufficient: boolean;
  brandedClickShare: number | null;
  durationMs: number;
}
export interface SearchConsoleSyncSkippedPayload { crawlRunId: string | null; reason: GscSkipReason; propertyCount?: number }
export interface SearchConsoleSyncFailedPayload { crawlRunId: string | null; reason: GscFailureReason; httpStatus?: number }
