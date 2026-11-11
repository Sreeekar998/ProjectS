// Reads a run's evidence out of the database and hands it to the engine.
//
// The competitive denominator comes from the CompetitiveSetVersion PINNED to
// the run's prompt set, never from a live query of the entities table and
// never from whichever version is latest. That is the whole point of
// freezing it: confirming a new competitor next month must not retroactively
// change last month's Share of Voice.

import { desc, eq, inArray } from "drizzle-orm";
import { getDb } from "@/lib/db/client";
import {
  collectionRuns,
  competitiveSetVersions,
  entities as entitiesTable,
  observationAnalyses,
  promptCandidates,
  promptRuns,
  promptSets,
  providerResponses,
  type FrozenCompetitorSnapshot,
} from "@/lib/db/schema";
import { engineOf } from "@/lib/providers/engines";
import type { NormalizedObservation } from "@/lib/analysis/types";
import { ANALYSIS_VERSION } from "@/lib/analysis/types";
import { METRIC_POLICY_VERSION } from "./policy";
import { computeMeasure, type ObservationProvenance, type PromptInfo } from "./engine";
import type { MeasureResult } from "./types";

export { comparability, compareMeasurements } from "./compare";

export class RunNotFoundError extends Error {
  constructor(collectionRunId: string) {
    super(`No measurement run with id ${collectionRunId} in this project.`);
    this.name = "RunNotFoundError";
  }
}

