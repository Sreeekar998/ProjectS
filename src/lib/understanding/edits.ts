// Operator corrections to the understanding fields.
//
// The Understand page is a confirmation step, not a form: the operator changes
// the one thing we got wrong (the business type, or where it is) and the
// dependent mirrors follow — markets, geography, scope, archetype, regulated
// handling — so Landscape and Prompts never read a half-edited profile.

import type { BusinessProfile, LocationProfile, Market, MarketScope, MarketArea } from "@/lib/profile/schema";
import { decideMarketArea, samePlaceName } from "./market-area";

/** A place as stored on a profile version (its `precision` is open text). */
type StoredPlace = NonNullable<LocationProfile["primary"]>;
import { placeLabel, precisionOf, type GeoPlace } from "@/lib/geo/types";
import { countryCodeFrom, countryName } from "@/lib/geo/countries";
import { archetypeForKind, BUSINESS_KINDS, PHYSICAL_PRESENCE, PLACE_BOUND_KINDS, type BusinessKind, type PhysicalPresence } from "./kinds";

export interface ClassificationEdit {
  businessType: string;
  industry?: string;
  subIndustry?: string | null;
  kind?: string;
  physicalPresence?: string;
}

export function applyClassificationEdit(base: BusinessProfile, edit: ClassificationEdit): BusinessProfile {
  const next = structuredClone(base);
  const previous = next.classification;
  const kind = ((BUSINESS_KINDS as readonly string[]).includes(edit.kind ?? "") ? edit.kind : previous?.kind ?? "other") as BusinessKind;
  const presence = ((PHYSICAL_PRESENCE as readonly string[]).includes(edit.physicalPresence ?? "")
    ? edit.physicalPresence
    : previous?.physicalPresence ?? "unknown") as PhysicalPresence;
  const industry = edit.industry?.trim() || previous?.industry || edit.businessType.trim();
  const subIndustry = edit.subIndustry === undefined ? previous?.subIndustry ?? null : edit.subIndustry?.trim() || null;
  const businessType = edit.businessType.trim();
  const path = [industry, subIndustry, businessType].filter((p, i, all): p is string => Boolean(p) && all.findIndex((q) => q?.toLowerCase() === p?.toLowerCase()) === i);
  next.classification = {
    industry,
    subIndustry,
    businessType,
    path,
    kind,
    businessModel: previous?.businessModel ?? "other",
    customerType: previous?.customerType ?? "mixed",
    physicalPresence: presence,
    pricePositioning: previous?.pricePositioning ?? "unknown",
    localCategory: PLACE_BOUND_KINDS.has(kind) && presence !== "online_only" ? (previous?.localCategory && previous.businessType === businessType ? previous.localCategory : businessType) : null,
    alternatives: [],
    // Drop "ruled out" entries that name what the operator just chose.
    ruledOut: (previous?.ruledOut ?? []).filter((entry) => {
      const a = entry.toLowerCase();
      const b = businessType.toLowerCase();
      return !(a.includes(b) || b.includes(a.replace(/^(standalone|a|an)\s+/, "")));
    }),
    rationale: "Set by the operator.",
    source: "user",
    evidenceIds: [],
    confidence: 100,
  };
  next.industry = { ...next.industry, value: path.join(" › "), primary: industry, secondary: subIndustry ?? businessType, source: "user", evidenceIds: [], confidence: 100 };
  next.archetype = { ...next.archetype, value: archetypeForKind(kind, presence), source: "user", evidenceIds: [], confidence: 100 };
  const regulated = new Set<"healthcare" | "finance" | "legal">();
  if (kind === "healthcare_medical") regulated.add("healthcare");
  if (kind === "finance_insurance") regulated.add("finance");
  if (kind === "legal_services") regulated.add("legal");
  next.regulatedDomain = { isRegulated: regulated.size > 0, categories: [...regulated], source: "user" };
  return next;
}

export interface LocationEdit {
  /** The confirmed place. Missing levels stay empty; nothing is invented. */
  primary: { [K in Exclude<keyof GeoPlace, "evidenceIds" | "confidence" | "precision" | "label">]?: GeoPlace[K] extends number | null ? number | null : string | null };
  marketScope?: MarketScope;
  nearbyAreas?: string[];
  /** Countries served for online and multi-country businesses (names or ISO codes). */
  countriesServed?: string[];
  /** Where customers are measured: the whole city, or one location's area. Null or absent keeps or derives it. */
  marketArea?: { level: MarketArea["level"]; name: string } | null;
}

