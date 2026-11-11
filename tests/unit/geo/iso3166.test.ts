import { describe, expect, it } from "vitest";
import { getCountries } from "libphonenumber-js";
import { alpha2FromAlpha3, alpha3, isCountryCode, isoCountry, ISO_COUNTRIES } from "@/lib/geo/iso3166";

// The deprecated or exceptional codes CLDR still names, which the old AA..ZZ
// scan picked up ("United Kingdom" → UK, "France" → FX, "Serbia" → YU).
const NOT_COUNTRIES = ["UK", "FX", "SU", "YU", "ZR", "DD", "TP", "AN", "BU", "CS", "DY", "HV", "NH", "RH", "VD", "YD", "EU", "EZ", "UN", "QO", "XA", "XB", "AC", "TA", "CP", "CQ", "DG", "EA", "IC", "ZZ"];

describe("ISO 3166-1 list", () => {
  it("has the 249 officially assigned codes plus Kosovo", () => {
    expect(ISO_COUNTRIES.filter((c) => c.official)).toHaveLength(249);
    expect(ISO_COUNTRIES.filter((c) => !c.official).map((c) => c.a2)).toEqual(["XK"]);
    expect(ISO_COUNTRIES).toHaveLength(250);
  });

  it("has unique, well-formed alpha-2 and alpha-3 codes and names", () => {
    const a2 = ISO_COUNTRIES.map((c) => c.a2);
    const a3 = ISO_COUNTRIES.map((c) => c.a3);
    expect(new Set(a2).size).toBe(a2.length);
    expect(new Set(a3).size).toBe(a3.length);
    for (const country of ISO_COUNTRIES) {
      expect(country.a2).toMatch(/^[A-Z]{2}$/);
      expect(country.a3).toMatch(/^[A-Z]{3}$/);
      expect(country.name.trim().length).toBeGreaterThan(2);
    }
  });

  it("gets a real English display name for every code from Intl", () => {
    const names = new Intl.DisplayNames(["en"], { type: "region" });
    const echoed = ISO_COUNTRIES.filter((c) => {
      const name = names.of(c.a2);
      return !name || name === c.a2 || /^Unknown/i.test(name);
    });
    expect(echoed.map((c) => c.a2)).toEqual([]);
  });

  it("matches libphonenumber apart from the known territory differences", () => {
    const list = new Set(ISO_COUNTRIES.map((c) => c.a2));
    const phone = new Set<string>(getCountries());
    expect([...phone].filter((code) => !list.has(code)).sort()).toEqual(["AC", "TA"]);
    expect([...list].filter((code) => !phone.has(code)).sort()).toEqual(["AQ", "BV", "GS", "HM", "PN", "TF", "UM"]);
  });

  it("excludes deprecated, exceptional and pseudo-region codes", () => {
    for (const code of NOT_COUNTRIES) expect(isCountryCode(code), code).toBe(false);
  });

  it("validates codes in any case and rejects non-codes", () => {
    expect(isCountryCode("AE")).toBe(true);
    expect(isCountryCode("ae")).toBe(true);
    expect(isCountryCode(" gb ")).toBe(true);
    expect(isCountryCode("XK")).toBe(true);
    expect(isCountryCode("")).toBe(false);
    expect(isCountryCode("ARE")).toBe(false);
    expect(isCountryCode(null)).toBe(false);
    expect(isCountryCode(undefined)).toBe(false);
    expect(isoCountry("fr")?.a3).toBe("FRA");
  });

  it("maps well-known alpha-3 codes", () => {
    const expected: Record<string, string> = {
      GB: "GBR", AE: "ARE", US: "USA", IN: "IND", SG: "SGP", AU: "AUS", CA: "CAN", DE: "DEU", FR: "FRA", SA: "SAU",
      QA: "QAT", KW: "KWT", OM: "OMN", BH: "BHR", EG: "EGY", ZA: "ZAF", BR: "BRA", MX: "MEX", JP: "JPN", CN: "CHN",
      KR: "KOR", ID: "IDN", MY: "MYS", TH: "THA", VN: "VNM", PH: "PHL", PK: "PAK", BD: "BGD", LK: "LKA", NP: "NPL",
      TR: "TUR", RU: "RUS", UA: "UKR", PL: "POL", ES: "ESP", IT: "ITA", NL: "NLD", BE: "BEL", CH: "CHE", SE: "SWE",
      NO: "NOR", DK: "DNK", FI: "FIN", IE: "IRL", NZ: "NZL", NG: "NGA", KE: "KEN", CI: "CIV", CD: "COD", CG: "COG",
      RS: "SRB", BA: "BIH", MK: "MKD", ME: "MNE", RO: "ROU", TL: "TLS", KP: "PRK", AX: "ALA", SS: "SSD", XK: "XKX",
    };
    for (const [a2, a3] of Object.entries(expected)) expect(alpha3(a2), a2).toBe(a3);
    expect(alpha3("ae")).toBe("ARE");
    expect(alpha3("ZZ")).toBeNull();
    expect(alpha3("UK")).toBeNull();
  });

  it("maps Search Console's lower-case alpha-3 back to alpha-2", () => {
    expect(alpha2FromAlpha3("are")).toBe("AE");
    expect(alpha2FromAlpha3("gbr")).toBe("GB");
    expect(alpha2FromAlpha3("USA")).toBe("US");
    expect(alpha2FromAlpha3("xkx")).toBe("XK");
    expect(alpha2FromAlpha3("xkk")).toBe("XK");
    expect(alpha2FromAlpha3("zzz")).toBeNull();
    expect(alpha2FromAlpha3("gb")).toBeNull();
    expect(alpha2FromAlpha3("")).toBeNull();
    for (const country of ISO_COUNTRIES) expect(alpha2FromAlpha3(country.a3.toLowerCase())).toBe(country.a2);
  });
});
