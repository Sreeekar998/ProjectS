import { describe, expect, it } from "vitest";
import { applyLocationResult, resolveLocation, type GroundedAddress, type LocationInput } from "@/lib/understanding/location";
import { buildMarketHint, type HintPlace } from "@/lib/projects/market-hint";
import { promptGeographyFromProfile } from "@/lib/prompts/geography";
import { applyClassificationEdit } from "@/lib/understanding/edits";
import { makeEvidenceSet, makeProfile } from "../../helpers/profile-fixtures";
import { scopeSentence } from "@/components/features/location-card";

// The operator's intake answer ("Where are your customers?") applied inside
// resolveLocation (market spec §5.3, test plan §9.4). Keyless and offline.

const NOW = new Date("2026-09-14T00:00:00Z");

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

const DIFC = hintPlace({ neighborhood: "DIFC", city: "Dubai", region: "Dubai", countryCode: "AE", lat: 25.2118, lng: 55.2797, providerId: "osm:difc" });
const BENGALURU = hintPlace({ city: "Bengaluru", region: "Karnataka", countryCode: "IN", lat: 12.9716, lng: 77.5946, providerId: "osm:blr" });
const DUBLIN = hintPlace({ city: "Dublin", region: "County Dublin", countryCode: "IE", lat: 53.3498, lng: -6.2603, providerId: "osm:dub" });

const areaHint = (code: string, place: HintPlace, query: string) => buildMarketHint({ countryCodes: [code], worldwide: false, area: { query, place } }, NOW)!;
const countryHint = (...codes: string[]) => buildMarketHint({ countryCodes: codes, worldwide: false, area: null }, NOW)!;
const worldwide = () => buildMarketHint({ countryCodes: [], worldwide: true, area: null }, NOW)!;

const base: Omit<LocationInput, "kind" | "presence" | "evidence" | "seedHostname" | "addresses"> = {
  serviceAreas: [],
  nearbyAreas: [],
  countriesServed: [],
  llmScope: "",
  scopeRationale: "",
  locationCount: "one",
  allowNetwork: false,
};

const salon = { kind: "personal_care_wellness", presence: "single_location" } as const;

