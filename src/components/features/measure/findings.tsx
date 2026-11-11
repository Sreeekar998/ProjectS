"use client";

// What needs attention: the measurement's findings as one ranked list on the
// Overview (the separate Opportunities tab was retired with measure-policy@4).
// Every finding carries its count against its own denominator, a sentence
// quoted from an answer behind it, what it is and is not evidence of, and the
// answers themselves. Deciding what to publish or change is the Actions
// phase; this list stops at naming the evidence.

import type { Opportunity, OpportunityType } from "@/lib/measure/types";
import { Meter } from "./charts";
import { AnswersBehindLink, Chip, Panel, engineName, useMeasure } from "./shared";

/** Losing ground first, then where to look, then what the figures rest on. */
const ORDER: OpportunityType[] = ["discovery_gap", "tradeoff_loss", "reputation_concern", "source_gap", "untracked_brand", "coverage_gap", "rival_source", "owned_uncited"];
const TONE: Record<OpportunityType, "danger" | "warn" | "neutral"> = {
  discovery_gap: "danger",
  tradeoff_loss: "danger",
  reputation_concern: "warn",
  source_gap: "neutral",
  untracked_brand: "neutral",
  coverage_gap: "warn",
  rival_source: "neutral",
  owned_uncited: "neutral",
};

export function Findings() {
  const { data, brand } = useMeasure();
  const engines = Object.keys(data.measure.coverage.byEngine);
  const rows = [...data.measure.opportunities].sort((a, b) => ORDER.indexOf(a.type) - ORDER.indexOf(b.type) || b.count - a.count);
  if (rows.length === 0) {
    return (
      <Panel>
        <p className="max-w-2xl text-sm leading-6 text-ink-600">
          Nothing stands out: no Discovery answer named other businesses without {brand}, no head-to-head went to a rival, no by-name answer was negative, and every planned answer was
          collected. Collect again later to see whether that holds.
        </p>
      </Panel>
    );
  }
  return (
    <div className="grid gap-3 lg:grid-cols-2">
      {rows.map((row) => (
        <FindingCard key={row.id} row={row} showEngines={engines.length > 1} />
      ))}
    </div>
  );
}

function FindingCard({ row, showEngines }: { row: Opportunity; showEngines: boolean }) {
  const { data, onDrill } = useMeasure();
  const definition = data.opportunityDefinitions[row.type];
  const example = (row.examples ?? [])[0];
  const tone = TONE[row.type] ?? "neutral";
  return (
    <article className="sun-sheet flex flex-col p-5">
      <div className="flex flex-wrap items-center gap-2">
        <Chip tone={tone === "neutral" ? "outline" : tone}>{definition?.label ?? row.type}</Chip>
        {showEngines && row.engines.map((engine) => <Chip key={engine}>{engineName(engine)}</Chip>)}
        <span className="ml-auto text-sm tabular-nums text-ink-500">
          <b className="font-semibold text-ink-950">{row.count}</b>
          {row.outOf !== null ? ` of ${row.outOf}` : ""}
        </span>
      </div>
      <h3 className="mt-2 text-sm font-semibold leading-5 text-ink-950">{row.title}</h3>
      {row.outOf !== null && row.outOf > 0 && (
        <div className="mt-2">
          <Meter value={row.count} total={row.outOf} tone={tone === "neutral" ? "neutral" : tone} label={`${row.count} of ${row.outOf}`} />
        </div>
      )}
      {example && (
        <button
          type="button"
          onClick={() => onDrill(row.title, [example.observationId])}
          title="Read this answer"
          className="sun-evidence focus-ring mt-3 block w-full py-1.5 pl-3 pr-2 text-left text-xs italic leading-5 text-ink-700 transition-colors hover:bg-sun-100/60"
        >
          “{example.text}”
        </button>
      )}
      {row.items.length > 0 && (
        <ul className="mt-3 flex flex-wrap gap-1.5" aria-label="Behind this finding">
          {row.items.slice(0, 6).map((item) => (
            <li key={item.label}>
              <button
                type="button"
                disabled={item.observationIds.length === 0}
                onClick={() => onDrill(`${row.title}: ${item.label}`, item.observationIds)}
                className="focus-ring rounded-full border border-ink-200 bg-white px-2.5 py-0.5 text-xs text-ink-800 hover:border-ink-300 hover:bg-paper disabled:cursor-default disabled:hover:bg-white"
              >
                {item.label} <span className="tabular-nums text-ink-500">{item.count}</span>
              </button>
            </li>
          ))}
          {row.items.length > 6 && <li className="px-1 py-0.5 text-xs text-ink-500">and {row.items.length - 6} more</li>}
        </ul>
      )}
      <div className="mt-auto flex flex-wrap items-center justify-between gap-x-4 gap-y-1 pt-3 text-xs">
        <AnswersBehindLink ids={row.observationIds} label={row.title} />
        {definition && (
          <details className="text-ink-500">
            <summary className="focus-ring cursor-pointer rounded font-medium text-ink-600 hover:underline">What this does and doesn’t show</summary>
            <div className="sun-inset mt-2 space-y-1.5 px-3 py-2.5 leading-5 text-ink-600">
              <p>
                <span className="font-medium text-ink-800">Evidence of:</span> {definition.evidenceOf}
              </p>
              <p>
                <span className="font-medium text-ink-800">Not evidence of:</span> {definition.notEvidenceOf}
              </p>
              <p>
                <span className="font-medium text-ink-800">Where to look next:</span> {definition.nextStep}
              </p>
            </div>
          </details>
        )}
      </div>
    </article>
  );
}
