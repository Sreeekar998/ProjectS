import { describe, it, expect, vi, afterEach } from "vitest";
import fs from "node:fs";
import path from "node:path";
import { getDb } from "@/lib/db/client";
import { businessProfileVersions, providerResponses, topics as topicsTable } from "@/lib/db/schema";
import { eq } from "drizzle-orm";
import { newId } from "@/lib/ids";
import { createProject } from "@/lib/projects/repository";
import { insertTargetEntity, insertCompetitorCandidates, updateEntity, freezeCompetitiveSet } from "@/lib/landscape/repository";
import { generatePromptSet, approvePromptSet } from "@/lib/prompts/orchestrator";
import { createCollectionRun, runAutomatedPromptRun, runVendorCanary, switchAutomatedRoute, addRoutesToCollectionRun, nextRouteForEngine, routeAvailability } from "@/lib/collection/orchestrator";
import { listPromptRuns } from "@/lib/collection/repository";
import { listArtifacts } from "@/lib/evidence/artifacts";
import { measureRun } from "@/lib/measure/service";
import { resetVendorHealth } from "@/lib/collection/vendor-health";
import { makeProfile } from "../helpers/profile-fixtures";
import { BRIGHTDATA_RECORD, CLORO_RESULT } from "../fixtures/vendor-payloads";

async function approvedProject(marketScope = "AE") {
  const db = getDb();
  const brand = "TrailStride";
  const profile = makeProfile({
    brandName: brand,
    archetype: "ecommerce_dtc_retail",
    industry: "trail running shoes",
    offerings: ["trail running shoes", "hiking boots"],
    audiences: ["Beginners", "Regular users", "Professionals"],
    countries: ["United Arab Emirates"],
    cities: [],
    regulated: false,
    domain: "trailstride.example",
  });
  const project = await createProject({ url: "https://trailstride.example/", marketScope, language: "en" });
  const now = new Date();
  const profileVersionId = newId("bpv");
  await db.insert(businessProfileVersions).values({ id: profileVersionId, projectId: project.id, version: 1, crawlRunId: null, profile: profile as unknown as Record<string, unknown>, fieldProvenance: {}, confirmedAt: now, confirmedBy: "test", createdAt: now }).run();
  for (const [priority, name] of ["Trail running shoes", "Hiking boots", "Waterproof footwear", "Running accessories", "Outdoor apparel"].entries()) {
    await db.insert(topicsTable).values({ id: newId("top"), projectId: project.id, businessProfileVersionId: profileVersionId, name, description: "test topic", priority, status: "confirmed", source: "system", evidenceIds: [], createdAt: now }).run();
  }
  await insertTargetEntity(project.id, brand, profile.identity.domains);
  const [rival] = await insertCompetitorCandidates(project.id, [{ canonicalName: "Salomon", competitorType: "direct", domains: [], reason: "test", confidence: 80, evidenceIds: [] }]);
  await updateEntity(rival!.id, { status: "confirmed" });
  await freezeCompetitiveSet(project.id, profileVersionId);
  const promptSet = await generatePromptSet(project.id);
  expect((await approvePromptSet(promptSet.id, "test")).status).toBe("approved");
  return { project, brand };
}

function json(status: number, body: unknown, headers: Record<string, string> = {}) {
  return new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json", ...headers } });
}

afterEach(() => {
  vi.unstubAllGlobals();
  delete process.env.BRIGHTDATA_API_TOKEN;
  delete process.env.CLORO_API_KEY;
  delete process.env.DECODO_AUTH_TOKEN;
  resetVendorHealth();
});

