// Coverage planning over typed frames.
//
// The planner decides *what* to measure; the realizer decides how to say it.
// Keeping those apart is what stops a fluent model from quietly choosing the
// measurement plan, and what lets the plan be checked before any wording
// exists.
//
// Every frame it emits has already passed `validateFrame`, so a frame that
// reaches realization is structurally sound by construction.

import type { BusinessArchetype } from "@/lib/profile/schema";
import type { PromptSection } from "./types";
import { SECTION_CANDIDATE_TARGET } from "./types";
import {
  categoryConcepts,
  conceptsOfKind,
  type MeasurementConcept,
} from "./semantic-concepts";
import { validateFrame, frameSignature, type BuyerIntent, type FrameDepth, type PromptRegister, type RealUserQueryFrame } from "./query-frames";

export interface PlannerCompetitor {
  entityId: string;
  name: string;
  relationship: string;
  relevance: number;
}

export interface PlannerTopic {
  id: string;
  name: string;
  /** Brand-neutral form, used when the topic itself is proprietary. */
  discoveryConcept: string;
  conceptId: string | null;
}

export interface FramePlanInput {
  archetype: BusinessArchetype;
  concepts: MeasurementConcept[];
  topics: PlannerTopic[];
  competitors: PlannerCompetitor[];
  targetBrand: string;
  sentimentThemes: string[];
  /** Locations already typed as LOCATION concepts. */
  maxPerSection?: Partial<Record<PromptSection, number>>;
}

/** Discovery intents, weighted per archetype. Weights need not sum to one. */
const DISCOVERY_INTENT_WEIGHTS: Record<BusinessArchetype, Partial<Record<BuyerIntent, number>>> = {
  b2b_saas_enterprise: { DISCOVER_CATEGORY: 2, GET_RECOMMENDATION: 3, SHORTLIST: 3, SOLVE_PROBLEM: 3, EVALUATE_OPTIONS: 3 },
  ecommerce_dtc_retail: { DISCOVER_CATEGORY: 3, GET_RECOMMENDATION: 3, SHORTLIST: 2, PURCHASE_DECISION: 3, EVALUATE_OPTIONS: 2 },
  local_service: { GET_RECOMMENDATION: 3, SHORTLIST: 3, SOLVE_PROBLEM: 2, DISCOVER_CATEGORY: 2 },
  dealership: { GET_RECOMMENDATION: 3, SHORTLIST: 3, PURCHASE_DECISION: 3, DISCOVER_CATEGORY: 2 },
  restaurant_food_chain: { DISCOVER_CATEGORY: 3, GET_RECOMMENDATION: 3, PURCHASE_DECISION: 2 },
  multi_location_chain: { DISCOVER_CATEGORY: 2, GET_RECOMMENDATION: 3, SHORTLIST: 2, PURCHASE_DECISION: 2 },
  healthcare: { DISCOVER_CATEGORY: 3, GET_RECOMMENDATION: 2, EVALUATE_OPTIONS: 3, SHORTLIST: 2 },
  finance: { DISCOVER_CATEGORY: 3, EVALUATE_OPTIONS: 3, GET_RECOMMENDATION: 2, SHORTLIST: 2 },
  marketplace: { DISCOVER_CATEGORY: 3, GET_RECOMMENDATION: 2, PURCHASE_DECISION: 2, SHORTLIST: 2 },
  travel_hospitality: { DISCOVER_CATEGORY: 3, GET_RECOMMENDATION: 3, PURCHASE_DECISION: 2 },
  education: { DISCOVER_CATEGORY: 3, EVALUATE_OPTIONS: 3, GET_RECOMMENDATION: 2 },
  other: { DISCOVER_CATEGORY: 3, GET_RECOMMENDATION: 3, SHORTLIST: 2, EVALUATE_OPTIONS: 2 },
};

/** Depth mix: real users ask short questions more often than long ones. */
const DEPTH_MIX: Array<{ depth: FrameDepth; weight: number }> = [
  { depth: "short", weight: 3 },
  { depth: "medium", weight: 4 },
  { depth: "deep", weight: 2 },
];

