// Bright Data — ChatGPT Scraper API (Web Scraper API, dataset "ChatGPT Search –
// Search by Prompt").
//
// What it does: opens chatgpt.com in a signed-out browser session from the
// requested country, sends the prompt with web search permitted, and returns
// the page: answer text and markdown, the rendered HTML, the citations and
// search sources the page showed, and whether search actually ran
// (https://docs.brightdata.com/products/scrapers/chatgpt/introduction).
//
// Mechanics, as measured on 2026-09-15 with a real key: the synchronous
// endpoint waits about a minute and then answers 202 with a snapshot id; the
// snapshot itself took five to eight minutes to become ready. So every call
// here is really submit → poll → download, and the poll budget defaults to a
// quarter of an hour. Both paths are handled, so callers see one call.
//
// Payload facts learned from a real record (kept in the client, not only in
// the tests, because they change how the answer is read):
//   * Inline links in the answer arrive as numbered placeholders — "[1]",
//     "[2]" — in `answer_text` and `answer_text_markdown`, with the link text
//     and URL in `links_attached[].position`. The brands a page names as
//     links would otherwise vanish from the text, so the placeholders are
//     restored from `links_attached` before the text is stored.
//   * `model` was null; `country` echoes only what was sent, and a request
//     without a country exited through an arbitrary proxy (prices in Swedish
//     krona), so a country is always sent.
//   * Shopping cards come back as `shopping[]` and as text inside the answer.

