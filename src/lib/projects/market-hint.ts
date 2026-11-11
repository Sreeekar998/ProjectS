// The operator's answer to "Where are your customers?" on the intake page.
//
// Stored in `projects.market_scope` (text NOT NULL) with no migration. Before
// 2026-09-14 that column held a zod default ("global") or a script value
// ("US", "AE") that nothing read. Formats now:
//   "auto"                       no hint: "Detect from my website"
//   {"v":1,"countryCodes":[…],…}  an operator hint (JSON of MarketHint)
//   "global" / "AE" / "" / junk  legacy rows written before the operator was
//                                asked; they parse to null so old projects
//                                never start steering re-analysis
// The column's comment in db/schema.ts is deliberately left stale: editing that
// module reloads it in the user's running dev server.
//
// Only Understand reads the hint (resolveLocation). Landscape, Prompts, tiers
// and Search Console read the resulting `profile.location` instead.
//
// Client-safe: zod and geo helpers only.

import { z } from "zod";
import { countryName } from "@/lib/geo/countries";
import { isCountryCode } from "@/lib/geo/iso3166";
import { HintPlaceSchema, type HintPlace } from "@/lib/geo/schema";
import { placeLabel, precisionOf } from "@/lib/geo/types";

export { HintPlaceSchema, type HintPlace };

export const MARKET_HINT_MAX_COUNTRIES = 10;
export const MARKET_HINT_AREA_QUERY_MAX = 120;

export interface MarketHint {
  v: 1;
  /** First = primary market country. Empty when worldwide. ISO alpha-2, upper-case, at most 10. */
  countryCodes: string[];
  worldwide: boolean;
  /** Local area; requires exactly one country. `place` null = typed text that was not resolved (search offline). */
  area: { query: string; place: HintPlace | null } | null;
  source: "user";
  /** ISO timestamp, set by the server. */
  capturedAt: string;
}

/** What `POST /api/projects` accepts as `market` (no v/source/capturedAt). */
export const MarketHintInputSchema = z
  .object({
    countryCodes: z
      .array(z.string().trim().toUpperCase().refine((code) => isCountryCode(code), "unknown country code"))
      .max(MARKET_HINT_MAX_COUNTRIES)
      .default([]),
    worldwide: z.boolean().default(false),
    area: z
      .object({ query: z.string().trim().min(2).max(MARKET_HINT_AREA_QUERY_MAX), place: HintPlaceSchema.nullable() })
      .nullable()
      .default(null),
  })
  .superRefine((m, ctx) => {
    if (m.worldwide && (m.countryCodes.length > 0 || m.area)) {
      ctx.addIssue({ code: "custom", path: ["worldwide"], message: "Worldwide cannot be combined with a country or area" });
    }
    if (m.area && m.countryCodes.length !== 1) {
      ctx.addIssue({ code: "custom", path: ["area"], message: "An area needs exactly one country" });
    }
    if (m.area?.place?.countryCode && m.area.place.countryCode.trim().toUpperCase() !== m.countryCodes[0]) {
      ctx.addIssue({ code: "custom", path: ["area", "place", "countryCode"], message: "The area is not in the chosen country" });
    }
    if (new Set(m.countryCodes).size !== m.countryCodes.length) {
      ctx.addIssue({ code: "custom", path: ["countryCodes"], message: "Duplicate country" });
    }
  });

export type MarketHintInput = z.infer<typeof MarketHintInputSchema>;

function cleanCodes(values: unknown): string[] {
  if (!Array.isArray(values)) return [];
  const out: string[] = [];
  for (const value of values) {
    if (typeof value !== "string") continue;
    const code = value.trim().toUpperCase();
    if (!isCountryCode(code) || out.includes(code)) continue;
    out.push(code);
    if (out.length === MARKET_HINT_MAX_COUNTRIES) break;
  }
  return out;
}

function cleanText(value: string | null | undefined, max = 300): string | null {
  if (typeof value !== "string") return null;
  const trimmed = value.replace(/\s+/g, " ").trim();
  return trimmed ? trimmed.slice(0, max) : null;
}

function cleanQuery(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const query = value.replace(/\s+/g, " ").trim().slice(0, MARKET_HINT_AREA_QUERY_MAX);
  return query.length >= 2 ? query : null;
}

/**
 * Server-side normalisation of an operator place: the country comes from the
 * chosen code, and the label and precision are recomputed rather than trusted
 * from the browser. Null when the place is in another country.
 */
