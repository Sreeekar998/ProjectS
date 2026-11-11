// Industry classification against the closed Project Sun taxonomy.
//
// Two-stage: Schema.org types pin a category outright when present (they are
// the business's own machine-readable self-description); otherwise weighted
// keyword scoring over the evidence corpus decides, with the runner-up kept as
// the secondary category when it belongs to a different sector.

import { INDUSTRY_TAXONOMY, industryLabel, type IndustryCategory } from "./taxonomy";
import { computeConfidence } from "./confidence";
import { evidenceStrength, type EvidenceItem } from "@/lib/evidence/types";
import type { BusinessArchetype } from "./schema";

export interface IndustryScore {
  category: IndustryCategory;
  score: number;
  matchedKeywords: string[];
  evidenceIds: string[];
  schemaPinned: boolean;
}

export interface IndustryResolution {
  taxonomyId: string | null;
  label: string;
  primary: string;
  secondary: string | null;
  confidence: number;
  evidenceIds: string[];
  ranked: IndustryScore[];
}

/** Evidence that describes what the business *is* rather than page furniture. */
const SIGNAL_HINTS = new Set(["industry", "offering", "description", "identity", "archetype"]);

/**
 * Keywords must match on word boundaries. Substring matching looks harmless
 * until a three-letter term like "vin" (an automotive keyword) fires on
 * "moving", "having" and "Kevin", and a bookshop is classified as a car
 * dealership. Compiled once per keyword and cached.
 */
const KEYWORD_REGEX = new Map<string, RegExp>();

/** Below this, the classifier reports "unclassified" instead of guessing. */
const MIN_CONFIDENCE_TO_CLASSIFY = 25;

function keywordMatcher(keyword: string): RegExp {
  const cached = KEYWORD_REGEX.get(keyword);
  if (cached) return cached;
  const escaped = keyword.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  // \b does not anchor around "&" or "/" so those are handled as literals
  // with a whitespace-or-edge guard.
  const regex = new RegExp(`(^|[^\\p{L}\\p{N}])${escaped}($|[^\\p{L}\\p{N}])`, "iu");
  KEYWORD_REGEX.set(keyword, regex);
  return regex;
}

export function classifyIndustry(evidence: EvidenceItem[]): IndustryResolution {
  const scores = new Map<string, IndustryScore>();

  const bump = (category: IndustryCategory, amount: number, keyword: string, item: EvidenceItem, schemaPinned = false) => {
    const entry = scores.get(category.id) ?? { category, score: 0, matchedKeywords: [], evidenceIds: [], schemaPinned: false };
    entry.score += amount;
    entry.schemaPinned = entry.schemaPinned || schemaPinned;
    if (!entry.matchedKeywords.includes(keyword) && entry.matchedKeywords.length < 12) entry.matchedKeywords.push(keyword);
    if (!entry.evidenceIds.includes(item.id) && entry.evidenceIds.length < 8) entry.evidenceIds.push(item.id);
    scores.set(category.id, entry);
  };

  // Stage 1: schema types.
  for (const item of evidence) {
    const declared = item.text.match(/^Declared schema type:\s*(.+)$/)?.[1];
    const types = declared ? declared.split("/").map((t) => t.trim()) : [];
    if (types.length === 0) continue;
    for (const category of INDUSTRY_TAXONOMY) {
      if (!category.schemaTypes) continue;
      for (const schemaType of category.schemaTypes) {
        if (!types.some((t) => t.toLowerCase() === schemaType.toLowerCase())) continue;
        // A generic `Organization`/`Store` is weak; a `Restaurant` is decisive.
        const specificity = schemaType === "Store" || schemaType === "OnlineStore" ? 3 : 8;
        bump(category, specificity * evidenceStrength(item), `schema:${schemaType}`, item, specificity >= 8);
      }
    }
  }

  // Stage 2: weighted keyword evidence.
  for (const item of evidence) {
    if (item.fieldHint && !SIGNAL_HINTS.has(item.fieldHint)) continue;
    const haystack = ` ${item.text.toLowerCase()} `;
    const strength = evidenceStrength(item);
    for (const category of INDUSTRY_TAXONOMY) {
      let matched = 0;
      for (const keyword of category.keywords) {
        if (!keywordMatcher(keyword).test(haystack)) continue;
        matched++;
        // Multi-word phrases are far more discriminating than single words.
        const weight = keyword.includes(" ") ? 1.6 : 0.9;
        bump(category, weight * strength, keyword, item);
        if (matched >= 4) break;
      }
      if (category.negativeKeywords?.some((k) => keywordMatcher(k).test(haystack))) {
        const entry = scores.get(category.id);
        if (entry) entry.score -= 2.5;
      }
    }
  }

  const ranked = [...scores.values()].sort((a, b) => {
    if (a.schemaPinned !== b.schemaPinned) return a.schemaPinned ? -1 : 1;
    return b.score - a.score;
  });

  const top = ranked[0];
  if (!top || top.score <= 0) {
    return { taxonomyId: null, label: "", primary: "", secondary: null, confidence: 0, evidenceIds: [], ranked };
  }

  const byId = new Map(evidence.map((e) => [e.id, e]));
  const topItems = top.evidenceIds.map((id) => byId.get(id)).filter((i): i is EvidenceItem => Boolean(i));

  // Margin over the runner-up is the real confidence signal: a clear winner is
  // trustworthy, a photo-finish between Retail and Marketplace is not.
  const runnerUp = ranked[1];
  const margin = runnerUp ? (top.score - runnerUp.score) / Math.max(1, top.score) : 1;
  const evidenceConfidence = computeConfidence({ items: topItems, ceiling: top.schemaPinned ? 96 : 88 });
  const confidence = Math.round(evidenceConfidence * (0.55 + 0.45 * Math.min(1, Math.max(0, margin) * 2)));

  // A same-sector runner-up is a refinement, not a second industry; only a
  // genuinely different sector earns the secondary slot.
  const secondary =
    runnerUp && runnerUp.score > top.score * 0.35 && runnerUp.category.sector !== top.category.sector
      ? runnerUp.category.category
      : top.category.category;

  // A weak winner is worse than no winner: a confidently wrong sector poisons
  // every downstream topic and competitor. Below the floor we return no
  // classification and let the user pick, while still exposing the ranking.
  if (confidence < MIN_CONFIDENCE_TO_CLASSIFY) {
    return { taxonomyId: null, label: "", primary: "", secondary: null, confidence, evidenceIds: top.evidenceIds.slice(0, 6), ranked: ranked.slice(0, 6) };
  }

  return {
    taxonomyId: top.category.id,
    label: industryLabel(top.category.id),
    primary: top.category.sector,
    secondary,
    confidence,
    evidenceIds: top.evidenceIds.slice(0, 6),
    ranked: ranked.slice(0, 6),
  };
}

