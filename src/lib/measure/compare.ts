// Comparing two measurements honestly.
//
// A later number differs either because the assistants changed or because the
// INSTRUMENT changed. Only the first is a trend. So before any delta is
// computed, the two lineages are compared: a difference in the questions, the
// competitive set, the analysis rules, the formulas, the engines or the
// sample size is a BREAK, and no delta is shown. Smaller differences (another
// provider for the same engine, another observer country, uneven coverage)
// are CAUTIONS: the delta is shown with the note beside it.

import { LOW_N, type MetricKey } from "./policy";
import { withinPlausibleRange } from "./precision";
import type { CoverageResult, MeasureLineage, MeasureResult, TradeOffOutcome } from "./types";

export type ComparabilityLevel = "comparable" | "caution" | "break";

export interface Comparability {
  level: ComparabilityLevel;
  breaks: string[];
  cautions: string[];
}

export interface MeasurementFacts {
  lineage: MeasureLineage;
  coverage: Pick<CoverageResult, "planned" | "analysable" | "byEngine">;
}

function analysableEngines(facts: MeasurementFacts): string[] {
  return Object.entries(facts.coverage.byEngine)
    .filter(([, counts]) => counts.analysable > 0)
    .map(([engine]) => engine)
    .sort();
}

function sameList(a: string[], b: string[]): boolean {
  return [...a].sort().join(",") === [...b].sort().join(",");
}

export function comparability(current: MeasurementFacts, previous: MeasurementFacts): Comparability {
  const a = current.lineage;
  const b = previous.lineage;
  const breaks: string[] = [];
  const cautions: string[] = [];

  if (a.promptSetId !== b.promptSetId) breaks.push("the approved questions changed, so the two runs asked different things");
  if (a.competitiveSetVersionId !== b.competitiveSetVersionId) breaks.push("the competitive set changed, so share-of-voice denominators differ");
  if (!sameList(a.analysisVersions, b.analysisVersions)) breaks.push(`the analysis rules differ (${b.analysisVersions.join("+") || "none"} vs ${a.analysisVersions.join("+") || "none"})`);
  if (a.metricPolicyVersion !== b.metricPolicyVersion) breaks.push(`the metric formulas differ (${b.metricPolicyVersion} vs ${a.metricPolicyVersion})`);
  const enginesA = analysableEngines(current);
  const enginesB = analysableEngines(previous);
  if (!sameList(enginesA, enginesB)) breaks.push(`the engines with analysable answers differ (${enginesB.join(", ") || "none"} vs ${enginesA.join(", ") || "none"})`);
  if (a.samplesPerPrompt !== b.samplesPerPrompt) breaks.push("the samples per question differ, so precision differs");

  if (!sameList(a.providerExperiences, b.providerExperiences)) cautions.push("collected through a different provider for the same engine");
  if (!sameList(a.observerRegions, b.observerRegions)) cautions.push(`the provider declared a different observer country (${b.observerRegions.join(", ") || "unknown"} vs ${a.observerRegions.join(", ") || "unknown"})`);
  if (a.models.length > 0 && b.models.length > 0 && !sameList(a.models, b.models)) cautions.push(`the page named a different model (${b.models.join(", ")} vs ${a.models.join(", ")})`);
  const coverageA = current.coverage.planned > 0 ? current.coverage.analysable / current.coverage.planned : 0;
  const coverageB = previous.coverage.planned > 0 ? previous.coverage.analysable / previous.coverage.planned : 0;
  if (coverageA < 1 || coverageB < 1) cautions.push(`coverage is partial (${previous.coverage.analysable} of ${previous.coverage.planned} vs ${current.coverage.analysable} of ${current.coverage.planned} answers analysable)`);
  else if (Math.abs(coverageA - coverageB) > 0.1) cautions.push("coverage differs by more than ten points");

  return { level: breaks.length > 0 ? "break" : cautions.length > 0 ? "caution" : "comparable", breaks, cautions };
}

