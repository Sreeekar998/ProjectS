import { NextRequest, NextResponse } from "next/server";
import { withErrorHandling } from "@/lib/http/respond";
import { appOrigin } from "@/lib/search-console/config";
import {
  OAUTH_COOKIE_NAME,
  OAUTH_COOKIE_PATH,
  completeConnection,
  exchangeCode,
  gscConfig,
  safeReturnTo,
  scopeGranted,
  timingSafeEqualText,
  verifyOAuthCookie,
  withGscOutcome,
} from "@/lib/search-console/oauth";

export const dynamic = "force-dynamic";

// Only these codes are echoed back in `gsc_reason`; anything else Google (or a
// crafted link) puts in `error` becomes the generic `oauth_error`.
const GOOGLE_ERRORS = new Set(["admin_policy_enforced", "org_internal", "invalid_client", "redirect_uri_mismatch", "invalid_scope", "unauthorized_client", "invalid_request", "disallowed_useragent", "invalid_grant"]);

function finish(req: NextRequest, returnTo: string, status: "connected" | "denied" | "error", reason?: string): NextResponse {
  // 303 also drops `code` and `state` from the address bar, as Google recommends.
  // The Location is relative so the browser lands on the host Google returned it
  // to, where the intake draft was saved; `req.nextUrl` names Next's bind host instead.
  const response = new NextResponse(null, { status: 303, headers: { location: withGscOutcome(returnTo, status, reason) } });
  response.cookies.set({ name: OAUTH_COOKIE_NAME, value: "", httpOnly: true, sameSite: "lax", path: OAUTH_COOKIE_PATH, maxAge: 0, secure: req.nextUrl.protocol === "https:" });
  response.headers.set("cache-control", "no-store");
  return response;
}

/** Google redirects here after consent. Logs never include the code or tokens. */
export async function GET(req: NextRequest) {
  return withErrorHandling(async () => {
    const params = req.nextUrl.searchParams;
    const cookie = verifyOAuthCookie(req.cookies.get(OAUTH_COOKIE_NAME)?.value);
    const state = params.get("state");
    if (!cookie || !state || !timingSafeEqualText(state, cookie.state)) {
      // Without a trusted cookie there is no trusted returnTo either.
      return finish(req, "/trial/new?gsc_return=1", "error", "state_mismatch");
    }
    const returnTo = safeReturnTo(cookie.returnTo);

    const error = params.get("error");
    if (error === "access_denied") return finish(req, returnTo, "denied");
    if (error) return finish(req, returnTo, "error", GOOGLE_ERRORS.has(error) ? error : "oauth_error");

    const code = params.get("code");
    if (!code) return finish(req, returnTo, "error", "missing_code");
    const config = gscConfig(appOrigin(req) ?? undefined);
    if ("unavailable" in config) return finish(req, returnTo, "error", "not_configured");

    const exchanged = await exchangeCode(code, config.redirectUri);
    if (!exchanged.ok) return finish(req, returnTo, "error", GOOGLE_ERRORS.has(exchanged.error) ? exchanged.error : "token_exchange_failed");
    if (!scopeGranted(exchanged.tokens.scope)) return finish(req, returnTo, "error", "scope_not_granted");
    if (!exchanged.tokens.refreshToken) return finish(req, returnTo, "error", "no_refresh_token");

    await completeConnection({ ...exchanged.tokens, refreshToken: exchanged.tokens.refreshToken });
    return finish(req, returnTo, "connected");
  });
}
