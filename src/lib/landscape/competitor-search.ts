// Search-grounded competitor discovery.
//
// Atelier 10, a luxury salon in DIFC, got "Lash Extensions" (a phrase from its
// own "Lash Lift vs Lash Extensions" article) as its only competitor, while the
// real DIFC salons a customer would weigh were either never proposed or were
// rejected because their websites did not say "serving Dubai". No source could
// see the local market: the model guessed from memory, Wikidata has no entries
// for neighbourhood salons, and the web-search seam was disabled.
//
// This source asks a search-grounded model the question a customer asks —
// "hair salon in DIFC", "best Russian manicure near Business Bay" — anchored to
// the confirmed location, and returns businesses with the area they are in and
// the page that says so. It uses provider search APIs (Google Search grounding
// or OpenAI web search), never scraping of search-result pages. Everything it
// returns is still verified against the candidate's own website and scored.

import { z } from "zod";
import { webSearch } from "@/lib/llm";
import { countryPhrase } from "@/lib/geo/countries";
import type { CompetitiveSearchProfile, CompetitorCandidate, CompetitorCandidateSource } from "./competitor-types";
import { planFromSearchProfile } from "./competitor-tiers";
import type { CompetitorTier } from "./tier-types";

const SearchCandidate = z.object({
  name: z.string().min(2).max(100),
  website: z.string().max(200).nullable().optional(),
  area: z.string().max(100).nullable().optional(),
  city: z.string().max(100).nullable().optional(),
  country: z.string().max(100).nullable().optional(),
  type: z.enum(["direct", "substitute", "marketplace"]).catch("direct"),
  priceLevel: z.string().max(40).nullable().optional(),
  why: z.string().min(5).max(400),
  evidenceUrl: z.string().max(500).nullable().optional(),
});

const SearchResponse = z.object({ competitors: z.array(z.unknown()) });

const SEARCH_SCHEMA = {
  type: "object",
  properties: {
    competitors: {
      type: "array",
      items: {
        type: "object",
        properties: {
          name: { type: "string" },
          website: { type: ["string", "null"], description: "Registrable domain seen in the results, e.g. example.com. Null if not seen." },
          area: { type: ["string", "null"], description: "Neighbourhood, district or area the business is in." },
          city: { type: ["string", "null"] },
          country: { type: ["string", "null"] },
          type: { type: "string", enum: ["direct", "substitute", "marketplace"] },
          priceLevel: { type: ["string", "null"], description: "budget, mid_market, premium, luxury or null." },
          why: { type: "string", description: "One factual sentence: why a customer of the target would consider it." },
          evidenceUrl: { type: ["string", "null"], description: "A result page that shows this business and its location." },
        },
        required: ["name", "website", "area", "city", "country", "type", "priceLevel", "why", "evidenceUrl"],
        additionalProperties: false,
      },
    },
  },
  required: ["competitors"],
  additionalProperties: false,
};

function list(values: Array<string | null | undefined>, max: number): string[] {
  return [...new Set(values.map((v) => v?.trim()).filter((v): v is string => Boolean(v)))].slice(0, max);
}

export interface SearchBrief {
  tier: CompetitorTier | null;
  task: string;
  userLocation?: { country?: string; city?: string; region?: string };
  /** Most results kept from this brief. */
  limit: number;
}

function compact(lines: string[]): string {
  return lines.filter((line, i, all) => line !== "" || (i > 0 && all[i - 1] !== "")).join("\n").trim();
}

const JSON_LINE = 'Answer with JSON only: {"competitors": [{"name", "website", "area", "city", "country", "type", "priceLevel", "why", "evidenceUrl"}]}.';

/**
 * One natural-language search brief per planned tier. Exported for tests.
 *
 * A single brief ("prefer DIFC, then elsewhere in Dubai, only outside Dubai if
 * customers travel") never asked for city-wide or country-wide rivals, so a
 * local salon's list held only neighbourhood names and a well-known national
 * chain was never looked for. Each tier now gets its own question, the way a
 * customer asks it at that level.
 */
