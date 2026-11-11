"use client";

// Building blocks shared by the Measure views.
//
// Every figure here obeys the honesty rules: no percentage without its
// fraction (small samples lead with the fraction), `—` for a null value,
// "so far" while a run is incomplete, and every number opens the answers
// behind it.

import { createContext, useContext, useEffect, useState, type ReactNode } from "react";
import { Button } from "@/components/ui/button";
import { Spinner } from "@/components/ui/primitives";
import { api, type MeasureResponse } from "@/lib/client/api";
import { cn } from "@/lib/cn";
import { ENGINE_LABEL, engineOf, isByHandRoute, isConsumerWebRoute, surfaceLabel, surfaceMethod } from "@/lib/providers/engines";
import type { BrandRow, MetricValue } from "@/lib/measure/types";
import type { MetricDelta } from "@/lib/measure/compare";
import { highlightsFor, sourcesFor } from "@/lib/measure/answer-evidence";
import { formatRange, plausibleRange } from "@/lib/measure/precision";
import { AnswerText, SourceList } from "./answer";

export type Drill = (title: string, ids: string[]) => void;
export type Explain = (definition: ExplainContent) => void;

export interface ExplainContent {
  label: string;
  plain: string;
  rows: Array<[string, string]>;
}

export interface MeasureContextValue {
  data: MeasureResponse;
  brand: string;
  scope: string;
  /** True while planned answers are missing; every figure reads it. */
  provisional: boolean;
  lowN: number;
  onExplain: Explain;
  onDrill: Drill;
}

export const MeasureContext = createContext<MeasureContextValue | null>(null);

export function useMeasure(): MeasureContextValue {
  const value = useContext(MeasureContext);
  if (!value) throw new Error("useMeasure outside MeasureContext");
  return value;
}

export function engineName(key: string): string {
  return ENGINE_LABEL[key as keyof typeof ENGINE_LABEL] ?? key;
}

/** "ChatGPT", "ChatGPT and Gemini". */
export function engineNames(engines: string[]): string {
  return engines.map(engineName).join(" and ");
}

export function routeName(route: string): string {
  return surfaceLabel(route);
}

/**
 * Coverage per surface for the reader: routes of one engine and surface are
 * one line ("ChatGPT on the web"), whichever connection collected them.
 */
export function coverageBySurface(byProvider: Record<string, { planned: number; captured: number; analysable: number }>): Array<{ key: string; label: string; method: string; planned: number; captured: number; analysable: number }> {
  const out = new Map<string, { key: string; label: string; method: string; planned: number; captured: number; analysable: number }>();
  for (const [route, counts] of Object.entries(byProvider)) {
    const label = surfaceLabel(route);
    const entry = out.get(label) ?? { key: label, label, method: surfaceMethod(route), planned: 0, captured: 0, analysable: 0 };
    entry.planned += counts.planned;
    entry.captured += counts.captured;
    entry.analysable += counts.analysable;
    out.set(label, entry);
  }
  return [...out.values()];
}

/**
 * The reader-facing name of a prompt section. The instrument's third lens is
 * stored and reviewed as "Sentiment Analysis"; Measure reports it as
 * "Reputation", the question it answers ("how am I described by name?"). The
 * Prompts page shows both names side by side so the mapping is never a surprise.
 */
export function sectionLabel(section: string | null | undefined): string {
  if (section === "Sentiment Analysis") return "Reputation";
  return section ?? "—";
}

/** The buyer question each section answers, for headers and legends. */
export function sectionQuestion(section: string | null | undefined): string | null {
  switch (section) {
    case "Discovery":
      return "when a buyer names no brand";
    case "Trade Offs":
      return "when a buyer compares you with a rival";
    case "Sentiment Analysis":
      return "when a buyer asks about you by name";
    default:
      return null;
  }
}

export function percent(value: number | null | undefined): string {
  if (value === null || value === undefined) return "—";
  return `${Math.round(value * 100)}%`;
}

export function fraction(metric: Pick<MetricValue, "numerator" | "denominator"> | null | undefined): string {
  if (!metric) return "—";
  return `${metric.numerator} of ${metric.denominator}`;
}

