// Measurement snapshots: the history behind Measure.
//
// A finalised run gets one immutable row per set of versions served. History
// reads these rows, so a past measurement is never silently recomputed with
// today's analyses or today's policy; a re-analysis writes a NEW row that
// supersedes the old one. Runs without a snapshot (still collecting, or
// stopped and not yet closed) are computed live and labelled provisional.

import { and, desc, eq } from "drizzle-orm";
import { getDb } from "@/lib/db/client";
import { collectionRuns, measurementSnapshots, promptSets } from "@/lib/db/schema";
import { newId } from "@/lib/ids";
import { sha256Hex } from "@/lib/text/similarity";
import { ANALYSIS_VERSION } from "@/lib/analysis/types";
import { comparability, type Comparability } from "./compare";
import { measureRun } from "./service";
import type { MeasureResult, MetricValue } from "./types";

export type MeasurementSnapshot = typeof measurementSnapshots.$inferSelect;

/** Everything comparability depends on, hashed, so equal fingerprints compare without a break. */
export function lineageFingerprint(result: MeasureResult): string {
  const analysableEngines = Object.entries(result.coverage.byEngine)
    .filter(([, counts]) => counts.analysable > 0)
    .map(([engine]) => engine)
    .sort();
  return sha256Hex(
    JSON.stringify({
      promptSetId: result.lineage.promptSetId,
      competitiveSetVersionId: result.lineage.competitiveSetVersionId,
      analysisVersions: result.lineage.analysisVersions,
      metricPolicyVersion: result.lineage.metricPolicyVersion,
      engines: analysableEngines,
      samplesPerPrompt: result.lineage.samplesPerPrompt,
    }),
  );
}

/**
 * Writes (or refreshes) the snapshot for a run at the versions currently
 * served. A row already at those versions is updated in place — the result
 * for a finalised run at fixed versions is a pure function of stored rows —
 * while a change of versions produces a new row that supersedes the last.
 */
export async function writeMeasurementSnapshot(projectId: string, collectionRunId: string): Promise<{ snapshot: MeasurementSnapshot; result: MeasureResult }> {
  const db = getDb();
  const result = await measureRun(projectId, collectionRunId);
  const previous = await latestSnapshotForRun(collectionRunId);
  const analysisVersions = result.lineage.analysisVersions;
  const engines = Object.entries(result.coverage.byEngine)
    .filter(([, counts]) => counts.analysable > 0)
    .map(([engine]) => engine)
    .sort();
  const coverage = {
    planned: result.coverage.planned,
    captured: result.coverage.captured,
    analysable: result.coverage.analysable,
    needsReview: result.coverage.needsReview,
    awaitingAnalysis: result.coverage.awaitingAnalysis,
  };
  const now = new Date();
  const sameVersions = previous && JSON.stringify(previous.analysisVersions) === JSON.stringify(analysisVersions) && previous.metricPolicyVersion === result.lineage.metricPolicyVersion;
  if (sameVersions && previous) {
    await db
      .update(measurementSnapshots)
      .set({ result: result as unknown as Record<string, unknown>, coverage, engines, fingerprint: lineageFingerprint(result), computedAt: new Date(result.computedAt) })
      .where(eq(measurementSnapshots.id, previous.id))
      .run();
    const refreshed = (await db.select().from(measurementSnapshots).where(eq(measurementSnapshots.id, previous.id)).get())!;
    return { snapshot: refreshed, result };
  }
  const row: typeof measurementSnapshots.$inferInsert = {
    id: newId("msnap"),
    projectId,
    collectionRunId,
    promptSetId: result.lineage.promptSetId,
    promptSetVersion: result.lineage.promptSetVersion,
    competitiveSetVersionId: result.lineage.competitiveSetVersionId,
    analysisVersions,
    metricPolicyVersion: result.lineage.metricPolicyVersion,
    providerExperiences: result.lineage.providerExperiences,
    engines,
    samplesPerPrompt: result.lineage.samplesPerPrompt,
    fingerprint: lineageFingerprint(result),
    coverage,
    result: result as unknown as Record<string, unknown>,
    supersedesSnapshotId: previous?.id ?? null,
    computedAt: new Date(result.computedAt),
    createdAt: now,
  };
  await db.insert(measurementSnapshots).values(row).run();
  return { snapshot: row as MeasurementSnapshot, result };
}

export async function latestSnapshotForRun(collectionRunId: string): Promise<MeasurementSnapshot | undefined> {
  return getDb()
    .select()
    .from(measurementSnapshots)
    .where(eq(measurementSnapshots.collectionRunId, collectionRunId))
    .orderBy(desc(measurementSnapshots.createdAt))
    .get();
}

export async function getSnapshot(projectId: string, snapshotId: string): Promise<MeasurementSnapshot | undefined> {
  return getDb()
    .select()
    .from(measurementSnapshots)
    .where(and(eq(measurementSnapshots.id, snapshotId), eq(measurementSnapshots.projectId, projectId)))
    .get();
}

/**
 * A stored result, with the two lineage fields that describe the PRESENT
 * refreshed: which analyzer is current now, and how many of the served rows
 * are behind it. Everything else in a snapshot is a fact about the past.
 */
