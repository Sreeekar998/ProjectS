// What the intake switch and the Understand "Search demand" section show.
//
// Pure so it can be tested without a DOM (vitest runs in node). Copy rules from
// the 2026-09-14 feedback: no confidence labels, no rejected or ambiguous query
// lists, and one plain line (never a spinner) when Search Console wasn't used.
//
// Client-safe.

import { countryName } from "@/lib/geo/countries";
import type { GscFailureReason, GscSkipReason, SearchConsoleProfileSummary, SearchConsoleStatus } from "./types";

// ---------------------------------------------------------------------------
// Intake switch
// ---------------------------------------------------------------------------

export const TOGGLE_TITLE = "Use Google Search Console";
export const TOGGLE_DESCRIPTION = "Reads the Google searches that already bring people to your site, so the analysis reads your most-searched pages first and checks where your customers are.";
export const DATA_NOTE = "Search Console data stays on this computer. Search terms (not personal data) are shared with the AI model that reads your site.";

export interface ToggleView {
  loading: boolean;
  switchDisabled: boolean;
  /** Helper lines under the switch, in order. */
  lines: string[];
  /** Show the "Setup steps" disclosure. */
  setup: { redirectUri: string | null } | null;
  connected: boolean;
  propertyCount: number | null;
  tone: "neutral" | "warn";
}

export function toggleView(input: { status: SearchConsoleStatus | null; loaded: boolean; checked: boolean; disabled?: boolean; notice?: "denied" | "error" | null }): ToggleView {
  const busy = input.disabled === true;
  if (!input.loaded) {
    return { loading: true, switchDisabled: true, lines: [], setup: null, connected: false, propertyCount: null, tone: "neutral" };
  }
  const noticeLine =
    input.notice === "denied"
      ? "Google sign-in was cancelled. Continue without Search Console, or switch it on to try again."
      : input.notice === "error"
        ? "Google sign-in didn't finish. Continue without Search Console, or switch it on to try again."
        : null;
  const withNotice = (lines: string[]) => (noticeLine ? [noticeLine, ...lines] : lines);
  const status = input.status;
  if (!status) {
    return { loading: false, switchDisabled: true, lines: ["Couldn't check Search Console. You can continue without it."], setup: null, connected: false, propertyCount: null, tone: "neutral" };
  }
  if (!status.configured) {
    if (status.reason === "disabled") {
      return { loading: false, switchDisabled: true, lines: ["Search Console is turned off on this computer (SUN_GSC_DISABLED)."], setup: null, connected: false, propertyCount: null, tone: "neutral" };
    }
    if (status.reason === "redirect_uri_unavailable") {
      return { loading: false, switchDisabled: true, lines: ["Set GOOGLE_OAUTH_REDIRECT_URI in .env.local to use Search Console from this address."], setup: { redirectUri: null }, connected: false, propertyCount: null, tone: "neutral" };
    }
    return {
      loading: false,
      switchDisabled: true,
      lines: ["Search Console isn't set up on this computer. Add GOOGLE_OAUTH_CLIENT_ID and GOOGLE_OAUTH_CLIENT_SECRET to .env.local and restart the app."],
      setup: { redirectUri: status.redirectUri },
      connected: false,
      propertyCount: null,
      tone: "neutral",
    };
  }
  if (!status.connected) {
    const lines: string[] = [];
    if (status.reason === "reconnect_required") lines.push("Your Google connection expired (test apps expire after 7 days). Switch on to reconnect.");
    else lines.push(TOGGLE_DESCRIPTION);
    if (input.checked) lines.push("You'll sign in with Google next (read-only access), then the analysis starts.", DATA_NOTE);
    return { loading: false, switchDisabled: busy, lines: withNotice(lines), setup: null, connected: false, propertyCount: null, tone: noticeLine || status.reason === "reconnect_required" ? "warn" : "neutral" };
  }
  const lines = [TOGGLE_DESCRIPTION];
  if (input.checked) lines.push(DATA_NOTE);
  return { loading: false, switchDisabled: busy, lines: withNotice(lines), setup: null, connected: true, propertyCount: status.propertyCount, tone: noticeLine ? "warn" : "neutral" };
}

export function connectedLine(propertyCount: number | null): string {
  if (propertyCount === null) return "Connected to Google Search Console";
  return `Connected to Google Search Console (${propertyCount} ${propertyCount === 1 ? "property" : "properties"})`;
}

export function setupSteps(redirectUri: string | null): string[] {
  return [
    "In Google Cloud, create or pick a project and enable the Google Search Console API.",
    "Set up the OAuth consent screen: user type External, publishing status Testing, add your Google account as a test user, and add the scope webmasters.readonly.",
    redirectUri
      ? `Create an OAuth client ID of type Web application and add this authorized redirect URI: ${redirectUri}`
      : "Create an OAuth client ID of type Web application, add the redirect URI you will open the app on (…/api/integrations/search-console/callback), and set it as GOOGLE_OAUTH_REDIRECT_URI.",
    "Put the client ID and secret in .env.local as GOOGLE_OAUTH_CLIENT_ID and GOOGLE_OAUTH_CLIENT_SECRET, then restart the app. If the app moves to another port, register that port's redirect URI too.",
    "Google will say it hasn't verified the app: continue as the test user. In Testing mode the connection has to be renewed every 7 days.",
  ];
}

// ---------------------------------------------------------------------------
// Understand section
// ---------------------------------------------------------------------------

export interface SyncEventLike {
  type: string;
  payload: Record<string, unknown>;
}

