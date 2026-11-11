import { assertResolvesToPublicAddress, UnsafeUrlError } from "@/lib/security/url-safety";
import { CRAWLER_USER_AGENT } from "./robots";

export interface SafeFetchOptions {
  timeoutMs: number;
  maxContentBytes: number;
  maxRedirects?: number;
  /** Preferred content language, e.g. "en" or "ar". */
  acceptLanguage?: string;
  /** Return a PDF's bytes instead of refusing it (menu documents). */
  acceptPdf?: boolean;
}

/**
 * A browser-like UA used for ONE retry when the crawler UA is refused with
 * 403/429/503. The operator entered their own site, so the page is meant to
 * be readable; a bot-management challenge on the first request is an
 * accident of hosting, not a policy. robots.txt is still honoured.
 */
const BROWSER_USER_AGENT = "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/128.0.0.0 Safari/537.36 ProjectSunBot/1.0";
const BOT_BLOCK_STATUSES = new Set([403, 429, 503]);

export interface SafeFetchResult {
  ok: boolean;
  status?: number;
  finalUrl?: string;
  contentType?: string;
  body?: string;
  /** Raw bytes of a PDF, when `acceptPdf` was set and the response was one. */
  bytes?: Uint8Array;
  error?: string;
  redirectChain: string[];
}

/**
 * Fetches with `redirect: "manual"` so every hop can be re-validated against
 * the SSRF guard before it is followed — this is the step most SSRF-safe
 * crawlers skip, letting an attacker DNS-rebind or redirect to a private
 * address only after the first, safe-looking hostname passes the check.
 */
export async function safeFetchHtml(startUrl: string, opts: SafeFetchOptions): Promise<SafeFetchResult> {
  const first = await safeFetchHtmlOnce(startUrl, opts, CRAWLER_USER_AGENT);
  if (!first.ok && first.status !== undefined && BOT_BLOCK_STATUSES.has(first.status)) {
    const retry = await safeFetchHtmlOnce(startUrl, opts, BROWSER_USER_AGENT);
    return retry.ok ? retry : first;
  }
  return first;
}

async function safeFetchHtmlOnce(startUrl: string, opts: SafeFetchOptions, userAgent: string): Promise<SafeFetchResult> {
  const maxRedirects = opts.maxRedirects ?? 5;
  const redirectChain: string[] = [];
  let currentUrl = startUrl;

  for (let hop = 0; hop <= maxRedirects; hop++) {
    let parsed: URL;
    try {
      parsed = new URL(currentUrl);
    } catch {
      return { ok: false, error: "invalid_redirect_target", redirectChain };
    }
    if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
      return { ok: false, error: "unsupported_redirect_scheme", redirectChain };
    }
    try {
      await assertResolvesToPublicAddress(parsed.hostname);
    } catch (err) {
      const code = err instanceof UnsafeUrlError ? err.code : "dns_resolution_failed";
      return { ok: false, error: code, redirectChain };
    }

    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), opts.timeoutMs);
    let res: Response;
    try {
      res = await fetch(parsed.toString(), {
        headers: {
          "user-agent": userAgent,
          accept: "text/html,application/xhtml+xml",
          "accept-language": opts.acceptLanguage ? `${opts.acceptLanguage},en;q=0.8` : "en-US,en;q=0.9",
        },
        redirect: "manual",
        signal: controller.signal,
      });
    } catch (err) {
      clearTimeout(timer);
      return { ok: false, error: (err as Error).name === "AbortError" ? "timeout" : "network_error", redirectChain };
    }
    clearTimeout(timer);

    if (res.status >= 300 && res.status < 400) {
      const location = res.headers.get("location");
      if (!location) return { ok: false, status: res.status, error: "redirect_missing_location", redirectChain };
      currentUrl = new URL(location, parsed).toString();
      redirectChain.push(currentUrl);
      continue;
    }

    if (!res.ok) return { ok: false, status: res.status, error: `http_${res.status}`, redirectChain, finalUrl: parsed.toString() };

    const contentType = res.headers.get("content-type") ?? "";
    // A menu document: bytes, capped like a page, never decoded as text.
    if (opts.acceptPdf && (contentType.includes("application/pdf") || (contentType.includes("octet-stream") && /\.pdf$/i.test(parsed.pathname)))) {
      const reader = res.body?.getReader();
      const chunks: Uint8Array[] = [];
      let received = 0;
      if (reader) {
        while (true) {
          const { done, value } = await reader.read();
          if (done) break;
          received += value.byteLength;
          if (received > opts.maxContentBytes) {
            await reader.cancel().catch(() => undefined);
            return { ok: false, status: res.status, error: "document_too_large", contentType, redirectChain, finalUrl: parsed.toString() };
          }
          chunks.push(value);
        }
      }
      const bytes = new Uint8Array(received);
      let offset = 0;
      for (const chunk of chunks) {
        bytes.set(chunk, offset);
        offset += chunk.byteLength;
      }
      return { ok: true, status: res.status, finalUrl: parsed.toString(), contentType, bytes, redirectChain };
    }
    if (!contentType.includes("text/html") && !contentType.includes("application/xhtml+xml") && contentType !== "") {
      return { ok: false, status: res.status, error: "unsupported_content_type", contentType, redirectChain, finalUrl: parsed.toString() };
    }

    const reader = res.body?.getReader();
    if (!reader) {
      const text = await res.text();
      return { ok: true, status: res.status, finalUrl: parsed.toString(), contentType, body: text.slice(0, opts.maxContentBytes), redirectChain };
    }
    const decoder = new TextDecoder();
    let received = 0;
    let text = "";
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      received += value.byteLength;
      text += decoder.decode(value, { stream: true });
      if (received >= opts.maxContentBytes) {
        await reader.cancel().catch(() => undefined);
        break;
      }
    }
    return { ok: true, status: res.status, finalUrl: parsed.toString(), contentType, body: text, redirectChain };
  }
  return { ok: false, error: "too_many_redirects", redirectChain };
}
