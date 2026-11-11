import { describe, expect, it } from "vitest";
import { countryCodeFrom, countryCodeFromCurrency, countryCodeFromHostname, countryCodesMentioned, countryName, countryOptions, countryPhrase, foldCountrySearchText } from "@/lib/geo/countries";
import { dominantPhoneCountry, phoneCountry } from "@/lib/geo/phone";
import { distanceMeters, sanitizeTagFilters } from "@/lib/geo/nearby";

describe("country signals", () => {
  it("reads country-code domains but not vanity endings", () => {
    expect(countryCodeFromHostname("salon.ae")).toBe("AE");
    expect(countryCodeFromHostname("shop.co.uk")).toBe("GB");
    expect(countryCodeFromHostname("startup.io")).toBeNull();
    expect(countryCodeFromHostname("brand.com")).toBeNull();
  });

  it("resolves names and codes without a fixed country list", () => {
    expect(countryCodeFrom("United Arab Emirates")).toBe("AE");
    expect(countryCodeFrom("uae")).toBe("AE");
    expect(countryName("DE")).toBe("Germany");
    expect(countryCodesMentioned("best salon in the United Arab Emirates")).toContain("AE");
    expect(countryCodeFromCurrency("Prices from AED 150")).toBe("AE");
  });

  it("resolves names to current ISO codes, not the deprecated codes CLDR also names", () => {
    // Before the ISO list, a .co.uk salon whose address said "United Kingdom"
    // resolved to UK and showed a GB/UK country conflict.
    expect(countryCodeFrom("United Kingdom")).toBe("GB");
    expect(countryCodeFrom("UK")).toBe("GB");
    expect(countryCodeFrom("France")).toBe("FR");
    expect(countryCodeFrom("Benin")).toBe("BJ");
    expect(countryCodeFrom("Burkina Faso")).toBe("BF");
    expect(countryCodeFrom("Congo - Kinshasa")).toBe("CD");
    expect(countryCodeFrom("Serbia")).toBe("RS");
    expect(countryCodeFrom("Russia")).toBe("RU");
    expect(countryCodeFrom("Kosovo")).toBe("XK");
    expect(countryCodeFrom("Hong Kong")).toBe("HK");
    expect(countryCodeFrom("Myanmar")).toBe("MM");
    expect(countryName("UK")).toBeNull();
    expect(countryName("FX")).toBeNull();
    expect(countryName("GB")).toBe("United Kingdom");
    const mentioned = countryCodesMentioned("London, United Kingdom and Paris, France");
    expect(mentioned).toEqual(expect.arrayContaining(["GB", "FR"]));
    expect(mentioned).not.toContain("UK");
    expect(mentioned).not.toContain("FX");
    expect(countryCodeFromHostname("site.rs")).toBe("RS");
    expect(countryCodeFromHostname("site.su")).toBeNull();
  });

  it("lists every country for the intake picker, sorted and searchable", () => {
    const options = countryOptions();
    expect(options).toHaveLength(250);
    const names = options.map((o) => o.name);
    expect(names).toEqual([...names].sort(new Intl.Collator("en", { sensitivity: "base" }).compare));
    const find = (query: string) => options.filter((o) => o.searchKeys.some((key) => key.includes(foldCountrySearchText(query)))).map((o) => o.code);
    expect(find("cote")).toContain("CI");
    expect(find("aland")).toContain("AX");
    expect(find("uae")).toContain("AE");
    expect(find("usa")).toContain("US");
    expect(find("kosovo")).toContain("XK");
    expect(options.find((o) => o.code === "GB")?.searchKeys).toEqual(expect.arrayContaining(["gb", "gbr", "uk"]));
  });

  it("adds the article only for country names that take one", () => {
    expect(countryPhrase("United Arab Emirates")).toBe("the United Arab Emirates");
    expect(countryPhrase("United States")).toBe("the United States");
    expect(countryPhrase("Philippines")).toBe("the Philippines");
    expect(countryPhrase("Netherlands")).toBe("the Netherlands");
    expect(countryPhrase("Cayman Islands")).toBe("the Cayman Islands");
    expect(countryPhrase("Dominican Republic")).toBe("the Dominican Republic");
    expect(countryPhrase("Germany")).toBe("Germany");
    expect(countryPhrase("Dominica")).toBe("Dominica");
    expect(countryPhrase("Czechia")).toBe("Czechia");
    expect(countryPhrase("India")).toBe("India");
    expect(countryPhrase("the Bahamas")).toBe("the Bahamas");
    expect(countryPhrase("")).toBe("");
  });

  it("validates phone numbers per country", () => {
    expect(phoneCountry("+97143334444")?.countryCode).toBe("AE");
    expect(dominantPhoneCountry(["+442079460000", "+442079460001", "+97143334444"])?.countryCode).toBe("GB");
  });
});

describe("nearby places helpers", () => {
  it("allows only map tag keys, never arbitrary query text", () => {
    expect(sanitizeTagFilters([{ key: "shop", value: "hairdresser" }, { key: "shop\"];out;", value: "x" }, { key: "name", value: "anything" }])).toEqual([{ key: "shop", value: "hairdresser" }]);
  });

  it("measures distance in metres", () => {
    expect(Math.round(distanceMeters({ lat: 25.2, lng: 55.27 }, { lat: 25.21, lng: 55.27 }) / 100)).toBe(11);
  });
});
