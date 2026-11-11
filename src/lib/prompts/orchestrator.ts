import { getProfileVersion } from "@/lib/profile/repository";
import type { BusinessProfile } from "@/lib/profile/schema";
import { getLatestCompetitiveSetVersion, type Entity, type Topic } from "@/lib/landscape/repository";
import type { FrozenCompetitorSnapshot, FrozenTopicSnapshot } from "@/lib/db/schema";
import { snapshotEntities } from "@/lib/landscape/frozen-entities";
import { listLocations, type Location } from "@/lib/geography/repository";
import { placesToLocations } from "./geography";
import { buildCoveragePolicy, sentimentThemesFor } from "./coverage-policy";
import { generateFromFrames, regenerateFrame, type FrameGenerationContext as GenerationContext } from "./frame-generation";
import { inferRegister, validateNaturalQuery } from "./natural-validator";
import { validateCandidate, buildForbiddenBrandTerms, buildCompetitorForbiddenTerms, scanForBrandLeakage } from "./validators";
import { dedupeCandidates, type DedupableItem } from "./dedupe";
import { scoreCandidate } from "./scoring";
import { openingKeys, selectPromptSetBySection, type ScoredCandidate } from "./selector";
import {
  createPromptContextSnapshot,
  createPromptSet,
  insertCandidates,
  updateCandidate,
  listCandidates,
  getPromptSet,
  updatePromptSet,
  computeFrozenHash,
  getLatestPromptSet,
  getPromptContextSnapshot,
  type PromptSet,
  type PromptCandidateRow,
} from "./repository";
import { buildPromptContextSnapshot, type PromptContextSnapshotData } from "./context";
import { newId } from "@/lib/ids";
import { appendEvent } from "@/lib/events/bus";
import { textSimilarity } from "@/lib/text/similarity";
import type { CandidatePromptDraft, PromptSection } from "./types";
import { APPROVED_TOTAL, SECTION_SELECT_COUNT, generationMethodOf, isModelSource } from "./types";
import { getProject } from "@/lib/projects/repository";
import { spokenName } from "@/lib/landscape/name-forms";
import { rephrasePrompt } from "./intent-generation";
import { clearProviderSuspension } from "@/lib/llm/suspension";
import { discoveryVerdictScore, judgeDiscoveryPrompts, siteClaimsFor, spokenPlace, type DiscoveryVerdict } from "./discovery";
import { judgeSectionPrompts, sectionVerdictScore, type SectionVerdict } from "./section-judge";
import type { PromptIntentModel } from "./intent-model";

export class LandscapeNotConfirmedError extends Error {
  constructor(message = "Confirm 4–6 topics and at least one Direct or Substitute competitor before generating prompts.") {
    super(message);
    this.name = "LandscapeNotConfirmedError";
  }
}

export class PromptSetIncompleteError extends Error {
  constructor(public readonly detail: string) {
    super(`These questions can’t be approved yet: ${detail}`);
    this.name = "PromptSetIncompleteError";
  }
}

const MAX_RETRIES = 3;
const GENERATION_CONCURRENCY = 4;

function sectionForCohort(cohort: string): PromptSection {
  if (cohort === "target_comparison") return "Trade Offs";
  if (cohort === "branded_accuracy") return "Sentiment Analysis";
  return "Discovery";
}

function snapshotTopics(projectId: string, profileVersionId: string, snapshot: FrozenTopicSnapshot[]): Topic[] {
  return snapshot.map((topic) => ({
    id: topic.id,
    projectId,
    businessProfileVersionId: profileVersionId,
    name: topic.name,
    discoveryConcept: topic.discoveryConcept,
    description: "Confirmed in the frozen Landscape version.",
    priority: topic.priority,
    status: "confirmed",
    source: "system",
    evidenceIds: topic.evidenceIds,
    createdAt: new Date(),
  }));
}

/** Frozen rivals as entity rows. Shared with answer analysis; re-exported for tests. */
export { snapshotEntities };

function snapshotLocations(projectId: string, context: PromptContextSnapshotData, existing: Location[]): Location[] {
  // Profile-bound places frozen in the snapshot are the one list generation,
  // regeneration and approval all use (see prompts/geography.ts).
  if (context.geography.places) return placesToLocations(projectId, context.geography.places);
  if (existing.length > 0) return existing;
  const countries = [context.geography.primaryMarket, ...context.geography.additionalMarkets].filter((value): value is string => Boolean(value));
  return [
    ...countries.map((name, index) => ({ id: `snapshot-country-${index}`, projectId, level: "country", name, parentId: null, countryCode: null, evidenceIds: [], isPrimary: index === 0 })),
    ...context.geography.cities.map((name, index) => ({ id: `snapshot-city-${index}`, projectId, level: "city", name, parentId: null, countryCode: null, evidenceIds: [], isPrimary: index === 0 })),
  ] as Location[];
}

function rowForDraft(promptSetId: string, draft: CandidatePromptDraft, sequence: number) {
  const now = new Date();
  return {
    id: newId("pc"),
    promptSetId,
    text: draft.text,
    editedText: null,
    cohort: draft.cohort,
    section: draft.section,
    intent: draft.intent,
    journeyStage: draft.journeyStage,
    topicId: draft.topicId,
    persona: draft.persona,
    useCaseConstraint: draft.useCaseConstraint,
    evaluationCriterion: draft.evaluationCriterion,
    competitorEntityId: draft.competitorEntityId,
    sentimentTheme: draft.sentimentTheme,
    geographyScope: draft.geographyScope,
    geographyText: draft.geographyText,
    locationId: draft.locationId,
    language: draft.language,
    brandPolicy: draft.brandPolicy,
    coverageCellKey: draft.coverageCellKey,
    evidenceBasis: draft.evidenceBasis,
    generationSource: draft.generationMethod,
    contextBasis: draft.contextBasis,
    qualityScore: null,
    qualityBreakdown: null,
    coverageGain: null,
    diversityGain: null,
    selectionScore: null,
    validationResult: null,
    semanticClusterId: null,
    lifecycleState: "CANDIDATE" as const,
    rejectedReason: null,
    duplicateOfId: null,
    selectionReason: null,
    sequence,
    createdAt: now,
    updatedAt: now,
  };
}

function draftFromRow(candidate: PromptCandidateRow): CandidatePromptDraft {
  const recoveredRegister = inferRegister(candidate.editedText ?? candidate.text);
  return {
    text: candidate.editedText ?? candidate.text,
    cohort: candidate.cohort as CandidatePromptDraft["cohort"],
    section: (candidate.section ?? sectionForCohort(candidate.cohort)) as PromptSection,
    intent: candidate.intent as CandidatePromptDraft["intent"],
    journeyStage: candidate.journeyStage as CandidatePromptDraft["journeyStage"],
    topicId: candidate.topicId,
    persona: candidate.persona,
    useCaseConstraint: candidate.useCaseConstraint,
    evaluationCriterion: candidate.evaluationCriterion,
    competitorEntityId: candidate.competitorEntityId,
    sentimentTheme: candidate.sentimentTheme,
    geographyScope: candidate.geographyScope as CandidatePromptDraft["geographyScope"],
    geographyText: candidate.geographyText,
    locationId: candidate.locationId,
    language: candidate.language,
    brandPolicy: candidate.brandPolicy as CandidatePromptDraft["brandPolicy"],
    coverageCellKey: candidate.coverageCellKey,
    evidenceBasis: (candidate.evidenceBasis as string[] | null) ?? [],
    contextBasis: (candidate.contextBasis as string[] | null) ?? [],
    register: recoveredRegister,
    generationMethod: generationMethodOf(candidate.generationSource),
  };
}

