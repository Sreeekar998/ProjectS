"use client";

// Overview: the measurement at a glance, in the order a marketing lead asks.
//
//   1. How visible am I, and how do I stand? Four headline figures: visibility,
//      share of voice, head-to-heads, reputation. Each carries its fraction, a
//      plausible range once there are enough answers, and its change.
//   2. Who is recommended instead, and where am I missing? Every business the
//      answers named, beside the topics and places where I was left out.
//   3. What needs attention? The findings, each with a quoted sentence and
//      the answers behind it (the Opportunities tab, folded in here).
//   4. Where do the answers come from, what changed, what does it rest on?
//
// Rebuilt with measure-policy@4. The earlier page stacked eleven panels, said
// each headline twice ("In short" repeated the tiles), showed share of voice
// three ways with three denominators and printed "100%" for one answer. Every
// mark still opens the answers behind it.

import Link from "next/link";
import type { MeasureResponse } from "@/lib/client/api";
import type { MetricValue } from "@/lib/measure/types";
import { BarList, GroupedBars, Meter, ShareBar, engineTone, type BarListRow, type GroupedRow, type MarkTone } from "./charts";
import { Findings } from "./findings";
import { CHANGE_METRICS, Chip, EmptyFigure, Headline, METRIC_SHORT_LABEL, MiniStack, Panel, Ring, Section, SoFar, businessStandings, engineName, formatDate, looksLikeOwnSite, useMeasure } from "./shared";
import { cn } from "@/lib/cn";

