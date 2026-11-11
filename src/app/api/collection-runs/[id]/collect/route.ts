import { NextRequest, NextResponse } from "next/server";
import { getRunnerProgress, startCollection } from "@/lib/collection/runner";
import { withErrorHandling } from "@/lib/http/respond";

/**
 * Starts collecting every planned automated observation in the background.
 *
 * Returns at once with live progress (202). Collection used to run inside this
 * request, so the page showed a spinner for the whole run and nothing else.
 */
export async function POST(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  return withErrorHandling(async () => {
    const { id } = await params;
    const runner = await startCollection(id);
    return NextResponse.json({ runner }, { status: 202 });
  });
}

/** Live runner progress: per-provider lanes, pacing state and ETA. */
export async function GET(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  return withErrorHandling(async () => {
    const { id } = await params;
    return NextResponse.json({ runner: getRunnerProgress(id) });
  });
}
