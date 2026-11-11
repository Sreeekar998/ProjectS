import { describe, expect, it } from "vitest";
import {
  assignCompetitorTier,
  computeBrandReach,
  effectiveTierFor,
  emptyBrandReach,
  planCompetitorTiers,
  planFromSearchProfile,
  selectByTierQuota,
  tierHeading,
  tierPlanDto,
  tierSubheading,
} from "@/lib/landscape/competitor-tiers";
import { buildCompetitiveSearchProfile } from "@/lib/landscape/search-profile";
import { scoreCompetitorCandidate } from "@/lib/landscape/competitor-scoring";
import { discoverCompetitors } from "@/lib/landscape/competitors";
import { promptGeographyFromProfile } from "@/lib/prompts/geography";
import type { BrandReach, CompetitorTier, CompetitorTierPlan } from "@/lib/landscape/tier-types";
import type { CompetitiveSearchProfile, RankedCompetitorCandidate } from "@/lib/landscape/competitor-types";
import type { BusinessProfile } from "@/lib/profile/schema";
import { makeProfile } from "../../helpers/profile-fixtures";
import { rival, siteProfile, tierBusiness } from "../../helpers/tier-fixtures";

const KNOWN: BrandReach = { known: true, points: 6, signals: [{ kind: "wikidata_entity", value: "x", points: 3 }], checkedOpenKnowledge: true };

function difcSalon(): BusinessProfile {
  return tierBusiness({
    brand: "Maison Nine",
    kind: "personal_care_wellness",
    physicalPresence: "single_location",
    scope: "hyperlocal",
    primaryRole: "storefront",
    primary: { neighborhood: "DIFC", city: "Dubai", country: "United Arab Emirates", countryCode: "AE", lat: 25.21, lng: 55.28 },
    nearbyAreas: ["Business Bay"],
  });
}

function planned(profile: BusinessProfile, reach: BrandReach = emptyBrandReach()): { plan: CompetitorTierPlan; target: CompetitiveSearchProfile } {
  const target = buildCompetitiveSearchProfile(profile, []);
  const plan = planCompetitorTiers(profile, target, reach);
  target.tiers = plan;
  return { plan, target };
}

const shape = (plan: CompetitorTierPlan) => plan.tiers.map((spec) => `${spec.tier}:${spec.place}:${spec.quota}`);

