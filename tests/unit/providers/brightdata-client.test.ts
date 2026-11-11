import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { collect, answerFromRecord, restorePlaceholders, BRIGHTDATA_CHATGPT_DATASET } from "@/lib/brightdata/client";
import { markersPass } from "@/lib/collection/consumer-collector";
import { BRIGHTDATA_EMPTY_RECORD, BRIGHTDATA_RECORD } from "../../fixtures/vendor-payloads";

function respond(status: number, body: unknown, headers: Record<string, string> = {}) {
  return new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json", ...headers } });
}

const ask = { engine: "chatgpt" as const, prompt: "best trail running shoes", country: "AE", locale: "en" };

describe("Bright Data ChatGPT collector", () => {
  beforeEach(() => {
    process.env.BRIGHTDATA_API_TOKEN = "test-brightdata-token";
    // Longer than two poll intervals; the poll test drives time with fake timers.
    process.env.SUN_BRIGHTDATA_POLL_MAX_MS = "30000";
  });
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.useRealTimers();
    delete process.env.BRIGHTDATA_API_TOKEN;
    delete process.env.SUN_BRIGHTDATA_POLL_MAX_MS;
  });

  it("sends the prompt to the ChatGPT dataset with the country and web search permitted", async () => {
    let url = "";
    let body: any = null;
    let auth: string | null = null;
    vi.stubGlobal("fetch", async (input: string, init: RequestInit) => {
      url = input;
      body = JSON.parse(String(init.body));
      auth = new Headers(init.headers).get("authorization");
      return respond(200, [BRIGHTDATA_RECORD]);
    });
    const result = await collect(ask);
    expect(url).toContain(`/datasets/v3/scrape?dataset_id=${BRIGHTDATA_CHATGPT_DATASET}`);
    expect(auth).toBe("Bearer test-brightdata-token");
    expect(body).toEqual([{ url: "https://chatgpt.com/", prompt: ask.prompt, web_search: true, country: "AE" }]);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    // The page's inline links come back as "[1]" placeholders; the brand
    // names are restored from links_attached so they are not lost to analysis.
    expect(result.text).toContain("Salomon Speedcross 6");
    expect(result.text).toContain("TrailStride is a lighter option");
    expect(result.text).not.toMatch(/\\?\[[123]\\?\]/);
    expect(result.model).toBeNull();
    expect(result.searched).toBe(true);
    expect(result.searchMode).toBe("permitted");
    expect(result.sources.filter((source) => source.kind === "citation")).toHaveLength(2);
    expect(result.sources.filter((source) => source.kind === "inline_link")).toHaveLength(4);
    expect(result.markers).toEqual({ siteUrl: true, siteUtm: true, pageHtml: true, searchMetadata: true, schemaKnown: true });
    expect(markersPass(result.markers)).toBe(true);
    expect(result.country).toBe("US");
    expect(result.html).toContain("data-build");
  });

  it("restores placeholders only where a link position matches", () => {
    expect(restorePlaceholders("Try [1] or [2]; see [9].", [{ url: "https://a", text: "Nike", position: 1 }, { url: "https://b", text: "ASICS", position: 2 }])).toBe("Try Nike or ASICS; see [9].");
    expect(restorePlaceholders("Try \\[1\\] today", [{ url: "https://a", text: "Nike", position: 1 }])).toBe("Try Nike today");
    expect(restorePlaceholders("No links [1]", [])).toBe("No links [1]");
  });

  it("does not claim a country the vendor did not echo", () => {
    const result = answerFromRecord({ ...BRIGHTDATA_RECORD, country: null }, ask, Date.now(), null);
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.country).toBeNull();
  });

  it("polls a snapshot when the synchronous call answers 202", async () => {
    vi.useFakeTimers();
    const calls: string[] = [];
    vi.stubGlobal("fetch", async (input: string) => {
      calls.push(input);
      if (input.includes("/scrape")) return respond(202, { snapshot_id: "s_abc" });
      if (input.includes("/progress/s_abc")) return respond(200, { status: calls.filter((c) => c.includes("/progress")).length < 2 ? "running" : "ready" });
      if (input.includes("/snapshot/s_abc")) return respond(200, [BRIGHTDATA_RECORD]);
      throw new Error(`unexpected ${input}`);
    });
    const pending = collect(ask);
    await vi.advanceTimersByTimeAsync(10_100);
    await vi.advanceTimersByTimeAsync(10_100);
    const result = await pending;
    expect(result.ok).toBe(true);
    expect(calls.some((c) => c.includes("/snapshot/s_abc?format=json"))).toBe(true);
  });

  it("treats a widget-only page as an empty answer to retry, never as an observation", async () => {
    vi.stubGlobal("fetch", async () => respond(200, [BRIGHTDATA_EMPTY_RECORD]));
    expect(await collect(ask)).toMatchObject({ ok: false, error: "empty_response", permanent: false });
  });

  it("fails closed on a payload shape it does not know", () => {
    const result = answerFromRecord({ answer: "something new", model: "x" }, ask, Date.now(), null);
    expect(result).toMatchObject({ ok: false, error: "schema_unrecognised", permanent: true });
  });

  it("maps a rejected key, an exhausted free tier and a rate limit to typed failures", async () => {
    vi.stubGlobal("fetch", async () => respond(401, { error: "unauthorized" }));
    expect(await collect(ask)).toMatchObject({ ok: false, error: "auth_failed", permanent: true });
    vi.stubGlobal("fetch", async () => respond(403, { error: "Free tier credits exhausted" }));
    expect(await collect(ask)).toMatchObject({ ok: false, error: "billing_required", permanent: true });
    vi.stubGlobal("fetch", async () => respond(429, { error: "too many" }, { "retry-after": "15" }));
    const limited = await collect(ask);
    expect(limited).toMatchObject({ ok: false, error: "rate_limited" });
    if (!limited.ok) expect(limited.retryAfterMs).toBe(15_000);
  });

  it("reports an error record from the site as a target failure", () => {
    const result = answerFromRecord({ input: {}, error: "Login required", error_code: "login_wall" }, ask, Date.now(), null);
    expect(result).toMatchObject({ ok: false, error: "target_blocked" });
  });

  it("is disabled without a key and refuses engines it does not serve", async () => {
    delete process.env.BRIGHTDATA_API_TOKEN;
    expect(await collect(ask)).toMatchObject({ ok: false, error: "brightdata_disabled" });
    process.env.BRIGHTDATA_API_TOKEN = "test";
    expect(await collect({ ...ask, engine: "gemini" })).toMatchObject({ ok: false, error: "engine_unsupported" });
  });
});
