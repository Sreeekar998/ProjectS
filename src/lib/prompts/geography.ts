// Prompt geography, bound to the confirmed location.
//
// Prompts used to read geography from the insert-only `locations` table, which
// kept every market any earlier analysis ever wrote (a Dubai salon still had
// "United States" rows from a bad crawl), knew only country/region/city, and
// was rebuilt differently at approval, so a region-bound prompt that passed
// generation failed approval. Places now come from the confirmed profile's
// location, at the levels customers actually say — "in DIFC", "near Business
// Bay", "in Dubai" — and are frozen into the prompt context snapshot so
// generation, regeneration and approval all check against the same list.

import type { BusinessProfile, MarketArea, MarketScope } from "@/lib/profile/schema";
import type { Location } from "@/lib/geography/repository";
import { PLACE_BOUND_KINDS, type BusinessKind } from "@/lib/understanding/kinds";
import { countryName } from "@/lib/geo/countries";
import { marketCountries } from "@/lib/understanding/market-countries";
import { isAreaLevel, marketAreaOf } from "@/lib/understanding/market-area";

export type PromptPlaceLevel = "neighborhood" | "district" | "city" | "region" | "country";

export interface PromptPlace {
  name: string;
  level: PromptPlaceLevel;
  countryCode: string | null;
  /** primary: where the business is; nearby: areas its site names; branch: another location; served: a market it sells into. */
  role: "primary" | "nearby" | "branch" | "served";
}

export interface PromptGeography {
  scope: MarketScope;
  placeBound: boolean;
  places: PromptPlace[];
  /** Where customers are measured; frozen with the places for traceability. */
  marketArea?: MarketArea | null;
}

type PromptPlaceSource = { city: string | null; neighborhood: string | null; district: string | null };

function push(list: PromptPlace[], place: PromptPlace | null) {
  if (!place || !place.name.trim()) return;
  const key = place.name.trim().toLowerCase();
  if (list.some((existing) => existing.name.toLowerCase() === key)) return;
  list.push({ ...place, name: place.name.trim() });
}

