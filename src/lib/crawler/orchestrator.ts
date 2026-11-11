// Website Intelligence crawl orchestrator.
//
// Responsibilities, in order:
//   normalize + SSRF-check the seed -> robots -> sitemap -> plan -> fetch in
//   bounded parallel batches -> classify -> extract typed evidence -> emit
//   progress events as each page lands.
//
// Evidence is written per page, not at the end, so profile synthesis can begin
// on partial evidence and the UI can populate progressively. Nothing here
// knows about the profile schema — it produces evidence and pages, and the
// profile layer consumes them.

import { normalizeUrl, assertResolvesToPublicAddress, UnsafeUrlError } from "@/lib/security/url-safety";
import { fetchRobotsPolicy, type RobotsPolicy } from "./robots";
import { discoverSitemap, type SitemapEntry } from "./sitemap";
import { safeFetchHtml } from "./fetcher";
import { extractPage, essentialContentMissing, type ExtractedPage } from "./extractor";
import { classifyPage, type PageType } from "./page-classifier";
import { CrawlPlanner, type PlannerCandidate } from "./crawl-planner";
import { canonicalizeUrl, isSameBusinessSite } from "./url-canonical";
import { getCrawlConfig, type CrawlConfig } from "./config";
import { isPlaywrightChromiumAvailable, renderWithPlaywright } from "./playwright-fallback";
import { documentTitle, extractDocumentPage, isMenuDocument } from "./documents";
import { createCrawlRun, updateCrawlRun, insertCrawlPage, insertEvidenceChunks } from "./repository";
import { insertEvidenceItems } from "@/lib/evidence/repository";
import { buildEvidenceForPage } from "@/lib/evidence/builder";
import type { EvidenceItem } from "@/lib/evidence/types";
import { storeEvidence } from "@/lib/evidence/store";
import { textSimilarity } from "@/lib/text/similarity";
import { newId } from "@/lib/ids";
import { appendEvent } from "@/lib/events/bus";
import type { GscMetricRow } from "@/lib/search-console/types";

const CHUNK_SIZE = 1500;
const CHUNK_OVERLAP = 150;

export interface CrawledPageRecord {
  id: string;
  url: string;
  canonicalUrl: string | null;
  pageType: PageType;
  title: string | null;
  metaDescription: string | null;
  extracted: ExtractedPage;
  isSelected: boolean;
}

export interface CrawlOutcome {
  crawlRunId: string;
  status: "completed" | "blocked" | "failed";
  blockReason?: string;
  registrableDomain: string;
  seedUrl: string;
  pages: CrawledPageRecord[];
  evidence: EvidenceItem[];
  metrics: CrawlMetrics;
}

export interface CrawlMetrics {
  durationMs: number;
  urlsDiscovered: number;
  urlsAdmitted: number;
  urlsSelectedForFetch: number;
  pagesFetched: number;
  pagesFailed: number;
  pagesSelected: number;
  /** Browser render attempts (adopted or not). */
  browserFallbacks: number;
  /** Renders whose DOM replaced the static HTML because it held more text. */
  browserRendersAdopted?: number;
  bytesDownloaded: number;
  evidenceItems: number;
  trapsRejected: number;
  offSiteRejected: number;
  /** On-site URLs dropped because the frontier was full (was silently uncounted). */
  frontierFullRejected?: number;
  /** Sitemap-only entries displaced by nav links that arrived later. */
  frontierEvicted?: number;
  sitemapUrls: number;
  robotsCrawlDelayMs: number;
  timeToFirstPageMs: number | null;
  bySlot: Record<string, number>;
}

export interface RunCrawlOptions {
  configOverrides?: Partial<CrawlConfig>;
  /** Invoked as soon as each page's evidence is persisted, for progressive synthesis. */
  onPageEvidence?: (page: CrawledPageRecord, evidence: EvidenceItem[], all: EvidenceItem[]) => void | Promise<void>;
  /**
   * Google Search Console top pages. The crawl never waits for them: whenever
   * they resolve, the planner lifts those URLs from its next batch on.
   */
  searchPages?: Promise<GscMetricRow[]>;
  /**
   * Whether the operator asked for Search Console on this run, recorded as
   * `metrics.searchConsoleRequested` when the run row is created. A later
   * bodiless "Analyse again" reuses it, so a retry after a stalled run does not
   * silently drop Search Console.
   */
  searchConsoleRequested?: boolean;
  /** Called synchronously once the run row exists, before `crawl.started` is emitted. */
  onRunCreated?: (crawlRunId: string) => void;
}

