// Browser-side constants for the Search Console OAuth round trip.
//
// Consent is a full-page redirect, so the intake page and the callback route
// agree on these query parameters: the intake saves its draft, leaves for
// Google, and on return reads `gsc_return=1&gsc_status=connected|denied|error`
// to restore the form (and auto-start only when connected).
//
// Client-safe.

export const GSC_RETURN_PARAM = "gsc_return";
export const GSC_STATUS_PARAM = "gsc_status";

/** The route that starts Google consent and comes back to `returnTo` (a same-origin path). */
export function searchConsoleStartHref(returnTo: string): string {
  return `/api/integrations/search-console/start?returnTo=${encodeURIComponent(returnTo)}`;
}
