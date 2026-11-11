import { NextRequest, NextResponse } from "next/server";
import { getCollectionRun, listPromptRuns, getProviderResponseByPromptRun } from "@/lib/collection/repository";
import { getPromptSet, listCandidates } from "@/lib/prompts/repository";
import { withErrorHandling, jsonError } from "@/lib/http/respond";
import { getRunnerProgress } from "@/lib/collection/runner";
import { inArray } from "drizzle-orm";
import { getDb } from "@/lib/db/client";
import { observationAnalyses } from "@/lib/db/schema";
import { ANALYSIS_VERSION } from "@/lib/analysis/types";

export async function GET(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  return withErrorHandling(async () => {
    const { id } = await params;
    const collectionRun = await getCollectionRun(id);
    if (!collectionRun) return jsonError(404, "collection_run_not_found", `No collection run with id ${id}`);

    const promptSet = await getPromptSet(collectionRun.promptSetId);
    const candidates = promptSet ? await listCandidates(promptSet.id) : [];
    const candidateById = new Map(candidates.map((c) => [c.id, c]));

    const runs = await listPromptRuns(id);
    const responses = await Promise.all(runs.map(async (run) => (run.state === "succeeded" ? await getProviderResponseByPromptRun(run.id) : undefined)));
    const responseIds = responses.filter((row): row is NonNullable<typeof row> => Boolean(row)).map((row) => row.id);
    // "Collected" and "analysable" are different facts: an answer whose
    // analysis threw is collected but counts nowhere until re-analysed.
    const analysisRows = responseIds.length
      ? await getDb().select({ providerResponseId: observationAnalyses.providerResponseId, analysisVersion: observationAnalyses.analysisVersion, eligibility: observationAnalyses.eligibility }).from(observationAnalyses).where(inArray(observationAnalyses.providerResponseId, responseIds)).all()
      : [];
    const analysisByResponse = new Map<string, { version: string; eligibility: string }>();
    for (const row of analysisRows) {
      const existing = analysisByResponse.get(row.providerResponseId);
      if (!existing || (existing.version !== ANALYSIS_VERSION && row.analysisVersion === ANALYSIS_VERSION)) {
        analysisByResponse.set(row.providerResponseId, { version: row.analysisVersion, eligibility: row.eligibility });
      }
    }
    const analysisSummary = { analysed: 0, needsReview: 0, missing: 0, stale: 0 };
    const enriched = await Promise.all(
      runs.map(async (run, index) => {
        const candidate = candidateById.get(run.promptCandidateId);
        const response = responses[index];
        const analysis = response ? analysisByResponse.get(response.id) : undefined;
        const analysisState = !response ? null : !analysis ? "missing" : analysis.eligibility === "NEEDS_REVIEW" ? "needs_review" : "analysed";
        if (analysisState === "missing") analysisSummary.missing += 1;
        else if (analysisState === "needs_review") analysisSummary.needsReview += 1;
        else if (analysisState === "analysed") analysisSummary.analysed += 1;
        if (analysis && analysis.version !== ANALYSIS_VERSION) analysisSummary.stale += 1;
        return {
          analysisState,
          analysisVersion: analysis?.version ?? null,
          ...run,
          promptText: candidate?.editedText ?? candidate?.text ?? "(prompt not found)",
          section: candidate?.section ?? null,
          cohort: candidate?.cohort,
          brandPolicy: candidate?.brandPolicy,
          topicId: candidate?.topicId,
          responseId: response?.id ?? null,
          // Enough of the captured evidence to render it in place, so the
          // operator sees the run filling up rather than a bare counter.
          observation: response
            ? {
                observedAt: response.observedAt,
                excerpt: response.responseText.slice(0, 400),
                fullLength: response.responseText.length,
                sourceCount: (response.sourceUrls as string[]).length,
                sourcesCaptureState: response.sourcesCaptureState,
                answerCaptureState: response.answerCaptureState,
                searchState: response.searchState,
                visibleModelMode: response.visibleModelMode,
                intendedMarket: response.intendedMarket,
                observerRegion: response.observerRegion,
                observerRegionSource: response.observerRegionSource,
                sessionProfile: response.sessionProfile,
                rawHash: response.rawHash,
              }
            : null,
        };
      }),
    );

    return NextResponse.json({ collectionRun, promptRuns: enriched, runner: getRunnerProgress(id), analysisSummary, currentAnalysisVersion: ANALYSIS_VERSION });
  });
}