function validationContext(profile: BusinessProfile, context: PromptContextSnapshotData, locations: Location[]) {
  return {
    profile,
    forbiddenTerms: buildForbiddenBrandTerms(profile),
    competitorForbiddenTerms: buildCompetitorForbiddenTerms(context.confirmedCompetitors),
    confirmedCompetitors: context.confirmedCompetitors,
    approvedTopicIds: context.confirmedTopics.map((topic) => topic.id),
    approvedLocations: locations,
    placeBound: context.geography.placeBound ?? false,
  };
}

/**
 * Generates and validates a whole batch of frame-realized drafts. Frames are
 * planned globally (the planner reasons about the section as a whole, not one
 * slot at a time), so generation is one batch rather than a per-cell fan-out.
 */
async function generateAndValidateDrafts(
  projectId: string,
  promptSetId: string,
  drafts: CandidatePromptDraft[],
  sequenceBase: number,
  validationCtx: ReturnType<typeof validationContext>,
  counters: Record<string, number>,
): Promise<void> {
  if (drafts.length === 0) return;
  const rows = drafts.map((draft, index) => rowForDraft(promptSetId, draft, sequenceBase + index + 1));
  await insertCandidates(rows);
  counters.generated = (counters.generated ?? 0) + rows.length;
  if (!counters.firstCandidateMs && counters.generationStartedAt) counters.firstCandidateMs = Date.now() - counters.generationStartedAt;

  for (let index = 0; index < rows.length; index++) {
    const row = rows[index]!;
    const draft = drafts[index]!;
    // The hard policy gate (brand leakage, competitor validity, geography)
    // runs first, then the natural-language gate. Either rejects outright.
    const policyResult = validateCandidate(draft, validationCtx);
    const naturalResult = policyResult.pass
      ? validateNaturalQuery({ text: draft.text, section: draft.section, register: draft.register })
      : { ok: true as const };

    const pass = policyResult.pass && naturalResult.ok;
    const code = !policyResult.pass ? policyResult.code : naturalResult.ok ? null : naturalResult.code;
    const reason = !policyResult.pass ? policyResult.reason : naturalResult.ok ? null : naturalResult.detail;

    await updateCandidate(row.id, {
      lifecycleState: pass ? "VALIDATED" : "REJECTED",
      rejectedReason: pass ? null : `${code}: ${reason}`,
      validationResult: { ...policyResult, natural: naturalResult } as unknown as Record<string, unknown>,
    });

    if (pass) {
      counters.validated = (counters.validated ?? 0) + 1;
      if (!counters.firstValidatedMs && counters.generationStartedAt) counters.firstValidatedMs = Date.now() - counters.generationStartedAt;
      appendEvent(projectId, "prompt.candidate.validated", { promptSetId, candidateId: row.id, section: draft.section });
    } else {
      if (code === "brand_leakage" || code === "competitor_leakage") counters.rejectedBrand = (counters.rejectedBrand ?? 0) + 1;
      else if (naturalResult.ok === false) counters.rejectedLanguage = (counters.rejectedLanguage ?? 0) + 1;
      else counters.rejectedOther = (counters.rejectedOther ?? 0) + 1;
      appendEvent(projectId, "prompt.candidate.rejected", { promptSetId, candidateId: row.id, code, reason });
    }
  }
  appendEvent(projectId, "prompt.counters.updated", { promptSetId, counters: { ...counters } });
}

export interface GeneratePromptSetOptions {
  /**
   * Build a new prompt-set version even when one already exists for this
   * competitive set. Earlier versions are left untouched — collection runs
   * reference them by id — so regenerating after an engine upgrade never
   * disturbs evidence already collected.
   */
  force?: boolean;
}

