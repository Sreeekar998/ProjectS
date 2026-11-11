import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { collect, answerFromResult, basicAuthValue } from "@/lib/decodo/client";
import { markersPass } from "@/lib/collection/consumer-collector";
import { DECODO_FAILED, DECODO_RESULT } from "../../fixtures/vendor-payloads";

function respond(status: number, body: unknown, headers: Record<string, string> = {}) {
  return new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json", ...headers } });
}

const ask = { engine: "chatgpt" as const, prompt: "best trail running shoes", country: "AE", locale: "en" };

describe("Decodo ChatGPT collector", () => {
  beforeEach(() => {
    process.env.DECODO_AUTH_TOKEN = "dXNlcjpwYXNz";
  });
  afterEach(() => {
    vi.unstubAllGlobals();
    delete process.env.DECODO_AUTH_TOKEN;
    delete process.env.SUN_DECODO_GEO;
  });

  it("sends the chatgpt target with search and parsing on, and no geo unless asked", async () => {
    let body: any = null;
    let auth: string | null = null;
    vi.stubGlobal("fetch", async (url: string, init: RequestInit) => {
      expect(url).toBe("https://scraper-api.decodo.com/v2/scrape");
      body = JSON.parse(String(init.body));
      auth = new Headers(init.headers).get("authorization");
      return respond(200, { results: [DECODO_RESULT] });
    });
    const result = await collect(ask);
    // geo made every real ChatGPT request fail on 2026-09-15, so it is opt-in.
    expect(body).toEqual({ target: "chatgpt", prompt: ask.prompt, search: true, parse: true });
    expect(auth).toBe("Basic dXNlcjpwYXNz");
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.model).toBe("gpt-5-6");
    expect(result.searched).toBe(true);
    expect(result.searchQueries).toEqual(["best trail running shoes 2026"]);
    expect(result.sources.filter((s) => s.kind === "citation")).toHaveLength(1);
    expect(result.sources.filter((s) => s.kind === "inline_link")).toHaveLength(1);
    expect(result.text).toContain("**Salomon Speedcross 6**");
    expect(markersPass(result.markers)).toBe(true);
    // Without geo the exit is unknown: no country is claimed.
    expect(result.country).toBeNull();
    expect(result.vendorRequestId).toBe("7505595815340045313");
  });

  it("sends geo when opted in", async () => {
    process.env.SUN_DECODO_GEO = "1";
    let body: any = null;
    vi.stubGlobal("fetch", async (_url: string, init: RequestInit) => {
      body = JSON.parse(String(init.body));
      return respond(200, { results: [DECODO_RESULT] });
    });
    const result = await collect(ask);
    expect(body.geo).toBe("AE");
    if (result.ok) expect(result.country).toBe("AE");
  });

  it("encodes a pasted user:password pair and passes a dashboard token through", () => {
    expect(basicAuthValue("user:pass")).toBe("dXNlcjpwYXNz");
    expect(basicAuthValue("dXNlcjpwYXNz")).toBe("dXNlcjpwYXNz");
    expect(basicAuthValue("Basic dXNlcjpwYXNz")).toBe("dXNlcjpwYXNz");
  });

  it("treats the vendor's failed envelope as a target failure whether it comes with 200 or 400", async () => {
    vi.stubGlobal("fetch", async () => respond(200, DECODO_FAILED));
    expect(await collect(ask)).toMatchObject({ ok: false, error: "target_blocked", permanent: false });
    vi.stubGlobal("fetch", async () => respond(400, { status: "failed", message: "Something went wrong. Please try again later" }));
    expect(await collect(ask)).toMatchObject({ ok: false, error: "target_blocked", permanent: false });
  });

  it("fails closed when the page came back unparsed", () => {
    expect(answerFromResult({ content: "<html>raw</html>", status_code: 200, url: "https://chatgpt.com/" }, ask, Date.now(), null)).toMatchObject({ ok: false, error: "schema_unrecognised", permanent: true });
    expect(answerFromResult({ content: "<html>blocked</html>", status_code: 403, url: "https://chatgpt.com/" }, ask, Date.now(), null)).toMatchObject({ ok: false, error: "target_blocked" });
  });

  it("maps a bad token, a plan limit and a rate limit", async () => {
    vi.stubGlobal("fetch", async () => respond(401, { message: "Unauthorized" }));
    expect(await collect(ask)).toMatchObject({ ok: false, error: "auth_failed", permanent: true });
    vi.stubGlobal("fetch", async () => respond(403, { message: "Subscription limit reached" }));
    expect(await collect(ask)).toMatchObject({ ok: false, error: "billing_required", permanent: true });
    vi.stubGlobal("fetch", async () => respond(429, { message: "Too many requests" }, { "retry-after": "5" }));
    expect(await collect(ask)).toMatchObject({ ok: false, error: "rate_limited", retryAfterMs: 5_000 });
  });

  it("is disabled without a token", async () => {
    delete process.env.DECODO_AUTH_TOKEN;
    expect(await collect(ask)).toMatchObject({ ok: false, error: "decodo_disabled" });
  });
});