export function OverviewView({ view }: { projectId: string; view: (name: string) => string }) {
  const { data, brand, scope, provisional } = useMeasure();
  const measure = data.measure;
  const metrics = measure.metrics[scope] ?? {};
  const defs = data.definitions;
  const comparison = data.previous?.comparison ?? null;
  const comparable = comparison && comparison.comparability.level !== "break";
  const deltas = comparable ? (comparison.metrics[scope] ?? {}) : {};
  const outcomes = measure.tradeOffs[scope]?.outcomes ?? { TARGET_PREFERRED: 0, COMPETITOR_PREFERRED: 0, TIE: 0, UNCLEAR: 0, NO_COMPARISON: 0 };
  const distribution = measure.sentiment[scope]?.distribution ?? {};
  const tradeDelta = comparable ? comparison.tradeOffs[scope] : undefined;
  const engines = Object.keys(measure.coverage.byEngine);
  const shownEngines = scope === "combined" ? engines : [scope];
  const visibility = metrics.discovery_visibility;
  const eligible = visibility?.denominator ?? measure.scopes.discovery.eligible;
  const standings = businessStandings(measure.brands, scope);
  const named = standings.filter((entry) => entry.named > 0);
  const leader = named.find((entry) => entry.row.relation !== "target");
  const target = standings.find((entry) => entry.row.relation === "target");
  const first = metrics.first_choice_rate;
  const shareAll = metrics.discovery_share_all_names;
  const engineLabel = engineNameList(shownEngines.length > 0 ? shownEngines : engines);

  const visibilityFootnote = [
    leader ? (leader.named > (target?.named ?? 0) ? `Most named: ${leader.row.name}, ${leader.named} of ${eligible}` : `Named as often as or more than any other business`) : null,
    first && first.denominator > 0 ? `ranked first in ${first.numerator} of ${first.denominator} ordered lists` : null,
  ]
    .filter(Boolean)
    .join(" · ");

  return (
    <div className="space-y-8">
      <section aria-label="Headline results" className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <Headline
          label="Visibility"
          metric={visibility}
          sentence={(m) => `Named in ${m.numerator} of ${m.denominator} answers to questions that never mentioned ${brand}`}
          definition={defs.discovery_visibility}
          delta={deltas.discovery_visibility}
          footnote={visibilityFootnote || null}
          accent
          visual={visibility && visibility.denominator > 0 ? <Ring value={visibility.value} size={64} label={`${visibility.numerator} of ${visibility.denominator}`} /> : undefined}
        />
        {shareAll ? (
          <Headline
            label="Share of voice"
            metric={shareAll}
            sentence={(m) => `${brand} took ${m.numerator} of ${m.denominator} mentions of the ${named.length} ${named.length === 1 ? "business" : "businesses"} named in those answers`}
            definition={defs.discovery_share_all_names}
            delta={deltas.discovery_share_all_names}
            footnoteAction={
              <Link href={view("brands")} className="focus-ring rounded font-medium text-brand-600 hover:underline">
                Every business named →
              </Link>
            }
            visual={shareAll.denominator > 0 ? <Ring value={shareAll.value} size={64} tone="brand" label={`${shareAll.numerator} of ${shareAll.denominator} mentions`} /> : undefined}
          />
        ) : (
          // Snapshots written before measure-policy@3 have no share of every business.
          <Headline label="Share of voice" metric={metrics.discovery_share_of_voice} sentence={(m) => `${brand} took ${m.numerator} of ${m.denominator} mentions of tracked brands`} definition={defs.discovery_share_of_voice} />
        )}
        <VerdictHeadline
          wins={outcomes.TARGET_PREFERRED}
          losses={outcomes.COMPETITOR_PREFERRED}
          open={outcomes.TIE + outcomes.UNCLEAR}
          notCompared={outcomes.NO_COMPARISON}
          change={tradeDelta ? { wins: tradeDelta.TARGET_PREFERRED?.change ?? 0, losses: tradeDelta.COMPETITOR_PREFERRED?.change ?? 0 } : null}
          href={view("performance") + "&section=Trade%20Offs"}
        />
        <ReputationHeadline
          positive={distribution.POSITIVE ?? 0}
          negative={distribution.NEGATIVE ?? 0}
          mixed={distribution.MIXED ?? 0}
          factual={(distribution.NEUTRAL ?? 0) + (distribution.NO_SENTIMENT ?? 0)}
          href={view("performance") + "&section=Sentiment%20Analysis"}
        />
      </section>

      <div className="grid gap-4 lg:grid-cols-12">
        <Panel
          className="lg:col-span-7"
          // "Names", not "recommends": an answer naming a business counts whatever it said about it.
          title={`Who ${engineLabel} names when buyers ask`}
          hint={`Every business named in the ${eligible} answers to questions that never mentioned ${brand}, tracked or not. An answer naming a business five times counts once.`}
          action={
            <Link href={view("brands")} className="focus-ring shrink-0 rounded text-xs font-medium text-brand-600 hover:underline">
              All competitors →
            </Link>
          }
        >
          <BusinessBars eligible={eligible} />
        </Panel>
        <Panel className="lg:col-span-5" title="Where you are missing" hint={`Answers naming ${brand}, by topic and by the place the question named. ${data.sourceDefinitions.leaders ?? ""}`}>
          <MissingFrom />
        </Panel>
      </div>

      <Section
        id="findings"
        eyebrow="Where the evidence points"
        title="What needs attention"
        note="Each finding is counted from the answers, with a sentence quoted from one of them. Deciding what to publish or change belongs to the next phase."
      >
        <Findings />
      </Section>

      <div className="grid gap-4 lg:grid-cols-12">
        <Panel
          className="lg:col-span-6"
          title="Where the answers come from"
          hint="Each answer once, by whose site it cited."
          action={
            <Link href={view("sources")} className="focus-ring shrink-0 rounded text-xs font-medium text-brand-600 hover:underline">
              All sources →
            </Link>
          }
        >
          <SourcesGlance />
        </Panel>
        <Panel className="lg:col-span-6" title="What changed" hint={data.previous ? `Compared with the measurement of ${formatDate(data.previous.createdAt)}.` : undefined}>
          <WhatChanged data={data} scope={scope} />
          <Coverage />
        </Panel>
      </div>

      {shownEngines.length > 1 && (
        <Panel title={shownEngines.map(engineName).join(" vs ")} hint={`The same figures, one bar per engine. ${brand}'s site and the questions are identical on both.`}>
          <EngineBars engines={shownEngines} />
        </Panel>
      )}

      {provisional && <p className="text-xs text-ink-500">Figures marked “so far” use only the answers collected. {brand} is never counted as absent from an answer that was not collected.</p>}
    </div>
  );
}

