"use client";

// Sources: which sites the answers lean on, and whether yours is one of them.
//
// Simplified with measure-policy@4. The view had three citation rates (two of
// them identical whenever every answer showed sources, which is every answer
// from ChatGPT on the web), a five-number "what was counted" panel, a "by
// whose site" bar that summed answers per site (one answer citing three
// directories counted three times), a site table and a separate list of
// "sites shaping answers you are missing from" that repeated the table's last
// column. Now: one rate, each answer once by whose site it cited, the kinds
// of site counted by answers, and one site table with that filter built in.

import { useMemo, useState } from "react";
import { Select } from "@/components/ui/primitives";
import type { DomainRow, UrlRow } from "@/lib/measure/types";
import { BarList, ShareBar, type BarListRow, type MarkTone } from "./charts";
import { Chip, CountLink, Headline, Mark, Panel, Section, engineName, looksLikeOwnSite, sectionLabel, useMeasure } from "./shared";

type OwnershipFilter = "all" | "TARGET_OWNED" | "COMPETITOR_OWNED" | "third";
type SectionFilter = "all" | "Discovery" | "Trade Offs" | "Sentiment Analysis";

function ownershipMatches(row: { ownership: string }, filter: OwnershipFilter): boolean {
  if (filter === "all") return true;
  if (filter === "third") return row.ownership !== "TARGET_OWNED" && row.ownership !== "COMPETITOR_OWNED";
  return row.ownership === filter;
}

function sectionMatches(row: { bySection: Record<string, number> }, filter: SectionFilter): boolean {
  return filter === "all" || (row.bySection[filter] ?? 0) > 0;
}

