import { describe, expect, it } from "vitest";
import { classifyArchetype, classifyIndustry } from "@/lib/profile/industry-classifier";
import { resolveMarkets } from "@/lib/profile/market-resolver";
import { makeEvidenceSet } from "../../helpers/profile-fixtures";

describe("rules-based fallback for a salon", () => {
  const evidence = makeEvidenceSet([
    { text: "Book your appointment for hair colour, keratin treatment and a luxury pedicure", sourceType: "main_content", fieldHint: "archetype" },
    { text: "Our stylists offer balayage, blow dry and lash extensions", sourceType: "main_content", fieldHint: "offering" },
    { text: "Clinically proven hair treatment products", sourceType: "main_content" },
    { text: "Booking platform: fresha https://www.fresha.com/a/example", sourceType: "url_signal", fieldHint: "archetype" },
    { text: "Commerce affordance: book_appointment", sourceType: "url_signal", fieldHint: "archetype" },
  ]);

  it("is a local service, not healthcare, despite appointment and treatment wording", () => {
    const result = classifyArchetype(evidence, classifyIndustry(evidence), 0);
    expect(result.value).toBe("local_service");
    expect((result.scores.healthcare ?? 0)).toBeLessThan(result.scores.local_service ?? 0);
  });

  it("does not read a theme's en-US tag as a US market, and keeps a salon storefront local", () => {
    const markets = resolveMarkets({
      evidence: makeEvidenceSet([
        { text: "html lang: en-US", sourceType: "meta", fieldHint: "language" },
        { text: "og:locale: en_US", sourceType: "meta", fieldHint: "language" },
        { text: "HairSalon address: DIFC, Dubai, AE", sourceType: "address", fieldHint: "market", pageType: "contact", data: { structured: true, schemaType: "HairSalon", locality: "Dubai", country: "AE" } },
      ]),
      seedUrl: "https://salon.ae/",
      seedHostname: "salon.ae",
    });
    expect(markets.markets.map((m) => m.name)).not.toContain("United States");
    expect(markets.scope.value).toBe("local");
  });

  it("keeps an online retailer or multi-site business national despite one structured store address", () => {
    const markets = resolveMarkets({
      evidence: makeEvidenceSet([
        { text: "ShoeStore address: Bengaluru, IN", sourceType: "address", fieldHint: "market", pageType: "contact", data: { structured: true, schemaType: "ShoeStore", locality: "Bengaluru", country: "IN" } },
        { text: "Commerce affordance: add_to_cart", sourceType: "url_signal", fieldHint: "archetype" },
        { text: "14 stores across Bengaluru, Mumbai and Delhi.", sourceType: "main_content", pageType: "store_locator" },
      ]),
      seedUrl: "https://stride.in/",
      seedHostname: "stride.in",
    });
    expect(markets.scope.value).not.toBe("local");
  });

  // Review 2026-09-14: the multi-site guard fired on ordinary storefront pages
  // and made a single DIFC salon "national", losing Dubai and its local tiers.
  describe("single-storefront guard", () => {
    const salonAddress = { text: "HairSalon address: Gate Building, DIFC, Dubai, AE", sourceType: "address" as const, fieldHint: "market" as const, pageType: "contact" as const, data: { structured: true, schemaType: "HairSalon", locality: "Dubai", country: "AE" } };
    const salon = (extra: Parameters<typeof makeEvidenceSet>[0]) =>
      resolveMarkets({ evidence: makeEvidenceSet([salonAddress, ...extra]), seedUrl: "https://salon.ae/", seedHostname: "salon.ae" });
    const retailer = (extra: Parameters<typeof makeEvidenceSet>[0]) =>
      resolveMarkets({
        evidence: makeEvidenceSet([
          { text: "ShoeStore address: Bengaluru, IN", sourceType: "address", fieldHint: "market", pageType: "contact", data: { structured: true, schemaType: "ShoeStore", locality: "Bengaluru", country: "IN" } },
          ...extra,
        ]),
        seedUrl: "https://stride.in/",
        seedHostname: "stride.in",
      });

    it("keeps a salon with a /location page and a Shop now button local", () => {
      const markets = salon([
        { text: "HairSalon address: Gate Building, DIFC, Dubai, AE", sourceType: "address", fieldHint: "market", pageType: "store_locator", url: "https://salon.ae/location", data: { structured: true, schemaType: "HairSalon", locality: "Dubai", country: "AE" } },
        { text: "Commerce affordance: add_to_cart", sourceType: "url_signal", fieldHint: "archetype" },
        { text: "Commerce affordance: find_location", sourceType: "url_signal", fieldHint: "archetype" },
      ]);
      expect(markets.scope.value).toBe("local");
      expect(markets.markets.map((m) => m.name)).toEqual(expect.arrayContaining(["United Arab Emirates", "Dubai"]));
    });

    it("does not read clients across a city, 'our salons', award copy or opening hours as multi-site", () => {
      const markets = salon([
        { text: "Loved by clients across Dubai and the UAE for balayage and brows.", sourceType: "main_content" },
        { text: "Our salons use only vegan colour. Voted one of the top 10 salons in Dubai.", sourceType: "main_content" },
        { text: "Open 7 days, with 24/7 clinics booking online.", sourceType: "main_content" },
      ]);
      expect(markets.scope.value).toBe("local");
      expect(markets.markets.map((m) => m.name)).toContain("Dubai");
    });

    it("still treats an explicit store locator URL as multi-site", () => {
      const markets = salon([{ text: "Find a salon near you", sourceType: "main_content", pageType: "store_locator", url: "https://salon.ae/find-a-location" }]);
      expect(markets.scope.value).not.toBe("local");
    });

    it("keeps an online retailer with '14 stores across' non-local, from the count alone", () => {
      expect(retailer([{ text: "14 stores across Bengaluru, Mumbai and Delhi.", sourceType: "main_content", pageType: "about" }]).scope.value).not.toBe("local");
      expect(retailer([{ text: "We serve every state through our online store and 14 retail stores.", sourceType: "main_content" }]).scope.value).not.toBe("local");
    });

    it("counts number words and country-wide customers, not a single site", () => {
      expect(retailer([{ text: "All three hospitals are NABH accredited.", sourceType: "main_content" }]).scope.value).not.toBe("local");
      expect(retailer([{ text: "Serving customers across India since 1998.", sourceType: "main_content" }]).scope.value).not.toBe("local");
      expect(retailer([{ text: "Visit our one store in Indiranagar.", sourceType: "main_content" }]).scope.value).toBe("local");
      expect(retailer([{ text: "Our 1 store is open daily.", sourceType: "main_content" }]).scope.value).toBe("local");
    });
  });
});
