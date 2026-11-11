import { NextRequest, NextResponse } from "next/server";
import { reanalyseCollectionRun } from "@/lib/analysis/service";
import { getCollectionRun } from "@/lib/collection/repository";
import { writeMeasurementSnapshot } from "@/lib/measure/snapshots";
import { withErrorHandling, jsonError } from "@/lib/http/respond";

/**
 * Brings every collected answer of the run to the current analysis version.
 * Analyses are additive: nothing is overwritten. A finalised run gets a new
 * snapshot at the new versions, superseding the old one.
 */
export async function POST(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  return withErrorHandling(async () => {
    const { id } = await params;
    const run = await getCollectionRun(id);
    if (!run) return jsonError(404, "collection_run_not_found", `No collection run with id ${id}`);
    const outcome = await reanalyseCollectionRun(id);
    let snapshotId: string | null = null;
    if (run.status === "completed") {
      const { snapshot } = await writeMeasurementSnapshot(run.projectId, id);
      snapshotId = snapshot.id;
    }
    return NextResponse.json({ ...outcome, snapshotId });
  });
}
