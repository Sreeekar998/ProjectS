// Business kinds: the small, closed vocabulary downstream code switches on.
//
// Industry, sub-industry and business type are open text inferred from the
// website ("Beauty & Personal Care › Hair & Beauty Salons › Luxury hair and
// beauty salon"). Code still needs a handful of stable families to decide
// things like "does geography dominate competitor search?" or "what does a
// Discovery prompt ask for?". The old 12-value archetype list had no family
// for salons, spas, gyms or barbers, so the nearest bucket — healthcare —
// won, and every prompt asked for a doctor. `personal_care_wellness` exists
// precisely to keep that boundary: healthcare_medical is licensed clinical
// care only.
//
// Client-safe.

import type { BusinessArchetype } from "@/lib/profile/schema";

export const BUSINESS_KINDS = [
  "personal_care_wellness",
  "healthcare_medical",
  "restaurant_food_beverage",
  "local_retail_store",
  "local_service_home_trades",
  "professional_services",
  "hospitality_lodging",
  "travel_tourism",
  "education_training",
  "fitness_recreation",
  "real_estate_property",
  "automotive",
  "finance_insurance",
  "legal_services",
  "ecommerce_dtc_retail",
  "consumer_brand_manufacturer",
  "b2b_saas_software",
  "b2b_services_agency",
  "industrial_manufacturing_b2b",
  "marketplace_platform",
  "media_publishing",
  "nonprofit_public_sector",
  "other",
] as const;
export type BusinessKind = (typeof BUSINESS_KINDS)[number];

export const BUSINESS_KIND_LABELS: Record<BusinessKind, string> = {
  personal_care_wellness: "Personal care & wellness (salons, spas, barbers)",
  healthcare_medical: "Healthcare & medical (licensed clinical care)",
  restaurant_food_beverage: "Restaurant, café or food & beverage",
  local_retail_store: "Local shop or retail store",
  local_service_home_trades: "Local service or home trades",
  professional_services: "Professional services (accounting, consulting, design…)",
  hospitality_lodging: "Hotel or accommodation",
  travel_tourism: "Travel & tourism",
  education_training: "Education & training",
  fitness_recreation: "Fitness, sport & recreation",
  real_estate_property: "Real estate & property",
  automotive: "Automotive",
  finance_insurance: "Finance & insurance",
  legal_services: "Legal services",
  ecommerce_dtc_retail: "Online store / direct-to-consumer brand",
  consumer_brand_manufacturer: "Consumer brand (sold through many channels)",
  b2b_saas_software: "Software / SaaS",
  b2b_services_agency: "B2B services or agency",
  industrial_manufacturing_b2b: "Industrial, manufacturing or wholesale",
  marketplace_platform: "Marketplace or platform",
  media_publishing: "Media & publishing",
  nonprofit_public_sector: "Nonprofit or public sector",
  other: "Other",
};

export const BUSINESS_MODELS = ["services_in_person", "services_remote", "retail_physical", "retail_online", "saas_subscription", "marketplace", "manufacturing_wholesale", "media_advertising", "nonprofit", "mixed", "other"] as const;
export type BusinessModel = (typeof BUSINESS_MODELS)[number];

export const CUSTOMER_TYPES = ["b2c", "b2b", "b2b2c", "b2g", "mixed"] as const;
export type CustomerType = (typeof CUSTOMER_TYPES)[number];

export const PHYSICAL_PRESENCE = ["single_location", "multi_location", "service_area", "online_only", "unknown"] as const;
export type PhysicalPresence = (typeof PHYSICAL_PRESENCE)[number];

export const PRICE_POSITIONING = ["budget", "mid_market", "premium", "luxury", "unknown"] as const;
export type PricePositioning = (typeof PRICE_POSITIONING)[number];

/** Kinds whose customers choose by place: geography drives competitors and prompts. */
export const PLACE_BOUND_KINDS = new Set<BusinessKind>([
  "personal_care_wellness",
  "healthcare_medical",
  "restaurant_food_beverage",
  "local_retail_store",
  "local_service_home_trades",
  "hospitality_lodging",
  "fitness_recreation",
  "real_estate_property",
  "automotive",
  "education_training",
  "legal_services",
  "professional_services",
]);

/** The legacy archetype that downstream policy tables still key on. */
export function archetypeForKind(kind: BusinessKind, presence: PhysicalPresence): BusinessArchetype {
  switch (kind) {
    case "personal_care_wellness":
    case "local_service_home_trades":
    case "fitness_recreation":
    case "professional_services":
    case "legal_services":
    case "real_estate_property":
      return presence === "multi_location" ? "multi_location_chain" : "local_service";
    case "local_retail_store":
      return presence === "multi_location" ? "multi_location_chain" : presence === "online_only" ? "ecommerce_dtc_retail" : "local_service";
    case "healthcare_medical":
      return "healthcare";
    case "restaurant_food_beverage":
      return "restaurant_food_chain";
    case "hospitality_lodging":
    case "travel_tourism":
      return "travel_hospitality";
    case "education_training":
      return "education";
    case "automotive":
      return "dealership";
    case "finance_insurance":
      return "finance";
    case "ecommerce_dtc_retail":
    case "consumer_brand_manufacturer":
      return "ecommerce_dtc_retail";
    case "b2b_saas_software":
    case "b2b_services_agency":
    case "industrial_manufacturing_b2b":
      return "b2b_saas_enterprise";
    case "marketplace_platform":
      return "marketplace";
    default:
      return "other";
  }
}

/** What an unbranded shopper is choosing between, in plain words, per kind. */
export function choiceNounForKind(kind: BusinessKind): { plural: string; singular: string } {
  switch (kind) {
    case "personal_care_wellness":
      return { plural: "salons, spas or studios", singular: "salon or studio" };
    case "healthcare_medical":
      return { plural: "clinics or doctors", singular: "clinic or doctor" };
    case "restaurant_food_beverage":
      return { plural: "restaurants or cafés", singular: "restaurant or café" };
    case "local_retail_store":
      return { plural: "shops", singular: "shop" };
    case "local_service_home_trades":
      return { plural: "local companies", singular: "company" };
    case "professional_services":
    case "legal_services":
      return { plural: "firms", singular: "firm" };
    case "hospitality_lodging":
      return { plural: "hotels or places to stay", singular: "hotel" };
    case "travel_tourism":
      return { plural: "tour operators or travel companies", singular: "operator" };
    case "education_training":
      return { plural: "schools, courses or programmes", singular: "course or school" };
    case "fitness_recreation":
      return { plural: "gyms, studios or clubs", singular: "gym or studio" };
    case "real_estate_property":
      return { plural: "agencies or developers", singular: "agency" };
    case "automotive":
      return { plural: "dealers or garages", singular: "dealer or garage" };
    case "finance_insurance":
      return { plural: "banks, lenders or insurers", singular: "provider" };
    case "b2b_saas_software":
      return { plural: "software tools", singular: "tool" };
    case "b2b_services_agency":
      return { plural: "agencies or service providers", singular: "provider" };
    case "industrial_manufacturing_b2b":
      return { plural: "suppliers or manufacturers", singular: "supplier" };
    case "marketplace_platform":
      return { plural: "platforms or apps", singular: "platform" };
    case "media_publishing":
      return { plural: "publications or channels", singular: "publication" };
    case "ecommerce_dtc_retail":
    case "consumer_brand_manufacturer":
      return { plural: "brands", singular: "brand" };
    default:
      return { plural: "options", singular: "option" };
  }
}
