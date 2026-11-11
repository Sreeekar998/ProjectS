import { describe, expect, it } from "vitest";
import { scoreCompetitors, scorePrompts, scoreUnderstanding, type GoldenExpect } from "../../../benchmarks/onboarding/score";

const salon: GoldenExpect = { brand: ["Maison Nine"], kinds: ["personal_care_wellness"], city: ["Dubai"], area: ["DIFC"], country: "AE", scopes: ["hyperlocal", "local"], placeBound: true, healthcareWordsAllowed: false };

describe("onboarding golden scoring", () => {
  it("fails the demo regression: healthcare, US market", () => {
    const checks = scoreUnderstanding(salon, { brand: "maison nine wordmark cream", aliases: [], kind: "healthcare_medical", path: ["Healthcare"], archetype: "healthcare", regulated: ["healthcare"], location: { neighborhood: null, district: null, city: null, region: null, countryCode: "US", formattedAddress: null }, nearbyAreas: [], scope: "multi-country", offeringCount: 2, audienceCount: 0, descriptionLength: 40, synthesisMode: "llm_grounded" });
    const failed = checks.filter((c) => !c.pass).map((c) => c.name);
    expect(failed).toEqual(expect.arrayContaining(["business kind", "not healthcare", "country", "city", "neighbourhood/area", "market scope"]));
  });

  it("matches researched rivals by domain or name", () => {
    const checks = scoreCompetitors([{ name: "Salon Alpha (Tower 2)", url: "https://salonalpha.example/" }, { name: "Beta Beauty" }], [
      { name: "Salon Alpha", domain: "salonalpha.example", status: "candidate", type: "direct", rejectionReason: null },
      { name: "Beta Beauty DIFC", domain: null, status: "removed", type: "direct", rejectionReason: "x" },
    ], "Maison Nine");
    expect(checks.find((c) => c.name === "researched rivals suggested")?.observed).toMatch(/^1\/2/);
  });

  it("flags clinic wording and unplaced local Discovery prompts", () => {
    const prompts = [
      ...Array.from({ length: 10 }, (_, i) => ({ section: "Discovery", text: i === 0 ? "Which clinic in Dubai does facials?" : `Which salon in DIFC is good for style ${i}?`, geographyScope: i < 5 ? "neighborhood" : "none", geographyText: i < 5 ? "DIFC" : null })),
      ...Array.from({ length: 10 }, (_, i) => ({ section: "Trade Offs", text: `Maison Nine or Salon Alpha for option ${i}?`, geographyScope: "none", geographyText: null })),
      ...Array.from({ length: 10 }, (_, i) => ({ section: "Sentiment Analysis", text: `Is Maison Nine reliable for thing ${i}?`, geographyScope: "none", geographyText: null })),
    ];
    const checks = scorePrompts(salon, prompts, ["Maison Nine"]);
    expect(checks.find((c) => c.name === "no clinic/doctor wording")?.pass).toBe(false);
    expect(checks.find((c) => c.name === "discovery names a place")?.pass).toBe(false);
    expect(checks.find((c) => c.name === "10/10/10")?.pass).toBe(true);
  });
});
