import { describe, it, expect } from "vitest";
import { eq } from "drizzle-orm";
import { getDb } from "@/lib/db/client";
import { businessProfileVersions, routePolicies, topics as topicsTable } from "@/lib/db/schema";
import { newId } from "@/lib/ids";
import { createProject } from "@/lib/projects/repository";
import { insertTargetEntity, insertCompetitorCandidates, updateEntity, freezeCompetitiveSet } from "@/lib/landscape/repository";
import { generatePromptSet, approvePromptSet } from "@/lib/prompts/orchestrator";
import { listCandidates } from "@/lib/prompts/repository";
import { addRoutesToCollectionRun, createCollectionRun, recordManualObservation } from "@/lib/collection/orchestrator";
import { listPromptRuns } from "@/lib/collection/repository";
import { measureRun } from "@/lib/measure/service";
import { makeProfile } from "../helpers/profile-fixtures";

// The manual route is how an operator observes the consumer ChatGPT and Gemini
// apps: the app plans the prompts, a person asks them and pastes back exactly
// what they saw. Nothing automated ever submits to those apps.
describe.sequential("manual observation workflow", () => {
  it("plans prompts for the operator, stores a pasted answer, and measures only what was captured", async () => {
    const db = getDb();
    const brand = "TrailStride";
    const rival = "PeakRunner";
    const profile = makeProfile({
      brandName: brand,
      archetype: "ecommerce_dtc_retail",
      industry: "trail running shoes",
      offerings: ["trail running shoes", "hiking boots"],
      audiences: ["Beginners", "Regular users", "Professionals"],
      countries: ["United States"],
      cities: [],
      regulated: false,
      domain: "trailstride.example",
    });
    const project = await createProject({ url: "https://trailstride.example/", marketScope: "global", language: "en" });
    const now = new Date();
    const profileVersionId = newId("bpv");
    await db.insert(businessProfileVersions).values({ id: profileVersionId, projectId: project.id, version: 1, crawlRunId: null, profile: profile as unknown as Record<string, unknown>, fieldProvenance: {}, confirmedAt: now, confirmedBy: "test", createdAt: now }).run();
    for (const [priority, name] of ["Trail running shoes", "Hiking boots", "Waterproof footwear", "Running accessories", "Outdoor apparel"].entries()) {
      await db.insert(topicsTable).values({ id: newId("top"), projectId: project.id, businessProfileVersionId: profileVersionId, name, description: "test topic", priority, status: "confirmed", source: "system", evidenceIds: [], createdAt: now }).run();
    }
    await insertTargetEntity(project.id, brand, profile.identity.domains);
    const [rivalRow] = await insertCompetitorCandidates(project.id, [{ canonicalName: rival, competitorType: "direct", domains: [], reason: "test", confidence: 80, evidenceIds: [] }]);
    await updateEntity(rivalRow!.id, { status: "confirmed" });
    await freezeCompetitiveSet(project.id, profileVersionId);
    const promptSet = await generatePromptSet(project.id);
    expect((await approvePromptSet(promptSet.id, "test-operator")).status).toBe("approved");

    // By-hand capture left the product on 2026-09-14 and its policy row is
    // seeded disabled; the capture path stays for stored rows and QA fixtures,
    // so this test re-enables the row in its own temporary database only.
    await db.update(routePolicies).set({ enabled: "true" }).where(eq(routePolicies.providerExperience, "chatgpt_manual")).run();
    const collectionRun = await createCollectionRun(project.id, ["chatgpt_manual"]);
    const manualRows = await listPromptRuns(collectionRun.id);
    expect(manualRows).toHaveLength(30);
    expect(manualRows.every((row) => row.state === "awaiting_import")).toBe(true);

    const sections = new Map((await listCandidates(promptSet.id)).map((candidate) => [candidate.id, candidate.section]));
    const discoveryRow = manualRows.find((row) => sections.get(row.promptCandidateId) === "Discovery")!;
    const { providerResponseId } = await recordManualObservation(discoveryRow.id, {
      operator: "test-operator",
      responseText: `For rocky trails I'd start with ${rival} for grip, and ${brand} is a lighter option for beginners.`,
      sourceUrls: ["https://reviews.example/trail-shoes"],
      answerCaptureState: "complete",
      sourcesCaptureState: "complete",
      visibleModelMode: "default",
    });
    expect(providerResponseId).toBeTruthy();
    const afterCapture = await listPromptRuns(collectionRun.id);
    expect(afterCapture.find((row) => row.id === discoveryRow.id)?.state).toBe("succeeded");
    expect(afterCapture.filter((row) => row.state === "awaiting_import")).toHaveLength(29);

    // The other 29 are gaps in coverage, never absences of the brand.
    const measure = await measureRun(project.id, collectionRun.id);
    expect(measure.coverage.planned).toBe(30);
    expect(measure.coverage.captured).toBe(1);
    expect(measure.coverage.byProvider.chatgpt_manual).toMatchObject({ planned: 30, captured: 1 });
    expect(measure.scopes.discovery.excluded).toContainEqual({ reason: "not captured", count: 9 });
    const visibility = measure.metrics.combined!.discovery_visibility!;
    expect(visibility.denominator).toBeLessThanOrEqual(1);
    expect(visibility.denominatorObservationIds.every((id) => id === providerResponseId)).toBe(true);

    // Adding an automated route to the same run is idempotent, and a pasted
    // answer can never be recorded against an automated route.
    await addRoutesToCollectionRun(collectionRun.id, ["groq_free_api"]);
    await addRoutesToCollectionRun(collectionRun.id, ["groq_free_api"]);
    const withApi = await listPromptRuns(collectionRun.id);
    const apiRows = withApi.filter((row) => row.providerExperience === "groq_free_api");
    expect(apiRows).toHaveLength(30);
    await expect(recordManualObservation(apiRows[0]!.id, { operator: "test-operator", responseText: "pasted", sourceUrls: [] })).rejects.toThrow(/manual capture is not permitted/);
  }, 60_000);
});
