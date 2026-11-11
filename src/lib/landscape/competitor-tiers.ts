// Geographic competitor tiers: which levels a business competes at, the
// "known brand" signal, where each rival competes, and how suggestion slots are
// shared between the levels.
//
// Operators asked for competitors "area-wise for strictly local businesses,
// city-wise for almost everything, country-wide for businesses catering to the
// whole country or known brands, possibly all three" (feedback 2026-09-14).
// Before tiers, geography was one 0-100 score: city-wide rivals always ranked
// below neighbourhood ones and fell out of the top 16, and a well-known
// national chain was rejected outright for a local target. Tiers make
// membership carry geography, so ranking happens within a level.
//
// Pure and client-safe: no network, no database.

import type { BusinessProfile } from "@/lib/profile/schema";
import { PLACE_BOUND_KINDS, type BusinessKind } from "@/lib/understanding/kinds";
import { marketCountries } from "@/lib/understanding/market-countries";
import { isAreaLevel, marketAreaOf } from "@/lib/understanding/market-area";
import { countryCodeFrom, countryCodeFromHostname, countryName, countryPhrase } from "@/lib/geo/countries";
import { isCountryCode } from "@/lib/geo/iso3166";
import type { CandidateBusinessProfile, CompetitiveSearchProfile, CompetitorCandidate, RankedCompetitorCandidate, TierHint } from "./competitor-types";
import {
  COMPETITOR_TIER_POLICY_VERSION,
  type BrandReach,
  type CompetitorTier,
  type CompetitorTierPlan,
  type LandscapeTierPlanDto,
  type StoredCompetitorTier,
  type TierAssignment,
  type TierBasis,
  type TierLevel,
  type TierSpec,
} from "./tier-types";

export { COMPETITOR_TIER_POLICY_VERSION };

export const TIER_ORDER: CompetitorTier[] = ["area", "city", "country"];
export const AREA_RADIUS_METERS = 3_000;
const CITY_RADIUS_METERS = 25_000;
const LOCAL_SCOPES = new Set(["hyperlocal", "local"]);
const WIDE_SCOPES = new Set(["regional", "national", "international", "multi-country", "global"]);
// Archetype-era place-bound families, for profiles without a classification.
const LEGACY_PLACE_BOUND_ARCHETYPES = new Set(["local_service", "dealership", "restaurant_food_chain", "healthcare"]);

// --- Place matching ---------------------------------------------------------

function placeKey(value: string | null | undefined): string {
  return (value ?? "").normalize("NFKD").replace(/[\u0300-\u036f]/g, "").toLowerCase().replace(/[^\p{L}\p{N}]+/gu, " ").trim();
}

function sameName(a: string | null | undefined, b: string | null | undefined): boolean {
  const x = placeKey(a);
  return Boolean(x && x === placeKey(b));
}

/**
 * `value` names `place`, or a named part of it that starts with the place's
 * name: "Dubai Marina" is in Dubai, "DIFC Gate Village" is in DIFC. Each
 * comma-separated part counts on its own ("Emirates Financial Towers, DIFC").
 *
 * Never the reverse, and never a name that merely ends with the place: when
 * either name could contain the other, a rival reported only as "Dubai" landed
 * in the "In DIFC" group as "Located in Downtown Dubai", and one in New York
 * landed in "Across York" (review of the tier change, 2026-09-14).
 */
export function placeIsWithin(value: string | null | undefined, place: string | null | undefined): boolean {
  const p = placeKey(place);
  if (!p || !value) return false;
  return value.split(/[,;]/).some((part) => {
    const v = placeKey(part);
    return Boolean(v && (v === p || v.startsWith(`${p} `)));
  });
}

/** Whole-word containment either way ("Downtown Dubai" / "Dubai"): a name that may be local, not proof that it is. */
function placesOverlap(a: string | null | undefined, b: string | null | undefined): boolean {
  const x = placeKey(a);
  const y = placeKey(b);
  return Boolean(x && y && (x === y || ` ${x} `.includes(` ${y} `) || ` ${y} `.includes(` ${x} `)));
}

function firstMatch(places: string[], values: Array<string | null | undefined>): string | null {
  for (const value of values) {
    if (!value) continue;
    const hit = places.find((place) => placeIsWithin(value, place));
    if (hit) return hit;
  }
  return null;
}

function unique(values: Array<string | null | undefined>): string[] {
  const out: string[] = [];
  for (const value of values) {
    const trimmed = value?.trim();
    if (trimmed && !out.some((existing) => placeKey(existing) === placeKey(trimmed))) out.push(trimmed);
  }
  return out;
}

function joinNames(names: string[]): string {
  if (names.length <= 1) return names[0] ?? "";
  return `${names.slice(0, -1).join(", ")} and ${names.at(-1)}`;
}

function formatDistance(meters: number): string {
  return meters >= 1000 ? `${(meters / 1000).toFixed(1)} km` : `${Math.round(meters)} m`;
}

// --- Plan -------------------------------------------------------------------

/** Everything the planner reads, from either a full profile or a search profile. */
interface PlanInput {
  legacy: boolean;
  placeBound: boolean;
  kind: string | null;
  scope: string;
  primaryRole: string;
  physicalPresence: string;
  neighborhood: string | null;
  nearbyAreas: string[];
  hasCoordinates: boolean;
  city: string | null;
  otherCities: string[];
  hasCityServiceArea: boolean;
  countryCodes: string[];
  /** Display names, aligned with codes first, then names that have no code. */
  countryNames: string[];
  /** The operator chose one area of a multi-location business to measure around. */
  marketAreaChosen?: boolean;
}

