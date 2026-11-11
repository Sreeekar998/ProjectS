"use client";

import { useEffect, useState, type JSX, type ReactNode } from "react";
import { cn } from "@/lib/cn";

// One loading pattern for every stage page.
//
// Pages used to show a bare spinner, or an empty card with "No verified
// suggestions yet" while Landscape was still working, which read as a failure
// (feedback 2026-09-14: "show loading animation on every page, especially
// Landscape"). LoadingStage shows what is happening, with real steps when the
// page has them and an honest indeterminate bar when it has no total; it never
// invents a percentage.
//
// Reduced motion: globals.css clamps every animation to one 0.01 ms run, which
// would leave the indeterminate fill parked off-screen. That fill is hidden
// under `motion-reduce` and a static bar shows instead (`data-loading-bar`
// "animated" / "static", asserted by e2e).
//
// Uses only tokens defined in globals.css (no brand-200/300, ok-50, warn-50).

export interface LoadingStep {
  key: string;
  label: string;
  state: "done" | "active" | "pending";
  detail?: string;
}

export interface LoadingStageProps {
  title: string;
  subtitle?: string;
  steps?: LoadingStep[];
  /** 0–100 for real progress; null/undefined = indeterminate (never invent a %). */
  percent?: number | null;
  /** Epoch ms when the work began; renders the elapsed time (aria-hidden). */
  startedAt?: number | null;
  /** Everything finished: stops animation, header shows a check. */
  complete?: boolean;
  /** Slow/stall notes. */
  note?: ReactNode;
  /** Action buttons (retry, start again). */
  children?: ReactNode;
  compact?: boolean;
  className?: string;
}

function formatElapsed(ms: number): string {
  const total = Math.max(0, Math.floor(ms / 1000));
  const minutes = Math.floor(total / 60);
  const seconds = total % 60;
  return `${minutes}:${String(seconds).padStart(2, "0")}`;
}

function useElapsed(startedAt: number | null | undefined, running: boolean): string | null {
  const [now, setNow] = useState<number | null>(null);
  useEffect(() => {
    if (typeof startedAt !== "number") return;
    setNow(Date.now());
    if (!running) return;
    const timer = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(timer);
  }, [startedAt, running]);
  // Rendered only after mount, so server and client markup agree.
  if (typeof startedAt !== "number" || now === null) return null;
  return formatElapsed(now - startedAt);
}

export function StepIcon({ state }: { state: LoadingStep["state"] }): JSX.Element {
  if (state === "done") {
    return (
      <span aria-hidden="true" className="mt-0.5 flex h-4 w-4 shrink-0 items-center justify-center rounded-full bg-ok-100 text-[10px] font-bold text-ok-600">
        ✓
      </span>
    );
  }
  if (state === "active") {
    return <span aria-hidden="true" className="mt-1 h-2.5 w-2.5 shrink-0 rounded-full bg-sun-500 motion-safe:animate-pulse" />;
  }
  return <span aria-hidden="true" className="mt-1 h-2.5 w-2.5 shrink-0 rounded-full border border-ink-200" />;
}

function PulseOrb({ complete }: { complete: boolean }): JSX.Element {
  if (complete) {
    return (
      <span aria-hidden="true" className="flex h-4 w-4 shrink-0 items-center justify-center rounded-full bg-ok-100 text-[10px] font-bold text-ok-600">
        ✓
      </span>
    );
  }
  return (
    <span aria-hidden="true" className="relative flex h-3 w-3 shrink-0">
      <span className="absolute inline-flex h-full w-full rounded-full bg-sun-400/60 motion-safe:animate-ping" />
      <span className="relative inline-flex h-3 w-3 rounded-full bg-sun-500" />
    </span>
  );
}

