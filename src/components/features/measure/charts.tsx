"use client";

// Chart primitives for Measure, in plain HTML and SVG: no charting library.
//
// The rules they follow (the product's honesty rules plus the data-viz method):
//   * every mark opens the answers behind it (a bar is a button when it has ids);
//   * a percentage never appears without its fraction, and a small sample
//     leads with the fraction (callers pass both);
//   * one story per chart: the target brand is the emphasis colour (sun), every
//     rival is the same de-emphasis grey, so the reader's eye lands on "you";
//   * status colours (ok / warn / danger) only where the colour MEANS good or
//     bad (a verdict, a portrayal), never as a series colour;
//   * the two answer engines have fixed identity colours that never swap;
//   * thin marks, 2px surface gaps between touching fills, hairline grid,
//     numbers in text tokens (never in the series colour), a legend whenever
//     two or more series share a chart, and a table twin elsewhere on the page.

import type { ReactNode } from "react";
import { cn } from "@/lib/cn";
import type { PromptRow } from "@/lib/measure/types";
import { engineName, useMeasure } from "./shared";

/** Colour roles a mark may wear. Identity (target, rival, engines), state (ok, warn, danger) and neutrals. */
export type MarkTone = "target" | "rival" | "neutral" | "muted" | "ok" | "warn" | "danger" | "chatgpt" | "gemini";

export const MARK_FILL: Record<MarkTone, string> = {
  target: "bg-sun-500",
  rival: "bg-ink-500",
  neutral: "bg-ink-300",
  muted: "bg-ink-200",
  ok: "bg-ok-500",
  warn: "bg-warn-500",
  danger: "bg-danger-500",
  chatgpt: "bg-engine-chatgpt",
  gemini: "bg-engine-gemini",
};

/** The fixed identity colour of an answer engine; colour follows the engine, never its position. */
export function engineTone(engine: string): MarkTone {
  return engine === "gemini" ? "gemini" : "chatgpt";
}

function pct(value: number, total: number): string {
  return total > 0 ? `${(value / total) * 100}%` : "0%";
}

// --- Legend -----------------------------------------------------------------------

export function Legend({ items, className = "" }: { items: Array<{ label: string; tone: MarkTone; count?: number | null }>; className?: string }) {
  return (
    <ul className={cn("flex flex-wrap gap-x-4 gap-y-1 text-xs text-ink-600", className)} aria-label="Legend">
      {items.map((item) => (
        <li key={item.label} className="flex items-center gap-1.5">
          <span aria-hidden="true" className={cn("inline-block h-2.5 w-2.5 rounded-sm", MARK_FILL[item.tone])} />
          <span>{item.label}</span>
          {typeof item.count === "number" && <span className="tabular-nums text-ink-500">{item.count}</span>}
        </li>
      ))}
    </ul>
  );
}

// --- Bar list ----------------------------------------------------------------------

export interface BarListRow {
  key: string;
  label: string;
  /** Small text after the label ("you", a tier, a kind). Text only: the row is a button. */
  badge?: ReactNode;
  /** A control that belongs to the row (a filter toggle). Rendered beside the row, never inside it, because a button cannot contain a button. */
  action?: ReactNode;
  /** Bar length. */
  value: number;
  /** When set, the bar is a share of this total and the readout says "value of total". */
  total?: number | null;
  /** Answers behind the bar; the row is a button when present. */
  ids?: string[];
  tone?: MarkTone;
  /** Extra text at the right ("· 42%", "#1 Nike"). */
  note?: string | null;
}

/**
 * Horizontal bars, one series, longest first unless the caller ordered them.
 * The bar is a 10px rounded mark with a square baseline; the value sits at the
 * right in text ink. Used for brands, topics, sites and kinds.
 */
