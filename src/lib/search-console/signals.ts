// Code-computed Search Console signals and the profile summary.
//
// Principle: code computes, models read. Every share and count here is
// deterministic. Query strings are customer language typed by strangers, so
// they pass a hygiene filter (no emails, phone numbers, URLs or over-long
// strings; markup characters neutralised) before anything leaves this module,
// and they are never evidence for a profile field. Place names come only from
// the business's resolved location (no gazetteer), and a query theme that
// matches no offering is never turned into one (the no-fabrication rule).
//
// Pure and client-safe.

import { alpha2FromAlpha3 } from "@/lib/geo/iso3166";
import { countryCodesMentioned, countryName } from "@/lib/geo/countries";
import { brandModifierTokens, brandTerms, normalizeSearchText, splitBrandQueries } from "./brand-split";
import {
  GSC_SIGNALS_POLICY_VERSION,
  type GscMetricRow,
  type GscPropertyMatch,
  type GscSnapshot,
  type PlaceLevelMix,
  type SearchConsoleProfileSummary,
  type SearchConsoleSignals,
  type SignalsContext,
} from "./types";

export { brandTerms, splitBrandQueries } from "./brand-split";

export const MIN_NON_BRAND_IMPRESSIONS = 100;
export const MIN_VISIBLE_QUERIES = 10;
const MAX_QUERY_LENGTH = 80;
const MAX_NON_BRAND = 150;
const MAX_TOP_BRANDED = 20;
const MAX_COUNTRIES = 12;
const MAX_TOP_PAGES = 50;
const MAX_SUMMARY_QUERIES = 50;
const MAX_SUMMARY_COUNTRIES = 8;
const MAX_SUMMARY_PAGES = 20;
const MAX_MODIFIERS = 10;
const MAX_OFFERINGS = 12;
const MAX_EXAMPLES = 5;
const MAX_UNMATCHED_PLACES = 20;

const CONTROL = /\p{Cc}+/gu;
const EMAIL = /[^\s@]+@[^\s@]+\.[^\s@]+/;
const URLISH = /(:\/\/|\bwww\.|[a-z0-9-]+\.[a-z]{2,}\/)/i;
const LONG_DIGITS = /\d{6,}/;
const PHONE = /\+\d|\d{3}[\s.-]\d{3,4}[\s.-]?\d{3,4}/;
const NEAR_ME = /\b(near me|nearby|near by|close to me)\b/;

/**
 * A query safe to show and to hand to a model as data, or null to drop it.
 * Angle brackets become spaces so a query like `</website><system>` can't close
 * or open a wrapper in the understanding digest.
 */
export function sanitizeSearchQuery(q: string): string | null {
  if (typeof q !== "string") return null;
  const cleaned = q.replace(CONTROL, " ").replace(/[<>]/g, " ").replace(/\s+/g, " ").trim();
  if (!cleaned || cleaned.length > MAX_QUERY_LENGTH) return null;
  if (EMAIL.test(cleaned) || URLISH.test(cleaned) || LONG_DIGITS.test(cleaned) || PHONE.test(cleaned)) return null;
  return cleaned;
}

function sum(rows: Array<{ impressions: number }>): number {
  return rows.reduce((total, row) => total + row.impressions, 0);
}

function sumClicks(rows: Array<{ clicks: number }>): number {
  return rows.reduce((total, row) => total + row.clicks, 0);
}

function ratio(part: number, whole: number): number {
  return whole > 0 ? Math.min(1, Math.max(0, part / whole)) : 0;
}

function round(value: number, digits = 4): number {
  const factor = 10 ** digits;
  return Math.round(value * factor) / factor;
}

function byDemand<T extends { clicks: number; impressions: number }>(a: T, b: T): number {
  return b.clicks - a.clicks || b.impressions - a.impressions;
}

function tokenList(value: string): string[] {
  const normalized = normalizeSearchText(value);
  return normalized ? normalized.split(" ") : [];
}

function containsTokens(haystack: string[], needle: string[]): boolean {
  if (needle.length === 0 || needle.length > haystack.length) return false;
  for (let start = 0; start + needle.length <= haystack.length; start += 1) {
    if (needle.every((token, index) => haystack[start + index] === token)) return true;
  }
  return false;
}

/** Hygiene-filtered query rows; the first spelling wins when two rows sanitise to the same text. */
function cleanQueries(rows: GscMetricRow[]): GscMetricRow[] {
  const seen = new Map<string, GscMetricRow>();
  for (const row of rows) {
    const query = sanitizeSearchQuery(row.key);
    if (!query) continue;
    const existing = seen.get(query);
    if (existing) {
      existing.clicks += row.clicks;
      existing.impressions += row.impressions;
    } else {
      seen.set(query, { ...row, key: query });
    }
  }
  return [...seen.values()];
}

