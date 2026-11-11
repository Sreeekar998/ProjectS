import { NextRequest, NextResponse } from "next/server";
import { listEvidenceByIds, listEvidenceForProject } from "@/lib/evidence/repository";
import { withErrorHandling } from "@/lib/http/respond";

const MAX_IDS = 40;

/**
 * Backs the "Why?" / evidence panel: given the evidence ids a profile field
 * cites, return the observations behind it. Deliberately id-addressed rather
 * than dumping the whole evidence set into the review screen — the default
 * experience stays clean, and the provenance is one click away.
 */
export async function GET(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  return withErrorHandling(async () => {
    const { id: projectId } = await params;
    const idsParam = new URL(req.url).searchParams.get("ids");

    if (!idsParam) {
      const all = await listEvidenceForProject(projectId);
      return NextResponse.json({ evidence: all.slice(0, 500), total: all.length });
    }

    const ids = idsParam.split(",").map((s) => s.trim()).filter(Boolean).slice(0, MAX_IDS);
    const items = await listEvidenceByIds(ids);
    // Scope to the project so an id from another project cannot be read here.
    const scoped = items.filter((item) => item.projectId === projectId);
    return NextResponse.json({ evidence: scoped, total: scoped.length });
  });
}
