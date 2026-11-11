import { describe, expect, it } from "vitest";
import {
  DETECT_CHOICE,
  WORLDWIDE_CHOICE,
  countryMatchScore,
  countryPickerOption,
  countryPickerOptions,
  countryResultCount,
  searchCountryOptions,
} from "@/lib/geo/country-search";
import { foldCountrySearchText } from "@/lib/geo/countries";

const values = (query: string) => searchCountryOptions(query).map((o) => o.value);

describe("intake country picker options", () => {
  it("lists Detect, Worldwide and all 250 countries (252 options)", () => {
    const options = countryPickerOptions();
    expect(options.length).toBeGreaterThanOrEqual(252);
    expect(options[0]?.value).toBe(DETECT_CHOICE);
    expect(options[1]?.value).toBe(WORLDWIDE_CHOICE);
    expect(countryResultCount(options)).toBe(250);
    expect(new Set(options.map((o) => o.value)).size).toBe(options.length);
  });

  it("returns every option in list order for an empty or blank query", () => {
    expect(searchCountryOptions("")).toBe(countryPickerOptions());
    expect(searchCountryOptions("   ")).toHaveLength(countryPickerOptions().length);
  });

  it("resolves a committed value to its option, tolerating lower-case codes", () => {
    expect(countryPickerOption("AE")?.label).toBe("United Arab Emirates");
    expect(countryPickerOption("ae")?.value).toBe("AE");
    expect(countryPickerOption("auto")?.label).toBe("Detect from my website");
    expect(countryPickerOption("ZZ")).toBeNull();
  });
});

describe("country search ranking", () => {
  it("puts an exact code or alias first", () => {
    expect(values("uk")[0]).toBe("GB");
    expect(values("uae")[0]).toBe("AE");
    expect(values("usa")[0]).toBe("US");
    expect(values("us")[0]).toBe("US");
    expect(values("ksa")[0]).toBe("SA");
    // The alias beats the prefix match on Ukraine.
    expect(values("uk").indexOf("GB")).toBeLessThan(values("uk").indexOf("UA"));
  });

  it("folds diacritics and punctuation, so 'cote' and 'aland' match", () => {
    expect(values("cote")).toContain("CI");
    expect(values("côte d'ivoire")[0]).toBe("CI");
    expect(values("aland")).toContain("AX");
    expect(values("sao tome")).toContain("ST");
  });

  it("finds Kosovo and matches alpha-3 codes", () => {
    expect(values("kosovo")[0]).toBe("XK");
    expect(values("are")[0]).toBe("AE");
    expect(values("gbr")[0]).toBe("GB");
  });

  it("matches a partial multi-word name ('united ar' → only the UAE)", () => {
    expect(values("united ar")).toEqual(["AE"]);
    expect(values("united")).toEqual(expect.arrayContaining(["AE", "GB", "US"]));
  });

  it("ranks name prefixes above word prefixes above substrings", () => {
    const results = values("guinea");
    // "Guinea" (exact) and "Guinea-Bissau" (prefix) before "Equatorial Guinea" and "Papua New Guinea".
    expect(results[0]).toBe("GN");
    expect(results.indexOf("GW")).toBeLessThan(results.indexOf("GQ"));
    expect(results.indexOf("GW")).toBeLessThan(results.indexOf("PG"));
  });

  it("keeps the special options on top only while the query clearly matches them", () => {
    expect(values("worldwide")[0]).toBe(WORLDWIDE_CHOICE);
    expect(values("glo")[0]).toBe(WORLDWIDE_CHOICE);
    expect(values("detect")[0]).toBe(DETECT_CHOICE);
    expect(values("in")).not.toContain(WORLDWIDE_CHOICE);
    expect(values("an")).not.toContain(WORLDWIDE_CHOICE);
    expect(values("germany")).not.toContain(DETECT_CHOICE);
  });

  it("ignores one-letter substring noise but keeps prefixes", () => {
    const results = values("z");
    expect(results).toEqual(expect.arrayContaining(["ZA", "ZM", "ZW"]));
    expect(results).not.toContain("BR"); // "Brazil" contains z, but not as a word start
  });

  it("returns nothing for text that matches no country", () => {
    expect(searchCountryOptions("qqqq")).toEqual([]);
    expect(countryMatchScore({ searchKeys: ["france"] }, foldCountrySearchText("xyz"))).toBeNull();
  });
});