function normalizeHintPlace(place: HintPlace, countryCode: string): HintPlace | null {
  const placeCountry = place.countryCode?.trim().toUpperCase() || countryCode;
  if (placeCountry !== countryCode) return null;
  const levels = {
    premise: cleanText(place.premise),
    street: cleanText(place.street),
    neighborhood: cleanText(place.neighborhood),
    district: cleanText(place.district),
    city: cleanText(place.city),
    region: cleanText(place.region),
    country: countryName(countryCode) ?? cleanText(place.country),
  };
  return {
    label: placeLabel(levels) || cleanText(place.label) || "",
    formattedAddress: place.formattedAddress && place.formattedAddress.length <= 300 ? cleanText(place.formattedAddress) : null,
    ...levels,
    countryCode,
    postalCode: cleanText(place.postalCode, 40),
    lat: place.lat,
    lng: place.lng,
    precision: precisionOf(levels),
    provider: place.provider,
    providerId: cleanText(place.providerId),
  };
}

/** Builds the stored hint from validated input. An empty choice ("Detect from my website") → null. */
export function buildMarketHint(input: MarketHintInput, now: Date = new Date()): MarketHint | null {
  const worldwide = input.worldwide === true;
  const countryCodes = worldwide ? [] : cleanCodes(input.countryCodes);
  if (!worldwide && countryCodes.length === 0) return null;
  let area: MarketHint["area"] = null;
  const onlyCountry = countryCodes.length === 1 ? countryCodes[0] : undefined;
  if (!worldwide && input.area && onlyCountry) {
    const query = cleanQuery(input.area.query);
    if (query) {
      if (!input.area.place) area = { query, place: null };
      else {
        const place = normalizeHintPlace(input.area.place, onlyCountry);
        if (place) area = { query, place };
      }
    }
  }
  return { v: 1, countryCodes, worldwide, area, source: "user", capturedAt: now.toISOString() };
}

/** The value written to `projects.market_scope`. */
export function serializeMarketHint(hint: MarketHint | null): string {
  if (!hint) return "auto";
  return JSON.stringify({
    v: 1,
    countryCodes: hint.countryCodes,
    worldwide: hint.worldwide,
    area: hint.area,
    source: "user",
    capturedAt: hint.capturedAt,
  });
}

/** Reads `projects.market_scope`. Never throws: legacy values, junk and other versions → null. */
export function parseMarketHint(raw: string | null | undefined): MarketHint | null {
  if (typeof raw !== "string") return null;
  const trimmed = raw.trim();
  if (!trimmed.startsWith("{")) return null;
  let value: unknown;
  try {
    value = JSON.parse(trimmed);
  } catch {
    return null;
  }
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const record = value as Record<string, unknown>;
  if (record.v !== 1) return null;

  const worldwide = record.worldwide === true;
  const countryCodes = worldwide ? [] : cleanCodes(record.countryCodes);
  if (!worldwide && countryCodes.length === 0) return null;

  let area: MarketHint["area"] = null;
  const rawArea = record.area as { query?: unknown; place?: unknown } | null | undefined;
  const onlyCountry = countryCodes.length === 1 ? countryCodes[0] : undefined;
  if (!worldwide && onlyCountry && rawArea && typeof rawArea === "object") {
    const query = cleanQuery(rawArea.query);
    if (query) {
      if (rawArea.place === null || rawArea.place === undefined) area = { query, place: null };
      else {
        const parsed = HintPlaceSchema.safeParse(rawArea.place);
        // An area in a different country than the hint's is dropped, not repaired.
        if (parsed.success && (parsed.data.countryCode || onlyCountry).toUpperCase() === onlyCountry) {
          area = { query, place: parsed.data };
        }
      }
    }
  }
  return {
    v: 1,
    countryCodes,
    worldwide,
    area,
    source: "user",
    capturedAt: typeof record.capturedAt === "string" ? record.capturedAt : "",
  };
}

/**
 * Legacy `marketScope` strings from scripts and tests: an ISO alpha-2 code
 * becomes a country hint; "global" and anything else means no hint.
 */
export function marketHintFromLegacy(v?: string): MarketHint | null {
  if (typeof v !== "string") return null;
  const trimmed = v.trim();
  if (!/^[A-Za-z]{2}$/.test(trimmed) || !isCountryCode(trimmed)) return null;
  return { v: 1, countryCodes: [trimmed.toUpperCase()], worldwide: false, area: null, source: "user", capturedAt: new Date().toISOString() };
}

/** "DIFC, Dubai, United Arab Emirates" | "United States" | "United Arab Emirates, Saudi Arabia" | "Worldwide". */
export function describeMarketHint(h: MarketHint): string {
  if (h.worldwide) return "Worldwide";
  const primary = h.countryCodes[0];
  if (h.area) {
    if (h.area.place?.label) return h.area.place.label;
    const country = primary ? countryName(primary) : null;
    return country && !h.area.query.toLowerCase().includes(country.toLowerCase()) ? `${h.area.query}, ${country}` : h.area.query;
  }
  return h.countryCodes.map((code) => countryName(code) ?? code).join(", ");
}

/** The primary market country of a hint, or null. */
export function hintCountry(h: MarketHint | null): string | null {
  return h?.countryCodes[0] ?? null;
}
