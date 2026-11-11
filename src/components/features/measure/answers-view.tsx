"use client";

// Answers: every question with the answer each engine gave, in full, as the
// site showed it, with the linked brands highlighted and every source
// labelled by owner. This is the evidence behind every figure, readable
// offline: print it or save it as a PDF. Filters and the print button are
// hidden when printing.

import { useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { api, ApiError, type MeasureAnswer } from "@/lib/client/api";
import { SegmentedControl, Spinner } from "@/components/ui/primitives";
import type { PromptRow } from "@/lib/measure/types";
import { AnswerText, SourceList } from "./answer";
import { Chip, HighlightLegend, Panel, engineName, formatDateTime, registrableDomainOf, routeName, sectionLabel, useMeasure } from "./shared";
import { OutcomeCell, StatusChip } from "./performance-view";

type SectionFilter = "all" | "Discovery" | "Trade Offs" | "Sentiment Analysis";
const SECTION_ORDER = ["Discovery", "Trade Offs", "Sentiment Analysis"];

export function AnswersView({ projectId, reportHref }: { projectId: string; reportHref: string }) {
  const { data, brand, scope } = useMeasure();
  const measure = data.measure;
  const [answers, setAnswers] = useState<MeasureAnswer[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [section, setSection] = useState<SectionFilter>("all");
  const [query, setQuery] = useState("");

  useEffect(() => {
    let cancelled = false;
    setAnswers(null);
    setError(null);
    api
      .getMeasureAnswers(projectId, data.run.id)
      .then((result) => {
        if (!cancelled) setAnswers(result.answers);
      })
      .catch((err) => {
        if (!cancelled) setError(err instanceof ApiError ? err.message : "The answers could not be loaded. Try again.");
      });
    return () => {
      cancelled = true;
    };
  }, [projectId, data.run.id]);

  const engines = useMemo(() => (scope === "combined" ? Object.keys(measure.coverage.byEngine) : [scope]), [scope, measure.coverage.byEngine]);
  const byObservation = useMemo(() => new Map((answers ?? []).map((answer) => [answer.observationId, answer])), [answers]);

  // One block per question, in the section order of the workspace, each
  // engine's row beside it; the prompt rows carry the outcome, the answers
  // carry the text.
  const questions = useMemo(() => {
    const map = new Map<string, { id: string; text: string; section: string | null; topic: string | null; rows: PromptRow[] }>();
    for (const row of measure.prompts) {
      if (!engines.includes(row.engine)) continue;
      const entry = map.get(row.promptCandidateId) ?? { id: row.promptCandidateId, text: row.text, section: row.section, topic: row.topicName, rows: [] };
      entry.rows.push(row);
      map.set(row.promptCandidateId, entry);
    }
    return [...map.values()]
      .filter((question) => (section === "all" || question.section === section) && (query.trim() === "" || question.text.toLowerCase().includes(query.trim().toLowerCase())))
      .sort((a, b) => SECTION_ORDER.indexOf(a.section ?? "") - SECTION_ORDER.indexOf(b.section ?? "") || a.text.localeCompare(b.text));
  }, [measure.prompts, engines, section, query]);

  // Back goes to wherever the reader came from (the Report, the Export menu on
  // any tab); the report only when there is no history.
  const router = useRouter();
  const collected = questions.reduce((total, question) => total + question.rows.filter((row) => row.observationId).length, 0);

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <p className="text-xs font-semibold uppercase tracking-[0.14em] text-ink-500">
            Every answer
            <button
              type="button"
              onClick={() => (window.history.length > 1 ? router.back() : router.push(reportHref))}
              className="focus-ring ml-3 rounded font-medium normal-case tracking-normal text-brand-600 hover:underline print:hidden"
            >
              ← Back
            </button>
          </p>
          <h2 className="mt-1 text-xl font-semibold tracking-[-0.015em] text-ink-950">What {engines.map(engineName).join(" and ")} actually said</h2>
          <p className="mt-1 max-w-2xl text-sm text-ink-500">
            {questions.length} question{questions.length === 1 ? "" : "s"} · {collected} answer{collected === 1 ? "" : "s"} collected. Each answer is shown as the site showed it, with the names the analysis linked highlighted and every source labelled by owner.
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2 print:hidden">
          <SegmentedControl label="Question type" value={section} onChange={setSection} options={(["all", "Discovery", "Trade Offs", "Sentiment Analysis"] as SectionFilter[]).map((key) => ({ value: key, label: key === "all" ? "All" : sectionLabel(key) }))} />
          <input type="search" value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Search questions" aria-label="Search questions" className="focus-ring h-9 w-44 rounded-lg border border-ink-200 bg-white px-3 text-sm text-ink-900 shadow-sheet placeholder:text-ink-400 hover:border-ink-300" />
          <button type="button" onClick={() => window.print()} className="focus-ring rounded-lg border border-ink-200 bg-white px-3 py-1.5 text-sm font-medium text-ink-900 shadow-sheet hover:border-ink-300 hover:bg-paper">
            Print or save as PDF
          </button>
        </div>
      </div>

      {error ? (
        <Panel>
          <p className="text-sm text-danger-600">{error}</p>
        </Panel>
      ) : answers === null ? (
        <Panel>
          <p className="flex items-center gap-2 text-sm text-ink-500">
            <Spinner /> Loading every answer…
          </p>
        </Panel>
      ) : questions.length === 0 ? (
        <Panel>
          <p className="py-4 text-center text-sm text-ink-500">No questions match these filters.</p>
        </Panel>
      ) : (
        <ol className="space-y-6">
          {questions.map((question, index) => (
            <li key={question.id} className="sun-print-keep sun-sheet">
              <div className="border-b border-ink-100 bg-paper px-5 py-3.5">
                <p className="sun-eyebrow text-ink-500">
                  {index + 1} · {sectionLabel(question.section)}
                  {question.topic ? ` · ${question.topic}` : ""}
                </p>
                <h3 className="mt-0.5 text-base font-semibold text-ink-950">{question.text}</h3>
              </div>
              <div className={`grid divide-y divide-ink-100 ${engines.length > 1 ? "lg:grid-cols-2 lg:divide-x lg:divide-y-0" : ""}`}>
                {engines.map((engine) => {
                  const row = question.rows.find((candidate) => candidate.engine === engine);
                  const answer = row?.observationId ? byObservation.get(row.observationId) : undefined;
                  return (
                    <div key={engine} className="min-w-0 px-5 py-4">
                      <div className="flex flex-wrap items-center justify-between gap-2">
                        <p className="text-sm font-semibold text-ink-900">{engineName(engine)}</p>
                        {row ? row.status === "analysable" ? <OutcomeCell row={row} /> : <StatusChip status={row.status} /> : <Chip tone="neutral">not planned</Chip>}
                      </div>
                      {answer ? (
                        <>
                          <p className="mt-1 text-xs text-ink-500">
                            {routeName(answer.route)}
                            {answer.observedAt ? ` · ${formatDateTime(answer.observedAt)}` : ""}
                            {answer.model ? ` · ${answer.model}` : ""}
                            {answer.country ? ` · asked from ${answer.country}` : ""}
                            {answer.searchState === "on" ? " · web search on" : answer.searchState === "off" ? " · no web search" : ""}
                            {answer.answerCaptureState === "truncated" ? " · answer cut off" : ""}
                          </p>
                          <div className="mt-3">{answer.responseText ? <AnswerText text={answer.responseText} highlights={answer.highlights} /> : <p className="text-sm text-ink-500">No answer text.</p>}</div>
                          {answer.highlights.length > 0 && (
                            <div className="-mx-3.5 mt-3">
                              <HighlightLegend brand={brand} />
                            </div>
                          )}
                          <div className="mt-3 border-t border-ink-100 pt-2.5">
                            <p className="sun-eyebrow text-ink-500">
                              Sources the page showed{answer.sources.length > 0 ? ` (${answer.sources.length})` : ""}
                            </p>
                            {answer.sources.length > 0 ? (
                              <SourceList
                                sources={answer.sources}
                                brand={brand}
                                footer={answer.inlineOnly.length > 0 ? <li className="pt-1 text-[11px] text-ink-500">Also linked inline in the answer: {answer.inlineOnly.map(registrableDomainOf).join(", ")}</li> : undefined}
                              />
                            ) : (
                              <p className="mt-1 text-xs text-ink-500">
                                {answer.sourcesCaptureState === "none_present" ? "The page showed no sources for this answer." : "Sources were not captured for this answer, so it is left out of every source figure."}
                              </p>
                            )}
                          </div>
                        </>
                      ) : (
                        <p className="mt-2 text-sm text-ink-500">
                          {row?.status === "not_collected" ? "This answer was not collected. It is left out of every figure and never counted as the brand being absent." : "No answer to show."}
                        </p>
                      )}
                    </div>
                  );
                })}
              </div>
            </li>
          ))}
        </ol>
      )}
    </div>
  );
}