function engineNameList(engines: string[]): string {
  return engines.length === 0 ? "ChatGPT" : engines.map(engineName).join(" and ");
}

// --- Charts on this page ------------------------------------------------------------

/**
 * Every business the Discovery answers named, by answers naming it: the target
 * in colour, tracked rivals in grey, untracked businesses lighter. Tracked
 * rivals no answer named are listed under the chart.
 */
function BusinessBars({ eligible }: { eligible: number }) {
  const { data, scope } = useMeasure();
  const standings = businessStandings(data.measure.brands, scope);
  const named = standings.filter((entry) => entry.named > 0);
  const shown = named.slice(0, 8);
  const target = standings.find((entry) => entry.row.relation === "target");
  if (target && !shown.includes(target)) shown.push(target);
  const unnamed = data.measure.brands.filter((row) => row.relation === "confirmed_competitor" && (scope === "combined" ? row.discoveryNamed : (row.namedByEngine[scope]?.named ?? 0)) === 0);
  const rows: BarListRow[] = shown.map(({ row, named: count }) => ({
    key: `${row.relation}:${row.name}`,
    label: row.name,
    badge:
      row.relation === "target" ? (
        <span className="shrink-0 rounded bg-sun-100 px-1.5 py-px text-[10px] font-semibold text-sun-900">you</span>
      ) : row.relation === "confirmed_competitor" ? (
        <span className="shrink-0 rounded border border-ink-200 px-1.5 py-px text-[10px] font-medium text-ink-600">tracked</span>
      ) : undefined,
    value: count,
    total: eligible,
    ids: row.discoveryObservationIds,
    tone: row.relation === "target" ? "target" : row.relation === "confirmed_competitor" ? "rival" : "neutral",
  }));
  const others = named.length - shown.filter((entry) => entry.named > 0).length;
  return (
    <>
      <BarList rows={rows} max={eligible} labelWidth="minmax(0,14rem)" wrapLabels drillTitle={(row) => `Discovery answers naming ${row.label}`} emptyText="No business has been named yet." />
      {(others > 0 || unnamed.length > 0) && (
        <p className="mt-3 border-t border-ink-100 pt-3 text-xs leading-5 text-ink-500">
          {others > 0 ? `${others} more ${others === 1 ? "business was" : "businesses were"} named. ` : ""}
          {unnamed.length > 0 && (
            <>
              <span className="font-medium text-ink-700">Tracked, never named:</span> {unnamed.map((row) => row.name).join(", ")}
            </>
          )}
        </p>
      )}
    </>
  );
}

/**
 * Topics and places side by side, each with the answers naming the target and
 * the business named most there. Counts only: a topic has two or three answers.
 */
