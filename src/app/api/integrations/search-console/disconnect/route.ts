import { NextRequest, NextResponse } from "next/server";
import { jsonError, withErrorHandling } from "@/lib/http/respond";
import { appOrigin } from "@/lib/search-console/config";
import { resetSearchConsoleMemory } from "@/lib/search-console/memory";
import { revokeRefreshToken } from "@/lib/search-console/oauth";
import { searchConsoleStatus } from "@/lib/search-console/status";
import { deleteGoogleTokens, readGoogleTokens } from "@/lib/search-console/token-store";

export const dynamic = "force-dynamic";

/**
 * Forgets the Google connection. The app has no auth, so the Origin check is
 * what stops another site from disconnecting it with a cross-site POST. It
 * compares against the host the browser used, not `req.nextUrl` (Next's bind
 * host), which refused every Disconnect made from http://127.0.0.1.
 * Revoking at Google is best effort; the local row is deleted either way.
 * Saved profile versions keep their Search Console summary (versions are immutable).
 */
export async function POST(req: NextRequest) {
  return withErrorHandling(async () => {
    const origin = req.headers.get("origin");
    const expected = appOrigin(req);
    if (!origin || !expected || origin !== expected) return jsonError(403, "origin_mismatch", "Disconnect must come from this app.");
    const stored = await readGoogleTokens();
    if (stored && stored !== "unreadable") await revokeRefreshToken(stored.refreshToken);
    await deleteGoogleTokens();
    resetSearchConsoleMemory();
    return NextResponse.json({ status: await searchConsoleStatus(expected) }, { headers: { "cache-control": "no-store" } });
  });
}
