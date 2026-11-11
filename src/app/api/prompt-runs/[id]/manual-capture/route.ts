import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { recordManualObservation } from "@/lib/collection/orchestrator";
import { withErrorHandling } from "@/lib/http/respond";

// Capture states are ASSERTED by the operator, never inferred. "not_captured"
// is the honest default for sources: it keeps the observation out of citation
// denominators instead of contributing a zero. See lib/measure/policy.ts.
const BodySchema = z.object({
  operator: z.string().min(1).max(120).default("interview_operator"),
  responseText: z.string().min(1).max(200_000),
  sourceUrls: z.array(z.string().max(2048)).max(100).default([]),
  visibleModelMode: z.string().max(120).optional(),
  searchState: z.enum(["on", "off", "unknown", "not_applicable"]).optional(),
  accountTier: z.string().max(60).optional(),
  locale: z.string().max(20).optional(),
  observerRegion: z.string().max(60).optional(),
  answerCaptureState: z.enum(["complete", "truncated", "unknown"]).optional(),
  sourcesCaptureState: z.enum(["complete", "partial", "none_present", "not_captured", "unknown"]).optional(),
  note: z.string().max(2000).optional(),
});

export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  return withErrorHandling(async () => {
    const { id } = await params;
    const body = BodySchema.parse(await req.json());
    const result = await recordManualObservation(id, body);
    return NextResponse.json(result, { status: 201 });
  });
}
