// The market area: where a business's customers are measured.
//
// Local-search systems keep two geographies apart. A business has locations
// (addresses, branches, a head office). Its customers are somewhere else: a
// neighbourhood, a city, a country, everywhere. Prompts and competitor tiers
// need the second one. Until 2026-09-16 the pipeline used the first: the
// primary address stood in for the market, so a restaurant with four Dubai
// branches and "Dubai" chosen at intake was measured around Jabel Ali, the
// branch whose address the website listed first. This module decides the
// market area once, in the resolver and the editor, and derives it for older
// profiles that never stored one.
//
// Client-safe: pure functions over profile data.

import type { BusinessProfile, LocationProfile, MarketArea, MarketScope } from "@/lib/profile/schema";
import { countryName } from "@/lib/geo/countries";
import { PLACE_BOUND_KINDS, type BusinessKind } from "./kinds";

type Place = NonNullable<LocationProfile["primary"]>;

/**
 * Two names for one place: equal, one inside the other ("Umm Suqeim" and
 * "Umm Suqeim 3"), or initials ("JVC" and "Jumeirah Village Circle"), the way
 * the location resolver already compares areas.
 */
export function samePlaceName(a: string | null | undefined, b: string | null | undefined): boolean {
  if (!a || !b) return false;
  const norm = (value: string) => value.toLowerCase().replace(/[^\p{L}\p{N}]+/gu, " ").trim();
  const x = norm(a);
  const y = norm(b);
  if (!x || !y) return false;
  return x === y || x.includes(y) || y.includes(x) || isAcronymOf(a, b) || isAcronymOf(b, a);
}

function isAcronymOf(short: string, long: string): boolean {
  const compact = short.replace(/[^\p{L}\p{N}]/gu, "");
  if (compact.length < 2 || compact.length > 6 || /\s/.test(short.trim())) return false;
  const words = long.split(/[^\p{L}\p{N}]+/u).filter((word) => word && !/^(of|the|and|de|la|al|el)$/i.test(word));
  if (words.length < 2) return false;
  return words.map((word) => word[0]).join("").toLowerCase() === compact.toLowerCase();
}

export interface MarketAreaInput {
  placeBound: boolean;
  scope: MarketScope;
  primary: Place | null;
  branches: Place[];
  presence: string;
  /** Countries served, market first. */
  countries: string[];
  /** The operator's intake area, when it resolved to a place. */
  operatorArea?: { neighborhood: string | null; district: string | null; city: string | null; region: string | null; countryCode: string | null } | null;
  /** The operator said customers are everywhere. */
  worldwide?: boolean;
  /** Areas the site says it is near; used to recognise an operator area that is really a district. */
  nearbyAreas?: string[];
}

/** The place people ask about for a business customers visit: its own area, else its city. */
function footprintArea(input: MarketAreaInput): MarketArea | null {
  const { primary, branches, scope, presence } = input;
  if (!primary) return null;
  const code = primary.countryCode ?? input.countries[0] ?? null;
  const multi = presence === "multi_location" || branches.length > 0;
  const cities = new Set([primary.city, ...branches.map((branch) => branch.city)].filter((city): city is string => Boolean(city)).map((city) => city.toLowerCase()));
  if ((scope === "hyperlocal" || scope === "local" || scope === "unknown") && primary.city) {
    // Several locations in one city are compared across that city; one
    // storefront is compared around its own area.
    if (multi && cities.size <= 1) {
      return { level: "city", name: primary.city, countryCode: code, source: "website", rationale: `${branches.length + 1} locations across ${primary.city}.` };
    }
    if (presence === "service_area") return { level: "city", name: primary.city, countryCode: code, source: "website", rationale: `Serves customers across ${primary.city}.` };
    if (!multi && primary.neighborhood) return { level: "neighborhood", name: primary.neighborhood, countryCode: code, source: "website", rationale: `One location in ${primary.neighborhood}.` };
    return { level: "city", name: primary.city, countryCode: code, source: "website", rationale: `Customers come from across ${primary.city}.` };
  }
  if (scope === "hyperlocal" && primary.neighborhood) return { level: "neighborhood", name: primary.neighborhood, countryCode: code, source: "website", rationale: `One location in ${primary.neighborhood}.` };
  if (scope === "regional") {
    const name = primary.region && !samePlaceName(primary.region, primary.city) ? primary.region : primary.city;
    return name ? { level: "region", name, countryCode: code, source: "website", rationale: "Locations across the region." } : null;
  }
  if (code) return { level: "country", name: countryName(code) ?? code, countryCode: code, source: "inferred", rationale: "Locations across the country." };
  return null;
}

/**
 * An operator area the geocoder called a city that is really one of the
 * business's own areas inside its city: the area's region names the business's
 * city (not the area itself), and the area matches the storefront's
 * neighbourhood or district, a branch's area, or an area the site says it is
 * near. Both conditions, so a separate city in the same region ("Al Ain" for
 * an Abu Dhabi business) stays a city.
 */
