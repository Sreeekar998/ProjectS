import { desc, eq, sql } from "drizzle-orm";
import { getDb } from "@/lib/db/client";
import { crawlRuns, crawlPages, evidenceChunks } from "@/lib/db/schema";
import { newId } from "@/lib/ids";

export type CrawlRun = typeof crawlRuns.$inferSelect;
export type EvidenceChunk = typeof evidenceChunks.$inferSelect;

export type CrawlRunMetrics = Record<string, number | string | Record<string, number>>;

export async function createCrawlRun(projectId: string, init: { metrics?: CrawlRunMetrics } = {}): Promise<CrawlRun> {
  const db = getDb();
  const row = {
    id: newId("crw"),
    projectId,
    status: "running",
    startedAt: new Date(),
    completedAt: null,
    robotsAllowed: null,
    robotsCheckedAt: null,
    sitemapUrls: null,
    discoveredCount: 0,
    fetchedCount: 0,
    selectedCount: 0,
    blockReason: null,
    usedPlaywrightFallback: false,
    metrics: init.metrics ?? null,
  };
  await db.insert(crawlRuns).values(row).run();
  return row as unknown as CrawlRun;
}

export async function updateCrawlRun(id: string, patch: Partial<typeof crawlRuns.$inferInsert>): Promise<void> {
  const db = getDb();
  await db.update(crawlRuns).set(patch).where(eq(crawlRuns.id, id)).run();
}

export async function getCrawlRun(id: string): Promise<CrawlRun | undefined> {
  const db = getDb();
  return db.select().from(crawlRuns).where(eq(crawlRuns.id, id)).get();
}

export async function getLatestCrawlRun(projectId: string): Promise<CrawlRun | undefined> {
  const db = getDb();
  return db.select().from(crawlRuns).where(eq(crawlRuns.projectId, projectId)).orderBy(desc(crawlRuns.startedAt), sql`rowid desc`).limit(1).get();
}

/** Adds keys to a run's metrics without dropping the crawl telemetry already stored there. */
export async function mergeCrawlRunMetrics(id: string, patch: CrawlRunMetrics): Promise<void> {
  const current = await getCrawlRun(id);
  if (!current) return;
  await updateCrawlRun(id, { metrics: { ...(current.metrics ?? {}), ...patch } });
}

export async function insertCrawlPage(page: typeof crawlPages.$inferInsert): Promise<void> {
  const db = getDb();
  await db.insert(crawlPages).values(page).run();
}

export async function insertEvidenceChunks(chunks: Array<typeof evidenceChunks.$inferInsert>): Promise<void> {
  if (chunks.length === 0) return;
  const db = getDb();
  await db.insert(evidenceChunks).values(chunks).run();
}

export async function listEvidenceChunksForProject(projectId: string): Promise<EvidenceChunk[]> {
  const db = getDb();
  return db.select().from(evidenceChunks).where(eq(evidenceChunks.projectId, projectId)).all();
}
