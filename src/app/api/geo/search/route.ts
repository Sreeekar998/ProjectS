import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { countryCodeFrom } from "@/lib/geo/countries";
import { geoProviderName, searchPlaces } from "@/lib/geo/providers";
import { withErrorHandling } from "@/lib/http/respond";

// Type-ahead place search for the intake "Area or city" field and the
// Understand page's "Change location" editor. Only the query, a country, a
// coordinate bias and the per-edit session token reach the geo provider;
// nothing about the project is forwarded, and nothing is logged.

const optionalNumber = (min: number, max: number) =>
  z.preprocess((v) => (v === "" || v === null || v === undefined ? undefined : Number(v)), z.number().min(min).max(max).optional());

const SearchQuerySchema = z
  .object({
    q: z.string().trim().min(2).max(120),
    // Any two letters used to pass, so "UK" silently searched nothing. Rejecting
    // non-ISO codes instead broke "Change location" for profiles saved before
    // the ISO fix, which still carry "UK" (now GB) or "FX" (no country): the
    // code is normalised, and one that names no country searches without a bias.
    country: z.string().trim().max(60).optional(),
    /** "1" = only places inside `country` (the intake area field). */
    strict: z.enum(["1", "0", "true", "false"]).optional(),
    lat: optionalNumber(-90, 90),
    lng: optionalNumber(-180, 180),
    session: z.string().trim().max(100).optional(),
  })
  .transform((query, ctx) => {
    const strict = query.strict === "1" || query.strict === "true";
    const country = query.country ? countryCodeFrom(query.country) : null;
    // A strict search without its country would offer places anywhere in the world.
    if (strict && query.country && !country) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, path: ["country"], message: "unknown country code" });
      return z.NEVER;
    }
    return { ...query, country, strict };
  });

export async function GET(req: NextRequest) {
  return withErrorHandling(async () => {
    const search = req.nextUrl.searchParams;
    const query = SearchQuerySchema.parse({
      q: search.get("q") ?? "",
      country: search.get("country") ?? undefined,
      strict: search.get("strict") || undefined,
      lat: search.get("lat") ?? undefined,
      lng: search.get("lng") ?? undefined,
      session: search.get("session") || undefined,
    });
    const near = query.lat !== undefined && query.lng !== undefined ? { lat: query.lat, lng: query.lng } : null;
    const { suggestions, unavailable } = await searchPlaces(query.q, {
      near,
      countryCode: query.country,
      strict: query.strict,
      sessionToken: query.session ?? null,
    });
    // `provider` drives the attribution line under the intake area field;
    // `unavailable` lets the field say search is down rather than "no matches".
    return NextResponse.json({ suggestions, provider: geoProviderName(), unavailable });
  });
}
