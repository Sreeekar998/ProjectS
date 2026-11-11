import { NextRequest, NextResponse } from "next/server";
import { withErrorHandling } from "@/lib/http/respond";
import { appOrigin } from "@/lib/search-console/config";
import {
  OAUTH_COOKIE_MAX_AGE_S,
  OAUTH_COOKIE_NAME,
  OAUTH_COOKIE_PATH,
  buildAuthorizeUrl,
  gscConfig,
  newOAuthState,
  safeReturnTo,
  signOAuthCookie,
  withGscOutcome,
} from "@/lib/search-console/oauth";

export const dynamic = "force-dynamic";

/**
 * Begins Google consent. A GET that only redirects: the `state` it mints is
 * bound to this browser through a signed, httpOnly, 10-minute cookie, which the
 * callback checks before accepting any code.
 */
export async function GET(req: NextRequest) {
  return withErrorHandling(async () => {
    const returnTo = safeReturnTo(req.nextUrl.searchParams.get("returnTo"));
    const config = gscConfig(appOrigin(req) ?? undefined);
    if ("unavailable" in config) {
      // Relative Location: the browser resolves it against the host it used (see appOrigin).
      return new NextResponse(null, { status: 303, headers: { location: withGscOutcome(returnTo, "error", "not_configured"), "cache-control": "no-store" } });
    }
    const state = newOAuthState();
    const response = NextResponse.redirect(buildAuthorizeUrl({ state, redirectUri: config.redirectUri }), 302);
    response.cookies.set({
      name: OAUTH_COOKIE_NAME,
      value: signOAuthCookie({ state, returnTo, iat: Date.now() }),
      httpOnly: true,
      sameSite: "lax",
      path: OAUTH_COOKIE_PATH,
      maxAge: OAUTH_COOKIE_MAX_AGE_S,
      secure: req.nextUrl.protocol === "https:",
    });
    response.headers.set("cache-control", "no-store");
    return response;
  });
}
