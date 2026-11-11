import { NextRequest, NextResponse } from "next/server";
import { desc, eq, and } from "drizzle-orm";
import { getDb } from "@/lib/db/client";
import { collectionRuns, promptSets } from "@/lib/db/schema";
import { compareMeasurements } from "@/lib/measure/compare";
import { previousRunForComparison, resultForRun } from "@/lib/measure/snapshots";
import { readinessSummary } from "@/lib/measure/readiness";
import {
  BRAND_COLUMN_DEFINITIONS,
  COMBINED_AGGREGATION,
  COMPARABILITY_RULES,
  LOW_N,
  METRIC_DEFINITIONS,
  OPPORTUNITY_DEFINITIONS,
  SAMPLING_POSTURE,
  SOURCE_DEFINITIONS,
  SOURCE_KIND_LABEL,
} from "@/lib/measure/policy";
import { withErrorHandling, jsonError } from "@/lib/http/respond";

/**
 * One measurement: the selected run (default: the latest), its result — the
 * frozen snapshot when the run is finalised, live otherwise — and the change
 * against the previous comparable run when one exists.
 */
export async function GET(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  return withErrorHandling(async () => {
    const { id: projectId } = await params;
    const requested = req.nextUrl.searchParams.get("collectionRunId") ?? req.nextUrl.searchParams.get("run");

    const db = getDb();
    const run = requested
      ? await db.select().from(collectionRuns).where(and(eq(collectionRuns.id, requested), eq(collectionRuns.projectId, projectId))).get()
      : await db.select().from(collectionRuns).where(eq(collectionRuns.projectId, projectId)).orderBy(desc(collectionRuns.createdAt)).get();

    if (!run) return jsonError(404, "no_collection_run", requested ? "No measurement run with that id in this project." : "No measurement run exists for this project yet.");

    const { result: measure, snapshot } = await resultForRun(projectId, run.id);
    const createdAt = new Date(run.createdAt).getTime();
    const previous = await previousRunForComparison(projectId, measure, createdAt);
    const readiness = await readinessSummary(projectId);
    const latestApproved = await db
      .select({ id: promptSets.id, version: promptSets.version, approvedAt: promptSets.approvedAt })
      .from(promptSets)
      .where(and(eq(promptSets.projectId, projectId), eq(promptSets.status, "approved")))
      .orderBy(desc(promptSets.version))
      .get();

    // Definitions travel with the numbers so the UI never has to restate a
    // formula, and the two can never drift apart.
    return NextResponse.json({
      measure,
      run: {
        id: run.id,
        createdAt,
        status: run.status,
        completedAt: run.completedAt ? new Date(run.completedAt).getTime() : null,
        finalisedBy: run.finalisedBy ?? null,
        promptSetId: run.promptSetId,
      },
      snapshot: snapshot ? { id: snapshot.id, computedAt: new Date(snapshot.computedAt).getTime() } : null,
      previous: previous
        ? { runId: previous.runId, createdAt: previous.createdAt, comparison: compareMeasurements(measure, previous.result) }
        : null,
      latestApprovedPromptSet: latestApproved
        ? { id: latestApproved.id, version: latestApproved.version, newerThanRun: latestApproved.id !== run.promptSetId }
        : null,
      definitions: METRIC_DEFINITIONS,
      brandColumns: BRAND_COLUMN_DEFINITIONS,
      sourceDefinitions: SOURCE_DEFINITIONS,
      sourceKindLabels: SOURCE_KIND_LABEL,
      opportunityDefinitions: OPPORTUNITY_DEFINITIONS,
      comparabilityRules: COMPARABILITY_RULES,
      aggregation: COMBINED_AGGREGATION,
      sampling: SAMPLING_POSTURE,
      lowN: LOW_N,
      readiness,
    });
  });
}
