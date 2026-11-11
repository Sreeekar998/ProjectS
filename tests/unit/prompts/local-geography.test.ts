import { describe, expect, it } from "vitest";
import { placesMentioned, placesToLocations, promptGeographyFromProfile } from "@/lib/prompts/geography";
import { choiceUnitForProfile } from "@/lib/prompts/choice-unit";
import { discoveryPlaces } from "@/lib/prompts/discovery";
import { validateCandidate } from "@/lib/prompts/validators";
import type { CandidatePromptDraft } from "@/lib/prompts/types";
import { applyClassificationEdit, applyLocationEdit } from "@/lib/understanding/edits";
import { makeProfile } from "../../helpers/profile-fixtures";

function localSalon() {
  let profile = makeProfile({ brandName: "Maison Nine Salon", archetype: "local_service", industry: "Beauty", domain: "maisonnine.ae" });
  profile = applyClassificationEdit(profile, { businessType: "Hair salon", kind: "personal_care_wellness", physicalPresence: "single_location" });
  profile = applyLocationEdit(profile, { primary: { neighborhood: "DIFC", city: "Dubai", country: "United Arab Emirates" }, nearbyAreas: ["Business Bay"], marketScope: "local" });
  return profile;
}

function draft(text: string, section: CandidatePromptDraft["section"] = "Discovery"): CandidatePromptDraft {
  return { text, cohort: "neutral_discovery", section, intent: "recommend", journeyStage: "awareness", topicId: null, persona: null, useCaseConstraint: null, evaluationCriterion: null, competitorEntityId: null, sentimentTheme: null, geographyScope: "none", geographyText: null, locationId: null, language: "en", brandPolicy: section === "Discovery" ? "TARGET_FORBIDDEN" : "TARGET_REQUIRED", coverageCellKey: "k", evidenceBasis: [], contextBasis: [], generationMethod: "model" };
}