export function formatDate(at: number | string | Date | null | undefined): string {
  if (!at) return "—";
  return new Date(at).toLocaleDateString([], { day: "numeric", month: "short", year: "numeric" });
}

export function formatDateTime(at: number | string | Date | null | undefined): string {
  if (!at) return "—";
  return new Date(at).toLocaleString([], { day: "numeric", month: "short", hour: "numeric", minute: "2-digit" });
}

/** Host without scheme or "www."; enough for display. Ownership comes from the analysis, never from this. */
export function registrableDomainOf(url: string): string {
  try {
    return new URL(url).hostname.replace(/^www\./i, "");
  } catch {
    return url;
  }
}

export function sum(values: number[]): number {
  return values.reduce((total, value) => total + value, 0);
}

/** Definition rows for a metric from METRIC_DEFINITIONS, in the "?" drawer's shape. */
export function metricExplain(definition: any): ExplainContent | null {
  if (!definition) return null;
  return {
    label: definition.label,
    plain: definition.plain,
    rows: [
      ["What is counted", definition.event],
      ["Out of", definition.denominator],
      ["Which questions", definition.sections],
      ["Missing answers", definition.missingData],
    ],
  };
}

/** Short labels for metrics in change lists; the full definitions stay in the policy module. */
export const METRIC_SHORT_LABEL: Record<string, string> = {
  discovery_visibility: "Visibility",
  discovery_share_of_voice: "Share among tracked brands",
  discovery_share_all_names: "Share of voice",
  first_choice_rate: "Ranked first",
  answer_brand_free_rate: "No business named",
  tradeoff_decisiveness: "Head-to-heads with a verdict",
  tradeoff_target_win_rate: "Won when decided",
  owned_citation_rate: "Your site cited",
  owned_citation_rate_when_sourced: "Your site cited, when sources were shown",
  citation_share: "Share of tracked-brand links",
};

/**
 * Metrics whose change is shown, in reading order. The others stay in the
 * exports: share among tracked brands and share of tracked-brand links read
 * 100% by construction whenever no tracked rival appears, and "no business
 * named" moving is context, not a result.
 */
export const CHANGE_METRICS = ["discovery_visibility", "discovery_share_all_names", "first_choice_rate", "tradeoff_target_win_rate", "owned_citation_rate"] as const;

/** A sentiment theme for a reader: the analysis files a theme-less opinion under "overall". */
export function themeLabel(category: string): string {
  return category === "overall" ? "general impression" : category.replace(/_/g, " ");
}

export interface BusinessStanding {
  row: BrandRow;
  /** Discovery answers naming it in the current scope. */
  named: number;
  /** Its place by answers naming it; ties share a place. */
  place: number;
}

/**
 * Every business the Discovery answers named, tracked or not, by answers
 * naming it, with shared places on ties. The target is always included.
 */
export function businessStandings(brands: BrandRow[], scope: string): BusinessStanding[] {
  const namedIn = (row: BrandRow) => (scope === "combined" ? row.discoveryNamed : (row.namedByEngine[scope]?.named ?? 0));
  const rows = brands.filter((row) => namedIn(row) > 0 || row.relation === "target");
  const sorted = [...rows].sort((a, b) => namedIn(b) - namedIn(a) || (a.relation === "target" ? -1 : b.relation === "target" ? 1 : 0) || a.name.localeCompare(b.name));
  return sorted.map((row) => ({ row, named: namedIn(row), place: sorted.filter((other) => namedIn(other) > namedIn(row)).length + 1 }));
}

/**
 * A third-party site whose address spells the brand ("atelier10salon.ae" for
 * Atelier 10 Salon, whose recorded site is atelier10.ae). Only a hint: the
 * figures keep counting it as third party until the domain is recorded.
 */
export function looksLikeOwnSite(domain: string, brand: string): boolean {
  const label = (domain.split(".")[0] ?? "").toLowerCase().replace(/[^a-z0-9]/g, "");
  const tokens = brand.toLowerCase().split(/\s+/).map((token) => token.replace(/[^a-z0-9]/g, "")).filter(Boolean);
  const head = tokens.slice(0, 2).join("");
  return head.length >= 5 && label.includes(head);
}

