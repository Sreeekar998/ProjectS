// Measurement lineage, end to end on a temporary database: the competitive
// set stays pinned, analysis links against the frozen set, a second run on
// the same questions plans every prompt again, closing a run freezes a
// snapshot, and History compares runs honestly.

import { describe, it, expect, beforeAll } from "vitest";
import { eq } from "drizzle-orm";
import { getDb } from "@/lib/db/client";
import { businessProfileVersions, collectionRuns, topics as topicsTable } from "@/lib/db/schema";
import { newId } from "@/lib/ids";
import { sha256Hex } from "@/lib/text/similarity";
import { createProject } from "@/lib/projects/repository";
import { insertTargetEntity, insertCompetitorCandidates, updateEntity, freezeCompetitiveSet, getLatestCompetitiveSetVersion } from "@/lib/landscape/repository";
import { generatePromptSet, approvePromptSet } from "@/lib/prompts/orchestrator";
import { listCandidates } from "@/lib/prompts/repository";
import { createCollectionRun } from "@/lib/collection/orchestrator";
import { insertProviderResponse, listPromptRuns, updatePromptRun } from "@/lib/collection/repository";
import { finaliseCollectionRun, runFullyAnalysed } from "@/lib/collection/finalise";
import { analyseObservationById } from "@/lib/analysis/service";
import { ANALYSIS_VERSION } from "@/lib/analysis/types";
import { measureRun } from "@/lib/measure/service";
import { latestSnapshotForRun, listMeasurementHistory, previousRunForComparison, resultForRun } from "@/lib/measure/snapshots";
import { makeProfile } from "../helpers/profile-fixtures";

const BRAND = "TrailStride";
const RIVAL = "PeakRunner";
const LATER_RIVAL = "Ridgeline";

async function answer(projectId: string, promptRunId: string, route: string, text: string, urls: string[] = []) {
  const id = newId("pres");
  await insertProviderResponse({
    id, promptRunId, providerExperience: route, route: "consumer_app", method: "automated_partner", visibleModelMode: "unknown", searchState: "on",
    accountTier: "signed_out", locale: "en", observerRegion: "IN", observerRegionSource: "provider_declared", intendedMarket: "IN", sessionProfile: null,
    responseText: text, sourceUrls: urls, inlineCitationUrls: [], answerCaptureState: "complete", sourcesCaptureState: urls.length ? "complete" : "none_present",
    rawHash: sha256Hex(text), latencyMs: 10, observedAt: new Date(), adapterVersion: "test@1", parserVersion: null, policyVersion: "route-policy@2", isFixture: true, fixtureLabel: "lineage-test",
  });
  await updatePromptRun(promptRunId, { state: "succeeded", attempts: 1 });
  await analyseObservationById(projectId, id);
  return id;
}

