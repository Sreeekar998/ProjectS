import { z } from "zod";
import type { SearchConsoleProfileSummary } from "@/lib/search-console/types";

// The Canonical Business Profile.
//
// This is a superset of the profile shape the downstream landscape/prompt
// layers already read (`identity.brandName.value`, `offerings.values`,
// `geography.countries`, …) — those accessors are kept verbatim so this task
// does not ripple into code it is not responsible for. Everything added here
// is the evidence-grounded layer: a synthesized description, a taxonomy-backed
// industry, evidence-supported identity traits, typed offerings, and markets
// with an explicit scope level.
//
// Rules that hold everywhere in this file:
//   * every substantive value carries `evidenceIds` and a `confidence`;
//   * `source` records whether a value came from evidence, from the model, or
//     from the user — a user edit is never silently overwritten;
//   * an empty array means "no evidence found", never "not looked at".

// Archetype is a finer-grained operational classification than industry: it
// drives which PromptCoveragePolicy row applies (spec 5.2). Several archetypes
// intentionally share a coverage-policy row (see prompts/coverage-policy.ts).
export const BUSINESS_ARCHETYPES = [
  "b2b_saas_enterprise",
  "ecommerce_dtc_retail",
  "local_service",
  "dealership",
  "restaurant_food_chain",
  "multi_location_chain",
  "healthcare",
  "finance",
  "marketplace",
  "travel_hospitality",
  "education",
  "other",
] as const;
export type BusinessArchetype = (typeof BUSINESS_ARCHETYPES)[number];

export const FieldProvenanceSource = z.enum(["evidence", "user", "inferred_needs_review"]);
export type ProvenanceSource = z.infer<typeof FieldProvenanceSource>;

const confidence = z.number().min(0).max(100);

const evidenceBackedString = z.object({
  value: z.string(),
  source: FieldProvenanceSource,
  evidenceIds: z.array(z.string()).default([]),
  confidence: confidence.default(0),
});

const evidenceBackedStringArray = z.object({
  values: z.array(z.string()).default([]),
  source: FieldProvenanceSource,
  evidenceIds: z.array(z.string()).default([]),
  confidence: confidence.default(0),
});

export const OFFERING_TYPES = ["product", "service", "category", "solution"] as const;
export type OfferingType = (typeof OFFERING_TYPES)[number];

export const OfferingSchema = z.object({
  name: z.string().min(1).max(80),
  type: z.enum(OFFERING_TYPES),
  confidence,
  evidenceIds: z.array(z.string()).default([]),
  /** Distinct pages this offering was observed on — the anti-one-off control. */
  pageCount: z.number().int().min(0).default(0),
});
export type Offering = z.infer<typeof OfferingSchema>;

// `neighborhood` and `district` were added for local businesses: "Dubai" is a
// city-wide market, "DIFC" is where a salon's customers actually come from.
export const MARKET_LEVELS = ["neighborhood", "district", "city", "region", "country", "multi-country", "global"] as const;
export type MarketLevel = (typeof MARKET_LEVELS)[number];

export const MarketSchema = z.object({
  name: z.string().min(1).max(80),
  level: z.enum(MARKET_LEVELS),
  /** ISO 3166-1 alpha-2 when the market is a country and it could be resolved. */
  countryCode: z.string().length(2).nullable().default(null),
  confidence,
  evidenceIds: z.array(z.string()).default([]),
  isPrimary: z.boolean().default(false),
});
export type Market = z.infer<typeof MarketSchema>;

// `hyperlocal` (one neighbourhood matters) and `international` were added.
// `multi-country` is kept so older profile versions still read correctly; new
// profiles write `international` instead.
export const MARKET_SCOPES = ["hyperlocal", "local", "regional", "national", "international", "multi-country", "global", "unknown"] as const;
export type MarketScope = (typeof MARKET_SCOPES)[number];

export const IdentityTraitSchema = z.object({
  value: z.string().min(1).max(60),
  confidence,
  evidenceIds: z.array(z.string()).default([]),
  pageCount: z.number().int().min(0).default(0),
  /** True when the trait rests on a single page and should be user-checked. */
  needsCheck: z.boolean().default(false),
});
export type IdentityTrait = z.infer<typeof IdentityTraitSchema>;

export const AudienceSchema = z.object({
  value: z.string().min(1).max(80),
  confidence,
  evidenceIds: z.array(z.string()).default([]),
  pageCount: z.number().int().min(0).default(0),
});

