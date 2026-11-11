import type { BusinessProfile } from "@/lib/profile/schema";
import type { Topic } from "./repository";
import type { CompetitiveSearchProfile } from "./competitor-types";
import { PLACE_BOUND_KINDS, type BusinessKind } from "@/lib/understanding/kinds";
import { marketCountries } from "@/lib/understanding/market-countries";
import { countryName } from "@/lib/geo/countries";
import { homeCountryBranches } from "./competitor-tiers";

function unique(values: Array<string | null | undefined>): string[] {
  return [...new Set(values.map((value) => value?.trim()).filter((value): value is string => Boolean(value)))];
}

function inferBusinessModel(profile: BusinessProfile): CompetitiveSearchProfile["businessModel"] {
  const customerType = profile.classification?.customerType;
  if (customerType === "b2b" || customerType === "b2g") return "B2B";
  if (customerType === "b2c") return "B2C";
  if (customerType === "b2b2c" || customerType === "mixed") return "mixed";
  const audience = [...profile.targetAudience.map((item) => item.value), ...profile.personas.values].join(" ").toLowerCase();
  const b2b = /business|enterprise|company|team|professional|organization|operator|manager/.test(audience) || profile.archetype.value === "b2b_saas_enterprise";
  const b2c = /consumer|shopper|patient|student|traveler|guest|family|homeowner|driver|diner/.test(audience) || ["ecommerce_dtc_retail", "restaurant_food_chain", "travel_hospitality"].includes(profile.archetype.value);
  if (b2b && b2c) return "mixed";
  if (b2b) return "B2B";
  if (b2c) return "B2C";
  return "unknown";
}

export function neutralizeTopicName(name: string, profile: BusinessProfile): string {
  const brandTerms = [profile.identity.brandName.value, ...profile.identity.aliases.values]
    .filter(Boolean)
    .sort((a, b) => b.length - a.length);
  let concept = name;
  for (const term of brandTerms) concept = concept.replace(new RegExp(term.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"), "gi"), "");
  concept = concept.replace(/[®™]/g, "").replace(/\s+/g, " ").replace(/^[-–—: ]+|[-–—: ]+$/g, "").trim();
  if (concept.length >= 4) return concept;
  return profile.offerings.values[0] ?? profile.industry.secondary ?? profile.industry.primary ?? profile.industry.value ?? "buyer need";
}

export function buildCompetitiveSearchProfile(profile: BusinessProfile, topics: Topic[], locale = "en"): CompetitiveSearchProfile {
  const confirmedTopics = topics.filter((topic) => topic.status === "confirmed" || topic.status === "candidate");
  const offerings = unique([...profile.offerings.values, ...profile.offerings.items.map((item) => item.name)]);
  const jobs = unique(profile.customerJobs.values);
  const audiences = unique(profile.targetAudience.map((item) => item.value));
  const personas = unique(profile.personas.values);
  const criteria = unique(profile.decisionConstraints.values);
  const evidenceIds = unique([
    ...profile.identity.brandName.evidenceIds,
    ...profile.description.evidenceIds,
    ...profile.industry.evidenceIds,
    ...profile.offerings.evidenceIds,
    ...profile.customerJobs.evidenceIds,
    ...profile.geography.evidenceIds,
  ]);

  const classification = profile.classification;
  const location = profile.location;
  const primary = location?.primary ?? null;
  // The market country, not the head office: a Dubai-HQ software company whose
  // customers are in Saudi Arabia searched for UAE rivals. For place-bound
  // businesses this is still the storefront's country.
  const market = marketCountries(profile);
  // An online business's office is not a market: for a global one the office
  // city, region and country are left out of the competitor geography, so
  // rivals are searched and judged worldwide rather than around the office.
  const placeBound = classification ? PLACE_BOUND_KINDS.has(classification.kind as BusinessKind) && classification.physicalPresence !== "online_only" : true;
  const officeIsMarket = placeBound || !market.worldwide;

  return {
    targetBrand: profile.identity.brandName.value,
    aliases: unique(profile.identity.aliases.values),
    canonicalDomain: profile.identity.canonicalDomain || profile.identity.domains[0] || "",
    parentBrand: profile.identity.parentBrand,
    industry: classification?.industry || profile.industry.primary || profile.industry.value,
    subIndustry: classification ? classification.localCategory ?? classification.businessType : profile.industry.secondary,
    businessArchetype: profile.archetype.value,
    businessModel: inferBusinessModel(profile),
    offerings,
    jobsToBeDone: jobs,
    useCases: unique([...jobs, ...offerings]),
    targetAudiences: audiences,
    personas,
    importantTopics: confirmedTopics.map((topic) => ({
      id: topic.id,
      name: topic.name,
      discoveryConcept: topic.discoveryConcept || neutralizeTopicName(topic.name, profile),
    })),
    evaluationCriteria: criteria,
    geography: {
      scope: profile.marketScope.value,
      cities: unique([officeIsMarket ? primary?.city : null, ...profile.geography.cities]),
      regions: unique([officeIsMarket ? primary?.region : null, ...profile.geography.regions]),
      countries: unique([...market.all.map((code) => countryName(code) ?? null), officeIsMarket ? primary?.country : null, ...profile.geography.countries]),
      locale,
      neighborhoods: unique([primary?.neighborhood, ...(profile.geography.neighborhoods ?? [])]),
      nearbyAreas: unique(profile.location?.nearbyAreas ?? []),
      // No country for a worldwide online business: the web-search brief would
      // otherwise be localised to the office ("in the United States", San Francisco).
      countryCode: market.primary ?? (officeIsMarket ? primary?.countryCode ?? null : null),
      placeLabel: primary?.label ?? null,
      formattedAddress: primary?.formattedAddress ?? null,
      lat: primary?.lat ?? null,
      lng: primary?.lng ?? null,
      primaryRole: location?.primaryRole,
      // Home-country branches only; see homeCountryBranches.
      branchCities: unique(homeCountryBranches(location?.branches ?? [], primary?.countryCode ?? market.primary ?? null).map((branch) => branch.city)),
      serviceAreaCities: unique((location?.serviceAreas ?? []).filter((area) => area.level === "city").map((area) => area.name)),
    },
    understanding: classification
      ? {
          kind: classification.kind,
          businessType: classification.businessType,
          localCategory: classification.localCategory,
          path: classification.path,
          description: profile.description.value,
          pricePositioning: classification.pricePositioning,
          physicalPresence: classification.physicalPresence,
          placeBound: PLACE_BOUND_KINDS.has(classification.kind as BusinessKind) && classification.physicalPresence !== "online_only",
          offeringGroups: profile.offerings.groups ?? [],
          audienceSegments: (profile.audienceSegments ?? []).map((segment) => segment.label),
        }
      : undefined,
    evidenceIds,
  };
}