export interface MetricDelta {
  key: MetricKey;
  from: { numerator: number; denominator: number; value: number | null };
  to: { numerator: number; denominator: number; value: number | null };
  /** Percentage points, only when both sides have a value and at least LOW_N in the denominator. */
  points: number | null;
  /** Whether the change must be read as counts rather than points. */
  countsOnly: boolean;
  direction: "up" | "down" | "flat" | null;
  /**
   * The later value sits inside the earlier value's plausible range (Wilson
   * 95%), so a different handful of similar questions could produce it.
   * Absent in comparisons computed before measure-policy@4.
   */
  withinRange?: boolean;
}

export interface CountDelta {
  from: number;
  to: number;
  change: number;
}

export interface MeasurementComparison {
  previousRunId: string;
  comparability: Comparability;
  /** Empty when the pair is not comparable. */
  metrics: Record<string, Partial<Record<MetricKey, MetricDelta>>>;
  tradeOffs: Record<string, Partial<Record<TradeOffOutcome, CountDelta>>>;
  sentiment: Record<string, Record<string, CountDelta>>;
}

function metricDelta(key: MetricKey, to: MeasureResult["metrics"][string][MetricKey], from: MeasureResult["metrics"][string][MetricKey]): MetricDelta | null {
  if (!to || !from) return null;
  const bothValued = to.value !== null && from.value !== null;
  const enough = to.denominator >= LOW_N && from.denominator >= LOW_N;
  const points = bothValued && enough ? Math.round((to.value! - from.value!) * 1000) / 10 : null;
  const direction = !bothValued ? null : to.value! > from.value! ? "up" : to.value! < from.value! ? "down" : "flat";
  return {
    key,
    from: { numerator: from.numerator, denominator: from.denominator, value: from.value },
    to: { numerator: to.numerator, denominator: to.denominator, value: to.value },
    points,
    countsOnly: bothValued && !enough,
    direction,
    withinRange: bothValued && withinPlausibleRange(from, to),
  };
}

export function compareMeasurements(current: MeasureResult, previous: MeasureResult): MeasurementComparison {
  const verdict = comparability(current, previous);
  const out: MeasurementComparison = { previousRunId: previous.collectionRunId, comparability: verdict, metrics: {}, tradeOffs: {}, sentiment: {} };
  if (verdict.level === "break") return out;

  for (const scope of Object.keys(current.metrics)) {
    const to = current.metrics[scope] ?? {};
    const from = previous.metrics[scope];
    if (!from) continue;
    const deltas: Partial<Record<MetricKey, MetricDelta>> = {};
    for (const key of Object.keys(to) as MetricKey[]) {
      const delta = metricDelta(key, to[key], from[key]);
      if (delta) deltas[key] = delta;
    }
    out.metrics[scope] = deltas;

    const tradeTo = current.tradeOffs[scope]?.outcomes;
    const tradeFrom = previous.tradeOffs[scope]?.outcomes;
    if (tradeTo && tradeFrom) {
      const rows: Partial<Record<TradeOffOutcome, CountDelta>> = {};
      for (const outcome of Object.keys(tradeTo) as TradeOffOutcome[]) {
        rows[outcome] = { from: tradeFrom[outcome] ?? 0, to: tradeTo[outcome], change: tradeTo[outcome] - (tradeFrom[outcome] ?? 0) };
      }
      out.tradeOffs[scope] = rows;
    }
    const sentTo = current.sentiment[scope]?.distribution;
    const sentFrom = previous.sentiment[scope]?.distribution;
    if (sentTo && sentFrom) {
      const rows: Record<string, CountDelta> = {};
      for (const polarity of Object.keys(sentTo)) {
        rows[polarity] = { from: sentFrom[polarity] ?? 0, to: sentTo[polarity] ?? 0, change: (sentTo[polarity] ?? 0) - (sentFrom[polarity] ?? 0) };
      }
      out.sentiment[scope] = rows;
    }
  }
  return out;
}
