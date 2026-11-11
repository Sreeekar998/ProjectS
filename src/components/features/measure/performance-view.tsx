"use client";

// Questions (URL key "performance"): every answer at a glance as one cell per
// question and engine, the section's own figures, then one row per question ×
// engine with every fact the analysis established about the answer.

import { useMemo, useState } from "react";
import { SegmentedControl, Select } from "@/components/ui/primitives";
import type { PromptRow, TradeOffOutcome } from "@/lib/measure/types";
import { OutcomeStrip } from "./charts";
import { Chip, MetricRow, MiniStat, Panel, StackedBar, engineName, sectionLabel, themeLabel, useMeasure } from "./shared";

type SectionFilter = "all" | "Discovery" | "Trade Offs" | "Sentiment Analysis";
type OutcomeFilter = "all" | "named" | "not_named" | "no_brand" | "first" | "won" | "lost" | "undecided" | "positive" | "mixed_negative" | "factual" | "gap";
type CitedFilter = "all" | "mine" | "not_mine" | "rival" | "none";

const STATUS_LABEL: Record<PromptRow["status"], string> = {
  analysable: "Analysed",
  needs_review: "Needs a look",
  not_collected: "Not collected",
  awaiting_analysis: "Awaiting analysis",
};

const VERDICT_LABEL: Record<TradeOffOutcome, string> = {
  TARGET_PREFERRED: "You preferred",
  COMPETITOR_PREFERRED: "Rival preferred",
  TIE: "No clear winner",
  UNCLEAR: "Verdict unclear",
  NO_COMPARISON: "Didn’t compare",
};

const PORTRAYAL_LABEL: Record<string, string> = {
  POSITIVE: "Positive",
  MIXED: "Mixed",
  NEGATIVE: "Negative",
  NEUTRAL: "Neutral",
  NO_SENTIMENT: "Factual, no opinion",
};

function outcomeMatches(row: PromptRow, filter: OutcomeFilter): boolean {
  if (filter === "all") return true;
  if (filter === "gap") return row.status !== "analysable";
  if (row.status !== "analysable") return false;
  switch (filter) {
    case "named":
      return row.targetNamed === true;
    // Untracked businesses count: an answer listing six untracked salons named
    // others, not nobody (measure-policy@4).
    case "not_named":
      return row.targetNamed === false && row.brandsNamed.length + row.untrackedNamed.length > 0;
    case "no_brand":
      return row.targetNamed === false && row.brandsNamed.length + row.untrackedNamed.length === 0;
    case "first":
      return row.targetRank === 1;
    case "won":
      return row.verdict === "TARGET_PREFERRED";
    case "lost":
      return row.verdict === "COMPETITOR_PREFERRED";
    case "undecided":
      return row.verdict === "TIE" || row.verdict === "UNCLEAR";
    case "positive":
      return row.portrayal === "POSITIVE";
    case "mixed_negative":
      return row.portrayal === "MIXED" || row.portrayal === "NEGATIVE";
    case "factual":
      return row.portrayal === "NO_SENTIMENT" || row.portrayal === "NEUTRAL";
  }
}

function citedMatches(row: PromptRow, filter: CitedFilter): boolean {
  if (filter === "all") return true;
  if (filter === "none") return row.status === "analysable" && row.sourceState === "none_present";
  if (row.ownedCited === null) return false;
  if (filter === "mine") return row.ownedCited;
  if (filter === "not_mine") return !row.ownedCited && row.sourceCount > 0;
  return row.rivalCited === true;
}

