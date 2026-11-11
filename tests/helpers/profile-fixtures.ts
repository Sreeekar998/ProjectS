// Test helpers for building valid BusinessProfile fixtures.
//
// Downstream tests (prompt generation, coverage policy) only care about a
// handful of profile fields, but the type requires the whole canonical shape.
// Building fixtures through `emptyProfile` keeps those tests focused and means
// a future schema addition does not require touching every test file.

import { emptyProfile, type BusinessArchetype, type BusinessProfile, type MarketLevel } from "@/lib/profile/schema";
import type { EvidenceItem, EvidenceSourceType, EvidenceFieldHint } from "@/lib/evidence/types";
import type { PageType } from "@/lib/crawler/page-classifier";

export interface ProfileFixtureInput {
  brandName: string;
  archetype: BusinessArchetype;
  criteria?: string[];
  industry: string;
  industryTaxonomyId?: string;
  offerings?: string[];
  description?: string;
  brandIdentity?: string[];
  audiences?: string[];
  countries?: string[];
  cities?: string[];
  regulated?: boolean;
  domain?: string;
}

export function makeProfile(input: ProfileFixtureInput): BusinessProfile {
  const domain = input.domain ?? `${input.brandName.toLowerCase().replace(/\s+/g, "")}.example`;
  const profile = emptyProfile(domain);
  const countries = input.countries ?? [];
  const cities = input.cities ?? [];

  profile.identity.brandName = { value: input.brandName, source: "evidence", evidenceIds: [], confidence: 90 };
  profile.identity.domains = [domain];
  profile.description = {
    value: input.description ?? `${input.brandName} operates in ${input.industry}.`,
    source: "evidence",
    evidenceIds: [],
    confidence: 80,
  };
  if (input.criteria) profile.decisionConstraints = { values: input.criteria, source: "evidence", evidenceIds: [], confidence: 90 };
  profile.archetype = { value: input.archetype, source: "evidence", evidenceIds: [], confidence: 90, scores: {} };
  profile.industry = {
    value: input.industry,
    taxonomyId: input.industryTaxonomyId ?? null,
    primary: input.industry,
    secondary: null,
    source: "evidence",
    evidenceIds: [],
    confidence: 85,
  };
  profile.offerings = {
    values: input.offerings ?? [],
    items: (input.offerings ?? []).map((name) => ({ name, type: "category" as const, confidence: 80, evidenceIds: [], pageCount: 2 })),
    source: (input.offerings ?? []).length > 0 ? "evidence" : "inferred_needs_review",
    evidenceIds: [],
    confidence: 80,
  };
  profile.brandIdentity = (input.brandIdentity ?? []).map((value) => ({ value, confidence: 80, evidenceIds: [], pageCount: 2, needsCheck: false }));
  profile.targetAudience = (input.audiences ?? []).map((value) => ({ value, confidence: 75, evidenceIds: [], pageCount: 2 }));
  profile.personas = {
    values: input.audiences ?? [],
    source: (input.audiences ?? []).length > 0 ? "evidence" : "inferred_needs_review",
    evidenceIds: [],
    confidence: 75,
  };
  profile.markets = [
    ...countries.map((name, index) => ({ name, level: "country" as MarketLevel, countryCode: null, confidence: 85, evidenceIds: [], isPrimary: index === 0 })),
    ...cities.map((name) => ({ name, level: "city" as MarketLevel, countryCode: null, confidence: 75, evidenceIds: [], isPrimary: false })),
  ];
  profile.marketScope = {
    value: countries.length > 1 ? "multi-country" : cities.length > 0 ? "local" : countries.length === 1 ? "national" : "unknown",
    source: "evidence",
    evidenceIds: [],
    confidence: 80,
  };
  profile.geography = {
    countries,
    regions: [],
    cities,
    serviceAreaDescription: null,
    languages: ["en"],
    source: "evidence",
    evidenceIds: [],
  };
  profile.regulatedDomain = {
    isRegulated: input.regulated ?? false,
    categories: input.regulated ? ["healthcare"] : [],
    source: "evidence",
  };
  profile.quality = { overallConfidence: 82, evidenceItemCount: 40, pagesAnalyzed: 8, synthesisMode: "deterministic", warnings: [] };
  return profile;
}

let evidenceCounter = 0;

export interface EvidenceFixtureInput {
  text: string;
  sourceType?: EvidenceSourceType;
  pageType?: PageType;
  fieldHint?: EvidenceFieldHint;
  url?: string;
  crawlPageId?: string;
  data?: Record<string, unknown>;
  id?: string;
}

export function makeEvidence(input: EvidenceFixtureInput): EvidenceItem {
  evidenceCounter += 1;
  const url = input.url ?? "https://example.test/";
  return {
    id: input.id ?? `ev_test_${evidenceCounter}`,
    runId: "crw_test",
    projectId: "prj_test",
    crawlPageId: input.crawlPageId ?? `pg_${url}`,
    url,
    canonicalUrl: null,
    pageType: input.pageType ?? "home",
    sourceType: input.sourceType ?? "main_content",
    text: input.text,
    fieldHint: input.fieldHint ?? null,
    data: input.data ?? null,
    extractedAt: new Date("2026-01-01T00:00:00Z").toISOString(),
  };
}

export function makeEvidenceSet(items: EvidenceFixtureInput[]): EvidenceItem[] {
  return items.map(makeEvidence);
}
