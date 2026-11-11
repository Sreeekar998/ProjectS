// Decodo (formerly Smartproxy) — Web Scraping API, target "chatgpt".
//
// What it does: "A browser session renders the chat interface, rotating IPs
// keep you unblocked" (decodo.com/scraping/chatgpt). With `parse: true` the
// response carries the model the page named, the answer as text and
// markdown, the citations, the search queries the assistant ran and the raw
// event stream (https://help.decodo.com/docs/web-scraping-api-chatgpt).
//
// Payload facts learned with a real key on 2026-09-15:
//   * The parsed answer sits under `results[0].content.results` (a nested
//     `results`), with `llm_model` populated ("gpt-5-6") — the only vendor
//     that reported the model.
//   * A request with `geo` (as "IN", "India" or "United States") failed every
//     time with status 613 "We were not able to scrape the target …";
//     without `geo` it succeeded, but through an arbitrary exit (a Vietnamese
//     one, judging by the cited sites). `geo` is therefore sent only when
//     SUN_DECODO_GEO=1, and an answer collected without it carries no
//     country: the row records the origin as unknown rather than claiming
//     the market country.
//   * A failure can arrive as HTTP 200 or 400 with `{"status":"failed",
//     "status_code":613,…}`; it is a target failure (retry, breaker), not a
//     schema change.
//   * One request takes about two minutes.
//
// Not done here: a screenshot. `headless: "png"` is a second, separate
// ChatGPT conversation, so it would not picture the answer that was parsed.

import { getCredential } from "@/lib/providers/credentials";
import {
  answerLooksEmpty,
  asRecord,
  asString,
  asStringArray,
  failureFromException,
  fetchWithTimeout,
  normalizeCountry,
  readJson,
  retryAfterMs,
  stripImageMarkdown,
  uniqueSources,
  urlHasSiteUtm,
  type ConsumerAnswer,
  type ConsumerCollector,
  type ConsumerFailure,
  type ConsumerRequest,
  type ConsumerResult,
  type ConsumerSource,
} from "@/lib/collection/consumer-collector";

export const DECODO_ADAPTER_VERSION = "decodo-consumer-adapter@2";

const VENDOR = "decodo" as const;
const REQUEST_TIMEOUT_MS = 240_000;

function baseUrl(): string {
  return (process.env.SUN_DECODO_BASE_URL ?? "https://scraper-api.decodo.com").replace(/\/$/, "");
}

/** Whether to send `geo`. Off by default: every geo-targeted ChatGPT request failed on 2026-09-15. */
function sendGeo(): boolean {
  return process.env.SUN_DECODO_GEO === "1";
}

export function isDecodoAvailable(): boolean {
  return Boolean(getCredential("decodo"));
}

/** The dashboard token is already base64; a pasted user:password pair is encoded here. */
export function basicAuthValue(credential: string): string {
  const trimmed = credential.trim();
  if (trimmed.includes(":")) return Buffer.from(trimmed, "utf8").toString("base64");
  return trimmed.replace(/^Basic\s+/i, "");
}

function failure(error: string, startedAt: number, extra: Partial<ConsumerFailure> = {}): ConsumerFailure {
  return { ok: false, vendor: VENDOR, error, latencyMs: Date.now() - startedAt, retryAfterMs: null, permanent: false, ...extra };
}

async function safeJson(response: Response): Promise<unknown> {
  try {
    return await readJson(response);
  } catch (error) {
    return { __unreadable: error instanceof Error ? error.message.slice(0, 200) : String(error) };
  }
}

/** Decodo's own failure envelope: `{status:"failed", status_code?, message}`. */
function vendorFailure(body: unknown, startedAt: number): ConsumerFailure | null {
  const record = asRecord(body);
  if (!record || record.status !== "failed") return null;
  const code = typeof record.status_code === "number" ? record.status_code : null;
  const message = asString(record.message) ?? "";
  const detail = `${code ?? ""} ${message}`.trim().slice(0, 300);
  // 613 "not able to scrape the target" and its "try again later" sibling are
  // the site or the vendor's proxies refusing; both count toward the breaker.
  return failure("target_blocked", startedAt, { detail });
}

async function httpFailure(response: Response, startedAt: number): Promise<ConsumerFailure> {
  const body = await safeJson(response);
  const vendor = vendorFailure(body, startedAt);
  if (vendor) return vendor;
  const text = JSON.stringify(body ?? "").toLowerCase();
  const detail = text.slice(0, 300);
  if (response.status === 401) return failure("auth_failed", startedAt, { permanent: true, detail });
  if (response.status === 402) return failure("billing_required", startedAt, { permanent: true, detail });
  if (response.status === 403) {
    const billing = /credit|balance|quota|limit|subscription|plan|payment|insufficient/.test(text);
    return failure(billing ? "billing_required" : "auth_failed", startedAt, { permanent: true, detail });
  }
  if (response.status === 429) return failure("rate_limited", startedAt, { retryAfterMs: retryAfterMs(response.headers), detail });
  if (response.status >= 500) return failure(`provider_error: http_${response.status}`, startedAt, { detail });
  return failure(`http_${response.status}`, startedAt, { permanent: response.status >= 400 && response.status < 500, detail });
}