function MissingFrom() {
  const { data, scope, brand, onDrill } = useMeasure();
  const measure = data.measure;
  const combined = scope === "combined";
  // Engine-scoped counts come from the question rows; the topic and place rows are pooled.
  const topicRows = measure.byTopic
    .map((topic) => {
      const rows = measure.prompts.filter((row) => row.section === "Discovery" && row.status === "analysable" && (combined || row.engine === scope) && (topic.topicId ? row.topicId === topic.topicId : row.topicName === topic.topicName));
      const ids = rows.filter((row) => row.targetNamed).map((row) => row.observationId).filter((id): id is string => Boolean(id));
      return { key: topic.topicId ?? topic.topicName, label: topic.topicName, present: ids.length, eligible: rows.length, ids, leader: combined ? topic.leaderName : null, leaderCount: combined ? (topic.leaderCount ?? null) : null };
    })
    .filter((row) => row.eligible > 0);
  const placeRows = combined
    ? (measure.byPlace ?? []).filter((row) => row.place).map((row) => ({ key: row.place!, label: row.place!, present: row.targetPresent, eligible: row.eligible, ids: row.targetIds, leader: row.leaderName, leaderCount: row.leaderCount }))
    : [];
  if (topicRows.length === 0 && placeRows.length === 0) return <p className="py-4 text-sm text-ink-500">No Discovery answer has been analysed yet.</p>;
  const group = (title: string, rows: typeof topicRows) =>
    rows.length === 0 ? null : (
      <div>
        <p className="mb-1 text-xs font-semibold uppercase tracking-[0.08em] text-ink-500">{title}</p>
        <ul className="divide-y divide-ink-100">
          {rows.map((row) => (
            <li key={row.key} className="grid grid-cols-[minmax(0,1fr)_auto] items-baseline gap-x-3 py-1.5 text-sm">
              <span className="min-w-0 text-ink-800">{row.label}</span>
              <button
                type="button"
                disabled={row.ids.length === 0}
                onClick={() => onDrill(`Discovery answers naming ${brand}: ${row.label}`, row.ids)}
                className={cn("focus-ring rounded text-right tabular-nums hover:underline disabled:no-underline", row.present === 0 ? "text-danger-600" : "text-ink-900")}
              >
                <b className="font-semibold">{row.present}</b> <span className="text-ink-500">of {row.eligible}</span>
              </button>
              {row.leader && (row.leaderCount ?? 0) > row.present && (
                <span className="col-span-2 text-xs text-ink-500">
                  most named: {row.leader}
                  {row.leaderCount ? ` (${row.leaderCount})` : ""}
                </span>
              )}
            </li>
          ))}
        </ul>
      </div>
    );
  return (
    <div className="space-y-4">
      {group("By topic", topicRows)}
      {group("By place", placeRows)}
    </div>
  );
}

/** Each answer once by whose site it cited, then the five most-cited sites. */
function SourcesGlance() {
  const { data, scope, brand } = useMeasure();
  const sources = data.measure.sources;
  const domains = sources.domains;
  const count = (row: (typeof domains)[number]) => (scope === "combined" ? row.responsesCiting : (row.byEngine[scope] ?? 0));
  const cited = domains.filter((row) => count(row) > 0);
  const mix = sources.answerMix;
  const inScope = (ids: string[]) => (scope === "combined" ? ids : ids.filter((id) => data.measure.prompts.some((row) => row.observationId === id && row.engine === scope)));
  if (cited.length === 0 && (!mix || mix.noSources.length === 0)) return <p className="py-4 text-sm text-ink-500">None of these answers showed the pages they used yet.</p>;
  const kinds = data.sourceKindLabels;
  const top: BarListRow[] = [...cited]
    .sort((a, b) => count(b) - count(a))
    .slice(0, 5)
    .map((row) => ({
      key: row.domain,
      label: row.domain,
      badge: (
        <span className="shrink-0 text-[10px] text-ink-500">
          {row.ownership === "TARGET_OWNED" ? "yours" : row.ownership === "COMPETITOR_OWNED" ? (row.ownerName ?? "rival") : looksLikeOwnSite(row.domain, brand) ? "possibly yours" : (kinds[row.kind] ?? row.kind)}
        </span>
      ),
      value: count(row),
      ids: row.observationIds,
      tone: (row.ownership === "TARGET_OWNED" ? "target" : row.ownership === "COMPETITOR_OWNED" ? "rival" : "neutral") as MarkTone,
    }));
  return (
    <div className="space-y-4">
      {mix && (
        <ShareBar
          height="lg"
          segments={[
            { key: "yours", label: `Cited ${brand}'s site`, count: inScope(mix.yours).length, tone: "target", ids: inScope(mix.yours) },
            { key: "rival", label: "A tracked rival's, not yours", count: inScope(mix.rivalNotYours).length, tone: "rival", ids: inScope(mix.rivalNotYours) },
            { key: "third", label: "Third-party sites only", count: inScope(mix.thirdPartyOnly).length, tone: "neutral", ids: inScope(mix.thirdPartyOnly) },
            { key: "none", label: "No sources", count: inScope(mix.noSources).length, tone: "muted", ids: inScope(mix.noSources) },
          ]}
          drillTitle={(segment) => `Answers that ${segment.label.charAt(0).toLowerCase()}${segment.label.slice(1)}`}
        />
      )}
      {top.length > 0 && (
        <div>
          <p className="mb-1 text-xs text-ink-500">Most-cited sites, by answers citing them</p>
          <BarList rows={top} unit="" labelWidth="minmax(0,11rem)" drillTitle={(row) => `Answers citing ${row.label}`} />
        </div>
      )}
    </div>
  );
}

