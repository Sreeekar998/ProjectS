// Geocoding, reverse geocoding and place autocomplete.
//
// Provider order is decided by what the operator has configured:
//   * Google Maps Platform (GOOGLE_MAPS_API_KEY): Places Autocomplete (New),
//     Place Details and Geocoding. Densest data for Gulf, Indian and SE Asian
//     neighbourhoods. Google's terms allow storing place IDs, and Geocoding
//     results for the operator's own business; nothing here stores Places
//     display fields for other businesses.
//   * OpenStreetMap, keyless: Photon (komoot) for type-ahead suggestions and
//     Nominatim for geocoding. Nominatim forbids autocomplete and allows one
//     request per second, so it is only used for single lookups, serialised
//     through a queue, and cached.
//
// Every call has a short timeout and never throws: location resolution must
// degrade to "what the website says" rather than stall onboarding.

import { emptyPlace, placeLabel, precisionOf, type GeoLevel, type GeoPlace, type GeoSuggestion } from "./types";
import { countryName } from "./countries";
import { geoCacheGet, geoCacheSet } from "./cache";

const USER_AGENT = "ProjectSun-Onboarding/1.0 (business location resolution; low volume; cached)";
const TIMEOUT_MS = 6_000;

function googleKey(): string | null {
  const key = process.env.GOOGLE_MAPS_API_KEY?.trim();
  return key ? key : null;
}

export function geoProviderName(): "google" | "openstreetmap" {
  return googleKey() ? "google" : "openstreetmap";
}

async function fetchJson(url: string, init: RequestInit = {}, timeoutMs = TIMEOUT_MS): Promise<unknown | null> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const res = await fetch(url, { ...init, signal: controller.signal, headers: { "user-agent": USER_AGENT, accept: "application/json", ...(init.headers ?? {}) } });
    if (!res.ok) return null;
    return await res.json();
  } catch {
    return null;
  } finally {
    clearTimeout(timer);
  }
}

// --- Nominatim (1 request per second, serialised) --------------------------

let nominatimChain: Promise<unknown> = Promise.resolve();
let lastNominatimAt = 0;

function nominatim<T>(url: string): Promise<T | null> {
  const run = async () => {
    const wait = Math.max(0, lastNominatimAt + 1100 - Date.now());
    if (wait > 0) await new Promise((r) => setTimeout(r, wait));
    lastNominatimAt = Date.now();
    return (await fetchJson(url)) as T | null;
  };
  const next = nominatimChain.then(run, run);
  nominatimChain = next.catch(() => undefined);
  return next;
}

interface NominatimResult {
  osm_type?: string;
  osm_id?: number;
  lat?: string;
  lon?: string;
  display_name?: string;
  addresstype?: string;
  name?: string;
  address?: Record<string, string>;
}

function fromNominatim(result: NominatimResult): GeoPlace {
  const a = result.address ?? {};
  const place = emptyPlace("nominatim");
  place.premise = a.building ?? a.amenity ?? a.shop ?? null;
  place.street = [a.house_number, a.road].filter(Boolean).join(" ") || null;
  place.neighborhood = a.neighbourhood ?? a.quarter ?? a.residential ?? (a.suburb && a.city_district ? a.suburb : null) ?? null;
  place.district = a.city_district ?? a.borough ?? a.suburb ?? null;
  place.city = a.city ?? a.town ?? a.village ?? a.municipality ?? null;
  place.region = a.state ?? a.state_district ?? a.county ?? a.region ?? null;
  place.countryCode = a.country_code ? a.country_code.toUpperCase() : null;
  place.country = a.country ?? countryName(place.countryCode);
  place.postalCode = a.postcode ?? null;
  place.lat = result.lat ? Number(result.lat) : null;
  place.lng = result.lon ? Number(result.lon) : null;
  place.formattedAddress = result.display_name ?? null;
  place.providerId = result.osm_type && result.osm_id ? `${result.osm_type}/${result.osm_id}` : null;
  place.precision = precisionOf(place);
  place.label = placeLabel(place);
  return place;
}

// --- Photon (autocomplete) --------------------------------------------------

interface PhotonFeature {
  geometry?: { coordinates?: [number, number] };
  properties?: Record<string, string | number | undefined>;
}

const PHOTON_LEVEL: Record<string, GeoLevel> = {
  country: "country",
  state: "region",
  county: "region",
  city: "city",
  district: "district",
  locality: "neighborhood",
  street: "street",
  house: "premise",
  other: "premise",
};

