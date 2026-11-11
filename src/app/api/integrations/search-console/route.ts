import { NextRequest, NextResponse } from "next/server";
import { withErrorHandling } from "@/lib/http/respond";
import { appOrigin } from "@/lib/search-console/config";
import { searchConsoleStatus } from "@/lib/search-console/status";

export const dynamic = "force-dynamic";

/** Search Console connection status for the intake switch. Never returns tokens or the client secret. */
export async function GET(req: NextRequest) {
  return withErrorHandling(async () => NextResponse.json({ status: await searchConsoleStatus(appOrigin(req)) }, { headers: { "cache-control": "no-store" } }));
}
