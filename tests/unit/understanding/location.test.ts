import { describe, expect, it } from "vitest";
import { resolveLocation, type GroundedAddress } from "@/lib/understanding/location";
import { makeEvidenceSet } from "../../helpers/profile-fixtures";

function address(partial: Partial<GroundedAddress>): GroundedAddress {
  return {
    raw: "", role: "storefront", premise: null, street: null, neighborhood: null, district: null, city: null, region: null, country: null, countryCode: null, postalCode: null, citations: [], evidenceIds: [],
    ...partial,
  } as GroundedAddress;
}

const base = { serviceAreas: [] as Array<{ name: string; level: string; evidenceIds: string[] }>, nearbyAreas: [] as string[], countriesServed: [] as string[], llmScope: "", scopeRationale: "", locationCount: "one", allowNetwork: false };

describe("resolveLocation", () => {
  it("places a single salon in its neighbourhood, with a local scope and no country market", async () => {
    const evidence = makeEvidenceSet([
      { id: "ev_addr", text: "HairSalon address: Gate Building, DIFC, Dubai, AE", sourceType: "address", fieldHint: "market", data: { structured: true, locality: "Dubai", country: "AE", schemaType: "HairSalon", formatted: "Gate Building, DIFC, Dubai, AE" } },
      { id: "ev_phone", text: "Phone link: +97143334444", sourceType: "phone", fieldHint: "market", data: { telephone: "+97143334444" } },
      { id: "ev_lang", text: "html lang: en-US", sourceType: "meta", fieldHint: "language" },
    ]);
    const result = await resolveLocation({
      ...base,
      addresses: [address({ raw: "Gate Building, DIFC, Dubai", neighborhood: "DIFC", city: "Dubai", country: "United Arab Emirates", evidenceIds: ["ev_addr"] })],
      nearbyAreas: ["Business Bay"],
      kind: "personal_care_wellness",
      presence: "single_location",
      evidence,
      seedHostname: "example-salon.ae",
    });
    expect(result.location.primary?.countryCode).toBe("AE");
    expect(result.location.primary?.neighborhood).toBe("DIFC");
    expect(result.scope.value).toBe("hyperlocal");
    expect(result.markets[0]).toMatchObject({ name: "DIFC", level: "neighborhood" });
    // A page language tag is a theme default, never a market.
    expect(result.location.signals.some((signal) => /US/.test(signal.value))).toBe(false);
    expect(result.location.nearbyAreas).toEqual(["Business Bay"]);
  });

  it("lets the model widen a destination business from hyperlocal to local, never narrower", async () => {
    const result = await resolveLocation({
      ...base,
      llmScope: "local",
      addresses: [address({ raw: "12 Mary St, Surry Hills, Sydney", neighborhood: "Surry Hills", city: "Sydney", countryCode: "AU" })],
      kind: "restaurant_food_beverage",
      presence: "single_location",
      evidence: [],
      seedHostname: "example.com.au",
    });
    expect(result.scope.value).toBe("local");
    expect(result.markets.map((m) => m.level)).toEqual(["city", "neighborhood", "country"]);
  });

  it("treats an online business with several countries as international and lists countries, not a head-office city", async () => {
    const result = await resolveLocation({
      ...base,
      addresses: [address({ raw: "100 King St W, Toronto", role: "headquarters", city: "Toronto", countryCode: "CA" })],
      countriesServed: ["Canada", "United States", "United Kingdom"],
      kind: "b2b_saas_software",
      presence: "online_only",
      evidence: [],
      seedHostname: "example.com",
    });
    expect(result.scope.value).toBe("international");
    expect(result.markets.every((m) => m.level === "country")).toBe(true);
    expect(result.location.primaryRole).toBe("headquarters");
  });

  it("does not make a many-shop chain local to its head-office city", async () => {
    const result = await resolveLocation({
      ...base,
      llmScope: "national",
      locationCount: "many",
      addresses: [address({ raw: "Quorum Business Park, Newcastle upon Tyne", role: "headquarters", city: "Newcastle upon Tyne", countryCode: "GB" })],
      kind: "restaurant_food_beverage",
      presence: "multi_location",
      evidence: [],
      seedHostname: "example.co.uk",
    });
    expect(result.scope.value).toBe("national");
    expect(result.markets[0]).toMatchObject({ level: "country", countryCode: "GB" });
  });

  it("flags a country conflict instead of guessing", async () => {
    const evidence = makeEvidenceSet([
      { id: "ev_p1", text: "Phone link: +442079460000", sourceType: "phone", data: { telephone: "+442079460000" } },
      { id: "ev_p2", text: "Phone link: +442079460001", sourceType: "phone", data: { telephone: "+442079460001" } },
    ]);
    const result = await resolveLocation({
      ...base,
      addresses: [address({ raw: "Main Street", street: "Main Street", countryCode: "IE", city: "Dublin" })],
      kind: "local_retail_store",
      presence: "single_location",
      evidence,
      seedHostname: "example.co.uk",
    });
    expect(result.location.needsConfirmation).toBe(true);
    expect(result.warnings.join(" ")).toMatch(/confirm/i);
  });
});

