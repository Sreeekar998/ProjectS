import { GoogleGenAI } from "@google/genai";
import { isGeminiApiAvailable } from "@/lib/providers/capability-gates";
import { getCredential } from "@/lib/providers/credentials";

export const GEMINI_ADAPTER_VERSION = "gemini-free-api-adapter@1";
// A floating alias, chosen against my own first instinct.
//
// Pinning a version is better for reproducibility, and that is what I tried
// first. It does not survive contact with this provider: `gemini-2.0-flash` is
// retired outright, and `gemini-2.5-flash` returns "no longer available to new
// users" — a pinned name can stop working for a NEW key while still appearing
// in the model list. Two dead pins in one session is enough evidence.
//
// The alias keeps collection working; reproducibility is preserved a different
// way, because the resolved model is recorded on every single observation, so a
// change shows up in the evidence rather than silently shifting a series.
//
// Flash-LITE specifically. The full Flash model has a free daily quota small
// enough that a single 30-prompt run exhausts it and every later request
// returns 429, while Flash-Lite answers the same prompts comfortably inside the
// free tier. Picking the bigger model would have meant a tool that only works
// once a day.
const MODEL = "gemini-flash-lite-latest";
const REQUEST_TIMEOUT_MS = 20_000;

let client: GoogleGenAI | null = null;
let activeKey: string | null = null;
function getClient(): GoogleGenAI | null {
  if (!isGeminiApiAvailable()) return null;
  // Rebuilt when the key changes, so pasting one in the UI takes effect at
  // once rather than on the next server restart.
  const key = getCredential("gemini")!;
  if (!client || activeKey !== key) {
    client = new GoogleGenAI({ apiKey: key });
    activeKey = key;
  }
  return client;
}

export interface GeminiStructuredResult<T> {
  ok: boolean;
  data?: T;
  rawText?: string;
  error?: string;
  latencyMs: number;
  model: string;
}

/**
 * Calls Gemini for structured JSON output. Never throws — every failure
 * mode (no key, network error, timeout, malformed JSON, safety block)
 * returns `{ ok: false }` so callers always have a deterministic fallback
 * path available, per the hard "must not crash without the key" rule.
 */
export async function generateStructuredJson<T>(params: {
  systemInstruction: string;
  userContent: string;
  responseSchema: Record<string, unknown>;
  /** Higher for generative tasks that need variety; low for extraction. */
  temperature?: number;
  /** Longer for calls that return many items. */
  timeoutMs?: number;
}): Promise<GeminiStructuredResult<T>> {
  const started = Date.now();
  const gemini = getClient();
  if (!gemini) {
    return { ok: false, error: "gemini_api_disabled", latencyMs: 0, model: MODEL };
  }
  try {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), params.timeoutMs ?? REQUEST_TIMEOUT_MS);
    const response = await gemini.models.generateContent({
      model: MODEL,
      contents: params.userContent,
      config: {
        systemInstruction: params.systemInstruction,
        responseMimeType: "application/json",
        responseSchema: params.responseSchema,
        temperature: params.temperature ?? 0.2,
        abortSignal: controller.signal,
      },
    });
    clearTimeout(timer);
    const text = response.text ?? "";
    try {
      const data = JSON.parse(text) as T;
      return { ok: true, data, rawText: text, latencyMs: Date.now() - started, model: MODEL };
    } catch {
      return { ok: false, error: "malformed_json_response", rawText: text.slice(0, 500), latencyMs: Date.now() - started, model: MODEL };
    }
  } catch (err) {
    const message = (err as Error).message ?? "unknown_error";
    const rateLimited = /429|quota|rate/i.test(message);
    return { ok: false, error: rateLimited ? "rate_limited" : `request_failed:${message.slice(0, 150)}`, latencyMs: Date.now() - started, model: MODEL };
  }
}

export interface GroundedSource {
  url: string;
  title: string | null;
}

export interface GeminiTextResult {
  /** Pages the model actually cited, when grounding was on. */
  sources?: GroundedSource[];
  /** Whether a web search actually ran for this answer. */
  searched?: boolean;
  /** Why generation stopped; "MAX_TOKENS" means the answer is incomplete. */
  finishReason?: string | null;
  /** On a 429, how long the provider asked us to wait, when it said. */
  retryAfterMs?: number | null;
  ok: boolean;
  text?: string;
  error?: string;
  latencyMs: number;
  model: string;
}

/**
 * Whether this key refused web search during the current collection run.
 *
 * A key with no search allowance was spending two requests on every answer: a
 * refused search, then the plain question. Once search is refused, the rest of
 * the run asks plainly. Each new run checks again with its first answers, so
 * turning on billing takes effect on the next Collect, with nothing to wait for.
 */
let searchUnavailable = false;

/** Called when a collection run starts, so its first answers check search again. */
export function recheckSearchAllowance(): void {
  searchUnavailable = false;
}

/**
 * Runs one prompt, preferring a grounded answer and falling back if grounding
 * is not available on this key.
 *
 * Search grounding is billed separately from tokens, and a plain free key has
 * no grounding quota at all — the request comes back RESOURCE_EXHAUSTED while
 * the identical ungrounded request succeeds. Failing the whole observation over
 * that would trade every answer for citations we cannot have, so grounding is
 * attempted and quietly dropped when the quota says no. Whether it actually
 * happened is recorded per observation, never assumed.
 */
