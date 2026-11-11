// Country resolution over the ISO 3166-1 list.
//
// The previous market resolver carried 32 countries; a business anywhere else
// had no country at all. Names still come from the platform's own Unicode CLDR
// data via `Intl.DisplayNames`, but WHICH codes exist comes from the fixed ISO
// list in `iso3166.ts`: scanning AA..ZZ picked up deprecated codes whose CLDR
// names shadowed the real ones, so "United Kingdom" resolved to UK, "France"
// to FX and "Serbia" to YU, and a .co.uk salon showed a GB/UK conflict. The
// only hand-written data here is what CLDR cannot know: common short names
// people write on websites ("UAE", "KSA", "USA"), ccTLDs that are sold as
// vanity domains rather than used as country signals, and currencies.
//
// Client-safe: no server imports.

import { ISO_COUNTRIES } from "./iso3166";

const REGION_NAMES = typeof Intl !== "undefined" && "DisplayNames" in Intl ? new Intl.DisplayNames(["en"], { type: "region" }) : null;

let codeToName: Map<string, string> | null = null;
let nameToCode: Map<string, string> | null = null;

function normalizeName(value: string): string {
  return value
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/&/g, " and ")
    .replace(/[^a-z0-9]+/g, " ")
    .replace(/\bthe\b/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

/** Short names and historical names that CLDR does not return for "en". */
const ALIASES: Record<string, string> = {
  uae: "AE",
  "u a e": "AE",
  emirates: "AE",
  "united arab emirates": "AE",
  ksa: "SA",
  saudi: "SA",
  "kingdom of saudi arabia": "SA",
  usa: "US",
  "u s a": "US",
  us: "US",
  "u s": "US",
  "united states of america": "US",
  america: "US",
  uk: "GB",
  "u k": "GB",
  "great britain": "GB",
  britain: "GB",
  england: "GB",
  scotland: "GB",
  wales: "GB",
  "northern ireland": "GB",
  holland: "NL",
  "czech republic": "CZ",
  turkey: "TR",
  turkiye: "TR",
  "south korea": "KR",
  korea: "KR",
  "republic of korea": "KR",
  russia: "RU",
  vietnam: "VN",
  "viet nam": "VN",
  "ivory coast": "CI",
  "cote d ivoire": "CI",
  macau: "MO",
  "hong kong sar": "HK",
  burma: "MM",
  swaziland: "SZ",
  "cape verde": "CV",
  "east timor": "TL",
  "the netherlands": "NL",
  "the philippines": "PH",
  bharat: "IN",
  macedonia: "MK",
  vatican: "VA",
  "dr congo": "CD",
  drc: "CD",
};

function displayName(names: Intl.DisplayNames | null, code: string): string | null {
  let name: string | undefined;
  try {
    name = names?.of(code);
  } catch {
    name = undefined;
  }
  // DisplayNames echoes unknown codes back unchanged; real regions get a name.
  if (!name || name === code || /^Unknown/i.test(name)) return null;
  return name;
}

function buildTables(): void {
  if (codeToName && nameToCode) return;
  codeToName = new Map();
  nameToCode = new Map();
  for (const country of ISO_COUNTRIES) {
    const name = displayName(REGION_NAMES, country.a2) ?? country.name;
    codeToName.set(country.a2, name);
    nameToCode.set(normalizeName(name), country.a2);
  }
  // ISO short names that differ from CLDR ("Holy See", "Cabo Verde", "Hong
  // Kong", "Myanmar") also resolve, without displacing a CLDR name.
  for (const country of ISO_COUNTRIES) {
    const key = normalizeName(country.name);
    if (key && !nameToCode.has(key)) nameToCode.set(key, country.a2);
  }
  for (const [alias, code] of Object.entries(ALIASES)) nameToCode.set(normalizeName(alias), code);
}

export function countryName(code: string | null | undefined): string | null {
  if (!code) return null;
  buildTables();
  return codeToName!.get(code.toUpperCase()) ?? null;
}

/** Resolves "AE", "UAE", "United Arab Emirates", "Emirates" → "AE". */
export function countryCodeFrom(value: string | null | undefined): string | null {
  if (!value) return null;
  const trimmed = value.trim();
  if (!trimmed) return null;
  buildTables();
  if (/^[A-Za-z]{2}$/.test(trimmed)) {
    const upper = trimmed.toUpperCase();
    if (codeToName!.has(upper)) return upper;
    // Two-letter words like "uk" are aliases, not ISO codes.
    return nameToCode!.get(normalizeName(trimmed)) ?? null;
  }
  return nameToCode!.get(normalizeName(trimmed)) ?? null;
}

export interface CountryOption {
  /** ISO 3166-1 alpha-2, upper-case. */
  code: string;
  /** Display name in the requested locale (English short name when Intl is unavailable). */
  name: string;
  /** Folded names, codes and aliases to match typed text against (see `foldCountrySearchText`). */
  searchKeys: string[];
}

/**
 * Lower-cases, folds diacritics and turns punctuation into single spaces, so
 * "cote" matches Côte d’Ivoire and "aland" matches Åland Islands. Unlike the
 * resolver's normaliser it keeps "the", so prefix typing behaves predictably.
 */
export function foldCountrySearchText(value: string): string {
  return value
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/&/g, " and ")
    .replace(/[^a-z0-9]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

const optionsByLocale = new Map<string, CountryOption[]>();

/** Every ISO country plus Kosovo (250), sorted by display name, for the intake country picker. */
export function countryOptions(locale = "en"): CountryOption[] {
  const cached = optionsByLocale.get(locale);
  if (cached) return cached;
  buildTables();
  let names: Intl.DisplayNames | null = null;
  try {
    names = typeof Intl !== "undefined" && "DisplayNames" in Intl ? new Intl.DisplayNames([locale], { type: "region" }) : null;
  } catch {
    names = null;
  }
  const aliasesByCode = new Map<string, string[]>();
  for (const [alias, code] of Object.entries(ALIASES)) aliasesByCode.set(code, [...(aliasesByCode.get(code) ?? []), alias]);
  const options = ISO_COUNTRIES.map((country) => {
    const name = displayName(names, country.a2) ?? country.name;
    const keys = [name, country.name, codeToName!.get(country.a2) ?? "", country.a2, country.a3, ...(aliasesByCode.get(country.a2) ?? [])]
      .map(foldCountrySearchText)
      .filter(Boolean);
    return { code: country.a2, name, searchKeys: [...new Set(keys)] };
  });
  let collator: Intl.Collator | null = null;
  try {
    collator = new Intl.Collator(locale, { sensitivity: "base" });
  } catch {
    collator = null;
  }
  options.sort((a, b) => (collator ? collator.compare(a.name, b.name) : a.name.localeCompare(b.name)));
  optionsByLocale.set(locale, options);
  return options;
}

// Country names that take a definite article in running English: "in the
// United Arab Emirates", "in the Philippines", but "in Germany". Grammar only,
// not a country list.
const ARTICLE_PREFIX = /^(united|republic|kingdom|netherlands|philippines|bahamas|gambia|maldives|czech|dominican republic|central african|holy see)\b/i;
const ARTICLE_SUFFIX = /\b(islands|emirates|states|territories|territory|netherlands)$/i;

/** "United Arab Emirates" → "the United Arab Emirates"; "Germany" → "Germany". For mid-sentence use. */
export function countryPhrase(name: string): string {
  const trimmed = (name ?? "").trim();
  if (!trimmed) return "";
  if (/^the\s/i.test(trimmed)) return trimmed;
  return ARTICLE_PREFIX.test(trimmed) || ARTICLE_SUFFIX.test(trimmed) ? `the ${trimmed}` : trimmed;
}

/** Finds any country named inside free text ("… Sheikh Zayed Road, Dubai, UAE"). */
export function countryCodesMentioned(text: string): string[] {
  buildTables();
  const normalized = ` ${normalizeName(text)} `;
  const found = new Set<string>();
  for (const [name, code] of nameToCode!) {
    // Two-letter aliases ("us", "uk") collide with ordinary words; only
    // longer names are matched inside prose.
    // Three-letter aliases count only when written as an acronym ("UAE",
    // "USA"), so the word "usa" in another language does not.
    if (name.length === 3 && /^[a-z]+$/.test(name)) {
      if (new RegExp(`(^|[^A-Za-z])${name.toUpperCase()}([^A-Za-z]|$)`).test(text)) found.add(code);
      continue;
    }
    if (name.length < 4) continue;
    if (normalized.includes(` ${name} `)) found.add(code);
  }
  return [...found];
}

/**
 * ccTLDs sold as vanity/generic domains. `.io` is not evidence of the British
 * Indian Ocean Territory and `.ai` is not evidence of Anguilla.
 */
const VANITY_CCTLDS = new Set(["io", "ai", "co", "me", "tv", "fm", "ly", "gg", "to", "sh", "ac", "cc", "ws", "la", "vc", "am", "ag", "sc", "so", "st", "tk", "ml", "ga", "cf", "gq", "nu", "md", "gl", "im", "lc", "bz", "mu", "cx", "pw", "vg"]);

/** Country implied by the site's ccTLD, or null for gTLDs and vanity ccTLDs. */
export function countryCodeFromHostname(hostname: string): string | null {
  const last = hostname.toLowerCase().split(".").filter(Boolean).at(-1);
  if (!last || last.length !== 2) return null;
  if (VANITY_CCTLDS.has(last)) return null;
  if (last === "uk") return "GB";
  if (last === "eu") return null;
  buildTables();
  const upper = last.toUpperCase();
  return codeToName!.has(upper) ? upper : null;
}

/**
 * Currencies that identify one country. USD and EUR are deliberately absent:
 * they are priced in by businesses everywhere and say little about location.
 */
const CURRENCY_COUNTRY: Record<string, string> = {
  AED: "AE",
  SAR: "SA",
  QAR: "QA",
  KWD: "KW",
  BHD: "BH",
  OMR: "OM",
  JOD: "JO",
  EGP: "EG",
  MAD: "MA",
  INR: "IN",
  PKR: "PK",
  LKR: "LK",
  BDT: "BD",
  NPR: "NP",
  GBP: "GB",
  SGD: "SG",
  MYR: "MY",
  IDR: "ID",
  PHP: "PH",
  THB: "TH",
  VND: "VN",
  KRW: "KR",
  JPY: "JP",
  CNY: "CN",
  HKD: "HK",
  TWD: "TW",
  AUD: "AU",
  NZD: "NZ",
  CAD: "CA",
  MXN: "MX",
  BRL: "BR",
  ARS: "AR",
  CLP: "CL",
  COP: "CO",
  PEN: "PE",
  ZAR: "ZA",
  NGN: "NG",
  KES: "KE",
  GHS: "GH",
  TRY: "TR",
  ILS: "IL",
  CHF: "CH",
  SEK: "SE",
  NOK: "NO",
  DKK: "DK",
  PLN: "PL",
  CZK: "CZ",
  HUF: "HU",
  RON: "RO",
  UAH: "UA",
  RUB: "RU",
};

const CURRENCY_SYMBOLS: Array<{ test: RegExp; code: string }> = [
  { test: /₹|\bRs\.?\s?\d/, code: "INR" },
  { test: /£/, code: "GBP" },
  { test: /\bد\.?إ\b|\bDhs?\.?\s?\d/i, code: "AED" },
  { test: /\bS\$\s?\d/, code: "SGD" },
  { test: /\bA\$\s?\d/, code: "AUD" },
  { test: /\bC\$\s?\d/, code: "CAD" },
  { test: /\bRM\s?\d/, code: "MYR" },
  { test: /₩/, code: "KRW" },
  { test: /₺/, code: "TRY" },
  { test: /₦/, code: "NGN" },
  { test: /₱/, code: "PHP" },
  { test: /฿/, code: "THB" },
];

/** Country implied by a currency token ("AED 105", "Currency: ₹ 1,299"), or null. */
export function countryCodeFromCurrency(text: string): string | null {
  const iso = text.toUpperCase().match(/\b([A-Z]{3})\b/g) ?? [];
  for (const token of iso) {
    const code = CURRENCY_COUNTRY[token];
    if (code) return code;
  }
  for (const symbol of CURRENCY_SYMBOLS) {
    if (symbol.test.test(text)) return CURRENCY_COUNTRY[symbol.code] ?? null;
  }
  return null;
}

/** Currency ISO code used in a country, for prompt budget phrasing. */
export function currencyForCountry(countryCode: string | null | undefined): string | null {
  if (!countryCode) return null;
  const upper = countryCode.toUpperCase();
  if (upper === "US") return "USD";
  const euro = ["DE", "FR", "ES", "IT", "NL", "BE", "AT", "IE", "PT", "FI", "GR", "LU", "SK", "SI", "EE", "LV", "LT", "MT", "CY", "HR"];
  if (euro.includes(upper)) return "EUR";
  const entry = Object.entries(CURRENCY_COUNTRY).find(([, code]) => code === upper);
  return entry?.[0] ?? null;
}
