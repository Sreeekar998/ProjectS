// Prompt selection.
//
// Selection is per section, not per coverage cell: each section fills exactly
// ten slots from its own candidate pool. Sorting by score and taking the top
// ten produces a set that is uniformly high-scoring and uniformly similar, so
// utility combines quality with what a candidate *adds* — a new topic, a new
// audience, a competitor that is under-represented.
//
// The greedy pass is deterministic: identical inputs always produce the
// identical selection, which is what makes an approved set reproducible.

import type { PromptSection } from "./types";
import { SECTION_SELECT_COUNT } from "./types";
import { MIN_SELECTABLE_SCORE } from "./scoring";

export interface ScoredCandidate {
  id: string;
  section: PromptSection;
  qualityScore: number;
  /** Normalized coverage keys this candidate satisfies. */
  coverageKeys: string[];
  competitorEntityId: string | null;
  topicId: string | null;
  sentimentTheme: string | null;
  evaluationCriterion: string | null;
  /** Grammatical register, capped so one shape cannot fill the section. */
  register: "keyword" | "imperative" | "question";
  /** The product/service category the prompt is about, capped for spread. */
  categoryKey: string | null;
  /** Highest similarity to any other candidate in the same section, 0-1. */
  maxSimilarity: number;
  /** Stable tiebreaker so equal-utility candidates always order the same way. */
  sequence: number;
  /**
   * A deterministic-floor candidate in a section that also has provider-written
   * candidates. Fallbacks fill only what the primary pool cannot.
   */
  fallback?: boolean;
  /**
   * Keys a section caps, such as the prompt's opening words or that it states
   * a budget (see SECTION_KEY_CAPS).
   */
  capKeys?: string[];
}

export interface SelectionUtility {
  coverageGain: number;
  diversityGain: number;
  selectionScore: number;
  reason: string;
}

export interface SelectionResult {
  selectedIds: string[];
  utilities: Map<string, SelectionUtility>;
  /** Sections that could not reach their required count. */
  shortfalls: Array<{ section: PromptSection; required: number; selected: number }>;
  /** Valid, unselected candidates the user can browse and swap in. */
  alternativesBySection: Map<PromptSection, string[]>;
}

const QUALITY_WEIGHT = 0.55;
const COVERAGE_WEIGHT = 0.3;
const DIVERSITY_WEIGHT = 0.15;

/**
 * No single register may hold more than this share of a section.
 *
 * Real tracked prompt sets are a mixture — the captured Velova Discovery set
 * runs one bare keyword phrase, five imperatives and four questions. Without a
 * cap the scorer picks whichever register happens to score a point higher and
 * the whole section comes out in one voice, which is precisely the
 * "repetitive templates" failure.
 */
const MAX_REGISTER_SHARE = 0.6;

/**
 * Per-section caps on keys a candidate carries, by exact key or by the part
 * before the colon.
 *
 * Discovery: ten prompts where six opened "Which Dubai salon…" or "Looking
 * for…" read as one template however varied their needs were, and two budget
 * prompts in ten ("…for under AED 500", "…around AED 50–120") made money the
 * story of the section. Situation-first and story-style prompts are the most
 * natural individually and the most tiring in bulk.
 */
export const SECTION_KEY_CAPS: Partial<Record<PromptSection, Record<string, number>>> = {
  // Real openers are varied: "which" opens 4% of real recommendation prompts and "recommend" 1%.
  Discovery: { opening: 2, "first:which": 1, "first:recommend": 1, "first:suggest": 1, "first:looking": 1, "first:help": 1, "first:can": 2, "budget:stated": 1, "placeRole:nearby": 2, "shape:situation": 3, "style:story": 2, "style:search": 4 },
};

/** Caps that hold even when a thin pool relaxes the others: two price prompts in ten made money the story of a Nike set. */
const HARD_CAP_KEYS = new Set(["budget:stated"]);

function capFor(section: PromptSection, key: string): number | null {
  const caps = SECTION_KEY_CAPS[section];
  if (!caps) return null;
  return caps[key] ?? caps[key.split(":")[0]!] ?? null;
}

