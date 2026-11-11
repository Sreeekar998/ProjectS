import { describe, it, expect } from "vitest";
import { resolveIdentity } from "@/lib/profile/identity-resolver";
import { normalizeOfferingName, resolveOfferings, singularize, titleCase } from "@/lib/profile/offering-resolver";
import { resolveMarkets } from "@/lib/profile/market-resolver";
import { resolveBrandIdentity, resolveTargetAudience } from "@/lib/profile/identity-traits";
import { classifyArchetype, classifyIndustry } from "@/lib/profile/industry-classifier";
import { computeConfidence } from "@/lib/profile/confidence";
import { makeEvidenceSet } from "../../helpers/profile-fixtures";

describe("resolveIdentity", () => {
  it("prefers an Organization schema name over the domain", () => {
    const evidence = makeEvidenceSet([
      { text: "Organization name: Basil & Vine Trattoria", sourceType: "jsonld", fieldHint: "brand_name" },
      { text: "Page title: Home | basilvine", sourceType: "meta", fieldHint: "brand_name" },
    ]);
    const result = resolveIdentity(evidence, "basilvine.com");
    expect(result.brandName.value).toBe("Basil & Vine Trattoria");
    expect(result.brandName.source).toBe("evidence");
    expect(result.brandName.evidenceIds.length).toBeGreaterThan(0);
  });

  it("uses og:site_name when there is no Organization schema", () => {
    const evidence = makeEvidenceSet([{ text: "og:site_name: Crestline Motors", sourceType: "meta", fieldHint: "brand_name" }]);
    expect(resolveIdentity(evidence, "crestlinemotors.com").brandName.value).toBe("Crestline Motors");
  });

  it("picks the title segment that repeats across pages", () => {
    const evidence = makeEvidenceSet([
      { text: "Page title: Running Shoes | Stride Athletics", sourceType: "meta", fieldHint: "brand_name", pageType: "category", crawlPageId: "p1" },
      { text: "Page title: About Us | Stride Athletics", sourceType: "meta", fieldHint: "brand_name", pageType: "about", crawlPageId: "p2" },
      { text: "Page title: Contact | Stride Athletics", sourceType: "meta", fieldHint: "brand_name", pageType: "contact", crawlPageId: "p3" },
    ]);
    expect(resolveIdentity(evidence, "strideathletics.com").brandName.value).toBe("Stride Athletics");
  });

  it("falls back to the domain only when nothing else exists, and says so", () => {
    const result = resolveIdentity([], "hdfcbank.com");
    expect(result.brandName.source).toBe("inferred_needs_review");
    expect(result.brandName.confidence).toBeLessThan(40);
  });

  it("does not treat the capitalized domain as an evidence-backed name", () => {
    const result = resolveIdentity([], "bookmyshow.com");
    expect(result.brandName.source).not.toBe("evidence");
  });

  it("captures alternateName values as aliases, not as the brand name", () => {
    const evidence = makeEvidenceSet([
      { text: "Organization name: International Business Machines", sourceType: "jsonld", fieldHint: "brand_name" },
      { text: "Organization alternateName: Big Blue", sourceType: "jsonld", fieldHint: "brand_alias" },
    ]);
    const result = resolveIdentity(evidence, "ibm.com");
    expect(result.brandName.value).toBe("International Business Machines");
    expect(result.aliases.values).toContain("Big Blue");
  });
});

describe("offering normalization", () => {
  it("singularizes common plural forms", () => {
    expect(singularize("shoes")).toBe("shoe");
    expect(singularize("categories")).toBe("category");
    expect(singularize("watches")).toBe("watch");
    expect(singularize("bus")).toBe("bus");
  });

  it("normalizes punctuation and case for comparison", () => {
    expect(normalizeOfferingName("Running Shoes!")).toBe(normalizeOfferingName("running shoe"));
  });

  it("title-cases without capitalizing small words", () => {
    expect(titleCase("shoes and apparel")).toBe("Shoes and Apparel");
  });
});

