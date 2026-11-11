// Keyless golden check for competitor tiers (tiers spec §9 and §12).
//
// Hand-built profiles mirror six golden businesses (location, scope, presence,
// branches). The plans must match `expect.tiers` in
// benchmarks/onboarding/golden-businesses.json, and the researched rivals,
// fed in as candidates with the evidence a real run would see (reported area
// or city, map distance, footprint, ccTLD), must land in their researched tier.
// Brand names are allowed here; nothing in src/ knows them.

import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { buildCompetitiveSearchProfile } from "@/lib/landscape/search-profile";
import { emptyBrandReach, planCompetitorTiers } from "@/lib/landscape/competitor-tiers";
import { scoreCompetitorCandidate } from "@/lib/landscape/competitor-scoring";
import { NearbyPlacesCandidateSource } from "@/lib/landscape/competitor-nearby";
import type { CandidateBusinessProfile, CompetitorCandidate } from "@/lib/landscape/competitor-types";
import type { BrandReach } from "@/lib/landscape/tier-types";
import type { BusinessProfile } from "@/lib/profile/schema";
import { scoreTiers, type GoldenCase } from "../../benchmarks/onboarding/score";
import { rival, siteProfile, tierBusiness } from "../helpers/tier-fixtures";

const golden = JSON.parse(fs.readFileSync(path.resolve("benchmarks/onboarding/golden-businesses.json"), "utf8")) as { cases: GoldenCase[] };
const goldenCase = (prefix: string) => golden.cases.find((c) => c.id.startsWith(prefix))!;

const KNOWN_GLOBAL: BrandReach = { known: true, points: 8, signals: [], checkedOpenKnowledge: true };

interface Fixture {
  prefix: string;
  profile: BusinessProfile;
  reach?: BrandReach;
  rivals: Array<{ candidate: CompetitorCandidate; site?: CandidateBusinessProfile | null }>;
  /** Places the plan names, in tier order. */
  places: string[];
}

const search = (name: string, location: CompetitorCandidate["location"], extra: Partial<CompetitorCandidate> = {}) =>
  rival(name, { location, structuralAffinity: 70, ...extra });

