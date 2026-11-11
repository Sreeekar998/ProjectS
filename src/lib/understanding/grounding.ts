// Grounding: turns model citations into stored evidence ids and rejects
// claims the website does not support.
//
// The model cites page ids and fact ids. A page id is not an evidence id, so
// each claim is matched against the evidence items stored for the cited pages
// and the ones that share the claim's words are attached. A claim whose words
// appear nowhere in what it cites is checked against the whole site; if they
// appear nowhere at all it is dropped — this is what stops a model from adding
// "Bridal makeup" to a salon that never mentions makeup.

import type { EvidenceItem } from "@/lib/evidence/types";
import type { SiteDigest } from "./digest";

const STOPWORDS = new Set(
  "a an and are as at be by for from has have in is it its of on or our that the their this to we with you your us all any can more most also into per via not no only own same so than too very just about over under up out off then there these those what which who whom how when where why will would should could may might must do does did done get got".split(" "),
);

function stem(token: string): string {
  if (token.length > 5 && token.endsWith("ing")) return token.slice(0, -3);
  if (token.length > 4 && token.endsWith("ies")) return `${token.slice(0, -3)}y`;
  // "-es" is a plural ending only after s, x, z, ch and sh: "manicures" is
  // "manicure" + s, and stripping "es" left "manicur", which then failed to
  // match the singular on the page.
  if (token.length > 4 && /(sses|xes|zes|ches|shes)$/.test(token)) return token.slice(0, -2);
  if (token.length > 3 && token.endsWith("s") && !/(ss|us|is)$/.test(token)) return token.slice(0, -1);
  if (token.length > 5 && token.endsWith("ed")) return token.slice(0, -2);
  return token;
}

/** Content tokens, Unicode-aware, lowercased, lightly stemmed. */
export function contentTokens(text: string): string[] {
  const tokens = text
    .normalize("NFKD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .match(/[\p{L}\p{N}]+/gu);
  if (!tokens) return [];
  return tokens.filter((t) => (t.length > 1 || /\d/.test(t)) && !STOPWORDS.has(t)).map(stem);
}

/** Fraction of the claim's content tokens present in the haystack (0..1). */
export function supportRatio(claim: string, haystack: string | Set<string>): number {
  const claimTokens = [...new Set(contentTokens(claim))];
  if (claimTokens.length === 0) return 0;
  const hay = typeof haystack === "string" ? new Set(contentTokens(haystack)) : haystack;
  const hits = claimTokens.filter((t) => hay.has(t)).length;
  return hits / claimTokens.length;
}

export interface ResolvedCitations {
  evidenceIds: string[];
  pageIds: string[];
  text: string;
  valid: number;
  invalid: number;
}

export class Grounder {
  private readonly corpusTokens: Set<string>;
  private readonly pageTokenCache = new Map<string, Set<string>>();

  constructor(private readonly digest: SiteDigest) {
    this.corpusTokens = new Set(contentTokens(digest.corpus));
  }

  resolve(citations: string[]): ResolvedCitations {
    const evidenceIds: string[] = [];
    const pageIds: string[] = [];
    const texts: string[] = [];
    let valid = 0;
    let invalid = 0;
    for (const raw of citations) {
      const ref = raw.trim().replace(/^\[|\]$/g, "").toLowerCase();
      const fact = this.digest.factByRef.get(ref);
      if (fact) {
        valid++;
        if (!evidenceIds.includes(fact.evidenceId)) evidenceIds.push(fact.evidenceId);
        texts.push(fact.text);
        if (fact.pageId && !pageIds.includes(fact.pageId)) pageIds.push(fact.pageId);
        continue;
      }
      const page = this.digest.pageByRef.get(ref);
      if (page) {
        valid++;
        if (!pageIds.includes(page.pageId)) pageIds.push(page.pageId);
        texts.push(page.text);
        continue;
      }
      invalid++;
    }
    return { evidenceIds, pageIds, text: texts.join("\n"), valid, invalid };
  }

  /** Is the claim supported anywhere on the site (pages, facts, titles, headings)? */
  siteSupport(claim: string): number {
    return supportRatio(claim, this.corpusTokens);
  }

  /** Pages whose digest text supports the claim best, for claims with no usable citation. */
  findSupportingPages(claim: string, minRatio = 0.6): string[] {
    const scored: Array<{ pageId: string; ratio: number }> = [];
    for (const page of this.digest.pages) {
      let tokens = this.pageTokenCache.get(page.pageId);
      if (!tokens) {
        tokens = new Set(contentTokens(`${page.title ?? ""} ${page.text}`));
        this.pageTokenCache.set(page.pageId, tokens);
      }
      const ratio = supportRatio(claim, tokens);
      if (ratio >= minRatio) scored.push({ pageId: page.pageId, ratio });
    }
    return scored.sort((a, b) => b.ratio - a.ratio).slice(0, 3).map((s) => s.pageId);
  }

  /**
   * Evidence ids for a claim: directly cited facts first, then the evidence
   * items on cited pages that share the most words with the claim. When no
   * item on a cited page overlaps (the claim is an inference, such as a
   * business type), the page's strongest items are used so the "Why?" panel
   * still shows where the model looked.
   */
  evidenceFor(claim: string, resolved: ResolvedCitations, max = 4, allowInference = false): string[] {
    const out = [...resolved.evidenceIds];
    const claimTokens = new Set(contentTokens(claim));
    const candidates: Array<{ item: EvidenceItem; score: number }> = [];
    for (const pageId of resolved.pageIds) {
      for (const item of this.digest.evidenceByPage.get(pageId) ?? []) {
        if (out.includes(item.id)) continue;
        const itemTokens = new Set(contentTokens(item.text));
        let overlap = 0;
        for (const token of claimTokens) if (itemTokens.has(token)) overlap++;
        if (overlap > 0) candidates.push({ item, score: overlap + (item.sourceType === "jsonld" || item.sourceType === "heading" ? 0.5 : 0) - item.text.length / 4000 });
      }
    }
    candidates.sort((a, b) => b.score - a.score);
    for (const { item } of candidates) {
      if (out.length >= max) break;
      out.push(item.id);
    }
    if (out.length === 0 && allowInference) {
      for (const pageId of resolved.pageIds) {
        const items = (this.digest.evidenceByPage.get(pageId) ?? []).filter((i) => ["heading", "main_content", "meta", "jsonld"].includes(i.sourceType));
        for (const item of items.slice(0, 2)) {
          if (out.length >= max) break;
          out.push(item.id);
        }
      }
    }
    return out.slice(0, max);
  }

  evidenceItems(ids: string[]): EvidenceItem[] {
    return ids.map((id) => this.digest.evidenceById.get(id)).filter((i): i is EvidenceItem => Boolean(i));
  }

  /** Evidence ids on the given pages matching a claim, used after `findSupportingPages`. */
  evidenceOnPages(claim: string, pageIds: string[], max = 3): string[] {
    return this.evidenceFor(claim, { evidenceIds: [], pageIds, text: "", valid: pageIds.length, invalid: 0 }, max, true);
  }
}
