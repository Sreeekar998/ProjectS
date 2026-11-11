import { NextRequest, NextResponse } from "next/server";
import { and, desc, eq } from "drizzle-orm";
import { z } from "zod";
import { getDb } from "@/lib/db/client";
import { collectionRuns } from "@/lib/db/schema";
import { resultForRun } from "@/lib/measure/snapshots";
import { brandsCsv, questionsCsv, sourcesCsv } from "@/lib/measure/export";
import { publicMeasure } from "@/lib/measure/public";
import { METRIC_DEFINITIONS, OPPORTUNITY_DEFINITIONS, COMPARABILITY_RULES, SAMPLING_POSTURE, COMBINED_AGGREGATION } from "@/lib/measure/policy";
import { withErrorHandling, jsonError } from "@/lib/http/respond";

const FormatSchema = z.enum(["csv", "json", "brands-csv", "sources-csv"]);

/**
 * `?format=csv` — the question table, one row per question × engine.
 * `?format=brands-csv` — the tracked brands and the names outside the set.
 * `?format=sources-csv` — the cited sites.
 * `?format=json` — the full measurement with its definitions and lineage.
 * Every file carries the lineage so a number can be traced back. An unknown
 * format is a 400, not a silent CSV.
 */
export async function GET(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  return withErrorHandling(async () => {
    const { id: projectId } = await params;
    const requested = req.nextUrl.searchParams.get("run");
    const format = FormatSchema.parse(req.nextUrl.searchParams.get("format") ?? "csv");
    const db = getDb();
    const run = requested
      ? await db.select().from(collectionRuns).where(and(eq(collectionRuns.id, requested), eq(collectionRuns.projectId, projectId))).get()
      : await db.select().from(collectionRuns).where(eq(collectionRuns.projectId, projectId)).orderBy(desc(collectionRuns.createdAt)).get();
    if (!run) return jsonError(404, "no_collection_run", requested ? "That measurement does not belong to this project." : "No measurement run exists for this project yet.");

    const { result, snapshot } = await resultForRun(projectId, run.id);
    const stamp = new Date(run.createdAt).toISOString().slice(0, 10);
    const base = `measure-${projectId.slice(-8)}-${stamp}`;
    const csv = (name: string, body: string) =>
      new NextResponse(body, {
        headers: { "content-type": "text/csv; charset=utf-8", "content-disposition": `attachment; filename="${name}.csv"`, "cache-control": "no-store" },
      });

    if (format === "json") {
      const body = {
        exportedAt: new Date().toISOString(),
        run: { id: run.id, createdAt: run.createdAt, status: run.status, finalisedBy: run.finalisedBy ?? null, snapshotId: snapshot?.id ?? null },
        // Route-scoped blocks are re-keyed by surface: the vendor behind a route stays internal.
        measure: publicMeasure(result),
        definitions: METRIC_DEFINITIONS,
        opportunityDefinitions: OPPORTUNITY_DEFINITIONS,
        comparabilityRules: COMPARABILITY_RULES,
        sampling: SAMPLING_POSTURE,
        aggregation: COMBINED_AGGREGATION,
      };
      return new NextResponse(JSON.stringify(body, null, 2), {
        headers: { "content-type": "application/json", "content-disposition": `attachment; filename="${base}.json"`, "cache-control": "no-store" },
      });
    }
    if (format === "brands-csv") return csv(`${base}-brands`, brandsCsv(result, run.id));
    if (format === "sources-csv") return csv(`${base}-sources`, sourcesCsv(result, run.id));
    return csv(base, questionsCsv(result, run.id));
  });
}
