import { describe, expect, it } from "vitest";
import {
  budgetCap,
  discoveryPlaces,
  discoveryVerdictScore,
  mentionsPlace,
  parseWrittenDiscovery,
  placeUsedAsAdjective,
  planDiscoverySlots,
  spokenPlace,
  type DiscoveryPlace,
  type DiscoveryVerdict,
} from "@/lib/prompts/discovery";
import { placesToLocations } from "@/lib/prompts/geography";
import type { PromptIntentModel } from "@/lib/prompts/intent-model";

const need = (category: string, budgetHint: string | null = null) => ({ category, synonyms: [], situations: ["my old pair wore out"], attributes: [], audiences: ["beginners"], budgetHint, topicId: null });
const model = {
  version: "intent-model@4",
  primaryMarket: null,
  vocabularySize: 10,
  concerns: [],
  decisionFactors: [],
  needs: [need("running shoes", "under $150"), need("yoga pants", "under $80"), need("gym bags", "under $60"), need("hiking boots")],
} as unknown as PromptIntentModel;

const US = placesToLocations("prj", [{ name: "United States", level: "country", countryCode: "US", role: "primary" }, { name: "India", level: "country", countryCode: "IN", role: "served" }]);

describe("Discovery slots", () => {
  it("gives every need a bare ask and a context ask, and every other need a situation-first ask", () => {
    const slots = planDiscoverySlots(model, [], { placeBound: false, scope: "global" }, "US");
    expect(slots.filter((slot) => slot.needIndex === 0).map((slot) => slot.shape)).toEqual(["bare", "context", "situation"]);
    expect(slots.filter((slot) => slot.needIndex === 1).map((slot) => slot.shape)).toEqual(["bare", "context"]);
    expect(slots.map((slot) => slot.slotIndex)).toEqual(slots.map((_, index) => index));
    expect(slots.every((slot) => slot.styles[0] !== slot.styles[1])).toBe(true);
  });

  // "Help me find a DIFC colourist within AED 800–2,500": price ranges on
  // most needs made money the story of the section.
  it("lets at most two context slots mention money, as one cap, never for another country", () => {
    const slots = planDiscoverySlots(model, US, { placeBound: false, scope: "international" }, "US");
    const priced = slots.filter((slot) => slot.budget);
    expect(priced.length).toBeLessThanOrEqual(2);
    expect(priced.every((slot) => slot.shape === "context" && (!slot.place || slot.place.countryCode === "US"))).toBe(true);
  });

  it("asks a place people visit for a price word, not a number", () => {
    const city = placesToLocations("prj", [{ name: "Leeds", level: "city", countryCode: "GB", role: "primary" }]);
    const slots = planDiscoverySlots(model, city, { placeBound: true, scope: "local" }, "GB");
    expect(slots.every((slot) => slot.place?.say === "Leeds")).toBe(true);
    expect(slots.filter((slot) => slot.budget).every((slot) => /price word/.test(slot.budget!))).toBe(true);
  });

  // A restaurant's set came back with three of ten prompts about buying its gift vouchers.
  it("never plans slots for side sales such as gift vouchers or merchandise", () => {
    const withSides = { ...model, needs: [need("restaurant gift vouchers"), need("dry-aged steak"), need("branded t-shirts"), need("private dining")] } as unknown as PromptIntentModel;
    const slots = planDiscoverySlots(withSides, [], { placeBound: false, scope: "global" }, null);
    expect([...new Set(slots.map((slot) => slot.needIndex))]).toEqual([1, 3]);
  });

  it("never asks about price for a premium or luxury business", () => {
    const slots = planDiscoverySlots(model, [], { placeBound: false, scope: "global" }, "US", "luxury");
    expect(slots.some((slot) => slot.budget)).toBe(false);
  });

  it("reads a budget as one cap and drops ranges and sentences", () => {
    expect(budgetCap("under $50 a month")).toBe("under $50 a month");
    expect(budgetCap("under AED 300")).toBe("under AED 300");
    expect(budgetCap("AED 800–2,500")).toBeNull();
    expect(budgetCap("Typically $150–$1,500 for repairs")).toBeNull();
    expect(budgetCap(null)).toBeNull();
  });
});

