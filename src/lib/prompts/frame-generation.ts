// Frame → candidate drafts.
//
// Bridges the semantic layer (concepts, frames, realizers) to the persistence
// layer (CandidatePromptDraft rows) the rest of the pipeline already speaks.
// The deterministic floor always runs; provider realization is additive, and
// every draft from either path goes through the same validators afterwards.

import type { BusinessProfile } from "@/lib/profile/schema";
import type { Topic, Entity } from "@/lib/landscape/repository";
import type { Location } from "@/lib/geography/repository";
import type { CandidatePromptDraft, Cohort, Intent, JourneyStage, GeographyScope, PromptSection } from "./types";
import type { BuyerIntent, RealUserQueryFrame } from "./query-frames";
import { frameCoverageKeys } from "./query-frames";
import { batchFrames, realizeFrameDeterministic, realizeWithProvider, type RealizedPrompt } from "./realizer";
import { planFrames, type FramePlan, type PlannerCompetitor, type PlannerTopic } from "./frame-planner";
import { buildMeasurementConcepts, inferConceptKind, type MeasurementConcept } from "./semantic-concepts";
import { promptModelAvailable } from "./model-call";
import { sentimentThemesFor, tradeOffCriteriaFor } from "./coverage-policy";
import { generateIntentDrafts } from "./intent-generation";
import type { PromptIntentModel } from "./intent-model";
import { hasTieredRivals, orderRivalsByTierMix } from "@/lib/landscape/competitor-tier-order";

const INTENT_FOR_BUYER_INTENT: Record<BuyerIntent, Intent> = {
  DISCOVER_CATEGORY: "discover",
  GET_RECOMMENDATION: "recommend",
  SHORTLIST: "recommend",
  SOLVE_PROBLEM: "solve_problem",
  EVALUATE_OPTIONS: "evaluate",
  COMPARE_BRANDS: "compare",
  CHECK_TRUST: "verify",
  CHECK_REPUTATION: "verify",
  CHECK_EXPERIENCE: "verify",
  PURCHASE_DECISION: "purchase",
};

const JOURNEY_FOR_SECTION: Record<PromptSection, JourneyStage> = {
  Discovery: "awareness",
  "Trade Offs": "consideration",
  "Sentiment Analysis": "decision",
};

const COHORT_FOR_SECTION: Record<PromptSection, Cohort> = {
  Discovery: "neutral_discovery",
  "Trade Offs": "target_comparison",
  "Sentiment Analysis": "branded_accuracy",
};

export interface FrameGenerationContext {
  /** Needed to read the site vocabulary that grounds the intent model. */
  projectId?: string;
  profile: BusinessProfile;
  topics: Topic[];
  competitors: Entity[];
  locations: Location[];
  language: string;
}

/**
 * Derives the typed concept set from the confirmed profile. Proprietary terms
 * come from the brand's own aliases and identifying product terms, so a
 * sub-brand is recognised as a PRODUCT_LINE rather than a shoppable category.
 */
/** Enough distinct criteria to express a purchase decision rather than one axis. */
const MIN_TRADEOFF_CRITERIA = 4;

function topUpCriteria(fromSite: string[], fromArchetype: string[]): string[] {
  const out = [...fromSite];
  const seen = new Set(out.map((value) => value.trim().toLowerCase()));
  for (const criterion of fromArchetype) {
    if (out.length >= MIN_TRADEOFF_CRITERIA) break;
    const key = criterion.trim().toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(criterion);
  }
  return out;
}

export function conceptsForContext(ctx: FrameGenerationContext): MeasurementConcept[] {
  const profile = ctx.profile;
  const brandName = profile.identity.brandName.value;
  const proprietaryTerms = [brandName, ...profile.identity.aliases.values].filter(Boolean);

  return buildMeasurementConcepts({
    offerings: profile.offerings.items.map((item) => ({
      name: item.name,
      type: item.type,
      evidenceIds: item.evidenceIds,
      confidence: item.confidence,
    })),
    audiences: profile.targetAudience.map((item) => item.value),
    // The site's own criteria lead; the archetype list only TOPS UP a thin
    // one.
    //
    // Appending the archetype list wholesale was wrong — it asked a coffee
    // roaster's buyers which espresso blends are "known for comfort". But
    // replacing it only when the site yielded nothing was also wrong: a site
    // that publishes exactly one constraint ("free shipping") drove every
    // Trade Off frame through that single criterion, so six of ten comparison
    // prompts read "Compare Nike and X on free shipping for Y". One criterion
    // cannot express a purchase decision. Site criteria keep priority order,
    // and the archetype supplies only what is missing up to a workable floor.
    criteria: topUpCriteria(profile.decisionConstraints.values, tradeOffCriteriaFor(profile.archetype.value)),
    jobs: profile.customerJobs.values,
    markets: ctx.locations.map((location) => location.name),
    // Only the specific industry CATEGORY ("Apparel & Sporting Goods") can act
    // as a shoppable noun. The bare sector ("Retail", "Software") is not
    // something anyone shops for, and letting it through produced
    // "How do Nike and Adidas compare for retail?".
    industryCategory: profile.industry.secondary ?? null,
    industrySector: profile.industry.primary ?? null,
    proprietaryTerms,
  });
}

