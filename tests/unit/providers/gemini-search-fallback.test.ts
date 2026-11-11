import { beforeEach, describe, expect, it, vi } from "vitest";

const state = vi.hoisted(() => ({ calls: [] as boolean[], mode: "search-refused" as "search-refused" | "all-limited" }));

vi.mock("@google/genai", () => ({
  GoogleGenAI: class {
    models = {
      generateContent: async (request: { config?: { tools?: unknown[] } }) => {
        const grounded = Boolean(request.config?.tools?.length);
        state.calls.push(grounded);
        if (state.mode === "all-limited" || grounded) {
          throw new Error('{"error":{"code":429,"message":"You exceeded your current quota","status":"RESOURCE_EXHAUSTED"}}');
        }
        return { text: "Nike", candidates: [{ finishReason: "STOP" }] };
      },
    };
  },
}));

const ask = { systemInstruction: "Answer.", userContent: "Best running shoes?", grounded: true };

describe("Gemini answers when the key has no web-search allowance", () => {
  beforeEach(() => {
    process.env.GEMINI_API_KEY = "test-gemini-key";
    state.calls = [];
    vi.resetModules();
  });

  it("stops spending a request on search once search is refused but the plain question works", async () => {
    state.mode = "search-refused";
    const { generateTextWithGroundingFallback } = await import("@/lib/gemini/client");
    expect((await generateTextWithGroundingFallback(ask)).ok).toBe(true);
    expect(state.calls).toEqual([true, false]);
    state.calls = [];
    expect((await generateTextWithGroundingFallback(ask)).ok).toBe(true);
    expect(state.calls).toEqual([false]);
  });

  it("checks search again when the next collection run starts, with no waiting", async () => {
    state.mode = "search-refused";
    const { generateTextWithGroundingFallback, recheckSearchAllowance } = await import("@/lib/gemini/client");
    await generateTextWithGroundingFallback(ask);
    recheckSearchAllowance();
    state.calls = [];
    await generateTextWithGroundingFallback(ask);
    expect(state.calls).toEqual([true, false]);
  });

  it("keeps trying search when every request is rate limited, not just search", async () => {
    state.mode = "all-limited";
    const { generateTextWithGroundingFallback } = await import("@/lib/gemini/client");
    expect((await generateTextWithGroundingFallback(ask)).ok).toBe(false);
    state.calls = [];
    await generateTextWithGroundingFallback(ask);
    expect(state.calls[0]).toBe(true);
  });
});
