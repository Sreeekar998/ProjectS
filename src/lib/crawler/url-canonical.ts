// URL canonicalization and crawl-trap detection.
//
// Two jobs that are easy to conflate but must stay separate:
//   1. `canonicalizeUrl` produces the identity a URL is deduplicated by.
//   2. `classifyUrlTrap` decides whether a URL is worth spending budget on.
//
// Neither touches the network. SSRF checks live in @/lib/security/url-safety
// and run separately before every fetch, including after each redirect hop.

import { parse as parseTld } from "tldts";

const TRACKING_PARAM_EXACT = new Set([
  "gclid",
  "gbraid",
  "wbraid",
  "fbclid",
  "msclkid",
  "dclid",
  "yclid",
  "twclid",
  "ttclid",
  "igshid",
  "mkt_tok",
  "_ga",
  "_gl",
  "ref",
  "referrer",
  "source",
  "cmpid",
  "campaignid",
  "adgroupid",
  "srsltid",
  "spm",
  "trk",
]);

const TRACKING_PARAM_PREFIXES = ["utm_", "mc_", "pk_", "piwik_", "hsa_", "vero_", "matomo_", "oly_", "at_"];

export function isTrackingParam(key: string): boolean {
  const lower = key.toLowerCase();
  return TRACKING_PARAM_EXACT.has(lower) || TRACKING_PARAM_PREFIXES.some((p) => lower.startsWith(p));
}

/**
 * Produces a stable identity for a URL: lowercase host, default port dropped,
 * fragment dropped, tracking parameters stripped, remaining query sorted, and
 * a trailing slash normalized away (except on the site root).
 *
 * Returns null for anything that is not an http(s) URL.
 */
export function canonicalizeUrl(input: string, base?: string): string | null {
  let url: URL;
  try {
    url = base ? new URL(input, base) : new URL(input);
  } catch {
    return null;
  }
  if (url.protocol !== "http:" && url.protocol !== "https:") return null;

  url.hash = "";
  url.hostname = url.hostname.toLowerCase();
  if ((url.protocol === "http:" && url.port === "80") || (url.protocol === "https:" && url.port === "443")) {
    url.port = "";
  }

  for (const key of [...url.searchParams.keys()]) {
    if (isTrackingParam(key)) url.searchParams.delete(key);
  }
  url.searchParams.sort();

  if (url.pathname.length > 1 && url.pathname.endsWith("/")) {
    url.pathname = url.pathname.replace(/\/+$/, "");
  }
  // Collapse accidental double slashes inside the path (common in CMS output).
  url.pathname = url.pathname.replace(/\/{2,}/g, "/");

  return url.toString();
}

export interface RegistrableDomainInfo {
  registrableDomain: string;
  subdomain: string;
  hostname: string;
}

export function registrableDomainInfo(hostname: string): RegistrableDomainInfo {
  const host = hostname.toLowerCase();
  const parsed = parseTld(host, { allowPrivateDomains: true });
  return {
    registrableDomain: parsed.domain ?? host,
    subdomain: parsed.subdomain ?? "",
    hostname: host,
  };
}

/**
 * Same *intended public website*, not merely the same registrable domain.
 *
 * `www.acme.com` and `acme.com` are the same site. `shop.acme.com` is part of
 * the business site and worth crawling. `status.acme.com`, `careers.acme.com`
 * and `cdn.acme.com` are not — they are operationally separate properties
 * whose content would pollute business understanding.
 */
const OFF_SITE_SUBDOMAINS = new Set([
  "status",
  "cdn",
  "static",
  "assets",
  "img",
  "images",
  "media",
  "mail",
  "webmail",
  "smtp",
  "ftp",
  "vpn",
  "careers",
  "jobs",
  "developer",
  "developers",
  "docs",
  "api",
  "id",
  "auth",
  "login",
  "sso",
  "accounts",
  "account",
  "my",
  "portal",
  "app",
  "admin",
  "dashboard",
  "community",
  "forum",
  "forums",
  "support",
  "help",
  "helpdesk",
  "kb",
  "investors",
  "ir",
  "press",
  "news",
  "newsroom",
  "track",
  "click",
  "links",
  "go",
]);

export function isSameBusinessSite(candidateHostname: string, seedHostname: string): boolean {
  const candidate = registrableDomainInfo(candidateHostname);
  const seed = registrableDomainInfo(seedHostname);
  if (candidate.registrableDomain !== seed.registrableDomain) return false;

  const normalizedCandidateSub = candidate.subdomain.replace(/^www\./, "").replace(/^www$/, "");
  const normalizedSeedSub = seed.subdomain.replace(/^www\./, "").replace(/^www$/, "");
  if (normalizedCandidateSub === normalizedSeedSub) return true;
  // Always allow moving between apex and www of the seed.
  if (normalizedCandidateSub === "" || normalizedSeedSub === "") {
    const other = normalizedCandidateSub || normalizedSeedSub;
    return !OFF_SITE_SUBDOMAINS.has(other.split(".").pop() ?? other);
  }
  const leaf = normalizedCandidateSub.split(".").pop() ?? normalizedCandidateSub;
  return !OFF_SITE_SUBDOMAINS.has(leaf);
}

export type UrlTrapReason =
  | "session_or_auth"
  | "cart_or_checkout"
  | "search_results"
  | "faceted_filter"
  | "deep_pagination"
  | "calendar"
  | "print_or_export"
  | "non_html_asset"
  | "feed"
  | "locale_duplicate"
  | "tag_or_archive";