// --- Business Understanding v2 (all optional: older versions lack them) ----

const citedString = z.object({ value: z.string(), evidenceIds: z.array(z.string()).default([]), confidence: confidence.default(0) });

export const ClassificationSchema = z.object({
  /** Open labels inferred from the website, not picked from a list. */
  industry: z.string(),
  subIndustry: z.string().nullable(),
  businessType: z.string(),
  /** Broad → specific, 2-4 levels. */
  path: z.array(z.string()),
  /** Closed policy family for downstream logic (see understanding/kinds.ts). */
  kind: z.string(),
  businessModel: z.string(),
  customerType: z.string(),
  physicalPresence: z.string(),
  pricePositioning: z.string(),
  /** Everyday category a maps app would use ("Hair salon", "Italian restaurant"). */
  localCategory: z.string().nullable(),
  alternatives: z.array(z.object({ businessType: z.string(), kind: z.string(), why: z.string() })).default([]),
  /** Nearby categories the evidence rules out ("Medical clinic"). */
  ruledOut: z.array(z.string()).default([]),
  rationale: z.string(),
  source: FieldProvenanceSource,
  evidenceIds: z.array(z.string()).default([]),
  confidence,
});
export type BusinessClassification = z.infer<typeof ClassificationSchema>;

export const GeoPlaceSchema = z.object({
  label: z.string(),
  formattedAddress: z.string().nullable(),
  premise: z.string().nullable(),
  street: z.string().nullable(),
  neighborhood: z.string().nullable(),
  district: z.string().nullable(),
  city: z.string().nullable(),
  region: z.string().nullable(),
  country: z.string().nullable(),
  countryCode: z.string().nullable(),
  postalCode: z.string().nullable(),
  lat: z.number().nullable(),
  lng: z.number().nullable(),
  precision: z.string().nullable(),
  provider: z.string(),
  providerId: z.string().nullable(),
  confidence,
  evidenceIds: z.array(z.string()).default([]),
});

/** How an operator's intake hint related to the website's own location evidence. */
export const OPERATOR_HINT_OUTCOMES = ["agreed", "filled", "overrode", "conflict", "unresolved", "noted"] as const;
export type OperatorHintOutcome = (typeof OPERATOR_HINT_OUTCOMES)[number];

export const LOCATION_COUNTS = ["none", "one", "few", "many", "unknown"] as const;
export type LocationCount = (typeof LOCATION_COUNTS)[number];

/** Where customers are measured; distinct from where the business sits. */
export const MARKET_AREA_LEVELS = ["neighborhood", "district", "city", "region", "country", "global"] as const;
export const MarketAreaSchema = z.object({
  level: z.enum(MARKET_AREA_LEVELS),
  name: z.string(),
  countryCode: z.string().nullable(),
  /** operator: the intake answer; user: the Location editor; website / inferred: derived from the business's own footprint. */
  source: z.enum(["operator", "user", "website", "inferred"]),
  rationale: z.string().nullable().default(null),
});
export type MarketArea = z.infer<typeof MarketAreaSchema>;

