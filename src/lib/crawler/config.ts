// Every crawl bound lives here rather than as a magic number at a call site,
// so tuning the planner is a single-file exercise and the benchmark harness
// can override bounds per scenario.

export interface CrawlConfig {
  /** Hard ceiling on URLs held in the frontier at once. */
  maxUrls: number;
  /** Pages actually fetched over the network. */
  maxPages: number;
  /** Pages promoted into the evidence store. */
  maxSelectedPages: number;
  maxDepth: number;
  /** Simultaneous in-flight requests to the single target host. */
  concurrencyPerHost: number;
  /** Politeness delay applied between request batches (robots crawl-delay wins if larger). */
  minRequestIntervalMs: number;
  maxRedirects: number;
  timeoutMs: number;
  maxContentBytes: number;
  maxTotalTimeMs: number;
  playwrightFallbackEnabled: boolean;
  /** Ceiling on how many pages may be re-fetched through a headless browser. */
  maxBrowserFallbacks: number;
  /** Menu, brochure and price-list PDFs read per crawl, and the size cap of each. */
  maxDocuments: number;
  maxDocumentBytes: number;
  nearDuplicateThreshold: number;
  /** No single URL-pattern family may occupy more than this share of the fetch budget. */
  maxShareOfBudgetPerUrlFamily: number;
  /** Absolute cap on pages fetched from one URL-pattern family (e.g. /products/<sku>). */
  maxPagesPerUrlFamily: number;
  /** Sitemap bounds. */
  maxSitemapBytes: number;
  maxSitemapUrls: number;
  maxSitemapIndexChildren: number;
  maxSitemapFiles: number;
}

export const DEFAULT_CRAWL_CONFIG: CrawlConfig = {
  maxUrls: 400,
  maxPages: 30,
  maxSelectedPages: 26,
  maxDepth: 2,
  concurrencyPerHost: 4,
  minRequestIntervalMs: 0,
  maxRedirects: 5,
  timeoutMs: 12_000,
  maxContentBytes: 2_000_000,
  maxTotalTimeMs: 90_000,
  playwrightFallbackEnabled: true,
  // Four: the seed, a menu or product page, its framed ordering page and one
  // more; three ran out before a restaurant's ordering menu was reached.
  maxBrowserFallbacks: 4,
  maxDocuments: 4,
  // A designed menu with photographs runs to 10-20 MB; only the text is kept.
  maxDocumentBytes: 25_000_000,
  nearDuplicateThreshold: 0.88,
  maxShareOfBudgetPerUrlFamily: 0.3,
  maxPagesPerUrlFamily: 6,
  maxSitemapBytes: 5_000_000,
  maxSitemapUrls: 1_500,
  maxSitemapIndexChildren: 12,
  maxSitemapFiles: 6,
};

export function getCrawlConfig(overrides: Partial<CrawlConfig> = {}): CrawlConfig {
  return {
    ...DEFAULT_CRAWL_CONFIG,
    maxUrls: numEnv("SUN_CRAWL_MAX_URLS", DEFAULT_CRAWL_CONFIG.maxUrls),
    maxPages: numEnv("SUN_CRAWL_MAX_PAGES", DEFAULT_CRAWL_CONFIG.maxPages),
    maxSelectedPages: numEnv("SUN_CRAWL_MAX_SELECTED_PAGES", DEFAULT_CRAWL_CONFIG.maxSelectedPages),
    maxDepth: numEnv("SUN_CRAWL_MAX_DEPTH", DEFAULT_CRAWL_CONFIG.maxDepth),
    concurrencyPerHost: numEnv("SUN_CRAWL_CONCURRENCY", DEFAULT_CRAWL_CONFIG.concurrencyPerHost),
    timeoutMs: numEnv("SUN_CRAWL_TIMEOUT_MS", DEFAULT_CRAWL_CONFIG.timeoutMs),
    maxContentBytes: numEnv("SUN_CRAWL_MAX_CONTENT_BYTES", DEFAULT_CRAWL_CONFIG.maxContentBytes),
    maxTotalTimeMs: numEnv("SUN_CRAWL_MAX_TOTAL_TIME_MS", DEFAULT_CRAWL_CONFIG.maxTotalTimeMs),
    maxBrowserFallbacks: numEnv("SUN_CRAWL_MAX_BROWSER_FALLBACKS", DEFAULT_CRAWL_CONFIG.maxBrowserFallbacks),
    playwrightFallbackEnabled: process.env.SUN_PLAYWRIGHT_FALLBACK_ENABLED !== "false",
    ...overrides,
  };
}

function numEnv(key: string, fallback: number): number {
  const raw = process.env[key];
  if (!raw) return fallback;
  const n = Number(raw);
  return Number.isFinite(n) && n > 0 ? n : fallback;
}
