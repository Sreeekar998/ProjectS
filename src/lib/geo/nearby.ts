// Nearby businesses of a category from OpenStreetMap (Overpass API).
//
// Keyless, open data (ODbL; attribution "© OpenStreetMap contributors"), and
// queried through the public Overpass API within its fair-use policy: one
// small radius query per discovery run, cached for 30 days. Coverage is uneven
// — well mapped in European and Gulf city centres, thin elsewhere — so this is
// one source among several, never the only one.

import { geoCacheGet, geoCacheSet } from "./cache";

// Public instances, tried in order. The main instance answers busy periods
// with an XML "rate limited / timeout" page instead of JSON.
// Public instances with per-attempt timeouts. On 2026-09-13 the main instance
// answered 504 or 429 (per-IP slots) during busy periods, the mail.ru mirror
// answered in about 27 s and kumi.systems timed out, so this source is
// best-effort and a miss simply contributes no candidates.
const OVERPASS_ENDPOINTS: Array<{ url: string; timeoutMs: number }> = [
  { url: "https://overpass-api.de/api/interpreter", timeoutMs: 10_000 },
  { url: "https://maps.mail.ru/osm/tools/overpass/api/interpreter", timeoutMs: 40_000 },
  { url: "https://overpass.kumi.systems/api/interpreter", timeoutMs: 15_000 },
];
const USER_AGENT = "ProjectSun/2.0 (local-first AI visibility research; competitor discovery)";
const ALLOWED_KEYS = new Set(["shop", "amenity", "craft", "office", "leisure", "tourism", "healthcare", "beauty", "cuisine", "club", "sport"]);

export interface OsmTagFilter {
  key: string;
  value: string;
}

export interface NearbyPlace {
  osmId: string;
  name: string;
  website: string | null;
  tags: Record<string, string>;
  matchedFilter: string;
  lat: number;
  lng: number;
  distanceMeters: number;
  suburb: string | null;
  city: string | null;
}

export function sanitizeTagFilters(filters: OsmTagFilter[]): OsmTagFilter[] {
  const out: OsmTagFilter[] = [];
  for (const filter of filters) {
    const key = filter.key.trim().toLowerCase();
    const value = filter.value.trim().toLowerCase();
    if (!ALLOWED_KEYS.has(key) || !/^[a-z0-9_;:-]{2,40}$/.test(value)) continue;
    if (out.some((f) => f.key === key && f.value === value)) continue;
    out.push({ key, value });
    if (out.length >= 5) break;
  }
  return out;
}

export function distanceMeters(a: { lat: number; lng: number }, b: { lat: number; lng: number }): number {
  const rad = Math.PI / 180;
  const dLat = (b.lat - a.lat) * rad;
  const dLng = (b.lng - a.lng) * rad;
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(a.lat * rad) * Math.cos(b.lat * rad) * Math.sin(dLng / 2) ** 2;
  return 2 * 6_371_000 * Math.asin(Math.sqrt(h));
}

/** Named places matching any filter within `radius` metres of the point, nearest first. */
export async function findNearbyPlaces(center: { lat: number; lng: number }, filters: OsmTagFilter[], radius: number, timeoutMs = 40_000): Promise<NearbyPlace[]> {
  const clean = sanitizeTagFilters(filters);
  if (clean.length === 0 || !Number.isFinite(center.lat) || !Number.isFinite(center.lng)) return [];
  const lat = center.lat.toFixed(5);
  const lng = center.lng.toFixed(5);
  const cacheKey = `overpass:${lat},${lng}:${radius}:${clean.map((f) => `${f.key}=${f.value}`).join("|")}`;
  const cached = geoCacheGet<NearbyPlace[]>(cacheKey);
  if (cached) return cached;

  // Area filter first, then tags: the tag-first form timed out on the public
  // instance for a 2 km query that the area-first form answered in under 2 s.
  const body = `[out:json][timeout:20];(${clean.map((f) => `nwr(around:${Math.round(radius)},${lat},${lng})["${f.key}"="${f.value}"]["name"];`).join("")});out center tags 120;`;
  type OverpassJson = { elements?: Array<{ type: string; id: number; lat?: number; lon?: number; center?: { lat: number; lon: number }; tags?: Record<string, string> }> };
  let json: OverpassJson | null = null;
  for (const endpoint of OVERPASS_ENDPOINTS) {
    const url = endpoint.url;
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), Math.min(endpoint.timeoutMs, timeoutMs));
    try {
      const res = await fetch(url, {
        method: "POST",
        headers: { "content-type": "application/x-www-form-urlencoded", "user-agent": USER_AGENT, accept: "application/json" },
        body: `data=${encodeURIComponent(body)}`,
        signal: controller.signal,
      });
      if (!res.ok || !(res.headers.get("content-type") ?? "").includes("json")) continue;
      json = (await res.json()) as OverpassJson;
      break;
    } catch {
      // Try the next instance.
    } finally {
      clearTimeout(timer);
    }
  }
  if (!json) return [];
  {
    const seen = new Set<string>();
    const places: NearbyPlace[] = [];
    for (const element of json.elements ?? []) {
      const tags = element.tags ?? {};
      const name = (tags["name:en"] || tags.name || "").trim();
      const pLat = element.lat ?? element.center?.lat;
      const pLng = element.lon ?? element.center?.lon;
      if (!name || pLat === undefined || pLng === undefined) continue;
      const key = name.toLowerCase().replace(/[^\p{L}\p{N}]+/gu, "");
      if (seen.has(key)) continue;
      seen.add(key);
      const matched = clean.find((f) => tags[f.key] === f.value);
      places.push({
        osmId: `${element.type}/${element.id}`,
        name,
        website: tags.website || tags["contact:website"] || null,
        tags: Object.fromEntries(Object.entries(tags).filter(([k]) => /^(shop|amenity|craft|office|leisure|tourism|healthcare|beauty|cuisine|brand|operator|addr:suburb|addr:city|addr:street|opening_hours)$/.test(k))),
        matchedFilter: matched ? `${matched.key}=${matched.value}` : "",
        lat: pLat,
        lng: pLng,
        distanceMeters: Math.round(distanceMeters(center, { lat: pLat, lng: pLng })),
        suburb: tags["addr:suburb"] || null,
        city: tags["addr:city"] || null,
      });
    }
    places.sort((a, b) => a.distanceMeters - b.distanceMeters);
    geoCacheSet(cacheKey, places);
    return places;
  }
}