export function BarList({
  rows,
  max,
  unit = "answers",
  drillTitle,
  emptyText = "Nothing to show yet.",
  labelWidth = "minmax(0,9rem)",
  showFraction = true,
  wrapLabels = false,
}: {
  rows: BarListRow[];
  /** Scale maximum; defaults to the longest bar (or its total when shares are shown). */
  max?: number;
  unit?: string;
  drillTitle?: (row: BarListRow) => string;
  emptyText?: string;
  labelWidth?: string;
  showFraction?: boolean;
  /** Let long labels (topic names) take two lines instead of truncating. */
  wrapLabels?: boolean;
}) {
  const { onDrill, lowN } = useMeasure();
  if (rows.length === 0) return <p className="py-4 text-sm text-ink-500">{emptyText}</p>;
  const scale = Math.max(1, max ?? Math.max(...rows.map((row) => (row.total && row.total > 0 ? row.total : row.value))));
  return (
    <ul className="space-y-1">
      {rows.map((row) => {
        const clickable = Boolean(row.ids && row.ids.length > 0);
        const tone = row.tone ?? "rival";
        const share = row.total && row.total > 0 ? row.value / row.total : null;
        const width = row.total && row.total > 0 ? pct(row.value, scale) : pct(row.value, scale);
        const readout = row.total && row.total > 0 && showFraction ? `${row.value} of ${row.total}` : `${row.value}${unit ? ` ${unit}` : ""}`;
        const content = (
          <>
            <span className="flex min-w-0 items-center gap-1.5 text-sm text-ink-800">
              <span className={cn(wrapLabels ? "leading-5" : "truncate", tone === "target" && "font-semibold text-ink-950")}>{row.label}</span>
              {row.badge}
            </span>
            <span className="relative h-2.5 overflow-hidden rounded-r bg-ink-100" aria-hidden="true">
              <span className={cn("absolute inset-y-0 left-0 rounded-r", MARK_FILL[tone], clickable && "transition-colors group-hover:brightness-95")} style={{ width }} />
              {row.total && row.total > 0 && row.total < scale && <span className="absolute inset-y-0 w-px bg-ink-300" style={{ left: pct(row.total, scale) }} />}
            </span>
            <span className="text-right text-xs tabular-nums text-ink-500">
              <b className="font-semibold text-ink-900">{readout}</b>
              {/* "1 of 1 100%" read as a strength; below LOW_N the fraction stands alone, as everywhere else. */}
              {share !== null && row.total! >= lowN ? <span className="ml-1">{Math.round(share * 100)}%</span> : ""}
              {row.note ? <span className="ml-1">{row.note}</span> : ""}
            </span>
          </>
        );
        const gridClass = "grid w-full items-center gap-3 rounded-lg px-2 py-1.5 text-left";
        const gridStyle = { gridTemplateColumns: `${labelWidth} 1fr auto` } as const;
        return (
          <li key={row.key} className={cn(row.action && "flex items-center gap-2")}>
            {clickable ? (
              <button type="button" onClick={() => onDrill(drillTitle ? drillTitle(row) : row.label, row.ids!)} title="Read the answers" className={cn("focus-ring group hover:bg-paper", gridClass, row.action && "min-w-0 flex-1")} style={gridStyle}>
                {content}
              </button>
            ) : (
              <div className={cn(gridClass, row.action && "min-w-0 flex-1")} style={gridStyle}>
                {content}
              </div>
            )}
            {row.action}
          </li>
        );
      })}
    </ul>
  );
}

// --- Share bar -----------------------------------------------------------------------

export interface ShareSegment {
  key: string;
  label: string;
  count: number;
  tone: MarkTone;
  ids?: string[];
}

/**
 * Part-to-whole as one horizontal stacked bar with 2px surface gaps, a legend
 * with counts, and a click on a segment or its legend row opening the answers.
 */
