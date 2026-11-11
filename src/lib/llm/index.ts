// Routed LLM entry points: `generateStructured`, `webSearch`, `embedTexts`.
//
// Behaviour that every caller relies on:
//   * never throws; a failed chain returns `{ ok: false }` with every attempt
//     listed, so a caller can log precisely which provider said what;
//   * one transient retry per route (rate limit, overload, timeout) with a
//     short back-off, then the next route;
//   * malformed or validator-rejected output moves to the next route rather
//     than being accepted;
//   * every attempt is recorded in the ledger with an estimated cost.

import { availableRoutes, EMBEDDING_ROUTES, estimateCostUsd, hasCredentialFor, paidAllowedForStage } from "./routing";
import { recordUsage } from "./ledger";
import { clearProviderSuspension, providerSuspension, suspendProviderOn } from "./suspension";
import { openaiEmbed, openaiStructured, openaiWebSearch } from "./openai";
import { geminiEmbed, geminiGroundedSearch, geminiStructured } from "./gemini";
import { compatibleStructured } from "./openai-compatible";
import type { EmbeddingResult, LlmStage, LlmUsage, ModelRoute, StructuredRequest, StructuredResult, WebSearchRequest, WebSearchResult } from "./types";

export type { LlmStage, ModelRoute, StructuredRequest, StructuredResult, WebSearchRequest, WebSearchResult, EmbeddingResult } from "./types";
export { summarizeUsage, resetLedger } from "./ledger";
export { routesForStage, availableRoutes } from "./routing";
export { providerSuspension, clearProviderSuspension } from "./suspension";

const DEFAULT_TIMEOUT_MS: Record<LlmStage, number> = {
  extract: 90_000,
  classify: 60_000,
  synthesize: 120_000,
  locate: 45_000,
  competitors: 90_000,
  topics: 60_000,
  prompts: 120_000,
  judge: 45_000,
  search: 120_000,
};

const TRANSIENT = /^(rate_limited|timeout|network_error|provider_error|empty_response)/;

/**
 * A model that is up but overloaded ("503 … currently experiencing high
 * demand"). The fallbacks behind it are weaker models, so waiting a little
 * longer for it is worth more than an immediate fall back: the Landscape
 * stage went from Gemini 3.8 Flash straight to Flash-Lite after one 1.2 s retry.
 */
const OVERLOADED = /^provider_error.*(503|UNAVAILABLE|overloaded|high demand)/i;
const OVERLOAD_BACKOFF_MS = [3_000, 8_000];

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function parseJson(text: string): unknown | undefined {
  const trimmed = text.trim().replace(/^```(?:json)?\s*/i, "").replace(/\s*```$/, "");
  try {
    return JSON.parse(trimmed);
  } catch {
    // Some open models wrap the object in prose; salvage the outermost object.
    const start = trimmed.indexOf("{");
    const end = trimmed.lastIndexOf("}");
    if (start >= 0 && end > start) {
      try {
        return JSON.parse(trimmed.slice(start, end + 1));
      } catch {
        return undefined;
      }
    }
    return undefined;
  }
}

async function callRoute<T>(route: ModelRoute, request: StructuredRequest<T>, timeoutMs: number) {
  switch (route.provider) {
    case "openai":
      return openaiStructured({
        model: route.model,
        schemaName: request.schemaName,
        schema: request.schema,
        systemInstruction: request.systemInstruction,
        userContent: request.userContent,
        reasoningEffort: request.reasoningEffort,
        maxOutputTokens: request.maxOutputTokens,
        timeoutMs,
      });
    case "gemini":
      return geminiStructured({
        model: route.model,
        schema: request.schema,
        systemInstruction: request.systemInstruction,
        userContent: request.userContent,
        temperature: request.temperature,
        reasoningEffort: request.reasoningEffort,
        maxOutputTokens: request.maxOutputTokens,
        timeoutMs,
      });
    case "groq":
    case "cerebras":
      return compatibleStructured({
        provider: route.provider,
        model: route.model,
        schemaName: request.schemaName,
        schema: request.schema,
        systemInstruction: request.systemInstruction,
        userContent: request.userContent,
        temperature: request.temperature,
        maxOutputTokens: request.maxOutputTokens,
        timeoutMs,
      });
  }
}

export async function generateStructured<T>(request: StructuredRequest<T>): Promise<StructuredResult<T>> {
  const started = Date.now();
  const routes = availableRoutes(request.stage, request.routes);
  const attempts: StructuredResult<T>["attempts"] = [];
  const timeoutMs = request.timeoutMs ?? DEFAULT_TIMEOUT_MS[request.stage];
  if (routes.length === 0) {
    return { ok: false, error: "no_provider_available", provider: "none", model: "", latencyMs: 0, attempts };
  }

  for (const route of routes) {
    // A provider that refused on an earlier route of this chain (terra, then luna) is not asked again.
    if (providerSuspension(route.provider)) {
      attempts.push({ provider: route.provider, model: route.model, ok: false, error: `provider_suspended:${providerSuspension(route.provider)}`, latencyMs: 0 });
      continue;
    }
    for (let attempt = 0; attempt < 3; attempt++) {
      const routeStarted = Date.now();
      const result = await callRoute(route, request, timeoutMs);
      const latencyMs = Date.now() - routeStarted;
      const usage = result.usage;
      const costUsd = usage ? estimateCostUsd(route.model, usage) : 0;

      let error = result.error;
      let data: T | undefined;
      if (result.ok && result.text) {
        const parsed = parseJson(result.text);
        if (parsed === undefined) error = "malformed_json_response";
        else if (request.validate) {
          const validated = request.validate(parsed);
          if (validated === null) error = "schema_validation_failed";
          else data = validated;
        } else data = parsed as T;
      }

      const ok = !error && data !== undefined;
      recordUsage({ projectId: request.projectId ?? "-", stage: request.stage, provider: route.provider, model: result.model ?? route.model, ok, latencyMs, usage, costUsd, error });
      attempts.push({ provider: route.provider, model: result.model ?? route.model, ok, error, latencyMs });

      if (ok) {
        clearProviderSuspension(route.provider);
        return { ok: true, data, rawText: result.text, provider: route.provider, model: result.model ?? route.model, latencyMs: Date.now() - started, usage, costUsd, attempts };
      }
      if (suspendProviderOn(route.provider, error)) break;
      if (error && OVERLOADED.test(error) && attempt < OVERLOAD_BACKOFF_MS.length) {
        await sleep(OVERLOAD_BACKOFF_MS[attempt]!);
        continue;
      }
      if (attempt === 0 && error && TRANSIENT.test(error)) {
        await sleep(error.startsWith("rate_limited") ? 2500 : 1200);
        continue;
      }
      break;
    }
  }

  const last = attempts[attempts.length - 1];
  return { ok: false, error: last?.error ?? "all_routes_failed", provider: last?.provider ?? "none", model: last?.model ?? "", latencyMs: Date.now() - started, attempts };
}

