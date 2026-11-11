import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { collect, answerFromResult } from "@/lib/cloro/client";
import { markersPass } from "@/lib/collection/consumer-collector";
import { CLORO_EMPTY_RESULT, CLORO_RESULT } from "../../fixtures/vendor-payloads";

function respond(status: number, body: unknown, headers: Record<string, string> = {}) {
  return new Response(typeof body === "string" ? body : JSON.stringify(body), { status, headers: { "content-type": "application/json", ...headers } });
}

const ask = { engine: "chatgpt" as const, prompt: "best trail running shoes", country: "ae", locale: "en" };

describe("cloro collector", () => {
  beforeEach(() => {
    process.env.CLORO_API_KEY = "test-cloro-key";
  });
  afterEach(() => {
    vi.unstubAllGlobals();
    delete process.env.CLORO_API_KEY;
    delete process.env.SUN_CLORO_SEARCH_QUERIES;
  });

  it("asks chatgpt.com through cloro, fetches the rendered page, and keeps the credit headers", async () => {
    const calls: Array<{ url: string; body: any }> = [];
    vi.stubGlobal("fetch", async (url: string, init?: RequestInit) => {
      calls.push({ url, body: init?.body ? JSON.parse(String(init.body)) : null });
      if (url.endsWith("/v1/monitor/chatgpt")) {
        expect(new Headers(init?.headers).get("authorization")).toBe("Bearer test-cloro-key");
        return respond(200, { success: true, result: CLORO_RESULT }, { "x-credits-charged": "7", "x-credits-remaining": "493", "x-request-id": "req_1" });
      }
      if (url === CLORO_RESULT.html) return new Response("<html data-build='x'><body>rendered</body></html>", { status: 200 });
      throw new Error(`unexpected ${url}`);
    });
    const result = await collect(ask);
    expect(calls[0]!.body).toEqual({ prompt: ask.prompt, country: "AE", include: { markdown: true, html: true } });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.model).toBeNull();
    expect(result.searchMode).toBe("forced");
    expect(result.searched).toBe(true);
    expect(result.credits).toEqual({ charged: 7, remaining: 493 });
    expect(result.sources.filter((s) => s.kind === "citation").map((s) => s.position)).toEqual([1, 2]);
    expect(result.html).toContain("rendered");
    expect(result.markers.pageHtml).toBe(true);
    expect(result.markers.siteUtm).toBe(true);
    expect(markersPass(result.markers)).toBe(true);
    expect(result.vendorRequestId).toBe("req_1");
  });

  it("serves Gemini from the same key and marks its search state unknown", async () => {
    vi.stubGlobal("fetch", async (url: string) => {
      if (url.endsWith("/v1/monitor/gemini")) return respond(200, { success: true, result: { ...CLORO_RESULT, html: null, searchQueries: [] } });
      throw new Error(`unexpected ${url}`);
    });
    const result = await collect({ ...ask, engine: "gemini" });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.site).toBe("gemini.google.com");
    expect(result.searchMode).toBe("unknown");
  });

  it("returns cloro's blank-answer rule as empty_response so the lane retries once", () => {
    const result = answerFromResult(CLORO_EMPTY_RESULT, ask, Date.now(), { credits: { charged: 7, remaining: 1 }, requestId: null, html: null });
    expect(result).toMatchObject({ ok: false, error: "empty_response", permanent: false });
  });

  it("maps insufficient credits, a bad key, a rate limit and an upstream failure", async () => {
    vi.stubGlobal("fetch", async () => respond(403, { error: { code: "INSUFFICIENT_CREDITS", message: "no credits" } }));
    expect(await collect(ask)).toMatchObject({ ok: false, error: "billing_required", permanent: true });
    vi.stubGlobal("fetch", async () => respond(401, { error: { code: "INVALID_OR_EXPIRED_API_KEY", message: "bad" } }));
    expect(await collect(ask)).toMatchObject({ ok: false, error: "auth_failed", permanent: true });
    vi.stubGlobal("fetch", async () => respond(429, { error: { code: "CONCURRENT_LIMIT_EXCEEDED", message: "slow down" } }));
    const limited = await collect(ask);
    expect(limited).toMatchObject({ ok: false, error: "rate_limited" });
    if (!limited.ok) expect(limited.retryAfterMs).toBe(20_000);
    vi.stubGlobal("fetch", async () => respond(502, { error: { code: "EXTERNAL_SERVICE_ERROR", message: "provider down" } }));
    expect(await collect(ask)).toMatchObject({ ok: false, error: "target_blocked", permanent: false });
  });

  it("runs one request at a time on the free tier even when two lanes ask together", async () => {
    let inFlight = 0;
    let peak = 0;
    vi.stubGlobal("fetch", async (url: string) => {
      if (!url.includes("/v1/monitor/")) return new Response("<html/>", { status: 200 });
      inFlight += 1;
      peak = Math.max(peak, inFlight);
      await new Promise((resolve) => setTimeout(resolve, 20));
      inFlight -= 1;
      return respond(200, { success: true, result: { ...CLORO_RESULT, html: null } });
    });
    await Promise.all([collect(ask), collect({ ...ask, engine: "gemini" }), collect(ask)]);
    expect(peak).toBe(1);
  });

  it("is disabled without a key", async () => {
    delete process.env.CLORO_API_KEY;
    expect(await collect(ask)).toMatchObject({ ok: false, error: "cloro_disabled" });
  });
});