describe("resolveLocation with Google Search Console signals", () => {
  const mix = (partial: Partial<Record<"neighborhood" | "nearby" | "city" | "region" | "country" | "nearMe", number>> = {}) => ({ neighborhood: 0, nearby: 0, city: 0, region: 0, country: 0, nearMe: 0, ...partial });
  const gsc = (countries: Array<{ countryCode: string; share: number; impressions: number }>, placeDemand = { placeBearingImpressions: 0, mix: mix(), unmatchedPlaceMentions: [] as string[] }, sufficient = true) => ({
    sufficient,
    countries: countries.map((c) => ({ ...c, clicks: Math.round(c.impressions / 20) })),
    placeDemand,
  });
  const irishPhones = () =>
    makeEvidenceSet([
      { id: "ev_ie1", text: "Phone link: +35312345678", sourceType: "phone", data: { telephone: "+35312345678" } },
      { id: "ev_ie2", text: "Phone link: +35312345679", sourceType: "phone", data: { telephone: "+35312345679" } },
    ]);

  it("breaks a domain-ending versus phone tie with a strong country share (weight 2)", async () => {
    const input = { ...base, addresses: [], kind: "b2b_saas_software" as const, presence: "online_only" as const, evidence: irishPhones(), seedHostname: "example.co.uk" };
    const tie = await resolveLocation(input);
    expect(tie.location.primary?.countryCode).toBe("GB");
    const result = await resolveLocation({ ...input, searchConsole: gsc([{ countryCode: "IE", share: 0.72, impressions: 1200 }]) });
    expect(result.location.primary?.countryCode).toBe("IE");
    expect(result.location.signals).toContainEqual(expect.objectContaining({ kind: "search_console_country", weight: 2 }));
  });

  it("votes 1 for a 40–60% share and nothing below it", async () => {
    const input = { ...base, addresses: [], kind: "b2b_saas_software" as const, presence: "online_only" as const, evidence: [], seedHostname: "example.com" };
    const medium = await resolveLocation({ ...input, searchConsole: gsc([{ countryCode: "AE", share: 0.5, impressions: 900 }]) });
    expect(medium.location.signals.find((s) => s.kind === "search_console_country")?.weight).toBe(1);
    const weak = await resolveLocation({ ...input, searchConsole: gsc([{ countryCode: "AE", share: 0.3, impressions: 900 }]) });
    expect(weak.location.signals.some((s) => s.kind === "search_console_country")).toBe(false);
    expect(weak.location.primary).toBeNull();
  });

  it("never overrides or contests a structured address", async () => {
    const evidence = makeEvidenceSet([
      { id: "ev_addr", text: "HairSalon address: Gate Building, DIFC, Dubai, AE", sourceType: "address", data: { structured: true, locality: "Dubai", country: "AE", schemaType: "HairSalon", formatted: "Gate Building, DIFC, Dubai, AE" } },
    ]);
    const result = await resolveLocation({
      ...base,
      addresses: [],
      kind: "personal_care_wellness",
      presence: "single_location",
      evidence,
      seedHostname: "example.com",
      searchConsole: gsc([{ countryCode: "IN", share: 0.95, impressions: 5000 }]),
    });
    expect(result.location.primary?.countryCode).toBe("AE");
    expect(result.location.signals.find((s) => s.kind === "search_console_country")?.weight).toBe(0);
    expect(result.warnings.join(" ")).not.toMatch(/most signals point/);
  });

  it("never outweighs the operator's hint", async () => {
    const { buildMarketHint } = await import("@/lib/projects/market-hint");
    const { marketCountries } = await import("@/lib/understanding/market-countries");
    const hint = buildMarketHint({ countryCodes: ["AE"], worldwide: false, area: null })!;
    const sa = gsc([{ countryCode: "SA", share: 0.9, impressions: 4000 }]);
    const salonResult = await resolveLocation({ ...base, addresses: [], kind: "personal_care_wellness", presence: "single_location", evidence: [], seedHostname: "example.com", hint, searchConsole: sa });
    expect(salonResult.location.primary?.countryCode).toBe("AE");
    const online = await resolveLocation({ ...base, addresses: [], kind: "b2b_saas_software", presence: "online_only", evidence: [], seedHostname: "example.com", hint, searchConsole: sa });
    expect(online.location.primary?.countryCode).toBe("AE");
    expect(marketCountries({ location: online.location, classification: { kind: "b2b_saas_software", physicalPresence: "online_only" } as never, marketScope: { value: online.scope.value } as never, markets: online.markets }).primary).toBe("AE");
  });

  it("widens an online business from national to international when demand comes from two countries", async () => {
    const input = { ...base, addresses: [address({ raw: "100 King St W, Toronto", role: "headquarters", city: "Toronto", countryCode: "CA" })], kind: "b2b_saas_software" as const, presence: "online_only" as const, evidence: [], seedHostname: "example.com" };
    expect((await resolveLocation(input)).scope.value).toBe("national");
    const result = await resolveLocation({ ...input, searchConsole: gsc([{ countryCode: "CA", share: 0.55, impressions: 900 }, { countryCode: "US", share: 0.3, impressions: 500 }, { countryCode: "GB", share: 0.05, impressions: 80 }]) });
    expect(result.scope.value).toBe("international");
    expect(result.location.countriesServed).toEqual(expect.arrayContaining(["CA", "US"]));
    expect(result.location.countriesServed).not.toContain("GB");
    expect(result.scope.rationale).toMatch(/Search demand/);
  });

  it("widens a salon from hyperlocal to local when searches name the city far more than the area", async () => {
    const input = { ...base, addresses: [address({ raw: "Gate Building, DIFC, Dubai", neighborhood: "DIFC", city: "Dubai", countryCode: "AE" })], kind: "personal_care_wellness" as const, presence: "single_location" as const, evidence: [], seedHostname: "example.ae" };
    expect((await resolveLocation(input)).scope.value).toBe("hyperlocal");
    const cityHeavy = await resolveLocation({ ...input, searchConsole: gsc([{ countryCode: "AE", share: 0.9, impressions: 3000 }], { placeBearingImpressions: 400, mix: mix({ city: 300, neighborhood: 60, nearMe: 40 }), unmatchedPlaceMentions: [] }) });
    expect(cityHeavy.scope.value).toBe("local");
    const areaHeavy = await resolveLocation({ ...input, searchConsole: gsc([{ countryCode: "AE", share: 0.9, impressions: 3000 }], { placeBearingImpressions: 400, mix: mix({ city: 100, neighborhood: 200, nearMe: 100 }), unmatchedPlaceMentions: [] }) });
    expect(areaHeavy.scope.value).toBe("hyperlocal");
  });

  it("never narrows a scope, ignores insufficient data, and yields to a hint's scope", async () => {
    const international = { ...base, addresses: [address({ raw: "100 King St W, Toronto", role: "headquarters", city: "Toronto", countryCode: "CA" })], countriesServed: ["Canada", "United States", "United Kingdom"], kind: "b2b_saas_software" as const, presence: "online_only" as const, evidence: [], seedHostname: "example.com" };
    expect((await resolveLocation({ ...international, searchConsole: gsc([{ countryCode: "CA", share: 1, impressions: 5000 }]) })).scope.value).toBe("international");

    const national = { ...international, countriesServed: [] };
    const twoCountries = [{ countryCode: "CA", share: 0.55, impressions: 900 }, { countryCode: "US", share: 0.3, impressions: 500 }];
    const thin = await resolveLocation({ ...national, searchConsole: gsc(twoCountries, undefined, false) });
    expect(thin.scope.value).toBe("national");
    expect(thin.location.signals.some((s) => s.kind === "search_console_country")).toBe(false);

    const { buildMarketHint } = await import("@/lib/projects/market-hint");
    const hinted = await resolveLocation({ ...national, hint: buildMarketHint({ countryCodes: ["CA"], worldwide: false, area: null }), searchConsole: gsc(twoCountries) });
    expect(hinted.scope.value).toBe("national");
  });
});
