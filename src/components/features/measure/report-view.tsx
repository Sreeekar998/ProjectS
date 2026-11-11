"use client";

// Report: the whole measurement as one document a marketing lead can print
// or save as a PDF and hand on. It is composed from the same result the
// other views read, so every figure here is the figure on the page: the
// headline fractions, what changed against the previous comparable run, the
// engines side by side, the brands, each question with its outcome per
// engine, the sites shaping the answers, the findings with a quoted sentence
// behind each, and the definitions verbatim. Nothing is written by a model.

import { Fragment } from "react";
import Link from "next/link";
import type { MeasureHistoryEntry } from "@/lib/client/api";
import { summariseMeasurement } from "@/lib/measure/summary";
import type { MetricValue, PromptRow } from "@/lib/measure/types";
import type { MetricDelta } from "@/lib/measure/compare";
import type { MetricDefinition } from "@/lib/measure/policy";
import { CHANGE_METRICS, Chip, DeltaChip, METRIC_SHORT_LABEL, Mark, RangeNote, Ring, businessStandings, engineName, formatDate, formatDateTime, fraction, percent, routeName, sectionLabel, themeLabel, useMeasure, coverageBySurface } from "./shared";
import { OutcomeCell, StatusChip } from "./performance-view";

const SECTION_ORDER = ["Discovery", "Trade Offs", "Sentiment Analysis"];