export const LocationProfileSchema = z.object({
  /** The place customers visit, or the head office for businesses without one. */
  primary: GeoPlaceSchema.nullable(),
  primaryRole: z.enum(["storefront", "headquarters", "service_base", "unknown"]),
  branches: z.array(GeoPlaceSchema).default([]),
  /** Areas the business says it serves, for service-area and delivery businesses. */
  serviceAreas: z.array(z.object({ name: z.string(), level: z.string(), evidenceIds: z.array(z.string()).default([]) })).default([]),
  /** Nearby areas and landmarks the website itself mentions (used in local prompts). */
  nearbyAreas: z.array(z.string()).default([]),
  /** ISO 3166-1 alpha-2 codes of countries served. */
  countriesServed: z.array(z.string()).default([]),
  /**
   * The geography prompts and competitors are measured in: the operator's
   * market area (intake or the Location editor), else the business's own
   * footprint (a single storefront's neighbourhood, a one-city chain's city,
   * an online business's country). Business locations are evidence of where
   * it is; this says where its customers are compared. A four-branch Dubai
   * restaurant once had every Discovery prompt anchored to the branch whose
   * address the website listed first. Absent on versions built before
   * 2026-09-16; readers derive it with `marketAreaOf`.
   */
  marketArea: MarketAreaSchema.optional(),
  /**
   * How each country/city signal voted, for the "Why?" panel. `kind` is open
   * text; besides the website kinds (`structured_address`, `website_address`,
   * `coordinates`, `cctld`, `phone`, `currency`, …) it can be `operator_stated`
   * (the intake "Where are your customers?" answer), `website_area_name` (the
   * site's own name for an area the operator named differently) and
   * `search_console_country` (Google Search Console country share).
   */
  signals: z.array(z.object({ kind: z.string(), value: z.string(), weight: z.number(), evidenceIds: z.array(z.string()).default([]) })).default([]),
  needsConfirmation: z.boolean(),
  rationale: z.string(),
  source: FieldProvenanceSource,
  confidence,
  /**
   * What the operator said on the intake page and how it was applied. Absent on
   * versions built before 2026-09-14 and when no hint was given; readers treat
   * undefined as "no hint".
   */
  operatorHint: z
    .object({
      countryCodes: z.array(z.string()).default([]),
      worldwide: z.boolean(),
      /** describeMarketHint() of the hint. */
      label: z.string(),
      outcome: z.enum(OPERATOR_HINT_OUTCOMES),
      /** Plain-English line for the Location card. */
      message: z.string().nullable().default(null),
      /** What the website said, kept only when it conflicts with the hint. */
      websitePlace: GeoPlaceSchema.nullable().default(null),
    })
    .optional(),
  /** How many customer-facing locations the business has; feeds competitor tiers. Absent on older versions. */
  locationCount: z.enum(LOCATION_COUNTS).optional(),
});
export type LocationProfile = z.infer<typeof LocationProfileSchema>;

export const AudienceSegmentSchema = z.object({
  label: z.string(),
  description: z.string(),
  /** How the segment relates to the business's place. */
  geoRelation: z.string(),
  evidenceIds: z.array(z.string()).default([]),
  confidence,
});
export type AudienceSegment = z.infer<typeof AudienceSegmentSchema>;

export const BusinessProfileSchema = z.object({
  identity: z.object({
    brandName: evidenceBackedString,
    aliases: evidenceBackedStringArray,
    domains: z.array(z.string()),
    canonicalDomain: z.string().default(""),
    parentBrand: z.string().nullable().default(null),
    legalName: z.string().nullable().optional(),
    /** Every name the site uses for itself, with where it was seen. */
    nameCandidates: z.array(z.object({ name: z.string(), sources: z.array(z.string()), evidenceIds: z.array(z.string()).default([]) })).optional(),
  }),
  /** 1-2 factual sentences. Synthesized, never copied wholesale from meta. */
  description: evidenceBackedString,
  archetype: z.object({
    value: z.enum(BUSINESS_ARCHETYPES),
    source: FieldProvenanceSource,
    evidenceIds: z.array(z.string()).default([]),
    confidence,
    scores: z.record(z.string(), z.number()).default({}),
  }),
  industry: z.object({
    /** Display label, kept as `value` so existing readers keep working. */
    value: z.string(),
    /** Taxonomy id, e.g. "retail.apparel_sporting_goods". */
    taxonomyId: z.string().nullable().default(null),
    primary: z.string().default(""),
    secondary: z.string().nullable().default(null),
    source: FieldProvenanceSource,
    evidenceIds: z.array(z.string()).default([]),
    confidence: confidence.default(0),
  }),
  brandIdentity: z.array(IdentityTraitSchema).default([]),
  /** Typed offerings. `offerings.values` mirrors the names for legacy readers. */
  offerings: evidenceBackedStringArray.extend({
    items: z.array(OfferingSchema).default([]),
    /** Offerings grouped the way the site groups them ("Hair", "Nails"). */
    groups: z.array(z.object({ name: z.string(), items: z.array(z.string()) })).optional(),
  }),
  targetAudience: z.array(AudienceSchema).default([]),
  markets: z.array(MarketSchema).default([]),
  marketScope: z.object({
    value: z.enum(MARKET_SCOPES),
    source: FieldProvenanceSource,
    evidenceIds: z.array(z.string()).default([]),
    confidence: confidence.default(0),
  }),
  // --- Fields consumed by the existing landscape/prompt layers -------------
  customerJobs: evidenceBackedStringArray,
  personas: evidenceBackedStringArray,
  decisionConstraints: evidenceBackedStringArray,
  classification: ClassificationSchema.optional(),
  location: LocationProfileSchema.optional(),
  /** Google Search Console summary attached at crawl time when the operator connected it. Older versions lack it. */
  searchConsole: z.custom<SearchConsoleProfileSummary>().optional(),
  audienceSegments: z.array(AudienceSegmentSchema).optional(),
  positioning: z
    .object({ summary: citedString.nullable(), differentiators: z.array(z.string()).default([]), priceRange: z.string().nullable() })
    .optional(),
  contact: z
    .object({ phones: z.array(z.string()).default([]), emails: z.array(z.string()).default([]), socialProfiles: z.array(z.string()).default([]), bookingPlatforms: z.array(z.string()).default([]) })
    .optional(),
  geography: z.object({
    countries: z.array(z.string()).default([]),
    regions: z.array(z.string()).default([]),
    cities: z.array(z.string()).default([]),
    /** Neighbourhoods/districts that define a local business's market. */
    neighborhoods: z.array(z.string()).optional(),
    serviceAreaDescription: z.string().nullable().default(null),
    languages: z.array(z.string()).default([]),
    source: FieldProvenanceSource,
    evidenceIds: z.array(z.string()).default([]),
  }),
  regulatedDomain: z.object({
    isRegulated: z.boolean(),
    categories: z.array(z.enum(["healthcare", "finance", "legal"])).default([]),
    source: FieldProvenanceSource,
  }),
  /** Run-level quality summary, surfaced in the Why?/Evidence panel. */
  quality: z
    .object({
      overallConfidence: confidence.default(0),
      evidenceItemCount: z.number().int().min(0).default(0),
      pagesAnalyzed: z.number().int().min(0).default(0),
      synthesisMode: z.enum(["deterministic", "llm_grounded"]).default("deterministic"),
      warnings: z.array(z.string()).default([]),
      /** Provider:model pairs that produced this version, and their estimated cost. */
      models: z.array(z.string()).optional(),
      llmCostUsd: z.number().optional(),
      llmCalls: z.number().optional(),
      /** Schema generation of this profile; 2 = Business Understanding v2. */
      schemaVersion: z.number().optional(),
    })
    .default({
      overallConfidence: 0,
      evidenceItemCount: 0,
      pagesAnalyzed: 0,
      synthesisMode: "deterministic",
      warnings: [],
    }),
});

