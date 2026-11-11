import { describe, it, expect } from "vitest";
import { normalizeUrl, assertResolvesToPublicAddress, UnsafeUrlError } from "@/lib/security/url-safety";

describe("normalizeUrl", () => {
  it("accepts a well-formed https URL", () => {
    const result = normalizeUrl("https://example.com/path?a=1");
    expect(result.hostname).toBe("example.com");
    expect(result.registrableDomain).toBe("example.com");
  });

  it("rejects non-http(s) schemes", () => {
    expect(() => normalizeUrl("ftp://example.com")).toThrow(UnsafeUrlError);
    expect(() => normalizeUrl("file:///etc/passwd")).toThrow(UnsafeUrlError);
    expect(() => normalizeUrl("javascript:alert(1)")).toThrow(UnsafeUrlError);
  });

  it("rejects localhost and internal-looking hostnames", () => {
    expect(() => normalizeUrl("http://localhost/")).toThrow(UnsafeUrlError);
    expect(() => normalizeUrl("http://foo.local/")).toThrow(UnsafeUrlError);
    expect(() => normalizeUrl("http://metadata.google.internal/")).toThrow(UnsafeUrlError);
  });

  it("rejects malformed URLs", () => {
    expect(() => normalizeUrl("not a url")).toThrow(UnsafeUrlError);
    expect(() => normalizeUrl("")).toThrow(UnsafeUrlError);
  });

  it("strips fragments and known tracking params, and sorts query params", () => {
    const result = normalizeUrl("https://example.com/?utm_source=x&b=2&a=1#section");
    expect(result.url.hash).toBe("");
    expect(result.url.searchParams.has("utm_source")).toBe(false);
    expect(result.url.toString()).toContain("a=1");
    expect(result.url.toString()).toContain("b=2");
  });
});

describe("assertResolvesToPublicAddress", () => {
  it("rejects a hostname that resolves to loopback", async () => {
    await expect(assertResolvesToPublicAddress("localhost")).rejects.toThrow(UnsafeUrlError);
  });

  it("rejects an unresolvable hostname", async () => {
    await expect(assertResolvesToPublicAddress("this-domain-does-not-exist-sun-test.invalid")).rejects.toThrow(UnsafeUrlError);
  });
});

describe("normalizeUrl scheme handling", () => {
  it("defaults a bare domain to HTTPS — people type example.com, not https://example.com", () => {
    expect(normalizeUrl("example.com").url.toString()).toBe("https://example.com/");
    expect(normalizeUrl("www.example.co.uk/about").url.toString()).toBe("https://www.example.co.uk/about");
  });

  it("keeps an explicit http scheme rather than upgrading it", () => {
    expect(normalizeUrl("http://example.com").url.protocol).toBe("http:");
  });

  it("still rejects a disallowed scheme instead of rewriting it to HTTPS", () => {
    for (const input of ["javascript:alert(1)", "file:///etc/passwd", "ftp://example.com", "data:text/html,x", "gopher://example.com"]) {
      expect(() => normalizeUrl(input), input).toThrow(UnsafeUrlError);
    }
  });

  it("rejects empty input", () => {
    expect(() => normalizeUrl("   ")).toThrow(UnsafeUrlError);
  });
});
