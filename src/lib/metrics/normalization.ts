import { parse as parseTld } from "tldts";
import type { Entity } from "@/lib/landscape/repository";

export const PARSER_VERSION = "response-parser@1";

export interface ParsedMention {
  entityId: string;
  aliasMatched: string;
  charStart: number;
  charEnd: number;
  isRecommendation: boolean;
  rankPosition: number | null;
  confidence: number;
}

export interface ParsedCitation {
  url: string;
  domain: string;
  matchedEntityId: string | null;
  isOwnedDomain: boolean;
}

function escapeRegex(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function buildAliasPattern(alias: string): RegExp | null {
  const trimmed = alias.trim();
  if (trimmed.length < 2) return null;
  return new RegExp(`\\b${escapeRegex(trimmed)}\\b`, "gi");
}

// A numbered/bulleted list item, capturing the leading marker (e.g. "1.",
// "2)", "-", "*") and the item's own text span, used both to detect
// recommendation-style structure and to assign explicit rank positions.
const LIST_ITEM_PATTERN = /^\s*(?:(\d{1,2})[.)]|[-*•])\s+(.+)$/gm;

interface ListItem {
  rank: number | null;
  start: number;
  end: number;
}

function detectListItems(text: string): ListItem[] {
  const items: ListItem[] = [];
  for (const match of text.matchAll(LIST_ITEM_PATTERN)) {
    const rank = match[1] ? Number(match[1]) : null;
    items.push({ rank, start: match.index!, end: match.index! + match[0].length });
  }
  return items;
}

const RECOMMENDATION_CONTEXT_PATTERN = /\b(recommend|top choice|best option|consider|worth considering|popular choice|well-?regarded|leading (provider|option|brand))\b/i;

/** Parses one response's text against the confirmed entity set. Exact
 * alias/domain matches only (spec 8.2 step 2) — no fuzzy/LLM-judge matching
 * in this build, which is a documented simplification (see
 * IMPLEMENTATION_STATUS.md). Rank is assigned ONLY when the mention falls
 * inside a numbered list item; ambiguous prose always yields rank=null
 * rather than invented precision. */
export function parseMentions(responseText: string, entities: Entity[], aliasesByEntity: Map<string, string[]>): ParsedMention[] {
  const mentions: ParsedMention[] = [];
  const listItems = detectListItems(responseText);

  for (const entity of entities) {
    const aliasCandidates = [entity.canonicalName, ...(aliasesByEntity.get(entity.id) ?? [])];
    const seenSpans = new Set<string>();
    for (const alias of aliasCandidates) {
      const pattern = buildAliasPattern(alias);
      if (!pattern) continue;
      for (const match of responseText.matchAll(pattern)) {
        const start = match.index!;
        const end = start + match[0].length;
        const spanKey = `${start}-${end}`;
        if (seenSpans.has(spanKey)) continue;
        seenSpans.add(spanKey);

        const containingItem = listItems.find((item) => start >= item.start && start < item.end);
        const nearbyText = responseText.slice(Math.max(0, start - 120), Math.min(responseText.length, end + 120));
        const isRecommendation = Boolean(containingItem) || RECOMMENDATION_CONTEXT_PATTERN.test(nearbyText);

        mentions.push({
          entityId: entity.id,
          aliasMatched: alias,
          charStart: start,
          charEnd: end,
          isRecommendation,
          rankPosition: containingItem?.rank ?? null,
          confidence: 95,
        });
      }
    }
  }
  return mentions;
}

export function parseCitations(sourceUrls: string[], entities: Entity[]): ParsedCitation[] {
  const domainToEntity = new Map<string, string>();
  for (const entity of entities) {
    for (const domain of entity.domains as string[]) {
      const parsed = parseTld(domain);
      if (parsed.domain) domainToEntity.set(parsed.domain.toLowerCase(), entity.id);
    }
  }

  return sourceUrls.map((url) => {
    let domain = "";
    try {
      const parsed = parseTld(new URL(url).hostname);
      domain = parsed.domain?.toLowerCase() ?? "";
    } catch {
      domain = "";
    }
    const matchedEntityId = domainToEntity.get(domain) ?? null;
    return { url, domain, matchedEntityId, isOwnedDomain: matchedEntityId !== null && entities.find((e) => e.id === matchedEntityId)?.kind === "target" };
  });
}