export async function generatePromptSet(projectId: string, options: GeneratePromptSetOptions = {}): Promise<PromptSet> {
  const generationStartedAt = Date.now();
  // A new run asks the paid writer again: credits may have been added since a refusal.
  clearProviderSuspension();
  const project = await getProject(projectId);
  if (!project) throw new Error(`project ${projectId} not found`);
  const competitiveSet = await getLatestCompetitiveSetVersion(projectId);
  if (!competitiveSet) throw new LandscapeNotConfirmedError();
  const topicsSnapshot = competitiveSet.topicSnapshot as FrozenTopicSnapshot[];
  const competitorsSnapshot = competitiveSet.competitorSnapshot as FrozenCompetitorSnapshot[];
  if (topicsSnapshot.length < 4 || topicsSnapshot.length > 6 || competitorsSnapshot.length < 1) throw new LandscapeNotConfirmedError();

  const existing = await getLatestPromptSet(projectId);
  if (!options.force && existing && existing.competitiveSetVersionId === competitiveSet.id && ["generating", "reviewing", "approved"].includes(existing.status)) return existing;

  const profileVersion = await getProfileVersion(competitiveSet.businessProfileVersionId);
  if (!profileVersion?.confirmedAt) throw new Error("The frozen competitive set references an unavailable confirmed business profile.");
  const profile = profileVersion.profile as unknown as BusinessProfile;
  const contextData = buildPromptContextSnapshot(profile, profileVersion.id, competitiveSet, project.language);
  const contextSnapshot = await createPromptContextSnapshot(projectId, profileVersion.id, competitiveSet.id, contextData);
  appendEvent(projectId, "prompt.context.ready", { contextSnapshotId: contextSnapshot.id, competitiveSetVersionId: competitiveSet.id });

  const topics = snapshotTopics(projectId, profileVersion.id, topicsSnapshot);
  const competitors = snapshotEntities(projectId, competitorsSnapshot);
  const locations = snapshotLocations(projectId, contextData, await listLocations(projectId));
  const policy = buildCoveragePolicy(profile.archetype.value, topics, competitors, locations);
  const promptSet = await createPromptSet(projectId, profileVersion.id, policy, {
    competitiveSetVersionId: competitiveSet.id,
    promptContextSnapshotId: contextSnapshot.id,
    selectionPolicyVersion: policy.version,
  });
  appendEvent(projectId, "prompt.coverage_plan.ready", {
    promptSetId: promptSet.id,
    totalSlots: policy.cells.length,
    discovery: policy.cells.filter((cell) => cell.section === "Discovery").length,
    tradeOffs: policy.cells.filter((cell) => cell.section === "Trade Offs").length,
    sentiment: policy.cells.filter((cell) => cell.section === "Sentiment Analysis").length,
  });
  appendEvent(projectId, "prompt.generation.started", { promptSetId: promptSet.id, cellCount: policy.cells.length, concurrency: GENERATION_CONCURRENCY });

  const generationContext: GenerationContext = { projectId, profile, topics, competitors, locations, language: project.language };
  const validationCtx = validationContext(profile, contextData, locations);
  const counters: Record<string, number> = {
    generated: 0,
    validated: 0,
    rejectedBrand: 0,
    rejectedOther: 0,
    duplicates: 0,
    shortlisted: 0,
    selected: 0,
    retryCount: 0,
    aiCallCount: 0,
    generationStartedAt,
    firstCandidateMs: 0,
    firstValidatedMs: 0,
  };

  const frameRun = await generateFromFrames(generationContext);
  // The judge reads the business and the intent model the drafts came from.
  const judgeContext = { projectId, profile, competitors, locations, model: frameRun.intentModel };
  counters.framesPlanned = frameRun.stats.framesPlanned;
  counters.framesDiscarded = frameRun.stats.framesDiscarded;
  counters.deterministicDrafts = frameRun.stats.deterministic;
  counters.providerDrafts = frameRun.stats.provider;
  counters.aiCallCount = frameRun.stats.providerBatches;
  counters.intentRetries = frameRun.stats.intentRetries;
  counters.intentFailedSections = frameRun.stats.intentFailedSections;
  if (frameRun.intentModel) {
    counters.intentNeeds = frameRun.intentModel.needs.length;
    // The plan behind the prompts, published so it can be inspected: which
    // needs, situations, concerns and decision factors the set was built from.
    appendEvent(projectId, "prompt.context.ready", { promptSetId: promptSet.id, intentModel: frameRun.intentModel });
  }
  appendEvent(projectId, "prompt.generation.started", {
    promptSetId: promptSet.id,
    framesPlanned: frameRun.stats.framesPlanned,
    framesDiscarded: frameRun.stats.framesDiscarded,
    mode: frameRun.stats.provider > 0 ? "ai_assisted" : "deterministic",
  });
  for (const warning of frameRun.warnings) {
    appendEvent(projectId, "policy.status", { stage: "prompt_frame_plan", warning });
  }
  await generateAndValidateDrafts(projectId, promptSet.id, frameRun.drafts, 0, validationCtx, counters);

  counters.generationMs = Date.now() - generationStartedAt;
  const firstDedupeStartedAt = Date.now();
  await runDedupeScoreShortlist(projectId, promptSet.id, counters, judgeContext);
  counters.dedupeMs = Date.now() - firstDedupeStartedAt;
  counters.usefulShortlistMs = Date.now() - generationStartedAt;
  const firstSelectionStartedAt = Date.now();
  let selection = await runSelection(promptSet.id);
  counters.selectionMs = Date.now() - firstSelectionStartedAt;
  let retries = 0;
  // A shortfall now means "this section could not reach ten", so a retry
  // regenerates every cell feeding the short section rather than one slot.
  // Only the short sections are written again, from the first pass's intent
  // model: a retry used to re-run the planner and all three writers (four
  // paid calls) to refill one section.
  while (selection.shortfalls.length > 0 && retries < MAX_RETRIES) {
    retries += 1;
    counters.retryCount = retries;
    const shortSections = new Set(selection.shortfalls.map((shortfall) => shortfall.section));
    const retryRun = await generateFromFrames(generationContext, { sections: [...shortSections], intentModel: frameRun.intentModel });
    counters.aiCallCount = (counters.aiCallCount ?? 0) + retryRun.stats.providerBatches;
    counters.providerDrafts = (counters.providerDrafts ?? 0) + retryRun.stats.provider;
    if (retryRun.intentModel) judgeContext.model = retryRun.intentModel;
    const retryDrafts = retryRun.drafts.filter((draft) => shortSections.has(draft.section));
    await generateAndValidateDrafts(projectId, promptSet.id, retryDrafts, retries * 10_000, validationCtx, counters);
    const retryDedupeStartedAt = Date.now();
    await runDedupeScoreShortlist(projectId, promptSet.id, counters, judgeContext);
    counters.dedupeMs += Date.now() - retryDedupeStartedAt;
    const retrySelectionStartedAt = Date.now();
    selection = await runSelection(promptSet.id);
    counters.selectionMs += Date.now() - retrySelectionStartedAt;
  }

  const allCandidates = await listCandidates(promptSet.id);
  for (const selectedId of selection.selectedIds) {
    const candidate = allCandidates.find((row) => row.id === selectedId)!;
    const utility = selection.utilities.get(selectedId)!;
    await updateCandidate(selectedId, {
      lifecycleState: "SELECTED",
      coverageGain: utility.coverageGain,
      diversityGain: utility.diversityGain,
      selectionScore: utility.selectionScore,
      selectionReason: buildSelectionReason(candidate, utility),
    });
    counters.selected = (counters.selected ?? 0) + 1;
    appendEvent(projectId, "prompt.candidate.selected", { promptSetId: promptSet.id, candidateId: selectedId, section: candidate.section, ...utility });
  }
  counters.totalMs = Date.now() - generationStartedAt;
  await updatePromptSet(promptSet.id, { status: "reviewing", generationStats: counters });
  appendEvent(projectId, "prompt.shortlist.updated", { promptSetId: promptSet.id, selected: counters.selected });
  appendEvent(projectId, "prompt_set.ready", { promptSetId: promptSet.id, counters, shortfalls: selection.shortfalls });
  return (await getPromptSet(promptSet.id))!;
}

interface DiscoveryJudgeContext {
  projectId: string;
  profile: BusinessProfile;
  competitors: Entity[];
  locations: Location[];
  model: PromptIntentModel | null;
}

/**
 * Judges the model-written Discovery prompts that survived the gates and
 * dedupe, in one call. The heuristic scorer rated every assembled prompt of the
 * old Discovery set 81–96, so for these rows the verdict is the quality score;
 * a prompt failing any check can still be browsed and picked by the reviewer
 * but is never auto-selected. Without a judge route the heuristic score stands.
 */
async function judgeDiscoverySurvivors(rows: PromptCandidateRow[], context: DiscoveryJudgeContext | undefined): Promise<{ verdicts: Map<string, DiscoveryVerdict>; model: string | null }> {
  const verdicts = new Map<string, DiscoveryVerdict>();
  // Templates are judged too, model prompts first: when the judge fails many
  // model prompts, templates fill the section, and "Recommend a shortlist of
  // desserts with strong occasion fit" was selected for a burger restaurant
  // exactly that way. A template that passes keeps its heuristic score.
  const discovery = rows
    .filter((row) => (row.section ?? sectionForCohort(row.cohort)) === "Discovery")
    .sort((a, b) => Number(isModelSource(b.generationSource)) - Number(isModelSource(a.generationSource)) || (b.qualityScore ?? 0) - (a.qualityScore ?? 0))
    .slice(0, DISCOVERY_JUDGE_LIMIT);
  if (!context || discovery.length === 0) return { verdicts, model: null };
  const profile = context.profile;
  const names = [profile.identity.brandName.value, ...profile.identity.aliases.values, ...context.competitors.filter((entity) => entity.kind === "competitor").map((entity) => entity.canonicalName)];
  const result = await judgeDiscoveryPrompts({
    projectId: context.projectId,
    profile,
    model: context.model,
    siteClaims: context.model ? siteClaimsFor(profile, context.model) : [...(profile.positioning?.differentiators ?? [])],
    names,
    places: [...new Set(context.locations.flatMap((location) => [location.name, spokenPlace(location.name, "primary")]).filter((name): name is string => Boolean(name)))],
    texts: discovery.map((row) => row.text),
  });
  discovery.forEach((row, index) => {
    const verdict = result.verdicts.get(index);
    if (verdict) verdicts.set(row.id, verdict);
  });
  return { verdicts, model: result.model };
}

/** Most survivors one section judge call reads; the rest keep their heuristic score. */
const SECTION_JUDGE_LIMIT = 60;
/** Most Discovery survivors one judge call reads (model-written first). */
const DISCOVERY_JUDGE_LIMIT = 60;

/**
 * Judges the Trade Off and Sentiment survivors, model-written and template
 * alike, one call per section. Templates are judged too because they are the
 * fallback that fills a short section, and "Atelier 10 Salon vs 011 Italian
 * Grooming DIFC reliability" was selected exactly that way. Without a judge
 * route the heuristic score stands.
 */