export function PerformanceView({ initialSection }: { initialSection?: string | null }) {
  const { data, brand, scope, onDrill } = useMeasure();
  const measure = data.measure;
  const defs = data.definitions;
  const metrics = measure.metrics[scope] ?? {};
  const [section, setSection] = useState<SectionFilter>((["Discovery", "Trade Offs", "Sentiment Analysis"].includes(initialSection ?? "") ? initialSection : "all") as SectionFilter);
  const [topic, setTopic] = useState("all");
  const [outcome, setOutcome] = useState<OutcomeFilter>("all");
  const [cited, setCited] = useState<CitedFilter>("all");
  const [query, setQuery] = useState("");

  const topics = useMemo(() => [...new Set(measure.prompts.map((row) => row.topicName).filter((name): name is string => Boolean(name)))].sort(), [measure.prompts]);
  const rows = useMemo(
    () =>
      measure.prompts.filter(
        (row) =>
          (scope === "combined" || row.engine === scope) &&
          (section === "all" || row.section === section) &&
          (topic === "all" || row.topicName === topic) &&
          outcomeMatches(row, outcome) &&
          citedMatches(row, cited) &&
          (query.trim() === "" || row.text.toLowerCase().includes(query.trim().toLowerCase())),
      ),
    [measure.prompts, scope, section, topic, outcome, cited, query],
  );
  const outcomes = measure.tradeOffs[scope]?.outcomes ?? { TARGET_PREFERRED: 0, COMPETITOR_PREFERRED: 0, TIE: 0, UNCLEAR: 0, NO_COMPARISON: 0 };
  const distribution = measure.sentiment[scope]?.distribution ?? {};
  const outcomeOptions: Array<[OutcomeFilter, string]> =
    section === "Discovery"
      ? [["all", "Any outcome"], ["named", `${brand} named`], ["not_named", "Others named, not you"], ["no_brand", "No business named"], ["first", `${brand} ranked first`], ["gap", "Not usable"]]
      : section === "Trade Offs"
        ? [["all", "Any verdict"], ["won", "You preferred"], ["lost", "Rival preferred"], ["undecided", "No clear winner"], ["gap", "Not usable"]]
        : section === "Sentiment Analysis"
          ? [["all", "Any portrayal"], ["positive", "Positive"], ["mixed_negative", "Mixed or negative"], ["factual", "Factual or neutral"], ["gap", "Not usable"]]
          : [["all", "Any outcome"], ["named", `${brand} named`], ["won", "You preferred"], ["lost", "Rival preferred"], ["mixed_negative", "Mixed or negative"], ["gap", "Not usable"]];

  return (
    <div className="space-y-6">
      <SegmentedControl
        label="Question type"
        value={section}
        onChange={(key) => {
          setSection(key);
          setOutcome("all");
        }}
        options={(["all", "Discovery", "Trade Offs", "Sentiment Analysis"] as SectionFilter[]).map((key) => ({
          value: key,
          label: key === "all" ? "All questions" : sectionLabel(key),
          count: measure.prompts.filter((row) => (scope === "combined" || row.engine === scope) && (key === "all" || row.section === key)).length,
        }))}
      />

      <Panel
        title={section === "all" ? "Every answer at a glance" : `${sectionLabel(section)}: every answer at a glance`}
        hint="One cell per answer, grouped by the question it answers. A cell opens that answer as the site showed it, with its sources."
      >
        <OutcomeStrip rows={measure.prompts.filter((row) => (section === "all" || row.section === section) && (scope === "combined" || row.engine === scope))} engines={scope === "combined" ? Object.keys(measure.coverage.byEngine) : [scope]} />
      </Panel>

      {section === "Discovery" && (
        <Panel title={`When a buyer doesn’t name ${brand}`} hint="An answer naming a business five times counts once. Every business named is listed under Competitors.">
          <div className="grid gap-x-8 sm:grid-cols-3">
            <MetricRow label={`${brand} named`} metric={metrics.discovery_visibility} definition={defs.discovery_visibility} />
            <MetricRow label={`${brand} ranked first`} metric={metrics.first_choice_rate} definition={defs.first_choice_rate} />
            <MetricRow label="Named no business at all" metric={metrics.answer_brand_free_rate} definition={defs.answer_brand_free_rate} />
          </div>
        </Panel>
      )}
      {section === "Trade Offs" && (
        <div className="grid gap-4 lg:grid-cols-12">
          <Panel className="lg:col-span-5" title="Verdicts" hint={`These questions name ${brand}, so only the verdict counts here, not the mention.`}>
            <StackedBar
              segments={[
                { key: "TARGET_PREFERRED", label: `${brand} preferred`, count: outcomes.TARGET_PREFERRED, tone: "bg-ok-500" },
                { key: "TIE", label: "No clear winner", count: outcomes.TIE, tone: "bg-ink-300" },
                { key: "UNCLEAR", label: "Verdict unclear", count: outcomes.UNCLEAR, tone: "bg-ink-400" },
                { key: "COMPETITOR_PREFERRED", label: "Rival preferred", count: outcomes.COMPETITOR_PREFERRED, tone: "bg-danger-500" },
                { key: "NO_COMPARISON", label: "Didn’t compare them", count: outcomes.NO_COMPARISON, tone: "bg-ink-200" },
              ]}
              idsFor={(key) => measure.tradeOffs[scope]?.observationIdsByOutcome?.[key as TradeOffOutcome] ?? []}
            />
            <div className="mt-4 grid grid-cols-2 gap-3 border-t border-ink-100 pt-4">
              <MiniStat label="Gave a verdict" metric={metrics.tradeoff_decisiveness} definition={defs.tradeoff_decisiveness} />
              <MiniStat label={`${brand} won, when decided`} metric={metrics.tradeoff_target_win_rate} definition={defs.tradeoff_target_win_rate} />
            </div>
          </Panel>
          <Panel className="lg:col-span-7" title="By rival" hint="Only comparisons involving you count. Each pairing has a handful of answers, so these are counts.">
            <RivalList />
          </Panel>
        </div>
      )}
      {section === "Sentiment Analysis" && (
        <div className="grid gap-4 lg:grid-cols-12">
          <Panel className="lg:col-span-5" title="How the answers describe it" hint="Factual answers with no opinion are never counted as positive, and are shown apart from the opinions.">
            <StackedBar
              segments={[
                { key: "POSITIVE", label: "Positive", count: distribution.POSITIVE ?? 0, tone: "bg-ok-500" },
                { key: "MIXED", label: "Mixed", count: distribution.MIXED ?? 0, tone: "bg-warn-500" },
                { key: "NEGATIVE", label: "Negative", count: distribution.NEGATIVE ?? 0, tone: "bg-danger-500" },
                { key: "NEUTRAL", label: "Neutral", count: distribution.NEUTRAL ?? 0, tone: "bg-ink-300" },
                { key: "NO_SENTIMENT", label: "Factual, no opinion", count: distribution.NO_SENTIMENT ?? 0, tone: "bg-ink-200" },
              ]}
              idsFor={(key) => measure.sentiment[scope]?.observationIdsByPolarity?.[key] ?? []}
            />
          </Panel>
          <Panel className="lg:col-span-7" title="By theme" hint="Only themes the answers actually discussed.">
            <ThemeList />
          </Panel>
        </div>
      )}

      <Panel
        title={`${rows.length} of ${measure.prompts.length} question${measure.prompts.length === 1 ? "" : "s"}`}
        hint="One row per question and engine. Every row opens the answer."
        action={
          <input
            type="search"
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder="Search questions"
            aria-label="Search questions"
            className="focus-ring h-9 w-full rounded-lg border border-ink-200 bg-white px-3 text-sm text-ink-900 shadow-sheet placeholder:text-ink-400 hover:border-ink-300 sm:w-52"
          />
        }
      >
        <div className="mb-4 grid gap-2 sm:grid-cols-3">
          <Select aria-label="Topic" value={topic} onChange={(event) => setTopic(event.target.value)}>
            <option value="all">Every topic</option>
            {topics.map((name) => (
              <option key={name} value={name}>
                {name}
              </option>
            ))}
          </Select>
          <Select aria-label="Outcome" value={outcome} onChange={(event) => setOutcome(event.target.value as OutcomeFilter)}>
            {outcomeOptions.map(([key, label]) => (
              <option key={key} value={key}>
                {label}
              </option>
            ))}
          </Select>
          <Select aria-label="Sources" value={cited} onChange={(event) => setCited(event.target.value as CitedFilter)}>
            <option value="all">Any sources</option>
            <option value="mine">Cited your site</option>
            <option value="not_mine">Showed sources, none yours</option>
            <option value="rival">Cited a rival’s site</option>
            <option value="none">Showed no sources</option>
          </Select>
        </div>

        {rows.length === 0 ? (
          <p className="py-6 text-center text-sm text-ink-500">No questions match these filters.</p>
        ) : (
          <>
            <div className="sun-scroll-x hidden sm:block">
              <table className="sun-table">
                <thead>
                  <tr>
                    <th>Question</th>
                    <th>Engine</th>
                    <th>Outcome</th>
                    <th>Brands named</th>
                    <th>Sources</th>
                    <th>Status</th>
                  </tr>
                </thead>
                <tbody>
                  {rows.map((row) => (
                    <tr key={`${row.promptCandidateId}:${row.route}`} className="align-top hover:bg-paper">
                      <td className="max-w-md pr-3">
                        <button
                          type="button"
                          disabled={!row.observationId}
                          onClick={() => row.observationId && onDrill(row.text, [row.observationId])}
                          className="focus-ring rounded text-left text-ink-950 hover:underline disabled:cursor-default disabled:no-underline"
                        >
                          {row.text}
                        </button>
                        <p className="mt-0.5 text-[11px] text-ink-500">
                          {sectionLabel(row.section)}
                          {row.topicName ? ` · ${row.topicName}` : ""}
                        </p>
                      </td>
                      <td className="whitespace-nowrap text-ink-700">{engineName(row.engine)}</td>
                      <td className="pr-3">
                        <OutcomeCell row={row} />
                      </td>
                      <td className="pr-3">
                        <BrandsCell row={row} />
                      </td>
                      <td className="whitespace-nowrap pr-3">
                        <SourcesCell row={row} />
                      </td>
                      <td className="whitespace-nowrap py-2.5">
                        <StatusChip status={row.status} />
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <ul className="space-y-2 sm:hidden">
              {rows.map((row) => (
                <li key={`${row.promptCandidateId}:${row.route}`} className="rounded-xl border border-ink-200/75 bg-white p-3 shadow-sheet">
                  <button type="button" disabled={!row.observationId} onClick={() => row.observationId && onDrill(row.text, [row.observationId])} className="focus-ring rounded text-left text-sm font-medium text-ink-950">
                    {row.text}
                  </button>
                  <p className="mt-0.5 text-[11px] text-ink-500">
                    {engineName(row.engine)} · {sectionLabel(row.section)}
                    {row.topicName ? ` · ${row.topicName}` : ""}
                  </p>
                  <div className="mt-2 flex flex-wrap items-center gap-2 text-xs">
                    <OutcomeCell row={row} />
                    <StatusChip status={row.status} />
                  </div>
                  <div className="mt-2 flex flex-wrap items-center gap-2 text-xs">
                    <BrandsCell row={row} />
                    <SourcesCell row={row} />
                  </div>
                </li>
              ))}
            </ul>
          </>
        )}
      </Panel>
    </div>
  );
}

export function StatusChip({ status }: { status: PromptRow["status"] }) {
  const tone = status === "analysable" ? "ok" : status === "not_collected" ? "neutral" : "warn";
  return <Chip tone={tone}>{STATUS_LABEL[status]}</Chip>;
}

export function OutcomeCell({ row }: { row: PromptRow }) {
  const { brand } = useMeasure();
  if (row.status !== "analysable") return <span className="text-xs text-ink-500">—</span>;
  if (row.section === "Discovery") {
    if (row.targetNamed) {
      return (
        <span className="flex flex-wrap items-center gap-1">
          <Chip tone="sun">{brand} named</Chip>
          {row.targetRank !== null && <Chip tone={row.targetRank === 1 ? "ok" : "neutral"}>#{row.targetRank}</Chip>}
          {row.targetRole === "RECOMMENDED" && row.targetRank === null && <Chip tone="ok">recommended</Chip>}
        </span>
      );
    }
    if (row.brandsNamed.length === 0 && row.untrackedNamed.length === 0) return <Chip tone="neutral">No business named</Chip>;
    return (
      <span className="flex flex-wrap items-center gap-1">
        <Chip tone="danger">Not named</Chip>
        {row.firstChoiceName && <span className="text-xs text-ink-500">#1 {row.firstChoiceName}</span>}
      </span>
    );
  }
  if (row.section === "Trade Offs") {
    const tone = row.verdict === "TARGET_PREFERRED" ? "ok" : row.verdict === "COMPETITOR_PREFERRED" ? "danger" : "neutral";
    return (
      <span className="flex flex-wrap items-center gap-1">
        <Chip tone={tone}>{row.verdict ? VERDICT_LABEL[row.verdict] : "—"}</Chip>
        {row.rivalName && <span className="text-xs text-ink-500">vs {row.rivalName}</span>}
        {row.aspects.length > 0 && <span className="text-xs text-ink-500">on {row.aspects.join(", ")}</span>}
      </span>
    );
  }
  const tone = row.portrayal === "POSITIVE" ? "ok" : row.portrayal === "NEGATIVE" ? "danger" : row.portrayal === "MIXED" ? "warn" : "neutral";
  return (
    <span className="flex flex-wrap items-center gap-1">
      <Chip tone={tone}>{row.portrayal ? (PORTRAYAL_LABEL[row.portrayal] ?? row.portrayal) : "—"}</Chip>
      {row.themes.length > 0 && <span className="text-xs text-ink-500">{[...new Set(row.themes.map((theme) => themeLabel(theme.category)))].join(", ")}</span>}
    </span>
  );
}

function BrandsCell({ row }: { row: PromptRow }) {
  const { brand } = useMeasure();
  if (row.status !== "analysable") return <span className="text-xs text-ink-500">—</span>;
  const names = [...row.brandsNamed, ...row.untrackedNamed.map((name) => `${name}*`)];
  if (names.length === 0) return <span className="text-xs text-ink-500">none</span>;
  return (
    <span className="flex flex-wrap gap-1">
      {names.map((name) => (
        <span key={name} className={`rounded px-1.5 py-px text-[11px] ${name === brand ? "bg-sun-100 font-semibold text-sun-900" : name.endsWith("*") ? "border border-dashed border-ink-300 text-ink-600" : "bg-ink-100 text-ink-700"}`} title={name.endsWith("*") ? "Not tracked" : undefined}>
          {name}
        </span>
      ))}
    </span>
  );
}

function SourcesCell({ row }: { row: PromptRow }) {
  if (row.status === "not_collected") return <span className="text-xs text-ink-500">—</span>;
  if (row.sourceState === "none_present") return <span className="text-xs text-ink-500">none shown</span>;
  if (row.sourceState !== "complete") return <span className="text-xs text-ink-500">not captured</span>;
  return (
    <span className="flex items-center gap-1 text-xs text-ink-600">
      <span className="tabular-nums">{row.sourceCount}</span>
      {row.ownedCited && <Chip tone="sun">yours</Chip>}
      {row.rivalCited && <Chip tone="neutral">rival</Chip>}
    </span>
  );
}

function RivalList() {
  const { data, scope, brand, onDrill } = useMeasure();
  const rows = data.measure.tradeOffs[scope]?.byCompetitor ?? [];
  if (rows.length === 0) return <p className="py-4 text-sm text-ink-500">No comparisons collected yet.</p>;
  return (
    <ul className="divide-y divide-ink-100">
      {rows.map((row) => {
        const total = Math.max(1, row.targetPreferred + row.competitorPreferred + row.undecided);
        return (
          <li key={row.name}>
            <button
              type="button"
              onClick={() => onDrill(`${brand} vs ${row.name}`, row.observationIds)}
              className="focus-ring grid w-full grid-cols-[minmax(0,7.5rem)_1fr] items-center gap-x-3 gap-y-1 rounded-lg px-2 py-2.5 text-left hover:bg-paper sm:grid-cols-[minmax(0,7.5rem)_1fr_auto]"
            >
              <span className="truncate text-sm font-medium text-ink-800">{row.name}</span>
              <span className="flex h-2.5 overflow-hidden rounded-full bg-ink-100">
                <span className="h-full bg-ok-500" style={{ width: `${(row.targetPreferred / total) * 100}%` }} />
                <span className="h-full bg-ink-300" style={{ width: `${(row.undecided / total) * 100}%` }} />
                <span className="h-full bg-danger-500" style={{ width: `${(row.competitorPreferred / total) * 100}%` }} />
              </span>
              <span className="col-span-2 text-xs tabular-nums text-ink-500 sm:col-span-1">
                <b className="font-semibold text-ok-600">{row.targetPreferred}</b> won · <b className="font-semibold text-danger-600">{row.competitorPreferred}</b> lost · {row.undecided} open
              </span>
            </button>
          </li>
        );
      })}
    </ul>
  );
}

function ThemeList() {
  const { data, scope, onDrill } = useMeasure();
  const rows = data.measure.sentiment[scope]?.aspects ?? [];
  if (rows.length === 0) return <p className="py-4 text-sm text-ink-500">No theme-level evidence in these answers yet.</p>;
  return (
    <ul className="divide-y divide-ink-100">
      {rows.map((row) => (
        <li key={row.category}>
          <button type="button" onClick={() => onDrill(`Theme: ${themeLabel(row.category)}`, row.observationIds)} className="focus-ring flex w-full items-center justify-between gap-3 rounded-lg px-2 py-2.5 text-left hover:bg-paper">
            <span className="text-sm first-letter:uppercase text-ink-800">{themeLabel(row.category)}</span>
            <span className="flex gap-1.5 text-xs tabular-nums">
              {row.positive > 0 && <span className="rounded-full bg-ok-100 px-2 py-0.5 font-medium text-ok-600">+{row.positive}</span>}
              {row.negative > 0 && <span className="rounded-full bg-danger-100 px-2 py-0.5 font-medium text-danger-600">−{row.negative}</span>}
              {row.mixed > 0 && <span className="rounded-full bg-warn-100 px-2 py-0.5 font-medium text-warn-600">±{row.mixed}</span>}
            </span>
          </button>
        </li>
      ))}
    </ul>
  );
}
