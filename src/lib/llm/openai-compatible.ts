// Groq / Cerebras adapter: OpenAI-compatible chat completions with JSON output.
//
// Both free tiers serve open-weight models over the chat-completions shape.
// `response_format: json_schema` is attempted first; when a model rejects it
// the call is repeated in plain `json_object` mode with the schema pasted into
// the system prompt, and the caller's validator decides whether the result is
// usable. These are the keyless-cost fallback, not the primary route.

import { getCredential } from "@/lib/providers/credentials";
import type { LlmProviderId, LlmUsage } from "./types";
import { toPlainJsonSchema } from "./schema";

const ENDPOINTS: Record<"groq" | "cerebras", string> = {
  groq: "https://api.groq.com/openai/v1/chat/completions",
  cerebras: "https://api.cerebras.ai/v1/chat/completions",
};

export interface CompatibleCallResult {
  ok: boolean;
  text?: string;
  error?: string;
  model: string;
  usage?: LlmUsage;
}

function classifyHttpError(status: number, code: string): string {
  if (status === 429) return "rate_limited";
  if (status === 401 || status === 403) return "auth_failed";
  if (status === 404 || /model/i.test(code)) return "model_unavailable";
  if (status === 400) return `bad_request:${code || "unknown"}`;
  if (status >= 500) return `provider_error:${status}`;
  return `http_${status}`;
}

export async function compatibleStructured(params: {
  provider: Extract<LlmProviderId, "groq" | "cerebras">;
  model: string;
  schemaName: string;
  schema: Record<string, unknown>;
  systemInstruction: string;
  userContent: string;
  temperature?: number;
  maxOutputTokens?: number;
  timeoutMs: number;
}): Promise<CompatibleCallResult> {
  const key = getCredential(params.provider);
  if (!key) return { ok: false, error: `${params.provider}_api_disabled`, model: params.model };

  const attempt = async (mode: "json_schema" | "json_object"): Promise<CompatibleCallResult & { status?: number; code?: string }> => {
    const schemaNote = mode === "json_object" ? `\n\nReturn ONLY a JSON object matching this JSON Schema exactly:\n${JSON.stringify(toPlainJsonSchema(params.schema))}` : "";
    const body: Record<string, unknown> = {
      model: params.model,
      messages: [
        { role: "system", content: `${params.systemInstruction}${schemaNote}` },
        { role: "user", content: params.userContent },
      ],
      temperature: params.temperature ?? 0.2,
      max_completion_tokens: params.maxOutputTokens ?? 4000,
      response_format:
        mode === "json_schema"
          ? { type: "json_schema", json_schema: { name: params.schemaName, schema: toPlainJsonSchema(params.schema), strict: false } }
          : { type: "json_object" },
    };
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), params.timeoutMs);
    try {
      const response = await fetch(ENDPOINTS[params.provider], {
        method: "POST",
        headers: { "content-type": "application/json", authorization: `Bearer ${key}` },
        body: JSON.stringify(body),
        signal: controller.signal,
      });
      const json = (await response.json().catch(() => ({}))) as {
        model?: string;
        error?: { code?: string; type?: string; message?: string };
        choices?: Array<{ message?: { content?: string | null }; finish_reason?: string }>;
        usage?: { prompt_tokens?: number; completion_tokens?: number };
      };
      if (!response.ok) {
        const code = json.error?.code ?? json.error?.type ?? "";
        return { ok: false, error: `${classifyHttpError(response.status, code)}${json.error?.message ? `:${json.error.message.slice(0, 120)}` : ""}`, model: params.model, status: response.status, code };
      }
      const text = json.choices?.[0]?.message?.content?.trim();
      const usage = json.usage ? { inputTokens: json.usage.prompt_tokens ?? 0, outputTokens: json.usage.completion_tokens ?? 0 } : undefined;
      if (!text) return { ok: false, error: "empty_response", model: json.model ?? params.model, usage };
      return { ok: true, text, model: json.model ?? params.model, usage };
    } catch (error) {
      const aborted = error instanceof Error && error.name === "AbortError";
      return { ok: false, error: aborted ? "timeout" : "network_error", model: params.model };
    } finally {
      clearTimeout(timer);
    }
  };

  const first = await attempt("json_schema");
  if (first.ok) return first;
  // A 400 on the response_format is the model saying it lacks schema mode;
  // any other failure (rate limit, auth) is returned as-is.
  if (first.status === 400) return attempt("json_object");
  return first;
}