const FIXTURES: Fixture[] = [
  {
    prefix: "00-",
    profile: tierBusiness({ brand: "Atelier 10", domain: "atelier10.ae", kind: "personal_care_wellness", physicalPresence: "single_location", scope: "hyperlocal", primaryRole: "storefront", primary: { neighborhood: "DIFC", city: "Dubai", region: "Dubai", country: "United Arab Emirates", countryCode: "AE", lat: 25.2116, lng: 55.2823 }, nearbyAreas: ["Business Bay", "Downtown Dubai"], socialProfiles: ["https://instagram.com/atelier10", "https://facebook.com/atelier10", "https://tiktok.com/@atelier10"] }),
    places: ["DIFC", "Dubai"],
    rivals: [
      { candidate: search("The Salon Luxe", { area: "DIFC", city: "Dubai", country: "United Arab Emirates" }, { likelyDomain: "thesalonluxedubai.com" }) },
      { candidate: search("Y12 Salon", { area: "DIFC", city: "Dubai", country: "United Arab Emirates" }, { likelyDomain: "y12salons.com" }) },
      { candidate: search("It's Beauty DIFC", { area: null, city: null, country: null }, { likelyDomain: "itsbeauty.ae" }), site: siteProfile({ structuredLocalities: ["DIFC"], addressPlaceMentions: ["DIFC", "Dubai"] }) },
      { candidate: search("HAIRPLAY Hair Extensions Salon", { area: "Emirates Financial Towers, DIFC", city: "Dubai", country: null }, { likelyDomain: "hairplayextensions.com" }) },
      { candidate: search("Laurance Hair & Beauty Salon", { area: null, city: null, country: null, distanceMeters: 800 }, { likelyDomain: "laurancesalon.com", evidence: [{ source: "nearby_places", reason: "map", evidenceIds: [], discoveredAt: 1 }] }) },
    ],
  },
  {
    prefix: "02-",
    profile: tierBusiness({ brand: "Orfali Bros", domain: "orfalibros.com", kind: "restaurant_food_beverage", category: "Restaurant", physicalPresence: "single_location", scope: "local", primaryRole: "storefront", primary: { neighborhood: "Jumeirah", district: "Wasl 51", city: "Dubai", country: "United Arab Emirates", countryCode: "AE", lat: 25.2048, lng: 55.2527 }, nearbyAreas: ["Al Wasl"] }),
    places: ["Jumeirah", "Dubai"],
    rivals: [
      { candidate: search("Sufret Maryam", { area: "Jumeirah", city: "Dubai", country: null }) },
      { candidate: search("Manao", { area: null, city: null, country: null, distanceMeters: 900 }, { evidence: [{ source: "nearby_places", reason: "map", evidenceIds: [], discoveredAt: 1 }] }) },
      { candidate: search("Itadaku", { area: "Jumeirah 1", city: "Dubai", country: null }) },
      { candidate: search("3 Fils", { area: null, city: "Dubai", country: null, distanceMeters: 4200 }) },
    ],
  },
  {
    prefix: "05-",
    profile: tierBusiness({ brand: "Alaan", domain: "alaan.com", kind: "b2b_saas_software", category: "Spend management software", physicalPresence: "online_only", scope: "international", primaryRole: "headquarters", primary: { city: "Dubai", country: "United Arab Emirates", countryCode: "AE" }, countriesServed: ["AE", "SA"], customerType: "b2b" }),
    places: ["United Arab Emirates and Saudi Arabia"],
    rivals: [
      { candidate: search("Pemo", { area: null, city: "Dubai", country: "United Arab Emirates" }, { likelyDomain: "pemo.io" }) },
      { candidate: search("Qashio", { area: null, city: "Dubai", country: "UAE" }, { likelyDomain: "qashio.com" }) },
      { candidate: search("Zoho Expense", { area: null, city: null, country: "India" }, { likelyDomain: "zoho.com" }) },
      { candidate: search("Bayzat", { area: null, city: null, country: null }, { likelyDomain: "bayzat.com" }) },
    ],
  },
  {
    prefix: "06-",
    profile: tierBusiness({
      brand: "Tips & Toes",
      domain: "tipsandtoes.com",
      kind: "personal_care_wellness",
      category: "Nail and beauty salon",
      physicalPresence: "multi_location",
      scope: "regional",
      primaryRole: "headquarters",
      primary: { neighborhood: "Arjan", city: "Dubai", country: "United Arab Emirates", countryCode: "AE", lat: 25.06, lng: 55.24 },
      branches: [{ city: "Dubai", countryCode: "AE" }, { city: "Abu Dhabi", countryCode: "AE" }, { city: "Sharjah", countryCode: "AE" }, { city: "Riyadh", countryCode: "SA" }],
      countriesServed: ["AE", "SA"],
      locationCount: "many",
    }),
    places: ["Dubai", "United Arab Emirates and Saudi Arabia"],
    rivals: [
      { candidate: search("NStyle Beauty Lounge", { area: null, city: "Dubai", country: null }, { likelyDomain: "nstyle.ae" }) },
      { candidate: search("Sisters Beauty Lounge", { area: "Jumeirah", city: "Dubai", country: null }, { likelyDomain: "sistersbeautylounge.com" }) },
      { candidate: search("The Nail Spa", { area: "Dubai Marina", city: null, country: null }) },
      { candidate: search("Dollhouse", { area: null, city: null, country: null }, { likelyDomain: "dollhouse.ae" }), site: siteProfile({ localityCount: 5, hasLocationsPage: true, structuredLocalities: ["Dubai", "Abu Dhabi", "Al Ain", "Sharjah", "Ajman"] }) },
      { candidate: search("N.Bar", { area: null, city: "Abu Dhabi", country: "United Arab Emirates" }, { likelyDomain: "nbar.ae" }), site: siteProfile({ localityCount: 4, structuredLocalities: ["Abu Dhabi", "Al Ain", "Ras Al Khaimah", "Fujairah"], structuredCountries: ["AE"] }) },
    ],
  },
  {
    prefix: "15-",
    profile: tierBusiness({ brand: "Greggs", domain: "greggs.co.uk", kind: "restaurant_food_beverage", category: "Bakery", physicalPresence: "multi_location", scope: "national", primaryRole: "headquarters", primary: { neighborhood: "Gosforth", city: "Newcastle upon Tyne", country: "United Kingdom", countryCode: "GB", lat: 55.0215, lng: -1.6186 }, locationCount: "many" }),
    reach: KNOWN_GLOBAL,
    places: ["United Kingdom"],
    rivals: [
      { candidate: search("Pret A Manger", { area: null, city: "London", country: "United Kingdom" }, { likelyDomain: "pret.co.uk" }) },
      { candidate: search("Costa Coffee", { area: null, city: null, country: null }, { likelyDomain: "costa.co.uk" }) },
      { candidate: search("Subway UK", { area: null, city: null, country: "United States" }, { likelyDomain: "subway.com" }) },
      { candidate: search("M&S Food", { area: null, city: null, country: "UK" }, { likelyDomain: "marksandspencer.com" }) },
      { candidate: search("Starbucks UK", { area: null, city: "Seattle", country: null }, { likelyDomain: "starbucks.co.uk" }) },
    ],
  },
  {
    prefix: "16-",
    profile: tierBusiness({ brand: "Nike", domain: "nike.com", kind: "consumer_brand_manufacturer", category: "Athletic footwear and apparel", physicalPresence: "online_only", scope: "global", primaryRole: "headquarters", primary: null, countriesServed: [] }),
    reach: KNOWN_GLOBAL,
    places: ["Worldwide"],
    rivals: ["Adidas", "Puma", "Under Armour", "New Balance", "Lululemon"].map((name, index) => ({
      candidate: search(name, { area: null, city: null, country: index % 2 ? "United States" : "Germany" }, { evidence: [{ source: "open_knowledge", reason: "category", evidenceIds: [], discoveredAt: 1 }] }),
    })),
  },
];

