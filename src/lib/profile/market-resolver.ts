// Market / geography inference.
//
// Three mistakes this module refuses to make:
//   1. treating the headquarters address as the market — a Bengaluru-built SaaS
//      selling to US enterprises is not "an India business";
//   2. treating a .com domain as the United States;
//   3. treating the site's language as its market — an English site is not
//      evidence of a US or UK market, which would badly misprice a Gulf brand.
//
// Signals are weighted by how directly they state a market. A storefront the
// user is actually on (ccTLD, locale path, currency, hreflang set) beats an
// address block, which beats a sentence mentioning a place.

import { computeConfidence } from "./confidence";
import type { EvidenceItem } from "@/lib/evidence/types";
import { schemaFamilyOf } from "@/lib/crawler/structured-data";
import { countryCodesMentioned } from "@/lib/geo/countries";
import type { Market, MarketLevel, MarketScope } from "./schema";

interface CountryEntry {
  code: string;
  name: string;
  aliases: string[];
  ccTlds: string[];
  currencies: string[];
  phonePrefixes: string[];
}

// Not exhaustive — it covers the markets a public business site is most
// likely to declare, and unknown values degrade to "named market, unknown
// code" rather than being dropped.
const COUNTRIES: CountryEntry[] = [
  { code: "US", name: "United States", aliases: ["usa", "u.s.", "u.s.a.", "united states of america", "america"], ccTlds: ["us"], currencies: ["USD", "US$"], phonePrefixes: ["+1"] },
  { code: "GB", name: "United Kingdom", aliases: ["uk", "u.k.", "great britain", "britain", "england", "scotland", "wales"], ccTlds: ["uk", "co.uk"], currencies: ["GBP", "£"], phonePrefixes: ["+44"] },
  { code: "IN", name: "India", aliases: ["bharat"], ccTlds: ["in", "co.in"], currencies: ["INR", "₹", "Rs", "Rs."], phonePrefixes: ["+91"] },
  { code: "AE", name: "United Arab Emirates", aliases: ["uae", "u.a.e.", "emirates"], ccTlds: ["ae"], currencies: ["AED", "DHS", "Dhs"], phonePrefixes: ["+971"] },
  { code: "SA", name: "Saudi Arabia", aliases: ["ksa", "kingdom of saudi arabia"], ccTlds: ["sa"], currencies: ["SAR"], phonePrefixes: ["+966"] },
  { code: "CA", name: "Canada", aliases: [], ccTlds: ["ca"], currencies: ["CAD", "C$"], phonePrefixes: ["+1"] },
  { code: "AU", name: "Australia", aliases: [], ccTlds: ["au", "com.au"], currencies: ["AUD", "A$"], phonePrefixes: ["+61"] },
  { code: "DE", name: "Germany", aliases: ["deutschland"], ccTlds: ["de"], currencies: ["EUR", "€"], phonePrefixes: ["+49"] },
  { code: "FR", name: "France", aliases: [], ccTlds: ["fr"], currencies: ["EUR", "€"], phonePrefixes: ["+33"] },
  { code: "ES", name: "Spain", aliases: ["españa"], ccTlds: ["es"], currencies: ["EUR", "€"], phonePrefixes: ["+34"] },
  { code: "IT", name: "Italy", aliases: ["italia"], ccTlds: ["it"], currencies: ["EUR", "€"], phonePrefixes: ["+39"] },
  { code: "NL", name: "Netherlands", aliases: ["holland"], ccTlds: ["nl"], currencies: ["EUR", "€"], phonePrefixes: ["+31"] },
  { code: "SG", name: "Singapore", aliases: [], ccTlds: ["sg", "com.sg"], currencies: ["SGD", "S$"], phonePrefixes: ["+65"] },
  { code: "JP", name: "Japan", aliases: ["nippon"], ccTlds: ["jp", "co.jp"], currencies: ["JPY", "¥"], phonePrefixes: ["+81"] },
  { code: "CN", name: "China", aliases: [], ccTlds: ["cn", "com.cn"], currencies: ["CNY", "RMB"], phonePrefixes: ["+86"] },
  { code: "BR", name: "Brazil", aliases: ["brasil"], ccTlds: ["br", "com.br"], currencies: ["BRL", "R$"], phonePrefixes: ["+55"] },
  { code: "MX", name: "Mexico", aliases: ["méxico"], ccTlds: ["mx", "com.mx"], currencies: ["MXN"], phonePrefixes: ["+52"] },
  { code: "ZA", name: "South Africa", aliases: [], ccTlds: ["za", "co.za"], currencies: ["ZAR", "R"], phonePrefixes: ["+27"] },
  { code: "NG", name: "Nigeria", aliases: [], ccTlds: ["ng", "com.ng"], currencies: ["NGN"], phonePrefixes: ["+234"] },
  { code: "KE", name: "Kenya", aliases: [], ccTlds: ["ke", "co.ke"], currencies: ["KES"], phonePrefixes: ["+254"] },
  { code: "QA", name: "Qatar", aliases: [], ccTlds: ["qa"], currencies: ["QAR"], phonePrefixes: ["+974"] },
  { code: "KW", name: "Kuwait", aliases: [], ccTlds: ["kw"], currencies: ["KWD"], phonePrefixes: ["+965"] },
  { code: "IE", name: "Ireland", aliases: [], ccTlds: ["ie"], currencies: ["EUR", "€"], phonePrefixes: ["+353"] },
  { code: "NZ", name: "New Zealand", aliases: [], ccTlds: ["nz", "co.nz"], currencies: ["NZD"], phonePrefixes: ["+64"] },
  { code: "CH", name: "Switzerland", aliases: [], ccTlds: ["ch"], currencies: ["CHF"], phonePrefixes: ["+41"] },
  { code: "SE", name: "Sweden", aliases: [], ccTlds: ["se"], currencies: ["SEK"], phonePrefixes: ["+46"] },
  { code: "PL", name: "Poland", aliases: ["polska"], ccTlds: ["pl"], currencies: ["PLN"], phonePrefixes: ["+48"] },
  { code: "ID", name: "Indonesia", aliases: [], ccTlds: ["id", "co.id"], currencies: ["IDR"], phonePrefixes: ["+62"] },
  { code: "PH", name: "Philippines", aliases: [], ccTlds: ["ph", "com.ph"], currencies: ["PHP"], phonePrefixes: ["+63"] },
  { code: "MY", name: "Malaysia", aliases: [], ccTlds: ["my", "com.my"], currencies: ["MYR"], phonePrefixes: ["+60"] },
  { code: "TR", name: "Türkiye", aliases: ["turkey"], ccTlds: ["tr", "com.tr"], currencies: ["TRY"], phonePrefixes: ["+90"] },
];

