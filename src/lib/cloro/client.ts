// cloro — POST /v1/monitor/chatgpt and /v1/monitor/gemini.
//
// What it does (cloro's docs, verbatim): "cloro does not call the ChatGPT API.
// Each request runs through a real browser session against ChatGPT's web
// interface, routed through a proxy" in the requested country, using
// "logged-out sessions — no account of any kind". Web search is on for every
// ChatGPT request unless disabled. The response is the page's text, markdown,
// a 24-hour URL to the rendered HTML, the sources panel with positions, the
// inline citation pills and, optionally, the search queries the assistant ran
// (https://cloro.dev/docs/api-reference/endpoint/monitor-chatgpt).
//
// Mechanics: synchronous, typically 30–45 s, five-minute maximum. cloro meters
// concurrent jobs per key (one on the free tier), and this one key serves both
// the ChatGPT and the Gemini lane, so a process-wide gate below keeps the two
// lanes inside the limit instead of trading 429s.
//
// Honesty notes baked in:
//   * `model` is empty on almost every response since ChatGPT's mobile-web
//     format (cloro changelog, August 2026); it is stored as unknown, never
//     guessed.
//   * A `success: true` response with no sources and a body under ~160
//     characters is cloro's own definition of a blank answer, and it is billed;
//     it is returned here as `empty_response` so the lane retries it once and
//     never counts it as an observation.
//   * The rendered HTML is fetched from cloro's URL while it is valid and kept
//     as evidence; failure to fetch it never fails the observation.

import { getCredential } from "@/lib/providers/credentials";
import {
  answerLooksEmpty,
  asRecord,
  asString,
  asStringArray,
  failureFromException,
  fetchHtmlSnapshot,
  fetchWithTimeout,
  normalizeCountry,
  numericHeader,
  readJson,
  Semaphore,
  stripImageMarkdown,
  uniqueSources,
  urlHasSiteUtm,
  type ConsumerAnswer,
  type ConsumerCollector,
  type ConsumerFailure,
  type ConsumerRequest,
  type ConsumerResult,
  type ConsumerSite,
  type ConsumerSource,
} from "@/lib/collection/consumer-collector";
import type { AnswerEngine } from "@/lib/providers/engines";

export const CLORO_ADAPTER_VERSION = "cloro-consumer-adapter@1";

const VENDOR = "cloro" as const;
// cloro's hard maximum is five minutes; a little over so their timeout arrives first.
const REQUEST_TIMEOUT_MS = 5.5 * 60_000;

function baseUrl(): string {
  return (process.env.SUN_CLORO_BASE_URL ?? "https://api.cloro.dev").replace(/\/$/, "");
}

/** Concurrent jobs the account allows: 1 on the free tier, 10 on Lite. */
function concurrencyLimit(): number {
  const raw = Number(process.env.SUN_CLORO_CONCURRENCY);
  return Number.isFinite(raw) && raw >= 1 ? Math.floor(raw) : 1;
}

/** Search queries cost two extra credits per answer; off by default to stretch the free tier. */
function includeSearchQueries(): boolean {
  return process.env.SUN_CLORO_SEARCH_QUERIES === "1";
}

// Module state, like the Gemini client's search memo: one gate per process.
let gate: Semaphore | null = null;
let gateLimit = 0;
function acquireGate(): Promise<() => void> {
  const limit = concurrencyLimit();
  if (!gate || gateLimit !== limit) {
    gate = new Semaphore(limit);
    gateLimit = limit;
  }
  return gate.acquire();
}

export function isCloroAvailable(): boolean {
  return Boolean(getCredential("cloro"));
}

function failure(error: string, startedAt: number, extra: Partial<ConsumerFailure> = {}): ConsumerFailure {
  return { ok: false, vendor: VENDOR, error, latencyMs: Date.now() - startedAt, retryAfterMs: null, permanent: false, ...extra };
}

function creditsOf(headers: Headers): { charged: number | null; remaining: number | null } {
  return { charged: numericHeader(headers, "x-credits-charged"), remaining: numericHeader(headers, "x-credits-remaining") };
}

