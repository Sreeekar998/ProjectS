import type { BusinessArchetype } from "@/lib/profile/schema";

// Used only to top up the candidate pool when on-site evidence yields fewer
// than 4 distinct topic clusters — never to replace evidence-backed topics,
// only to ensure the confirmed set can still reach the required 4-6.
export const ARCHETYPE_TOPIC_TEMPLATES: Record<BusinessArchetype, string[]> = {
  b2b_saas_enterprise: ["Problem awareness & category fit", "Feature & platform evaluation", "Pricing & plans", "Integrations & implementation", "Vendor trust & security"],
  ecommerce_dtc_retail: ["Product discovery", "Sizing, fit & specifications", "Pricing & availability", "Shipping, returns & policies", "Comparison shopping"],
  local_service: ["Service discovery & category fit", "Pricing & estimates", "Availability & scheduling", "Trust, reviews & credentials"],
  dealership: ["Vehicle/model discovery", "Pricing & financing", "Test drive & purchase process", "Trade-in & service"],
  restaurant_food_chain: ["Cuisine & menu discovery", "Dietary needs & occasions", "Delivery & ordering", "Location & hours"],
  multi_location_chain: ["Category discovery", "Nearest location & availability", "Pricing across locations", "Brand-wide reputation"],
  healthcare: ["Provider/category discovery", "Eligibility & insurance", "Appointment & access", "Trust & credentials"],
  finance: ["Product/category discovery", "Eligibility & criteria", "Rates & fees", "Trust & regulatory standing"],
  marketplace: ["Category discovery", "Seller/listing trust", "Pricing & availability", "Booking or purchase process"],
  travel_hospitality: ["Destination/category discovery", "Availability & booking", "Pricing & packages", "Amenities & experience"],
  education: ["Program discovery", "Admissions & format", "Outcomes & accreditation", "Cost & financial aid"],
  other: ["Category discovery", "Pricing & value", "Trust & credibility", "Purchase or contact process"],
};
