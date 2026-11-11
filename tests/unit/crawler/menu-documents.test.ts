import { describe, expect, it } from "vitest";
import { documentTitle, isMenuDocument, pageFromDocumentText } from "@/lib/crawler/documents";

// A restaurant that publishes its menus as PDFs (tresindstudio.com: food,
// papadom, bar and pairing menus) had "Food Menu" and "Wine Menu" as its
// offerings. Menu-like PDFs are read; other PDFs stay out.
describe("menu documents", () => {
  it("admits PDFs whose file name or link text says menu, brochure or price list", () => {
    expect(isMenuDocument("https://x.ae/wp-content/uploads/2025/09/Papadom-Menu-1.pdf", "")).toBe(true);
    expect(isMenuDocument("https://x.ae/wp-content/uploads/2025/08/studio.pdf.pdf.pdf", "Food Menu")).toBe(true);
    expect(isMenuDocument("https://x.ae/files/brochure-2026.pdf", null)).toBe(true);
    expect(isMenuDocument("https://x.ae/files/price-list.pdf", null)).toBe(true);
    expect(isMenuDocument("https://x.ae/files/annual-report-2025.pdf", "Annual report")).toBe(false);
    expect(isMenuDocument("https://x.ae/files/terms.pdf", "Terms and conditions")).toBe(false);
    expect(isMenuDocument("https://x.ae/menu/", "Menu")).toBe(false);
  });

  it("titles a document by its link text, else its file name", () => {
    expect(documentTitle("https://x.ae/uploads/studio.pdf.pdf.pdf", "Food Menu")).toBe("Food Menu");
    expect(documentTitle("https://x.ae/uploads/Papadom-Menu-1.pdf", "")).toBe("Papadom Menu 1");
  });

  it("turns document text into a page the extractor reads as a menu", () => {
    const page = pageFromDocumentText("Chef's Tasting Menu\nGolden lentil, black lime\nWagyu, morel, ghee\nAED 895 per person", "https://x.ae/uploads/studio.pdf", "Food Menu");
    expect(page.title).toBe("Food Menu");
    expect(page.h1).toBe("Food Menu");
    expect(page.mainText).toContain("Wagyu, morel, ghee");
    expect(page.mainText).toContain("AED 895");
  });
});

import { CrawlPlanner } from "@/lib/crawler/crawl-planner";
import { DEFAULT_CRAWL_CONFIG } from "@/lib/crawler/config";

describe("menu documents in the crawl frontier", () => {
  it("batches a menu PDF a page links to, and still skips other PDFs", () => {
    const planner = new CrawlPlanner(DEFAULT_CRAWL_CONFIG, "https://tresind.test/", (url) => new URL(url).hostname === "tresind.test");
    planner.discover("https://tresind.test/", { depth: 0, inPrimaryNav: true, inFooter: false, inboundLinks: 1 });
    const menu = planner.discover("https://tresind.test/wp-content/uploads/2025/08/studio.pdf.pdf.pdf", { depth: 1, inPrimaryNav: false, inFooter: false, inboundLinks: 1, anchorText: "Food Menu" });
    const report = planner.discover("https://tresind.test/wp-content/uploads/annual-report.pdf", { depth: 1, inPrimaryNav: false, inFooter: false, inboundLinks: 1, anchorText: "Annual report" });
    expect(menu?.pageType).toBe("menu");
    const batch = planner.takeBatch(10).map((candidate) => candidate.url);
    expect(batch).toContain("https://tresind.test/wp-content/uploads/2025/08/studio.pdf.pdf.pdf");
    expect(batch).not.toContain("https://tresind.test/wp-content/uploads/annual-report.pdf");
    expect(report === null || report.trapReason === "non_html_asset").toBe(true);
  });
});