export function SourcesView() {
  const { data, brand, scope } = useMeasure();
  const measure = data.measure;
  const sources = measure.sources;
  const metrics = measure.metrics[scope] ?? {};
  const defs = data.definitions;
  const kinds = data.sourceKindLabels;
  const [ownership, setOwnership] = useState<OwnershipFilter>("all");
  const [kind, setKind] = useState("all");
  const [section, setSection] = useState<SectionFilter>("all");
  const [leftOut, setLeftOut] = useState(false);
  const [showUrls, setShowUrls] = useState(25);
  const engines = Object.keys(measure.coverage.byEngine);
  const inScope = (row: { byEngine: Record<string, number> }) => scope === "combined" || (row.byEngine[scope] ?? 0) > 0;
  const scopedIds = (ids: string[]) => (scope === "combined" ? ids : ids.filter((id) => measure.prompts.some((row) => row.observationId === id && row.engine === scope)));

  const domains = useMemo(
    () => sources.domains.filter((row) => ownershipMatches(row, ownership) && (kind === "all" || row.kind === kind) && sectionMatches(row, section) && inScope(row) && (!leftOut || row.discoveryWithoutTarget > 0)),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [sources.domains, ownership, kind, section, scope, leftOut],
  );
  const urls = useMemo(
    () => sources.urls.filter((row) => ownershipMatches(row, ownership) && (kind === "all" || row.kind === kind) && sectionMatches(row, section) && inScope(row) && (!leftOut || row.discoveryWithoutTarget > 0)),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [sources.urls, ownership, kind, section, scope, leftOut],
  );
  // Kinds of site counted by ANSWERS: an answer citing three directories counts once for "directory".
  const byKind = useMemo(() => {
    const map = new Map<string, { kind: string; sites: number; ids: Set<string> }>();
    for (const row of sources.domains) {
      if (!inScope(row)) continue;
      const entry = map.get(row.kind) ?? { kind: row.kind, sites: 0, ids: new Set<string>() };
      entry.sites += 1;
      for (const id of scopedIds(row.observationIds)) entry.ids.add(id);
      map.set(row.kind, entry);
    }
    return [...map.values()].filter((entry) => entry.ids.size > 0).sort((a, b) => b.ids.size - a.ids.size);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sources.domains, scope]);
  const mix = sources.answerMix;
  const possiblyYours = sources.domains.filter((row) => row.ownership !== "TARGET_OWNED" && row.ownership !== "COMPETITOR_OWNED" && looksLikeOwnSite(row.domain, brand));
  const max = Math.max(1, ...domains.map((row) => row.responsesCiting));
  const owned = metrics.owned_citation_rate;
  const ownedWhenSourced = metrics.owned_citation_rate_when_sourced;
  // The narrower rate says something only when some answers showed no sources at all.
  const showWhenSourced = Boolean(owned && ownedWhenSourced && ownedWhenSourced.denominator !== owned.denominator);

  if (sources.domains.length === 0) {
    return (
      <Panel title="No cited sites yet">
        <p className="max-w-2xl text-sm leading-6 text-ink-500">None of these answers listed the pages they used, or their sources were not captured. Sources appear here as soon as an answer shows them.</p>
      </Panel>
    );
  }

  return (
    <div className="space-y-8">
      <div className="grid gap-4 lg:grid-cols-12">
        <div className="lg:col-span-4">
          <Headline
            label="Your site cited"
            metric={owned}
            sentence={(m) => `${brand}'s own pages were among the sources of ${m.numerator} of ${m.denominator} answers${showWhenSourced && ownedWhenSourced ? `; ${ownedWhenSourced.numerator} of the ${ownedWhenSourced.denominator} that showed any source` : ""}`}
            definition={defs.owned_citation_rate}
          />
        </div>
        <Panel className="lg:col-span-8" title="Whose sites the answers cited" hint={data.sourceDefinitions.answerMix ?? "Each answer once, by whose site it cited."}>
          {mix ? (
            <ShareBar
              height="lg"
              segments={[
                { key: "yours", label: `Cited ${brand}'s site`, count: scopedIds(mix.yours).length, tone: "target", ids: scopedIds(mix.yours) },
                { key: "rival", label: "A tracked rival's, not yours", count: scopedIds(mix.rivalNotYours).length, tone: "rival", ids: scopedIds(mix.rivalNotYours) },
                { key: "third", label: "Third-party sites only", count: scopedIds(mix.thirdPartyOnly).length, tone: "neutral", ids: scopedIds(mix.thirdPartyOnly) },
                { key: "none", label: "No sources", count: scopedIds(mix.noSources).length, tone: "muted", ids: scopedIds(mix.noSources) },
              ]}
              drillTitle={(segment) => `Answers that ${segment.label.charAt(0).toLowerCase()}${segment.label.slice(1)}`}
            />
          ) : (
            <p className="text-sm text-ink-500">This measurement was saved before answers were grouped by whose site they cited. Re-analyse it to see the mix.</p>
          )}
          {possiblyYours.length > 0 && (
            <p className="mt-3 rounded-lg bg-sun-50 px-3 py-2 text-xs leading-5 text-ink-700">
              <span className="font-semibold">Possibly yours:</span> {possiblyYours.map((row) => `${row.domain} (${row.responsesCiting} ${row.responsesCiting === 1 ? "answer" : "answers"})`).join(", ")}. {possiblyYours.length === 1 ? "It spells" : "They spell"} {brand} but {possiblyYours.length === 1 ? "is" : "are"} counted as third party, because only the
              domains recorded for {brand} count as yours. If it is yours, add it to your websites under Understand; answers analysed after that count it.
            </p>
          )}
        </Panel>
      </div>

      <Section eyebrow="By kind" title="What kinds of site the answers lean on" note="Answers citing at least one site of each kind. Ownership is recorded; every other kind is guessed from the address. Choose a kind to filter the table below.">
        <Panel>
          <BarList
            rows={byKind.map(
              (entry): BarListRow => ({
                key: entry.kind,
                label: `${kinds[entry.kind] ?? entry.kind}${entry.kind !== "yours" && entry.kind !== "rival" && entry.kind !== "other" ? " (guess)" : ""}`,
                action: (
                  <button
                    type="button"
                    onClick={() => setKind(kind === entry.kind ? "all" : entry.kind)}
                    aria-pressed={kind === entry.kind}
                    aria-label={`${kind === entry.kind ? "Stop filtering by" : "Filter the table to"} ${kinds[entry.kind] ?? entry.kind}`}
                    className={`focus-ring shrink-0 rounded-full border px-1.5 py-px text-[10px] ${kind === entry.kind ? "border-sun-400 bg-sun-100 text-sun-900" : "border-ink-200 text-ink-500 hover:border-ink-300"}`}
                  >
                    {kind === entry.kind ? "filtering" : "filter"}
                  </button>
                ),
                value: entry.ids.size,
                ids: [...entry.ids],
                tone: (entry.kind === "yours" ? "target" : entry.kind === "rival" ? "rival" : "neutral") as MarkTone,
                note: `· ${entry.sites} site${entry.sites === 1 ? "" : "s"}`,
              }),
            )}
            labelWidth="minmax(0,13rem)"
            drillTitle={(row) => `Answers citing ${row.label}`}
          />
        </Panel>
      </Section>

      <Section eyebrow="Sites" title="Which sites shape the answers" note={data.sourceDefinitions.kind}>
        <Panel
          action={
            <div className="flex flex-wrap items-center gap-2">
              <label className="flex items-center gap-1.5 text-xs text-ink-700">
                <input type="checkbox" checked={leftOut} onChange={(event) => setLeftOut(event.target.checked)} className="focus-ring h-3.5 w-3.5 rounded border-ink-300" />
                Only sites cited when {brand} was left out
              </label>
              <Select aria-label="Question type" value={section} onChange={(event) => setSection(event.target.value as SectionFilter)}>
                <option value="all">Every question type</option>
                <option value="Discovery">Discovery</option>
                <option value="Trade Offs">Trade Offs</option>
                <option value="Sentiment Analysis">Reputation</option>
              </Select>
              <Select aria-label="Ownership" value={ownership} onChange={(event) => setOwnership(event.target.value as OwnershipFilter)}>
                <option value="all">Every site</option>
                <option value="TARGET_OWNED">Yours</option>
                <option value="COMPETITOR_OWNED">Rivals’</option>
                <option value="third">Third party</option>
              </Select>
              <Select aria-label="Kind" value={kind} onChange={(event) => setKind(event.target.value)}>
                <option value="all">Any kind</option>
                {Object.entries(kinds).map(([key, label]) => (
                  <option key={key} value={key}>
                    {label}
                  </option>
                ))}
              </Select>
            </div>
          }
        >
          {domains.length === 0 ? (
            <p className="py-6 text-center text-sm text-ink-500">No sites match these filters.</p>
          ) : (
            <>
              <ul className="space-y-2 sm:hidden">
                {domains.map((row) => (
                  <DomainCard key={row.domain} row={row} section={section} />
                ))}
              </ul>
              <div className="sun-scroll-x hidden sm:block">
                <table className="sun-table">
                  <thead>
                    <tr>
                      <th>Site</th>
                      <th>Kind</th>
                      <th>{section === "all" ? "Answers citing" : `${sectionLabel(section)} answers citing`}</th>
                      {engines.length > 1 && scope === "combined" && engines.map((engine) => <th key={engine}>{engineName(engine)}</th>)}
                      <th>
                        <span title={data.sourceDefinitions.discoveryWithoutTarget}>In discovery answers without {brand}</span>
                      </th>
                    </tr>
                  </thead>
                  <tbody>
                    {domains.map((row) => (
                      <DomainTableRow key={row.domain} row={row} max={max} engines={engines} section={section} />
                    ))}
                  </tbody>
                </table>
              </div>
              {leftOut && <p className="mt-3 text-xs leading-5 text-ink-500">{data.opportunityDefinitions.source_gap?.notEvidenceOf}</p>}
            </>
          )}
        </Panel>
      </Section>

      <details className="group">
        <summary className="focus-ring cursor-pointer rounded text-sm font-medium text-brand-600 hover:underline">Every cited page ({urls.length})</summary>
        <Panel className="mt-3">
          {urls.length === 0 ? (
            <p className="py-6 text-center text-sm text-ink-500">No pages match these filters.</p>
          ) : (
            <>
              <ul className="divide-y divide-ink-100">
                {urls.slice(0, showUrls).map((row) => (
                  <UrlListRow key={row.url} row={row} />
                ))}
              </ul>
              {urls.length > showUrls && (
                <button type="button" onClick={() => setShowUrls((value) => value + 25)} className="focus-ring mt-3 rounded text-sm font-medium text-brand-600 hover:underline">
                  Show {Math.min(25, urls.length - showUrls)} more of {urls.length}
                </button>
              )}
            </>
          )}
        </Panel>
      </details>

      <p className="text-xs leading-5 text-ink-500">
        {data.sourceDefinitions.trustworthy} {sources.totals.trustworthy} answers qualified; they cited {sources.totals.uniqueDomains} sites and {sources.totals.uniqueUrls} pages. {data.sourceDefinitions.ownership}
      </p>
    </div>
  );
}