export function buildSearchTasks(profile: CompetitiveSearchProfile): SearchBrief[] {
  const u = profile.understanding;
  const category = u?.localCategory || u?.businessType || profile.subIndustry || profile.industry;
  if (!category) return [];
  const plan = planFromSearchProfile(profile);
  const geo = profile.geography;
  const cat = category.toLowerCase();
  const offerings = u?.offeringGroups.length
    ? u.offeringGroups.slice(0, 6).map((g) => `${g.name} (${g.items.slice(0, 4).join(", ")})`)
    : profile.offerings.slice(0, 10);
  const audiences = list([...(u?.audienceSegments ?? []), ...profile.targetAudiences], 4);
  const price = u?.pricePositioning && u.pricePositioning !== "unknown" ? u.pricePositioning.replace(/_/g, " ") : null;
  const placeBound = u?.placeBound ?? ["local_service", "restaurant_food_chain", "dealership", "healthcare", "multi_location_chain"].includes(profile.businessArchetype);
  const target = `${profile.targetBrand}${profile.canonicalDomain ? ` (${profile.canonicalDomain})` : ""}`;
  const area = plan.tiers.find((spec) => spec.tier === "area");
  const city = plan.tiers.find((spec) => spec.tier === "city");
  const country = plan.tiers.find((spec) => spec.tier === "country");
  const cityName = city?.place ?? geo.cities[0] ?? null;
  const countryCode = country?.countryCodes[0] ?? geo.countryCode ?? null;
  const countryText = country && country.level !== "global" ? countryPhrase(country.place) : geo.countries[0] ? countryPhrase(geo.countries[0]) : null;
  const localWhere = [area && area.place !== "Nearby" ? area.place : null, cityName, geo.countries[0] ?? null].filter(Boolean).join(", ");
  const describe = `${profile.targetBrand} is a ${price ? `${price} ` : ""}${cat}${localWhere && placeBound ? ` in ${localWhere}` : ""}${placeBound && geo.formattedAddress ? ` (address: ${geo.formattedAddress})` : ""}.`;
  const common = [offerings.length > 0 ? `It offers: ${offerings.join("; ")}.` : "", audiences.length > 0 ? `Its customers include: ${audiences.join("; ")}.` : ""];
  const noSelf = `Do not include ${profile.targetBrand} itself or its other branches. Only give a website when you saw it in the results; never guess one.`;
  const localLocation = countryCode ? { country: countryCode, ...(cityName ? { city: cityName } : {}), ...(geo.regions[0] ? { region: geo.regions[0] } : {}) } : undefined;
  const briefs: SearchBrief[] = [];

  if (area) {
    const nearby = area.places.slice(1, 6);
    const named = area.place !== "Nearby";
    const here = named ? area.place : `the area around ${geo.formattedAddress ?? profile.targetBrand}`;
    briefs.push({
      tier: "area",
      limit: 8,
      userLocation: localLocation,
      task: compact([
        `Find real, currently operating businesses in ${here}${nearby.length > 0 ? ` and the nearby areas (${nearby.join(", ")})` : ""} that compete with ${target} for the same customers.`,
        describe,
        ...common,
        "",
        "Search the way a local customer would, for example:",
        `- "${cat} in ${named ? area.place : cityName ?? "this area"}"`,
        nearby.length > 0 ? `- "${cat} near ${nearby[0]}"` : "",
        offerings[0] ? `- "best ${(u?.offeringGroups[0]?.items[0] ?? profile.offerings[0] ?? category).toLowerCase()} ${named ? area.place : cityName ?? ""}"`.replace(/ "$/, '"') : "",
        "",
        `Return up to 8 businesses of the same kind in ${here}${nearby.length > 0 ? " or those nearby areas" : ""}, most relevant first (type direct), plus businesses of a different kind that solve the same need (type substitute), plus up to 2 booking platforms or directories customers use to choose (type marketplace).`,
        cityName ? `Do not include businesses elsewhere in ${cityName}.` : "",
        price ? `Favour a similar price level (${price}), but include strong alternatives at other price levels.` : "",
        `${noSelf} Give the area and city for each.`,
        "",
        JSON_LINE,
      ]),
    });
  }

  if (city) {
    const cities = city.places;
    const inArea = area && area.place !== "Nearby" ? ` in ${area.place}` : "";
    briefs.push({
      tier: "city",
      limit: 8,
      userLocation: localLocation,
      task: compact([
        `Find businesses across ${city.place}${cities.length > 1 ? ` (and in ${cities.slice(1).join(", ")})` : ""} that a customer of a ${price ? `${price} ` : ""}${cat}${inArea} would also consider instead of ${target}.`,
        describe,
        ...common,
        "",
        `Search the way a customer choosing anywhere in the city would ("best ${cat} in ${city.place}", "top rated ${cat} ${city.place}").`,
        `Return up to 8: the most recommended and best-known ${cat} businesses across ${city.place}, including chains with a branch in ${city.place}, most relevant first (type direct), plus businesses of a different kind that solve the same need (type substitute).`,
        price ? `Favour a similar price level (${price}), but include strong alternatives at other price levels.` : "",
        `${noSelf} Give the area and city for each.`,
        "",
        JSON_LINE,
      ]),
    });
  }

  if (country || plan.tiers.length === 0) {
    const global = country?.level === "global" || geo.scope === "global";
    const market = global ? "worldwide" : countryText ? `in ${countryText}` : "in its main market";
    if (placeBound && country && !global && countryText) {
      briefs.push({
        tier: "country",
        limit: 8,
        userLocation: countryCode ? { country: countryCode } : undefined,
        task: compact([
          `Find the chains and well-known ${cat} brands that customers across ${countryText} compare with ${target}: businesses with several locations or national reach.`,
          `${profile.targetBrand} is a ${price ? `${price} ` : ""}${cat}.`,
          ...common,
          "",
          `Search the way a customer would ("best ${cat} chains in ${countryText}", "${cat} brands ${countryText}").`,
          `Return up to 8 chains or brands across ${countryText}, most relevant first (type direct), plus businesses of a different kind that solve the same need (type substitute).`,
          `${noSelf} Give the country for each, and a city when the business has one main location.`,
          "",
          JSON_LINE,
        ]),
      });
    } else {
      briefs.push({
        tier: country ? "country" : null,
        limit: 12,
        userLocation: global || !countryCode ? undefined : { country: countryCode },
        task: compact([
          `Find the companies and brands that compete with ${target} for the same customers ${market}.`,
          `${profile.targetBrand} is a ${price ? `${price} ` : ""}${cat}${u?.path.length ? ` (${u.path.join(" › ")})` : ""}.`,
          u?.description ? `Summary: ${u.description}` : "",
          ...common,
          "",
          `Search the way a buyer would ("best ${cat}", "${profile.targetBrand} alternatives", "${cat} for ${audiences[0] ?? "customers"}") and use comparison and review pages.`,
          "Return up to 12 competitors a buyer would realistically shortlist instead, most relevant first (type direct), plus products of a different kind that solve the same need (type substitute), plus up to 2 marketplaces or review sites buyers use to choose (type marketplace).",
          `Do not include ${profile.targetBrand} itself, its sub-brands, suppliers, partners or integrations. Only give a website when you saw it in the results; never guess one.`,
          "",
          JSON_LINE,
        ]),
      });
    }
  }
  return briefs;
}

function domainOf(value: string | null | undefined): string | null {
  if (!value) return null;
  const trimmed = value.trim().toLowerCase();
  if (!trimmed || /\s/.test(trimmed)) return null;
  try {
    const url = new URL(/^https?:\/\//.test(trimmed) ? trimmed : `https://${trimmed}`);
    const host = url.hostname.replace(/^www\./, "");
    // Search-redirect and social hosts are not the business's own website.
    if (/(^|\.)(google\.[a-z.]+|vertexaisearch\.cloud\.google\.com|instagram\.com|facebook\.com|tiktok\.com|linkedin\.com|x\.com|twitter\.com|youtube\.com|maps\.app\.goo\.gl|goo\.gl|wa\.me)$/.test(host)) return null;
    return host.includes(".") ? host : null;
  } catch {
    return null;
  }
}

export class GroundedSearchCandidateSource implements CompetitorCandidateSource {
  readonly sourceType = "web_search" as const;

  constructor(private readonly options: { projectId?: string } = {}) {}

  async discover(profile: CompetitiveSearchProfile): Promise<CompetitorCandidate[]> {
    const briefs = buildSearchTasks(profile);
    if (briefs.length === 0) return [];
    // Briefs run in parallel and fail independently: a 429 on one tier's
    // search must not cost the other tiers their results.
    const lists = await Promise.all(briefs.map((brief) => this.runBrief(profile, brief).catch(() => [] as CompetitorCandidate[])));
    return lists.flat();
  }

  private async runBrief(profile: CompetitiveSearchProfile, brief: SearchBrief): Promise<CompetitorCandidate[]> {
    const result = await webSearch({
      stage: "search",
      task: brief.task,
      userLocation: brief.userLocation,
      contextSize: "medium",
      schema: SEARCH_SCHEMA,
      schemaName: "competitor_search",
      projectId: this.options.projectId,
      maxOutputTokens: 6000,
    });
    if (!result.ok) return [];
    const parsed = SearchResponse.safeParse(result.data);
    if (!parsed.success) return [];
    const placeBound = profile.understanding?.placeBound ?? false;
    const out: CompetitorCandidate[] = [];
    for (const [rank, raw] of parsed.data.competitors.entries()) {
      const item = SearchCandidate.safeParse(raw);
      if (!item.success) continue;
      const c = item.data;
      const domain = domainOf(c.website);
      const evidenceUrl = c.evidenceUrl && /^https?:\/\//.test(c.evidenceUrl) ? c.evidenceUrl : null;
      const areaText = [c.area, c.city].filter(Boolean).join(", ");
      const dimensions = [
        profile.understanding?.localCategory || profile.understanding?.businessType || profile.subIndustry || "same category",
        ...(areaText ? [`located in ${areaText}`] : []),
        ...(c.priceLevel ? [`price level: ${c.priceLevel}`] : []),
      ];
      out.push({
        canonicalName: c.name.trim(),
        likelyDomain: domain,
        proposedType: c.type,
        entityType: placeBound && c.type !== "marketplace" && brief.tier !== "country" ? "local_location" : "company",
        parentName: null,
        reason: c.why.trim(),
        matchedDimensions: dimensions.slice(0, 4),
        // Earlier results are what a searcher sees first. Search evidence is
        // stronger than a model's memory but weaker than a verified website.
        confidence: Math.max(45, 72 - rank * 2),
        // Found by a same-category search anchored to the target's place: that
        // is market-structure evidence, not word overlap.
        structuralAffinity: c.type === "direct" ? Math.max(50, 78 - rank * 2) : c.type === "substitute" ? 45 : undefined,
        evidence: [{ source: this.sourceType, reason: `${c.why.trim()}${evidenceUrl ? ` Source: ${evidenceUrl}` : ""}`, evidenceIds: [], discoveredAt: Date.now() }],
        aliases: [],
        location: { area: c.area ?? null, city: c.city ?? null, country: c.country ?? null },
        sourceUrls: list([evidenceUrl], 1),
        ...(brief.tier ? { tierHint: [{ tier: brief.tier, source: this.sourceType }] } : {}),
      });
      if (out.length >= brief.limit) break;
    }
    return out;
  }
}