async function judgeSectionSurvivors(rows: PromptCandidateRow[], context: DiscoveryJudgeContext | undefined): Promise<{ verdicts: Map<string, SectionVerdict>; model: string | null }> {
  const verdicts = new Map<string, SectionVerdict>();
  if (!context) return { verdicts, model: null };
  const profile = context.profile;
  const brand = spokenName(profile.identity.brandName.value, [profile.identity.canonicalDomain, ...profile.identity.domains]);
  const rivals = context.competitors
    .filter((entity) => entity.kind === "competitor")
    .map((entity) => {
      const spoken = spokenName(entity.canonicalName, [entity.canonicalDomain, ...(entity.domains ?? [])]);
      return spoken === entity.canonicalName ? entity.canonicalName : `${entity.canonicalName} (${spoken})`;
    });
  let model: string | null = null;
  for (const section of ["Trade Offs", "Sentiment Analysis"] as const) {
    const inSection = rows
      .filter((row) => (row.section ?? sectionForCohort(row.cohort)) === section && row.generationSource !== "user")
      // Model-written first, then the best templates, so the call reads what selection would pick.
      .sort((a, b) => Number(isModelSource(b.generationSource)) - Number(isModelSource(a.generationSource)) || (b.qualityScore ?? 0) - (a.qualityScore ?? 0))
      .slice(0, SECTION_JUDGE_LIMIT);
    if (inSection.length === 0) continue;
    const result = await judgeSectionPrompts({ projectId: context.projectId, profile, brand, rivals, section, texts: inSection.map((row) => row.editedText ?? row.text) });
    inSection.forEach((row, index) => {
      const verdict = result.verdicts.get(index);
      if (verdict) verdicts.set(row.id, verdict);
    });
    model = model ?? result.model;
  }
  return { verdicts, model };
}

async function runDedupeScoreShortlist(projectId: string, promptSetId: string, counters: Record<string, number>, judgeContext?: DiscoveryJudgeContext): Promise<void> {
  const all = await listCandidates(promptSetId);
  const validated = all.filter((candidate) => candidate.lifecycleState === "VALIDATED");
  const contextKey = (candidate: PromptCandidateRow) => [candidate.topicId, candidate.intent, candidate.competitorEntityId, candidate.evaluationCriterion, candidate.sentimentTheme, candidate.geographyText].filter(Boolean).join("|");
  const items: DedupableItem[] = validated.map((candidate) => ({ id: candidate.id, text: candidate.text, cohort: candidate.section ?? sectionForCohort(candidate.cohort), contextKey: contextKey(candidate) }));
  const anchors: DedupableItem[] = all
    .filter((candidate) => ["SHORTLISTED", "SELECTED", "USER_APPROVED"].includes(candidate.lifecycleState))
    .map((candidate) => ({ id: candidate.id, text: candidate.editedText ?? candidate.text, cohort: candidate.section ?? sectionForCohort(candidate.cohort), contextKey: contextKey(candidate) }));
  const { survivors, duplicateOf, clusterIdByCandidate } = dedupeCandidates(items, anchors);
  for (const [candidateId, duplicateId] of duplicateOf) {
    await updateCandidate(candidateId, {
      lifecycleState: "REJECTED",
      rejectedReason: `exact_or_semantic_duplicate: best represented by ${duplicateId}`,
      duplicateOfId: duplicateId,
      semanticClusterId: clusterIdByCandidate.get(candidateId),
    });
    counters.duplicates = (counters.duplicates ?? 0) + 1;
    appendEvent(projectId, "prompt.candidate.clustered", { promptSetId, candidateId, clusterId: clusterIdByCandidate.get(candidateId), duplicateOfId: duplicateId });
  }
  const survivorsRows = validated.filter((candidate) => survivors.includes(candidate.id));
  // The section judges need the heuristic order, so templates are scored first.
  const heuristics = new Map<string, ReturnType<typeof scoreCandidate>>();
  for (const candidate of survivorsRows) {
    const section = candidate.section ?? sectionForCohort(candidate.cohort);
    const sameSection = survivorsRows.filter((other) => other.id !== candidate.id && (other.section ?? sectionForCohort(other.cohort)) === section);
    const maxSimilarity = sameSection.length ? Math.max(...sameSection.map((other) => textSimilarity(candidate.text, other.text))) : 0;
    heuristics.set(candidate.id, scoreCandidate(draftFromRow(candidate), maxSimilarity));
  }
  const [judged, judgedSections] = await Promise.all([
    judgeDiscoverySurvivors(survivorsRows, judgeContext),
    judgeSectionSurvivors(
      survivorsRows.map((row) => ({ ...row, qualityScore: heuristics.get(row.id)?.total ?? row.qualityScore })),
      judgeContext,
    ),
  ]);
  if (judged.verdicts.size > 0) {
    counters.discoveryJudged = (counters.discoveryJudged ?? 0) + judged.verdicts.size;
    counters.discoveryJudgeFailed = (counters.discoveryJudgeFailed ?? 0) + [...judged.verdicts.values()].filter((verdict) => discoveryVerdictScore(verdict).failed).length;
  }
  if (judgedSections.verdicts.size > 0) {
    counters.sectionJudged = (counters.sectionJudged ?? 0) + judgedSections.verdicts.size;
    counters.sectionJudgeFailed = (counters.sectionJudgeFailed ?? 0) + [...judgedSections.verdicts.values()].filter((verdict) => sectionVerdictScore(verdict).failed).length;
  }
  for (const candidate of survivorsRows) {
    const heuristic = heuristics.get(candidate.id)!;
    const verdict = judged.verdicts.get(candidate.id);
    const sectionVerdict = judgedSections.verdicts.get(candidate.id);
    const judgedScore = verdict ? discoveryVerdictScore(verdict) : sectionVerdict ? sectionVerdictScore(sectionVerdict) : null;
    const breakdown = judgedScore
      ? {
          ...heuristic,
          // A template that passes the judge keeps its heuristic score (below a
          // passing model prompt, which selection prefers anyway); a failure is
          // below the floor whoever wrote it.
          total: judgedScore.failed ? judgedScore.total : isModelSource(candidate.generationSource) ? Math.max(0, judgedScore.total - heuristic.redundancyPenalty) : Math.max(heuristic.total, 0),
          cappedReason: judgedScore.failed,
          judgeGiveaway: (verdict ?? sectionVerdict)?.giveaway ?? "",
          judgeModel: verdict ? judged.model : judgedSections.model,
        }
      : heuristic;
    await updateCandidate(candidate.id, {
      lifecycleState: "SHORTLISTED",
      qualityScore: breakdown.total,
      qualityBreakdown: breakdown as unknown as Record<string, number>,
      semanticClusterId: clusterIdByCandidate.get(candidate.id),
    });
    counters.shortlisted = (counters.shortlisted ?? 0) + 1;
    appendEvent(projectId, "prompt.candidate.scored", { promptSetId, candidateId: candidate.id, qualityScore: breakdown.total });
    appendEvent(projectId, "prompt.candidate.shortlisted", { promptSetId, candidateId: candidate.id, score: breakdown.total });
  }
}

async function runSelection(promptSetId: string) {
  const candidates = (await listCandidates(promptSetId)).filter((candidate) => candidate.lifecycleState === "SHORTLISTED");
  // Sections where a provider wrote candidates; there, templates are fallback.
  const providerSections = new Set(
    candidates.filter((candidate) => isModelSource(candidate.generationSource)).map((candidate) => candidate.section ?? sectionForCohort(candidate.cohort)),
  );
  const pool: ScoredCandidate[] = candidates.map((candidate, index) => ({
    id: candidate.id,
    section: (candidate.section ?? sectionForCohort(candidate.cohort)) as PromptSection,
    qualityScore: candidate.qualityScore ?? 0,
    // The frame's coverage keys were stored on the draft; they are what the
    // selector diversifies over.
    coverageKeys: (candidate.evidenceBasis as string[] | null) && Array.isArray(candidate.contextBasis)
      ? (candidate.contextBasis as string[])
      : coverageKeysFromRow(candidate),
    competitorEntityId: candidate.competitorEntityId,
    topicId: candidate.topicId,
    sentimentTheme: candidate.sentimentTheme,
    evaluationCriterion: candidate.evaluationCriterion,
    register: inferRegister(candidate.editedText ?? candidate.text),
    // The frame recorded its category on the draft's coverage keys.
    categoryKey: (candidate.contextBasis as string[] | null)?.find((key) => key.startsWith("category:")) ?? candidate.topicId,
    maxSimilarity: similarityOf(candidate, candidates),
    sequence: candidate.sequence ?? index,
    fallback: candidate.generationSource === "template" && providerSections.has(candidate.section ?? sectionForCohort(candidate.cohort)),
    capKeys: capKeysFor(candidate),
  }));
  return selectPromptSetBySection(pool);
}

