"use client";

import { useEffect, useId, useRef, useState, type KeyboardEvent, type ReactNode, type Ref } from "react";
import { Input, Label, Spinner } from "@/components/ui/primitives";
import { api } from "@/lib/client/api";
import { cn } from "@/lib/cn";
import type { GeoLevel, GeoPlace, GeoSuggestion } from "@/lib/geo/types";

// Debounced place type-ahead (ARIA combobox with a listbox popup), shared by
// the Understand "Change location" editor and the intake "Area or city" field.
// It was inlined in the editor; the intake needed the same search with a
// strict in-country filter, so it lives here once instead of as a fork.
//
// Only the typed text, the country, a coordinate bias and a per-edit session
// token reach `/api/geo/search`; nothing about the project is sent.

export interface PlaceSearchState {
  /** The trimmed query this state describes. */
  query: string;
  status: "idle" | "searching" | "results" | "empty" | "unavailable";
  /** Suggestions shown for `query` (after the level filter). */
  count: number;
}

type Note = string | null | ((query: string) => string | null);

export interface PlaceSearchComboboxProps {
  id?: string;
  label: string;
  /** Rendered next to the label, e.g. an "Optional" badge. */
  labelAside?: ReactNode;
  placeholder?: string;
  /** ISO alpha-2 bias (or filter with `strict`). Read when the debounce fires, not on every change. */
  country?: string | null;
  /** Only places inside `country`. */
  strict?: boolean;
  /** Coordinate bias. Read when the debounce fires. */
  near?: { lat: number; lng: number } | null;
  /** Keep only these suggestion levels (the intake never offers a whole country as an area). */
  levels?: GeoLevel[];
  /** Search again without the country and coordinate bias when the biased search finds nothing. */
  fallbackToWorldwide?: boolean;
  initialQuery?: string;
  autoFocus?: boolean;
  disabled?: boolean;
  invalid?: boolean;
  describedBy?: string;
  inputRef?: Ref<HTMLInputElement>;
  inputClassName?: string;
  /** Let Enter submit the surrounding form when no suggestion list is open. */
  submitOnEnter?: boolean;
  emptyNote?: Note;
  unavailableNote?: Note;
  /** Show "Place search uses …" once the provider is known. */
  attribution?: boolean;
  onPick: (place: GeoPlace, suggestion: GeoSuggestion) => void;
  onQueryChange?: (query: string) => void;
  onSearchState?: (state: PlaceSearchState) => void;
  onResolvingChange?: (resolving: boolean) => void;
}

