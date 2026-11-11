import { describe, it, expect } from "vitest";
import { isSitemapIndex, parseSitemapIndex, parseUrlset, sampleEvenly } from "@/lib/crawler/sitemap";

const URLSET = `<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
  <url><loc>https://example.test/</loc><lastmod>2026-01-01</lastmod><priority>1.0</priority></url>
  <url><loc>https://example.test/about</loc><lastmod>2025-12-01</lastmod></url>
  <url><loc>https://example.test/products?a=1&amp;b=2</loc></url>
</urlset>`;

const INDEX = `<?xml version="1.0" encoding="UTF-8"?>
<sitemapindex xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
  <sitemap><loc>https://example.test/sitemap-pages.xml</loc></sitemap>
  <sitemap><loc>https://example.test/sitemap-products.xml</loc></sitemap>
</sitemapindex>`;

describe("isSitemapIndex", () => {
  it("distinguishes an index from a urlset", () => {
    expect(isSitemapIndex(INDEX)).toBe(true);
    expect(isSitemapIndex(URLSET)).toBe(false);
  });
});

describe("parseUrlset", () => {
  it("extracts locs with lastmod and priority", () => {
    const entries = parseUrlset(URLSET, "s.xml", 100);
    expect(entries).toHaveLength(3);
    expect(entries[0]).toMatchObject({ loc: "https://example.test/", lastmod: "2026-01-01", priority: 1 });
    expect(entries[1]?.lastmod).toBe("2025-12-01");
  });

  it("decodes XML entities in the loc", () => {
    const entries = parseUrlset(URLSET, "s.xml", 100);
    expect(entries[2]?.loc).toBe("https://example.test/products?a=1&b=2");
  });

  it("respects the limit", () => {
    expect(parseUrlset(URLSET, "s.xml", 2)).toHaveLength(2);
  });

  it("falls back to bare <loc> scanning when <url> wrappers are missing", () => {
    const odd = `<root><loc>https://example.test/a</loc><loc>https://example.test/b</loc></root>`;
    expect(parseUrlset(odd, "s.xml", 10).map((e) => e.loc)).toEqual(["https://example.test/a", "https://example.test/b"]);
  });

  it("parses a plain-text sitemap", () => {
    const text = "https://example.test/a\nhttps://example.test/b\n\nnot-a-url";
    expect(parseUrlset(text, "s.txt", 10).map((e) => e.loc)).toEqual(["https://example.test/a", "https://example.test/b"]);
  });

  it("returns nothing rather than throwing on malformed XML", () => {
    expect(() => parseUrlset("<urlset><url><loc>broken", "s.xml", 10)).not.toThrow();
    expect(parseUrlset("<<<>>>", "s.xml", 10)).toEqual([]);
  });
});

describe("parseSitemapIndex", () => {
  it("extracts child sitemap URLs", () => {
    expect(parseSitemapIndex(INDEX, 10)).toEqual([
      "https://example.test/sitemap-pages.xml",
      "https://example.test/sitemap-products.xml",
    ]);
  });

  it("respects the child limit", () => {
    expect(parseSitemapIndex(INDEX, 1)).toHaveLength(1);
  });
});

describe("sampleEvenly", () => {
  it("returns the whole list when it is smaller than the count", () => {
    expect(sampleEvenly([1, 2, 3], 5)).toEqual([1, 2, 3]);
  });

  it("spreads the sample across the list rather than taking a prefix", () => {
    const sample = sampleEvenly([...Array(100).keys()], 4);
    expect(sample).toHaveLength(4);
    expect(sample[0]).toBe(0);
    // A prefix-taking implementation would return [0,1,2,3].
    expect(sample[3]).toBeGreaterThan(50);
  });
});
