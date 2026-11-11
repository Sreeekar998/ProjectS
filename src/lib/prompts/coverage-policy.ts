import type { BusinessArchetype } from "@/lib/profile/schema";
import type { CoverageCell, CoveragePolicy, Cohort, Intent, GeographyScope, JourneyStage } from "./types";
import { NEUTRAL_TOTAL, SECTION_SELECT_COUNT } from "./types";
import type { Topic } from "@/lib/landscape/repository";
import type { Entity } from "@/lib/landscape/repository";
import type { Location } from "@/lib/geography/repository";
import { hasTieredRivals, orderRivalsByTierMix } from "@/lib/landscape/competitor-tier-order";

// Bumped when the selection policy changes shape: v3 is the 10/10/10 split
// that replaced the earlier 21/4/5 spine.
// @4: profile-bound levelled places (neighbourhood/city), classification-based
// choice unit, routed prompt models, stacked/too-broad geography validators.
// @5: the Trade Off comparison pool is ordered round-robin across geographic
// competitor tiers (area → city → country); untiered sets order as @4.
export const COVERAGE_POLICY_VERSION = "prompt-selection@5-10-10-10";

// Section 5.2: neutral-intent emphasis per archetype. Weights need not sum to
// 1 — they are normalized at allocation time — which keeps this table easy
// to extend without breaking every other row.
const INTENT_WEIGHTS: Record<BusinessArchetype, Partial<Record<Intent, number>>> = {
  b2b_saas_enterprise: { discover: 2, recommend: 3, solve_problem: 3, alternatives: 2, evaluate: 3, purchase: 1 },
  ecommerce_dtc_retail: { discover: 2, recommend: 2, solve_problem: 2, alternatives: 2, evaluate: 2, purchase: 3 },
  local_service: { discover: 2, recommend: 3, solve_problem: 1, alternatives: 1, evaluate: 1, visit_contact: 3 },
  dealership: { discover: 2, recommend: 3, solve_problem: 1, alternatives: 2, evaluate: 2, visit_contact: 3 },
  restaurant_food_chain: { discover: 3, recommend: 3, solve_problem: 1, alternatives: 1, purchase: 3 },
  multi_location_chain: { discover: 2, recommend: 2, alternatives: 1, evaluate: 1, visit_contact: 3, purchase: 2 },
  healthcare: { discover: 3, recommend: 2, solve_problem: 1, evaluate: 3, visit_contact: 2 },
  finance: { discover: 3, recommend: 2, solve_problem: 1, evaluate: 3, alternatives: 1 },
  marketplace: { discover: 3, recommend: 2, alternatives: 2, evaluate: 2, purchase: 2 },
  travel_hospitality: { discover: 3, recommend: 2, alternatives: 1, evaluate: 1, purchase: 3 },
  education: { discover: 3, recommend: 2, evaluate: 3, alternatives: 1, visit_contact: 1 },
  other: { discover: 3, recommend: 3, solve_problem: 2, alternatives: 2, evaluate: 2 },
};

const GEO_EMPHASIS: Record<BusinessArchetype, { scope: GeographyScope; fraction: number }> = {
  b2b_saas_enterprise: { scope: "country", fraction: 0.2 },
  ecommerce_dtc_retail: { scope: "country", fraction: 0.3 },
  local_service: { scope: "city", fraction: 0.6 },
  dealership: { scope: "city", fraction: 0.6 },
  restaurant_food_chain: { scope: "city", fraction: 0.65 },
  multi_location_chain: { scope: "city", fraction: 0.45 },
  healthcare: { scope: "region", fraction: 0.4 },
  finance: { scope: "country", fraction: 0.35 },
  marketplace: { scope: "country", fraction: 0.3 },
  travel_hospitality: { scope: "city", fraction: 0.5 },
  education: { scope: "city", fraction: 0.3 },
  other: { scope: "country", fraction: 0.25 },
};

const TRADE_OFF_CRITERIA: Record<BusinessArchetype, string[]> = {
  b2b_saas_enterprise: ["implementation effort", "workflow fit", "integration needs", "scalability"],
  // Fallbacks apply when the site itself yielded no criteria, so they have to
  // hold for anything sold online. "Comfort" and "product fit" are apparel
  // vocabulary and produced "Which espresso blends are known for comfort?" for
  // a coffee roaster sharing this archetype.
  ecommerce_dtc_retail: ["quality", "price", "delivery", "overall value"],
  local_service: ["service-area fit", "availability", "reliability", "overall value"],
  dealership: ["vehicle availability", "purchase experience", "after-sales service", "overall value"],
  restaurant_food_chain: ["occasion fit", "menu preferences", "location", "overall value"],
  multi_location_chain: ["location coverage", "service consistency", "availability", "overall value"],
  healthcare: ["service fit", "access", "location", "general patient experience"],
  finance: ["fee transparency", "digital convenience", "support", "trust"],
  marketplace: ["selection", "seller trust", "buyer experience", "overall value"],
  travel_hospitality: ["location", "amenities", "traveler fit", "overall value"],
  education: ["program fit", "delivery format", "student support", "overall value"],
  other: ["fit for the use case", "reliability", "service experience", "overall value"],
};