function fromPhoton(feature: PhotonFeature): GeoSuggestion | null {
  const p = feature.properties ?? {};
  const name = typeof p.name === "string" ? p.name : null;
  const type = typeof p.type === "string" ? p.type : "other";
  const level = PHOTON_LEVEL[type] ?? "premise";
  const place = emptyPlace("photon");
  place.countryCode = typeof p.countrycode === "string" ? p.countrycode.toUpperCase() : null;
  place.country = (p.country as string) ?? countryName(place.countryCode);
  place.region = (p.state as string) ?? (p.county as string) ?? null;
  place.city = (p.city as string) ?? null;
  place.district = (p.district as string) ?? null;
  place.neighborhood = (p.locality as string) ?? null;
  place.street = [p.housenumber, p.street].filter(Boolean).join(" ") || null;
  place.postalCode = (p.postcode as string) ?? null;
  // The feature's own name belongs to its own level.
  if (name) {
    if (level === "country") place.country = name;
    else if (level === "region") place.region = name;
    else if (level === "city") place.city = name;
    else if (level === "district") place.district = place.district ?? name;
    else if (level === "neighborhood") place.neighborhood = name;
    else if (level === "street") place.street = name;
    else place.premise = name;
    if (level === "district" && place.district !== name) place.neighborhood = name;
  }
  const coords = feature.geometry?.coordinates;
  place.lng = coords?.[0] ?? null;
  place.lat = coords?.[1] ?? null;
  place.providerId = p.osm_type && p.osm_id ? `${p.osm_type}/${p.osm_id}` : null;
  place.precision = precisionOf(place);
  place.label = placeLabel(place);
  if (!name && !place.label) return null;
  const title = name ?? place.label;
  const parents = placeLabel({ ...place, neighborhood: level === "neighborhood" ? null : place.neighborhood, district: level === "district" ? null : place.district, city: level === "city" ? null : place.city, region: level === "region" ? null : place.region, country: level === "country" ? null : place.country });
  return { id: place.providerId ?? `${title}|${place.lat}|${place.lng}`, title, subtitle: parents, level, place };
}

// --- Google ---------------------------------------------------------------

interface GoogleAddressComponent {
  longText?: string;
  long_name?: string;
  shortText?: string;
  short_name?: string;
  types?: string[];
}

function fromGoogleComponents(components: GoogleAddressComponent[], base: GeoPlace): GeoPlace {
  const pick = (...types: string[]) => {
    for (const type of types) {
      const hit = components.find((c) => c.types?.includes(type));
      if (hit) return hit.longText ?? hit.long_name ?? null;
    }
    return null;
  };
  const country = components.find((c) => c.types?.includes("country"));
  base.countryCode = (country?.shortText ?? country?.short_name ?? "").toUpperCase() || null;
  base.country = country?.longText ?? country?.long_name ?? countryName(base.countryCode);
  base.region = pick("administrative_area_level_1");
  base.city = pick("locality", "postal_town", "administrative_area_level_2");
  base.district = pick("sublocality_level_1", "sublocality");
  base.neighborhood = pick("neighborhood", "sublocality_level_2", "sublocality_level_3") ?? null;
  base.street = [pick("street_number"), pick("route")].filter(Boolean).join(" ") || null;
  base.premise = pick("premise", "subpremise", "establishment");
  base.postalCode = pick("postal_code");
  base.precision = precisionOf(base);
  base.label = placeLabel(base);
  return base;
}

// --- Public API -------------------------------------------------------------

export interface AutocompleteOptions {
  near?: { lat: number; lng: number } | null;
  countryCode?: string | null;
  /** Only suggestions inside `countryCode` (the intake area field). Google filters server-side already. */
  strict?: boolean;
  sessionToken?: string | null;
}

export async function autocompletePlaces(query: string, options: AutocompleteOptions = {}): Promise<GeoSuggestion[]> {
  return (await searchPlaces(query, options)).suggestions;
}

export interface PlaceSearchResult {
  suggestions: GeoSuggestion[];
  /** Every provider request failed (as opposed to answering with no matches). */
  unavailable: boolean;
}

