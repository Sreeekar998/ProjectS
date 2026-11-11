import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { collect, answerFromResult, basicAuthValue } from "@/lib/oxylabs/client";
import { markersPass } from "@/lib/collection/consumer-collector";
import { OXYLABS_RESULT } from "../../fixtures/vendor-payloads";

function respond(status: number, body: unknown, headers: Record<string, string> = {}) {
  return new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json", ...headers } });
}

const ask = { engine: "chatgpt" as const, prompt: "best trail running shoes", country: "IN", locale: "en" };

describe("Oxylabs ChatGPT collector", () => {
  beforeEach(() => {
    process.env.OXYLABS_AUTH = "sun_user:sun_pass";
  });
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.useRealTimers();
    delete process.env.OXYLABS_AUTH;
  });

  it("submits a push-pull job with the country name, polls it, and reads the parsed result", async () => {
    vi.useFakeTimers();
    const calls: Array<{ url: string; body: any; auth: string | null }> = [];
    let polls = 0;
    vi.stubGlobal("fetch", async (url: string, init?: RequestInit) => {
      calls.push({ url, body: init?.body ? JSON.parse(String(init.body)) : null, auth: new Headers(init?.headers).get("authorization") });
      if (url.endsWith("/v1/queries")) return respond(201, { id: "7470033199733683201", status: "pending" });
      if (url.endsWith("/v1/queries/7470033199733683201")) {
        polls += 1;
        return respond(200, { id: "7470033199733683201", status: polls < 2 ? "pending" : "done" });
      }
      if (url.endsWith("/v1/queries/7470033199733683201/results")) return respond(200, { results: [OXYLABS_RESULT] });
      throw new Error(`unexpected ${url}`);
    });
    const pending = collect(ask);
    await vi.advanceTimersByTimeAsync(10_100);
    await vi.advanceTimersByTimeAsync(10_100);
    const result = await pending;
    expect(calls[0]!.url).toBe("https://data.oxylabs.io/v1/queries");
    expect(calls[0]!.auth).toBe(`Basic ${basicAuthValue("sun_user:sun_pass")}`);
    expect(calls[0]!.body).toEqual({ source: "chatgpt", prompt: ask.prompt, search: true, parse: true, geo_location: "India" });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.model).toBe("gpt-5-5");
    expect(result.searched).toBe(true);
    expect(result.sources.filter((s) => s.kind === "citation")).toHaveLength(1);
    expect(result.sources.filter((s) => s.kind === "inline_link")).toHaveLength(1);
    expect(result.country).toBe("IN");
    expect(markersPass(result.markers)).toBe(true);
    expect(result.vendorRequestId).toBe("7470033199733683201");
  });

  it("treats a faulted job as a target failure and an unparsed page as fail-closed", () => {
    expect(answerFromResult({ content: "<html/>", status_code: 200, url: "https://chatgpt.com/" }, ask, Date.now(), "j")).toMatchObject({ ok: false, error: "schema_unrecognised", permanent: true });
    expect(answerFromResult({ content: { parse_status_code: 12005 }, status_code: 200 }, ask, Date.now(), "j")).toMatchObject({ ok: false, error: "target_blocked" });
  });

  it("maps a rejected user, an exhausted trial and a rate limit", async () => {
    vi.stubGlobal("fetch", async () => respond(401, { message: "Unauthorized" }));
    expect(await collect(ask)).toMatchObject({ ok: false, error: "auth_failed", permanent: true });
    vi.stubGlobal("fetch", async () => respond(403, { message: "Free trial limit reached" }));
    expect(await collect(ask)).toMatchObject({ ok: false, error: "billing_required", permanent: true });
    vi.stubGlobal("fetch", async () => respond(429, { message: "Too many requests" }, { "retry-after": "2" }));
    expect(await collect(ask)).toMatchObject({ ok: false, error: "rate_limited", retryAfterMs: 2_000 });
  });

  it("is disabled without a username:password pair", async () => {
    process.env.OXYLABS_AUTH = "just-a-token";
    expect(await collect(ask)).toMatchObject({ ok: false, error: "oxylabs_disabled" });
    delete process.env.OXYLABS_AUTH;
    expect(await collect(ask)).toMatchObject({ ok: false, error: "oxylabs_disabled" });
  });
});