function KindChip({ kind, ownership, label }: { kind: string; ownership: string; label: string }) {
  const guessed = ownership !== "TARGET_OWNED" && ownership !== "COMPETITOR_OWNED";
  return (
    <Chip tone={guessed ? "outline" : ownership === "TARGET_OWNED" ? "sun" : "neutral"} className={guessed ? "border-dashed" : ""}>
      {label}
      {guessed && kind !== "other" ? " (guess)" : ""}
    </Chip>
  );
}

function DomainTableRow({ row, max, engines, section }: { row: DomainRow; max: number; engines: string[]; section: SectionFilter }) {
  const { data, scope, brand, onDrill } = useMeasure();
  const label = data.sourceKindLabels[row.kind] ?? row.kind;
  const citing = section !== "all" ? (row.bySection[section] ?? 0) : scope === "combined" ? row.responsesCiting : (row.byEngine[scope] ?? 0);
  return (
    <tr className="align-top">
      <td className="pr-3">
        <button type="button" onClick={() => onDrill(`Answers citing ${row.domain}`, row.observationIds)} className="focus-ring flex items-center gap-2 whitespace-nowrap rounded text-left font-mono text-xs text-ink-900 hover:underline">
          <Mark name={row.domain} tone={row.ownership === "TARGET_OWNED" ? "target" : row.ownership === "COMPETITOR_OWNED" ? "rival" : "neutral"} size="sm" />
          {row.domain}
        </button>
        {(row.ownerName || (row.ownership !== "TARGET_OWNED" && looksLikeOwnSite(row.domain, brand))) && (
          <p className="pl-8 text-[11px] text-ink-500">{row.ownerName ?? "possibly yours, not recorded"}</p>
        )}
        <span className="ml-8 mt-1 block h-1.5 w-40 max-w-full overflow-hidden rounded-full bg-ink-100">
          <span className={`block h-full rounded-full ${row.ownership === "TARGET_OWNED" ? "bg-sun-500" : "bg-ink-300"}`} style={{ width: `${(row.responsesCiting / max) * 100}%` }} />
        </span>
      </td>
      <td className="pr-3">
        <KindChip kind={row.kind} ownership={row.ownership} label={label} />
      </td>
      <td className="tabular-nums text-ink-900">{citing}</td>
      {engines.length > 1 &&
        scope === "combined" &&
        engines.map((engine) => (
          <td key={engine} className="py-2.5 pr-3 tabular-nums text-ink-600">
            {row.byEngine[engine] ?? 0}
          </td>
        ))}
      <td className="tabular-nums">
        <CountLink count={row.discoveryWithoutTarget} label={`Discovery answers citing ${row.domain} that did not name ${brand}`} ids={row.discoveryWithoutTargetIds} />
      </td>
    </tr>
  );
}