/** `autocompletePlaces`, telling "the provider is down" apart from "nothing matches". */
export async function searchPlaces(query: string, options: AutocompleteOptions = {}): Promise<PlaceSearchResult> {
  const q = query.trim();
  if (q.length < 2) return { suggestions: [], unavailable: false };
  const key = googleKey();
  if (key) {
    const body: Record<string, unknown> = { input: q, languageCode: "en" };
    if (options.countryCode) body.includedRegionCodes = [options.countryCode.toLowerCase()];
    if (options.near) body.locationBias = { circle: { center: { latitude: options.near.lat, longitude: options.near.lng }, radius: 50_000 } };
    if (options.sessionToken) body.sessionToken = options.sessionToken;
    const json = (await fetchJson("https://places.googleapis.com/v1/places:autocomplete", {
      method: "POST",
      headers: { "content-type": "application/json", "X-Goog-Api-Key": key },
      body: JSON.stringify(body),
    })) as { suggestions?: Array<{ placePrediction?: { placeId?: string; types?: string[]; structuredFormat?: { mainText?: { text?: string }; secondaryText?: { text?: string } }; text?: { text?: string } } }> } | null;
    const out: GeoSuggestion[] = [];
    for (const suggestion of json?.suggestions ?? []) {
      const prediction = suggestion.placePrediction;
      if (!prediction?.placeId) continue;
      const types = prediction.types ?? [];
      const level: GeoLevel = types.includes("country")
        ? "country"
        : types.includes("administrative_area_level_1")
          ? "region"
          : types.includes("locality")
            ? "city"
            : types.some((t) => t.startsWith("sublocality"))
              ? "district"
              : types.includes("neighborhood")
                ? "neighborhood"
                : types.includes("route")
                  ? "street"
                  : "premise";
      const place = emptyPlace("google");
      place.providerId = prediction.placeId;
      place.label = prediction.text?.text ?? prediction.structuredFormat?.mainText?.text ?? "";
      out.push({ id: prediction.placeId, title: prediction.structuredFormat?.mainText?.text ?? place.label, subtitle: prediction.structuredFormat?.secondaryText?.text ?? "", level, place });
    }
    if (out.length > 0) return { suggestions: out, unavailable: false };
  }

  // Photon has no documented country filter, so the country is applied to the
  // results. It used to be applied only on a cache miss and the cache key
  // ignored the country: a query first searched without a country came back
  // from the cache unfiltered. The cache now holds the raw list per request,
  // and the country re-order or strict filter runs after every read.
  const countryCode = options.countryCode?.trim().toUpperCase() || null;
  const strict = Boolean(options.strict && countryCode);
  const primary = await photonSuggestions(q, options.near ?? null, countryCode, strict);
  // A failed request used to look like "no results": a strict search then
  // spent a second 6 s timeout on the country-name retry, and the intake said
  // "No places match" during an outage instead of "unavailable".
  if (primary === null) return { suggestions: [], unavailable: true };
  const done = (suggestions: GeoSuggestion[]): PlaceSearchResult => ({ suggestions, unavailable: false });
  if (!countryCode) return done(primary);
  const inCountry = primary.filter((s) => s.place.countryCode === countryCode);
  if (!strict) return done(inCountry.length > 0 ? [...inCountry, ...primary.filter((s) => !inCountry.includes(s))] : primary);
  if (inCountry.length >= 3) return done(inCountry);
  // An area name typed alone is often outranked by same-named places in other
  // countries; one retry with the country name appended finds the local one.
  const name = countryName(countryCode);
  if (!name || q.toLowerCase().includes(name.toLowerCase())) return done(inCountry);
  const retry = ((await photonSuggestions(`${q}, ${name}`, options.near ?? null, countryCode, strict)) ?? []).filter((s) => s.place.countryCode === countryCode);
  const merged = [...inCountry];
  for (const suggestion of retry) if (!merged.some((existing) => existing.id === suggestion.id)) merged.push(suggestion);
  return done(merged);
}

/** One Photon request (raw, unfiltered results), cached per request and country. `null` when the request failed. */
async function photonSuggestions(q: string, near: { lat: number; lng: number } | null, countryCode: string | null, strict: boolean): Promise<GeoSuggestion[] | null> {
  // A country with no coordinate bias asks for more results, so filtering to
  // the country still leaves a useful list.
  const params = new URLSearchParams({ q, limit: countryCode && !near ? "15" : "8", lang: "en" });
  if (near) {
    params.set("lat", String(near.lat));
    params.set("lon", String(near.lng));
  }
  const cacheKey = `photon:${params.toString()}|country=${countryCode ?? ""}|strict=${strict ? 1 : 0}`;
  const cached = geoCacheGet<GeoSuggestion[]>(cacheKey);
  if (cached) return cached;
  const json = (await fetchJson(`https://photon.komoot.io/api/?${params.toString()}`)) as { features?: PhotonFeature[] } | null;
  if (json === null) return null;
  const suggestions = (json.features ?? []).map(fromPhoton).filter((s): s is GeoSuggestion => Boolean(s));
  if (suggestions.length > 0) geoCacheSet(cacheKey, suggestions);
  return suggestions;
}

