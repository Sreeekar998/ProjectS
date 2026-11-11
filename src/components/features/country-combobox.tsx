"use client";

import { useEffect, useMemo, useRef, useState, type KeyboardEvent, type Ref } from "react";
import { cn } from "@/lib/cn";
import {
  countryPickerOption,
  countryPickerOptions,
  countryResultCount,
  searchCountryOptions,
  type CountryChoice,
  type CountryPickerOption,
} from "@/lib/geo/country-search";
import { browserDrawsFlags, flagEmoji } from "@/lib/geo/flags";

// Searchable "Where are your customers?" picker: Detect from my website,
// Worldwide / online, and every ISO country. ARIA APG "combobox with listbox
// popup", the same pattern as the place search.
//
// Each country carries its flag: a 250-name list scans faster by shape than by
// text, and the committed choice is confirmed at a glance. Windows draws no
// flag glyphs, so the picker checks once and shows the ISO code in a chip
// there instead; the name is always the identification, the flag a cue.
//
// The input shows the committed choice; typing filters. Leaving the field
// without picking restores the committed choice, so a half-typed name never
// silently becomes the market.

/** The flag (or ISO chip) before a country's name; the special options carry a small glyph of their own. */
function OptionMark({ option, flags }: { option: CountryPickerOption; flags: boolean }) {
  if (option.kind === "special") {
    return (
      <span aria-hidden="true" className="grid h-5 w-7 shrink-0 place-items-center text-ink-500">
        {option.value === "worldwide" ? (
          <svg viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="1.5" className="h-4 w-4">
            <circle cx="10" cy="10" r="7.25" />
            <path d="M2.75 10h14.5M10 2.75c2.6 2.4 3.9 4.8 3.9 7.25S12.6 14.85 10 17.25M10 2.75c-2.6 2.4-3.9 4.8-3.9 7.25s1.3 4.85 3.9 7.25" />
          </svg>
        ) : (
          <svg viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="1.5" className="h-4 w-4">
            <circle cx="9" cy="9" r="5.25" />
            <path d="M13 13l3.5 3.5" strokeLinecap="round" />
          </svg>
        )}
      </span>
    );
  }
  const flag = flagEmoji(option.value);
  if (flags && flag) {
    return (
      <span aria-hidden="true" className="w-7 shrink-0 text-center text-lg leading-none">
        {flag}
      </span>
    );
  }
  return (
    <span aria-hidden="true" className="grid h-5 w-7 shrink-0 place-items-center rounded bg-ink-100 text-[10px] font-semibold tracking-wide text-ink-600">
      {option.value.toUpperCase()}
    </span>
  );
}

export interface CountryComboboxProps {
  id: string;
  value: CountryChoice;
  onChange: (value: CountryChoice) => void;
  disabled?: boolean;
  /** Id of the element that names the field (the fieldset legend). */
  labelledBy?: string;
  describedBy?: string;
  inputRef?: Ref<HTMLInputElement>;
  className?: string;
}

/**
 * What Enter does: submit the form, commit an option, or restore the committed
 * choice. The list closed by Escape keeps the typed text, and Enter then
 * submitted the committed market while the field still read the typed country
 * (review 2026-09-14). Typed text never lets Enter submit; it commits the best
 * match (as an open list does) or restores the field, so the operator sees the
 * market before the next Enter starts anything.
 */
export function comboboxEnterAction(input: {
  open: boolean;
  query: string | null;
  active: CountryPickerOption | undefined;
  options: CountryPickerOption[];
}): { kind: "submit" } | { kind: "pick"; option: CountryPickerOption } | { kind: "restore" } {
  const { open, query, active, options } = input;
  if (!open && query === null) return { kind: "submit" };
  const choice = (open ? active : undefined) ?? (query && query.trim() ? searchCountryOptions(query, options)[0] : undefined);
  return choice ? { kind: "pick", option: choice } : { kind: "restore" };
}

function countMessage(query: string, count: number): string {
  if (count === 0) return `No country matches “${query}”.`;
  return count === 1 ? "1 country matches" : `${count} countries match`;
}