function countriesFrom(codes: Array<string | null | undefined>, names: Array<string | null | undefined>): { codes: string[]; names: string[] } {
  const outCodes: string[] = [];
  const outNames: string[] = [];
  for (const raw of codes) {
    const code = raw ? (isCountryCode(raw) ? raw.trim().toUpperCase() : countryCodeFrom(raw)) : null;
    if (!code || outCodes.includes(code)) continue;
    outCodes.push(code);
    outNames.push(countryName(code) ?? code);
  }
  for (const name of names) {
    if (!name?.trim()) continue;
    const code = countryCodeFrom(name);
    if (code) {
      if (!outCodes.includes(code)) {
        outCodes.push(code);
        outNames.push(countryName(code) ?? name.trim());
      }
    } else if (!outNames.some((existing) => sameName(existing, name))) {
      outNames.push(name.trim());
    }
  }
  return { codes: outCodes, names: outNames };
}

/**
 * Branches in the home country. The city tier is "Across Dubai" with the
 * business's other cities as extra places; a Dubai chain's Riyadh branch put a
 * Riyadh rival under "Across Dubai" as "Located in Riyadh". Branches in other
 * countries belong to the country tier, if any.
 */
export function homeCountryBranches<T extends { countryCode?: string | null }>(branches: T[], homeCode: string | null): T[] {
  const home = homeCode?.trim().toUpperCase();
  return home ? branches.filter((branch) => !branch.countryCode || branch.countryCode.trim().toUpperCase() === home) : branches;
}

function inputFromSearch(search: CompetitiveSearchProfile): PlanInput {
  const geo = search.geography;
  const u = search.understanding;
  const countries = countriesFrom([geo.countryCode], geo.countries);
  const city = geo.cities[0] ?? geo.serviceAreaCities?.[0] ?? geo.branchCities?.[0] ?? null;
  return {
    legacy: !u,
    placeBound: u?.placeBound ?? LEGACY_PLACE_BOUND_ARCHETYPES.has(search.businessArchetype),
    kind: u?.kind ?? null,
    scope: geo.scope,
    primaryRole: geo.primaryRole ?? "unknown",
    physicalPresence: u?.physicalPresence ?? "unknown",
    neighborhood: geo.neighborhoods?.[0] ?? null,
    nearbyAreas: geo.nearbyAreas ?? [],
    hasCoordinates: typeof geo.lat === "number" && typeof geo.lng === "number",
    city,
    otherCities: unique([...(geo.branchCities ?? []), ...(geo.serviceAreaCities ?? [])]).filter((name) => !sameName(name, city)),
    hasCityServiceArea: (geo.serviceAreaCities ?? []).length > 0,
    countryCodes: countries.codes,
    countryNames: countries.names,
  };
}

function inputFromProfile(profile: BusinessProfile, search: CompetitiveSearchProfile): PlanInput {
  const base = inputFromSearch(search);
  const location = profile.location;
  const classification = profile.classification;
  const primary = location?.primary ?? null;
  const market = marketCountries(profile);
  const countries = market.all.length > 0 ? countriesFrom(market.all, []) : { codes: base.countryCodes, names: base.countryNames };
  const serviceAreaCities = unique((location?.serviceAreas ?? []).filter((area) => area.level === "city").map((area) => area.name));
  const branchCities = unique(homeCountryBranches(location?.branches ?? [], primary?.countryCode ?? countries.codes[0] ?? null).map((branch) => branch.city));
  const city = primary?.city ?? serviceAreaCities[0] ?? branchCities[0] ?? (location ? null : base.city);
  const marketArea = marketAreaOf(profile);
  const chosenArea = isAreaLevel(marketArea) && (marketArea.source === "operator" || marketArea.source === "user") ? marketArea.name : null;
  return {
    legacy: !classification && !location,
    placeBound: classification ? PLACE_BOUND_KINDS.has(classification.kind as BusinessKind) && classification.physicalPresence !== "online_only" : base.placeBound,
    kind: classification?.kind ?? base.kind,
    scope: profile.marketScope.value,
    primaryRole: location?.primaryRole ?? "unknown",
    physicalPresence: classification?.physicalPresence ?? "unknown",
    // The operator's chosen area of a chain ("JVC" for a four-branch restaurant)
    // is the area rivals are compared around; the city stays the city.
    neighborhood: chosenArea ?? primary?.neighborhood ?? (location ? null : base.neighborhood),
    marketAreaChosen: Boolean(chosenArea),
    nearbyAreas: location?.nearbyAreas ?? base.nearbyAreas,
    hasCoordinates: typeof primary?.lat === "number" && typeof primary?.lng === "number",
    city: city ?? base.city,
    otherCities: unique([...branchCities, ...serviceAreaCities]).filter((name) => !sameName(name, city ?? base.city)),
    hasCityServiceArea: serviceAreaCities.length > 0,
    countryCodes: countries.codes,
    countryNames: countries.names,
  };
}

function quotasFor(tiers: CompetitorTier[], input: PlanInput): number[] {
  const key = tiers.join("+");
  if (tiers.length === 3) return [6, 6, 6];
  if (key === "area+city") return input.scope === "hyperlocal" ? [8, 8] : [6, 10];
  if (key === "city+country") return input.scope === "national" && input.placeBound && input.primaryRole !== "headquarters" ? [6, 10] : [8, 8];
  if (tiers.length === 2) return [8, 8];
  return tiers.length === 1 ? [16] : [];
}

