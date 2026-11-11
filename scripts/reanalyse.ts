// Re-runs analysis over already-captured observations. Used after an analyzer
// change: the raw answers are immutable, so a new interpretation is a new
// analysis row rather than a new collection.
import { getDb } from "@/lib/db/client";
import { providerResponses, promptRuns, collectionRuns } from "@/lib/db/schema";
import { eq } from "drizzle-orm";
import { normalizeProviderResponse } from "@/lib/metrics/orchestrator";
import { analyseObservationById } from "@/lib/analysis/service";

async function main() {
  const collectionRunId = process.argv[2];
  if (!collectionRunId) throw new Error("usage: reanalyse.ts <collectionRunId>");
  const db = getDb();
  const run = await db.select().from(collectionRuns).where(eq(collectionRuns.id, collectionRunId)).get();
  if (!run) throw new Error(`collection run ${collectionRunId} not found`);
  const runs = await db.select().from(promptRuns).where(eq(promptRuns.collectionRunId, collectionRunId)).all();
  let done = 0;
  let failed = 0;
  for (const promptRun of runs) {
    const responses = await db.select().from(providerResponses).where(eq(providerResponses.promptRunId, promptRun.id)).all();
    for (const response of responses) {
      try {
        await normalizeProviderResponse(response.id, run.projectId);
        await analyseObservationById(run.projectId, response.id);
        done += 1;
      } catch (error) {
        failed += 1;
        console.error(`  ${response.id}: ${error instanceof Error ? error.message : String(error)}`);
      }
    }
  }
  console.log(`re-analysed ${done}, failed ${failed}`);
}
main().catch((error) => { console.error(error); process.exit(1); });
