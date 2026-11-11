// Location resolution and market scope.
//
// No single signal is trusted. The primary place is assembled from the
// business's structured address, the address as the model read it, map
// coordinates, and a geocoder, and each country signal votes:
//
//   structured address country   3.0     reverse-geocoded coordinates  3.0
//   model-read address country   2.5     domain ending (.ae, .co.uk)   2.0
//   phone numbers (validated)    2.0     single-country currency       1.2
//   Search Console country share 2 / 1   countries the site says it serves 1.0
//
// Page language tags are not counted: WordPress sites ship `en-US` whatever
// their country, which is how a Dubai salon became a US business.
//
// Neighbourhood names come from the website, not the geocoder. OpenStreetMap
// calls the block around Staybridge Suites "Trade Centre 1"; the business and
// its customers call it DIFC. A geocoder fills gaps (city, emirate, coordinates)
// and can raise or lower confidence, but never renames the area.
//
// The operator's intake answer ("Where are your customers?") weighs 4: more
// than any single website signal, less than two agreeing strong ones. It
// settles close calls (GB vs IE on a .co.uk site) and fills what the website
// leaves out, and it is applied here, deterministically, never through the
// model. When a physical address on the website contradicts it for a
// place-bound business, the operator's value is kept as the working value but
// both are shown for confirmation: an agency typo must not silently move a
// salon to another country, and neither may a stale footer address.
//
// Search Console country share is an input vote only when the pull had enough
// data, and it never counts against a written address: a Dubai salon's
// searches from India are diaspora and tourists, not its location.

import type { EvidenceItem } from "@/lib/evidence/types";
import { LOCATION_COUNTS, type BusinessProfile, type LocationCount, type LocationProfile, type Market, type MarketScope, type OperatorHintOutcome } from "@/lib/profile/schema";
import { emptyPlace, placeLabel, precisionOf, type GeoPlace } from "@/lib/geo/types";
import { countryCodeFrom, countryCodeFromCurrency, countryCodeFromHostname, countryName } from "@/lib/geo/countries";
import { dominantPhoneCountry } from "@/lib/geo/phone";
import { geocodeText, reverseGeocode } from "@/lib/geo/providers";
import { computeConfidence } from "@/lib/profile/confidence";
import { describeMarketHint, hintCountry, type HintPlace, type MarketHint } from "@/lib/projects/market-hint";
import type { SearchConsoleSignals } from "@/lib/search-console/types";
import { PLACE_BOUND_KINDS, type BusinessKind, type PhysicalPresence } from "./kinds";
import { decideMarketArea } from "./market-area";
import type { UnderstandingOutput } from "./extraction";

type LlmAddress = UnderstandingOutput["location"]["addresses"][number];

export interface GroundedAddress extends LlmAddress {
  evidenceIds: string[];
}

export interface LocationInput {
  addresses: GroundedAddress[];
  serviceAreas: Array<{ name: string; level: string; evidenceIds: string[] }>;
  nearbyAreas: string[];
  countriesServed: string[];
  llmScope: string;
  scopeRationale: string;
  locationCount: string;
  kind: BusinessKind;
  presence: PhysicalPresence;
  evidence: EvidenceItem[];
  seedHostname: string;
  allowNetwork: boolean;
  /** The operator's intake answer, when one was given. */
  hint?: MarketHint | null;
  /** Code-computed Search Console signals; ignored unless `sufficient`. */
  searchConsole?: Pick<SearchConsoleSignals, "sufficient" | "countries" | "placeDemand"> | null;
}

export interface LocationResult {
  location: LocationProfile;
  markets: Market[];
  scope: { value: MarketScope; confidence: number; evidenceIds: string[]; rationale: string };
  geography: { countries: string[]; regions: string[]; cities: string[]; neighborhoods: string[]; serviceAreaDescription: string | null };
  warnings: string[];
}

interface StructuredAddress {
  street: string | null;
  city: string | null;
  region: string | null;
  countryCode: string | null;
  postalCode: string | null;
  formatted: string | null;
  evidenceId: string;
  localBusiness: boolean;
}

/** More than any single website signal (structured address 3), less than two agreeing strong ones. */
const HINT_WEIGHT = 4;
/** Signals that put the business somewhere on a map, as opposed to a domain ending or a phone prefix. */
const PHYSICAL_SIGNALS = new Set(["structured_address", "website_address", "coordinates"]);

function structuredAddresses(evidence: EvidenceItem[]): StructuredAddress[] {
  const out: StructuredAddress[] = [];
  for (const item of evidence) {
    if (item.sourceType !== "address") continue;
    const data = (item.data ?? {}) as Record<string, unknown>;
    if (!data.structured) continue;
    const str = (v: unknown) => (typeof v === "string" && v.trim() ? v.trim() : null);
    out.push({
      street: str(data.street),
      city: str(data.locality),
      region: str(data.region),
      countryCode: countryCodeFrom(str(data.country)),
      postalCode: str(data.postalCode),
      formatted: str(data.formatted),
      evidenceId: item.id,
      localBusiness: /Salon|Spa|Store|Shop|Restaurant|Cafe|Clinic|Dentist|Hotel|LocalBusiness|Business|Service|Physician|Gym|Club|Bakery|Bar/i.test(String(data.schemaType ?? "")),
    });
  }
  return out;
}

function coordinates(evidence: EvidenceItem[]): Array<{ lat: number; lng: number; evidenceId: string; weight: number }> {
  const out: Array<{ lat: number; lng: number; evidenceId: string; weight: number }> = [];
  for (const item of evidence) {
    const data = (item.data ?? {}) as Record<string, unknown>;
    const lat = Number(data.lat);
    const lng = Number(data.lng);
    if (!Number.isFinite(lat) || !Number.isFinite(lng) || (lat === 0 && lng === 0) || Math.abs(lat) > 90 || Math.abs(lng) > 180) continue;
    // Structured-data coordinates describe the business; a map link might be directions to anywhere.
    const weight = item.sourceType === "jsonld" || item.sourceType === "microdata" ? 3 : /Map link/.test(item.text) ? 2 : 1;
    out.push({ lat, lng, evidenceId: item.id, weight });
  }
  return out.sort((a, b) => b.weight - a.weight);
}

