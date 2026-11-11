// The shared contract for consumer-web collection providers.
//
// Bright Data, cloro and Decodo each open the assistant's website in a
// signed-out browser and return what the page showed. Their payloads differ,
// so each client maps its own shape into ConsumerAnswer here, and everything
// downstream (the orchestrator, the runner, the tests) sees one shape.
//
// Two rules make the answers honest:
//   1. Every answer carries SURFACE MARKERS — facts in the payload that could
//      only come from the real website (a chatgpt.com URL, the utm tag ChatGPT
//      appends to cited links, the rendered page HTML, search metadata). An
//      answer without them is stored, but it is never labelled as the
//      consumer surface. This is how a vendor's silent fallback to a model API
//      would show up as data instead of passing unnoticed.
//   2. A vendor that says "success" with a blank page is a failure to retry,
//      not an observation. Blank answers would otherwise enter presence
//      denominators as "the brand was absent".

import type { AnswerEngine } from "@/lib/providers/engines";
import type { CollectionVendor } from "@/lib/providers/catalog";

export type ConsumerSite = "chatgpt.com" | "gemini.google.com";

export interface ConsumerSource {
  url: string;
  title: string | null;
  /** 1-based position as the surface listed it, when the vendor reports one. */
  position: number | null;
  /**
   * citation      a source the surface showed for the answer (source panel)
   * search_result a page the assistant retrieved, cited or not
   * inline_link   a link placed inside the answer body
   */
  kind: "citation" | "search_result" | "inline_link";
}

export interface SurfaceMarkers {
  /** The payload named the assistant's site as the page it drove. */
  siteUrl: boolean;
  /** Cited links carry the tag the site appends (utm_source=chatgpt.com). */
  siteUtm: boolean;
  /** The rendered page HTML came back. */
  pageHtml: boolean;
  /** The payload reports web-search state or the queries the assistant ran. */
  searchMetadata: boolean;
  /** The payload had the fields this adapter was written against. */
  schemaKnown: boolean;
}

export interface ConsumerAnswer {
  ok: true;
  vendor: CollectionVendor;
  engine: AnswerEngine;
  site: ConsumerSite;
  /** The answer as shown; markdown when the vendor returns it, plain text otherwise. */
  text: string;
  markdown: string | null;
  /** The model the page named, or null when the surface did not say. Never guessed. */
  model: string | null;
  /** Whether the assistant searched the web for this answer; null when the vendor does not report it. */
  searched: boolean | null;
  /** How search was configured on this request. */
  searchMode: "forced" | "permitted" | "off" | "unknown";
  sources: ConsumerSource[];
  searchQueries: string[];
  /** The country the request was routed through, as sent to the vendor (ISO alpha-2). */
  country: string | null;
  latencyMs: number;
  credits: { charged: number | null; remaining: number | null };
  markers: SurfaceMarkers;
  /** The vendor's payload, verbatim, kept as evidence next to the answer. */
  rawPayload: unknown;
  /** The rendered page, when the vendor returned it (may be several hundred KB). */
  html: string | null;
  vendorRequestId: string | null;
}

export interface ConsumerFailure {
  ok: false;
  vendor: CollectionVendor;
  /**
   * <vendor>_disabled | auth_failed | billing_required | rate_limited | timeout |
   * network_error | empty_response | target_blocked | schema_unrecognised |
   * engine_unsupported | http_<status> | provider_error: <detail>
   */
  error: string;
  latencyMs: number;
  retryAfterMs: number | null;
  /** Retrying cannot fix it (bad key, no credits, unknown payload shape). */
  permanent: boolean;
  detail?: string;
  credits?: { charged: number | null; remaining: number | null };
}

export type ConsumerResult = ConsumerAnswer | ConsumerFailure;

export interface ConsumerRequest {
  engine: AnswerEngine;
  prompt: string;
  /** ISO alpha-2 country to route the request through, or null for the vendor's default. */
  country: string | null;
  locale: string;
}

export interface ConsumerCollector {
  vendor: CollectionVendor;
  adapterVersion: string;
  isAvailable(): boolean;
  supports(engine: AnswerEngine): boolean;
  collect(request: ConsumerRequest): Promise<ConsumerResult>;
}

/** A fixed, brand-neutral prompt every vendor is asked before a run. */
export const CANARY_PROMPT = "What are three well-known brands of running shoes, and what is each known for?";

/** Payload markers pass when the shape is known and at least one site-only fact is present. */
export function markersPass(markers: SurfaceMarkers): boolean {
  return markers.schemaKnown && (markers.siteUrl || markers.siteUtm || markers.pageHtml || markers.searchMetadata);
}

/**
 * A "successful" answer that is really a blank page or a widget placeholder.
 * cloro's own rule (no sources and a body under about 160 characters) is the
 * strictest published one, so it is the rule for every vendor.
 */