// --- Frame ----------------------------------------------------------------------

export function Section({ id, eyebrow, title, note, aside, children }: { id?: string; eyebrow?: string; title: string; note?: string; aside?: ReactNode; children: ReactNode }) {
  return (
    <section id={id} className="scroll-mt-24">
      <div className="mb-4 flex flex-col gap-1 sm:flex-row sm:items-end sm:justify-between">
        <div className="min-w-0">
          {eyebrow && <p className="sun-eyebrow text-ink-500">{eyebrow}</p>}
          <h2 className="mt-1 text-balance text-xl font-semibold tracking-[-0.015em] text-ink-950">{title}</h2>
          {note && <p className="mt-1 max-w-2xl text-sm leading-6 text-ink-500">{note}</p>}
        </div>
        {aside && <div className="shrink-0 text-xs tabular-nums text-ink-500">{aside}</div>}
      </div>
      {children}
    </section>
  );
}

export function Panel({ title, hint, className = "", action, children }: { title?: string; hint?: string; className?: string; action?: ReactNode; children: ReactNode }) {
  return (
    <div className={cn("sun-sheet p-5", className)}>
      {(title || action) && (
        <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
          <div className="min-w-0">
            {title && <h3 className="text-sm font-semibold text-ink-950">{title}</h3>}
            {hint && <p className="mt-0.5 text-xs leading-5 text-ink-500">{hint}</p>}
          </div>
          {action}
        </div>
      )}
      <div className={title || action ? "mt-4" : ""}>{children}</div>
    </div>
  );
}

export function SoFar() {
  return <span className="ml-1.5 rounded bg-warn-100 px-1 py-px align-middle text-[10px] font-semibold uppercase tracking-wide text-warn-600">so far</span>;
}

export function ExplainButton({ onClick, label = "How is this calculated?" }: { onClick: () => void; label?: string }) {
  return (
    <button
      type="button"
      onClick={onClick}
      title={label}
      aria-label={label}
      className="focus-ring grid h-[18px] w-[18px] shrink-0 place-items-center rounded-full border border-ink-300 text-[10px] font-bold text-ink-500 transition-colors hover:border-sun-500 hover:bg-sun-100 hover:text-sun-900"
    >
      ?
    </button>
  );
}

export function EmptyFigure({ text = "No answers to count yet." }: { text?: string }) {
  return (
    <>
      <p className="sun-figure mt-3 text-4xl text-ink-300">—</p>
      <p className="mt-2 text-sm leading-5 text-ink-500">{text}</p>
    </>
  );
}

export function MiniStack({ parts }: { parts: Array<[number, string]> }) {
  const total = sum(parts.map(([count]) => count));
  if (total === 0) return null;
  return (
    <div className="mt-3 flex h-2 gap-0.5 overflow-hidden rounded-full" aria-hidden="true">
      {parts
        .filter(([count]) => count > 0)
        .map(([count, tone], index) => (
          <span key={index} className={`h-full min-w-[3px] ${tone}`} style={{ width: `${(count / total) * 100}%` }} />
        ))}
    </div>
  );
}

export function Chip({ children, tone = "neutral", className = "" }: { children: ReactNode; tone?: "neutral" | "ok" | "warn" | "danger" | "brand" | "sun" | "outline"; className?: string }) {
  const tones = {
    neutral: "bg-ink-100 text-ink-700",
    outline: "border border-ink-200 bg-white text-ink-600",
    ok: "bg-ok-100 text-ok-600",
    warn: "bg-warn-100 text-warn-600",
    danger: "bg-danger-100 text-danger-600",
    brand: "bg-brand-50 text-brand-600",
    sun: "bg-sun-100 text-sun-900",
  };
  return <span className={cn("inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[11px] font-medium leading-4", tones[tone], className)}>{children}</span>;
}

// --- Change vs the previous comparable run ------------------------------------------

