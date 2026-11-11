import type { BusinessArchetype } from "@/lib/profile/schema";
import type { FrozenCompetitorSnapshot } from "@/lib/db/schema";
import type { CompetitorTier, CompetitorTierPlan, TierAssignment } from "./tier-types";

// @5: location-bound search source, understanding-aware search profile,
// geography scored from positive evidence only (a failed fetch is no longer
// "not local"), website comparison mentions need corroboration.
// @6: geographic tiers (area/city/country) with per-tier briefs, hints,
// evidence-based tier assignment, tier quotas; known-brand signal; nearby only
// for area tier; open knowledge country-filtered.
export const COMPETITOR_DISCOVERY_POLICY_VERSION = "competitor-discovery@6";

export type CompetitorSourceType =
  | "website_explicit"
  | "ai_hypothesis"
  | "authorized_search"
  | "web_search"
  | "nearby_places"
  | "open_knowledge"
  | "user_manual"
  | "observed_ai_response";

export type CompetitorRole = "direct" | "substitute" | "marketplace" | "adjacent" | "not_competitor";
export type EntityType = "company" | "brand" | "sub_brand" | "product_line" | "local_location";
export type EntityRelationship = "parent" | "sub_brand" | "product_line" | "local_location" | "same_entity";

export interface CompetitiveSearchProfile {
  targetBrand: string;
  aliases: string[];
  canonicalDomain: string;
  parentBrand: string | null;
  industry: string;
  subIndustry: string | null;
  businessArchetype: BusinessArchetype;
  businessModel: "B2B" | "B2C" | "mixed" | "unknown";
  offerings: string[];
  jobsToBeDone: string[];
  useCases: string[];
  targetAudiences: string[];
  personas: string[];
  importantTopics: Array<{ id: string; name: string; discoveryConcept: string }>;
  evaluationCriteria: string[];
  geography: {
    scope: string;
    cities: string[];
    regions: string[];
    countries: string[];
    locale: string;
    /** Finest levels, from the confirmed location (empty for older profiles). */
    neighborhoods?: string[];
    nearbyAreas?: string[];
    countryCode?: string | null;
    placeLabel?: string | null;
    formattedAddress?: string | null;
    lat?: number | null;
    lng?: number | null;
    /** What the primary place is to customers (`location.primaryRole`); absent on older profiles. */
    primaryRole?: string;
    /** Cities of other branches, for the city tier of regional chains. */
    branchCities?: string[];
    /** City-level service areas, for service-area businesses. */
    serviceAreaCities?: string[];
  };
  /** Business Understanding fields; absent on profiles built before it. */
  understanding?: {
    kind: string;
    businessType: string;
    localCategory: string | null;
    path: string[];
    description: string;
    pricePositioning: string;
    physicalPresence: string;
    /** Customers choose by place: geography gates competitors. */
    placeBound: boolean;
    offeringGroups: Array<{ name: string; items: string[] }>;
    audienceSegments: string[];
  };
  evidenceIds: string[];
  /**
   * The geographic tiers this run searches and groups by. Attached by
   * `discoverCompetitors` before any source starts; readers that get a profile
   * without it derive one with `planFromSearchProfile`.
   */
  tiers?: CompetitorTierPlan;
}

/** A source's guess at where a rival competes. The final tier is decided from evidence. */
export interface TierHint {
  tier: CompetitorTier;
  source: CompetitorSourceType;
}

export interface CandidateSourceEvidence {
  source: CompetitorSourceType;
  reason: string;
  evidenceIds: string[];
  discoveredAt: number;
}

export interface CompetitorCandidate {
  canonicalName: string;
  likelyDomain: string | null;
  proposedType: Exclude<CompetitorRole, "not_competitor">;
  entityType: EntityType;
  parentName?: string | null;
  reason: string;
  matchedDimensions: string[];
  confidence: number;
  /**
   * 0-100 evidence-grounded market affinity supplied by the discovering
   * source, independent of any lexical comparison of website text.
   *
   * It exists because token overlap between two homepages is a weak
   * substitutability signal — Nike's navigation says "Running / Jordan /
   * Sportswear" and Adidas's says "Originals / Terrex", which share no tokens
   * at all — while a structural signal (shared market-category signature,
   * explicit rivalry language) is strong. Sources that have such evidence
   * report it here; sources that do not leave it undefined and the scorer
   * falls back to the lexical dimensions alone.
   */
  structuralAffinity?: number;
  evidence: CandidateSourceEvidence[];
  aliases: string[];
  /** Where the candidate operates, when a source reported it (search results, model). */
  location?: { area: string | null; city: string | null; country: string | null; distanceMeters?: number | null } | null;
  /** Like-for-like screening by the re-rank step; absent when it did not run. */
  screening?: { keep: boolean; relevance: number; reason: string; tier?: CompetitorTier | "elsewhere" | "unknown" } | null;
  /** Tiers the discovering sources placed it in (one per source brief). */
  tierHint?: TierHint[];
  /** Tagged as a chain or brand (OpenStreetMap `brand=`): footprint evidence for the country tier. */
  chain?: boolean;
  /** Public pages a search source read about the candidate. */
  sourceUrls?: string[];
}

