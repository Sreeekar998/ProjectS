// CSV exports of a measurement: the question table, the brands, the sources.
//
// Pure functions over a MeasureResult, so the route stays a thin handler and
// the escaping can be unit-tested. Every file carries the lineage columns so
// a number can be traced back to the questions, competitive set and rules it
// came from.

import { ENGINE_LABEL, surfaceLabel } from "@/lib/providers/engines";
import type { BrandRow, DomainRow, MeasureResult, PromptRow } from "./types";

/**
 * One CSV cell. Quotes, commas and line breaks (CR or LF) are quoted; a value
 * a spreadsheet would run as a formula (leading =, +, -, @, tab or CR) is
 * prefixed with an apostrophe. Question text, brand names and cited domains
 * come from model output and answer pages, so this is not optional.
 */
export function csvCell(value: unknown): string {
  if (value === null || value === undefined) return "";
  let text = Array.isArray(value) ? value.join("; ") : String(value);
  if (/^[=+\-@\t\r]/.test(text)) text = `'${text}`;
  return /[",\r\n]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
}

/** Excel needs a BOM to read UTF-8 (brand names, question text) and CRLF line ends. */
export function csvBody(header: string[], rows: string[][]): string {
  return `﻿${[header.join(","), ...rows.map((row) => row.join(","))].join("\r\n")}\r\n`;
}

const LINEAGE_HEADER = ["run_id", "prompt_set_version", "competitive_set_version", "analysis_version", "metric_policy_version"];

function lineageCells(result: MeasureResult, runId: string): string[] {
  const lineage = result.lineage;
  return [csvCell(runId), csvCell(lineage.promptSetVersion), csvCell(lineage.competitiveSetVersion), csvCell(lineage.analysisVersion), csvCell(lineage.metricPolicyVersion)];
}

const QUESTION_COLUMNS: Array<[string, (row: PromptRow) => unknown]> = [
  ["question", (row) => row.text],
  ["section", (row) => (row.section === "Sentiment Analysis" ? "Reputation" : row.section)],
  ["topic", (row) => row.topicName],
  ["engine", (row) => ENGINE_LABEL[row.engine as keyof typeof ENGINE_LABEL] ?? row.engine],
  // The surface, never the route id: a route id names the vendor behind it.
  ["surface", (row) => surfaceLabel(row.route)],
  ["status", (row) => row.status],
  ["target_named", (row) => (row.targetNamed === null ? "" : row.targetNamed ? "yes" : "no")],
  ["brands_named", (row) => row.brandsNamed],
  ["untracked_named", (row) => row.untrackedNamed],
  ["target_role", (row) => row.targetRole],
  ["rank_eligibility", (row) => row.rankEligibility],
  ["target_rank", (row) => row.targetRank],
  ["first_choice", (row) => row.firstChoiceName],
  ["verdict", (row) => row.verdict],
  ["rival", (row) => row.rivalName],
  ["aspects", (row) => row.aspects],
  ["portrayal", (row) => row.portrayal],
  ["themes", (row) => row.themes.map((theme) => `${theme.category}:${theme.polarity}`)],
  ["source_capture", (row) => row.sourceState],
  ["sources", (row) => row.sourceCount],
  ["owned_cited", (row) => (row.ownedCited === null ? "" : row.ownedCited ? "yes" : "no")],
  ["rival_cited", (row) => (row.rivalCited === null ? "" : row.rivalCited ? "yes" : "no")],
  ["cited_domains", (row) => row.citedDomains],
  ["observed_at", (row) => (row.observedAt ? new Date(row.observedAt).toISOString() : "")],
  ["model", (row) => row.model],
  ["observer_country", (row) => row.country],
  ["search", (row) => row.searchState],
  ["observation_id", (row) => row.observationId],
];

const BRAND_COLUMNS: Array<[string, (row: BrandRow) => unknown]> = [
  ["brand", (row) => row.name],
  ["relation", (row) => row.relation],
  ["discovery_named", (row) => row.discoveryNamed],
  ["discovery_eligible", (row) => row.discoveryEligible],
  ["share_of_voice", (row) => (row.shareOfVoice === null ? "" : row.shareOfVoice.toFixed(4))],
  ["ranked_first", (row) => row.firstChoice],
  ["ranked_count", (row) => row.rankedCount],
  ["average_rank", (row) => (row.averageRank === null ? "" : row.averageRank.toFixed(2))],
  ["head_to_head_won", (row) => row.headToHead?.won ?? ""],
  ["head_to_head_lost", (row) => row.headToHead?.lost ?? ""],
  ["head_to_head_undecided", (row) => row.headToHead?.undecided ?? ""],
  ["own_site_cited", (row) => row.ownDomainsCited],
  ["named_anywhere", (row) => row.namedAnywhere],
];

const SOURCE_COLUMNS: Array<[string, (row: DomainRow) => unknown]> = [
  ["domain", (row) => row.domain],
  ["ownership", (row) => row.ownership],
  ["owner", (row) => row.ownerName],
  ["kind", (row) => row.kind],
  ["answers_citing", (row) => row.responsesCiting],
  ["total_citations", (row) => row.totalCitations],
  ["discovery_answers_without_target", (row) => row.discoveryWithoutTarget],
];

function table<T>(columns: Array<[string, (row: T) => unknown]>, rows: T[], result: MeasureResult, runId: string): string {
  const header = [...columns.map(([name]) => name), ...LINEAGE_HEADER];
  return csvBody(
    header,
    rows.map((row) => [...columns.map(([, read]) => csvCell(read(row))), ...lineageCells(result, runId)]),
  );
}

/** The question table, one row per question × engine. */
export function questionsCsv(result: MeasureResult, runId: string): string {
  return table(QUESTION_COLUMNS, result.prompts, result, runId);
}

/** Tracked brands and the names outside the set. */
export function brandsCsv(result: MeasureResult, runId: string): string {
  return table(BRAND_COLUMNS, result.brands, result, runId);
}

/** The cited sites. */
export function sourcesCsv(result: MeasureResult, runId: string): string {
  return table(SOURCE_COLUMNS, result.sources.domains, result, runId);
}