/** The site table's row as a card, for narrow screens. */
function DomainCard({ row, section }: { row: DomainRow; section: SectionFilter }) {
  const { data, scope, brand, onDrill } = useMeasure();
  const label = data.sourceKindLabels[row.kind] ?? row.kind;
  const citing = section !== "all" ? (row.bySection[section] ?? 0) : scope === "combined" ? row.responsesCiting : (row.byEngine[scope] ?? 0);
  return (
    <li className="rounded-xl border border-ink-200/75 bg-white p-3.5">
      <button type="button" onClick={() => onDrill(`Answers citing ${row.domain}`, row.observationIds)} className="focus-ring flex max-w-full items-center gap-2 rounded text-left font-mono text-xs text-ink-900 hover:underline">
        <Mark name={row.domain} tone={row.ownership === "TARGET_OWNED" ? "target" : row.ownership === "COMPETITOR_OWNED" ? "rival" : "neutral"} size="sm" />
        <span className="truncate">{row.domain}</span>
      </button>
      <div className="mt-2 flex flex-wrap items-center gap-1.5">
        <KindChip kind={row.kind} ownership={row.ownership} label={label} />
        {row.ownerName && <span className="text-[11px] text-ink-500">{row.ownerName}</span>}
      </div>
      <dl className="mt-3 grid grid-cols-2 gap-2 text-xs">
        <div>
          <dt className="text-ink-500">Answers citing</dt>
          <dd className="mt-0.5 font-semibold tabular-nums text-ink-950">{citing}</dd>
        </div>
        <div>
          <dt className="text-ink-500">Without {brand}</dt>
          <dd className="mt-0.5 tabular-nums">
            <CountLink count={row.discoveryWithoutTarget} label={`Discovery answers citing ${row.domain} that did not name ${brand}`} ids={row.discoveryWithoutTargetIds} />
          </dd>
        </div>
      </dl>
    </li>
  );
}

function UrlListRow({ row }: { row: UrlRow }) {
  const { data, onDrill } = useMeasure();
  const label = data.sourceKindLabels[row.kind] ?? row.kind;
  return (
    <li className="flex flex-col gap-1 py-2.5 sm:flex-row sm:items-center sm:justify-between">
      <div className="min-w-0">
        <button type="button" onClick={() => onDrill(`Answers citing ${row.url}`, row.observationIds)} className="focus-ring block max-w-full truncate rounded text-left font-mono text-xs text-ink-800 hover:underline">
          {row.url}
        </button>
        <p className="mt-0.5 flex flex-wrap items-center gap-1.5 text-[11px] text-ink-500">
          <KindChip kind={row.kind} ownership={row.ownership} label={label} />
          {Object.entries(row.bySection).map(([section, count]) => (
            <span key={section}>
              {sectionLabel(section)} {count}
            </span>
          ))}
        </p>
      </div>
      <span className="shrink-0 text-xs tabular-nums text-ink-500">
        {row.responsesCiting} answer{row.responsesCiting === 1 ? "" : "s"}
        {row.discoveryWithoutTarget > 0 ? ` · ${row.discoveryWithoutTarget} without you` : ""}
      </span>
    </li>
  );
}