function planFromInput(input: PlanInput, reach: BrandReach): CompetitorTierPlan {
  const scope = input.scope;
  const local = LOCAL_SCOPES.has(scope);
  const wide = WIDE_SCOPES.has(scope);
  const global = scope === "global";
  const onlineOnly = input.physicalPresence === "online_only";
  // Software is sold online whatever its office address says (D3).
  const software = input.kind === "b2b_saas_software";
  const specs: TierSpec[] = [];

  // Area: customers come to one storefront in a named neighbourhood (or at
  // known coordinates). A service-area business or a multi-location chain has
  // no single area to compare around. Kinds that are not place-bound get one
  // only when the market is strictly hyperlocal.
  const hasArea =
    !input.legacy &&
    (input.placeBound ? local : scope === "hyperlocal" && !onlineOnly && !software) &&
    (input.primaryRole === "storefront" || input.primaryRole === "unknown") &&
    input.physicalPresence !== "service_area" &&
    (input.physicalPresence !== "multi_location" || input.marketAreaChosen === true) &&
    Boolean(input.neighborhood || input.hasCoordinates);
  if (hasArea) {
    const named = Boolean(input.neighborhood);
    specs.push({
      tier: "area",
      place: input.neighborhood ?? "Nearby",
      places: named ? unique([input.neighborhood, ...input.nearbyAreas]) : [],
      level: "neighborhood",
      countryCodes: input.countryCodes.slice(0, 1),
      quota: 0,
      radiusMeters: AREA_RADIUS_METERS,
    });
  }

  // City: almost every business customers reach in a city. Not online-only or
  // software businesses, and not a national chain's head-office city: Greggs
  // would get "Across Newcastle upon Tyne", which is where its office is, not
  // where its customers are (prompts/geography.ts refuses the same city).
  // Kinds that are not place-bound qualify on scope alone, whatever the
  // address role: an agency or tour operator whose operator named DIFC got
  // only "Across the United Arab Emirates" while its prompts asked about Dubai,
  // and a DIFC office address (role headquarters) kept doing so (review,
  // 2026-09-14). The head-office exclusion is for national chains only.
  let hasCity = false;
  if (input.city && !onlineOnly && !software) {
    if (input.legacy) hasCity = input.placeBound && (local || scope === "regional" || scope === "unknown");
    else
      hasCity =
        local ||
        scope === "regional" ||
        (input.placeBound && scope === "unknown") ||
        // A place-bound business with venues is compared in its city whatever
        // its scope: REIF (venues in Dubai and Cairo, scope international) got
        // only "Across the United Arab Emirates and Egypt" and Cairo sushi chains.
        (input.placeBound && ["national", "international", "multi-country"].includes(scope) && input.primaryRole !== "headquarters") ||
        ((input.physicalPresence === "service_area" || (input.placeBound && input.hasCityServiceArea)) && input.primaryRole !== "headquarters" && !(wide && scope !== "regional"));
  }
  if (hasCity && input.city) {
    specs.push({
      tier: "city",
      place: input.city,
      places: unique([input.city, ...input.otherCities.slice(0, 3)]),
      level: "city",
      countryCodes: input.countryCodes.slice(0, 1),
      quota: 0,
    });
  }

  // Country: businesses that sell across the country (or wider), and known
  // brands whose customers compare them with national names. A business with
  // no local tier competes at country level by default.
  const countryKnown = input.countryNames.length > 0;
  const hasLocal = specs.length > 0;
  let hasCountry = false;
  if (global) hasCountry = true;
  else if (countryKnown) hasCountry = input.legacy ? !hasLocal || wide : wide || reach.known || !hasLocal;
  if (hasCountry) {
    if (global) {
      specs.push({ tier: "country", place: "Worldwide", places: [], level: "global", countryCodes: [], quota: 0 });
    } else {
      // Guests of a restaurant group compare it within their own country, so a
      // place-bound business with venues abroad (international) gets its market
      // country only; a regional chain's region (GCC branches) stays whole.
      const count = scope === "regional" || (!input.placeBound && ["international", "multi-country"].includes(scope)) ? 3 : 1;
      const names = input.countryNames.slice(0, count);
      specs.push({ tier: "country", place: joinNames(names), places: names, level: "country", countryCodes: input.countryCodes.slice(0, count), quota: 0 });
    }
  }

  // City-states: "Across Singapore" twice is one group, as in prompts. Exact
  // names only: "Mexico City" is not Mexico.
  const citySpec = specs.find((spec) => spec.tier === "city");
  const countrySpec = specs.find((spec) => spec.tier === "country");
  if (citySpec && countrySpec && countrySpec.level === "country") {
    const cityAsCountry = countryCodeFrom(citySpec.place);
    const sameName = countrySpec.places.some((name) => placeKey(name) === placeKey(citySpec.place));
    if (countrySpec.places.length === 1 && (sameName || (cityAsCountry && countrySpec.countryCodes.includes(cityAsCountry)))) specs.splice(specs.indexOf(countrySpec), 1);
  }

  const tiers = TIER_ORDER.map((tier) => specs.find((spec) => spec.tier === tier)).filter((spec): spec is TierSpec => Boolean(spec));
  const quotas = quotasFor(tiers.map((spec) => spec.tier), input);
  tiers.forEach((spec, index) => (spec.quota = quotas[index] ?? 16));
  const primaryTier: CompetitorTier | null = tiers.some((t) => t.tier === "area") && (scope === "hyperlocal" || !tiers.some((t) => t.tier === "city"))
    ? "area"
    : tiers.some((t) => t.tier === "city")
      ? "city"
      : tiers.some((t) => t.tier === "country")
        ? "country"
        : null;
  return { version: COMPETITOR_TIER_POLICY_VERSION, tiers, primaryTier, maxSuggestions: tiers.length === 3 ? 18 : 16, brandReach: reach };
}