describe("planCompetitorTiers", () => {
  it("plans a hyperlocal DIFC salon as area + city, 8/8, primary area", () => {
    const { plan } = planned(difcSalon());
    expect(shape(plan)).toEqual(["area:DIFC:8", "city:Dubai:8"]);
    expect(plan.tiers[0]!.places).toEqual(["DIFC", "Business Bay"]);
    expect(plan.tiers[0]!.radiusMeters).toBe(3000);
    expect(plan.primaryTier).toBe("area");
    expect(plan.maxSuggestions).toBe(16);
  });

  it("adds a country tier for the same salon when it is a known brand: 6/6/6, cap 18", () => {
    const { plan } = planned(difcSalon(), KNOWN);
    expect(shape(plan)).toEqual(["area:DIFC:6", "city:Dubai:6", "country:United Arab Emirates:6"]);
    expect(plan.maxSuggestions).toBe(18);
    expect(plan.brandReach.known).toBe(true);
  });

  it("gives a local destination restaurant area 6 / city 10 with the city as primary", () => {
    const profile = tierBusiness({ brand: "Grill House", kind: "restaurant_food_beverage", category: "Restaurant", physicalPresence: "single_location", scope: "local", primaryRole: "storefront", primary: { neighborhood: "Jumeirah", city: "Dubai", country: "United Arab Emirates", countryCode: "AE" } });
    const { plan } = planned(profile);
    expect(shape(plan)).toEqual(["area:Jumeirah:6", "city:Dubai:10"]);
    expect(plan.primaryTier).toBe("city");
  });

  it("plans a regional multi-location chain with HQ and branches in two countries as city (+branch cities) and country, no area", () => {
    const profile = tierBusiness({
      brand: "Nail Chain",
      kind: "personal_care_wellness",
      physicalPresence: "multi_location",
      scope: "regional",
      primaryRole: "headquarters",
      primary: { neighborhood: "Arjan", city: "Dubai", country: "United Arab Emirates", countryCode: "AE", lat: 25.06, lng: 55.24 },
      branches: [{ city: "Abu Dhabi", countryCode: "AE" }, { city: "Sharjah", countryCode: "AE" }, { city: "Riyadh", countryCode: "SA" }],
      countriesServed: ["AE", "SA"],
    });
    const { plan } = planned(profile);
    expect(plan.tiers.map((spec) => spec.tier)).toEqual(["city", "country"]);
    // The Riyadh branch is not a place of "Across Dubai"; Saudi Arabia is in the country tier.
    expect(plan.tiers[0]!.places).toEqual(["Dubai", "Abu Dhabi", "Sharjah"]);
    expect(tierPlanDto(plan)!.tiers[0]).toMatchObject({ heading: "Across Dubai", subheading: "and Abu Dhabi, Sharjah" });
    expect(plan.tiers[1]!.place).toBe("United Arab Emirates and Saudi Arabia");
    expect(plan.tiers.map((spec) => spec.quota)).toEqual([8, 8]);
  });

  it("plans a national chain that publishes only its head office as country only", () => {
    const profile = tierBusiness({ brand: "Bake Chain", kind: "restaurant_food_beverage", category: "Bakery", physicalPresence: "multi_location", scope: "national", primaryRole: "headquarters", primary: { neighborhood: "Gosforth", city: "Newcastle upon Tyne", country: "United Kingdom", countryCode: "GB", lat: 55, lng: -1.6 } });
    const { plan } = planned(profile);
    expect(shape(plan)).toEqual(["country:United Kingdom:16"]);
    expect(plan.primaryTier).toBe("country");
  });

  it("plans an online SaaS selling in two countries as one country tier and no city tier", () => {
    const profile = tierBusiness({ brand: "Spend Cards", kind: "b2b_saas_software", category: "Spend management software", physicalPresence: "online_only", scope: "international", primaryRole: "headquarters", primary: { city: "Dubai", country: "United Arab Emirates", countryCode: "AE" }, countriesServed: ["AE", "SA"], customerType: "b2b" });
    const { plan } = planned(profile);
    expect(shape(plan)).toEqual(["country:United Arab Emirates and Saudi Arabia:16"]);
  });

  it("plans a global brand without a country as Worldwide", () => {
    const profile = tierBusiness({ brand: "Shoe Brand", kind: "consumer_brand_manufacturer", category: "Athletic footwear", physicalPresence: "online_only", scope: "global", primaryRole: "headquarters", primary: null, countriesServed: [] });
    const { plan } = planned(profile);
    expect(plan.tiers).toHaveLength(1);
    expect(plan.tiers[0]).toMatchObject({ tier: "country", place: "Worldwide", level: "global" });
    expect(tierHeading(plan.tiers[0]!)).toBe("Worldwide");
  });

  it("plans a service-area plumber as city only, plus country only when known", () => {
    const profile = tierBusiness({ brand: "Pipe Pros", kind: "local_service_home_trades", category: "Plumber", physicalPresence: "service_area", scope: "local", primaryRole: "service_base", primary: { neighborhood: "Park Slope", city: "New York", country: "United States", countryCode: "US", lat: 40.67, lng: -73.98 }, serviceAreas: [{ name: "Brooklyn", level: "district" }] });
    expect(shape(planned(profile).plan)).toEqual(["city:New York:16"]);
    expect(planned(profile, KNOWN).plan.tiers.map((spec) => spec.tier)).toEqual(["city", "country"]);
  });

  describe("businesses whose kind is not place-bound but whose market is local", () => {
    // The operator named DIFC on intake; Understand classified the site as an
    // agency, tour operator or "other". These got only "Across the United Arab
    // Emirates" while their prompts asked about DIFC and Dubai (review, 2026-09-14).
    const DIFC = { neighborhood: "DIFC", city: "Dubai", country: "United Arab Emirates", countryCode: "AE", lat: 25.21, lng: 55.28 };
    const localBusiness = (kind: string, fields: Partial<Parameters<typeof tierBusiness>[0]> = {}) =>
      tierBusiness({ brand: "Local Co", kind, category: "Local business", physicalPresence: "single_location", scope: "local", primaryRole: "service_base", primary: DIFC, customerType: "b2b", ...fields });

    it.each(["b2b_services_agency", "travel_tourism", "other"])("plans a local %s in DIFC as city Dubai only, agreeing with its prompt places", (kind) => {
      for (const primaryRole of ["service_base", "storefront", "unknown"] as const) {
        const profile = localBusiness(kind, { primaryRole });
        const { plan, target } = planned(profile);
        expect(shape(plan)).toEqual(["city:Dubai:16"]);
        expect(plan.primaryTier).toBe("city");
        // The search-profile path plans the same.
        expect(planFromSearchProfile({ ...target, tiers: undefined }).tiers.map((spec) => `${spec.tier}:${spec.place}`)).toEqual(["city:Dubai"]);

        const places = promptGeographyFromProfile(profile)!.places;
        const promptNames = places.map((place) => place.name);
        for (const spec of plan.tiers) expect(promptNames).toContain(spec.place);
        expect(places.some((place) => place.level === "country")).toBe(false);
      }
    });

    it("adds the area only when the market is hyperlocal, and a country tier only for a known brand", () => {
      const hyperlocal = localBusiness("b2b_services_agency", { scope: "hyperlocal", primaryRole: "storefront" });
      const { plan } = planned(hyperlocal);
      expect(shape(plan)).toEqual(["area:DIFC:8", "city:Dubai:8"]);
      const promptNames = promptGeographyFromProfile(hyperlocal)!.places.map((place) => place.name);
      expect(promptNames).toEqual(expect.arrayContaining(["DIFC", "Dubai"]));

      expect(planned(localBusiness("travel_tourism"), KNOWN).plan.tiers.map((spec) => `${spec.tier}:${spec.place}`)).toEqual(["city:Dubai", "country:United Arab Emirates"]);
    });

    it("gives a regional agency its city and countries", () => {
      const { plan } = planned(localBusiness("b2b_services_agency", { scope: "regional", primaryRole: "unknown", countriesServed: ["AE", "SA"] }));
      expect(plan.tiers.map((spec) => `${spec.tier}:${spec.place}`)).toEqual(["city:Dubai", "country:United Arab Emirates and Saudi Arabia"]);
    });

    it("keeps the D3 exclusions: online-only, software and national head-office-only businesses get no city tier", () => {
      expect(shape(planned(localBusiness("b2b_services_agency", { physicalPresence: "online_only" })).plan)).toEqual(["country:United Arab Emirates:16"]);
      expect(shape(planned(localBusiness("b2b_saas_software", { physicalPresence: "unknown", scope: "hyperlocal", primaryRole: "storefront" })).plan)).toEqual(["country:United Arab Emirates:16"]);
      expect(shape(planned(localBusiness("travel_tourism", { scope: "national", primaryRole: "headquarters" })).plan)).toEqual(["country:United Arab Emirates:16"]);
    });

    // The extraction prompt labels an address with no walk-in customers
    // "headquarters or office", so a local agency listing its DIFC office still
    // got only a country group (verifier, 2026-09-14).
    it.each(["b2b_services_agency", "travel_tourism", "finance_insurance", "other"])("gives a local or regional %s whose address is its office a Dubai group", (kind) => {
      const local = localBusiness(kind, { primaryRole: "headquarters" });
      const { plan } = planned(local);
      expect(shape(plan)).toEqual(["city:Dubai:16"]);
      const promptNames = promptGeographyFromProfile(local)!.places.map((place) => place.name);
      expect(promptNames).toContain("Dubai");

      const regional = planned(localBusiness(kind, { scope: "regional", primaryRole: "headquarters", countriesServed: ["AE", "SA"] })).plan;
      expect(regional.tiers.map((spec) => `${spec.tier}:${spec.place}`)).toEqual(["city:Dubai", "country:United Arab Emirates and Saudi Arabia"]);
    });
  });

  it("folds the country tier into the city tier for a city-state", () => {
    const profile = tierBusiness({ brand: "Smile Dental", kind: "healthcare_medical", category: "Dental clinic", physicalPresence: "multi_location", scope: "local", primaryRole: "storefront", primary: { neighborhood: "Orchard", city: "Singapore", country: "Singapore", countryCode: "SG" } });
    const { plan } = planned(profile, KNOWN);
    expect(plan.tiers.map((spec) => `${spec.tier}:${spec.place}`)).toEqual(["city:Singapore"]);
  });

  it("plans a legacy profile from its geography, or not at all", () => {
    const local = makeProfile({ brandName: "Old Plumber", archetype: "local_service", industry: "Plumbing", countries: ["United States"], cities: ["Austin"] });
    expect(planned(local).plan.tiers.map((spec) => `${spec.tier}:${spec.place}`)).toEqual(["city:Austin"]);
    const national = makeProfile({ brandName: "Old Shop", archetype: "ecommerce_dtc_retail", industry: "Retail", countries: ["United States"] });
    expect(planned(national).plan.tiers.map((spec) => `${spec.tier}:${spec.place}`)).toEqual(["country:United States"]);
    const nothing = makeProfile({ brandName: "Old Unknown", archetype: "other", industry: "Things" });
    expect(planned(nothing).plan.tiers).toEqual([]);
    expect(planned(nothing).plan.primaryTier).toBeNull();
  });

  it("labels groups for the page", () => {
    const { plan } = planned(difcSalon(), KNOWN);
    const dto = tierPlanDto(plan)!;
    expect(dto.tiers.map((group) => group.heading)).toEqual(["In DIFC", "Across Dubai", "Across the United Arab Emirates"]);
    expect(dto.tiers[0]!.subheading).toBe("and nearby: Business Bay");
    expect(dto.knownBrand).toBe(true);
    expect(tierSubheading({ tier: "area", place: "Nearby", places: [], radiusMeters: 3000 })).toBe("within 3 km");
    expect(tierHeading({ tier: "area", place: "Nearby", level: "neighborhood" })).toBe("Nearby");
    expect(tierPlanDto({ ...plan, tiers: [] })).toBeNull();
  });
});