interface PreparedPlace {
  name: string;
  level: keyof PlaceLevelMix;
  tokens: string[];
}

function preparePlaces(places: SignalsContext["places"]): PreparedPlace[] {
  const seen = new Set<string>();
  const prepared: PreparedPlace[] = [];
  for (const place of places) {
    const tokens = tokenList(place.name);
    const key = `${place.level}:${tokens.join(" ")}`;
    if (tokens.length === 0 || seen.has(key)) continue;
    seen.add(key);
    prepared.push({ name: place.name, level: place.level, tokens });
  }
  return prepared;
}

function placeMatches(query: string, places: PreparedPlace[]): { names: string[]; levels: Set<keyof PlaceLevelMix>; foreignCountries: string[] } {
  const queryTokens = tokenList(query);
  const names: string[] = [];
  const levels = new Set<keyof PlaceLevelMix>();
  for (const place of places) {
    if (containsTokens(queryTokens, place.tokens)) {
      names.push(place.name);
      levels.add(place.level);
    }
  }
  const knownCountryNames = new Set(places.filter((place) => place.level === "country").map((place) => place.tokens.join(" ")));
  const foreignCountries: string[] = [];
  for (const code of countryCodesMentioned(query)) {
    const name = countryName(code);
    if (!name) continue;
    if (knownCountryNames.has(tokenList(name).join(" "))) continue;
    levels.add("country");
    foreignCountries.push(name);
  }
  if (NEAR_ME.test(normalizeSearchText(query))) levels.add("nearMe");
  return { names, levels, foreignCountries };
}

function hostOf(url: string): string | null {
  try {
    return new URL(url).hostname.toLowerCase().replace(/^www\./, "");
  } catch {
    return null;
  }
}

function samesite(url: string, domain: string, pageFilter: RegExp | null): boolean {
  const host = hostOf(url);
  const bare = domain.trim().toLowerCase().replace(/^www\./, "");
  if (!host || !bare) return false;
  if (host !== bare && !host.endsWith(`.${bare}`)) return false;
  return pageFilter ? pageFilter.test(url) : true;
}

function compilePageFilter(pattern: string | null): RegExp | null {
  if (!pattern) return null;
  try {
    return new RegExp(pattern, "i");
  } catch {
    return null;
  }
}