/** The headline rates per engine, one bar per engine, so a difference between assistants is read in one glance. */
function EngineBars({ engines }: { engines: string[] }) {
  const { data, brand } = useMeasure();
  const measure = data.measure;
  const metricRow = (label: string, key: keyof (typeof measure.metrics)[string]): GroupedRow => ({
    label,
    values: engines.map((engine) => {
      const metric = measure.metrics[engine]?.[key] as MetricValue | undefined;
      return { series: engine, numerator: metric?.numerator ?? 0, denominator: metric?.denominator ?? 0, ids: metric?.numeratorObservationIds ?? [] };
    }),
  });
  const rows: GroupedRow[] = [
    metricRow("Visibility", "discovery_visibility"),
    metricRow("Share of voice", "discovery_share_all_names"),
    metricRow(`${brand} won, when decided`, "tradeoff_target_win_rate"),
    metricRow("Your site cited", "owned_citation_rate"),
  ];
  return <GroupedBars rows={rows} series={engines.map((engine) => ({ key: engine, label: engineName(engine), tone: engineTone(engine) }))} />;
}

// --- Tiles and panels --------------------------------------------------------------

function VerdictHeadline({ wins, losses, open, notCompared, change, href }: { wins: number; losses: number; open: number; notCompared: number; change: { wins: number; losses: number } | null; href: string }) {
  const { brand, provisional, onExplain, data } = useMeasure();
  const asked = wins + losses + open + notCompared;
  const definition = data.definitions.tradeoff_decisiveness;
  return (
    <div className={cn("sun-sheet flex flex-col p-5", provisional && "border-dashed")}>
      <div className="flex items-start justify-between gap-2">
        <p className="text-sm font-medium text-ink-700">
          Head-to-head
          {provisional && <SoFar />}
        </p>
        {definition && (
          <button
            type="button"
            onClick={() => onExplain({ label: "Head-to-head", plain: "How the Trade Off answers comparing you with a named rival were decided. Only the verdict counts: the question names both businesses, so a mention is not evidence.", rows: [["Gave a verdict", definition.denominator], ["Undecided", definition.missingData]] })}
            title="How is this counted?"
            aria-label="How is this counted?"
            className="focus-ring grid h-[18px] w-[18px] shrink-0 place-items-center rounded-full border border-ink-300 text-[10px] font-bold text-ink-500 hover:border-sun-500 hover:bg-sun-100 hover:text-sun-900"
          >
            ?
          </button>
        )}
      </div>
      {asked === 0 ? (
        <EmptyFigure />
      ) : (
        <>
          <div className="mt-3 flex flex-wrap items-baseline gap-x-3 gap-y-1">
            <p className="sun-figure text-[2.5rem] leading-none text-ink-950">
              <span className="text-ok-600">{wins}</span>
              <span className="px-1.5 text-2xl font-normal text-ink-300">–</span>
              <span className="text-danger-600">{losses}</span>
            </p>
            {change && (change.wins !== 0 || change.losses !== 0) && (
              <Chip tone="neutral" className="tabular-nums">
                {change.wins >= 0 ? "+" : ""}
                {change.wins} won · {change.losses >= 0 ? "+" : ""}
                {change.losses} lost
              </Chip>
            )}
          </div>
          <p className="mt-2.5 text-sm leading-5 text-ink-600">
            Won {wins}, lost {losses} of {asked} head-to-head questions
            {open > 0 ? `; ${open} with no clear winner` : ""}
            {notCompared > 0 ? `; ${notCompared} didn’t compare the two` : ""}
          </p>
          <MiniStack parts={[[wins, "bg-ok-500"], [open, "bg-ink-300"], [notCompared, "bg-ink-100"], [losses, "bg-danger-500"]]} />
          <Link href={href} className="focus-ring mt-auto self-start rounded pt-3 text-sm font-medium text-brand-600 hover:underline">
            See the comparisons →
          </Link>
        </>
      )}
      {asked > 0 && wins + losses === 0 && <p className="mt-1 text-xs text-ink-500">No answer picked a side between {brand} and a rival.</p>}
    </div>
  );
}

