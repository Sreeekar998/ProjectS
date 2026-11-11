import { describe, expect, it } from "vitest";
import { emptyPlace } from "@/lib/geo/types";
import type { BusinessClassification, BusinessProfile, LocationProfile } from "@/lib/profile/schema";
import { marketCountries } from "@/lib/understanding/market-countries";
import { makeProfile } from "../../helpers/profile-fixtures";

function classification(kind: string, physicalPresence: string): BusinessClassification {
  return {
    industry: "Test",
    subIndustry: null,
    businessType: "Test business",
    path: ["Test"],
    kind,
    businessModel: "b2c",
    customerType: "consumers",
    physicalPresence,
    pricePositioning: "mid",
    localCategory: null,
    alternatives: [],
    ruledOut: [],
    rationale: "",
    source: "evidence",
    evidenceIds: [],
    confidence: 80,
  };
}

function location(primaryCountry: string | null, countriesServed: string[]): LocationProfile {
  const primary = primaryCountry ? { ...emptyPlace("website"), label: primaryCountry, countryCode: primaryCountry, precision: "country" as const } : null;
  return { primary, primaryRole: "headquarters", branches: [], serviceAreas: [], nearbyAreas: [], countriesServed, signals: [], needsConfirmation: false, rationale: "", source: "evidence", confidence: 80 };
}

function profile(kind: string, presence: string, loc: LocationProfile | undefined, scope: BusinessProfile["marketScope"]["value"] = "national"): BusinessProfile {
  const base = makeProfile({ brandName: "Example Co", archetype: "other", industry: "Test" });
  base.classification = classification(kind, presence);
  base.location = loc;
  base.marketScope = { value: scope, source: "evidence", evidenceIds: [], confidence: 80 };
  return base;
}

describe("marketCountries", () => {
  it("uses the place for a place-bound business, even if it serves other countries", () => {
    const result = marketCountries(profile("personal_care_wellness", "single_location", location("AE", ["SA", "AE"]), "local"));
    expect(result).toEqual({ primary: "AE", all: ["AE", "SA"], worldwide: false });
  });

  it("uses the first served country for an online business whose head office is elsewhere", () => {
    // A Dubai-HQ software company whose operator said Saudi Arabia.
    const result = marketCountries(profile("software_saas", "online_only", location("AE", ["SA", "AE"])));
    expect(result.primary).toBe("SA");
    expect(result.all).toEqual(["SA", "AE"]);
  });

  it("treats an online-only presence as not place-bound whatever the kind", () => {
    expect(marketCountries(profile("personal_care_wellness", "online_only", location("GB", ["IE"]))).primary).toBe("IE");
  });

  it("falls back to the head office when nothing else is known", () => {
    expect(marketCountries(profile("software_saas", "online_only", location("CA", [])))).toEqual({ primary: "CA", all: ["CA"], worldwide: false });
    expect(marketCountries(profile("personal_care_wellness", "single_location", location(null, ["AE"])))).toEqual({ primary: "AE", all: ["AE"], worldwide: false });
  });

  it("reports a global scope as worldwide", () => {
    expect(marketCountries(profile("software_saas", "online_only", location("US", ["US", "GB"]), "global"))).toEqual({ primary: "US", all: ["US", "GB"], worldwide: true });
  });

  it("repairs pre-ISO-fix codes and drops junk", () => {
    expect(marketCountries(profile("software_saas", "online_only", location("UK", ["uk", "ZZ", "fr"]))).all).toEqual(["GB", "FR"]);
  });

  it("reads markets for profiles built before first-class locations", () => {
    const legacy = profile("other", "unknown", undefined);
    legacy.markets = [
      { name: "Germany", level: "country", countryCode: "DE", confidence: 70, evidenceIds: [], isPrimary: false },
      { name: "Austria", level: "country", countryCode: "AT", confidence: 80, evidenceIds: [], isPrimary: true },
      { name: "Vienna", level: "city", countryCode: null, confidence: 60, evidenceIds: [], isPrimary: false },
    ];
    expect(marketCountries(legacy)).toEqual({ primary: "AT", all: ["AT", "DE"], worldwide: false });
    expect(marketCountries(profile("other", "unknown", undefined))).toEqual({ primary: null, all: [], worldwide: false });
  });
});