export async function runCrawl(
  projectId: string,
  startUrl: string,
  targetLanguage: string,
  options: RunCrawlOptions = {},
): Promise<CrawlOutcome> {
  const config = getCrawlConfig(options.configOverrides);
  const startedAt = Date.now();
  const runMetrics: Record<string, string> =
    options.searchConsoleRequested === undefined ? {} : { searchConsoleRequested: options.searchConsoleRequested ? "yes" : "no" };
  const crawlRun = await createCrawlRun(projectId, Object.keys(runMetrics).length > 0 ? { metrics: runMetrics } : {});
  options.onRunCreated?.(crawlRun.id);

  const metrics: CrawlMetrics = {
    durationMs: 0,
    urlsDiscovered: 0,
    urlsAdmitted: 0,
    urlsSelectedForFetch: 0,
    pagesFetched: 0,
    pagesFailed: 0,
    pagesSelected: 0,
    browserFallbacks: 0,
    bytesDownloaded: 0,
    evidenceItems: 0,
    trapsRejected: 0,
    offSiteRejected: 0,
    sitemapUrls: 0,
    robotsCrawlDelayMs: 0,
    timeToFirstPageMs: null,
    bySlot: {},
  };

  const fail = async (reason: string, status: "blocked" | "failed" = "blocked"): Promise<CrawlOutcome> => {
    metrics.durationMs = Date.now() - startedAt;
    await updateCrawlRun(crawlRun.id, { status, blockReason: reason, completedAt: new Date(), metrics: toMetricsJson(metrics, runMetrics) });
    appendEvent(projectId, status === "blocked" ? "crawl.blocked" : "crawl.failed", { crawlRunId: crawlRun.id, reason });
    return { crawlRunId: crawlRun.id, status, blockReason: reason, registrableDomain: "", seedUrl: startUrl, pages: [], evidence: [], metrics };
  };

  // Announced before the seed is validated so a rejected URL still shows up on
  // the progress stream as "started, then failed" rather than as silence.
  appendEvent(projectId, "crawl.started", { crawlRunId: crawlRun.id, startUrl, targetLanguage });

  let seed: { url: URL; registrableDomain: string; hostname: string };
  try {
    seed = normalizeUrl(startUrl);
    await assertResolvesToPublicAddress(seed.hostname);
  } catch (err) {
    return fail(err instanceof UnsafeUrlError ? err.code : "unknown_url_error");
  }

  appendEvent(projectId, "crawl.page.discovered", {
    crawlRunId: crawlRun.id,
    domain: seed.registrableDomain,
    count: 1,
  });

  const origin = seed.url.origin;
  let robots: RobotsPolicy;
  try {
    robots = await fetchRobotsPolicy(origin, AbortSignal.timeout(config.timeoutMs));
  } catch {
    robots = { fetched: false, sitemaps: [], crawlDelayMs: 0, matchedAgent: null, isAllowed: () => true };
  }
  metrics.robotsCrawlDelayMs = robots.crawlDelayMs;
  const seedPath = `${seed.url.pathname || "/"}${seed.url.search}`;
  await updateCrawlRun(crawlRun.id, { robotsAllowed: robots.isAllowed(seedPath), robotsCheckedAt: new Date() });

  if (!robots.isAllowed(seedPath)) return fail("robots_disallowed");

  const planner = new CrawlPlanner(config, seed.url.toString(), (url) => {
    try {
      return isSameBusinessSite(new URL(url).hostname, seed.hostname);
    } catch {
      return false;
    }
  });

  planner.discover(seed.url.toString(), { depth: 0, inSitemap: false, inboundLinks: 1 });
  // Late rows still count: the planner rescores every waiting URL per batch.
  void options.searchPages
    ?.then((rows) => {
      if (rows.length > 0) planner.applySearchDemand(rows);
    })
    .catch(() => undefined);

  const sitemap = await discoverSitemap(origin, robots.sitemaps, AbortSignal.timeout(config.timeoutMs), {
    maxUrls: config.maxSitemapUrls,
    maxIndexChildren: config.maxSitemapIndexChildren,
    maxFiles: config.maxSitemapFiles,
    maxBytes: config.maxSitemapBytes,
  });
  metrics.sitemapUrls = sitemap.entries.length;
  // Sitemap URLs are admitted round-robin across the files they came from and
  // never fill the whole frontier: with the first file's entries taking every
  // slot, postman.com's home-page navigation (/product, /pricing, /enterprise)
  // arrived to a full frontier and was dropped, so the profile was built from
  // 21 other companies' API collections and one home page.
  const sitemapAdmissionCap = Math.max(50, Math.floor(config.maxUrls * 0.6));
  const bySource = new Map<string, SitemapEntry[]>();
  for (const entry of sitemap.entries) bySource.set(entry.source, [...(bySource.get(entry.source) ?? []), entry]);
  const sources = [...bySource.values()];
  let sitemapAdmitted = 0;
  for (let index = 0; sitemapAdmitted < sitemapAdmissionCap; index++) {
    let added = false;
    for (const list of sources) {
      const entry = list[index];
      if (!entry) continue;
      added = true;
      planner.discover(entry.loc, { depth: 1, inSitemap: true });
      sitemapAdmitted++;
      if (sitemapAdmitted >= sitemapAdmissionCap) break;
    }
    if (!added) break;
  }
  await updateCrawlRun(crawlRun.id, { sitemapUrls: sitemap.filesFetched.slice(0, 20) });
  appendEvent(projectId, "crawl.sitemap.discovered", {
    crawlRunId: crawlRun.id,
    files: sitemap.filesFetched.length,
    indexes: sitemap.indexesFollowed.length,
    urls: sitemap.entries.length,
    truncated: sitemap.truncated,
  });
  appendEvent(projectId, "crawl.page.discovered", { crawlRunId: crawlRun.id, count: planner.stats().admitted });

  const pages: CrawledPageRecord[] = [];
  const allEvidence: EvidenceItem[] = [];
  const selectedTexts: Array<{ pageId: string; url: string; text: string; hash: string }> = [];
  const runState: RunState = { browserFallbacks: 0, documents: 0 };

  const deadlineReached = () => Date.now() - startedAt > config.maxTotalTimeMs;

  while (planner.hasWork() && planner.budgetRemaining() > 0 && !deadlineReached()) {
    const batch = planner.takeBatch(Math.min(config.concurrencyPerHost, planner.budgetRemaining()));
    if (batch.length === 0) break;
    metrics.urlsSelectedForFetch += batch.length;
    for (const candidate of batch) {
      appendEvent(projectId, "crawl.page.selected", {
        crawlRunId: crawlRun.id,
        url: candidate.url,
        pageType: candidate.pageType,
        score: Number(candidate.score.toFixed(2)),
      });
    }

    const results = await Promise.all(batch.map((candidate) => fetchAndExtract(candidate, robots, config, runState)));

    for (const result of results) {
      if (deadlineReached()) break;
      const { candidate } = result;
      if (!result.ok) {
        metrics.pagesFailed++;
        appendEvent(projectId, "crawl.page.skipped", { crawlRunId: crawlRun.id, url: candidate.url, reason: result.error });
        await insertCrawlPage({
          id: newId("pg"),
          crawlRunId: crawlRun.id,
          url: candidate.url,
          normalizedUrl: candidate.canonicalUrl,
          pageType: candidate.pageType,
          httpStatus: result.status ?? null,
          fetchMethod: "http",
          contentHash: null,
          score: Math.round(candidate.score * 100),
          selectedReason: `fetch_failed:${result.error}`,
          isSelected: false,
          slotKey: candidate.slotKey,
          familyKey: candidate.familyKey,
          scoreBreakdown: candidate.breakdown,
          title: null,
          metaDescription: null,
          canonicalUrl: null,
          headings: [],
          jsonLd: [],
          structuredSignals: {},
          schemaTypes: [],
          hreflang: [],
          breadcrumb: [],
          htmlLang: null,
          ogSiteName: null,
          wordCount: 0,
          fetchMs: result.fetchMs,
          fetchedAt: new Date(),
          error: result.error ?? null,
        });
        continue;
      }

      metrics.pagesFetched++;
      metrics.bytesDownloaded += result.bytes;
      if (metrics.timeToFirstPageMs === null) metrics.timeToFirstPageMs = Date.now() - startedAt;
      // Every render attempt counts, adopted or not: the run row said the
      // browser was used while the metrics said 0 because only adopted renders
      // were mirrored here.
      metrics.browserFallbacks = runState.browserFallbacks;
      if (result.usedBrowser) metrics.browserRendersAdopted = (metrics.browserRendersAdopted ?? 0) + 1;

      const extracted = result.extracted;
      const finalUrl = result.finalUrl;
      let classification = classifyPage({
        url: finalUrl,
        anchorText: candidate.signals.anchorText,
        breadcrumbTrail: extracted.breadcrumb,
        title: extracted.title,
        h1: extracted.h1,
        schemaTypes: extracted.schemaEntities.flatMap((e) => e.types),
        itemCardCount: extracted.itemCardCount,
        hasArticleBody: extracted.hasArticleBody,
        publishedDate: extracted.publishedDate,
      });
      // A menu document is a menu page whatever its file name looks like.
      if (result.document) classification = { ...classification, pageType: "menu", signals: ["document:menu", ...classification.signals] };
      planner.recordFetched(candidate, classification.pageType);
      appendEvent(projectId, "crawl.page.classified", {
        crawlRunId: crawlRun.id,
        url: finalUrl,
        pageType: classification.pageType,
        signals: classification.signals.slice(0, 4),
      });

      // Discover onward links, marking navigation/footer prominence so the
      // planner can prefer the site's own primary taxonomy.
      if (candidate.signals.depth < config.maxDepth) {
        const inboundSeen = new Set<string>();
        for (const link of extracted.links) {
          const canonical = canonicalizeUrl(link.href);
          if (!canonical || inboundSeen.has(canonical)) continue;
          inboundSeen.add(canonical);
          planner.discover(canonical, {
            depth: candidate.signals.depth + 1,
            inPrimaryNav: link.inNav,
            inFooter: link.inFooter,
            inboundLinks: 1,
            anchorText: link.text,
            breadcrumbTrail: extracted.breadcrumb,
          });
        }
      }

      const duplicate = findDuplicate(selectedTexts, extracted, config.nearDuplicateThreshold);
      const wordCount = extracted.mainText.split(/\s+/).filter(Boolean).length;
      // Selection is about evidence value, not fetch success: a duplicate or
      // an empty page is recorded but contributes no evidence.
      const selectionBudgetFull = pages.filter((p) => p.isSelected).length >= config.maxSelectedPages;
      const hasContent = wordCount >= 25 || extracted.schemaEntities.length > 0 || extracted.cardTitles.length >= 3;
      const isSelected = !duplicate && !selectionBudgetFull && hasContent;

      const pageId = newId("pg");
      await insertCrawlPage({
        id: pageId,
        crawlRunId: crawlRun.id,
        url: finalUrl,
        normalizedUrl: candidate.canonicalUrl,
        pageType: classification.pageType,
        httpStatus: result.status ?? null,
        fetchMethod: result.document ? "pdf" : result.usedBrowser ? "playwright" : "http",
        contentHash: extracted.contentHash,
        score: Math.round(candidate.score * 100),
        selectedReason: isSelected
          ? `selected pageType=${classification.pageType} score=${candidate.score.toFixed(2)} signals=${classification.signals.join(",")}`
          : duplicate
            ? `duplicate_of=${duplicate.url}`
            : selectionBudgetFull && hasContent
              ? "selection_budget_full"
              : "insufficient_content",
        isSelected,
        slotKey: candidate.slotKey,
        familyKey: candidate.familyKey,
        scoreBreakdown: candidate.breakdown,
        title: extracted.title,
        metaDescription: extracted.metaDescription,
        canonicalUrl: extracted.canonicalUrl,
        headings: extracted.headings,
        jsonLd: extracted.jsonLd.slice(0, 30),
        structuredSignals: {
          addresses: extracted.addresses,
          phoneCountrySignals: extracted.phoneCountrySignals,
          currencySignals: extracted.currencySignals,
          commerceAffordances: extracted.commerceAffordances,
          navLabels: extracted.navLabels.slice(0, 30),
          cardTitles: extracted.cardTitles.slice(0, 30),
        },
        schemaTypes: [...new Set(extracted.schemaEntities.flatMap((e) => e.types))].slice(0, 30),
        hreflang: extracted.hreflang.slice(0, 40),
        breadcrumb: extracted.breadcrumb,
        htmlLang: extracted.htmlLang,
        ogSiteName: extracted.ogSiteName,
        wordCount,
        fetchMs: result.fetchMs,
        fetchedAt: new Date(),
        error: null,
      });

      const record: CrawledPageRecord = {
        id: pageId,
        url: finalUrl,
        canonicalUrl: extracted.canonicalUrl,
        pageType: classification.pageType,
        title: extracted.title,
        metaDescription: extracted.metaDescription,
        extracted,
        isSelected,
      };
      pages.push(record);
      metrics.bySlot[candidate.slotKey] = (metrics.bySlot[candidate.slotKey] ?? 0) + 1;

      if (!isSelected) {
        appendEvent(projectId, "crawl.page.skipped", {
          crawlRunId: crawlRun.id,
          url: finalUrl,
          reason: duplicate ? "duplicate" : "insufficient_content",
        });
        continue;
      }

      metrics.pagesSelected++;
      selectedTexts.push({ pageId, url: finalUrl, text: extracted.mainText, hash: extracted.contentHash });
      storeEvidence(projectId, extracted.mainText);

      const evidence = await insertEvidenceItems(
        buildEvidenceForPage(
          {
            runId: crawlRun.id,
            projectId,
            crawlPageId: pageId,
            url: finalUrl,
            canonicalUrl: extracted.canonicalUrl,
            pageType: classification.pageType,
          },
          extracted,
        ),
      );
      allEvidence.push(...evidence);
      metrics.evidenceItems = allEvidence.length;

      // Text chunks remain for downstream prompt generation, which indexes on
      // them; typed evidence items are what profile synthesis cites.
      await insertEvidenceChunks(
        chunkText(extracted.mainText).map((chunk, index) => ({
          id: newId("evc"),
          crawlPageId: pageId,
          projectId,
          chunkIndex: index,
          text: chunk.text,
          charOffsetStart: chunk.start,
          charOffsetEnd: chunk.end,
          hash: extracted.contentHash,
        })),
      );

      appendEvent(projectId, "crawl.evidence.extracted", {
        crawlRunId: crawlRun.id,
        url: finalUrl,
        pageType: classification.pageType,
        items: evidence.length,
        totalItems: allEvidence.length,
        pagesProcessed: metrics.pagesSelected,
        pagesPlanned: metrics.urlsSelectedForFetch,
      });

      await options.onPageEvidence?.(record, evidence, allEvidence);
    }

    const plannerStats = planner.stats();
    metrics.urlsDiscovered = plannerStats.discovered;
    metrics.urlsAdmitted = plannerStats.admitted;
    metrics.trapsRejected = plannerStats.rejectedTraps;
    metrics.offSiteRejected = plannerStats.rejectedOffSite;
    metrics.frontierFullRejected = plannerStats.rejectedFrontierFull;
    metrics.frontierEvicted = plannerStats.evicted;
    await updateCrawlRun(crawlRun.id, {
      discoveredCount: plannerStats.admitted,
      fetchedCount: metrics.pagesFetched,
      selectedCount: metrics.pagesSelected,
      usedPlaywrightFallback: runState.browserFallbacks > 0,
    });

    if (robots.crawlDelayMs > 0) await sleep(robots.crawlDelayMs);
  }

  metrics.durationMs = Date.now() - startedAt;
  const status = metrics.pagesFetched === 0 ? "failed" : "completed";
  await updateCrawlRun(crawlRun.id, {
    status,
    completedAt: new Date(),
    discoveredCount: metrics.urlsAdmitted,
    fetchedCount: metrics.pagesFetched,
    selectedCount: metrics.pagesSelected,
    usedPlaywrightFallback: runState.browserFallbacks > 0,
    blockReason: status === "failed" ? "no_pages_fetched" : null,
    metrics: toMetricsJson(metrics, runMetrics),
  });
  appendEvent(projectId, status === "failed" ? "crawl.failed" : "crawl.completed", {
    crawlRunId: crawlRun.id,
    fetched: metrics.pagesFetched,
    selected: metrics.pagesSelected,
    evidence: allEvidence.length,
    durationMs: metrics.durationMs,
    reason: status === "failed" ? "no_pages_fetched" : undefined,
  });

  return {
    crawlRunId: crawlRun.id,
    status,
    blockReason: status === "failed" ? "no_pages_fetched" : undefined,
    registrableDomain: seed.registrableDomain,
    seedUrl: seed.url.toString(),
    pages,
    evidence: allEvidence,
    metrics,
  };
}