describe("computeBrandReach", () => {
  const salon = () => difcSalon();

  it("knows a brand whose exact official-website entity has 25+ language editions", () => {
    const reach = computeBrandReach(salon(), { entity: { id: "Q1", label: "Maison Nine", description: "salon" }, matchedBy: "url", sitelinks: 31, countryCodes: ["AE"] }, true);
    expect(reach).toMatchObject({ known: true, points: 5, checkedOpenKnowledge: true });
  });

  it("does not know a brand from an entity with 2 language editions alone (3 points)", () => {
    const reach = computeBrandReach(salon(), { entity: { id: "Q1", label: "Maison Nine", description: "salon" }, matchedBy: "url", sitelinks: 2, countryCodes: ["AE"] }, true);
    expect(reach.points).toBe(3);
    expect(reach.known).toBe(false);
  });

  it("scores a name-search entity in another country as 0", () => {
    const reach = computeBrandReach(salon(), { entity: { id: "Q2", label: "Maison Nine", description: "company" }, matchedBy: "name", sitelinks: 40, countryCodes: ["FR"] }, true);
    expect(reach.points).toBe(0);
    expect(reach.known).toBe(false);
  });

  it("never knows a brand from social links alone", () => {
    const profile = salon();
    profile.contact = { phones: [], emails: [], bookingPlatforms: [], socialProfiles: ["https://instagram.com/x", "https://facebook.com/x", "https://tiktok.com/@x", "https://x.com/x", "https://youtube.com/x"] };
    const reach = computeBrandReach(profile, null, false);
    expect(reach.points).toBe(1);
    expect(reach.known).toBe(false);
  });

  it("knows a national multi-location chain with branches in 3 cities", () => {
    const profile = tierBusiness({ brand: "Chain", kind: "personal_care_wellness", physicalPresence: "multi_location", scope: "national", primaryRole: "storefront", primary: { city: "Dubai", countryCode: "AE" }, branches: [{ city: "Abu Dhabi", countryCode: "AE" }, { city: "Sharjah", countryCode: "AE" }] });
    const reach = computeBrandReach(profile, null, false);
    expect(reach.points).toBe(4);
    expect(reach.known).toBe(true);
  });

  it("scores nothing and marks the lookup unchecked when it times out", async () => {
    const profile = salon();
    const never = { resolve: () => new Promise<never>(() => undefined) };
    let reach: BrandReach | null = null;
    await discoverCompetitors(profile, [], [], {
      sources: [],
      targetKnowledge: never,
      brandLookupTimeoutMs: 20,
      onEvent: (event) => {
        if (event.type === "started") reach = event.profile.tiers!.brandReach;
      },
    });
    expect(reach).toMatchObject({ known: false, points: 0, checkedOpenKnowledge: false });
  });
});

