import { eq, inArray } from "drizzle-orm";
import { getDb } from "@/lib/db/client";
import { evidenceItems } from "@/lib/db/schema";
import { newId } from "@/lib/ids";
import type { PageType } from "@/lib/crawler/page-classifier";
import type { EvidenceFieldHint, EvidenceItem, EvidenceSourceType, NewEvidenceItem } from "./types";

type Row = typeof evidenceItems.$inferSelect;

function toDomain(row: Row): EvidenceItem {
  return {
    id: row.id,
    runId: row.runId,
    projectId: row.projectId,
    crawlPageId: row.crawlPageId,
    url: row.url,
    canonicalUrl: row.canonicalUrl,
    pageType: row.pageType as PageType,
    sourceType: row.sourceType as EvidenceSourceType,
    text: row.text,
    fieldHint: (row.fieldHint as EvidenceFieldHint | null) ?? null,
    data: row.data ?? null,
    extractedAt: row.extractedAt.toISOString(),
  };
}

export async function insertEvidenceItems(items: NewEvidenceItem[]): Promise<EvidenceItem[]> {
  if (items.length === 0) return [];
  const db = getDb();
  const now = new Date();
  const rows = items.map((item) => ({
    id: item.id ?? newId("ev"),
    runId: item.runId,
    projectId: item.projectId,
    crawlPageId: item.crawlPageId,
    url: item.url,
    canonicalUrl: item.canonicalUrl ?? null,
    pageType: item.pageType,
    sourceType: item.sourceType,
    text: item.text,
    fieldHint: item.fieldHint ?? null,
    data: item.data ?? null,
    extractedAt: item.extractedAt ? new Date(item.extractedAt) : now,
  }));
  // SQLite caps bound parameters per statement; chunk to stay well under it.
  for (let i = 0; i < rows.length; i += 200) {
    await db.insert(evidenceItems).values(rows.slice(i, i + 200)).run();
  }
  return rows.map(toDomain);
}

export async function listEvidenceByIds(ids: string[]): Promise<EvidenceItem[]> {
  if (ids.length === 0) return [];
  const db = getDb();
  const out: EvidenceItem[] = [];
  for (let i = 0; i < ids.length; i += 200) {
    const rows = await db.select().from(evidenceItems).where(inArray(evidenceItems.id, ids.slice(i, i + 200))).all();
    out.push(...rows.map(toDomain));
  }
  return out;
}

export async function listEvidenceForProject(projectId: string): Promise<EvidenceItem[]> {
  const db = getDb();
  const rows = await db.select().from(evidenceItems).where(eq(evidenceItems.projectId, projectId)).all();
  return rows.map(toDomain);
}

export async function deleteEvidenceForRun(runId: string): Promise<void> {
  const db = getDb();
  await db.delete(evidenceItems).where(eq(evidenceItems.runId, runId)).run();
}
