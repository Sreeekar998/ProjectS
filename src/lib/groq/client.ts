// Groq free-tier adapter.
//
// This is the OpenAI-family half of automated collection. It is NOT ChatGPT,
// and the difference matters enough to state in code:
//
//   * There is no free route to ChatGPT or to GPT-4o/GPT-5 in 2026. The OpenAI
//     API bills per token, and GitHub Models — which briefly served GPT-4o free
//     — was retired on 30 July 2026 and now returns 410.
//   * What IS free is `openai/gpt-oss-120b`, OpenAI's OPEN-WEIGHT model, served
//     on Groq's free tier with no credit card.
//
// So this route observes an OpenAI *model*, not the OpenAI *product*. Every
// record it writes says so, and nothing in the UI calls it ChatGPT.

import { getCredential } from "@/lib/providers/credentials";

const ENDPOINT = "https://api.groq.com/openai/v1/chat/completions";
export const GROQ_ADAPTER_VERSION = "groq-free-api-adapter@1";

/** OpenAI's open-weight model, free tier eligible. One place to change it. */
const MODEL = "openai/gpt-oss-120b";
const REQUEST_TIMEOUT_MS = 45_000;

export function isGroqAvailable(): boolean {
  return Boolean(getCredential("groq"));
}

export interface GroqTextResult {
  ok: boolean;
  text?: string;
  /** Always empty: this endpoint is an ungrounded chat completion. */
  sources?: Array<{ url: string; title: string | null }>;
  /** Always false — the route has no search capability at all. */
  searched?: boolean;
  error?: string;
  latencyMs: number;
  model: string;
  /**
   * Why generation stopped. "length" means the answer ran into the token cap
   * and is incomplete — an observation that must not be treated as whole.
   */
  finishReason?: string | null;
  /** Groq's own rate-limit report for this response, used to pace the lane. */
  rateLimit?: GroqRateLimit;
}

export interface GroqRateLimit {
  limitTokens: number | null;
  remainingTokens: number | null;
  /** Milliseconds until the per-minute token budget is fully replenished. */
  resetTokensMs: number | null;
  /** Present on a 429: how long Groq asked us to wait. */
  retryAfterMs: number | null;
}

/** Parses Groq's durations: "4.875s", "20m9.6s", "250ms", "1h2m", or bare seconds. */
export function parseGroqDuration(value: string | null): number | null {
  if (!value) return null;
  let total = 0;
  let matched = false;
  for (const match of value.matchAll(/(\d+(?:\.\d+)?)(ms|h|m|s)/g)) {
    matched = true;
    const amount = Number(match[1]);
    total += match[2] === "h" ? amount * 3_600_000 : match[2] === "m" ? amount * 60_000 : match[2] === "s" ? amount * 1000 : amount;
  }
  if (matched) return Math.round(total);
  const seconds = Number(value);
  return Number.isFinite(seconds) ? Math.round(seconds * 1000) : null;
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
    retryAfterMs: parseGroqDuration(headers.get("retry-after")),
  };
}

/**
 * Runs one prompt. Never throws — a missing key, timeout, rate limit or
 * provider error all return `{ ok: false }` with a typed reason, so a failed
 * observation stays a coverage gap rather than becoming brand absence.
 */
export async function generateText(params: { systemInstruction: string; userContent: string }): Promise<GroqTextResult> {
  const started = Date.now();
  if (!isGroqAvailable()) return { ok: false, error: "groq_api_disabled", latencyMs: 0, model: MODEL };

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
  try {
    const response = await fetch(ENDPOINT, {
      method: "POST",
      headers: { "content-type": "application/json", authorization: `Bearer ${getCredential("groq")}` },
      body: JSON.stringify({
        model: MODEL,
        messages: [
          { role: "system", content: params.systemInstruction },
          { role: "user", content: params.userContent },
        ],
        // Room for a COMPLETE answer. At 1,200 tokens half of all gpt-oss answers
        // were cut off mid-table — measured uncapped, real answers to these
        // questions run 1,400-2,300 tokens — so brands listed after the cut were
        // silently missing from every presence metric while the capture was
        // recorded as whole. Groq meters actual usage rather than this ceiling,
        // so the higher cap costs nothing on shorter answers.
        max_completion_tokens: 3000,
        temperature: 0.3,
      }),
      signal: controller.signal,
    });
    clearTimeout(timer);

    if (response.status === 429) {
      return { ok: false, error: "rate_limited", latencyMs: Date.now() - started, model: MODEL, rateLimit: readRateLimit(response.headers) };
    }
    // A rejected key or an exhausted balance fails every prompt the same way;
    // named as such, the collection lane pauses instead of failing each one.
    if (response.status === 401 || response.status === 403) {
      return { ok: false, error: "auth_failed", latencyMs: Date.now() - started, model: MODEL, rateLimit: readRateLimit(response.headers) };
    }
    if (response.status === 402) {
      return { ok: false, error: "billing_required", latencyMs: Date.now() - started, model: MODEL, rateLimit: readRateLimit(response.headers) };
    }
    if (!response.ok) {
      return { ok: false, error: `http_${response.status}`, latencyMs: Date.now() - started, model: MODEL, rateLimit: readRateLimit(response.headers) };
    }

    const body = (await response.json()) as { choices?: Array<{ finish_reason?: string; message?: { content?: string } }> };
    const rateLimit = readRateLimit(response.headers);
    const text = body.choices?.[0]?.message?.content?.trim();
    if (!text) return { ok: false, error: "empty_response", latencyMs: Date.now() - started, model: MODEL, rateLimit };
    return { ok: true, text, latencyMs: Date.now() - started, model: MODEL, finishReason: body.choices?.[0]?.finish_reason ?? null, rateLimit };
  } catch (error) {
    clearTimeout(timer);
    const aborted = error instanceof Error && error.name === "AbortError";
    return { ok: false, error: aborted ? "timeout" : "network_error", latencyMs: Date.now() - started, model: MODEL };
  }
}