// --- Archetype -------------------------------------------------------------

const ARCHETYPE_SIGNALS: Array<{ archetype: BusinessArchetype; weight: number; test: RegExp }> = [
  { archetype: "ecommerce_dtc_retail", weight: 3, test: /Commerce affordance: add_to_cart/ },
  { archetype: "ecommerce_dtc_retail", weight: 1.4, test: /\b(free shipping|returns policy|size guide|in stock|out of stock|new arrivals)\b/i },
  { archetype: "b2b_saas_enterprise", weight: 3, test: /Commerce affordance: request_demo/ },
  { archetype: "b2b_saas_enterprise", weight: 1.6, test: /\b(per user per month|integrations|api documentation|sso|soc 2|enterprise plan|seats)\b/i },
  { archetype: "local_service", weight: 3, test: /Commerce affordance: request_quote/ },
  { archetype: "local_service", weight: 1.6, test: /\b(service area|licensed and insured|emergency service|same day|no call-out fee)\b/i },
  { archetype: "dealership", weight: 2.6, test: /\b(test drive|trade-in|certified pre-owned|used cars|vin|showroom)\b/i },
  { archetype: "restaurant_food_chain", weight: 2.6, test: /\b(menu|reservation|dine-in|takeaway|takeout|cuisine|order online)\b/i },
  // Deliberately light: a store locator is present on most retail and chain
  // sites. Multi-location only wins when actual location pages back it up
  // (see the locationPageCount bonus below), otherwise an ecommerce brand
  // with 14 shops would be classified as a chain rather than a retailer.
  { archetype: "multi_location_chain", weight: 0.6, test: /Commerce affordance: find_location/ },
  { archetype: "multi_location_chain", weight: 0.5, test: /\b(store locator|our locations|find a (store|branch|dealer)|nationwide)\b/i },
  // "appointment" and "treatment" used to be healthcare words here. Every salon,
  // spa and barber books appointments and sells treatments, so a Dubai hair
  // salon scored 27.6 healthcare against 2.2 local service from its homepage
  // alone, and was then asked "which clinic, hospital or doctor" prompts.
  // Only words that belong to medical practice count now.
  { archetype: "healthcare", weight: 2.8, test: /\b(patients?|physicians?|doctors?|diagnos[ie]s|telehealth|medical (centre|center|practice|clinic)|hospital|outpatient|dentist(ry)?|surgeon|gp practice)\b/i },
  { archetype: "healthcare", weight: 1.2, test: /\b(clinic|specialit(y|ies)|specialt(y|ies))\b/i },
  { archetype: "local_service", weight: 2.4, test: /\b(salon|stylists?|haircuts?|blow[- ]?dry|balayage|manicure|pedicure|nail (bar|art|studio)|lash (lift|extensions?)|brows?|barber(shop)?|waxing|facials?|day spa)\b/i },
  { archetype: "local_service", weight: 2.5, test: /^Booking platform: (fresha|booksy|vagaro|zenoti|phorest|mindbody|treatwell|square|calendly|acuity)/i },
  { archetype: "local_service", weight: 1.2, test: /Commerce affordance: book_appointment/ },
  // "policy", "premium", "portfolio" and "deposit" are NOT finance words in
  // isolation: every site on the web has a privacy policy, most SaaS pricing
  // pages sell a premium plan, agencies show a portfolio and hotels take a
  // deposit. Unqualified, they scored finance as the runner-up archetype for a
  // sportswear retailer and as the WINNER for a CRM vendor, which then applied
  // "fee transparency" as a trade-off criterion to software comparisons.
  // Each term is now anchored to its financial sense.
  { archetype: "finance", weight: 2.8, test: /\b(interest rate|annual percentage rate|apr\b|home loan|personal loan|mortgage|investment portfolio|insurance policy|policy premium|insurance premium|deposit account|savings account|current account|checking account|brokerage|underwriting|credit score)\b/i },
  // Kept in step with the platform.marketplace taxonomy keywords: a
  // marketplace INVITES THIRD PARTIES TO SELL. The bare words "marketplace"
  // and "vendors" appear on any B2B site with an app directory or partner
  // programme, and they were enough to classify a CRM vendor as a marketplace
  // — which then applied marketplace trade-off criteria ("seller trust",
  // "selection") to software comparison prompts.
  { archetype: "marketplace", weight: 3, test: /\b(become a seller|sell on|start selling|seller central|verified sellers|list your|listing fee|seller fees|browse listings|buy and sell)\b/i },
  { archetype: "travel_hospitality", weight: 2.6, test: /\b(book a room|check-in|check-out|itinerary|amenities|nights|suite|resort)\b/i },
  { archetype: "education", weight: 2.6, test: /\b(admissions|curriculum|enroll|tuition|campus|syllabus|degree|course)\b/i },
];

