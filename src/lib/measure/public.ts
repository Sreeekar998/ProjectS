// The measurement as a reader may take it away.
//
// A MeasureResult keys metrics and coverage by collection route
// (`chatgpt_oxylabs_web`) and lists the routes in its lineage. Those ids name
// the vendor behind an answer, which is internal: the stored rows, logs and
// the collection settings page keep it for debugging, auditing and cost. The
// exports and anything a reader downloads use the surface instead ("ChatGPT
// on the web"), so this projection re-keys every route-scoped block.

import type { MeasureResult, PromptRow } from "./types";
import { surfaceLabel } from "@/lib/providers/engines";

type RouteKeyed<T> = Record<string, T>;

function bySurface<T>(block: RouteKeyed<T>, merge?: (a: T, b: T) => T): RouteKeyed<T> {
  const out: RouteKeyed<T> = {};
  for (const [scope, value] of Object.entries(block)) {
    const key = scope === "combined" ? "combined" : surfaceLabel(scope);
    // Two routes of one surface in one run (a handover) keep the first block
    // unless the caller can add them; a metric block cannot be added.
    out[key] = key in out && merge ? merge(out[key]!, value) : key in out ? out[key]! : value;
  }
  return out;
}

export type PublicPromptRow = Omit<PromptRow, "route"> & { surface: string };

export type PublicMeasureResult = Omit<MeasureResult, "metrics" | "presence" | "tradeOffs" | "sentiment" | "prompts" | "coverage" | "lineage"> & {
  lineage: Omit<MeasureResult["lineage"], "providerExperiences"> & { surfaces: string[] };
  coverage: Omit<MeasureResult["coverage"], "byProvider"> & { bySurface: MeasureResult["coverage"]["byProvider"] };
  metrics: MeasureResult["metrics"];
  presence: MeasureResult["presence"];
  tradeOffs: MeasureResult["tradeOffs"];
  sentiment: MeasureResult["sentiment"];
  prompts: PublicPromptRow[];
};

export function publicMeasure(result: MeasureResult): PublicMeasureResult {
  const { providerExperiences, ...lineage } = result.lineage;
  const { byProvider, ...coverage } = result.coverage;
  const addCounts = (a: { planned: number; captured: number; analysable: number }, b: { planned: number; captured: number; analysable: number }) => ({
    planned: a.planned + b.planned,
    captured: a.captured + b.captured,
    analysable: a.analysable + b.analysable,
  });
  return {
    ...result,
    lineage: { ...lineage, surfaces: [...new Set(providerExperiences.map(surfaceLabel))] },
    coverage: { ...coverage, bySurface: bySurface(byProvider, addCounts) },
    metrics: bySurface(result.metrics),
    presence: bySurface(result.presence),
    tradeOffs: bySurface(result.tradeOffs),
    sentiment: bySurface(result.sentiment),
    prompts: result.prompts.map(({ route, ...row }) => ({ ...row, surface: surfaceLabel(route) })),
  };
}
