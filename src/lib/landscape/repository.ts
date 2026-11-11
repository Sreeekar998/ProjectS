import { eq, and, desc, isNotNull } from "drizzle-orm";
import { z } from "zod";
import { getDb } from "@/lib/db/client";
import crypto from "node:crypto";
import { topics, entities, aliases, competitorDiscoveryRuns, competitiveSetVersions, businessProfileVersions, type FrozenTopicSnapshot } from "@/lib/db/schema";
import { newId } from "@/lib/ids";
import { normalizeForSimilarity } from "@/lib/text/similarity";
import type { BusinessProfile } from "@/lib/profile/schema";
import { canonicalizeDomain, normalizeEntityName } from "./competitor-entity";
import type { CompetitiveSearchProfile, FrozenCompetitorSnapshotV2, RankedCompetitorCandidate } from "./competitor-types";
import { COMPETITOR_DISCOVERY_POLICY_VERSION } from "./competitor-types";
import { buildCompetitiveSearchProfile } from "./search-profile";
import { COMPETITOR_TIER_POLICY_VERSION, computeBrandReach, effectiveTierFor, planCompetitorTiers, readStoredTier, storedTierFrom } from "./competitor-tiers";
import type { CompetitorTierPlan, StoredCompetitorTier } from "./tier-types";

export type Topic = typeof topics.$inferSelect;
export type Entity = typeof entities.$inferSelect;
export type CompetitorDiscoveryRun = typeof competitorDiscoveryRuns.$inferSelect;
export type CompetitiveSetVersion = typeof competitiveSetVersions.$inferSelect;

export async function insertTopics(projectId: string, businessProfileVersionId: string, candidates: Array<{ name: string; discoveryConcept?: string; description: string; evidenceIds: string[] }>): Promise<Topic[]> {
  const db = getDb();
  const now = new Date();
  const rows = candidates.map((c, idx) => ({
    id: newId("top"),
    projectId,
    businessProfileVersionId,
    name: c.name,
    discoveryConcept: c.discoveryConcept ?? c.name,
    description: c.description,
    priority: idx,
    status: "candidate" as const,
    source: "system" as const,
    evidenceIds: c.evidenceIds,
    createdAt: now,
  }));
  if (rows.length > 0) await db.insert(topics).values(rows).run();
  return rows as unknown as Topic[];
}

export async function listTopics(projectId: string): Promise<Topic[]> {
  const db = getDb();
  return db.select().from(topics).where(eq(topics.projectId, projectId)).all();
}

export async function updateTopic(id: string, patch: Partial<typeof topics.$inferInsert>): Promise<void> {
  const db = getDb();
  await db.update(topics).set(patch).where(eq(topics.id, id)).run();
}

export async function addTopic(projectId: string, businessProfileVersionId: string, input: { name: string; discoveryConcept?: string; description?: string }): Promise<Topic> {
  const db = getDb();
  const row = {
    id: newId("top"),
    projectId,
    businessProfileVersionId,
    name: input.name,
    discoveryConcept: input.discoveryConcept ?? input.name,
    description: input.description ?? "Added manually by operator.",
    priority: 99,
    status: "confirmed" as const,
    source: "user" as const,
    evidenceIds: [],
    createdAt: new Date(),
  };
  await db.insert(topics).values(row).run();
  return row as unknown as Topic;
}

export async function insertTargetEntity(projectId: string, name: string, domains: string[]): Promise<Entity> {
  const db = getDb();
  const row = {
    id: newId("ent"),
    projectId,
    kind: "target" as const,
    competitorType: null,
    canonicalName: name,
    normalizedName: normalizeEntityName(name),
    domains,
    canonicalDomain: canonicalizeDomain(domains[0]),
    entityType: "company",
    parentEntityId: null,
    relationship: null,
    status: "confirmed" as const,
    discoveryStatus: "confirmed",
    confidence: 100,
    reason: "Target business under measurement.",
    geographyRelevance: null,
    evidenceIds: [],
    source: "system" as const,
    sourceContributions: ["system"],
    matchedDimensions: [],
    scoreBreakdown: {},
    verificationStatus: "not_applicable",
    verificationSummary: "Target business under measurement.",
    rejectionReason: null,
    candidateProfile: null,
    createdAt: new Date(),
  };
  await db.insert(entities).values(row).run();
  return row as unknown as Entity;
}