const BY_CODE = new Map(COUNTRIES.map((c) => [c.code, c]));

export function countryFromCode(code: string): CountryEntry | undefined {
  return BY_CODE.get(code.toUpperCase());
}

export function countryFromName(value: string): CountryEntry | undefined {
  const lower = value.trim().toLowerCase();
  if (lower.length === 2) return BY_CODE.get(lower.toUpperCase());
  return COUNTRIES.find((c) => c.name.toLowerCase() === lower || c.aliases.includes(lower));
}

export function countryFromCcTld(hostname: string): CountryEntry | undefined {
  const parts = hostname.toLowerCase().split(".");
  const last = parts[parts.length - 1];
  const lastTwo = parts.slice(-2).join(".");
  return COUNTRIES.find((c) => c.ccTlds.includes(lastTwo) || c.ccTlds.includes(last ?? ""));
}

function countryFromCurrency(token: string): CountryEntry[] {
  const normalized = token.trim();
  return COUNTRIES.filter((c) => c.currencies.some((cur) => normalized.toUpperCase().startsWith(cur.toUpperCase())));
}

function countryFromPhone(token: string): CountryEntry | undefined {
  const digits = token.replace(/[^\d+]/g, "");
  const matches = COUNTRIES.filter((c) => c.phonePrefixes.some((p) => digits.startsWith(p)));
  // "+1" is shared by US and Canada; an ambiguous prefix is not evidence.
  return matches.length === 1 ? matches[0] : undefined;
}

