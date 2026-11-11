import { NextRequest, NextResponse } from "next/server";
import { eq } from "drizzle-orm";
import { getDb } from "@/lib/db/client";
import { observationAnalyses, providerResponses } from "@/lib/db/schema";
import { ANALYSIS_VERSION } from "@/lib/analysis/types";
import { listMentionsForResponse, listCitationsForResponse } from "@/lib/metrics/repository";
import { getPromptRun } from "@/lib/collection/repository";
import { listCandidates, getPromptSet } from "@/lib/prompts/repository";
import { getCollectionRun } from "@/lib/collection/repository";
import { listEntities } from "@/lib/landscape/repository";
import { listArtifacts } from "@/lib/evidence/artifacts";
import { withErrorHandling, jsonError } from "@/lib/http/respond";

export async function GET(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  return withErrorHandling(async () => {
    const { id } = await params;
    const db = getDb();
    const response = await db.select().from(providerResponses).where(eq(providerResponses.id, id)).get();
    if (!response) return jsonError(404, "provider_response_not_found", `No provider_response with id ${id}`);

    const promptRun = await getPromptRun(response.promptRunId);
    const collectionRun = promptRun ? await getCollectionRun(promptRun.collectionRunId) : undefined;
    const promptSet = collectionRun ? await getPromptSet(collectionRun.promptSetId) : undefined;
    const candidates = promptSet ? await listCandidates(promptSet.id) : [];
    const candidate = promptRun ? candidates.find((c) => c.id === promptRun.promptCandidateId) : undefined;

    const mentions = await listMentionsForResponse(id);
    const citations = await listCitationsForResponse(id);
    const entities = collectionRun ? await listEntities(collectionRun.projectId) : [];
    const entityById = new Map(entities.map((e) => [e.id, e]));

    // The analysis Measure serves for this answer: the current version when
    // one exists, else the most recent. It carries the brand spans and the
    // ownership of every cited URL, which is what the answer view highlights.
    const analysisRows = await db.select().from(observationAnalyses).where(eq(observationAnalyses.providerResponseId, id)).all();
    const analysis = analysisRows.sort((a, b) => {
      const rank = (row: (typeof analysisRows)[number]) => (row.analysisVersion === ANALYSIS_VERSION ? 1 : 0);
      return rank(b) - rank(a) || new Date(b.analysedAt).getTime() - new Date(a.analysedAt).getTime();
    })[0];

    return NextResponse.json({
      response,
      promptRun,
      candidate,
      mentions: mentions.map((m) => ({ ...m, entityName: entityById.get(m.entityId)?.canonicalName ?? "unknown" })),
      citations: citations.map((c) => ({ ...c, entityName: c.matchedEntityId ? entityById.get(c.matchedEntityId)?.canonicalName : null })),
      // The provider's raw payload and the rendered page, when kept: the chain
      // from a dashboard number back to what the site actually showed.
      artifacts: collectionRun ? listArtifacts(collectionRun.projectId, id) : [],
      analysis: analysis ? { version: analysis.analysisVersion, eligibility: analysis.eligibility, ...(analysis.payload as Record<string, unknown>) } : null,
      entities: entities.map((e) => ({ id: e.id, canonicalName: e.canonicalName, kind: e.kind, parentEntityId: e.parentEntityId })),
    });
  });
}
