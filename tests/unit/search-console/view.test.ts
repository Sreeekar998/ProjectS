import { describe, expect, it } from "vitest";
import type { SearchConsoleProfileSummary, SearchConsoleStatus } from "@/lib/search-console/types";
import { formatPeriod, formatShare, searchDemandView, setupSteps, toggleView } from "@/lib/search-console/view";

const COPY_GUARD = /High confidence|Medium confidence|Low confidence|Needs review|Ruled out|not suggested|Confirm anyway|% match|unsupported finding|notes from the analysis|ambiguous|rejected/i;

const redirectUri = "http://localhost:3000/api/integrations/search-console/callback";
const notConfigured: SearchConsoleStatus = { configured: false, connected: false, reason: "oauth_not_configured", redirectUri };
const notConnected: SearchConsoleStatus = { configured: true, connected: false, reason: "not_connected", redirectUri };
const expired: SearchConsoleStatus = { configured: true, connected: false, reason: "reconnect_required", redirectUri };
const connected: SearchConsoleStatus = { configured: true, connected: true, connectedAt: 1, propertyCount: 3, redirectUri };

describe("toggleView", () => {
  it("is a disabled placeholder until the status arrives", () => {
    expect(toggleView({ status: null, loaded: false, checked: false })).toMatchObject({ loading: true, switchDisabled: true, lines: [] });
  });

  it("without OAuth env is disabled with setup steps and the exact redirect URI, and no connect action", () => {
    const view = toggleView({ status: notConfigured, loaded: true, checked: false });
    expect(view).toMatchObject({ loading: false, switchDisabled: true, connected: false, setup: { redirectUri } });
    expect(view.lines[0]).toContain("isn't set up on this computer");
    expect(view.lines.join(" ")).not.toMatch(/connect/i);
    expect(setupSteps(redirectUri).join("\n")).toContain(redirectUri);
  });

  it("explains a non-loopback address and a failed status request", () => {
    expect(toggleView({ status: { configured: false, connected: false, reason: "redirect_uri_unavailable", redirectUri: null }, loaded: true, checked: false }).lines[0]).toContain("GOOGLE_OAUTH_REDIRECT_URI");
    expect(toggleView({ status: null, loaded: true, checked: false })).toMatchObject({ switchDisabled: true, lines: ["Couldn't check Search Console. You can continue without it."] });
  });

  it("configured and not connected: enabled, and says Google sign-in comes next when switched on", () => {
    expect(toggleView({ status: notConnected, loaded: true, checked: false })).toMatchObject({ switchDisabled: false, connected: false });
    expect(toggleView({ status: notConnected, loaded: true, checked: true }).lines.join(" ")).toContain("You'll sign in with Google next (read-only access)");
    expect(toggleView({ status: notConnected, loaded: true, checked: false, disabled: true }).switchDisabled).toBe(true);
  });

  it("shows the reconnect copy and the cancelled sign-in notice", () => {
    expect(toggleView({ status: expired, loaded: true, checked: false })).toMatchObject({ tone: "warn", lines: [expect.stringContaining("expired (test apps expire after 7 days)")] });
    const denied = toggleView({ status: notConnected, loaded: true, checked: false, notice: "denied" });
    expect(denied.lines[0]).toBe("Google sign-in was cancelled. Continue without Search Console, or switch it on to try again.");
    expect(toggleView({ status: notConnected, loaded: true, checked: false, notice: "error" }).lines[0]).toContain("didn't finish");
  });

  it("connected: enabled with the property count", () => {
    expect(toggleView({ status: connected, loaded: true, checked: true })).toMatchObject({ switchDisabled: false, connected: true, propertyCount: 3, setup: null });
  });
});

