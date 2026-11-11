// Gemini adapter for the routed LLM layer: structured output, grounded
// search and embeddings, with the model chosen per call.
//
// The collection lane keeps its own client (`@/lib/gemini/client`) because it
// carries lane-specific behaviour (search-allowance memory, retry policy).
// This adapter is stateless apart from the SDK instance.

import { GoogleGenAI } from "@google/genai";
import { getCredential } from "@/lib/providers/credentials";
import { toGeminiSchema, toPlainJsonSchema } from "./schema";
import type { LlmUsage, ReasoningEffort, WebSearchSource } from "./types";

let client: GoogleGenAI | null = null;
let activeKey: string | null = null;

function getClient(): GoogleGenAI | null {
  const key = getCredential("gemini");
  if (!key) return null;
  if (!client || activeKey !== key) {
    client = new GoogleGenAI({ apiKey: key });
    activeKey = key;
  }
  return client;
}

function classifyError(error: unknown): string {
  const message = error instanceof Error ? error.message : String(error);
  const detail = message.replace(/\s+/g, " ").slice(0, 160);
  if (/429|quota|rate limit|RESOURCE_EXHAUSTED/i.test(message)) return "rate_limited";
  if (/not found|not supported|NOT_FOUND|404/i.test(message)) return `model_unavailable:${detail}`;
  if (/API key|PERMISSION_DENIED|401|403/i.test(message)) return `auth_failed:${detail}`;
  if (/INVALID_ARGUMENT|400/i.test(message)) return `bad_request:${detail}`;
  if (/503|UNAVAILABLE|overloaded|high demand/i.test(message)) return `provider_error:${detail}`;
  if (error instanceof Error && error.name === "AbortError") return "timeout";
  return `request_failed:${detail}`;
}

function thinkingConfigFor(model: string, effort: ReasoningEffort | undefined): Record<string, unknown> | undefined {
  // Gemini 2.5 exposes a token budget; 0 disables thinking on Flash. The 3.x
  // generation ignores unknown budget values but accepts a level. Only the
  // two known-safe shapes are sent, and only when the caller asked for
  // minimal reasoning, because extraction does not need a thinking pass and
  // the probe showed 445 thought tokens on an 80-token answer.
  if (effort !== "minimal") return undefined;
  if (/gemini-2\.5/.test(model)) return { thinkingConfig: { thinkingBudget: 0 } };
  if (/gemini-3/.test(model)) return { thinkingConfig: { thinkingLevel: "low" } };
  return undefined;
}

interface GeminiResponseLike {
  text?: string;
  usageMetadata?: { promptTokenCount?: number; candidatesTokenCount?: number; thoughtsTokenCount?: number };
  candidates?: Array<{ finishReason?: string; groundingMetadata?: { webSearchQueries?: string[]; groundingChunks?: Array<{ web?: { uri?: string; title?: string } }> } }>;
}

function readUsage(response: GeminiResponseLike): LlmUsage | undefined {
  const meta = response.usageMetadata;
  if (!meta) return undefined;
  return { inputTokens: meta.promptTokenCount ?? 0, outputTokens: (meta.candidatesTokenCount ?? 0) + (meta.thoughtsTokenCount ?? 0), reasoningTokens: meta.thoughtsTokenCount };
}

export interface GeminiCallResult {
  ok: boolean;
  text?: string;
  error?: string;
  model: string;
  usage?: LlmUsage;
  sources?: WebSearchSource[];
  queries?: string[];
}

