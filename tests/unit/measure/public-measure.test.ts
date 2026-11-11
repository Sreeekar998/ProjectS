import { describe, expect, it } from "vitest";
import { publicMeasure } from "@/lib/measure/public";
import type { MeasureResult } from "@/lib/measure/types";

// A reader's export names the surface an answer came from, never the vendor
// behind the route (feedback 2026-09-16). Route ids embed vendor names.
describe("publicMeasure", () => {
  const counts = { planned: 10, captured: 8, analysable: 7 };
  const result = {
    lineage: { providerExperiences: ["chatgpt_oxylabs_web", "chatgpt_cloro_web", "gemini_cloro_web"], engines: ["chatgpt", "gemini"] },
    coverage: { planned: 30, byProvider: { chatgpt_oxylabs_web: counts, chatgpt_cloro_web: { planned: 2, captured: 2, analysable: 2 }, gemini_cloro_web: counts } },
    metrics: { combined: { a: 1 }, chatgpt_oxylabs_web: { a: 2 }, gemini_cloro_web: { a: 3 } },
    presence: { combined: [], chatgpt_oxylabs_web: [] },
    tradeOffs: { combined: { x: 1 } },
    sentiment: { combined: { y: 1 } },
    prompts: [{ promptCandidateId: "p1", text: "q", engine: "chatgpt", route: "chatgpt_oxylabs_web", status: "analysable" }],
  } as unknown as MeasureResult;

  it("re-keys every route-scoped block by surface and drops route ids", () => {
    const pub = publicMeasure(result);
    const json = JSON.stringify(pub);
    expect(json).not.toMatch(/oxylabs|cloro|brightdata|decodo/i);
    expect(pub.lineage.surfaces).toEqual(["ChatGPT on the web", "Gemini on the web"]);
    expect(pub.coverage.bySurface["ChatGPT on the web"]).toEqual({ planned: 12, captured: 10, analysable: 9 });
    expect(Object.keys(pub.metrics).sort()).toEqual(["ChatGPT on the web", "Gemini on the web", "combined"]);
    expect(pub.prompts[0]).toMatchObject({ surface: "ChatGPT on the web" });
    expect("route" in pub.prompts[0]!).toBe(false);
    expect("providerExperiences" in pub.lineage).toBe(false);
    expect("byProvider" in pub.coverage).toBe(false);
  });
});
