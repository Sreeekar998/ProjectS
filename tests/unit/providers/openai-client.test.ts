import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { generateText } from "@/lib/openai/client";

function respond(status: number, body: unknown, headers: Record<string, string> = {}) {
  return new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json", ...headers } });
}

const ask = { systemInstruction: "Answer.", userContent: "Best running shoes for beginners?" };

describe("OpenAI adapter", () => {
  beforeEach(() => {
    process.env.OPENAI_API_KEY = "test-openai-key";
  });
  afterEach(() => {
    vi.unstubAllGlobals();
    delete process.env.OPENAI_API_KEY;
  });

  it("asks gpt-5-nano and returns the answer", async () => {
    let sent: any = null;
    let auth: string | null = null;
    vi.stubGlobal("fetch", async (_url: string, init: RequestInit) => {
      sent = JSON.parse(String(init.body));
      auth = new Headers(init.headers).get("authorization");
      return respond(200, { choices: [{ finish_reason: "stop", message: { content: " Nike Pegasus and Asics Novablast. " } }] });
    });
    const result = await generateText(ask);
    expect(result).toMatchObject({ ok: true, text: "Nike Pegasus and Asics Novablast.", finishReason: "stop", searched: false });
    expect(sent.model).toBe("gpt-5-nano");
    expect(sent).not.toHaveProperty("temperature");
    expect(auth).toBe("Bearer test-openai-key");
  });

  it("reports an empty balance as billing, not as a rate limit to retry", async () => {
    vi.stubGlobal("fetch", async () => respond(429, { error: { code: "insufficient_quota", type: "insufficient_quota" } }));
    expect(await generateText(ask)).toMatchObject({ ok: false, error: "billing_required" });
  });

  // OpenAI now puts the empty balance in `code` and "insufficient_quota" in `type`.
  it("reports an exhausted credit balance as billing too", async () => {
    vi.stubGlobal("fetch", async () => respond(429, { error: { code: "credit_balance_exhausted", type: "insufficient_quota", message: "You have no credits remaining." } }));
    expect(await generateText(ask)).toMatchObject({ ok: false, error: "billing_required" });
  });

  it("reports a real rate limit with how long to wait", async () => {
    vi.stubGlobal("fetch", async () => respond(429, { error: { code: "rate_limit_exceeded" } }, { "retry-after": "20" }));
    const result = await generateText(ask);
    expect(result).toMatchObject({ ok: false, error: "rate_limited" });
    expect(result.rateLimit?.retryAfterMs).toBe(20_000);
  });

  it("is disabled without a key", async () => {
    delete process.env.OPENAI_API_KEY;
    expect(await generateText(ask)).toMatchObject({ ok: false, error: "openai_api_disabled" });
  });
});