describe("resolveOfferings", () => {
  it("returns business categories, not SKU or model names", () => {
    const evidence = makeEvidenceSet([
      { text: "Primary nav: Running", sourceType: "navigation", fieldHint: "offering", pageType: "home", crawlPageId: "p1" },
      { text: "Primary nav: Basketball", sourceType: "navigation", fieldHint: "offering", pageType: "home", crawlPageId: "p1" },
      { text: "Primary nav: Training", sourceType: "navigation", fieldHint: "offering", pageType: "home", crawlPageId: "p1" },
      { text: "Breadcrumb: Home > Running > Shoes", sourceType: "breadcrumb", fieldHint: "offering", pageType: "category", crawlPageId: "p2" },
      { text: "Listing item: Pegasus 41", sourceType: "list_item", fieldHint: "offering", pageType: "category", crawlPageId: "p2" },
      { text: "Listing item: Vomero 18", sourceType: "list_item", fieldHint: "offering", pageType: "category", crawlPageId: "p2" },
      { text: "Listing item: Structure 25", sourceType: "list_item", fieldHint: "offering", pageType: "category", crawlPageId: "p2" },
      { text: "H2: Running Shoes", sourceType: "heading", fieldHint: "offering", pageType: "product_index", crawlPageId: "p3" },
    ]);
    const { offerings } = resolveOfferings(evidence);
    const names = offerings.map((o) => o.name.toLowerCase());
    expect(names.some((n) => n.includes("running"))).toBe(true);
    // Single-page model names must not crowd out the categories.
    expect(names).not.toContain("pegasus 41");
    expect(names).not.toContain("vomero 18");
  });

  it("rejects generic navigation labels", () => {
    const evidence = makeEvidenceSet([
      { text: "Primary nav: Products", sourceType: "navigation", fieldHint: "offering" },
      { text: "Primary nav: About Us", sourceType: "navigation", fieldHint: "offering" },
      { text: "Primary nav: Contact", sourceType: "navigation", fieldHint: "offering" },
      { text: "Primary nav: Cardiology", sourceType: "navigation", fieldHint: "offering" },
      { text: "Primary nav: Orthopaedics", sourceType: "navigation", fieldHint: "offering" },
    ]);
    const names = resolveOfferings(evidence).offerings.map((o) => o.name.toLowerCase());
    expect(names).not.toContain("products");
    expect(names).not.toContain("about us");
    expect(names).not.toContain("contact");
    expect(names).toContain("cardiology");
  });

  it("consolidates a category and its qualified variants into one offering", () => {
    const evidence = makeEvidenceSet([
      { text: "H2: Running Shoes", sourceType: "heading", fieldHint: "offering", pageType: "product_index", crawlPageId: "p1" },
      { text: "H2: Men's Running Shoes", sourceType: "heading", fieldHint: "offering", pageType: "category", crawlPageId: "p2" },
      { text: "H2: Women's Running Shoes", sourceType: "heading", fieldHint: "offering", pageType: "category", crawlPageId: "p3" },
    ]);
    const offerings = resolveOfferings(evidence).offerings;
    const running = offerings.filter((o) => o.name.toLowerCase().includes("running"));
    expect(running).toHaveLength(1);
    expect(running[0]?.pageCount).toBeGreaterThanOrEqual(2);
  });

  it("gives every offering supporting evidence ids", () => {
    const evidence = makeEvidenceSet([
      { text: "Service: Cardiology", sourceType: "jsonld", fieldHint: "offering", pageType: "service_index" },
      { text: "Service: Oncology", sourceType: "jsonld", fieldHint: "offering", pageType: "service_index" },
    ]);
    for (const offering of resolveOfferings(evidence).offerings) {
      expect(offering.evidenceIds.length).toBeGreaterThan(0);
    }
  });

  it("returns nothing rather than guessing when there is no offering evidence", () => {
    expect(resolveOfferings([]).offerings).toEqual([]);
  });
});