/**
 * The keys a section caps (selector SECTION_KEY_CAPS): the opening words and
 * the plan's shape, style, budget and place role. Only model-written prompts
 * carry them: the template floor rotates its own openers by design, and capping
 * them left a confirmed topic uncovered in the keyless travel benchmark.
 */
function capKeysFor(candidate: PromptCandidateRow): string[] {
  if (!isModelSource(candidate.generationSource)) return [];
  const basis = (candidate.contextBasis as string[] | null) ?? [];
  return [...openingKeys(candidate.editedText ?? candidate.text), ...basis.filter((key) => /^(shape|style|budget|placeRole):/.test(key))];
}

/** Falls back to reconstructing coverage keys when a row predates frames. */
function coverageKeysFromRow(candidate: PromptCandidateRow): string[] {
  return [
    `intent:${candidate.intent}`,
    candidate.topicId ? `topic:${candidate.topicId}` : null,
    candidate.persona ? `audience:${candidate.persona}` : null,
    candidate.evaluationCriterion ? `criterion:${candidate.evaluationCriterion}` : null,
    candidate.competitorEntityId ? `competitor:${candidate.competitorEntityId}` : null,
    candidate.sentimentTheme ? `theme:${candidate.sentimentTheme}` : null,
    candidate.geographyText ? `location:${candidate.geographyText}` : null,
  ].filter((value): value is string => Boolean(value));
}

/**
 * Redundancy is measured WITHIN a register, not across the whole section.
 *
 * "Recommend the best X brands" and "Suggest good X for Y" are structurally
 * alike, so scoring every imperative against the section's questions charged
 * the whole register a redundancy penalty for being internally consistent and
 * pushed all of it below the selection floor — the section then came out in a
 * single voice. Two prompts in different registers are different measurements
 * even when their surface forms rhyme.
 */
function similarityOf(candidate: PromptCandidateRow, all: PromptCandidateRow[]): number {
  const section = candidate.section ?? sectionForCohort(candidate.cohort);
  const register = inferRegister(candidate.editedText ?? candidate.text);
  const peers = all.filter(
    (other) =>
      other.id !== candidate.id &&
      (other.section ?? sectionForCohort(other.cohort)) === section &&
      inferRegister(other.editedText ?? other.text) === register,
  );
  if (peers.length === 0) return 0;
  return Math.max(...peers.map((other) => textSimilarity(candidate.editedText ?? candidate.text, other.editedText ?? other.text)));
}

/**
 * Explains why this prompt made the cut. Reads the candidate row rather than a
 * coverage cell: since the frame planner took over, `coverageCellKey` holds a
 * frame id, so a cell lookup no longer resolves.
 */
function buildSelectionReason(
  candidate: PromptCandidateRow,
  utility: { coverageGain: number; diversityGain: number; selectionScore: number; reason?: string },
): string {
  const section = candidate.section ?? sectionForCohort(candidate.cohort);
  const context = [
    candidate.persona && `audience “${candidate.persona}”`,
    candidate.useCaseConstraint && `use case “${candidate.useCaseConstraint}”`,
    candidate.evaluationCriterion && `criterion “${candidate.evaluationCriterion}”`,
    candidate.sentimentTheme && `theme “${candidate.sentimentTheme}”`,
    candidate.geographyText && `market “${candidate.geographyText}”`,
  ]
    .filter(Boolean)
    .join(", ");

  return `Best validated representative for ${section}${context ? ` covering ${context}` : ""}. Quality ${candidate.qualityScore ?? 0}/100; coverage contribution ${Math.round(utility.coverageGain * 100)}%; diversity contribution ${Math.round(utility.diversityGain * 100)}%. Passed identity-leakage, competitor, geography, safety, natural-language, and duplicate gates.`;
}

async function loadApprovalContext(promptSet: PromptSet) {
  if (!promptSet.promptContextSnapshotId) throw new PromptSetIncompleteError("prompt context snapshot is missing");
  const snapshot = await getPromptContextSnapshot(promptSet.promptContextSnapshotId);
  if (!snapshot) throw new PromptSetIncompleteError("prompt context snapshot cannot be loaded");
  const context = snapshot.context as unknown as PromptContextSnapshotData;
  const profileVersion = await getProfileVersion(promptSet.businessProfileVersionId);
  if (!profileVersion) throw new PromptSetIncompleteError("business profile version cannot be loaded");
  const profile = profileVersion.profile as unknown as BusinessProfile;
  const locations = snapshotLocations(promptSet.projectId, context, []);
  return { context, profile, locations, validationCtx: validationContext(profile, context, locations) };
}

export async function approvePromptSet(promptSetId: string, approvedBy: string): Promise<PromptSet> {
  const promptSet = await getPromptSet(promptSetId);
  if (!promptSet) throw new Error(`prompt set ${promptSetId} not found`);
  if (promptSet.status === "approved") return promptSet;
  const all = await listCandidates(promptSetId);
  const selected = all.filter((candidate) => candidate.lifecycleState === "SELECTED" || candidate.lifecycleState === "USER_APPROVED");
  if (selected.length !== APPROVED_TOTAL) throw new PromptSetIncompleteError(`exactly ${APPROVED_TOTAL} prompts required, found ${selected.length}`);
  const counts = {
    discovery: selected.filter((candidate) => (candidate.section ?? sectionForCohort(candidate.cohort)) === "Discovery").length,
    tradeOffs: selected.filter((candidate) => (candidate.section ?? sectionForCohort(candidate.cohort)) === "Trade Offs").length,
    sentiment: selected.filter((candidate) => (candidate.section ?? sectionForCohort(candidate.cohort)) === "Sentiment Analysis").length,
  };
  // Approval is the gate that makes the section policy real: an operator can
  // edit and swap freely, but a set that is not exactly ten in each section
  // cannot be frozen.
  const required = SECTION_SELECT_COUNT;
  if (
    counts.discovery !== required.Discovery ||
    counts.tradeOffs !== required["Trade Offs"] ||
    counts.sentiment !== required["Sentiment Analysis"]
  ) {
    throw new PromptSetIncompleteError(
      `section policy must be ${required.Discovery}/${required["Trade Offs"]}/${required["Sentiment Analysis"]}, found ${counts.discovery}/${counts.tradeOffs}/${counts.sentiment}`,
    );
  }
  // Every approved prompt must still read like a real user question — an edit
  // made after selection is revalidated here, not trusted.
  // Every failing prompt is reported at once, by its words: stopping at the
  // first and naming it by row id ("pc_866f…: missing_required_competitor")
  // left the reviewer unable to tell which prompt to fix, and fixing it only
  // revealed the next (2026-10-15).
  const failures: string[] = [];
  const quoted = (candidate: (typeof selected)[number]) => `“${(candidate.editedText ?? candidate.text).trim()}”`;
  for (const candidate of selected) {
    // A prompt the reviewer wrote is how they ask. The natural-language gate
    // exists to catch machine-written splices; the measurement rules below
    // still apply to it.
    if (candidate.generationSource === "user") continue;
    const text = (candidate.editedText ?? candidate.text).trim();
    const section = (candidate.section ?? sectionForCohort(candidate.cohort)) as PromptSection;
    const natural = validateNaturalQuery({ text, section, register: inferRegister(text) });
    if (!natural.ok) failures.push(`${quoted(candidate)}: ${natural.detail}`);
  }
  const { validationCtx } = await loadApprovalContext(promptSet);
  const seen = new Set<string>();
  for (const candidate of selected) {
    const draft = draftFromRow(candidate);
    const validation = validateCandidate(draft, validationCtx);
    if (!validation.pass) failures.push(`${quoted(candidate)}: ${validation.reason}`);
    const key = (candidate.editedText ?? candidate.text).trim().toLowerCase();
    if (seen.has(key)) failures.push(`${quoted(candidate)} appears twice.`);
    seen.add(key);
  }
  if (failures.length > 0) {
    throw new PromptSetIncompleteError(
      `${failures.length === 1 ? "one prompt needs" : `${failures.length} prompts need`} replacing or editing before approval. ${failures.join(" ")}`,
    );
  }
  for (const candidate of selected) await updateCandidate(candidate.id, { lifecycleState: "USER_APPROVED" });
  const approvedRows = (await listCandidates(promptSetId)).filter((candidate) => candidate.lifecycleState === "USER_APPROVED");
  const frozenHash = computeFrozenHash(approvedRows);
  await updatePromptSet(promptSetId, { status: "approved", approvedAt: new Date(), approvedBy, frozenHash });
  appendEvent(promptSet.projectId, "prompt_set.approved", { promptSetId, approvedBy, frozenHash, count: approvedRows.length });
  return (await getPromptSet(promptSetId))!;
}

