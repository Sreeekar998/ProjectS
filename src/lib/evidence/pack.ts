// Builds the curated EvidencePack handed to the synthesis layer.
//
// The point of a pack is that it is *small and representative*: a 26-page
// crawl produces on the order of a thousand evidence items, and sending all of
// them would be both expensive and counter-productive — the model's attention
// is the scarce resource, and burying the About-page sentence under 400
// listing items is how you get a bad description.
//
// Selection is per field hint, ranked by evidence strength, with a per-page cap
// so one large category page cannot dominate.

import { evidenceStrength, type EvidenceFieldHint, type EvidenceItem, type EvidencePack } from "./types";
import type { PageSummary } from "@/lib/profile/deterministic-extractor";
import type { BusinessProfile } from "@/lib/profile/schema";
import type { IndustryResolution } from "@/lib/profile/industry-classifier";

/** Per-hint budgets, tuned so the whole pack stays inside a free-tier request. */
const HINT_BUDGET: Record<EvidenceFieldHint, number> = {
  brand_name: 12,
  brand_alias: 6,
  description: 26,
  industry: 18,
  archetype: 10,
  offering: 60,
  identity: 24,
  market: 30,
  audience: 18,
  language: 8,
  contact: 4,
};

const MAX_PER_PAGE_PER_HINT = 8;

export interface BuildPackInput {
  projectId: string;
  runId: string;
  canonicalDomain: string;
  seedUrl: string;
  evidence: EvidenceItem[];
  pages: PageSummary[];
  baseline: BusinessProfile;
  industry: IndustryResolution;
}

export function buildEvidencePack(input: BuildPackInput): EvidencePack {
  const byHint = new Map<EvidenceFieldHint, EvidenceItem[]>();
  for (const item of input.evidence) {
    const hint = (item.fieldHint ?? "description") as EvidenceFieldHint;
    const list = byHint.get(hint) ?? [];
    list.push(item);
    byHint.set(hint, list);
  }

  const selected: EvidenceItem[] = [];
  for (const [hint, items] of byHint) {
    const budget = HINT_BUDGET[hint] ?? 8;
    const perPage = new Map<string, number>();
    const ranked = [...items].sort((a, b) => evidenceStrength(b) - evidenceStrength(a) || a.text.length - b.text.length);
    for (const item of ranked) {
      if (selected.filter((s) => (s.fieldHint ?? "description") === hint).length >= budget) break;
      const pageKey = item.crawlPageId ?? item.url;
      const used = perPage.get(pageKey) ?? 0;
      if (used >= MAX_PER_PAGE_PER_HINT) continue;
      perPage.set(pageKey, used + 1);
      selected.push(item);
    }
  }

  // Always include everything the baseline already cites, so the model can see
  // exactly what the deterministic pass relied on and argue with it.
  const citedIds = new Set(collectCitedIds(input.baseline));
  const byId = new Map(input.evidence.map((e) => [e.id, e]));
  for (const id of citedIds) {
    if (selected.some((s) => s.id === id)) continue;
    const item = byId.get(id);
    if (item) selected.push(item);
  }

  return {
    projectId: input.projectId,
    runId: input.runId,
    canonicalDomain: input.canonicalDomain,
    seedUrl: input.seedUrl,
    items: selected,
    pages: input.pages.map((p) => ({ id: p.id, url: p.url, pageType: p.pageType, title: p.title })),
    deterministic: {
      brandNameCandidates: [{ value: input.baseline.identity.brandName.value, score: input.baseline.identity.brandName.confidence, evidenceIds: input.baseline.identity.brandName.evidenceIds }],
      offeringCandidates: input.baseline.offerings.items.map((o) => ({ name: o.name, type: o.type, support: o.pageCount, evidenceIds: o.evidenceIds })),
      marketCandidates: input.baseline.markets.map((m) => ({ name: m.name, level: m.level, support: m.confidence, evidenceIds: m.evidenceIds })),
      identityCandidates: input.baseline.brandIdentity.map((t) => ({ value: t.value, pageCount: t.pageCount, evidenceIds: t.evidenceIds })),
      audienceCandidates: input.baseline.targetAudience.map((a) => ({ value: a.value, pageCount: a.pageCount, evidenceIds: a.evidenceIds })),
      industryCandidates: input.industry.ranked.map((r) => ({
        taxonomyId: r.category.id,
        label: `${r.category.sector} — ${r.category.category}`,
        primary: r.category.sector,
        secondary: r.category.category,
        score: r.score,
        evidenceIds: r.evidenceIds,
      })),
      languages: input.baseline.geography.languages,
    },
  };
}

export function collectCitedIds(profile: BusinessProfile): string[] {
  return [
    ...profile.identity.brandName.evidenceIds,
    ...profile.identity.aliases.evidenceIds,
    ...profile.description.evidenceIds,
    ...profile.industry.evidenceIds,
    ...profile.archetype.evidenceIds,
    ...profile.offerings.items.flatMap((o) => o.evidenceIds),
    ...profile.brandIdentity.flatMap((t) => t.evidenceIds),
    ...profile.targetAudience.flatMap((a) => a.evidenceIds),
    ...profile.markets.flatMap((m) => m.evidenceIds),
    ...profile.geography.evidenceIds,
  ];
}
