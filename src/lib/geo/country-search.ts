// Options and type-ahead ranking for the intake "Where are your customers?"
// country picker.
//
// A native <select> was rejected: the operator asked for a searchable list of
// every country, and first-letter type-ahead over 250 names is unusable. Typed
// text is folded the same way as `countryOptions().searchKeys`, so "cote"
// finds Côte d'Ivoire and "uae" finds the United Arab Emirates; an exact code
// or alias ranks first so "uk" lands on the United Kingdom, not Ukraine.
//
// Client-safe and pure.

import { countryOptions, foldCountrySearchText } from "./countries";

/** "auto" = detect from the website (no hint); "worldwide"; or an ISO alpha-2 code. */
export type CountryChoice = string;

export const DETECT_CHOICE = "auto";
export const WORLDWIDE_CHOICE = "worldwide";

export interface CountryPickerOption {
  value: CountryChoice;
  label: string;
  /** Secondary line, special options only. */
  description: string | null;
  kind: "special" | "country";
  searchKeys: string[];
}

const SPECIAL_OPTIONS: CountryPickerOption[] = [
  {
    value: DETECT_CHOICE,
    label: "Detect from my website",
    description: "From your address, phone and domain",
    kind: "special",
    searchKeys: ["detect from my website"],
  },
  {
    value: WORLDWIDE_CHOICE,
    label: "Worldwide / online",
    description: "Customers anywhere, e.g. an online store or software",
    kind: "special",
    searchKeys: ["worldwide online", "global", "online"],
  },
];

const byLocale = new Map<string, CountryPickerOption[]>();

/** Detect, Worldwide, then every ISO country plus Kosovo (252 options). */
export function countryPickerOptions(locale = "en"): CountryPickerOption[] {
  const cached = byLocale.get(locale);
  if (cached) return cached;
  const countries: CountryPickerOption[] = countryOptions(locale).map((option) => ({
    value: option.code,
    label: option.name,
    description: null,
    kind: "country",
    searchKeys: option.searchKeys,
  }));
  const all = [...SPECIAL_OPTIONS, ...countries];
  byLocale.set(locale, all);
  return all;
}

/** The option for a committed value, or null for an unknown value. */
export function countryPickerOption(value: CountryChoice, options: CountryPickerOption[] = countryPickerOptions()): CountryPickerOption | null {
  const upper = value.trim().toUpperCase();
  return options.find((option) => option.value === value || (option.kind === "country" && option.value === upper)) ?? null;
}

/**
 * 0 exact key (name, code or alias), 1 a key starts with the query, 2 every
 * typed word starts a word of one key, 3 substring; null = no match.
 */
export function countryMatchScore(option: Pick<CountryPickerOption, "searchKeys">, foldedQuery: string): number | null {
  const q = foldedQuery;
  if (!q) return 3;
  const tokens = q.split(" ");
  let best: number | null = null;
  for (const key of option.searchKeys) {
    let score: number | null = null;
    if (key === q) score = 0;
    else if (key.startsWith(q)) score = 1;
    else {
      const words = key.split(" ");
      if (tokens.every((token) => words.some((word) => word.startsWith(token)))) score = 2;
      else if (key.includes(q)) score = 3;
    }
    if (score !== null && (best === null || score < best)) best = score;
    if (best === 0) break;
  }
  return best;
}

/**
 * Filters and ranks options for typed text. An empty query returns every
 * option in list order. Special options stay at the top while they match;
 * countries follow by score, then alphabetically (the list order).
 */
export function searchCountryOptions(query: string, options: CountryPickerOption[] = countryPickerOptions()): CountryPickerOption[] {
  const folded = foldCountrySearchText(query);
  if (!folded) return options;
  const specials: CountryPickerOption[] = [];
  const scored: Array<{ option: CountryPickerOption; score: number; index: number }> = [];
  options.forEach((option, index) => {
    const score = countryMatchScore(option, folded);
    if (score === null) return;
    // A one-letter query matches half the list by substring; only prefixes count.
    if (folded.length < 2 && score > 2) return;
    if (option.kind === "special") {
      // "an" or "in" should not push Worldwide above Angola and India.
      if (score === 0 || (score <= 2 && folded.length >= 3)) specials.push(option);
    } else scored.push({ option, score, index });
  });
  scored.sort((a, b) => a.score - b.score || a.index - b.index);
  return [...specials, ...scored.map((entry) => entry.option)];
}

/** How many real countries (not the special options) are in a result list. */
export function countryResultCount(results: CountryPickerOption[]): number {
  return results.filter((option) => option.kind === "country").length;
}
