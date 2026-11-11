import { afterEach, describe, expect, it } from "vitest";
import { toGeminiSchema, toOpenAiStrictSchema } from "@/lib/llm/schema";
import { estimateCostUsd, paidAllowedForStage, routesForStage } from "@/lib/llm/routing";

const schema = { type: "object", properties: { name: { type: "string", minLength: 2 }, website: { type: ["string", "null"] }, items: { type: "array", maxItems: 3, items: { type: "string" } } }, required: ["name"] };

describe("schema dialects", () => {
  it("makes every property required and closes objects for OpenAI strict mode", () => {
    const strict = toOpenAiStrictSchema(schema) as { required: string[]; additionalProperties: boolean; properties: Record<string, Record<string, unknown>> };
    expect(strict.required).toEqual(["name", "website", "items"]);
    expect(strict.additionalProperties).toBe(false);
    expect(strict.properties.name!.minLength).toBeUndefined();
  });

  it("uses nullable single types for Gemini and drops additionalProperties", () => {
    const gemini = toGeminiSchema({ ...schema, additionalProperties: false }) as { properties: Record<string, Record<string, unknown>>; additionalProperties?: boolean };
    expect(gemini.properties.website).toMatchObject({ type: "string", nullable: true });
    expect(gemini.additionalProperties).toBeUndefined();
    expect((gemini.properties.items as { maxItems?: number }).maxItems).toBeUndefined();
  });
});

describe("paid routing gate", () => {
  const saved = { ...process.env };
  afterEach(() => {
    process.env = { ...saved };
  });

  it("allows paid OpenAI for Understand and Prompts only, unless Landscape is opted in", () => {
    delete process.env.SUN_ALLOW_PAID_LANDSCAPE;
    delete process.env.SUN_LLM_NO_PAID;
    expect(paidAllowedForStage("extract")).toBe(true);
    expect(paidAllowedForStage("prompts")).toBe(true);
    expect(routesForStage("competitors").some((route) => route.provider === "openai")).toBe(false);
    process.env.SUN_ALLOW_PAID_LANDSCAPE = "1";
    expect(routesForStage("competitors")[0]?.provider).toBe("openai");
    process.env.SUN_LLM_NO_PAID = "1";
    expect(routesForStage("extract").some((route) => route.provider === "openai")).toBe(false);
  });

  it("never routes a retired Gemini 2.5 model", () => {
    for (const stage of ["extract", "classify", "synthesize", "locate", "competitors", "topics", "prompts", "judge", "search"] as const) {
      expect(routesForStage(stage).some((route) => route.model.startsWith("gemini-2.5"))).toBe(false);
    }
  });

  it("prices OpenAI calls and treats free-tier Gemini as zero", () => {
    delete process.env.SUN_GEMINI_BILLING;
    expect(estimateCostUsd("gpt-5.6-luna", { inputTokens: 1_000_000, outputTokens: 0 })).toBe(0.2);
    expect(estimateCostUsd("gemini-3.8-flash", { inputTokens: 1_000_000, outputTokens: 1_000_000 })).toBe(0);
  });
});
