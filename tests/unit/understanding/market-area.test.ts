import { describe, expect, it } from "vitest";
import { resolveLocation, type GroundedAddress, type LocationInput } from "@/lib/understanding/location";
import { buildMarketHint, type HintPlace } from "@/lib/projects/market-hint";
import { applyClassificationEdit, applyLocationEdit } from "@/lib/understanding/edits";
import { decideMarketArea, marketAreaOf } from "@/lib/understanding/market-area";
import { placesToLocations, promptGeographyFromProfile } from "@/lib/prompts/geography";
import { discoveryPlaces } from "@/lib/prompts/discovery";
import { mergeFrames } from "@/lib/crawler/playwright-fallback";
import { makeProfile } from "../../helpers/profile-fixtures";

// The market area: where customers are measured, kept apart from where the
// business is. A four-branch Dubai restaurant with "Dubai" chosen at intake
// was measured around Jabel Ali, the branch whose address the website listed
// first (feedback 2026-09-16). Keyless and offline.

const NOW = new Date("2026-09-16T00:00:00Z");

function address(partial: Partial<GroundedAddress>): GroundedAddress {
  return {
    raw: "", role: "storefront", premise: null, street: null, neighborhood: null, district: null, city: null, region: null, country: null, countryCode: null, postalCode: null, citations: [], evidenceIds: [],
    ...partial,
  } as GroundedAddress;
}

function hintPlace(partial: Partial<HintPlace>): HintPlace {
  return {
    label: "", formattedAddress: null, premise: null, street: null, neighborhood: null, district: null, city: null, region: null, country: null, countryCode: null, postalCode: null, lat: null, lng: null, precision: null, provider: "photon", providerId: null,
    ...partial,
  };
}

const DUBAI_CITY = hintPlace({ city: "Dubai", region: "Dubai", countryCode: "AE", lat: 25.26, lng: 55.29, providerId: "osm:dubai", precision: "city" });
const JVC = hintPlace({ neighborhood: "JVC", city: "Dubai", region: "Dubai", countryCode: "AE", lat: 25.06, lng: 55.21, providerId: "osm:jvc", precision: "neighborhood" });
const areaHint = (place: HintPlace, query: string) => buildMarketHint({ countryCodes: ["AE"], worldwide: false, area: { query, place } }, NOW)!;
const countryHint = () => buildMarketHint({ countryCodes: ["AE"], worldwide: false, area: null }, NOW)!;

const branchAddresses = [
  address({ raw: "Shop JAC-FB-02, Jabel Ali Recreational Club, Dubai", premise: "Jabel Ali Recreational Club", neighborhood: "Jabel Ali", city: "Dubai", country: "United Arab Emirates", countryCode: "AE" }),
  address({ raw: "Jumeirah 3, Dubai", neighborhood: "Umm Suqeim 3", city: "Dubai", country: "United Arab Emirates", countryCode: "AE", role: "branch" }),
  address({ raw: "Green Community Village, Dubai Investment Park", neighborhood: "Green Community Village", city: "Dubai", country: "United Arab Emirates", countryCode: "AE", role: "branch" }),
  address({ raw: "Circle Mall, JVC, Dubai", premise: "Circle Mall", neighborhood: "JVC", city: "Dubai", country: "United Arab Emirates", countryCode: "AE", role: "branch" }),
];

const restaurant: Omit<LocationInput, "hint"> = {
  addresses: branchAddresses,
  serviceAreas: [],
  nearbyAreas: [],
  countriesServed: ["AE"],
  llmScope: "local",
  scopeRationale: "",
  locationCount: "few",
  kind: "restaurant_food_beverage",
  presence: "multi_location",
  evidence: [],
  seedHostname: "example.ae",
  allowNetwork: false,
};