export async function insertCompetitorCandidates(
  projectId: string,
  candidates: Array<{
    canonicalName: string;
    competitorType: "direct" | "substitute" | "marketplace" | "adjacent";
    domains: string[];
    reason: string;
    confidence: number;
    evidenceIds: string[];
    source?: string;
    sourceContributions?: string[];
    matchedDimensions?: string[];
    scoreBreakdown?: Record<string, number>;
    verificationStatus?: string;
    verificationSummary?: string;
  }>,
): Promise<Entity[]> {
  const db = getDb();
  const now = new Date();
  const rows = candidates.map((c) => ({
    id: newId("ent"),
    projectId,
    kind: "competitor" as const,
    competitorType: c.competitorType,
    canonicalName: c.canonicalName,
    normalizedName: normalizeEntityName(c.canonicalName),
    domains: c.domains,
    canonicalDomain: canonicalizeDomain(c.domains[0]),
    entityType: "company",
    parentEntityId: null,
    relationship: null,
    status: "candidate" as const,
    discoveryStatus: "suggested",
    confidence: c.confidence,
    reason: c.reason,
    geographyRelevance: null,
    evidenceIds: c.evidenceIds,
    source: c.source ?? "system",
    sourceContributions: c.sourceContributions ?? [c.source ?? "system"],
    matchedDimensions: c.matchedDimensions ?? [],
    scoreBreakdown: c.scoreBreakdown ?? {},
    verificationStatus: c.verificationStatus ?? "not_applicable",
    verificationSummary: c.verificationSummary ?? null,
    rejectionReason: null,
    candidateProfile: null,
    createdAt: now,
  }));
  if (rows.length > 0) await db.insert(entities).values(rows).run();
  return rows as unknown as Entity[];
}

export async function listEntities(projectId: string, kind?: "target" | "competitor" | "emerging"): Promise<Entity[]> {
  const db = getDb();
  if (kind) return db.select().from(entities).where(and(eq(entities.projectId, projectId), eq(entities.kind, kind))).all();
  return db.select().from(entities).where(eq(entities.projectId, projectId)).all();
}

export async function updateEntity(id: string, patch: Partial<typeof entities.$inferInsert>): Promise<void> {
  const db = getDb();
  await db.update(entities).set(patch).where(eq(entities.id, id)).run();
}

export async function getEntity(id: string): Promise<Entity | undefined> {
  return getDb().select().from(entities).where(eq(entities.id, id)).get();
}

/**
 * Merges fields into `candidate_profile` instead of replacing it. The PATCH
 * route used `updateEntity`, which overwrites the whole JSON column, so moving
 * a rival between tiers would have dropped its reported location and sources.
 */
export async function mergeEntityCandidateProfile(id: string, fields: Record<string, unknown>): Promise<void> {
  const current = await getEntity(id);
  if (!current) return;
  const existing = current.candidateProfile && typeof current.candidateProfile === "object" ? current.candidateProfile : {};
  await getDb().update(entities).set({ candidateProfile: { ...existing, ...fields } }).where(eq(entities.id, id)).run();
}

export async function addEntity(projectId: string, input: { canonicalName: string; kind: "competitor" | "emerging"; competitorType?: "direct" | "substitute" | "marketplace" | "adjacent"; domains?: string[]; candidateProfile?: Record<string, unknown> | null }): Promise<Entity> {
  const db = getDb();
  const row = {
    id: newId("ent"),
    projectId,
    kind: input.kind,
    competitorType: input.competitorType ?? null,
    canonicalName: input.canonicalName,
    normalizedName: normalizeEntityName(input.canonicalName),
    domains: input.domains ?? [],
    canonicalDomain: canonicalizeDomain(input.domains?.[0]),
    entityType: "company",
    parentEntityId: null,
    relationship: null,
    status: "confirmed" as const,
    discoveryStatus: "confirmed",
    confidence: 100,
    reason: "Added manually by operator.",
    geographyRelevance: null,
    evidenceIds: [],
    source: "user_manual" as const,
    sourceContributions: ["user_manual"],
    matchedDimensions: [],
    scoreBreakdown: {},
    verificationStatus: "not_applicable",
    verificationSummary: "Manual entry; user confirmation is the evidence source.",
    rejectionReason: null,
    candidateProfile: input.candidateProfile ?? null,
    createdAt: new Date(),
  };
  await db.insert(entities).values(row).run();
  return row as unknown as Entity;
}

