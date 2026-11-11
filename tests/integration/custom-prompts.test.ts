import { describe, it, expect } from "vitest";
import { getDb } from "@/lib/db/client";
import { businessProfileVersions, topics as topicsTable } from "@/lib/db/schema";
import { newId } from "@/lib/ids";
import { createProject } from "@/lib/projects/repository";
import { insertTargetEntity, insertCompetitorCandidates, updateEntity, freezeCompetitiveSet } from "@/lib/landscape/repository";
import { generatePromptSet, approvePromptSet, addCustomPrompt, editCustomPrompt, regeneratePromptCandidate, PromptReviewError } from "@/lib/prompts/orchestrator";
import { listCandidates } from "@/lib/prompts/repository";
import { createCollectionRun } from "@/lib/collection/orchestrator";
import { listPromptRuns } from "@/lib/collection/repository";
import { makeProfile } from "../helpers/profile-fixtures";

const BRAND = "Harbor Cycles";
const RIVAL = "Summit Wheels";

async function reviewableSet() {
  const db = getDb();
  const profile = makeProfile({
    brandName: BRAND,
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
  await insertTargetEntity(project.id, BRAND, profile.identity.domains);
  const [rival] = await insertCompetitorCandidates(project.id, [{ canonicalName: RIVAL, competitorType: "direct", domains: [], reason: "test", confidence: 80, evidenceIds: [] }]);
  await updateEntity(rival!.id, { status: "confirmed" });
  await freezeCompetitiveSet(project.id, profileVersionId);
  return { project, promptSet: await generatePromptSet(project.id) };
}

type Rows = Awaited<ReturnType<typeof listCandidates>>;
const selectedIn = (rows: Rows, section: string) => rows.filter((row) => row.section === section && ["SELECTED", "USER_APPROVED"].includes(row.lifecycleState));

describe.sequential("prompts the reviewer adds", () => {
  it("holds each section to its rules and its count, changing nothing when a prompt is refused", async () => {
    const { promptSet } = await reviewableSet();
    const before = await listCandidates(promptSet.id);
    const discovery = selectedIn(before, "Discovery");
    expect(discovery).toHaveLength(10);

    await expect(addCustomPrompt(promptSet.id, { text: `Is ${BRAND} a good place to buy an electric bike?`, section: "Discovery", replacesCandidateId: discovery[0]!.id })).rejects.toThrow(
      /can't mention Harbor Cycles/,
    );
    await expect(addCustomPrompt(promptSet.id, { text: `Is ${BRAND} good for commuter bikes?`, section: "Trade Offs", replacesCandidateId: selectedIn(before, "Trade Offs")[0]!.id })).rejects.toThrow(
      /Name one of: Summit Wheels/,
    );
    await expect(
      addCustomPrompt(promptSet.id, { text: `${BRAND} or ${RIVAL} for a first road bike?`, section: "Sentiment Analysis", replacesCandidateId: selectedIn(before, "Sentiment Analysis")[0]!.id }),
    ).rejects.toThrow(/Add it under Trade Offs/);
    // A full section needs to know which prompt yours replaces.
    await expect(addCustomPrompt(promptSet.id, { text: "Which bike shops are best for fitting a first road bike?", section: "Discovery" })).rejects.toThrow(/already has 10 prompts/);
    // The same question twice is refused.
    await expect(
      addCustomPrompt(promptSet.id, { text: discovery[1]!.editedText ?? discovery[1]!.text, section: "Discovery", replacesCandidateId: discovery[0]!.id }),
    ).rejects.toBeInstanceOf(PromptReviewError);

    const after = await listCandidates(promptSet.id);
    expect(after).toHaveLength(before.length);
    expect(selectedIn(after, "Discovery").map((row) => row.id)).toEqual(discovery.map((row) => row.id));
  }, 60_000);

  it("takes a slot, is frozen on approval, and is planned for collection like any other prompt", async () => {
    const { project, promptSet } = await reviewableSet();
    let rows = await listCandidates(promptSet.id);
    const replacedDiscovery = selectedIn(rows, "Discovery")[0]!;
    const replacedTradeOff = selectedIn(rows, "Trade Offs")[0]!;

    const discovery = await addCustomPrompt(promptSet.id, { text: "Which bike shops are best for fitting a first road bike?", section: "Discovery", replacesCandidateId: replacedDiscovery.id });
    expect(discovery.replacedId).toBe(replacedDiscovery.id);
    const tradeOff = await addCustomPrompt(promptSet.id, { text: `${BRAND} or ${RIVAL} for a commuter e-bike with a long warranty?`, section: "Trade Offs", replacesCandidateId: replacedTradeOff.id });
    const reputation = await addCustomPrompt(promptSet.id, {
      text: `What do riders say about ${BRAND} product quality?`,
      section: "Sentiment Analysis",
      replacesCandidateId: selectedIn(rows, "Sentiment Analysis")[0]!.id,
    });

    rows = await listCandidates(promptSet.id);
    for (const section of ["Discovery", "Trade Offs", "Sentiment Analysis"]) expect(selectedIn(rows, section)).toHaveLength(10);
    const tradeRow = rows.find((row) => row.id === tradeOff.candidateId)!;
    expect(tradeRow).toMatchObject({ lifecycleState: "SELECTED", generationSource: "user", section: "Trade Offs", brandPolicy: "TARGET_REQUIRED" });
    expect(tradeRow.competitorEntityId).toBeTruthy();
    expect(rows.find((row) => row.id === reputation.candidateId)!.sentimentTheme).toBe("product quality");
    expect(rows.find((row) => row.id === replacedTradeOff.id)!.lifecycleState).toBe("SHORTLISTED");

    // Your own words are never reworded; an edit is rechecked by the same rules.
    await expect(regeneratePromptCandidate(promptSet.id, discovery.candidateId)).rejects.toThrow(/stay in your words/);
    await expect(editCustomPrompt(promptSet.id, discovery.candidateId, `Is ${BRAND} the best shop for fitting a first road bike?`)).rejects.toThrow(/can't mention/);
    await editCustomPrompt(promptSet.id, discovery.candidateId, "Which bike shops are best for fitting a first gravel bike?");

    expect((await approvePromptSet(promptSet.id, "test")).status).toBe("approved");
    rows = await listCandidates(promptSet.id);
    const frozen = rows.filter((row) => row.lifecycleState === "USER_APPROVED");
    expect(frozen).toHaveLength(30);
    expect(frozen.map((row) => row.id)).toEqual(expect.arrayContaining([discovery.candidateId, tradeOff.candidateId, reputation.candidateId]));
    expect(frozen.find((row) => row.id === discovery.candidateId)!.editedText).toBe("Which bike shops are best for fitting a first gravel bike?");

    await expect(addCustomPrompt(promptSet.id, { text: "Which bike shops are best for kids bikes?", section: "Discovery", replacesCandidateId: discovery.candidateId })).rejects.toThrow(/frozen/);
    await expect(editCustomPrompt(promptSet.id, discovery.candidateId, "Which bike shops are best for fitting a kids bike?")).rejects.toThrow(/frozen/);

    const run = await createCollectionRun(project.id, ["chatgpt_manual"]);
    const planned = new Set((await listPromptRuns(run.id)).map((row) => row.promptCandidateId));
    expect(planned.size).toBe(30);
    for (const id of [discovery.candidateId, tradeOff.candidateId, reputation.candidateId]) expect(planned.has(id)).toBe(true);
  }, 60_000);
});