const TRAP_PATH_RULES: Array<{ reason: UrlTrapReason; test: RegExp }> = [
  { reason: "session_or_auth", test: /\/(login|signin|sign-in|logout|signout|register|signup|sign-up|account|my-account|profile|password|reset|auth|oauth|sso)(\/|$)/i },
  { reason: "cart_or_checkout", test: /\/(cart|basket|bag|checkout|order-status|wishlist|compare)(\/|$)/i },
  { reason: "search_results", test: /\/(search|find|results|autocomplete|suggest)(\/|$)/i },
  { reason: "calendar", test: /\/(calendar|events?)\/\d{4}([/-]\d{1,2})?(\/|$)/i },
  { reason: "print_or_export", test: /\/(print|printable|amp|export|download)(\/|$)/i },
  { reason: "non_html_asset", test: /\.(pdf|jpe?g|png|gif|webp|avif|svg|ico|css|js|mjs|json|xml|zip|gz|rar|mp[34]|mov|avi|webm|woff2?|ttf|eot|dmg|exe|csv|xlsx?|docx?|pptx?)$/i },
  { reason: "feed", test: /\/(feed|rss|atom)(\/|$)|\.(rss|atom)$/i },
  { reason: "tag_or_archive", test: /\/(tag|tags|author|archive|archives|category-archive|date)\/[^/]+/i },
  { reason: "deep_pagination", test: /\/(page|p)\/(\d+)(\/|$)/i },
];

const FACET_PARAM_HINTS = ["color", "colour", "size", "price", "filter", "facet", "sort", "orderby", "order_by", "brand", "material", "fit", "width", "rating", "availability", "pa_", "attribute"];
const PAGINATION_PARAM_HINTS = ["page", "p", "start", "offset", "from", "pg"];
const MAX_SHALLOW_PAGE = 2;

export interface UrlTrapVerdict {
  isTrap: boolean;
  reason?: UrlTrapReason;
}

/**
 * Flags URLs that generate unbounded or near-worthless crawl surface.
 * Deliberately conservative: a false positive costs one page of coverage,
 * while a false negative can consume the entire budget on shoe colourways.
 */
export function classifyUrlTrap(rawUrl: string): UrlTrapVerdict {
  let url: URL;
  try {
    url = new URL(rawUrl);
  } catch {
    return { isTrap: true, reason: "non_html_asset" };
  }
  const path = url.pathname;

  for (const rule of TRAP_PATH_RULES) {
    if (rule.reason === "deep_pagination") {
      const match = path.match(rule.test);
      if (match && Number(match[2]) > MAX_SHALLOW_PAGE) return { isTrap: true, reason: "deep_pagination" };
      continue;
    }
    if (rule.test.test(path)) return { isTrap: true, reason: rule.reason };
  }

  const paramKeys = [...url.searchParams.keys()].map((k) => k.toLowerCase());
  if (paramKeys.some((k) => FACET_PARAM_HINTS.some((h) => k === h || k.startsWith(h)))) {
    return { isTrap: true, reason: "faceted_filter" };
  }
  for (const key of paramKeys) {
    if (PAGINATION_PARAM_HINTS.includes(key)) {
      const value = Number(url.searchParams.get(key));
      if (Number.isFinite(value) && value > MAX_SHALLOW_PAGE) return { isTrap: true, reason: "deep_pagination" };
    }
  }
  if (paramKeys.some((k) => k === "q" || k === "query" || k === "s" || k === "keyword")) {
    return { isTrap: true, reason: "search_results" };
  }
  // More than two surviving query parameters on a content URL is a strong
  // signal of a generated permutation rather than an editorially real page.
  if (paramKeys.length > 2) return { isTrap: true, reason: "faceted_filter" };

  return { isTrap: false };
}

/**
 * Groups URLs that a CMS or storefront generates from one template, so the
 * planner can sample a family (`/products/*`) instead of exhausting the
 * budget inside it. Numeric and slug-like leaf segments collapse to `*`.
 */
export function urlFamilyKey(rawUrl: string): string {
  let url: URL;
  try {
    url = new URL(rawUrl);
  } catch {
    return rawUrl;
  }
  const segments = url.pathname.split("/").filter(Boolean);
  if (segments.length === 0) return `${url.hostname}:/`;

  const shaped = segments.map((segment, index) => {
    if (index === 0) return segment.toLowerCase();
    if (/^\d+$/.test(segment)) return "*";
    if (/^[0-9a-f-]{8,}$/i.test(segment)) return "*";
    // A leaf segment with several words is almost always an item slug.
    if (index >= 1 && (segment.match(/-/g)?.length ?? 0) >= 2) return "*";
    return segment.toLowerCase();
  });

  // Everything below depth 3 of the same branch is one family.
  return `${url.hostname}:/${shaped.slice(0, 3).join("/")}`;
}

/** Locale-ish first path segment, e.g. /en-gb/…, /fr/…, /in/en/… */
const LOCALE_SEGMENT = /^([a-z]{2})([-_][a-z]{2})?$/i;

export function localeSegmentOf(rawUrl: string): string | null {
  try {
    const first = new URL(rawUrl).pathname.split("/").filter(Boolean)[0];
    if (!first) return null;
    return LOCALE_SEGMENT.test(first) ? first.toLowerCase() : null;
  } catch {
    return null;
  }
}