/** Industry categories that imply an archetype when signals are thin. */
const INDUSTRY_TO_ARCHETYPE: Record<string, BusinessArchetype> = {
  "software.b2b_saas": "b2b_saas_enterprise",
  "software.developer_infrastructure": "b2b_saas_enterprise",
  "technology.it_services": "b2b_saas_enterprise",
  "automotive.dealership": "dealership",
  "hospitality.restaurants": "restaurant_food_chain",
  "hospitality.hotels": "travel_hospitality",
  "travel.agency_ota": "travel_hospitality",
  "healthcare.hospital_clinical": "healthcare",
  "healthcare.dental_specialty": "healthcare",
  "healthcare.wellness_fitness": "local_service",
  "finance.banking": "finance",
  "finance.brokerage_investing": "finance",
  "finance.lending": "finance",
  "finance.insurance": "finance",
  "finance.payments_fintech": "finance",
  "education.schools_universities": "education",
  "education.training_edtech": "education",
  "platform.marketplace": "marketplace",
  "services.local_trades": "local_service",
  "services.personal_care": "local_service",
  "retail.apparel_sporting_goods": "ecommerce_dtc_retail",
  "retail.beauty_personal_care": "ecommerce_dtc_retail",
  "retail.electronics": "ecommerce_dtc_retail",
  "retail.home_furniture": "ecommerce_dtc_retail",
  "retail.general_merchandise": "ecommerce_dtc_retail",
  "retail.jewellery_luxury": "ecommerce_dtc_retail",
  "retail.grocery_food": "ecommerce_dtc_retail",
};

export interface ArchetypeResolution {
  value: BusinessArchetype;
  confidence: number;
  scores: Record<string, number>;
  evidenceIds: string[];
}

export function classifyArchetype(
  evidence: EvidenceItem[],
  industry: IndustryResolution,
  locationPageCount: number,
): ArchetypeResolution {
  const scores: Record<string, number> = {};
  const evidenceIds: Record<string, string[]> = {};

  for (const item of evidence) {
    const strength = evidenceStrength(item);
    for (const signal of ARCHETYPE_SIGNALS) {
      if (!signal.test.test(item.text)) continue;
      scores[signal.archetype] = (scores[signal.archetype] ?? 0) + signal.weight * strength;
      const list = evidenceIds[signal.archetype] ?? [];
      if (list.length < 6 && !list.includes(item.id)) list.push(item.id);
      evidenceIds[signal.archetype] = list;
    }
  }

  if (industry.taxonomyId) {
    const implied = INDUSTRY_TO_ARCHETYPE[industry.taxonomyId];
    if (implied) scores[implied] = (scores[implied] ?? 0) + 2.2;
  }
  // Several distinct location pages is the defining multi-location signal —
  // a locator link alone is not.
  if (locationPageCount >= 3) scores.multi_location_chain = (scores.multi_location_chain ?? 0) + locationPageCount * 1.2;

  const ranked = Object.entries(scores).sort((a, b) => b[1] - a[1]);
  const top = ranked[0];
  if (!top || top[1] <= 0) return { value: "other", confidence: 0, scores, evidenceIds: [] };

  const total = ranked.reduce((sum, [, v]) => sum + v, 0);
  const share = top[1] / Math.max(1, total);
  const runnerUp = ranked[1]?.[1] ?? 0;
  const margin = (top[1] - runnerUp) / Math.max(1, top[1]);
  const confidence = Math.min(95, Math.round((share * 0.5 + margin * 0.5) * 100));

  return {
    value: top[0] as BusinessArchetype,
    confidence,
    scores: Object.fromEntries(ranked.map(([k, v]) => [k, Number(v.toFixed(2))])),
    evidenceIds: evidenceIds[top[0]] ?? [],
  };
}
