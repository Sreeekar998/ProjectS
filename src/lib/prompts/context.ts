import crypto from "node:crypto";
import type { BusinessProfile, MarketArea } from "@/lib/profile/schema";
import type { CompetitiveSetVersion } from "@/lib/landscape/repository";
import type { FrozenCompetitorSnapshot, FrozenTopicSnapshot } from "@/lib/db/schema";
import { promptGeographyFromProfile, type PromptPlace } from "./geography";

// @2: geography.places (profile-bound, levelled) and the business understanding fields.
export const PROMPT_CONTEXT_POLICY_VERSION = "prompt-context@2";

export interface PromptContextSnapshotData {
  brand: {
    name: string;
    aliases: string[];
    domain: string;
    uniqueIdentifyingTerms: string[];
  };
  description: string;
  industry: string;
  subIndustry: string | null;
  businessArchetype: string;
  offerings: string[];
  targetAudiences: string[];
  personas: string[];
  jobsToBeDone: string[];
  painPoints: string[];
  useCases: string[];
  evaluationCriteria: string[];
  confirmedTopics: FrozenTopicSnapshot[];
  competitiveSetVersionId: string;
  confirmedCompetitors: FrozenCompetitorSnapshot[];
  geography: {
    primaryMarket: string | null;
    additionalMarkets: string[];
    cities: string[];
    scope: string;
    language: string;
    locale: string;
    /** Levelled places from the confirmed location; absent on @1 snapshots. */
    places?: PromptPlace[];
    placeBound?: boolean;
    /** Where customers are measured (the operator's area or the business's footprint); absent before 2026-09-16. */
    marketArea?: MarketArea | null;
  };
  classification?: { businessType: string; localCategory: string | null; kind: string; path: string[]; pricePositioning: string } | null;
  profileVersionId: string;
  topicSetVersionId: string;
  policyVersion: string;
  createdAt: number;
}

function unique(values: string[]): string[] {
  return [...new Set(values.map((value) => value.trim()).filter(Boolean))];
}

function uniqueTargetTerms(profile: BusinessProfile): string[] {
  const terms = [...profile.identity.aliases.values];
  for (const offering of profile.offerings.items) {
    const name = offering.name.trim();
    if (offering.confidence >= 75 && (/®|™/.test(name) || name.toLowerCase().includes(profile.identity.brandName.value.toLowerCase()))) terms.push(name);
  }
  return unique(terms);
}

export function buildPromptContextSnapshot(
  profile: BusinessProfile,
  profileVersionId: string,
  competitiveSet: CompetitiveSetVersion,
  language: string,
): PromptContextSnapshotData {
  const competitors = competitiveSet.competitorSnapshot as FrozenCompetitorSnapshot[];
  const topics = competitiveSet.topicSnapshot as FrozenTopicSnapshot[];
  const markets = unique([...profile.geography.countries, ...profile.geography.regions, ...profile.geography.cities]);
  const promptGeography = promptGeographyFromProfile(profile);
  return {
    brand: {
      name: profile.identity.brandName.value,
      aliases: unique(profile.identity.aliases.values),
      domain: profile.identity.canonicalDomain || profile.identity.domains[0] || "",
      uniqueIdentifyingTerms: uniqueTargetTerms(profile),
    },
    description: profile.description.value,
    industry: profile.industry.primary || profile.industry.value,
    subIndustry: profile.industry.secondary,
    businessArchetype: profile.archetype.value,
    offerings: unique([...profile.offerings.values, ...profile.offerings.items.map((item) => item.name)]),
    targetAudiences: unique(profile.targetAudience.map((item) => item.value)),
    personas: unique(profile.personas.values),
    jobsToBeDone: unique(profile.customerJobs.values),
    painPoints: [],
    useCases: unique([...profile.customerJobs.values, ...profile.offerings.values]),
    evaluationCriteria: unique(profile.decisionConstraints.values),
    confirmedTopics: topics,
    competitiveSetVersionId: competitiveSet.id,
    confirmedCompetitors: competitors,
    geography: {
      primaryMarket: markets[0] ?? null,
      additionalMarkets: markets.slice(1),
      cities: unique(profile.geography.cities),
      scope: profile.marketScope.value,
      language,
      locale: language,
      ...(promptGeography ? { places: promptGeography.places, placeBound: promptGeography.placeBound, marketArea: promptGeography.marketArea ?? null } : {}),
    },
    classification: profile.classification
      ? {
          businessType: profile.classification.businessType,
          localCategory: profile.classification.localCategory,
          kind: profile.classification.kind,
          path: profile.classification.path,
          pricePositioning: profile.classification.pricePositioning,
        }
      : null,
    profileVersionId,
    topicSetVersionId: competitiveSet.id,
    policyVersion: PROMPT_CONTEXT_POLICY_VERSION,
    createdAt: Date.now(),
  };
}

export function hashPromptContext(context: PromptContextSnapshotData): string {
  return crypto.createHash("sha256").update(JSON.stringify(context)).digest("hex");
}
