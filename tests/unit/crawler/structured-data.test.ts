import { describe, it, expect } from "vitest";
import * as cheerio from "cheerio";
import {
  allStrings,
  extractMicrodata,
  extractRdfa,
  firstString,
  flattenJsonLd,
  hasAnyType,
  normalizeTypes,
  ORGANIZATION_TYPES,
  parseJsonLdBlocks,
  readAddresses,
} from "@/lib/crawler/structured-data";

describe("normalizeTypes", () => {
  it("handles a string, an array, and a fully-qualified URL", () => {
    expect(normalizeTypes("Organization")).toEqual(["Organization"]);
    expect(normalizeTypes(["Organization", "Store"])).toEqual(["Organization", "Store"]);
    expect(normalizeTypes("https://schema.org/Restaurant")).toEqual(["Restaurant"]);
    expect(normalizeTypes("schema:Hotel")).toEqual(["Hotel"]);
  });

  it("returns an empty list for missing or non-string types", () => {
    expect(normalizeTypes(undefined)).toEqual([]);
    expect(normalizeTypes(42)).toEqual([]);
  });
});

describe("parseJsonLdBlocks", () => {
  it("parses a well-formed block", () => {
    const parsed = parseJsonLdBlocks(['{"@type":"Organization","name":"Acme"}']);
    expect(parsed).toHaveLength(1);
  });

  it("flattens a top-level array", () => {
    expect(parseJsonLdBlocks(['[{"@type":"Organization"},{"@type":"WebSite"}]'])).toHaveLength(2);
  });

  it("repairs a trailing comma rather than dropping high-value evidence", () => {
    const parsed = parseJsonLdBlocks(['{"@type":"Organization","name":"Acme",}']);
    expect(parsed).toHaveLength(1);
    expect((parsed[0] as { name: string }).name).toBe("Acme");
  });

  it("strips HTML comment wrappers", () => {
    expect(parseJsonLdBlocks(['<!--{"@type":"Organization","name":"Acme"}-->'])).toHaveLength(1);
  });

  it("drops irreparably malformed blocks without throwing", () => {
    expect(() => parseJsonLdBlocks(["{not json at all"])).not.toThrow();
    expect(parseJsonLdBlocks(["{not json at all", '{"@type":"Organization"}'])).toHaveLength(1);
  });

  it("ignores empty blocks", () => {
    expect(parseJsonLdBlocks(["", "   "])).toEqual([]);
  });
});

describe("flattenJsonLd", () => {
  it("expands an @graph", () => {
    const parsed = parseJsonLdBlocks([
      JSON.stringify({
        "@context": "https://schema.org",
        "@graph": [
          { "@type": "Organization", name: "Acme" },
          { "@type": "WebSite", name: "Acme Site" },
        ],
      }),
    ]);
    const entities = flattenJsonLd(parsed);
    expect(entities.map((e) => e.types[0])).toEqual(expect.arrayContaining(["Organization", "WebSite"]));
  });

  it("collects nested entities", () => {
    const parsed = parseJsonLdBlocks([
      JSON.stringify({ "@type": "Product", name: "Shoe", brand: { "@type": "Brand", name: "Acme" } }),
    ]);
    const entities = flattenJsonLd(parsed);
    expect(entities.some((e) => e.types.includes("Brand"))).toBe(true);
  });

  it("resolves an @id reference to the real node", () => {
    const parsed = parseJsonLdBlocks([
      JSON.stringify({
        "@graph": [
          { "@type": "Organization", "@id": "#org", name: "Acme Corp" },
          { "@type": "Product", name: "Shoe", brand: { "@id": "#org" } },
        ],
      }),
    ]);
    const entities = flattenJsonLd(parsed);
    const product = entities.find((e) => e.types.includes("Product"));
    expect(firstString(product?.props.brand)).toBe("Acme Corp");
  });

  it("handles an array @type", () => {
    const parsed = parseJsonLdBlocks([JSON.stringify({ "@type": ["Organization", "OnlineStore"], name: "Acme" })]);
    const entities = flattenJsonLd(parsed);
    expect(entities[0]?.types).toEqual(["Organization", "OnlineStore"]);
    expect(hasAnyType(entities[0]!, ORGANIZATION_TYPES)).toBe(true);
  });
});

describe("value accessors", () => {
  it("firstString unwraps nested name/@value shapes", () => {
    expect(firstString("Acme")).toBe("Acme");
    expect(firstString(["", "Acme"])).toBe("Acme");
    expect(firstString({ name: "Acme" })).toBe("Acme");
    expect(firstString({ "@value": "Acme" })).toBe("Acme");
    expect(firstString(null)).toBeNull();
  });

  it("allStrings collects and deduplicates", () => {
    expect(allStrings(["a", "b", "a", { name: "c" }])).toEqual(["a", "b", "c"]);
  });

  it("readAddresses normalizes single and nested addresses", () => {
    const addresses = readAddresses({
      "@type": "PostalAddress",
      addressLocality: "Mumbai",
      addressRegion: "MH",
      addressCountry: "IN",
    });
    expect(addresses[0]).toMatchObject({ locality: "Mumbai", region: "MH", country: "IN" });
  });

  it("readAddresses handles an array of locations", () => {
    const addresses = readAddresses([
      { addressLocality: "Mumbai", addressCountry: "IN" },
      { addressLocality: "Delhi", addressCountry: "IN" },
    ]);
    expect(addresses).toHaveLength(2);
  });

  // Street-only addresses are kept since the location rework: a salon's JSON-LD
  // "Gate Village 10, DIFC" often has no locality, and the understanding step
  // and geocoder can still place it. It carries no country or city by itself.
  it("readAddresses keeps a street-only address without inventing geography", () => {
    const [address] = readAddresses({ streetAddress: "1 Nowhere Rd" });
    expect(address?.street).toBe("1 Nowhere Rd");
    expect(address?.locality).toBeUndefined();
    expect(address?.country).toBeUndefined();
  });
  it("readAddresses ignores an empty address", () => {
    expect(readAddresses({ streetAddress: "  " })).toEqual([]);
  });
});

describe("microdata and RDFa", () => {
  it("reads itemtype/itemprop pairs", () => {
    const $ = cheerio.load(`<div itemscope itemtype="https://schema.org/Restaurant">
      <span itemprop="name">Basil &amp; Vine</span>
      <span itemprop="servesCuisine">Italian</span>
    </div>`);
    const entities = extractMicrodata($);
    expect(entities[0]?.types).toEqual(["Restaurant"]);
    expect(entities[0]?.props.name).toBe("Basil & Vine");
    expect(entities[0]?.origin).toBe("microdata");
  });

  it("reads typeof/property pairs", () => {
    const $ = cheerio.load(`<div typeof="Organization"><span property="name">Acme</span></div>`);
    const entities = extractRdfa($);
    expect(entities[0]?.types).toEqual(["Organization"]);
    expect(entities[0]?.props.name).toBe("Acme");
  });
});
