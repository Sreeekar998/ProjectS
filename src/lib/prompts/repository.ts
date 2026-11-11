import { eq, max } from "drizzle-orm";
import crypto from "node:crypto";
import { getDb } from "@/lib/db/client";
import { promptSets, promptCandidates, promptContextSnapshots } from "@/lib/db/schema";
import { newId } from "@/lib/ids";
import type { CoveragePolicy } from "./types";
import type { PromptContextSnapshotData } from "./context";
import { hashPromptContext } from "./context";

export type PromptSet = typeof promptSets.$inferSelect;
export type PromptCandidateRow = typeof promptCandidates.$inferSelect;
export type PromptContextSnapshot = typeof promptContextSnapshots.$inferSelect;

export async function createPromptContextSnapshot(
  projectId: string,
  businessProfileVersionId: string,
  competitiveSetVersionId: string,
  context: PromptContextSnapshotData,
): Promise<PromptContextSnapshot> {
  const row = {
    id: newId("pcs"),
    projectId,
    businessProfileVersionId,
    competitiveSetVersionId,
    context: context as unknown as Record<string, unknown>,
    frozenHash: hashPromptContext(context),
    createdAt: new Date(),
  };
  await getDb().insert(promptContextSnapshots).values(row).run();
  return row as unknown as PromptContextSnapshot;
}

export async function getPromptContextSnapshot(id: string): Promise<PromptContextSnapshot | undefined> {
  return getDb().select().from(promptContextSnapshots).where(eq(promptContextSnapshots.id, id)).get();
}

export async function createPromptSet(
  projectId: string,
  businessProfileVersionId: string,
  coveragePolicy: CoveragePolicy,
  refs?: { competitiveSetVersionId: string; promptContextSnapshotId: string; selectionPolicyVersion: string },
): Promise<PromptSet> {
  const db = getDb();
  const latest = await db
    .select({ version: max(promptSets.version) })
    .from(promptSets)
    .where(eq(promptSets.projectId, projectId))
    .get();
  const row = {
    id: newId("pset"),
    projectId,
    version: (latest?.version ?? 0) + 1,
    businessProfileVersionId,
    competitiveSetVersionId: refs?.competitiveSetVersionId ?? null,
    promptContextSnapshotId: refs?.promptContextSnapshotId ?? null,
    selectionPolicyVersion: refs?.selectionPolicyVersion ?? coveragePolicy.version,
    status: "generating" as const,
    coveragePolicy: coveragePolicy as unknown as Record<string, unknown>,
    generationStats: null,
    approvedAt: null,
    approvedBy: null,
    frozenHash: null,
    createdAt: new Date(),
  };
  await db.insert(promptSets).values(row).run();
  return row as unknown as PromptSet;
}

export async function insertCandidates(rows: Array<typeof promptCandidates.$inferInsert>): Promise<void> {
  if (rows.length === 0) return;
  const db = getDb();
  await db.insert(promptCandidates).values(rows).run();
}

export async function updateCandidate(id: string, patch: Partial<typeof promptCandidates.$inferInsert>): Promise<void> {
  const db = getDb();
  await db.update(promptCandidates).set({ ...patch, updatedAt: new Date() }).where(eq(promptCandidates.id, id)).run();
}

export async function listCandidates(promptSetId: string): Promise<PromptCandidateRow[]> {
  const db = getDb();
  return db.select().from(promptCandidates).where(eq(promptCandidates.promptSetId, promptSetId)).all();
}

export async function getPromptSet(id: string): Promise<PromptSet | undefined> {
  const db = getDb();
  return db.select().from(promptSets).where(eq(promptSets.id, id)).get();
}

export async function getLatestPromptSet(projectId: string): Promise<PromptSet | undefined> {
  const db = getDb();
  const all = await db.select().from(promptSets).where(eq(promptSets.projectId, projectId)).all();
  return all.sort((a, b) => b.version - a.version)[0];
}

export async function updatePromptSet(id: string, patch: Partial<typeof promptSets.$inferInsert>): Promise<void> {
  const db = getDb();
  await db.update(promptSets).set(patch).where(eq(promptSets.id, id)).run();
}

export function computeFrozenHash(candidates: PromptCandidateRow[]): string {
  const canonical = candidates
    .map((c) => `${c.id}|${c.editedText ?? c.text}|${c.brandPolicy}|${c.section ?? c.cohort}|${c.competitorEntityId ?? ""}|${c.sentimentTheme ?? ""}`)
    .sort()
    .join("\n");
  return crypto.createHash("sha256").update(canonical).digest("hex");
}
