// Shared zod shapes for places that cross the API boundary.
//
// These lived inline in `api/geo/place/route.ts`. The intake page now sends an
// operator-chosen place in `POST /api/projects` too, so both routes (and the
// market hint parser) validate against one definition instead of two copies
// that drift. Lengths and ranges are unchanged from the original route.
//
// Client-safe: zod and geo types only.

import { z } from "zod";
import { GEO_LEVELS, type GeoPlace } from "./types";

const text = z.string().max(300).nullable();

export const GEO_PROVIDER_IDS = ["website", "llm", "nominatim", "photon", "google", "user"] as const;

/** The subset of a GeoPlace an operator can hand us: no evidence ids, no confidence. */
export const HintPlaceSchema = z.object({
  label: z.string().max(300),
  formattedAddress: text,
  premise: text,
  street: text,
  neighborhood: text,
  district: text,
  city: text,
  region: text,
  country: text,
  countryCode: text,
  postalCode: text,
  lat: z.number().min(-90).max(90).nullable(),
  lng: z.number().min(-180).max(180).nullable(),
  precision: z.enum(GEO_LEVELS).nullable(),
  provider: z.enum(GEO_PROVIDER_IDS),
  providerId: text,
});

export type HintPlace = z.infer<typeof HintPlaceSchema>;

/** A full place as returned by the geo providers. */
export const GeoPlaceSchema = HintPlaceSchema.extend({
  confidence: z.number().min(0).max(100),
  evidenceIds: z.array(z.string().max(100)).max(50),
});

/** One autocomplete suggestion, as posted back to `POST /api/geo/place`. */
export const GeoSuggestionSchema = z.object({
  id: z.string().max(300),
  title: z.string().max(300),
  subtitle: z.string().max(300),
  level: z.enum(GEO_LEVELS),
  place: GeoPlaceSchema,
});

// Compile-time guards: the schemas must stay assignable to the shared types,
// so a field added to GeoPlace fails here rather than being silently stripped.
type HintPlaceKeys = "label" | "formattedAddress" | "premise" | "street" | "neighborhood" | "district" | "city" | "region" | "country" | "countryCode" | "postalCode" | "lat" | "lng" | "precision" | "provider" | "providerId";
const _hintPlaceMatchesGeoPlace: Pick<GeoPlace, HintPlaceKeys> = {} as HintPlace;
const _geoPlaceMatches: GeoPlace = {} as z.infer<typeof GeoPlaceSchema>;
void _hintPlaceMatchesGeoPlace;
void _geoPlaceMatches;
