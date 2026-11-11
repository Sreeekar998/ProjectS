// The intake form's state across the Google Search Console consent redirect.
//
// Consent is a full-page navigation to Google and back, which wipes React
// state: without this the operator's chosen country and area were lost and the
// analysis would start as "Detect from my website". The draft is written to
// sessionStorage just before leaving, read once on return, and removed. No
// project is created before consent, so a cancelled consent leaves nothing
// behind in the database.
//
// Storage is injected so the rules are testable without a browser, and every
// access is wrapped: Safari private mode and blocked storage throw on access.
//
// It also turns the form's choices into the `market` body of POST /api/projects.
//
// Client-safe and pure.

import { DETECT_CHOICE, WORLDWIDE_CHOICE } from "@/lib/geo/country-search";
import { isCountryCode } from "@/lib/geo/iso3166";
import type { GeoPlace } from "@/lib/geo/types";
import { MARKET_HINT_AREA_QUERY_MAX, MarketHintInputSchema, type HintPlace, type MarketHint, type MarketHintInput } from "@/lib/projects/market-hint";

export const INTAKE_DRAFT_KEY = "sun.intake.draft.v1";
/** Long enough for a Google sign-in with two-factor; short enough that a stale tab never restores old answers. */
export const INTAKE_DRAFT_TTL_MS = 15 * 60 * 1000;

export interface IntakeDraft {
  v: 1;
  url: string;
  market: MarketHintInput | null;
  /** Chip title of a picked area (the suggestion's own name), so the restored chip reads the same. */
  areaLabel: string | null;
  searchConsole: boolean;
  savedAt: number;
}

export interface DraftStorage {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
  removeItem(key: string): void;
}

/** `window.sessionStorage`, or null where it is missing or blocked. */
export function browserSessionStorage(): DraftStorage | null {
  try {
    if (typeof window === "undefined") return null;
    return window.sessionStorage ?? null;
  } catch {
    return null;
  }
}

export function saveIntakeDraft(
  storage: DraftStorage | null,
  draft: Omit<IntakeDraft, "v" | "savedAt">,
  now: number = Date.now(),
): boolean {
  if (!storage) return false;
  const value: IntakeDraft = { v: 1, url: draft.url, market: draft.market, areaLabel: draft.areaLabel, searchConsole: draft.searchConsole, savedAt: now };
  try {
    storage.setItem(INTAKE_DRAFT_KEY, JSON.stringify(value));
    return true;
  } catch {
    return false;
  }
}

export function clearIntakeDraft(storage: DraftStorage | null): void {
  if (!storage) return;
  try {
    storage.removeItem(INTAKE_DRAFT_KEY);
  } catch {
    // Nothing to clean up if storage is unavailable.
  }
}

/** Validates a stored draft. Malformed, expired or future-dated drafts → null. */
export function parseIntakeDraft(raw: string | null, now: number = Date.now()): IntakeDraft | null {
  if (!raw) return null;
  let value: unknown;
  try {
    value = JSON.parse(raw);
  } catch {
    return null;
  }
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const record = value as Record<string, unknown>;
  if (record.v !== 1 || typeof record.url !== "string" || typeof record.savedAt !== "number" || !Number.isFinite(record.savedAt)) return null;
  const age = now - record.savedAt;
  // A clock skew of a few seconds is tolerated; anything older than the TTL is not restored.
  if (age > INTAKE_DRAFT_TTL_MS || age < -60_000) return null;
  const url = record.url.trim().slice(0, 2048);
  if (!url) return null;
  let market: MarketHintInput | null = null;
  if (record.market !== null && record.market !== undefined) {
    const parsed = MarketHintInputSchema.safeParse(record.market);
    if (!parsed.success) return null;
    market = parsed.data;
  }
  return {
    v: 1,
    url,
    market,
    areaLabel: typeof record.areaLabel === "string" && record.areaLabel.trim() ? record.areaLabel.trim().slice(0, 300) : null,
    searchConsole: record.searchConsole === true,
    savedAt: record.savedAt,
  };
}

/** Reads the draft once and removes it, valid or not. */
export function takeIntakeDraft(storage: DraftStorage | null, now: number = Date.now()): IntakeDraft | null {
  if (!storage) return null;
  let raw: string | null = null;
  try {
    raw = storage.getItem(INTAKE_DRAFT_KEY);
  } catch {
    return null;
  }
  clearIntakeDraft(storage);
  return parseIntakeDraft(raw, now);
}

export type SearchConsoleNotice = "denied" | "error";

export interface IntakeReturnDecision {
  /** True when the page was reached from the Search Console consent flow. */
  returning: boolean;
  /** The draft to restore into the form, or null (fields come from the query string). */
  draft: IntakeDraft | null;
  /** Initial toggle state. */
  searchConsole: boolean;
  /** Start the analysis without another click (only after a successful connect with the operator's draft). */
  autoStart: boolean;
  notice: SearchConsoleNotice | null;
}

const NOT_RETURNING: IntakeReturnDecision = { returning: false, draft: null, searchConsole: false, autoStart: false, notice: null };

function sameUrl(a: string, b: string): boolean {
  const norm = (value: string) => value.trim().replace(/\/+$/, "").toLowerCase();
  return norm(a) === norm(b);
}