describe.sequential("consumer-web collection routes", () => {
  it("picks one keyed consumer-web route per enabled engine by default, in preference order", async () => {
    const { project } = await approvedProject();
    process.env.BRIGHTDATA_API_TOKEN = "test-brightdata";
    process.env.CLORO_API_KEY = "test-cloro";
    process.env.SUN_ENGINES = "chatgpt,gemini";
    const run = await createCollectionRun(project.id);
    const routes = new Set((await listPromptRuns(run.id)).map((row) => row.providerExperience));
    // cloro outranks Bright Data for ChatGPT since 2026-09-15, and is the only Gemini provider.
    expect([...routes].sort()).toEqual(["chatgpt_cloro_web", "gemini_cloro_web"]);
    expect((await listPromptRuns(run.id)).every((row) => row.state === "planned")).toBe(true);
  }, 60_000);

  it("measures ChatGPT only by default (Gemini hidden on 2026-09-15) and honours a preferred-route override", async () => {
    const { project } = await approvedProject();
    process.env.BRIGHTDATA_API_TOKEN = "test-brightdata";
    process.env.CLORO_API_KEY = "test-cloro";
    delete process.env.SUN_ENGINES;
    const run = await createCollectionRun(project.id);
    expect([...new Set((await listPromptRuns(run.id)).map((row) => row.providerExperience))]).toEqual(["chatgpt_cloro_web"]);
    expect(nextRouteForEngine("gemini")).toBeNull();
    // Free test runs on Bright Data while cloro credits are kept for the demo.
    process.env.SUN_PREFERRED_ROUTES = "chatgpt_brightdata_web";
    expect(nextRouteForEngine("chatgpt")).toBe("chatgpt_brightdata_web");
    expect(routeAvailability().map((route) => route.id)[0]).toBe("chatgpt_brightdata_web");
    expect(routeAvailability().find((route) => route.id === "gemini_cloro_web")?.enabled).toBe(false);
    delete process.env.SUN_PREFERRED_ROUTES;
  }, 60_000);

  it("refuses to plan a run when no provider key is present", async () => {
    const { project } = await approvedProject();
    await expect(createCollectionRun(project.id)).rejects.toThrow(/No collection provider is connected/);
  }, 60_000);

  it("stores a web answer with honest provenance and keeps the vendor payload as evidence", async () => {
    const { project, brand } = await approvedProject("AE");
    process.env.BRIGHTDATA_API_TOKEN = "test-brightdata";
    let sent: any = null;
    vi.stubGlobal("fetch", async (_url: string, init?: RequestInit) => {
      sent = init?.body ? JSON.parse(String(init.body)) : null;
      return json(200, [{ ...BRIGHTDATA_RECORD, answer_text_markdown: `${BRIGHTDATA_RECORD.answer_text_markdown}\n\n${brand} is a solid choice for wide feet.` }]);
    });
    const run = await createCollectionRun(project.id, ["chatgpt_brightdata_web"]);
    const row = (await listPromptRuns(run.id))[0]!;
    const outcome = await runAutomatedPromptRun(row.id);
    expect(outcome.state).toBe("succeeded");
    // The project's market country is the execution country.
    expect(sent[0].country).toBe("AE");

    const stored = await getDb().select().from(providerResponses).where(eq(providerResponses.promptRunId, row.id)).get();
    expect(stored).toMatchObject({
      providerExperience: "chatgpt_brightdata_web",
      route: "consumer_app",
      method: "automated_partner",
      accountTier: "signed_out",
      searchState: "on",
      visibleModelMode: "unknown",
      observerRegion: "US",
      observerRegionSource: "provider_declared",
      sourcesCaptureState: "complete",
      answerCaptureState: "complete",
      adapterVersion: "brightdata-consumer-adapter@2",
    });
    expect(stored!.sourceUrls).toHaveLength(2);
    expect(stored!.inlineCitationUrls).toContain("https://trailstride.example/shoes");
    // The placeholder-restored brand names are in the stored answer text.
    expect(stored!.responseText).toContain("Salomon Speedcross 6");
    expect(stored!.intendedMarket).toBeTruthy();
    const session = stored!.sessionProfile as Record<string, unknown>;
    expect(session.signedIn).toBe(false);
    expect(session.freshConversation).toBe(true);
    expect(String(session.notes)).toContain("Bright Data");

    const artifacts = listArtifacts(project.id, stored!.id);
    expect(artifacts.map((a) => a.kind).sort()).toEqual(["page.html", "payload.json"]);
    const payload = JSON.parse(fs.readFileSync(path.join(process.env.SUN_EVIDENCE_DIR!, artifacts.find((a) => a.kind === "payload.json")!.relativePath), "utf8"));
    expect(payload.vendor).toBe("brightdata");
    expect(payload.payload.prompt).toBe(BRIGHTDATA_RECORD.prompt);

    const measure = await measureRun(project.id, run.id);
    expect(measure.coverage.byEngine.chatgpt).toMatchObject({ planned: 30, captured: 1 });
    expect(Object.keys(measure.metrics)).toContain("chatgpt");
  }, 60_000);

  it("marks an answer without site markers as unverified instead of counting it", async () => {
    const { project } = await approvedProject();
    process.env.CLORO_API_KEY = "test-cloro";
    vi.stubGlobal("fetch", async (url: string) => {
      if (url.endsWith("/v1/monitor/chatgpt")) {
        // No utm tags, no page, no queries: nothing proves the surface.
        return json(200, { success: true, result: { ...CLORO_RESULT, html: null, searchQueries: [], sources: [{ position: 1, url: "https://reviews.example/trail-shoes", label: "x" }], citationPills: [] } });
      }
      throw new Error(`unexpected ${url}`);
    });
    const run = await createCollectionRun(project.id, ["chatgpt_cloro_web"]);
    const row = (await listPromptRuns(run.id))[0]!;
    expect((await runAutomatedPromptRun(row.id)).state).toBe("succeeded");
    const stored = await getDb().select().from(providerResponses).where(eq(providerResponses.promptRunId, row.id)).get();
    expect(stored).toMatchObject({ sourcesCaptureState: "unknown", answerCaptureState: "unknown" });
  }, 60_000);

  it("judges a canary the way it judges an answer", async () => {
    process.env.BRIGHTDATA_API_TOKEN = "test-brightdata";
    vi.stubGlobal("fetch", async () => json(200, [BRIGHTDATA_RECORD]));
    expect(await runVendorCanary("chatgpt_brightdata_web", "AE")).toMatchObject({ ok: true, route: "chatgpt_brightdata_web", citations: 2, searched: true });
    vi.stubGlobal("fetch", async () => json(401, { error: "nope" }));
    expect(await runVendorCanary("chatgpt_brightdata_web", "AE")).toMatchObject({ ok: false, reason: "auth_failed" });
  });

  it("switches only between routes for the same engine on the same surface", async () => {
    const { project } = await approvedProject();
    process.env.BRIGHTDATA_API_TOKEN = "test-brightdata";
    process.env.CLORO_API_KEY = "test-cloro";
    const run = await createCollectionRun(project.id, ["chatgpt_brightdata_web"]);
    await expect(switchAutomatedRoute(run.id, "chatgpt_brightdata_web", "openai_api")).rejects.toThrow(/same surface/);
    await expect(switchAutomatedRoute(run.id, "chatgpt_brightdata_web", "gemini_cloro_web")).rejects.toThrow(/same assistant/);
    await switchAutomatedRoute(run.id, "chatgpt_brightdata_web", "chatgpt_cloro_web");
    const rows = await listPromptRuns(run.id);
    expect(rows.filter((row) => row.providerExperience === "chatgpt_brightdata_web" && row.state === "policy_disabled")).toHaveLength(30);
    expect(rows.filter((row) => row.providerExperience === "chatgpt_cloro_web" && row.state === "planned")).toHaveLength(30);
    const measure = await measureRun(project.id, run.id);
    expect(measure.coverage.planned).toBe(30);
  }, 60_000);

  it("plans retired API and by-hand routes, and keyless web routes, as policy_disabled", async () => {
    const { project } = await approvedProject();
    process.env.BRIGHTDATA_API_TOKEN = "test-brightdata";
    const run = await createCollectionRun(project.id, ["chatgpt_brightdata_web"]);
    await addRoutesToCollectionRun(run.id, ["openai_api", "chatgpt_manual", "chatgpt_decodo_web"]);
    const rows = await listPromptRuns(run.id);
    for (const route of ["openai_api", "chatgpt_manual", "chatgpt_decodo_web"]) {
      const own = rows.filter((row) => row.providerExperience === route);
      expect(own).toHaveLength(30);
      expect(own.every((row) => row.state === "policy_disabled")).toBe(true);
    }
    const measure = await measureRun(project.id, run.id);
    expect(measure.coverage.planned).toBe(30);
  }, 60_000);
});