export interface CandidateBusinessProfile {
  displayName: string;
  canonicalDomain: string | null;
  finalUrl: string | null;
  title: string | null;
  description: string | null;
  offerings: string[];
  audienceSignals: string[];
  jobSignals: string[];
  useCaseSignals: string[];
  categorySignals: string[];
  geographySignals: string[];
  /** Target place names (neighbourhood, nearby areas, city, country) found on the candidate's own site. */
  placeMentions?: string[];
  /** addressLocality values from the candidate's structured data (cities, not streets). */
  structuredLocalities?: string[];
  /**
   * Target place names found only in the address, footer or JSON-LD text. A
   * blog post on a Jumeirah salon's site that mentions "DIFC" must not put it
   * in DIFC; body-text mentions stay in `placeMentions` and support the city tier only.
   */
  addressPlaceMentions?: string[];
  /** JSON-LD addressCountry values. */
  structuredCountries?: string[];
  /** Distinct addressLocality values: three or more is a multi-city footprint. */
  localityCount?: number;
  /** A same-origin locations / branches / store-locator link. */
  hasLocationsPage?: boolean;
  contentTokens: string[];
  pagesFetched: string[];
  verificationStatus: "not_applicable" | "pending" | "verified" | "failed" | "contradicted";
  verificationSummary: string;
  /** The fetch error behind a `failed` status (`timeout`, `http_403`, `dns_error`, …), so callers can tell a blocked site from a made-up one. */
  verificationError?: string | null;
}

export interface CompetitorScoreBreakdown {
  /** Structural market affinity from the discovering source. See CompetitorCandidate. */
  structuralAffinity: number;
  offeringOverlap: number;
  jobUseCaseOverlap: number;
  audienceOverlap: number;
  categoryOverlap: number;
  geographyOverlap: number;
  archetypeCompatibility: number;
  semanticSimilarity: number;
  evidenceConfidence: number;
  total: number;
}

export interface RankedCompetitorCandidate extends CompetitorCandidate {
  normalizedName: string;
  canonicalDomain: string | null;
  candidateProfile: CandidateBusinessProfile | null;
  role: CompetitorRole;
  score: CompetitorScoreBreakdown;
  rejectionReason: string | null;
  verificationStatus: CandidateBusinessProfile["verificationStatus"];
  verificationSummary: string;
  /** Where the evidence says it competes with the target. */
  tier: TierAssignment;
}

export interface CompetitorCandidateSource {
  readonly sourceType: CompetitorSourceType;
  discover(profile: CompetitiveSearchProfile): Promise<CompetitorCandidate[]>;
}

/**
 * Frozen snapshot rows written since competitor tiers (2026-09-14). Measure
 * reads only `entityId` and `canonicalName`, so the extra fields change no
 * figure; Trade Offs use them to mix rivals across tiers.
 */
export interface FrozenCompetitorSnapshotV2 extends FrozenCompetitorSnapshot {
  tier?: CompetitorTier | null;
  tierPlace?: string | null;
}

/** Future search connectors implement this. There is deliberately no default
 * consumer-search scraper or paid credential requirement in Phase 2. */
export interface WebSearchProvider {
  readonly id: string;
  readonly enabled: boolean;
  search(query: string, limit: number): Promise<Array<{ title: string; url: string; snippet: string }>>;
}

/** Reserved seam for a later observed-response source. New observations create
 * suggestions for the next version; they never mutate an existing frozen set. */
export interface ObservedCompetitorSignal {
  name: string;
  domain?: string;
  observationIds: string[];
  role: "solution" | "recommendation" | "source" | "infrastructure" | "example" | "other";
}
