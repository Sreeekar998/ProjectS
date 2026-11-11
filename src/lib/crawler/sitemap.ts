// Sitemap discovery and parsing (sitemaps.org protocol, including indexes).
//
// Sitemaps are the cheapest high-quality discovery signal on a large site:
// they hand over the URL inventory without a link-following crawl. The parse
// must therefore be tolerant — real sitemaps are gzipped, namespaced, plain
// text, or index files nested two levels deep.

import { gunzipSync } from "node:zlib";
import { CRAWLER_USER_AGENT } from "./robots";
import { DEFAULT_CRAWL_CONFIG } from "./config";

export interface SitemapEntry {
  loc: string;
  lastmod?: string;
  priority?: number;
  /** Which sitemap file the URL came from — useful for section diversity. */
  source: string;
}

export interface SitemapDiscovery {
  entries: SitemapEntry[];
  filesFetched: string[];
  indexesFollowed: string[];
  errors: Array<{ url: string; reason: string }>;
  truncated: boolean;
}

const CONVENTIONAL_PATHS = ["/sitemap.xml", "/sitemap_index.xml", "/sitemap-index.xml", "/sitemap/sitemap.xml", "/sitemap.txt"];

interface FetchOpts {
  signal: AbortSignal;
  maxBytes: number;
}

async function fetchSitemapBody(url: string, opts: FetchOpts): Promise<{ body: string } | { error: string }> {
  try {
    const res = await fetch(url, {
      headers: { "user-agent": CRAWLER_USER_AGENT, accept: "application/xml,text/xml,text/plain,*/*" },
      redirect: "follow",
      signal: opts.signal,
    });
    if (!res.ok) return { error: `http_${res.status}` };
    const declaredLength = Number(res.headers.get("content-length") ?? "0");
    if (declaredLength > opts.maxBytes) return { error: "too_large" };
    const contentType = res.headers.get("content-type") ?? "";
    if (/text\/html/i.test(contentType)) return { error: "html_not_sitemap" };
    const buffer = Buffer.from(await res.arrayBuffer());
    // `.xml.gz` sitemaps arrive as raw gzip when the server sets no
    // content-encoding; the magic bytes are the reliable test.
    const isGzip = buffer.length > 2 && buffer[0] === 0x1f && buffer[1] === 0x8b;
    let body: string;
    try {
      body = (isGzip ? gunzipSync(buffer) : buffer).toString("utf8");
    } catch {
      return { error: "gzip_decode_failed" };
    }
    return { body: body.slice(0, opts.maxBytes) };
  } catch (err) {
    return { error: (err as Error).name === "AbortError" ? "timeout" : "network_error" };
  }
}

export function isSitemapIndex(xml: string): boolean {
  return /<sitemapindex[\s>]/i.test(xml);
}