describe("assignCompetitorTier", () => {
  const { plan, target } = planned(difcSalon());

  it("places a rival 600 m away in the area tier by distance", () => {
    expect(assignCompetitorTier(plan, target, rival("A", { location: { area: null, city: null, country: null, distanceMeters: 600 } }), null)).toMatchObject({ tier: "area", basis: "distance", geographyScore: 95 });
  });

  it("places a rival reported in a nearby area in the area tier by name", () => {
    expect(assignCompetitorTier(plan, target, rival("B", { location: { area: "Business Bay", city: "Dubai", country: null } }), null)).toMatchObject({ tier: "area", basis: "area_name", place: "DIFC" });
  });

  it("places a rival 5 km away with no names in the city tier at 75", () => {
    expect(assignCompetitorTier(plan, target, rival("C", { location: { area: null, city: null, country: null, distanceMeters: 5000 } }), null)).toMatchObject({ tier: "city", basis: "distance", geographyScore: 75 });
  });

  it("places a rival reported in the city in the city tier", () => {
    expect(assignCompetitorTier(plan, target, rival("D", { location: { area: null, city: "Dubai", country: null } }), null)).toMatchObject({ tier: "city", basis: "city_name", geographyScore: 85 });
  });

  it("leaves a single-location rival in another city without a tier, and the scorer rejects it", () => {
    const candidate = rival("E", { location: { area: null, city: "Abu Dhabi", country: "United Arab Emirates" } });
    expect(assignCompetitorTier(plan, target, candidate, null)).toMatchObject({ tier: null, elsewhere: "Abu Dhabi" });
    expect(scoreCompetitorCandidate(target, candidate, null).rejectionReason).toMatch(/^Based in Abu Dhabi, outside Dubai/);
  });

  it("keeps an out-of-city chain with a multi-city footprint as a country-tier rival when the plan has a country tier", () => {
    const known = planned(difcSalon(), KNOWN);
    const candidate = rival("F", { likelyDomain: "f.example", location: { area: null, city: "Abu Dhabi", country: "United Arab Emirates" } });
    const siteElsewhere = siteProfile({ localityCount: 4, structuredLocalities: ["Abu Dhabi", "Al Ain", "Sharjah", "Ajman"] });
    expect(assignCompetitorTier(known.plan, known.target, candidate, siteElsewhere)).toMatchObject({ tier: "country", basis: "country_footprint" });
    expect(scoreCompetitorCandidate(known.target, candidate, siteElsewhere).rejectionReason).toBeNull();
  });

  it("puts a rival in another city of the country in the country tier of a national plan, without rejecting it", () => {
    const national = planned(tierBusiness({ brand: "Bake Chain", kind: "restaurant_food_beverage", category: "Bakery", physicalPresence: "multi_location", scope: "national", primaryRole: "headquarters", primary: { city: "Newcastle upon Tyne", country: "United Kingdom", countryCode: "GB" } }));
    const candidate = rival("Coffee Chain", { location: { area: null, city: "London", country: "United Kingdom" } });
    expect(assignCompetitorTier(national.plan, national.target, candidate, null)).toMatchObject({ tier: "country", place: "United Kingdom" });
    expect(scoreCompetitorCandidate(national.target, candidate, null).rejectionReason).toBeNull();
  });

  it("puts every rival of a global plan in the Worldwide tier", () => {
    const global = planned(tierBusiness({ brand: "Shoe Brand", kind: "consumer_brand_manufacturer", physicalPresence: "online_only", scope: "global", primaryRole: "headquarters", primary: null }));
    expect(assignCompetitorTier(global.plan, global.target, rival("G", { location: { area: null, city: "Herzogenaurach", country: "Germany" } }), null)).toMatchObject({ tier: "country", place: "Worldwide", geographyScore: 80 });
  });

  it("does not put a rival in the area for a body-text mention; its address decides", () => {
    const site = siteProfile({ placeMentions: ["DIFC", "Dubai"], addressPlaceMentions: ["Dubai"], structuredLocalities: ["Dubai"] });
    expect(assignCompetitorTier(plan, target, rival("H", { likelyDomain: "h.example" }), site)).toMatchObject({ tier: "city", basis: "structured_locality" });
  });

  it("uses a search source's area hint when there is no location evidence", () => {
    expect(assignCompetitorTier(plan, target, rival("I", { tierHint: [{ tier: "area", source: "web_search" }] }), null)).toMatchObject({ tier: "area", basis: "source_hint", geographyScore: 55 });
  });

  it("falls back to the city tier, unverified, with no evidence and no hint, and no evidence text for Why?", () => {
    expect(assignCompetitorTier(plan, target, rival("J"), null)).toMatchObject({ tier: "city", basis: "unverified", geographyScore: 50, evidence: "" });
  });

  it("gives Why? no text for a single-tier fallback or a country-only rival with evidence of another country", () => {
    const national = planned(tierBusiness({ brand: "Bake Chain", kind: "restaurant_food_beverage", category: "Bakery", physicalPresence: "multi_location", scope: "national", primaryRole: "headquarters", primary: { city: "Newcastle upon Tyne", country: "United Kingdom", countryCode: "GB" } }));
    expect(assignCompetitorTier(national.plan, national.target, rival("K"), null)).toMatchObject({ tier: "country", basis: "single_tier", evidence: "" });
    expect(assignCompetitorTier(national.plan, national.target, rival("L", { location: { area: null, city: null, country: "United States" } }), null)).toMatchObject({ tier: "country", basis: "unverified", geographyScore: 35, evidence: "" });
  });
});

