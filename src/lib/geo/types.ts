// Provider-agnostic place model. Client-safe: imported by the Understand page.
//
// One shape for every source of location — the business's own website, a
// model reading it, OpenStreetMap, Google, or the operator typing a correction
// — so the pipeline can reconcile them field by field instead of trusting one.
// Every level is optional because real evidence is uneven: a SaaS company may
// only reveal a country, a salon its street and district.

export const GEO_LEVELS = ["country", "region", "city", "district", "neighborhood", "street", "premise"] as const;
export type GeoLevel = (typeof GEO_LEVELS)[number];

export type GeoProviderId = "website" | "llm" | "nominatim" | "photon" | "google" | "user";

export interface GeoPlace {
  /** Short human label, finest meaningful level first: "DIFC, Dubai, United Arab Emirates". */
  label: string;
  formattedAddress: string | null;
  /** Building, floor, unit or landmark building ("Staybridge Suites, 6th Floor"). */
  premise: string | null;
  street: string | null;
  /** Community, neighbourhood or area as locals say it ("DIFC", "Dubai Marina", "Koramangala"). */
  neighborhood: string | null;
  /** Larger city subdivision when distinct from the neighbourhood ("Trade Centre", "Brooklyn"). */
  district: string | null;
  city: string | null;
  /** State, province, emirate or county. */
  region: string | null;
  country: string | null;
  /** ISO 3166-1 alpha-2, uppercase. */
  countryCode: string | null;
  postalCode: string | null;
  lat: number | null;
  lng: number | null;
  /** Finest level this place is known at. */
  precision: GeoLevel | null;
  provider: GeoProviderId;
  /** Google place_id, OSM "relation/123", or null. */
  providerId: string | null;
  /** 0-100, computed by the pipeline, never self-reported by a model. */
  confidence: number;
  evidenceIds: string[];
}

export interface GeoSuggestion {
  id: string;
  /** Main line: the place's own name. */
  title: string;
  /** Secondary line: its parents ("Dubai, United Arab Emirates"). */
  subtitle: string;
  level: GeoLevel;
  place: GeoPlace;
}

export function emptyPlace(provider: GeoProviderId): GeoPlace {
  return {
    label: "",
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
    provider,
    providerId: null,
    confidence: 0,
    evidenceIds: [],
  };
}

/** Finest populated level of a place. */
export function precisionOf(place: Pick<GeoPlace, GeoLevel>): GeoLevel | null {
  for (const level of [...GEO_LEVELS].reverse()) {
    if (place[level]) return level;
  }
  return null;
}

/** "DIFC, Dubai, United Arab Emirates" — neighbourhood → city → country, de-duplicated. */
export function placeLabel(place: Pick<GeoPlace, "neighborhood" | "district" | "city" | "region" | "country">): string {
  const parts: string[] = [];
  // Finest area, then the city (the region only when there is no city), then
  // the country: "Jumeirah 1, Dubai, United Arab Emirates", not "…, Dubai Emirate, …".
  for (const value of [place.neighborhood ?? place.district, place.city ?? place.region, place.country]) {
    if (!value) continue;
    const normalized = value.trim().toLowerCase();
    if (parts.some((p) => p.toLowerCase() === normalized)) continue;
    parts.push(value.trim());
  }
  // A region equal to its city ("Dubai, Dubai") or a district that merely
  // repeats the neighbourhood reads as noise; the de-duplication above covers
  // exact repeats, and three parts are enough for a label.
  return parts.length > 3 ? [parts[0], parts[parts.length - 2], parts[parts.length - 1]].join(", ") : parts.join(", ");
}

/** Hierarchy from broadest to finest, for display and prompt geography. */
export function placeHierarchy(place: Pick<GeoPlace, GeoLevel>): Array<{ level: GeoLevel; name: string }> {
  const out: Array<{ level: GeoLevel; name: string }> = [];
  const seen = new Set<string>();
  for (const level of GEO_LEVELS) {
    const name = place[level];
    if (!name) continue;
    const key = name.trim().toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    out.push({ level, name: name.trim() });
  }
  return out;
}