/**
 * Register mix per section, weighted from the captured reference sets.
 *
 * Velova's live Discovery set is roughly one bare keyword phrase, five
 * imperatives and four interrogatives; Peec's guide shows the same spread plus
 * short "Tesla vs Rivian" comparisons and "Is Tesla worth it?" sentiment
 * checks. Discovery therefore leans imperative/keyword, while Sentiment stays
 * mostly interrogative because that is how people actually ask about trust.
 */
const REGISTER_MIX: Record<PromptSection, Array<{ register: PromptRegister; weight: number }>> = {
  Discovery: [
    { register: "keyword", weight: 3 },
    { register: "imperative", weight: 4 },
    { register: "question", weight: 4 },
  ],
  "Trade Offs": [
    { register: "keyword", weight: 3 },
    { register: "imperative", weight: 2 },
    { register: "question", weight: 5 },
  ],
  "Sentiment Analysis": [
    { register: "keyword", weight: 2 },
    { register: "question", weight: 6 },
  ],
};

function weightedCycle<T>(entries: Array<[T, number]>, count: number): T[] {
  const expanded: T[] = [];
  for (const [value, weight] of entries) {
    for (let i = 0; i < Math.max(1, Math.round(weight)); i++) expanded.push(value);
  }
  if (expanded.length === 0) return [];
  return Array.from({ length: count }, (_, index) => expanded[index % expanded.length]!);
}

function pick<T>(items: T[], index: number): T | null {
  return items.length === 0 ? null : items[index % items.length]!;
}

/** How many rivals Trade Offs are spread across. */
export const MAX_TRADE_OFF_RIVALS = 5;

/**
 * Competitor allocation across the ten Trade Off slots. One competitor takes
 * all ten (with a breadth warning); more competitors share them as evenly as
 * relevance allows, so no single rival dominates the comparison set.
 */
export function allocateCompetitorSlots(competitors: PlannerCompetitor[], slots: number): Array<{ competitor: PlannerCompetitor; count: number }> {
  if (competitors.length === 0) return [];
  const ranked = [...competitors].sort((a, b) => b.relevance - a.relevance);
  // The rivals a buyer actually weighs, not every confirmed name: ten
  // comparisons spread across sixteen competitors measured obscure brands and
  // under-measured the obvious ones.
  const usable = ranked.slice(0, Math.min(ranked.length, slots, MAX_TRADE_OFF_RIVALS));

  const base = Math.floor(slots / usable.length);
  const remainder = slots - base * usable.length;
  return usable.map((competitor, index) => ({
    competitor,
    // The remainder goes to the most relevant competitors first.
    count: base + (index < remainder ? 1 : 0),
  }));
}

export interface FramePlan {
  frames: RealUserQueryFrame[];
  warnings: string[];
  /** Frames the planner built but had to discard, with reasons. */
  discarded: Array<{ signature: string; reason: string }>;
}

