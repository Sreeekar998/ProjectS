import { describe, expect, it } from "vitest";
import { applyClassificationEdit, applyLocationEdit } from "@/lib/understanding/edits";
import { promptGeographyFromProfile } from "@/lib/prompts/geography";
import { makeProfile } from "../../helpers/profile-fixtures";

describe("understanding edits", () => {
  it("moves a business out of healthcare and drops regulated handling with it", () => {
    const profile = makeProfile({ brandName: "Maison Nine", archetype: "healthcare", industry: "Healthcare", regulated: true });
    const next = applyClassificationEdit(profile, { businessType: "Hair salon", industry: "Beauty and personal care", kind: "personal_care_wellness", physicalPresence: "single_location" });
    expect(next.classification?.kind).toBe("personal_care_wellness");
    expect(next.archetype.value).toBe("local_service");
    expect(next.regulatedDomain.isRegulated).toBe(false);
    expect(next.industry.source).toBe("user");
  });

  it("derives markets and scope from a confirmed place without inventing levels", () => {
    let profile = makeProfile({ brandName: "Maison Nine", archetype: "local_service", industry: "Beauty", countries: ["United States"] });
    profile = applyClassificationEdit(profile, { businessType: "Hair salon", kind: "personal_care_wellness", physicalPresence: "single_location" });
    const next = applyLocationEdit(profile, { primary: { neighborhood: "Marina District", city: "Dubai", country: "United Arab Emirates" } });
    expect(next.location?.primary?.countryCode).toBe("AE");
    expect(next.marketScope.value).toBe("hyperlocal");
    expect(next.markets.map((m) => m.name)).toEqual(["Marina District", "Dubai", "United Arab Emirates"]);
    expect(next.geography.countries).toEqual(["United Arab Emirates"]);
    expect(next.location?.needsConfirmation).toBe(false);
  });

  it("keeps the intake hint and the location count through a location correction", () => {
    let profile = makeProfile({ brandName: "Maison Nine", archetype: "local_service", industry: "Beauty" });
    profile = applyClassificationEdit(profile, { businessType: "Hair salon", kind: "personal_care_wellness", physicalPresence: "single_location" });
    profile = applyLocationEdit(profile, { primary: { city: "Dubai", country: "United Arab Emirates" } });
    const operatorHint = { countryCodes: ["AE"], worldwide: false, label: "DIFC, Dubai, United Arab Emirates", outcome: "filled" as const, message: null, websitePlace: null };
    profile.location = { ...profile.location!, operatorHint, locationCount: "one" };
    const next = applyLocationEdit(profile, { primary: { neighborhood: "DIFC", city: "Dubai", country: "United Arab Emirates" } });
    expect(next.location?.operatorHint).toEqual(operatorHint);
    expect(next.location?.locationCount).toBe("one");
    expect(next.location?.source).toBe("user");
  });

  it("keeps an online business's market-first country order, but leads with the place for a place-bound one", () => {
    let online = makeProfile({ brandName: "Ledgerly", archetype: "b2b_saas_enterprise", industry: "Software" });
    online = applyClassificationEdit(online, { businessType: "Accounting software", kind: "b2b_saas_software", physicalPresence: "online_only" });
    const onlineNext = applyLocationEdit(online, { primary: { city: "Dubai", country: "United Arab Emirates" }, countriesServed: ["Saudi Arabia", "KW"] });
    expect(onlineNext.location?.countriesServed).toEqual(["SA", "KW", "AE"]);
    expect(onlineNext.markets[0]).toMatchObject({ name: "Saudi Arabia", isPrimary: true });

    let salon = makeProfile({ brandName: "Maison Nine", archetype: "local_service", industry: "Beauty" });
    salon = applyClassificationEdit(salon, { businessType: "Hair salon", kind: "personal_care_wellness", physicalPresence: "single_location" });
    const salonNext = applyLocationEdit(salon, { primary: { city: "Dubai", country: "United Arab Emirates" }, countriesServed: ["Saudi Arabia"] });
    expect(salonNext.location?.countriesServed).toEqual(["AE", "SA"]);
  });

  it("moves an online business's market to the corrected country when the chips only repeat the detected head office", () => {
    let online = makeProfile({ brandName: "Ledgerly", archetype: "b2b_saas_enterprise", industry: "Software" });
    online = applyClassificationEdit(online, { businessType: "Accounting software", kind: "b2b_saas_software", physicalPresence: "online_only" });
    // Detected without a hint: head office Toronto, so Canada leads the list the editor pre-fills.
    online = applyLocationEdit(online, { primary: { city: "Toronto", country: "Canada" }, countriesServed: ["CA"] });
    const corrected = applyLocationEdit(online, { primary: { city: "Austin", country: "United States" }, countriesServed: ["Canada"] });
    expect(corrected.location?.countriesServed).toEqual(["US", "CA"]);
    expect(corrected.markets[0]).toMatchObject({ name: "United States", isPrimary: true });
    expect(promptGeographyFromProfile(corrected)?.places.filter((p) => p.level === "country").map((p) => p.name)[0]).toBe("United States");

    // The operator's intake country stays first when only the head office is corrected.
    const hinted = structuredClone(online);
    hinted.location = { ...hinted.location!, operatorHint: { countryCodes: ["CA"], worldwide: false, label: "Canada", outcome: "agreed", message: null, websitePlace: null } };
    expect(applyLocationEdit(hinted, { primary: { city: "Austin", country: "United States" }, countriesServed: ["Canada"] }).location?.countriesServed).toEqual(["CA", "US"]);

    // A market list that already leads elsewhere keeps its order.
    const saudi = applyLocationEdit(online, { primary: { city: "Austin", country: "United States" }, countriesServed: ["Saudi Arabia", "Canada"] });
    expect(saudi.location?.countriesServed).toEqual(["SA", "CA", "US"]);
  });
});