describe("resolveMarkets", () => {
  it("reads the market from a ccTLD storefront", () => {
    const result = resolveMarkets({ evidence: [], seedHostname: "www.nike.in", seedUrl: "https://www.nike.in/" });
    expect(result.markets[0]?.name).toBe("India");
    expect(result.markets[0]?.countryCode).toBe("IN");
  });

  it("reads the market from a locale path segment", () => {
    const result = resolveMarkets({ evidence: [], seedHostname: "www.example.com", seedUrl: "https://www.example.com/gb/shop" });
    expect(result.markets[0]?.countryCode).toBe("GB");
  });

  it("does not treat a .com domain as the United States", () => {
    const result = resolveMarkets({ evidence: [], seedHostname: "www.example.com", seedUrl: "https://www.example.com/" });
    expect(result.markets).toHaveLength(0);
    expect(result.scope.value).toBe("unknown");
  });

  it("does not treat an English-language site as a US or UK market", () => {
    const evidence = makeEvidenceSet([{ text: "html lang: en", sourceType: "hreflang", fieldHint: "language" }]);
    const result = resolveMarkets({ evidence, seedHostname: "example.ae", seedUrl: "https://example.ae/" });
    expect(result.markets.map((m) => m.countryCode)).not.toContain("US");
    expect(result.markets[0]?.countryCode).toBe("AE");
  });

  it("does not promote a headquarters mention to the primary market", () => {
    const evidence = makeEvidenceSet([
      { text: "We are headquartered in San Francisco, United States.", sourceType: "main_content", fieldHint: "market", pageType: "about", crawlPageId: "p1" },
      { text: "Organization areaServed: India", sourceType: "jsonld", fieldHint: "market", pageType: "home", crawlPageId: "p2" },
    ]);
    const result = resolveMarkets({ evidence, seedHostname: "example.com", seedUrl: "https://example.com/" });
    expect(result.markets[0]?.name).toBe("India");
  });

  it("infers a global scope from an explicit worldwide statement", () => {
    const evidence = makeEvidenceSet([
      { text: "We ship worldwide to customers in over 40 countries.", sourceType: "main_content", fieldHint: "market", pageType: "home" },
    ]);
    expect(resolveMarkets({ evidence, seedHostname: "example.com", seedUrl: "https://example.com/" }).scope.value).toBe("global");
  });

  it("infers a local scope from a single city address", () => {
    const evidence = makeEvidenceSet([
      { text: "MedicalClinic address: Bengaluru, KA, IN", sourceType: "address", fieldHint: "market", pageType: "contact", data: { locality: "Bengaluru", region: "KA", country: "IN" } },
    ]);
    const result = resolveMarkets({ evidence, seedHostname: "clinic.example", seedUrl: "https://clinic.example/" });
    expect(result.cities).toContain("Bengaluru");
    expect(["local", "national"]).toContain(result.scope.value);
  });

  it("infers multi-country scope from a broad hreflang set", () => {
    const evidence = makeEvidenceSet([
      { text: "hreflang en-gb -> https://example.com/gb", sourceType: "hreflang", fieldHint: "market" },
      { text: "hreflang fr-fr -> https://example.com/fr", sourceType: "hreflang", fieldHint: "market" },
      { text: "hreflang de-de -> https://example.com/de", sourceType: "hreflang", fieldHint: "market" },
    ]);
    const result = resolveMarkets({ evidence, seedHostname: "example.com", seedUrl: "https://example.com/" });
    expect(["multi-country", "global"]).toContain(result.scope.value);
  });

  it("ignores an ambiguous shared currency", () => {
    const evidence = makeEvidenceSet([{ text: "Currency: EUR 49", sourceType: "currency", fieldHint: "market" }]);
    const result = resolveMarkets({ evidence, seedHostname: "example.com", seedUrl: "https://example.com/" });
    // EUR maps to a dozen countries; it must not name a single market.
    expect(result.markets).toHaveLength(0);
  });

  it("warns rather than inventing a market when there is no evidence", () => {
    const result = resolveMarkets({ evidence: [], seedHostname: "example.com", seedUrl: "https://example.com/" });
    expect(result.warnings.join(" ")).toMatch(/no market evidence/i);
  });
});

