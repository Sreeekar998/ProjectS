// Stage → model routing and price table.
//
// One file to change when a model is retired or a price moves. Each stage has
// an ordered chain; the first provider with a key that answers cleanly wins.
// Environment overrides let an operator pin a stage without a code change:
//   SUN_LLM_EXTRACT="openai:gpt-5.4-mini,gemini:gemini-3.5-flash"
//
// Why these defaults (verified against the account's model list, the vendors'
// pricing pages and live probes on 2026-09-13):
//   * gpt-5.6-luna ($0.20 in / $1.20 out per 1M, 1.05M context, strict JSON
//     schema, reasoning effort none…max) is cheaper than the 5.4 mini/nano
//     tier and answered the salon probe correctly and injection-resistant.
//     It is the workhorse for extraction, classification, location parsing,
//     topics and judging.
//   * gpt-5.6-terra ($2 / $12) is the mid-tier flagship; it is used only where
//     writing quality or reasoning is the product: business synthesis on hard
//     cases and the final prompt writing.
//   * Gemini 3.5 Flash-Lite / 3.6-3.8 Flash are free-tier for text, so they
//     are the no-spend fallback and the default for Landscape stages.
//   * Groq's free plan allows 8K tokens per minute, which cannot carry an
//     evidence pack, so Groq only appears on the small judge stage. Cerebras
//     has no permanent free tier and is not routed by default.

import type { LlmProviderId, LlmStage, ModelRoute } from "./types";
import { getCredential } from "@/lib/providers/credentials";

// Gemini 2.5 Flash / Flash-Lite are listed by the models endpoint but return
// 404 "no longer available to new users" for this account (probed
// 2026-09-13), so no chain relies on them. Grounded search on Gemini 3.x has
// no free-tier quota (429 RESOURCE_EXHAUSTED on a free key); the search chain
// keeps it for billing-enabled keys, where 5,000 queries a month are free.
const DEFAULT_ROUTES: Record<LlmStage, ModelRoute[]> = {
  extract: [
    { provider: "openai", model: "gpt-5.6-luna" },
    { provider: "gemini", model: "gemini-3.5-flash-lite" },
    { provider: "gemini", model: "gemini-3.6-flash" },
  ],
  classify: [
    { provider: "openai", model: "gpt-5.6-luna" },
    { provider: "gemini", model: "gemini-3.5-flash-lite" },
    { provider: "gemini", model: "gemini-3.6-flash" },
  ],
  synthesize: [
    { provider: "openai", model: "gpt-5.6-terra" },
    { provider: "openai", model: "gpt-5.6-luna" },
    { provider: "gemini", model: "gemini-3.8-flash" },
    { provider: "gemini", model: "gemini-3.6-flash" },
  ],
  locate: [
    { provider: "openai", model: "gpt-5.6-luna" },
    { provider: "gemini", model: "gemini-3.5-flash-lite" },
    { provider: "gemini", model: "gemini-3.6-flash" },
  ],
  competitors: [
    { provider: "openai", model: "gpt-5.6-luna" },
    { provider: "gemini", model: "gemini-3.8-flash" },
    { provider: "gemini", model: "gemini-3.7-flash" },
    { provider: "gemini", model: "gemini-3.5-flash-lite" },
  ],
  // Topics are the abstraction everything downstream is bound to (needs,
  // prompts, competitors). Compared on 2026-09-16: for a global API platform
  // luna kept 4 topics and dropped monitoring and distribution, terra returned
  // 6 covering them, for about $0.01 a business against $0.001; for a salon
  // both were equal. Terra first, luna as the cheap fallback.
  topics: [
    { provider: "openai", model: "gpt-5.6-terra" },
    { provider: "openai", model: "gpt-5.6-luna" },
    { provider: "gemini", model: "gemini-3.8-flash" },
    { provider: "gemini", model: "gemini-3.6-flash" },
    { provider: "gemini", model: "gemini-3.5-flash-lite" },
  ],
  prompts: [
    { provider: "openai", model: "gpt-5.6-terra" },
    { provider: "openai", model: "gpt-5.6-luna" },
    { provider: "gemini", model: "gemini-3.8-flash" },
    { provider: "gemini", model: "gemini-3.6-flash" },
  ],
  judge: [
    { provider: "openai", model: "gpt-5.6-luna" },
    { provider: "gemini", model: "gemini-3.5-flash-lite" },
    { provider: "groq", model: "openai/gpt-oss-120b" },
  ],
  search: [
    { provider: "openai", model: "gpt-5.6-luna" },
    { provider: "gemini", model: "gemini-3.6-flash" },
  ],
};

export const EMBEDDING_ROUTES: ModelRoute[] = [
  { provider: "openai", model: "text-embedding-3-small" },
  { provider: "gemini", model: "gemini-embedding-2" },
];

/**
 * USD per 1M tokens, from the vendors' pricing pages on 2026-09-13. Used for
 * cost telemetry only. Gemini 3.x Flash prices are the promotional rate that
 * doubles on 2027-01-01. Update here only.
 */