interface FetchResult {
  candidate: PlannerCandidate;
  ok: boolean;
  status?: number;
  error?: string;
  finalUrl: string;
  extracted: ExtractedPage;
  usedBrowser: boolean;
  /** The page is the text of a menu, brochure or price-list PDF. */
  document?: boolean;
  bytes: number;
  fetchMs: number;
}

/** Per-run mutable state; never module-global, so concurrent runs can't
 * consume each other's browser budget. */
/** Page types whose text describes the business itself; a JS shell of one of these is worth a render. */
const RENDER_WORTHY_TYPES = new Set<PageType>(["home", "about", "pricing", "product_index", "service_index", "menu", "solution", "product", "service", "category", "industry", "location", "contact"]);

interface RunState {
  browserFallbacks: number;
  /** Menu, brochure and price-list PDFs read so far. */
  documents: number;
}

async function fetchAndExtract(
  candidate: PlannerCandidate,
  robots: RobotsPolicy,
  config: CrawlConfig,
  state: RunState,
): Promise<FetchResult> {
  const started = Date.now();
  const empty = { candidate, finalUrl: candidate.url, extracted: extractPage("<html></html>", candidate.url), usedBrowser: false, bytes: 0 };

  let parsed: URL;
  try {
    parsed = new URL(candidate.url);
  } catch {
    return { ...empty, ok: false, error: "invalid_url", fetchMs: Date.now() - started };
  }
  if (!robots.isAllowed(`${parsed.pathname}${parsed.search}`)) {
    return { ...empty, ok: false, error: "robots_disallowed", fetchMs: Date.now() - started };
  }
  try {
    // Re-resolved per URL: a hostname that was public at seed time can be
    // re-pointed at a private address mid-crawl (DNS rebinding).
    await assertResolvesToPublicAddress(parsed.hostname);
  } catch (err) {
    return { ...empty, ok: false, error: err instanceof UnsafeUrlError ? err.code : "dns_error", fetchMs: Date.now() - started };
  }

  // Menu documents: a few PDFs per crawl, read as menu pages. No browser
  // render, no onward links.
  if (isMenuDocument(candidate.url, candidate.signals.anchorText)) {
    if (state.documents >= config.maxDocuments) return { ...empty, ok: false, error: "document_budget_spent", fetchMs: Date.now() - started };
    state.documents++;
    const document = await safeFetchHtml(candidate.url, { timeoutMs: config.timeoutMs, maxContentBytes: config.maxDocumentBytes, maxRedirects: config.maxRedirects, acceptPdf: true });
    if (!document.ok || !document.bytes) return { ...empty, ok: false, status: document.status, error: document.error ?? "empty_document", fetchMs: Date.now() - started };
    const documentUrl = document.finalUrl ?? candidate.url;
    const page = await extractDocumentPage(document.bytes, documentUrl, documentTitle(candidate.url, candidate.signals.anchorText));
    if (!page) return { ...empty, ok: false, status: document.status, error: "document_without_text", fetchMs: Date.now() - started };
    return { candidate, ok: true, status: document.status, finalUrl: documentUrl, extracted: page, usedBrowser: false, document: true, bytes: document.bytes.byteLength, fetchMs: Date.now() - started };
  }

  const fetched = await safeFetchHtml(candidate.url, {
    timeoutMs: config.timeoutMs,
    maxContentBytes: config.maxContentBytes,
    maxRedirects: config.maxRedirects,
  });
  if (!fetched.ok || !fetched.body) {
    return { ...empty, ok: false, status: fetched.status, error: fetched.error ?? "empty_body", fetchMs: Date.now() - started };
  }

  const finalUrl = fetched.finalUrl ?? candidate.url;
  let extracted = extractPage(fetched.body, finalUrl);
  let usedBrowser = false;

  // The render budget (3 a run) goes to pages worth rendering: the home page
  // always qualifies, other pages only when their type carries the business's
  // own description. Postman spent all three renders on the first three empty
  // pages of other companies' API collections, and its 70-word home page was
  // never rendered.
  const isSeed = candidate.signals.depth === 0 || candidate.pageType === "home";
  const worthRendering = isSeed || RENDER_WORTHY_TYPES.has(candidate.pageType);
  if (
    config.playwrightFallbackEnabled &&
    worthRendering &&
    state.browserFallbacks < config.maxBrowserFallbacks &&
    essentialContentMissing(extracted, { isSeed }) &&
    (await isPlaywrightChromiumAvailable())
  ) {
    state.browserFallbacks++;
    const rendered = await renderWithPlaywright(finalUrl, config.timeoutMs);
    if (rendered.ok && rendered.html) {
      const reExtracted = extractPage(rendered.html, finalUrl);
      // Only adopt the rendered DOM when it actually produced more content.
      if (reExtracted.mainText.length > extracted.mainText.length) {
        extracted = reExtracted;
        usedBrowser = true;
      }
    }
  }

  return {
    candidate,
    ok: true,
    status: fetched.status,
    finalUrl,
    extracted,
    usedBrowser,
    bytes: fetched.body.length,
    fetchMs: Date.now() - started,
  };
}

