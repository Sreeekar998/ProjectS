import { describe, expect, it } from "vitest";
import { extractPage } from "@/lib/crawler/extractor";
import { schemaFamilyOf } from "@/lib/crawler/structured-data";
import { buildEvidenceForPage } from "@/lib/evidence/builder";

const html = `<!doctype html><html lang="en-US"><head><title>Maison Nine Salon | Luxury salon</title>
<script type="application/ld+json">{"@context":"https://schema.org","@type":"HairSalon","name":"Maison Nine Salon","telephone":"+97143334444","address":{"@type":"PostalAddress","streetAddress":"Gate Building, 6th Floor","addressLocality":"Dubai","addressCountry":"AE"},"geo":{"@type":"GeoCoordinates","latitude":25.2118,"longitude":55.2739},"priceRange":"AED 100 - AED 1500"}</script>
</head><body>
<header><nav><a href="/hair/">Hair</a><a href="/nails/">Nails</a></nav></header>
<main><h1>Maison Nine</h1>
<div class="location-intro">Every visit to Maison Nine begins with 1 personal consultation and a calm, unhurried welcome from our team of stylists.</div>
<p>Book balayage, gel manicures and brow lamination.</p>
<a href="https://www.fresha.com/a/maison-nine-dubai">Book now</a>
<iframe src="https://www.google.com/maps/embed?pb=!1m18!1m12!1m3!1d3610.0!2d55.2739!3d25.2118!2m3!1f0!2f0!3f0"></iframe>
</main>
<footer><address>Gate Building, 6th Floor, DIFC, Dubai</address><a href="tel:+97143334444">Call</a><a href="https://instagram.com/maisonnine">Instagram</a></footer>
</body></html>`;

describe("local business signals", () => {
  const page = extractPage(html, "https://maisonnine.example/");

  it("classifies HairSalon as a local business schema type", () => {
    expect(schemaFamilyOf("HairSalon")).toBe("local_business");
    expect(schemaFamilyOf("https://schema.org/Restaurant")).toBe("local_business");
  });

  it("keeps real addresses and drops marketing copy that merely contains a digit", () => {
    expect(page.locationSignals.addressBlocks.some((block) => /Gate Building/.test(block))).toBe(true);
    expect(page.locationSignals.addressBlocks.some((block) => /Every visit/.test(block))).toBe(false);
  });

  it("reads map coordinates, phone, social and booking links", () => {
    expect(page.locationSignals.mapLinks.some((link) => Math.abs((link.lat ?? 0) - 25.2118) < 0.001 && Math.abs((link.lng ?? 0) - 55.2739) < 0.001)).toBe(true);
    expect(page.locationSignals.telLinks).toContain("+97143334444");
    expect(page.locationSignals.bookingLinks.some((link) => link.platform === "fresha")).toBe(true);
  });

  it("turns the salon's structured data into brand, address and geo evidence", () => {
    const evidence = buildEvidenceForPage({ runId: "r", projectId: "p", crawlPageId: "pg", url: "https://maisonnine.example/", canonicalUrl: null, pageType: "home" }, page);
    const texts = evidence.map((item) => item.text);
    expect(texts).toContain("HairSalon name: Maison Nine Salon");
    expect(texts.some((text) => /^HairSalon address: .*Dubai/.test(text))).toBe(true);
    expect(texts.some((text) => /^HairSalon geo: 25\.2118, 55\.2739/.test(text))).toBe(true);
    expect(texts.some((text) => /^Booking platform: fresha/.test(text))).toBe(true);
  });
});