export async function insertAlias(entityId: string, alias: string): Promise<void> {
  const db = getDb();
  await db.insert(aliases).values({ id: newId("als"), entityId, alias, normalizedAlias: normalizeForSimilarity(alias) }).run();
}

export async function listAliasesForEntities(entityIds: string[]): Promise<Array<typeof aliases.$inferSelect>> {
  if (entityIds.length === 0) return [];
  const db = getDb();
  const all = await db.select().from(aliases).all();
  return all.filter((a) => entityIds.includes(a.entityId));
}

export async function createCompetitorDiscoveryRun(projectId: string, businessProfileVersionId: string): Promise<CompetitorDiscoveryRun> {
  const row = {
    id: newId("cdr"),
    projectId,
    businessProfileVersionId,
    status: "running",
    sourceStats: {},
    // Written at creation so a run that fails before planning still records its
    // policy; otherwise the policy-stale check would re-run it on every page open.
    metrics: { policyVersion: COMPETITOR_DISCOVERY_POLICY_VERSION } as unknown as Record<string, number>,
    error: null,
    startedAt: new Date(),
    completedAt: null,
  };
  await getDb().insert(competitorDiscoveryRuns).values(row).run();
  return row as unknown as CompetitorDiscoveryRun;
}

export async function updateCompetitorDiscoveryRun(id: string, patch: Partial<typeof competitorDiscoveryRuns.$inferInsert>): Promise<void> {
  await getDb().update(competitorDiscoveryRuns).set(patch).where(eq(competitorDiscoveryRuns.id, id)).run();
}

export async function getLatestCompetitorDiscoveryRun(projectId: string): Promise<CompetitorDiscoveryRun | undefined> {
  const rows = await getDb().select().from(competitorDiscoveryRuns).where(eq(competitorDiscoveryRuns.projectId, projectId)).all();
  // startedAt has one-second resolution. A stranded run marked failed and its
  // replacement started in the same second tied, and the failed run read as
  // latest; on a tie the row inserted later wins.
  return rows
    .map((row, index) => ({ row, index }))
    .sort((a, b) => b.row.startedAt.getTime() - a.row.startedAt.getTime() || b.index - a.index)[0]?.row;
}

// The drizzle column is typed Record<string, number>, but run metrics also hold
// `policyVersion` and the tier plan (JSON; no schema change). Reads go through
// this validator so a malformed or older row reads as "no plan".
const TierSpecSchema = z.object({
  tier: z.enum(["area", "city", "country"]),
  place: z.string(),
  places: z.array(z.string()),
  level: z.enum(["neighborhood", "city", "country", "global"]),
  countryCodes: z.array(z.string()),
  quota: z.number(),
  radiusMeters: z.number().optional(),
});
const TierPlanSchema = z.object({
  version: z.literal(COMPETITOR_TIER_POLICY_VERSION),
  tiers: z.array(TierSpecSchema),
  primaryTier: z.enum(["area", "city", "country"]).nullable(),
  maxSuggestions: z.number(),
  brandReach: z.object({
    known: z.boolean(),
    points: z.number(),
    signals: z.array(z.object({ kind: z.string(), value: z.string(), points: z.number() })),
    checkedOpenKnowledge: z.boolean(),
  }),
});

export function readTierPlan(run: Pick<CompetitorDiscoveryRun, "metrics"> | null | undefined): CompetitorTierPlan | null {
  const metrics = (run?.metrics ?? null) as Record<string, unknown> | null;
  const parsed = TierPlanSchema.safeParse(metrics?.tierPlan);
  return parsed.success ? (parsed.data as CompetitorTierPlan) : null;
}