export async function geminiStructured(params: {
  model: string;
  schema: Record<string, unknown>;
  systemInstruction: string;
  userContent: string;
  temperature?: number;
  reasoningEffort?: ReasoningEffort;
  maxOutputTokens?: number;
  timeoutMs: number;
}): Promise<GeminiCallResult> {
  const gemini = getClient();
  if (!gemini) return { ok: false, error: "gemini_api_disabled", model: params.model };

  // `responseSchema` (OpenAPI subset) is deprecated in favour of
  // `responseJsonSchema` (plain JSON Schema). The plain form is tried first;
  // a 400 falls back to the converted subset so older models keep working.
  const attempt = async (schemaField: "responseJsonSchema" | "responseSchema"): Promise<GeminiCallResult> => {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), params.timeoutMs);
    try {
      const response = (await gemini.models.generateContent({
        model: params.model,
        contents: params.userContent,
        config: {
          systemInstruction: params.systemInstruction,
          responseMimeType: "application/json",
          [schemaField]: schemaField === "responseJsonSchema" ? toPlainJsonSchema(params.schema) : toGeminiSchema(params.schema),
          temperature: params.temperature ?? 0.2,
          abortSignal: controller.signal,
          ...(params.maxOutputTokens ? { maxOutputTokens: params.maxOutputTokens } : {}),
          ...(thinkingConfigFor(params.model, params.reasoningEffort) ?? {}),
        } as Record<string, unknown>,
      })) as GeminiResponseLike;
      const text = response.text ?? "";
      const usage = readUsage(response);
      if (!text.trim()) return { ok: false, error: `empty_response:${response.candidates?.[0]?.finishReason ?? "unknown"}`, model: params.model, usage };
      return { ok: true, text, model: params.model, usage };
    } catch (error) {
      return { ok: false, error: classifyError(error), model: params.model };
    } finally {
      clearTimeout(timer);
    }
  };

  const first = await attempt("responseJsonSchema");
  if (!first.ok && first.error?.startsWith("bad_request")) return attempt("responseSchema");
  return first;
}

export async function geminiGroundedSearch(params: {
  model: string;
  task: string;
  instructions?: string;
  timeoutMs: number;
  maxOutputTokens?: number;
}): Promise<GeminiCallResult> {
  const gemini = getClient();
  if (!gemini) return { ok: false, error: "gemini_api_disabled", model: params.model };
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), params.timeoutMs);
  try {
    const response = (await gemini.models.generateContent({
      model: params.model,
      contents: params.task,
      config: {
        ...(params.instructions ? { systemInstruction: params.instructions } : {}),
        temperature: 0.3,
        tools: [{ googleSearch: {} }],
        abortSignal: controller.signal,
        ...(params.maxOutputTokens ? { maxOutputTokens: params.maxOutputTokens } : {}),
      },
    })) as GeminiResponseLike;
    const text = response.text?.trim() ?? "";
    const meta = response.candidates?.[0]?.groundingMetadata;
    const sources: WebSearchSource[] = [];
    const seen = new Set<string>();
    for (const chunk of meta?.groundingChunks ?? []) {
      const uri = chunk.web?.uri;
      if (!uri || seen.has(uri)) continue;
      seen.add(uri);
      sources.push({ url: uri, title: chunk.web?.title ?? null });
    }
    const usage = readUsage(response);
    if (!text) return { ok: false, error: "empty_response", model: params.model, usage, sources, queries: meta?.webSearchQueries ?? [] };
    return { ok: true, text, model: params.model, usage, sources, queries: meta?.webSearchQueries ?? [] };
  } catch (error) {
    return { ok: false, error: classifyError(error), model: params.model };
  } finally {
    clearTimeout(timer);
  }
}

export async function geminiEmbed(params: { model: string; texts: string[]; timeoutMs: number }): Promise<{ ok: boolean; vectors: number[][]; error?: string }> {
  const gemini = getClient();
  if (!gemini) return { ok: false, vectors: [], error: "gemini_api_disabled" };
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), params.timeoutMs);
  try {
    const response = (await gemini.models.embedContent({
      model: params.model,
      contents: params.texts,
      config: { abortSignal: controller.signal } as Record<string, unknown>,
    })) as { embeddings?: Array<{ values?: number[] }> };
    const vectors = (response.embeddings ?? []).map((e) => e.values ?? []);
    return { ok: vectors.length === params.texts.length && vectors.every((v) => v.length > 0), vectors };
  } catch (error) {
    return { ok: false, vectors: [], error: classifyError(error) };
  } finally {
    clearTimeout(timer);
  }
}