export function applyLocationEdit(base: BusinessProfile, edit: LocationEdit): BusinessProfile {
  const next = structuredClone(base);
  const clean = (v: string | null | undefined) => (typeof v === "string" && v.trim() ? v.trim().slice(0, 120) : null);
  const countryCode = countryCodeFrom(clean(edit.primary.countryCode)) ?? countryCodeFrom(clean(edit.primary.country));
  const place: GeoPlace = {
    label: "",
    formattedAddress: clean(edit.primary.formattedAddress),
    premise: clean(edit.primary.premise),
    street: clean(edit.primary.street),
    neighborhood: clean(edit.primary.neighborhood),
    district: clean(edit.primary.district),
    city: clean(edit.primary.city),
    region: clean(edit.primary.region),
    country: countryName(countryCode) ?? clean(edit.primary.country),
    countryCode,
    postalCode: clean(edit.primary.postalCode),
    lat: typeof edit.primary.lat === "number" && Number.isFinite(edit.primary.lat) ? edit.primary.lat : null,
    lng: typeof edit.primary.lng === "number" && Number.isFinite(edit.primary.lng) ? edit.primary.lng : null,
    precision: null,
    provider: edit.primary.provider === "google" || edit.primary.provider === "photon" || edit.primary.provider === "nominatim" ? (edit.primary.provider as GeoPlace["provider"]) : "user",
    // Google's terms allow storing place ids indefinitely; nothing else from Places is kept beyond what the operator confirmed.
    providerId: clean(edit.primary.providerId),
    confidence: 100,
    evidenceIds: [],
  };
  place.precision = precisionOf(place);
  place.label = placeLabel(place) || place.formattedAddress || "";

  // Measuring a chain at one of its branches makes that branch the primary
  // and moves the website's first address to the branches; the addresses
  // themselves never change.
  const branches: StoredPlace[] = (next.location?.branches ?? []).map((branch) => ({ ...branch }));
  let primary: StoredPlace = place;
  const requestedArea = edit.marketArea ?? null;
  const inAreaNamed = (name: string) => (candidate: StoredPlace) => samePlaceName(candidate.neighborhood, name) || samePlaceName(candidate.district, name);
  if (requestedArea && (requestedArea.level === "neighborhood" || requestedArea.level === "district") && !inAreaNamed(requestedArea.name)(place)) {
    const index = branches.findIndex(inAreaNamed(requestedArea.name));
    if (index >= 0) {
      const chosen = branches[index]!;
      branches.splice(index, 1);
      const previous: StoredPlace = base.location?.primary && samePlaceName(base.location.primary.label, place.label) ? base.location.primary : place;
      branches.unshift(previous);
      primary = { ...chosen, confidence: 100 };
    }
  }

  const kind = (next.classification?.kind ?? "other") as BusinessKind;
  const presence = (next.classification?.physicalPresence ?? "unknown") as PhysicalPresence;
  const placeBound = PLACE_BOUND_KINDS.has(kind) && presence !== "online_only";
  const servedCodes = (edit.countriesServed ?? next.location?.countriesServed ?? []).map((c) => countryCodeFrom(c)).filter((c): c is string => Boolean(c));
  // Place-bound: customers visit the place, so its country leads. Online: the
  // operator's chip order is the market order (a Dubai-HQ software company
  // selling to Saudi Arabia lists SA first), and downstream stages read the
  // market country from countriesServed[0] (understanding/market-countries.ts),
  // so the head office must not be forced to the front.
  //
  // Except when the chips lead with the head-office country the operator just
  // corrected: without an intake hint, resolveLocation puts the detected head
  // office first, the editor pre-fills the chips from that list, and a SaaS
  // misread as Canadian and corrected to the United States kept Canada as its
  // market country for prompts and Landscape. A lead chip the operator gave at
  // intake is theirs and stays first.
  const previousCountry = base.location?.primary?.countryCode ?? null;
  const leadIsDetectedHeadOffice =
    !placeBound &&
    Boolean(countryCode && previousCountry && countryCode !== previousCountry && servedCodes[0] === previousCountry) &&
    base.location?.operatorHint?.countryCodes[0] !== previousCountry;
  const countriesServed = [
    ...new Set(
      placeBound
        ? [...(countryCode ? [countryCode] : []), ...servedCodes]
        : leadIsDetectedHeadOffice
          ? [countryCode!, ...servedCodes.slice(1), previousCountry!]
          : [...servedCodes, ...(countryCode ? [countryCode] : [])],
    ),
  ];

  const scope: MarketScope =
    edit.marketScope ??
    (placeBound
      ? place.neighborhood && presence === "single_location"
        ? next.marketScope.value === "local" ? "local" : "hyperlocal"
        : place.city
          ? "local"
          : place.region
            ? "regional"
            : "national"
      : countriesServed.length > 5
        ? "global"
        : countriesServed.length >= 2
          ? "international"
          : "national");

  const kept = next.location?.marketArea ?? null;
  const keptStillFits =
    kept !== null &&
    (kept.level === "city"
      ? samePlaceName(kept.name, primary.city)
      : kept.level === "neighborhood" || kept.level === "district"
        ? [primary, ...branches].some(inAreaNamed(kept.name))
        : true);
  const marketArea: MarketArea | null = requestedArea
    ? { level: requestedArea.level, name: requestedArea.name.trim().slice(0, 120), countryCode, source: "user", rationale: "Chosen by the operator." }
    : keptStillFits
      ? kept
      : decideMarketArea({ placeBound, scope, primary, branches, presence, countries: countriesServed });

  next.location = {
    primary: primary.label ? primary : null,
    primaryRole: next.location?.primaryRole ?? (placeBound ? "storefront" : "headquarters"),
    branches,
    ...(marketArea ? { marketArea } : {}),
    serviceAreas: next.location?.serviceAreas ?? [],
    nearbyAreas: (edit.nearbyAreas ?? next.location?.nearbyAreas ?? []).map((a) => a.trim()).filter(Boolean).slice(0, 10),
    countriesServed,
    signals: next.location?.signals ?? [],
    needsConfirmation: false,
    rationale: "Confirmed by the operator.",
    source: "user",
    confidence: 100,
    // What the operator said at intake, and how many locations the site
    // implies, survive a correction: the card and competitor tiers read them.
    ...(next.location?.operatorHint ? { operatorHint: next.location.operatorHint } : {}),
    ...(next.location?.locationCount ? { locationCount: next.location.locationCount } : {}),
  };

  const markets: Market[] = [];
  const push = (name: string | null, level: Market["level"], code: string | null) => {
    if (!name || markets.some((m) => m.name.toLowerCase() === name.toLowerCase())) return;
    markets.push({ name, level, countryCode: code, confidence: 100, evidenceIds: [], isPrimary: markets.length === 0 });
  };
  if (scope === "hyperlocal") push(place.neighborhood, "neighborhood", countryCode);
  if (scope === "hyperlocal" || scope === "local" || scope === "regional") {
    push(place.city, "city", countryCode);
    if (scope === "local") push(place.neighborhood, "neighborhood", countryCode);
    push(place.region, "region", countryCode);
    push(place.country, "country", countryCode);
  } else {
    // Worldwide leads for a global business, as resolveLocation writes it.
    if (scope === "global") push("Worldwide", "global", null);
    for (const code of countriesServed) push(countryName(code), "country", code);
  }
  next.markets = markets;
  // An online business's office city and state are not markets (see
  // resolveLocation); for a global one the geography mirror leaves them out.
  const officeIsMarket = placeBound || scope !== "global";
  next.geography = {
    ...next.geography,
    countries: markets.filter((m) => m.level === "country").map((m) => m.name),
    regions: officeIsMarket && place.region ? [place.region] : [],
    cities: officeIsMarket && place.city ? [place.city] : [],
    neighborhoods: place.neighborhood ? [place.neighborhood] : [],
    source: "user",
    evidenceIds: [],
  };
  next.marketScope = { value: scope, source: "user", evidenceIds: [], confidence: 100 };
  return next;
}