/** Maps one Decodo result into a ConsumerAnswer. Exported for tests. */
export function answerFromResult(result: unknown, request: ConsumerRequest, startedAt: number, requestId: string | null): ConsumerResult {
  const row = asRecord(result);
  if (!row) return failure("schema_unrecognised", startedAt, { permanent: true, detail: "result is not an object" });
  const content = asRecord(row.content);
  const statusCode = typeof row.status_code === "number" ? row.status_code : content && typeof content.status_code === "number" ? content.status_code : null;
  if (!content) {
    // An unparsed page comes back as a string; a blocked page as a status.
    if (statusCode !== null && statusCode >= 400) return failure(statusCode === 403 || statusCode === 429 ? "target_blocked" : `provider_error: target_http_${statusCode}`, startedAt, { detail: `status_code ${statusCode}` });
    return failure("schema_unrecognised", startedAt, { permanent: true, detail: `content is ${typeof row.content}` });
  }
  // The parsed answer is nested under content.results; older shapes put it on content itself.
  const parsed = asRecord(content.results) ?? content;
  const responseText = asString(parsed.response_text);
  const markdown = asString(parsed.markdown_text);
  const schemaKnown = responseText !== null || markdown !== null;
  if (!schemaKnown) {
    if (statusCode !== null && statusCode >= 400) return failure("target_blocked", startedAt, { detail: `status_code ${statusCode}` });
    return failure("schema_unrecognised", startedAt, { permanent: true, detail: `keys: ${Object.keys(parsed).slice(0, 12).join(",")}` });
  }

  const sources: ConsumerSource[] = [];
  for (const item of Array.isArray(parsed.citations) ? parsed.citations : []) {
    const c = asRecord(item);
    const url = c ? asString(c.url) : null;
    if (url) sources.push({ url, title: c ? (asString(c.title) ?? asString(c.text)) : null, position: null, kind: "citation" });
  }
  for (const item of Array.isArray(parsed.links) ? parsed.links : []) {
    const l = asRecord(item);
    const url = l ? asString(l.url) : null;
    if (url) sources.push({ url, title: l ? asString(l.text) : null, position: null, kind: "inline_link" });
  }
  const deduped = uniqueSources(sources);
  const searchQueries = asStringArray(parsed.search_queries);
  const text = stripImageMarkdown((markdown && markdown.trim().length > 0 ? markdown : responseText) ?? "");
  const citationCount = deduped.filter((source) => source.kind === "citation").length;
  if (answerLooksEmpty(text, citationCount)) return failure("empty_response", startedAt, { detail: text.slice(0, 120) });

  const pageUrl = asString(row.url) ?? "";
  const rawStream = Array.isArray(parsed.raw_response) ? parsed.raw_response.length : 0;
  const answer: ConsumerAnswer = {
    ok: true,
    vendor: VENDOR,
    engine: "chatgpt",
    site: "chatgpt.com",
    text,
    markdown,
    model: asString(parsed.llm_model) || null,
    searched: citationCount > 0 || searchQueries.length > 0 ? true : null,
    searchMode: "forced",
    sources: deduped,
    searchQueries,
    // Only when geo was sent and accepted; otherwise the exit is unknown.
    country: request.country,
    latencyMs: Date.now() - startedAt,
    credits: { charged: 1, remaining: null },
    markers: {
      siteUrl: /chatgpt\.com/i.test(pageUrl),
      siteUtm: deduped.some((source) => urlHasSiteUtm(source.url, "chatgpt.com")),
      // The raw event stream is chatgpt.com's own SSE, kept in the payload.
      pageHtml: rawStream > 0,
      searchMetadata: Array.isArray(parsed.search_queries),
      schemaKnown,
    },
    rawPayload: result,
    html: null,
    vendorRequestId: requestId ?? (typeof row.task_id === "string" ? row.task_id : typeof content.task_id === "string" ? content.task_id : null),
  };
  return answer;
}

/** Asks ChatGPT one prompt through Decodo. Never throws. */
export async function collect(request: ConsumerRequest): Promise<ConsumerResult> {
  const startedAt = Date.now();
  const credential = getCredential("decodo");
  if (!credential) return failure("decodo_disabled", startedAt, { permanent: true });
  if (request.engine !== "chatgpt") return failure("engine_unsupported", startedAt, { permanent: true, detail: `Decodo route serves chatgpt only, got ${request.engine}` });

  const country = sendGeo() ? normalizeCountry(request.country) : null;
  const payload = { target: "chatgpt", prompt: request.prompt, search: true, parse: true, ...(country ? { geo: country } : {}) };
  let response: Response;
  try {
    response = await fetchWithTimeout(
      `${baseUrl()}/v2/scrape`,
      { method: "POST", headers: { authorization: `Basic ${basicAuthValue(credential)}`, "content-type": "application/json", accept: "application/json" }, body: JSON.stringify(payload) },
      REQUEST_TIMEOUT_MS,
    );
  } catch (error) {
    return failureFromException(VENDOR, error, startedAt);
  }
  if (!response.ok) return httpFailure(response, startedAt);

  const body = await safeJson(response);
  const vendor = vendorFailure(body, startedAt);
  if (vendor) return vendor;
  const record = asRecord(body);
  const results = record && Array.isArray(record.results) ? record.results : Array.isArray(body) ? body : record ? [record] : [];
  if (results.length === 0) return failure("empty_response", startedAt, { detail: "no results in response" });
  return answerFromResult(results[0], { ...request, country }, startedAt, response.headers.get("x-request-id"));
}

export const decodoCollector: ConsumerCollector = {
  vendor: VENDOR,
  adapterVersion: DECODO_ADAPTER_VERSION,
  isAvailable: isDecodoAvailable,
  supports: (engine) => engine === "chatgpt",
  collect,
};