export function LoadingStage({ title, subtitle, steps, percent, startedAt, complete = false, note, children, compact = false, className }: LoadingStageProps): JSX.Element {
  const elapsed = useElapsed(startedAt, !complete);
  const determinate = typeof percent === "number" && Number.isFinite(percent);
  const pct = complete ? 100 : determinate ? Math.min(100, Math.max(0, Math.round(percent))) : null;
  const stepList = steps ?? [];
  const activeIndex = stepList.findIndex((step) => step.state === "active");
  const doneCount = stepList.filter((step) => step.state === "done").length;
  const stepNumber = complete ? stepList.length : activeIndex >= 0 ? activeIndex + 1 : Math.min(stepList.length, doneCount + 1);

  const meta: string[] = [];
  if (pct !== null && (determinate || complete)) meta.push(`${pct}%`);
  else if (stepList.length > 0) meta.push(`Step ${stepNumber} of ${stepList.length}`);
  if (elapsed) meta.push(elapsed);

  return (
    // No aria-busy here: a busy live region holds its announcements until it
    // stops being busy, which was only at the end, so step changes were never
    // read out (review 2026-09-14). The skeletons below it are aria-hidden.
    <div
      role="status"
      aria-live="polite"
      className={cn(compact ? "w-full" : "sun-sheet p-5 sm:p-6", className)}
    >
      <div className="flex items-start justify-between gap-4">
        <div className="flex min-w-0 items-center gap-2.5">
          <PulseOrb complete={complete} />
          <div className="min-w-0">
            <div className="text-sm font-semibold text-ink-950">{title}</div>
            {subtitle && <div className="mt-0.5 text-xs text-ink-500">{subtitle}</div>}
          </div>
        </div>
        {meta.length > 0 && (
          <span aria-hidden="true" className="shrink-0 text-xs tabular-nums text-ink-400">
            {meta.join(" · ")}
          </span>
        )}
      </div>

      {pct !== null ? (
        <div
          className={cn("overflow-hidden rounded-full bg-ink-100", compact ? "mt-2 h-1" : "mt-3 h-1.5")}
          role="progressbar"
          aria-label={title}
          aria-valuenow={pct}
          aria-valuemin={0}
          aria-valuemax={100}
        >
          <div className="h-full rounded-full bg-sun-500 transition-[width] duration-500" style={{ width: `${pct}%` }} />
        </div>
      ) : (
        <div className={cn("overflow-hidden rounded-full bg-ink-100", compact ? "mt-2 h-1" : "mt-3 h-1.5")} role="progressbar" aria-label={title}>
          <div data-loading-bar="animated" className="h-full w-1/3 rounded-full bg-sun-500 motion-safe:animate-indeterminate motion-reduce:hidden" />
          <div data-loading-bar="static" className="hidden h-full w-1/3 rounded-full bg-sun-400 motion-reduce:block" />
        </div>
      )}

      {stepList.length > 0 && (
        <ol className={cn("space-y-2.5", compact ? "mt-3" : "mt-4")}>
          {stepList.map((step) => (
            <li key={step.key} className="flex items-start gap-2.5 text-sm">
              <StepIcon state={step.state} />
              <div className="min-w-0">
                <div className={step.state === "pending" ? "text-ink-300" : "text-ink-800"}>{step.label}</div>
                {step.detail && (
                  <div key={step.detail} aria-hidden="true" className="mt-0.5 truncate text-xs text-ink-400 motion-safe:animate-fade-in">
                    {step.detail}
                  </div>
                )}
              </div>
            </li>
          ))}
        </ol>
      )}

      {note && <div className="mt-3 text-xs text-ink-500">{note}</div>}
      {children && <div className="mt-4 flex flex-wrap gap-2">{children}</div>}
    </div>
  );
}

/** A shimmering placeholder block. Size it with className (defaults to one text line). */
export function Skeleton({ className }: { className?: string }): JSX.Element {
  return <div aria-hidden="true" className={cn("sun-skeleton h-4 w-full rounded-md bg-ink-100 motion-safe:animate-shimmer", className)} />;
}

/** A card of label/value placeholder rows. Contains no real field labels. */
export function SkeletonCard({ rows = 3, className }: { rows?: number; className?: string }): JSX.Element {
  return (
    <div aria-hidden="true" className={cn("sun-sheet p-5", className)}>
      <div className="space-y-5">
        {Array.from({ length: Math.max(1, rows) }, (_, index) => (
          <div key={index} className="space-y-2">
            <Skeleton className="h-3 w-24" />
            <Skeleton className="w-2/3" />
          </div>
        ))}
      </div>
    </div>
  );
}