export async function webSearch(request: WebSearchRequest): Promise<WebSearchResult> {
  const started = Date.now();
  const stage = request.stage ?? "search";
  const timeoutMs = request.timeoutMs ?? DEFAULT_TIMEOUT_MS.search;
  const routes = availableRoutes(stage);
  const searchRoutes = routes.filter((route) => route.provider === "openai" || route.provider === "gemini");
  if (searchRoutes.length === 0) return { ok: false, error: "no_search_provider_available", sources: [], queries: [], provider: "none", model: "", latencyMs: 0 };

  for (const route of searchRoutes) {
    if (providerSuspension(route.provider)) continue;
    const routeStarted = Date.now();
    const result =
      route.provider === "openai"
        ? await openaiWebSearch({ model: route.model, task: request.task, userLocation: request.userLocation, contextSize: request.contextSize, schema: request.schema, schemaName: request.schemaName, maxOutputTokens: request.maxOutputTokens, timeoutMs })
        : await geminiGroundedSearch({ model: route.model, task: request.schema ? `${request.task}\n\nReturn ONLY JSON matching this schema: ${JSON.stringify(request.schema)}` : request.task, timeoutMs, maxOutputTokens: request.maxOutputTokens });
    const latencyMs = Date.now() - routeStarted;
    const costUsd = result.usage ? estimateCostUsd(route.model, { ...result.usage, toolCalls: result.usage.toolCalls ?? (result.ok ? 1 : 0) }) : 0;
    let data: unknown;
    let error = result.error;
    if (result.ok && request.schema && result.text) {
      data = parseJson(result.text);
      if (data === undefined) error = "malformed_json_response";
    }
    const ok = result.ok && !error;
    recordUsage({ projectId: request.projectId ?? "-", stage, provider: route.provider, model: result.model, ok, latencyMs, usage: result.usage, costUsd, error });
    suspendProviderOn(route.provider, error);
    if (ok) {
      return { ok: true, text: result.text, data, sources: result.sources ?? [], queries: result.queries ?? [], provider: route.provider, model: result.model, latencyMs: Date.now() - started, usage: result.usage, costUsd };
    }
  }
  return { ok: false, error: "all_search_routes_failed", sources: [], queries: [], provider: "none", model: "", latencyMs: Date.now() - started };
}

export async function embedTexts(texts: string[], options: { projectId?: string; timeoutMs?: number; stage?: LlmStage } = {}): Promise<EmbeddingResult> {
  const started = Date.now();
  if (texts.length === 0) return { ok: true, vectors: [], provider: "none", model: "", latencyMs: 0 };
  for (const route of EMBEDDING_ROUTES) {
    if (!hasCredentialFor(route.provider)) continue;
    if (route.provider === "openai" && !paidAllowedForStage(options.stage ?? "judge")) continue;
    if (providerSuspension(route.provider)) continue;
    const result =
      route.provider === "openai"
        ? await openaiEmbed({ model: route.model, texts, dimensions: 512, timeoutMs: options.timeoutMs ?? 45_000 })
        : await geminiEmbed({ model: route.model, texts, timeoutMs: options.timeoutMs ?? 45_000 });
    const usage = "usage" in result ? (result as { usage?: LlmUsage }).usage : undefined;
    const costUsd = route.provider === "openai" && usage ? estimateCostUsd(route.model, usage) : 0;
    recordUsage({ projectId: options.projectId ?? "-", stage: "judge", provider: route.provider, model: route.model, ok: result.ok, latencyMs: Date.now() - started, usage, costUsd, error: result.error });
    suspendProviderOn(route.provider, result.error);
    if (result.ok) return { ok: true, vectors: result.vectors, provider: route.provider, model: route.model, latencyMs: Date.now() - started, costUsd };
  }
  return { ok: false, vectors: [], provider: "none", model: "", error: "no_embedding_provider", latencyMs: Date.now() - started };
}

/** Cosine similarity for embeddings produced by `embedTexts`. */
export function cosineSimilarity(a: number[], b: number[]): number {
  let dot = 0;
  let na = 0;
  let nb = 0;
  const n = Math.min(a.length, b.length);
  for (let i = 0; i < n; i++) {
    dot += a[i]! * b[i]!;
    na += a[i]! * a[i]!;
    nb += b[i]! * b[i]!;
  }
  if (na === 0 || nb === 0) return 0;
  return dot / (Math.sqrt(na) * Math.sqrt(nb));
}