/**
 * A change is shown only for a comparable pair. In points when both sides
 * have enough answers, as counts otherwise, and never when either side is
 * null. `invert` marks metrics where down is good (none today, kept for
 * brand-free rate readers).
 */
export function DeltaChip({ delta, invert = false }: { delta: MetricDelta | null | undefined; invert?: boolean }) {
  if (!delta || delta.direction === null) return null;
  const good = delta.direction === "flat" ? null : (delta.direction === "up") !== invert;
  // A change a different handful of similar questions could produce is shown, never coloured as a gain or a loss.
  const tone = delta.direction === "flat" || delta.withinRange ? "neutral" : good ? "ok" : "danger";
  const arrow = delta.direction === "up" ? "↑" : delta.direction === "down" ? "↓" : "→";
  const label = delta.points !== null ? `${delta.points > 0 ? "+" : ""}${delta.points} pts` : `${delta.from.numerator} of ${delta.from.denominator} → ${delta.to.numerator} of ${delta.to.denominator}`;
  const title =
    (delta.points !== null ? `Previous run: ${delta.from.numerator} of ${delta.from.denominator}` : "Small sample on one side: shown as counts, not points") +
    (delta.withinRange ? ". Within the previous run's plausible range, so not read as a gain or a loss." : "");
  return (
    <Chip tone={tone} className="tabular-nums">
      <span title={title}>
        {arrow} {label}
        {delta.withinRange && delta.direction !== "flat" ? " · within range" : ""}
      </span>
    </Chip>
  );
}

/** "Plausible range 5–51%": shown under a rate once it has enough answers to lead with a percentage. */
export function RangeNote({ metric, className = "" }: { metric: Pick<MetricValue, "numerator" | "denominator"> | null | undefined; className?: string }) {
  const { lowN } = useMeasure();
  if (!metric || metric.denominator < lowN) return null;
  const range = formatRange(plausibleRange(metric.numerator, metric.denominator));
  if (!range) return null;
  return (
    <span className={cn("tabular-nums", className)} title="Wilson 95% interval from the counts: how far a different handful of similar questions could plausibly move this rate.">
      plausible range {range}
    </span>
  );
}

// --- Figures --------------------------------------------------------------------

export function Headline({
  label, metric, sentence, definition, delta, accent = false, footnote, footnoteAction, visual, figure,
}: {
  label: string; metric: MetricValue | undefined; sentence: (metric: MetricValue) => string; definition?: any; delta?: MetricDelta | null; accent?: boolean;
  /** A same-run reference point ("Most named: Salomon, 16 of 17"), never an external benchmark. */
  footnote?: string | null;
  /** A link shown after the footnote ("See untracked brands →"). */
  footnoteAction?: ReactNode;
  /** A small chart beside the figure (a ring, a share bar); the figure stays the primary reading. */
  visual?: ReactNode;
  /** Words in place of the number when the figure cannot be read as one ("Not comparable"); no ring, fraction or change is shown. */
  figure?: string;
}) {
  const { provisional, lowN, onExplain, onDrill } = useMeasure();
  const empty = !metric || metric.denominator === 0;
  const lowSample = Boolean(metric) && !empty && metric!.denominator < lowN;
  const explain = metricExplain(definition);
  return (
    <div className={cn("flex flex-col rounded-2xl border bg-white p-5 shadow-sheet", accent ? "border-sun-300 bg-gradient-to-b from-sun-50 to-white" : "border-ink-200/75", provisional && "border-dashed")}>
      <div className="flex items-start justify-between gap-2">
        <p className="text-sm font-medium text-ink-700">
          {label}
          {provisional && <SoFar />}
        </p>
        {explain && <ExplainButton onClick={() => onExplain(explain)} />}
      </div>
      {empty ? (
        <EmptyFigure />
      ) : (
        <>
          <div className="mt-3 flex items-center gap-4">
            {figure ? null : visual}
            <div className="min-w-0">
              <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
                {figure ? (
                  <p className="sun-figure text-2xl leading-tight text-ink-700">{figure}</p>
                ) : (
                  <p className={cn("sun-figure text-[2.5rem] leading-none", accent ? "text-sun-800" : "text-ink-950")}>
                    {lowSample ? `${metric!.numerator} of ${metric!.denominator}` : percent(metric!.value)}
                  </p>
                )}
                {!figure && !lowSample && <span className="text-sm tabular-nums text-ink-500">{fraction(metric)}</span>}
                {!figure && <DeltaChip delta={delta} />}
              </div>
            </div>
          </div>
          <p className="mt-2.5 text-sm leading-5 text-ink-600">
            {sentence(metric!)}
            {!figure && lowSample ? ", a small sample" : ""}
          </p>
          {!figure && !lowSample && (
            <p className="mt-1 text-xs text-ink-500">
              <RangeNote metric={metric} />
            </p>
          )}
          {(footnote || footnoteAction) && (
            <p className="mt-1 text-xs leading-5 text-ink-500">
              {footnote}
              {footnote && footnoteAction ? " " : ""}
              {footnoteAction}
            </p>
          )}
          {metric!.numerator > 0 && (
            <button type="button" onClick={() => onDrill(label, metric!.numeratorObservationIds)} className="focus-ring mt-auto self-start rounded pt-3 text-sm font-medium text-brand-600 hover:underline">
              See the answers →
            </button>
          )}
        </>
      )}
    </div>
  );
}

