import { afterEach, describe, expect, it, vi } from "vitest";
import type { CompetitiveSearchProfile, CompetitorCandidate, CandidateBusinessProfile } from "@/lib/landscape/competitor-types";
import { scoreCompetitorCandidate } from "@/lib/landscape/competitor-scoring";
import { buildSearchTasks } from "@/lib/landscape/competitor-search";
import { assignCompetitorTier, emptyBrandReach, planFromSearchProfile } from "@/lib/landscape/competitor-tiers";
import { NearbyPlacesCandidateSource } from "@/lib/landscape/competitor-nearby";
import { discoverCompetitors } from "@/lib/landscape/competitors";
import { makeProfile } from "../../helpers/profile-fixtures";

function salonTarget(): CompetitiveSearchProfile {
  return {
    targetBrand: "Maison Nine", aliases: [], canonicalDomain: "maisonnine.example", parentBrand: null,
    industry: "Beauty and personal care", subIndustry: "Hair salon", businessArchetype: "local_service", businessModel: "B2C",
    offerings: ["Balayage", "Gel manicure", "Volume lash extensions"], jobsToBeDone: [], useCases: [], targetAudiences: ["Busy professionals"], personas: [],
    importantTopics: [{ id: "t1", name: "Hair colour", discoveryConcept: "Hair colour" }], evaluationCriteria: [],
    geography: { scope: "local", cities: ["Dubai"], regions: ["Dubai"], countries: ["United Arab Emirates"], locale: "en", neighborhoods: ["DIFC"], nearbyAreas: ["Business Bay"], countryCode: "AE", placeLabel: "DIFC, Dubai, United Arab Emirates", formattedAddress: "Gate Building, DIFC, Dubai", lat: 25.21, lng: 55.27 },
    understanding: { kind: "personal_care_wellness", businessType: "Luxury hair salon", localCategory: "Hair salon", path: ["Beauty", "Hair salon"], description: "A luxury hair and nail salon in DIFC.", pricePositioning: "luxury", physicalPresence: "single_location", placeBound: true, offeringGroups: [{ name: "Hair", items: ["Balayage"] }, { name: "Nails", items: ["Gel manicure"] }], audienceSegments: ["Busy professionals in DIFC"] },
    evidenceIds: [],
  };
}

function candidate(name: string, extra: Partial<CompetitorCandidate> = {}): CompetitorCandidate {
  return { canonicalName: name, likelyDomain: null, proposedType: "direct", entityType: "local_location", reason: "Same kind of salon nearby.", matchedDimensions: ["hair salon"], confidence: 60, evidence: [{ source: "web_search", reason: "Search result", evidenceIds: [], discoveredAt: 1 }], aliases: [], ...extra };
}

const failedFetch: CandidateBusinessProfile = { displayName: "x", canonicalDomain: "x.example", finalUrl: null, title: null, description: null, offerings: [], audienceSignals: [], jobSignals: [], useCaseSignals: [], categorySignals: [], geographySignals: [], placeMentions: [], structuredLocalities: [], contentTokens: [], pagesFetched: [], verificationStatus: "failed", verificationSummary: "timeout" };

describe("local competitor geography", () => {
  it("does not call a rival non-local because its website could not be fetched", () => {
    const ranked = scoreCompetitorCandidate(salonTarget(), candidate("Salon Alpha", { likelyDomain: "x.example" }), failedFetch);
    expect(ranked.rejectionReason).toBeNull();
    expect(ranked.score.geographyOverlap).toBe(50);
  });

  it("puts the neighbourhood in the area tier and the rest of the city in the city tier, and rejects a rival positively placed in another city", () => {
    const target = salonTarget();
    const plan = planFromSearchProfile(target);
    const inDifc = assignCompetitorTier(plan, target, candidate("A", { location: { area: "DIFC", city: "Dubai", country: null } }), null);
    expect(inDifc).toMatchObject({ tier: "area", place: "DIFC", basis: "area_name", geographyScore: 92 });
    const inJumeirah = assignCompetitorTier(plan, target, candidate("B", { location: { area: "Jumeirah", city: "Dubai", country: null } }), null);
    expect(inJumeirah).toMatchObject({ tier: "city", place: "Dubai", basis: "city_name", geographyScore: 85 });
    const far = scoreCompetitorCandidate(target, candidate("C", { location: { area: null, city: "Abu Dhabi", country: "United Arab Emirates" } }), null);
    expect(far.tier.tier).toBeNull();
    expect(far.rejectionReason).toMatch(/Abu Dhabi/);
  });

  it("uses map distance when a source measured it", () => {
    const target = salonTarget();
    const near = assignCompetitorTier(planFromSearchProfile(target), target, candidate("D", { location: { area: null, city: null, country: null, distanceMeters: 900 } }), null);
    expect(near).toMatchObject({ tier: "area", basis: "distance", geographyScore: 95 });
    expect(near.evidence).toMatch(/900 m away/);
  });

  it("rejects a place-bound rival known only from model memory", () => {
    const ranked = scoreCompetitorCandidate(salonTarget(), candidate("Remembered Salon", { evidence: [{ source: "ai_hypothesis", reason: "memory", evidenceIds: [], discoveredAt: 1 }] }), null);
    expect(ranked.rejectionReason).toMatch(/general knowledge/);
  });

  it("does not treat a customer-facing reason as a customer relationship", () => {
    const ranked = scoreCompetitorCandidate(salonTarget(), candidate("Salon Beta", { reason: "Customers of the target would also consider it for balayage.", location: { area: "DIFC", city: "Dubai", country: null } }), null);
    expect(ranked.role).not.toBe("not_competitor");
  });
});