export type SearchDemandView =
  | { kind: "hidden" }
  | { kind: "notice"; message: string }
  | {
      kind: "summary";
      property: string;
      period: string;
      headline: string;
      /** Set when the data wasn't enough to use; the rest of the summary is then omitted. */
      notUsed: string | null;
      searches: string[];
      countries: string | null;
      notes: string[];
      usedFor: string;
      footnote: string;
    };

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
const MAX_SEARCH_CHIPS = 8;
const MAX_COUNTRIES_SHOWN = 3;

function parseDay(value: string): { year: number; month: number; day: number } | null {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value);
  if (!match) return null;
  const month = Number(match[2]);
  if (month < 1 || month > 12) return null;
  return { year: Number(match[1]), month, day: Number(match[3]) };
}

/** "16 Jun – 13 Sep 2026", or with both years when they differ. */
export function formatPeriod(startDate: string, endDate: string): string {
  const start = parseDay(startDate);
  const end = parseDay(endDate);
  if (!start || !end) return `${startDate} – ${endDate}`;
  const endText = `${end.day} ${MONTHS[end.month - 1]} ${end.year}`;
  const startText = start.year === end.year ? `${start.day} ${MONTHS[start.month - 1]}` : `${start.day} ${MONTHS[start.month - 1]} ${start.year}`;
  return `${startText} – ${endText}`;
}

export function formatShare(share: number): string {
  if (!Number.isFinite(share) || share <= 0) return "0%";
  const percent = Math.round(share * 100);
  return percent === 0 ? "<1%" : `${percent}%`;
}

const SKIP_MESSAGES: Record<GscSkipReason, string> = {
  disabled: "Search Console is turned off on this computer, so it wasn't used.",
  oauth_not_configured: "Search Console isn't set up on this computer, so it wasn't used.",
  not_connected: "Google Search Console wasn't connected, so it wasn't used.",
  reconnect_required: "The Google connection expired, so Search Console wasn't used. Reconnect it on the start page next time.",
  no_matching_property: "The connected Google account has no Search Console property for this website, so it wasn't used.",
  property_not_accessible: "The connected Google account can't read the chosen Search Console property, so it wasn't used.",
  insufficient_data: "Search Console had too little search data for this website, so it wasn't used.",
  timeout: "Search Console was slow; the analysis continued without it.",
};

const FAILURE_MESSAGES: Record<GscFailureReason, string> = {
  quota_exceeded: "Google's Search Console limit was reached; try again in 15 minutes.",
  permission_denied: "The connected Google account isn't allowed to read this property's search data, so it wasn't used.",
  google_unavailable: "Google Search Console didn't respond; the analysis continued without it.",
  network_error: "Google Search Console couldn't be reached; the analysis continued without it.",
  invalid_response: "Google Search Console sent an answer that couldn't be read; the analysis continued without it.",
  token_refresh_failed: "The Google connection couldn't be renewed, so Search Console wasn't used.",
};

function eventNotice(event: SyncEventLike | null): string | null {
  if (!event) return null;
  const reason = typeof event.payload.reason === "string" ? event.payload.reason : "";
  if (event.type === "search_console.sync.skipped") {
    if (reason === "no_matching_property" && typeof event.payload.propertyCount === "number") {
      const count = event.payload.propertyCount;
      return `The connected Google account has ${count} Search Console ${count === 1 ? "property" : "properties"}, none for this website, so it wasn't used.`;
    }
    return SKIP_MESSAGES[reason as GscSkipReason] ?? "Search Console wasn't used for this analysis.";
  }
  if (event.type === "search_console.sync.failed") {
    return FAILURE_MESSAGES[reason as GscFailureReason] ?? "Search Console couldn't be read; the analysis continued without it.";
  }
  return null;
}

export function searchDemandView(summary: SearchConsoleProfileSummary | undefined | null, lastSyncEvent: SyncEventLike | null): SearchDemandView {
  if (!summary) {
    const message = eventNotice(lastSyncEvent);
    return message ? { kind: "notice", message } : { kind: "hidden" };
  }
  const property = summary.siteUrl;
  const period = formatPeriod(summary.startDate, summary.endDate);
  const clicks = summary.totals.clicks;
  const headlineParts = [`${clicks.toLocaleString("en-US")} ${clicks === 1 ? "click" : "clicks"} from Google`];
  if (summary.brandedClickShare !== null) headlineParts.push(`${formatShare(summary.brandedClickShare)} searched your name`);
  // Always names the AI sharing: the Understand call reads search terms from the
  // preliminary signals, which can count as sufficient even when this saved summary doesn't.
  const footnote = `${DATA_NOTE} Disconnecting doesn't change this saved analysis.`;
  if (!summary.sufficient) {
    return {
      kind: "summary",
      property,
      period,
      headline: headlineParts[0]!,
      notUsed: "Too few searches without your name in this period to use.",
      searches: [],
      countries: null,
      notes: [],
      usedFor: "",
      footnote,
    };
  }
  const countries = summary.countries
    .slice(0, MAX_COUNTRIES_SHOWN)
    .map((country) => `${countryName(country.countryCode) ?? country.countryCode} ${formatShare(country.share)}`)
    .join(" · ");
  const notes: string[] = [];
  if (summary.pageFilter) notes.push("Only this website's pages inside the property are counted.");
  if (summary.totals.anonymizedShare > 0.7) notes.push("Google hides most searches for smaller sites for privacy, so these are the searches it shows.");
  return {
    kind: "summary",
    property,
    period,
    headline: headlineParts.join(" · "),
    notUsed: null,
    searches: summary.topNonBrandQueries.slice(0, MAX_SEARCH_CHIPS).map((row) => row.query),
    countries: countries || null,
    notes,
    usedFor: "Used to choose which pages to read first, to check where your customers are, and to give the AI that reads your site the words customers search with.",
    footnote,
  };
}