export function readRunPolicyVersion(run: Pick<CompetitorDiscoveryRun, "metrics"> | null | undefined): string | null {
  const value = (run?.metrics as Record<string, unknown> | null | undefined)?.policyVersion;
  return typeof value === "string" ? value : null;
}

/** Stores run metrics that include non-numeric fields (policy version, tier plan). */
export function runMetrics(fields: Record<string, unknown>): Record<string, number> {
  return fields as unknown as Record<string, number>;
}

async function latestConfirmedProfileVersion(projectId: string) {
  return getDb()
    .select()
    .from(businessProfileVersions)
    .where(and(eq(businessProfileVersions.projectId, projectId), isNotNull(businessProfileVersions.confirmedAt)))
    .orderBy(desc(businessProfileVersions.version))
    .get();
}

export interface TierContext {
  plan: CompetitorTierPlan;
  target: CompetitiveSearchProfile;
}

/**
 * The plan and target a project's rows are grouped and frozen under: the
 * latest discovery run's stored plan, or (for runs from before tiers) a plan
 * from the confirmed profile with profile-only brand signals. No network.
 */
export async function loadTierContext(projectId: string, options: { run?: CompetitorDiscoveryRun | null; profileVersionId?: string | null } = {}): Promise<TierContext | null> {
  const run = options.run === undefined ? await getLatestCompetitorDiscoveryRun(projectId) : options.run;
  const db = getDb();
  const versionId = options.profileVersionId ?? run?.businessProfileVersionId ?? null;
  const version = (versionId ? await db.select().from(businessProfileVersions).where(eq(businessProfileVersions.id, versionId)).get() : undefined) ?? (await latestConfirmedProfileVersion(projectId));
  if (!version) return null;
  const profile = version.profile as unknown as BusinessProfile;
  const target = buildCompetitiveSearchProfile(profile, []);
  const plan = readTierPlan(run) ?? planCompetitorTiers(profile, target, computeBrandReach(profile, null, false));
  target.tiers = plan;
  return { plan, target };
}

/** The tier a row is shown and frozen under (stored, or derived at read time). Same function for GET and freeze. */
export function effectiveTier(entity: Entity, context: TierContext | null): StoredCompetitorTier | null {
  if (!context) return readStoredTier(entity.candidateProfile) ?? null;
  return effectiveTierFor(entity, context.plan, context.target);
}

/** The operator touched a competitor row: confirmed it, removed it, or added it by hand. */
export function isOperatorTouched(entity: Pick<Entity, "status" | "source" | "rejectionReason">): boolean {
  return entity.status === "confirmed" || entity.source === "user_manual" || (entity.status === "removed" && !entity.rejectionReason);
}

/**
 * A discovery run from an older policy is re-run only when nothing would be
 * lost: no frozen competitive set and no row the operator confirmed, removed or
 * added. Otherwise tiers are derived at read time, so opening Landscape on the
 * live database never silently re-runs discovery behind a loading screen.
 */
export async function isDiscoveryPolicyStale(projectId: string, run: CompetitorDiscoveryRun | null | undefined): Promise<boolean> {
  if (!run || run.status === "running") return false;
  if (readRunPolicyVersion(run) === COMPETITOR_DISCOVERY_POLICY_VERSION) return false;
  if (await getLatestCompetitiveSetVersion(projectId)) return false;
  const competitors = await listEntities(projectId, "competitor");
  return !competitors.some(isOperatorTouched);
}

