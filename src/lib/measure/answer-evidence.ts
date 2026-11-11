// What to mark in an answer when it is shown: the brands the analyzer linked
// (as highlight surfaces) and the ownership of every source the page listed.
// Pure and client-safe; the answer drawer and the printable answers report
// both read it, and the answers API computes it on the server so a report
// of sixty answers is one request.

import type { Highlight } from "./answer-markdown";

export interface SourceItem {
  url: string;
  ownership: "TARGET_OWNED" | "COMPETITOR_OWNED" | "THIRD_PARTY" | "UNKNOWN" | string;
  ownerName: string | null;
}

interface OccurrenceLike {
  entityId?: string | null;
  confidence?: string;
  relation?: string;
  name?: string;
  mention?: { text?: string } | null;
}

interface AnalysisLike {
  occurrences?: OccurrenceLike[];
  emergingCandidates?: Array<{ name?: string; mentions?: Array<{ text?: string } | null> }>;
}

/**
 * Brands the analyzer linked in this answer, as highlight surfaces. Only
 * exact or strong links are marked: a weak match is not shown as a brand.
 */
export function highlightsFor(analysis: AnalysisLike | null | undefined, targetEntityId: string | null): Highlight[] {
  if (!analysis) return [];
  const out: Highlight[] = [];
  for (const occurrence of analysis.occurrences ?? []) {
    if (!occurrence.entityId || !["exact", "strong"].includes(occurrence.confidence ?? "")) continue;
    const surface = occurrence.mention?.text ?? occurrence.name;
    if (!surface) continue;
    const isTarget = occurrence.entityId === targetEntityId || occurrence.relation === "target" || occurrence.relation === "target_product";
    out.push({ surface, tone: isTarget ? "target" : "rival" });
  }
  for (const candidate of analysis.emergingCandidates ?? []) {
    for (const span of candidate.mentions ?? []) if (span?.text) out.push({ surface: span.text, tone: "untracked" });
    if (candidate.name) out.push({ surface: candidate.name, tone: "untracked" });
  }
  return out;
}

/** The page's source list in the order it was shown, each URL with the ownership the analysis recorded. */
export function sourcesFor(
  sourceUrls: string[],
  citations: Array<{ url: string; ownership: string; ownerEntityId: string | null }>,
  ownerNames: Map<string, string>,
): SourceItem[] {
  const byUrl = new Map(citations.map((citation) => [citation.url, citation]));
  return sourceUrls.map((url) => {
    const citation = byUrl.get(url);
    return { url, ownership: citation?.ownership ?? "UNKNOWN", ownerName: citation?.ownerEntityId ? (ownerNames.get(citation.ownerEntityId) ?? null) : null };
  });
}
