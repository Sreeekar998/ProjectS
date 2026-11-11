// Closing a run turns it into a measurement.
//
// A finalised run accepts no more answers, its result is frozen in
// measurement_snapshots, and "Collect again" starts a new run. Automatic when
// every planned answer was collected and analysed; by the operator when a
// partial run is stopped and they want to keep what they have.

import { eq } from "drizzle-orm";
import { getDb } from "@/lib/db/client";
import { collectionRuns, observationAnalyses, promptRuns, providerResponses } from "@/lib/db/schema";
import { appendEvent } from "@/lib/events/bus";
import { writeMeasurementSnapshot } from "@/lib/measure/snapshots";
import { getCollectionRun, type CollectionRun } from "./repository";

export class RunFinalisedError extends Error {
  constructor(collectionRunId: string) {
    super(`Run ${collectionRunId} is finished; start a new run to collect again.`);
    this.name = "RunFinalisedError";
  }
}

/** Every planned answer of the run is collected and has an analysis row. */
export async function runFullyAnalysed(collectionRunId: string): Promise<boolean> {
  const db = getDb();
  const rows = (await db.select().from(promptRuns).where(eq(promptRuns.collectionRunId, collectionRunId)).all()).filter((row) => row.state !== "policy_disabled");
  if (rows.length === 0) return false;
  for (const row of rows) {
    if (row.state !== "succeeded") return false;
    const response = await db.select({ id: providerResponses.id }).from(providerResponses).where(eq(providerResponses.promptRunId, row.id)).get();
    if (!response) return false;
    const analysis = await db.select({ id: observationAnalyses.id }).from(observationAnalyses).where(eq(observationAnalyses.providerResponseId, response.id)).get();
    if (!analysis) return false;
  }
  return true;
}

export async function finaliseCollectionRun(collectionRunId: string, by: "auto" | "operator"): Promise<CollectionRun> {
  const db = getDb();
  const run = await getCollectionRun(collectionRunId);
  if (!run) throw new Error(`collection_run ${collectionRunId} not found`);
  if (run.status !== "completed") {
    await db.update(collectionRuns).set({ status: "completed", completedAt: new Date(), finalisedBy: by }).where(eq(collectionRuns.id, collectionRunId)).run();
  }
  const { snapshot } = await writeMeasurementSnapshot(run.projectId, collectionRunId);
  appendEvent(run.projectId, "metric.snapshot.updated", { collectionRunId, snapshotId: snapshot.id, finalisedBy: by });
  return (await getCollectionRun(collectionRunId))!;
}
