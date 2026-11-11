// Analysis service: read a stored observation, analyse it, persist the result.
//
// Deliberately NOT a new stage in the product journey. Normalization is
// infrastructure between collection and Measure, and giving it its own
// navigation step would ask the operator to care about a step whose whole
// job is to be correct and invisible.

import { and, desc, eq, inArray } from "drizzle-orm";
import { getDb } from "@/lib/db/client";
import { collectionRuns, competitiveSetVersions, observationAnalyses, promptCandidates, promptRuns, promptSets, providerResponses, type FrozenCompetitorSnapshot } from "@/lib/db/schema";
import { newId } from "@/lib/ids";
import { listEntities, listAliasesForEntities, type Entity } from "@/lib/landscape/repository";
import { snapshotEntities } from "@/lib/landscape/frozen-entities";
import { listTopics } from "@/lib/landscape/repository";
import { getLatestProfileVersion } from "@/lib/profile/repository";
import { getPromptContextSnapshot } from "@/lib/prompts/repository";
import type { BusinessProfile } from "@/lib/profile/schema";
import { buildLinkTargets, learnProductForms, type EmergingContext } from "./mentions";
import type { PromptSection } from "@/lib/prompts/types";
import { analyzeObservation } from "./analyzer";
import { ANALYSIS_VERSION, type NormalizedObservation } from "./types";

export interface AnalyseOptions {
  /** Re-analyse even when a row already exists for this version. */
  force?: boolean;
  /** Confirmed topics / criteria, widening aspect coverage. */
  projectAspects?: string[];
}

/**
 * The brands an answer may be linked against: the target, the competitors
 * FROZEN for the prompt set the answer was collected for, and any product or
 * sub-brand entity parented to one of those.
 *
 * Live confirmed entities used to be the inventory. That let a rival confirmed
 * after collection silently join, or fail to join, earlier analyses depending
 * on when they ran — and made two runs on the same questions link against
 * different brands. The frozen set is what Measure's denominators use, so it
 * is what linking uses too. Falls back to the live confirmed set only for
 * legacy prompt sets with no frozen version.
 */
/** Business-type nouns any answer uses when it names a provider of a kind. */
const GENERIC_CATEGORY_TERMS = ["gym", "gyms", "studio", "studios", "salon", "salons", "clinic", "clinics", "restaurant", "restaurants", "cafe", "cafes", "café", "bar", "bars", "bakery", "hotel", "hotels", "agency", "agencies", "school", "schools", "academy", "centre", "center", "club", "clubs", "shop", "shops", "store", "stores", "boutique", "spa", "company", "companies", "platform", "platforms", "software", "app", "apps", "tool", "tools", "service", "services", "provider", "providers", "brand", "brands", "chain", "chains", "trainer", "trainers", "coach", "coaches", "class", "classes", "vendor", "vendors", "supplier", "suppliers", "consultancy", "firm", "firms", "practice", "kitchen", "caterer", "caterers", "venue", "venues"];

/** Words of a profile value; older profiles store some fields as objects or arrays rather than strings. */
function words(value: unknown): string[] {
  if (value === null || value === undefined) return [];
  if (Array.isArray(value)) return value.flatMap(words);
  if (typeof value === "object") return Object.values(value as Record<string, unknown>).flatMap(words);
  if (typeof value !== "string") return [];
  return value
    .toLowerCase()
    .split(/[^a-z0-9]+/)
    .filter((token) => token.length >= 3);
}

/**
 * Places and category words for untracked-name detection: the run's frozen
 * prompt context when the run has one (the same places and topics the
 * questions were written from), else the latest profile and live topics.
 */
/** One context per run per minute: analysing a run asks for it once per answer. */
const contextCache = new Map<string, { at: number; value: EmergingContext }>();
const CONTEXT_CACHE_MS = 60_000;

export async function emergingContextForRun(projectId: string, collectionRunId: string | null): Promise<EmergingContext> {
  const cacheKey = `${projectId}:${collectionRunId ?? ""}`;
  const cached = contextCache.get(cacheKey);
  if (cached && Date.now() - cached.at < CONTEXT_CACHE_MS) return cached.value;
  const value = await buildEmergingContext(projectId, collectionRunId);
  contextCache.set(cacheKey, { at: Date.now(), value });
  return value;
}

