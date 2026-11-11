"use client";

import { useEffect, useId, useRef, useState, type JSX } from "react";
import { Skeleton } from "@/components/ui/loading-stage";
import { Badge } from "@/components/ui/primitives";
import { cn } from "@/lib/cn";
import { api } from "@/lib/client/api";
import type { SearchConsoleStatus } from "@/lib/search-console/types";
import { TOGGLE_TITLE, connectedLine, setupSteps, toggleView } from "@/lib/search-console/view";

// Intake-page switch for Google Search Console (feedback 2026-09-14: "a Google
// Search Console toggle on the page where they enter the website").
//
// The props and the DOM ids (`gsc-connect`, `gsc-connect-title`, `gsc-toggle`)
// are a contract with the intake page and e2e. The switch only records intent;
// the intake page does the Google round trip on submit, so no project is
// created before consent. Without OAuth credentials on this machine it stays
// disabled and shows the setup steps instead of a Connect button that could
// only fail. The status request never blocks the URL field: until it answers,
// the switch is disabled with a placeholder line.

export interface SearchConsoleToggleProps {
  checked: boolean;
  onCheckedChange: (next: boolean) => void;
  disabled?: boolean;
  /** null while loading or when the status request failed. */
  onStatus?: (status: SearchConsoleStatus | null) => void;
  notice?: "denied" | "error" | null;
}

export function SearchConsoleToggle(props: SearchConsoleToggleProps): JSX.Element {
  const { checked, onCheckedChange, onStatus, notice } = props;
  const [status, setStatus] = useState<SearchConsoleStatus | null>(null);
  const [loaded, setLoaded] = useState(false);
  const [disconnecting, setDisconnecting] = useState(false);
  const [disconnectError, setDisconnectError] = useState(false);
  const helperId = useId();
  // Latest callbacks without re-running the status effect when the parent re-renders.
  const callbacks = useRef({ onCheckedChange, onStatus, checked, notice });
  callbacks.current = { onCheckedChange, onStatus, checked, notice };

  useEffect(() => {
    let cancelled = false;
    api
      .getSearchConsoleStatus()
      .then(({ status: next }) => {
        if (cancelled) return;
        setStatus(next);
        setLoaded(true);
        callbacks.current.onStatus?.(next);
        // The intake page starts the switch on; this keeps it on once connected.
        // After a cancelled sign-in the intake page decides instead.
        if (next.connected && !callbacks.current.checked && !callbacks.current.notice) callbacks.current.onCheckedChange(true);
        if (!next.configured && callbacks.current.checked) callbacks.current.onCheckedChange(false);
      })
      .catch(() => {
        if (cancelled) return;
        setStatus(null);
        setLoaded(true);
        callbacks.current.onStatus?.(null);
        if (callbacks.current.checked) callbacks.current.onCheckedChange(false);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  const view = toggleView({ status, loaded, checked, disabled: props.disabled || disconnecting, notice });

  async function disconnect() {
    setDisconnecting(true);
    setDisconnectError(false);
    try {
      const { status: next } = await api.disconnectSearchConsole();
      setStatus(next);
      onStatus?.(next);
      onCheckedChange(false);
    } catch {
      setDisconnectError(true);
    } finally {
      setDisconnecting(false);
    }
  }

  return (
    <section id="gsc-connect" aria-labelledby="gsc-connect-title" className="space-y-1.5">
      <div className="flex items-start justify-between gap-4">
        <div className="flex min-w-0 flex-wrap items-center gap-2">
          <span id="gsc-connect-title" className="text-sm font-medium text-ink-800">
            {TOGGLE_TITLE}
          </span>
          <Badge tone="outline">Optional</Badge>
        </div>
        <button
          type="button"
          role="switch"
          id="gsc-toggle"
          aria-checked={checked}
          aria-labelledby="gsc-connect-title"
          aria-describedby={helperId}
          aria-busy={view.loading || undefined}
          disabled={view.switchDisabled}
          onClick={() => onCheckedChange(!checked)}
          className={cn(
            "focus-ring relative inline-flex h-6 w-11 shrink-0 items-center rounded-full transition disabled:cursor-not-allowed disabled:opacity-50",
            checked ? "bg-ink-950" : "bg-ink-300",
          )}
        >
          <span className={cn("inline-block h-5 w-5 rounded-full bg-white shadow-sm transition", checked ? "translate-x-5" : "translate-x-0.5")} />
        </button>
      </div>

      <div id={helperId} className="space-y-1 text-xs leading-5">
        {view.loading ? (
          <>
            <Skeleton className="h-3 w-full" />
            <span className="sr-only">Checking Google Search Console…</span>
          </>
        ) : (
          view.lines.map((line, index) => (
            <p key={line} className={cn(index === 0 && view.tone === "warn" ? "text-warn-600" : "text-ink-500")}>
              {line}
            </p>
          ))
        )}
        {view.connected && (
          <p className="text-ink-500">
            {connectedLine(view.propertyCount)}
            {" · "}
            <button
              type="button"
              onClick={() => void disconnect()}
              disabled={disconnecting || props.disabled}
              className="focus-ring rounded font-medium text-ink-600 underline decoration-dotted underline-offset-2 hover:text-brand-600 disabled:cursor-not-allowed disabled:opacity-50"
            >
              {disconnecting ? "Disconnecting…" : "Disconnect"}
            </button>
          </p>
        )}
        {disconnectError && <p className="text-warn-600">Couldn&apos;t disconnect. Try again.</p>}
      </div>

      {view.setup && (
        <details className="text-xs text-ink-500">
          <summary className="focus-ring w-fit cursor-pointer rounded font-medium text-ink-600 underline decoration-dotted underline-offset-2 hover:text-brand-600">Setup steps</summary>
          <ol className="sun-inset mt-2 list-decimal space-y-1.5 py-3 pl-7 pr-3 leading-5 text-ink-600">
            {setupSteps(view.setup.redirectUri).map((step) => (
              <li key={step} className="break-words">
                {step}
              </li>
            ))}
          </ol>
        </details>
      )}
    </section>
  );
}