/** The first two words ("opening:which dubai") and the first word ("first:which"), as cap keys. */
export function openingKeys(text: string): string[] {
  const words = text.toLowerCase().match(/[a-z']+/g) ?? [];
  return [`opening:${words.slice(0, 2).join(" ")}`, `first:${words[0] ?? ""}`];
}

/** Cap on how many of a section's ten slots one competitor may hold. */
function competitorCap(distinctCompetitors: number, slots: number): number {
  if (distinctCompetitors <= 1) return slots;
  return Math.ceil(slots / distinctCompetitors) + 1;
}

function coverageGainFor(candidate: ScoredCandidate, covered: Set<string>): number {
  if (candidate.coverageKeys.length === 0) return 0;
  const fresh = candidate.coverageKeys.filter((key) => !covered.has(key)).length;
  return fresh / candidate.coverageKeys.length;
}

export function selectSection(section: PromptSection, pool: ScoredCandidate[]): {
  selected: ScoredCandidate[];
  utilities: Map<string, SelectionUtility>;
  alternatives: ScoredCandidate[];
} {
  const slots = SECTION_SELECT_COUNT[section];
  const utilities = new Map<string, SelectionUtility>();

  const eligible = pool
    .filter((candidate) => candidate.section === section && candidate.qualityScore >= MIN_SELECTABLE_SCORE)
    .sort((a, b) => b.qualityScore - a.qualityScore || a.sequence - b.sequence);

  // The cap spreads a section across the rivals it can genuinely be written
  // about. Counting template fallbacks here held well-paired provider prompts
  // to two per rival whenever the frozen set was large, and the freed slots
  // went to template comparisons with rivals the provider had declined to pair
  // ("Chipotle vs Blaze Pizza menu preferences").
  const competitorsIn = (candidates: ScoredCandidate[]) => new Set(candidates.map((c) => c.competitorEntityId).filter(Boolean)).size;
  const primaryCompetitors = competitorsIn(eligible.filter((candidate) => !candidate.fallback));
  const cap = competitorCap(primaryCompetitors > 0 ? primaryCompetitors : competitorsIn(eligible), slots);

  const selected: ScoredCandidate[] = [];
  const covered = new Set<string>();
  const competitorCounts = new Map<string, number>();
  const registerCounts = new Map<string, number>();
  const categoryCounts = new Map<string, number>();
  const distinctCategories = new Set(eligible.map((candidate) => candidate.categoryKey).filter(Boolean)).size;
  // With several categories available, no single one should take a third of
  // the section — otherwise "basketball gear" answers three of ten slots while
  // other confirmed topics go unmeasured.
  // Discovery holds at most two prompts per need once there are five or more:
  // three of ten Quality Chop House prompts asked for group feasting menus.
  const categoryCap = distinctCategories <= 2 ? slots : section === "Discovery" && distinctCategories >= 5 ? 2 : Math.max(2, Math.ceil(slots / Math.min(distinctCategories, 5)) + 1);
  const availableRegisters = new Set(eligible.map((candidate) => candidate.register)).size;
  // With only one register available the cap must not block selection.
  const registerCap = availableRegisters <= 1 ? slots : Math.max(2, Math.ceil(slots * MAX_REGISTER_SHARE));
  const criterionCounts = new Map<string, number>();
  const themeCounts = new Map<string, number>();
  const capKeyCounts = new Map<string, number>();
  // Two-phase fill. Candidates a provider wrote from the customer intent model
  // go first; the deterministic template floor only fills slots they cannot.
  // Letting both compete on one utility scale selected ten of thirty Nike
  // prompts from templates ("Nike product quality reviews") over better
  // intent-written alternatives, because a template's coverage keys looked
  // "new" beside the intent vocabulary. Without a provider every candidate is
  // primary, so the no-key behaviour is unchanged.
  const fill = (candidates: ScoredCandidate[]): ScoredCandidate[] => {
    const remaining = [...candidates];

    // Diversity caps are preferences, not quotas. If the pool cannot supply
    // enough of the other registers, relaxing the cap is strictly better than
    // returning a short section — the product requires exactly ten. They relax
    // in two steps: register and key caps first, the category cap last, so a
    // thin pool does not hand four of ten Discovery slots to one need.
    let capsActive = true;
    let categoryCapActive = true;

    while (selected.length < slots && remaining.length > 0) {
      let bestIndex = -1;
      let bestUtility: SelectionUtility | null = null;

      for (let i = 0; i < remaining.length; i++) {
        const candidate = remaining[i]!;

        // Hard allocation guards, applied before utility so a dominant
        // competitor cannot simply out-score its way past the cap.
        if (candidate.competitorEntityId) {
          const used = competitorCounts.get(candidate.competitorEntityId) ?? 0;
          if (used >= cap) continue;
        }
        if (categoryCapActive && candidate.categoryKey && (categoryCounts.get(candidate.categoryKey) ?? 0) >= categoryCap) continue;
        if ((candidate.capKeys ?? []).some((key) => {
          const cap = HARD_CAP_KEYS.has(key) ? capFor(section, key) : null;
          return cap !== null && (capKeyCounts.get(key) ?? 0) >= cap;
        })) continue;
        if (capsActive) {
          if ((registerCounts.get(candidate.register) ?? 0) >= registerCap) continue;
          if ((candidate.capKeys ?? []).some((key) => {
            const cap = capFor(section, key);
            return cap !== null && (capKeyCounts.get(key) ?? 0) >= cap;
          })) continue;
        }

        const coverageGain = coverageGainFor(candidate, covered);
        const diversityGain = 1 - candidate.maxSimilarity;

        // Soft penalties: repeating a criterion or theme is allowed but costly,
        // so ten Trade Offs do not all hinge on "overall value".
        const criterionUsed = candidate.evaluationCriterion ? (criterionCounts.get(candidate.evaluationCriterion) ?? 0) : 0;
        const themeUsed = candidate.sentimentTheme ? (themeCounts.get(candidate.sentimentTheme) ?? 0) : 0;
        // Steep, because three selected prompts differing only in their trailing
        // category ("Does Nike generally offer good value for sportswear /
        // athletic apparel / running shoes?") is the "ten slight variations"
        // failure even though each is individually well-formed.
        const repetitionPenalty = Math.min(0.45, criterionUsed * 0.18 + themeUsed * 0.18);

        const selectionScore =
          QUALITY_WEIGHT * (candidate.qualityScore / 100) + COVERAGE_WEIGHT * coverageGain + DIVERSITY_WEIGHT * diversityGain - repetitionPenalty;

        if (
          !bestUtility ||
          selectionScore > bestUtility.selectionScore + 1e-9 ||
          (Math.abs(selectionScore - bestUtility.selectionScore) <= 1e-9 && candidate.sequence < remaining[bestIndex]!.sequence)
        ) {
          bestIndex = i;
          bestUtility = {
            coverageGain: Number(coverageGain.toFixed(4)),
            diversityGain: Number(diversityGain.toFixed(4)),
            selectionScore: Number(selectionScore.toFixed(4)),
            reason: buildReason(candidate, coverageGain, diversityGain),
          };
        }
      }

      if (bestIndex < 0 || !bestUtility) {
        // Every remaining candidate was blocked by a diversity cap. Drop the
        // caps and keep filling rather than hand back nine of ten.
        if (capsActive && remaining.length > 0) {
          capsActive = false;
          continue;
        }
        if (categoryCapActive && remaining.length > 0) {
          categoryCapActive = false;
          continue;
        }
        break;
      }
      const chosen = remaining.splice(bestIndex, 1)[0]!;
      selected.push(chosen);
      utilities.set(chosen.id, bestUtility);
      for (const key of chosen.coverageKeys) covered.add(key);
      if (chosen.competitorEntityId) competitorCounts.set(chosen.competitorEntityId, (competitorCounts.get(chosen.competitorEntityId) ?? 0) + 1);
      registerCounts.set(chosen.register, (registerCounts.get(chosen.register) ?? 0) + 1);
      if (chosen.categoryKey) categoryCounts.set(chosen.categoryKey, (categoryCounts.get(chosen.categoryKey) ?? 0) + 1);
      if (chosen.evaluationCriterion) criterionCounts.set(chosen.evaluationCriterion, (criterionCounts.get(chosen.evaluationCriterion) ?? 0) + 1);
      if (chosen.sentimentTheme) themeCounts.set(chosen.sentimentTheme, (themeCounts.get(chosen.sentimentTheme) ?? 0) + 1);
      for (const key of chosen.capKeys ?? []) capKeyCounts.set(key, (capKeyCounts.get(key) ?? 0) + 1);
    }
    return remaining;
  };

  const leftoverPrimary = fill(eligible.filter((candidate) => !candidate.fallback));
  const leftoverFallback = fill(eligible.filter((candidate) => candidate.fallback));
  return { selected, utilities, alternatives: [...leftoverPrimary, ...leftoverFallback] };
}

function buildReason(candidate: ScoredCandidate, coverageGain: number, diversityGain: number): string {
  const parts = [`quality ${candidate.qualityScore}`];
  if (coverageGain > 0) parts.push(`adds ${Math.round(coverageGain * 100)}% new coverage`);
  if (diversityGain > 0.6) parts.push("distinct from the rest of the section");
  if (candidate.competitorEntityId) parts.push("competitor allocation");
  if (candidate.sentimentTheme) parts.push(`theme: ${candidate.sentimentTheme}`);
  if (candidate.evaluationCriterion) parts.push(`criterion: ${candidate.evaluationCriterion}`);
  return parts.join(" · ");
}

export function selectPromptSetBySection(pool: ScoredCandidate[]): SelectionResult {
  const selectedIds: string[] = [];
  const utilities = new Map<string, SelectionUtility>();
  const shortfalls: SelectionResult["shortfalls"] = [];
  const alternativesBySection = new Map<PromptSection, string[]>();

  for (const section of Object.keys(SECTION_SELECT_COUNT) as PromptSection[]) {
    const result = selectSection(section, pool);
    for (const candidate of result.selected) selectedIds.push(candidate.id);
    for (const [id, utility] of result.utilities) utilities.set(id, utility);
    alternativesBySection.set(
      section,
      result.alternatives.sort((a, b) => b.qualityScore - a.qualityScore || a.sequence - b.sequence).map((c) => c.id),
    );
    const required = SECTION_SELECT_COUNT[section];
    if (result.selected.length < required) {
      shortfalls.push({ section, required, selected: result.selected.length });
    }
  }

  return { selectedIds, utilities, shortfalls, alternativesBySection };
}