function newSessionToken(): string {
  // randomUUID only exists in secure contexts; a LAN http:// address is not one.
  if (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function") return crypto.randomUUID();
  return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 12)}`;
}

/** The route answers 200 with `unavailable: true` when the provider itself failed (older responses omit the flag). */
function searchUnavailable(response: object): boolean {
  return "unavailable" in response && response.unavailable === true;
}

function noteText(note: Note | undefined, query: string): string | null {
  if (typeof note === "function") return note(query);
  return note ?? null;
}

export function PlaceSearchCombobox({
  id,
  label,
  labelAside,
  placeholder,
  country = null,
  strict = false,
  near = null,
  levels,
  fallbackToWorldwide = false,
  initialQuery = "",
  autoFocus = false,
  disabled = false,
  invalid = false,
  describedBy,
  inputRef,
  inputClassName,
  submitOnEnter = false,
  emptyNote = "No matching places.",
  unavailableNote = "Place search is unavailable right now.",
  attribution = false,
  onPick,
  onQueryChange,
  onSearchState,
  onResolvingChange,
}: PlaceSearchComboboxProps) {
  const generated = useId();
  const inputId = id ?? `${generated}-search`;
  const listId = `${inputId}-suggestions`;
  const noteId = `${inputId}-note`;
  const sessionToken = useRef<string>(newSessionToken());

  const [query, setQuery] = useState(initialQuery);
  const [suggestions, setSuggestions] = useState<GeoSuggestion[]>([]);
  const [searching, setSearching] = useState(false);
  const [status, setStatus] = useState<PlaceSearchState["status"]>("idle");
  const [activeIndex, setActiveIndex] = useState(-1);
  const [listOpen, setListOpen] = useState(false);
  const [resolving, setResolving] = useState(false);
  const [provider, setProvider] = useState<"google" | "openstreetmap" | null>(null);

  // The bias and callbacks are read through refs when the timer fires; re-searching
  // on every bias edit would spend lookups the operator did not ask for.
  const latest = useRef({ country, strict, near, levels, fallbackToWorldwide, onSearchState, onQueryChange });
  latest.current = { country, strict, near, levels, fallbackToWorldwide, onSearchState, onQueryChange };

  useEffect(() => {
    const q = query.trim();
    if (q.length < 2) {
      setSuggestions([]);
      setSearching(false);
      setStatus("idle");
      latest.current.onSearchState?.({ query: q, status: "idle", count: 0 });
      return;
    }
    const controller = new AbortController();
    latest.current.onSearchState?.({ query: q, status: "searching", count: 0 });
    const timer = setTimeout(async () => {
      setSearching(true);
      const bias = latest.current;
      const keep = (found: GeoSuggestion[]) => (bias.levels ? found.filter((s) => bias.levels!.includes(s.level)) : found);
      try {
        const lat = bias.near?.lat ?? null;
        const lng = bias.near?.lng ?? null;
        let response = await api.geoSearch({ q, country: bias.country, strict: bias.strict, lat, lng, session: sessionToken.current }, { signal: controller.signal });
        let found = keep(response.suggestions);
        // A worldwide retry cannot help when the provider itself is down.
        if (found.length === 0 && !searchUnavailable(response) && bias.fallbackToWorldwide && (bias.country || lat !== null)) {
          response = await api.geoSearch({ q, session: sessionToken.current }, { signal: controller.signal });
          found = keep(response.suggestions);
        }
        if (response.provider) setProvider(response.provider);
        const next: PlaceSearchState["status"] = found.length > 0 ? "results" : searchUnavailable(response) ? "unavailable" : "empty";
        setSuggestions(found);
        setActiveIndex(found.length > 0 ? 0 : -1);
        setListOpen(true);
        setStatus(next);
        bias.onSearchState?.({ query: q, status: next, count: found.length });
      } catch {
        if (controller.signal.aborted) return;
        setSuggestions([]);
        setStatus("unavailable");
        bias.onSearchState?.({ query: q, status: "unavailable", count: 0 });
      } finally {
        if (!controller.signal.aborted) setSearching(false);
      }
    }, 350);
    return () => {
      controller.abort();
      clearTimeout(timer);
    };
  }, [query]);

  async function choose(suggestion: GeoSuggestion) {
    setListOpen(false);
    setSuggestions([]);
    setQuery("");
    latest.current.onQueryChange?.("");
    setResolving(true);
    onResolvingChange?.(true);
    let resolved: GeoPlace = suggestion.place;
    try {
      ({ place: resolved } = await api.geoPlace(suggestion, sessionToken.current));
    } catch {
      resolved = suggestion.place;
    } finally {
      // A details lookup ends the provider's autocomplete session.
      sessionToken.current = newSessionToken();
      setResolving(false);
      onResolvingChange?.(false);
    }
    onPick(resolved, suggestion);
  }

  function onKeyDown(event: KeyboardEvent<HTMLInputElement>) {
    const open = listOpen && suggestions.length > 0;
    if (event.key === "ArrowDown" && suggestions.length > 0) {
      event.preventDefault();
      setListOpen(true);
      setActiveIndex((i) => (i + 1) % suggestions.length);
    } else if (event.key === "ArrowUp" && suggestions.length > 0) {
      event.preventDefault();
      setListOpen(true);
      setActiveIndex((i) => (i <= 0 ? suggestions.length - 1 : i - 1));
    } else if (event.key === "Enter") {
      if (open && activeIndex >= 0 && suggestions[activeIndex]) {
        event.preventDefault();
        void choose(suggestions[activeIndex]);
      } else if (!submitOnEnter) {
        event.preventDefault();
      }
    } else if (event.key === "Escape" && open) {
      event.preventDefault();
      setListOpen(false);
    }
  }

  const trimmed = query.trim();
  const note = status === "empty" ? noteText(emptyNote, trimmed) : status === "unavailable" ? noteText(unavailableNote, trimmed) : null;
  const activeId = listOpen && activeIndex >= 0 ? `${inputId}-option-${activeIndex}` : undefined;
  const describedByIds = [describedBy, note ? noteId : null].filter(Boolean).join(" ") || undefined;

  return (
    <div className="relative">
      <div className="flex items-center justify-between gap-2">
        <Label htmlFor={inputId}>{label}</Label>
        {labelAside}
      </div>
      <div className="relative">
        <Input
          id={inputId}
          ref={inputRef}
          role="combobox"
          aria-autocomplete="list"
          aria-expanded={listOpen && suggestions.length > 0}
          aria-controls={listId}
          aria-activedescendant={activeId}
          aria-invalid={invalid || undefined}
          aria-describedby={describedByIds}
          autoComplete="off"
          autoFocus={autoFocus}
          spellCheck={false}
          enterKeyHint="search"
          value={query}
          disabled={disabled}
          onChange={(e) => {
            setQuery(e.target.value);
            setListOpen(true);
            latest.current.onQueryChange?.(e.target.value);
          }}
          onKeyDown={onKeyDown}
          onBlur={() => setListOpen(false)}
          onFocus={() => suggestions.length > 0 && setListOpen(true)}
          placeholder={placeholder}
          className={cn("pr-9", invalid && "border-danger-500", inputClassName)}
        />
        {(searching || resolving) && (
          <span className="absolute right-3 top-1/2 -translate-y-1/2 text-ink-400">
            <Spinner />
          </span>
        )}
      </div>
      {listOpen && suggestions.length > 0 && (
        <ul
          id={listId}
          role="listbox"
          aria-label="Matching places"
          className="absolute left-0 right-0 z-20 mt-1 max-h-[50vh] overflow-y-auto overscroll-contain rounded-lg border border-ink-200 bg-white py-1 shadow-sm sm:max-h-72"
        >
          {suggestions.map((suggestion, index) => (
            <li
              key={`${suggestion.id}-${index}`}
              id={`${inputId}-option-${index}`}
              role="option"
              aria-selected={index === activeIndex}
              onMouseDown={(e) => e.preventDefault()}
              onMouseEnter={() => setActiveIndex(index)}
              onClick={() => void choose(suggestion)}
              className={cn("flex min-h-11 cursor-pointer flex-col justify-center px-3 py-2 text-sm sm:min-h-0", index === activeIndex && "bg-brand-50")}
            >
              <div className="break-words font-medium text-ink-900">{suggestion.title}</div>
              {suggestion.subtitle && <div className="break-words text-xs text-ink-500">{suggestion.subtitle}</div>}
            </li>
          ))}
        </ul>
      )}
      {note && (
        <p id={noteId} className="mt-1.5 text-xs text-ink-400">
          {note}
        </p>
      )}
      {attribution && provider && (
        <p className="mt-1 text-[11px] text-ink-300">Place search uses {provider === "google" ? "Google Maps" : "OpenStreetMap"}</p>
      )}
    </div>
  );
}