export function MetricRow({ label, metric, definition, delta }: { label: string; metric: MetricValue | undefined; definition?: any; delta?: MetricDelta | null }) {
  const { provisional, lowN, onExplain, onDrill } = useMeasure();
  const empty = !metric || metric.denominator === 0;
  const lowSample = !empty && metric!.denominator < lowN;
  const explain = metricExplain(definition);
  return (
    <div className="flex items-center justify-between gap-3 border-t border-ink-100 py-3 first:border-t-0 first:pt-0 last:pb-0">
      <div className="min-w-0">
        <p className="flex items-center gap-1.5 text-sm text-ink-800">
          {label}
          {explain && <ExplainButton onClick={() => onExplain(explain)} />}
        </p>
        {!empty && metric!.numerator > 0 && (
          <button type="button" onClick={() => onDrill(label, metric!.numeratorObservationIds)} className="focus-ring mt-0.5 rounded text-xs font-medium text-brand-600 hover:underline">
            See the {metric!.numerator} →
          </button>
        )}
      </div>
      <div className="shrink-0 text-right">
        <div className="flex items-baseline justify-end gap-2">
          <DeltaChip delta={delta} />
          <p className="sun-figure text-xl text-ink-950">{empty ? "—" : lowSample ? `${metric!.numerator} of ${metric!.denominator}` : percent(metric!.value)}</p>
        </div>
        <p className="text-xs tabular-nums text-ink-500">
          {empty ? "no answers yet" : lowSample ? "small sample" : `${metric!.numerator} of ${metric!.denominator}`}
          {provisional && !empty ? " so far" : ""}
        </p>
      </div>
    </div>
  );
}

export function MiniStat({ label, metric, definition }: { label: string; metric: MetricValue | undefined; definition?: any }) {
  const { provisional, lowN, onExplain } = useMeasure();
  const empty = !metric || metric.denominator === 0;
  const explain = metricExplain(definition);
  return (
    <div>
      <div className="flex items-center gap-1.5">
        <p className="text-xs text-ink-500">{label}</p>
        {explain && <ExplainButton onClick={() => onExplain(explain)} />}
      </div>
      <p className="sun-figure mt-1 text-lg text-ink-950">{empty ? <span className="text-ink-300">—</span> : `${metric!.numerator} of ${metric!.denominator}`}</p>
      {!empty && metric!.denominator >= lowN && (
        <p className="text-xs tabular-nums text-ink-500">
          {percent(metric!.value)}
          {provisional ? " so far" : ""}
        </p>
      )}
    </div>
  );
}

