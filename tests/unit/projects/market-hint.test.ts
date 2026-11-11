import { describe, expect, it } from "vitest";
import {
  buildMarketHint,
  describeMarketHint,
  hintCountry,
  marketHintFromLegacy,
  MarketHintInputSchema,
  parseMarketHint,
  serializeMarketHint,
  type HintPlace,
  type MarketHint,
} from "@/lib/projects/market-hint";

const NOW = new Date("2026-09-14T10:00:00.000Z");

function place(overrides: Partial<HintPlace> = {}): HintPlace {
  return {
    label: "DIFC, Dubai",
    formattedAddress: "DIFC, Dubai, United Arab Emirates",
    premise: null,
    street: null,
    neighborhood: "DIFC",
    district: null,
    city: "Dubai",
    region: "Dubai",
    country: "UAE",
    countryCode: "AE",
    postalCode: null,
    lat: 25.21,
    lng: 55.28,
    precision: "premise",
    provider: "photon",
    providerId: "osm:relation/1",
    ...overrides,
  };
}

function input(value: unknown) {
  return MarketHintInputSchema.parse(value);
}

describe("parseMarketHint", () => {
  it("returns null for legacy, empty and malformed values without throwing", () => {
    for (const raw of ["auto", "global", "AE", "US", "", "   ", null, undefined, "{", '{"v":2,"countryCodes":["AE"]}', "[]", "null", "42", '"AE"', '{"v":1}', '{"v":1,"countryCodes":["ZZ"],"worldwide":false}']) {
      expect(() => parseMarketHint(raw as string | null | undefined)).not.toThrow();
      expect(parseMarketHint(raw as string | null | undefined), String(raw)).toBeNull();
    }
  });

  it("round-trips a built hint unchanged", () => {
    const hint = buildMarketHint(input({ countryCodes: ["AE"], area: { query: "DIFC", place: place() } }), NOW)!;
    expect(parseMarketHint(serializeMarketHint(hint))).toEqual(hint);
    const worldwide = buildMarketHint(input({ worldwide: true }), NOW)!;
    expect(parseMarketHint(serializeMarketHint(worldwide))).toEqual(worldwide);
    const unresolved = buildMarketHint(input({ countryCodes: ["AE"], area: { query: "Jumeira Lakes", place: null } }), NOW)!;
    expect(parseMarketHint(serializeMarketHint(unresolved))).toEqual(unresolved);
  });

  it("normalises stored codes: upper-cases, drops unknown codes and duplicates", () => {
    const parsed = parseMarketHint(JSON.stringify({ v: 1, countryCodes: ["ae", "ZZ", "sa", "AE", "UK"], worldwide: false, area: null, source: "user", capturedAt: NOW.toISOString() }));
    expect(parsed?.countryCodes).toEqual(["AE", "SA"]);
  });

  it("drops a stored area whose place is in another country", () => {
    const parsed = parseMarketHint(JSON.stringify({ v: 1, countryCodes: ["IN"], worldwide: false, area: { query: "DIFC", place: place() }, source: "user", capturedAt: NOW.toISOString() }));
    expect(parsed?.countryCodes).toEqual(["IN"]);
    expect(parsed?.area).toBeNull();
  });

  it("drops a stored area when there is not exactly one country", () => {
    const parsed = parseMarketHint(JSON.stringify({ v: 1, countryCodes: ["AE", "SA"], worldwide: false, area: { query: "DIFC", place: place() }, source: "user", capturedAt: NOW.toISOString() }));
    expect(parsed?.area).toBeNull();
  });
});

describe("serializeMarketHint", () => {
  it("stores no hint as auto", () => {
    expect(serializeMarketHint(null)).toBe("auto");
  });
});