export function planFrames(input: FramePlanInput): FramePlan {
  const frames: RealUserQueryFrame[] = [];
  const discarded: Array<{ signature: string; reason: string }> = [];
  const warnings: string[] = [];
  const seen = new Set<string>();
  let counter = 0;

  const categories = categoryConcepts(input.concepts);
  const activities = conceptsOfKind(input.concepts, ["ACTIVITY", "USE_CASE"]);
  const audiences = conceptsOfKind(input.concepts, ["AUDIENCE", "PERSONA"]);
  const criteria = conceptsOfKind(input.concepts, ["EVALUATION_CRITERION", "FEATURE", "PURCHASE_CONSTRAINT"]);
  const jobs = conceptsOfKind(input.concepts, ["JOB_TO_BE_DONE"]);
  const locations = conceptsOfKind(input.concepts, ["LOCATION"]);

  if (categories.length === 0) {
    warnings.push(
      "No purchasable category could be derived from the confirmed profile, so Discovery prompts cannot be planned. Add a product or service category on the Understand step.",
    );
  }

  const admit = (frame: RealUserQueryFrame) => {
    const verdict = validateFrame(frame);
    const signature = frameSignature(frame);
    if (!verdict.valid) {
      discarded.push({ signature, reason: verdict.reason ?? "invalid frame" });
      return;
    }
    if (seen.has(signature)) {
      discarded.push({ signature, reason: "duplicate frame plan" });
      return;
    }
    seen.add(signature);
    frames.push(frame);
  };

  const nextId = (section: string) => {
    counter += 1;
    return `frm_${section.replace(/\s+/g, "").toLowerCase()}_${counter}`;
  };

  // --- Discovery ----------------------------------------------------------
  const discoveryTarget = input.maxPerSection?.Discovery ?? SECTION_CANDIDATE_TARGET.Discovery;
  const intents = weightedCycle(
    Object.entries(DISCOVERY_INTENT_WEIGHTS[input.archetype] ?? DISCOVERY_INTENT_WEIGHTS.other).map(([intent, weight]) => [intent as BuyerIntent, weight ?? 1] as [BuyerIntent, number]),
    discoveryTarget,
  );
  const depths = weightedCycle(DEPTH_MIX.map((entry) => [entry.depth, entry.weight] as [FrameDepth, number]), discoveryTarget);
  const discoveryRegisters = weightedCycle(
    REGISTER_MIX.Discovery.map((entry) => [entry.register, entry.weight] as [PromptRegister, number]),
    discoveryTarget,
  );

  let audienceTurn = 0;
  let criterionTurn = 0;
  for (let i = 0; i < discoveryTarget && categories.length > 0; i++) {
    const depth = depths[i] ?? "medium";
    const topic = pick(input.topics, i);
    // Prefer the category concept the topic maps to, so a topic actually
    // steers what is measured rather than being decoration.
    const topicConcept = topic?.conceptId ? input.concepts.find((c) => c.id === topic.conceptId) ?? null : null;
    const category = topicConcept?.neutralLabel ? topicConcept : pick(categories, i)!;

    // The topic's own concept becomes the activity when it is one — this is
    // how "Running" reaches the sentence as an activity rather than a noun.
    const activityFromTopic = topicConcept && ["ACTIVITY", "USE_CASE"].includes(topicConcept.kind) ? topicConcept : null;
    const activity = depth === "short" ? activityFromTopic : (activityFromTopic ?? pick(activities, i));
    const audience = depth === "short" ? null : pick(audiences, audienceTurn++);
    const criterion = depth === "deep" || (depth === "medium" && i % 2 === 0) ? pick(criteria, criterionTurn++) : null;
    const location = depth === "deep" && locations.length > 0 ? pick(locations, i) : null;
    const job = pick(jobs, i);

    admit({
      id: nextId("discovery"),
      section: "Discovery",
      buyerIntent: intents[i] ?? "GET_RECOMMENDATION",
      depth,
      register: discoveryRegisters[i] ?? "question",
      categoryConcept: category,
      activityConcept: activity && activity.id !== category.id ? activity : null,
      audienceConcept: audience,
      criterionConcept: criterion,
      jobConcept: job,
      locationConcept: location,
      targetBrand: null,
      competitorName: null,
      competitorEntityId: null,
      sentimentTheme: null,
      topicId: topic?.id ?? null,
      topicName: topic?.name ?? null,
      conversationalGoal: `Elicit ${category.neutralLabel} brands without naming any`,
      sourceConceptIds: [category.id, activity?.id, audience?.id, criterion?.id, location?.id].filter((v): v is string => Boolean(v)),
    });
  }

  // --- Trade Offs ---------------------------------------------------------
  const tradeOffTarget = input.maxPerSection?.["Trade Offs"] ?? SECTION_CANDIDATE_TARGET["Trade Offs"];
  if (input.competitors.length === 0) {
    warnings.push("No confirmed competitor is available, so Trade Off prompts cannot be planned. Confirm at least one competitor on the Landscape step.");
  } else {
    if (input.competitors.length === 1) {
      warnings.push(`Only ${input.competitors[0]!.name} is confirmed, so every Trade Off prompt compares against the same rival. Confirm more competitors for broader coverage.`);
    }
    const allocation = allocateCompetitorSlots(input.competitors, tradeOffTarget);
    const tradeOffRegisters = weightedCycle(
      REGISTER_MIX["Trade Offs"].map((entry) => [entry.register, entry.weight] as [PromptRegister, number]),
      tradeOffTarget,
    );
    let index = 0;
    // Separate rotating counters. Deriving the audience from the shared index
    // aliased against the depth cycle — deep frames landed on indices 2, 5, 8,
    // all of which are the same audience modulo three, so every comparison
    // said "for families".
    let audienceTurn = 0;
    let criterionTurn = 0;
    for (const { competitor, count } of allocation) {
      for (let n = 0; n < count; n++, index++) {
        const depth: FrameDepth = n % 3 === 0 ? "short" : n % 3 === 1 ? "medium" : "deep";
        // Every comparison carries a decision dimension: a Trade Off without
        // one is just "which is better", which is the monotony to avoid.
        const criterion = pick(criteria, criterionTurn++);
        const activity = pick(activities, index);
        const category = pick(categories, index);
        const audience = depth === "deep" ? pick(audiences, audienceTurn++) : null;
        const location = depth === "deep" && locations.length > 0 ? pick(locations, index) : null;

        admit({
          id: nextId("tradeoffs"),
          section: "Trade Offs",
          buyerIntent: "COMPARE_BRANDS",
          depth,
          register: tradeOffRegisters[index] ?? "question",
          categoryConcept: category,
          activityConcept: activity && activity.id !== category?.id ? activity : null,
          audienceConcept: audience,
          criterionConcept: criterion,
          jobConcept: null,
          locationConcept: location,
          targetBrand: input.targetBrand,
          competitorName: competitor.name,
          competitorEntityId: competitor.entityId,
          sentimentTheme: null,
          topicId: pick(input.topics, index)?.id ?? null,
          topicName: pick(input.topics, index)?.name ?? null,
          conversationalGoal: `Compare ${input.targetBrand} with ${competitor.name} on ${criterion?.canonicalLabel ?? activity?.canonicalLabel ?? "overall fit"}`,
          sourceConceptIds: [category?.id, activity?.id, criterion?.id, audience?.id].filter((v): v is string => Boolean(v)),
        });
      }
    }
  }

  // --- Sentiment ----------------------------------------------------------
  const sentimentTarget = input.maxPerSection?.["Sentiment Analysis"] ?? SECTION_CANDIDATE_TARGET["Sentiment Analysis"];
  if (input.sentimentThemes.length === 0) {
    warnings.push("No sentiment themes are available for this business type.");
  }
  const sentimentRegisters = weightedCycle(
    REGISTER_MIX["Sentiment Analysis"].map((entry) => [entry.register, entry.weight] as [PromptRegister, number]),
    sentimentTarget,
  );
  for (let i = 0; i < sentimentTarget && input.sentimentThemes.length > 0; i++) {
    const theme = input.sentimentThemes[i % input.sentimentThemes.length]!;
    const depth: FrameDepth = i % 3 === 0 ? "short" : i % 3 === 1 ? "medium" : "deep";
    const category = pick(categories, i);
    const audience = depth === "deep" ? pick(audiences, i) : null;
    const location = depth === "deep" && locations.length > 0 ? pick(locations, i) : null;

    admit({
      id: nextId("sentiment"),
      section: "Sentiment Analysis",
      buyerIntent: i % 2 === 0 ? "CHECK_REPUTATION" : "CHECK_TRUST",
      depth,
      register: sentimentRegisters[i] ?? "question",
      categoryConcept: category,
      activityConcept: null,
      audienceConcept: audience,
      criterionConcept: null,
      jobConcept: null,
      locationConcept: location,
      targetBrand: input.targetBrand,
      competitorName: null,
      competitorEntityId: null,
      sentimentTheme: theme,
      topicId: null,
      topicName: null,
      conversationalGoal: `Check how ${input.targetBrand} is regarded for ${theme}`,
      sourceConceptIds: [category?.id, audience?.id].filter((v): v is string => Boolean(v)),
    });
  }

  return { frames, warnings, discarded };
}