/** Full details for a suggestion (only Google suggestions need a second call). */
export async function placeDetails(suggestion: GeoSuggestion, sessionToken?: string | null): Promise<GeoPlace> {
  const key = googleKey();
  if (suggestion.place.provider !== "google" || !key || !suggestion.place.providerId) return suggestion.place;
  const url = `https://places.googleapis.com/v1/places/${encodeURIComponent(suggestion.place.providerId)}?languageCode=en${sessionToken ? `&sessionToken=${encodeURIComponent(sessionToken)}` : ""}`;
  const json = (await fetchJson(url, { headers: { "X-Goog-Api-Key": key, "X-Goog-FieldMask": "id,addressComponents,location,formattedAddress,types" } })) as {
    addressComponents?: GoogleAddressComponent[];
    location?: { latitude?: number; longitude?: number };
    formattedAddress?: string;
  } | null;
  if (!json) return suggestion.place;
  const place = fromGoogleComponents(json.addressComponents ?? [], { ...suggestion.place });
  place.lat = json.location?.latitude ?? null;
  place.lng = json.location?.longitude ?? null;
  place.formattedAddress = json.formattedAddress ?? null;
  return place;
}

/** Forward geocoding of free text ("Staybridge Suites, Sheikh Zayed Road, Dubai"). */
export async function geocodeText(text: string, countryCode?: string | null): Promise<GeoPlace | null> {
  const q = text.replace(/\s+/g, " ").trim().slice(0, 240);
  if (q.length < 3) return null;
  const cacheKey = `geocode:${googleKey() ? "g" : "n"}:${countryCode ?? ""}:${q.toLowerCase()}`;
  const cached = geoCacheGet<GeoPlace | null>(cacheKey);
  if (cached !== undefined) return cached;

  const key = googleKey();
  let place: GeoPlace | null = null;
  if (key) {
    const params = new URLSearchParams({ address: q, language: "en", key });
    if (countryCode) params.set("components", `country:${countryCode}`);
    const json = (await fetchJson(`https://maps.googleapis.com/maps/api/geocode/json?${params.toString()}`)) as {
      results?: Array<{ place_id?: string; formatted_address?: string; address_components?: GoogleAddressComponent[]; geometry?: { location?: { lat?: number; lng?: number } } }>;
    } | null;
    const first = json?.results?.[0];
    if (first) {
      place = fromGoogleComponents(first.address_components ?? [], emptyPlace("google"));
      place.providerId = first.place_id ?? null;
      place.formattedAddress = first.formatted_address ?? null;
      place.lat = first.geometry?.location?.lat ?? null;
      place.lng = first.geometry?.location?.lng ?? null;
    }
  } else {
    const params = new URLSearchParams({ q, format: "jsonv2", addressdetails: "1", limit: "1", "accept-language": "en" });
    if (countryCode) params.set("countrycodes", countryCode.toLowerCase());
    const json = await nominatim<NominatimResult[]>(`https://nominatim.openstreetmap.org/search?${params.toString()}`);
    const first = json?.[0];
    if (first) place = fromNominatim(first);
  }
  geoCacheSet(cacheKey, place);
  return place;
}

/** Reverse geocoding of coordinates to a place with neighbourhood and city. */
export async function reverseGeocode(lat: number, lng: number): Promise<GeoPlace | null> {
  if (!Number.isFinite(lat) || !Number.isFinite(lng)) return null;
  const cacheKey = `reverse:${googleKey() ? "g" : "n"}:${lat.toFixed(4)},${lng.toFixed(4)}`;
  const cached = geoCacheGet<GeoPlace | null>(cacheKey);
  if (cached !== undefined) return cached;
  const key = googleKey();
  let place: GeoPlace | null = null;
  if (key) {
    const json = (await fetchJson(`https://maps.googleapis.com/maps/api/geocode/json?latlng=${lat},${lng}&language=en&key=${key}`)) as {
      results?: Array<{ place_id?: string; formatted_address?: string; address_components?: GoogleAddressComponent[] }>;
    } | null;
    const first = json?.results?.[0];
    if (first) {
      place = fromGoogleComponents(first.address_components ?? [], emptyPlace("google"));
      place.providerId = first.place_id ?? null;
      place.formattedAddress = first.formatted_address ?? null;
      place.lat = lat;
      place.lng = lng;
    }
  } else {
    const json = await nominatim<NominatimResult>(`https://nominatim.openstreetmap.org/reverse?lat=${lat}&lon=${lng}&format=jsonv2&addressdetails=1&zoom=16&accept-language=en`);
    if (json && json.address) place = fromNominatim(json);
  }
  geoCacheSet(cacheKey, place);
  return place;
}