export function CountryCombobox({ id, value, onChange, disabled = false, labelledBy, describedBy, inputRef, className }: CountryComboboxProps) {
  const options = useMemo(() => countryPickerOptions(), []);
  // Unknown values fall back to the first option ("Detect from my website"), which always exists.
  const committed = countryPickerOption(value, options) ?? options[0]!;
  const listId = `${id}-listbox`;
  const optionId = (option: CountryPickerOption) => `${id}-option-${option.value}`;

  const [open, setOpen] = useState(false);
  /** Typed text; null = not filtering (the input shows the committed choice). */
  const [query, setQuery] = useState<string | null>(null);
  const [activeIndex, setActiveIndex] = useState(-1);
  // Decided once the component is on screen (canvas), so the server render and
  // the first client render agree and no flag flashes into a code chip.
  const [flags, setFlags] = useState(false);
  useEffect(() => setFlags(browserDrawsFlags()), []);
  /** Tab commits the active option only when the operator moved to it with the keyboard or mouse. */
  const navigated = useRef(false);
  /** Focus selects the text so typing replaces it; the click that focused must not undo that selection. */
  const focusedByPointer = useRef(false);

  const results = useMemo(() => (query === null ? options : searchCountryOptions(query, options)), [options, query]);
  const active = open && activeIndex >= 0 ? results[activeIndex] : undefined;

  useEffect(() => {
    if (!active) return;
    document.getElementById(optionId(active))?.scrollIntoView({ block: "nearest" });
    // optionId only depends on `id`, which is stable for the component's life.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [active]);

  function openList(highlightCommitted: boolean) {
    setOpen(true);
    if (highlightCommitted) {
      const index = results.findIndex((option) => option.value === committed.value);
      setActiveIndex(index >= 0 ? index : 0);
    }
  }

  function close(restore: boolean) {
    setOpen(false);
    setActiveIndex(-1);
    navigated.current = false;
    if (restore) setQuery(null);
  }

  function pick(option: CountryPickerOption) {
    close(true);
    if (option.value !== value) onChange(option.value);
  }

  function move(next: number) {
    if (results.length === 0) return;
    navigated.current = true;
    setActiveIndex(((next % results.length) + results.length) % results.length);
  }

  function onKeyDown(event: KeyboardEvent<HTMLInputElement>) {
    switch (event.key) {
      case "ArrowDown":
        event.preventDefault();
        if (!open) {
          openList(true);
          navigated.current = true;
        } else move(activeIndex + 1);
        break;
      case "ArrowUp":
        event.preventDefault();
        if (!open) {
          openList(true);
          navigated.current = true;
        } else move(activeIndex <= 0 ? results.length - 1 : activeIndex - 1);
        break;
      case "Home":
      case "End":
        if (!open || results.length === 0) break;
        event.preventDefault();
        move(event.key === "Home" ? 0 : results.length - 1);
        break;
      case "Enter": {
        const action = comboboxEnterAction({ open, query, active, options });
        if (action.kind === "submit") break; // the field shows the committed choice: let Enter submit the form
        event.preventDefault();
        if (action.kind === "pick") pick(action.option);
        else close(true);
        break;
      }
      case "Escape":
        if (open) {
          event.preventDefault();
          close(false);
        } else if (query !== null) {
          event.preventDefault();
          setQuery(null);
        }
        break;
      case "Tab":
        if (open && navigated.current && active) pick(active);
        else close(true);
        break;
    }
  }

  const count = countryResultCount(results);
  const typed = query !== null && query.trim() !== "";

  // The committed country's flag sits inside the field while it shows the
  // committed name; it hides while the operator types.
  const committedFlag = query === null && committed.kind === "country" ? flagEmoji(committed.value) : null;
  const showLeading = committedFlag !== null;

  return (
    <div className={cn("relative", className)}>
      <div className="relative">
        {showLeading && (
          <span aria-hidden="true" className="pointer-events-none absolute inset-y-0 left-3 flex items-center">
            {flags ? (
              <span className="text-lg leading-none">{committedFlag}</span>
            ) : (
              <span className="rounded bg-ink-100 px-1 text-[10px] font-semibold tracking-wide text-ink-600">{committed.value.toUpperCase()}</span>
            )}
          </span>
        )}
        <input
          id={id}
          ref={inputRef}
          type="text"
          role="combobox"
          aria-autocomplete="list"
          aria-expanded={open && results.length > 0}
          aria-controls={listId}
          aria-activedescendant={active ? optionId(active) : undefined}
          aria-labelledby={labelledBy}
          aria-describedby={describedBy}
          autoComplete="off"
          autoCorrect="off"
          spellCheck={false}
          enterKeyHint="done"
          disabled={disabled}
          value={query ?? committed.label}
          onChange={(event) => {
            setQuery(event.target.value);
            setOpen(true);
            setActiveIndex(-1);
            navigated.current = false;
          }}
          onFocus={(event) => event.currentTarget.select()}
          onMouseDown={(event) => {
            focusedByPointer.current = document.activeElement !== event.currentTarget;
          }}
          onMouseUp={(event) => {
            if (focusedByPointer.current) event.preventDefault();
            focusedByPointer.current = false;
          }}
          onClick={(event) => {
            if (open) return;
            openList(query === null);
            // A tap on an already-focused field (it is focused on load after a
            // landing hand-off) would otherwise put the caret mid-name, and typing
            // would append to "United Arab Emirates" instead of searching.
            if (query === null) event.currentTarget.select();
          }}
          onKeyDown={onKeyDown}
          onBlur={() => close(true)}
          className={cn(
            "focus-ring h-11 w-full rounded-lg border border-ink-200 bg-white pr-10 text-base text-ink-900 placeholder:text-ink-300 disabled:cursor-not-allowed disabled:bg-ink-50 disabled:text-ink-400 sm:h-10 sm:text-sm",
            showLeading ? (flags ? "pl-11" : "pl-12") : "pl-3",
          )}
        />
        <button
          type="button"
          tabIndex={-1}
          aria-hidden="true"
          disabled={disabled}
          onMouseDown={(event) => event.preventDefault()}
          onClick={() => {
            if (open) close(true);
            else {
              document.getElementById(id)?.focus();
              openList(true);
            }
          }}
          className="absolute inset-y-0 right-0 flex w-10 items-center justify-center text-ink-400 disabled:cursor-not-allowed"
        >
          <svg viewBox="0 0 20 20" fill="currentColor" className={cn("h-4 w-4 transition-transform", open && "rotate-180")}>
            <path fillRule="evenodd" d="M5.23 7.21a.75.75 0 0 1 1.06.02L10 11.06l3.71-3.83a.75.75 0 1 1 1.08 1.04l-4.25 4.39a.75.75 0 0 1-1.08 0L5.21 8.27a.75.75 0 0 1 .02-1.06Z" clipRule="evenodd" />
          </svg>
        </button>
      </div>

      <div aria-live="polite" className="sr-only">
        {open && typed ? countMessage(query!.trim(), count) : ""}
      </div>

      {open && results.length > 0 && (
        <ul
          id={listId}
          role="listbox"
          aria-label="Countries"
          className="absolute left-0 right-0 z-20 mt-1 max-h-[50vh] overflow-y-auto overscroll-contain rounded-lg border border-ink-200 bg-white py-1 shadow-sm sm:max-h-72"
        >
          {results.map((option, index) => {
            const isActive = index === activeIndex;
            const isCommitted = option.value === committed.value;
            const firstCountry = option.kind === "country" && results[index - 1]?.kind === "special";
            return (
              <li
                key={option.value}
                id={optionId(option)}
                role="option"
                aria-selected={isActive}
                onMouseDown={(event) => event.preventDefault()}
                onMouseEnter={() => {
                  navigated.current = true;
                  setActiveIndex(index);
                }}
                onClick={() => pick(option)}
                className={cn(
                  "flex min-h-11 cursor-pointer items-center justify-between gap-3 px-3 py-2 text-base sm:min-h-9 sm:text-sm",
                  isActive && "bg-brand-50",
                  firstCountry && "border-t border-ink-100",
                )}
              >
                <span className="flex min-w-0 items-center gap-2.5">
                  <OptionMark option={option} flags={flags} />
                  <span className="min-w-0">
                    <span className={cn("block break-words text-ink-900", option.kind === "special" && "font-medium")}>{option.label}</span>
                    {option.description && <span className="block break-words text-xs text-ink-500">{option.description}</span>}
                  </span>
                </span>
                {isCommitted && (
                  <svg aria-hidden="true" viewBox="0 0 20 20" fill="currentColor" className="h-4 w-4 shrink-0 text-brand-600">
                    <path fillRule="evenodd" d="M16.7 5.3a1 1 0 0 1 0 1.4l-8 8a1 1 0 0 1-1.4 0l-4-4a1 1 0 1 1 1.4-1.4L8 12.58l7.3-7.3a1 1 0 0 1 1.4 0Z" clipRule="evenodd" />
                  </svg>
                )}
              </li>
            );
          })}
        </ul>
      )}
      {open && results.length === 0 && typed && (
        <p className="absolute left-0 right-0 z-20 mt-1 rounded-lg border border-ink-200 bg-white px-3 py-2 text-sm text-ink-500 shadow-sm">
          No country matches “{query!.trim()}”.
        </p>
      )}
    </div>
  );
}