function findDuplicate(
  seen: Array<{ pageId: string; url: string; text: string; hash: string }>,
  extracted: ExtractedPage,
  threshold: number,
): { pageId: string; url: string } | undefined {
  if (extracted.mainText.length === 0) return undefined;
  const exact = seen.find((s) => s.hash === extracted.contentHash);
  if (exact) return exact;
  // Similarity is O(n) per comparison; cap the comparison set so a 26-page
  // crawl never becomes quadratic on long documents.
  for (const candidate of seen.slice(-15)) {
    if (Math.abs(candidate.text.length - extracted.mainText.length) > candidate.text.length * 0.5) continue;
    if (textSimilarity(candidate.text, extracted.mainText) >= threshold) return candidate;
  }
  return undefined;
}

function chunkText(text: string): Array<{ text: string; start: number; end: number }> {
  if (text.length <= CHUNK_SIZE) return text.length ? [{ text, start: 0, end: text.length }] : [];
  const chunks: Array<{ text: string; start: number; end: number }> = [];
  let start = 0;
  while (start < text.length) {
    const end = Math.min(start + CHUNK_SIZE, text.length);
    chunks.push({ text: text.slice(start, end), start, end });
    if (end >= text.length) break;
    start = end - CHUNK_OVERLAP;
  }
  return chunks;
}

