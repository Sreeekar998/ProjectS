import { load } from "cheerio";
import { safeFetchHtml } from "@/lib/crawler/fetcher";
import { canonicalizeDomain, normalizeEntityName } from "./competitor-entity";
import type { CandidateBusinessProfile, CompetitiveSearchProfile, CompetitorCandidate } from "./competitor-types";

const MAX_PAGES = 4;
const FETCH_OPTIONS = { timeoutMs: 7_500, maxContentBytes: 350_000, maxRedirects: 4 };
// contact/location pages carry the address a local rival is judged by.
const HIGH_VALUE_PATH = /\b(about|company|product|products|service|services|solution|solutions|platform|category|categories|contact|location|locations|find-us|visit)\b/i;
// A branch finder is footprint evidence for the country tier. Plural finders
// only: "/location", "/store" and "/find-us" are ordinary pages on one-shop
// sites, and matching them moved a single Ajman salon into "Across the UAE"
// instead of rejecting it as outside Dubai (review, 2026-09-14).
const LOCATIONS_PATH = /(^|[/_-])(locations|branches|stores|store-locator|store-finder)\b/i;
const TOKEN_STOPWORDS = new Set(["the", "and", "for", "with", "from", "this", "that", "our", "your", "you", "are", "company", "home", "learn", "more"]);

function normalizeWhitespace(value: string): string {
  return value.replace(/\s+/g, " ").trim();
}

function compactSignals(values: string[], max = 18): string[] {
  const seen = new Set<string>();
  const result: string[] = [];
  for (const value of values.map(normalizeWhitespace)) {
    const key = value.toLowerCase();
    if (value.length < 3 || value.length > 140 || seen.has(key)) continue;
    seen.add(key);
    result.push(value);
    if (result.length >= max) break;
  }
  return result;
}

function contentTokens(text: string): string[] {
  const counts = new Map<string, number>();
  for (const token of text.toLowerCase().replace(/[^a-z0-9\s-]/g, " ").split(/\s+/)) {
    if (token.length < 3 || TOKEN_STOPWORDS.has(token)) continue;
    counts.set(token, (counts.get(token) ?? 0) + 1);
  }
  return [...counts.entries()].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0])).slice(0, 60).map(([token]) => token);
}

function extractPage(html: string, url: string) {
  const $ = load(html);
  // Read structured-data localities and the footer before boilerplate is
  // removed: a salon's address usually lives in its footer or JSON-LD, and a
  // verifier that only read <main> judged real DIFC salons "not local".
  const localities = new Set<string>();
  const countries = new Set<string>();
  const structuredAddressParts: string[] = [];
  $('script[type="application/ld+json"]').each((_, node) => {
    const text = $(node).text();
    for (const match of text.matchAll(/"addressLocality"\s*:\s*"([^"]{2,120})"/g)) localities.add(match[1]!);
    for (const match of text.matchAll(/"(?:addressRegion|addressCountry|streetAddress)"\s*:\s*"([^"]{2,120})"/g)) structuredAddressParts.push(match[1]!);
    // addressCountry is a code ("AE"), a name, or a Country object.
    for (const match of text.matchAll(/"addressCountry"\s*:\s*"([^"]{2,80})"/g)) countries.add(match[1]!.trim());
    for (const match of text.matchAll(/"addressCountry"\s*:\s*\{[^}]*?"name"\s*:\s*"([^"]{2,80})"/g)) countries.add(match[1]!.trim());
  });
  const footer = normalizeWhitespace($("footer").text()).slice(0, 3_000);
  const addressText = normalizeWhitespace(`${$("address, [itemprop=address]").text()} ${structuredAddressParts.join(" ")}`).slice(0, 1_500);
  $("script, style, nav, footer, noscript, svg").remove();
  const title = normalizeWhitespace($("title").first().text()) || null;
  const description = normalizeWhitespace($("meta[name='description']").attr("content") ?? $("meta[property='og:description']").attr("content") ?? "") || null;
  const headings = compactSignals($("h1, h2, h3").toArray().map((node) => $(node).text()), 24);
  const links = $("a[href]").toArray().map((node) => $(node).attr("href") ?? "").filter(Boolean);
  const body = normalizeWhitespace($("main, article, body").first().text()).slice(0, 18_000);
  return { url, title, description, headings, links, body, localities: [...localities], countries: [...countries], footer, addressText };
}

function normalizePlace(value: string): string {
  return value.normalize("NFKD").replace(/[\u0300-\u036f]/g, "").toLowerCase().replace(/[^\p{L}\p{N}]+/gu, " ").trim();
}

/** Which of the target's place names appear on the candidate's own pages. */
function findPlaceMentions(text: string, places: string[]): string[] {
  const haystack = ` ${normalizePlace(text)} `;
  return [...new Set(places.filter((place) => {
    const needle = normalizePlace(place);
    return needle.length >= 3 && haystack.includes(` ${needle} `);
  }))];
}

function resolveHighValueLinks(baseUrl: string, hrefs: string[]): string[] {
  const base = new URL(baseUrl);
  const urls = new Set<string>();
  for (const href of hrefs) {
    try {
      const url = new URL(href, base);
      if (url.origin !== base.origin || !HIGH_VALUE_PATH.test(url.pathname)) continue;
      url.hash = "";
      url.search = "";
      urls.add(url.toString());
    } catch {
      // Ignore malformed links from third-party page markup.
    }
  }
  return [...urls].slice(0, MAX_PAGES - 1);
}