async function httpFailure(response: Response, startedAt: number): Promise<ConsumerFailure> {
  const body = await readJson(response);
  const record = asRecord(body);
  const errorObject = record ? asRecord(record.error) : null;
  const code = errorObject ? asString(errorObject.code) : typeof record?.error === "string" ? record.error : null;
  const detail = (errorObject ? asString(errorObject.message) : null) ?? JSON.stringify(body ?? "").slice(0, 200);
  const credits = creditsOf(response.headers);
  if (response.status === 401) return failure("auth_failed", startedAt, { permanent: true, detail, credits });
  if (response.status === 403) {
    return failure(code === "INSUFFICIENT_CREDITS" ? "billing_required" : "auth_failed", startedAt, { permanent: true, detail: `${code ?? ""} ${detail}`.trim(), credits });
  }
  if (response.status === 429) {
    // No Retry-After on cloro's 429s; the rate window is one second, the
    // concurrency window clears when a job finishes. Twenty seconds is a safe
    // default for either.
    return failure("rate_limited", startedAt, { retryAfterMs: 20_000, detail: `${code ?? ""} ${detail}`.trim(), credits });
  }
  if (response.status === 502 || response.status === 503 || response.status === 504) {
    // 502 EXTERNAL_SERVICE_ERROR is the upstream site failing or blocking.
    return failure("target_blocked", startedAt, { detail: `${code ?? ""} ${detail}`.trim(), credits });
  }
  if (response.status >= 500) return failure(`provider_error: http_${response.status}`, startedAt, { detail, credits });
  return failure(`http_${response.status}`, startedAt, { permanent: response.status >= 400 && response.status < 500, detail: `${code ?? ""} ${detail}`.trim(), credits });
}

function siteFor(engine: AnswerEngine): ConsumerSite {
  return engine === "gemini" ? "gemini.google.com" : "chatgpt.com";
}

/** Maps cloro's `result` into a ConsumerAnswer. Exported for tests. */
export function answerFromResult(result: unknown, request: ConsumerRequest, startedAt: number, meta: { credits: ConsumerAnswer["credits"]; requestId: string | null; html: string | null }): ConsumerResult {
  const row = asRecord(result);
  if (!row) return failure("schema_unrecognised", startedAt, { permanent: true, detail: "result is not an object" });
  const text = asString(row.text);
  const schemaKnown = text !== null && Array.isArray(row.sources);
  if (!schemaKnown) return failure("schema_unrecognised", startedAt, { permanent: true, detail: `keys: ${Object.keys(row).slice(0, 12).join(",")}` });

  const site = siteFor(request.engine);
  const sources: ConsumerSource[] = [];
  for (const item of row.sources as unknown[]) {
    const s = asRecord(item);
    const url = s ? asString(s.url) : null;
    if (url) sources.push({ url, title: s ? asString(s.label) : null, position: s && typeof s.position === "number" ? s.position : null, kind: "citation" });
  }
  for (const item of Array.isArray(row.citationPills) ? row.citationPills : []) {
    const p = asRecord(item);
    const url = p ? asString(p.url) : null;
    if (url) sources.push({ url, title: p ? asString(p.label) : null, position: p && typeof p.position === "number" ? p.position : null, kind: "inline_link" });
  }
  const deduped = uniqueSources(sources);
  const searchQueries = asStringArray(row.searchQueries);
  const markdown = asString(row.markdown);
  const body = stripImageMarkdown(markdown && markdown.trim().length > 0 ? markdown : text ?? "");
  const citationCount = deduped.filter((source) => source.kind === "citation").length;
  if (answerLooksEmpty(body, citationCount)) return failure("empty_response", startedAt, { detail: body.slice(0, 120), credits: meta.credits });

  const searched = citationCount > 0 || searchQueries.length > 0 ? true : null;
  const answer: ConsumerAnswer = {
    ok: true,
    vendor: VENDOR,
    engine: request.engine,
    site,
    text: body,
    markdown,
    model: asString(row.model) || null,
    searched,
    // cloro forces ChatGPT's web search on unless told otherwise; Gemini's page
    // decides for itself and cloro does not report which.
    searchMode: request.engine === "chatgpt" ? "forced" : "unknown",
    sources: deduped,
    searchQueries,
    country: request.country,
    latencyMs: Date.now() - startedAt,
    credits: meta.credits,
    // A sources array is part of cloro's schema, not proof of the site; the
    // queries the assistant ran, the utm tag on cited links and the rendered
    // page are.
    markers: {
      siteUrl: false,
      siteUtm: deduped.some((source) => urlHasSiteUtm(source.url, site)),
      pageHtml: Boolean(meta.html),
      searchMetadata: searchQueries.length > 0,
      schemaKnown,
    },
    rawPayload: result,
    html: meta.html,
    vendorRequestId: meta.requestId,
  };
  return answer;
}

