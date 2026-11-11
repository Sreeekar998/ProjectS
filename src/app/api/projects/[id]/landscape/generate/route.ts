import { NextRequest, NextResponse } from "next/server";
import { getLatestProfileVersion } from "@/lib/profile/repository";
import { generateLandscape, landscapeJobKey, landscapeStartSequence, noteLandscapeStart } from "@/lib/landscape/orchestrator";
import { withErrorHandling, jsonError } from "@/lib/http/respond";
import { appendEvent, latestSequence } from "@/lib/events/bus";
import { release, tryAcquire } from "@/lib/jobs/active";

export async function POST(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  return withErrorHandling(async () => {
    const { id: projectId } = await params;
    const profileVersion = await getLatestProfileVersion(projectId);
    if (!profileVersion) return jsonError(404, "profile_not_found", "Generate and confirm a business profile first.");

    // One generation per project at a time. Two tabs (or a reload during the
    // first request) each started a run, and each inserted a full topic set.
    // The client scopes its progress to events after `sinceSequence`.
    const key = landscapeJobKey(projectId);
    const sinceSequence = latestSequence(projectId);
    if (!tryAcquire(key)) {
      return NextResponse.json({ status: "already_running", sinceSequence: landscapeStartSequence(projectId) ?? sinceSequence }, { status: 202 });
    }
    noteLandscapeStart(projectId, sinceSequence);

    void generateLandscape(projectId, profileVersion.id)
      .catch((error) => {
        try {
          appendEvent(projectId, "landscape.competitor.discovery_failed", {
            error: error instanceof Error ? error.message : "unknown_error",
          });
        } catch {
          // The event store is unavailable; nothing else can report it.
        }
      })
      .finally(() => release(key));
    return NextResponse.json({ status: "started", sinceSequence }, { status: 202 });
  });
}
