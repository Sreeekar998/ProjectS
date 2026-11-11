import { describe, expect, it } from "vitest";
import type { BusinessArchetype } from "@/lib/profile/schema";
import type { CandidateBusinessProfile, CompetitiveSearchProfile, CompetitorCandidate } from "@/lib/landscape/competitor-types";
import { scoreCompetitorCandidate } from "@/lib/landscape/competitor-scoring";
import { resolveCompetitorCandidates } from "@/lib/landscape/competitor-entity";
import { buildCompetitiveSearchProfile } from "@/lib/landscape/search-profile";
import { planCompetitorTiers, emptyBrandReach } from "@/lib/landscape/competitor-tiers";
import type { BrandReach, CompetitorTier } from "@/lib/landscape/tier-types";
import { tierBusiness, type TierBusinessInput } from "../helpers/tier-fixtures";

const CASES: Array<{ label: string; archetype: BusinessArchetype; category: string; offering: string; job: string; audience: string; market: string }> = [
  { label: "consumer ecommerce", archetype: "ecommerce_dtc_retail", category: "trail footwear", offering: "trail running shoes", job: "choose shoes for trail running", audience: "recreational runners", market: "India" },
  { label: "B2B SaaS", archetype: "b2b_saas_enterprise", category: "workflow software", offering: "approval workflow automation", job: "automate approval routing", audience: "operations teams", market: "United States" },
  { label: "enterprise software", archetype: "b2b_saas_enterprise", category: "data platform", offering: "enterprise data governance", job: "govern enterprise data", audience: "data leaders", market: "United States" },
  { label: "industrial manufacturing", archetype: "other", category: "industrial pumps", offering: "chemical process pumps", job: "move corrosive fluids safely", audience: "plant engineers", market: "Germany" },
  { label: "restaurant", archetype: "restaurant_food_chain", category: "Italian restaurant", offering: "Italian dining", job: "book an Italian dinner", audience: "local diners", market: "Bengaluru" },
  { label: "hotel", archetype: "travel_hospitality", category: "boutique hotel", offering: "boutique hotel rooms", job: "book a city stay", audience: "business travelers", market: "Mumbai" },
  { label: "local service", archetype: "local_service", category: "plumbing service", offering: "emergency plumbing", job: "repair a burst pipe", audience: "homeowners", market: "Austin" },
  { label: "dealership", archetype: "dealership", category: "car dealership", offering: "new and used vehicles", job: "buy a family car", audience: "local drivers", market: "Denver" },
  { label: "hospital", archetype: "healthcare", category: "private hospital", offering: "cardiology services", job: "access cardiology services", audience: "patients", market: "Bengaluru" },
  { label: "financial service", archetype: "finance", category: "retail bank", offering: "savings accounts", job: "manage everyday banking", audience: "banking customers", market: "India" },
  { label: "education", archetype: "education", category: "vocational college", offering: "certificate programs", job: "gain job-ready skills", audience: "adult learners", market: "Chicago" },
  { label: "marketplace travel", archetype: "marketplace", category: "travel marketplace", offering: "hotel booking marketplace", job: "compare hotel availability", audience: "travelers", market: "global" },
];

function targetProfile(testCase: (typeof CASES)[number]): CompetitiveSearchProfile {
  return {
    targetBrand: `Target ${testCase.label}`,
    aliases: [],
    canonicalDomain: `target-${testCase.archetype}.example`,
    parentBrand: null,
    industry: testCase.category,
    subIndustry: testCase.category,
    businessArchetype: testCase.archetype,
    businessModel: testCase.archetype === "b2b_saas_enterprise" ? "B2B" : "B2C",
    offerings: [testCase.offering],
    jobsToBeDone: [testCase.job],
    useCases: [testCase.job],
    targetAudiences: [testCase.audience],
    personas: [testCase.audience],
    importantTopics: [{ id: "topic-1", name: testCase.category, discoveryConcept: testCase.category }],
    evaluationCriteria: ["reliability"],
    geography: { scope: testCase.market === "global" ? "global" : "local", cities: testCase.market === "global" ? [] : [testCase.market], regions: [], countries: testCase.market === "global" ? [] : [testCase.market], locale: "en" },
    evidenceIds: ["evidence-1"],
  };
}

