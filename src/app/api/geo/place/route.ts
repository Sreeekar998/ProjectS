import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { placeDetails } from "@/lib/geo/providers";
import { GeoSuggestionSchema } from "@/lib/geo/schema";
import type { GeoSuggestion } from "@/lib/geo/types";
import { withErrorHandling } from "@/lib/http/respond";

// Resolves one autocomplete suggestion to a full place. Keyless suggestions
// already carry their address and come straight back; Google suggestions need a
// Place Details call, which closes the autocomplete session token.
//
// The suggestion shape lives in `lib/geo/schema.ts`, shared with the intake's
// market hint, so the two places a browser hands us a place validate alike.

const PlaceBodySchema = z.object({
  suggestion: GeoSuggestionSchema,
  session: z.string().max(100).nullable().optional(),
});

export async function POST(req: NextRequest) {
  return withErrorHandling(async () => {
    const body = PlaceBodySchema.parse(await req.json());
    const place = await placeDetails(body.suggestion as GeoSuggestion, body.session ?? null);
    return NextResponse.json({ place });
  });
}
