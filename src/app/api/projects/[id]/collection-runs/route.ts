import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { createCollectionRun } from "@/lib/collection/orchestrator";
import { listCollectionRunsForProject } from "@/lib/collection/repository";
import { ALL_ROUTE_IDS } from "@/lib/providers/route-policy-seed";
import { withErrorHandling } from "@/lib/http/respond";

const BodySchema = z.object({
  // Omitted means "one consumer-web route per engine, the first whose provider
  // key is present and healthy". Retired route ids are still accepted so old
  // scripts do not break; they plan as policy_disabled.
  providerExperiences: z.array(z.enum(ALL_ROUTE_IDS)).min(1).optional(),
});

export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  return withErrorHandling(async () => {
    const { id: projectId } = await params;
    const body = BodySchema.parse(await req.json());
    const run = await createCollectionRun(projectId, body.providerExperiences);
    return NextResponse.json({ collectionRun: run }, { status: 201 });
  });
}

export async function GET(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  return withErrorHandling(async () => {
    const { id: projectId } = await params;
    const runs = await listCollectionRunsForProject(projectId);
    return NextResponse.json({ collectionRuns: runs });
  });
}
