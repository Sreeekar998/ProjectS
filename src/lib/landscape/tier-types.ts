// Geographic competitor tiers: shared types for discovery, persistence, the
// Landscape API and the page.
//
// Operators asked for competitors "area-wise for strictly local businesses,
// city-wise for almost everything, country-wide for businesses catering to the
// whole country or known brands, possibly all three" (feedback 2026-09-14).
// Discovery plans up to three tiers from the confirmed location and labels
// every suggestion with the tier its evidence supports.
//
// Frozen after Phase 0: additions are fine, renames are not (the Landscape page
// and the API DTO are built against these names in parallel).
//
// Client-safe: types and one constant only.

export const COMPETITOR_TIER_POLICY_VERSION = "competitor-tiers@1";

export type CompetitorTier = "area" | "city" | "country";
export type TierLevel = "neighborhood" | "city" | "country" | "global";

export interface TierSpec {
  tier: CompetitorTier;
  /** "DIFC" | "Dubai" | "United Arab Emirates" | "Worldwide" */
  place: string;
  /** Names that count as inside: area = neighbourhood + nearby areas; city = primary + branch cities; country = country names. */
  places: string[];
  level: TierLevel;
  countryCodes: string[];
  quota: number;
  /** Area tier only. */
  radiusMeters?: number;
}

export interface BrandReach {
  known: boolean;
  points: number;
  signals: Array<{ kind: string; value: string; points: number }>;
  checkedOpenKnowledge: boolean;
}

export interface CompetitorTierPlan {
  version: typeof COMPETITOR_TIER_POLICY_VERSION;
  /** Always ordered area → city → country. */
  tiers: TierSpec[];
  primaryTier: CompetitorTier | null;
  maxSuggestions: number;
  brandReach: BrandReach;
}

export type TierBasis =
  | "distance"
  | "area_name"
  | "city_name"
  | "structured_locality"
  | "country_footprint"
  | "country_domain"
  | "open_knowledge_country"
  | "source_hint"
  | "single_tier"
  | "unverified"
  | "operator";

export interface TierAssignment {
  /** null = no planned tier fits (positive evidence the business is elsewhere). */
  tier: CompetitorTier | null;
  /** The TierSpec.place it was assigned to. */
  place: string | null;
  basis: TierBasis;
  /** One factual clause for Why?: "600 m away (OpenStreetMap)". */
  evidence: string;
  elsewhere: string | null;
  geographyScore: number;
}

/** Stored as `entities.candidate_profile.tier`. */
export interface StoredCompetitorTier {
  tier: CompetitorTier;
  place: string;
  basis: TierBasis;
  evidence: string;
  policy: string;
  /** True when computed at read time for a row stored before tiers existed. */
  derived?: boolean;
}

// API DTOs (GET /api/projects/[id]/landscape → landscape.*). Rejected rows are
// still returned with status "removed"; the page filters them.

export interface LandscapeTierGroupDto {
  tier: CompetitorTier;
  place: string;
  level: TierLevel;
  heading: string;
  subheading: string | null;
  quota: number;
}

export interface LandscapeTierPlanDto {
  tiers: LandscapeTierGroupDto[];
  primaryTier: CompetitorTier | null;
  knownBrand: boolean;
}

export interface LandscapeCompetitorTierFields {
  tier: CompetitorTier | null;
  tierPlace: string | null;
  tierEvidence: string | null;
}