export function StackedBar({ segments, idsFor }: { segments: Array<{ key: string; label: string; count: number; tone: string }>; idsFor: (key: string) => string[] }) {
  const { onDrill } = useMeasure();
  const shown = segments.filter((segment) => segment.count > 0);
  const total = sum(shown.map((segment) => segment.count));
  if (total === 0) return <p className="py-4 text-sm text-ink-500">No answers to count yet.</p>;
  return (
    <div>
      <div className="flex h-3 gap-px overflow-hidden rounded-full bg-ink-100" role="img" aria-label={shown.map((segment) => `${segment.label}: ${segment.count}`).join(", ")}>
        {shown.map((segment) => (
          <span key={segment.key} className={`h-full ${segment.tone}`} style={{ width: `${(segment.count / total) * 100}%` }} />
        ))}
      </div>
      <ul className="mt-3 space-y-0.5">
        {shown.map((segment) => (
          <li key={segment.key}>
            <button type="button" onClick={() => onDrill(segment.label, idsFor(segment.key))} className="focus-ring flex w-full items-center justify-between gap-3 rounded-lg px-2 py-1.5 text-left text-sm hover:bg-paper">
              <span className="flex items-center gap-2 text-ink-800">
                <span className={`h-2.5 w-2.5 rounded-sm ${segment.tone}`} />
                {segment.label}
              </span>
              <span className="font-semibold tabular-nums text-ink-950">{segment.count}</span>
            </button>
          </li>
        ))}
      </ul>
    </div>
  );
}

/** A count with the answers behind it, one click away. */
export function CountLink({ count, label, ids, className = "" }: { count: number; label: string; ids: string[]; className?: string }) {
  const { onDrill } = useMeasure();
  if (count === 0 || ids.length === 0) return <span className={`tabular-nums text-ink-400 ${className}`}>{count}</span>;
  return (
    <button type="button" onClick={() => onDrill(label, ids)} className={`focus-ring rounded font-semibold tabular-nums text-brand-600 hover:underline ${className}`}>
      {count}
    </button>
  );
}

/**
 * "3 answers behind this →" as one link. The count alone was the button and
 * the words and arrow were plain text, so clicking the arrow did nothing
 * (feedback 2026-09-16). With no answers there is nothing to open, so no arrow.
 */
export function AnswersBehindLink({ ids, label, className = "" }: { ids: string[]; label: string; className?: string }) {
  const { onDrill } = useMeasure();
  const count = ids.length;
  if (count === 0) return <span className={`text-ink-400 ${className}`}>No answers behind this yet</span>;
  return (
    <button type="button" onClick={() => onDrill(label, ids)} className={`focus-ring rounded font-medium text-brand-600 hover:underline ${className}`}>
      <span className="font-semibold tabular-nums">{count}</span> answer{count === 1 ? "" : "s"} behind this →
    </button>
  );
}

// --- Drawers ----------------------------------------------------------------------

export function Drawer({ title, subtitle, eyebrow, children, onClose, wide = false }: { title: string; subtitle?: string; eyebrow?: string; children: ReactNode; onClose: () => void; wide?: boolean }) {
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => event.key === "Escape" && onClose();
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  return (
    <div className="fixed inset-0 z-50 flex justify-end">
      <button type="button" aria-label="Close" className="absolute inset-0 bg-ink-950/35 backdrop-blur-[2px]" onClick={onClose} />
      <div role="dialog" aria-modal="true" aria-label={title} className={cn("relative flex h-full w-full flex-col overflow-hidden border-l border-ink-200 bg-paper shadow-float sm:my-2 sm:mr-2 sm:h-[calc(100%-1rem)] sm:rounded-2xl sm:border", wide ? "max-w-2xl" : "max-w-xl")}>
        <div className="flex items-start justify-between gap-3 border-b border-ink-200/70 bg-white px-5 py-4">
          <div className="min-w-0">
            {eyebrow && <p className="sun-eyebrow text-sun-700">{eyebrow}</p>}
            <h2 className={cn("text-balance font-semibold text-ink-950", eyebrow ? "mt-1" : "")}>{title}</h2>
            {subtitle && <p className="mt-0.5 text-xs text-ink-500">{subtitle}</p>}
          </div>
          <Button size="sm" variant="ghost" onClick={onClose}>
            Close
          </Button>
        </div>
        <div className="flex-1 overflow-y-auto px-5 py-4">{children}</div>
      </div>
    </div>
  );
}

