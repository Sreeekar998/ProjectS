// Every answer of a run, ready to print: the question, the answer as the
// site showed it, the brands to highlight and the sources with ownership.
//
// The drawer fetches one answer at a time; a report of a whole run needs
// them all in one request, computed once on the server from the same stored
// rows and the same analysis Measure serves (current version first, then
// the most recent), so what the report shows is what the figures counted.

import { eq, inArray } from "drizzle-orm";
import { getDb } from "@/lib/db/client";
import { collectionRuns, entities as entitiesTable, observationAnalyses, promptCandidates, promptRuns, providerResponses, topics as topicsTable } from "@/lib/db/schema";
import { ANALYSIS_VERSION, type NormalizedObservation } from "@/lib/analysis/types";
import { engineOf } from "@/lib/providers/engines";
import { RunNotFoundError } from "./service";
import { highlightsFor, sourcesFor, type SourceItem } from "./answer-evidence";
import type { Highlight } from "./answer-markdown";

export interface RunAnswer {
  observationId: string;
  promptCandidateId: string;
  question: string;
  section: string | null;
  topicName: string | null;
  engine: string;
  route: string;
  observedAt: number | null;
  model: string | null;
  country: string | null;
  searchState: string | null;
  answerCaptureState: string;
  sourcesCaptureState: string;
  responseText: string;
  /** "analysable", "needs_review" or "awaiting_analysis": what the served analysis says about this answer. */
  analysis: "analysable" | "needs_review" | "awaiting_analysis";
  highlights: Highlight[];
  sources: SourceItem[];
  /** Domains linked inline in the answer that the page did not list as sources. */
  inlineOnly: string[];
}

const SECTION_ORDER: Record<string, number> = { Discovery: 0, "Trade Offs": 1, "Sentiment Analysis": 2 };

function hostOf(url: string): string {
  try {
    return new URL(url).hostname.replace(/^www\./i, "");
  } catch {
    return url;
  }
}

export async function listRunAnswers(projectId: string, collectionRunId: string): Promise<RunAnswer[]> {
  const db = getDb();
  const run = await db.select().from(collectionRuns).where(eq(collectionRuns.id, collectionRunId)).get();
  if (!run || run.projectId !== projectId) throw new RunNotFoundError(collectionRunId);

  const runs = (await db.select().from(promptRuns).where(eq(promptRuns.collectionRunId, collectionRunId)).all()).filter((row) => row.state !== "policy_disabled");
  if (runs.length === 0) return [];
  const responses = await db.select().from(providerResponses).where(inArray(providerResponses.promptRunId, runs.map((r) => r.id))).all();
  if (responses.length === 0) return [];
  const analysisRows = await db.select().from(observationAnalyses).where(inArray(observationAnalyses.providerResponseId, responses.map((r) => r.id))).all();
  const analysisByResponse = new Map<string, (typeof analysisRows)[number]>();
  const versionRank = (row: (typeof analysisRows)[number]) => (row.analysisVersion === ANALYSIS_VERSION ? 1 : 0);
  for (const row of analysisRows) {
    const existing = analysisByResponse.get(row.providerResponseId);
    const newer = existing ? new Date(row.analysedAt).getTime() > new Date(existing.analysedAt).getTime() : true;
    if (!existing || versionRank(row) > versionRank(existing) || (versionRank(row) === versionRank(existing) && newer)) analysisByResponse.set(row.providerResponseId, row);
  }

  const candidates = await db.select().from(promptCandidates).where(eq(promptCandidates.promptSetId, run.promptSetId)).all();
  const candidateById = new Map(candidates.map((c) => [c.id, c]));
  const topicName = new Map((await db.select({ id: topicsTable.id, name: topicsTable.name }).from(topicsTable).where(eq(topicsTable.projectId, projectId)).all()).map((t) => [t.id, t.name]));
  const entities = await db.select().from(entitiesTable).where(eq(entitiesTable.projectId, projectId)).all();
  const target = entities.find((e) => e.kind === "target");
  const ownerNames = new Map(entities.map((e) => [e.id, e.canonicalName]));
  const runById = new Map(runs.map((r) => [r.id, r]));

  const answers: RunAnswer[] = [];
  for (const response of responses) {
    const promptRun = runById.get(response.promptRunId);
    if (!promptRun) continue;
    const candidate = candidateById.get(promptRun.promptCandidateId);
    const stored = analysisByResponse.get(response.id);
    const analysis = stored ? (stored.payload as unknown as NormalizedObservation) : null;
    const sourceUrls = (response.sourceUrls as string[] | null) ?? [];
    const inline = ((response.inlineCitationUrls as string[] | null) ?? []).filter((url) => !sourceUrls.includes(url));
    answers.push({
      observationId: response.id,
      promptCandidateId: promptRun.promptCandidateId,
      question: candidate?.editedText ?? candidate?.text ?? "(question unavailable)",
      section: candidate?.section ?? null,
      topicName: candidate?.topicId ? (topicName.get(candidate.topicId) ?? null) : null,
      engine: engineOf(response.providerExperience),
      route: response.providerExperience,
      observedAt: response.observedAt ? new Date(response.observedAt).getTime() : null,
      model: response.visibleModelMode && response.visibleModelMode !== "unknown" ? response.visibleModelMode : null,
      country: response.observerRegion ?? null,
      searchState: response.searchState ?? null,
      answerCaptureState: response.answerCaptureState ?? "complete",
      sourcesCaptureState: response.sourcesCaptureState ?? "unknown",
      responseText: response.responseText ?? "",
      analysis: !analysis ? "awaiting_analysis" : analysis.eligibility === "NEEDS_REVIEW" ? "needs_review" : "analysable",
      highlights: highlightsFor(analysis, target?.id ?? null),
      sources: sourcesFor(sourceUrls, analysis?.citations ?? [], ownerNames),
      inlineOnly: [...new Set(inline.map(hostOf))],
    });
  }

  return answers.sort(
    (a, b) =>
      (SECTION_ORDER[a.section ?? ""] ?? 3) - (SECTION_ORDER[b.section ?? ""] ?? 3) ||
      a.question.localeCompare(b.question) ||
      a.engine.localeCompare(b.engine),
  );
}
