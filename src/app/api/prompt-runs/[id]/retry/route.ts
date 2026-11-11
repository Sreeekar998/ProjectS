import { NextRequest, NextResponse } from "next/server";
import { retryPromptRun } from "@/lib/collection/orchestrator";
import { getPromptRun } from "@/lib/collection/repository";
import { withErrorHandling } from "@/lib/http/respond";

export async function POST(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  return withErrorHandling(async () => {
    const { id } = await params;
    await retryPromptRun(id);
    const run = await getPromptRun(id);
    return NextResponse.json({ promptRun: run });
  });
}