describe("place names in tier assignment", () => {
  // Nearby areas whose names contain the city's, as for a real DIFC salon.
  function atelier(): { plan: CompetitorTierPlan; target: CompetitiveSearchProfile } {
    const profile = difcSalon();
    profile.location!.nearbyAreas = ["Business Bay", "Downtown Dubai"];
    return planned(profile);
  }

  it("groups a rival reported only in the city under the city, even when a nearby area contains the city's name", () => {
    const { plan, target } = atelier();
    expect(plan.tiers[0]!.places).toEqual(["DIFC", "Business Bay", "Downtown Dubai"]);
    for (const location of [{ area: "Jumeirah", city: "Dubai" }, { area: null, city: "Dubai" }, { area: "Al Barsha", city: "Dubai" }]) {
      expect(assignCompetitorTier(plan, target, rival("M", { location: { ...location, country: null } }), null), JSON.stringify(location)).toMatchObject({ tier: "city", basis: "city_name", evidence: "Located in Dubai" });
    }
    const aiOnly = rival("N", { evidence: [{ source: "ai_hypothesis", reason: "memory", evidenceIds: [], discoveredAt: 1 }], location: { area: null, city: "Dubai", country: null } });
    expect(assignCompetitorTier(plan, target, aiOnly, null)).toMatchObject({ tier: "city", evidence: "Located in Dubai" });
    const footerOnlyDubai = siteProfile({ placeMentions: ["Dubai"], addressPlaceMentions: ["Dubai"], structuredLocalities: ["Dubai"] });
    expect(assignCompetitorTier(plan, target, rival("O", { likelyDomain: "o.example" }), footerOnlyDubai)).toMatchObject({ tier: "city", basis: "structured_locality", evidence: "Address in Dubai on its website" });
  });

  it("still groups a rival in a named part of an area under that area", () => {
    const { plan, target } = atelier();
    const located = (area: string) => assignCompetitorTier(plan, target, rival("P", { location: { area, city: "Dubai", country: null } }), null);
    expect(located("Downtown Dubai")).toMatchObject({ tier: "area", evidence: "Located in Downtown Dubai" });
    expect(located("DIFC Gate Village")).toMatchObject({ tier: "area", evidence: "Located in DIFC" });
    expect(located("Emirates Financial Towers, DIFC")).toMatchObject({ tier: "area", evidence: "Located in DIFC" });
    expect(assignCompetitorTier(plan, target, rival("Q", { location: { area: null, city: "Dubai Marina", country: null } }), null)).toMatchObject({ tier: "city", evidence: "Located in Dubai" });
  });

  it("does not take New York for York, and rejects it", () => {
    const { plan, target } = planned(tierBusiness({ brand: "Minster Hair", kind: "personal_care_wellness", physicalPresence: "single_location", scope: "hyperlocal", primaryRole: "storefront", primary: { neighborhood: "Micklegate", city: "York", country: "United Kingdom", countryCode: "GB" } }));
    const candidate = rival("R", { location: { area: "Manhattan", city: "New York", country: null } });
    expect(assignCompetitorTier(plan, target, candidate, null)).toMatchObject({ tier: null, elsewhere: "New York" });
    expect(scoreCompetitorCandidate(target, candidate, null).rejectionReason).toMatch(/^Based in New York, outside York/);
    // The same city name in another country is not the target's city either.
    const homonym = rival("S", { location: { area: null, city: "York", country: "United States" } });
    expect(assignCompetitorTier(plan, target, homonym, null)).toMatchObject({ tier: null, elsewhere: "United States" });
  });

  it("does not reject a website locality that only overlaps a local place when its country is the target's", () => {
    const { plan, target } = planned(tierBusiness({ brand: "Nail Chain", kind: "personal_care_wellness", physicalPresence: "multi_location", scope: "regional", primaryRole: "headquarters", primary: { city: "Dubai", country: "United Arab Emirates", countryCode: "AE" }, branches: [{ city: "Sharjah", countryCode: "AE" }], countriesServed: ["AE"] }));
    const site = siteProfile({ structuredLocalities: ["Downtown Dubai"], structuredCountries: ["AE"] });
    const ranked = assignCompetitorTier(plan, target, rival("T", { likelyDomain: "t.example" }), site);
    expect(ranked.elsewhere).toBeNull();
    expect(ranked.tier).toBe("city");
  });

  it("does not put a rival in a branch city of another country under the home city", () => {
    const { plan, target } = planned(tierBusiness({ brand: "Nail Chain", kind: "personal_care_wellness", physicalPresence: "multi_location", scope: "regional", primaryRole: "headquarters", primary: { city: "Dubai", country: "United Arab Emirates", countryCode: "AE" }, branches: [{ city: "Abu Dhabi", countryCode: "AE" }, { city: "Riyadh", countryCode: "SA" }], countriesServed: ["AE", "SA"] }));
    expect(assignCompetitorTier(plan, target, rival("U", { location: { area: null, city: "Abu Dhabi", country: null } }), null)).toMatchObject({ tier: "city", place: "Dubai", evidence: "Located in Abu Dhabi" });
    expect(assignCompetitorTier(plan, target, rival("V", { location: { area: null, city: "Riyadh", country: "Saudi Arabia" } }), null).tier).not.toBe("city");
  });
});