describe("market area in the location resolver", () => {
  it("measures a one-city chain across the city the operator chose, keeping the first address as a location", async () => {
    const result = await resolveLocation({ ...restaurant, hint: areaHint(DUBAI_CITY, "Dubai") });
    expect(result.location.marketArea).toMatchObject({ level: "city", name: "Dubai", countryCode: "AE", source: "operator" });
    expect(result.location.primary?.neighborhood).toBe("Jabel Ali");
    expect(result.location.branches).toHaveLength(3);
    expect(result.scope.value).toBe("local");
  });

  it("measures the chain around the branch whose area the operator named, making that branch the primary", async () => {
    const result = await resolveLocation({ ...restaurant, hint: areaHint(JVC, "JVC") });
    expect(result.location.marketArea).toMatchObject({ level: "neighborhood", name: "JVC", source: "operator" });
    expect(result.location.primary?.neighborhood).toBe("JVC");
    expect(result.location.primary?.premise).toBe("Circle Mall");
    expect(result.location.branches.map((branch) => branch.neighborhood)).toEqual(expect.arrayContaining(["Jabel Ali"]));
    expect(result.location.branches).toHaveLength(3);
  });

  it("reads a region hint that is the chain's city under another name as the city", async () => {
    const emirate = hintPlace({ region: "Dubai Emirate", countryCode: "AE", lat: 25.2, lng: 55.3, providerId: "osm:dubai-emirate", precision: "region" });
    const result = await resolveLocation({ ...restaurant, hint: areaHint(emirate, "Dubai") });
    expect(result.location.marketArea).toMatchObject({ level: "city", name: "Dubai", source: "operator" });
  });

  it("keeps one branch when the displaced website primary is also in the address list", async () => {
    const twice = [...branchAddresses, address({ raw: "Jabel Ali Recreational Club, Dubai", premise: "Jabel Ali Recreational Club", neighborhood: "Jabel Ali", city: "Dubai", country: "United Arab Emirates", countryCode: "AE", role: "branch" })];
    const result = await resolveLocation({ ...restaurant, addresses: twice, hint: areaHint(JVC, "JVC") });
    expect(result.location.branches.filter((branch) => branch.neighborhood === "Jabel Ali")).toHaveLength(1);
  });

  it("measures a one-city chain across its city when only the country was chosen", async () => {
    const result = await resolveLocation({ ...restaurant, hint: countryHint() });
    expect(result.location.marketArea).toMatchObject({ level: "city", name: "Dubai", source: "website" });
  });

  it("measures a single storefront around its own area", async () => {
    const result = await resolveLocation({ ...restaurant, addresses: branchAddresses.slice(0, 1), presence: "single_location", locationCount: "one", hint: countryHint() });
    expect(result.location.marketArea).toMatchObject({ level: "neighborhood", name: "Jabel Ali", source: "website" });
  });
});

function chain() {
  let profile = makeProfile({ brandName: "Nawab", archetype: "restaurant_food_chain", industry: "Food", domain: "nawab.ae" });
  profile = applyClassificationEdit(profile, { businessType: "North Indian restaurant", kind: "restaurant_food_beverage", physicalPresence: "multi_location" });
  profile = applyLocationEdit(profile, { primary: { neighborhood: "Jabel Ali", city: "Dubai", country: "United Arab Emirates" }, marketScope: "local" });
  const branch = (neighborhood: string) => ({ ...profile.location!.primary!, label: `${neighborhood}, Dubai`, neighborhood, premise: null });
  profile.location!.branches = [branch("Umm Suqeim 3"), branch("Green Community Village"), branch("JVC")];
  return profile;
}