describe.sequential("measurement lineage", () => {
  let projectId: string;
  let profileVersionId: string;
  let rivalId: string;

  beforeAll(async () => {
    process.env.OXYLABS_AUTH = "mock:oxylabs";
    const db = getDb();
    const profile = makeProfile({ brandName: BRAND, archetype: "ecommerce_dtc_retail", industry: "trail running shoes", offerings: ["trail running shoes", "hiking boots"], audiences: ["Beginners", "Regular users", "Professionals"], countries: ["India"], cities: [], regulated: false, domain: "trailstride.example" });
    const project = await createProject({ url: "https://trailstride.example/", marketScope: "IN", language: "en" });
    projectId = project.id;
    const now = new Date();
    profileVersionId = newId("bpv");
    await db.insert(businessProfileVersions).values({ id: profileVersionId, projectId, version: 1, crawlRunId: null, profile: profile as unknown as Record<string, unknown>, fieldProvenance: {}, confirmedAt: now, confirmedBy: "test", createdAt: now }).run();
    for (const [priority, name] of ["Trail running shoes", "Hiking boots", "Waterproof footwear", "Running accessories", "Outdoor apparel"].entries()) {
      await db.insert(topicsTable).values({ id: newId("top"), projectId, businessProfileVersionId: profileVersionId, name, description: "t", priority, status: "confirmed", source: "system", evidenceIds: [], createdAt: now }).run();
    }
    await insertTargetEntity(projectId, BRAND, ["trailstride.example"]);
    const [rival] = await insertCompetitorCandidates(projectId, [{ canonicalName: RIVAL, competitorType: "direct", domains: ["peakrunner.example"], reason: "t", confidence: 80, evidenceIds: [] }]);
    rivalId = rival!.id;
    await updateEntity(rivalId, { status: "confirmed" });
    await freezeCompetitiveSet(projectId, profileVersionId);
    const promptSet = await generatePromptSet(projectId);
    expect((await approvePromptSet(promptSet.id, "test")).status).toBe("approved");
  });

  it("plans every prompt again for a second run on the same approved questions", async () => {
    const first = await createCollectionRun(projectId, ["chatgpt_oxylabs_web"]);
    const second = await createCollectionRun(projectId, ["chatgpt_oxylabs_web"]);
    expect((await listPromptRuns(first.id)).filter((row) => row.state === "planned")).toHaveLength(30);
    expect((await listPromptRuns(second.id)).filter((row) => row.state === "planned")).toHaveLength(30);
    // Adding the same route to a run still never duplicates a question.
    const { addRoutesToCollectionRun } = await import("@/lib/collection/orchestrator");
    await addRoutesToCollectionRun(second.id, ["chatgpt_oxylabs_web"]);
    expect(await listPromptRuns(second.id)).toHaveLength(30);
  });

  it("keeps the competitive set pinned and links analysis against the frozen set, even after a rival is confirmed later", async () => {
    const run = await createCollectionRun(projectId, ["chatgpt_oxylabs_web"]);
    const rows = await listPromptRuns(run.id);
    const sections = new Map((await listCandidates(run.promptSetId)).map((c) => [c.id, c.section]));
    const discovery = rows.filter((row) => sections.get(row.promptCandidateId) === "Discovery");
    const pinned = (await getLatestCompetitiveSetVersion(projectId))!;

    // A newcomer is named in the first answer BEFORE it exists as a rival.
    // The analyzer proposes an untracked name only when it is also written
    // mid-sentence, so the answer names the newcomer in prose as well.
    const before = await answer(projectId, discovery[0]!.id, "chatgpt_oxylabs_web", `Top picks:\n\n1. **${RIVAL}** — grippy.\n2. **${LATER_RIVAL}** — light.\n3. **${BRAND}** — good value.\n\nFor wet trails, ${RIVAL} is the safest pick, though ${LATER_RIVAL} is catching up.`);

    // The landscape changes: the newcomer is confirmed and the set re-frozen (v2).
    const [later] = await insertCompetitorCandidates(projectId, [{ canonicalName: LATER_RIVAL, competitorType: "direct", domains: ["ridgeline.example"], reason: "t", confidence: 70, evidenceIds: [] }]);
    await updateEntity(later!.id, { status: "confirmed" });
    const refrozen = await freezeCompetitiveSet(projectId, profileVersionId);
    expect(refrozen.version).toBe(pinned.version + 1);

    // A second answer analysed AFTER the change still links against the pinned set.
    await answer(projectId, discovery[1]!.id, "chatgpt_oxylabs_web", `Top picks:\n\n1. **${LATER_RIVAL}** — light.\n2. **${RIVAL}** — grippy.\n\nMost runners prefer ${LATER_RIVAL} for long days.`);

    const measure = await measureRun(projectId, run.id);
    expect(measure.lineage.competitiveSetVersionId).toBe(pinned.id);
    expect(measure.lineage.competitiveSetSource).toBe("pinned");
    expect(measure.lineage.analysisVersions).toEqual([ANALYSIS_VERSION]);
    expect(measure.lineage.staleAnalyses).toBe(0);
    // The newcomer is untracked in this measurement: named, counted nowhere.
    expect(measure.brands.map((row) => row.name).sort()).toEqual([BRAND, LATER_RIVAL, RIVAL].sort());
    expect(measure.brands.find((row) => row.name === LATER_RIVAL)!.relation).toBe("emerging");
    expect(measure.metrics.combined!.discovery_share_of_voice!.denominator).toBe(3);
    const firstRow = measure.prompts.find((row) => row.observationId === before)!;
    expect(firstRow.brandsNamed).toEqual([RIVAL, BRAND]);
    expect(firstRow.untrackedNamed).toContain(LATER_RIVAL);
  });

  it("closes a complete run automatically, freezes a snapshot, and compares later runs honestly", async () => {
    const db = getDb();
    // A fresh prompt set for the re-frozen set, so the earlier runs become a break.
    const promptSet = await generatePromptSet(projectId, { force: true });
    expect((await approvePromptSet(promptSet.id, "test")).status).toBe("approved");

    const run = await createCollectionRun(projectId, ["chatgpt_oxylabs_web"]);
    expect(run.promptSetId).toBe(promptSet.id);
    const rows = await listPromptRuns(run.id);
    for (const row of rows) await answer(projectId, row.id, "chatgpt_oxylabs_web", `${BRAND} is a solid choice. ${RIVAL} is more established.`, ["https://trailstride.example/shoes"]);
    expect(await runFullyAnalysed(run.id)).toBe(true);
    const closed = await finaliseCollectionRun(run.id, "auto");
    expect(closed.status).toBe("completed");
    expect(closed.finalisedBy).toBe("auto");
    const snapshot = await latestSnapshotForRun(run.id);
    expect(snapshot).toBeDefined();
    expect(snapshot!.analysisVersions).toEqual([ANALYSIS_VERSION]);
    expect(snapshot!.coverage).toMatchObject({ planned: 30, captured: 30, analysable: 30 });

    // Served from the snapshot, not recomputed.
    const { snapshot: served, result } = await resultForRun(projectId, run.id);
    expect(served?.id).toBe(snapshot!.id);
    expect(result.collectionRunId).toBe(run.id);

    // The earlier run measured a different prompt set: a break, reported as such.
    const createdAt = new Date((await db.select().from(collectionRuns).where(eq(collectionRuns.id, run.id)).get())!.createdAt).getTime() + 1;
    const previous = await previousRunForComparison(projectId, result, createdAt);
    expect(previous).not.toBeNull();
    expect(previous!.comparability.level).toBe("break");
    expect(previous!.comparability.breaks.join(" ")).toContain("questions changed");

    const history = await listMeasurementHistory(projectId, run.id);
    const mine = history.find((entry) => entry.runId === run.id)!;
    expect(mine.status).toBe("final");
    expect(mine.comparedToSelected).toBeNull();
    expect(history.filter((entry) => entry.runId !== run.id).every((entry) => entry.comparedToSelected?.level === "break" || entry.coverage.analysable === 0)).toBe(true);
  });

  it("refuses a run id from another project", async () => {
    const other = await createProject({ url: "https://other.example/", marketScope: "IN", language: "en" });
    const run = (await db().select().from(collectionRuns).where(eq(collectionRuns.projectId, projectId)).all())[0]!;
    await expect(measureRun(other.id, run.id)).rejects.toThrow(/No measurement run/);
  });
});

function db() {
  return getDb();
}