/**
 * Opinions counted among the answers that gave one. Most by-name answers state
 * facts; "2 of 10 positive" read as a poor reputation when the other eight
 * were neutral facts and only one was negative.
 */
function ReputationHeadline({ positive, negative, mixed, factual, href }: { positive: number; negative: number; mixed: number; factual: number; href: string }) {
  const { provisional, brand } = useMeasure();
  const opinions = positive + negative + mixed;
  const total = opinions + factual;
  return (
    <div className={cn("sun-sheet flex flex-col p-5", provisional && "border-dashed")}>
      <p className="text-sm font-medium text-ink-700">
        Reputation
        {provisional && <SoFar />}
      </p>
      {total === 0 ? (
        <EmptyFigure />
      ) : opinions === 0 ? (
        <>
          <p className="sun-figure mt-3 text-2xl leading-tight text-ink-700">No opinions</p>
          <p className="mt-2.5 text-sm leading-5 text-ink-600">
            All {total} answers about {brand} by name stated facts without an opinion.
          </p>
          <Link href={href} className="focus-ring mt-auto self-start rounded pt-3 text-sm font-medium text-brand-600 hover:underline">
            See how it’s described →
          </Link>
        </>
      ) : (
        <>
          <div className="mt-3 flex flex-wrap items-baseline gap-x-2 gap-y-1">
            <p className="sun-figure text-[2.5rem] leading-none text-ink-950">{positive}</p>
            <span className="text-base text-ink-500">of {opinions} opinions positive</span>
          </div>
          <p className="mt-2.5 text-sm leading-5 text-ink-600">
            {negative} negative, {mixed} mixed; {factual} of {total} answers stated facts without an opinion
          </p>
          <MiniStack parts={[[positive, "bg-ok-500"], [mixed, "bg-warn-500"], [negative, "bg-danger-500"], [factual, "bg-ink-200"]]} />
          <Link href={href} className="focus-ring mt-auto self-start rounded pt-3 text-sm font-medium text-brand-600 hover:underline">
            See how it’s described →
          </Link>
        </>
      )}
    </div>
  );
}

