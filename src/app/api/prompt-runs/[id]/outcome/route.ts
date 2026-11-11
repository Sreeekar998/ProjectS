import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { markPromptRunTypedOutcome } from "@/lib/collection/orchestrator";
import { getPromptRun } from "@/lib/collection/repository";
import { withErrorHandling } from "@/lib/http/respond";

const BodySchema = z.object({ outcome: z.enum(["rate_limited", "incomplete", "failed"]), note: z.string().optional() });

export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  return withErrorHandling(async () => {
    const { id } = await params;
    const body = BodySchema.parse(await req.json());
    await markPromptRunTypedOutcome(id, body.outcome, body.note);
    const run = await getPromptRun(id);
    return NextResponse.json({ promptRun: run });
  });
}