function plannerTopics(ctx: FrameGenerationContext, concepts: MeasurementConcept[]): PlannerTopic[] {
  const brandTerms = [ctx.profile.identity.brandName.value, ...ctx.profile.identity.aliases.values];
  return ctx.topics.map((topic) => {
    const kind = inferConceptKind({ label: topic.name, proprietaryTerms: brandTerms });
    // Match the topic to an already-typed concept when possible so the frame
    // planner inherits the neutral label rather than re-deriving it.
    const match = concepts.find((concept) => concept.canonicalLabel.toLowerCase() === topic.name.toLowerCase());
    return {
      id: topic.id,
      name: topic.name,
      discoveryConcept: match?.neutralLabel ?? topic.name,
      conceptId: match?.id ?? null,
      kind,
    } satisfies PlannerTopic & { kind: unknown };
  });
}

function plannerCompetitors(ctx: FrameGenerationContext): PlannerCompetitor[] {
  const eligible = ctx.competitors
    .filter((entity) => entity.kind === "competitor" && entity.status === "confirmed")
    // Trade Offs are about the choice a buyer actually faces, so a directory
    // or aggregator is a weaker comparison than a direct rival.
    .filter((entity) => entity.competitorType !== "marketplace");
  if (!hasTieredRivals(eligible)) {
    return eligible.map((entity) => ({
      entityId: entity.id,
      name: entity.canonicalName,
      relationship: entity.competitorType ?? "direct",
      relevance: (entity.confidence ?? 50) + (entity.competitorType === "direct" ? 20 : 0),
    }));
  }
  // Tiered sets: the planner keeps the most relevant five, so relevance follows
  // the tier-mixed order and the cap keeps rivals from every level.
  const ordered = orderRivalsByTierMix(eligible);
  return ordered.map((entity, index) => ({
    entityId: entity.id,
    name: entity.canonicalName,
    relationship: entity.competitorType ?? "direct",
    relevance: ordered.length - index,
  }));
}

export function planFramesForContext(ctx: FrameGenerationContext): FramePlan & { concepts: MeasurementConcept[] } {
  const concepts = conceptsForContext(ctx);
  const plan = planFrames({
    archetype: ctx.profile.archetype.value,
    concepts,
    topics: plannerTopics(ctx, concepts),
    competitors: plannerCompetitors(ctx),
    targetBrand: ctx.profile.identity.brandName.value,
    sentimentThemes: sentimentThemesFor(ctx.profile.archetype.value),
  });
  return { ...plan, concepts };
}

function geographyForFrame(frame: RealUserQueryFrame, locations: Location[]): { scope: GeographyScope; text: string | null; locationId: string | null } {
  if (!frame.locationConcept) return { scope: "none", text: null, locationId: null };
  const match = locations.find((location) => location.name.toLowerCase() === frame.locationConcept!.canonicalLabel.toLowerCase());
  if (!match) return { scope: "none", text: null, locationId: null };
  const scope = (["country", "region", "city", "branch", "district", "neighborhood"].includes(match.level) ? match.level : "country") as GeographyScope;
  return { scope, text: match.name, locationId: match.id };
}

export function draftFromRealized(
  realized: RealizedPrompt,
  frame: RealUserQueryFrame,
  ctx: FrameGenerationContext,
): CandidatePromptDraft {
  const geography = geographyForFrame(frame, ctx.locations);
  const topic = frame.topicId ? ctx.topics.find((item) => item.id === frame.topicId) : undefined;
  const evidenceBasis = [
    ...((topic?.evidenceIds as string[] | undefined) ?? []),
    // The concepts' own evidence. The old lookup `find((o) => o.name)` ignored
    // the concept and cited the first offering's evidence on every frame.
    ...[frame.categoryConcept, frame.activityConcept, frame.criterionConcept, frame.audienceConcept]
      .filter((concept): concept is NonNullable<typeof concept> => Boolean(concept && frame.sourceConceptIds.includes(concept.id)))
      .flatMap((concept) => concept.sourceEvidenceIds)
      .slice(0, 2),
  ].slice(0, 6);

  return {
    text: realized.text.trim(),
    cohort: COHORT_FOR_SECTION[frame.section],
    section: frame.section,
    intent: INTENT_FOR_BUYER_INTENT[frame.buyerIntent],
    journeyStage: JOURNEY_FOR_SECTION[frame.section],
    topicId: frame.topicId,
    persona: frame.audienceConcept?.canonicalLabel ?? null,
    useCaseConstraint: frame.activityConcept?.canonicalLabel ?? null,
    evaluationCriterion: frame.criterionConcept?.canonicalLabel ?? null,
    competitorEntityId: frame.competitorEntityId,
    sentimentTheme: frame.sentimentTheme,
    geographyScope: geography.scope,
    geographyText: geography.text,
    locationId: geography.locationId,
    language: ctx.language,
    brandPolicy: frame.section === "Discovery" ? "TARGET_FORBIDDEN" : "TARGET_REQUIRED",
    // One frame is one coverage slot: the frame id IS the cell key, which
    // keeps the existing per-cell persistence and retry machinery working.
    coverageCellKey: frame.id,
    evidenceBasis,
    contextBasis: frameCoverageKeys(frame),
    generationMethod: realized.method,
    frameId: frame.id,
    authoredBy: "system",
    register: frame.register,
  };
}

