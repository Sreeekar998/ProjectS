import { NextRequest, NextResponse } from "next/server";
import { generatePromptSet } from "@/lib/prompts/orchestrator";
import { withErrorHandling } from "@/lib/http/respond";
import { appendEvent, latestSequence } from "@/lib/events/bus";
import { release, tryAcquire } from "@/lib/jobs/active";

export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  return withErrorHandling(async () => {
    const { id: projectId } = await params;
    const force = req.nextUrl.searchParams.get("force") === "1";
    const key = `prompts:${projectId}`;
    // The page reads only events after this sequence, so an older generation's
    // prompt_set.ready or failure can't end the new one's loading panel.
    const sinceSequence = latestSequence(projectId);

    // One generation per project at a time. A reload during generation used to
    // POST again and could start a second, racing set (with `force`, a second
    // version).
    if (!tryAcquire(key)) {
      return NextResponse.json({ status: "already_running", sinceSequence }, { status: 202 });
    }

    // Fire-and-forget; the page follows the prompt.* events. Failures go to
    // policy.status {stage:"prompt_generation"}, which the page shows as a
    // failed generation with "Try again".
    void generatePromptSet(projectId, { force })
      .catch((err) => {
        appendEvent(projectId, "policy.status", { stage: "prompt_generation", error: err instanceof Error ? err.message : "unknown_error" });
      })
      .finally(() => release(key));

    return NextResponse.json({ status: "started", sinceSequence }, { status: 202 });
  });
}