describe("Discovery places", () => {
  it("keeps the area people say and drops landmarks and addresses the site mentions", () => {
    expect(spokenPlace("KHB Colony, 7th Block, Koramangala", "primary")).toBe("Koramangala");
    expect(spokenPlace("Regent Hotel", "nearby")).toBeNull();
    expect(spokenPlace("next to Corner House", "nearby")).toBeNull();
    expect(spokenPlace("Quorum Business Park", "primary")).toBeNull();
    expect(spokenPlace("Park Slope", "nearby")).toBe("Park Slope");
  });

  it("never hands out a landmark as a place", () => {
    const locations = placesToLocations("prj", [
      { name: "Orchard", level: "neighborhood", countryCode: "SG", role: "primary" },
      { name: "Hotel Jen", level: "neighborhood", countryCode: "SG", role: "nearby" },
      { name: "Singapore", level: "city", countryCode: "SG", role: "primary" },
    ]);
    const { places } = discoveryPlaces(locations, { placeBound: true, scope: "local" });
    expect(new Set(places.map((place) => place.say))).toEqual(new Set(["Orchard", "Singapore"]));
  });

  it("accepts the ways people write a country, and rejects a place used as an adjective", () => {
    const uae: DiscoveryPlace = { locationName: "United Arab Emirates", level: "country", say: "the UAE", countryCode: "AE", role: "country" };
    expect(mentionsPlace("best corporate cards in the UAE", uae)).toBe(true);
    expect(mentionsPlace("corporate card for a uae startup", uae)).toBe(true);
    const leeds: DiscoveryPlace = { locationName: "Leeds", level: "city", say: "Leeds", countryCode: "GB", role: "primary" };
    expect(placeUsedAsAdjective("Which Leeds salon does balayage?", leeds)).toBe(true);
    expect(placeUsedAsAdjective("best salons in Leeds for balayage", leeds)).toBe(false);
    expect(placeUsedAsAdjective("show me Leeds salons for extensions", leeds)).toBe(true);
    expect(placeUsedAsAdjective("best boiler repair Leeds", leeds)).toBe(false);
    expect(placeUsedAsAdjective("Leeds salons that do balayage", leeds)).toBe(true);
    expect(placeUsedAsAdjective("which salons around Leeds do balayage", leeds)).toBe(false);
  });
});

describe("written Discovery prompts", () => {
  const leeds: DiscoveryPlace = { locationName: "Leeds", level: "city", say: "Leeds", countryCode: "GB", role: "primary" };
  const slots = [
    { slotIndex: 0, needIndex: 0, shape: "bare" as const, styles: ["search", "question"] as ["search", "question"], place: leeds, budget: null },
  ];

  it("keeps each style once, with the slot's place and no money it was not given", () => {
    const written = parseWrittenDiscovery(
      {
        prompts: [
          { slotIndex: 0, style: "search", text: "best running shops in leeds" },
          { slotIndex: 0, style: "search", text: "good running shops in leeds" },
          { slotIndex: 0, style: "question", text: "Which running shops do people like?" },
          { slotIndex: 0, style: "question", text: "What running shops in Leeds do fittings under £20?" },
          { slotIndex: 0, style: "request", text: "find me a running shop in Leeds" },
        ],
      },
      slots,
      "openai:test",
    );
    expect(written.map((prompt) => prompt.text)).toEqual(["best running shops in leeds"]);
  });

  it("drops a place written as an adjective", () => {
    expect(parseWrittenDiscovery({ prompts: [{ slotIndex: 0, style: "question", text: "Which Leeds running shop is best?" }] }, slots, "m")).toHaveLength(0);
  });
});

describe("Discovery verdicts", () => {
  const pass: DiscoveryVerdict = { asksForOptions: true, realCategory: true, offered: true, severalCouldAnswer: true, echoesClaim: false, assembled: false, readsReal: true, pointsAtOne: false, giveaway: "" };

  it("scores a prompt that passes every check above the selection floor and any failure below it", () => {
    expect(discoveryVerdictScore(pass).total).toBeGreaterThanOrEqual(55);
    for (const failure of [{ echoesClaim: true }, { assembled: true }, { readsReal: false }, { asksForOptions: false }, { pointsAtOne: true }, { offered: false }, { severalCouldAnswer: false }]) {
      const scored = discoveryVerdictScore({ ...pass, ...failure });
      expect(scored.total).toBeLessThan(55);
      expect(scored.failed).toBeTruthy();
    }
  });
});