function toMetricsJson(metrics: CrawlMetrics, extra: Record<string, string> = {}): Record<string, number | string | Record<string, number>> {
  return {
    ...extra,
    durationMs: metrics.durationMs,
    urlsDiscovered: metrics.urlsDiscovered,
    urlsAdmitted: metrics.urlsAdmitted,
    urlsSelectedForFetch: metrics.urlsSelectedForFetch,
    pagesFetched: metrics.pagesFetched,
    pagesFailed: metrics.pagesFailed,
    pagesSelected: metrics.pagesSelected,
    browserFallbacks: metrics.browserFallbacks,
    browserRendersAdopted: metrics.browserRendersAdopted ?? 0,
    bytesDownloaded: metrics.bytesDownloaded,
    evidenceItems: metrics.evidenceItems,
    trapsRejected: metrics.trapsRejected,
    offSiteRejected: metrics.offSiteRejected,
    frontierFullRejected: metrics.frontierFullRejected ?? 0,
    frontierEvicted: metrics.frontierEvicted ?? 0,
    sitemapUrls: metrics.sitemapUrls,
    robotsCrawlDelayMs: metrics.robotsCrawlDelayMs,
    timeToFirstPageMs: metrics.timeToFirstPageMs ?? -1,
    bySlot: metrics.bySlot,
  };
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