/** Null for profiles built before locations existed; callers keep the old path. */
export function promptGeographyFromProfile(profile: BusinessProfile): PromptGeography | null {
  const location = profile.location;
  if (!location) return null;
  const scope = profile.marketScope.value;
  const kind = (profile.classification?.kind ?? "other") as BusinessKind;
  const placeBound = PLACE_BOUND_KINDS.has(kind) && profile.classification?.physicalPresence !== "online_only";
  const primary = location.primary;
  const code = primary?.countryCode ?? null;
  const places: PromptPlace[] = [];
  const local = scope === "hyperlocal" || scope === "local";
  // Where customers are measured (understanding/market-area.ts): the operator's
  // area, else the business's footprint. Business locations are evidence of
  // where it is, not the anchor of every prompt.
  const marketArea = marketAreaOf(profile);
  const inMarketCity = (branch: PromptPlaceSource) => !primary?.city || !branch.city || branch.city.toLowerCase() === primary.city.toLowerCase();
  const branchAreas = location.branches.filter(inMarketCity).map((branch) => branch.neighborhood ?? branch.district).filter((name): name is string => Boolean(name));

  if (primary && placeBound && isAreaLevel(marketArea)) {
    // Measured around one area (a single storefront, or the operator chose a
    // branch's area): that area leads, the site's nearby areas and the other
    // branches' areas follow, then the city.
    push(places, { name: marketArea.name, level: marketArea.level, countryCode: code, role: "primary" });
    for (const area of location.nearbyAreas.slice(0, 4)) push(places, { name: area, level: "neighborhood", countryCode: code, role: "nearby" });
    for (const name of branchAreas.slice(0, 3)) push(places, { name, level: "neighborhood", countryCode: code, role: "nearby" });
    push(places, primary.city ? { name: primary.city, level: "city", countryCode: code, role: "primary" } : null);
  } else if (primary && placeBound && (marketArea?.level === "city" || (marketArea?.level === "region" && local))) {
    // Measured across the city (a chain with branches across it, or the
    // operator chose the city): the city leads; the branches' own areas are
    // the local asks people still make, and none of them is the anchor. A
    // four-branch Dubai restaurant with "Dubai" chosen at intake once had
    // four of ten Discovery prompts in Jabel Ali, its first-listed branch.
    push(places, { name: marketArea.level === "city" ? marketArea.name : (primary.city ?? marketArea.name), level: "city", countryCode: code, role: "primary" });
    const own = [primary.neighborhood ?? primary.district, ...branchAreas].filter((name): name is string => Boolean(name));
    for (const name of own.slice(0, 6)) push(places, { name, level: "neighborhood", countryCode: code, role: "nearby" });
    for (const area of location.nearbyAreas.slice(0, 4)) push(places, { name: area, level: "neighborhood", countryCode: code, role: "nearby" });
  } else if (primary) {
    // Neighbourhoods and the city are prompt places only when customers come
    // from there. A national chain's head-office district ("Quorum Business
    // Park", "Gosforth") is not.
    if (local) {
      push(places, primary.neighborhood ? { name: primary.neighborhood, level: "neighborhood", countryCode: code, role: "primary" } : null);
      for (const area of location.nearbyAreas.slice(0, 4)) push(places, { name: area, level: "neighborhood", countryCode: code, role: "nearby" });
      push(places, primary.city ? { name: primary.city, level: "city", countryCode: code, role: "primary" } : null);
    }
    if (scope === "regional") {
      push(places, primary.city ? { name: primary.city, level: "city", countryCode: code, role: "primary" } : null);
      for (const branch of location.branches.slice(0, 6)) push(places, branch.city ? { name: branch.city, level: "city", countryCode: branch.countryCode, role: "branch" } : null);
      push(places, primary.region && primary.region.toLowerCase() !== (primary.city ?? "").toLowerCase() ? { name: primary.region, level: "region", countryCode: code, role: "primary" } : null);
    }
  }
  // A business people visit is asked for by city and area whatever its scope:
  // a restaurant group with venues in Dubai, Abu Dhabi and Cairo is
  // "restaurants in Dubai" or "in Dubai Hills", never "restaurants in the
  // UAE" (which is what an international scope produced for REIF). Its venues
  // in the market country are the places; other countries' venues are not the
  // market the operator chose.
  if (placeBound && !local && scope !== "regional" && primary && places.length === 0) {
    const market = marketCountries(profile);
    const home = market.primary ?? code;
    const inMarket = (country: string | null | undefined) => !home || !country || country.toUpperCase() === home.toUpperCase();
    const venues = location.branches.filter((branch) => inMarket(branch.countryCode));
    // A head office is not a venue: a bakery chain's "Quorum Business Park"
    // stays out even when no branch is listed (then the country stands).
    const primaryIsVenue = location.primaryRole !== "headquarters";
    if (primaryIsVenue && inMarket(code)) push(places, primary.city ? { name: primary.city, level: "city", countryCode: code, role: "primary" } : null);
    for (const branch of venues.slice(0, 8)) push(places, branch.city ? { name: branch.city, level: "city", countryCode: branch.countryCode, role: "branch" } : null);
    // A chain that lists its cities and areas without addresses (44 branches
    // behind a finder) is still asked for by city and area: a UAE salon chain
    // got "manicure salons in the UAE" ten times over.
    for (const area of (location.serviceAreas ?? []).filter((item) => item.level === "city").slice(0, 6)) push(places, { name: area.name, level: "city", countryCode: home, role: "branch" });
    // A head office in the market whose site names branch areas but no
    // branch address or city (a 44-branch salon chain behind a finder) still
    // serves its own city; without it the areas had no city to hang on and
    // every prompt lost its place.
    if (!primaryIsVenue && inMarket(code) && primary.city && places.length === 0 && location.nearbyAreas.length > 0) push(places, { name: primary.city, level: "city", countryCode: code, role: "branch" });
    if (primaryIsVenue && inMarket(code)) push(places, primary.neighborhood ? { name: primary.neighborhood, level: "neighborhood", countryCode: code, role: "nearby" } : null);
    for (const branch of venues.slice(0, 6)) push(places, branch.neighborhood ? { name: branch.neighborhood, level: "neighborhood", countryCode: branch.countryCode, role: "nearby" } : null);
    for (const area of location.nearbyAreas.slice(0, 6)) push(places, { name: area, level: "neighborhood", countryCode: home, role: "nearby" });
  }
  const hasVenuePlaces = placeBound && places.some((place) => place.level === "city" || place.level === "neighborhood" || place.level === "district");
  // A single salon's customers do not ask for "salons in the United Arab
  // Emirates"; the country is a prompt place only for national and wider scopes,
  // and for a place-bound business only when no venue city is known (a chain
  // with hundreds of unnamed locations).
  if (!local && scope !== "regional" && !hasVenuePlaces) {
    // The market country, not the head office: a Toronto software company whose
    // customers are in the United States gets "in the United States" prompts.
    const market = marketCountries(profile);
    // People visit a place-bound business in their own country: one market
    // country, never the other countries it has venues in.
    const countries = market.all.slice(0, placeBound || scope === "national" ? 1 : 5);
    for (const country of countries) push(places, { name: countryName(country) ?? country, level: "country", countryCode: country, role: country === market.primary ? "primary" : "served" });
    // A head-office city is not where a national chain's customers are.
    if (placeBound && primary?.city && scope === "national" && location.primaryRole !== "headquarters") push(places, { name: primary.city, level: "city", countryCode: code, role: "primary" });
  }
  return { scope, placeBound, places, marketArea };
}

/** The same places as rows the validators and frame planner already understand. */
export function placesToLocations(projectId: string, places: PromptPlace[]): Location[] {
  return places.map((place, index) => ({
    id: `place-${place.level}-${index}`,
    projectId,
    level: place.level,
    name: place.name,
    parentId: null,
    countryCode: place.countryCode,
    evidenceIds: [],
    isPrimary: place.role === "primary",
  })) as Location[];
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/** Known places a prompt mentions, longest names first. */
export function placesMentioned(text: string, locations: Location[]): Location[] {
  const found: Location[] = [];
  let remaining = ` ${text} `;
  for (const location of [...locations].sort((a, b) => b.name.length - a.name.length)) {
    const pattern = new RegExp(`(^|[^\\p{L}\\p{N}])${escapeRegExp(location.name)}(?=[^\\p{L}\\p{N}]|$)`, "iu");
    if (pattern.test(remaining)) {
      found.push(location);
      remaining = remaining.replace(pattern, "$1 ");
    }
  }
  return found;
}