const SENTIMENT_THEMES: Record<BusinessArchetype, string[]> = {
  b2b_saas_enterprise: ["reliability", "implementation experience", "support", "ease of use", "value"],
  ecommerce_dtc_retail: ["product quality", "delivery experience", "returns", "authenticity", "value"],
  local_service: ["reliability", "service quality", "responsiveness", "trust", "value"],
  dealership: ["sales transparency", "purchase experience", "service", "after-sales support", "trust"],
  restaurant_food_chain: ["food quality", "service", "consistency", "cleanliness reputation", "value"],
  multi_location_chain: ["service consistency", "availability", "customer experience", "reliability", "value"],
  healthcare: ["institutional reputation", "general patient experience", "service quality", "access", "trust"],
  finance: ["trust", "security reputation", "fee transparency", "reliability", "support"],
  marketplace: ["seller trust", "buyer experience", "reliability", "support", "value"],
  travel_hospitality: ["cleanliness", "service", "booking reliability", "room quality", "value"],
  education: ["institutional reputation", "teaching quality", "student support", "program experience", "value"],
  other: ["reliability", "quality", "customer experience", "support", "value"],
};

const INTENT_TO_COHORT: Record<Intent, Cohort> = {
  discover: "neutral_discovery",
  recommend: "neutral_discovery",
  solve_problem: "neutral_problem",
  alternatives: "neutral_discovery",
  evaluate: "neutral_evaluation",
  verify: "branded_accuracy",
  purchase: "neutral_evaluation",
  visit_contact: "neutral_evaluation",
  compare: "target_comparison",
};

const INTENT_TO_JOURNEY: Record<Intent, JourneyStage> = {
  discover: "awareness",
  recommend: "consideration",
  solve_problem: "awareness",
  alternatives: "consideration",
  evaluate: "consideration",
  verify: "decision",
  purchase: "decision",
  visit_contact: "decision",
  compare: "decision",
};

function allocateAcrossTopics(total: number, topics: Topic[]): number[] {
  const sortedByPriority = [...topics].sort((a, b) => a.priority - b.priority);
  const n = sortedByPriority.length;
  const base = Math.floor(total / n);
  const remainder = total - base * n;
  return sortedByPriority.map((_, idx) => base + (idx < remainder ? 1 : 0));
}

// Cycles through intents in weight-priority order rather than front-loading
// repeats for the heaviest-weighted intent. This guarantees zero same-topic
// intent repeats whenever slotCount <= the number of distinct weighted
// intents (true for the overwhelming majority of real topic allocations).
// When slotCount does exceed the distinct count, repeats still happen,
// highest-weight intents first.
function normalizedIntentPlan(archetype: BusinessArchetype, slotCount: number): Intent[] {
  // A website the classifier could not place must still produce a prompt set,
  // so an unrecognised archetype degrades to the neutral plan instead of
  // throwing partway through generation.
  const weights = INTENT_WEIGHTS[archetype] ?? INTENT_WEIGHTS.other;
  const sortedIntents = (Object.entries(weights) as Array<[Intent, number]>).sort((a, b) => b[1] - a[1]).map(([intent]) => intent);
  if (sortedIntents.length === 0 || slotCount === 0) return [];
  const plan: Intent[] = Array.from({ length: slotCount }, (_, i) => sortedIntents[i % sortedIntents.length]!);
  // Guarantee at least one "discover" slot even on an archetype whose
  // weight table happens not to define it, so every topic gets a genuine
  // discovery-style question rather than only niche intents.
  if (!plan.includes("discover")) plan[0] = "discover";
  return plan;
}

/**
 * Builds the coverage cells for a prompt set: ten slots per section.
 *
 * Since the frame planner took over generation, cells no longer drive
 * wording — they record the measurement plan and group retries by section.
 * The counts are kept in step with SECTION_SELECT_COUNT so the plan and the
 * selection policy can never silently disagree.
 */