/** A published definition, verbatim from the policy module. */
export function ExplainDrawer({ content, onClose }: { content: ExplainContent; onClose: () => void }) {
  return (
    <Drawer eyebrow="How this figure is counted" title={content.label} onClose={onClose}>
      <p className="text-[15px] leading-7 text-ink-800">{content.plain}</p>
      <dl className="mt-5 space-y-3 text-sm">
        {content.rows.map(([term, value]) => (
          <div key={term} className="sun-sheet px-4 py-3">
            <dt className="sun-eyebrow text-ink-500">{term}</dt>
            <dd className="mt-1 leading-6 text-ink-700">{value}</dd>
          </div>
        ))}
      </dl>
    </Drawer>
  );
}

/** The legend under a highlighted answer: which mark means what. */
export function HighlightLegend({ brand }: { brand: string }) {
  return (
    <p className="border-t border-ink-100 px-3.5 py-1.5 text-[11px] leading-5 text-ink-500">
      Highlighted: <mark className="rounded bg-sun-100 px-0.5 text-sun-900">{brand}</mark>, <mark className="rounded bg-ink-100 px-0.5 text-ink-800">tracked rivals</mark>,{" "}
      <mark className="rounded border border-dashed border-ink-300 bg-transparent px-0.5 text-ink-700">untracked names</mark>. Only names the analysis linked with confidence are marked.
    </p>
  );
}

