import { eq } from "drizzle-orm";
import { getDb } from "@/lib/db/client";
import { collectionRuns, promptRuns, providerResponses, manualCaptureEvents } from "@/lib/db/schema";
import { newId } from "@/lib/ids";

export type CollectionRun = typeof collectionRuns.$inferSelect;
export type PromptRun = typeof promptRuns.$inferSelect;
export type ProviderResponse = typeof providerResponses.$inferSelect;

export async function createCollectionRunRow(projectId: string, promptSetId: string, providerExperiences: string[]): Promise<CollectionRun> {
  const db = getDb();
  const row = { id: newId("crun"), projectId, promptSetId, providerExperiences, status: "active" as const, createdAt: new Date() };
  await db.insert(collectionRuns).values(row).run();
  return row as unknown as CollectionRun;
}

export async function getCollectionRun(id: string): Promise<CollectionRun | undefined> {
  const db = getDb();
  return db.select().from(collectionRuns).where(eq(collectionRuns.id, id)).get();
}

export async function listCollectionRunsForProject(projectId: string): Promise<CollectionRun[]> {
  const db = getDb();
  return db.select().from(collectionRuns).where(eq(collectionRuns.projectId, projectId)).all();
}

export async function insertPromptRun(row: typeof promptRuns.$inferInsert): Promise<void> {
  const db = getDb();
  await db.insert(promptRuns).values(row).run();
}

export async function getPromptRunByIdempotencyKey(key: string): Promise<PromptRun | undefined> {
  const db = getDb();
  return db.select().from(promptRuns).where(eq(promptRuns.idempotencyKey, key)).get();
}

export async function getPromptRun(id: string): Promise<PromptRun | undefined> {
  const db = getDb();
  return db.select().from(promptRuns).where(eq(promptRuns.id, id)).get();
}

export async function listPromptRuns(collectionRunId: string): Promise<PromptRun[]> {
  const db = getDb();
  return db.select().from(promptRuns).where(eq(promptRuns.collectionRunId, collectionRunId)).all();
}

export async function updatePromptRun(id: string, patch: Partial<typeof promptRuns.$inferInsert>): Promise<void> {
  const db = getDb();
  await db.update(promptRuns).set({ ...patch, updatedAt: new Date() }).where(eq(promptRuns.id, id)).run();
}

export async function insertProviderResponse(row: typeof providerResponses.$inferInsert): Promise<void> {
  const db = getDb();
  await db.insert(providerResponses).values(row).run();
}

export async function getProviderResponseByPromptRun(promptRunId: string): Promise<ProviderResponse | undefined> {
  const db = getDb();
  return db.select().from(providerResponses).where(eq(providerResponses.promptRunId, promptRunId)).get();
}

export async function getProviderResponse(id: string): Promise<ProviderResponse | undefined> {
  const db = getDb();
  return db.select().from(providerResponses).where(eq(providerResponses.id, id)).get();
}

export async function insertManualCaptureEvent(row: typeof manualCaptureEvents.$inferInsert): Promise<void> {
  const db = getDb();
  await db.insert(manualCaptureEvents).values(row).run();
}
