// Profile fixtures for competitor-tier tests: a classification and a
// first-class location on top of `makeProfile`, so a test states only what
// decides the plan (kind, presence, scope, role, places).

import type { BusinessProfile, LocationProfile, MarketScope } from "@/lib/profile/schema";
import type { CandidateBusinessProfile, CompetitorCandidate } from "@/lib/landscape/competitor-types";
import { makeProfile } from "./profile-fixtures";

type GeoPlace = NonNullable<LocationProfile["primary"]>;

export function geoPlace(fields: Partial<GeoPlace>): GeoPlace {
  return {
    label: [fields.neighborhood, fields.city, fields.country].filter(Boolean).join(", "),
    formattedAddress: null,
    premise: null,
    street: null,
    neighborhood: null,
    district: null,
    city: null,
    region: null,
    country: null,
    countryCode: null,
    postalCode: null,
    lat: null,
    lng: null,
    precision: null,
    provider: "website",
    providerId: null,
    confidence: 80,
    evidenceIds: [],
    ...fields,
  };
}

export interface TierBusinessInput {
  brand: string;
  domain?: string;
  kind: string;
  category?: string;
  physicalPresence: string;
  scope: MarketScope;
  primaryRole: LocationProfile["primaryRole"];
  primary: Partial<GeoPlace> | null;
  branches?: Array<Partial<GeoPlace>>;
  nearbyAreas?: string[];
  countriesServed?: string[];
  serviceAreas?: Array<{ name: string; level: string }>;
  socialProfiles?: string[];
  locationCount?: LocationProfile["locationCount"];
  customerType?: string;
}

export function tierBusiness(input: TierBusinessInput): BusinessProfile {
  const category = input.category ?? "Hair salon";
  const profile = makeProfile({ brandName: input.brand, archetype: "local_service", industry: category, offerings: [category], domain: input.domain });
  profile.classification = {
    industry: category,
    subIndustry: null,
    businessType: category,
    path: [category],
    kind: input.kind,
    businessModel: "services_in_person",
    customerType: input.customerType ?? "b2c",
    physicalPresence: input.physicalPresence,
    pricePositioning: "premium",
    localCategory: category,
    alternatives: [],
    ruledOut: [],
    rationale: "",
    source: "evidence",
    evidenceIds: [],
    confidence: 90,
  };
  const primary = input.primary ? geoPlace(input.primary) : null;
  profile.location = {
    primary,
    primaryRole: input.primaryRole,
    branches: (input.branches ?? []).map(geoPlace),
    serviceAreas: (input.serviceAreas ?? []).map((area) => ({ ...area, evidenceIds: [] })),
    nearbyAreas: input.nearbyAreas ?? [],
    countriesServed: input.countriesServed ?? (primary?.countryCode ? [primary.countryCode] : []),
    signals: [],
    needsConfirmation: false,
    rationale: "",
    source: "evidence",
    confidence: 90,
    ...(input.locationCount ? { locationCount: input.locationCount } : {}),
  };
  profile.marketScope = { value: input.scope, source: "evidence", evidenceIds: [], confidence: 90 };
  profile.contact = { phones: [], emails: [], socialProfiles: input.socialProfiles ?? [], bookingPlatforms: [] };
  return profile;
}

export function rival(name: string, extra: Partial<CompetitorCandidate> = {}): CompetitorCandidate {
  return {
    canonicalName: name,
    likelyDomain: null,
    proposedType: "direct",
    entityType: "company",
    reason: "Same kind of business.",
    matchedDimensions: ["same category"],
    confidence: 60,
    evidence: [{ source: "web_search", reason: "Search result", evidenceIds: [], discoveredAt: 1 }],
    aliases: [],
    ...extra,
  };
}

export function siteProfile(fields: Partial<CandidateBusinessProfile> = {}): CandidateBusinessProfile {
  return {
    displayName: "Rival",
    canonicalDomain: "rival.example",
    finalUrl: "https://rival.example/",
    title: null,
    description: null,
    offerings: [],
    audienceSignals: [],
    jobSignals: [],
    useCaseSignals: [],
    categorySignals: [],
    geographySignals: [],
    placeMentions: [],
    structuredLocalities: [],
    addressPlaceMentions: [],
    structuredCountries: [],
    localityCount: 0,
    hasLocationsPage: false,
    contentTokens: [],
    pagesFetched: ["/"],
    verificationStatus: "verified",
    verificationSummary: "Fixture.",
    ...fields,
  };
}