export type BusinessProfile = z.infer<typeof BusinessProfileSchema>;

/** Field paths the user may edit; used to protect edits across re-analysis. */
export const EDITABLE_FIELD_PATHS = [
  "identity.brandName",
  "identity.aliases",
  "identity.domains",
  "description",
  "industry",
  "archetype",
  "classification",
  "brandIdentity",
  "offerings",
  "targetAudience",
  "markets",
  "location",
  "marketScope",
] as const;
export type EditableFieldPath = (typeof EDITABLE_FIELD_PATHS)[number];

/** An empty, well-typed profile — the starting point for progressive filling. */
export function emptyProfile(canonicalDomain: string): BusinessProfile {
  const blankString = { value: "", source: "inferred_needs_review" as const, evidenceIds: [], confidence: 0 };
  const blankArray = { values: [], source: "inferred_needs_review" as const, evidenceIds: [], confidence: 0 };
  return {
    identity: {
      brandName: blankString,
      aliases: blankArray,
      domains: canonicalDomain ? [canonicalDomain] : [],
      canonicalDomain,
      parentBrand: null,
    },
    description: blankString,
    archetype: { value: "other", source: "inferred_needs_review", evidenceIds: [], confidence: 0, scores: {} },
    industry: { value: "", taxonomyId: null, primary: "", secondary: null, source: "inferred_needs_review", evidenceIds: [], confidence: 0 },
    brandIdentity: [],
    offerings: { ...blankArray, items: [] },
    targetAudience: [],
    markets: [],
    marketScope: { value: "unknown", source: "inferred_needs_review", evidenceIds: [], confidence: 0 },
    customerJobs: blankArray,
    personas: blankArray,
    decisionConstraints: blankArray,
    geography: { countries: [], regions: [], cities: [], serviceAreaDescription: null, languages: [], source: "inferred_needs_review", evidenceIds: [] },
    regulatedDomain: { isRegulated: false, categories: [], source: "inferred_needs_review" },
    quality: { overallConfidence: 0, evidenceItemCount: 0, pagesAnalyzed: 0, synthesisMode: "deterministic", warnings: [] },
  };
}