export async function measureRun(projectId: string, collectionRunId: string): Promise<MeasureResult> {
  const db = getDb();

  const run = await db.select().from(collectionRuns).where(eq(collectionRuns.id, collectionRunId)).get();
  // A run id from another project must not measure under this project's
  // name: the URL parameter is user input.
  if (!run || run.projectId !== projectId) throw new RunNotFoundError(collectionRunId);

  const promptSet = await db.select().from(promptSets).where(eq(promptSets.id, run.promptSetId)).get();
  const candidates = await db.select().from(promptCandidates).where(eq(promptCandidates.promptSetId, run.promptSetId)).all();
  const candidateById = new Map(candidates.map((c) => [c.id, c]));

  // A question retired from a route (moved to another route, or a route the
  // policy disables) is not planned evidence: counting it would leave a run
  // permanently incomplete for answers nobody will ever ask for.
  const runs = (await db.select().from(promptRuns).where(eq(promptRuns.collectionRunId, collectionRunId)).all()).filter((row) => row.state !== "policy_disabled");

  const responses = runs.length
    ? await db.select().from(providerResponses).where(inArray(providerResponses.promptRunId, runs.map((r) => r.id))).all()
    : [];
  const responseByRun = new Map(responses.map((r) => [r.promptRunId, r]));

  const analysisRows = responses.length
    ? await db.select().from(observationAnalyses).where(inArray(observationAnalyses.providerResponseId, responses.map((r) => r.id))).all()
    : [];
  // One analysis per response. When an analyser upgrade leaves rows at more
  // than one version, the CURRENT version wins, then the most recent — never
  // whichever row the query happened to return last, which let a stale
  // interpretation silently stand in for the current one.
  const analysisByResponse = new Map<string, (typeof analysisRows)[number]>();
  const versionRank = (row: (typeof analysisRows)[number]) => (row.analysisVersion === ANALYSIS_VERSION ? 1 : 0);
  for (const row of analysisRows) {
    const existing = analysisByResponse.get(row.providerResponseId);
    const newer = existing ? new Date(row.analysedAt).getTime() > new Date(existing.analysedAt).getTime() : true;
    if (!existing || versionRank(row) > versionRank(existing) || (versionRank(row) === versionRank(existing) && newer)) {
      analysisByResponse.set(row.providerResponseId, row);
    }
  }

  // The versions ACTUALLY served, so lineage never claims the current
  // analyzer for rows an older one wrote.
  const served = [...analysisByResponse.values()];
  const analysisVersions = [...new Set(served.map((row) => row.analysisVersion))].sort();
  const staleAnalyses = served.filter((row) => row.analysisVersion !== ANALYSIS_VERSION).length;

  // One analysis per PLANNED prompt run. A run with no captured response
  // becomes a NOT_CAPTURED analysis so the denominator work happens in one
  // place — the engine never has to guess why an observation is missing. A
  // response WITH no analysis row (the analyser threw after capture) is also
  // NOT_CAPTURED for every metric, but carries `analysis_missing` so coverage
  // can say "collected, awaiting analysis" rather than "not collected".
  const analyses: NormalizedObservation[] = runs.map((promptRun) => {
    const response = responseByRun.get(promptRun.id);
    const stored = response ? analysisByResponse.get(response.id) : undefined;
    if (stored) return stored.payload as unknown as NormalizedObservation;

    const candidate = candidateById.get(promptRun.promptCandidateId);
    return {
      observationId: response?.id ?? promptRun.id,
      promptCandidateId: promptRun.promptCandidateId,
      section: (candidate?.section as never) ?? null,
      providerExperience: promptRun.providerExperience,
      analysisVersion: ANALYSIS_VERSION,
      analysedAt: Date.now(),
      eligibility: "NOT_CAPTURED",
      sourceHash: "",
      occurrences: [], comparisons: [], positions: [], rankEligibility: "no_options",
      sentiment: [], citations: [], sourceCaptureState: "unknown", emergingCandidates: [],
      warnings: response
        ? [{ code: "analysis_missing", detail: "The answer was collected but its analysis did not run; re-analyse to include it." }]
        : [{ code: "not_captured", detail: `prompt run is ${promptRun.state}` }],
      reviewedBy: null, supersedesAnalysisId: null,
    } satisfies NormalizedObservation;
  });

  // The frozen set — the authority for every competitive denominator. The
  // prompt set pins the version it was generated from; only a legacy set
  // with no pin falls back to the latest version, and lineage says so.
  let frozen = promptSet?.competitiveSetVersionId
    ? await db.select().from(competitiveSetVersions).where(eq(competitiveSetVersions.id, promptSet.competitiveSetVersionId)).get()
    : undefined;
  let competitiveSetSource: MeasureResult["lineage"]["competitiveSetSource"] = frozen ? "pinned" : "none";
  if (!frozen) {
    frozen = await db.select().from(competitiveSetVersions).where(eq(competitiveSetVersions.projectId, projectId)).orderBy(desc(competitiveSetVersions.version)).get();
    if (frozen) competitiveSetSource = "latest_fallback";
  }

  const target = await db.select().from(entitiesTable).where(eq(entitiesTable.projectId, projectId)).all();
  const targetEntity = target.find((e) => e.kind === "target");

  const frozenCompetitors = ((frozen?.competitorSnapshot as FrozenCompetitorSnapshot[] | undefined) ?? []).map((c) => ({
    entityId: c.entityId,
    name: c.canonicalName,
  }));

  const topics = ((frozen?.topicSnapshot as Array<{ topicId?: string; id?: string; name: string }> | undefined) ?? []).map((t) => ({
    id: (t.topicId ?? t.id ?? "") as string,
    name: t.name,
  }));

  const topicByPrompt = new Map<string, string | null>();
  const prompts = new Map<string, PromptInfo>();
  const knownPlaces = placeNamesOf(candidates.map((candidate) => candidate.geographyText ?? null));
  for (const candidate of candidates) {
    topicByPrompt.set(candidate.id, candidate.topicId ?? null);
    const text = candidate.editedText ?? candidate.text;
    prompts.set(candidate.id, {
      id: candidate.id,
      text,
      section: candidate.section ?? null,
      topicId: candidate.topicId ?? null,
      competitorEntityId: candidate.competitorEntityId ?? null,
      place: placeOfQuestion(candidate.geographyText ?? null, text, knownPlaces),
    });
  }

  const provenance = new Map<string, ObservationProvenance>();
  for (const response of responses) {
    provenance.set(response.id, {
      observedAt: new Date(response.observedAt).getTime(),
      model: response.visibleModelMode ?? null,
      country: response.observerRegion ?? null,
      searchState: response.searchState ?? null,
    });
  }

  const plannedByProvider: Record<string, number> = {};
  for (const promptRun of runs) {
    plannedByProvider[promptRun.providerExperience] = (plannedByProvider[promptRun.providerExperience] ?? 0) + 1;
  }
  const engines = [...new Set(runs.map((row) => engineOf(row.providerExperience)))].sort();

  return computeMeasure({
    projectId,
    collectionRunId,
    analyses,
    plannedCount: runs.length,
    plannedByProvider,
    targetEntityId: targetEntity?.id ?? "",
    targetName: targetEntity?.canonicalName ?? "Target",
    competitors: frozenCompetitors,
    topics,
    topicByPrompt,
    prompts,
    provenance,
    lineage: {
      promptSetId: run.promptSetId,
      promptSetVersion: promptSet?.version ?? null,
      competitiveSetVersionId: frozen?.id ?? null,
      competitiveSetVersion: frozen?.version ?? null,
      competitiveSetSource,
      analysisVersion: analysisVersions.length === 0 ? ANALYSIS_VERSION : analysisVersions.length === 1 ? analysisVersions[0]! : "mixed",
      analysisVersions,
      currentAnalysisVersion: ANALYSIS_VERSION,
      staleAnalyses,
      metricPolicyVersion: METRIC_POLICY_VERSION,
      providerExperiences: [...new Set(runs.map((row) => row.providerExperience))].sort(),
      engines,
      samplesPerPrompt: run.samplesPerPrompt ?? 1,
    },
  });
}