/** Parses `<url>` entries, keeping lastmod/priority where present. */
export function parseUrlset(xml: string, source: string, limit: number): SitemapEntry[] {
  const entries: SitemapEntry[] = [];
  const blocks = xml.matchAll(/<url\b[^>]*>([\s\S]*?)<\/url>/gi);
  for (const block of blocks) {
    if (entries.length >= limit) break;
    const inner = block[1] ?? "";
    const loc = firstTag(inner, "loc");
    if (!loc) continue;
    const priorityRaw = firstTag(inner, "priority");
    entries.push({
      loc,
      lastmod: firstTag(inner, "lastmod") ?? undefined,
      priority: priorityRaw ? Number(priorityRaw) : undefined,
      source,
    });
  }
  if (entries.length === 0) {
    // Some sitemaps omit <url> wrappers or use odd namespacing; fall back to
    // bare <loc> scanning, and to plain-text sitemaps (one URL per line).
    for (const loc of scanLocs(xml, limit)) entries.push({ loc, source });
    if (entries.length === 0 && !/[<>]/.test(xml.slice(0, 200))) {
      for (const line of xml.split(/\r?\n/)) {
        if (entries.length >= limit) break;
        const trimmed = line.trim();
        if (/^https?:\/\//i.test(trimmed)) entries.push({ loc: trimmed, source });
      }
    }
  }
  return entries;
}

export function parseSitemapIndex(xml: string, limit: number): string[] {
  const out: string[] = [];
  const blocks = xml.matchAll(/<sitemap\b[^>]*>([\s\S]*?)<\/sitemap>/gi);
  for (const block of blocks) {
    if (out.length >= limit) break;
    const loc = firstTag(block[1] ?? "", "loc");
    if (loc) out.push(loc);
  }
  if (out.length === 0) return scanLocs(xml, limit);
  return out;
}

function firstTag(xml: string, tag: string): string | null {
  const match = xml.match(new RegExp(`<${tag}\\b[^>]*>([\\s\\S]*?)<\\/${tag}>`, "i"));
  if (!match) return null;
  return decodeXmlEntities((match[1] ?? "").trim()) || null;
}

function scanLocs(xml: string, limit: number): string[] {
  const out: string[] = [];
  for (const match of xml.matchAll(/<loc>\s*([^<\s][^<]*?)\s*<\/loc>/gi)) {
    if (out.length >= limit) break;
    out.push(decodeXmlEntities((match[1] ?? "").trim()));
  }
  return out;
}

function decodeXmlEntities(value: string): string {
  return value
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&#(\d+);/g, (_, code) => String.fromCharCode(Number(code)))
    .replace(/&amp;/g, "&");
}

export interface DiscoverSitemapOptions {
  maxUrls?: number;
  maxIndexChildren?: number;
  maxFiles?: number;
  maxBytes?: number;
}

/**
 * Discovers URLs from robots-declared sitemaps first, falling back to the
 * conventional locations. Follows sitemap indexes to a bounded depth and
 * samples children across the index rather than exhausting the first child,
 * so a 50-file index still yields a cross-section of the site.
 */
export async function discoverSitemap(
  origin: string,
  robotsSitemaps: string[],
  signal: AbortSignal,
  options: DiscoverSitemapOptions = {},
): Promise<SitemapDiscovery> {
  const maxUrls = options.maxUrls ?? DEFAULT_CRAWL_CONFIG.maxSitemapUrls;
  const maxIndexChildren = options.maxIndexChildren ?? DEFAULT_CRAWL_CONFIG.maxSitemapIndexChildren;
  const maxFiles = options.maxFiles ?? DEFAULT_CRAWL_CONFIG.maxSitemapFiles;
  const maxBytes = options.maxBytes ?? DEFAULT_CRAWL_CONFIG.maxSitemapBytes;

  const result: SitemapDiscovery = { entries: [], filesFetched: [], indexesFollowed: [], errors: [], truncated: false };
  const seenFiles = new Set<string>();
  const seenLocs = new Set<string>();

  const candidates = [...robotsSitemaps, ...CONVENTIONAL_PATHS.map((p) => `${origin}${p}`)];
  const queue: Array<{ url: string; depth: number }> = [];
  for (const candidate of candidates) {
    const absolute = safeAbsolute(candidate, origin);
    if (absolute && !seenFiles.has(absolute)) {
      seenFiles.add(absolute);
      queue.push({ url: absolute, depth: 0 });
    }
  }

  const pendingChildren: Array<{ url: string; depth: number }> = [];

  // Children of an index are queued behind every remaining top-level
  // candidate (breadth first), and drained whenever the queue runs dry. The
  // previous version only drained when the queue was empty at the moment the
  // index was parsed, which never happened for a robots-declared index
  // followed by the conventional paths: WordPress, Yoast and Shopify sites
  // all returned zero sitemap URLs.
  while ((queue.length > 0 || pendingChildren.length > 0) && result.filesFetched.length < maxFiles && result.entries.length < maxUrls) {
    if (queue.length === 0) queue.push(...pendingChildren.splice(0));
    const next = queue.shift()!;
    const fetched = await fetchSitemapBody(next.url, { signal, maxBytes });
    if ("error" in fetched) {
      result.errors.push({ url: next.url, reason: fetched.error });
      continue;
    }
    result.filesFetched.push(next.url);

    if (isSitemapIndex(fetched.body) && next.depth < 2) {
      result.indexesFollowed.push(next.url);
      const children = parseSitemapIndex(fetched.body, maxIndexChildren * 4);
      // Sample across the index: taking the first N children of a large
      // ecommerce index usually returns nothing but product URLs. Page and
      // post sitemaps are preferred over taxonomy/category/tag/author files,
      // which are archives rather than business pages.
      const ranked = [...children].sort((a, b) => sitemapChildPriority(a) - sitemapChildPriority(b));
      for (const child of sampleEvenly(ranked, maxIndexChildren)) {
        const absolute = safeAbsolute(child, origin);
        if (absolute && !seenFiles.has(absolute)) {
          seenFiles.add(absolute);
          pendingChildren.push({ url: absolute, depth: next.depth + 1 });
        }
      }
      // Once a real index has been found, the conventional guesses are
      // redundant requests.
      for (let i = queue.length - 1; i >= 0; i--) {
        if (CONVENTIONAL_PATHS.some((p) => queue[i]!.url === `${origin}${p}`)) queue.splice(i, 1);
      }
      continue;
    }

    // One file never gets the whole URL budget. postman.com's index lists 26
    // children; the first one fetched (other companies' public API
    // collections, 13,136 URLs) filled all 1,500 slots, the marketing sitemap
    // holding /pricing and /downloads was never read, and the profile was built
    // from one home page. Each file is capped so the budget spans the index.
    const perFile = Math.max(60, Math.ceil(maxUrls / Math.max(1, maxFiles)));
    const parsed = parseUrlset(fetched.body, next.url, Math.min(perFile, maxUrls - result.entries.length));
    for (const entry of parsed) {
      if (seenLocs.has(entry.loc)) continue;
      seenLocs.add(entry.loc);
      result.entries.push(entry);
      if (result.entries.length >= maxUrls) {
        result.truncated = true;
        break;
      }
    }
    // Only fall through to the conventional paths when robots gave us nothing
    // usable; otherwise a site with a valid sitemap also gets probed for
    // /sitemap_index.xml etc., which is wasted requests.
    if (result.entries.length > 0 && robotsSitemaps.length > 0) {
      for (let i = queue.length - 1; i >= 0; i--) {
        if (CONVENTIONAL_PATHS.some((p) => queue[i]!.url === `${origin}${p}`)) queue.splice(i, 1);
      }
    }
  }

  if (queue.length > 0 || pendingChildren.length > 0) result.truncated = true;
  return result;
}

/**
 * Lower is better: the site's own page/product/service sitemaps first, blog
 * and news next, taxonomy archives after, and directories of other people's
 * content (user profiles, team workspaces, public collections, forum posts)
 * last. Exported for tests.
 *
 * Matched on the sitemap FILE name, never the whole URL: matching the host
 * put every child of www.postman.com in the "post|blog" tier because the
 * hostname contains "post", and the one child that escaped it was the public
 * team-collections directory, matched by "collections" (a rule written for
 * Shopify product collections).
 */
export function sitemapChildPriority(url: string): number {
  let file: string;
  try {
    const path = new URL(url).pathname.toLowerCase();
    file = path.split("/").filter(Boolean).at(-1) ?? path;
  } catch {
    file = url.toLowerCase();
  }
  // Someone else's content on the site: worthless for understanding the business.
  if (/\b(public|user|users|profile|profiles|member|members|community|forum|workspace|workspaces|request|requests|team-collections|user-collections|comments?|reviews?-by|authors?)\b/.test(file.replace(/[-_.]/g, " "))) return 4;
  if (/\b(page|pages|marketing|main|www|site|static|company|about|product|products|service|services|solution|solutions|pricing|location|locations|menu|collection|collections|categories|category)\b/.test(file.replace(/[-_.]/g, " "))) return 0;
  if (/\b(post|posts|blog|blogs|article|articles|news|resources?|learning|docs?)\b/.test(file.replace(/[-_.]/g, " "))) return 1;
  if (/\b(tag|tags|taxonom\w*|archive|archives|attachment|attachments|media|image|images|video|videos)\b/.test(file.replace(/[-_.]/g, " "))) return 3;
  return 2;
}

function safeAbsolute(value: string, base: string): string | null {
  try {
    const url = new URL(value, base);
    return url.protocol === "http:" || url.protocol === "https:" ? url.toString() : null;
  } catch {
    return null;
  }
}

/** Takes `count` items spread evenly across the list, always including the first. */
export function sampleEvenly<T>(items: T[], count: number): T[] {
  if (items.length <= count) return [...items];
  const step = items.length / count;
  const out: T[] = [];
  for (let i = 0; i < count; i++) out.push(items[Math.floor(i * step)]!);
  return out;
}
