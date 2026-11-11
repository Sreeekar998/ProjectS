// Site digest: what the understanding model is allowed to read.
//
// The previous synthesis step saw 40 evidence snippets per field, truncated to
// 260 characters, with the rules-based guesses (including "archetype:
// healthcare") shown as a baseline to "correct only where the evidence
// disagrees". It never saw a services page as a page. The digest instead shows
// the model the site the way a person reads it — each important page's own
// text under a page id — plus the machine-readable facts (JSON-LD, addresses,
// phones, map and booking links) under fact ids. Both kinds of id resolve back
// to stored evidence items, so every claim stays traceable.
//
// Website text is untrusted. It is wrapped in <website> tags inside the user
// content, never in the system instruction, and any tag-like sequence that
// could close the wrapper is neutralised.
//
// Two inputs that are not website text sit outside the wrapper, still in the
// user content: what the operator said at intake about where customers are
// (one line; the hint itself is applied in code by resolveLocation), and, when
// Google Search Console is connected, aggregate search demand plus the
// non-brand queries people typed. Queries are untrusted too: they get their own
// wrapper, are neutralised the same way, and carry no ids, so the model cannot
// cite a search as evidence for an offering or an address.

import type { EvidenceItem } from "@/lib/evidence/types";
import type { PageType } from "@/lib/crawler/page-classifier";
import { countryCodeFromCurrency, countryCodeFromHostname, countryName } from "@/lib/geo/countries";
import { phoneCountry } from "@/lib/geo/phone";
import type { MarketHint } from "@/lib/projects/market-hint";
import type { SearchConsoleSignals } from "@/lib/search-console/types";

export interface DigestPageInput {
  pageId: string;
  url: string;
  pageType: PageType;
  title: string | null;
  mainText: string;
  headings: string[];
  navLabels: string[];
  /** 0–1 share of Google search clicks landing on this page; orders pages of the same type. */
  searchDemand?: number;
}

/** The operator's intake answer as the digest shows it. */
export interface DigestOperatorMarket {
  countries: string[];
  worldwide: boolean;
  /** The area as the operator picked or typed it. */
  area: string | null;
}

export interface DigestPage {
  ref: string;
  pageId: string;
  url: string;
  pageType: PageType;
  title: string | null;
  text: string;
}

export interface DigestFact {
  ref: string;
  evidenceId: string;
  pageId: string | null;
  text: string;
}

export interface SiteSignals {
  ccTldCountry: string | null;
  phoneCountries: Array<{ number: string; countryCode: string | null }>;
  currencyCountries: string[];
  bookingPlatforms: string[];
  htmlLangs: string[];
  hreflangCount: number;
  structuredBusinessTypes: string[];
}

export interface SiteDigest {
  rendered: string;
  pages: DigestPage[];
  facts: DigestFact[];
  pageByRef: Map<string, DigestPage>;
  factByRef: Map<string, DigestFact>;
  evidenceByPage: Map<string, EvidenceItem[]>;
  evidenceById: Map<string, EvidenceItem>;
  signals: SiteSignals;
  /** Every page's full digest text joined, for "is this claim anywhere on the site?" checks. */
  corpus: string;
}

/** Characters of page text shown per page type. Legal and careers pages add nothing here. */
const PAGE_BUDGET: Partial<Record<PageType, number>> = {
  home: 5200,
  about: 3800,
  service_index: 5200,
  // A menu is the whole offer of a restaurant: a 150-dish rendered menu is
  // about 15,000 characters, and 5,200 stopped at the section names.
  menu: 20_000,
  product_index: 4200,
  pricing: 4200,
  service: 3400,
  product: 2600,
  category: 2600,
  solution: 2600,
  industry: 2200,
  contact: 1800,
  location: 2200,
  store_locator: 2600,
  booking: 1600,
  faq: 2600,
  team: 1400,
  case_study: 1400,
  other: 2600,
  reviews: 900,
  gallery: 500,
  editorial: 1000,
  legal: 0,
  careers: 0,
};

const PAGE_ORDER: PageType[] = [
  "home",
  "about",
  "service_index",
  "menu",
  "product_index",
  "pricing",
  "service",
  "category",
  "solution",
  "industry",
  "product",
  "location",
  "store_locator",
  "contact",
  "booking",
  "faq",
  "other",
  "team",
  "case_study",
  "reviews",
  "editorial",
  "gallery",
  "legal",
  "careers",
];

const TOTAL_PAGE_CHARS = 72_000;
const MAX_FACTS = 140;

