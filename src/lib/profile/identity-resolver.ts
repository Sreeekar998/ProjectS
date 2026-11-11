// Brand name and alias resolution.
//
// The naive approach — title-case the domain — gets `nike.in` right by luck
// and `hdfcbank.com`, `bookmyshow.com` or `jlr.com` wrong. Instead, candidates
// are ranked by the strength of the evidence that produced them, and the
// domain is only the last resort.

import { computeConfidence } from "./confidence";
import { evidenceStrength, type EvidenceItem } from "@/lib/evidence/types";

export interface BrandNameCandidate {
  value: string;
  score: number;
  evidenceIds: string[];
  sources: string[];
}

export interface IdentityResolution {
  brandName: { value: string; confidence: number; evidenceIds: string[]; source: "evidence" | "inferred_needs_review" };
  aliases: { values: string[]; confidence: number; evidenceIds: string[] };
  candidates: BrandNameCandidate[];
}

/** Weight of the evidence kind that produced a name candidate. */
const CANDIDATE_SOURCE_WEIGHT: Record<string, number> = {
  organization_schema: 1.0,
  // An `alternateName` is by definition not the primary name, so it must never
  // outrank the `name` it sits beside — it is alias evidence, not name evidence.
  organization_alias: 0.4,
  website_schema: 0.85,
  og_site_name: 0.8,
  logo_alt: 0.6,
  title_template: 0.55,
  page_title: 0.4,
  domain: 0.2,
  user_input: 0.9,
};

const LEGAL_SUFFIX =
  /\b(inc|inc\.|llc|l\.l\.c\.|ltd|ltd\.|limited|plc|gmbh|s\.a\.|sa|srl|bv|b\.v\.|nv|pty|pvt|private limited|corp|corporation|co\.|company|holdings|group|international)\b\.?$/i;

const TITLE_SEPARATORS = /\s+[|–—‒\-·:]\s+/;

/**
 * A page title is usually "Page Name | Brand" or "Brand: Page Name". Which
 * half is the brand is decided by which half repeats across pages, so this
 * returns both and lets the frequency count settle it.
 */
export function titleSegments(title: string): string[] {
  return title
    .split(TITLE_SEPARATORS)
    .map((s) => s.trim())
    .filter((s) => s.length >= 2 && s.length <= 60);
}