describe("resolveLocation with an operator hint", () => {
  it("1. fills a salon with no website address from the hint's area", async () => {
    const result = await resolveLocation({ ...base, ...salon, addresses: [], evidence: [], seedHostname: "example.com", hint: areaHint("AE", DIFC, "DIFC") });
    const primary = result.location.primary!;
    expect(primary).toMatchObject({ neighborhood: "DIFC", city: "Dubai", countryCode: "AE" });
    expect(result.scope.value).toBe("hyperlocal");
    expect(result.location.needsConfirmation).toBe(false);
    expect(result.location.operatorHint?.outcome).toBe("filled");
    expect(result.location.source).toBe("user");
    const stated = result.location.signals.filter((s) => s.kind === "operator_stated");
    expect(stated).toHaveLength(1);
    expect(stated[0]!.weight).toBe(4);
    // A neighbourhood centroid never claims street precision.
    expect(primary.precision).toBe("neighborhood");
    expect(primary.evidenceIds).toEqual([]);
  });

  it("2. agrees with a structured address and keeps the website's street and coordinates", async () => {
    const evidence = makeEvidenceSet([
      { id: "ev_addr", text: "HairSalon address: 12 Al Saada Street, Dubai, AE", sourceType: "address", fieldHint: "market", data: { structured: true, street: "12 Al Saada Street", locality: "Dubai", country: "AE", schemaType: "HairSalon", formatted: "12 Al Saada Street, Dubai, AE" } },
      { id: "ev_geo", text: "HairSalon geo: 25.2100, 55.2800", sourceType: "jsonld", data: { lat: 25.21, lng: 55.28 } },
    ]);
    const result = await resolveLocation({ ...base, ...salon, addresses: [], evidence, seedHostname: "example.com", hint: areaHint("AE", DIFC, "DIFC") });
    const primary = result.location.primary!;
    expect(result.location.operatorHint?.outcome).toBe("agreed");
    expect(result.location.confidence).toBeGreaterThanOrEqual(85);
    expect(primary.street).toBe("12 Al Saada Street");
    expect(primary.lat).toBe(25.21);
    expect(primary.lng).toBe(55.28);
    expect(primary.neighborhood).toBe("DIFC");
    expect(result.location.source).toBe("evidence");
    expect(result.location.needsConfirmation).toBe(false);
  });

  it("3. uses the operator's area name over the website's and records the website's", async () => {
    const result = await resolveLocation({
      ...base,
      ...salon,
      addresses: [address({ raw: "Trade Centre 1, Dubai", neighborhood: "Trade Centre 1", city: "Dubai", countryCode: "AE", evidenceIds: [] })],
      evidence: [],
      seedHostname: "example.com",
      hint: areaHint("AE", DIFC, "DIFC"),
    });
    expect(result.location.primary?.neighborhood).toBe("DIFC");
    expect(result.location.signals).toContainEqual(expect.objectContaining({ kind: "website_area_name", value: "Trade Centre 1" }));
    expect(result.location.operatorHint?.outcome).toBe("agreed");
  });

  it("3b. keeps the website's initials when the picked area is the same place under its formal name", async () => {
    const formal = hintPlace({ neighborhood: "Dubai International Financial Centre", city: "Dubai", region: "Dubai", countryCode: "AE", lat: 25.21, lng: 55.28 });
    const result = await resolveLocation({
      ...base,
      ...salon,
      nearbyAreas: ["DIFC", "Business Bay"],
      addresses: [address({ raw: "Sheikh Zayed Road, DIFC, Dubai", neighborhood: "DIFC", city: "Dubai", countryCode: "AE", evidenceIds: [] })],
      evidence: [],
      seedHostname: "example.com",
      hint: areaHint("AE", formal, "DIFC"),
    });
    expect(result.location.primary?.neighborhood).toBe("DIFC");
    expect(result.location.nearbyAreas).toEqual(["Business Bay"]);
    expect(result.location.signals.some((s) => s.kind === "website_area_name")).toBe(false);
  });

  it("4. shows both places when a single salon's written address contradicts the hint", async () => {
    const evidence = makeEvidenceSet([
      { id: "ev_addr", text: "HairSalon address: 12 Al Saada Street, Dubai, AE", sourceType: "address", data: { structured: true, street: "12 Al Saada Street", locality: "Dubai", country: "AE", schemaType: "HairSalon", formatted: "12 Al Saada Street, Dubai, AE" } },
      { id: "ev_geo", text: "HairSalon geo", sourceType: "jsonld", data: { lat: 25.21, lng: 55.28 } },
    ]);
    const result = await resolveLocation({
      ...base,
      ...salon,
      addresses: [address({ raw: "12 Al Saada Street, Dubai", street: "12 Al Saada Street", city: "Dubai", countryCode: "AE", evidenceIds: ["ev_addr"] })],
      evidence,
      seedHostname: "example.ae",
      hint: areaHint("IN", BENGALURU, "Bengaluru"),
    });
    const primary = result.location.primary!;
    expect(result.location.operatorHint?.outcome).toBe("conflict");
    expect(result.location.needsConfirmation).toBe(true);
    expect(result.location.operatorHint?.websitePlace?.city).toBe("Dubai");
    expect(primary.city).toBe("Bengaluru");
    expect(primary.countryCode).toBe("IN");
    expect(primary.street).toBeNull();
    expect(primary.lat).toBe(BENGALURU.lat);
    expect(result.location.confidence).toBeLessThanOrEqual(55);
    expect(result.warnings.join(" ")).toMatch(/You told us/);
    expect(result.location.operatorHint?.message).toMatch(/You told us .*Bengaluru.*Dubai/);
  });

  it("5. overrides a country that only a domain ending and phone prefixes suggested", async () => {
    const evidence = makeEvidenceSet([
      { id: "ev_p1", text: "Phone link: +442079460000", sourceType: "phone", data: { telephone: "+442079460000" } },
      { id: "ev_p2", text: "Phone link: +442079460001", sourceType: "phone", data: { telephone: "+442079460001" } },
    ]);
    const result = await resolveLocation({ ...base, kind: "local_retail_store", presence: "single_location", addresses: [], evidence, seedHostname: "example.co.uk", hint: areaHint("IE", DUBLIN, "Dublin") });
    expect(result.location.operatorHint?.outcome).toBe("overrode");
    expect(result.location.primary?.countryCode).toBe("IE");
    expect(result.location.primary?.city).toBe("Dublin");
    expect(result.location.needsConfirmation).toBe(false);
    expect(result.warnings.join(" ")).not.toMatch(/most signals/);
  });

  it("5b. never moves a written address without a country into the operator's country on weak signals alone", async () => {
    // JSON-LD without addressCountry casts no physical vote; the .co.uk ending and a UK phone make it GB.
    const evidence = makeEvidenceSet([
      { id: "ev_addr", text: "HairSalon address: 5 High St, London", sourceType: "address", data: { structured: true, street: "5 High St", locality: "London", schemaType: "HairSalon", formatted: "5 High St, London" } },
      { id: "ev_p1", text: "Phone link: +442079460000", sourceType: "phone", data: { telephone: "+442079460000" } },
    ]);
    const input: LocationInput = { ...base, ...salon, addresses: [], evidence, seedHostname: "salon.co.uk" };
    expect((await resolveLocation(input)).location.primary).toMatchObject({ city: "London", countryCode: "GB" });

    const result = await resolveLocation({ ...input, hint: countryHint("IE") });
    const location = result.location;
    expect(location.operatorHint?.outcome).toBe("conflict");
    expect(location.needsConfirmation).toBe(true);
    expect(location.primary).toMatchObject({ countryCode: "IE", city: null, street: null });
    expect(location.operatorHint?.websitePlace).toMatchObject({ city: "London", street: "5 High St", countryCode: "GB" });
    expect(result.markets.map((m) => m.name)).not.toContain("London");

    // Same address in a chain: the London location stays as a branch in its own country.
    const chain = await resolveLocation({ ...input, presence: "multi_location", hint: countryHint("IE") });
    expect(chain.location.operatorHint?.outcome).toBe("overrode");
    expect(chain.location.branches).toEqual(expect.arrayContaining([expect.objectContaining({ city: "London", countryCode: "GB" })]));
  });

  it("5c. shows the website's own country in the conflict box when the hint's area names another city", async () => {
    const evidence = makeEvidenceSet([{ id: "ev_p1", text: "Phone link: +442079460000", sourceType: "phone", data: { telephone: "+442079460000" } }]);
    const london = address({ raw: "5 High St, London", street: "5 High St", city: "London" });
    const result = await resolveLocation({ ...base, kind: "local_retail_store", presence: "single_location", addresses: [london], evidence, seedHostname: "example.co.uk", hint: areaHint("IE", DUBLIN, "Dublin") });
    expect(result.location.operatorHint?.outcome).toBe("conflict");
    expect(result.location.operatorHint?.websitePlace).toMatchObject({ city: "London", countryCode: "GB" });
    expect(result.location.operatorHint?.message).toMatch(/London, United Kingdom/);
    expect(result.location.primary).toMatchObject({ city: "Dublin", countryCode: "IE", street: null });

    // No country anywhere on the site: the operator's country fills it, and the
    // conflict box still quotes only what the website wrote.
    const bare = await resolveLocation({ ...base, kind: "local_retail_store", presence: "single_location", addresses: [london], evidence: [], seedHostname: "example.com", hint: areaHint("IE", DUBLIN, "Dublin") });
    expect(bare.location.operatorHint?.outcome).toBe("conflict");
    expect(bare.location.operatorHint?.websitePlace).toMatchObject({ city: "London", countryCode: null });
  });

  it("5d. keeps a country-less street when it sits in the operator's city", async () => {
    const evidence = makeEvidenceSet([{ id: "ev_p1", text: "Phone link: +442079460000", sourceType: "phone", data: { telephone: "+442079460000" } }]);
    const result = await resolveLocation({
      ...base,
      kind: "local_retail_store",
      presence: "single_location",
      addresses: [address({ raw: "12 Grafton St, Dublin", street: "12 Grafton St", city: "Dublin", evidenceIds: ["ev_p1"] })],
      evidence,
      seedHostname: "example.co.uk",
      hint: areaHint("IE", DUBLIN, "Dublin"),
    });
    expect(result.location.operatorHint?.outcome).toBe("overrode");
    expect(result.location.needsConfirmation).toBe(false);
    expect(result.location.primary).toMatchObject({ street: "12 Grafton St", city: "Dublin", countryCode: "IE" });
    expect(result.location.operatorHint?.websitePlace).toBeNull();
  });

  it("6. settles the Dublin-address-on-a-.co.uk-site conflict when the operator says Ireland", async () => {
    const evidence = makeEvidenceSet([
      { id: "ev_p1", text: "Phone link: +442079460000", sourceType: "phone", data: { telephone: "+442079460000" } },
      { id: "ev_p2", text: "Phone link: +442079460001", sourceType: "phone", data: { telephone: "+442079460001" } },
    ]);
    const input: LocationInput = { ...base, kind: "local_retail_store", presence: "single_location", addresses: [address({ raw: "Main Street", street: "Main Street", countryCode: "IE", city: "Dublin" })], evidence, seedHostname: "example.co.uk" };
    const without = await resolveLocation(input);
    expect(without.location.needsConfirmation).toBe(true);
    const result = await resolveLocation({ ...input, hint: countryHint("IE") });
    expect(result.location.operatorHint?.outcome).toBe("agreed");
    expect(result.location.needsConfirmation).toBe(false);
    expect(result.location.primary?.countryCode).toBe("IE");
    expect(result.warnings.join(" ")).not.toMatch(/Please confirm the location/);
  });

  it("7. keeps an online company's head office but makes the operator's country its market", async () => {
    const evidence = makeEvidenceSet([
      { id: "ev_hq", text: "Organization address: 100 King St W, Toronto, CA", sourceType: "address", data: { structured: true, street: "100 King St W", locality: "Toronto", country: "CA", schemaType: "Organization", formatted: "100 King St W, Toronto, CA" } },
      { id: "ev_org", text: "Organization name: Ledgerly", sourceType: "jsonld" },
    ]);
    const result = await resolveLocation({
      ...base,
      kind: "b2b_saas_software",
      presence: "online_only",
      addresses: [address({ raw: "100 King St W, Toronto", role: "headquarters", street: "100 King St W", city: "Toronto", countryCode: "CA", evidenceIds: ["ev_hq", "ev_org"] })],
      evidence,
      seedHostname: "example.com",
      hint: countryHint("US"),
    });
    expect(result.scope.value).toBe("national");
    expect(result.location.countriesServed[0]).toBe("US");
    expect(result.location.primary?.countryCode).toBe("CA");
    expect(result.location.operatorHint?.outcome).toBe("noted");
    expect(result.location.needsConfirmation).toBe(false);
    // The card names the market, not the head office's country.
    expect(scopeSentence("national", result.location)).toBe("Serves customers across United States");

    let profile = makeProfile({ brandName: "Ledgerly", archetype: "b2b_saas_enterprise", industry: "Software" });
    profile = applyClassificationEdit(profile, { businessType: "Accounting software", kind: "b2b_saas_software", physicalPresence: "online_only" });
    applyLocationResult(profile, result);
    const places = promptGeographyFromProfile(profile)!.places;
    expect(places.filter((p) => p.level === "country").map((p) => p.name)).toEqual(["United States"]);
    expect(profile.marketScope.value).toBe("national");
  });

  it("7b. lets the operator's country win over a currency alone for an online company", async () => {
    // Wipro with India chosen came out "head office in United Kingdom" and
    // "Serves customers across United Kingdom" from one £ price on the site.
    const evidence = makeEvidenceSet([{ id: "ev_gbp", text: "Price: £1,200", sourceType: "currency" }]);
    const result = await resolveLocation({ ...base, kind: "b2b_services_agency", presence: "multi_location", addresses: [], evidence, seedHostname: "example.com", hint: countryHint("IN") });
    expect(result.location.signals.some((signal) => signal.kind === "currency" && signal.value === "GB")).toBe(true);
    expect(result.location.primary?.countryCode).toBe("IN");
    expect(result.location.countriesServed[0]).toBe("IN");
    expect(result.location.operatorHint?.message ?? "").not.toMatch(/head office/);
    expect(result.scope.value).toBe("national");
    expect(scopeSentence("national", result.location)).toBe("Serves customers across India");
  });

  it("8. treats worldwide as global for an online business, and as a note for a salon", async () => {
    const online = await resolveLocation({ ...base, kind: "ecommerce_dtc_retail", presence: "online_only", addresses: [], evidence: [], seedHostname: "example.com", hint: worldwide() });
    expect(online.scope.value).toBe("global");
    expect(online.location.signals.find((s) => s.kind === "operator_stated")?.weight).toBe(0);

    const salonAddress = [address({ raw: "Gate Building, DIFC, Dubai", neighborhood: "DIFC", city: "Dubai", countryCode: "AE" })];
    const plain = await resolveLocation({ ...base, ...salon, addresses: salonAddress, evidence: [], seedHostname: "example.ae" });
    const told = await resolveLocation({ ...base, ...salon, addresses: salonAddress, evidence: [], seedHostname: "example.ae", hint: worldwide() });
    expect(told.scope.value).toBe(plain.scope.value);
    expect(told.location.operatorHint?.outcome).toBe("noted");
    expect(told.location.operatorHint?.message).toMatch(/all over the world.*DIFC/);
  });

  it("9. makes a chain's branch in the operator's city the primary and keeps the other location as a branch", async () => {
    const chain = (dubaiRole: GroundedAddress["role"]): LocationInput => ({
      ...base,
      kind: "personal_care_wellness",
      presence: "multi_location",
      locationCount: "few",
      addresses: [
        address({ raw: "Head office, Sheikh Zayed Road, Dubai", role: dubaiRole, street: "Sheikh Zayed Road", city: "Dubai", countryCode: "AE" }),
        address({ raw: "80 Feet Road, Koramangala, Bengaluru", role: "branch", street: "80 Feet Road", neighborhood: "Koramangala", city: "Bengaluru", countryCode: "IN" }),
      ],
      evidence: [],
      seedHostname: "example.com",
    });
    // The spec fixture: Dubai is the headquarters.
    for (const role of ["headquarters", "storefront"] as const) {
      const result = await resolveLocation({ ...chain(role), hint: areaHint("IN", BENGALURU, "Bengaluru") });
      expect(result.location.primary?.city).toBe("Bengaluru");
      expect(result.location.branches.map((b) => b.city)).toContain("Dubai");
      expect(result.location.operatorHint?.outcome).not.toBe("conflict");
      expect(result.location.operatorHint?.websitePlace).toBeNull();
    }
    // Without a hint a salon chain's head office is still not a branch customers visit.
    const plain = await resolveLocation(chain("headquarters"));
    expect(plain.location.branches.map((b) => b.city)).not.toContain("Dubai");
  });

  it("10. never writes an unresolved area into place levels and asks the operator to check it", async () => {
    const hint = buildMarketHint({ countryCodes: ["AE"], worldwide: false, area: { query: "Jumeira Lakes", place: null } }, NOW)!;
    const result = await resolveLocation({ ...base, ...salon, addresses: [], evidence: [], seedHostname: "example.com", hint });
    const primary = result.location.primary!;
    expect(result.location.operatorHint?.outcome).toBe("unresolved");
    expect(result.location.needsConfirmation).toBe(true);
    for (const level of ["premise", "street", "neighborhood", "district", "city", "region"] as const) expect(primary[level]).not.toBe("Jumeira Lakes");
    expect(primary.countryCode).toBe("AE");
    expect(result.location.operatorHint?.label).toMatch(/Jumeira Lakes/);
    expect(result.location.operatorHint?.message).toMatch(/couldn't find/);
  });

  it("11. gives an online business with two stated countries an international scope, in the operator's order", async () => {
    const result = await resolveLocation({ ...base, kind: "b2b_saas_software", presence: "online_only", addresses: [], evidence: [], seedHostname: "example.com", hint: countryHint("AE", "SA") });
    expect(result.scope.value).toBe("international");
    expect(result.location.countriesServed.slice(0, 2)).toEqual(["AE", "SA"]);
  });

  it("12. reads a London address on a .co.uk site as GB without a GB/UK conflict (no hint)", async () => {
    const result = await resolveLocation({
      ...base,
      ...salon,
      addresses: [address({ raw: "14 Exmouth Market, London, United Kingdom", street: "14 Exmouth Market", city: "London", country: "United Kingdom" })],
      evidence: [],
      seedHostname: "example.co.uk",
    });
    expect(result.location.primary?.countryCode).toBe("GB");
    expect(result.location.signals.every((s) => !/→ UK$/.test(s.value))).toBe(true);
    expect(result.warnings.join(" ")).not.toMatch(/most signals point/);
  });

  it("13. without a hint, leaves no operator trace on the location", async () => {
    const result = await resolveLocation({ ...base, ...salon, addresses: [address({ raw: "Gate Building, DIFC, Dubai", neighborhood: "DIFC", city: "Dubai", countryCode: "AE" })], evidence: [], seedHostname: "example.ae" });
    expect(result.location.operatorHint).toBeUndefined();
    expect(result.location.signals.some((s) => s.kind === "operator_stated")).toBe(false);
    expect(result.location.locationCount).toBe("one");
  });

  it("gives an online business's named market area a local scope and keeps the head office as a branch", async () => {
    const austin = hintPlace({ city: "Austin", region: "Texas", countryCode: "US", lat: 30.27, lng: -97.74 });
    const result = await resolveLocation({
      ...base,
      kind: "b2b_saas_software",
      presence: "online_only",
      addresses: [address({ raw: "100 King St W, Toronto", role: "headquarters", street: "100 King St W", city: "Toronto", countryCode: "CA" })],
      evidence: [],
      seedHostname: "example.com",
      hint: areaHint("US", austin, "Austin"),
    });
    expect(result.scope.value).toBe("local");
    expect(result.location.primary?.city).toBe("Austin");
    expect(result.location.primaryRole).toBe("service_base");
    expect(result.location.branches.map((b) => b.city)).toContain("Toronto");
    expect(result.location.operatorHint?.outcome).toBe("overrode");
  });
});
