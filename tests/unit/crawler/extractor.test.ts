import { describe, it, expect } from "vitest";
import { extractPage } from "@/lib/crawler/extractor";

const SAMPLE_HTML = `<!doctype html><html lang="en"><head>
  <title>Nimbus Flow - Workflow Automation</title>
  <meta name="description" content="Automate repetitive work without code.">
  <link rel="canonical" href="https://nimbusflow.example/">
  <script type="application/ld+json">{"@context":"https://schema.org","@type":"Organization","name":"Nimbus Flow","address":{"@type":"PostalAddress","addressCountry":"United States","addressLocality":"Austin"}}</script>
  </head><body>
  <nav><a href="/about">About</a><a href="/pricing">Pricing</a></nav>
  <script>console.log('tracking pixel noise');</script>
  <h1>Automate your busywork</h1>
  <h2>How to reduce manual data entry</h2>
  <p>Nimbus Flow connects your apps. Call us at +1 512 555 0100 or visit 123 Congress Ave, Suite 400.</p>
  <p>Pricing starts at USD 29/month.</p>
  <footer>Copyright footer noise that should be excluded</footer>
  </body></html>`;

describe("extractPage", () => {
  const result = extractPage(SAMPLE_HTML, "https://nimbusflow.example/");

  it("extracts title, meta description, and canonical URL", () => {
    expect(result.title).toBe("Nimbus Flow - Workflow Automation");
    expect(result.metaDescription).toBe("Automate repetitive work without code.");
    expect(result.canonicalUrl).toBe("https://nimbusflow.example/");
  });

  it("extracts headings in document order", () => {
    expect(result.headings).toEqual(["Automate your busywork", "How to reduce manual data entry"]);
  });

  it("parses JSON-LD structured data", () => {
    expect(result.jsonLd).toHaveLength(1);
    expect((result.jsonLd[0] as { name: string }).name).toBe("Nimbus Flow");
  });

  it("resolves relative links against the base URL", () => {
    const aboutLink = result.links.find((l) => l.text === "About");
    expect(aboutLink?.href).toBe("https://nimbusflow.example/about");
    expect(aboutLink?.inNav).toBe(true);
  });

  it("removes boilerplate (script, nav, footer) from the extracted main text", () => {
    expect(result.mainText).not.toContain("tracking pixel noise");
    expect(result.mainText).not.toContain("footer noise");
    expect(result.mainText).toContain("Nimbus Flow connects your apps");
  });

  it("detects a phone-country signal", () => {
    expect(result.phoneCountrySignals.length).toBeGreaterThan(0);
  });

  it("detects a currency signal", () => {
    expect(result.currencySignals.length).toBeGreaterThan(0);
  });

  it("detects an address-like signal", () => {
    expect(result.addresses.length).toBeGreaterThan(0);
  });

  it("produces a stable content hash for identical input", () => {
    const again = extractPage(SAMPLE_HTML, "https://nimbusflow.example/");
    expect(again.contentHash).toBe(result.contentHash);
  });

  it("produces a different hash for different content (near-dup detection input)", () => {
    const other = extractPage(SAMPLE_HTML.replace("busywork", "chores"), "https://nimbusflow.example/");
    expect(other.contentHash).not.toBe(result.contentHash);
  });

  it("does not throw on malformed JSON-LD", () => {
    const malformed = extractPage(`<html><head><script type="application/ld+json">{not valid json</script></head><body><p>hi</p></body></html>`, "https://x.example/");
    expect(malformed.jsonLd).toEqual([]);
  });
});
