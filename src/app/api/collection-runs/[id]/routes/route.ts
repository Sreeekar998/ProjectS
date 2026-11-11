import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { addRoutesToCollectionRun, switchAutomatedRoute } from "@/lib/collection/orchestrator";
import { ALL_ROUTE_IDS, AUTOMATED_ROUTE_IDS } from "@/lib/providers/route-policy-seed";
import { withErrorHandling } from "@/lib/http/respond";

const BodySchema = z.object({
  providerExperiences: z.array(z.enum(ALL_ROUTE_IDS)).min(1),
  /**
   * An automated route whose unfinished questions move to the (single) route
   * given, e.g. ChatGPT on the web continuing from Bright Data to cloro. The
   * replacement must observe the same engine on the same surface.
   */
  replaces: z.enum(AUTOMATED_ROUTE_IDS).optional(),
});

/** Adds observation routes to an existing run, so a second engine or a replacement provider shares one measurement. */
export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  return withErrorHandling(async () => {
    const { id } = await params;
    const body = BodySchema.parse(await req.json());
    const collectionRun = body.replaces
      ? await switchAutomatedRoute(id, body.replaces, body.providerExperiences[0]!)
      : await addRoutesToCollectionRun(id, body.providerExperiences);
    return NextResponse.json({ collectionRun }, { status: 201 });
  });
}