function candidate(name: string, type: "direct" | "substitute" | "marketplace" | "adjacent", dimensions: string[], reason = "Competes for the same buyer decision."): CompetitorCandidate {
  return {
    canonicalName: name,
    likelyDomain: `${name.toLowerCase().replace(/\s+/g, "-")}.example`,
    proposedType: type,
    entityType: "company",
    reason,
    matchedDimensions: dimensions,
    confidence: 82,
    evidence: [{ source: "ai_hypothesis", reason, evidenceIds: [], discoveredAt: 1 }],
    aliases: [],
  };
}

function verifiedProfile(testCase: (typeof CASES)[number], name: string, market = testCase.market): CandidateBusinessProfile {
  return {
    displayName: name,
    canonicalDomain: `${name.toLowerCase().replace(/\s+/g, "-")}.example`,
    finalUrl: `https://${name.toLowerCase().replace(/\s+/g, "-")}.example/`,
    title: `${name} — ${testCase.category}`,
    description: `${testCase.offering} for ${testCase.audience}`,
    offerings: [testCase.offering],
    audienceSignals: [testCase.audience],
    jobSignals: [testCase.job],
    useCaseSignals: [testCase.job],
    categorySignals: [testCase.category],
    geographySignals: [market],
    contentTokens: [testCase.category, testCase.offering, testCase.job, testCase.audience],
    pagesFetched: ["/", "/services"],
    verificationStatus: "verified",
    verificationSummary: "Fixture website verified.",
  };
}