describe("MarketHintInputSchema", () => {
  const rejects = (value: unknown) => expect(MarketHintInputSchema.safeParse(value).success).toBe(false);

  it("accepts the three intake shapes", () => {
    expect(input({ countryCodes: ["ae"] }).countryCodes).toEqual(["AE"]);
    expect(input({ worldwide: true })).toEqual({ countryCodes: [], worldwide: true, area: null });
    expect(input({ countryCodes: ["AE"], area: { query: "DIFC", place: place() } }).area?.place?.neighborhood).toBe("DIFC");
    expect(input({ countryCodes: ["AE"], area: { query: "DIFC", place: null } }).area?.place).toBeNull();
  });

  it("rejects contradictory or invalid input", () => {
    rejects({ worldwide: true, countryCodes: ["AE"] });
    rejects({ worldwide: true, area: { query: "DIFC", place: null } });
    rejects({ countryCodes: [], area: { query: "DIFC", place: null } });
    rejects({ countryCodes: ["AE", "SA"], area: { query: "DIFC", place: null } });
    rejects({ countryCodes: ["IN"], area: { query: "DIFC", place: place() } });
    rejects({ countryCodes: ["UK"] });
    rejects({ countryCodes: ["ZZ"] });
    rejects({ countryCodes: ["EU"] });
    rejects({ countryCodes: ["AE", "ae"] });
    rejects({ countryCodes: ["AE", "SA", "QA", "KW", "OM", "BH", "EG", "JO", "IN", "PK", "LK"] });
    rejects({ countryCodes: ["AE"], area: { query: "x".repeat(121), place: null } });
    rejects({ countryCodes: ["AE"], area: { query: "D", place: null } });
    rejects({ countryCodes: ["AE"], area: { query: "DIFC", place: place({ lat: 91 }) } });
    rejects({ countryCodes: ["AE"], area: { query: "DIFC", place: place({ provider: "somewhere" as HintPlace["provider"] }) } });
  });
});

describe("buildMarketHint", () => {
  it("treats Detect from my website as no hint", () => {
    expect(buildMarketHint(input({}), NOW)).toBeNull();
    expect(buildMarketHint(input({ countryCodes: [], worldwide: false, area: null }), NOW)).toBeNull();
  });

  it("normalises the operator's place on the server", () => {
    const hint = buildMarketHint(input({ countryCodes: ["ae"], area: { query: "  DIFC ", place: place({ countryCode: null, label: "whatever the browser sent" }) } }), NOW) as MarketHint;
    expect(hint).toMatchObject({ v: 1, countryCodes: ["AE"], worldwide: false, source: "user", capturedAt: NOW.toISOString() });
    expect(hint.area?.query).toBe("DIFC");
    expect(hint.area?.place).toMatchObject({
      countryCode: "AE",
      country: "United Arab Emirates",
      label: "DIFC, Dubai, United Arab Emirates",
      // A neighbourhood centroid never claims premise precision.
      precision: "neighborhood",
    });
  });

  it("builds a worldwide hint with no countries or area", () => {
    expect(buildMarketHint(input({ worldwide: true }), NOW)).toEqual({ v: 1, countryCodes: [], worldwide: true, area: null, source: "user", capturedAt: NOW.toISOString() });
  });
});

describe("marketHintFromLegacy", () => {
  it("turns an ISO code into a country hint and everything else into none", () => {
    expect(marketHintFromLegacy("US")).toMatchObject({ v: 1, countryCodes: ["US"], worldwide: false, area: null, source: "user" });
    expect(marketHintFromLegacy("ae")?.countryCodes).toEqual(["AE"]);
    for (const value of ["global", "", "usa", "UK", "auto", undefined]) expect(marketHintFromLegacy(value), String(value)).toBeNull();
  });
});

describe("describeMarketHint and hintCountry", () => {
  it("describes area, countries and worldwide in plain words", () => {
    const area = buildMarketHint(input({ countryCodes: ["AE"], area: { query: "DIFC", place: place() } }), NOW)!;
    expect(describeMarketHint(area)).toBe("DIFC, Dubai, United Arab Emirates");
    expect(describeMarketHint(buildMarketHint(input({ countryCodes: ["US"] }), NOW)!)).toBe("United States");
    expect(describeMarketHint(buildMarketHint(input({ countryCodes: ["AE", "SA"] }), NOW)!)).toBe("United Arab Emirates, Saudi Arabia");
    expect(describeMarketHint(buildMarketHint(input({ worldwide: true }), NOW)!)).toBe("Worldwide");
    expect(describeMarketHint(buildMarketHint(input({ countryCodes: ["AE"], area: { query: "Jumeira Lakes", place: null } }), NOW)!)).toBe("Jumeira Lakes, United Arab Emirates");
  });

  it("reads the primary country", () => {
    expect(hintCountry(null)).toBeNull();
    expect(hintCountry(buildMarketHint(input({ worldwide: true }), NOW))).toBeNull();
    expect(hintCountry(buildMarketHint(input({ countryCodes: ["SA", "AE"] }), NOW))).toBe("SA");
  });
});