/** A review action that cannot be carried out as asked; its message is shown to the reviewer. */
export class PromptReviewError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "PromptReviewError";
  }
}

/**
 * Provider-written and reviewer-written prompts do not share template coverage slots: each carries
 * its own key, so "the same slot" is the section. Treating that key as a slot
 * made Replace reject the prompt and then find no alternative (leaving nine),
 * and made Select add an eleventh prompt to a full section.
 */
function isIntentCandidate(row: { coverageCellKey: string | null; contextBasis?: unknown }): boolean {
  const key = row.coverageCellKey ?? "";
  const basis = (row.contextBasis as string[] | null) ?? [];
  return key.startsWith("intent:") || key.startsWith("user:") || basis.includes("source:intent_model") || basis.includes("source:user");
}

function sectionOfRow(row: { section: string | null; cohort: string }): PromptSection {
  return (row.section as PromptSection | null) ?? sectionForCohort(row.cohort);
}

function categoryOf(row: { contextBasis?: unknown }): string | null {
  return ((row.contextBasis as string[] | null) ?? []).find((key) => key.startsWith("category:")) ?? null;
}

type CandidateRow = Awaited<ReturnType<typeof listCandidates>>[number];

export async function updatePromptSelection(
  promptSetId: string,
  candidateId: string,
  action: "select" | "deselect" | "reject" | "replace",
): Promise<void> {
  const promptSet = await getPromptSet(promptSetId);
  if (!promptSet || promptSet.status === "approved") throw new PromptReviewError("This prompt set is approved and frozen, so it can no longer change.");
  const candidates = await listCandidates(promptSetId);
  const candidate = candidates.find((row) => row.id === candidateId);
  if (!candidate) throw new PromptReviewError("That prompt is no longer in this set. Refresh the page.");
  if (action === "deselect") {
    await updateCandidate(candidateId, { lifecycleState: "SHORTLISTED", selectionReason: "Deselected during review." });
    return;
  }
  if (action === "reject") {
    await updateCandidate(candidateId, { lifecycleState: "REJECTED", rejectedReason: "Rejected during review." });
    return;
  }

  const section = sectionOfRow(candidate);
  const intent = isIntentCandidate(candidate);
  const isSelected = (row: CandidateRow) => ["SELECTED", "USER_APPROVED"].includes(row.lifecycleState);

  if (action === "select") {
    // A template alternative swaps with the prompt holding its own slot, when
    // one does. Either way a section never goes past its count: a template
    // alternative in a section of provider-written prompts has no slot-mate to
    // swap with, and selecting it made Discovery 11 of 10.
    const slotMate = intent
      ? undefined
      : candidates.find((row) => row.id !== candidateId && row.coverageCellKey === candidate.coverageCellKey && row.lifecycleState === "SELECTED");
    const selectedInSection = candidates.filter((row) => row.id !== candidateId && row.id !== slotMate?.id && isSelected(row) && sectionOfRow(row) === section).length;
    if (selectedInSection >= SECTION_SELECT_COUNT[section]) {
      throw new PromptReviewError(`${section} already has ${SECTION_SELECT_COUNT[section]} prompts. Deselect or replace one first.`);
    }
    if (slotMate) await updateCandidate(slotMate.id, { lifecycleState: "SHORTLISTED" });
    await updateCandidate(candidateId, { lifecycleState: "SELECTED", selectionReason: "Selected by the reviewer." });
    return;
  }

  // Replace. The alternative is chosen before anything is removed, so a replace
  // with nothing to replace it with leaves the section untouched.
  const affinity = (row: CandidateRow) =>
    (candidate.competitorEntityId && row.competitorEntityId === candidate.competitorEntityId ? 3 : 0) +
    (candidate.sentimentTheme && row.sentimentTheme === candidate.sentimentTheme ? 2 : 0) +
    (categoryOf(candidate) && categoryOf(row) === categoryOf(candidate) ? 2 : 0) +
    (candidate.topicId && row.topicId === candidate.topicId ? 1 : 0);
  const selectedTexts = new Set(candidates.filter(isSelected).map((row) => (row.editedText ?? row.text).trim().toLowerCase()));
  const replacement = candidates
    .filter((row) => row.id !== candidateId && row.lifecycleState === "SHORTLISTED")
    .filter((row) => (intent ? sectionOfRow(row) === section : row.coverageCellKey === candidate.coverageCellKey))
    .filter((row) => !selectedTexts.has((row.editedText ?? row.text).trim().toLowerCase()))
    .sort((a, b) => affinity(b) - affinity(a) || (b.selectionScore ?? b.qualityScore ?? 0) - (a.selectionScore ?? a.qualityScore ?? 0) || a.id.localeCompare(b.id))[0];
  if (!replacement) throw new PromptReviewError("There is no validated alternative for this prompt yet. Use Regenerate to write new ones.");
  await updateCandidate(candidateId, { lifecycleState: "REJECTED", rejectedReason: "Replaced during review." });
  await updateCandidate(replacement.id, { lifecycleState: "SELECTED", selectionReason: "Selected as the reviewer-requested replacement." });
}

