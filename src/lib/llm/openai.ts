// OpenAI Responses API adapter: structured output, web search, embeddings.
//
// Raw `fetch` on purpose (no SDK dependency, same as the collection lane).
// Structured output uses `text.format = json_schema` in strict mode, which
// guarantees the shape; reasoning effort is per call. Temperature is not sent:
// the 5.x reasoning models reject non-default values, and variety is obtained
// through instructions instead.

import { getCredential } from "@/lib/providers/credentials";
import { toOpenAiStrictSchema } from "./schema";
import type { LlmUsage, ReasoningEffort, WebSearchSource } from "./types";

const RESPONSES_ENDPOINT = "https://api.openai.com/v1/responses";
const EMBEDDINGS_ENDPOINT = "https://api.openai.com/v1/embeddings";

export interface OpenAiCallResult {
  ok: boolean;
  text?: string;
  error?: string;
  model: string;
  usage?: LlmUsage;
  status?: string;
  sources?: WebSearchSource[];
  queries?: string[];
  toolCalls?: number;
}

interface ResponsesBody {
  status?: string;
  model?: string;
  error?: { message?: string; code?: string; type?: string } | null;
  incomplete_details?: { reason?: string } | null;
  usage?: { input_tokens?: number; output_tokens?: number; output_tokens_details?: { reasoning_tokens?: number } };
  output?: Array<{
    type?: string;
    action?: { type?: string; query?: string; sources?: Array<{ url?: string; title?: string }> };
    content?: Array<{ type?: string; text?: string; annotations?: Array<{ type?: string; url?: string; title?: string }> }>;
  }>;
}

function classifyHttpError(status: number, code: string, type = ""): string {
  // An empty balance arrives as a 429 with code "credit_balance_exhausted" and
  // type "insufficient_quota". Read as a rate limit it was retried on every
  // call before falling back, and the account looked merely busy.
  if ([code, type].some((value) => value === "insufficient_quota" || value === "credit_balance_exhausted") || status === 402) return "billing_required";
  if (status === 429) return "rate_limited";
  if (status === 401) return "auth_failed";
  if (status === 404 || code === "model_not_found") return "model_unavailable";
  if (status === 400) return `bad_request:${code || "unknown"}`;
  if (status >= 500) return `provider_error:${status}`;
  return `http_${status}`;
}

async function postResponses(body: Record<string, unknown>, timeoutMs: number): Promise<{ ok: boolean; status: number; json: ResponsesBody; error?: string }> {
  const key = getCredential("openai");
  if (!key) return { ok: false, status: 0, json: {}, error: "openai_api_disabled" };
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetch(RESPONSES_ENDPOINT, {
      method: "POST",
      headers: { "content-type": "application/json", authorization: `Bearer ${key}` },
      body: JSON.stringify(body),
      signal: controller.signal,
    });
    const json = (await response.json().catch(() => ({}))) as ResponsesBody;
    if (!response.ok) {
      const code = json.error?.code ?? json.error?.type ?? "";
      const message = json.error?.message ? `:${json.error.message.slice(0, 160)}` : "";
      return { ok: false, status: response.status, json, error: `${classifyHttpError(response.status, code, json.error?.type ?? "")}${message}` };
    }
    return { ok: true, status: response.status, json };
  } catch (error) {
    const aborted = error instanceof Error && error.name === "AbortError";
    return { ok: false, status: 0, json: {}, error: aborted ? "timeout" : "network_error" };
  } finally {
    clearTimeout(timer);
  }
}

function readUsage(json: ResponsesBody): LlmUsage | undefined {
  if (!json.usage) return undefined;
  return {
    inputTokens: json.usage.input_tokens ?? 0,
    outputTokens: json.usage.output_tokens ?? 0,
    reasoningTokens: json.usage.output_tokens_details?.reasoning_tokens,
  };
}

function readOutput(json: ResponsesBody): { text: string | null; sources: WebSearchSource[]; queries: string[]; toolCalls: number } {
  let text: string | null = null;
  const sources: WebSearchSource[] = [];
  const seen = new Set<string>();
  const queries: string[] = [];
  let toolCalls = 0;
  for (const item of json.output ?? []) {
    if (item.type === "web_search_call") {
      toolCalls++;
      if (item.action?.query) queries.push(item.action.query);
      for (const source of item.action?.sources ?? []) {
        if (source.url && !seen.has(source.url)) {
          seen.add(source.url);
          sources.push({ url: source.url, title: source.title ?? null });
        }
      }
    }
    if (item.type === "message") {
      for (const part of item.content ?? []) {
        if (part.type === "output_text" && typeof part.text === "string") {
          text = (text ?? "") + part.text;
          for (const annotation of part.annotations ?? []) {
            if (annotation.type === "url_citation" && annotation.url && !seen.has(annotation.url)) {
              seen.add(annotation.url);
              sources.push({ url: annotation.url, title: annotation.title ?? null });
            }
          }
        }
      }
    }
  }
  return { text, sources, queries, toolCalls };
}