describe("resolveBrandIdentity", () => {
  it("rejects traits that could describe any company", () => {
    const evidence = makeEvidenceSet([
      { text: "We are an innovative, trusted, customer-focused company delivering high quality.", sourceType: "main_content", pageType: "about" },
    ]);
    expect(resolveBrandIdentity(evidence)).toHaveLength(0);
  });

  it("extracts a specific, evidenced trait", () => {
    const evidence = makeEvidenceSet([
      { text: "Every shoe is made from recycled materials with a carbon-neutral supply chain.", sourceType: "main_content", pageType: "about", crawlPageId: "p1" },
      { text: "Our sustainable manufacturing uses only ethically sourced inputs.", sourceType: "main_content", pageType: "home", crawlPageId: "p2" },
    ]);
    const traits = resolveBrandIdentity(evidence);
    expect(traits.map((t) => t.value)).toContain("Sustainable");
    expect(traits[0]?.evidenceIds.length).toBeGreaterThan(0);
  });

  it("flags a single-page trait for review instead of adopting it", () => {
    const evidence = makeEvidenceSet([
      { text: "Our eco-friendly studio uses recycled flooring.", sourceType: "main_content", pageType: "about", crawlPageId: "only-page" },
    ]);
    const trait = resolveBrandIdentity(evidence).find((t) => t.value === "Sustainable");
    expect(trait?.needsCheck).toBe(true);
    expect(trait?.confidence).toBeLessThan(50);
  });

  it("does not let two conflicting traits both win", () => {
    const evidence = makeEvidenceSet([
      { text: "Our premium, luxury finishes are the finest available.", sourceType: "main_content", pageType: "about", crawlPageId: "p1" },
      { text: "A premium luxury experience throughout.", sourceType: "main_content", pageType: "home", crawlPageId: "p2" },
      { text: "The most affordable, budget-friendly option.", sourceType: "main_content", pageType: "product_index", crawlPageId: "p3" },
    ]);
    const values = resolveBrandIdentity(evidence).map((t) => t.value);
    expect(values.includes("Premium") && values.includes("Affordable")).toBe(false);
  });
});

describe("resolveTargetAudience", () => {
  it("only counts audience words in a for/built-for framing", () => {
    const evidence = makeEvidenceSet([
      { text: "Built for enterprises with complex approval chains.", sourceType: "main_content", pageType: "home", crawlPageId: "p1" },
      { text: "Enterprises are mentioned incidentally in this blog post.", sourceType: "main_content", pageType: "editorial", crawlPageId: "p2" },
    ]);
    const audiences = resolveTargetAudience(evidence);
    expect(audiences.map((a) => a.value)).toContain("Enterprises");
    expect(audiences[0]?.evidenceIds.length).toBeGreaterThan(0);
  });

  it("returns nothing when the site never states an audience", () => {
    const evidence = makeEvidenceSet([{ text: "Our warehouse is open Monday to Friday.", sourceType: "main_content" }]);
    expect(resolveTargetAudience(evidence)).toEqual([]);
  });
});