async function buildEmergingContext(projectId: string, collectionRunId: string | null): Promise<EmergingContext> {
  const db = getDb();
  const places = new Set<string>();
  const terms = new Set<string>(GENERIC_CATEGORY_TERMS);
  // "Binnamangala, Stage 1, Indiranagar" is three places, not one.
  const addPlace = (value: unknown) => {
    if (typeof value !== "string") return;
    for (const part of value.split(/\s*[,/]\s*/)) if (part.trim().length >= 2) places.add(part.trim());
  };
  const addTerms = (value: unknown) => {
    for (const token of words(value)) terms.add(token);
  };

  let usedSnapshot = false;
  if (collectionRunId) {
    const run = await db.select().from(collectionRuns).where(eq(collectionRuns.id, collectionRunId)).get();
    const promptSet = run ? await db.select().from(promptSets).where(eq(promptSets.id, run.promptSetId)).get() : undefined;
    const snapshot = promptSet?.promptContextSnapshotId ? await getPromptContextSnapshot(promptSet.promptContextSnapshotId) : undefined;
    const context = snapshot?.context as
      | { geography?: { primaryMarket?: string | null; additionalMarkets?: string[]; cities?: string[]; places?: Array<{ name: string }> }; offerings?: string[]; confirmedTopics?: Array<{ name: string }>; classification?: { businessType?: string; localCategory?: string | null; path?: string[] } | null; useCases?: string[] }
      | undefined;
    if (context) {
      usedSnapshot = true;
      addPlace(context.geography?.primaryMarket);
      for (const market of context.geography?.additionalMarkets ?? []) addPlace(market);
      for (const city of context.geography?.cities ?? []) addPlace(city);
      for (const place of context.geography?.places ?? []) addPlace(place.name);
      for (const offering of context.offerings ?? []) addTerms(offering);
      for (const topic of context.confirmedTopics ?? []) addTerms(topic.name);
      addTerms(context.classification?.businessType);
      addTerms(context.classification?.localCategory);
      for (const step of context.classification?.path ?? []) addTerms(step);
    }
  }
  // The profile's places join the snapshot's: branch areas and nearby areas
  // are not prompt places but are what answers name ("the JVC branch").
  {
    const version = await getLatestProfileVersion(projectId);
    const profile = version?.profile as BusinessProfile | undefined;
    if (profile) {
      for (const name of [...profile.geography.countries, ...profile.geography.regions, ...profile.geography.cities, ...(profile.geography.neighborhoods ?? [])]) addPlace(name);
      for (const market of profile.markets) addPlace(market.name);
      const location = profile.location;
      for (const place of [location?.primary, ...(location?.branches ?? [])]) for (const level of [place?.neighborhood, place?.district, place?.city, place?.region, place?.country]) addPlace(level);
      for (const area of location?.nearbyAreas ?? []) addPlace(area);
      for (const area of location?.serviceAreas ?? []) addPlace(area.name);
      for (const offering of [...profile.offerings.values, ...profile.offerings.items.map((item) => item.name)]) addTerms(offering);
      addTerms(profile.classification?.businessType);
      addTerms(profile.classification?.localCategory);
      for (const step of profile.classification?.path ?? []) addTerms(step);
      addTerms(profile.industry.primary);
    }
    if (!usedSnapshot) for (const topic of await listTopics(projectId)) if (topic.status !== "removed") addTerms(topic.name);
  }
  // Product and line names written after a tracked brand anywhere in the
  // run ("Nike Pegasus 40", "Adidas Ultraboost"), so an answer that says only
  // "the Pegasus" does not propose it as a new brand.
  let productForms: string[] = [];
  if (collectionRunId) {
    const { entities, aliasesByEntity } = await linkableEntitiesForRun(projectId, collectionRunId);
    const surfaces = buildLinkTargets(entities, aliasesByEntity)
      .filter((target) => target.surfaceForm !== "product_of")
      .map((target) => target.surface);
    const runs = await db.select({ id: promptRuns.id }).from(promptRuns).where(eq(promptRuns.collectionRunId, collectionRunId)).all();
    if (runs.length > 0 && surfaces.length > 0) {
      const responses = await db
        .select({ responseText: providerResponses.responseText })
        .from(providerResponses)
        .where(inArray(providerResponses.promptRunId, runs.map((run) => run.id)))
        .all();
      productForms = learnProductForms(responses.map((response) => response.responseText ?? ""), surfaces);
    }
  }
  return { places: [...places], categoryTerms: [...terms], productForms };
}