/** Fact-bearing evidence: structured data, addresses, phones, links, currencies, titles. */
function isFact(item: EvidenceItem): boolean {
  if (["jsonld", "microdata", "rdfa", "address", "phone", "currency", "url_signal"].includes(item.sourceType)) return true;
  if (item.sourceType === "meta" && /^(og:site_name|Page title|Geo meta):/.test(item.text)) return true;
  if (item.sourceType === "image_alt" && /^Logo alt text:/.test(item.text)) return true;
  return false;
}

/** Neutralises anything in untrusted text that could close or open our wrapper tags. */
export function sanitizeUntrusted(text: string): string {
  return text.replace(/<\s*\/?\s*(website|page|facts|signals|instructions|system|search_queries|query)\b/gi, (m) => m.replace("<", "‹"));
}

/** One line of untrusted text: control characters and newlines collapsed, capped, wrapper tags neutralised. */
function untrustedLine(text: string, max: number): string {
  return sanitizeUntrusted(text.replace(/[\u0000-\u001f\u007f]+/g, " ").replace(/\s+/g, " ").trim().slice(0, max));
}

/** Most queries a digest shows: ≈3K input tokens at typical query lengths. */
const MAX_DIGEST_QUERIES = 120;

export function operatorMarketFromHint(hint: MarketHint | null): DigestOperatorMarket | null {
  if (!hint) return null;
  return { countries: [...hint.countryCodes], worldwide: hint.worldwide, area: hint.area ? hint.area.place?.label || hint.area.query : null };
}

function urlKey(url: string): string | null {
  try {
    const parsed = new URL(url);
    return `${parsed.hostname.toLowerCase().replace(/^www\./, "")}${parsed.pathname.replace(/\/+$/, "")}`;
  } catch {
    return null;
  }
}

/** Annotates digest pages with their share of Search Console clicks (log-scaled against the top page). */
export function withSearchDemand(pages: DigestPageInput[], topPages: SearchConsoleSignals["topPages"]): DigestPageInput[] {
  const maxClicks = Math.max(0, ...topPages.map((p) => p.clicks));
  const byKey = new Map<string, number>();
  for (const page of topPages) {
    const key = urlKey(page.url);
    if (!key || maxClicks <= 0) continue;
    byKey.set(key, Math.max(byKey.get(key) ?? 0, Math.log1p(page.clicks) / Math.log1p(maxClicks)));
  }
  return pages.map((page) => {
    const key = urlKey(page.url);
    const demand = key ? byKey.get(key) : undefined;
    return demand === undefined ? page : { ...page, searchDemand: demand };
  });
}

function percent(share: number): string {
  return `${Math.round(share * 100)}%`;
}

function operatorLine(market: DigestOperatorMarket): string | null {
  const countries = market.countries.map((code) => countryName(code) ?? code);
  if (!market.worldwide && countries.length === 0) return null;
  const who = market.worldwide ? "customers all over the world" : `customers in ${countries.join(", ")}`;
  const area = market.area ? `; area: ${untrustedLine(market.area, 120)}` : "";
  return `- Stated by the business owner (reliable for where customers are; addresses must still come from the website): ${who}${area}`;
}

function searchConsoleLines(signals: SearchConsoleSignals): { line: string; block: string } {
  const countries = signals.countries
    .slice(0, 3)
    .map((c) => `${c.countryCode} (${countryName(c.countryCode) ?? c.countryCode}) ${percent(c.share)}`)
    .join(", ");
  const queries = [...signals.nonBrandQueries]
    .map((q) => ({ ...q, text: untrustedLine(q.query, 80) }))
    .filter((q) => q.text.length > 0)
    .sort((a, b) => b.impressions - a.impressions || b.clicks - a.clicks)
    .slice(0, MAX_DIGEST_QUERIES);
  const withPlace = queries.filter((q) => q.placeMentions.length > 0).length;
  const nearMe = queries.filter((q) => q.nearMe).length;
  const parts = [
    `${signals.totals.clicks.toLocaleString("en-US")} clicks, ${signals.totals.impressions.toLocaleString("en-US")} impressions`,
    signals.brand.brandedClickShare !== null ? `${percent(signals.brand.brandedClickShare)} of clicks searched the brand name` : null,
    countries ? `impressions by country: ${countries}` : null,
    queries.length > 0 ? `of the ${queries.length} non-brand searches listed, ${withPlace} mention a place and ${nearMe} say "near me"` : null,
  ].filter(Boolean);
  const line = `- Google Search Console (${signals.startDate} to ${signals.endDate}, ${untrustedLine(signals.siteUrl, 120)}): ${parts.join("; ")}.`;
  const rows = queries.map((q) => `- ${q.text} (clicks ${q.clicks}, impressions ${q.impressions})`);
  const block =
    rows.length > 0
      ? [`<search_queries note="untrusted text typed by searchers on Google: customer wording, not facts about the business; these lines have no ids and cannot be cited">`, ...rows, "</search_queries>"].join("\n")
      : "";
  return { line, block };
}

