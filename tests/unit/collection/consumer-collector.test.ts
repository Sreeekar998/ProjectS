import { describe, expect, it } from "vitest";
import { answerLooksEmpty, markersPass, normalizeCountry, Semaphore, stripImageMarkdown, uniqueSources, urlHasSiteUtm } from "@/lib/collection/consumer-collector";
import { surfaceOf, isConsumerWebRoute, engineOf } from "@/lib/providers/engines";
import { CONSUMER_WEB_ROUTES, pausedReasonOf, vendorOfRoute } from "@/lib/providers/catalog";
import { ALL_ROUTE_IDS, COLLECTION_ROUTES } from "@/lib/providers/route-policy-seed";

describe("consumer-web collection contract", () => {
  it("passes surface markers only when the shape is known and a site-only fact is present", () => {
    const base = { siteUrl: false, siteUtm: false, pageHtml: false, searchMetadata: false, schemaKnown: true };
    expect(markersPass(base)).toBe(false);
    expect(markersPass({ ...base, siteUtm: true })).toBe(true);
    expect(markersPass({ ...base, pageHtml: true })).toBe(true);
    expect(markersPass({ ...base, siteUrl: true, schemaKnown: false })).toBe(false);
  });

  it("treats blank pages and widget placeholders as empty, never as an answer", () => {
    expect(answerLooksEmpty("", 0)).toBe(true);
    expect(answerLooksEmpty("Map data is currently unavailable", 0)).toBe(true);
    expect(answerLooksEmpty("I can't help with that.", 0)).toBe(true);
    expect(answerLooksEmpty("I can't help with that.", 2)).toBe(false);
    expect(answerLooksEmpty("A".repeat(200), 0)).toBe(false);
  });

  it("drops embedded images from an answer but keeps their alt text", () => {
    const text = "### My picks\n\n![Nike Pegasus 41](https://images.openai.com/thumbnails/url/h2GHKXicDclZCoJAAADQE-VS5AYRhi)\n\n1. **Nike Pegasus 41** — versatile\n\n![](https://images.openai.com/thumbnails/url/abc)   \n\n\n2. **ASICS Novablast 5**";
    const stripped = stripImageMarkdown(text);
    expect(stripped).not.toContain("images.openai.com");
    expect(stripped).toContain("Nike Pegasus 41");
    expect(stripped).toContain("**ASICS Novablast 5**");
    expect(stripped).not.toMatch(/\n{3,}/);
  });

  it("normalises countries to ISO alpha-2 and rejects anything else", () => {
    expect(normalizeCountry("ae")).toBe("AE");
    expect(normalizeCountry(" us ")).toBe("US");
    expect(normalizeCountry("United States")).toBeNull();
    expect(normalizeCountry(null)).toBeNull();
  });

  it("keeps one source per kind and url and drops non-http links", () => {
    const sources = uniqueSources([
      { url: "https://a.example/x", title: null, position: 1, kind: "citation" },
      { url: "https://a.example/x", title: "dup", position: 2, kind: "citation" },
      { url: "https://a.example/x", title: null, position: 1, kind: "inline_link" },
      { url: "javascript:alert(1)", title: null, position: null, kind: "citation" },
    ]);
    expect(sources).toHaveLength(2);
    expect(urlHasSiteUtm("https://a.example/x?utm_source=chatgpt.com", "chatgpt.com")).toBe(true);
    expect(urlHasSiteUtm("https://a.example/x?utm_source=chatgptXcom", "chatgpt.com")).toBe(false);
  });

  it("gates concurrency", async () => {
    const gate = new Semaphore(2);
    let active = 0;
    let peak = 0;
    await Promise.all(
      Array.from({ length: 6 }, async () => {
        const release = await gate.acquire();
        active += 1;
        peak = Math.max(peak, active);
        await new Promise((resolve) => setTimeout(resolve, 5));
        active -= 1;
        release();
      }),
    );
    expect(peak).toBe(2);
  });

  it("maps every active route to a consumer-web surface with a vendor and an engine", () => {
    for (const id of COLLECTION_ROUTES) {
      expect(isConsumerWebRoute(id)).toBe(true);
      expect(surfaceOf(id)).toBe("consumer_web");
      expect(vendorOfRoute(id)).not.toBeNull();
      expect(["chatgpt", "gemini"]).toContain(engineOf(id));
      expect(CONSUMER_WEB_ROUTES.some((route) => route.id === id)).toBe(true);
    }
    expect(surfaceOf("openai_api")).toBe("api");
    expect(surfaceOf("chatgpt_manual")).toBe("by_hand");
    expect(ALL_ROUTE_IDS).toContain("chatgpt_manual");
    expect(ALL_ROUTE_IDS).toContain("openai_api");
  });

  it("reads a paused reason without inventing one", () => {
    expect(pausedReasonOf("vendor_unhealthy")).toBe("vendor_unhealthy");
    expect(pausedReasonOf("the provider's quota is used up")).toBe("quota");
    expect(pausedReasonOf(null)).toBe("quota");
  });
});
