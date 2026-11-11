import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { generateText } from "@/lib/cerebras/client";

function respond(status: number, body: unknown, headers: Record<string, string> = {}) {
  return new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json", ...headers } });
}

describe("Cerebras adapter", () => {
  beforeEach(() => {
    process.env.CEREBRAS_API_KEY = "test-cerebras-key";
  });
  afterEach(() => {
    vi.unstubAllGlobals();
    delete process.env.CEREBRAS_API_KEY;
  });

  it("returns the answer and marks a cut-off answer through its finish reason", async () => {
    const calls: Array<{ url: string; body: any; auth: string | null }> = [];
    vi.stubGlobal("fetch", async (url: string, init: RequestInit) => {
      calls.push({ url, body: JSON.parse(String(init.body)), auth: new Headers(init.headers).get("authorization") });
      return respond(200, { choices: [{ finish_reason: "length", message: { content: " Nike and Asics are both good. " } }] });
    });
    const result = await generateText({ systemInstruction: "Answer.", userContent: "Best running shoes?" });
    expect(result.ok).toBe(true);
    expect(result.text).toBe("Nike and Asics are both good.");
    expect(result.finishReason).toBe("length");
    expect(result.searched).toBe(false);
    expect(calls[0]!.url).toBe("https://api.cerebras.ai/v1/chat/completions");
    expect(calls[0]!.body.model).toBe("gpt-oss-120b");
    expect(calls[0]!.auth).toBe("Bearer test-cerebras-key");
  });

  // Named, a rejected key or spent credits pause the lane instead of failing every prompt.
  it("reports a rejected key and spent credits as account problems", async () => {
    vi.stubGlobal("fetch", async () => respond(401, { error: "bad key" }));
    expect((await generateText({ systemInstruction: "Answer.", userContent: "Best running shoes?" })).error).toBe("auth_failed");
    vi.stubGlobal("fetch", async () => respond(402, { error: "no credits" }));
    expect((await generateText({ systemInstruction: "Answer.", userContent: "Best running shoes?" })).error).toBe("billing_required");
  });

  it("reports a rate limit with how long to wait, never as an answer", async () => {
    vi.stubGlobal("fetch", async () => respond(429, { error: "too many" }, { "retry-after": "42" }));
    const result = await generateText({ systemInstruction: "Answer.", userContent: "Best running shoes?" });
    expect(result.ok).toBe(false);
    expect(result.error).toBe("rate_limited");
    expect(result.rateLimit?.retryAfterMs).toBe(42_000);
  });

  it("is disabled without a key, so the lane never runs", async () => {
    delete process.env.CEREBRAS_API_KEY;
    const result = await generateText({ systemInstruction: "Answer.", userContent: "Best running shoes?" });
    expect(result).toMatchObject({ ok: false, error: "cerebras_api_disabled" });
  });
});