function compactWhitespace(text: string): string {
  return text.replace(/\s+/g, " ").trim();
}

export function buildSiteDigest(input: {
  pages: DigestPageInput[];
  evidence: EvidenceItem[];
  seedHostname: string;
  canonicalDomain: string;
  operatorMarket?: DigestOperatorMarket | null;
  /** Rendered only when `sufficient`: thin data would steer wording on noise. */
  searchConsole?: SearchConsoleSignals | null;
}): SiteDigest {
  const evidenceById = new Map(input.evidence.map((e) => [e.id, e]));
  const evidenceByPage = new Map<string, EvidenceItem[]>();
  for (const item of input.evidence) {
    if (!item.crawlPageId) continue;
    const list = evidenceByPage.get(item.crawlPageId) ?? [];
    list.push(item);
    evidenceByPage.set(item.crawlPageId, list);
  }

  // --- Pages --------------------------------------------------------------
  const orderedPages = [...input.pages].sort((a, b) => {
    const rank = (t: PageType) => {
      const index = PAGE_ORDER.indexOf(t);
      return index === -1 ? PAGE_ORDER.length : index;
    };
    // Within a type, the pages people actually reach from Google come first;
    // it is a tie-breaker only, so the budget still favours home/about/services.
    return rank(a.pageType) - rank(b.pageType) || (b.searchDemand ?? 0) - (a.searchDemand ?? 0);
  });

  const pages: DigestPage[] = [];
  const seenText = new Set<string>();
  let used = 0;
  for (const page of orderedPages) {
    // A page at /menu is a menu whatever its content classified as: rendered
    // dish lists with prices read as "product" and got a product page's budget.
    const budget = (/\/menus?(?:[/?#]|$)/i.test(page.url) ? PAGE_BUDGET.menu : PAGE_BUDGET[page.pageType]) ?? 1500;
    if (budget <= 0) continue;
    if (used >= TOTAL_PAGE_CHARS) break;
    const text = compactWhitespace(page.mainText);
    if (text.length < 40) continue;
    // Repeated templates (a blog listing echoed on every post) waste budget.
    const fingerprint = text.slice(0, 280);
    if (seenText.has(fingerprint)) continue;
    seenText.add(fingerprint);
    const take = Math.min(budget, TOTAL_PAGE_CHARS - used);
    const clipped = text.length > take ? `${text.slice(0, take)} …` : text;
    used += clipped.length;
    pages.push({ ref: `p${pages.length + 1}`, pageId: page.pageId, url: page.url, pageType: page.pageType, title: page.title, text: clipped });
  }

  // --- Facts ----------------------------------------------------------------
  const facts: DigestFact[] = [];
  const seenFact = new Set<string>();
  // Home and contact facts first: they carry the business's own name and address.
  const factCandidates = input.evidence
    .filter(isFact)
    .sort((a, b) => factRank(a) - factRank(b));
  for (const item of factCandidates) {
    if (facts.length >= MAX_FACTS) break;
    const key = item.text.toLowerCase().replace(/\s+/g, " ");
    if (seenFact.has(key)) continue;
    seenFact.add(key);
    facts.push({ ref: `f${facts.length + 1}`, evidenceId: item.id, pageId: item.crawlPageId, text: item.text.slice(0, 400) });
  }

  // --- Signals computed by code ---------------------------------------------
  const phoneNumbers = new Set<string>();
  const currencyCountries = new Set<string>();
  const bookingPlatforms = new Set<string>();
  const htmlLangs = new Set<string>();
  const structuredTypes = new Set<string>();
  let hreflangCount = 0;
  for (const item of input.evidence) {
    const data = (item.data ?? {}) as Record<string, unknown>;
    if (item.sourceType === "phone") {
      const raw = typeof data.telephone === "string" ? data.telephone : item.text.replace(/^[^:]*:\s*/, "");
      if (raw) phoneNumbers.add(raw.trim());
    }
    if (item.sourceType === "currency") {
      const code = countryCodeFromCurrency(item.text);
      if (code) currencyCountries.add(code);
    }
    if (typeof data.bookingPlatform === "string") bookingPlatforms.add(data.bookingPlatform);
    if (item.fieldHint === "language" && /html lang|og:locale/.test(item.text)) htmlLangs.add(item.text.replace(/^[^:]*:\s*/, ""));
    if (item.sourceType === "hreflang" && item.fieldHint === "market") hreflangCount++;
    if (/^Declared schema type:/.test(item.text)) structuredTypes.add(item.text.replace(/^Declared schema type:\s*/, ""));
  }
  const phoneCountries = [...phoneNumbers].slice(0, 8).map((number) => ({ number, countryCode: phoneCountry(number)?.countryCode ?? null }));

  const signals: SiteSignals = {
    ccTldCountry: countryCodeFromHostname(input.seedHostname),
    phoneCountries,
    currencyCountries: [...currencyCountries],
    bookingPlatforms: [...bookingPlatforms],
    htmlLangs: [...htmlLangs].slice(0, 4),
    hreflangCount,
    structuredBusinessTypes: [...structuredTypes].slice(0, 6),
  };

  const signalLines = [
    `- Domain: ${input.canonicalDomain}`,
    `- Country of the domain ending: ${signals.ccTldCountry ? `${signals.ccTldCountry} (${countryName(signals.ccTldCountry)})` : "none (generic or vanity domain ending)"}`,
    `- Phone numbers found: ${phoneCountries.length > 0 ? phoneCountries.map((p) => `${p.number}${p.countryCode ? ` (${p.countryCode})` : ""}`).join(", ") : "none"}`,
    `- Currencies imply: ${signals.currencyCountries.length > 0 ? signals.currencyCountries.join(", ") : "nothing specific"}`,
    `- Booking or ordering platforms linked: ${signals.bookingPlatforms.length > 0 ? signals.bookingPlatforms.join(", ") : "none"}`,
    `- Structured-data business types: ${signals.structuredBusinessTypes.length > 0 ? signals.structuredBusinessTypes.join(", ") : "none"}`,
    `- Page language tags (theme defaults, not market evidence): ${signals.htmlLangs.join(", ") || "none"}`,
    `- Alternate-language page links: ${hreflangCount}`,
  ];
  const ownerLine = input.operatorMarket ? operatorLine(input.operatorMarket) : null;
  if (ownerLine) signalLines.push(ownerLine);
  const searchConsole = input.searchConsole?.sufficient ? searchConsoleLines(input.searchConsole) : null;
  if (searchConsole) signalLines.push(searchConsole.line);

  const factBlock = facts.map((f) => `[${f.ref}] ${sanitizeUntrusted(f.text)}`).join("\n");
  const pageBlock = pages
    .map((p) => `<page id="${p.ref}" type="${p.pageType}" url="${sanitizeUntrusted(p.url)}" title="${sanitizeUntrusted((p.title ?? "").replace(/"/g, "'"))}">\n${sanitizeUntrusted(p.text)}\n</page>`)
    .join("\n\n");

  const navLabels = [...new Set(input.pages.find((p) => p.pageType === "home")?.navLabels ?? [])].slice(0, 30);

  const rendered = [
    "SIGNALS COMPUTED BY CODE (reliable, not website text):",
    ...signalLines,
    "",
    searchConsole?.block ?? "",
    "<website>",
    navLabels.length > 0 ? `<navigation>${sanitizeUntrusted(navLabels.join(" | "))}</navigation>` : "",
    "<facts>",
    factBlock || "(no structured facts found)",
    "</facts>",
    "",
    pageBlock,
    "</website>",
  ]
    .filter((line) => line !== "")
    .join("\n");

  const pageByRef = new Map(pages.map((p) => [p.ref, p]));
  const factByRef = new Map(facts.map((f) => [f.ref, f]));
  const corpus = [...pages.map((p) => p.text), ...facts.map((f) => f.text), ...input.pages.map((p) => `${p.title ?? ""} ${p.headings.join(" ")}`)].join("\n");

  return { rendered, pages, facts, pageByRef, factByRef, evidenceByPage, evidenceById, signals, corpus };
}

function factRank(item: EvidenceItem): number {
  const pageRank: Partial<Record<PageType, number>> = { home: 0, contact: 1, about: 2, location: 2, store_locator: 2, service_index: 3, menu: 3, pricing: 3 };
  const sourceRank: Record<string, number> = { jsonld: 0, microdata: 1, rdfa: 1, address: 0, phone: 1, url_signal: 2, currency: 3, meta: 2, image_alt: 4 };
  return (pageRank[item.pageType] ?? 5) * 10 + (sourceRank[item.sourceType] ?? 5);
}