const summary: SearchConsoleProfileSummary = {
  source: "google_search_console",
  policyVersion: "gsc-signals@1",
  siteUrl: "sc-domain:lumenstudio.test",
  matchReason: "domain_property",
  pageFilter: null,
  startDate: "2026-06-16",
  endDate: "2026-09-13",
  fetchedAt: 1,
  sufficient: true,
  totals: { clicks: 4210, impressions: 61000, anonymizedShare: 0.25 },
  brandedClickShare: 0.38,
  brandedImpressionShare: 0.2,
  topNonBrandQueries: Array.from({ length: 12 }, (_, index) => ({ query: `service ${index}`, clicks: 10, impressions: 100 })),
  brandedModifiers: ["prices"],
  demandByOffering: [],
  countries: [
    { countryCode: "AE", share: 0.72 },
    { countryCode: "IN", share: 0.09 },
    { countryCode: "SA", share: 0.05 },
    { countryCode: "GB", share: 0.03 },
  ],
  placeDemand: { placeBearingImpressions: 0, mix: { neighborhood: 0, nearby: 0, city: 0, region: 0, country: 0, nearMe: 0 } },
  topPages: [],
  rawEvidenceHash: null,
};

describe("searchDemandView", () => {
  it("renders nothing when Search Console was never part of the analysis", () => {
    expect(searchDemandView(undefined, null)).toEqual({ kind: "hidden" });
    expect(searchDemandView(undefined, { type: "search_console.sync.started", payload: {} })).toEqual({ kind: "hidden" });
  });

  it("summarises clicks, brand share, eight searches and the top countries", () => {
    const view = searchDemandView(summary, { type: "search_console.sync.completed", payload: {} });
    expect(view).toMatchObject({
      kind: "summary",
      property: "sc-domain:lumenstudio.test",
      period: "16 Jun – 13 Sep 2026",
      headline: "4,210 clicks from Google · 38% searched your name",
      notUsed: null,
      countries: "United Arab Emirates 72% · India 9% · Saudi Arabia 5%",
    });
    expect(view.kind === "summary" && view.searches).toHaveLength(8);
    // The Understand call reads these search terms, so the card must say so.
    expect(view).toMatchObject({
      usedFor: expect.stringContaining("to give the AI that reads your site the words customers search with"),
      footnote: "Search Console data stays on this computer. Search terms (not personal data) are shared with the AI model that reads your site. Disconnecting doesn't change this saved analysis.",
    });
    expect(JSON.stringify(view)).not.toMatch(COPY_GUARD);
  });

  it("says plainly when there was too little data, and notes a page filter and hidden searches", () => {
    const thin = searchDemandView({ ...summary, sufficient: false, brandedClickShare: null }, null);
    expect(thin).toMatchObject({ kind: "summary", headline: "4,210 clicks from Google", notUsed: expect.stringContaining("Too few searches"), searches: [], footnote: expect.stringContaining("shared with the AI model") });
    const filtered = searchDemandView({ ...summary, pageFilter: "^https?://shop", totals: { ...summary.totals, anonymizedShare: 0.8 } }, null);
    expect(filtered.kind === "summary" && filtered.notes).toHaveLength(2);
  });

  it("turns a skipped or failed sync into one line", () => {
    expect(searchDemandView(undefined, { type: "search_console.sync.skipped", payload: { reason: "no_matching_property", propertyCount: 3 } })).toEqual({
      kind: "notice",
      message: "The connected Google account has 3 Search Console properties, none for this website, so it wasn't used.",
    });
    expect(searchDemandView(undefined, { type: "search_console.sync.skipped", payload: { reason: "timeout" } })).toEqual({ kind: "notice", message: "Search Console was slow; the analysis continued without it." });
    expect(searchDemandView(undefined, { type: "search_console.sync.failed", payload: { reason: "quota_exceeded" } })).toEqual({ kind: "notice", message: "Google's Search Console limit was reached; try again in 15 minutes." });
    for (const reason of ["disabled", "oauth_not_configured", "not_connected", "reconnect_required", "property_not_accessible", "insufficient_data", "something_new"]) {
      const view = searchDemandView(undefined, { type: "search_console.sync.skipped", payload: { reason } });
      expect(view.kind, reason).toBe("notice");
      expect(JSON.stringify(view)).not.toMatch(COPY_GUARD);
    }
  });

  it("formats periods and shares", () => {
    expect(formatPeriod("2025-12-20", "2026-03-19")).toBe("20 Dec 2025 – 19 Mar 2026");
    expect(formatShare(0.004)).toBe("<1%");
    expect(formatShare(0)).toBe("0%");
  });
});