describe("competitor tiers on the golden businesses (keyless)", () => {
  it.each(FIXTURES)("plans $prefix as the golden set expects and places its researched rivals", (fixture) => {
    const expected = goldenCase(fixture.prefix);
    expect(expected.expect.tiers, `${expected.id} has expect.tiers`).toBeTruthy();
    const target = buildCompetitiveSearchProfile(fixture.profile, []);
    const plan = planCompetitorTiers(fixture.profile, target, fixture.reach ?? emptyBrandReach());
    target.tiers = plan;
    expect(plan.tiers.map((spec) => spec.tier)).toEqual(expected.expect.tiers);
    expect(plan.tiers.map((spec) => spec.place)).toEqual(fixture.places);

    const researched = expected.researched?.competitors ?? [];
    const observed = fixture.rivals.map(({ candidate, site }) => {
      const ranked = scoreCompetitorCandidate(target, candidate, site ?? null);
      expect(ranked.rejectionReason, `${candidate.canonicalName}: ${ranked.rejectionReason}`).toBeNull();
      return { name: ranked.canonicalName, domain: ranked.likelyDomain, status: "candidate", type: ranked.role, rejectionReason: null, tier: ranked.tier.tier };
    });
    expect(observed).toHaveLength(researched.length);

    const checks = scoreTiers(expected, { tiers: plan.tiers.map((spec) => spec.tier), primaryTier: plan.primaryTier }, observed);
    const byName = Object.fromEntries(checks.map((check) => [check.name, check]));
    expect(byName["tier plan"]!.pass, byName["tier plan"]!.observed).toBe(true);
    expect(byName["researched rival tier"]!.pass, byName["researched rival tier"]!.observed).toBe(true);
    expect(byName["researched rival tier"]!.observed).toMatch(new RegExp(`^${researched.length}/${researched.length} `));
    for (const name of ["no country tier for a strictly local business", "no area/city tier for HQ-only or online businesses"]) {
      if (byName[name]) expect(byName[name]!.pass, byName[name]!.observed).toBe(true);
    }
  });

  it("rejects an Abu Dhabi single-location salon for the DIFC salon (no country tier)", () => {
    const fixture = FIXTURES[0]!;
    const target = buildCompetitiveSearchProfile(fixture.profile, []);
    target.tiers = planCompetitorTiers(fixture.profile, target, emptyBrandReach());
    const ranked = scoreCompetitorCandidate(target, search("Capital Salon", { area: "Al Reem Island", city: "Abu Dhabi", country: "United Arab Emirates" }), null);
    expect(ranked.rejectionReason).toMatch(/Abu Dhabi/);
  });

  it("groups Atelier 10's Dubai-wide rivals under Dubai, not DIFC, even though Downtown Dubai is a nearby area", () => {
    const fixture = FIXTURES[0]!;
    const target = buildCompetitiveSearchProfile(fixture.profile, []);
    target.tiers = planCompetitorTiers(fixture.profile, target, emptyBrandReach());
    const memory = [{ source: "ai_hypothesis" as const, reason: "memory", evidenceIds: [], discoveredAt: 1 }];
    const probes = [
      { candidate: search("Jumeirah Salon", { area: "Jumeirah", city: "Dubai", country: null }) },
      { candidate: search("Remembered Salon", { area: null, city: "Dubai", country: null }, { evidence: memory }) },
      { candidate: search("Footer Salon", { area: null, city: null, country: null }, { likelyDomain: "footer-salon.ae" }), site: siteProfile({ placeMentions: ["Dubai"], addressPlaceMentions: ["Dubai"], structuredLocalities: ["Dubai"] }) },
      { candidate: search("Barsha Salon", { area: "Al Barsha", city: "Dubai", country: null }) },
    ];
    for (const { candidate, site } of probes) {
      const ranked = scoreCompetitorCandidate(target, candidate, site ?? null);
      expect(ranked.tier, candidate.canonicalName).toMatchObject({ tier: "city", place: "Dubai" });
      expect(ranked.tier.evidence, candidate.canonicalName).not.toMatch(/DIFC|Downtown/);
    }
  });

  it("never looks for map neighbours around a head office (Tips & Toes, Greggs), only around a storefront (Atelier 10)", async () => {
    for (const fixture of FIXTURES.filter((f) => ["00-", "06-", "15-"].includes(f.prefix))) {
      let calls = 0;
      const source = new NearbyPlacesCandidateSource({ fetchPlaces: async () => { calls += 1; return []; } });
      const target = buildCompetitiveSearchProfile(fixture.profile, []);
      target.tiers = planCompetitorTiers(fixture.profile, target, fixture.reach ?? emptyBrandReach());
      await source.discover(target);
      expect(calls > 0, fixture.prefix).toBe(fixture.prefix === "00-");
    }
  });

  it("accepts a country tier for the destination restaurant only as an alternative plan", () => {
    const orfali = goldenCase("02-");
    const withCountry = scoreTiers(orfali, { tiers: ["area", "city", "country"], primaryTier: "city" }, []);
    expect(withCountry.find((check) => check.name === "tier plan")!.pass).toBe(true);
    const atelier = goldenCase("00-");
    const wrong = scoreTiers(atelier, { tiers: ["area", "city", "country"], primaryTier: "area" }, []);
    expect(wrong.find((check) => check.name === "tier plan")!.pass).toBe(false);
    expect(wrong.find((check) => check.name === "no country tier for a strictly local business")!.pass).toBe(false);
  });
});