const GLOBAL_PHRASES = /\b(worldwide|globally|global(?!\s+(hq|headquarters))|international(?:ly)?|around the world|in \d+\+? countries|across \d+\+? countries|ships? worldwide|available worldwide)\b/i;
const NATIONAL_PHRASES = /\b(nationwide|across the country|pan[- ]india|all over india|throughout the (uk|us|country)|coast to coast)\b/i;
const HQ_PHRASES = /\b(headquarter(ed|s)?|head office|registered office|corporate office|our hq|founded in)\b/i;

/**
 * Page types where an address is almost always the head office rather than a
 * place the business serves. A `location` or `store_locator` page is the
 * opposite: its addresses ARE the market.
 */
const HQ_ONLY_PAGE_TYPES = new Set(["about", "contact", "home", "legal", "careers"]);

interface MarketSignal {
  code: string | null;
  name: string;
  level: MarketLevel;
  weight: number;
  evidenceIds: string[];
  /** Every signal kind that contributed — a merged signal keeps all of them,
   * so a weak address does not mask the explicit `areaServed` beside it. */
  kinds: Set<string>;
  isHqOnly: boolean;
}

export interface MarketResolution {
  markets: Market[];
  scope: { value: MarketScope; confidence: number; evidenceIds: string[] };
  languages: string[];
  cities: string[];
  regions: string[];
  countries: string[];
  serviceAreaDescription: string | null;
  warnings: string[];
}

export interface ResolveMarketsInput {
  evidence: EvidenceItem[];
  seedHostname: string;
  seedUrl: string;
}

// The explicit locator shapes from page-classifier.ts. Its bare depth-1
// "/location(s)" or "/stores" index rule is left out: a single salon's
// /location page is directions to one place, not a list of branches.
const EXPLICIT_LOCATOR_PATH = /\b(store-?locator|find-a-(store|dealer|branch|clinic|location)|locations?-near|dealer-?locator|branch-?locator|where-to-buy|our-(stores|locations|branches|showrooms|clinics|centres|centers))\b/;

function isExplicitLocatorUrl(url: string): boolean {
  try {
    return EXPLICIT_LOCATOR_PATH.test(new URL(url).pathname.toLowerCase());
  } catch {
    return false;
  }
}

const COUNT_WORDS: Record<string, number> = {
  two: 2, three: 3, four: 4, five: 5, six: 6, seven: 7, eight: 8, nine: 9, ten: 10,
  eleven: 11, twelve: 12, fifteen: 15, twenty: 20, dozens: 24, hundreds: 200,
};

// "14 stores", "three hospitals", "over 120 branches", "14 retail stores". One
// descriptive word may sit between the count and the noun; time and rating
// words ("5 star salons"), "24/7 clinics" and award copy ("one of the top 10
// salons in Dubai") are not counts of the business's own sites.
const SITE_COUNT = new RegExp(
  `(?<![/.:#£$€₹-])(?<!\\b(?:top|best)\\s+)\\b(\\d[\\d,]*|${Object.keys(COUNT_WORDS).join("|")})\\s+(?:(?!(?:hours?|stars?|years?|minutes?|days?|weeks?|months?)\\b)[a-z]+\\s+)?(stores|shops|branches|locations|outlets|hospitals|clinics|restaurants|showrooms|salons|offices|centres|centers)\\b`,
  "gi",
);

function statesMultipleSites(text: string): boolean {
  for (const match of text.matchAll(SITE_COUNT)) {
    const raw = match[1]!.toLowerCase();
    const count = COUNT_WORDS[raw] ?? Number(raw.replace(/,/g, ""));
    if (Number.isFinite(count) && count >= 2) return true;
  }
  return false;
}

// "customers across the United Kingdom since 1974" is a national footprint;
// "clients across Dubai" is one city's catchment, so only a country counts.
const CUSTOMERS_ACROSS = /\b(?:customers|clients|patients|members)\s+(?:across|throughout)\s+([^.,;:!?\n]{2,80})/gi;

function statesCountryWideCustomers(text: string): boolean {
  for (const match of text.matchAll(CUSTOMERS_ACROSS)) {
    // Only the first place named: "clients across Dubai and the UAE" is still Dubai.
    const place = match[1]!.split(/\s+(?:and|or|from|since|with|in|for|who|through)\b/i)[0]!;
    if (countryCodesMentioned(place).length > 0) return true;
  }
  return false;
}