describe("tier scoring rules", () => {
  const memory = (extra = {}) => rival("Remembered", { evidence: [{ source: "ai_hypothesis", reason: "memory", evidenceIds: [], discoveredAt: 1 }], ...extra });

  it("rejects a memory-only area hypothesis", () => {
    const { target } = planned(difcSalon());
    const ranked = scoreCompetitorCandidate(target, memory({ tierHint: [{ tier: "area", source: "ai_hypothesis" }] }), null);
    expect(ranked.tier.tier).toBe("area");
    expect(ranked.rejectionReason).toMatch(/general knowledge/);
  });

  it("keeps a memory-only country hypothesis for a national plan", () => {
    const { target } = planned(tierBusiness({ brand: "Bake Chain", kind: "restaurant_food_beverage", category: "Bakery", physicalPresence: "multi_location", scope: "national", primaryRole: "headquarters", primary: { city: "Newcastle upon Tyne", country: "United Kingdom", countryCode: "GB" } }));
    const ranked = scoreCompetitorCandidate(target, memory({ proposedType: "direct", confidence: 75, structuralAffinity: 60 }), null);
    expect(ranked.tier.tier).toBe("country");
    expect(ranked.rejectionReason).toBeNull();
  });

  it("rejects an unverified memory-only country hypothesis for a known local brand, and keeps a verified one", () => {
    const { target } = planned(difcSalon(), KNOWN);
    const hinted = memory({ likelyDomain: "chain.example", tierHint: [{ tier: "country", source: "ai_hypothesis" }], structuralAffinity: 60 });
    const unverified = scoreCompetitorCandidate(target, hinted, null);
    expect(unverified.tier.tier).toBe("country");
    expect(unverified.rejectionReason).toMatch(/general knowledge/);
    const verified = scoreCompetitorCandidate(target, hinted, siteProfile({ categorySignals: ["Hair salon"], offerings: ["Hair salon"] }));
    expect(verified.tier.tier).toBe("country");
    expect(verified.rejectionReason).toBeNull();
  });

  it("keeps the weak-match rule for map-only rivals", () => {
    const { target } = planned(difcSalon());
    const ranked = scoreCompetitorCandidate(target, rival("Burger Place", { evidence: [{ source: "nearby_places", reason: "map", evidenceIds: [], discoveredAt: 1 }], location: { area: null, city: null, country: null, distanceMeters: 300 }, screening: { keep: true, relevance: 20, reason: "Different kind of place." } }), null);
    expect(ranked.rejectionReason).toMatch(/Weak like-for-like match/);
  });
});