export async function upsertRankedCompetitorCandidate(projectId: string, candidate: RankedCompetitorCandidate): Promise<Entity> {
  const db = getDb();
  const current = await listEntities(projectId, "competitor");
  const existing = current.find(
    (entity) =>
      (candidate.canonicalDomain && entity.canonicalDomain === candidate.canonicalDomain) ||
      (entity.normalizedName || normalizeEntityName(entity.canonicalName)) === candidate.normalizedName,
  );
  const evidenceIds = [...new Set(candidate.evidence.flatMap((item) => item.evidenceIds))];
  const sourceContributions = [...new Set(candidate.evidence.map((item) => item.source))];
  const confidence = Math.round(candidate.score.total * 0.7 + candidate.confidence * 0.3);
  const rejected = Boolean(candidate.rejectionReason || candidate.role === "not_competitor");
  const patch = {
    competitorType: candidate.role === "not_competitor" ? candidate.proposedType : candidate.role,
    canonicalName: candidate.canonicalName,
    normalizedName: candidate.normalizedName,
    domains: candidate.canonicalDomain ? [candidate.canonicalDomain] : [],
    canonicalDomain: candidate.canonicalDomain,
    entityType: candidate.entityType,
    status: rejected ? "removed" : "candidate",
    discoveryStatus: rejected ? "rejected" : "suggested",
    confidence,
    reason: candidate.reason,
    geographyRelevance: `${candidate.score.geographyOverlap}% overlap`,
    evidenceIds,
    source: sourceContributions[0] ?? "system",
    sourceContributions,
    matchedDimensions: candidate.matchedDimensions,
    scoreBreakdown: candidate.score as unknown as Record<string, number>,
    verificationStatus: candidate.verificationStatus,
    verificationSummary: candidate.verificationSummary,
    rejectionReason: candidate.rejectionReason,
    // Where a search or model source placed the rival, the page it read and
    // the tier its evidence supports travel with the website profile for the
    // "Why?" panel and tier grouping. Measure does not read this column.
    candidateProfile: {
      ...(candidate.candidateProfile ?? {}),
      reportedLocation: candidate.location ?? null,
      sourceUrls: candidate.sourceUrls ?? [],
      tier: rejected ? null : storedTierFrom(candidate.tier),
    } as unknown as Record<string, unknown>,
  };

  let entityId: string;
  if (existing) {
    entityId = existing.id;
    // Re-running discovery must not undo the operator: a confirmed or manually
    // added rival stays confirmed with its name and type, and a rival the
    // operator removed stays removed. Only the evidence is refreshed.
    const operatorOwned = existing.status === "confirmed" || existing.source === "user_manual";
    // The PATCH route marks operator removals discoveryStatus "rejected" too;
    // only system rejections carry a rejection reason.
    const operatorRemoved = existing.status === "removed" && !existing.rejectionReason;
    // A tier the operator chose survives rediscovery; so does a kept row's
    // last tier when this run would have rejected it (it stays confirmed).
    const existingProfile = existing.candidateProfile && typeof existing.candidateProfile === "object" ? existing.candidateProfile : {};
    const existingTier = readStoredTier(existing.candidateProfile);
    const freshTier = storedTierFrom(candidate.tier);
    const keptTier = existingTier?.basis === "operator" ? existingTier : freshTier ?? existingTier;
    const ownedProfile = { ...existingProfile, ...patch.candidateProfile, ...(keptTier !== undefined ? { tier: keptTier } : {}) };
    if (keptTier === undefined) delete (ownedProfile as Record<string, unknown>).tier;
    const update = operatorOwned || operatorRemoved
      ? {
          confidence: patch.confidence,
          reason: existing.reason ?? patch.reason,
          geographyRelevance: patch.geographyRelevance,
          evidenceIds: [...new Set([...(existing.evidenceIds ?? []), ...evidenceIds])],
          sourceContributions: [...new Set([...((existing.sourceContributions as string[] | null) ?? []), ...sourceContributions])],
          matchedDimensions: patch.matchedDimensions,
          scoreBreakdown: patch.scoreBreakdown,
          verificationStatus: patch.verificationStatus,
          verificationSummary: patch.verificationSummary,
          candidateProfile: ownedProfile,
        }
      : patch;
    await db.update(entities).set(update).where(eq(entities.id, existing.id)).run();
  } else {
    entityId = newId("ent");
    await db.insert(entities).values({ id: entityId, projectId, kind: "competitor", ...patch, createdAt: new Date() }).run();
  }
  const knownAliases = await listAliasesForEntities([entityId]);
  const normalizedKnown = new Set(knownAliases.map((alias) => alias.normalizedAlias));
  for (const alias of candidate.aliases) {
    const normalizedAlias = normalizeForSimilarity(alias);
    if (!normalizedAlias || normalizedKnown.has(normalizedAlias)) continue;
    await insertAlias(entityId, alias);
    normalizedKnown.add(normalizedAlias);
  }
  return (await db.select().from(entities).where(eq(entities.id, entityId)).get()) as Entity;
}