function isDistrictOfOwnCity(areaCity: string, areaRegion: string | null, input: MarketAreaInput): boolean {
  const primary = input.primary;
  if (!input.placeBound || !primary?.city || !areaRegion) return false;
  // Exact names here: samePlaceName treats "Dubai International Financial
  // Centre" as "Dubai" because one contains the other.
  const exact = (a: string, b: string) => a.toLowerCase().replace(/[^\p{L}\p{N}]+/gu, " ").trim() === b.toLowerCase().replace(/[^\p{L}\p{N}]+/gu, " ").trim();
  if (exact(areaCity, primary.city)) return false;
  if (!exact(areaRegion, primary.city) || exact(areaRegion, areaCity)) return false;
  const ownAreas = [primary.neighborhood, primary.district, ...input.branches.flatMap((branch) => [branch.neighborhood, branch.district]), ...(input.nearbyAreas ?? [])];
  return ownAreas.some((name) => samePlaceName(name, areaCity));
}

/**
 * Decide the market area. The operator's intake area wins when it resolved to
 * a place; otherwise the business's own footprint (place-bound) or its market
 * country / the world (online).
 */
export function decideMarketArea(input: MarketAreaInput): MarketArea | null {
  const area = input.operatorArea;
  if (area) {
    const code = area.countryCode ?? input.primary?.countryCode ?? input.countries[0] ?? null;
    if (area.neighborhood) return { level: "neighborhood", name: area.neighborhood, countryCode: code, source: "operator", rationale: "You told us where your customers are." };
    if (area.district) return { level: "district", name: area.district, countryCode: code, source: "operator", rationale: "You told us where your customers are." };
    if (area.city) {
      // A geocoder can file a district as its own "city": Photon returns
      // "Dubai International Financial Centre" with city = DIFC and region =
      // Dubai. Taken as a city, it replaced Dubai in every city slot, so a DIFC
      // salon whose customers "mostly come from across Dubai" was asked about
      // only in DIFC and never in Dubai (7 of 10 Discovery prompts, 2026-09-18).
      // When the area's region is the business's own city and the area is one
      // of the business's own areas, it is a district of that city.
      if (isDistrictOfOwnCity(area.city, area.region, input)) {
        return { level: "district", name: area.city, countryCode: code, source: "operator", rationale: "You told us where your customers are." };
      }
      return { level: "city", name: area.city, countryCode: code, source: "operator", rationale: "You told us where your customers are." };
    }
    if (area.region) {
      // A region that is the business's city under another name ("Dubai
      // Emirate" for Dubai locations, a geocoder reading "Dubai" as a state)
      // is the city: measured across it, not around the first-listed branch.
      const cities = [input.primary?.city, ...input.branches.map((branch) => branch.city)].filter((city): city is string => Boolean(city));
      const oneCity = cities.length > 0 && cities.every((city) => samePlaceName(city, cities[0]));
      if (oneCity && (samePlaceName(cities[0], area.region) || input.placeBound)) {
        return { level: "city", name: cities[0]!, countryCode: code, source: "operator", rationale: "You told us where your customers are." };
      }
      return { level: "region", name: area.region, countryCode: code, source: "operator", rationale: "You told us where your customers are." };
    }
  }
  if (!input.placeBound) {
    if (input.worldwide || input.scope === "global") return { level: "global", name: "Worldwide", countryCode: null, source: input.worldwide ? "operator" : "inferred", rationale: input.worldwide ? "You told us customers come from all over the world." : "Sells worldwide." };
    const code = input.countries[0] ?? input.primary?.countryCode ?? null;
    return code ? { level: "country", name: countryName(code) ?? code, countryCode: code, source: "inferred", rationale: `Customers across ${countryName(code) ?? code}.` } : null;
  }
  return footprintArea(input);
}

/** The stored market area, or one derived for a profile that predates it. */
export function marketAreaOf(profile: Pick<BusinessProfile, "location" | "marketScope" | "classification">): MarketArea | null {
  const location = profile.location;
  if (!location) return null;
  if (location.marketArea) return location.marketArea;
  const kind = (profile.classification?.kind ?? "other") as BusinessKind;
  const placeBound = PLACE_BOUND_KINDS.has(kind) && profile.classification?.physicalPresence !== "online_only";
  return decideMarketArea({
    placeBound,
    scope: profile.marketScope.value,
    primary: location.primary,
    branches: location.branches,
    presence: profile.classification?.physicalPresence ?? "unknown",
    countries: location.countriesServed,
    nearbyAreas: location.nearbyAreas,
  });
}

/** True when the market area is one of the business's own areas rather than its whole city or wider. */
export function isAreaLevel(area: MarketArea | null | undefined): area is MarketArea & { level: "neighborhood" | "district" } {
  return Boolean(area && (area.level === "neighborhood" || area.level === "district"));
}

/** The location whose area the market area names, if it is one of the business's locations. */
export function locationForArea(location: Pick<LocationProfile, "primary" | "branches">, area: MarketArea | null | undefined): Place | null {
  if (!isAreaLevel(area)) return null;
  const matches = (place: Place | null) => Boolean(place && (samePlaceName(place.neighborhood, area.name) || samePlaceName(place.district, area.name)));
  if (matches(location.primary)) return location.primary;
  return location.branches.find((branch) => matches(branch)) ?? null;
}
