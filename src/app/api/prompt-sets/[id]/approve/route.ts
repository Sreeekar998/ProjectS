import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { approvePromptSet } from "@/lib/prompts/orchestrator";
import { withErrorHandling } from "@/lib/http/respond";

const BodySchema = z.object({ approvedBy: z.string().default("interview_operator") });

export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  return withErrorHandling(async () => {
    const { id } = await params;
    const body = BodySchema.parse(await req.json().catch(() => ({})));
    const promptSet = await approvePromptSet(id, body.approvedBy);
    return NextResponse.json({ promptSet });
  });
}