describe("competitor intelligence benchmark", () => {
  it.each(CASES)("ranks relevant $label competitors above irrelevant entities", (testCase) => {
    const target = targetProfile(testCase);
    const relevant = scoreCompetitorCandidate(target, candidate("Relevant Rival", "direct", [testCase.category, testCase.offering, testCase.job]), verifiedProfile(testCase, "Relevant Rival"));
    const irrelevantProfile = { ...verifiedProfile(testCase, "Unrelated Vendor", "Remote market"), offerings: ["cloud hosting"], audienceSignals: ["software developers"], jobSignals: ["host a website"], useCaseSignals: ["deploy infrastructure"], categorySignals: ["cloud infrastructure"], contentTokens: ["cloud", "hosting", "infrastructure"] };
    const irrelevant = scoreCompetitorCandidate(target, candidate("Unrelated Vendor", "adjacent", ["technology"], "Technology infrastructure vendor."), irrelevantProfile);
    expect(relevant.score.total).toBeGreaterThan(irrelevant.score.total);
    expect(relevant.role).toBe("direct");
    expect(relevant.rejectionReason).toBeNull();
    expect(irrelevant.rejectionReason).toBeTruthy();
  });

  it("achieves Precision@5 above the 80% pilot target across all fixture markets", () => {
    let relevantInTopFive = 0;
    let totalTopFive = 0;
    for (const testCase of CASES) {
      const target = targetProfile(testCase);
      const ranked = [0, 1, 2, 3, 4].map((index) => scoreCompetitorCandidate(target, candidate(`Relevant ${index}`, "direct", [testCase.category, testCase.offering, testCase.job]), verifiedProfile(testCase, `Relevant ${index}`)))
        .concat([
          scoreCompetitorCandidate(target, candidate("Supplier Co", "adjacent", ["technology"], "Technology supplier and integration partner."), verifiedProfile(testCase, "Supplier Co", "Remote market")),
          scoreCompetitorCandidate(target, candidate("Remote Directory", "marketplace", ["directory"], "Comparison directory."), verifiedProfile(testCase, "Remote Directory", "Remote market")),
        ])
        .sort((a, b) => b.score.total - a.score.total)
        .slice(0, 5);
      relevantInTopFive += ranked.filter((item) => !item.rejectionReason && item.role === "direct").length;
      totalTopFive += ranked.length;
    }
    expect(relevantInTopFive / totalTopFive).toBeGreaterThanOrEqual(0.8);
  });

  it("resolves legal suffixes, casing, and duplicate country domains without merging distinct names", () => {
    const merged = resolveCompetitorCandidates([
      candidate("Example Brand Ltd", "direct", ["category"]),
      { ...candidate("example brand", "direct", ["audience"]), likelyDomain: "https://www.examplebrand.com/in" },
      { ...candidate("Separate Brand", "direct", ["category"]), likelyDomain: "separate.example" },
    ]);
    expect(merged).toHaveLength(2);
    expect(merged.find((item) => item.canonicalName.includes("Example"))?.evidence).toHaveLength(2);
  });

  it("merges a rival named with the target's city and spacing variants, keeping distinct names apart", () => {
    // A Dubai restaurant got both "Akira Back" (model) and "Akira Back Dubai" (search).
    const merged = resolveCompetitorCandidates(
      [
        candidate("Akira Back Dubai", "direct", ["category"]),
        candidate("Akira Back", "direct", ["audience"]),
        candidate("SushiArt", "direct", ["category"]),
        candidate("Sushi Art", "direct", ["audience"]),
        candidate("Dubai Marina Grill", "direct", ["category"]),
        candidate("Marina Grill", "direct", ["category"]),
      ],
      ["Dubai", "United Arab Emirates"],
    );
    expect(merged.map((item) => item.canonicalName).sort()).toEqual(["Akira Back Dubai", "Dubai Marina Grill", "Marina Grill", "SushiArt"]);
    // "Pluto Card" and "Pluto" (a UAE spend platform) and "Gazebo Restaurant" and "Gazebo" are one rival each.
    const tails = resolveCompetitorCandidates([candidate("Pluto Card", "direct", ["category"]), candidate("Pluto", "direct", ["audience"]), candidate("Gazebo Restaurant", "direct", ["category"]), candidate("Gazebo", "direct", ["audience"]), candidate("Pemo", "direct", ["category"])]);
    expect(tails.map((item) => item.canonicalName).sort()).toEqual(["Gazebo Restaurant", "Pemo", "Pluto Card"]);
    expect(merged.find((item) => item.canonicalName === "Akira Back Dubai")?.evidence).toHaveLength(2);
  });

  it("rejects target-self, target-owned product, supplier, and geographically invalid local cases", () => {
    const testCase = CASES.find((item) => item.archetype === "local_service")!;
    const target = targetProfile(testCase);
    const self = scoreCompetitorCandidate(target, { ...candidate(target.targetBrand, "direct", [testCase.category]), likelyDomain: target.canonicalDomain }, verifiedProfile(testCase, target.targetBrand));
    const product = scoreCompetitorCandidate(target, { ...candidate("Target Product", "direct", [testCase.category]), entityType: "product_line", parentName: target.targetBrand }, verifiedProfile(testCase, "Target Product"));
    const supplier = scoreCompetitorCandidate(target, candidate("Pipe Supplier", "adjacent", ["plumbing"], "Supplier to plumbing companies."), verifiedProfile(testCase, "Pipe Supplier"));
    const remote = scoreCompetitorCandidate(target, candidate("Remote Plumber", "direct", [testCase.category, testCase.offering, testCase.job]), verifiedProfile(testCase, "Remote Plumber", "Sydney"));
    expect([self, product, supplier, remote].every((item) => Boolean(item.rejectionReason))).toBe(true);
  });
});

