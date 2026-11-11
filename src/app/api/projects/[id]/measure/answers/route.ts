import { NextRequest, NextResponse } from "next/server";
import { and, desc, eq } from "drizzle-orm";
import { getDb } from "@/lib/db/client";
import { collectionRuns } from "@/lib/db/schema";
import { listRunAnswers } from "@/lib/measure/answers";
import { withErrorHandling, jsonError } from "@/lib/http/respond";

/** Every collected answer of one run (`?run=`, default the latest), with highlights and source ownership, for the printable answers report. */
export async function GET(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  return withErrorHandling(async () => {
    const { id: projectId } = await params;
    const requested = req.nextUrl.searchParams.get("run");
    const db = getDb();
    const run = requested
      ? await db.select().from(collectionRuns).where(and(eq(collectionRuns.id, requested), eq(collectionRuns.projectId, projectId))).get()
      : await db.select().from(collectionRuns).where(eq(collectionRuns.projectId, projectId)).orderBy(desc(collectionRuns.createdAt)).get();
    if (!run) return jsonError(404, "no_collection_run", requested ? "No measurement run with that id in this project." : "No measurement run exists for this project yet.");
    const answers = await listRunAnswers(projectId, run.id);
    return NextResponse.json({ runId: run.id, answers });
  });
}