export async function linkableEntitiesForRun(projectId: string, collectionRunId: string | null): Promise<{ entities: Entity[]; aliasesByEntity: Map<string, string[]>; competitiveSetVersionId: string | null }> {
  const db = getDb();
  const live = await listEntities(projectId);
  const target = live.filter((entity) => entity.kind === "target");

  let frozen: FrozenCompetitorSnapshot[] | null = null;
  let competitiveSetVersionId: string | null = null;
  if (collectionRunId) {
    const run = await db.select().from(collectionRuns).where(eq(collectionRuns.id, collectionRunId)).get();
    const promptSet = run ? await db.select().from(promptSets).where(eq(promptSets.id, run.promptSetId)).get() : undefined;
    if (promptSet?.competitiveSetVersionId) {
      const version = await db.select().from(competitiveSetVersions).where(eq(competitiveSetVersions.id, promptSet.competitiveSetVersionId)).get();
      if (version) {
        frozen = version.competitorSnapshot as FrozenCompetitorSnapshot[];
        competitiveSetVersionId = version.id;
      }
    }
  }

  let linkable: Entity[];
  if (frozen) {
    const liveById = new Map(live.map((entity) => [entity.id, entity]));
    const frozenIds = new Set(frozen.map((competitor) => competitor.entityId));
    // A frozen rival keeps its frozen name; its domain list is the union of
    // the snapshot's canonical domain and the live row's domains, because a
    // domain added later is a fact about the company, not about the run.
    const competitors = snapshotEntities(projectId, frozen).map((entity) => {
      const current = liveById.get(entity.id);
      const domains = [...new Set([...(entity.domains as string[]), ...((current?.domains as string[] | undefined) ?? [])])];
      return { ...entity, domains, canonicalDomain: entity.canonicalDomain ?? current?.canonicalDomain ?? null };
    });
    const parentIds = new Set([...target.map((entity) => entity.id), ...frozenIds]);
    const products = live.filter((entity) => entity.parentEntityId && parentIds.has(entity.parentEntityId));
    linkable = [...target, ...competitors, ...products];
  } else {
    // Legacy prompt sets (no frozen version): only entities the user confirmed.
    linkable = live.filter((entity) => entity.kind === "target" || entity.status === "confirmed" || Boolean(entity.parentEntityId));
  }

  const aliasRows = await listAliasesForEntities(linkable.map((entity) => entity.id));
  const aliasesByEntity = new Map<string, string[]>();
  for (const row of aliasRows) {
    const list = aliasesByEntity.get(row.entityId) ?? [];
    list.push(row.alias);
    aliasesByEntity.set(row.entityId, list);
  }
  for (const competitor of frozen ?? []) {
    const list = aliasesByEntity.get(competitor.entityId) ?? [];
    for (const alias of competitor.aliases ?? []) if (!list.includes(alias)) list.push(alias);
    aliasesByEntity.set(competitor.entityId, list);
  }
  return { entities: linkable, aliasesByEntity, competitiveSetVersionId };
}

/**
 * Analyses one captured observation.
 *
 * Returns the existing analysis when one already exists for this version and
 * the source text has not changed — analysis is a pure function of (raw text,
 * frozen entity set, version), so recomputing it is wasted work rather than a
 * correctness risk.
 */
