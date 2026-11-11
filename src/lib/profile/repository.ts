import { eq, desc } from "drizzle-orm";
import { getDb } from "@/lib/db/client";
import { businessProfileVersions } from "@/lib/db/schema";
import { newId } from "@/lib/ids";
import type { BusinessProfile } from "./schema";

export type BusinessProfileVersionRow = typeof businessProfileVersions.$inferSelect;

export type FieldProvenanceMap = Record<
  string,
  { source: "evidence" | "user" | "inferred_needs_review"; evidenceIds?: string[]; confidence?: number }
>;

/** Flat map used by the UI to badge each field with its provenance. */
export function deriveFieldProvenance(profile: BusinessProfile): FieldProvenanceMap {
  return {
    "identity.brandName": { source: profile.identity.brandName.source, evidenceIds: profile.identity.brandName.evidenceIds, confidence: profile.identity.brandName.confidence },
    "identity.aliases": { source: profile.identity.aliases.source, evidenceIds: profile.identity.aliases.evidenceIds, confidence: profile.identity.aliases.confidence },
    description: { source: profile.description.source, evidenceIds: profile.description.evidenceIds, confidence: profile.description.confidence },
    archetype: { source: profile.archetype.source, evidenceIds: profile.archetype.evidenceIds, confidence: profile.archetype.confidence },
    industry: { source: profile.industry.source, evidenceIds: profile.industry.evidenceIds, confidence: profile.industry.confidence },
    brandIdentity: {
      source: profile.brandIdentity.length > 0 ? "evidence" : "inferred_needs_review",
      evidenceIds: profile.brandIdentity.flatMap((t) => t.evidenceIds).slice(0, 10),
      confidence: average(profile.brandIdentity.map((t) => t.confidence)),
    },
    offerings: { source: profile.offerings.source, evidenceIds: profile.offerings.evidenceIds, confidence: profile.offerings.confidence },
    targetAudience: {
      source: profile.targetAudience.length > 0 ? "evidence" : "inferred_needs_review",
      evidenceIds: profile.targetAudience.flatMap((a) => a.evidenceIds).slice(0, 10),
      confidence: average(profile.targetAudience.map((a) => a.confidence)),
    },
    markets: {
      source: profile.markets.length > 0 ? "evidence" : "inferred_needs_review",
      evidenceIds: profile.markets.flatMap((m) => m.evidenceIds).slice(0, 10),
      confidence: average(profile.markets.map((m) => m.confidence)),
    },
    customerJobs: { source: profile.customerJobs.source, evidenceIds: profile.customerJobs.evidenceIds },
    personas: { source: profile.personas.source, evidenceIds: profile.personas.evidenceIds },
    decisionConstraints: { source: profile.decisionConstraints.source, evidenceIds: profile.decisionConstraints.evidenceIds },
    geography: { source: profile.geography.source, evidenceIds: profile.geography.evidenceIds },
    regulatedDomain: { source: profile.regulatedDomain.source, evidenceIds: [] },
  };
}

function average(values: number[]): number {
  return values.length === 0 ? 0 : Math.round(values.reduce((a, b) => a + b, 0) / values.length);
}

export interface CreateVersionOptions {
  confirmed?: boolean;
  confirmedBy?: string;
  status?: "partial" | "complete" | "failed";
  synthesisMode?: "deterministic" | "llm_grounded";
  userEditedFields?: string[];
}

export async function createProfileVersion(
  projectId: string,
  crawlRunId: string | null,
  profile: BusinessProfile,
  opts: CreateVersionOptions = {},
): Promise<BusinessProfileVersionRow> {
  const db = getDb();
  const latest = await db
    .select({ version: businessProfileVersions.version })
    .from(businessProfileVersions)
    .where(eq(businessProfileVersions.projectId, projectId))
    .orderBy(desc(businessProfileVersions.version))
    .get();
  const now = new Date();
  const row = {
    id: newId("bpv"),
    projectId,
    version: (latest?.version ?? 0) + 1,
    crawlRunId,
    profile: profile as unknown as Record<string, unknown>,
    fieldProvenance: deriveFieldProvenance(profile),
    confirmedAt: opts.confirmed ? now : null,
    confirmedBy: opts.confirmed ? (opts.confirmedBy ?? "interview_operator") : null,
    status: opts.status ?? "complete",
    userEditedFields: opts.userEditedFields ?? [],
    synthesisMode: opts.synthesisMode ?? profile.quality.synthesisMode,
    createdAt: now,
  };
  await db.insert(businessProfileVersions).values(row).run();
  return row as unknown as BusinessProfileVersionRow;
}

export interface UpdateVersionOptions {
  status?: "partial" | "complete" | "failed";
  synthesisMode?: "deterministic" | "llm_grounded";
  crawlRunId?: string;
  userEditedFields?: string[];
}

/**
 * Updates a version in place. Used only while a version is still `partial`:
 * a completed or confirmed version is immutable, and an edit creates a new one.
 */
export async function updateProfileVersion(
  id: string,
  profile: BusinessProfile,
  opts: UpdateVersionOptions = {},
): Promise<BusinessProfileVersionRow> {
  const db = getDb();
  const patch: Partial<typeof businessProfileVersions.$inferInsert> = {
    profile: profile as unknown as Record<string, unknown>,
    fieldProvenance: deriveFieldProvenance(profile),
  };
  if (opts.status) patch.status = opts.status;
  if (opts.synthesisMode) patch.synthesisMode = opts.synthesisMode;
  if (opts.crawlRunId) patch.crawlRunId = opts.crawlRunId;
  if (opts.userEditedFields) patch.userEditedFields = opts.userEditedFields;
  await db.update(businessProfileVersions).set(patch).where(eq(businessProfileVersions.id, id)).run();
  const row = await db.select().from(businessProfileVersions).where(eq(businessProfileVersions.id, id)).get();
  return row as BusinessProfileVersionRow;
}

export async function getLatestProfileVersion(projectId: string): Promise<BusinessProfileVersionRow | undefined> {
  const db = getDb();
  return db
    .select()
    .from(businessProfileVersions)
    .where(eq(businessProfileVersions.projectId, projectId))
    .orderBy(desc(businessProfileVersions.version))
    .get();
}

export async function getProfileVersion(id: string): Promise<BusinessProfileVersionRow | undefined> {
  const db = getDb();
  return db.select().from(businessProfileVersions).where(eq(businessProfileVersions.id, id)).get();
}

export async function confirmProfileVersion(id: string, confirmedBy: string): Promise<void> {
  const db = getDb();
  await db
    .update(businessProfileVersions)
    .set({ confirmedAt: new Date(), confirmedBy })
    .where(eq(businessProfileVersions.id, id))
    .run();
}
