import { describe, it, expect } from "vitest";
import {
  canonicalizeUrl,
  classifyUrlTrap,
  isSameBusinessSite,
  isTrackingParam,
  localeSegmentOf,
  registrableDomainInfo,
  urlFamilyKey,
} from "@/lib/crawler/url-canonical";

describe("canonicalizeUrl", () => {
  it("strips the fragment, lowercases the host and drops the default port", () => {
    expect(canonicalizeUrl("HTTPS://Example.COM:443/Path#section")).toBe("https://example.com/Path");
  });

  it("removes tracking parameters but keeps meaningful ones", () => {
    const result = canonicalizeUrl("https://example.com/p?utm_source=x&gclid=y&id=42&fbclid=z");
    expect(result).toBe("https://example.com/p?id=42");
  });

  it("sorts remaining query parameters so order cannot create duplicates", () => {
    expect(canonicalizeUrl("https://example.com/a?b=2&a=1")).toBe(canonicalizeUrl("https://example.com/a?a=1&b=2"));
  });

  it("normalizes a trailing slash away, except at the root", () => {
    expect(canonicalizeUrl("https://example.com/about/")).toBe("https://example.com/about");
    expect(canonicalizeUrl("https://example.com/")).toBe("https://example.com/");
  });

  it("collapses duplicate slashes inside the path", () => {
    expect(canonicalizeUrl("https://example.com//a///b")).toBe("https://example.com/a/b");
  });

  it("resolves relative URLs against a base", () => {
    expect(canonicalizeUrl("/about", "https://example.com/team")).toBe("https://example.com/about");
  });

  it("rejects non-http(s) schemes", () => {
    for (const url of ["mailto:a@b.com", "javascript:alert(1)", "file:///etc/passwd", "ftp://example.com", "data:text/html,x"]) {
      expect(canonicalizeUrl(url)).toBeNull();
    }
  });

  it("recognizes tracking parameter families", () => {
    expect(isTrackingParam("utm_campaign")).toBe(true);
    expect(isTrackingParam("GCLID")).toBe(true);
    expect(isTrackingParam("mc_cid")).toBe(true);
    expect(isTrackingParam("productId")).toBe(false);
  });
});

describe("registrable domain and site scoping", () => {
  it("extracts the registrable domain across multi-part public suffixes", () => {
    expect(registrableDomainInfo("shop.example.co.uk").registrableDomain).toBe("example.co.uk");
    expect(registrableDomainInfo("www.nike.in").registrableDomain).toBe("nike.in");
  });

  it("treats www and the apex as the same site", () => {
    expect(isSameBusinessSite("www.example.com", "example.com")).toBe(true);
    expect(isSameBusinessSite("example.com", "www.example.com")).toBe(true);
  });

  it("keeps a business subdomain such as shop. in scope", () => {
    expect(isSameBusinessSite("shop.example.com", "www.example.com")).toBe(true);
  });

  it("excludes operationally separate subdomains", () => {
    for (const host of ["status.example.com", "careers.example.com", "cdn.example.com", "docs.example.com", "support.example.com"]) {
      expect(isSameBusinessSite(host, "www.example.com")).toBe(false);
    }
  });

  it("excludes a different registrable domain entirely", () => {
    expect(isSameBusinessSite("example.org", "example.com")).toBe(false);
    expect(isSameBusinessSite("evil-example.com", "example.com")).toBe(false);
  });
});

describe("classifyUrlTrap", () => {
  it.each([
    ["https://example.com/cart", "cart_or_checkout"],
    ["https://example.com/checkout/step-2", "cart_or_checkout"],
    ["https://example.com/login", "session_or_auth"],
    ["https://example.com/my-account/orders", "session_or_auth"],
    ["https://example.com/search", "search_results"],
    ["https://example.com/catalog?q=shoes", "search_results"],
    ["https://example.com/shop?color=red", "faceted_filter"],
    ["https://example.com/shop?a=1&b=2&c=3", "faceted_filter"],
    ["https://example.com/blog/page/9", "deep_pagination"],
    ["https://example.com/blog?page=12", "deep_pagination"],
    ["https://example.com/events/2026/03", "calendar"],
    ["https://example.com/brochure.pdf", "non_html_asset"],
    ["https://example.com/feed", "feed"],
    ["https://example.com/tag/running", "tag_or_archive"],
    ["https://example.com/print/article", "print_or_export"],
  ])("flags %s as %s", (url, reason) => {
    const verdict = classifyUrlTrap(url);
    expect(verdict.isTrap).toBe(true);
    expect(verdict.reason).toBe(reason);
  });

  it.each([
    "https://example.com/",
    "https://example.com/about",
    "https://example.com/products/running-shoes",
    "https://example.com/locations/mumbai",
    "https://example.com/blog/page/2",
    "https://example.com/shop?id=17",
  ])("admits the real content URL %s", (url) => {
    expect(classifyUrlTrap(url).isTrap).toBe(false);
  });
});

describe("urlFamilyKey", () => {
  it("groups item pages generated from one template", () => {
    const a = urlFamilyKey("https://example.com/products/running/pegasus-41-mens");
    const b = urlFamilyKey("https://example.com/products/running/vomero-18-womens");
    expect(a).toBe(b);
  });

  it("keeps distinct sections in distinct families", () => {
    expect(urlFamilyKey("https://example.com/products/running")).not.toBe(urlFamilyKey("https://example.com/services/repairs"));
  });

  it("collapses numeric and hash-like identifiers", () => {
    expect(urlFamilyKey("https://example.com/p/12345")).toBe(urlFamilyKey("https://example.com/p/98765"));
  });
});

describe("localeSegmentOf", () => {
  it("detects a locale path segment", () => {
    expect(localeSegmentOf("https://example.com/in/men")).toBe("in");
    expect(localeSegmentOf("https://example.com/en-gb/shop")).toBe("en-gb");
  });

  it("returns null when the first segment is ordinary content", () => {
    expect(localeSegmentOf("https://example.com/products/shoes")).toBeNull();
    expect(localeSegmentOf("https://example.com/")).toBeNull();
  });
});