function cleanName(raw: string): string {
  return raw
    .replace(/^\s*(home|homepage|welcome to|official site of|official website of)\s*[:\-|]?\s*/i, "")
    .replace(/\s*[:\-|]\s*(official site|official website|home|homepage)\s*$/i, "")
    .replace(/[®™©]/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

function normalizeForCompare(value: string): string {
  return value.toLowerCase().replace(LEGAL_SUFFIX, "").replace(/[^a-z0-9]+/g, "");
}

function domainRoot(canonicalDomain: string): string {
  return canonicalDomain.split(".")[0] ?? canonicalDomain;
}

export function resolveIdentity(
  evidence: EvidenceItem[],
  canonicalDomain: string,
  userSuppliedName?: string,
): IdentityResolution {
  const candidates = new Map<string, BrandNameCandidate>();

  const push = (rawValue: string, sourceKey: string, item: EvidenceItem | null) => {
    const value = cleanName(rawValue);
    if (value.length < 2 || value.length > 60) return;
    if (/^https?:\/\//i.test(value)) return;
    const key = normalizeForCompare(value);
    if (!key) return;
    const weight = CANDIDATE_SOURCE_WEIGHT[sourceKey] ?? 0.3;
    const strength = item ? evidenceStrength(item) : 0.5;
    const existing = candidates.get(key);
    if (existing) {
      existing.score += weight * strength;
      if (item && !existing.evidenceIds.includes(item.id)) existing.evidenceIds.push(item.id);
      if (!existing.sources.includes(sourceKey)) existing.sources.push(sourceKey);
      // Prefer the better-formed spelling of the same name.
      if (value.length < existing.value.length && /[A-Z]/.test(value)) existing.value = value;
      return;
    }
    candidates.set(key, {
      value,
      score: weight * strength * 1.5,
      evidenceIds: item ? [item.id] : [],
      sources: [sourceKey],
    });
  };

  const titleSegmentCounts = new Map<string, { count: number; value: string; ids: string[] }>();

  for (const item of evidence) {
    if (item.fieldHint !== "brand_name" && item.fieldHint !== "brand_alias") continue;
    const text = item.text;

    if (item.sourceType === "jsonld" || item.sourceType === "microdata" || item.sourceType === "rdfa") {
      const nameMatch = text.match(/^(.*?)\s+name:\s*(.+)$/);
      if (nameMatch) {
        const schemaType = nameMatch[1] ?? "";
        const value = nameMatch[2] ?? "";
        push(value, /WebSite/i.test(schemaType) ? "website_schema" : "organization_schema", item);
        continue;
      }
      const aliasMatch = text.match(/alternateName:\s*(.+)$/);
      if (aliasMatch) push(aliasMatch[1] ?? "", "organization_alias", item);
      continue;
    }

    if (text.startsWith("og:site_name:")) {
      push(text.slice("og:site_name:".length), "og_site_name", item);
      continue;
    }
    if (text.startsWith("Logo alt text:")) {
      push(text.slice("Logo alt text:".length), "logo_alt", item);
      continue;
    }
    if (text.startsWith("Page title:") || text.startsWith("og:title:")) {
      const title = text.slice(text.indexOf(":") + 1).trim();
      for (const segment of titleSegments(title)) {
        const key = normalizeForCompare(segment);
        if (!key) continue;
        const entry = titleSegmentCounts.get(key) ?? { count: 0, value: segment, ids: [] };
        entry.count += 1;
        if (!entry.ids.includes(item.id)) entry.ids.push(item.id);
        titleSegmentCounts.set(key, entry);
      }
      // A single-segment title on the homepage is very often just the brand.
      if (titleSegments(title).length === 1 && item.pageType === "home") push(title, "page_title", item);
    }
  }

  // A title segment repeating across several pages is the site's brand slot.
  const totalTitles = [...titleSegmentCounts.values()].reduce((max, e) => Math.max(max, e.count), 0);
  for (const entry of titleSegmentCounts.values()) {
    if (entry.count < 2 || entry.count < totalTitles * 0.5) continue;
    const key = normalizeForCompare(entry.value);
    const existing = candidates.get(key);
    const boost = 0.55 * Math.min(1, entry.count / 4);
    if (existing) {
      existing.score += boost;
      for (const id of entry.ids) if (!existing.evidenceIds.includes(id)) existing.evidenceIds.push(id);
      if (!existing.sources.includes("title_template")) existing.sources.push("title_template");
    } else {
      candidates.set(key, { value: cleanName(entry.value), score: boost, evidenceIds: entry.ids, sources: ["title_template"] });
    }
  }

  // A SECTION of the site is not the business.
  //
  // Large sites give each section its own og:site_name — "HubSpot Blog",
  // "Acme Support", "Nike Store" — and a section that publishes many pages
  // outweighs the handful that carry the bare brand, so the crawl elected
  // "HubSpot Blog" as the company. That name then propagated into the
  // description, every prompt and every competitor reason string. When the
  // remainder of such a name IS the registrable domain, the section word is
  // furniture: fold the candidate into the real brand rather than competing
  // with it.
  const SITE_SECTION =
    /\s+(blog|shop|store|help|support|docs|documentation|news|newsroom|careers|jobs|community|academy|learn|learning|developers?|api|status|press|partners?|events?|forum|knowledge ?base|resources?|pricing|login|account|home|official site|online store|official store)$/i;
  const domainRootKey = normalizeForCompare(domainRoot(canonicalDomain));
  for (const [key, candidate] of [...candidates]) {
    const stripped = candidate.value.replace(SITE_SECTION, "").trim();
    if (stripped === candidate.value || stripped.length < 2) continue;
    const strippedKey = normalizeForCompare(stripped);
    if (!domainRootKey || strippedKey !== domainRootKey) continue;
    const target = candidates.get(strippedKey);
    if (target) {
      target.score += candidate.score;
      for (const id of candidate.evidenceIds) if (!target.evidenceIds.includes(id)) target.evidenceIds.push(id);
      for (const source of candidate.sources) if (!target.sources.includes(source)) target.sources.push(source);
    } else {
      candidates.set(strippedKey, { ...candidate, value: stripped });
    }
    candidates.delete(key);
  }

  // The domain confirms a candidate rather than creating one: a candidate that
  // matches the registrable domain is almost certainly the brand.
  const domainKey = normalizeForCompare(domainRoot(canonicalDomain));
  for (const [key, candidate] of candidates) {
    if (!domainKey || domainKey.length < 3) break;
    // Containment in either direction, not just a shared prefix: "Books to
    // Scrape" embeds "toscrape", and "Nike" is a prefix of "nikeinc". A shared
    // prefix alone would miss the first case and pick the site's tagline.
    const related = key === domainKey || key.includes(domainKey) || domainKey.includes(key);
    if (related) candidate.score += 0.9;
  }

  if (userSuppliedName) push(userSuppliedName, "user_input", null);

  if (candidates.size === 0 && canonicalDomain) {
    // Last resort only: no schema, no og:site_name, no repeating title.
    const fallback = domainRoot(canonicalDomain);
    candidates.set(normalizeForCompare(fallback), {
      value: fallback.charAt(0).toUpperCase() + fallback.slice(1),
      score: 0.2,
      evidenceIds: [],
      sources: ["domain"],
    });
  }

  const ranked = [...candidates.values()].sort((a, b) => b.score - a.score || a.value.length - b.value.length);
  const winner = ranked[0];
  if (!winner) {
    return {
      brandName: { value: canonicalDomain, confidence: 0, evidenceIds: [], source: "inferred_needs_review" },
      aliases: { values: [], confidence: 0, evidenceIds: [] },
      candidates: [],
    };
  }

  const winnerItems = evidence.filter((e) => winner.evidenceIds.includes(e.id));
  const fromEvidence = winner.sources.some((s) => s !== "domain");
  // An alias-only winner means no primary name was declared anywhere; say so
  // rather than presenting a nickname as the brand name.
  const confidence = fromEvidence
    ? computeConfidence({ items: winnerItems, ceiling: winner.sources.includes("organization_schema") ? 100 : 88 })
    : 20;

  const winnerKey = normalizeForCompare(winner.value);
  const aliasCandidates = ranked
    .slice(1)
    .filter((c) => {
      const key = normalizeForCompare(c.value);
      // Drop near-duplicates of the winner and generic page-title leftovers.
      if (key === winnerKey || key.includes(winnerKey) || winnerKey.includes(key)) return false;
      return c.sources.some((s) => s === "organization_alias" || s === "organization_schema" || s === "og_site_name" || s === "website_schema");
    })
    .slice(0, 5);

  return {
    brandName: {
      value: winner.value,
      confidence,
      evidenceIds: winner.evidenceIds.slice(0, 6),
      source: fromEvidence ? "evidence" : "inferred_needs_review",
    },
    aliases: {
      values: aliasCandidates.map((c) => c.value),
      confidence: aliasCandidates.length > 0 ? 70 : 0,
      evidenceIds: aliasCandidates.flatMap((c) => c.evidenceIds).slice(0, 6),
    },
    candidates: ranked.slice(0, 8),
  };
}
