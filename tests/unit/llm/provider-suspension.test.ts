import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { generateStructured } from "@/lib/llm";
import { clearProviderSuspension, providerSuspension, suspendProviderOn } from "@/lib/llm/suspension";

const request = {
  stage: "prompts" as const,
  schemaName: "probe",
  schema: { type: "object", properties: { ok: { type: "boolean" } }, required: ["ok"] },
  systemInstruction: "Answer.",
  userContent: "Say ok.",
  routes: [
    { provider: "openai" as const, model: "gpt-5.6-terra" },
    { provider: "openai" as const, model: "gpt-5.6-luna" },
  ],
};

describe("provider suspension", () => {
  beforeEach(() => {
    process.env.OPENAI_API_KEY = "test-openai-key";
    clearProviderSuspension();
    vi.spyOn(console, "warn").mockImplementation(() => undefined);
  });
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
    delete process.env.OPENAI_API_KEY;
    clearProviderSuspension();
  });

  it("suspends only for errors no retry can fix, and expires", () => {
    expect(suspendProviderOn("openai", "rate_limited:slow down", 0)).toBe(false);
    expect(suspendProviderOn("openai", "billing_required:You have no credits remaining.", 0)).toBe(true);
    expect(providerSuspension("openai", 1_000)).toBe("billing_required");
    // Short, so a top-up with the same key is used again soon.
    expect(providerSuspension("openai", 3 * 60_000)).toBeNull();
  });

  // A Boldin run with an exhausted balance asked OpenAI, retried, and fell back on every call.
  it("stops asking a provider with no credits, on this chain and the next calls", async () => {
    let calls = 0;
    vi.stubGlobal("fetch", async () => {
      calls += 1;
      return new Response(JSON.stringify({ error: { code: "credit_balance_exhausted", type: "insufficient_quota", message: "You have no credits remaining." } }), { status: 429, headers: { "content-type": "application/json" } });
    });
    const first = await generateStructured(request);
    expect(first.ok).toBe(false);
    expect(calls).toBe(1);
    expect(first.attempts.map((attempt) => attempt.error?.split(":")[0])).toEqual(["billing_required", "provider_suspended"]);
    await generateStructured(request);
    expect(calls).toBe(1);
    clearProviderSuspension("openai");
    await generateStructured(request);
    expect(calls).toBe(2);
  });

  it("lifts the skip as soon as the provider answers", async () => {
    suspendProviderOn("openai", "billing_required");
    expect(providerSuspension("openai")).toBe("billing_required");
    let calls = 0;
    vi.stubGlobal("fetch", async () => {
      calls += 1;
      return new Response(JSON.stringify({ choices: [{ finish_reason: "stop", message: { content: "Nike and Asics." } }] }), { status: 200, headers: { "content-type": "application/json" } });
    });
    const { generateText } = await import("@/lib/openai/client");
    await generateText({ systemInstruction: "Answer.", userContent: "hi" }).catch(() => undefined);
    expect(providerSuspension("openai")).toBeNull();
    expect(calls).toBe(1);
  });
});