describe("classifyIndustry", () => {
  it("pins a category from a decisive Schema.org type", () => {
    const evidence = makeEvidenceSet([{ text: "Declared schema type: Restaurant", sourceType: "jsonld", fieldHint: "industry" }]);
    const result = classifyIndustry(evidence);
    expect(result.taxonomyId).toBe("hospitality.restaurants");
    expect(result.primary).toBe("Hospitality");
  });

  it("classifies from keywords when there is no schema", () => {
    const evidence = makeEvidenceSet([
      { text: "Request a demo of our workflow automation platform.", sourceType: "main_content", fieldHint: "description", pageType: "home" },
      { text: "Primary nav: Integrations", sourceType: "navigation", fieldHint: "offering", pageType: "home" },
      { text: "Pricing is per user per month with an enterprise plan.", sourceType: "main_content", fieldHint: "offering", pageType: "pricing" },
    ]);
    const result = classifyIndustry(evidence);
    expect(result.taxonomyId).toBe("software.b2b_saas");
  });

  it("returns no classification rather than a wrong one when evidence is absent", () => {
    const result = classifyIndustry([]);
    expect(result.taxonomyId).toBeNull();
    expect(result.confidence).toBe(0);
  });

  it("distinguishes a vehicle manufacturer from a dealership", () => {
    const dealer = classifyIndustry(
      makeEvidenceSet([
        { text: "Book a test drive at our showroom today.", sourceType: "main_content", fieldHint: "offering", pageType: "home" },
        { text: "Browse certified pre-owned and used cars with trade-in valuation.", sourceType: "main_content", fieldHint: "offering", pageType: "product_index" },
      ]),
    );
    expect(dealer.taxonomyId).toBe("automotive.dealership");
  });
});

describe("classifyArchetype", () => {
  it("reads an ecommerce archetype from a cart affordance", () => {
    const evidence = makeEvidenceSet([
      { text: "Commerce affordance: add_to_cart", sourceType: "url_signal", fieldHint: "archetype", pageType: "product_index" },
      { text: "Free shipping on all orders, easy returns policy.", sourceType: "main_content", fieldHint: "offering", pageType: "home" },
    ]);
    const industry = classifyIndustry(evidence);
    expect(classifyArchetype(evidence, industry, 0).value).toBe("ecommerce_dtc_retail");
  });

  it("reads a multi-location archetype from several location pages", () => {
    const evidence = makeEvidenceSet([{ text: "Commerce affordance: find_location", sourceType: "url_signal", fieldHint: "archetype", pageType: "store_locator" }]);
    const industry = classifyIndustry(evidence);
    expect(classifyArchetype(evidence, industry, 6).value).toBe("multi_location_chain");
  });

  it("returns 'other' with zero confidence when no signal exists", () => {
    const result = classifyArchetype([], classifyIndustry([]), 0);
    expect(result.value).toBe("other");
    expect(result.confidence).toBe(0);
  });
});

describe("computeConfidence", () => {
  it("returns zero without evidence", () => {
    expect(computeConfidence({ items: [] })).toBe(0);
  });

  it("rates structured data above body prose", () => {
    const jsonld = computeConfidence({ items: makeEvidenceSet([{ text: "x", sourceType: "jsonld", pageType: "home" }]) });
    const prose = computeConfidence({ items: makeEvidenceSet([{ text: "x", sourceType: "main_content", pageType: "editorial" }]) });
    expect(jsonld).toBeGreaterThan(prose);
  });

  it("rewards agreement across independent pages", () => {
    const single = computeConfidence({ items: makeEvidenceSet([{ text: "x", sourceType: "heading", crawlPageId: "p1" }]) });
    const multiple = computeConfidence({
      items: makeEvidenceSet([
        { text: "x", sourceType: "heading", crawlPageId: "p1" },
        { text: "x", sourceType: "heading", crawlPageId: "p2" },
        { text: "x", sourceType: "heading", crawlPageId: "p3" },
      ]),
    });
    expect(multiple).toBeGreaterThan(single);
  });

  it("cuts confidence when signals conflict", () => {
    const items = makeEvidenceSet([{ text: "x", sourceType: "jsonld", crawlPageId: "p1" }]);
    expect(computeConfidence({ items, conflicts: 2 })).toBeLessThan(computeConfidence({ items }));
  });

  it("is deterministic for the same evidence", () => {
    const items = makeEvidenceSet([{ text: "x", sourceType: "jsonld" }]);
    expect(computeConfidence({ items })).toBe(computeConfidence({ items }));
  });
});