/**
 * Asks ChatGPT or Gemini one prompt through cloro. Never throws.
 */
export async function collect(request: ConsumerRequest): Promise<ConsumerResult> {
  const startedAt = Date.now();
  if (!isCloroAvailable()) return failure("cloro_disabled", startedAt, { permanent: true });
  if (request.engine !== "chatgpt" && request.engine !== "gemini") return failure("engine_unsupported", startedAt, { permanent: true });

  const country = normalizeCountry(request.country) ?? "US";
  const payload = {
    prompt: request.prompt,
    country,
    include: { markdown: true, html: true, ...(request.engine === "chatgpt" && includeSearchQueries() ? { searchQueries: true } : {}) },
  };
  const release = await acquireGate();
  try {
    let response: Response;
    try {
      response = await fetchWithTimeout(
        `${baseUrl()}/v1/monitor/${request.engine}`,
        { method: "POST", headers: { authorization: `Bearer ${getCredential("cloro")}`, "content-type": "application/json" }, body: JSON.stringify(payload) },
        REQUEST_TIMEOUT_MS,
      );
    } catch (error) {
      return failureFromException(VENDOR, error, startedAt);
    }
    if (!response.ok) return httpFailure(response, startedAt);

    const body = asRecord(await readJson(response));
    if (!body || body.success !== true) {
      return failure(`provider_error: ${asString(body?.error) ?? "unsuccessful"}`, startedAt, { detail: JSON.stringify(body ?? "").slice(0, 200), credits: creditsOf(response.headers) });
    }
    const result = asRecord(body.result);
    const htmlUrl = result ? asString(result.html) : null;
    const html = htmlUrl && /^https?:\/\//i.test(htmlUrl) ? await fetchHtmlSnapshot(htmlUrl) : null;
    return answerFromResult(body.result, { ...request, country }, startedAt, { credits: creditsOf(response.headers), requestId: response.headers.get("x-request-id"), html });
  } finally {
    release();
  }
}

/** Credits left on the key, for the budget guard. Null when the vendor or the network does not say. */
export async function creditsRemaining(): Promise<number | null> {
  if (!isCloroAvailable()) return null;
  try {
    const response = await fetchWithTimeout(`${baseUrl()}/v1/credits`, { method: "GET", headers: { authorization: `Bearer ${getCredential("cloro")}` } }, 15_000);
    if (!response.ok) return null;
    const body = asRecord(await readJson(response));
    const candidates = [body?.remaining, body?.credits, body?.balance, asRecord(body?.data)?.remaining, asRecord(body?.credits)?.remaining];
    const value = candidates.find((item) => typeof item === "number");
    return typeof value === "number" ? value : null;
  } catch {
    return null;
  }
}

export const cloroCollector: ConsumerCollector = {
  vendor: VENDOR,
  adapterVersion: CLORO_ADAPTER_VERSION,
  isAvailable: isCloroAvailable,
  supports: (engine) => engine === "chatgpt" || engine === "gemini",
  collect,
};