function stableHash(value: unknown): string {
  return crypto.createHash("sha256").update(JSON.stringify(value)).digest("hex");
}

export async function freezeCompetitiveSet(projectId: string, businessProfileVersionId: string): Promise<CompetitiveSetVersion> {
  const [allTopics, allEntities] = await Promise.all([listTopics(projectId), listEntities(projectId)]);
  // What the page grouped is what gets frozen: the same effectiveTier as GET.
  const tierContext = await loadTierContext(projectId, { profileVersionId: businessProfileVersionId });
  const confirmedTopics = allTopics.filter((topic) => topic.status === "confirmed").sort((a, b) => a.priority - b.priority);
  // Every confirmed rival is tracked except marketplaces, which are channels a
  // customer buys through rather than alternatives chosen between. Freezing
  // only direct and substitute rivals silently removed confirmed adjacent
  // ones — in two test projects, each brand's highest-confidence rival — from
  // Trade Off prompts and from every Measure competitor metric.
  const eligibleEntities = allEntities.filter(
    (entity) =>
      entity.kind === "competitor" && entity.status === "confirmed" && ["direct", "substitute", "adjacent"].includes(entity.competitorType ?? ""),
  );
  const entityAliases = await listAliasesForEntities(eligibleEntities.map((entity) => entity.id));
  const topicSnapshot: FrozenTopicSnapshot[] = confirmedTopics.map((topic) => ({
    id: topic.id,
    name: topic.name,
    discoveryConcept: topic.discoveryConcept || topic.name,
    priority: topic.priority,
    evidenceIds: (topic.evidenceIds as string[] | null) ?? [],
  }));
  const competitorSnapshot: FrozenCompetitorSnapshotV2[] = eligibleEntities.map((entity) => {
    const tier = effectiveTier(entity, tierContext);
    return {
    entityId: entity.id,
    canonicalName: entity.canonicalName,
    normalizedName: entity.normalizedName || normalizeEntityName(entity.canonicalName),
    canonicalDomain: entity.canonicalDomain,
    aliases: entityAliases.filter((alias) => alias.entityId === entity.id).map((alias) => alias.alias),
    competitorType: entity.competitorType || "direct",
    entityType: entity.entityType,
    confidence: entity.confidence,
    reason: entity.reason,
    provenance: (entity.sourceContributions as string[] | null) ?? [entity.source],
    matchedDimensions: (entity.matchedDimensions as string[] | null) ?? [],
    scoreBreakdown: (entity.scoreBreakdown as Record<string, number> | null) ?? {},
    evidenceIds: (entity.evidenceIds as string[] | null) ?? [],
    verificationStatus: entity.verificationStatus,
    tier: tier?.tier ?? null,
    tierPlace: tier?.place ?? null,
    };
  });
  const frozenHash = stableHash({ businessProfileVersionId, topicSnapshot, competitorSnapshot, discoveryPolicyVersion: COMPETITOR_DISCOVERY_POLICY_VERSION });
  const existing = await getLatestCompetitiveSetVersion(projectId);
  if (existing?.frozenHash === frozenHash) return existing;
  const row = {
    id: newId("csv"),
    projectId,
    version: (existing?.version ?? 0) + 1,
    businessProfileVersionId,
    topicSnapshot,
    competitorSnapshot,
    discoveryPolicyVersion: COMPETITOR_DISCOVERY_POLICY_VERSION,
    frozenHash,
    confirmedAt: new Date(),
    createdAt: new Date(),
  };
  await getDb().insert(competitiveSetVersions).values(row).run();
  return row as unknown as CompetitiveSetVersion;
}

export async function getLatestCompetitiveSetVersion(projectId: string): Promise<CompetitiveSetVersion | undefined> {
  const rows = await getDb().select().from(competitiveSetVersions).where(eq(competitiveSetVersions.projectId, projectId)).all();
  return rows.sort((a, b) => b.version - a.version)[0];
}