export async function analyseObservationById(
  projectId: string,
  providerResponseId: string,
  options: AnalyseOptions = {},
): Promise<NormalizedObservation> {
  const db = getDb();

  const response = await db.select().from(providerResponses).where(eq(providerResponses.id, providerResponseId)).get();
  if (!response) throw new Error(`provider_response ${providerResponseId} not found`);

  const existing = await db
    .select()
    .from(observationAnalyses)
    .where(and(eq(observationAnalyses.providerResponseId, providerResponseId), eq(observationAnalyses.analysisVersion, ANALYSIS_VERSION)))
    .get();
  if (existing && !options.force) return existing.payload as unknown as NormalizedObservation;

  // provider_responses points at a PROMPT RUN, which in turn names the prompt
  // candidate; resolving the candidate directly from promptRunId would look up
  // the wrong table and silently lose the section.
  const run = await db.select().from(promptRuns).where(eq(promptRuns.id, response.promptRunId)).get();
  const candidate = run
    ? await db.select().from(promptCandidates).where(eq(promptCandidates.id, run.promptCandidateId)).get()
    : undefined;

  const { entities, aliasesByEntity } = await linkableEntitiesForRun(projectId, run?.collectionRunId ?? null);
  const emerging = await emergingContextForRun(projectId, run?.collectionRunId ?? null);

  const result = analyzeObservation({
    observationId: response.id,
    promptCandidateId: candidate?.id ?? run?.promptCandidateId ?? response.promptRunId,
    section: (candidate?.section as PromptSection | undefined) ?? null,
    providerExperience: response.providerExperience,
    responseText: response.responseText,
    sourceUrls: (response.sourceUrls as string[]) ?? [],
    captured: true,
    sourceCaptureState: (response.sourcesCaptureState as never) ?? "unknown",
    answerCaptureState: (response.answerCaptureState as never) ?? "unknown",
    entities,
    aliasesByEntity,
    projectAspects: options.projectAspects,
    emerging,
    questionRivalEntityId: candidate?.competitorEntityId ?? null,
  });

  const priorLatest = await db
    .select()
    .from(observationAnalyses)
    .where(eq(observationAnalyses.providerResponseId, providerResponseId))
    .orderBy(desc(observationAnalyses.analysedAt))
    .get();

  const payload: NormalizedObservation = { ...result, supersedesAnalysisId: priorLatest?.id ?? null };

  await db
    .insert(observationAnalyses)
    .values({
      id: newId("oan"),
      projectId,
      providerResponseId,
      promptCandidateId: payload.promptCandidateId,
      section: payload.section,
      providerExperience: payload.providerExperience,
      analysisVersion: payload.analysisVersion,
      eligibility: payload.eligibility,
      sourceHash: payload.sourceHash,
      payload: payload as unknown as Record<string, unknown>,
      warningCount: payload.warnings.length,
      supersedesAnalysisId: payload.supersedesAnalysisId,
      reviewedBy: null,
      reviewedAt: null,
      analysedAt: new Date(),
    })
    .onConflictDoUpdate({
      target: [observationAnalyses.providerResponseId, observationAnalyses.analysisVersion],
      set: { payload: payload as unknown as Record<string, unknown>, eligibility: payload.eligibility, warningCount: payload.warnings.length, analysedAt: new Date() },
    })
    .run();

  return payload;
}

/**
 * Brings every captured answer of a run up to the current analysis version.
 * Answers already at the current version are left alone; nothing is
 * overwritten (analyses are additive).
 */
export async function reanalyseCollectionRun(collectionRunId: string): Promise<{ analysed: number; skipped: number; failed: number }> {
  const db = getDb();
  const run = await db.select().from(collectionRuns).where(eq(collectionRuns.id, collectionRunId)).get();
  if (!run) throw new Error(`collection_run ${collectionRunId} not found`);
  const rows = await db.select().from(promptRuns).where(eq(promptRuns.collectionRunId, collectionRunId)).all();
  let analysed = 0;
  let skipped = 0;
  let failed = 0;
  for (const promptRun of rows) {
    const response = await db.select().from(providerResponses).where(eq(providerResponses.promptRunId, promptRun.id)).get();
    if (!response) continue;
    const current = await db
      .select({ id: observationAnalyses.id })
      .from(observationAnalyses)
      .where(and(eq(observationAnalyses.providerResponseId, response.id), eq(observationAnalyses.analysisVersion, ANALYSIS_VERSION)))
      .get();
    if (current) {
      skipped += 1;
      continue;
    }
    try {
      await analyseObservationById(run.projectId, response.id);
      analysed += 1;
    } catch {
      failed += 1;
    }
  }
  return { analysed, skipped, failed };
}