// One case per tier plan shape. Each has a same-category rival placed in the
// plan's tier by realistic evidence, a supplier, and a rival in another city.
const KNOWN: BrandReach = { known: true, points: 6, signals: [], checkedOpenKnowledge: true };
const TIER_CASES: Array<{ label: string; business: TierBusinessInput; reach?: BrandReach; plan: CompetitorTier[]; rivalLocation: CompetitorCandidate["location"]; rivalTier: CompetitorTier; otherCityRejected: boolean }> = [
  {
    label: "hyperlocal salon (area + city)",
    business: { brand: "Salon Target", kind: "personal_care_wellness", category: "Hair salon", physicalPresence: "single_location", scope: "hyperlocal", primaryRole: "storefront", primary: { neighborhood: "Koramangala", city: "Bengaluru", country: "India", countryCode: "IN", lat: 12.93, lng: 77.62 } },
    plan: ["area", "city"],
    rivalLocation: { area: "Koramangala", city: "Bengaluru", country: null },
    rivalTier: "area",
    otherCityRejected: true,
  },
  {
    label: "known local restaurant (area + city + country)",
    business: { brand: "Chop Target", kind: "restaurant_food_beverage", category: "Restaurant", physicalPresence: "single_location", scope: "local", primaryRole: "storefront", primary: { neighborhood: "Clerkenwell", city: "London", country: "United Kingdom", countryCode: "GB" } },
    reach: KNOWN,
    plan: ["area", "city", "country"],
    rivalLocation: { area: "Soho", city: "London", country: null },
    rivalTier: "city",
    otherCityRejected: true,
  },
  {
    label: "regional estate agent chain (city + country)",
    business: { brand: "Agent Target", kind: "real_estate_property", category: "Estate agent", physicalPresence: "multi_location", scope: "regional", primaryRole: "headquarters", primary: { city: "Exeter", country: "United Kingdom", countryCode: "GB" }, branches: [{ city: "Torquay", countryCode: "GB" }, { city: "Exmouth", countryCode: "GB" }] },
    plan: ["city", "country"],
    rivalLocation: { area: null, city: "Torquay", country: "United Kingdom" },
    rivalTier: "city",
    otherCityRejected: true,
  },
  {
    label: "national chain (country)",
    business: { brand: "Bakery Target", kind: "restaurant_food_beverage", category: "Bakery", physicalPresence: "multi_location", scope: "national", primaryRole: "headquarters", primary: { city: "Leeds", country: "United Kingdom", countryCode: "GB" } },
    plan: ["country"],
    rivalLocation: { area: null, city: "London", country: "United Kingdom" },
    rivalTier: "country",
    otherCityRejected: false,
  },
  {
    label: "global software (worldwide)",
    business: { brand: "Software Target", kind: "b2b_saas_software", category: "Workflow software", physicalPresence: "online_only", scope: "global", primaryRole: "headquarters", primary: null, customerType: "b2b" },
    plan: ["country"],
    rivalLocation: { area: null, city: "Sydney", country: "Australia" },
    rivalTier: "country",
    otherCityRejected: false,
  },
];

describe("competitor intelligence benchmark: geographic tiers", () => {
  it.each(TIER_CASES)("plans and places rivals for a $label", (testCase) => {
    const profile = tierBusiness(testCase.business);
    const target = buildCompetitiveSearchProfile(profile, []);
    target.tiers = planCompetitorTiers(profile, target, testCase.reach ?? emptyBrandReach());
    expect(target.tiers.tiers.map((spec) => spec.tier)).toEqual(testCase.plan);

    const category = testCase.business.category!;
    const evidence = [{ source: "web_search" as const, reason: "Search result", evidenceIds: [], discoveredAt: 1 }];
    const relevant = scoreCompetitorCandidate(target, { ...candidate("Relevant Rival", "direct", [category]), evidence, structuralAffinity: 70, location: testCase.rivalLocation }, null);
    expect(relevant.rejectionReason).toBeNull();
    expect(relevant.tier.tier).toBe(testCase.rivalTier);

    const supplier = scoreCompetitorCandidate(target, { ...candidate("Supply Co", "adjacent", ["supplies"], "Supplier and integration partner."), evidence, location: testCase.rivalLocation }, null);
    expect(supplier.rejectionReason).toBeTruthy();

    const faraway = scoreCompetitorCandidate(target, { ...candidate("Faraway Rival", "direct", [category]), evidence, structuralAffinity: 70, location: { area: null, city: "Gotham", country: null } }, null);
    expect(Boolean(faraway.rejectionReason)).toBe(testCase.otherCityRejected);
  });
});