function WhatChanged({ data, scope }: { data: MeasureResponse; scope: string }) {
  const previous = data.previous;
  if (!previous) {
    return <p className="text-sm text-ink-500">This is the first measurement of these questions. Changes appear once a second run is collected on the same questions.</p>;
  }
  const verdict = previous.comparison.comparability;
  if (verdict.level === "break") {
    return (
      <div className="text-sm text-ink-600">
        <p className="font-medium text-ink-900">Not compared with the previous run:</p>
        <ul className="mt-1 list-disc space-y-0.5 pl-5 text-ink-500">
          {verdict.breaks.map((reason) => (
            <li key={reason}>{reason}</li>
          ))}
        </ul>
      </div>
    );
  }
  const deltas = previous.comparison.metrics[scope] ?? {};
  const moved = CHANGE_METRICS.map((key) => deltas[key]).filter((delta): delta is NonNullable<typeof delta> => Boolean(delta && delta.direction && delta.direction !== "flat"));
  return (
    <div className="space-y-3 text-sm">
      {verdict.cautions.length > 0 && (
        <ul className="space-y-0.5 rounded-lg bg-warn-100 px-3 py-2 text-xs leading-5 text-warn-600">
          {verdict.cautions.map((caution) => (
            <li key={caution}>Read with care: {caution}.</li>
          ))}
        </ul>
      )}
      {moved.length === 0 ? (
        <p className="text-ink-500">No headline figure moved between the two runs.</p>
      ) : (
        <ul className="divide-y divide-ink-100">
          {moved.map((delta) => (
            <li key={delta.key} className="grid grid-cols-[minmax(0,1fr)_auto] items-center gap-3 py-2">
              <span className="text-ink-700">{METRIC_SHORT_LABEL[delta.key] ?? delta.key}</span>
              <span className="flex items-center gap-2 tabular-nums text-ink-500">
                <span>
                  {delta.from.numerator} of {delta.from.denominator} → {delta.to.numerator} of {delta.to.denominator}
                </span>
                <Chip tone={delta.withinRange ? "neutral" : delta.direction === "up" ? "ok" : "danger"}>
                  {delta.direction === "up" ? "↑" : "↓"}
                  {delta.points !== null ? ` ${delta.points > 0 ? "+" : ""}${delta.points} pts` : ""}
                  {delta.withinRange ? " · within range" : ""}
                </Chip>
              </span>
            </li>
          ))}
        </ul>
      )}
      <p className="text-xs leading-5 text-ink-500">{data.comparabilityRules.deltas}</p>
    </div>
  );
}

/** What the figures rest on: a line when every answer is in, the breakdown only when some are missing. */
function Coverage() {
  const { data } = useMeasure();
  const coverage = data.measure.coverage;
  const engines = Object.keys(coverage.byEngine);
  const gaps = coverage.notCollected + coverage.awaitingAnalysis + coverage.needsReview;
  return (
    <div className="mt-4 border-t border-ink-100 pt-4">
      <div className="flex items-baseline justify-between text-sm">
        <span className="text-ink-700">
          <b className="font-semibold text-ink-950">{coverage.analysable}</b> of {coverage.planned} planned answers analysed
        </span>
        <span className="text-xs text-ink-500">{data.sampling.label}</span>
      </div>
      <div className="mt-2">
        <Meter value={coverage.analysable} total={coverage.planned} tone="ok" label={`${coverage.analysable} of ${coverage.planned} analysed`} />
      </div>
      {gaps > 0 && (
        <p className="mt-2 text-xs leading-5 text-warn-600">
          {[coverage.notCollected > 0 ? `${coverage.notCollected} not collected` : "", coverage.awaitingAnalysis > 0 ? `${coverage.awaitingAnalysis} awaiting analysis` : "", coverage.needsReview > 0 ? `${coverage.needsReview} need a look` : ""].filter(Boolean).join(", ")}
          . They are left out of every figure, never counted as absence.
        </p>
      )}
      {engines.length > 1 && (
        <p className="mt-1 text-xs tabular-nums text-ink-500">{engines.map((engine) => `${engineName(engine)} ${coverage.byEngine[engine]!.analysable} of ${coverage.byEngine[engine]!.planned}`).join(" · ")}</p>
      )}
      <p className="mt-2 text-xs leading-5 text-ink-500">{data.sampling.caveat}</p>
    </div>
  );
}