describe("prompt places for a chain measured across its city", () => {
  it("derives a city-level market area for a profile that predates the field", () => {
    const profile = chain();
    delete profile.location!.marketArea;
    expect(marketAreaOf(profile)).toMatchObject({ level: "city", name: "Dubai" });
  });

  it("leads with the city and offers the branch areas as nearby places, with no primary area", () => {
    const profile = chain();
    profile.location!.marketArea = { level: "city", name: "Dubai", countryCode: "AE", source: "operator", rationale: null };
    const geography = promptGeographyFromProfile(profile)!;
    expect(geography.places[0]).toMatchObject({ level: "city", name: "Dubai", role: "primary" });
    expect(geography.places.filter((place) => place.role === "primary")).toHaveLength(1);
    expect(geography.places.filter((place) => place.role === "nearby").map((place) => place.name)).toEqual(["Jabel Ali", "Umm Suqeim 3", "Green Community Village", "JVC"]);
    const { places } = discoveryPlaces(placesToLocations("prj", geography.places), { placeBound: true, scope: "local" });
    const first = places.slice(0, 10);
    expect(first.filter((place) => place.say === "Dubai").length).toBeGreaterThanOrEqual(7);
    expect(new Set(first.map((place) => place.say)).size).toBeGreaterThan(1);
  });

  it("measured around one branch, leads with that area and keeps the city", () => {
    const profile = applyLocationEdit(chain(), { primary: { neighborhood: "Jabel Ali", city: "Dubai", country: "United Arab Emirates" }, marketArea: { level: "neighborhood", name: "JVC" } });
    expect(profile.location!.primary?.neighborhood).toBe("JVC");
    expect(profile.location!.branches.map((branch) => branch.neighborhood)).toContain("Jabel Ali");
    expect(profile.location!.marketArea).toMatchObject({ level: "neighborhood", name: "JVC", source: "user" });
    const geography = promptGeographyFromProfile(profile)!;
    expect(geography.places[0]).toMatchObject({ level: "neighborhood", name: "JVC", role: "primary" });
    expect(geography.places.map((place) => place.name)).toContain("Dubai");
    const { places } = discoveryPlaces(placesToLocations("prj", geography.places), { placeBound: true, scope: "local" });
    expect(places.slice(0, 8).filter((place) => place.say === "JVC").length).toBeGreaterThanOrEqual(2);
  });

  it("lets the editor widen the measurement back to the city", () => {
    const narrow = applyLocationEdit(chain(), { primary: { neighborhood: "Jabel Ali", city: "Dubai", country: "United Arab Emirates" }, marketArea: { level: "neighborhood", name: "JVC" } });
    const wide = applyLocationEdit(narrow, { primary: { neighborhood: "JVC", city: "Dubai", country: "United Arab Emirates" }, marketArea: { level: "city", name: "Dubai" } });
    expect(wide.location!.marketArea).toMatchObject({ level: "city", name: "Dubai", source: "user" });
    expect(promptGeographyFromProfile(wide)!.places[0]).toMatchObject({ level: "city", name: "Dubai" });
  });
});

describe("browser render merges same-site frames", () => {
  it("appends frame bodies inside the page body", () => {
    const merged = mergeFrames("<html><body><p>menu</p></body></html>", ['<section data-sun-frame="https://x.test/order">Biryani AED 40</section>']);
    expect(merged).toContain("Biryani AED 40");
    expect(merged.indexOf("</body>")).toBeGreaterThan(merged.indexOf("Biryani"));
  });
  it("leaves a page without frames alone", () => {
    expect(mergeFrames("<p>a</p>", [])).toBe("<p>a</p>");
  });
});

// A geocoder can file a district as its own "city": Photon answered the
// intake area "Dubai International Financial Centre" with city = DIFC and
// region = Dubai, so the market area became the city "DIFC" and a DIFC salon
// whose customers come from across Dubai was never asked about in Dubai
// (2026-09-18).
describe("operator area that the geocoder called a city", () => {
  const storefront = {
    label: "Staybridge Suites, DIFC, Dubai", formattedAddress: null, premise: "Staybridge Suites", street: "Sheikh Zayed Road",
    neighborhood: "DIFC", district: "Trade Center First", city: "Dubai", region: "Dubai", country: "United Arab Emirates", countryCode: "AE",
    postalCode: null, lat: 25.21, lng: 55.28, provider: "website", providerId: null,
  } as unknown as Parameters<typeof decideMarketArea>[0]["primary"];

  it("becomes a district of the business's own city when it is one of the business's areas", () => {
    const area = decideMarketArea({
      placeBound: true, scope: "local", primary: storefront, branches: [], presence: "single_location", countries: ["AE"],
      operatorArea: { neighborhood: null, district: null, city: "Dubai International Financial Centre", region: "Dubai", countryCode: "AE" },
      nearbyAreas: ["Business Bay", "Trade Centre"],
    });
    expect(area).toMatchObject({ level: "district", name: "Dubai International Financial Centre", source: "operator" });
  });

  it("stays a city when it is not one of the business's own areas", () => {
    const area = decideMarketArea({
      placeBound: true, scope: "local", primary: storefront, branches: [], presence: "single_location", countries: ["AE"],
      operatorArea: { neighborhood: null, district: null, city: "Hatta", region: "Dubai", countryCode: "AE" },
      nearbyAreas: ["Business Bay"],
    });
    expect(area).toMatchObject({ level: "city", name: "Hatta" });
  });

  it("stays the city when the operator chose the business's own city", () => {
    const area = decideMarketArea({
      placeBound: true, scope: "local", primary: storefront, branches: [], presence: "single_location", countries: ["AE"],
      operatorArea: { neighborhood: null, district: null, city: "Dubai", region: "Dubai", countryCode: "AE" },
    });
    expect(area).toMatchObject({ level: "city", name: "Dubai" });
  });
});
