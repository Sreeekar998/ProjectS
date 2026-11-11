"use client";
import { Suspense, useCallback, useEffect, useRef, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import Link from "next/link";
import { CountryCombobox } from "@/components/features/country-combobox";
import { PlaceSearchCombobox, type PlaceSearchState } from "@/components/features/place-search";
import { SearchConsoleToggle } from "@/components/features/search-console-toggle";
import { TrialSkeleton } from "@/components/features/trial-skeleton";
import { Button } from "@/components/ui/button";
import { Badge, Card, CardBody, Input, Label, Notice, Spinner } from "@/components/ui/primitives";
import { api, ApiError } from "@/lib/client/api";
import {
  browserSessionStorage,
  decideIntakeReturn,
  intakeAreaFromPick,
  intakeChoiceFromMarket,
  intakeMarket,
  saveIntakeDraft,
  takeIntakeDraft,
  type IntakeAreaPick,
  type SearchConsoleNotice,
} from "@/lib/client/intake-draft";
import { DETECT_CHOICE, WORLDWIDE_CHOICE, type CountryChoice } from "@/lib/geo/country-search";
import { isCountryCode } from "@/lib/geo/iso3166";
import type { GeoLevel } from "@/lib/geo/types";
import type { MarketHintInput } from "@/lib/projects/market-hint";
import { GSC_RETURN_PARAM, GSC_STATUS_PARAM, searchConsoleStartHref } from "@/lib/search-console/client";
import type { SearchConsoleStatus } from "@/lib/search-console/types";

// The website is the one required answer. "Where are your customers?" is
// optional and defaults to "Detect from my website": a market picker that
// defaulted to "Global" once turned a Dubai salon into a US business, so
// nothing is pre-selected from the browser locale or the domain. Filling the
// area says "customers come to this place" without asking whether the business
// is local.
//
// A URL handed over by the landing page (`?url=`) is pre-filled, not started:
// auto-starting hid the market and Search Console choices from almost every
// operator. `&start=1` keeps the one-click start for scripts and deep links.

const AREA_LEVELS: GeoLevel[] = ["region", "city", "district", "neighborhood", "street", "premise"];
const AREA_UNPICKED = "Choose a place from the list, or clear this field.";

export default function NewTrialPage() {
  return (
    <Suspense fallback={<TrialSkeleton />}>
      <NewTrialForm />
    </Suspense>
  );
}

interface IntakeValues {
  url: string;
  country: CountryChoice;
  areaPick: IntakeAreaPick | null;
  areaQuery: string;
  searchConsole: boolean;
  /** Returning from a successful Google consent: connected even if the status request has not answered yet. */
  assumeConnected?: boolean;
  /** The operator already submitted this area once before the consent redirect. */
  skipAreaCheck?: boolean;
}

function hostOf(value: string): string {
  try {
    return new URL(/^[a-z][a-z0-9+.-]*:\/\//i.test(value) ? value : `https://${value}`).hostname || value;
  } catch {
    return value;
  }
}

function initialCountry(country: string | null, worldwide: boolean): CountryChoice {
  if (worldwide) return WORLDWIDE_CHOICE;
  if (country && isCountryCode(country)) return country.trim().toUpperCase();
  return DETECT_CHOICE;
}

/** "market.area.place.countryCode: The area is not in the chosen country; …" → the first readable reason. */
function marketErrorMessage(message: string): string {
  const first = message.split("; ")[0] ?? message;
  const reason = first.includes(": ") ? first.slice(first.indexOf(": ") + 2) : first;
  return `Check where your customers are: ${reason.charAt(0).toLowerCase()}${reason.slice(1)}${/[.!?]$/.test(reason) ? "" : "."}`;
}

function NewTrialForm() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const incomingUrl = searchParams.get("url")?.trim() ?? "";
  const startParam = searchParams.get("start") === "1";
  const countryParam = searchParams.get("country");
  const worldwideParam = searchParams.get("worldwide") === "1";
  const gscReturnParam = searchParams.get(GSC_RETURN_PARAM);
  const gscStatusParam = searchParams.get(GSC_STATUS_PARAM);

  const [url, setUrl] = useState(incomingUrl);
  const [country, setCountry] = useState<CountryChoice>(() => initialCountry(countryParam, worldwideParam));
  const [areaPick, setAreaPick] = useState<IntakeAreaPick | null>(null);
  const [areaQuery, setAreaQuery] = useState("");
  /** Bumped to remount the area search (cleared, restored, or the country changed). */
  const [areaKey, setAreaKey] = useState(0);
  const [focusArea, setFocusArea] = useState(false);
  const [areaError, setAreaError] = useState<string | null>(null);
  const [areaResolving, setAreaResolving] = useState(false);
  // On by default (operator, 2026-10-15). The switch turns itself off when
  // Search Console isn't set up on this computer, and stays off after a
  // cancelled Google sign-in.
  const [searchConsole, setSearchConsole] = useState(true);
  const [gscNotice, setGscNotice] = useState<SearchConsoleNotice | null>(null);
  const [loading, setLoading] = useState(false);
  const [autoStarting, setAutoStarting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const urlInputRef = useRef<HTMLInputElement>(null);
  const countryInputRef = useRef<HTMLInputElement>(null);
  const areaInputRef = useRef<HTMLInputElement>(null);
  /** The chip's "Clear area" button: the focus target once a picked area replaces the search input. */
  const areaClearRef = useRef<HTMLButtonElement>(null);
  const gscStatus = useRef<SearchConsoleStatus | null>(null);
  const areaSearch = useRef<PlaceSearchState | null>(null);
  // One start per page load: the guard stops React's dev-mode double effect
  // (and a double click) from creating two projects.
  const started = useRef(false);
  const initialised = useRef(false);

  const countryCode = isCountryCode(country) ? country.toUpperCase() : null;

  // Controls are disabled while loading, and a disabled input cannot take
  // focus: the field to focus after an error is remembered and focused once the
  // form is enabled again.
  const [focusTarget, setFocusTarget] = useState<"url" | "country" | "area" | null>(null);
  const focusAfterError = useCallback((field: "url" | "country" | "area") => setFocusTarget(field), []);
  useEffect(() => {
    if (!focusTarget || loading) return;
    // Picking an area unmounts the search input; keyboard focus then fell back
    // to the page body. With a chip shown, "area" means its clear button.
    const target = focusTarget === "area" ? areaInputRef.current ?? areaClearRef.current : focusTarget === "country" ? countryInputRef.current : urlInputRef.current;
    target?.focus();
    setFocusTarget(null);
  }, [focusTarget, loading]);

  /** Whether typed-but-unpicked area text has suggestions (then the operator must pick one). */
  const areaHasSuggestions = useCallback(async (query: string, code: string): Promise<boolean> => {
    const known = areaSearch.current;
    if (known && known.query === query && (known.status === "results" || known.status === "empty" || known.status === "unavailable")) {
      return known.status === "results" && known.count > 0;
    }
    try {
      const { suggestions } = await api.geoSearch({ q: query, country: code, strict: true });
      return suggestions.some((s) => AREA_LEVELS.includes(s.level));
    } catch {
      // Search is down: the text is sent as-is and looked up during analysis.
      return false;
    }
  }, []);

  const start = useCallback(
    async (values: IntakeValues) => {
      const trimmed = values.url.trim();
      if (!trimmed) {
        urlInputRef.current?.focus();
        return;
      }
      if (started.current) return;
      started.current = true;
      setError(null);
      setAreaError(null);
      setLoading(true);

      const code = isCountryCode(values.country) ? values.country.toUpperCase() : null;
      let area: MarketHintInput["area"] = null;
      if (code && values.areaPick) {
        area = intakeAreaFromPick(values.areaPick, code);
      } else if (code) {
        const typed = values.areaQuery.trim();
        if (typed.length >= 2) {
          if (!values.skipAreaCheck && (await areaHasSuggestions(typed, code))) {
            setAreaError(AREA_UNPICKED);
            setLoading(false);
            started.current = false;
            focusAfterError("area");
            return;
          }
          area = { query: typed.slice(0, 120), place: null };
        }
      }
      const market = intakeMarket(values.country, area);

      // Google consent is a full-page redirect. The form goes to sessionStorage
      // first and no project exists yet, so a cancelled consent leaves nothing
      // behind and the return restores the operator's answers.
      const status = gscStatus.current;
      if (values.searchConsole && !values.assumeConnected && status?.configured && !status.connected) {
        saveIntakeDraft(browserSessionStorage(), { url: trimmed, market, areaLabel: values.areaPick?.title ?? null, searchConsole: true });
        // Back from Google's page reloads this entry or restores it from the
        // back/forward cache. Marking the entry as a return makes a reload
        // restore the draft (not connected, so nothing starts); the `pageshow`
        // handler below re-enables a cached page that was left mid-submit.
        const returnPath = `/trial/new?${GSC_RETURN_PARAM}=1&url=${encodeURIComponent(trimmed)}`;
        window.history.replaceState(null, "", returnPath);
        window.location.assign(searchConsoleStartHref(returnPath));
        return;
      }

      try {
        const { project } = await api.createProject({ url: trimmed, market });
        const useSearchConsole = values.searchConsole && (values.assumeConnected === true || gscStatus.current?.connected === true);
        await api.startCrawl(project.id, useSearchConsole ? { searchConsole: { enabled: true } } : undefined);
        const next = `/projects/${project.id}/understand`;
        router.prefetch(next);
        router.push(next);
        // `loading` stays true until the Understand route replaces this page.
      } catch (err) {
        started.current = false;
        setLoading(false);
        setAutoStarting(false);
        if (err instanceof ApiError && err.code === "invalid_request" && err.message.startsWith("market.")) {
          setError(marketErrorMessage(err.message));
          focusAfterError(err.message.startsWith("market.area") && code ? "area" : "country");
          return;
        }
        setError(err instanceof ApiError ? err.message : "Could not start the analysis. Check the URL and try again.");
        focusAfterError("url");
      }
    },
    [router, areaHasSuggestions, focusAfterError],
  );

  useEffect(() => {
    if (initialised.current) return;
    initialised.current = true;

    const returning = gscReturnParam !== null || gscStatusParam !== null;
    const decision = decideIntakeReturn({
      gscReturn: gscReturnParam,
      gscStatus: gscStatusParam,
      url: incomingUrl || null,
      draft: returning ? takeIntakeDraft(browserSessionStorage()) : null,
    });

    if (decision.returning) {
      const restored = decision.draft ? intakeChoiceFromMarket(decision.draft.market, decision.draft.areaLabel) : null;
      const restoredUrl = decision.draft?.url ?? incomingUrl;
      if (restored) {
        setCountry(restored.country);
        setAreaPick(restored.areaPick);
        setAreaQuery(restored.areaQuery);
        setAreaKey((key) => key + 1);
      }
      setUrl(restoredUrl);
      setSearchConsole(decision.searchConsole);
      setGscNotice(decision.notice);
      // Drop the consent parameters so a reload is an ordinary visit.
      const clean = new URLSearchParams();
      if (restoredUrl) clean.set("url", restoredUrl);
      const query = clean.toString();
      window.history.replaceState(null, "", `/trial/new${query ? `?${query}` : ""}`);
      if (decision.autoStart && restored) {
        setAutoStarting(true);
        void start({ url: restoredUrl, ...restored, searchConsole: true, assumeConnected: true, skipAreaCheck: true });
        return;
      }
      (restoredUrl ? countryInputRef : urlInputRef).current?.focus();
      return;
    }

    if (incomingUrl && startParam) {
      setAutoStarting(true);
      void start({ url: incomingUrl, country: initialCountry(countryParam, worldwideParam), areaPick: null, areaQuery: "", searchConsole: false });
      return;
    }
    // A carried-over website is already filled in; the next decision is the market.
    (incomingUrl ? countryInputRef : urlInputRef).current?.focus();
    // Runs once per page load; later query-string changes (the replaceState
    // above) must not restore or start again.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    function onPageShow(event: PageTransitionEvent) {
      if (!event.persisted) return;
      started.current = false;
      setLoading(false);
      setAutoStarting(false);
      // The fields are still on screen, so a reload from here is an ordinary
      // visit; the saved draft stays for a consent the operator still finishes.
      const clean = new URLSearchParams(window.location.search);
      clean.delete(GSC_RETURN_PARAM);
      clean.delete(GSC_STATUS_PARAM);
      const query = clean.toString();
      window.history.replaceState(null, "", `/trial/new${query ? `?${query}` : ""}`);
    }
    window.addEventListener("pageshow", onPageShow);
    return () => window.removeEventListener("pageshow", onPageShow);
  }, []);

  function changeCountry(next: CountryChoice) {
    setCountry(next);
    setError(null);
    setAreaError(null);
    // An area belongs to one country: a different choice clears it.
    setAreaPick(null);
    setAreaQuery("");
    setAreaKey((key) => key + 1);
    setFocusArea(false);
  }

  function clearArea() {
    setAreaPick(null);
    setAreaQuery("");
    setAreaError(null);
    setFocusArea(true);
    setAreaKey((key) => key + 1);
  }

  const busy = loading || areaResolving;
  const prefilled = Boolean(incomingUrl) && !autoStarting;
  const heading = autoStarting ? "Starting your analysis" : prefilled ? `Ready to analyse ${hostOf(incomingUrl)}` : "Analyse your brand";
  const lede = autoStarting
    ? `Connecting to ${url || incomingUrl} and planning the crawl…`
    : prefilled
      ? "Add where your customers are, or just start. We'll detect it from the website."
      : "Enter your website. We work out what the business does and where its customers are; you confirm it next.";

  return (
    <main className="min-h-screen">
      <div className="mx-auto max-w-6xl px-4 py-5 sm:px-6">
        <div className="flex items-center justify-between gap-4">
          <Link href="/" className="focus-ring flex items-center gap-2.5 rounded-md" aria-label="Project Sun home">
            <span className="sun-mark" aria-hidden="true">
              <span />
            </span>
            <span className="text-sm font-semibold tracking-tight text-ink-950">Project Sun</span>
          </Link>
          <Link href="/" className="focus-ring rounded text-sm text-ink-500 transition hover:text-ink-900">
            ← Back
          </Link>
        </div>

        <div className="mt-8 grid gap-10 lg:mt-12 lg:grid-cols-[minmax(0,1fr)_360px] lg:gap-16">
          <section className="min-w-0 max-w-xl">
            <p className="sun-eyebrow text-sun-700">Start</p>
            <h1 className="sun-title mt-2 break-words">{heading}</h1>
            <p className="mt-2.5 break-words text-[15px] leading-6 text-ink-600">{lede}</p>

            <Card className="mt-6">
              <CardBody className="p-5 sm:p-6">
                <form
                  onSubmit={(event) => {
                    event.preventDefault();
                    if (busy) return;
                    void start({ url, country, areaPick, areaQuery, searchConsole });
                  }}
                  className="space-y-5"
                >
                  <div>
                    <Label htmlFor="url">Website</Label>
                    <Input
                      id="url"
                      ref={urlInputRef}
                      type="text"
                      required
                      placeholder="https://example.com"
                      value={url}
                      onChange={(event) => setUrl(event.target.value)}
                      disabled={loading}
                      autoFocus={!incomingUrl}
                      className="h-11 text-base sm:text-sm"
                    />
                  </div>

                  <div className="border-t border-ink-100 pt-4">
                    <fieldset className="min-w-0 space-y-4" disabled={loading}>
                      <legend className="mb-1.5 w-full text-sm font-medium text-ink-800">
                        <span className="flex items-center justify-between gap-2">
                          <span id="market-legend">Where are your customers?</span>
                          <Badge tone="outline">Optional</Badge>
                        </span>
                      </legend>
                      <div>
                        <CountryCombobox
                          id="market-country"
                          value={country}
                          onChange={changeCountry}
                          disabled={loading}
                          labelledBy="market-legend"
                          describedBy="market-country-help"
                          inputRef={countryInputRef}
                        />
                        <p id="market-country-help" className="mt-1.5 text-xs leading-5 text-ink-500">
                          Pick a country, or Worldwide if you sell everywhere online. Leave it and we&apos;ll read it from your website.
                        </p>
                      </div>

                      {countryCode && (
                        <div>
                          {areaPick ? (
                            <>
                              <div className="flex items-center justify-between gap-2">
                                <span id="market-area-label" className="mb-1.5 block text-sm font-medium text-ink-800">
                                  Area or city
                                </span>
                                <Badge tone="outline">Optional</Badge>
                              </div>
                              <div
                                role="group"
                                aria-labelledby="market-area-label"
                                className="flex min-h-11 items-center justify-between gap-2 rounded-lg border border-sun-200 bg-sun-50 py-1.5 pl-3 pr-1.5 sm:min-h-10"
                              >
                                <span className="min-w-0 break-words text-sm text-ink-800">
                                  <span className="font-medium text-ink-950">{areaPick.title}</span>
                                  {areaPick.subtitle && <span className="text-ink-500"> · {areaPick.subtitle}</span>}
                                </span>
                                <button
                                  ref={areaClearRef}
                                  type="button"
                                  onClick={clearArea}
                                  disabled={loading}
                                  aria-label={`Clear area ${areaPick.title}`}
                                  className="focus-ring flex h-8 w-8 shrink-0 items-center justify-center rounded-md text-ink-500 transition hover:bg-sun-100 hover:text-ink-900 disabled:cursor-not-allowed"
                                >
                                  <svg aria-hidden="true" viewBox="0 0 20 20" fill="currentColor" className="h-4 w-4">
                                    <path d="M6.28 5.22a.75.75 0 0 0-1.06 1.06L8.94 10l-3.72 3.72a.75.75 0 1 0 1.06 1.06L10 11.06l3.72 3.72a.75.75 0 1 0 1.06-1.06L11.06 10l3.72-3.72a.75.75 0 0 0-1.06-1.06L10 8.94 6.28 5.22Z" />
                                  </svg>
                                </button>
                              </div>
                            </>
                          ) : (
                            <PlaceSearchCombobox
                              key={`${countryCode}-${areaKey}`}
                              id="market-area"
                              label="Area or city"
                              labelAside={<Badge tone="outline">Optional</Badge>}
                              placeholder="Neighbourhood, area or city"
                              country={countryCode}
                              strict
                              levels={AREA_LEVELS}
                              initialQuery={areaQuery}
                              autoFocus={focusArea}
                              disabled={loading}
                              invalid={Boolean(areaError)}
                              describedBy={areaError ? "market-area-help market-area-error" : "market-area-help"}
                              inputRef={areaInputRef}
                              inputClassName="h-11 text-base sm:h-10 sm:text-sm"
                              submitOnEnter
                              attribution
                              emptyNote={(q) => `No places match. We'll look up “${q}” during analysis.`}
                              unavailableNote={(q) => `Place search is unavailable. We'll look up “${q}” during analysis.`}
                              onQueryChange={(q) => {
                                setAreaQuery(q);
                                setAreaError(null);
                              }}
                              onSearchState={(state) => {
                                areaSearch.current = state;
                              }}
                              onResolvingChange={setAreaResolving}
                              onPick={(place, suggestion) => {
                                setAreaPick({ title: suggestion.title, subtitle: suggestion.subtitle, place });
                                setAreaQuery("");
                                setAreaError(null);
                                setFocusTarget("area");
                              }}
                            />
                          )}
                          <p id="market-area-help" className="mt-1.5 text-xs leading-5 text-ink-500">
                            For local businesses: where customers visit you or where you work. We use it to find competitors nearby.
                          </p>
                          {areaError && (
                            <p id="market-area-error" role="alert" className="mt-1.5 text-xs font-medium text-danger-600">
                              {areaError}
                            </p>
                          )}
                        </div>
                      )}
                    </fieldset>
                  </div>

                  <div className="border-t border-ink-100 pt-4">
                    <SearchConsoleToggle
                      checked={searchConsole}
                      onCheckedChange={(next) => {
                        setSearchConsole(next);
                        if (next) setGscNotice(null);
                      }}
                      disabled={loading}
                      onStatus={(status) => {
                        gscStatus.current = status;
                      }}
                      notice={gscNotice}
                    />
                  </div>

                  {error && (
                    <Notice tone="danger" role="alert">
                      {error}
                    </Notice>
                  )}
                  <Button type="submit" variant="accent" size="lg" disabled={busy} className="w-full">
                    {loading ? (
                      <>
                        <Spinner /> Starting analysis…
                      </>
                    ) : (
                      "Analyse my brand"
                    )}
                  </Button>
                  <p className="text-center text-xs text-ink-400">Public HTTP(S) URLs only — private and internal addresses are rejected.</p>
                </form>
              </CardBody>
            </Card>
          </section>

          <aside className="min-w-0 lg:sticky lg:top-8 lg:self-start" aria-label="What happens next">
            <Card tone="ink" className="p-5 sm:p-6">
              <p className="sun-eyebrow text-sun-300">What happens next</p>
              <ol className="mt-4 space-y-4">
                {[
                  ["Understand", "We read your public pages and build a profile of the business, its offerings and where its customers are. You correct and confirm it."],
                  ["Landscape", "You confirm the topics buyers ask about and the competitors they compare you with, near you and beyond."],
                  ["Prompts", "Thirty buyer questions are written from that context, in three lenses. You edit and approve them; then they are frozen."],
                  ["Measure", "ChatGPT and Gemini are asked every question from their own websites. Every figure opens the answer behind it."],
                ].map(([name, body], index) => (
                  <li key={name} className="flex gap-3">
                    <span aria-hidden="true" className="mt-0.5 grid h-5 w-5 shrink-0 place-items-center rounded-full bg-white/10 text-[11px] font-semibold text-sun-300">
                      {index + 1}
                    </span>
                    <div className="min-w-0">
                      <p className="text-sm font-semibold text-white">{name}</p>
                      <p className="mt-0.5 text-xs leading-5 text-white/60">{body}</p>
                    </div>
                  </li>
                ))}
              </ol>
              <p className="mt-5 border-t border-white/10 pt-4 text-xs leading-5 text-white/55">
                No card, no account. Nothing is asked of ChatGPT or Gemini until you approve the questions, and every answer keeps a record of how it was collected.
              </p>
            </Card>
          </aside>
        </div>
      </div>
    </main>
  );
}