export function snapshotResult(snapshot: MeasurementSnapshot): MeasureResult {
  const result = snapshot.result as unknown as MeasureResult;
  const stale = result.lineage.analysisVersions.some((version) => version !== ANALYSIS_VERSION) ? result.coverage.captured : 0;
  return { ...result, lineage: { ...result.lineage, currentAnalysisVersion: ANALYSIS_VERSION, staleAnalyses: stale } };
}

export interface HistoryEntry {
  runId: string;
  createdAt: number;
  completedAt: number | null;
  finalisedBy: string | null;
  status: "final" | "provisional";
  snapshotId: string | null;
  promptSetId: string;
  promptSetVersion: number | null;
  competitiveSetVersionId: string | null;
  lineage: MeasureResult["lineage"];
  coverage: MeasureResult["coverage"];
  headline: {
    discoveryVisibility: MetricValue | null;
    shareOfVoice: MetricValue | null;
    firstChoice: MetricValue | null;
    ownedCitation: MetricValue | null;
    wins: number;
    losses: number;
    undecided: number;
    positive: number;
    negative: number;
    mixed: number;
  };
  /** Comparability against the run the caller selected, when one was given. */
  comparedToSelected: Comparability | null;
}

/** The measurement to show for a run: its final snapshot when it has one, live otherwise. */
export async function resultForRun(projectId: string, collectionRunId: string): Promise<{ result: MeasureResult; snapshot: MeasurementSnapshot | null }> {
  const snapshot = await latestSnapshotForRun(collectionRunId);
  if (snapshot) return { result: snapshotResult(snapshot), snapshot };
  return { result: await measureRun(projectId, collectionRunId), snapshot: null };
}

export async function listMeasurementHistory(projectId: string, selectedRunId?: string | null): Promise<HistoryEntry[]> {
  const db = getDb();
  const runs = (await db.select().from(collectionRuns).where(eq(collectionRuns.projectId, projectId)).all()).sort(
    (a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime(),
  );
  const versions = new Map((await db.select({ id: promptSets.id, version: promptSets.version }).from(promptSets).where(eq(promptSets.projectId, projectId)).all()).map((row) => [row.id, row.version]));
  const entries: Array<HistoryEntry & { result: MeasureResult }> = [];
  for (const run of runs) {
    const { result, snapshot } = await resultForRun(projectId, run.id);
    const combined = result.metrics.combined ?? {};
    const outcomes = result.tradeOffs.combined?.outcomes;
    const distribution = result.sentiment.combined?.distribution ?? {};
    entries.push({
      runId: run.id,
      createdAt: new Date(run.createdAt).getTime(),
      completedAt: run.completedAt ? new Date(run.completedAt).getTime() : null,
      finalisedBy: run.finalisedBy ?? null,
      status: snapshot ? "final" : "provisional",
      snapshotId: snapshot?.id ?? null,
      promptSetId: run.promptSetId,
      promptSetVersion: versions.get(run.promptSetId) ?? null,
      competitiveSetVersionId: result.lineage.competitiveSetVersionId,
      lineage: result.lineage,
      coverage: result.coverage,
      headline: {
        discoveryVisibility: combined.discovery_visibility ?? null,
        shareOfVoice: combined.discovery_share_of_voice ?? null,
        firstChoice: combined.first_choice_rate ?? null,
        ownedCitation: combined.owned_citation_rate ?? null,
        wins: outcomes?.TARGET_PREFERRED ?? 0,
        losses: outcomes?.COMPETITOR_PREFERRED ?? 0,
        undecided: (outcomes?.TIE ?? 0) + (outcomes?.UNCLEAR ?? 0),
        positive: distribution.POSITIVE ?? 0,
        negative: distribution.NEGATIVE ?? 0,
        mixed: distribution.MIXED ?? 0,
      },
      comparedToSelected: null,
      result,
    });
  }
  const selected = selectedRunId ? entries.find((entry) => entry.runId === selectedRunId) : undefined;
  return entries.map(({ result, ...entry }) => ({
    ...entry,
    comparedToSelected: selected && selected.runId !== entry.runId ? comparability(selected.result, result) : null,
  }));
}

/**
 * The run to compare against: the most recent earlier run whose lineage is
 * comparable (no break). When every earlier run is a break, the most recent
 * one is returned WITH its break, so the page can say why there is no delta
 * rather than pretending this is the first measurement.
 */
export async function previousRunForComparison(projectId: string, current: MeasureResult, currentCreatedAt: number): Promise<{ runId: string; result: MeasureResult; comparability: Comparability; createdAt: number } | null> {
  const db = getDb();
  const runs = (await db.select().from(collectionRuns).where(eq(collectionRuns.projectId, projectId)).all())
    .filter((run) => run.id !== current.collectionRunId && new Date(run.createdAt).getTime() < currentCreatedAt)
    .sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());
  let latestBreak: { runId: string; result: MeasureResult; comparability: Comparability; createdAt: number } | null = null;
  for (const run of runs) {
    const { result } = await resultForRun(projectId, run.id);
    if (result.coverage.analysable === 0) continue;
    const verdict = comparability(current, result);
    const entry = { runId: run.id, result, comparability: verdict, createdAt: new Date(run.createdAt).getTime() };
    if (verdict.level !== "break") return entry;
    latestBreak ??= entry;
  }
  return latestBreak;
}