function same(a: string | null | undefined, b: string | null | undefined): boolean {
  if (!a || !b) return false;
  const n = (s: string) => s.toLowerCase().replace(/[^\p{L}\p{N}]+/gu, " ").trim();
  return n(a) === n(b) || n(a).includes(n(b)) || n(b).includes(n(a)) || isAcronymOf(a, b) || isAcronymOf(b, a);
}

/**
 * "DIFC" and "Dubai International Financial Centre" are one area. Map
 * providers return the formal name while websites and customers use the
 * initials; treating them as different replaced the site's "DIFC" with the
 * formal name and then listed "DIFC" again as a nearby area.
 */
function isAcronymOf(short: string, long: string): boolean {
  const compact = short.replace(/[^\p{L}\p{N}]/gu, "");
  if (compact.length < 2 || compact.length > 6 || /\s/.test(short.trim())) return false;
  const words = long.split(/[^\p{L}\p{N}]+/u).filter((word) => word && !/^(of|the|and|de|la|al|el)$/i.test(word));
  if (words.length < 2) return false;
  return words.map((word) => word[0]).join("").toLowerCase() === compact.toLowerCase();
}

function addressCountry(address: GroundedAddress): string | null {
  return countryCodeFrom(address.countryCode) ?? countryCodeFrom(address.country);
}

/** A primary place built only from what the operator told us: area levels, never a street. */
function placeFromHint(hintPlace: HintPlace | null, countryCode: string): GeoPlace {
  const place = emptyPlace(hintPlace?.provider ?? "user");
  if (hintPlace) {
    place.neighborhood = hintPlace.neighborhood;
    place.district = hintPlace.district;
    place.city = hintPlace.city;
    place.region = hintPlace.region;
    place.postalCode = hintPlace.postalCode;
    place.lat = hintPlace.lat;
    place.lng = hintPlace.lng;
    place.providerId = hintPlace.providerId;
  }
  place.countryCode = countryCode;
  place.country = countryName(countryCode);
  return place;
}

/** A finished copy of the website's own place, kept for the conflict box or as a branch. */
function finishedCopy(place: GeoPlace, evidenceIds: string[], evidence: EvidenceItem[]): GeoPlace {
  const copy: GeoPlace = { ...place, evidenceIds: evidenceIds.slice(0, 6) };
  copy.precision = precisionOf(copy);
  copy.label = placeLabel(copy) || copy.formattedAddress || "";
  copy.confidence = computeConfidence({ items: evidenceItems(evidence, copy.evidenceIds), ceiling: 85 });
  return copy;
}

const SCOPE_ORDER: MarketScope[] = ["hyperlocal", "local", "regional", "national", "international", "global"];

