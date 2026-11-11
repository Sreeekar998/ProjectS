// Oxylabs — Web Scraper API, source "chatgpt".
//
// What it does: "The chatgpt source lets you submit a prompt to ChatGPT and
// receive a fully parsed, structured response"; the product page describes it
// as simulating "real user interactions with ChatGPT UI". JavaScript rendering
// is forced for this source, `search: true` turns on ChatGPT's web search, and
// `geo_location` names the country the browser exits from
// (https://developers.oxylabs.io/api-targets/llms-and-ai/chatgpt).
//
// Mechanics: Push-Pull only. POST /v1/queries returns a job id; the job is
// polled (pending → done | faulted) and its results fetched. Oxylabs says
// realtime is not available for this source because it "takes longer to
// complete than a synchronous connection allows". A published sample job took
// about 36 s; the poll budget here is ten minutes.
//
// Credentials: Basic auth with the Web Scraper API user's username and
// password, stored as one "username:password" string.
//
// Written from the documentation (2026-09-14) before any live request; the
// field names below are the documented ones and the parser fails closed on a
// shape it does not know. First live check: `scripts/vendor-canary.ts`.

import { getCredential } from "@/lib/providers/credentials";
import { countryName } from "@/lib/geo/countries";
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

export const OXYLABS_ADAPTER_VERSION = "oxylabs-consumer-adapter@1";

const VENDOR = "oxylabs" as const;
const SUBMIT_TIMEOUT_MS = 60_000;
const POLL_INTERVAL_MS = 10_000;

function baseUrl(): string {
  return (process.env.SUN_OXYLABS_BASE_URL ?? "https://data.oxylabs.io").replace(/\/$/, "");
}

function pollBudgetMs(): number {
  const raw = Number(process.env.SUN_OXYLABS_POLL_MAX_MS);
  return Number.isFinite(raw) && raw > 0 ? raw : 10 * 60_000;
}

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

export function isOxylabsAvailable(): boolean {
  const credential = getCredential("oxylabs");
  return Boolean(credential && credential.includes(":"));
}

/** "username:password" → the Basic header value. */
export function basicAuthValue(credential: string): string {
  return Buffer.from(credential.trim(), "utf8").toString("base64");
}

