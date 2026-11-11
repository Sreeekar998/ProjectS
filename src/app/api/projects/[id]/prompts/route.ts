import { NextRequest, NextResponse } from "next/server";
import { getLatestPromptSet, getPromptContextSnapshot, listCandidates } from "@/lib/prompts/repository";
import type { PromptContextSnapshotData } from "@/lib/prompts/context";
import { withErrorHandling } from "@/lib/http/respond";
import { isActive } from "@/lib/jobs/active";

export async function GET(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  return withErrorHandling(async () => {
    const { id: projectId } = await params;
    // A restart mid-generation leaves the set "generating" forever. `inProgress`
    // says whether a generation job is actually running in this process, so the
    // page can offer "Generate again" instead of an endless spinner.
    const inProgress = isActive(`prompts:${projectId}`);
    const promptSet = await getLatestPromptSet(projectId);
    // "Not generated yet" is a normal UI state, not an exceptional missing
    // resource. Returning a nullable shape avoids an intentional 404 appearing
    // as a browser-console error while the page starts generation.
    if (!promptSet) return NextResponse.json({ promptSet: null, candidates: [], topics: [], inProgress });
    const candidates = await listCandidates(promptSet.id);
    // Topic names from the frozen context, so the page's topic filter shows
    // "Hair colour and highlights" rather than raw topic ids.
    const snapshot = promptSet.promptContextSnapshotId ? await getPromptContextSnapshot(promptSet.promptContextSnapshotId) : undefined;
    const context = snapshot?.context as unknown as PromptContextSnapshotData | undefined;
    const topics = (context?.confirmedTopics ?? []).map((topic) => ({ id: topic.id, name: topic.name }));
    return NextResponse.json({ promptSet, candidates, topics, inProgress });
  });
}
