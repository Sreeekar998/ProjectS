// OpenAI API adapter: the ChatGPT lane's paid route.
//
// Each question goes to gpt-5-nano through the Chat Completions endpoint. This
// is an OpenAI GPT model, the family behind ChatGPT, but it is still the API
// rather than the ChatGPT app: it does not search the web here, so answers
// carry no sources. It bills per token, roughly a tenth of a cent per answer.

import { clearProviderSuspension } from "@/lib/llm/suspension";
import { getCredential } from "@/lib/providers/credentials";
import { parseGroqDuration, type GroqRateLimit, type GroqTextResult } from "@/lib/groq/client";

const ENDPOINT = "https://api.openai.com/v1/chat/completions";
export const OPENAI_ADAPTER_VERSION = "openai-api-adapter@1";

/** The model the ChatGPT lane asks. One place to change it. */
const MODEL = "gpt-5-nano";
const REQUEST_TIMEOUT_MS = 90_000;

export type OpenAITextResult = GroqTextResult;

export function isOpenAIAvailable(): boolean {
  return Boolean(getCredential("openai"));
}

function readRateLimit(headers: Headers): GroqRateLimit {
  const numeric = (name: string) => {
    const raw = headers.get(name);
    const value = raw === null ? Number.NaN : Number(raw);
    return Number.isFinite(value) ? value : null;
  };
  return {
    limitTokens: numeric("x-ratelimit-limit-tokens"),
    remainingTokens: numeric("x-ratelimit-remaining-tokens"),
    resetTokensMs: parseGroqDuration(headers.get("x-ratelimit-reset-tokens")),
    retryAfterMs: parseGroqDuration(headers.get("retry-after")) ?? parseGroqDuration(headers.get("x-ratelimit-reset-requests")),
  };
}

/** An OpenAI error that means the account has no credits, whichever field carries it. */
export function isEmptyBalance(error: { code?: string | null; type?: string | null } | null | undefined): boolean {
  return [error?.code, error?.type].some((value) => value === "insufficient_quota" || value === "credit_balance_exhausted");
}

/**
 * Runs one prompt. Never throws: a missing key, empty balance, timeout, rate
 * limit or provider error all return `{ ok: false }` with a typed reason, so a
 * failed observation stays a coverage gap rather than becoming brand absence.
 */
export async function generateText(params: { systemInstruction: string; userContent: string }): Promise<OpenAITextResult> {
  const started = Date.now();
  if (!isOpenAIAvailable()) return { ok: false, error: "openai_api_disabled", latencyMs: 0, model: MODEL };

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
  try {
    const response = await fetch(ENDPOINT, {
      method: "POST",
      headers: { "content-type": "application/json", authorization: `Bearer ${getCredential("openai")}` },
      body: JSON.stringify({
        model: MODEL,
        messages: [
          { role: "system", content: params.systemInstruction },
          { role: "user", content: params.userContent },
        ],
        // The model's hidden reasoning is counted against this cap before the
        // visible answer, so it sits well above the 1,200-2,200 tokens that real
        // answers to these questions take. Temperature is left at the default.
        max_completion_tokens: 6000,
      }),
      signal: controller.signal,
    });
    clearTimeout(timer);
    const latencyMs = () => Date.now() - started;

    if (!response.ok) {
      const body = (await response.json().catch(() => ({}))) as { error?: { code?: string | null; type?: string | null } };
      const code = body.error?.code ?? body.error?.type ?? "";
      const rateLimit = readRateLimit(response.headers);
      // An empty prepaid balance also arrives as a 429. Retrying cannot fix it,
      // so it is reported as its own permanent failure, not as a rate limit.
      // OpenAI now sends code "credit_balance_exhausted" with type
      // "insufficient_quota"; reading the code alone filed an empty balance as a
      // rate limit, and the console said OpenAI was "limiting requests for a moment".
      if (isEmptyBalance(body.error) || response.status === 402) return { ok: false, error: "billing_required", latencyMs: latencyMs(), model: MODEL, rateLimit };
      if (response.status === 429) return { ok: false, error: "rate_limited", latencyMs: latencyMs(), model: MODEL, rateLimit };
      if (response.status === 401) return { ok: false, error: "auth_failed", latencyMs: latencyMs(), model: MODEL, rateLimit };
      if (response.status === 404 || code === "model_not_found") return { ok: false, error: "model_unavailable", latencyMs: latencyMs(), model: MODEL, rateLimit };
      return { ok: false, error: `http_${response.status}`, latencyMs: latencyMs(), model: MODEL, rateLimit };
    }

    const body = (await response.json()) as { model?: string; choices?: Array<{ finish_reason?: string; message?: { content?: string | null } }> };
    const rateLimit = readRateLimit(response.headers);
    // The evidence records the exact snapshot OpenAI says answered, e.g. "gpt-5-nano-2025-08-07".
    const model = body.model ?? MODEL;
    const text = body.choices?.[0]?.message?.content?.trim();
    if (!text) return { ok: false, error: "empty_response", latencyMs: latencyMs(), model, finishReason: body.choices?.[0]?.finish_reason ?? null, rateLimit };
    // A working OpenAI account lifts the routed layer's skip at once (see llm/suspension.ts).
    clearProviderSuspension("openai");
    return { ok: true, text, sources: [], searched: false, latencyMs: latencyMs(), model, finishReason: body.choices?.[0]?.finish_reason ?? null, rateLimit };
  } catch (error) {
    clearTimeout(timer);
    const aborted = error instanceof Error && error.name === "AbortError";
    return { ok: false, error: aborted ? "timeout" : "network_error", latencyMs: Date.now() - started, model: MODEL };
  }
}
