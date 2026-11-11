import { describe, it, expect } from "vitest";
import { classifyFromUrl, classifyPage, slotKeyFor, PAGE_TYPE_VALUE } from "@/lib/crawler/page-classifier";

const base = "https://example.test";

describe("classifyFromUrl", () => {
  it.each([
    ["/", "home"],
    ["/about", "about"],
    ["/about-us", "about"],
    ["/company/our-story", "about"],
    ["/products", "product_index"],
    ["/shop", "product_index"],
    ["/collections", "product_index"],
    ["/products/running", "category"],
    ["/products/running/pegasus-41", "product"],
    ["/services", "service_index"],
    ["/services/root-canal", "service"],
    ["/solutions", "solution"],
    ["/industries", "industry"],
    ["/pricing", "pricing"],
    ["/plans", "pricing"],
    ["/stores", "store_locator"],
    ["/store-locator", "store_locator"],
    ["/locations/mumbai", "location"],
    ["/contact", "contact"],
    ["/contact-us", "contact"],
    ["/faq", "faq"],
    ["/case-studies", "case_study"],
    ["/blog", "editorial"],
    ["/news/2024/announcement", "editorial"],
    ["/careers", "careers"],
    ["/privacy-policy", "legal"],
    ["/terms", "legal"],
    ["/cookies", "legal"],
    ["/xyzzy-1234", "other"],
  ])("classifies %s as %s", (path, expected) => {
    expect(classifyFromUrl({ url: `${base}${path}` })).toBe(expected);
  });

  it("prefers the path over anchor text so a stray link cannot mislabel a page", () => {
    // A "Careers" link inside a product card must not make the product page a
    // careers page.
    expect(classifyFromUrl({ url: `${base}/products/shoes/air-max`, anchorText: "Careers" })).toBe("product");
  });

  it("uses anchor text only when the path itself is uninformative", () => {
    expect(classifyFromUrl({ url: `${base}/p/9912`, anchorText: "Our pricing plans" })).toBe("pricing");
  });
});

describe("classifyPage", () => {
  it("lets a decisive Schema.org type override the URL guess", () => {
    const result = classifyPage({ url: `${base}/xyzzy`, schemaTypes: ["Restaurant"] });
    expect(result.pageType).toBe("location");
    expect(result.signals).toContain("schema:Restaurant");
  });

  it("treats a Product schema on a page full of cards as a listing, not an item", () => {
    const result = classifyPage({ url: `${base}/shop`, schemaTypes: ["Product"], itemCardCount: 24 });
    expect(result.pageType).toBe("product_index");
  });

  it("keeps a single Product page as a product", () => {
    const result = classifyPage({ url: `${base}/products/shoes/air-max`, schemaTypes: ["Product"], itemCardCount: 1 });
    expect(result.pageType).toBe("product");
  });

  it("falls back to heading text when the URL is opaque", () => {
    const result = classifyPage({ url: `${base}/p/17`, title: "About Us | Acme", h1: "Our story" });
    expect(result.pageType).toBe("about");
  });

  it("detects an article body as editorial", () => {
    const result = classifyPage({ url: `${base}/x/y`, hasArticleBody: true, publishedDate: "2026-01-01" });
    expect(result.pageType).toBe("editorial");
  });

  it("always classifies the site root as home", () => {
    expect(classifyPage({ url: `${base}/`, schemaTypes: ["Product"] }).pageType).toBe("home");
  });
});

describe("page type information value", () => {
  it("ranks offering indexes and About above editorial and legal pages", () => {
    expect(PAGE_TYPE_VALUE.home).toBeGreaterThan(PAGE_TYPE_VALUE.editorial);
    expect(PAGE_TYPE_VALUE.product_index).toBeGreaterThan(PAGE_TYPE_VALUE.product);
    expect(PAGE_TYPE_VALUE.about).toBeGreaterThan(PAGE_TYPE_VALUE.careers);
    expect(PAGE_TYPE_VALUE.legal).toBeLessThan(PAGE_TYPE_VALUE.editorial);
  });

  it("maps every page type to a diversity slot", () => {
    expect(slotKeyFor("product_index")).toBe("offering_index");
    expect(slotKeyFor("service_index")).toBe("offering_index");
    expect(slotKeyFor("store_locator")).toBe("market");
    expect(slotKeyFor("legal")).toBe("other");
  });
});