describe("search briefs", () => {
  it("asks one question per planned tier: the neighbourhood, then across the city", () => {
    const briefs = buildSearchTasks(salonTarget());
    expect(briefs.map((brief) => brief.tier)).toEqual(["area", "city"]);
    const [area, city] = briefs;
    expect(area!.task).toMatch(/hair salon in DIFC/);
    expect(area!.task).toMatch(/near Business Bay/);
    expect(area!.task).toMatch(/Do not include businesses elsewhere in Dubai/);
    expect(city!.task).toMatch(/across Dubai/);
    for (const brief of briefs) {
      expect(brief.task).not.toMatch(/United States/);
      expect(brief.userLocation).toMatchObject({ country: "AE", city: "Dubai" });
    }
  });

  it("adds a country brief only when the plan has a country tier", () => {
    const target = salonTarget();
    const known = { ...emptyBrandReach(), known: true, points: 5 };
    target.tiers = planFromSearchProfile(target, known);
    expect(target.tiers.tiers.map((spec) => spec.tier)).toEqual(["area", "city", "country"]);
    const country = buildSearchTasks(target).find((brief) => brief.tier === "country")!;
    expect(country.task).toMatch(/across the United Arab Emirates/);
    expect(country.userLocation).toEqual({ country: "AE" });
  });

  it("names the country for a national chain and has no city in the location", () => {
    const target = salonTarget();
    target.geography = { ...target.geography, scope: "national", primaryRole: "headquarters", neighborhoods: [], nearbyAreas: [], cities: ["Newcastle upon Tyne"], countries: ["United Kingdom"], countryCode: "GB" };
    target.understanding = { ...target.understanding!, localCategory: "Bakery", businessType: "Bakery chain", physicalPresence: "multi_location" };
    const briefs = buildSearchTasks(target);
    expect(briefs.map((brief) => brief.tier)).toEqual(["country"]);
    expect(briefs[0]!.task).toMatch(/across the United Kingdom/);
    expect(briefs[0]!.task).not.toMatch(/Newcastle/);
    expect(briefs[0]!.userLocation).toEqual({ country: "GB" });
  });

  it("says worldwide for a global brand", () => {
    const target = salonTarget();
    target.geography = { scope: "global", cities: [], regions: [], countries: [], locale: "en" };
    target.understanding = { ...target.understanding!, placeBound: false, physicalPresence: "online_only" };
    const briefs = buildSearchTasks(target);
    expect(briefs).toHaveLength(1);
    expect(briefs[0]!.task).toMatch(/worldwide/);
    expect(briefs[0]!.userLocation).toBeUndefined();
  });
});