/**
 * What the intake does when it loads with `gsc_return` / `gsc_status`.
 *
 * - connected + draft → restore, toggle on, start once (the operator already clicked "Analyse").
 * - connected, no usable draft → toggle on, URL from the query, wait for a click.
 * - denied / error → restore what we have, toggle off, show the notice, never start.
 * - `gsc_return=1` with no status → restore, toggle off, no notice, never start.
 *   Every server redirect sets a status, so this is the operator pressing Back
 *   on Google's page (the intake marks its history entry before leaving).
 *
 * The callback's state-mismatch redirect carries `gsc_status=error` without
 * `gsc_return`, so either parameter marks a return. A draft saved for a
 * different URL than the one in the query is ignored rather than mixed in.
 */
export function decideIntakeReturn(input: { gscReturn: string | null; gscStatus: string | null; url: string | null; draft: IntakeDraft | null }): IntakeReturnDecision {
  const returning = input.gscReturn === "1" || Boolean(input.gscStatus);
  if (!returning) return NOT_RETURNING;
  const queryUrl = input.url?.trim() ?? "";
  const draft = input.draft && (!queryUrl || sameUrl(input.draft.url, queryUrl)) ? input.draft : null;
  if (input.gscStatus === "connected") {
    return { returning: true, draft, searchConsole: true, autoStart: Boolean(draft), notice: null };
  }
  const notice = input.gscStatus === "denied" ? "denied" : input.gscStatus ? "error" : null;
  return { returning: true, draft, searchConsole: false, autoStart: false, notice };
}

// --- Form values → POST body ------------------------------------------------

/** An area the operator picked from the place search, as shown on the chip. */
export interface IntakeAreaPick {
  title: string;
  subtitle: string;
  place: GeoPlace | HintPlace;
}

const clip = (value: string | null | undefined, max = 300) => (typeof value === "string" && value.trim() ? value.trim().slice(0, max) : null);

/** The HintPlace fields of a provider place: no evidence ids, no confidence, strings capped like the server schema. */
export function hintPlaceFromGeoPlace(place: GeoPlace | HintPlace): HintPlace {
  return {
    label: clip(place.label) ?? "",
    formattedAddress: clip(place.formattedAddress),
    premise: clip(place.premise),
    street: clip(place.street),
    neighborhood: clip(place.neighborhood),
    district: clip(place.district),
    city: clip(place.city),
    region: clip(place.region),
    country: clip(place.country),
    countryCode: clip(place.countryCode)?.toUpperCase() ?? null,
    postalCode: clip(place.postalCode),
    lat: typeof place.lat === "number" && Number.isFinite(place.lat) ? place.lat : null,
    lng: typeof place.lng === "number" && Number.isFinite(place.lng) ? place.lng : null,
    precision: place.precision ?? null,
    provider: place.provider,
    providerId: clip(place.providerId),
  };
}

function areaText(pick: IntakeAreaPick): string {
  const parts = [pick.title, pick.subtitle].map((part) => part.trim()).filter(Boolean);
  return parts.join(", ").slice(0, MARKET_HINT_AREA_QUERY_MAX);
}

/**
 * The `market.area` for a picked place. A pick whose details came back without
 * any area level (a Google details call that failed leaves only a label) or in
 * another country is sent as text for Understand to geocode, rather than as a
 * place the server would reject or reduce to the bare country.
 */
export function intakeAreaFromPick(pick: IntakeAreaPick, countryCode: string): NonNullable<MarketHintInput["area"]> {
  const place = hintPlaceFromGeoPlace(pick.place);
  const inCountry = !place.countryCode || place.countryCode === countryCode.toUpperCase();
  const hasArea = Boolean(place.neighborhood || place.district || place.city || place.region);
  if (!inCountry || !hasArea) return { query: areaText(pick), place: null };
  const title = pick.title.trim().slice(0, MARKET_HINT_AREA_QUERY_MAX);
  return { query: title.length >= 2 ? title : areaText(pick), place };
}

/** The POST body `market` for the form's choices; null = "Detect from my website". */
export function intakeMarket(choice: string, area: MarketHintInput["area"]): MarketHintInput | null {
  if (choice === WORLDWIDE_CHOICE) return { countryCodes: [], worldwide: true, area: null };
  if (choice === DETECT_CHOICE || !isCountryCode(choice)) return null;
  return { countryCodes: [choice.trim().toUpperCase()], worldwide: false, area };
}

/** Form values from a restored draft market (the intake offers one country, so extra countries are dropped). */
export function intakeChoiceFromMarket(market: MarketHintInput | MarketHint | null, areaLabel: string | null): { country: string; areaPick: IntakeAreaPick | null; areaQuery: string } {
  if (!market) return { country: DETECT_CHOICE, areaPick: null, areaQuery: "" };
  if (market.worldwide) return { country: WORLDWIDE_CHOICE, areaPick: null, areaQuery: "" };
  const country = market.countryCodes[0];
  if (!country) return { country: DETECT_CHOICE, areaPick: null, areaQuery: "" };
  const area = market.countryCodes.length === 1 ? market.area : null;
  if (!area) return { country, areaPick: null, areaQuery: "" };
  if (!area.place) return { country, areaPick: null, areaQuery: area.query };
  const title = areaLabel ?? area.query;
  const label = area.place.label ?? "";
  // The chip reads "<area> · <city>, <country>": the stored label minus the title in front.
  const subtitle = label.toLowerCase().startsWith(`${title.toLowerCase()}, `) ? label.slice(title.length + 2) : label === title ? "" : label;
  return { country, areaPick: { title, subtitle, place: area.place }, areaQuery: "" };
}
