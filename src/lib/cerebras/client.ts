// Cerebras free-tier adapter: the ChatGPT lane's preferred automatic route.
//
// Cerebras serves gpt-oss-120b, OpenAI's open-weight model, on an
// OpenAI-compatible endpoint. Like the Groq lane it observes an OpenAI MODEL,
// not the ChatGPT app. Its free tier allows 1M tokens a day at 5 requests a
// minute: roughly five times the daily answers of Groq's free tier, where the
// same model stops at 200K tokens.

import { getCredential } from "@/lib/providers/credentials";
import { parseGroqDuration, type GroqRateLimit, type GroqTextResult } from "@/lib/groq/client";

const ENDPOINT = "https://api.cerebras.ai/v1/chat/completions";
export const CEREBRAS_ADAPTER_VERSION = "cerebras-free-api-adapter@1";

/** OpenAI's open-weight model on Cerebras. One place to change it. */
const MODEL = "gpt-oss-120b";
const REQUEST_TIMEOUT_MS = 60_000;

export type CerebrasTextResult = GroqTextResult;

export function isCerebrasAvailable(): boolean {
  return Boolean(getCredential("cerebras"));
}

/**
 * Reads whichever rate-limit headers a response carries. The header names are
 * not listed in Cerebras' public rate-limit page, so every read is optional and
 * the lane is paced by its own request window rather than by these values. On a
 * 429, a daily reset time stands in for a missing retry-after, so a spent daily
 * quota pauses the lane instead of retrying into it.
 */
function readRateLimit(headers: Headers, limited: boolean): GroqRateLimit {
  const numeric = (...names: string[]) => {
    for (const name of names) {
      const raw = headers.get(name);
      if (raw !== null && Number.isFinite(Number(raw))) return Number(raw);
    }
    return null;
  };
  const duration = (...names: string[]) => {
    for (const name of names) {
      const value = parseGroqDuration(headers.get(name));
      if (value !== null) return value;
    }
    return null;
  };
  return {
    limitTokens: numeric("x-ratelimit-limit-tokens-minute", "x-ratelimit-limit-tokens"),
    remainingTokens: numeric("x-ratelimit-remaining-tokens-minute", "x-ratelimit-remaining-tokens"),
    resetTokensMs: duration("x-ratelimit-reset-tokens-minute", "x-ratelimit-reset-tokens"),
    retryAfterMs: limited ? duration("retry-after", "x-ratelimit-reset-tokens-day", "x-ratelimit-reset-requests-day") : duration("retry-after"),
  };
}

/**
 * Runs one prompt. Never throws: a missing key, timeout, rate limit or provider
 * error all return `{ ok: false }` with a typed reason, so a failed observation
 * stays a coverage gap rather than becoming brand absence.
 */
export async function generateText(params: { systemInstruction: string; userContent: string }): Promise<CerebrasTextResult> {
  const started = Date.now();
  if (!isCerebrasAvailable()) return { ok: false, error: "cerebras_api_disabled", latencyMs: 0, model: MODEL };

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
  try {
    const response = await fetch(ENDPOINT, {
      method: "POST",
      headers: { "content-type": "application/json", authorization: `Bearer ${getCredential("cerebras")}` },
      body: JSON.stringify({
        model: MODEL,
        messages: [
          { role: "system", content: params.systemInstruction },
          { role: "user", content: params.userContent },
        ],
        // The same room for a complete answer as the Groq lane: real answers to
        // these questions run 1,400-2,300 tokens, and a cut-off answer would
        // hide every brand listed after the cut.
        max_completion_tokens: 3000,
        temperature: 0.3,
      }),
      signal: controller.signal,
    });
    clearTimeout(timer);

    if (response.status === 429) {
      return { ok: false, error: "rate_limited", latencyMs: Date.now() - started, model: MODEL, rateLimit: readRateLimit(response.headers, true) };
    }
    // A rejected key or an exhausted balance fails every prompt the same way;
    // named as such, the collection lane pauses instead of failing each one.
    if (response.status === 401 || response.status === 403) {
      return { ok: false, error: "auth_failed", latencyMs: Date.now() - started, model: MODEL, rateLimit: readRateLimit(response.headers, false) };
    }
    if (response.status === 402) {
      return { ok: false, error: "billing_required", latencyMs: Date.now() - started, model: MODEL, rateLimit: readRateLimit(response.headers, false) };
    }
    if (!response.ok) {
      return { ok: false, error: `http_${response.status}`, latencyMs: Date.now() - started, model: MODEL, rateLimit: readRateLimit(response.headers, false) };
    }

    const body = (await response.json()) as { choices?: Array<{ finish_reason?: string; message?: { content?: string } }> };
    const rateLimit = readRateLimit(response.headers, false);
    const text = body.choices?.[0]?.message?.content?.trim();
    if (!text) return { ok: false, error: "empty_response", latencyMs: Date.now() - started, model: MODEL, rateLimit };
    return { ok: true, text, sources: [], searched: false, latencyMs: Date.now() - started, model: MODEL, finishReason: body.choices?.[0]?.finish_reason ?? null, rateLimit };
  } catch (error) {
    clearTimeout(timer);
    const aborted = error instanceof Error && error.name === "AbortError";
    return { ok: false, error: aborted ? "timeout" : "network_error", latencyMs: Date.now() - started, model: MODEL };
  }
}