export async function regeneratePromptCandidate(promptSetId: string, candidateId: string): Promise<void> {
  const promptSet = await getPromptSet(promptSetId);
  if (!promptSet || promptSet.status === "approved") throw new PromptReviewError("This prompt set is approved and frozen, so it can no longer change.");
  if ((await listCandidates(promptSetId)).find((row) => row.id === candidateId)?.generationSource === "user") {
    throw new PromptReviewError("Your own prompts stay in your words. Use Edit to change the wording.");
  }
  const snapshot = promptSet.promptContextSnapshotId ? await getPromptContextSnapshot(promptSet.promptContextSnapshotId) : undefined;
  if (!snapshot) throw new Error("Prompt context snapshot is missing.");
  const context = snapshot.context as unknown as PromptContextSnapshotData;
  const profileVersion = await getProfileVersion(promptSet.businessProfileVersionId);
  if (!profileVersion) throw new Error("Business profile version is missing.");
  const profile = profileVersion.profile as unknown as BusinessProfile;
  const candidates = await listCandidates(promptSetId);
  const candidate = candidates.find((row) => row.id === candidateId);
  if (!candidate) throw new PromptReviewError("That prompt is no longer in this set. Refresh the page.");
  const topics = snapshotTopics(promptSet.projectId, promptSet.businessProfileVersionId, context.confirmedTopics);
  const competitors = snapshotEntities(promptSet.projectId, context.confirmedCompetitors);
  const locations = snapshotLocations(promptSet.projectId, context, []);
  const generationContext: GenerationContext = { profile, topics, competitors, locations, language: context.geography.language };
  // Regenerate from the SAME semantic frame, so the replacement measures the
  // same thing the user asked to rephrase rather than drifting to a new topic.
  // A provider-written prompt has no template frame; it is reworded with its
  // brand, rival and single detail held fixed.
  const intent = isIntentCandidate(candidate);
  const rival = candidate.competitorEntityId ? context.confirmedCompetitors.find((item) => item.entityId === candidate.competitorEntityId) : undefined;
  const sourceDrafts = intent
    ? await rephrasePrompt(draftFromRow(candidate), { brand: profile.identity.brandName.value, rivalName: rival ? spokenName(rival.canonicalName, [rival.canonicalDomain]) : null })
    : await regenerateFrame(candidate.coverageCellKey, generationContext);
  if (sourceDrafts.length === 0) {
    throw new PromptReviewError(
      intent
        ? "New wordings could not be written right now: the writing model is unavailable or out of quota. Replace picks from the validated alternatives instead."
        : "This prompt's template produced no new wording.",
    );
  }
  const drafts = sourceDrafts.filter((draft) => validateNaturalQuery({ text: draft.text, section: draft.section, register: draft.register }).ok);
  const validationCtx = validationContext(profile, context, locations);
  const rows = drafts.map((draft, index) => rowForDraft(promptSetId, draft, Date.now() % 1_000_000 + index));
  await insertCandidates(rows);
  for (let index = 0; index < rows.length; index++) {
    const validation = validateCandidate(drafts[index]!, validationCtx);
    if (!validation.pass) {
      await updateCandidate(rows[index]!.id, { lifecycleState: "REJECTED", rejectedReason: `${validation.code}: ${validation.reason}`, validationResult: validation as unknown as Record<string, unknown> });
      continue;
    }
    const sameCell = candidates.filter((row) => row.coverageCellKey === candidate.coverageCellKey);
    const exactDuplicate = sameCell.find((row) => (row.editedText ?? row.text).trim().toLowerCase() === drafts[index]!.text.trim().toLowerCase());
    // A rewording is meant to resemble the prompt it rewords. Counting that
    // prompt rejected every new wording of a short Discovery search ("good
    // places for a women's haircut in Dubai" for "best women's haircut in
    // Dubai"); other wordings already in the slot still count.
    const nearestInCell = Math.max(0, ...sameCell.filter((row) => row.id !== candidate.id).map((row) => textSimilarity(row.editedText ?? row.text, drafts[index]!.text)));
    if (exactDuplicate || nearestInCell >= 0.72) {
      await updateCandidate(rows[index]!.id, {
        lifecycleState: "REJECTED",
        rejectedReason: `exact_or_semantic_duplicate: best represented by ${exactDuplicate?.id ?? "an existing frame candidate"}`,
        duplicateOfId: exactDuplicate?.id ?? null,
      });
      continue;
    }
    const maxSimilarity = Math.max(0, ...candidates.filter((row) => (row.section ?? sectionForCohort(row.cohort)) === drafts[index]!.section).map((row) => textSimilarity(row.editedText ?? row.text, drafts[index]!.text)));
    const breakdown = scoreCandidate(drafts[index]!, maxSimilarity);
    await updateCandidate(rows[index]!.id, {
      lifecycleState: "SHORTLISTED",
      validationResult: validation as unknown as Record<string, unknown>,
      qualityScore: breakdown.total,
      qualityBreakdown: breakdown as unknown as Record<string, number>,
      selectionReason: "Regenerated from the same semantic frame; available as a reviewed alternative.",
    });
  }
  const added = (await listCandidates(promptSetId)).filter((row) => rows.some((inserted) => inserted.id === row.id) && row.lifecycleState === "SHORTLISTED").length;
  appendEvent(promptSet.projectId, "prompt.shortlist.updated", { promptSetId, candidateId, regenerated: added });
  if (added === 0) throw new PromptReviewError("None of the new wordings passed the prompt checks. Try Regenerate again, or Replace.");
}

// ---------------------------------------------------------------------------
// Prompts the reviewer writes
// ---------------------------------------------------------------------------

const FROZEN_MESSAGE = "This prompt set is approved and frozen, so it can no longer change.";

/** The same shape provider-written prompts carry in each section. */
const USER_PROMPT_SHAPE: Record<PromptSection, Pick<CandidatePromptDraft, "cohort" | "intent" | "journeyStage" | "brandPolicy">> = {
  Discovery: { cohort: "neutral_discovery", intent: "recommend", journeyStage: "awareness", brandPolicy: "TARGET_FORBIDDEN" },
  "Trade Offs": { cohort: "target_comparison", intent: "compare", journeyStage: "consideration", brandPolicy: "TARGET_REQUIRED" },
  "Sentiment Analysis": { cohort: "branded_accuracy", intent: "verify", journeyStage: "decision", brandPolicy: "TARGET_REQUIRED" },
};

export interface CustomPromptInput {
  text: string;
  section: PromptSection;
  /** A selected prompt in the same section that this one takes the place of. Required once the section is full. */
  replacesCandidateId?: string | null;
}

function normalizeUserText(text: string): string {
  return text.replace(/\s+/g, " ").trim();
}

/** Confirmed competitors the text names, in the frozen set's order. */
function namedRivals(text: string, context: PromptContextSnapshotData): FrozenCompetitorSnapshot[] {
  return context.confirmedCompetitors.filter((competitor) => scanForBrandLeakage(text, buildCompetitorForbiddenTerms([competitor])).leaked);
}

/** The business's reputation theme a prompt is about, when its words say which. */
function reputationThemeFor(text: string, profile: BusinessProfile): string {
  const words = new Set(text.toLowerCase().match(/[a-z]+/g) ?? []);
  const theme = sentimentThemesFor(profile.archetype.value).find((candidate) => candidate.split(/\s+/).some((word) => word.length > 3 && words.has(word)));
  return theme ?? "overall reputation";
}

function userPromptDraft(
  text: string,
  section: PromptSection,
  key: string,
  context: PromptContextSnapshotData,
  profile: BusinessProfile,
  rival: FrozenCompetitorSnapshot | undefined,
): CandidatePromptDraft {
  const register = inferRegister(text);
  return {
    text,
    section,
    ...USER_PROMPT_SHAPE[section],
    topicId: null,
    persona: null,
    useCaseConstraint: null,
    // A Trade Off is bound to the rival the reviewer named (the first, when several are).
    competitorEntityId: section === "Trade Offs" ? (rival?.entityId ?? null) : null,
    evaluationCriterion: section === "Trade Offs" && rival ? "as worded in the prompt" : null,
    sentimentTheme: section === "Sentiment Analysis" ? reputationThemeFor(text, profile) : null,
    geographyScope: "none",
    geographyText: null,
    locationId: null,
    language: context.geography.language,
    coverageCellKey: key,
    evidenceBasis: [],
    contextBasis: ["source:user", `register:${register}`],
    generationMethod: "user",
    authoredBy: "user",
    register,
  };
}