export async function openaiStructured(params: {
  model: string;
  schemaName: string;
  schema: Record<string, unknown>;
  systemInstruction: string;
  userContent: string;
  reasoningEffort?: ReasoningEffort;
  maxOutputTokens?: number;
  timeoutMs: number;
}): Promise<OpenAiCallResult> {
  const body: Record<string, unknown> = {
    model: params.model,
    instructions: params.systemInstruction,
    input: params.userContent,
    text: { format: { type: "json_schema", name: params.schemaName, strict: true, schema: toOpenAiStrictSchema(params.schema) } },
    reasoning: { effort: params.reasoningEffort ?? "low" },
    store: false,
  };
  if (params.maxOutputTokens) body.max_output_tokens = params.maxOutputTokens;
  const result = await postResponses(body, params.timeoutMs);
  if (!result.ok) return { ok: false, error: result.error, model: params.model };
  const { text } = readOutput(result.json);
  const usage = readUsage(result.json);
  const model = result.json.model ?? params.model;
  if (result.json.status === "incomplete") {
    return { ok: false, error: `incomplete:${result.json.incomplete_details?.reason ?? "unknown"}`, model, usage, status: result.json.status };
  }
  if (!text) return { ok: false, error: "empty_response", model, usage, status: result.json.status };
  return { ok: true, text, model, usage, status: result.json.status };
}

export async function openaiWebSearch(params: {
  model: string;
  task: string;
  instructions?: string;
  userLocation?: { country?: string; city?: string; region?: string; timezone?: string };
  contextSize?: "low" | "medium" | "high";
  schema?: Record<string, unknown>;
  schemaName?: string;
  maxOutputTokens?: number;
  timeoutMs: number;
}): Promise<OpenAiCallResult> {
  const tool: Record<string, unknown> = { type: "web_search", search_context_size: params.contextSize ?? "medium" };
  if (params.userLocation && (params.userLocation.country || params.userLocation.city)) {
    tool.user_location = { type: "approximate", ...params.userLocation };
  }
  const body: Record<string, unknown> = {
    model: params.model,
    input: params.task,
    tools: [tool],
    include: ["web_search_call.action.sources"],
    reasoning: { effort: "low" },
    store: false,
  };
  if (params.instructions) body.instructions = params.instructions;
  if (params.schema) {
    body.text = { format: { type: "json_schema", name: params.schemaName ?? "search_result", strict: true, schema: toOpenAiStrictSchema(params.schema) } };
  }
  if (params.maxOutputTokens) body.max_output_tokens = params.maxOutputTokens;
  const result = await postResponses(body, params.timeoutMs);
  if (!result.ok) return { ok: false, error: result.error, model: params.model };
  const { text, sources, queries, toolCalls } = readOutput(result.json);
  const usage = readUsage(result.json);
  if (usage) usage.toolCalls = toolCalls;
  const model = result.json.model ?? params.model;
  if (!text) return { ok: false, error: "empty_response", model, usage, sources, queries, toolCalls };
  return { ok: true, text, model, usage, sources, queries, toolCalls, status: result.json.status };
}

export async function openaiEmbed(params: { model: string; texts: string[]; dimensions?: number; timeoutMs: number }): Promise<{ ok: boolean; vectors: number[][]; error?: string; usage?: LlmUsage }> {
  const key = getCredential("openai");
  if (!key) return { ok: false, vectors: [], error: "openai_api_disabled" };
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), params.timeoutMs);
  try {
    const response = await fetch(EMBEDDINGS_ENDPOINT, {
      method: "POST",
      headers: { "content-type": "application/json", authorization: `Bearer ${key}` },
      body: JSON.stringify({ model: params.model, input: params.texts, ...(params.dimensions ? { dimensions: params.dimensions } : {}) }),
      signal: controller.signal,
    });
    const json = (await response.json().catch(() => ({}))) as { data?: Array<{ index: number; embedding: number[] }>; usage?: { prompt_tokens?: number }; error?: { code?: string; type?: string } };
    if (!response.ok) return { ok: false, vectors: [], error: classifyHttpError(response.status, json.error?.code ?? "", json.error?.type ?? "") };
    const vectors = (json.data ?? []).sort((a, b) => a.index - b.index).map((d) => d.embedding);
    return { ok: vectors.length === params.texts.length, vectors, usage: { inputTokens: json.usage?.prompt_tokens ?? 0, outputTokens: 0 } };
  } catch (error) {
    const aborted = error instanceof Error && error.name === "AbortError";
    return { ok: false, vectors: [], error: aborted ? "timeout" : "network_error" };
  } finally {
    clearTimeout(timer);
  }
}