describe("nearby places source", () => {
  it("turns nearby same-category places into located candidates, excluding the target", async () => {
    const source = new NearbyPlacesCandidateSource({
      fetchPlaces: async () => [
        { osmId: "node/1", name: "Maison Nine", website: "https://maisonnine.example", tags: {}, matchedFilter: "shop=hairdresser", lat: 25.21, lng: 55.27, distanceMeters: 5, suburb: null, city: null },
        { osmId: "node/2", name: "Salon Gamma", website: "https://gamma.example", tags: {}, matchedFilter: "shop=hairdresser", lat: 25.215, lng: 55.27, distanceMeters: 600, suburb: "DIFC", city: null },
      ],
    });
    const found = await source.discover(salonTarget());
    expect(found.map((c) => c.canonicalName)).toEqual(["Salon Gamma"]);
    expect(found[0]!.location?.distanceMeters).toBe(600);
    expect(found[0]!.sourceUrls?.[0]).toMatch(/openstreetmap\.org\/node\/2/);
  });

  it("hints the area tier within 3 km (or a matching suburb) and the city tier beyond, and marks brand-tagged chains", async () => {
    const place = (id: number, name: string, distanceMeters: number, extra: Record<string, unknown> = {}) => ({ osmId: `node/${id}`, name, website: null, tags: {}, matchedFilter: "shop=hairdresser", lat: 25.2, lng: 55.2, distanceMeters, suburb: null, city: null, ...extra });
    const source = new NearbyPlacesCandidateSource({
      fetchPlaces: async () => [
        place(1, "Salon Close", 2_900),
        place(2, "Salon Bay", 4_200, { suburb: "Business Bay" }),
        place(3, "Salon Far", 3_500),
        place(4, "Salon Chain", 1_200, { tags: { brand: "Chain Co" } }),
        place(5, "Salon Sharjah", 5_000, { city: "Sharjah" }),
      ],
    });
    const found = await source.discover(salonTarget());
    const hint = (name: string) => found.find((c) => c.canonicalName === name)?.tierHint?.[0]?.tier ?? null;
    expect(hint("Salon Close")).toBe("area");
    expect(hint("Salon Bay")).toBe("area");
    expect(hint("Salon Far")).toBe("city");
    expect(hint("Salon Sharjah")).toBeNull();
    const chain = found.find((c) => c.canonicalName === "Salon Chain")!;
    expect(chain.chain).toBe(true);
    expect(chain.matchedDimensions).toContain("chain");
  });

  it("returns nothing for a plan without an area tier, even with coordinates (a national chain's head office)", async () => {
    let called = false;
    const source = new NearbyPlacesCandidateSource({ fetchPlaces: async () => { called = true; return []; } });
    const target = salonTarget();
    target.geography = { ...target.geography, scope: "national", primaryRole: "headquarters" };
    target.understanding = { ...target.understanding!, physicalPresence: "multi_location" };
    expect(await source.discover(target)).toEqual([]);
    expect(called).toBe(false);
  });
});

describe("comparison mentions on a local business site", () => {
  it("never makes a service named in a 'vs' sentence a competitor", async () => {
    const profile = makeProfile({ brandName: "Maison Nine", archetype: "local_service", industry: "Beauty", offerings: ["Lash lift", "Lash extensions"] });
    profile.classification = { industry: "Beauty", subIndustry: null, businessType: "Hair salon", path: ["Beauty", "Hair salon"], kind: "personal_care_wellness", businessModel: "services_in_person", customerType: "b2c", physicalPresence: "single_location", pricePositioning: "luxury", localCategory: "Hair salon", alternatives: [], ruledOut: [], rationale: "", source: "evidence", evidenceIds: [], confidence: 90 };
    const result = await discoverCompetitors(profile, [], [], {
      sources: [{ sourceType: "website_explicit", discover: async () => [candidate("Lash Extensions", { evidence: [{ source: "website_explicit", reason: "Lash Lift vs Lash Extensions", evidenceIds: [], discoveredAt: 1 }] })] }],
      verify: async () => null,
    });
    expect(result.candidates).toHaveLength(0);
  });
});

describe("branch-finder footprint on a rival's website", () => {
  afterEach(() => {
    vi.doUnmock("@/lib/crawler/fetcher");
    vi.resetModules();
  });

  // The fetcher is replaced per test (no network): every URL returns the same
  // one-page site whose links are under test.
  async function locationsPageFor(links: string[]): Promise<boolean | undefined> {
    vi.resetModules();
    vi.doMock("@/lib/crawler/fetcher", () => ({
      safeFetchHtml: async (url: string) => ({
        ok: true,
        finalUrl: url,
        body: `<html><head><title>Salon Rival</title></head><body><main><h1>Salon Rival</h1>${links.map((href) => `<a href="${href}">link</a>`).join("")}</main></body></html>`,
        redirectChain: [],
      }),
    }));
    const { verifyCompetitorWebsite } = await import("@/lib/landscape/competitor-verifier");
    const profile = await verifyCompetitorWebsite(candidate("Salon Rival", { likelyDomain: "salon-rival.example" }), salonTarget());
    return profile?.hasLocationsPage;
  }

  it("does not count a one-shop site's location, store or find-us page", async () => {
    expect(await locationsPageFor(["/location", "/store", "/find-us", "/contact"])).toBe(false);
  });

  it("counts plural branch finders", async () => {
    expect(await locationsPageFor(["/locations"])).toBe(true);
    expect(await locationsPageFor(["/our-branches"])).toBe(true);
    expect(await locationsPageFor(["/stores/dubai"])).toBe(true);
    expect(await locationsPageFor(["/store-locator"])).toBe(true);
  });
});
