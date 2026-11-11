import { eq } from "drizzle-orm";
import { getDb } from "@/lib/db/client";
import { mentions, citations } from "@/lib/db/schema";

export type MentionRow = typeof mentions.$inferSelect;
export type CitationRow = typeof citations.$inferSelect;

export async function insertMentions(rows: Array<typeof mentions.$inferInsert>): Promise<void> {
  if (rows.length === 0) return;
  const db = getDb();
  await db.insert(mentions).values(rows).run();
}

export async function insertCitations(rows: Array<typeof citations.$inferInsert>): Promise<void> {
  if (rows.length === 0) return;
  const db = getDb();
  await db.insert(citations).values(rows).run();
}

export async function listMentionsForResponse(providerResponseId: string): Promise<MentionRow[]> {
  const db = getDb();
  return db.select().from(mentions).where(eq(mentions.providerResponseId, providerResponseId)).all();
}

export async function listCitationsForResponse(providerResponseId: string): Promise<CitationRow[]> {
  const db = getDb();
  return db.select().from(citations).where(eq(citations.providerResponseId, providerResponseId)).all();
}