describe("selectByTierQuota", () => {
  const plan3 = planned(difcSalon(), KNOWN).plan;
  function ranked(tier: CompetitorTier, count: number, offset = 0): RankedCompetitorCandidate[] {
    return Array.from({ length: count }, (_, index) => ({
      ...rival(`${tier}-${index + offset}`),
      normalizedName: `${tier}${index}`,
      canonicalDomain: null,
      candidateProfile: null,
      role: "direct",
      score: { structuralAffinity: 0, offeringOverlap: 0, jobUseCaseOverlap: 0, audienceOverlap: 0, categoryOverlap: 0, geographyOverlap: 0, archetypeCompatibility: 0, semanticSimilarity: 0, evidenceConfidence: 0, total: 90 - index },
      rejectionReason: null,
      verificationStatus: "not_applicable",
      verificationSummary: "",
      tier: { tier, place: tier, basis: "unverified", evidence: "", elsewhere: null, geographyScore: 50 },
    }));
  }
  const count = (list: RankedCompetitorCandidate[]) => ["area", "city", "country"].map((tier) => list.filter((c) => c.tier.tier === tier).length);

  it("takes 6/6/6 in plan order from 10 valid per tier", () => {
    const chosen = selectByTierQuota(plan3, [...ranked("country", 10), ...ranked("city", 10), ...ranked("area", 10)]);
    expect(chosen).toHaveLength(18);
    expect(count(chosen)).toEqual([6, 6, 6]);
  });

  it("hands unused slots round-robin: 2 area + 10 city + 10 country gives 2/8/8", () => {
    const chosen = selectByTierQuota(plan3, [...ranked("area", 2), ...ranked("city", 10), ...ranked("country", 10)]);
    expect(count(chosen)).toEqual([2, 8, 8]);
  });

  it("keeps the top 16 by score for a single-tier plan", () => {
    const national = planned(tierBusiness({ brand: "Bake Chain", kind: "restaurant_food_beverage", physicalPresence: "multi_location", scope: "national", primaryRole: "headquarters", primary: { city: "Newcastle upon Tyne", countryCode: "GB" } })).plan;
    const all = ranked("country", 20);
    expect(selectByTierQuota(national, all)).toEqual(all.slice(0, 16));
  });

  it("never lets rejected rows consume quota", async () => {
    const profile = difcSalon();
    const plan = planned(profile).plan;
    const located = (name: string, distanceMeters: number) => rival(name, { location: { area: null, city: null, country: null, distanceMeters }, structuralAffinity: 70 });
    const sources = [
      {
        sourceType: "web_search" as const,
        discover: async () => [
          ...Array.from({ length: 6 }, (_, i) => rival(`Far ${i}`, { location: { area: null, city: "Abu Dhabi", country: null }, structuralAffinity: 90 })),
          ...Array.from({ length: 10 }, (_, i) => located(`Near ${i}`, 500 + i)),
          ...Array.from({ length: 10 }, (_, i) => located(`Town ${i}`, 9000 + i)),
        ],
      },
    ];
    const result = await discoverCompetitors(profile, [], [], { sources, tierPlan: plan, verify: async () => null });
    const valid = result.candidates.filter((c) => !c.rejectionReason);
    expect(count(valid)).toEqual([8, 8, 0]);
    expect(result.candidates.filter((c) => c.rejectionReason).length).toBe(6);
    expect(result.metrics.suggestedByTier).toEqual({ area: 8, city: 8, country: 0 });
  });
});