export function buildCoveragePolicy(archetype: BusinessArchetype, topics: Topic[], competitors: Entity[], locations: Location[] = []): CoveragePolicy {
  const confirmedTopics = topics.filter((t) => t.status === "confirmed");
  const topicAllocations = allocateAcrossTopics(NEUTRAL_TOTAL, confirmedTopics);
  const geo = GEO_EMPHASIS[archetype] ?? GEO_EMPHASIS.other;
  // Never bind geography to a scope with no confirmed location evidence —
  // an empty locations table means "no geography available yet", not
  // license to fabricate a placeholder like "Global / unspecified".
  const geoAvailable = locations.some((l) => l.level === geo.scope);
  const cells: CoverageCell[] = [];
  // Tracks how many cells with this exact (cohort, intent) combination have
  // already been created, ACROSS topics, so each cell's cellIndex is unique
  // within its (cohort, intent) family.
  const intentCellCounters = new Map<string, number>();
  const nextCellIndex = (cohort: string, intent: string): number => {
    const key = `${cohort}:${intent}`;
    const next = (intentCellCounters.get(key) ?? 0) + 1;
    intentCellCounters.set(key, next);
    return next - 1;
  };

  confirmedTopics.forEach((topic, idx) => {
    const slotCount = topicAllocations[idx] ?? 0;
    if (slotCount === 0) return;
    const intents = normalizedIntentPlan(archetype, slotCount);
    const geoSlots = geoAvailable ? Math.round(slotCount * geo.fraction) : 0;
    intents.forEach((intent, i) => {
      const hasGeo = i < geoSlots;
      const cohort = INTENT_TO_COHORT[intent];
      const brandPolicy = "TARGET_FORBIDDEN" as const;
      cells.push({
        key: `${cohort}|${topic.id}|${intent}|${hasGeo ? "geo" : "nogeo"}|${i}`,
        cellIndex: nextCellIndex(cohort, intent),
        cohort,
        section: "Discovery",
        intent,
        journeyStage: INTENT_TO_JOURNEY[intent],
        topicId: topic.id,
        topicName: topic.name,
        persona: null,
        useCaseConstraint: topic.name,
        evaluationCriterion: null,
        sentimentTheme: null,
        geographyScope: hasGeo ? geo.scope : "none",
        brandPolicy,
        competitorEntityId: null,
        generateCount: 3,
        selectCount: 1,
      });
    });
  });

  // Sentiment Analysis: ten TARGET_REQUIRED slots, spread across verify/evaluate
  // and cycling the archetype's sentiment themes.
  for (let i = 0; i < SECTION_SELECT_COUNT["Sentiment Analysis"]; i++) {
    cells.push({
      key: `branded_accuracy|${i}`,
      cellIndex: i,
      cohort: "branded_accuracy",
      section: "Sentiment Analysis",
      intent: i % 2 === 0 ? "verify" : "evaluate",
      journeyStage: "decision",
      topicId: null,
      topicName: null,
      persona: null,
      useCaseConstraint: null,
      evaluationCriterion: null,
      sentimentTheme: (SENTIMENT_THEMES[archetype] ?? SENTIMENT_THEMES.other)[i % (SENTIMENT_THEMES[archetype] ?? SENTIMENT_THEMES.other).length]!,
      geographyScope: "none",
      brandPolicy: "TARGET_REQUIRED",
      competitorEntityId: null,
      generateCount: 4,
      selectCount: 1,
    });
  }

  // Trade Offs: ten slots allocated across the confirmed competitors, each
  // paired with a rotating decision criterion so the ten comparisons do not
  // all hinge on the same dimension.
  const eligibleCompetitors = competitors.filter((c) => c.status === "confirmed" && ["direct", "substitute", "adjacent"].includes(c.competitorType ?? ""));
  // Any confirmed rival except a marketplace, ranked as the intent generator
  // ranks them: confidence first, directness as a bonus, mixed across tiers.
  const confirmedCompetitors = hasTieredRivals(eligibleCompetitors)
    ? orderRivalsByTierMix(eligibleCompetitors)
    : eligibleCompetitors.sort((a, b) => (b.confidence ?? 0) + (b.competitorType === "direct" ? 8 : 0) - ((a.confidence ?? 0) + (a.competitorType === "direct" ? 8 : 0)));
  const comparisonPool = confirmedCompetitors.length > 0 ? confirmedCompetitors : [null];
  const criteria = TRADE_OFF_CRITERIA[archetype] ?? TRADE_OFF_CRITERIA.other;
  for (let i = 0; i < SECTION_SELECT_COUNT["Trade Offs"]; i++) {
    const competitor = comparisonPool[i % comparisonPool.length];
    cells.push({
      key: `target_comparison|${i}`,
      cellIndex: i,
      cohort: "target_comparison",
      section: "Trade Offs",
      intent: "compare",
      journeyStage: "decision",
      topicId: null,
      topicName: null,
      persona: null,
      useCaseConstraint: null,
      evaluationCriterion: criteria[i % criteria.length]!,
      sentimentTheme: null,
      geographyScope: "none",
      brandPolicy: "TARGET_REQUIRED",
      competitorEntityId: competitor?.id ?? null,
      generateCount: 5,
      selectCount: 1,
    });
  }

  return { archetype, cells, version: COVERAGE_POLICY_VERSION };
}


/** Sentiment themes for an archetype, used by the frame planner. */
export function sentimentThemesFor(archetype: BusinessArchetype): string[] {
  return SENTIMENT_THEMES[archetype] ?? SENTIMENT_THEMES.other;
}

/** Decision dimensions a buyer weighs for this archetype. */
export function tradeOffCriteriaFor(archetype: BusinessArchetype): string[] {
  return TRADE_OFF_CRITERIA[archetype] ?? TRADE_OFF_CRITERIA.other;
}