import { getCredential } from "@/lib/providers/credentials";
import {
  answerLooksEmpty,
  asRecord,
  asString,
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

export const BRIGHTDATA_ADAPTER_VERSION = "brightdata-consumer-adapter@2";
export const BRIGHTDATA_CHATGPT_DATASET = "gd_m7aof0k82r803d5bjm";

const VENDOR = "brightdata" as const;
const REQUEST_TIMEOUT_MS = 120_000;
const POLL_INTERVAL_MS = 10_000;

function baseUrl(): string {
  return (process.env.SUN_BRIGHTDATA_BASE_URL ?? "https://api.brightdata.com").replace(/\/$/, "");
}

/** How long to wait for a snapshot before giving the prompt back to the lane as a transient failure. */
function pollBudgetMs(): number {
  const raw = Number(process.env.SUN_BRIGHTDATA_POLL_MAX_MS);
  return Number.isFinite(raw) && raw > 0 ? raw : 15 * 60_000;
}

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

export function isBrightDataAvailable(): boolean {
  return Boolean(getCredential("brightdata"));
}

function headers(): Record<string, string> {
  return { authorization: `Bearer ${getCredential("brightdata")}`, "content-type": "application/json" };
}

function failure(error: string, startedAt: number, extra: Partial<ConsumerFailure> = {}): ConsumerFailure {
  return { ok: false, vendor: VENDOR, error, latencyMs: Date.now() - startedAt, retryAfterMs: null, permanent: false, ...extra };
}

/** Reads a body that may be compressed or cut off without letting the exception escape. */
async function safeJson(response: Response): Promise<unknown> {
  try {
    return await readJson(response);
  } catch (error) {
    return { __unreadable: error instanceof Error ? error.message.slice(0, 200) : String(error) };
  }
}

/** Maps a non-2xx HTTP response to the shared error vocabulary. */
async function httpFailure(response: Response, startedAt: number): Promise<ConsumerFailure> {
  const body = await safeJson(response);
  const text = JSON.stringify(body ?? "").toLowerCase();
  const detail = text.slice(0, 300);
  if (response.status === 401) return failure("auth_failed", startedAt, { permanent: true, detail });
  if (response.status === 402) return failure("billing_required", startedAt, { permanent: true, detail });
  if (response.status === 403) {
    // The free tier's hard stop and a spent balance both arrive as 403 with a
    // billing message; a plain 403 is a key or permission problem.
    const billing = /credit|balance|quota|limit|insufficient|payment|plan/.test(text);
    return failure(billing ? "billing_required" : "auth_failed", startedAt, { permanent: true, detail });
  }
  if (response.status === 429) return failure("rate_limited", startedAt, { retryAfterMs: retryAfterMs(response.headers), detail });
  if (response.status >= 500) return failure(`provider_error: http_${response.status}`, startedAt, { detail });
  return failure(`http_${response.status}`, startedAt, { permanent: response.status >= 400 && response.status < 500, detail });
}

interface AttachedLink {
  url: string;
  text: string | null;
  position: number | null;
}

function attachedLinks(row: Record<string, unknown>): AttachedLink[] {
  const out: AttachedLink[] = [];
  for (const item of Array.isArray(row.links_attached) ? row.links_attached : []) {
    const l = asRecord(item);
    const url = l ? asString(l.url) : null;
    if (url) out.push({ url, text: l ? asString(l.text) : null, position: l && typeof l.position === "number" ? l.position : null });
  }
  return out;
}

/**
 * Puts the link text back where Bright Data left a numbered placeholder.
 * "[1]" (or "\[1\]" in markdown) becomes the link's text, so "Nike" is in the
 * answer the way the page showed it. Unmatched placeholders are left alone.
 */
export function restorePlaceholders(text: string, links: AttachedLink[]): string {
  if (links.length === 0) return text;
  const byPosition = new Map<number, string>();
  for (const link of links) {
    if (link.position !== null && link.text && !byPosition.has(link.position)) byPosition.set(link.position, link.text.trim());
  }
  if (byPosition.size === 0) return text;
  return text.replace(/\\?\[(\d{1,3})\\?\]/g, (match, digits: string) => byPosition.get(Number(digits)) ?? match);
}

/**
 * Turns one Bright Data record into a ConsumerAnswer, or a failure when the
 * record is an error, an unknown shape, or a blank page.
 */
export function answerFromRecord(record: unknown, request: ConsumerRequest, startedAt: number, requestId: string | null): ConsumerResult {
  const row = asRecord(record);
  if (!row) return failure("schema_unrecognised", startedAt, { permanent: true, detail: "record is not an object" });

  const errorText = asString(row.error) ?? asString(row.error_code) ?? asString(row.warning_code);
  if (errorText && typeof row.answer_text !== "string") {
    const blocked = /login|sign.?in|captcha|challenge|blocked|access denied|unavailable/i.test(errorText);
    return failure(blocked ? "target_blocked" : `provider_error: ${errorText.slice(0, 120)}`, startedAt, { detail: errorText.slice(0, 200) });
  }

  const answerText = asString(row.answer_text);
  const markdown = asString(row.answer_text_markdown);
  const schemaKnown = answerText !== null && ("web_search_triggered" in row || "citations" in row);
  if (!schemaKnown) return failure("schema_unrecognised", startedAt, { permanent: true, detail: `keys: ${Object.keys(row).slice(0, 12).join(",")}` });

  const links = attachedLinks(row);
  const sources: ConsumerSource[] = [];
  // `citations` are the entries the page marked as cited; `search_sources` is
  // the rest of the page's sources panel (measured: one cited entry against
  // five panel entries on the same answer). Both are sources the page showed,
  // which is what the other providers return as their sources list, so both
  // count as citations here; the cited flag stays in the raw payload.
  for (const item of Array.isArray(row.citations) ? row.citations : []) {
    const c = asRecord(item);
    const url = c ? asString(c.url) : null;
    if (url) sources.push({ url, title: c ? asString(c.title) : null, position: c && typeof c.position === "number" ? c.position : null, kind: "citation" });
  }
  for (const item of Array.isArray(row.search_sources) ? row.search_sources : []) {
    const s = asRecord(item);
    const url = s ? asString(s.url) : null;
    if (url) sources.push({ url, title: s ? asString(s.title) : null, position: s && typeof s.rank === "number" ? s.rank : null, kind: "citation" });
  }
  for (const link of links) sources.push({ url: link.url, title: link.text, position: link.position, kind: "inline_link" });
  const deduped = uniqueSources(sources);
  const html = asString(row.answer_html);
  const pageUrl = asString(row.url) ?? "";
  const searched = typeof row.web_search_triggered === "boolean" ? row.web_search_triggered : null;
  const restoredMarkdown = markdown && markdown.trim().length > 0 ? stripImageMarkdown(restorePlaceholders(markdown, links)) : null;
  const text = restoredMarkdown ?? stripImageMarkdown(restorePlaceholders(answerText ?? "", links));

  const markers = {
    siteUrl: /^https:\/\/chatgpt\.com\//i.test(pageUrl),
    siteUtm: deduped.some((source) => urlHasSiteUtm(source.url, "chatgpt.com")),
    pageHtml: Boolean(html && /chatgpt|data-build|openai|xsw4dja/i.test(html)),
    searchMetadata: "web_search_triggered" in row,
    schemaKnown,
  };

  const citationCount = deduped.filter((source) => source.kind === "citation").length;
  if (answerLooksEmpty(text, citationCount)) return failure("empty_response", startedAt, { detail: text.slice(0, 120) });

  const answer: ConsumerAnswer = {
    ok: true,
    vendor: VENDOR,
    engine: "chatgpt",
    site: "chatgpt.com",
    text,
    markdown: restoredMarkdown,
    model: asString(row.model) || null,
    searched,
    searchMode: "permitted",
    sources: deduped,
    searchQueries: [asString(row.web_search_query)].filter((q): q is string => Boolean(q)),
    // Only what the record says: a missing country means the vendor did not
    // confirm the exit, never that the requested country was used.
    country: normalizeCountry(asString(row.country)),
    latencyMs: Date.now() - startedAt,
    credits: { charged: 1, remaining: null },
    markers,
    rawPayload: record,
    html,
    vendorRequestId: requestId,
  };
  return answer;
}

async function pollSnapshot(snapshotId: string, request: ConsumerRequest, startedAt: number): Promise<ConsumerResult> {
  const deadline = Date.now() + pollBudgetMs();
  const base = baseUrl();
  for (;;) {
    if (Date.now() > deadline) return failure("timeout", startedAt, { detail: `snapshot ${snapshotId} not ready within the poll budget` });
    await sleep(POLL_INTERVAL_MS);
    let progress: Response;
    try {
      progress = await fetchWithTimeout(`${base}/datasets/v3/progress/${encodeURIComponent(snapshotId)}`, { method: "GET", headers: headers() }, 30_000);
    } catch (error) {
      return failureFromException(VENDOR, error, startedAt);
    }
    if (!progress.ok) return httpFailure(progress, startedAt);
    const body = asRecord(await safeJson(progress));
    const status = body ? asString(body.status) : null;
    if (status === "failed" || status === "canceled") return failure(`provider_error: snapshot_${status}`, startedAt, { detail: JSON.stringify(body).slice(0, 200) });
    if (status !== "ready") continue;

    let snapshot: Response;
    try {
      snapshot = await fetchWithTimeout(`${base}/datasets/v3/snapshot/${encodeURIComponent(snapshotId)}?format=json`, { method: "GET", headers: headers() }, 90_000);
    } catch (error) {
      return failureFromException(VENDOR, error, startedAt);
    }
    if (snapshot.status === 202) continue;
    if (!snapshot.ok) return httpFailure(snapshot, startedAt);
    return firstRecord(await safeJson(snapshot), request, startedAt, snapshotId);
  }
}

function firstRecord(records: unknown, request: ConsumerRequest, startedAt: number, requestId: string | null): ConsumerResult {
  const list = Array.isArray(records) ? records : [records];
  if (list.length === 0) return failure("empty_response", startedAt, { detail: "no records in response" });
  return answerFromRecord(list[0], request, startedAt, requestId);
}

/**
 * Asks ChatGPT one prompt through Bright Data. Never throws: every failure
 * mode returns `{ok:false}` with a typed reason.
 */
export async function collect(request: ConsumerRequest): Promise<ConsumerResult> {
  const startedAt = Date.now();
  if (!isBrightDataAvailable()) return failure("brightdata_disabled", startedAt, { permanent: true });
  if (request.engine !== "chatgpt") return failure("engine_unsupported", startedAt, { permanent: true, detail: `Bright Data route serves chatgpt only, got ${request.engine}` });

  const country = normalizeCountry(request.country) ?? "US";
  const input = [{ url: "https://chatgpt.com/", prompt: request.prompt, web_search: true, country }];
  const url = `${baseUrl()}/datasets/v3/scrape?dataset_id=${BRIGHTDATA_CHATGPT_DATASET}&format=json&include_errors=true`;

  let response: Response;
  try {
    response = await fetchWithTimeout(url, { method: "POST", headers: headers(), body: JSON.stringify(input) }, REQUEST_TIMEOUT_MS);
  } catch (error) {
    return failureFromException(VENDOR, error, startedAt);
  }
  const requestId = response.headers.get("x-request-id");
  const sent = { ...request, country };

  if (response.status === 202) {
    const body = asRecord(await safeJson(response));
    const snapshotId = body ? asString(body.snapshot_id) : null;
    if (!snapshotId) return failure("schema_unrecognised", startedAt, { permanent: true, detail: "202 without snapshot_id" });
    return pollSnapshot(snapshotId, sent, startedAt);
  }
  if (!response.ok) return httpFailure(response, startedAt);

  const body = await safeJson(response);
  const asObject = asRecord(body);
  if (asObject && typeof asObject.snapshot_id === "string") return pollSnapshot(asObject.snapshot_id, sent, startedAt);
  return firstRecord(body, sent, startedAt, requestId);
}

export const brightDataCollector: ConsumerCollector = {
  vendor: VENDOR,
  adapterVersion: BRIGHTDATA_ADAPTER_VERSION,
  isAvailable: isBrightDataAvailable,
  supports: (engine) => engine === "chatgpt",
  collect,
};