function headers(): Record<string, string> {
  return { authorization: `Basic ${basicAuthValue(getCredential("oxylabs") ?? "")}`, "content-type": "application/json" };
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

async function httpFailure(response: Response, startedAt: number): Promise<ConsumerFailure> {
  const body = await safeJson(response);
  const text = JSON.stringify(body ?? "").toLowerCase();
  const detail = text.slice(0, 300);
  if (response.status === 401) return failure("auth_failed", startedAt, { permanent: true, detail });
  if (response.status === 402) return failure("billing_required", startedAt, { permanent: true, detail });
  if (response.status === 403) {
    const billing = /credit|balance|quota|limit|insufficient|payment|plan|trial/.test(text);
    return failure(billing ? "billing_required" : "auth_failed", startedAt, { permanent: true, detail });
  }
  if (response.status === 429) return failure("rate_limited", startedAt, { retryAfterMs: retryAfterMs(response.headers), detail });
  if (response.status >= 500) return failure(`provider_error: http_${response.status}`, startedAt, { detail });
  return failure(`http_${response.status}`, startedAt, { permanent: response.status >= 400 && response.status < 500, detail });
}

/** Maps one result of a finished job into a ConsumerAnswer. Exported for tests. */
export function answerFromResult(result: unknown, request: ConsumerRequest, startedAt: number, jobId: string | null): ConsumerResult {
  const row = asRecord(result);
  if (!row) return failure("schema_unrecognised", startedAt, { permanent: true, detail: "result is not an object" });
  const statusCode = typeof row.status_code === "number" ? row.status_code : null;
  const content = asRecord(row.content);
  if (!content) {
    if (statusCode !== null && statusCode >= 400) return failure(statusCode === 403 || statusCode === 429 ? "target_blocked" : `provider_error: target_http_${statusCode}`, startedAt, { detail: `status_code ${statusCode}` });
    return failure("schema_unrecognised", startedAt, { permanent: true, detail: `content is ${typeof row.content}` });
  }
  const responseText = asString(content.response_text);
  const markdown = asString(content.markdown_text);
  const schemaKnown = responseText !== null || markdown !== null;
  if (!schemaKnown) {
    // Oxylabs bills any 2xx/4xx page even when parsing found nothing; parse_status_code says so.
    const parseStatus = typeof content.parse_status_code === "number" ? content.parse_status_code : null;
    return failure(parseStatus !== null && parseStatus !== 12000 ? "target_blocked" : "schema_unrecognised", startedAt, { permanent: parseStatus === null, detail: `parse_status_code ${parseStatus ?? "none"}; keys: ${Object.keys(content).slice(0, 12).join(",")}` });
  }

  const sources: ConsumerSource[] = [];
  for (const item of Array.isArray(content.citations) ? content.citations : []) {
    const c = asRecord(item);
    const url = c ? asString(c.url) : null;
    if (url) sources.push({ url, title: c ? (asString(c.title) ?? asString(c.text)) : null, position: null, kind: "citation" });
  }
  for (const item of Array.isArray(content.links) ? content.links : []) {
    const l = asRecord(item);
    const url = l ? asString(l.url) : null;
    if (url) sources.push({ url, title: l ? asString(l.text) : null, position: null, kind: "inline_link" });
  }
  const deduped = uniqueSources(sources);
  const searchQueries = asStringArray(content.search_queries);
  const text = stripImageMarkdown((markdown && markdown.trim().length > 0 ? markdown : responseText) ?? "");
  const citationCount = deduped.filter((source) => source.kind === "citation").length;
  if (answerLooksEmpty(text, citationCount)) return failure("empty_response", startedAt, { detail: text.slice(0, 120) });

  const pageUrl = asString(row.url) ?? "";
  const answer: ConsumerAnswer = {
    ok: true,
    vendor: VENDOR,
    engine: "chatgpt",
    site: "chatgpt.com",
    text,
    markdown,
    model: asString(content.llm_model) || null,
    searched: citationCount > 0 || searchQueries.length > 0 ? true : null,
    searchMode: "forced",
    sources: deduped,
    searchQueries,
    country: request.country,
    latencyMs: Date.now() - startedAt,
    credits: { charged: 1, remaining: null },
    markers: {
      siteUrl: /^https:\/\/chatgpt\.com\//i.test(pageUrl),
      siteUtm: deduped.some((source) => urlHasSiteUtm(source.url, "chatgpt.com")),
      pageHtml: false,
      searchMetadata: Array.isArray(content.search_queries),
      schemaKnown,
    },
    rawPayload: result,
    html: null,
    vendorRequestId: jobId,
  };
  return answer;
}

async function pollJob(jobId: string, request: ConsumerRequest, startedAt: number): Promise<ConsumerResult> {
  const deadline = Date.now() + pollBudgetMs();
  const base = baseUrl();
  for (;;) {
    if (Date.now() > deadline) return failure("timeout", startedAt, { detail: `job ${jobId} not done within the poll budget` });
    await sleep(POLL_INTERVAL_MS);
    let status: Response;
    try {
      status = await fetchWithTimeout(`${base}/v1/queries/${encodeURIComponent(jobId)}`, { method: "GET", headers: headers() }, 30_000);
    } catch (error) {
      return failureFromException(VENDOR, error, startedAt);
    }
    if (!status.ok) return httpFailure(status, startedAt);
    const job = asRecord(await safeJson(status));
    const state = job ? asString(job.status) : null;
    if (state === "faulted") return failure("target_blocked", startedAt, { detail: `job faulted: ${JSON.stringify(job).slice(0, 200)}` });
    if (state !== "done") continue;

    let results: Response;
    try {
      results = await fetchWithTimeout(`${base}/v1/queries/${encodeURIComponent(jobId)}/results`, { method: "GET", headers: headers() }, 60_000);
    } catch (error) {
      return failureFromException(VENDOR, error, startedAt);
    }
    if (!results.ok) return httpFailure(results, startedAt);
    const body = asRecord(await safeJson(results));
    const list = body && Array.isArray(body.results) ? body.results : [];
    if (list.length === 0) return failure("empty_response", startedAt, { detail: "no results in job" });
    return answerFromResult(list[0], request, startedAt, jobId);
  }
}

/** Asks ChatGPT one prompt through Oxylabs. Never throws. */
export async function collect(request: ConsumerRequest): Promise<ConsumerResult> {
  const startedAt = Date.now();
  if (!isOxylabsAvailable()) return failure("oxylabs_disabled", startedAt, { permanent: true, detail: "set OXYLABS_AUTH to username:password of a Web Scraper API user" });
  if (request.engine !== "chatgpt") return failure("engine_unsupported", startedAt, { permanent: true, detail: `Oxylabs route serves chatgpt only, got ${request.engine}` });

  const country = normalizeCountry(request.country);
  // geo_location takes a country name ("India"), not a code.
  const geo = country ? countryName(country) : null;
  const payload = { source: "chatgpt", prompt: request.prompt, search: true, parse: true, ...(geo ? { geo_location: geo } : {}) };
  let response: Response;
  try {
    response = await fetchWithTimeout(`${baseUrl()}/v1/queries`, { method: "POST", headers: headers(), body: JSON.stringify(payload) }, SUBMIT_TIMEOUT_MS);
  } catch (error) {
    return failureFromException(VENDOR, error, startedAt);
  }
  if (!response.ok) return httpFailure(response, startedAt);
  const job = asRecord(await safeJson(response));
  const jobId = job ? asString(job.id) : null;
  if (!jobId) return failure("schema_unrecognised", startedAt, { permanent: true, detail: `no job id: ${JSON.stringify(job).slice(0, 160)}` });
  // A job can already be done when the submit call returns; the poll handles both.
  return pollJob(jobId, { ...request, country }, startedAt);
}

export const oxylabsCollector: ConsumerCollector = {
  vendor: VENDOR,
  adapterVersion: OXYLABS_ADAPTER_VERSION,
  isAvailable: isOxylabsAvailable,
  supports: (engine) => engine === "chatgpt",
  collect,
};
