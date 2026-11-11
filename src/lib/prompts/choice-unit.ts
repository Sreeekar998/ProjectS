// What a customer of a business chooses between: the unit a Discovery answer
// names ("hair salons", "plumbers", "RFP software vendors").

import { choiceNounForKind, PLACE_BOUND_KINDS, type BusinessKind } from "@/lib/understanding/kinds";
import type { BusinessProfile } from "@/lib/profile/schema";

/**
 * What a customer of this kind of business actually chooses between.
 *
 * A retailer's customer picks a product; a restaurant's customer picks a PLACE.
 * Treating both alike produced Discovery prompts for a restaurant chain that
 * asked for a dish ("Need tortilla chips paired with chunky tomato salsa") —
 * a question whose honest answer is a recipe, not a list of restaurants, and
 * which therefore cannot measure whether the assistant recommends the brand.
 */
export function choiceUnitFor(archetype: string): { unit: string; ask: string } {
  switch (archetype) {
    case "restaurant_food_chain":
      return { unit: "restaurants or places to eat", ask: "where to eat or order from" };
    case "travel_hospitality":
      return { unit: "hotels or places to stay", ask: "which hotel or place to book" };
    case "healthcare":
      return { unit: "clinics, hospitals or doctors", ask: "which clinic, hospital or doctor to go to" };
    case "local_service":
      return { unit: "local businesses or service providers", ask: "which provider to hire" };
    case "dealership":
      return { unit: "dealerships", ask: "which dealership to buy from" };
    case "finance":
      return { unit: "banks, lenders or financial providers", ask: "which provider to go with" };
    case "education":
      return { unit: "schools, courses or programmes", ask: "which school or programme to choose" };
    case "multi_location_chain":
      return { unit: "stores or chains", ask: "which store or chain to go to" };
    case "marketplace":
      return { unit: "platforms or marketplaces", ask: "which platform to use" };
    case "b2b_saas_enterprise":
      return { unit: "software tools or vendors", ask: "which tool or vendor to pick" };
    default:
      return { unit: "products or brands", ask: "which product or brand to buy" };
  }
}

function pluralize(noun: string): string {
  const words = noun.trim().split(/\s+/);
  const last = words.pop() ?? "";
  if (/s$/i.test(last)) return [...words, last].join(" ");
  const plural = /(ch|sh|x|z)$/i.test(last) ? `${last}es` : /[^aeiou]y$/i.test(last) ? `${last.slice(0, -1)}ies` : `${last}s`;
  return [...words, plural].join(" ");
}

/**
 * The choice unit from the business's own classification, so a salon's
 * customer chooses between salons. The archetype table above stays for
 * profiles built before classification existed; keyed on a closed archetype it
 * turned a salon mis-typed as healthcare into "which clinic, hospital or
 * doctor to go to" on every Discovery prompt.
 */
export function choiceUnitForProfile(profile: BusinessProfile): { unit: string; ask: string } {
  const classification = profile.classification;
  if (!classification) return choiceUnitFor(profile.archetype.value);
  const kind = classification.kind as BusinessKind;
  const category = (classification.localCategory ?? classification.businessType).toLowerCase().replace(/^(a|an|the)\s+/, "");
  const noun = choiceNounForKind(kind);
  const unit = `${pluralize(category)} (or similar ${noun.plural})`;
  const singular = category;
  switch (kind) {
    case "restaurant_food_beverage":
      return { unit, ask: "where to eat, drink or order from" };
    case "hospitality_lodging":
      return { unit, ask: "where to stay" };
    case "local_service_home_trades":
    case "professional_services":
    case "legal_services":
    case "b2b_services_agency":
      return { unit, ask: `which ${singular} to hire` };
    case "b2b_saas_software":
      return { unit, ask: "which tool or vendor to pick" };
    case "ecommerce_dtc_retail":
    case "consumer_brand_manufacturer":
      return { unit, ask: "which brand or shop to buy from" };
    case "marketplace_platform":
      return { unit, ask: "which platform to use" };
    case "education_training":
      return { unit, ask: "which course, school or programme to choose" };
    case "finance_insurance":
      return { unit, ask: "which provider to go with" };
    default:
      return PLACE_BOUND_KINDS.has(kind) ? { unit, ask: `which ${singular} to go to or book` } : { unit, ask: `which ${singular} to choose` };
  }
}

