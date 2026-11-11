// Splits Search Console queries into branded, non-brand and ambiguous.
//
// Google's branded-query filter is a Performance-report UI feature with no API
// dimension, so the split runs here. Brand terms come only from this business's
// own names and domain (no brand lists). Matching works on a normalised,
// "squashed" form so "studio9", "studio 9" and "Stüdio-9" agree, and
// tolerates one typo for longer names, because searchers misspell brands.
//
// A short one-word brand that is also a word the site uses for what it sells
// (a salon called "Glow" that sells glow facials) can't be told apart from
// category demand, so those queries are marked ambiguous and left out of both
// shares rather than inflating brand awareness.
//
// Pure and client-safe.

import { parse as parseTld } from "tldts";
import { shortNameForms, spokenName } from "@/lib/landscape/name-forms";

const MIN_CONTAINS_LENGTH = 6;
const MIN_TERM_LENGTH = 4;
const MIN_TYPO_LENGTH = 6;
const AMBIGUOUS_MAX_LENGTH = 6;

/** NFKD, diacritics stripped, lower-case, anything but letters and digits becomes a space. */
export function normalizeSearchText(value: string): string {
  return value
    .normalize("NFKD")
    .replace(/\p{M}+/gu, "")
    .toLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, " ")
    .trim()
    .replace(/\s+/g, " ");
}

export function squash(value: string): string {
  return normalizeSearchText(value).replace(/ /g, "");
}

function tokens(value: string): string[] {
  const normalized = normalizeSearchText(value);
  return normalized ? normalized.split(" ") : [];
}