export const PRICE_PER_MILLION: Record<string, { input: number; output: number }> = {
  "gpt-6-astra": { input: 10, output: 50 },
  "gpt-5.6-sol": { input: 4, output: 20 },
  "gpt-5.6-terra": { input: 2, output: 12 },
  "gpt-5.6-luna": { input: 0.2, output: 1.2 },
  "gpt-5.5": { input: 5, output: 30 },
  "gpt-5.4": { input: 2.5, output: 15 },
  "gpt-5.4-mini": { input: 0.75, output: 4.5 },
  "gpt-5.4-nano": { input: 0.2, output: 1.25 },
  "gpt-5-mini": { input: 0.25, output: 2 },
  "gpt-5-nano": { input: 0.05, output: 0.4 },
  "text-embedding-3-small": { input: 0.02, output: 0 },
  "gemini-3.8-flash": { input: 0.75, output: 3.75 },
  "gemini-3.7-flash": { input: 0.75, output: 3.75 },
  "gemini-3.6-flash": { input: 0.75, output: 3.75 },
  "gemini-3.5-flash": { input: 1.5, output: 9 },
  "gemini-3.5-flash-lite": { input: 0.3, output: 2.5 },
  "gemini-3.1-pro-preview": { input: 2, output: 12 },
  "gemini-2.5-flash": { input: 0.3, output: 2.5 },
  "gemini-2.5-flash-lite": { input: 0.1, output: 0.4 },
  "gemini-flash-lite-latest": { input: 0.3, output: 2.5 },
  "gemini-embedding-2": { input: 0.2, output: 0 },
  "openai/gpt-oss-120b": { input: 0.15, output: 0.6 },
  "openai/gpt-oss-20b": { input: 0.075, output: 0.3 },
  "gpt-oss-120b": { input: 0.35, output: 0.75 },
};

/** USD per web-search tool call (OpenAI: $10 per 1,000 calls plus tokens). */
export const WEB_SEARCH_CALL_USD = 0.01;

export function estimateCostUsd(model: string, usage: { inputTokens: number; outputTokens: number; toolCalls?: number }): number {
  // The account's Gemini key is on the free tier (billing off), where text
  // calls cost nothing; set SUN_GEMINI_BILLING=1 to estimate at paid prices.
  if (/^gemini/.test(model) && process.env.SUN_GEMINI_BILLING !== "1") return 0;
  const price = PRICE_PER_MILLION[model] ?? PRICE_PER_MILLION[model.replace(/-\d{4}-\d{2}-\d{2}$/, "")];
  const tokens = price ? (usage.inputTokens * price.input + usage.outputTokens * price.output) / 1_000_000 : 0;
  return Number((tokens + (usage.toolCalls ?? 0) * WEB_SEARCH_CALL_USD).toFixed(6));
}

function parseOverride(raw: string | undefined): ModelRoute[] | null {
  if (!raw) return null;
  const routes: ModelRoute[] = [];
  for (const part of raw.split(",")) {
    const [provider, ...rest] = part.trim().split(":");
    const model = rest.join(":").trim();
    if (!provider || !model) continue;
    if (!["openai", "gemini", "groq", "cerebras"].includes(provider)) continue;
    routes.push({ provider: provider as LlmProviderId, model });
  }
  return routes.length > 0 ? routes : null;
}

/** Providers that bill per call on this account (Gemini text is free-tier). */
const PAID_PROVIDERS = new Set<LlmProviderId>(["openai"]);

/**
 * Stages where paid OpenAI calls are approved. On 2026-09-13 the operator
 * approved paid calls for Understand and Prompts ("good quality but cost
 * effective"); judge and embeddings serve prompt selection. Landscape stages
 * (topics, competitors, search) stay on free Gemini routes unless
 * SUN_ALLOW_PAID_LANDSCAPE=1. SUN_LLM_NO_PAID=1 turns every paid route off.
 * An explicit SUN_LLM_<STAGE> override is the operator's own choice and is
 * not filtered.
 */
const PAID_APPROVED_STAGES = new Set<LlmStage>(["extract", "classify", "synthesize", "locate", "prompts", "judge"]);

export function paidAllowedForStage(stage: LlmStage): boolean {
  if (process.env.SUN_LLM_NO_PAID === "1") return false;
  if (PAID_APPROVED_STAGES.has(stage)) return true;
  return process.env.SUN_ALLOW_PAID_LANDSCAPE === "1";
}

export function routesForStage(stage: LlmStage): ModelRoute[] {
  const override = parseOverride(process.env[`SUN_LLM_${stage.toUpperCase()}`]);
  if (override) return override;
  const allowPaid = paidAllowedForStage(stage);
  return DEFAULT_ROUTES[stage].filter((route) => allowPaid || !PAID_PROVIDERS.has(route.provider));
}

export function hasCredentialFor(provider: LlmProviderId): boolean {
  return Boolean(getCredential(provider));
}

/** Routes for a stage that currently have a key, in preference order. */
export function availableRoutes(stage: LlmStage, override?: ModelRoute[]): ModelRoute[] {
  return (override ?? routesForStage(stage)).filter((route) => hasCredentialFor(route.provider));
}
