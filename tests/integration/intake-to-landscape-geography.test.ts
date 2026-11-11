import { describe, expect, it } from "vitest";
import { synthesizeFinalProfile } from "@/lib/profile/orchestrator";
import { buildMarketHint, parseMarketHint, serializeMarketHint } from "@/lib/projects/market-hint";
import { buildCompetitiveSearchProfile } from "@/lib/landscape/search-profile";
import { emptyBrandReach, planCompetitorTiers } from "@/lib/landscape/competitor-tiers";
import { promptGeographyFromProfile } from "@/lib/prompts/geography";
import { applyClassificationEdit } from "@/lib/understanding/edits";
import { applyLocationResult, resolveLocation, type GroundedAddress } from "@/lib/understanding/location";
import { makeEvidenceSet } from "../helpers/profile-fixtures";
import { tierBusiness } from "../helpers/tier-fixtures";

// One operator answer on the intake page ("customers are in DIFC, Dubai") has
// to reach every later stage the same way: the profile location, the
// competitor tiers (area + city) and the prompt places. Each stage has its own
// tests; this one guards the hand-offs between them, keyless.
describe("intake market hint → location → competitor tiers → prompt places", () => {
  const evidence = makeEvidenceSet([
    { text: "Page title: Maison Nine | Hair and nail salon", sourceType: "meta", fieldHint: "brand_name", crawlPageId: "pg_home" },
    { text: "Maison Nine is a hair and nail salon offering balayage, gel manicures and brow lamination.", sourceType: "main_content", fieldHint: "description", crawlPageId: "pg_home" },
    { text: "H2: Balayage", sourceType: "heading", fieldHint: "offering", crawlPageId: "pg_home" },
    { text: "H2: Gel manicure", sourceType: "heading", fieldHint: "offering", crawlPageId: "pg_home" },
  ]);

  const difcHint = () =>
    parseMarketHint(
      serializeMarketHint(
        buildMarketHint({
          countryCodes: ["AE"],
          worldwide: false,
          area: { query: "DIFC", place: { label: "", formattedAddress: null, premise: null, street: null, neighborhood: "DIFC", district: null, city: "Dubai", region: "Dubai", country: null, countryCode: "AE", postalCode: null, lat: 25.21, lng: 55.28, precision: null, provider: "photon", providerId: null } },
        }),
      ),
    );

  const understand = (hint: ReturnType<typeof difcHint>) =>
    synthesizeFinalProfile({
      projectId: "prj_intake_geo",
      crawlRunId: "crw_intake_geo",
      evidence,
      pages: [{ id: "pg_home", url: "https://maisonnine.example/", pageType: "home", title: "Maison Nine" }],
      canonicalDomain: "maisonnine.example",
      seedUrl: "https://maisonnine.example/",
      seedHostname: "maisonnine.example",
      allowNetwork: false,
      marketHint: hint,
    });

  it("carries DIFC and Dubai from the intake answer into tiers and prompts", async () => {
    const hint = difcHint();
    expect(hint?.countryCodes).toEqual(["AE"]);

    let profile = await understand(hint);
    expect(profile.location?.primary).toMatchObject({ neighborhood: "DIFC", city: "Dubai", countryCode: "AE" });

    // A confirmed salon: place-bound, single location.
    profile = applyClassificationEdit(profile, { businessType: "Hair salon", kind: "personal_care_wellness", physicalPresence: "single_location" });
    expect(profile.location?.operatorHint).toBeTruthy();

    const search = buildCompetitiveSearchProfile(profile, [], "en");
    const plan = planCompetitorTiers(profile, search, emptyBrandReach());
    expect(plan.tiers.map((tier) => `${tier.tier}:${tier.place}`)).toEqual(expect.arrayContaining(["area:DIFC", "city:Dubai"]));
    expect(plan.tiers.some((tier) => tier.tier === "country")).toBe(false);

    const places = promptGeographyFromProfile(profile)!.places.map((place) => place.name);
    expect(places).toEqual(expect.arrayContaining(["DIFC", "Dubai"]));
    expect(places).not.toContain("United Arab Emirates");
  });

  // Kinds that are not place-bound still compete city-wide when the operator
  // puts their customers in an area: they got only a country group while their
  // prompts asked about Dubai (review, 2026-09-14).
  it.each([
    ["b2b_services_agency", "Marketing agency"],
    ["travel_tourism", "Tour operator"],
    ["other", "Business consultancy"],
  ])("gives a %s with the DIFC answer a Dubai group that matches its prompt places", async (kind, businessType) => {
    const profile = applyClassificationEdit(await understand(difcHint()), { businessType, kind, physicalPresence: "single_location" });
    expect(profile.marketScope.value).toBe("local");

    const search = buildCompetitiveSearchProfile(profile, [], "en");
    const plan = planCompetitorTiers(profile, search, emptyBrandReach());
    expect(plan.tiers.map((tier) => `${tier.tier}:${tier.place}`)).toEqual(["city:Dubai"]);

    const places = promptGeographyFromProfile(profile)!.places;
    expect(places.map((place) => place.name)).toContain("Dubai");
    expect(places.some((place) => place.level === "country")).toBe(false);
  });

  // The usual path for these kinds: the website lists its office, the model
  // labels it "office" or "headquarters", and the location resolves to a
  // head-office role. That still gave only a country group (verifier, 2026-09-14).
  it.each([
    ["b2b_services_agency", "office"],
    ["travel_tourism", "headquarters"],
    ["finance_insurance", "office"],
    ["other", "headquarters"],
  ] as const)("gives a %s whose website lists its DIFC %s a Dubai group that matches its prompt places", async (kind, role) => {
    const addressEvidence = makeEvidenceSet([
      { id: "ev_office", text: "Address: Gate Village 3, DIFC, Dubai, AE", sourceType: "address", fieldHint: "market", data: { structured: true, locality: "Dubai", country: "AE", schemaType: "Organization", formatted: "Gate Village 3, DIFC, Dubai, AE" } },
    ]);
    const office = { raw: "Gate Village 3, DIFC, Dubai", role, premise: null, street: null, neighborhood: "DIFC", district: null, city: "Dubai", region: null, country: "United Arab Emirates", countryCode: "AE", postalCode: null, citations: [], evidenceIds: ["ev_office"] } as GroundedAddress;
    const result = await resolveLocation({
      addresses: [office],
      serviceAreas: [],
      nearbyAreas: [],
      countriesServed: [],
      llmScope: "",
      scopeRationale: "",
      locationCount: "one",
      kind,
      presence: "single_location",
      evidence: addressEvidence,
      seedHostname: "localco.ae",
      allowNetwork: false,
      hint: difcHint(),
    });
    expect(result.location.primaryRole).toBe("headquarters");

    const profile = tierBusiness({ brand: "Local Co", kind, category: "Local business", physicalPresence: "single_location", scope: "unknown", primaryRole: "unknown", primary: null, customerType: "b2b" });
    applyLocationResult(profile, result);
    expect(profile.marketScope.value).toBe("local");

    const plan = planCompetitorTiers(profile, buildCompetitiveSearchProfile(profile, [], "en"), emptyBrandReach());
    expect(plan.tiers.map((tier) => `${tier.tier}:${tier.place}`)).toEqual(["city:Dubai"]);

    const places = promptGeographyFromProfile(profile)!.places.map((place) => place.name);
    for (const tier of plan.tiers) expect(places).toContain(tier.place);
  });
});
