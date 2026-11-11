// Deterministic description synthesis.
//
// The description is assembled from fields that are already evidence-grounded
// — archetype phrasing + offerings + audience + market — rather than copied
// from `<meta description>` (which is marketing copy, often stale, and
// frequently absent) or free-written by a model.
//
// The result is deliberately plain: "Online retailer providing athletic
// footwear, apparel and sports equipment for consumers and athletes in India."
// Every clause maps to a field that carries its own evidence ids, so the
// description inherits real provenance instead of asserting one.

import type { BusinessArchetype, Market, Offering } from "./schema";

/** How each archetype describes what it does, in a competitor-neutral way. */
const ARCHETYPE_PHRASING: Record<BusinessArchetype, { noun: string; verb: string }> = {
  ecommerce_dtc_retail: { noun: "Online retailer", verb: "selling" },
  b2b_saas_enterprise: { noun: "Software company", verb: "providing" },
  local_service: { noun: "Local service business", verb: "providing" },
  dealership: { noun: "Vehicle dealership", verb: "selling and servicing" },
  restaurant_food_chain: { noun: "Restaurant business", verb: "serving" },
  multi_location_chain: { noun: "Multi-location business", verb: "providing" },
  healthcare: { noun: "Healthcare provider", verb: "providing" },
  finance: { noun: "Financial services provider", verb: "offering" },
  marketplace: { noun: "Online marketplace", verb: "connecting buyers and sellers of" },
  travel_hospitality: { noun: "Hospitality business", verb: "providing" },
  education: { noun: "Education provider", verb: "offering" },
  other: { noun: "Business", verb: "providing" },
};

export interface DescriptionInput {
  brandName: string;
  archetype: BusinessArchetype;
  industrySector: string;
  industryCategory: string | null;
  offerings: Offering[];
  audiences: string[];
  markets: Market[];
  marketScope: string;
}

export interface BuiltDescription {
  text: string;
  /** Field paths whose evidence backs this description. */
  derivedFrom: string[];
}

export function buildDescription(input: DescriptionInput): BuiltDescription {
  const derivedFrom: string[] = [];
  const hasAnySubstance =
    input.archetype !== "other" ||
    Boolean(input.industryCategory) ||
    input.offerings.some((o) => o.confidence >= 35) ||
    input.markets.some((m) => m.confidence >= 40);
  // A description assembled from nothing would read "Business." — a sentence
  // with no information and, worse, no evidence to cite. An empty description
  // is the honest output; the UI shows it as "not enough evidence yet".
  if (!hasAnySubstance) return { text: "", derivedFrom: [] };
  const { noun, verb } = ARCHETYPE_PHRASING[input.archetype] ?? ARCHETYPE_PHRASING.other;

  const subject = input.archetype === "other" && input.industryCategory ? `${input.industryCategory} business` : noun;
  if (input.archetype !== "other") derivedFrom.push("archetype");
  if (input.industryCategory) derivedFrom.push("industry");

  const offeringNames = input.offerings
    .filter((o) => o.confidence >= 35)
    .slice(0, 4)
    .map((o) => o.name.toLowerCase());
  const offeringClause = offeringNames.length > 0 ? ` ${verb} ${joinList(offeringNames)}` : input.industryCategory ? ` operating in ${input.industryCategory.toLowerCase()}` : "";
  if (offeringNames.length > 0) derivedFrom.push("offerings");

  const audienceClause = input.audiences.length > 0 ? ` for ${joinList(input.audiences.slice(0, 2).map((a) => a.toLowerCase()))}` : "";
  if (audienceClause) derivedFrom.push("targetAudience");

  const marketClause = buildMarketClause(input.markets, input.marketScope);
  if (marketClause) derivedFrom.push("markets");

  const first = `${subject}${offeringClause}${audienceClause}${marketClause}.`.replace(/\s+/g, " ").trim();

  // A second sentence only earns its place when it adds a fact the first
  // could not carry.
  const remaining = input.offerings.filter((o) => o.confidence >= 35).slice(4, 7).map((o) => o.name.toLowerCase());
  const second = remaining.length >= 2 ? ` Its catalogue also covers ${joinList(remaining)}.` : "";

  return { text: capitalize(`${first}${second}`).slice(0, 400), derivedFrom: [...new Set(derivedFrom)] };
}

function buildMarketClause(markets: Market[], scope: string): string {
  if (scope === "global") return " serving customers globally";
  const named = markets.filter((m) => m.confidence >= 40);
  if (named.length === 0) return "";
  const primary = named.filter((m) => m.isPrimary).slice(0, 1);
  const chosen = primary.length > 0 ? primary : named.slice(0, 1);
  if (scope === "multi-country") {
    const countries = named.filter((m) => m.level === "country").slice(0, 3);
    if (countries.length >= 2) return ` operating in ${joinList(countries.map((m) => m.name))}`;
  }
  if (scope === "local" || scope === "regional") {
    const cityMarkets = named.filter((m) => m.level === "city").slice(0, 2);
    if (cityMarkets.length > 0) return ` serving ${joinList(cityMarkets.map((m) => m.name))}`;
  }
  return ` in ${chosen[0]!.name}`;
}

function joinList(values: string[]): string {
  const unique = [...new Set(values)];
  if (unique.length === 0) return "";
  if (unique.length === 1) return unique[0]!;
  if (unique.length === 2) return `${unique[0]} and ${unique[1]}`;
  return `${unique.slice(0, -1).join(", ")} and ${unique[unique.length - 1]}`;
}

function capitalize(value: string): string {
  return value.charAt(0).toUpperCase() + value.slice(1);
}

/** Words a factual profile description should never contain. */
const HYPE_TERMS = [
  "revolutionary",
  "world-leading",
  "world class",
  "world-class",
  "best-in-class",
  "cutting-edge",
  "game-changing",
  "transforming the future",
  "unparalleled",
  "unmatched",
  "seamlessly",
  "empowering",
  "passionate about",
  "one-stop shop",
  "leading provider",
  "market leader",
  "industry-leading",
  "premier destination",
  "trusted partner",
];

export function containsHype(text: string): string[] {
  const lower = text.toLowerCase();
  return HYPE_TERMS.filter((term) => lower.includes(term));
}

export function stripHype(text: string): string {
  let out = text;
  for (const term of HYPE_TERMS) {
    out = out.replace(new RegExp(`\\b${term.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\b\\s*`, "gi"), "");
  }
  return out.replace(/\s{2,}/g, " ").replace(/\s+([.,])/g, "$1").trim();
}