/** A small ring for a fraction, always beside its numbers, never instead of them. */
export function Ring({ value, size = 44, tone = "sun", label }: { value: number | null; size?: number; tone?: "sun" | "ok" | "brand"; label?: string }) {
  const stroke = 5;
  const radius = (size - stroke) / 2;
  const circumference = 2 * Math.PI * radius;
  const filled = value === null ? 0 : Math.max(0, Math.min(1, value)) * circumference;
  const color = { sun: "var(--color-sun-500)", ok: "var(--color-ok-500)", brand: "var(--color-brand-500)" }[tone];
  return (
    <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`} role="img" aria-label={label ?? (value === null ? "no answers" : `${Math.round(value * 100)}%`)} className="shrink-0">
      <circle cx={size / 2} cy={size / 2} r={radius} fill="none" stroke="var(--color-ink-100)" strokeWidth={stroke} />
      {value !== null && (
        <circle
          cx={size / 2}
          cy={size / 2}
          r={radius}
          fill="none"
          stroke={color}
          strokeWidth={stroke}
          strokeLinecap="round"
          strokeDasharray={`${filled} ${circumference - filled}`}
          transform={`rotate(-90 ${size / 2} ${size / 2})`}
        />
      )}
    </svg>
  );
}

/** Initials in a circle: a visual anchor for a brand or a site without fetching a logo from anyone. */
export function Mark({ name, tone = "neutral", size = "md" }: { name: string; tone?: "target" | "rival" | "neutral"; size?: "sm" | "md" }) {
  const initials = name
    .replace(/^www\./i, "")
    .split(/[\s.\-_]+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((part) => part[0]!.toUpperCase())
    .join("");
  const tones = { target: "bg-sun-100 text-sun-900 ring-1 ring-sun-300", rival: "bg-ink-900 text-white", neutral: "bg-ink-100 text-ink-600" };
  const sizes = { sm: "h-6 w-6 text-[10px]", md: "h-8 w-8 text-xs" };
  return (
    <span aria-hidden="true" className={`inline-grid shrink-0 place-items-center rounded-full font-semibold ${tones[tone]} ${sizes[size]}`}>
      {initials || "?"}
    </span>
  );
}

/** A figure → the exact answers that produced it, shown as the site showed them. */
export function EvidenceDrawer({ title, ids, onClose }: { title: string; ids: string[]; onClose: () => void }) {
  const { brand } = useMeasure();
  const [rows, setRows] = useState<any[] | null>(null);
  const [limit, setLimit] = useState(25);

  useEffect(() => {
    let cancelled = false;
    setRows(null);
    (async () => {
      const loaded = await Promise.all(
        ids.slice(0, limit).map(async (id) => {
          try {
            return await api.getObservationEvidence(id);
          } catch {
            return null;
          }
        }),
      );
      if (!cancelled) setRows(loaded.filter(Boolean));
    })();
    return () => {
      cancelled = true;
    };
  }, [ids, limit]);

  return (
    <Drawer eyebrow="The answers behind this figure" title={title} onClose={onClose} subtitle={`${ids.length} answer${ids.length === 1 ? "" : "s"}, as the site showed them`} wide>
      {rows === null ? (
        <div className="flex items-center gap-2 text-sm text-ink-500">
          <Spinner /> Loading answers…
        </div>
      ) : rows.length === 0 ? (
        <p className="text-sm text-ink-500">These answers could not be loaded.</p>
      ) : (
        <div className="space-y-4">
          {rows.map((row: any, index: number) => {
            const target = (row.entities ?? []).find((e: any) => e.kind === "target");
            const highlights = highlightsFor(row.analysis, target?.id ?? null);
            const sources = sourcesFor(
              row.response?.sourceUrls ?? [],
              row.analysis?.citations ?? [],
              new Map<string, string>((row.entities ?? []).map((e: any) => [e.id, e.canonicalName])),
            );
            const inline: string[] = (row.response?.inlineCitationUrls ?? []).filter((url: string) => !(row.response?.sourceUrls ?? []).includes(url));
            return (
              <article key={index} className="sun-sheet overflow-hidden">
                <div className="border-b border-ink-100 bg-paper px-3.5 py-2.5">
                  <p className="text-sm font-semibold text-ink-950">{row.candidate?.editedText ?? row.candidate?.text ?? "(question unavailable)"}</p>
                  <p className="mt-0.5 text-xs text-ink-500">
                    {routeName(row.response?.providerExperience ?? "")}
                    {row.candidate?.section ? ` · ${sectionLabel(row.candidate.section)}` : ""}
                    {row.response?.observedAt ? ` · ${formatDateTime(row.response.observedAt)}` : ""}
                    {row.response?.visibleModelMode && row.response.visibleModelMode !== "unknown" ? ` · ${row.response.visibleModelMode}` : ""}
                    {row.response?.observerRegion ? ` · asked from ${row.response.observerRegion}` : ""}
                    {row.response?.searchState === "on" ? " · web search on" : row.response?.searchState === "off" ? " · no web search" : ""}
                    {row.response?.answerCaptureState === "truncated" ? " · answer cut off" : ""}
                  </p>
                </div>
                <div className="max-h-96 overflow-y-auto px-3.5 py-3">
                  {row.response?.responseText ? <AnswerText text={row.response.responseText} highlights={highlights} /> : <p className="text-sm text-ink-500">No answer text.</p>}
                </div>
                {highlights.length > 0 && <HighlightLegend brand={brand} />}
                <div className="border-t border-ink-100 px-3.5 py-2.5">
                  <p className="sun-eyebrow text-ink-500">
                    Sources the page showed{sources.length > 0 ? ` (${sources.length})` : ""}
                  </p>
                  {sources.length > 0 ? (
                    <SourceList
                      sources={sources}
                      brand={brand}
                      footer={
                        inline.length > 0 ? (
                          <li className="pt-1 text-[11px] text-ink-500">
                            Also linked inline in the answer: {inline.map((url) => registrableDomainOf(url)).join(", ")}
                          </li>
                        ) : undefined
                      }
                    />
                  ) : (
                    <p className="mt-1 text-xs text-ink-500">
                      {row.response?.sourcesCaptureState === "none_present"
                        ? "The page showed no sources for this answer."
                        : "Sources were not captured for this answer, so it is left out of every source figure."}
                    </p>
                  )}
                </div>
              </article>
            );
          })}
          {ids.length > limit && (
            <button type="button" onClick={() => setLimit((value) => value + 25)} className="focus-ring rounded text-sm font-medium text-brand-600 hover:underline">
              Show {Math.min(25, ids.length - limit)} more of {ids.length}
            </button>
          )}
        </div>
      )}
    </Drawer>
  );
}
