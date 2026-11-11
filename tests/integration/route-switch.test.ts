import { describe, it, expect, vi, afterEach } from "vitest";
import { getDb } from "@/lib/db/client";
import { businessProfileVersions, topics as topicsTable } from "@/lib/db/schema";
import { newId } from "@/lib/ids";
import { createProject } from "@/lib/projects/repository";
import { insertTargetEntity, insertCompetitorCandidates, updateEntity, freezeCompetitiveSet } from "@/lib/landscape/repository";
import { generatePromptSet, approvePromptSet } from "@/lib/prompts/orchestrator";
import { createCollectionRun, runAutomatedPromptRun, switchAutomatedRoute } from "@/lib/collection/orchestrator";
import { listPromptRuns } from "@/lib/collection/repository";
import { measureRun } from "@/lib/measure/service";
import { resetVendorHealth } from "@/lib/collection/vendor-health";
import { makeProfile } from "../helpers/profile-fixtures";
import { BRIGHTDATA_RECORD } from "../fixtures/vendor-payloads";

async function approvedProject() {
  const db = getDb();
  const brand = "Northwind Rackets";
  const profile = makeProfile({
    brandName: brand, archetype: "ecommerce_dtc_retail", industry: "tennis equipment",
    offerings: ["tennis rackets", "tennis shoes", "racket strings"], audiences: ["Beginners", "Club players", "Coaches"],
    countries: ["United States"], cities: [], regulated: false, domain: "northwindrackets.example",
  });
  const project = await createProject({ url: "https://northwindrackets.example/", marketScope: "global", language: "en" });
  const now = new Date();
  const profileVersionId = newId("bpv");
  await db.insert(businessProfileVersions).values({ id: profileVersionId, projectId: project.id, version: 1, crawlRunId: null, profile: profile as unknown as Record<string, unknown>, fieldProvenance: {}, confirmedAt: now, confirmedBy: "test", createdAt: now }).run();
  for (const [priority, name] of ["Tennis rackets", "Tennis shoes", "Strings", "Court accessories", "Coaching gear"].entries()) {
    await db.insert(topicsTable).values({ id: newId("top"), projectId: project.id, businessProfileVersionId: profileVersionId, name, description: "test topic", priority, status: "confirmed", source: "system", evidenceIds: [], createdAt: now }).run();
  }
  await insertTargetEntity(project.id, brand, profile.identity.domains);
  const [rival] = await insertCompetitorCandidates(project.id, [{ canonicalName: "Baseline Sports", competitorType: "direct", domains: [], reason: "test", confidence: 80, evidenceIds: [] }]);
  await updateEntity(rival!.id, { status: "confirmed" });
  await freezeCompetitiveSet(project.id, profileVersionId);
  const promptSet = await generatePromptSet(project.id);
  expect((await approvePromptSet(promptSet.id, "test")).status).toBe("approved");
  return { project, brand };
}

afterEach(() => {
  vi.unstubAllGlobals();
  delete process.env.BRIGHTDATA_API_TOKEN;
  delete process.env.CLORO_API_KEY;
  delete process.env.DECODO_AUTH_TOKEN;
  resetVendorHealth();
});

describe.sequential("ChatGPT answers moving from one collection provider to the next", () => {
  it("asks each assistant through one route by default, preferring cloro for ChatGPT", async () => {
    const { project } = await approvedProject();
    process.env.CLORO_API_KEY = "test-cloro";
    process.env.DECODO_AUTH_TOKEN = "test-decodo";
    process.env.BRIGHTDATA_API_TOKEN = "test-brightdata";
    process.env.SUN_ENGINES = "chatgpt,gemini";
    const run = await createCollectionRun(project.id);
    const routes = new Set((await listPromptRuns(run.id)).map((row) => row.providerExperience));
    expect([...routes].sort()).toEqual(["chatgpt_cloro_web", "gemini_cloro_web"]);
    delete process.env.SUN_ENGINES;
  }, 60_000);

  it("falls through to the next keyed provider when the preferred one has no key", async () => {
    const { project } = await approvedProject();
    process.env.DECODO_AUTH_TOKEN = "test-decodo";
    const run = await createCollectionRun(project.id);
    const routes = new Set((await listPromptRuns(run.id)).map((row) => row.providerExperience));
    expect([...routes]).toEqual(["chatgpt_decodo_web"]);
  }, 60_000);

  it("keeps collected answers, moves only unfinished questions, and still plans exactly thirty", async () => {
    const { project, brand } = await approvedProject();
    process.env.BRIGHTDATA_API_TOKEN = "test-brightdata";
    process.env.CLORO_API_KEY = "test-cloro";
    vi.stubGlobal("fetch", async () => new Response(JSON.stringify([{ ...BRIGHTDATA_RECORD, answer_text_markdown: `${brand} is a solid choice for club players, alongside Baseline Sports.` }]), { status: 200, headers: { "content-type": "application/json" } }));
    const run = await createCollectionRun(project.id, ["chatgpt_brightdata_web"]);
    const rows0 = await listPromptRuns(run.id);
    for (const row of rows0.slice(0, 2)) await runAutomatedPromptRun(row.id);

    await switchAutomatedRoute(run.id, "chatgpt_brightdata_web", "chatgpt_cloro_web");
    const rows = await listPromptRuns(run.id);
    const brightdata = rows.filter((row) => row.providerExperience === "chatgpt_brightdata_web");
    const cloro = rows.filter((row) => row.providerExperience === "chatgpt_cloro_web");
    expect(brightdata.filter((row) => row.state === "succeeded")).toHaveLength(2);
    expect(brightdata.filter((row) => row.state === "policy_disabled")).toHaveLength(28);
    expect(cloro.filter((row) => row.state === "planned")).toHaveLength(28);
    expect(new Set(cloro.map((row) => row.promptCandidateId)).size).toBe(28);

    const measure = await measureRun(project.id, run.id);
    expect(measure.coverage.planned).toBe(30);
    expect(measure.coverage.byEngine.chatgpt).toMatchObject({ planned: 30, captured: 2 });
  }, 60_000);
});