export async function generateTextWithGroundingFallback(params: {
  systemInstruction: string;
  userContent: string;
  grounded?: boolean;
}): Promise<GeminiTextResult> {
  let searchRefused = false;
  if (params.grounded && !searchUnavailable) {
    const grounded = await withRetry(() => generateText(params));
    if (grounded.ok) return grounded;
    const quotaBlocked = /rate_limited|RESOURCE_EXHAUSTED|quota/i.test(grounded.error ?? "");
    if (!quotaBlocked) return grounded;
    searchRefused = true;
  }
  const plain = await withRetry(() => generateText({ ...params, grounded: false }));
  // Refused with search yet answered without it: this key has no search
  // allowance. When the plain question is refused too, it is an ordinary rate
  // limit, and search stays worth trying.
  if (searchRefused && plain.ok) searchUnavailable = true;
  return plain;
}

/** Transient provider-side conditions worth another attempt. */
function isTransient(error: string | undefined): boolean {
  return /503|UNAVAILABLE|high demand|overloaded|network_error|timeout/i.test(error ?? "");
}

/**
 * Retries a call while the provider reports congestion.
 *
 * The free tier is shared capacity and returns 503 "experiencing high demand"
 * under load. Recording that as a failed observation would understate coverage
 * for a reason that has nothing to do with the brand being measured, so it is
 * waited out — with a ceiling, so a genuinely down provider still surfaces.
 */
async function withRetry(call: () => Promise<GeminiTextResult>): Promise<GeminiTextResult> {
  const backoffMs = [1500, 4000, 9000];
  let result = await call();
  for (const wait of backoffMs) {
    if (result.ok || !isTransient(result.error)) return result;
    await new Promise((resolve) => setTimeout(resolve, wait));
    result = await call();
  }
  return result;
}

export async function generateText(params: {
  systemInstruction: string;
  userContent: string;
  /**
   * Enable Google Search grounding.
   *
   * This is what makes an API observation resemble a consumer answer: the
   * model actually searches, and the response carries the pages it used. It is
   * also the only lawful way we can get citations at all — the consumer apps
   * cannot be automated, and an ungrounded chat completion returns no sources
   * whatsoever, which would leave every citation metric permanently N/A.
   *
   * Search grounding has its own free allowance separate from token quota.
   */
  grounded?: boolean;
}): Promise<GeminiTextResult> {
  const started = Date.now();
  const gemini = getClient();
  if (!gemini) return { ok: false, error: "gemini_api_disabled", latencyMs: 0, model: MODEL };
  try {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
    const response = await gemini.models.generateContent({
      model: MODEL,
      contents: params.userContent,
      config: {
        systemInstruction: params.systemInstruction,
        temperature: 0.3,
        abortSignal: controller.signal,
        ...(params.grounded ? { tools: [{ googleSearch: {} }] } : {}),
      },
    });
    clearTimeout(timer);

    const text = response.text?.trim();
    if (!text) return { ok: false, error: "empty_response", latencyMs: Date.now() - started, model: MODEL };

    // Grounding metadata is where the cited pages live. Absent metadata on a
    // grounded request means the model chose not to search — a real fact about
    // the answer, not a capture failure, so it is reported as such.
    const metadata = response.candidates?.[0]?.groundingMetadata;
    const chunks = metadata?.groundingChunks ?? [];
    const sources: GroundedSource[] = [];
    const seen = new Set<string>();
    for (const chunk of chunks) {
      const uri = chunk.web?.uri;
      if (!uri || seen.has(uri)) continue;
      seen.add(uri);
      sources.push({ url: uri, title: chunk.web?.title ?? null });
    }

    return {
      ok: true,
      text,
      latencyMs: Date.now() - started,
      model: MODEL,
      sources,
      searched: params.grounded ? (metadata?.webSearchQueries?.length ?? 0) > 0 || sources.length > 0 : false,
      finishReason: (response.candidates?.[0]?.finishReason as string | undefined) ?? null,
    };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    if (/429|quota|rate limit/i.test(message)) {
      // Gemini states its own back-off, as `"retryDelay": "23s"` in the error
      // details or "Please retry in 23.4s" in the message. Honouring it beats
      // guessing, which either wastes time or burns another request.
      const retry = /retry(?:Delay)?["\s:]*(?:in\s*)?"?(\d+(?:\.\d+)?)s/i.exec(message);
      return { ok: false, error: "rate_limited", latencyMs: Date.now() - started, model: MODEL, retryAfterMs: retry ? Math.round(Number(retry[1]) * 1000) : null };
    }
    // Keep the provider's own wording. A retired model, a rejected tool config
    // and a dropped connection are different problems, and flattening them all
    // to "network_error" cost real debugging time.
    const detail = message.replace(/\s+/g, " ").slice(0, 180);
    if (/not found|not supported|NOT_FOUND|404/i.test(message)) {
      return { ok: false, error: `model_unavailable: ${detail}`, latencyMs: Date.now() - started, model: MODEL };
    }
    if (/API key|PERMISSION_DENIED|401|403/i.test(message)) {
      return { ok: false, error: `auth_failed: ${detail}`, latencyMs: Date.now() - started, model: MODEL };
    }
    return { ok: false, error: `provider_error: ${detail}`, latencyMs: Date.now() - started, model: MODEL };
  }
}
