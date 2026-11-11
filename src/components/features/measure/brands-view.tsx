"use client";

// Competitors (URL key "brands"): every business the Discovery answers named,
// tracked or not, in one table.
//
// Until measure-policy@4 this view showed three leaderboards with three
// denominators: tracked brands as bars, a tracked-only share of voice that
// read 100% whenever no tracked rival was named, and a table of tracked
// brands, with untracked businesses relegated to a list at the bottom. A
// salon's answers named 31 businesses and 2 of its 6 tracked rivals; the
// table now ranks them all by answers naming them, and keeps the columns only
// a tracked rival can have (head-to-head, own site cited) for tracked rows.

import { useState } from "react";
import type { BrandRow } from "@/lib/measure/types";
import { Chip, CountLink, ExplainButton, Mark, Panel, Section, businessStandings, engineName, percent, useMeasure, type BusinessStanding } from "./shared";

export function BrandsView() {
  const { data, brand, scope, lowN, onExplain, onDrill } = useMeasure();
  const measure = data.measure;
  const engines = Object.keys(measure.coverage.byEngine);
  const columns = data.brandColumns;
  const scoped = scope !== "combined";
  const [showAll, setShowAll] = useState(false);
  const standings = businessStandings(measure.brands, scope);
  const named = standings.filter((entry) => entry.named > 0);
  const eligible = scoped ? (measure.metrics[scope]?.discovery_visibility?.denominator ?? 0) : (measure.metrics.combined?.discovery_visibility?.denominator ?? 0);
  // Business mentions in this scope: the share-of-voice denominator, every business counted once per answer.
  const mentions = named.reduce((sum, entry) => sum + entry.named, 0);
  const target = standings.find((entry) => entry.row.relation === "target");
  const trackedNamed = measure.brands.filter((row) => row.relation === "confirmed_competitor" && standings.some((entry) => entry.row === row && entry.named > 0));
  const trackedNever = measure.brands.filter((row) => row.relation === "confirmed_competitor" && !trackedNamed.includes(row));
  // Businesses named once are most of the list and the least informative; they stay one click away.
  const visible = showAll ? standings : standings.filter((entry) => entry.named >= 2 || entry.row.relation !== "emerging");
  const hidden = standings.length - visible.length;

  const explain = (key: string) => {
    const column = columns[key];
    if (column) onExplain({ label: column.label, plain: column.plain, rows: [["Rule", column.rule]] });
  };
  const Head = ({ label, columnKey, className = "" }: { label: string; columnKey?: string; className?: string }) => (
    <th className={className}>
      <span className="inline-flex items-center gap-1">
        {label}
        {columnKey && columns[columnKey] && <ExplainButton onClick={() => explain(columnKey)} label={`How is ${label.toLowerCase()} counted?`} />}
      </span>
    </th>
  );
  const share = (entry: BusinessStanding) => (mentions >= lowN ? percent(entry.named / mentions) : "—");

  return (
    <div className="space-y-8">
      <Panel>
        <p className="text-[15px] leading-7 text-ink-800">
          {named.length === 0 ? (
            <>No business has been named in the Discovery answers yet.</>
          ) : (
            <>
              The {eligible} answers to questions that never mentioned {brand} named <b className="font-semibold">{named.length}</b> {named.length === 1 ? "business" : "businesses"}
              {scoped ? ` on ${engineName(scope)}` : ""}. {brand} was named in <b className="font-semibold">{target?.named ?? 0}</b>
              {target && target.named > 0 ? `, ${placeText(target, standings)}` : ""}. {trackedNamed.length} of {trackedNamed.length + trackedNever.length} tracked {trackedNamed.length + trackedNever.length === 1 ? "rival was" : "rivals were"} named.
            </>
          )}
        </p>
        {trackedNever.length > 0 && (
          <p className="mt-2 text-sm leading-6 text-ink-600">
            <span className="font-medium text-ink-800">Tracked, never named:</span> {trackedNever.map((row) => row.name).join(", ")}.
          </p>
        )}
      </Panel>

      <Section
        eyebrow="Every business named"
        title="How often each business was recommended"
        note={`Ranked by Discovery answers naming each business. “Tracked” rivals are frozen with the questions; untracked businesses are detected in the answers and are in no head-to-head. Add the ones that matter under Landscape, then collect a new run.`}
      >
        <Panel>
          <ul className="space-y-2 sm:hidden">
            {visible.map((entry) => (
              <BusinessCard key={`${entry.row.relation}:${entry.row.name}`} entry={entry} eligible={eligible} share={share(entry)} scoped={scoped} />
            ))}
          </ul>
          <div className="sun-scroll-x hidden sm:block">
            <table className="sun-table">
              <thead>
                <tr>
                  <Head label="#" />
                  <Head label="Business" />
                  <Head label="Named in discovery" columnKey="discoveryNamed" />
                  <Head label="Share of voice" columnKey="shareOfVoice" />
                  <Head label="Ranked first" columnKey="firstChoice" />
                  <Head label="Average position" columnKey="averageRank" />
                  <Head label={`Head-to-head vs ${brand}`} columnKey="headToHead" />
                  <Head label="Own site cited" columnKey="ownDomainsCited" />
                  {engines.length > 1 && !scoped && engines.map((engine) => <Head key={engine} label={engineName(engine)} />)}
                </tr>
              </thead>
              <tbody>
                {visible.map((entry) => {
                  const row = entry.row;
                  const isTarget = row.relation === "target";
                  return (
                    <tr key={`${row.relation}:${row.name}`} className={isTarget ? "is-target" : ""}>
                      <td className="tabular-nums text-ink-500">{entry.named > 0 ? entry.place : "—"}</td>
                      <td className="pr-3">
                        <span className={`flex items-center gap-2 ${isTarget ? "font-semibold text-ink-950" : "text-ink-800"}`}>
                          <Mark name={row.name} tone={isTarget ? "target" : row.relation === "confirmed_competitor" ? "rival" : "neutral"} size="sm" />
                          <span className="min-w-0">{row.name}</span>
                          <RelationBadge row={row} />
                        </span>
                      </td>
                      <td className="tabular-nums">
                        <button type="button" disabled={entry.named === 0} onClick={() => onDrill(`Discovery answers naming ${row.name}`, row.discoveryObservationIds)} className="focus-ring flex items-center gap-2 rounded text-left hover:underline disabled:no-underline">
                          <span className="block h-1.5 w-16 overflow-hidden rounded-full bg-ink-100" aria-hidden="true">
                            <span className={`block h-full rounded-full ${isTarget ? "bg-sun-500" : row.relation === "confirmed_competitor" ? "bg-ink-500" : "bg-ink-300"}`} style={{ width: `${eligible > 0 ? (entry.named / eligible) * 100 : 0}%` }} />
                          </span>
                          <span>
                            <b className="font-semibold text-ink-900">{entry.named}</b> <span className="text-ink-500">of {eligible}</span>
                          </span>
                        </button>
                      </td>
                      <td className="tabular-nums text-ink-700">{entry.named > 0 ? share(entry) : "—"}</td>
                      <td className="tabular-nums text-ink-700">{scoped || row.rankedCount === 0 ? "—" : row.firstChoice}</td>
                      <td className="tabular-nums text-ink-700">
                        {scoped || row.averageRank === null ? (
                          "—"
                        ) : (
                          <>
                            #{row.averageRank.toFixed(1)} <span className="text-xs text-ink-500">over {row.rankedCount}</span>
                          </>
                        )}
                      </td>
                      <td className="tabular-nums">{row.headToHead && !scoped ? <HeadToHead row={row} /> : <span className="text-ink-400">—</span>}</td>
                      <td className="tabular-nums">{scoped || row.relation === "emerging" ? <span className="text-ink-400">—</span> : <CountLink count={row.ownDomainsCited} label={`Answers citing ${row.name}'s site`} ids={row.ownDomainsCitedIds} />}</td>
                      {engines.length > 1 &&
                        !scoped &&
                        engines.map((engine) => (
                          <td key={engine} className="py-2.5 pr-3 tabular-nums text-ink-600">
                            {row.namedByEngine[engine]?.named ?? 0} <span className="text-ink-500">of {row.namedByEngine[engine]?.eligible ?? 0}</span>
                          </td>
                        ))}
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
          {hidden > 0 && (
            <button type="button" onClick={() => setShowAll(true)} className="focus-ring mt-3 rounded text-sm font-medium text-brand-600 hover:underline">
              Show {hidden} more {hidden === 1 ? "business" : "businesses"} named once
            </button>
          )}
          <p className="mt-3 text-xs leading-5 text-ink-500">
            Share of voice is each business’s share of the {mentions} business {mentions === 1 ? "mention" : "mentions"} in these answers{mentions < lowN ? ", shown once there are five or more" : ""}. Ranks exist only where an answer
            numbered its options; order of appearance in prose is never a rank.
            {scoped ? " Ranks, head-to-heads and citations are shown for all engines together." : ""}
          </p>
        </Panel>
      </Section>
    </div>
  );
}

/** "the most named", "named as often as Glow Salon", "behind Glow Salon (3)". */
function placeText(target: BusinessStanding, standings: BusinessStanding[]): string {
  const ahead = standings.filter((entry) => entry.named > target.named);
  const level = standings.filter((entry) => entry !== target && entry.named === target.named);
  if (ahead.length === 0) return level.length === 0 ? "more than any other business" : `level with ${level.slice(0, 2).map((entry) => entry.row.name).join(" and ")}${level.length > 2 ? " and others" : ""}`;
  return `behind ${ahead.length} ${ahead.length === 1 ? "business" : "businesses"} (most: ${ahead[0]!.row.name}, ${ahead[0]!.named})`;
}

function RelationBadge({ row }: { row: BrandRow }) {
  if (row.relation === "target") return <span className="shrink-0 rounded bg-sun-100 px-1.5 py-px text-[10px] font-semibold text-sun-900">you</span>;
  if (row.relation === "confirmed_competitor") return <span className="shrink-0 rounded border border-ink-200 px-1.5 py-px text-[10px] font-medium text-ink-600">tracked</span>;
  return (
    <Chip tone="outline" className="shrink-0 border-dashed">
      not tracked
    </Chip>
  );
}

function HeadToHead({ row }: { row: BrandRow }) {
  const { brand, onDrill } = useMeasure();
  const record = row.headToHead!;
  const total = record.won + record.lost + record.undecided;
  if (total === 0) return <span className="text-ink-400">not compared</span>;
  return (
    <button type="button" onClick={() => onDrill(`${brand} vs ${row.name}`, record.observationIds)} className="focus-ring rounded text-left hover:underline">
      <b className="font-semibold text-ok-600">{record.won}</b>–<b className="font-semibold text-danger-600">{record.lost}</b>
      {record.undecided > 0 && <span className="ml-1 text-xs text-ink-500">{record.undecided} undecided</span>}
    </button>
  );
}

/** The same figures as the table, one card per business, for narrow screens. */
function BusinessCard({ entry, eligible, share, scoped }: { entry: BusinessStanding; eligible: number; share: string; scoped: boolean }) {
  const { onDrill } = useMeasure();
  const row = entry.row;
  const isTarget = row.relation === "target";
  return (
    <li className={`rounded-xl border p-3.5 ${isTarget ? "border-sun-300 bg-sun-50/60" : "border-ink-200/75 bg-white"}`}>
      <div className="flex items-center gap-2">
        <span className="w-5 text-xs tabular-nums text-ink-500">{entry.named > 0 ? entry.place : "—"}</span>
        <Mark name={row.name} tone={isTarget ? "target" : row.relation === "confirmed_competitor" ? "rival" : "neutral"} size="sm" />
        <span className={`min-w-0 truncate text-sm ${isTarget ? "font-semibold text-ink-950" : "text-ink-800"}`}>{row.name}</span>
        <RelationBadge row={row} />
      </div>
      <dl className="mt-3 grid grid-cols-2 gap-x-3 gap-y-2 text-xs">
        <div>
          <dt className="text-ink-500">Named in discovery</dt>
          <dd className="mt-0.5 tabular-nums">
            <button type="button" disabled={entry.named === 0} onClick={() => onDrill(`Discovery answers naming ${row.name}`, row.discoveryObservationIds)} className="focus-ring rounded text-left font-semibold text-ink-950 hover:underline disabled:no-underline">
              {entry.named} <span className="font-normal text-ink-500">of {eligible}</span>
            </button>
          </dd>
        </div>
        <div>
          <dt className="text-ink-500">Share of voice</dt>
          <dd className="mt-0.5 font-semibold tabular-nums text-ink-950">{entry.named > 0 ? share : "—"}</dd>
        </div>
        <div>
          <dt className="text-ink-500">Average position</dt>
          <dd className="mt-0.5 font-semibold tabular-nums text-ink-950">{scoped || row.averageRank === null ? "—" : `#${row.averageRank.toFixed(1)} over ${row.rankedCount}`}</dd>
        </div>
        <div>
          <dt className="text-ink-500">Head-to-head</dt>
          <dd className="mt-0.5 tabular-nums">{row.headToHead && !scoped ? <HeadToHead row={row} /> : <span className="text-ink-400">—</span>}</dd>
        </div>
      </dl>
    </li>
  );
}