function explainUserPromptRejection(
  result: ReturnType<typeof validateCandidate>,
  section: PromptSection,
  brand: string,
  context: PromptContextSnapshotData,
  namesRival: boolean,
): string {
  const rivals = context.confirmedCompetitors.map((competitor) => spokenName(competitor.canonicalName, [competitor.canonicalDomain])).join(", ");
  switch (result.code) {
    case "brand_leakage":
      return `Discovery prompts can't mention ${brand}: they check whether assistants recommend ${brand} without being asked. Remove the name, or add it under ${namesRival ? "Trade Offs" : "Sentiment Analysis"}.`;
    case "competitor_leakage":
      return `Discovery prompts can't name a competitor, because that steers the answer. Remove the name, or add it under Trade Offs and mention ${brand} too.`;
    case "missing_required_competitor":
    case "invalid_competitor":
      return `Trade Offs prompts compare ${brand} with a confirmed competitor. Name one of: ${rivals}.`;
    case "missing_required_brand":
      return section === "Trade Offs"
        ? `Trade Offs prompts compare ${brand} with a competitor, so mention ${brand} as well.`
        : `Sentiment Analysis prompts ask about ${brand}, so mention ${brand}. To see whether ${brand} comes up on its own, add it under Discovery instead.`;
    case "geography_uncontrolled_near_me":
      return `"Near me" depends on where the assistant thinks you are, so answers can't be compared. Name the city or area instead.`;
    case "multi_intent":
      return "Ask one thing per prompt. Split this into separate prompts.";
    case "unstable_temporal_reference":
      return `Words like "today" or "this week" change meaning between runs. Leave the time reference out.`;
    case "leading_non_neutral":
      return "This wording pushes the assistant toward an answer. Ask it neutrally.";
    case "schema_not_a_query":
      return `Write it the way someone would ask an assistant: a question, or a search such as "best … for …".`;
    case "schema_length":
      return "Prompts need to be between 8 and 300 characters.";
    default:
      return result.reason ?? "This prompt did not pass the prompt checks.";
  }
}

/**
 * The measurement rules a reviewer's prompt must meet, the same ones generated
 * prompts meet: Discovery never names the brand or a competitor, Trade Offs
 * names the brand and a confirmed competitor, Sentiment Analysis names the
 * brand and no competitor. Wording style is not policed: it is how they ask.
 */
function checkedUserDraft(
  text: string,
  section: PromptSection,
  key: string,
  loaded: Awaited<ReturnType<typeof loadApprovalContext>>,
  candidates: CandidateRow[],
  editingId: string | null,
): CandidatePromptDraft {
  const { context, profile, validationCtx } = loaded;
  const brand = profile.identity.brandName.value;
  const rivals = namedRivals(text, context);
  if (section === "Sentiment Analysis" && rivals.length > 0) {
    throw new PromptReviewError(`This compares ${brand} with ${spokenName(rivals[0]!.canonicalName, [rivals[0]!.canonicalDomain])}. Add it under Trade Offs instead.`);
  }
  const draft = userPromptDraft(text, section, key, context, profile, rivals[0]);
  const result = validateCandidate(draft, validationCtx);
  if (!result.pass) throw new PromptReviewError(explainUserPromptRejection(result, section, brand, context, rivals.length > 0));
  const duplicate = candidates.find(
    (row) =>
      row.id !== editingId &&
      ["SELECTED", "USER_APPROVED", "SHORTLISTED"].includes(row.lifecycleState) &&
      (row.editedText ?? row.text).trim().toLowerCase() === text.toLowerCase(),
  );
  if (duplicate) {
    throw new PromptReviewError(
      duplicate.lifecycleState === "SHORTLISTED" ? `That prompt is already an alternative in ${sectionOfRow(duplicate)}. Select it there instead.` : "That prompt is already in the set.",
    );
  }
  return draft;
}

/**
 * Adds a prompt the reviewer wrote. It takes a slot in its section, so every
 * section stays at its count and the measurement stays balanced; the prompt it
 * replaces moves to the alternatives. Approval then freezes it with the rest,
 * and collection asks it like any other.
 */
export async function addCustomPrompt(promptSetId: string, input: CustomPromptInput): Promise<{ candidateId: string; replacedId: string | null }> {
  const promptSet = await getPromptSet(promptSetId);
  if (!promptSet) throw new PromptReviewError("This prompt set no longer exists. Refresh the page.");
  if (promptSet.status === "approved") throw new PromptReviewError(FROZEN_MESSAGE);
  if (promptSet.status === "generating") throw new PromptReviewError("Prompts are still being generated. Add your own once that finishes.");
  const section = input.section;
  const text = normalizeUserText(input.text);
  const candidates = await listCandidates(promptSetId);
  const key = `user:${section.toLowerCase().replace(/\s+/g, "-")}:${newId("up")}`;
  const draft = checkedUserDraft(text, section, key, await loadApprovalContext(promptSet), candidates, null);

  const inSection = candidates.filter((row) => ["SELECTED", "USER_APPROVED"].includes(row.lifecycleState) && sectionOfRow(row) === section);
  const replaced = input.replacesCandidateId ? inSection.find((row) => row.id === input.replacesCandidateId) : undefined;
  if (input.replacesCandidateId && !replaced) throw new PromptReviewError(`Choose a prompt from ${section} for yours to replace.`);
  if (!replaced && inSection.length >= SECTION_SELECT_COUNT[section]) {
    throw new PromptReviewError(`${section} already has ${SECTION_SELECT_COUNT[section]} prompts. Choose which one yours replaces.`);
  }

  const row = rowForDraft(promptSetId, draft, Math.max(0, ...candidates.map((candidate) => candidate.sequence)) + 1);
  await insertCandidates([row]);
  if (replaced) {
    await updateCandidate(replaced.id, { lifecycleState: "SHORTLISTED", selectionReason: "Replaced by a prompt you added; still available as an alternative." });
  }
  await updateCandidate(row.id, {
    lifecycleState: "SELECTED",
    validationResult: { pass: true, authoredBy: "user" },
    selectionReason: replaced ? `Added by you, in place of “${replaced.editedText ?? replaced.text}”.` : "Added by you.",
  });
  appendEvent(promptSet.projectId, "prompt.custom.added", { promptSetId, candidateId: row.id, section, replacedId: replaced?.id ?? null });
  return { candidateId: row.id, replacedId: replaced?.id ?? null };
}

/** Rewords a prompt the reviewer wrote; the rules are rechecked and the competitor it names is rebound. */
export async function editCustomPrompt(promptSetId: string, candidateId: string, text: string): Promise<void> {
  const promptSet = await getPromptSet(promptSetId);
  if (!promptSet || promptSet.status === "approved") throw new PromptReviewError(FROZEN_MESSAGE);
  const candidates = await listCandidates(promptSetId);
  const candidate = candidates.find((row) => row.id === candidateId);
  if (!candidate || candidate.generationSource !== "user") throw new PromptReviewError("That prompt is no longer in this set. Refresh the page.");
  const normalized = normalizeUserText(text);
  const draft = checkedUserDraft(normalized, sectionOfRow(candidate), candidate.coverageCellKey, await loadApprovalContext(promptSet), candidates, candidateId);
  await updateCandidate(candidateId, {
    editedText: normalized,
    competitorEntityId: draft.competitorEntityId,
    evaluationCriterion: draft.evaluationCriterion,
    sentimentTheme: draft.sentimentTheme,
    contextBasis: draft.contextBasis,
  });
  appendEvent(promptSet.projectId, "prompt.candidate.validated", { promptSetId, candidateId, edited: true });
}
