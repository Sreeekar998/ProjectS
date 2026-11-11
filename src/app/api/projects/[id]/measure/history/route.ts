import { NextRequest, NextResponse } from "next/server";
import { listMeasurementHistory } from "@/lib/measure/snapshots";
import { withErrorHandling } from "@/lib/http/respond";

/** Every run of the project as a measurement, newest first, with comparability against `?run=`. */
export async function GET(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  return withErrorHandling(async () => {
    const { id: projectId } = await params;
    const selected = req.nextUrl.searchParams.get("run");
    const history = await listMeasurementHistory(projectId, selected);
    return NextResponse.json({ history });
  });
}