export async function verifyCompetitorWebsite(candidate: CompetitorCandidate, target?: CompetitiveSearchProfile): Promise<CandidateBusinessProfile | null> {
  const canonicalDomain = canonicalizeDomain(candidate.likelyDomain);
  if (!canonicalDomain) return null;
  const startUrl = `https://${canonicalDomain}/`;
  const homepageResult = await safeFetchHtml(startUrl, FETCH_OPTIONS);
  if (!homepageResult.ok || !homepageResult.body || !homepageResult.finalUrl) {
    return {
      displayName: candidate.canonicalName,
      canonicalDomain,
      finalUrl: homepageResult.finalUrl ?? null,
      title: null,
      description: null,
      offerings: [],
      audienceSignals: [],
      jobSignals: [],
      useCaseSignals: [],
      categorySignals: [],
      geographySignals: [],
      placeMentions: [],
      structuredLocalities: [],
      addressPlaceMentions: [],
      structuredCountries: [],
      localityCount: 0,
      hasLocationsPage: false,
      contentTokens: [],
      pagesFetched: [],
      verificationStatus: "failed",
      verificationSummary: `Candidate website could not be verified (${homepageResult.error ?? "unavailable"}).`,
      verificationError: homepageResult.error ?? "unavailable",
    };
  }

  const pages = [extractPage(homepageResult.body, homepageResult.finalUrl)];
  const highValueUrls = resolveHighValueLinks(homepageResult.finalUrl, pages[0]!.links);
  const additional = await Promise.all(
    highValueUrls.map(async (url) => {
      const result = await safeFetchHtml(url, FETCH_OPTIONS);
      return result.ok && result.body && result.finalUrl ? extractPage(result.body, result.finalUrl) : null;
    }),
  );
  pages.push(...additional.filter((page): page is NonNullable<typeof page> => Boolean(page)));

  const combined = pages.map((page) => [page.title, page.description, ...page.headings, page.body].filter(Boolean).join(" ")).join(" ");
  const locationText = pages.map((page) => [page.addressText, page.footer, page.localities.join(" ")].join(" ")).join(" ");
  const targetPlaces = target
    ? [...(target.geography.neighborhoods ?? []), ...(target.geography.nearbyAreas ?? []), ...target.geography.cities, ...target.geography.regions, ...target.geography.countries]
    : [];
  const placeMentions = findPlaceMentions(`${combined} ${locationText}`, targetPlaces);
  // Only the address, footer and structured data place a rival in an area; a
  // blog post naming "DIFC" on a Jumeirah salon's site does not.
  const addressPlaceMentions = findPlaceMentions(locationText, targetPlaces);
  const allLocalities = [...new Set(pages.flatMap((page) => page.localities.map((locality) => locality.trim())))];
  const structuredLocalities = allLocalities.slice(0, 12);
  const localityCount = new Set(allLocalities.map(normalizePlace)).size;
  const structuredCountries = [...new Set(pages.flatMap((page) => page.countries))].slice(0, 6);
  const homeOrigin = new URL(homepageResult.finalUrl).origin;
  const hasLocationsPage = pages.some((page) =>
    page.links.some((href) => {
      try {
        const url = new URL(href, page.url);
        return url.origin === homeOrigin && LOCATIONS_PATH.test(url.pathname);
      } catch {
        return false;
      }
    }),
  );
  const headings = compactSignals(pages.flatMap((page) => page.headings), 30);
  const candidateName = normalizeEntityName(candidate.canonicalName);
  const identityHaystack = normalizeEntityName(`${pages[0]!.title ?? ""} ${combined.slice(0, 4_000)} ${canonicalDomain}`);
  const nameTokens = candidateName.split(" ").filter((token) => token.length > 2);
  const identityMatches = nameTokens.length === 0 || nameTokens.some((token) => identityHaystack.split(" ").includes(token));
  const verificationStatus = identityMatches ? "verified" : "contradicted";

  return {
    displayName: candidate.canonicalName,
    canonicalDomain: canonicalizeDomain(homepageResult.finalUrl) ?? canonicalDomain,
    finalUrl: homepageResult.finalUrl,
    title: pages[0]!.title,
    description: pages[0]!.description,
    offerings: headings.filter((heading) => /product|service|solution|platform|shop|care|course|room|menu|vehicle/i.test(heading)).slice(0, 12),
    audienceSignals: headings.filter((heading) => /for |teams?|business|patient|student|family|traveler|guest|professional|consumer/i.test(heading)).slice(0, 10),
    jobSignals: headings.filter((heading) => /help|manage|improve|build|buy|book|find|choose|deliver|protect|learn|care/i.test(heading)).slice(0, 10),
    useCaseSignals: headings.slice(0, 14),
    categorySignals: compactSignals([pages[0]!.title ?? "", pages[0]!.description ?? "", ...headings], 18),
    geographySignals: compactSignals([...(combined.match(/\b(?:in|across|serving)\s+[A-Z][A-Za-z .-]{2,40}/g) ?? []), ...structuredLocalities, ...placeMentions], 16),
    placeMentions,
    structuredLocalities,
    addressPlaceMentions,
    structuredCountries,
    localityCount,
    hasLocationsPage,
    contentTokens: contentTokens(combined),
    pagesFetched: pages.map((page) => page.url),
    verificationStatus,
    verificationSummary: identityMatches
      ? `Verified against ${pages.length} high-value page${pages.length === 1 ? "" : "s"} on ${canonicalDomain}.`
      : `The supplied domain did not provide enough identity evidence for ${candidate.canonicalName}.`,
  };
}
