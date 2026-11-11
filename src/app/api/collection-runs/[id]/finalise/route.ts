import { NextRequest, NextResponse } from "next/server";
import { finaliseCollectionRun } from "@/lib/collection/finalise";
import { getCollectionRun } from "@/lib/collection/repository";
import { cancelRecheck, getRunnerProgress } from "@/lib/collection/runner";
import { withErrorHandling, jsonError } from "@/lib/http/respond";

/**
 * Closes a run with what it has: its result is frozen as a measurement and
 * no more answers are collected for it. "Collect again" starts a new run.
 */
export async function POST(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  return withErrorHandling(async () => {
    const { id } = await params;
    const run = await getCollectionRun(id);
    if (!run) return jsonError(404, "collection_run_not_found", `No collection run with id ${id}`);
    if (getRunnerProgress(id)?.status === "running") return jsonError(409, "run_in_progress", "The run is still collecting; wait for it to stop before finishing it.");
    cancelRecheck(id);
    const collectionRun = await finaliseCollectionRun(id, "operator");
    return NextResponse.json({ collectionRun });
  });
}
