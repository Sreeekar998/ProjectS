// Position and rank — deliberately two separate questions.
//
// Position always exists for a present brand: it is where in the answer the
// brand first appears. Rank frequently does not exist, and manufacturing one
// from sentence order is how "Nike, ASICS and Brooks are all solid choices"
// becomes a false claim that Nike ranked first.

import type { ListStructure } from "./discourse";
import { ORDERED_PROSE_PATTERN } from "./discourse";
import type { DetectedMention } from "./mentions";
import type { OccurrenceRole, PositionBucket, PositionEvidence, RankEligibility, Span } from "./types";

/**
 * How many options an answer offered, for deciding whether it can carry a rank.
 * `options` counts every business offered, tracked or untracked;
 * `trackedOptions` only the tracked ones; `numberedOptions` the options that
 * sit on a numbered line or heading. A bare number is the older call shape
 * (tracked options only) and reads as all three.
 */
export interface OptionCounts {
  options: number;
  trackedOptions: number;
  numberedOptions: number;
}

export function determineRankEligibility(
  text: string,
  list: ListStructure,
  counts: OptionCounts | number,
): { eligibility: RankEligibility; reason: string } {
  const { options, trackedOptions, numberedOptions } =
    typeof counts === "number" ? { options: counts, trackedOptions: counts, numberedOptions: list.numbered ? counts : 0 } : counts;
  if (options === 0) return { eligibility: "no_options", reason: "no entity was presented as an option" };
  if (options === 1) return { eligibility: "single_option", reason: "only one option offered; nothing to rank" };

  // An explicit disclaimer beats every structural signal, including numbering.
  // Authors who number an unordered list still mean it is unordered when they
  // say so, and honouring the words over the markup is what keeps the parser
  // from inventing a competitive ordering.
  if (list.explicitlyUnordered) {
    return { eligibility: "not_rankable", reason: "the answer explicitly disclaims ordering" };
  }

  // Numbering ranks the options only when the options are what is numbered:
  // a numbered list of steps beside a bulleted list of salons ranks nothing.
  if (list.numbered && list.items.length >= 2 && numberedOptions >= 2) {
    return { eligibility: "explicit_ordered_list", reason: "numbered list markers" };
  }

  // Ordinal prose is read only when two tracked brands were offered, as
  // before observation-analysis@18: "then" and "next" are common words, and
  // counting untracked names would turn ordinary prose into rankings.
  if (trackedOptions >= 2 && ORDERED_PROSE_PATTERN.test(text)) {
    return { eligibility: "ordered_prose", reason: "ordinal prose ordering ('top choice', 'then', 'finally')" };
  }

  return { eligibility: "not_rankable", reason: "options given without any ordering signal" };
}

export function buildPositions(
  text: string,
  mentions: DetectedMention[],
  list: ListStructure,
  eligibility: RankEligibility,
  roleByMentionStart: Map<number, OccurrenceRole>,
): PositionEvidence[] {
  const length = Math.max(1, text.length);
  const firstByEntity = new Map<string, DetectedMention>();
  for (const mention of mentions) {
    const key = mention.entityId ?? mention.name.toLowerCase();
    if (!firstByEntity.has(key)) firstByEntity.set(key, mention);
  }

  const ordered = [...firstByEntity.values()].sort((a, b) => a.span.start - b.span.start);

  return ordered.map((mention, index) => {
    const ratio = mention.span.start / length;
    const bucket: PositionBucket = ratio < 1 / 3 ? "top" : ratio < 2 / 3 ? "middle" : "bottom";

    // A rank is emitted only when the response is rank-eligible AND this
    // mention sits inside an actual ordered marker. Prose order never becomes
    // a rank, however tempting the sequence looks.
    let explicitRank: number | null = null;
    if (eligibility === "explicit_ordered_list") {
      const item = list.items.find((i) => mention.span.start >= i.span.start && mention.span.start < i.span.end);
      explicitRank = item?.marker ?? null;
    } else if (eligibility === "ordered_prose") {
      const role = roleByMentionStart.get(mention.span.start);
      if (role === "RECOMMENDED") explicitRank = index + 1;
    }

    return {
      entityId: mention.entityId,
      name: mention.name,
      firstMentionOrder: index + 1,
      positionBucket: bucket,
      explicitRank,
      evidence: mention.span as Span,
    };
  });
}