export function emptyBrandReach(): BrandReach {
  return { known: false, points: 0, signals: [], checkedOpenKnowledge: false };
}

/** The plan for a confirmed profile. `search` is the profile `buildCompetitiveSearchProfile` made from it. */
export function planCompetitorTiers(profile: BusinessProfile, search: CompetitiveSearchProfile, reach: BrandReach): CompetitorTierPlan {
  return planFromInput(inputFromProfile(profile, search), reach);
}

/** A plan from a search profile alone, for callers that were handed one without `tiers`. */
export function planFromSearchProfile(search: CompetitiveSearchProfile, reach: BrandReach = emptyBrandReach()): CompetitorTierPlan {
  return search.tiers ?? planFromInput(inputFromSearch(search), reach);
}

export function hasLocalTier(plan: CompetitorTierPlan): boolean {
  return plan.tiers.some((spec) => spec.tier !== "country");
}

// --- Known brand ------------------------------------------------------------

/** What the encyclopedic lookup found for the target's own domain. */
export interface TargetKnowledgeFacts {
  entity: { id: string; label: string; description: string } | null;
  /** "url": its official-website property is the target host; "name": found by name, same registrable label. */
  matchedBy: "url" | "name" | null;
  sitelinks: number;
  /** ISO alpha-2 codes of the entity's country (P17). */
  countryCodes: string[];
}

const SOCIAL_HOST = /(^|\.)(instagram\.com|facebook\.com|fb\.com|tiktok\.com|x\.com|twitter\.com|linkedin\.com|youtube\.com|pinterest\.[a-z.]+|snapchat\.com|threads\.net|wa\.me|whatsapp\.com)$/;

