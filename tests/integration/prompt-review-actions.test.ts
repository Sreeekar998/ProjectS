import { describe, it, expect } from "vitest";
import { getDb } from "@/lib/db/client";
import { businessProfileVersions, topics as topicsTable } from "@/lib/db/schema";
import { newId } from "@/lib/ids";
import { createProject } from "@/lib/projects/repository";
import { insertTargetEntity, insertCompetitorCandidates, updateEntity, freezeCompetitiveSet } from "@/lib/landscape/repository";
import { generatePromptSet, updatePromptSelection, PromptReviewError } from "@/lib/prompts/orchestrator";
import { listCandidates } from "@/lib/prompts/repository";
import { makeProfile } from "../helpers/profile-fixtures";

async function reviewableSet() {
  const db = getDb();
  const brand = "Harbor Cycles";
  const profile = makeProfile({
    brandName: brand,
    archetype: "ecommerce_dtc_retail",
    industry: "bicycles",
    offerings: ["road bikes", "electric bikes", "bike helmets"],
    audiences: ["Beginners", "Commuters", "Racers"],
    countries: ["United States"],
    cities: [],
    regulated: false,
    domain: "harborcycles.example",
  });
  const project = await createProject({ url: "https://harborcycles.example/", marketScope: "global", language: "en" });
  const now = new Date();
  const profileVersionId = newId("bpv");
  await db.insert(businessProfileVersions).values({ id: profileVersionId, projectId: project.id, version: 1, crawlRunId: null, profile: profile as unknown as Record<string, unknown>, fieldProvenance: {}, confirmedAt: now, confirmedBy: "test", createdAt: now }).run();
  for (const [priority, name] of ["Road bikes", "Electric bikes", "Helmets", "Commuting gear", "Bike repairs"].entries()) {
    await db.insert(topicsTable).values({ id: newId("top"), projectId: project.id, businessProfileVersionId: profileVersionId, name, description: "test topic", priority, status: "confirmed", source: "system", evidenceIds: [], createdAt: now }).run();
  }
  await insertTargetEntity(project.id, brand, profile.identity.domains);
  const [rival] = await insertCompetitorCandidates(project.id, [{ canonicalName: "Summit Wheels", competitorType: "direct", domains: [], reason: "test", confidence: 80, evidenceIds: [] }]);
  await updateEntity(rival!.id, { status: "confirmed" });
  await freezeCompetitiveSet(project.id, profileVersionId);
  return generatePromptSet(project.id);
}

const selectedIn = (rows: Awaited<ReturnType<typeof listCandidates>>, section: string) =>
  rows.filter((row) => row.section === section && ["SELECTED", "USER_APPROVED"].includes(row.lifecycleState));

describe.sequential("prompt review actions", () => {
  it("never lets a section go past its count, and a failed action changes nothing", async () => {
    const promptSet = await reviewableSet();
    let rows = await listCandidates(promptSet.id);
    const section = ["Discovery", "Trade Offs", "Sentiment Analysis"].find((name) => selectedIn(rows, name).length === 10 && rows.some((row) => row.section === name && row.lifecycleState === "SHORTLISTED"));
    expect(section, "a full section with alternatives").toBeTruthy();

    // Selecting an alternative outside any selected prompt's slot, while full, is refused.
    const selectedSlots = new Set(selectedIn(rows, section!).map((row) => row.coverageCellKey));
    const outsider = rows.find((row) => row.section === section && row.lifecycleState === "SHORTLISTED" && !selectedSlots.has(row.coverageCellKey));
    if (outsider) {
      await expect(updatePromptSelection(promptSet.id, outsider.id, "select")).rejects.toBeInstanceOf(PromptReviewError);
      rows = await listCandidates(promptSet.id);
      expect(selectedIn(rows, section!)).toHaveLength(10);
    }

    // Deselect then select brings the section back to exactly ten.
    const removed = selectedIn(rows, section!)[0]!;
    await updatePromptSelection(promptSet.id, removed.id, "deselect");
    rows = await listCandidates(promptSet.id);
    expect(selectedIn(rows, section!)).toHaveLength(9);
    const alternative = rows.find((row) => row.section === section && row.lifecycleState === "SHORTLISTED" && row.id !== removed.id)!;
    await updatePromptSelection(promptSet.id, alternative.id, "select");
    rows = await listCandidates(promptSet.id);
    expect(selectedIn(rows, section!)).toHaveLength(10);
  }, 60_000);
});