export function buildSearchConsoleSignals(snapshot: GscSnapshot, ctx: SignalsContext): SearchConsoleSignals {
  const terms = brandTerms({ brandName: ctx.brandName, aliases: ctx.aliases, domain: ctx.domain });
  const visibleQueryImpressions = sum(snapshot.queries);
  const queries = cleanQueries(snapshot.queries);
  const split = splitBrandQueries(queries, terms, ctx.offeringVocabulary);

  const brandedClicks = sumClicks(split.branded);
  const nonBrandClicks = sumClicks(split.nonBrand);
  const brandedImpressions = sum(split.branded);
  const nonBrandImpressions = sum(split.nonBrand);

  const places = preparePlaces(ctx.places);
  const nonBrandQueries = [...split.nonBrand]
    .sort((a, b) => b.impressions - a.impressions || b.clicks - a.clicks)
    .slice(0, MAX_NON_BRAND)
    .map((row) => {
      const match = placeMatches(row.key, places);
      return { query: row.key, clicks: row.clicks, impressions: row.impressions, position: round(row.position, 2), placeMentions: match.names, nearMe: match.levels.has("nearMe") };
    });

  // Place mix reads query rows inside the top country when Google returned them:
  // place names are local to that country, and foreign traffic only dilutes them.
  const primary = cleanQueries(snapshot.primaryCountryQueries);
  const mixRows = primary.length > 0 ? splitBrandQueries(primary, terms, ctx.offeringVocabulary).nonBrand : split.nonBrand;
  const mixBase = sum(mixRows);
  const levelImpressions: PlaceLevelMix = { neighborhood: 0, nearby: 0, city: 0, region: 0, country: 0, nearMe: 0 };
  let placeBearingImpressions = 0;
  const unmatched = new Map<string, number>();
  for (const row of mixRows) {
    const match = placeMatches(row.key, places);
    if (match.levels.size === 0) continue;
    placeBearingImpressions += row.impressions;
    for (const level of match.levels) levelImpressions[level] += row.impressions;
    for (const name of match.foreignCountries) unmatched.set(name, (unmatched.get(name) ?? 0) + row.impressions);
  }
  const mix = Object.fromEntries(Object.entries(levelImpressions).map(([level, impressions]) => [level, round(ratio(impressions, mixBase))])) as unknown as PlaceLevelMix;

  const countryTotals = new Map<string, { clicks: number; impressions: number }>();
  for (const row of snapshot.countries) {
    const code = alpha2FromAlpha3(row.key);
    if (!code) continue;
    const entry = countryTotals.get(code) ?? { clicks: 0, impressions: 0 };
    entry.clicks += row.clicks;
    entry.impressions += row.impressions;
    countryTotals.set(code, entry);
  }
  // Unknown regions ("zzz") stay in the denominator: a share is of all impressions.
  const countryBase = sum(snapshot.countries) || snapshot.totals.impressions;
  const countries = [...countryTotals.entries()]
    .map(([countryCode, totals]) => ({ countryCode, clicks: totals.clicks, impressions: totals.impressions, share: round(ratio(totals.impressions, countryBase)) }))
    .sort((a, b) => b.impressions - a.impressions || b.clicks - a.clicks)
    .slice(0, MAX_COUNTRIES);

  const pageFilter = compilePageFilter(snapshot.pageFilter);
  const topPages = snapshot.pages
    .filter((row) => samesite(row.key, ctx.domain, pageFilter))
    .map((row) => ({ url: row.key, clicks: row.clicks, impressions: row.impressions }))
    .sort(byDemand)
    .slice(0, MAX_TOP_PAGES);

  let insufficientReason: string | null = null;
  if (nonBrandImpressions < MIN_NON_BRAND_IMPRESSIONS) insufficientReason = `Fewer than ${MIN_NON_BRAND_IMPRESSIONS} non-brand search impressions in this period.`;
  else if (queries.length < MIN_VISIBLE_QUERIES) insufficientReason = `Fewer than ${MIN_VISIBLE_QUERIES} visible search queries in this period.`;

  const brandDenominatorClicks = brandedClicks + nonBrandClicks;
  const brandDenominatorImpressions = brandedImpressions + nonBrandImpressions;

  return {
    siteUrl: snapshot.siteUrl,
    startDate: snapshot.startDate,
    endDate: snapshot.endDate,
    sufficient: insufficientReason === null,
    insufficientReason,
    totals: {
      clicks: snapshot.totals.clicks,
      impressions: snapshot.totals.impressions,
      visibleQueryImpressions,
      // Google leaves rare and sensitive queries out of query rows but counts them in totals.
      anonymizedShare: round(snapshot.totals.impressions > 0 ? ratio(snapshot.totals.impressions - visibleQueryImpressions, snapshot.totals.impressions) : 0),
    },
    brand: {
      terms,
      // Ambiguous queries sit out of both sides of the share.
      brandedClickShare: brandDenominatorClicks > 0 ? round(brandedClicks / brandDenominatorClicks) : null,
      brandedImpressionShare: brandDenominatorImpressions > 0 ? round(brandedImpressions / brandDenominatorImpressions) : null,
      ambiguousImpressionShare: round(ratio(sum(split.ambiguous), sum(queries))),
      topBranded: [...split.branded].sort(byDemand).slice(0, MAX_TOP_BRANDED).map((row) => ({ query: row.key, clicks: row.clicks, impressions: row.impressions })),
    },
    nonBrandQueries,
    countries,
    placeDemand: {
      placeBearingImpressions,
      mix,
      unmatchedPlaceMentions: [...unmatched.entries()].sort((a, b) => b[1] - a[1]).slice(0, MAX_UNMATCHED_PLACES).map(([name]) => name),
    },
    topPages,
    fetchedAt: snapshot.fetchedAt,
  };
}

// ---------------------------------------------------------------------------
// Offering demand
// ---------------------------------------------------------------------------

function stem(token: string): string {
  if (token.length > 4 && token.endsWith("ies")) return `${token.slice(0, -3)}y`;
  if (token.length > 5 && token.endsWith("ing")) return token.slice(0, -3);
  if (token.length > 4 && /(ches|shes|xes|sses)$/.test(token)) return token.slice(0, -2);
  if (token.length > 3 && token.endsWith("s") && !token.endsWith("ss")) return token.slice(0, -1);
  return token;
}

function contentTokens(value: string): Set<string> {
  return new Set(tokenList(value).filter((token) => token.length >= 3 && !/^\d+$/.test(token)).map(stem));
}

