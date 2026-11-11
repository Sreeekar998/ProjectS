// In-process usage ledger.
//
// Every model call records tokens, cost and latency here so a profile version
// can state which models produced it and what it cost, and so a runaway loop
// shows up as numbers rather than as a surprise on the provider invoice. It is
// per process and per project; nothing here is persisted on its own — the
// profile synthesis copies a summary into `quality`.

import type { LlmProviderId, LlmStage, LlmUsage } from "./types";

export interface LedgerEntry {
  at: number;
  projectId: string;
  stage: LlmStage;
  provider: LlmProviderId;
  model: string;
  ok: boolean;
  latencyMs: number;
  usage?: LlmUsage;
  costUsd: number;
  error?: string;
}

const MAX_ENTRIES = 5000;
const entries: LedgerEntry[] = [];

export function recordUsage(entry: Omit<LedgerEntry, "at">): void {
  entries.push({ at: Date.now(), ...entry });
  if (entries.length > MAX_ENTRIES) entries.splice(0, entries.length - MAX_ENTRIES);
}

export interface UsageSummary {
  calls: number;
  failedCalls: number;
  inputTokens: number;
  outputTokens: number;
  costUsd: number;
  models: string[];
  byStage: Record<string, { calls: number; costUsd: number; models: string[]; errors: string[] }>;
}

export function summarizeUsage(projectId: string, since?: number): UsageSummary {
  const summary: UsageSummary = { calls: 0, failedCalls: 0, inputTokens: 0, outputTokens: 0, costUsd: 0, models: [], byStage: {} };
  const models = new Set<string>();
  for (const entry of entries) {
    if (entry.projectId !== projectId) continue;
    if (since && entry.at < since) continue;
    summary.calls++;
    if (!entry.ok) summary.failedCalls++;
    summary.inputTokens += entry.usage?.inputTokens ?? 0;
    summary.outputTokens += entry.usage?.outputTokens ?? 0;
    summary.costUsd += entry.costUsd;
    if (entry.ok) models.add(`${entry.provider}:${entry.model}`);
    const stage = (summary.byStage[entry.stage] ??= { calls: 0, costUsd: 0, models: [], errors: [] });
    // Short, key-free error codes so a silent fallback is visible in telemetry.
    if (!entry.ok && entry.error) {
      const code = `${entry.provider}:${entry.model} ${entry.error.slice(0, 80)}`;
      if (!stage.errors.includes(code) && stage.errors.length < 5) stage.errors.push(code);
    }
    stage.calls++;
    stage.costUsd += entry.costUsd;
    if (entry.ok && !stage.models.includes(`${entry.provider}:${entry.model}`)) stage.models.push(`${entry.provider}:${entry.model}`);
  }
  summary.models = [...models];
  summary.costUsd = Number(summary.costUsd.toFixed(6));
  return summary;
}

/** Test helper. */
export function resetLedger(): void {
  entries.splice(0, entries.length);
}