export function ShareBar({ segments, height = "md", legend = true, drillTitle }: { segments: ShareSegment[]; height?: "sm" | "md" | "lg"; legend?: boolean; drillTitle?: (segment: ShareSegment) => string }) {
  const { onDrill } = useMeasure();
  const shown = segments.filter((segment) => segment.count > 0);
  const total = shown.reduce((sum, segment) => sum + segment.count, 0);
  if (total === 0) return <p className="py-3 text-sm text-ink-500">No answers to count yet.</p>;
  const h = { sm: "h-2", md: "h-3", lg: "h-5" }[height];
  return (
    <div>
      <div className={cn("flex w-full gap-0.5 overflow-hidden rounded-md", h)} role="img" aria-label={shown.map((segment) => `${segment.label}: ${segment.count}`).join(", ")}>
        {shown.map((segment) => {
          const clickable = Boolean(segment.ids && segment.ids.length > 0);
          const style = { width: pct(segment.count, total) };
          return clickable ? (
            <button
              key={segment.key}
              type="button"
              title={`${segment.label}: ${segment.count}`}
              onClick={() => onDrill(drillTitle ? drillTitle(segment) : segment.label, segment.ids!)}
              className={cn("focus-ring h-full min-w-[3px] first:rounded-l-md last:rounded-r-md hover:brightness-95", MARK_FILL[segment.tone])}
              style={style}
            />
          ) : (
            <span key={segment.key} title={`${segment.label}: ${segment.count}`} className={cn("h-full min-w-[3px] first:rounded-l-md last:rounded-r-md", MARK_FILL[segment.tone])} style={style} />
          );
        })}
      </div>
      {legend && (
        <ul className="mt-2.5 flex flex-wrap gap-x-4 gap-y-1 text-xs">
          {shown.map((segment) => {
            const clickable = Boolean(segment.ids && segment.ids.length > 0);
            const inner = (
              <>
                <span aria-hidden="true" className={cn("inline-block h-2.5 w-2.5 rounded-sm", MARK_FILL[segment.tone])} />
                <span className="text-ink-700">{segment.label}</span>
                <b className="font-semibold tabular-nums text-ink-900">{segment.count}</b>
                <span className="tabular-nums text-ink-500">{Math.round((segment.count / total) * 100)}%</span>
              </>
            );
            return (
              <li key={segment.key}>
                {clickable ? (
                  <button type="button" onClick={() => onDrill(drillTitle ? drillTitle(segment) : segment.label, segment.ids!)} className="focus-ring flex items-center gap-1.5 rounded hover:underline">
                    {inner}
                  </button>
                ) : (
                  <span className="flex items-center gap-1.5">{inner}</span>
                )}
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}

// --- Grouped bars (engines side by side) ------------------------------------------------

export interface GroupedValue {
  series: string;
  numerator: number;
  denominator: number;
  ids: string[];
}

export interface GroupedRow {
  label: string;
  values: GroupedValue[];
}

/**
 * One row per metric, one thin bar per engine, scaled 0–100% of each bar's
 * own denominator (a rate). Engines keep their identity colours; the legend
 * names them. A small denominator leads with the fraction, as everywhere.
 */
export function GroupedBars({ rows, series }: { rows: GroupedRow[]; series: Array<{ key: string; label: string; tone: MarkTone }> }) {
  const { onDrill, lowN } = useMeasure();
  return (
    <div>
      {/* One series needs no legend: the panel title names it. */}
      {series.length > 1 && <Legend items={series.map((item) => ({ label: item.label, tone: item.tone }))} className="mb-3" />}
      <ul className="space-y-3">
        {rows.map((row) => (
          <li key={row.label} className="grid grid-cols-[minmax(0,9rem)_1fr] items-start gap-3">
            <span className="pt-0.5 text-sm text-ink-800">{row.label}</span>
            <ul className="space-y-1">
              {series.map((item) => {
                const value = row.values.find((entry) => entry.series === item.key);
                const empty = !value || value.denominator === 0;
                const rate = empty ? 0 : value!.numerator / value!.denominator;
                const clickable = Boolean(value && value.ids.length > 0);
                const readout = empty ? "—" : value!.denominator < lowN ? `${value!.numerator} of ${value!.denominator}` : `${Math.round(rate * 100)}%`;
                const sub = empty || value!.denominator < lowN ? "" : `${value!.numerator} of ${value!.denominator}`;
                const inner = (
                  <>
                    <span className="relative h-2 overflow-hidden rounded-r bg-ink-100" aria-hidden="true">
                      <span className={cn("absolute inset-y-0 left-0 rounded-r", MARK_FILL[item.tone])} style={{ width: `${rate * 100}%` }} />
                    </span>
                    <span className="w-24 text-right text-xs tabular-nums text-ink-500">
                      <b className="font-semibold text-ink-900">{readout}</b>
                      {sub ? <span className="ml-1">{sub}</span> : ""}
                    </span>
                  </>
                );
                return (
                  <li key={item.key}>
                    {clickable ? (
                      <button type="button" onClick={() => onDrill(`${row.label} · ${item.label}`, value!.ids)} title={`${item.label}: read the answers`} className="focus-ring grid w-full grid-cols-[1fr_auto] items-center gap-2 rounded hover:bg-paper">
                        {inner}
                      </button>
                    ) : (
                      <span className="grid w-full grid-cols-[1fr_auto] items-center gap-2">{inner}</span>
                    )}
                  </li>
                );
              })}
            </ul>
          </li>
        ))}
      </ul>
    </div>
  );
}

// --- Outcome strip -----------------------------------------------------------------

type CellTone = MarkTone | "empty";

const CELL_FILL: Record<CellTone, string> = { ...MARK_FILL, empty: "bg-transparent border border-dashed border-ink-300" };

function cellFor(row: PromptRow, brand: string): { tone: CellTone; label: string } {
  if (row.status === "not_collected") return { tone: "empty", label: "Not collected" };
  if (row.status !== "analysable") return { tone: "muted", label: row.status === "needs_review" ? "Needs a look" : "Awaiting analysis" };
  if (row.section === "Discovery") {
    if (row.targetNamed) return { tone: "target", label: row.targetRank === 1 ? `${brand} named, ranked first` : `${brand} named` };
    if (row.brandsNamed.length === 0 && row.untrackedNamed.length === 0) return { tone: "neutral", label: "No business named" };
    return { tone: "danger", label: `${brand} not named${row.firstChoiceName ? ` (#1 ${row.firstChoiceName})` : ""}` };
  }
  if (row.section === "Trade Offs") {
    if (row.verdict === "TARGET_PREFERRED") return { tone: "ok", label: `${brand} preferred${row.rivalName ? ` over ${row.rivalName}` : ""}` };
    if (row.verdict === "COMPETITOR_PREFERRED") return { tone: "danger", label: `${row.rivalName ?? "Rival"} preferred` };
    return { tone: "neutral", label: row.verdict === "NO_COMPARISON" ? "Did not compare them" : "No clear winner" };
  }
  if (row.portrayal === "POSITIVE") return { tone: "ok", label: "Positive" };
  if (row.portrayal === "NEGATIVE") return { tone: "danger", label: "Negative" };
  if (row.portrayal === "MIXED") return { tone: "warn", label: "Mixed" };
  return { tone: "neutral", label: "Factual or neutral" };
}

const STRIP_SECTIONS: Array<{ key: string; label: string; legend: Array<{ label: string; tone: MarkTone }> }> = [
  { key: "Discovery", label: "Discovery", legend: [{ label: "you named", tone: "target" }, { label: "others named, not you", tone: "danger" }, { label: "no business named", tone: "neutral" }] },
  { key: "Trade Offs", label: "Trade Offs", legend: [{ label: "you preferred", tone: "ok" }, { label: "rival preferred", tone: "danger" }, { label: "no winner", tone: "neutral" }] },
  { key: "Sentiment Analysis", label: "Reputation", legend: [{ label: "positive", tone: "ok" }, { label: "mixed", tone: "warn" }, { label: "negative", tone: "danger" }, { label: "factual", tone: "neutral" }] },
];

/**
 * Every answer as one cell, grouped by section, one row per engine. Thirty
 * questions read at a glance; a cell opens its answer. The table twin is the
 * Questions view.
 */
export function OutcomeStrip({ rows, engines }: { rows: PromptRow[]; engines: string[] }) {
  const { brand, onDrill } = useMeasure();
  return (
    <div className="space-y-4">
      {STRIP_SECTIONS.map((section) => {
        const inSection = rows.filter((row) => row.section === section.key);
        if (inSection.length === 0) return null;
        const questions = [...new Map(inSection.map((row) => [row.promptCandidateId, row.text])).entries()];
        return (
          <div key={section.key}>
            <div className="mb-1.5 flex flex-wrap items-baseline justify-between gap-2">
              <p className="text-xs font-semibold uppercase tracking-[0.08em] text-ink-600">{section.label}</p>
              <Legend items={section.legend} />
            </div>
            <div className="space-y-1">
              {engines.map((engine) => (
                <div key={engine} className="grid grid-cols-[4.5rem_1fr] items-center gap-2">
                  <span className="text-xs text-ink-500">{engineName(engine)}</span>
                  <div className="flex flex-wrap gap-0.5">
                    {questions.map(([id, text]) => {
                      const row = inSection.find((item) => item.promptCandidateId === id && item.engine === engine);
                      if (!row) return <span key={id} className="h-5 w-5 rounded-sm bg-ink-50" title="Not planned on this engine" aria-hidden="true" />;
                      const cell = cellFor(row, brand);
                      const clickable = Boolean(row.observationId);
                      return (
                        <button
                          key={id}
                          type="button"
                          disabled={!clickable}
                          onClick={() => clickable && onDrill(text, [row.observationId!])}
                          title={`${cell.label} · ${text}`}
                          aria-label={`${cell.label}: ${text}`}
                          className={cn("focus-ring h-5 w-5 rounded-sm transition hover:scale-110 disabled:cursor-default disabled:hover:scale-100", CELL_FILL[cell.tone])}
                        />
                      );
                    })}
                  </div>
                </div>
              ))}
            </div>
          </div>
        );
      })}
    </div>
  );
}

// --- Meter -----------------------------------------------------------------------

/** A single ratio against its total, as a track and a fill in the same ramp. */
export function Meter({ value, total, tone = "target", label }: { value: number; total: number; tone?: MarkTone; label?: string }) {
  return (
    <div className="h-2 w-full overflow-hidden rounded-full bg-ink-100" role="img" aria-label={label ?? `${value} of ${total}`}>
      <div className={cn("h-full rounded-full transition-all duration-700", MARK_FILL[tone])} style={{ width: pct(value, Math.max(1, total)) }} />
    </div>
  );
}