/**
 * Share of visible non-brand impressions per offering. A query goes to the
 * offering whose content words it shares best (Jaccard ≥ 0.5, or it contains
 * every word of the offering). Queries that match nothing are simply not
 * counted: search demand never invents an offering.
 */
export function demandByOffering(queries: SearchConsoleSignals["nonBrandQueries"], offerings: string[]): SearchConsoleProfileSummary["demandByOffering"] {
  const prepared: Array<{ offering: string; tokens: Set<string> }> = [];
  const seen = new Set<string>();
  for (const offering of offerings) {
    const tokens = contentTokens(offering);
    const key = [...tokens].sort().join(" ");
    if (tokens.size === 0 || seen.has(key)) continue;
    seen.add(key);
    prepared.push({ offering, tokens });
  }
  const base = sum(queries);
  const totals = new Map<string, { clicks: number; impressions: number; examples: Array<{ query: string; impressions: number }> }>();
  for (const query of queries) {
    const tokens = contentTokens(query.query);
    if (tokens.size === 0) continue;
    let best: { offering: string; score: number } | null = null;
    for (const candidate of prepared) {
      let shared = 0;
      for (const token of candidate.tokens) if (tokens.has(token)) shared += 1;
      if (shared === 0) continue;
      const jaccard = shared / (tokens.size + candidate.tokens.size - shared);
      const containment = shared === candidate.tokens.size;
      if (jaccard < 0.5 && !containment) continue;
      const score = jaccard + (containment ? 1 : 0) + candidate.tokens.size * 0.001;
      if (!best || score > best.score) best = { offering: candidate.offering, score };
    }
    if (!best) continue;
    const entry = totals.get(best.offering) ?? { clicks: 0, impressions: 0, examples: [] };
    entry.clicks += query.clicks;
    entry.impressions += query.impressions;
    entry.examples.push({ query: query.query, impressions: query.impressions });
    totals.set(best.offering, entry);
  }
  return [...totals.entries()]
    .map(([offering, entry]) => ({
      offering,
      share: round(ratio(entry.impressions, base)),
      clicks: entry.clicks,
      impressions: entry.impressions,
      exampleQueries: entry.examples.sort((a, b) => b.impressions - a.impressions).slice(0, MAX_EXAMPLES).map((example) => example.query),
    }))
    .filter((entry) => entry.impressions > 0)
    .sort((a, b) => b.impressions - a.impressions || b.clicks - a.clicks)
    .slice(0, MAX_OFFERINGS);
}

export function summarizeForProfile(signals: SearchConsoleSignals, match: GscPropertyMatch, offerings: string[], rawEvidenceHash: string | null): SearchConsoleProfileSummary {
  const modifierWeights = new Map<string, number>();
  for (const row of signals.brand.topBranded) {
    for (const token of new Set(brandModifierTokens(row.query, signals.brand.terms))) {
      modifierWeights.set(token, (modifierWeights.get(token) ?? 0) + Math.max(1, row.impressions));
    }
  }
  return {
    source: "google_search_console",
    policyVersion: GSC_SIGNALS_POLICY_VERSION,
    siteUrl: signals.siteUrl,
    matchReason: match.matchReason,
    pageFilter: match.pageFilter,
    startDate: signals.startDate,
    endDate: signals.endDate,
    fetchedAt: signals.fetchedAt ?? Date.now(),
    sufficient: signals.sufficient,
    totals: { clicks: signals.totals.clicks, impressions: signals.totals.impressions, anonymizedShare: signals.totals.anonymizedShare },
    brandedClickShare: signals.brand.brandedClickShare,
    brandedImpressionShare: signals.brand.brandedImpressionShare,
    topNonBrandQueries: [...signals.nonBrandQueries].sort(byDemand).slice(0, MAX_SUMMARY_QUERIES).map((row) => ({ query: row.query, clicks: row.clicks, impressions: row.impressions })),
    brandedModifiers: [...modifierWeights.entries()].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0])).slice(0, MAX_MODIFIERS).map(([token]) => token),
    demandByOffering: demandByOffering(signals.nonBrandQueries, offerings),
    countries: signals.countries.slice(0, MAX_SUMMARY_COUNTRIES).map((country) => ({ countryCode: country.countryCode, share: country.share })),
    placeDemand: { placeBearingImpressions: signals.placeDemand.placeBearingImpressions, mix: signals.placeDemand.mix },
    topPages: signals.topPages.slice(0, MAX_SUMMARY_PAGES).map((page) => ({ url: page.url, clicks: page.clicks })),
    rawEvidenceHash,
  };
}