export interface FrameGenerationResult {
  drafts: CandidatePromptDraft[];
  frames: RealUserQueryFrame[];
  warnings: string[];
  stats: { framesPlanned: number; framesDiscarded: number; deterministic: number; provider: number; providerBatches: number; intentRetries: number; intentFailedSections: number };
  /** The customer intent model the provider drafts were built from, when one was. */
  intentModel: PromptIntentModel | null;
}

/**
 * Realizes every planned frame. The deterministic renderers run first so
 * there is always a floor; when a provider is configured its batches add
 * more natural variants for the same frames.
 */
export interface FrameGenerationOptions {
  /** A retry: only these sections are written by the model (templates are still realized for all). */
  sections?: PromptSection[];
  /** The intent model from the first pass, so a retry does not plan again. */
  intentModel?: PromptIntentModel | null;
}

export async function generateFromFrames(ctx: FrameGenerationContext, options: FrameGenerationOptions = {}): Promise<FrameGenerationResult> {
  const plan = planFramesForContext(ctx);
  const drafts: CandidatePromptDraft[] = [];
  let deterministic = 0;
  let provider = 0;
  let providerBatches = 0;
  let intentRetries = 0;
  let intentFailedSections = 0;

  for (const frame of plan.frames) {
    // Without a provider this is the only source of variety, so take every
    // renderer a frame can legally satisfy rather than the first two.
    for (const realized of realizeFrameDeterministic(frame, 4)) {
      drafts.push(draftFromRealized(realized, frame, ctx));
      deterministic += 1;
    }
  }

  let intentModel: PromptIntentModel | null = options.intentModel ?? null;
  let intentDrafts: CandidatePromptDraft[] = [];
  if (promptModelAvailable() && ctx.projectId) {
    // Intent first. Realizing the planner's frames through a model only
    // rephrases what the frames already say — a department-level category and a
    // delivery constraint — so it inherits their genericness. The intent model
    // supplies the needs and situations those frames never had.
    try {
      const intent = await generateIntentDrafts(
        {
          projectId: ctx.projectId,
          profile: ctx.profile,
          topics: ctx.topics,
          competitors: ctx.competitors,
          locations: ctx.locations,
          language: ctx.language,
        },
        { sections: options.sections, intentModel: options.intentModel },
      );
      intentModel = intent.model;
      intentDrafts = intent.drafts;
      providerBatches += intent.calls;
      intentRetries += intent.retries ?? 0;
      intentFailedSections += intent.failedSections?.length ?? 0;
    } catch {
      // A failed intent run costs quality, never the prompt set.
    }
  }
  for (const draft of intentDrafts) {
    drafts.push(draft);
    provider += 1;
  }

  if (promptModelAvailable() && intentDrafts.length === 0) {
    const batches = batchFrames(plan.frames);
    const byId = new Map(plan.frames.map((frame) => [frame.id, frame]));
    const results = await Promise.all(
      batches.map(async (batch) => {
        try {
          return await realizeWithProvider(batch);
        } catch {
          // A failed batch costs variety, never the run.
          return [] as RealizedPrompt[];
        }
      }),
    );
    providerBatches += batches.length;
    for (const realizedBatch of results) {
      for (const realized of realizedBatch) {
        const frame = byId.get(realized.frameId);
        if (!frame) continue;
        drafts.push(draftFromRealized(realized, frame, ctx));
        provider += 1;
      }
    }
  }

  return {
    drafts,
    frames: plan.frames,
    warnings: plan.warnings,
    stats: {
      framesPlanned: plan.frames.length,
      framesDiscarded: plan.discarded.length,
      deterministic,
      provider,
      providerBatches,
      intentRetries,
      intentFailedSections,
    },
    intentModel,
  };
}

/** Re-realizes one frame, for the per-prompt regenerate action. */
export async function regenerateFrame(frameId: string, ctx: FrameGenerationContext): Promise<CandidatePromptDraft[]> {
  const plan = planFramesForContext(ctx);
  const frame = plan.frames.find((item) => item.id === frameId);
  if (!frame) return [];

  const drafts = realizeFrameDeterministic(frame, 3).map((realized) => draftFromRealized(realized, frame, ctx));
  if (promptModelAvailable()) {
    try {
      for (const realized of await realizeWithProvider([frame])) {
        drafts.push(draftFromRealized(realized, frame, ctx));
      }
    } catch {
      // deterministic drafts still stand
    }
  }
  return drafts;
}