export function answerLooksEmpty(text: string, sourceCount: number): boolean {
  const body = text
    .replace(/map data is currently unavailable/gi, " ")
    .replace(/\s+/g, " ")
    .trim();
  if (body.length === 0) return true;
  return sourceCount === 0 && body.length < 160;
}

/**
 * Removes embedded images from a markdown answer, keeping any alt text.
 *
 * Real pages embed product thumbnails as `![alt](https://images.openai.com/...)`
 * with very long opaque URLs. They are pictures, not words the page showed,
 * and left in place they bulk up the stored answer and hand the analyser
 * random tokens. The vendor payload artifact keeps them verbatim.
 */
export function stripImageMarkdown(text: string): string {
  return text
    .replace(/!\[([^\]]*)\]\([^)]*\)/g, (_match, alt: string) => alt || "")
    .replace(/[ \t]+\n/g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

export function normalizeCountry(value: string | null | undefined): string | null {
  if (typeof value !== "string") return null;
  const code = value.trim().toUpperCase();
  return /^[A-Z]{2}$/.test(code) ? code : null;
}

export function uniqueSources(sources: ConsumerSource[]): ConsumerSource[] {
  const seen = new Set<string>();
  const out: ConsumerSource[] = [];
  for (const source of sources) {
    const url = source.url.trim();
    if (!/^https?:\/\//i.test(url)) continue;
    const key = `${source.kind}|${url}`;
    if (seen.has(key)) continue;
    seen.add(key);
    out.push({ ...source, url });
  }
  return out;
}

export function urlHasSiteUtm(url: string, site: ConsumerSite): boolean {
  return new RegExp(`utm_source=${site.replace(/\./g, "\\.")}`, "i").test(url);
}

/** Parses a Retry-After header (seconds or HTTP date) into milliseconds. */
export function retryAfterMs(headers: Headers): number | null {
  const raw = headers.get("retry-after");
  if (!raw) return null;
  const seconds = Number(raw);
  if (Number.isFinite(seconds)) return Math.max(0, Math.round(seconds * 1000));
  const at = Date.parse(raw);
  return Number.isFinite(at) ? Math.max(0, at - Date.now()) : null;
}

export function numericHeader(headers: Headers, name: string): number | null {
  const raw = headers.get(name);
  if (raw === null) return null;
  const value = Number(raw);
  return Number.isFinite(value) ? value : null;
}

/** fetch with a hard timeout. Throws {name:"AbortError"} on timeout, like fetch itself. */
export async function fetchWithTimeout(url: string, init: RequestInit, timeoutMs: number): Promise<Response> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await fetch(url, { ...init, signal: controller.signal });
  } finally {
    clearTimeout(timer);
  }
}

export async function readJson(response: Response): Promise<unknown> {
  const text = await response.text();
  if (!text) return null;
  try {
    return JSON.parse(text) as unknown;
  } catch {
    return { __raw: text.slice(0, 2000) };
  }
}

export function failureFromException(vendor: CollectionVendor, error: unknown, startedAt: number): ConsumerFailure {
  const aborted = error instanceof Error && error.name === "AbortError";
  return {
    ok: false,
    vendor,
    error: aborted ? "timeout" : "network_error",
    latencyMs: Date.now() - startedAt,
    retryAfterMs: null,
    permanent: false,
    detail: error instanceof Error ? error.message.slice(0, 200) : String(error).slice(0, 200),
  };
}

/** Best-effort download of a rendered page a vendor exposes by URL. Never throws. */
export async function fetchHtmlSnapshot(url: string, maxBytes = 4 * 1024 * 1024, timeoutMs = 20_000): Promise<string | null> {
  try {
    const response = await fetchWithTimeout(url, { method: "GET" }, timeoutMs);
    if (!response.ok) return null;
    const text = await response.text();
    if (!text) return null;
    return text.length > maxBytes ? text.slice(0, maxBytes) : text;
  } catch {
    return null;
  }
}

/**
 * A per-process concurrency gate. cloro meters concurrent jobs per API key
 * (one on the free tier), and the same key serves the ChatGPT and Gemini
 * lanes, so the limit has to be shared by the client, not by each lane.
 */
export class Semaphore {
  private active = 0;
  private readonly waiters: Array<() => void> = [];

  constructor(private readonly limit: number) {}

  async acquire(): Promise<() => void> {
    if (this.active < this.limit) {
      this.active += 1;
      return () => this.release();
    }
    await new Promise<void>((resolve) => this.waiters.push(resolve));
    this.active += 1;
    return () => this.release();
  }

  private release(): void {
    this.active -= 1;
    const next = this.waiters.shift();
    if (next) next();
  }
}

export function asRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" && !Array.isArray(value) ? (value as Record<string, unknown>) : null;
}

export function asString(value: unknown): string | null {
  return typeof value === "string" ? value : null;
}

export function asStringArray(value: unknown): string[] {
  return Array.isArray(value) ? value.filter((item): item is string => typeof item === "string") : [];
}