/** "studio9" for "www.studio9.co.uk"; falls back to the label before the last dot for hosts outside the public suffix list. */
export function domainLabel(domain: string): string {
  const host = domain.trim().toLowerCase().replace(/^[a-z][a-z0-9+.-]*:\/\//, "").split(/[/?#]/)[0]?.replace(/^www\./, "") ?? "";
  const parsed = parseTld(host, { allowPrivateDomains: true });
  if (parsed.domainWithoutSuffix) return parsed.domainWithoutSuffix;
  const labels = host.split(".").filter(Boolean);
  return labels.length >= 2 ? labels[labels.length - 2]! : host;
}

/** The business's own name forms, normalised and de-duplicated, longest first. */
export function brandTerms(input: { brandName: string; aliases: string[]; domain: string }): string[] {
  const raw: string[] = [input.brandName, ...input.aliases];
  const domain = input.domain.trim().toLowerCase().replace(/^[a-z][a-z0-9+.-]*:\/\//, "").split(/[/?#]/)[0]?.replace(/^www\./, "") ?? "";
  if (input.brandName.trim()) {
    raw.push(...shortNameForms(input.brandName, [domain]), spokenName(input.brandName, [domain]));
  }
  if (domain) {
    const parsed = parseTld(domain, { allowPrivateDomains: true });
    raw.push(parsed.domain ?? domain, domainLabel(domain));
  }
  const seen = new Set<string>();
  const terms: string[] = [];
  for (const value of raw) {
    const normalized = normalizeSearchText(value ?? "");
    const key = normalized.replace(/ /g, "");
    if (key.length < MIN_TERM_LENGTH || seen.has(key)) continue;
    seen.add(key);
    terms.push(normalized);
  }
  return terms.sort((a, b) => squash(b).length - squash(a).length);
}

/** Optimal string alignment distance, stopping early once it exceeds `max`. */
function editDistanceWithin(a: string, b: string, max: number): boolean {
  if (Math.abs(a.length - b.length) > max) return false;
  const rows = a.length + 1;
  const cols = b.length + 1;
  const d: number[][] = Array.from({ length: rows }, (_, i) => Array.from({ length: cols }, (_, j) => (i === 0 ? j : j === 0 ? i : 0)));
  for (let i = 1; i < rows; i += 1) {
    let rowMin = Infinity;
    for (let j = 1; j < cols; j += 1) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      let value = Math.min(d[i - 1]![j]! + 1, d[i]![j - 1]! + 1, d[i - 1]![j - 1]! + cost);
      if (i > 1 && j > 1 && a[i - 1] === b[j - 2] && a[i - 2] === b[j - 1]) value = Math.min(value, d[i - 2]![j - 2]! + 1);
      d[i]![j] = value;
      rowMin = Math.min(rowMin, value);
    }
    if (rowMin > max) return false;
  }
  return d[a.length]![b.length]! <= max;
}

interface PreparedTerm {
  squashed: string;
  tokenCount: number;
  ambiguous: boolean;
}

function prepareTerms(terms: string[], offeringVocabulary: string[]): PreparedTerm[] {
  const vocabulary = new Set(offeringVocabulary.flatMap((entry) => tokens(entry)));
  return terms
    .map((term) => {
      const termTokens = tokens(term);
      const squashed = termTokens.join("");
      return { squashed, tokenCount: termTokens.length, ambiguous: termTokens.length === 1 && squashed.length < AMBIGUOUS_MAX_LENGTH && vocabulary.has(squashed) };
    })
    .filter((term) => term.squashed.length >= MIN_TERM_LENGTH);
}

function matchesTerm(queryTokens: string[], querySquashed: string, term: PreparedTerm): boolean {
  // Long names match anywhere in the squashed query ("studio9salon").
  if (term.squashed.length >= MIN_CONTAINS_LENGTH && querySquashed.includes(term.squashed)) return true;
  // Short names must line up with whole words, or "vela" would match "novelas".
  const maxWindow = Math.min(queryTokens.length, term.tokenCount + 1);
  for (let size = 1; size <= maxWindow; size += 1) {
    for (let start = 0; start + size <= queryTokens.length; start += 1) {
      const window = queryTokens.slice(start, start + size).join("");
      if (window === term.squashed) return true;
      if (term.squashed.length >= MIN_TYPO_LENGTH && window.length >= MIN_TYPO_LENGTH - 1 && editDistanceWithin(window, term.squashed, 1)) return true;
    }
  }
  return false;
}

export type BrandClass = "branded" | "non_brand" | "ambiguous";

/** Classifies one query against prepared terms; a clear brand match wins over an ambiguous one. */
export function classifyQuery(query: string, terms: string[], offeringVocabulary: string[]): BrandClass {
  return classifyWith(query, prepareTerms(terms, offeringVocabulary));
}

function classifyWith(query: string, prepared: PreparedTerm[]): BrandClass {
  const queryTokens = tokens(query);
  const querySquashed = queryTokens.join("");
  let ambiguous = false;
  for (const term of prepared) {
    if (!matchesTerm(queryTokens, querySquashed, term)) continue;
    if (!term.ambiguous) return "branded";
    ambiguous = true;
  }
  return ambiguous ? "ambiguous" : "non_brand";
}

export function splitBrandQueries<Row extends { key: string }>(rows: Row[], terms: string[], offeringVocabulary: string[]): { branded: Row[]; nonBrand: Row[]; ambiguous: Row[] } {
  const prepared = prepareTerms(terms, offeringVocabulary);
  const split = { branded: [] as Row[], nonBrand: [] as Row[], ambiguous: [] as Row[] };
  for (const row of rows) {
    const kind = classifyWith(row.key, prepared);
    if (kind === "branded") split.branded.push(row);
    else if (kind === "ambiguous") split.ambiguous.push(row);
    else split.nonBrand.push(row);
  }
  return split;
}

/** Words searchers add to the brand name ("prices", "reviews", "vs"), with the brand's own words removed. */
export function brandModifierTokens(query: string, terms: string[]): string[] {
  const termTokens = new Set(terms.flatMap((term) => tokens(term)));
  const termSquashed = terms.map((term) => squash(term));
  return tokens(query).filter((token) => {
    if (token.length < 2 || /^\d+$/.test(token) || termTokens.has(token)) return false;
    // A misspelt brand word ("studo" for "studio") isn't a modifier either.
    if (token.length >= 4 && [...termTokens].some((word) => word.length >= 5 && editDistanceWithin(token, word, 1))) return false;
    // A token that is the brand glued to something else ("studio9downtown") isn't a modifier.
    return !termSquashed.some((term) => term.length >= MIN_TERM_LENGTH && (token.includes(term) || (term.length >= MIN_TYPO_LENGTH && editDistanceWithin(token, term, 1))));
  });
}