function hostOf(value: string): string | null {
  try {
    return new URL(/^https?:\/\//i.test(value) ? value : `https://${value}`).hostname.toLowerCase().replace(/^www\./, "");
  } catch {
    return null;
  }
}

/**
 * Whether customers are likely to compare the target with national names.
 *
 * Social links alone never make a brand known: a neighbourhood salon has
 * Instagram, TikTok and Facebook. `known` needs 4 points and one anchor (an
 * encyclopedic entity, a multi-city footprint, or national-or-wider scope).
 * `knowledge` is null when the lookup did not run or timed out; that scores
 * nothing and never counts against the brand.
 */
export function computeBrandReach(profile: BusinessProfile, knowledge: TargetKnowledgeFacts | null, checkedOpenKnowledge: boolean): BrandReach {
  const signals: BrandReach["signals"] = [];
  let anchor = false;
  const add = (kind: string, value: string, points: number, isAnchor = false) => {
    signals.push({ kind, value, points });
    if (isAnchor && points > 0) anchor = true;
  };
  const targetCountry = marketCountries(profile).primary;

  let entityCounted = false;
  if (knowledge?.entity) {
    if (knowledge.matchedBy === "url") {
      add("wikidata_entity", knowledge.entity.label, 3, true);
      entityCounted = true;
    } else {
      // "atelier10.ae" must not borrow an unrelated "atelier10.com" entity.
      const sameCountry = Boolean(targetCountry && knowledge.countryCodes.includes(targetCountry));
      add("wikidata_entity_by_name", knowledge.entity.label, sameCountry ? 3 : 0, true);
      entityCounted = sameCountry;
    }
    if (entityCounted && knowledge.sitelinks >= 25) add("wikipedia_languages", String(knowledge.sitelinks), 2);
    else if (entityCounted && knowledge.sitelinks >= 8) add("wikipedia_languages", String(knowledge.sitelinks), 1);
  }

  const socialProfiles = profile.contact?.socialProfiles ?? [];
  const hosts = socialProfiles.map(hostOf).filter((host): host is string => Boolean(host));
  if (!entityCounted && hosts.some((host) => /(^|\.)(wikipedia\.org|wikidata\.org)$/.test(host))) add("encyclopedia_link", "Wikipedia or Wikidata link on its website", 2, true);

  const location = profile.location;
  const branches = location?.branches ?? [];
  const cities = unique([location?.primary?.city, ...branches.map((branch) => branch.city)]);
  if (profile.classification?.physicalPresence === "multi_location" && (cities.length >= 3 || location?.locationCount === "many")) {
    add("multi_location", cities.length >= 3 ? `${cities.length} cities` : "many locations", 2, true);
  }
  const branchCountries = new Set([location?.primary?.countryCode, ...branches.map((branch) => branch.countryCode)].filter(Boolean));
  if (branchCountries.size >= 2) add("branch_countries", `${branchCountries.size} countries`, 1);

  const scope = profile.marketScope.value;
  if (scope === "national") add("market_scope", scope, 2, true);
  else if (["international", "multi-country", "global"].includes(scope)) add("market_scope", scope, 3, true);

  const platforms = new Set(hosts.filter((host) => SOCIAL_HOST.test(host)).map((host) => host.split(".").slice(-2).join(".")));
  if (platforms.size >= 4) add("social_platforms", `${platforms.size} platforms`, 1);

  const points = signals.reduce((sum, signal) => sum + signal.points, 0);
  return { known: points >= 4 && anchor, points, signals, checkedOpenKnowledge };
}

// --- Assignment -------------------------------------------------------------

const HINT_PRIORITY_SOURCES = new Set(["web_search", "nearby_places"]);

function narrowestHint(plan: CompetitorTierPlan, hints: TierHint[] | undefined, sources: (source: string) => boolean): CompetitorTier | null {
  const planned = new Set(plan.tiers.map((spec) => spec.tier));
  const relevant = (hints ?? []).filter((hint) => sources(hint.source));
  return TIER_ORDER.find((tier) => planned.has(tier) && relevant.some((hint) => hint.tier === tier)) ?? null;
}

function countryMatcher(codes: string[], names: string[]): (value: string | null | undefined) => boolean {
  return (value) => {
    if (!value?.trim()) return false;
    const trimmed = value.trim();
    const code = isCountryCode(trimmed) ? trimmed.toUpperCase() : countryCodeFrom(trimmed);
    if (code && codes.includes(code)) return true;
    return names.some((name) => placeKey(name) === placeKey(trimmed));
  };
}

function isCountryValue(value: string): boolean {
  return isCountryCode(value) || Boolean(countryCodeFrom(value));
}

function countryDisplay(value: string): string {
  const code = isCountryCode(value) ? value.trim().toUpperCase() : countryCodeFrom(value);
  return (code ? countryName(code) : null) ?? value.trim();
}

/** "in DIFC", "across Dubai", "across the United Arab Emirates", "worldwide". */
function tierPhrase(spec: Pick<TierSpec, "tier" | "place" | "level">): string {
  if (spec.tier === "area") return spec.place === "Nearby" ? "nearby" : `in ${spec.place}`;
  if (spec.tier === "city") return `across ${spec.place}`;
  return spec.level === "global" ? "worldwide" : `across ${countryListPhrase(spec.place)}`;
}

/**
 * Which planned tier a rival belongs to, from positive evidence only.
 *
 * Unknown is not elsewhere: a rival with no location evidence gets its
 * source's hint or the plan's broadest local tier with a lower score, and is
 * only left without a tier (and rejected by the scorer) when evidence places
 * it somewhere no planned tier covers.
 */
export function assignCompetitorTier(plan: CompetitorTierPlan, target: CompetitiveSearchProfile, c: CompetitorCandidate, p: CandidateBusinessProfile | null): TierAssignment {
  if (plan.tiers.length === 0) return { tier: null, place: null, basis: "unverified", evidence: "", elsewhere: null, geographyScore: 80 };
  const area = plan.tiers.find((spec) => spec.tier === "area") ?? null;
  const city = plan.tiers.find((spec) => spec.tier === "city") ?? null;
  const country = plan.tiers.find((spec) => spec.tier === "country") ?? null;
  const make = (spec: TierSpec, basis: TierBasis, evidence: string, geographyScore: number): TierAssignment => ({ tier: spec.tier, place: spec.place, basis, evidence, elsewhere: null, geographyScore });

  const reported = c.location ?? null;
  const distance = typeof reported?.distanceMeters === "number" ? reported.distanceMeters : null;
  const fromMap = c.evidence.some((item) => item.source === "nearby_places");
  const addressMentions = p?.addressPlaceMentions ?? [];
  // Free-text "in <Capitalised>" phrases only count for profiles stored before
  // the verifier matched the target's place names itself.
  const legacyPhrases = p && p.placeMentions === undefined ? p.geographySignals.map((signal) => signal.replace(/^(in|across|serving)\s+/i, "").trim()) : [];
  const localities = unique([...(p?.structuredLocalities ?? []), ...legacyPhrases]);
  const bodyMentions = p?.placeMentions ?? [];

  const geo = target.geography;
  const cityPlaces = city ? city.places : [];
  const cityNames = unique([...cityPlaces, ...geo.cities]);
  const isCityName = (value: string | null | undefined) => cityNames.some((name) => sameName(name, value));
  // A city's name is never area evidence, even when a nearby area's name
  // contains it ("Downtown Dubai") or the area list repeats the city.
  const fineAreas = (area ? area.places : unique([...(geo.neighborhoods ?? []), ...(geo.nearbyAreas ?? [])])).filter((name) => !isCityName(name));

  // Country evidence comes first: it decides whether a shared place name means
  // the same place (Birmingham, Alabama is not Birmingham for a UK target).
  const targetCountries = country
    ? { codes: country.countryCodes, names: country.places }
    : countriesFrom([geo.countryCode], geo.countries);
  const isTargetCountry = countryMatcher(targetCountries.codes, targetCountries.names);
  const rivalCountries = [reported?.country, ...(p?.structuredCountries ?? [])];
  const otherCountry = rivalCountries.find((value) => value?.trim() && isCountryValue(value) && !isTargetCountry(value)) ?? null;
  const inTargetCountry = rivalCountries.some(isTargetCountry);
  const foreign = (targetCountries.codes.length > 0 || targetCountries.names.length > 0) && Boolean(otherCountry) && !inTargetCountry;
  const domainCountry = c.likelyDomain || p?.canonicalDomain ? countryCodeFromHostname(hostOf(p?.canonicalDomain ?? c.likelyDomain ?? "") ?? "") : null;
  const countryAgrees = inTargetCountry || Boolean(domainCountry && targetCountries.codes.includes(domainCountry));
  const byName = (places: string[], values: Array<string | null | undefined>) => (foreign ? null : firstMatch(places, values));

  // Area evidence.
  let areaHit: { basis: TierBasis; evidence: string; score: number } | null = null;
  const radius = area?.radiusMeters ?? AREA_RADIUS_METERS;
  if (distance !== null && distance <= radius) {
    areaHit = { basis: "distance", evidence: `${formatDistance(distance)} away${fromMap ? " (OpenStreetMap)" : ""}`, score: 95 };
  } else {
    const notCity = (value: string | null | undefined) => !isCityName(value);
    const named = byName(fineAreas, [reported?.area, reported?.city].filter(notCity));
    const onSite = named ? null : byName(fineAreas, [...addressMentions, ...localities].filter(notCity));
    if (named) areaHit = { basis: "area_name", evidence: `Located in ${named}`, score: 92 };
    else if (onSite) areaHit = { basis: "area_name", evidence: `Address in ${onSite} on its website`, score: 92 };
  }
  if (area && areaHit) return make(area, areaHit.basis, areaHit.evidence, areaHit.score);

  // City evidence.
  let cityHit: { basis: TierBasis; evidence: string; score: number } | null = null;
  if (city) {
    const named = byName(cityPlaces, [reported?.city, reported?.area]);
    const structured = named ? null : byName(cityPlaces, [...addressMentions, ...localities]);
    const mentioned = named || structured ? null : byName(cityPlaces, bodyMentions);
    if (areaHit) cityHit = { basis: areaHit.basis === "distance" ? "distance" : "city_name", evidence: areaHit.evidence, score: 85 };
    else if (named) cityHit = { basis: "city_name", evidence: `Located in ${named}`, score: 85 };
    else if (structured) cityHit = { basis: "structured_locality", evidence: `Address in ${structured} on its website`, score: 85 };
    else if (mentioned) cityHit = { basis: "city_name", evidence: `Names ${mentioned} on its website`, score: 85 };
    else if (distance !== null && distance <= CITY_RADIUS_METERS) cityHit = { basis: "distance", evidence: `${formatDistance(distance)} away${fromMap ? " (OpenStreetMap)" : ""}`, score: 75 };
    if (cityHit) return make(city, cityHit.basis, cityHit.evidence, cityHit.score);
  }
  const inCityByName = !city && Boolean(byName(geo.cities, [reported?.city, reported?.area, ...addressMentions, ...localities]));

  // Country membership.
  const countryLabel = country?.place ?? targetCountries.names[0] ?? "the country";
  let countryHit: { basis: TierBasis; evidence: string } | null = null;
  const openKnowledge = c.evidence.some((item) => item.source === "open_knowledge");
  if (areaHit || inCityByName) countryHit = { basis: "single_tier", evidence: areaHit?.evidence ?? `Based in ${countryLabel}` };
  else if (openKnowledge && isTargetCountry(reported?.country)) countryHit = { basis: "open_knowledge_country", evidence: `Listed in ${countryPhrase(countryDisplay(reported!.country!))} on Wikidata` };
  else if (isTargetCountry(reported?.country)) countryHit = { basis: "single_tier", evidence: `Based in ${countryPhrase(countryDisplay(reported!.country!))}` };
  else if ((p?.structuredCountries ?? []).some(isTargetCountry) || addressMentions.some(isTargetCountry)) countryHit = { basis: "single_tier", evidence: `Address in ${countryPhrase(countryLabel)} on its website` };
  else if (domainCountry && targetCountries.codes.includes(domainCountry)) countryHit = { basis: "country_domain", evidence: `Uses a .${domainCountry.toLowerCase() === "gb" ? "uk" : domainCountry.toLowerCase()} website` };

  // Footprint: evidence of reach beyond one place.
  let footprint: string | null = null;
  if ((p?.localityCount ?? 0) >= 3) footprint = `Addresses in ${p!.localityCount} cities on its website`;
  else if (p?.hasLocationsPage) footprint = "Has a locations page on its website";
  else if (c.chain) footprint = "Mapped as a chain on OpenStreetMap";
  else if (openKnowledge) footprint = "Listed on Wikipedia and Wikidata";
  else if ((c.tierHint ?? []).some((hint) => hint.tier === "country" && hint.source === "web_search")) footprint = "Found by a search for rivals across the country";
  else if (c.screening?.tier === "country") footprint = "Judged a country-wide rival";

  // Elsewhere: positive evidence the rival is somewhere no local tier covers.
  // "New York" is elsewhere for a York target. A name that only overlaps a
  // local place ("Downtown Dubai" for a plan without that area) is not proof of
  // elsewhere when the rival's own country evidence is the target's.
  let elsewhere: string | null = null;
  if (area || city) {
    const localPlaces = unique([...fineAreas, ...cityPlaces, ...geo.cities]);
    const isLocal = (value: string) => localPlaces.some((place) => placeIsWithin(value, place) || (countryAgrees && placesOverlap(value, place)));
    const reportedCity = reported?.city && !isLocal(reported.city) ? reported.city : null;
    const structuredElsewhere = !reportedCity && localPlaces.length > 0
      ? localities.find((locality) => !isLocal(locality) && !isTargetCountry(locality) && !isCountryValue(locality)) ?? null
      : null;
    elsewhere = reportedCity ?? structuredElsewhere;
  }
  if (!elsewhere && foreign) elsewhere = countryDisplay(otherCountry!);

  const countryOnly = Boolean(country) && plan.tiers.length === 1;
  if (country && countryOnly) {
    if (country.level === "global") return make(country, countryHit?.basis ?? "single_tier", countryHit?.evidence ?? "Competes worldwide", 80);
    if (countryHit) return make(country, countryHit.basis, countryHit.evidence, 85);
  }
  if (country && !countryOnly && countryHit && footprint && !areaHit) {
    return make(country, "country_footprint", `${footprint}; ${countryHit.evidence.charAt(0).toLowerCase()}${countryHit.evidence.slice(1)}`, 85);
  }

  if (!elsewhere) {
    // No evidence text for a fallback: Why? shows inclusion evidence only, and
    // "Location not confirmed" read as a confidence label (feedback items 5-6).
    if (plan.tiers.length === 1) return make(plan.tiers[0]!, "single_tier", "", 60);
    const hinted =
      narrowestHint(plan, c.tierHint, (source) => HINT_PRIORITY_SOURCES.has(source)) ??
      (c.screening?.tier && plan.tiers.some((spec) => spec.tier === c.screening!.tier) ? (c.screening.tier as CompetitorTier) : null) ??
      narrowestHint(plan, c.tierHint, (source) => source === "ai_hypothesis") ??
      narrowestHint(plan, c.tierHint, () => true);
    const hintedSpec = hinted ? plan.tiers.find((spec) => spec.tier === hinted) : null;
    if (hintedSpec) return make(hintedSpec, "source_hint", `Found as a rival ${tierPhrase(hintedSpec)}`, 55);
    if (city) return make(city, "unverified", "", 50);
    return make(country ?? plan.tiers[0]!, "unverified", "", 50);
  }
  // Unknown is not zero for national plans: a UK-listed rival often has a .com
  // or a head office abroad, so another country lowers the score but keeps it.
  // Its evidence would be the reason it looks out of place, so Why? gets none.
  if (country && countryOnly) return make(country, "unverified", "", 35);
  return { tier: null, place: null, basis: "unverified", evidence: "", elsewhere, geographyScore: countryHit ? 30 : 10 };
}

// --- Selection --------------------------------------------------------------

/**
 * Suggestion slots shared between tiers: each tier first takes up to its quota
 * in plan order, then unused slots go round-robin to tiers that still have
 * rivals. Input order (best score first) is kept within each tier and in the
 * output. Rejected rows must be filtered out before calling.
 */
export function selectByTierQuota(plan: CompetitorTierPlan, valid: RankedCompetitorCandidate[]): RankedCompetitorCandidate[] {
  if (plan.tiers.length === 0) return valid.slice(0, plan.maxSuggestions);
  const cap = plan.maxSuggestions;
  const queues = new Map<CompetitorTier, RankedCompetitorCandidate[]>(plan.tiers.map((spec) => [spec.tier, []]));
  const untiered: RankedCompetitorCandidate[] = [];
  for (const candidate of valid) {
    const queue = candidate.tier?.tier ? queues.get(candidate.tier.tier) : undefined;
    if (queue) queue.push(candidate);
    else untiered.push(candidate);
  }
  const chosen = new Set<RankedCompetitorCandidate>();
  for (const spec of plan.tiers) {
    const queue = queues.get(spec.tier)!;
    while (chosen.size < cap && queue.length > 0 && [...chosen].filter((c) => c.tier?.tier === spec.tier).length < spec.quota) chosen.add(queue.shift()!);
  }
  let progressed = true;
  while (chosen.size < cap && progressed) {
    progressed = false;
    for (const spec of plan.tiers) {
      const queue = queues.get(spec.tier)!;
      if (chosen.size >= cap || queue.length === 0) continue;
      chosen.add(queue.shift()!);
      progressed = true;
    }
  }
  for (const candidate of untiered) {
    if (chosen.size >= cap) break;
    chosen.add(candidate);
  }
  return valid.filter((candidate) => chosen.has(candidate));
}

export function countByTier(candidates: Array<{ tier?: { tier: CompetitorTier | null } | null }>): Record<CompetitorTier, number> {
  const counts: Record<CompetitorTier, number> = { area: 0, city: 0, country: 0 };
  for (const candidate of candidates) if (candidate.tier?.tier) counts[candidate.tier.tier] += 1;
  return counts;
}

// --- Labels and DTOs --------------------------------------------------------

function countryListPhrase(place: string): string {
  const parts = place.split(/, | and /).filter(Boolean);
  return joinNames(parts.map(countryPhrase));
}

/** "In DIFC", "Across Dubai", "Across the United Arab Emirates", "Worldwide". */
export function tierHeading(spec: Pick<TierSpec, "tier" | "place" | "level">): string {
  if (spec.tier === "area") return spec.place === "Nearby" ? "Nearby" : `In ${spec.place}`;
  if (spec.tier === "city") return `Across ${spec.place}`;
  return spec.level === "global" ? "Worldwide" : `Across ${countryListPhrase(spec.place)}`;
}

/**
 * "and nearby: Business Bay, Downtown" or "within 3 km" for the area tier;
 * "and Abu Dhabi, Sharjah" for a city tier that also covers the business's
 * other cities, so the heading says where its rivals can be; null otherwise.
 */
export function tierSubheading(spec: Pick<TierSpec, "tier" | "place" | "places" | "radiusMeters">): string | null {
  if (spec.tier === "city") {
    const others = spec.places.filter((name) => !sameName(name, spec.place)).slice(0, 3);
    return others.length > 0 ? `and ${others.join(", ")}` : null;
  }
  if (spec.tier !== "area") return null;
  const nearby = spec.places.filter((name) => !sameName(name, spec.place)).slice(0, 3);
  if (nearby.length > 0) return `and nearby: ${nearby.join(", ")}`;
  if (spec.place === "Nearby") return `within ${Math.round((spec.radiusMeters ?? AREA_RADIUS_METERS) / 1000)} km`;
  return null;
}

export function tierPlanDto(plan: CompetitorTierPlan | null): LandscapeTierPlanDto | null {
  if (!plan || plan.tiers.length === 0) return null;
  return {
    tiers: plan.tiers.map((spec) => ({ tier: spec.tier, place: spec.place, level: spec.level, heading: tierHeading(spec), subheading: tierSubheading(spec), quota: spec.quota })),
    primaryTier: plan.primaryTier,
    knownBrand: plan.brandReach.known,
  };
}

export function storedTierFrom(assignment: TierAssignment | null | undefined): StoredCompetitorTier | null {
  if (!assignment?.tier || !assignment.place) return null;
  return { tier: assignment.tier, place: assignment.place, basis: assignment.basis, evidence: assignment.evidence, policy: COMPETITOR_TIER_POLICY_VERSION };
}

/** A tier the operator chose for a row. The place is the plan's, or the target's own place for a tier the plan lacks. */
export function operatorTier(tier: CompetitorTier, plan: CompetitorTierPlan, target: CompetitiveSearchProfile | null): StoredCompetitorTier {
  const spec = plan.tiers.find((item) => item.tier === tier);
  const geo = target?.geography;
  const fallback = tier === "area" ? geo?.neighborhoods?.[0] ?? "Nearby" : tier === "city" ? geo?.cities[0] ?? "City" : geo?.scope === "global" ? "Worldwide" : geo?.countries[0] ?? "Country";
  return { tier, place: spec?.place ?? fallback, basis: "operator", evidence: "Placed here by you", policy: COMPETITOR_TIER_POLICY_VERSION };
}

const TIERS = new Set<string>(TIER_ORDER);
const BASES = new Set<string>(["distance", "area_name", "city_name", "structured_locality", "country_footprint", "country_domain", "open_knowledge_country", "source_hint", "single_tier", "unverified", "operator"]);

/** A stored `candidateProfile.tier`: the value, null when stored as "no tier", undefined when never stored. */
export function readStoredTier(candidateProfile: unknown): StoredCompetitorTier | null | undefined {
  if (!candidateProfile || typeof candidateProfile !== "object" || !("tier" in candidateProfile)) return undefined;
  const value = (candidateProfile as { tier?: unknown }).tier;
  if (value === null) return null;
  if (!value || typeof value !== "object") return undefined;
  const tier = value as Partial<StoredCompetitorTier>;
  if (!tier.tier || !TIERS.has(tier.tier) || typeof tier.place !== "string" || !tier.basis || !BASES.has(tier.basis)) return undefined;
  return { tier: tier.tier, place: tier.place, basis: tier.basis, evidence: typeof tier.evidence === "string" ? tier.evidence : "", policy: typeof tier.policy === "string" ? tier.policy : COMPETITOR_TIER_POLICY_VERSION, ...(tier.derived ? { derived: true } : {}) };
}

/** The entity fields tier derivation reads (a structural subset of the `entities` row). */
export interface TierEntityInput {
  canonicalName: string;
  canonicalDomain: string | null;
  competitorType: string | null;
  source: string | null;
  sourceContributions: unknown;
  candidateProfile: unknown;
  rejectionReason: string | null;
}

/**
 * The tier a stored row is shown and frozen under. Rows written before tiers
 * have none stored; their tier is derived here from what was stored
 * (reported location, place mentions, localities, sources) without any
 * network or write, so opening Landscape on an older project fetches nothing.
 */
export function effectiveTierFor(entity: TierEntityInput, plan: CompetitorTierPlan, target: CompetitiveSearchProfile): StoredCompetitorTier | null {
  const stored = readStoredTier(entity.candidateProfile);
  if (stored !== undefined) return stored;
  if (entity.rejectionReason || plan.tiers.length === 0) return null;
  if (entity.source === "user_manual") {
    const primary = plan.tiers.find((spec) => spec.tier === plan.primaryTier) ?? plan.tiers[0]!;
    return { ...operatorTier(primary.tier, plan, target), evidence: "Added by you", derived: true };
  }
  const profile = (entity.candidateProfile ?? null) as (Partial<CandidateBusinessProfile> & { reportedLocation?: CompetitorCandidate["location"] }) | null;
  const sources = Array.isArray(entity.sourceContributions) ? (entity.sourceContributions as string[]) : entity.source ? [entity.source] : [];
  const candidate: CompetitorCandidate = {
    canonicalName: entity.canonicalName,
    likelyDomain: entity.canonicalDomain,
    proposedType: entity.competitorType === "substitute" || entity.competitorType === "marketplace" || entity.competitorType === "adjacent" ? entity.competitorType : "direct",
    entityType: "company",
    reason: "",
    matchedDimensions: [],
    confidence: 0,
    evidence: sources.map((source) => ({ source: source as CompetitorCandidate["evidence"][number]["source"], reason: "", evidenceIds: [], discoveredAt: 0 })),
    aliases: [],
    location: profile?.reportedLocation ?? null,
  };
  const candidateProfile = profile && typeof profile.verificationStatus === "string"
    ? ({ geographySignals: [], ...profile } as CandidateBusinessProfile)
    : null;
  const assignment = assignCompetitorTier(plan, target, candidate, candidateProfile);
  const tier = storedTierFrom(assignment);
  return tier ? { ...tier, derived: true } : null;
}

export type { TierLevel };