// --- Question places --------------------------------------------------------------

/** "DIFC" is written out as "Dubai International Financial Centre" in some questions; both are one place. */
function acronymOf(short: string, long: string): boolean {
  const compact = short.replace(/[^\p{L}\p{N}]/gu, "");
  if (compact.length < 2 || compact.length > 6 || /\s/.test(short.trim())) return false;
  const words = long.split(/[^\p{L}\p{N}]+/u).filter((word) => word && !/^(of|the|and|de|la|al|el)$/i.test(word));
  return words.length >= 2 && words.map((word) => word[0]).join("").toLowerCase() === compact.toLowerCase();
}

function samePlace(a: string, b: string): boolean {
  return a.trim().toLowerCase() === b.trim().toLowerCase() || acronymOf(a, b) || acronymOf(b, a);
}

/** Distinct places the questions name, one spelling per place (the longest, as people read it). */
function placeNamesOf(values: Array<string | null>): string[] {
  const out: string[] = [];
  for (const value of values) {
    const name = value?.trim();
    if (!name) continue;
    const existing = out.findIndex((place) => samePlace(place, name));
    if (existing === -1) out.push(name);
    else if (name.length > out[existing]!.length) out[existing] = name;
  }
  return out;
}

/**
 * The place a question names. The generator records it; a question edited or
 * written by hand may carry none, so the text is matched against the places
 * the other questions name.
 */
function placeOfQuestion(recorded: string | null, text: string, known: string[]): string | null {
  const direct = recorded?.trim();
  if (direct) return known.find((place) => samePlace(place, direct)) ?? direct;
  const escape = (value: string) => value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  for (const place of [...known].sort((a, b) => b.length - a.length)) {
    const words = place.split(/[^\p{L}\p{N}]+/u).filter((word) => word && !/^(of|the|and|de|la|al|el)$/i.test(word));
    const initials = words.length >= 3 ? [words.map((word) => word[0]).join("").toUpperCase()] : [];
    const spellings = [place, ...initials, ...known.filter((other) => other !== place && samePlace(other, place))];
    if (spellings.some((spelling) => new RegExp(`(^|[^\\p{L}\\p{N}])${escape(spelling)}(?=[^\\p{L}\\p{N}]|$)`, "iu").test(text))) return place;
  }
  return null;
}