describe("effectiveTierFor", () => {
  const { plan, target } = planned(difcSalon());
  const row = (fields: Record<string, unknown>) => ({ canonicalName: "Row", canonicalDomain: null, competitorType: "direct", source: "web_search", sourceContributions: ["web_search"], candidateProfile: null, rejectionReason: null, ...fields });

  it("returns a stored tier as stored", () => {
    const stored = { tier: "city", place: "Dubai", basis: "operator", evidence: "Placed here by you", policy: "competitor-tiers@1" };
    expect(effectiveTierFor(row({ candidateProfile: { tier: stored } }), plan, target)).toEqual(stored);
  });

  it("derives a tier for a row stored before tiers from its reported location, without writing", () => {
    const tier = effectiveTierFor(row({ candidateProfile: { reportedLocation: { area: "DIFC", city: "Dubai", country: null }, sourceUrls: [] } }), plan, target);
    expect(tier).toMatchObject({ tier: "area", place: "DIFC", derived: true });
  });

  it("puts a manual row without a tier in the primary tier as an operator choice", () => {
    expect(effectiveTierFor(row({ source: "user_manual", sourceContributions: ["user_manual"] }), plan, target)).toMatchObject({ tier: "area", basis: "operator" });
  });

  it("gives system-rejected rows no tier", () => {
    expect(effectiveTierFor(row({ rejectionReason: "Based in Abu Dhabi" }), plan, target)).toBeNull();
  });
});