describe("prompt geography for a local business", () => {
  const profile = localSalon();
  const geography = promptGeographyFromProfile(profile)!;
  const locations = placesToLocations("prj", geography.places);

  it("offers neighbourhood, nearby area and city, never the country", () => {
    expect(geography.placeBound).toBe(true);
    expect(geography.places.map((p) => `${p.level}:${p.name}`)).toEqual(["neighborhood:DIFC", "neighborhood:Business Bay", "city:Dubai"]);
  });

  it("gives every Discovery slot a place, the city most, and mixes levels", () => {
    const { places, placeEvery } = discoveryPlaces(locations, { placeBound: true, scope: "local" });
    expect(placeEvery).toBe(1);
    const counts = new Map<string, number>();
    for (const place of places) counts.set(place.say, (counts.get(place.say) ?? 0) + 1);
    expect([...counts.keys()].sort()).toEqual(["Business Bay", "DIFC", "Dubai"]);
    expect(counts.get("Dubai")!).toBeGreaterThan(counts.get("Business Bay")!);
    expect(places[0]!.say).not.toBe(places[1]!.say);
  });

  it("gives a national chain the country, not its head-office district", () => {
    let chain = makeProfile({ brandName: "Bakehouse", archetype: "multi_location_chain", industry: "Food" });
    chain = applyClassificationEdit(chain, { businessType: "Bakery chain", kind: "restaurant_food_beverage", physicalPresence: "multi_location" });
    chain = applyLocationEdit(chain, { primary: { neighborhood: "Quorum Business Park", city: "Newcastle upon Tyne", country: "United Kingdom" }, marketScope: "national" });
    chain.location!.primaryRole = "headquarters";
    expect(promptGeographyFromProfile(chain)!.places.map((p) => p.name)).toEqual(["United Kingdom"]);
  });

  it("gives a multi-country restaurant group its venue city and areas in the chosen market, never a country", () => {
    // REIF Japanese Kushiyaki: venues in Dubai and Cairo, market chosen UAE.
    // Its Discovery prompts once read "best kushiyaki restaurants in the UAE"
    // and "best wagyu sando restaurants in Egypt".
    let group = makeProfile({ brandName: "REIF Japanese Kushiyaki", archetype: "restaurant_food_chain", industry: "Food" });
    group = applyClassificationEdit(group, { businessType: "Japanese restaurant group", kind: "restaurant_food_beverage", physicalPresence: "multi_location" });
    group = applyLocationEdit(group, { primary: { neighborhood: "Mirdif", city: "Dubai", country: "United Arab Emirates" }, countriesServed: ["United Arab Emirates", "Egypt"], marketScope: "international" });
    const branch = (neighborhood: string, city: string, country: string, countryCode: string) => ({ ...group.location!.primary!, label: `${neighborhood}, ${city}`, neighborhood, city, country, countryCode });
    group.location!.branches = [branch("Dar Wasl", "Dubai", "United Arab Emirates", "AE"), branch("Downtown Dubai", "Dubai", "United Arab Emirates", "AE"), branch("New Cairo", "Cairo", "Egypt", "EG")];
    const geo = promptGeographyFromProfile(group)!;
    const names = geo.places.map((place) => place.name);
    expect(names).toContain("Dubai");
    expect(names).toContain("Dar Wasl");
    expect(names).not.toContain("Cairo");
    expect(names).not.toContain("New Cairo");
    expect(geo.places.some((place) => place.level === "country")).toBe(false);
  });

  it("names the country on two slots in three for a national online business, as people write it", () => {
    const countryOnly = placesToLocations("prj", [{ name: "United Arab Emirates", level: "country", countryCode: "AE", role: "primary" }]);
    const { places, placeEvery } = discoveryPlaces(countryOnly, { placeBound: false, scope: "national" });
    expect(placeEvery).toBe(1.5);
    expect(places.map((place) => place.say)).toEqual(["the UAE"]);
  });

  it("names an online business's market country, not its head-office country", () => {
    let software = makeProfile({ brandName: "Ledgerly", archetype: "b2b_saas_enterprise", industry: "Software" });
    software = applyClassificationEdit(software, { businessType: "Accounting software", kind: "b2b_saas_software", physicalPresence: "online_only" });
    software = applyLocationEdit(software, { primary: { city: "Dubai", country: "United Arab Emirates" }, countriesServed: ["Saudi Arabia"], marketScope: "national" });
    const places = promptGeographyFromProfile(software)!.places;
    expect(places.map((p) => `${p.level}:${p.name}:${p.role}`)).toEqual(["country:Saudi Arabia:primary"]);
  });

  it("asks which salon to go to, not which clinic", () => {
    const choice = choiceUnitForProfile(profile);
    expect(choice.unit).toMatch(/hair salons/);
    expect(`${choice.unit} ${choice.ask}`).not.toMatch(/clinic|doctor|hospital/);
  });

  it("finds the places a prompt names, longest first", () => {
    expect(placesMentioned("Which salon near Business Bay does balayage?", locations).map((l) => l.name)).toEqual(["Business Bay"]);
  });

  it("rejects stacked places and country-level Discovery asks", () => {
    const ctx = { profile, forbiddenTerms: ["maison nine salon"], approvedLocations: locations, placeBound: true };
    expect(validateCandidate(draft("Which hair salon in DIFC, Dubai, UAE is best for balayage?"), ctx).code).toBe("geography_stacked");
    expect(validateCandidate(draft("Which hair salon in the United Arab Emirates is best for balayage?"), ctx).code).toBe("geography_too_broad");
    expect(validateCandidate({ ...draft("Which hair salon in DIFC is best for balayage?"), geographyScope: "neighborhood", geographyText: "DIFC" }, ctx).pass).toBe(true);
  });

  it("does not treat a city-state's city as a stacked country", () => {
    const places = placesToLocations("prj", [{ name: "Orchard", level: "neighborhood", countryCode: "SG", role: "primary" }, { name: "Singapore", level: "city", countryCode: "SG", role: "primary" }]);
    const ctx = { profile, forbiddenTerms: ["maison nine salon"], approvedLocations: places, placeBound: true };
    expect(validateCandidate({ ...draft("Which dental clinic in Singapore does implants?"), geographyScope: "city", geographyText: "Singapore" }, ctx).pass).toBe(true);
  });

  it("accepts the spoken short form of the brand in branded prompts", () => {
    const ctx = { profile, forbiddenTerms: ["maison nine salon"], approvedLocations: locations, placeBound: true };
    expect(validateCandidate({ ...draft("Is Maison Nine good for balayage?", "Sentiment Analysis"), cohort: "branded_accuracy", sentimentTheme: "colour results" }, ctx).pass).toBe(true);
  });
});