export function ReportView({ projectId, history, view }: { projectId: string; history: MeasureHistoryEntry[] | null; view: (name: string) => string }) {
  const { data, brand, scope, provisional, lowN } = useMeasure();
  const measure = data.measure;
  const metrics = measure.metrics[scope] ?? {};
  const engines = scope === "combined" ? Object.keys(measure.coverage.byEngine) : [scope];
  const allEngines = Object.keys(measure.coverage.byEngine);
  const comparison = data.previous?.comparison ?? null;
  const comparable = Boolean(comparison && comparison.comparability.level !== "break");
  const deltas = comparable ? (comparison!.metrics[scope] ?? {}) : {};
  const outcomes = measure.tradeOffs[scope]?.outcomes ?? { TARGET_PREFERRED: 0, COMPETITOR_PREFERRED: 0, TIE: 0, UNCLEAR: 0, NO_COMPARISON: 0 };
  const distribution = measure.sentiment[scope]?.distribution ?? {};
  const sentences = summariseMeasurement({
    measure,
    brand,
    engineNames: allEngines.map(engineName),
    lowN,
    scope,
    previous: data.previous ? { label: formatDate(data.previous.createdAt), comparison: data.previous.comparison } : null,
  });
  const tracked = measure.brands.filter((row) => row.relation !== "emerging");
  const standings = businessStandings(measure.brands, scope);
  const namedBusinesses = standings.filter((entry) => entry.named > 0);
  const mentions = namedBusinesses.reduce((sum, entry) => sum + entry.named, 0);
  const targetStanding = standings.find((entry) => entry.row.relation === "target");
  const mix = measure.sources.answerMix;
  const rows = measure.prompts.filter((row) => scope === "combined" || row.engine === scope);
  const opportunities = measure.opportunities.filter((row) => row.type !== "coverage_gap");
  const coverage = measure.coverage;
  const lineage = measure.lineage;
  const topSites = measure.sources.domains.slice(0, 12);
  const gap = measure.opportunities.find((row) => row.type === "source_gap");
  const positive = distribution.POSITIVE ?? 0;
  const negative = distribution.NEGATIVE ?? 0;
  const mixed = distribution.MIXED ?? 0;
  const factual = (distribution.NEUTRAL ?? 0) + (distribution.NO_SENTIMENT ?? 0);
  const opinions = positive + mixed + negative;

  return (
    <article className="space-y-10 text-ink-900">
      {/* Cover */}
      <section className="sun-print-keep sun-sheet p-6 sm:p-8">
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div className="min-w-0">
            <p className="sun-eyebrow text-sun-700">AI visibility report</p>
            <h2 className="mt-2 text-3xl font-semibold tracking-[-0.025em] text-ink-950">{brand}</h2>
            <p className="mt-1 text-sm text-ink-500">
              Measured {formatDate(data.run.createdAt)} · {allEngines.map(engineName).join(" and ")}
              {lineage.observerRegions.length > 0 && lineage.observerRegions[0] !== "unknown" ? ` · asked from ${lineage.observerRegions.join(", ")}` : ""}
              {provisional ? " · partial results" : data.run.status === "completed" ? " · complete" : ""}
            </p>
          </div>
          <div className="flex flex-wrap gap-2 print:hidden">
            <button type="button" onClick={() => window.print()} className="focus-ring rounded-lg border border-ink-200 bg-white px-3 py-1.5 text-sm font-medium text-ink-900 shadow-sheet hover:border-ink-300 hover:bg-paper">
              Print or save as PDF
            </button>
            <Link href={view("answers")} className="focus-ring rounded-lg border border-ink-200 bg-white px-3 py-1.5 text-sm font-medium text-ink-900 shadow-sheet hover:border-ink-300 hover:bg-paper">
              Every answer, in full →
            </Link>
          </div>
        </div>
        <dl className="mt-5 grid gap-x-6 gap-y-1.5 text-sm sm:grid-cols-2 lg:grid-cols-3">
          <Meta term="Questions" value={`${measure.prompts.length / Math.max(1, allEngines.length)} approved, prompt set v${lineage.promptSetVersion ?? "?"}`} />
          <Meta term="Competitive set" value={`${tracked.length - 1} tracked rival${tracked.length - 1 === 1 ? "" : "s"}, v${lineage.competitiveSetVersion ?? "?"}`} />
          <Meta term="Coverage" value={`${coverage.analysable} of ${coverage.planned} answers analysable${provisional ? " so far" : ""}`} />
          <Meta term="Collected through" value={[...new Set(lineage.providerExperiences.map(routeName))].join("; ")} />
          <Meta term="Rules" value={`${lineage.analysisVersion} · ${lineage.metricPolicyVersion}`} />
          <Meta term="Generated" value={formatDateTime(Date.now())} />
        </dl>
      </section>

      {/* In one paragraph */}
      <section className="sun-print-keep">
        <Heading eyebrow="Summary" title="In one paragraph" />
        <p className="max-w-3xl border-l-[3px] border-sun-400 pl-4 text-[15px] leading-7 text-ink-800">{sentences.map((sentence) => sentence.text).join(" ")}</p>
      </section>

      {/* Headline figures */}
      <section className="sun-print-keep">
        <Heading eyebrow="Headline figures" title="Where the brand stands" note="Every rate carries its fraction; below five answers only the fraction is shown." />
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          <Figure label="Visibility" metric={metrics.discovery_visibility} lowN={lowN} delta={deltas.discovery_visibility} note={`Discovery answers naming ${brand}`} accent />
          {metrics.discovery_share_all_names ? (
            <Figure label="Share of voice" metric={metrics.discovery_share_all_names} lowN={lowN} delta={deltas.discovery_share_all_names} note={`Of every business mention in Discovery answers, tracked or not (${namedBusinesses.length} businesses named)`} />
          ) : (
            <Figure label="Share of voice (tracked brands)" metric={metrics.discovery_share_of_voice} lowN={lowN} delta={deltas.discovery_share_of_voice} note="Of tracked-brand mentions in Discovery answers" />
          )}
          <Figure label="Ranked first" metric={metrics.first_choice_rate} lowN={lowN} delta={deltas.first_choice_rate} note="Of answers that numbered their options" />
          <CountFigure
            label="Head-to-head"
            value={`${outcomes.TARGET_PREFERRED}–${outcomes.COMPETITOR_PREFERRED}`}
            note={`won – lost${outcomes.TIE + outcomes.UNCLEAR > 0 ? ` · ${outcomes.TIE + outcomes.UNCLEAR} with no clear winner` : ""}${outcomes.NO_COMPARISON > 0 ? ` · ${outcomes.NO_COMPARISON} didn’t compare` : ""}`}
            empty={outcomes.TARGET_PREFERRED + outcomes.COMPETITOR_PREFERRED + outcomes.TIE + outcomes.UNCLEAR + outcomes.NO_COMPARISON === 0}
          />
          <CountFigure
            label="Reputation"
            value={opinions === 0 ? "No opinions" : `${positive} of ${opinions} positive`}
            note={opinions === 0 ? `${factual} answers stated facts` : `${negative} negative, ${mixed} mixed among the opinions · ${factual} answers stated facts`}
            empty={opinions + factual === 0}
          />
          <Figure label="Your site cited" metric={metrics.owned_citation_rate} lowN={lowN} delta={deltas.owned_citation_rate} note="Of answers with usable sources" />
        </div>
        {targetStanding && namedBusinesses.length > 1 && (
          <p className="mt-3 text-sm text-ink-500">
            The Discovery answers named {namedBusinesses.length} businesses; {brand} was named in {targetStanding.named}, and {namedBusinesses.filter((entry) => entry.named > targetStanding.named).length} named more often.
          </p>
        )}
      </section>

      {/* What changed */}
      <section className="sun-print-keep">
        <Heading eyebrow="Change" title="What changed" note={data.previous ? `Compared with the measurement of ${formatDate(data.previous.createdAt)}.` : "The first measurement: nothing to compare yet."} />
        <div className="sun-sheet p-5 text-sm">
          {!data.previous ? (
            <p className="text-ink-500">Collect a second run on the same questions to see what moved. Changes are only ever shown between comparable runs.</p>
          ) : !comparable ? (
            <>
              <p className="font-medium text-ink-900">Not compared with the previous run.</p>
              <ul className="mt-1 list-disc space-y-0.5 pl-5 text-ink-500">
                {comparison!.comparability.breaks.map((reason) => (
                  <li key={reason}>{reason}</li>
                ))}
              </ul>
            </>
          ) : (
            <>
              {comparison!.comparability.cautions.length > 0 && (
                <ul className="mb-3 space-y-0.5 rounded-lg bg-warn-100 px-3 py-2 text-xs leading-5 text-warn-600">
                  {comparison!.comparability.cautions.map((caution) => (
                    <li key={caution}>Read with care: {caution}.</li>
                  ))}
                </ul>
              )}
              <ChangeList deltas={CHANGE_METRICS.map((key) => deltas[key]).filter((delta): delta is MetricDelta => Boolean(delta))} />
            </>
          )}
        </div>
      </section>

      {/* By engine */}
      <section className="sun-print-keep">
        <Heading eyebrow="By engine" title="Each assistant, side by side" note="Discovery figures use only questions that did not name the brand; head-to-heads and reputation use their own sections." />
        <div className="sun-sheet sun-scroll-x">
          <table className="sun-table">
            <thead>
              <tr>
                <th>Engine</th>
                <th>Answers</th>
                <th>Visibility</th>
                <th>Share of voice</th>
                <th>Head-to-head</th>
                <th>Positive / mixed / negative</th>
                <th>Your site cited</th>
              </tr>
            </thead>
            <tbody>
              {allEngines.map((engine) => {
                const own = measure.metrics[engine] ?? {};
                const o = measure.tradeOffs[engine]?.outcomes;
                const d = measure.sentiment[engine]?.distribution ?? {};
                const cov = measure.coverage.byEngine[engine]!;
                return (
                  <tr key={engine} className="tabular-nums">
                    <td className="font-medium text-ink-900">{engineName(engine)}</td>
                    <td className="text-ink-600">
                      {cov.analysable} of {cov.planned}
                    </td>
                    <td>
                      <span className="flex items-center gap-2">
                        <Ring value={own.discovery_visibility?.value ?? null} size={28} />
                        <RateText metric={own.discovery_visibility} lowN={lowN} />
                      </span>
                    </td>
                    <td><RateText metric={own.discovery_share_all_names ?? own.discovery_share_of_voice} lowN={lowN} /></td>
                    <td className="text-ink-700">{o ? `${o.TARGET_PREFERRED}–${o.COMPETITOR_PREFERRED}${o.TIE + o.UNCLEAR > 0 ? ` · ${o.TIE + o.UNCLEAR} open` : ""}` : "—"}</td>
                    <td className="text-ink-700">{`${d.POSITIVE ?? 0} / ${d.MIXED ?? 0} / ${d.NEGATIVE ?? 0}`}</td>
                    <td><RateText metric={own.owned_citation_rate} lowN={lowN} /></td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </section>

      {/* Competitors */}
      <section className="sun-print-keep">
        <Heading
          eyebrow="Competitors"
          title="Who the answers recommended"
          note={`Every business named in the Discovery answers, tracked or not, by answers naming it. ${tracked.length - 1} tracked ${tracked.length - 1 === 1 ? "rival is" : "rivals are"} frozen with the questions; the others were detected in the answers and are in no head-to-head.`}
        />
        <div className="sun-sheet sun-scroll-x">
          <table className="sun-table">
            <thead>
              <tr>
                <th>#</th>
                <th>Business</th>
                <th>Named in discovery</th>
                <th>Share of voice</th>
                <th>Average position</th>
                <th>Head-to-head vs {brand}</th>
              </tr>
            </thead>
            <tbody>
              {standings
                .filter((entry, index) => index < 12 || entry.row.relation === "target")
                .map((entry) => {
                  const row = entry.row;
                  const isTarget = row.relation === "target";
                  return (
                    <tr key={`${row.relation}:${row.name}`} className={`tabular-nums ${isTarget ? "is-target" : ""}`}>
                      <td className="text-ink-500">{entry.named > 0 ? entry.place : "—"}</td>
                      <td>
                        <span className={`flex items-center gap-2 ${isTarget ? "font-semibold text-ink-950" : "text-ink-800"}`}>
                          <Mark name={row.name} tone={isTarget ? "target" : row.relation === "confirmed_competitor" ? "rival" : "neutral"} size="sm" />
                          {row.name}
                          {isTarget ? (
                            <span className="rounded bg-sun-100 px-1.5 py-px text-[10px] font-semibold text-sun-800">you</span>
                          ) : row.relation === "confirmed_competitor" ? (
                            <span className="rounded border border-ink-200 px-1.5 py-px text-[10px] text-ink-600">tracked</span>
                          ) : null}
                        </span>
                      </td>
                      <td className="text-ink-900">
                        {entry.named} <span className="text-ink-500">of {row.discoveryEligible}</span>
                      </td>
                      <td className="text-ink-700">{entry.named > 0 && mentions >= lowN ? percent(entry.named / mentions) : "—"}</td>
                      <td className="text-ink-700">{row.averageRank === null ? "—" : `#${row.averageRank.toFixed(1)} over ${row.rankedCount}`}</td>
                      <td className="text-ink-700">{row.headToHead ? `${row.headToHead.won}–${row.headToHead.lost}${row.headToHead.undecided > 0 ? ` · ${row.headToHead.undecided} undecided` : ""}` : "—"}</td>
                    </tr>
                  );
                })}
            </tbody>
          </table>
        </div>
        {standings.length > 13 && <p className="mt-2 text-xs leading-5 text-ink-500">{standings.length - 13} more businesses were named; the Competitors view lists them all.</p>}
        {tracked.some((row) => row.relation === "confirmed_competitor" && row.discoveryNamed === 0) && (
          <p className="mt-1 text-xs leading-5 text-ink-500">
            <span className="font-medium text-ink-700">Tracked, never named:</span>{" "}
            {tracked
              .filter((row) => row.relation === "confirmed_competitor" && row.discoveryNamed === 0)
              .map((row) => row.name)
              .join(", ")}
            .
          </p>
        )}
      </section>

      {/* Discovery */}
      <section className="sun-print-page">
        <Heading eyebrow="Discovery" title={`When a buyer does not name ${brand}`} note={`${new Set(rows.filter((row) => row.section === "Discovery").map((row) => row.promptCandidateId)).size} questions that name no brand. Named means the answer text named the brand; a rank is shown only when the answer put options in a definite order.`} />
        {measure.byTopic.length > 0 && (
          <div className="mb-4 overflow-x-auto sun-sheet">
            <table className="sun-table">
              <thead>
                <tr>
                  <th>Topic</th>
                  <th>Answers</th>
                  <th>Named {brand}</th>
                  <th>Named most (answers)</th>
                </tr>
              </thead>
              <tbody>
                {measure.byTopic
                  .filter((topic) => topic.eligible > 0)
                  .map((topic) => (
                    <tr key={topic.topicName} className="tabular-nums">
                      <td className="text-ink-800">{topic.topicName}</td>
                      <td className="text-ink-600">{topic.eligible}</td>
                      <td className="text-ink-900">{topic.targetPresent} of {topic.eligible}</td>
                      <td className="text-ink-600">{topic.leaderName ? `${topic.leaderName}${topic.leaderCount ? ` (${topic.leaderCount})` : ""}` : "no other business"}</td>
                    </tr>
                  ))}
              </tbody>
            </table>
          </div>
        )}
        <QuestionTable rows={rows.filter((row) => row.section === "Discovery")} engines={engines} />
      </section>

      {/* Trade Offs */}
      <section className="sun-print-page">
        <Heading eyebrow="Trade Offs" title={`When a buyer compares ${brand} with a rival`} note="Only the verdict counts: the question names both brands, so a mention is not evidence. Ties and unclear answers are never losses." />
        <div className="mb-4 grid gap-3 sm:grid-cols-2">
          <div className="sun-sheet p-4 text-sm">
            <p className="text-xs font-semibold uppercase tracking-wide text-ink-500">Verdicts</p>
            <ul className="mt-2 space-y-1 tabular-nums text-ink-700">
              <li className="flex justify-between"><span>{brand} preferred</span><b className="font-semibold text-ok-600">{outcomes.TARGET_PREFERRED}</b></li>
              <li className="flex justify-between"><span>Rival preferred</span><b className="font-semibold text-danger-600">{outcomes.COMPETITOR_PREFERRED}</b></li>
              <li className="flex justify-between"><span>No clear winner</span><b className="font-semibold text-ink-900">{outcomes.TIE + outcomes.UNCLEAR}</b></li>
              <li className="flex justify-between"><span>Did not compare them</span><b className="font-semibold text-ink-900">{outcomes.NO_COMPARISON}</b></li>
            </ul>
          </div>
          <div className="sun-sheet p-4 text-sm">
            <p className="text-xs font-semibold uppercase tracking-wide text-ink-500">By rival</p>
            <ul className="mt-2 space-y-1 tabular-nums text-ink-700">
              {(measure.tradeOffs[scope]?.byCompetitor ?? []).map((rival) => (
                <li key={rival.name} className="flex justify-between gap-3">
                  <span>{rival.name}</span>
                  <span>
                    <b className="font-semibold text-ok-600">{rival.targetPreferred}</b> won · <b className="font-semibold text-danger-600">{rival.competitorPreferred}</b> lost · {rival.undecided} open
                  </span>
                </li>
              ))}
            </ul>
          </div>
        </div>
        <QuestionTable rows={rows.filter((row) => row.section === "Trade Offs")} engines={engines} />
      </section>

      {/* Reputation */}
      <section className="sun-print-page">
        <Heading eyebrow="Reputation" title={`When a buyer asks about ${brand} by name`} note="How the answer described the brand. A factual answer with no opinion is never counted as positive." />
        <div className="mb-4 grid gap-3 sm:grid-cols-2">
          <div className="sun-sheet p-4 text-sm">
            <p className="text-xs font-semibold uppercase tracking-wide text-ink-500">Portrayal</p>
            <ul className="mt-2 space-y-1 tabular-nums text-ink-700">
              <li className="flex justify-between"><span>Positive</span><b className="font-semibold text-ok-600">{positive}</b></li>
              <li className="flex justify-between"><span>Mixed</span><b className="font-semibold text-warn-600">{mixed}</b></li>
              <li className="flex justify-between"><span>Negative</span><b className="font-semibold text-danger-600">{negative}</b></li>
              <li className="flex justify-between"><span>Factual or neutral</span><b className="font-semibold text-ink-900">{factual}</b></li>
            </ul>
          </div>
          <div className="sun-sheet p-4 text-sm">
            <p className="text-xs font-semibold uppercase tracking-wide text-ink-500">By theme</p>
            {(measure.sentiment[scope]?.aspects ?? []).length === 0 ? (
              <p className="mt-2 text-ink-500">No theme-level evidence in these answers.</p>
            ) : (
              <ul className="mt-2 space-y-1 tabular-nums text-ink-700">
                {(measure.sentiment[scope]?.aspects ?? []).map((aspect) => (
                  <li key={aspect.category} className="flex justify-between gap-3">
                    <span className="first-letter:uppercase">{themeLabel(aspect.category)}</span>
                    <span>
                      {aspect.positive > 0 && <span className="text-ok-600">+{aspect.positive} </span>}
                      {aspect.negative > 0 && <span className="text-danger-600">−{aspect.negative} </span>}
                      {aspect.mixed > 0 && <span className="text-warn-600">±{aspect.mixed}</span>}
                    </span>
                  </li>
                ))}
              </ul>
            )}
          </div>
        </div>
        <QuestionTable rows={rows.filter((row) => row.section === "Sentiment Analysis")} engines={engines} />
      </section>

      {/* Sources */}
      <section className="sun-print-page">
        <Heading eyebrow="Sources" title="Which sites shape the answers" note={data.sourceDefinitions.trustworthy} />
        <div className="mb-4 grid gap-3 sm:grid-cols-3">
          <Figure label="Your site cited" metric={metrics.owned_citation_rate} lowN={lowN} note="Of answers with usable sources" />
          {mix && <CountFigure label="A tracked rival's site, not yours" value={`${mix.rivalNotYours.length} of ${measure.sources.totals.trustworthy}`} note="Answers citing a tracked rival's own site and not yours" empty={measure.sources.totals.trustworthy === 0} />}
          {mix && <CountFigure label="Third-party sites only" value={`${mix.thirdPartyOnly.length} of ${measure.sources.totals.trustworthy}`} note={`${mix.noSources.length} answers showed no sources`} empty={measure.sources.totals.trustworthy === 0} />}
        </div>
        {topSites.length === 0 ? (
          <p className="sun-sheet p-5 text-sm text-ink-500">None of these answers listed the pages they used, or their sources were not captured.</p>
        ) : (
          <div className="sun-sheet sun-scroll-x">
            <table className="sun-table">
              <thead>
                <tr>
                  <th>Site</th>
                  <th>Kind</th>
                  <th>Answers citing</th>
                  <th>Links</th>
                  <th>In discovery answers without you</th>
                </tr>
              </thead>
              <tbody>
                {topSites.map((row) => (
                  <tr key={row.domain} className="tabular-nums">
                    <td className="font-mono text-xs text-ink-800">
                      {row.domain}
                      {row.ownerName && <span className="ml-1.5 font-sans text-[11px] text-ink-500">{row.ownerName}</span>}
                    </td>
                    <td className="text-ink-600">
                      {data.sourceKindLabels[row.kind] ?? row.kind}
                      {row.ownership !== "TARGET_OWNED" && row.ownership !== "COMPETITOR_OWNED" && row.kind !== "other" ? " (guess)" : ""}
                    </td>
                    <td className="text-ink-900">{row.responsesCiting}</td>
                    <td className="text-ink-600">{row.totalCitations}</td>
                    <td className="text-ink-900">{row.discoveryWithoutTarget}</td>
                  </tr>
                ))}
              </tbody>
            </table>
            {measure.sources.domains.length > topSites.length && (
              <p className="border-t border-ink-100 px-4 py-2 text-xs text-ink-500">
                {measure.sources.domains.length - topSites.length} more site{measure.sources.domains.length - topSites.length === 1 ? "" : "s"} in the Sources view.
              </p>
            )}
          </div>
        )}
        {gap && (
          <div className="mt-3 sun-sheet p-4 text-sm">
            <p className="font-medium text-ink-900">Sites shaping answers {brand} is missing from</p>
            <p className="mt-1 text-ink-600">
              {gap.items.map((item) => `${item.label} (${item.count})`).join(", ")}. <span className="text-ink-500">{data.opportunityDefinitions.source_gap?.notEvidenceOf}</span>
            </p>
          </div>
        )}
      </section>

      {/* Findings */}
      <section className="sun-print-page">
        <Heading eyebrow="Findings" title="Where the evidence points" note="Each finding carries its counts and a sentence quoted from an answer behind it. Choosing what to publish or change belongs to the next phase." />
        {opportunities.length === 0 ? (
          <p className="sun-sheet p-5 text-sm text-ink-500">Nothing stands out in this measurement.</p>
        ) : (
          <ol className="space-y-3">
            {opportunities.map((row, index) => (
              <li key={row.id} className="sun-print-keep sun-sheet p-4">
                <div className="flex flex-wrap items-center gap-2">
                  <span className="text-xs font-semibold tabular-nums text-ink-500">{index + 1}.</span>
                  <Chip tone="neutral">{data.opportunityDefinitions[row.type]?.label ?? row.type}</Chip>
                  <Chip tone="neutral" className="tabular-nums">
                    {row.count}
                    {row.outOf !== null ? ` of ${row.outOf}` : ""}
                  </Chip>
                  {row.engines.map((engine) => (
                    <Chip key={engine} tone="neutral">
                      {engineName(engine)}
                    </Chip>
                  ))}
                </div>
                <p className="mt-2 text-sm font-semibold text-ink-900">{row.title}</p>
                <p className="mt-0.5 text-sm leading-6 text-ink-600">{row.detail}</p>
                {row.items.length > 0 && <p className="mt-1 text-xs text-ink-500">{row.items.slice(0, 8).map((item) => `${item.label} ${item.count}`).join(" · ")}</p>}
                {(row.examples ?? []).slice(0, 1).map((example) => (
                  <blockquote key={example.observationId} className="sun-evidence mt-2 py-1.5 pl-3.5 pr-3 text-sm italic leading-6 text-ink-800">
                    “{example.text}”
                  </blockquote>
                ))}
                <p className="mt-2 text-[11px] leading-5 text-ink-500">
                  <span className="font-medium text-ink-600">Not evidence of.</span> {data.opportunityDefinitions[row.type]?.notEvidenceOf}
                </p>
              </li>
            ))}
          </ol>
        )}
      </section>

      {/* Coverage and method */}
      <section className="sun-print-page">
        <Heading eyebrow="Method" title="What was measured, and how" note="Missing answers leave every figure; they are never brand absence." />
        <div className="grid gap-3 sm:grid-cols-2">
          <div className="sun-sheet p-4 text-sm">
            <p className="text-xs font-semibold uppercase tracking-wide text-ink-500">Coverage</p>
            <dl className="mt-2 grid grid-cols-2 gap-x-4 gap-y-1 tabular-nums">
              <Meta term="Planned" value={String(coverage.planned)} />
              <Meta term="Analysable" value={String(coverage.analysable)} />
              <Meta term="Not collected" value={String(coverage.notCollected)} />
              <Meta term="Needs a look" value={String(coverage.needsReview)} />
              <Meta term="Awaiting analysis" value={String(coverage.awaitingAnalysis)} />
              <Meta term="Sources usable" value={String(coverage.sourceCaptureComplete)} />
            </dl>
          </div>
          <div className="sun-sheet p-4 text-sm">
            <p className="text-xs font-semibold uppercase tracking-wide text-ink-500">Where the answers come from</p>
            <ul className="mt-2 space-y-1.5 text-ink-700">
              {coverageBySurface(coverage.byProvider).map((surface) => (
                <li key={surface.key} className="text-xs leading-5">
                  {surface.method} <span className="tabular-nums text-ink-500">({surface.captured} of {surface.planned} collected)</span>
                </li>
              ))}
            </ul>
            <p className="mt-2 text-xs leading-5 text-ink-500">{data.sampling.caveat}</p>
          </div>
        </div>
        <div className="mt-4 sun-sheet p-4">
          <p className="text-xs font-semibold uppercase tracking-wide text-ink-500">Definitions, as counted</p>
          <dl className="mt-2 grid gap-x-6 gap-y-3 text-sm sm:grid-cols-2">
            {(Object.values(data.definitions) as MetricDefinition[])
              // Kept in exports only: both read 100% by construction whenever no tracked rival appears.
              .filter((definition) => definition.key !== "discovery_share_of_voice" && definition.key !== "citation_share")
              .map((definition) => (
              <div key={definition.key} className="sun-print-keep">
                <dt className="font-semibold text-ink-900">{definition.label}</dt>
                <dd className="mt-0.5 text-xs leading-5 text-ink-600">
                  {definition.plain} <span className="text-ink-500">Counted: {definition.event} Out of: {definition.denominator}</span>
                </dd>
              </div>
            ))}
          </dl>
          <p className="mt-3 text-xs leading-5 text-ink-500">
            {data.comparabilityRules.deltas} {data.aggregation.description}
          </p>
        </div>
        {history && history.length > 1 && (
          <p className="mt-3 text-xs text-ink-500">
            {history.length} measurements of this project so far.
          </p>
        )}
        <p className="mt-3 text-[11px] text-ink-500">
          Project Sun · project {projectId.slice(-8)} · run {data.run.id.slice(-8)} · every figure in this report opens the answers behind it in the Measure workspace.
        </p>
      </section>
    </article>
  );
}

// --- Pieces ---------------------------------------------------------------------

function Heading({ eyebrow, title, note }: { eyebrow: string; title: string; note?: string }) {
  return (
    <div className="mb-3">
      <p className="text-xs font-semibold uppercase tracking-[0.14em] text-ink-500">{eyebrow}</p>
      <h3 className="mt-0.5 text-lg font-semibold tracking-[-0.015em] text-ink-950">{title}</h3>
      {note && <p className="mt-0.5 max-w-3xl text-sm text-ink-500">{note}</p>}
    </div>
  );
}

function Meta({ term, value }: { term: string; value: string }) {
  return (
    <div className="flex items-baseline justify-between gap-3 border-b border-ink-100 py-1.5">
      <dt className="shrink-0 text-ink-500">{term}</dt>
      <dd className="text-right font-medium text-ink-900">{value}</dd>
    </div>
  );
}

function RateText({ metric, lowN }: { metric: MetricValue | undefined; lowN: number }) {
  if (!metric || metric.denominator === 0) return <span className="text-ink-300">—</span>;
  return (
    <span className="text-ink-900">
      {metric.numerator} <span className="text-ink-500">of {metric.denominator}</span>
      {metric.denominator >= lowN && <span className="ml-1 text-xs text-ink-500">({percent(metric.value)})</span>}
    </span>
  );
}

function Figure({ label, metric, lowN, delta, note, accent = false, caveat }: { label: string; metric: MetricValue | undefined; lowN: number; delta?: MetricDelta | null; note: string; accent?: boolean; caveat?: string | null }) {
  const empty = !metric || metric.denominator === 0;
  const lowSample = !empty && metric!.denominator < lowN;
  // A figure that cannot be read as a comparison says so in place of the number.
  const incomparable = !empty && Boolean(caveat);
  return (
    <div className={`sun-print-keep rounded-2xl border bg-white p-4 shadow-sheet ${accent ? "border-sun-300 bg-gradient-to-b from-sun-50 to-white" : "border-ink-200/75"}`}>
      <p className="text-xs font-medium text-ink-500">{label}</p>
      <div className="mt-1.5 flex flex-wrap items-baseline gap-x-2 gap-y-1">
        <p className={`sun-figure ${incomparable ? "text-lg text-ink-700" : "text-2xl"} ${empty ? "text-ink-300" : incomparable ? "" : accent ? "text-sun-800" : "text-ink-950"}`}>
          {empty ? "—" : incomparable ? "Not comparable" : lowSample ? fraction(metric) : percent(metric!.value)}
        </p>
        {!empty && !lowSample && !incomparable && <span className="text-xs tabular-nums text-ink-500">{fraction(metric)}</span>}
        {!incomparable && <DeltaChip delta={delta} />}
      </div>
      <p className="mt-1 text-xs leading-5 text-ink-500">{empty ? "No answers to count yet." : incomparable ? caveat : note}{lowSample && !incomparable ? " (small sample)" : ""}</p>
      {!empty && !lowSample && !incomparable && (
        <p className="text-xs text-ink-500">
          <RangeNote metric={metric} />
        </p>
      )}
    </div>
  );
}

function CountFigure({ label, value, note, empty }: { label: string; value: string; note: string; empty: boolean }) {
  return (
    <div className="sun-print-keep sun-sheet p-4">
      <p className="text-xs font-medium text-ink-500">{label}</p>
      <p className={`sun-figure mt-1.5 text-2xl ${empty ? "text-ink-300" : "text-ink-950"}`}>{empty ? "—" : value}</p>
      <p className="mt-1 text-xs leading-5 text-ink-500">{empty ? "No answers to count yet." : note}</p>
    </div>
  );
}

function ChangeList({ deltas }: { deltas: MetricDelta[] }) {
  const moved = deltas.filter((delta) => delta.direction && delta.direction !== "flat" && (delta.points !== null || delta.countsOnly));
  if (moved.length === 0) return <p className="text-ink-500">No figure moved between the two runs.</p>;
  return (
    <ul className="divide-y divide-ink-100">
      {moved.map((delta) => (
        <li key={delta.key} className="flex items-center justify-between gap-3 py-2">
          <span className="text-ink-700">{METRIC_SHORT_LABEL[delta.key] ?? delta.key}</span>
          <span className="flex items-center gap-2 tabular-nums text-ink-500">
            <span>
              {delta.from.numerator} of {delta.from.denominator} → {delta.to.numerator} of {delta.to.denominator}
            </span>
            <DeltaChip delta={delta} />
          </span>
        </li>
      ))}
    </ul>
  );
}

/** Every question of a section once, one column per engine, the outcome in each cell. */
function QuestionTable({ rows, engines }: { rows: PromptRow[]; engines: string[] }) {
  const questions = new Map<string, { text: string; topic: string | null; byEngine: Record<string, PromptRow> }>();
  for (const row of rows) {
    const entry = questions.get(row.promptCandidateId) ?? { text: row.text, topic: row.topicName, byEngine: {} };
    entry.byEngine[row.engine] = row;
    questions.set(row.promptCandidateId, entry);
  }
  const ordered = [...questions.values()].sort((a, b) => a.text.localeCompare(b.text));
  if (ordered.length === 0) return <p className="sun-sheet p-5 text-sm text-ink-500">No questions in this section.</p>;
  return (
    <div className="sun-sheet sun-scroll-x">
      <table className="sun-table">
        <thead>
          <tr>
            <th>Question</th>
            {engines.map((engine) => (
              <th key={engine} className="px-4 py-2.5 font-semibold">
                {engineName(engine)}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {ordered.map((question, index) => (
            <Fragment key={index}>
              <tr className="sun-print-keep align-top">
                <td className="max-w-md py-2">
                  <span className="text-ink-900">{question.text}</span>
                  {question.topic && <span className="ml-2 text-[11px] text-ink-500">{question.topic}</span>}
                </td>
                {engines.map((engine) => {
                  const row = question.byEngine[engine];
                  if (!row) return <td key={engine} className="px-4 py-2 text-xs text-ink-300">not planned</td>;
                  return (
                    <td key={engine} className="px-4 py-2">
                      {row.status === "analysable" ? <OutcomeCell row={row} /> : <StatusChip status={row.status} />}
                    </td>
                  );
                })}
              </tr>
            </Fragment>
          ))}
        </tbody>
      </table>
      <p className="border-t border-ink-100 px-4 py-2 text-[11px] text-ink-500">Sections never blend: {SECTION_ORDER.map(sectionLabel).join(", ")} each answer their own question.</p>
    </div>
  );
}
