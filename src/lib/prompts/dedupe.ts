import { normalizeForSimilarity, textSimilarity } from "@/lib/text/similarity";

const NEAR_DUPLICATE_THRESHOLD = 0.72;

export interface DedupableItem {
  id: string;
  text: string;
  cohort: string;
  contextKey?: string;
}

export interface DedupeResult {
  survivors: string[]; // ids
  duplicateOf: Map<string, string>; // duplicate id -> survivor id
  clusterIdByCandidate: Map<string, string>;
}

function clusterId(seed: string): string {
  let hash = 2166136261;
  for (let index = 0; index < seed.length; index++) {
    hash ^= seed.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return `cluster_${(hash >>> 0).toString(16)}`;
}

/** Exact-normalized dedupe first, then near-duplicate clustering within the
 * same cohort (a neutral_discovery question and a branded_accuracy question
 * are never considered duplicates of each other, even if superficially
 * similar, since they measure different things). Ties broken by the caller's
 * preferred ordering (pass items already sorted best-first).
 *
 * `anchors` are candidates already accepted in an earlier pass (e.g. before
 * a coverage-gap retry regenerated more candidates) — they act as read-only
 * reference points that new `items` are checked against, but are never
 * themselves eligible to be marked a duplicate. Without this, a retry that
 * regenerates the same template output for a different coverage cell would
 * only ever be compared against the other candidates generated in that same
 * retry batch, missing the fact that an earlier pass already accepted
 * identical text — letting an exact duplicate slip into the final 30. */
export function dedupeCandidates(items: DedupableItem[], anchors: DedupableItem[] = []): DedupeResult {
  const survivors: string[] = [];
  const duplicateOf = new Map<string, string>();
  const clusterIdByCandidate = new Map<string, string>();
  const seenExact = new Map<string, string>();
  const anchorPool: DedupableItem[] = [...anchors];

  for (const anchor of anchors) {
    seenExact.set(`${anchor.cohort}::${normalizeForSimilarity(anchor.text)}`, anchor.id);
  }

  for (const item of items) {
    const normalized = `${item.cohort}::${normalizeForSimilarity(item.text)}`;
    const exactMatch = seenExact.get(normalized);
    if (exactMatch) {
      duplicateOf.set(item.id, exactMatch);
      clusterIdByCandidate.set(item.id, clusterIdByCandidate.get(exactMatch) ?? clusterId(normalized));
      continue;
    }
    seenExact.set(normalized, item.id);

    let nearMatch: string | undefined;
    for (const candidate of [...anchorPool, ...survivors.map((id) => items.find((i) => i.id === id)!)]) {
      if (candidate.cohort !== item.cohort) continue;
      // Similar wording can intentionally measure different topics, themes,
      // competitors, or buyer intents. Only collapse a semantic near-match
      // when its planned context is the same; exact text is still rejected
      // globally within the visible section above.
      if (candidate.contextKey && item.contextKey && candidate.contextKey !== item.contextKey) continue;
      if (textSimilarity(candidate.text, item.text) >= NEAR_DUPLICATE_THRESHOLD) {
        nearMatch = candidate.id;
        break;
      }
    }
    if (nearMatch) {
      duplicateOf.set(item.id, nearMatch);
      clusterIdByCandidate.set(item.id, clusterIdByCandidate.get(nearMatch) ?? clusterId(`${item.cohort}:${nearMatch}`));
    } else {
      survivors.push(item.id);
      clusterIdByCandidate.set(item.id, clusterId(normalized));
    }
  }

  return { survivors, duplicateOf, clusterIdByCandidate };
}
