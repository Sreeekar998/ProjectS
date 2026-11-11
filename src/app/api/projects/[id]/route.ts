import { NextRequest, NextResponse } from "next/server";
import { getProject } from "@/lib/projects/repository";
import { withErrorHandling, jsonError } from "@/lib/http/respond";

export async function GET(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  return withErrorHandling(async () => {
    const { id } = await params;
    const project = await getProject(id);
    if (!project) return jsonError(404, "project_not_found", `No project with id ${id}`);
    return NextResponse.json({ project });
  });
}