export function resolveMarkets({ evidence, seedHostname, seedUrl }: ResolveMarketsInput): MarketResolution {
  const signals: MarketSignal[] = [];
  const languages = new Set<string>();
  const cities = new Map<string, string[]>();
  const regions = new Map<string, string[]>();
  const warnings: string[] = [];
  const hreflangCodes = new Set<string>();
  const hqCities = new Set<string>();
  const storefrontCities = new Set<string>();
  // The single-storefront rule below is for a business customers visit in one
  // place. A store locator, "14 stores across…" or "customers across the United
  // Kingdom" means the one published address is not the market: applying the
  // rule to those made an Indian online retailer, a hospital group and a bank
  // "local". Only explicit multi-site statements count: a DIFC salon with a
  // /location page, a "Shop now" button or "clients across Dubai" is still one
  // storefront (review 2026-09-14).
  const multiSiteOrOnline = evidence.some((item) => isExplicitLocatorUrl(item.url) || statesMultipleSites(item.text) || statesCountryWideCustomers(item.text));
  const hqCityEvidence = new Map<string, string[]>();
  const hqRegionEvidence = new Map<string, string[]>();
  let globalEvidence: string[] = [];
  let nationalEvidence: string[] = [];
  let serviceAreaDescription: string | null = null;

  const push = (signal: MarketSignal) => {
    const existing = signals.find((s) => (signal.code ? s.code === signal.code : s.name.toLowerCase() === signal.name.toLowerCase()) && s.level === signal.level);
    if (existing) {
      existing.weight += signal.weight;
      existing.isHqOnly = existing.isHqOnly && signal.isHqOnly;
      for (const kind of signal.kinds) existing.kinds.add(kind);
      for (const id of signal.evidenceIds) if (existing.evidenceIds.length < 8 && !existing.evidenceIds.includes(id)) existing.evidenceIds.push(id);
      return;
    }
    signals.push({ ...signal, evidenceIds: [...signal.evidenceIds], kinds: new Set(signal.kinds) });
  };

  // 1. ccTLD — the site's own top-level declaration of its market.
  const ccTld = countryFromCcTld(seedHostname);
  if (ccTld) push({ code: ccTld.code, name: ccTld.name, level: "country", weight: 3.4, evidenceIds: [], kinds: new Set(["cctld"]), isHqOnly: false });

  // 2. Locale path segment, e.g. nike.com/in/ or example.com/en-gb/.
  const localeSegment = seedUrl.match(/^https?:\/\/[^/]+\/([a-z]{2}(?:[-_][a-z]{2})?)(?:\/|$)/i)?.[1];
  if (localeSegment) {
    const parts = localeSegment.split(/[-_]/);
    const regionPart = parts[1] ?? (parts[0]!.length === 2 ? parts[0] : undefined);
    const country = regionPart ? countryFromCode(regionPart) : undefined;
    if (country) push({ code: country.code, name: country.name, level: "country", weight: 3.2, evidenceIds: [], kinds: new Set(["locale_path"]), isHqOnly: false });
    languages.add(parts[0]!.toLowerCase());
  }

  for (const item of evidence) {
    if (item.fieldHint === "language") {
      const lang = item.text.match(/:\s*([A-Za-z-]{2,10})\s*$/)?.[1];
      if (lang) languages.add(lang.toLowerCase().split(/[-_]/)[0]!);
      const localeCountry = item.text.match(/:\s*[a-z]{2}[-_]([A-Z]{2})\s*$/)?.[1];
      // `en-US` / `en_US` is the WordPress and Shopify theme default. It made a
      // Dubai salon a United States business with a two-country market.
      if (localeCountry && !/^en[-_]US$/i.test(item.text.match(/:\s*([A-Za-z]{2}[-_][A-Za-z]{2})\s*$/)?.[1] ?? "")) {
        const country = countryFromCode(localeCountry);
        if (country) push({ code: country.code, name: country.name, level: "country", weight: 1.6, evidenceIds: [item.id], kinds: new Set(["og_locale"]), isHqOnly: false });
      }
      continue;
    }
    if (item.fieldHint !== "market") continue;

    // 3. hreflang set — the set of markets the business publishes for.
    if (item.sourceType === "hreflang") {
      const langTag = item.text.match(/hreflang\s+([a-z-]+)/i)?.[1]?.toLowerCase();
      if (!langTag || langTag === "x-default") continue;
      hreflangCodes.add(langTag);
      const regionCode = langTag.split("-")[1];
      if (regionCode) {
        const country = countryFromCode(regionCode);
        if (country) push({ code: country.code, name: country.name, level: "country", weight: 1.5, evidenceIds: [item.id], kinds: new Set(["hreflang"]), isHqOnly: false });
      }
      languages.add(langTag.split("-")[0]!);
      continue;
    }

    // 4. Structured addresses — real presence, but presence is not market.
    if (item.sourceType === "address") {
      const data = (item.data ?? {}) as { country?: string; region?: string; locality?: string; schemaType?: string; structured?: boolean };
      // A LocalBusiness-family address (HairSalon, Restaurant, Dentist) is the
      // storefront customers walk into, wherever on the site it is published.
      // Treating it as a contact-page HQ address discarded Atelier 10's Dubai.
      const storefront = Boolean(data.structured && data.schemaType && schemaFamilyOf(data.schemaType) === "local_business");
      if (storefront && data.locality) storefrontCities.add(data.locality);
      const isHqContext = !storefront && HQ_PHRASES.test(item.text);
      if (data.country) {
        const country = countryFromName(data.country);
        push({
          code: country?.code ?? null,
          name: country?.name ?? data.country,
          level: "country",
          // A location/store-locator page states market; a footer HQ address
          // on a contact page states presence.
          weight: item.pageType === "location" || item.pageType === "store_locator" ? 2.6 : 1.5,
          evidenceIds: [item.id],
          kinds: new Set(["schema_address"]),
          isHqOnly: !storefront && (isHqContext || item.pageType === "contact" || item.pageType === "about"),
        });
      }
      // A city only becomes a market when the address is a place the business
      // *serves* — a store, a branch, a clinic. The head-office address on a
      // contact or about page is presence, not market, and treating it as one
      // is how a global SaaS company ends up labelled "San Francisco".
      if (storefront || (!isHqContext && !HQ_ONLY_PAGE_TYPES.has(item.pageType))) {
        if (data.locality) {
          const list = cities.get(data.locality) ?? [];
          list.push(item.id);
          cities.set(data.locality, list);
        }
        if (data.region) {
          const list = regions.get(data.region) ?? [];
          list.push(item.id);
          regions.set(data.region, list);
        }
      } else if (data.locality) {
        hqCities.add(data.locality);
        const list = hqCityEvidence.get(data.locality) ?? [];
        list.push(item.id);
        hqCityEvidence.set(data.locality, list);
        if (data.region) {
          const regionList = hqRegionEvidence.get(data.region) ?? [];
          regionList.push(item.id);
          hqRegionEvidence.set(data.region, regionList);
        }
      }
      continue;
    }

    // 5. areaServed — an explicit, machine-readable market declaration.
    if (/areaServed:/i.test(item.text)) {
      const value = item.text.slice(item.text.indexOf(":") + 1).trim();
      const country = countryFromName(value);
      push({
        code: country?.code ?? null,
        name: country?.name ?? value,
        level: country ? "country" : guessLevel(value),
        weight: 3.0,
        evidenceIds: [item.id],
        kinds: new Set(["area_served"]),
        isHqOnly: false,
      });
      if (!serviceAreaDescription) serviceAreaDescription = value.slice(0, 160);
      continue;
    }

    // 6. Currency — what the storefront actually transacts in.
    if (item.sourceType === "currency") {
      const token = item.text.replace(/^(Currency|Offer priceCurrency):\s*/i, "");
      const matches = countryFromCurrency(token);
      // The euro maps to a dozen countries: it is a region signal, not a
      // country one, so it never names a single market on its own.
      if (matches.length === 1) {
        push({ code: matches[0]!.code, name: matches[0]!.name, level: "country", weight: 1.8, evidenceIds: [item.id], kinds: new Set(["currency"]), isHqOnly: false });
      }
      continue;
    }

    // 7. Phone country code, when unambiguous.
    if (item.sourceType === "phone") {
      const country = countryFromPhone(item.text);
      if (country) push({ code: country.code, name: country.name, level: "country", weight: 1.2, evidenceIds: [item.id], kinds: new Set(["phone"]), isHqOnly: false });
      continue;
    }

    // 8. Explicit statements in prose.
    if (item.sourceType === "main_content" || item.sourceType === "heading") {
      if (GLOBAL_PHRASES.test(item.text)) globalEvidence.push(item.id);
      if (NATIONAL_PHRASES.test(item.text)) nationalEvidence.push(item.id);
      const isHqStatement = HQ_PHRASES.test(item.text);
      for (const country of COUNTRIES) {
        const namePattern = new RegExp(`\\b(${[country.name, ...country.aliases].map(escapeRegExp).join("|")})\\b`, "i");
        if (!namePattern.test(item.text)) continue;
        push({
          code: country.code,
          name: country.name,
          level: "country",
          weight: isHqStatement ? 0.5 : 1.1,
          evidenceIds: [item.id],
          kinds: new Set([isHqStatement ? "prose_hq" : "prose_market"]),
          isHqOnly: isHqStatement,
        });
      }
      if (!serviceAreaDescription && /\b(serving|available in|ships? to|operating in)\b/i.test(item.text)) {
        serviceAreaDescription = item.text.slice(0, 200);
      }
    }
  }

  globalEvidence = [...new Set(globalEvidence)];
  nationalEvidence = [...new Set(nationalEvidence)];

  // A head-office city is only a market when it is ALL the business has told
  // us. A single-site clinic's contact address is its market; the same address
  // on a company that also declares `areaServed: India` or a broad hreflang set
  // is just where the office is.
  const hasIndependentMarketEvidence =
    signals.some((s) => !s.isHqOnly) || globalEvidence.length > 0 || nationalEvidence.length > 0 || hreflangCodes.size > 1;
  if (!hasIndependentMarketEvidence) {
    for (const [city, ids] of hqCityEvidence) {
      if (!cities.has(city)) cities.set(city, ids);
    }
    for (const [region, ids] of hqRegionEvidence) {
      if (!regions.has(region)) regions.set(region, ids);
    }
    hqCities.clear();
  }

  const byId = new Map(evidence.map((e) => [e.id, e]));
  const itemsFor = (ids: string[]) => ids.map((id) => byId.get(id)).filter((i): i is EvidenceItem => Boolean(i));

  // A market supported only by an HQ mention is presence, not market. Keep it,
  // but at low weight and flagged, rather than promoting it to primary.
  const ranked = signals
    .map((signal) => ({ signal, weight: signal.isHqOnly ? signal.weight * 0.35 : signal.weight }))
    .sort((a, b) => b.weight - a.weight);

  for (const { signal } of ranked) {
    if (signal.isHqOnly && ranked.length === 1) {
      warnings.push(`Only headquarters evidence found for ${signal.name}; market may be broader.`);
    }
  }

  // A locale tag alone never adds a country to the footprint.
  const distinctCountries = new Set(
    ranked.filter((r) => r.signal.level === "country" && !(r.signal.kinds.size === 1 && r.signal.kinds.has("og_locale"))).map((r) => r.signal.code ?? r.signal.name),
  );
  const hreflangCountryCount = new Set([...hreflangCodes].map((c) => c.split("-")[1]).filter(Boolean)).size;

  // "Explicit" means the business stated the country itself, rather than us
  // inferring it from an address block.
  const EXPLICIT_COUNTRY_KINDS = new Set(["area_served", "cctld", "locale_path"]);
  const hasExplicitCountryMarket = signals.some((s) => !s.isHqOnly && s.level === "country" && [...s.kinds].some((k) => EXPLICIT_COUNTRY_KINDS.has(k)));

  let scopeValue: MarketScope = "unknown";
  let scopeEvidence: string[] = [];
  if (globalEvidence.length > 0 || hreflangCountryCount >= 6) {
    scopeValue = "global";
    scopeEvidence = globalEvidence.length > 0 ? globalEvidence : ranked.filter((r) => r.signal.kinds.has("hreflang")).flatMap((r) => r.signal.evidenceIds).slice(0, 4);
  } else if (distinctCountries.size >= 2 || hreflangCountryCount >= 2) {
    scopeValue = "multi-country";
    scopeEvidence = ranked.slice(0, 3).flatMap((r) => r.signal.evidenceIds).slice(0, 4);
  } else if (nationalEvidence.length > 0) {
    scopeValue = "national";
    scopeEvidence = nationalEvidence;
  } else if (!multiSiteOrOnline && storefrontCities.size === 1 && cities.size === 1 && distinctCountries.size <= 1) {
    // A single storefront is local even on a country domain: `.ae` does not
    // make a DIFC salon a UAE-wide business.
    scopeValue = "local";
    scopeEvidence = [...cities.values()][0]?.slice(0, 3) ?? [];
  } else if (hasExplicitCountryMarket) {
    // An explicit `areaServed: India` or an India storefront outranks the one
    // city whose address happens to be published: the business is national.
    scopeValue = "national";
    scopeEvidence = ranked.find((r) => !r.signal.isHqOnly && r.signal.level === "country")?.signal.evidenceIds.slice(0, 3) ?? [];
  } else if (cities.size === 1 && distinctCountries.size <= 1) {
    scopeValue = "local";
    scopeEvidence = [...cities.values()][0]?.slice(0, 3) ?? [];
  } else if (cities.size > 1 && distinctCountries.size <= 1) {
    scopeValue = "regional";
    scopeEvidence = [...cities.values()].flat().slice(0, 4);
  } else if (distinctCountries.size === 1) {
    scopeValue = "national";
    scopeEvidence = ranked[0]?.signal.evidenceIds.slice(0, 3) ?? [];
  }

  const markets: Market[] = ranked.slice(0, 8).map(({ signal, weight }, index) => {
    const items = itemsFor(signal.evidenceIds);
    // A market with no evidence item (ccTLD/locale path are URL facts, not
    // page observations) still gets a real confidence, but a modest ceiling.
    const base = items.length > 0 ? computeConfidence({ items }) : 0;
    const structural = signal.kinds.has("cctld") || signal.kinds.has("locale_path") ? 72 : 0;
    return {
      name: signal.name,
      level: signal.level,
      countryCode: signal.code,
      confidence: Math.min(98, Math.max(base, structural, Math.round(Math.min(1, weight / 3.4) * 70))),
      evidenceIds: signal.evidenceIds.slice(0, 5),
      isPrimary: index === 0,
    };
  });

  if (scopeValue === "local" || scopeValue === "regional") {
    for (const [city, ids] of [...cities.entries()].slice(0, 5)) {
      if (markets.some((m) => m.name.toLowerCase() === city.toLowerCase())) continue;
      markets.push({
        name: city,
        level: "city",
        countryCode: null,
        confidence: computeConfidence({ items: itemsFor(ids) }),
        evidenceIds: ids.slice(0, 4),
        isPrimary: markets.length === 0,
      });
    }
  }

  if (markets.length === 0) {
    warnings.push("No market evidence found — geography left unset rather than guessed.");
  }
  for (const hqCity of hqCities) {
    if (markets.some((m) => m.name.toLowerCase() === hqCity.toLowerCase())) continue;
    warnings.push(`${hqCity} appears to be a head-office location rather than a market, so it was not added as one.`);
  }

  return {
    markets,
    scope: {
      value: scopeValue,
      confidence: scopeValue === "unknown" ? 0 : computeConfidence({ items: itemsFor(scopeEvidence), ceiling: 90 }) || (ccTld ? 65 : 40),
      evidenceIds: scopeEvidence.slice(0, 4),
    },
    languages: [...languages].slice(0, 8),
    cities: [...cities.keys()].slice(0, 12),
    regions: [...regions.keys()].slice(0, 12),
    countries: markets.filter((m) => m.level === "country").map((m) => m.name),
    serviceAreaDescription,
    warnings,
  };
}

function guessLevel(value: string): MarketLevel {
  if (/\b(worldwide|global|international)\b/i.test(value)) return "global";
  if (/\b(state|province|region|county|emirate)\b/i.test(value)) return "region";
  if (value.split(/[,;]/).length > 2) return "multi-country";
  return "region";
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}