export async function resolveLocation(input: LocationInput): Promise<LocationResult> {
  const warnings: string[] = [];
  const signals: LocationProfile["signals"] = [];
  const structured = structuredAddresses(input.evidence);
  const coords = coordinates(input.evidence);
  const placeBound = PLACE_BOUND_KINDS.has(input.kind) && input.presence !== "online_only";

  // --- Operator hint: resolve the area -------------------------------------------
  const hint = input.hint ?? null;
  const hintCode = hint && !hint.worldwide ? hintCountry(hint) : null;
  const worldwideHint = hint?.worldwide === true;
  const hintLabel = hint ? describeMarketHint(hint) : "";
  const hintArea = hintCode ? (hint?.area ?? null) : null;
  let hintPlace: HintPlace | null = null;
  if (hintArea?.place) {
    hintPlace = (hintArea.place.countryCode ?? hintCode)?.toUpperCase() === hintCode ? hintArea.place : null;
  } else if (hintArea && input.allowNetwork) {
    // Typed at intake but never picked from the list (place search was offline).
    for (const query of [hintArea.query, `${hintArea.query}, ${countryName(hintCode) ?? hintCode}`]) {
      const found = await geocodeText(query, hintCode);
      if (found?.countryCode === hintCode) {
        hintPlace = found;
        break;
      }
    }
  }
  const hintHasArea = Boolean(hintPlace && (hintPlace.neighborhood || hintPlace.district || hintPlace.city || hintPlace.region));
  const hintUnresolved = Boolean(hintArea && !hintHasArea);

  // --- Choose the primary address -----------------------------------------
  const rolePreference = placeBound ? ["storefront", "branch", "unknown", "headquarters", "office"] : ["headquarters", "office", "storefront", "branch", "unknown"];
  const roleSorted = [...input.addresses].sort((a, b) => rolePreference.indexOf(a.role) - rolePreference.indexOf(b.role));
  // A Dubai-headquartered chain whose operator says "Bengaluru" should read its
  // Bengaluru branch as the primary, not the Dubai flagship. Only roles already
  // preferred for this kind of business can move forward.
  const hintRoles = placeBound ? ["storefront", "branch", "unknown"] : ["headquarters", "office"];
  const matchesHint = (address: GroundedAddress) => {
    if (!hintCode || !hintRoles.includes(address.role)) return false;
    const code = addressCountry(address);
    if (code && code !== hintCode) return false;
    return hintHasArea && hintPlace?.city ? same(address.city, hintPlace.city) : code === hintCode;
  };
  const addresses = hintCode ? [...roleSorted.filter(matchesHint), ...roleSorted.filter((a) => !matchesHint(a))] : roleSorted;
  const primaryAddress = addresses[0] ?? null;

  let place: GeoPlace | null = null;
  const primaryEvidence = new Set<string>();
  if (primaryAddress) {
    place = emptyPlace("website");
    place.premise = primaryAddress.premise;
    place.street = primaryAddress.street;
    place.neighborhood = primaryAddress.neighborhood;
    place.district = primaryAddress.district;
    place.city = primaryAddress.city;
    place.region = primaryAddress.region;
    place.countryCode = addressCountry(primaryAddress);
    place.country = countryName(place.countryCode) ?? primaryAddress.country;
    place.postalCode = primaryAddress.postalCode;
    place.formattedAddress = primaryAddress.raw || null;
    for (const id of primaryAddress.evidenceIds) primaryEvidence.add(id);
  }

  // Merge the structured (JSON-LD) address that agrees with the model's reading,
  // or adopt it when the model found none.
  const matchingStructured =
    structured.find((s) => place && (same(s.city, place.city) || same(s.street, place.street) || (s.formatted && place.neighborhood && same(s.formatted, place.neighborhood)))) ??
    (place ? undefined : structured.find((s) => s.localBusiness) ?? structured[0]);
  if (matchingStructured) {
    if (!place) {
      place = emptyPlace("website");
      place.formattedAddress = matchingStructured.formatted;
    }
    place.street = place.street ?? matchingStructured.street;
    place.city = place.city ?? matchingStructured.city;
    place.region = place.region ?? matchingStructured.region;
    place.postalCode = place.postalCode ?? matchingStructured.postalCode;
    if (!place.countryCode && matchingStructured.countryCode) {
      place.countryCode = matchingStructured.countryCode;
      place.country = countryName(matchingStructured.countryCode);
    }
    primaryEvidence.add(matchingStructured.evidenceId);
  }

  // --- Country votes ----------------------------------------------------------
  const votes = new Map<string, number>();
  const physicalCountries = new Set<string>();
  /** Countries voted for by the website itself (everything but Search Console). */
  const websiteCountries = new Set<string>();
  const vote = (code: string | null | undefined, weight: number, kind: string, value: string, evidenceIds: string[] = []) => {
    if (!code) return;
    votes.set(code, (votes.get(code) ?? 0) + weight);
    if (PHYSICAL_SIGNALS.has(kind)) physicalCountries.add(code);
    if (kind !== "search_console_country") websiteCountries.add(code);
    signals.push({ kind, value, weight, evidenceIds });
  };
  for (const s of structured.slice(0, 3)) vote(s.countryCode, 3, "structured_address", `${s.formatted ?? s.city ?? ""} → ${s.countryCode}`, [s.evidenceId]);
  if (primaryAddress) vote(addressCountry(primaryAddress), 2.5, "website_address", primaryAddress.raw.slice(0, 120), primaryAddress.evidenceIds);
  vote(countryCodeFromHostname(input.seedHostname), 2, "domain_ending", input.seedHostname);
  // The hint is deliberately not the phone parser's default country: national
  // numbers parsed with it would "confirm" the very hint they were parsed with.
  const phoneNumbers = input.evidence.filter((e) => e.sourceType === "phone").map((e) => String((e.data as Record<string, unknown> | null)?.telephone ?? e.text.replace(/^[^:]*:\s*/, "")));
  const phone = dominantPhoneCountry([...new Set(phoneNumbers.map((n) => n.replace(/[^\d+]/g, "").replace(/^00/, "+")))], place?.countryCode ?? countryCodeFromHostname(input.seedHostname));
  if (phone) vote(phone.countryCode, 2, "phone", `${phone.count} number(s) → ${phone.countryCode}`, input.evidence.filter((e) => e.sourceType === "phone").slice(0, 2).map((e) => e.id));
  const currencyCodes = new Set(input.evidence.filter((e) => e.sourceType === "currency").map((e) => countryCodeFromCurrency(e.text)).filter((c): c is string => Boolean(c)));
  if (currencyCodes.size === 1) vote([...currencyCodes][0], 1.2, "currency", [...currencyCodes][0]!);
  for (const code of input.countriesServed.slice(0, 1)) vote(countryCodeFrom(code), 1, "countries_served", code);

  // --- Coordinates and geocoding ------------------------------------------------
  const bestCoords = coords[0];
  let reverse: GeoPlace | null = null;
  /** Country of a geocoder hit whose coordinates were copied onto the website's place. */
  let geocodedCountry: string | null = null;
  if (place && bestCoords) {
    place.lat = bestCoords.lat;
    place.lng = bestCoords.lng;
    primaryEvidence.add(bestCoords.evidenceId);
  }
  if (input.allowNetwork) {
    if (bestCoords) {
      reverse = await reverseGeocode(bestCoords.lat, bestCoords.lng);
      if (reverse?.countryCode) vote(reverse.countryCode, 3, "coordinates", `${bestCoords.lat.toFixed(4)}, ${bestCoords.lng.toFixed(4)} → ${[reverse.city, reverse.countryCode].filter(Boolean).join(", ")}`, [bestCoords.evidenceId]);
    } else if (place && (place.street || place.neighborhood || place.city)) {
      const query = [place.premise, place.street, place.neighborhood, place.city, place.region, place.country].filter(Boolean).join(", ");
      const bias = place.countryCode ?? hintCode;
      const geocoded = await geocodeText(query, bias);
      const fallback = geocoded ?? (place.neighborhood || place.city ? await geocodeText([place.neighborhood, place.city, place.country].filter(Boolean).join(", "), bias) : null);
      if (fallback && (!place.countryCode || fallback.countryCode === place.countryCode)) {
        place.lat = fallback.lat;
        place.lng = fallback.lng;
        place.providerId = fallback.providerId;
        geocodedCountry = fallback.countryCode;
        reverse = fallback;
        signals.push({ kind: "geocoded", value: `${query} → ${fallback.label}`, weight: 0, evidenceIds: [] });
      }
    }
  }

  // --- Search Console country share ---------------------------------------------
  const gsc = input.searchConsole?.sufficient ? input.searchConsole : null;
  const gscTop = gsc ? [...gsc.countries].sort((a, b) => b.share - a.share)[0] : undefined;
  const gscCode = gscTop ? countryCodeFrom(gscTop.countryCode) : null;
  if (gscTop && gscCode) {
    const weight = gscTop.share >= 0.6 && gscTop.impressions >= 200 ? 2 : gscTop.share >= 0.4 ? 1 : 0;
    const value = `${Math.round(gscTop.share * 100)}% of search impressions → ${gscCode}`;
    if (weight > 0 && (physicalCountries.size === 0 || physicalCountries.has(gscCode))) vote(gscCode, weight, "search_console_country", value);
    // Recorded without a vote: searches from elsewhere never argue with a written address.
    else if (weight > 0) signals.push({ kind: "search_console_country", value, weight: 0, evidenceIds: [] });
  }

  const rankedVotes = [...votes.entries()].sort((a, b) => b[1] - a[1]);
  const winningCountry = rankedVotes[0]?.[0] ?? null;
  const runnerUp = rankedVotes[1];
  let countryConflict = Boolean(runnerUp && rankedVotes[0] && rankedVotes[0][1] - runnerUp[1] < 1.5);

  // --- The website's own place ----------------------------------------------------
  let addressConflictWarning: string | null = null;
  if (!place && winningCountry) {
    // No address at all: the business still has a country.
    place = emptyPlace("website");
  }
  if (place) {
    if (!place.countryCode && winningCountry) {
      place.countryCode = winningCountry;
      place.country = countryName(winningCountry);
    } else if (place.countryCode && winningCountry && place.countryCode !== winningCountry && (votes.get(winningCountry) ?? 0) > (votes.get(place.countryCode) ?? 0)) {
      addressConflictWarning = `The address reads as ${place.country}, but most signals point to ${countryName(winningCountry)}. Please confirm the location.`;
      countryConflict = true;
    }
    if (reverse && (!place.countryCode || reverse.countryCode === place.countryCode)) {
      place.city = place.city ?? reverse.city;
      place.region = place.region ?? reverse.region;
      place.district = place.district ?? (reverse.district && !same(reverse.district, place.neighborhood) ? reverse.district : null);
      place.postalCode = place.postalCode ?? reverse.postalCode;
      if (reverse.neighborhood && !same(reverse.neighborhood, place.neighborhood)) {
        signals.push({ kind: "map_area_name", value: reverse.neighborhood, weight: 0, evidenceIds: [] });
      }
    }
  }

  // --- Branches ---------------------------------------------------------------
  const branches: GeoPlace[] = [];
  for (const address of addresses.slice(1)) {
    // A salon chain's head office is an office, not a place customers visit.
    // But when the operator placed a chain's customers in another country, the
    // head office is the website's own location there and stays visible, as a
    // displaced primary would (market §9.4 case 9: Dubai HQ, Bengaluru branch).
    const hqOutsideHint = Boolean(hintCode && input.presence === "multi_location" && addressCountry(address) && addressCountry(address) !== hintCode);
    if (address.role === "headquarters" && placeBound && !hqOutsideHint) continue;
    const branch = emptyPlace("website");
    branch.premise = address.premise;
    branch.street = address.street;
    branch.neighborhood = address.neighborhood;
    branch.district = address.district;
    branch.city = address.city;
    branch.region = address.region;
    branch.countryCode = addressCountry(address) ?? place?.countryCode ?? null;
    branch.country = countryName(branch.countryCode) ?? address.country;
    branch.postalCode = address.postalCode;
    branch.formattedAddress = address.raw || null;
    branch.precision = precisionOf(branch);
    branch.label = placeLabel(branch);
    branch.evidenceIds = address.evidenceIds.slice(0, 4);
    branch.confidence = computeConfidence({ items: evidenceItems(input.evidence, branch.evidenceIds), ceiling: 85 });
    if (!branch.label) continue;
    // The same venue written twice (the home page and the locations page,
    // one with a street and one without) is one branch: Nawab's Jabel Ali
    // branch was listed twice.
    // The primary's label is computed later, so compare on a label built now.
    const duplicateOf = (other: GeoPlace) => same(other.label || placeLabel(other), branch.label) && (!other.street || !branch.street || same(other.street, branch.street)) && (!other.premise || !branch.premise || same(other.premise, branch.premise));
    if (place && duplicateOf(place)) continue;
    if (branches.some(duplicateOf)) continue;
    branches.push(branch);
  }

  // --- Apply the operator's hint to the country and area ------------------------------
  // Assigned inside `rebuildFromHint` too; the casts stop TypeScript narrowing them to their initial null.
  let outcome = null as OperatorHintOutcome | null;
  let hintMessage: string | null = null;
  let websitePlace = null as GeoPlace | null;
  /** The primary was replaced by a place built from the hint (no website evidence left in it). */
  let rebuilt = false;
  /** Some level of the primary came from the hint. */
  let shapedByHint = false;
  let primaryRoleOverride: LocationProfile["primaryRole"] | null = null;
  const displaced: GeoPlace[] = [];
  const multi = input.presence === "multi_location" || branches.length > 0;
  // The website's own reading, taken before the hint touches anything: a copy
  // made after a country fill once labelled a London address "London, Ireland"
  // in the conflict box, and "Use the website's location" would have saved it so.
  const websiteOwn: GeoPlace | null = place ? { ...(place as GeoPlace) } : null;
  if (websiteOwn) {
    // A country only Search Console voted for is where searchers are, not the address.
    if (websiteOwn.countryCode && !websiteCountries.has(websiteOwn.countryCode)) {
      websiteOwn.countryCode = null;
      websiteOwn.country = null;
    }
    // Coordinates from a geocoder biased to the hint's country belong to some other street.
    if (geocodedCountry && websiteOwn.countryCode && geocodedCountry !== websiteOwn.countryCode) {
      websiteOwn.lat = null;
      websiteOwn.lng = null;
      websiteOwn.providerId = null;
    }
  }
  const rebuildFromHint = (next: OperatorHintOutcome, keepWebsitePlace: "conflict" | "branch") => {
    const copy = finishedCopy(websiteOwn ?? place!, [...primaryEvidence], input.evidence);
    if (keepWebsitePlace === "conflict") websitePlace = copy;
    else if (copy.label) displaced.push(copy);
    place = placeFromHint(hintHasArea ? hintPlace : null, hintCode!);
    // An area the map returned without a city ("Jumeirah Village Circle,
    // Dubai Emirate") sits in the website's own city when the region agrees;
    // without this the rebuilt primary had no city and prompts lost "in Dubai".
    // Only when the website's own place is in the operator's country and the
    // operator named an area: a London address moved to Ireland must not
    // become "London, Ireland".
    if (!place.city && copy.city && copy.countryCode === hintCode && Boolean(hintPlace?.neighborhood || hintPlace?.district) && (same(place.region, copy.region) || same(place.region, copy.city) || !place.region)) place.city = copy.city;
    outcome = next;
    rebuilt = true;
    shapedByHint = true;
    countryConflict = false;
  };

  if (hintCode) {
    // Where searchers are is not where the business is: a country only Search
    // Console voted for is not the website's, so the operator's answer fills it.
    const websiteCountry = place?.countryCode && websiteCountries.has(place.countryCode) ? place.countryCode : null;
    if (!place || !websiteCountry) {
      // Nothing on the website names a country.
      if (!place) place = emptyPlace("user");
      place.countryCode = hintCode;
      place.country = countryName(hintCode);
      outcome = "filled";
      shapedByHint = true;
    } else if (websiteCountry === hintCode) {
      // The operator settles a close call the website alone could not.
      outcome = "agreed";
      countryConflict = false;
    } else if (!placeBound && (physicalCountries.has(websiteCountry) || Boolean(place.premise || place.street || place.neighborhood || place.district || place.city))) {
      // A head office abroad is normal for an online business: the website keeps
      // the head office, and the hint becomes the market country below. Only a
      // written address, JSON-LD address or coordinates make it a head office:
      // Wipro, with India chosen at intake, came out "head office in United
      // Kingdom … Serves customers across United Kingdom" from nothing but a £
      // price on one crawled page. A country with no written place behind it
      // (currency, phone prefix, domain ending) falls through to the override below.
      outcome = "noted";
      hintMessage = `The website's head office is in ${countryName(websiteCountry) ?? websiteCountry}. Competitors and prompts use ${hintLabel}, where you told us your customers are.`;
    } else if (physicalCountries.has(websiteCountry)) {
      rebuildFromHint(multi ? "overrode" : "conflict", multi ? "branch" : "conflict");
    } else {
      // Only a domain ending, phone prefix or currency pointed elsewhere. A
      // written address with no country of its own (JSON-LD without
      // addressCountry is common) casts no physical vote, but it still names a
      // place: "5 High St, London" on a .co.uk site with a UK phone is not in
      // Ireland because the operator picked Ireland. Keep the website's levels
      // only when they agree with the operator's area; otherwise show both.
      const current: GeoPlace = place;
      const namesPlace = Boolean(current.premise || current.street || current.neighborhood || current.district || current.city);
      const agreesWithArea = Boolean(
        hintHasArea &&
          hintPlace &&
          (current.city
            ? same(current.city, hintPlace.city) || (!hintPlace.city && same(current.region, hintPlace.region))
            : current.neighborhood
              ? same(current.neighborhood, hintPlace.neighborhood)
              : false),
      );
      if (namesPlace && !agreesWithArea) {
        rebuildFromHint(multi ? "overrode" : "conflict", multi ? "branch" : "conflict");
      } else {
        if (!namesPlace) {
          // What is left (a region, a postcode, bare coordinates) came with the other country.
          current.region = null;
          current.postalCode = null;
          current.formattedAddress = null;
          current.lat = null;
          current.lng = null;
          current.providerId = null;
          primaryEvidence.clear();
        }
        current.countryCode = hintCode;
        current.country = countryName(hintCode);
        outcome = "overrode";
        countryConflict = false;
        shapedByHint = true;
      }
    }

    // A chain measured at one of its branches: when the operator's area is a
    // branch's area, that branch becomes the primary and the website's first
    // address joins the branches. Otherwise the merge below renamed the first
    // address to the operator's area (a Jabel Ali branch labelled "JVC").
    if (hintHasArea && hintPlace && !rebuilt && place && placeBound && branches.length > 0) {
      const areaName = hintPlace.neighborhood ?? hintPlace.district ?? null;
      const inArea = (candidate: GeoPlace) => Boolean(areaName && (same(candidate.neighborhood, areaName) || same(candidate.district, areaName)));
      if (areaName && !inArea(place)) {
        const index = branches.findIndex(inArea);
        if (index >= 0) {
          const chosen = branches[index]!;
          branches.splice(index, 1);
          branches.unshift(finishedCopy(place, [...primaryEvidence], input.evidence));
          place = chosen;
          primaryEvidence.clear();
          for (const id of chosen.evidenceIds) primaryEvidence.add(id);
          shapedByHint = true;
        }
      }
    }

    // Area merge.
    if (hintHasArea && hintPlace && !rebuilt && place) {
      const current: GeoPlace = place;
      if (current.countryCode === hintCode) {
        const sameCity = same(current.city, hintPlace.city) || (!hintPlace.city && same(current.region, hintPlace.region));
        if (!current.city || sameCity) {
          if (hintPlace.neighborhood && current.neighborhood && !same(hintPlace.neighborhood, current.neighborhood)) {
            // The website still beats the geocoder, and the operator beats the website.
            signals.push({ kind: "website_area_name", value: current.neighborhood, weight: 0, evidenceIds: [] });
            current.neighborhood = hintPlace.neighborhood;
          }
          current.neighborhood = current.neighborhood ?? hintPlace.neighborhood;
          current.district = current.district ?? hintPlace.district;
          current.region = current.region ?? hintPlace.region;
          current.postalCode = current.postalCode ?? hintPlace.postalCode;
          if (!current.city) {
            current.city = hintPlace.city;
            // Website coordinates are a premise; the hint's are an area centroid.
            if (current.lat === null || current.lng === null) {
              current.lat = hintPlace.lat;
              current.lng = hintPlace.lng;
              current.provider = hintPlace.provider;
              current.providerId = hintPlace.providerId;
            }
            if (outcome !== "overrode") outcome = "filled";
          } else if (outcome === "filled" || outcome === "agreed") {
            outcome = "agreed";
          }
          shapedByHint = true;
        } else if (placeBound) {
          rebuildFromHint(multi ? "overrode" : "conflict", multi ? "branch" : "conflict");
        } else {
          rebuildFromHint("overrode", "branch");
          primaryRoleOverride = "service_base";
        }
      } else if (!placeBound) {
        // Online business, head office abroad, customers in a named area: the
        // market area becomes the primary and the head office stays visible.
        rebuildFromHint("overrode", "branch");
        primaryRoleOverride = "service_base";
        hintMessage = null;
      }
    }
  }

  if (place) {
    const current: GeoPlace = place;
    if (!rebuilt && reverse && (!current.countryCode || reverse.countryCode === current.countryCode)) {
      if (!current.neighborhood && reverse.neighborhood && placeBound) {
        // Only when neither the website nor the operator names an area: better
        // an official area name than none, but marked for confirmation.
        current.neighborhood = reverse.neighborhood;
        warnings.push(`The website does not name its neighbourhood; the map places it in ${reverse.neighborhood}.`);
      }
      if (reverse.city && current.city && !same(reverse.city, current.city) && !same(reverse.region, current.city)) {
        warnings.push(`The website's city (${current.city}) differs from where its coordinates fall (${reverse.city}).`);
      }
    }
    current.precision = precisionOf(current);
    current.label = placeLabel(current);
    current.evidenceIds = rebuilt ? [] : [...primaryEvidence].slice(0, 6);
  }
  if (countryConflict && addressConflictWarning) warnings.push(addressConflictWarning);
  const primaryPlace = place as GeoPlace | null;
  for (const copy of displaced) {
    // The displaced website primary is often also in the address list (the
    // home page and the locations page both name it): one branch, not two.
    const sameVenue = (other: GeoPlace) => same(other.label, copy.label) && (!other.street || !copy.street || same(other.street, copy.street)) && (!other.premise || !copy.premise || same(other.premise, copy.premise));
    if (primaryPlace && sameVenue(primaryPlace)) continue;
    if (branches.some(sameVenue)) continue;
    branches.unshift(copy);
  }

  // --- Market scope -------------------------------------------------------------
  // Order: the operator's market countries, the place, branches, then what the site says it serves.
  const countries = new Set<string>();
  if (hintCode) for (const code of hint!.countryCodes) countries.add(code);
  if (primaryPlace?.countryCode) countries.add(primaryPlace.countryCode);
  for (const b of branches) if (b.countryCode) countries.add(b.countryCode);
  if (!(placeBound && input.presence === "single_location")) {
    for (const c of input.countriesServed) {
      const code = countryCodeFrom(c);
      if (code) countries.add(code);
    }
  }
  const cities = new Set<string>();
  if (primaryPlace?.city) cities.add(primaryPlace.city.toLowerCase());
  for (const b of branches) if (b.city) cities.add(b.city.toLowerCase());
  const llmScope = (SCOPE_ORDER as string[]).includes(input.llmScope) ? (input.llmScope as MarketScope) : null;

  let scope: MarketScope = "unknown";
  let rationale = "";
  if (placeBound) {
    const multiFootprint = input.presence === "multi_location" || branches.length > 0 || input.locationCount === "few" || input.locationCount === "many";
    const websitePrimaryRole = rebuilt ? null : primaryAddress?.role;
    if (countries.size >= 2 && multiFootprint) {
      scope = "international";
      rationale = `Locations in ${countries.size} countries.`;
    } else if (multiFootprint && cities.size >= 2) {
      scope = input.locationCount === "many" && cities.size >= 5 ? "national" : "regional";
      rationale = `Locations in ${cities.size} cities.`;
    } else if (input.presence === "service_area") {
      const broad = input.serviceAreas.some((a) => ["region", "country", "multi_country"].includes(a.level));
      scope = broad ? "regional" : "local";
      rationale = broad ? "Serves a wider region from its base." : "Serves customers across its city.";
    } else if (multiFootprint && branches.length === 0 && (input.locationCount === "many" || websitePrimaryRole === "headquarters" || websitePrimaryRole === "office")) {
      // A chain that publishes only its head office ("2,700 shops", shop finder
      // behind a form) is not a one-city business: Greggs came out "local" to
      // Newcastle. Use the model's reading of the footprint, else the country.
      // Only when no branch is listed: a chain whose ten published branches are
      // all in Bengaluru (Truffles) was called national on "many locations".
      scope = llmScope && ["regional", "national", "international", "global"].includes(llmScope) ? llmScope : countries.size >= 2 ? "international" : "national";
      rationale = input.scopeRationale || "Many locations; the website lists only its head office.";
    } else if (multiFootprint) {
      scope = "local";
      rationale = branches.length > 0 ? `${branches.length + 1} locations, all in ${primaryPlace?.city ?? "one city"}.` : "Several locations in one city.";
    } else if (primaryPlace?.neighborhood) {
      scope = "hyperlocal";
      rationale = `A single location in ${primaryPlace.neighborhood}; nearby customers matter most.`;
    } else if (primaryPlace?.city) {
      scope = "local";
      rationale = `A single location in ${primaryPlace.city}.`;
    } else {
      scope = llmScope ?? "local";
      rationale = input.scopeRationale || "A place-based business with an unconfirmed address.";
    }
    // A destination business (a Michelin restaurant, a flagship store) may
    // draw from the whole city; the model's reading can widen hyperlocal to
    // local, but never shrink a multi-location footprint.
    if (scope === "hyperlocal" && llmScope === "local") {
      scope = "local";
      rationale = input.scopeRationale || rationale;
    }
  } else {
    if (countries.size > 5 || (llmScope === "global" && countries.size !== 1)) {
      scope = "global";
      rationale = input.scopeRationale || "Sells worldwide.";
    } else if (countries.size >= 2 || llmScope === "international") {
      scope = "international";
      rationale = input.scopeRationale || `Operates in ${countries.size} countries.`;
    } else if (countries.size === 1) {
      scope = llmScope === "global" ? "global" : "national";
      rationale = input.scopeRationale || `Operates in ${countryName([...countries][0]!)}.`;
    } else {
      scope = llmScope ?? "unknown";
      rationale = input.scopeRationale;
    }
  }

  // Search demand can widen, never narrow, and yields to anything the operator said.
  if (gsc && !hint) {
    if (!placeBound && scope === "national") {
      const demand = gsc.countries
        .filter((c) => c.share >= 0.15 && c.impressions >= 100)
        .map((c) => countryCodeFrom(c.countryCode))
        .filter((code): code is string => Boolean(code));
      if (new Set(demand).size >= 2) {
        for (const code of demand) countries.add(code);
        scope = "international";
        rationale = `Search demand comes from ${[...new Set(demand)].join(", ")}.`;
      }
    }
    if (placeBound && scope === "hyperlocal") {
      const mix = gsc.placeDemand.mix;
      const nearby = mix.neighborhood + mix.nearby + mix.nearMe;
      // The same destination-business rule the model applies, measured instead of read.
      if (gsc.placeDemand.placeBearingImpressions >= 50 && mix.city > 0 && mix.city >= 2 * nearby) {
        scope = "local";
        rationale = "People search for it by city far more often than by neighbourhood.";
      }
    }
  }

  // The operator's answer decides the scope last.
  if (worldwideHint) {
    if (!placeBound) {
      outcome = scope === "global" ? "agreed" : "filled";
      scope = "global";
      rationale = "You told us customers come from all over the world.";
    } else {
      outcome = "noted";
      const where = primaryPlace?.neighborhood ?? primaryPlace?.city ?? primaryPlace?.label ?? null;
      hintMessage = `You told us customers come from all over the world. They still visit ${where ?? "your location"}, so nearby businesses are your competitors.`;
    }
  } else if (hintCode && hint) {
    if (!placeBound) {
      const precision = hintHasArea && hintPlace ? precisionOf(hintPlace) : null;
      if (precision === "region") scope = "regional";
      else if (precision && precision !== "country") scope = "local";
      else scope = hint.countryCodes.length === 1 ? "national" : "international";
      rationale = `You told us customers are in ${hintLabel}.`;
    } else {
      rationale = `You told us customers are in ${hintLabel}. ${rationale}`.trim();
    }
  }

  // A global business's head office is not one of its markets. Postman (a San
  // Francisco office, "Worldwide" chosen at intake) came out with the United
  // States as its primary market and only served country, and two Discovery
  // prompts asked for tools "in the US". When customers do not visit the
  // business and the scope is global, the office country stays a market only
  // when the website lists it among several countries it serves.
  if (scope === "global" && !placeBound) {
    if (worldwideHint) {
      // The operator said customers are everywhere. The model reads office
      // addresses as "countries served" (Postman: US, India, Japan from three
      // offices), and each became an "in India" / "in Japan" prompt.
      countries.clear();
    } else {
      const explicitlyServed = input.countriesServed.map((code) => countryCodeFrom(code)).filter((code): code is string => Boolean(code));
      const office = primaryPlace?.countryCode ?? null;
      if (office && !(explicitlyServed.length >= 2 && explicitlyServed.includes(office)) && !(hint?.countryCodes ?? []).includes(office)) countries.delete(office);
    }
  }

  if (hintCode && hintUnresolved && outcome !== "conflict") {
    outcome = "unresolved";
    hintMessage = `We couldn't find “${hintArea!.query}” on the map. Check the area below.`;
    warnings.push(hintMessage);
  }
  if (outcome === "conflict" && websitePlace) {
    hintMessage = `You told us ${hintLabel}, but the website's address is in ${websitePlace.label || "another place"}. Please confirm which is right.`;
    warnings.push(hintMessage);
  }

  // --- Confidence ---------------------------------------------------------------
  const evidenceForPlace = evidenceItems(input.evidence, primaryPlace?.evidenceIds ?? []);
  let confidence = primaryPlace ? computeConfidence({ items: evidenceForPlace, ceiling: 90 }) : 0;
  if (primaryPlace) {
    const agreeing = rankedVotes[0]?.[0] === primaryPlace.countryCode ? signals.filter((s) => s.value.endsWith(primaryPlace.countryCode ?? "~") || s.kind === "structured_address").length : 0;
    confidence = Math.min(95, confidence + Math.min(15, agreeing * 4) + (reverse && reverse.countryCode === primaryPlace.countryCode ? 6 : 0));
    if (countryConflict) confidence = Math.min(confidence, 55);
    if (evidenceForPlace.length === 0) confidence = Math.min(confidence, primaryPlace.countryCode ? 50 : 20);
    if (outcome === "agreed") confidence = Math.min(95, Math.max(confidence, 85));
    if (outcome === "filled") confidence = Math.min(95, Math.max(confidence, hintHasArea && (primaryPlace.city || primaryPlace.neighborhood) ? 85 : 75));
    if (outcome === "overrode") confidence = 80;
    if (outcome === "conflict") confidence = Math.min(confidence, 55);
    // "We still need the city" holds whatever the operator said about the country.
    if (!primaryPlace.city && placeBound) confidence = Math.min(confidence, 45);
    primaryPlace.confidence = confidence;
  }

  const missingLevels = !primaryPlace || (placeBound && !primaryPlace.city) || (placeBound && !primaryPlace.neighborhood && scope !== "local" && scope !== "regional");
  let needsConfirmation = missingLevels || countryConflict || confidence < 60;
  if (outcome === "agreed") needsConfirmation = missingLevels;
  if (outcome === "conflict" || outcome === "unresolved") needsConfirmation = true;

  if (hint) {
    signals.unshift({ kind: "operator_stated", value: hintLabel, weight: worldwideHint ? 0 : HINT_WEIGHT, evidenceIds: [] });
  }

  // --- Market area: where customers are measured -----------------------------------
  // The operator's intake area when it resolved to a place; otherwise the
  // business's own footprint (understanding/market-area.ts). Never a single
  // branch of a chain unless the operator named it.
  const marketArea = decideMarketArea({
    placeBound,
    scope,
    primary: primaryPlace,
    branches,
    presence: input.presence,
    countries: [...countries],
    operatorArea:
      hintHasArea && hintPlace && !hintUnresolved
        ? { neighborhood: hintPlace.neighborhood, district: hintPlace.district, city: hintPlace.city, region: hintPlace.region, countryCode: hintPlace.countryCode }
        : null,
    worldwide: worldwideHint,
    nearbyAreas: input.nearbyAreas,
  });

  const serviceAreas = input.serviceAreas.slice(0, 12);
  const locationCount = (LOCATION_COUNTS as readonly string[]).includes(input.locationCount) ? (input.locationCount as LocationCount) : undefined;
  const location: LocationProfile = {
    primary: primaryPlace && primaryPlace.label ? primaryPlace : primaryPlace?.countryCode ? { ...primaryPlace, label: countryName(primaryPlace.countryCode) ?? primaryPlace.countryCode } : null,
    primaryRole:
      primaryRoleOverride ??
      (rebuilt
        ? placeBound
          ? "storefront"
          : "service_base"
        : !primaryAddress
          ? "unknown"
          : primaryAddress.role === "storefront" || primaryAddress.role === "branch"
            ? "storefront"
            : primaryAddress.role === "headquarters" || primaryAddress.role === "office"
              ? "headquarters"
              : input.presence === "service_area"
                ? "service_base"
                : "unknown"),
    branches: branches.slice(0, 25),
    serviceAreas,
    nearbyAreas: [...new Set(input.nearbyAreas.map((a) => a.trim()).filter((a) => a && !same(a, primaryPlace?.neighborhood) && !same(a, primaryPlace?.city)))].slice(0, 10),
    countriesServed: [...countries].slice(0, 30),
    ...(marketArea ? { marketArea } : {}),
    signals: signals.slice(0, 20),
    needsConfirmation,
    rationale,
    // "user" only when the operator's words are all the place is built from.
    source: !primaryPlace ? "inferred_needs_review" : hint && shapedByHint && primaryPlace.evidenceIds.length === 0 ? "user" : "evidence",
    confidence,
    ...(hint
      ? {
          operatorHint: {
            countryCodes: [...hint.countryCodes],
            worldwide: hint.worldwide,
            label: hintLabel,
            outcome: outcome ?? "noted",
            message: hintMessage,
            websitePlace: outcome === "conflict" ? websitePlace : null,
          },
        }
      : {}),
    ...(locationCount ? { locationCount } : {}),
  };

  // --- Legacy mirrors -----------------------------------------------------------
  const markets: Market[] = [];
  const pushMarket = (name: string | null | undefined, level: Market["level"], countryCode: string | null, marketConfidence: number, evidenceIds: string[]) => {
    if (!name) return;
    if (markets.some((m) => same(m.name, name) && m.level === level)) return;
    markets.push({ name, level, countryCode, confidence: marketConfidence, evidenceIds: evidenceIds.slice(0, 4), isPrimary: markets.length === 0 });
  };
  const ids = primaryPlace?.evidenceIds ?? [];
  const localFirst = scope === "hyperlocal" || scope === "local" || scope === "regional";
  if (primaryPlace && localFirst) {
    // Hyperlocal leads with the neighbourhood; local leads with the city but
    // keeps the neighbourhood, because "salon in DIFC" is still a real query.
    if (scope === "hyperlocal") pushMarket(primaryPlace.neighborhood, "neighborhood", primaryPlace.countryCode, confidence, ids);
    pushMarket(primaryPlace.city, "city", primaryPlace.countryCode, confidence, ids);
    if (scope === "local") pushMarket(primaryPlace.neighborhood, "neighborhood", primaryPlace.countryCode, Math.min(confidence, 85), ids);
    if (scope === "regional") for (const b of branches) pushMarket(b.city, "city", b.countryCode, b.confidence, b.evidenceIds);
    if (primaryPlace.region && !same(primaryPlace.region, primaryPlace.city)) pushMarket(primaryPlace.region, "region", primaryPlace.countryCode, confidence, ids);
    pushMarket(primaryPlace.country, "country", primaryPlace.countryCode, Math.max(confidence, 60), ids);
  } else {
    // Worldwide leads for a global business, so downstream readers of the
    // first market (the prompt context, the location card) see the market and
    // not the office country.
    if (scope === "global") pushMarket("Worldwide", "global", null, 60, []);
    for (const code of countries) pushMarket(countryName(code), "country", code, primaryPlace?.countryCode === code ? Math.max(confidence, 60) : 55, primaryPlace?.countryCode === code ? ids : []);
  }
  for (const area of serviceAreas) {
    if (markets.some((m) => same(m.name, area.name))) continue;
    const level: Market["level"] = area.level === "multi_country" ? "multi-country" : (["neighborhood", "district", "city", "region", "country", "global"].includes(area.level) ? area.level : "region") as Market["level"];
    pushMarket(area.name, level, primaryPlace?.countryCode ?? null, 60, area.evidenceIds);
  }

  const neighborhoods = [primaryPlace?.neighborhood, ...branches.map((b) => b.neighborhood)].filter((v): v is string => Boolean(v));
  // The geography mirror lists MARKETS. An online business's office city and
  // state are where it sits, not where it sells, so for a global one they are
  // left out (the office itself stays in `location.primary`).
  const officeIsMarket = placeBound || scope !== "global";
  const geography = {
    countries: [...new Set(markets.filter((m) => m.level === "country").map((m) => m.name))],
    regions: officeIsMarket ? [...new Set([primaryPlace?.region, ...branches.map((b) => b.region)].filter((v): v is string => Boolean(v)))].slice(0, 12) : [],
    cities: officeIsMarket ? [...new Set([primaryPlace?.city, ...branches.map((b) => b.city)].filter((v): v is string => Boolean(v)))].slice(0, 25) : [],
    neighborhoods: [...new Set(neighborhoods)].slice(0, 25),
    serviceAreaDescription: serviceAreas.length > 0 ? serviceAreas.map((a) => a.name).join(", ").slice(0, 200) : null,
  };

  return {
    location,
    markets: markets.slice(0, 16),
    scope: { value: scope, confidence: scope === "unknown" ? 0 : Math.max(40, Math.min(90, confidence)), evidenceIds: ids.slice(0, 4), rationale },
    geography,
    warnings,
  };
}

/**
 * Writes a resolved location and its mirrors onto a profile. Shared by the
 * understanding call and the rules-only fallback, so a hint given at intake
 * reaches the profile even when no model answered.
 */
export function applyLocationResult(profile: BusinessProfile, result: LocationResult): void {
  profile.location = result.location;
  if (result.markets.length > 0) {
    profile.markets = result.markets;
    profile.geography = {
      ...profile.geography,
      countries: result.geography.countries,
      regions: result.geography.regions,
      cities: result.geography.cities,
      neighborhoods: result.geography.neighborhoods,
      serviceAreaDescription: result.geography.serviceAreaDescription ?? profile.geography.serviceAreaDescription,
      source: result.location.source,
      evidenceIds: result.location.primary?.evidenceIds ?? [],
    };
  }
  if (result.scope.value !== "unknown") {
    profile.marketScope = { value: result.scope.value, source: result.location.source, evidenceIds: result.scope.evidenceIds, confidence: result.scope.confidence };
  }
}

function evidenceItems(evidence: EvidenceItem[], ids: string[]): EvidenceItem[] {
  const set = new Set(ids);
  return evidence.filter((e) => set.has(e.id));
}
