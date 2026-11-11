// The Crawl Planner decides *which* pages are worth spending the budget on.
//
// A naive frontier ("fetch whatever we discovered, highest score first") fails
// on real sites in one specific way: a storefront with 5,000 SKUs produces
// 5,000 high-scoring product URLs and the crawl learns nothing but shoe names.
// So the planner enforces two things at once:
//
//   1. an information-value score per candidate URL, and
//   2. diversity quotas — per page-type slot and per URL family — that stop
//      any one section from consuming the budget.
//
// The planner is pure and synchronous: it holds no network state, which makes
// its behaviour directly testable against fixtures.

import { DIVERSITY_SLOTS, PAGE_TYPE_VALUE, classifyFromUrl, slotKeyFor, type PageType } from "./page-classifier";
import { isMenuDocument } from "./documents";
import type { UrlTrapVerdict } from "./url-canonical";
import { canonicalizeUrl, classifyUrlTrap, localeSegmentOf, urlFamilyKey, type UrlTrapReason } from "./url-canonical";
import type { CrawlConfig } from "./config";
import type { GscMetricRow } from "@/lib/search-console/types";

export interface DiscoverySignals {
  /** Present in the site's XML sitemap. */
  inSitemap?: boolean;
  /** Linked from the primary navigation of some already-fetched page. */
  inPrimaryNav?: boolean;
  /** Linked from the footer of some already-fetched page. */
  inFooter?: boolean;
  /** Number of distinct fetched pages linking here. */
  inboundLinks?: number;
  /** Anchor text seen pointing at this URL. */
  anchorText?: string;
  breadcrumbTrail?: string[];
  depth: number;
  /** 0–1: how much Google search traffic lands here (Search Console top pages, log-scaled). */
  searchDemand?: number;
}

export interface PlannerCandidate {
  url: string;
  canonicalUrl: string;
  pageType: PageType;
  slotKey: string;
  familyKey: string;
  score: number;
  breakdown: Record<string, number>;
  signals: DiscoverySignals;
  trapReason?: UrlTrapReason;
}

export interface ScoreBreakdown {
  score: number;
  breakdown: Record<string, number>;
}

const WEIGHTS = {
  pageTypeValue: 5,
  navigationProminence: 2.5,
  sitemapMembership: 1.2,
  linkCentrality: 1.8,
  structuredData: 1.0,
  localeMatch: 1.0,
  // Below page type (5) and navigation (2.5): a page people reach from Google
  // is worth reading, but a popular blog post must not outrank the services page.
  searchDemand: 2.0,
  depthPenalty: -0.9,
  trapPenalty: -8,
  familySaturation: -3,
  // A URL shape that holds a large share of the frontier is a generated
  // directory (other people's workspaces, listings), not the business's own
  // pages: 378 of postman.com's 400 admitted URLs were `/team/space/collection/id/slug`.
  shapeSaturation: -3,
  duplicatePenalty: -6,
} as const;

export interface ScoreInput {
  pageType: PageType;
  signals: DiscoverySignals;
  hasStructuredData?: boolean;
  /** How many pages of this URL family have already been fetched. */
  familyAlreadyFetched?: number;
  familyBudget: number;
  trapReason?: UrlTrapReason;
  isDuplicate?: boolean;
  /** Locale segment of the seed URL, if the site uses locale paths. */
  seedLocale?: string | null;
  candidateLocale?: string | null;
  maxInboundLinks?: number;
  /**
   * Path segments of the candidate URL. The depth penalty uses the deeper of
   * the discovery hop and the path: every sitemap URL is discovered at hop 1,
   * so a five-segment generated URL used to score like /pricing.
   */
  pathDepth?: number;
  /** 0–1 share of the frontier that shares this URL's shape (segment count and id pattern). */
  shapeShare?: number;
}

/**
 * Transparent, additive scoring. Every factor is normalized to 0-1 before its
 * weight is applied, so a weight is directly readable as "at most this many
 * points". Kept as data on the result for the Why?/Evidence UI and for tuning.
 */
export function scoreCandidate(input: ScoreInput): ScoreBreakdown {
  const {
    pageType,
    signals,
    hasStructuredData = false,
    familyAlreadyFetched = 0,
    familyBudget,
    trapReason,
    isDuplicate = false,
    seedLocale = null,
    candidateLocale = null,
    maxInboundLinks = 1,
    pathDepth = 0,
    shapeShare = 0,
  } = input;

  const navigationProminence = signals.inPrimaryNav ? 1 : signals.inFooter ? 0.35 : 0;
  const linkCentrality = maxInboundLinks > 0 ? Math.min(1, (signals.inboundLinks ?? 0) / maxInboundLinks) : 0;
  // A site that uses locale paths and was entered at /in/ should stay in /in/.
  const localeMatch = seedLocale === null ? 0 : candidateLocale === null || candidateLocale === seedLocale ? 1 : -1;
  const familySaturation = familyBudget > 0 ? Math.max(0, familyAlreadyFetched - familyBudget + 1) / Math.max(1, familyBudget) : 0;
  // Nav-linked pages keep their shallow depth whatever their path looks like.
  const effectiveDepth = signals.inPrimaryNav ? signals.depth : Math.max(signals.depth, pathDepth);
  // Only a shape that dominates the frontier is penalised (a fifth or more),
  // and in proportion, so a shop's /products/* family with 30% of a 400-URL
  // frontier loses about a point while a 95% directory loses three.
  const shapeSaturation = shapeShare >= 0.2 ? Math.min(1, (shapeShare - 0.2) / 0.6) : 0;

  const breakdown: Record<string, number> = {
    pageTypeValue: WEIGHTS.pageTypeValue * PAGE_TYPE_VALUE[pageType],
    navigationProminence: WEIGHTS.navigationProminence * navigationProminence,
    sitemapMembership: WEIGHTS.sitemapMembership * (signals.inSitemap ? 1 : 0),
    linkCentrality: WEIGHTS.linkCentrality * linkCentrality,
    structuredData: WEIGHTS.structuredData * (hasStructuredData ? 1 : 0),
    localeMatch: WEIGHTS.localeMatch * localeMatch,
    searchDemand: WEIGHTS.searchDemand * Math.max(0, Math.min(1, signals.searchDemand ?? 0)),
    depthPenalty: WEIGHTS.depthPenalty * Math.max(0, effectiveDepth - 1),
    familySaturation: WEIGHTS.familySaturation * Math.min(1, familySaturation),
    shapeSaturation: WEIGHTS.shapeSaturation * shapeSaturation,
    trapPenalty: trapReason ? WEIGHTS.trapPenalty : 0,
    duplicatePenalty: isDuplicate ? WEIGHTS.duplicatePenalty : 0,
  };

  const score = Number(Object.values(breakdown).reduce((a, b) => a + b, 0).toFixed(4));
  return { score, breakdown };
}

interface FrontierEntry extends PlannerCandidate {
  fetched: boolean;
  /** Path segments of the URL (see ScoreInput.pathDepth). */
  pathDepth: number;
  /** Segment count plus which segments are ids; groups URLs one template generates (see urlShapeKey). */
  shapeKey: string;
}

export interface PlannerStats {
  discovered: number;
  admitted: number;
  rejectedTraps: number;
  rejectedOffSite: number;
  /** On-site URLs that arrived when the frontier was full and displaced nothing. */
  rejectedFrontierFull: number;
  /** Frontier entries evicted for a better-placed newcomer (a nav link arriving after the sitemap). */
  evicted: number;
  dispatched: number;
  bySlot: Record<string, number>;
  byFamily: Record<string, number>;
}

function pathDepthOf(url: string): number {
  try {
    return new URL(url).pathname.split("/").filter(Boolean).length;
  } catch {
    return 0;
  }
}

/**
 * The template a URL was generated from: how many segments it has and which
 * of them are ids or slugs. `/a352-sarl/a352-bank-api/collection/jym72zn/...`
 * and `/akamai/akamai-apis/collection/u0t807d/...` are different families
 * (different first segment) but one shape, and a shape that holds most of
 * the frontier is a directory of generated pages. Exported for tests.
 */
export function urlShapeKey(rawUrl: string): string {
  let url: URL;
  try {
    url = new URL(rawUrl);
  } catch {
    return rawUrl;
  }
  const segments = url.pathname.split("/").filter(Boolean);
  const shape = segments.map((segment) => {
    if (/^\d+$/.test(segment) || /^[0-9a-f-]{8,}$/i.test(segment) || /^[a-z0-9]{6,8}$/i.test(segment) && /\d/.test(segment)) return "id";
    if ((segment.match(/-/g)?.length ?? 0) >= 1) return "slug";
    return "word";
  });
  return `${url.hostname}:${segments.length}:${shape.join("/")}`;
}

/**
 * Stateful frontier: `discover` admits candidates, `takeBatch` hands out the
 * next N URLs to fetch honouring diversity quotas, and `recordFetched` feeds
 * the outcome back so families saturate and later batches rebalance.
 */
export class CrawlPlanner {
  private readonly entries = new Map<string, FrontierEntry>();
  private readonly familyFetched = new Map<string, number>();
  private readonly slotFetched = new Map<string, number>();
  private readonly inboundLinks = new Map<string, number>();
  private readonly shapeCounts = new Map<string, number>();
  private dispatched = 0;
  private rejectedTraps = 0;
  private rejectedOffSite = 0;
  private rejectedFrontierFull = 0;
  private evicted = 0;
  private readonly familyBudget: number;

  constructor(
    private readonly config: CrawlConfig,
    private readonly seedUrl: string,
    private readonly isOnSite: (url: string) => boolean,
  ) {
    this.familyBudget = Math.max(
      1,
      Math.min(config.maxPagesPerUrlFamily, Math.floor(config.maxPages * config.maxShareOfBudgetPerUrlFamily)),
    );
  }

  private get seedLocale(): string | null {
    return localeSegmentOf(this.seedUrl);
  }

  /** Admits a URL into the frontier (or merges signals into an existing entry). */
  discover(rawUrl: string, signals: DiscoverySignals, base?: string): PlannerCandidate | null {
    const canonical = canonicalizeUrl(rawUrl, base);
    if (!canonical) return null;
    if (!this.isOnSite(canonical)) {
      this.rejectedOffSite++;
      return null;
    }

    const existing = this.entries.get(canonical);
    if (existing) {
      existing.signals = mergeSignals(existing.signals, signals);
      this.inboundLinks.set(canonical, (this.inboundLinks.get(canonical) ?? 0) + (signals.inboundLinks ?? 0));
      existing.signals.inboundLinks = this.inboundLinks.get(canonical);
      this.rescore(existing);
      return existing;
    }

    // A menu, brochure or price-list PDF is the offer itself, not an asset
    // to skip: a restaurant with four menu PDFs had no dishes in its profile.
    const menuDocument = isMenuDocument(canonical, signals.anchorText);
    // Not a trap and no trap reason: entries with a reason are never batched.
    const trap: UrlTrapVerdict = menuDocument ? { isTrap: false } : classifyUrlTrap(canonical);
    const pageType = menuDocument ? ("menu" as PageType) : classifyFromUrl({ url: canonical, anchorText: signals.anchorText, breadcrumbTrail: signals.breadcrumbTrail });
    const familyKey = urlFamilyKey(canonical);
    const entry: FrontierEntry = {
      url: canonical,
      canonicalUrl: canonical,
      pageType,
      slotKey: slotKeyFor(pageType),
      familyKey,
      score: 0,
      breakdown: {},
      signals,
      trapReason: trap.reason,
      fetched: false,
      pathDepth: pathDepthOf(canonical),
      shapeKey: urlShapeKey(canonical),
    };

    if (this.entries.size >= this.config.maxUrls) {
      // The sitemap is admitted before any page is fetched, so the site's own
      // navigation arrives last. When the frontier is full, a link the site
      // puts in its primary navigation still gets in by displacing the weakest
      // unfetched entry nobody linked to; anything else is counted as dropped
      // (it used to vanish from every metric).
      if (!signals.inPrimaryNav || trap.isTrap) {
        this.rejectedFrontierFull++;
        return null;
      }
      this.inboundLinks.set(canonical, signals.inboundLinks ?? 0);
      this.rescore(entry);
      const weakest = this.weakestDisplaceable();
      if (!weakest || weakest.score >= entry.score) {
        this.inboundLinks.delete(canonical);
        this.rejectedFrontierFull++;
        return null;
      }
      this.entries.delete(weakest.url);
      this.inboundLinks.delete(weakest.url);
      this.shapeCounts.set(weakest.shapeKey, Math.max(0, (this.shapeCounts.get(weakest.shapeKey) ?? 0) - 1));
      this.evicted++;
    }

    if (trap.isTrap) this.rejectedTraps++;
    this.inboundLinks.set(canonical, signals.inboundLinks ?? 0);
    this.shapeCounts.set(entry.shapeKey, (this.shapeCounts.get(entry.shapeKey) ?? 0) + 1);
    this.rescore(entry);
    this.entries.set(canonical, entry);
    return entry;
  }

  /** The lowest-scoring unfetched entry that no page links to and no nav names. */
  private weakestDisplaceable(): FrontierEntry | null {
    let weakest: FrontierEntry | null = null;
    for (const entry of this.entries.values()) {
      if (entry.fetched || entry.signals.inPrimaryNav || (entry.signals.inboundLinks ?? 0) > 0 || entry.signals.depth === 0) continue;
      this.rescore(entry);
      if (!weakest || entry.score < weakest.score) weakest = entry;
    }
    return weakest;
  }

  private rescore(entry: FrontierEntry): void {
    const { score, breakdown } = scoreCandidate({
      pageType: entry.pageType,
      signals: entry.signals,
      familyAlreadyFetched: this.familyFetched.get(entry.familyKey) ?? 0,
      familyBudget: this.familyBudget,
      trapReason: entry.trapReason,
      seedLocale: this.seedLocale,
      candidateLocale: localeSegmentOf(entry.url),
      maxInboundLinks: Math.max(1, ...this.inboundLinks.values()),
      pathDepth: entry.pathDepth,
      shapeShare: this.entries.size >= 40 ? (this.shapeCounts.get(entry.shapeKey) ?? 0) / Math.max(1, this.entries.size) : 0,
    });
    entry.score = score;
    entry.breakdown = breakdown;
  }

  /**
   * Returns the next batch to fetch. Diversity is enforced greedily: a slot
   * that has already reached its maximum is skipped, and starved slots with a
   * `min` requirement are pulled forward even when their raw score is lower.
   */
  takeBatch(size: number): PlannerCandidate[] {
    const available = [...this.entries.values()].filter((e) => !e.fetched && !e.trapReason);
    if (available.length === 0) return [];

    for (const entry of available) this.rescore(entry);
    available.sort((a, b) => b.score - a.score || a.signals.depth - b.signals.depth || a.url.localeCompare(b.url));

    const batch: PlannerCandidate[] = [];
    const provisionalSlot = new Map(this.slotFetched);
    const provisionalFamily = new Map(this.familyFetched);

    // Pass 1: satisfy starved required slots first so a shoe store still gets
    // its About page even though every product URL outscores it late in a run.
    const remainingBudget = this.config.maxPages - this.dispatched;
    for (const slot of DIVERSITY_SLOTS) {
      if (batch.length >= size || remainingBudget <= batch.length) break;
      if (slot.min === 0) continue;
      const have = provisionalSlot.get(slot.key) ?? 0;
      if (have >= slot.min) continue;
      const candidate = available.find(
        (e) => !batch.includes(e) && e.slotKey === slot.key && (provisionalFamily.get(e.familyKey) ?? 0) < this.familyBudget,
      );
      if (candidate) {
        batch.push(candidate);
        provisionalSlot.set(slot.key, have + 1);
        provisionalFamily.set(candidate.familyKey, (provisionalFamily.get(candidate.familyKey) ?? 0) + 1);
      }
    }

    // Quotas exist to stop a 5,000-SKU store from spending the budget on one
    // section. On a site whose whole frontier fits inside the page budget
    // (a 15-page salon), they only starve real pages, so they are lifted.
    const smallSite = this.entries.size <= this.config.maxPages;

    // Pass 2: fill the rest by score, respecting slot maxima and family budget.
    for (const entry of available) {
      if (batch.length >= size) break;
      if (this.dispatched + batch.length >= this.config.maxPages) break;
      if (batch.includes(entry)) continue;
      const slot = DIVERSITY_SLOTS.find((s) => s.key === entry.slotKey);
      const slotCount = provisionalSlot.get(entry.slotKey) ?? 0;
      if (!smallSite && slot && slotCount >= slot.max) continue;
      const familyCount = provisionalFamily.get(entry.familyKey) ?? 0;
      if (!smallSite && familyCount >= this.familyBudget) continue;
      batch.push(entry);
      provisionalSlot.set(entry.slotKey, slotCount + 1);
      provisionalFamily.set(entry.familyKey, familyCount + 1);
    }

    for (const entry of batch) {
      const stored = this.entries.get(entry.url);
      if (stored) stored.fetched = true;
    }
    this.dispatched += batch.length;
    return batch;
  }

  /**
   * Lifts the pages Google Search Console says people land on. Rows can arrive
   * after the crawl started: `takeBatch` rescores every waiting entry, so the
   * lift applies from the next batch. It only reorders the frontier; the page
   * budget, robots rules and the fetch guard are untouched. Returns how many
   * URLs received a lift.
   */
  applySearchDemand(rows: GscMetricRow[]): number {
    const kept: Array<{ url: string; clicks: number; impressions: number }> = [];
    const seen = new Set<string>();
    for (const row of [...rows].sort((a, b) => b.clicks - a.clicks || b.impressions - a.impressions)) {
      if (kept.length >= SEARCH_DEMAND_MAX_PAGES) break;
      const canonical = canonicalizeUrl(row.key);
      if (!canonical || seen.has(canonical)) continue;
      // A domain property also reports other subdomains and old downloads.
      if (!this.isOnSite(canonical) || classifyUrlTrap(canonical).isTrap || NON_PAGE_URL.test(new URL(canonical).pathname)) continue;
      seen.add(canonical);
      kept.push({ url: canonical, clicks: Math.max(0, row.clicks), impressions: Math.max(0, row.impressions) });
    }
    const maxClicks = Math.max(0, ...kept.map((k) => k.clicks));
    const maxImpressions = Math.max(0, ...kept.map((k) => k.impressions));
    let applied = 0;
    for (const page of kept) {
      // Clicks decide; impressions only separate pages nobody clicked.
      const demand =
        page.clicks > 0 && maxClicks > 0
          ? Math.log1p(page.clicks) / Math.log1p(maxClicks)
          : maxImpressions > 0
            ? (0.1 * Math.log1p(page.impressions)) / Math.log1p(maxImpressions)
            : 0;
      if (demand <= 0) continue;
      if (this.discover(page.url, { depth: 1, inSitemap: false, searchDemand: demand })) applied++;
    }
    return applied;
  }

  /** Feed the fetch outcome back so saturation and quotas stay accurate. */
  recordFetched(candidate: PlannerCandidate, finalPageType: PageType): void {
    this.familyFetched.set(candidate.familyKey, (this.familyFetched.get(candidate.familyKey) ?? 0) + 1);
    const slotKey = slotKeyFor(finalPageType);
    this.slotFetched.set(slotKey, (this.slotFetched.get(slotKey) ?? 0) + 1);
    const stored = this.entries.get(candidate.url);
    if (stored) {
      stored.pageType = finalPageType;
      stored.slotKey = slotKey;
    }
  }

  hasWork(): boolean {
    return [...this.entries.values()].some((e) => !e.fetched && !e.trapReason);
  }

  budgetRemaining(): number {
    return Math.max(0, this.config.maxPages - this.dispatched);
  }

  stats(): PlannerStats {
    return {
      discovered: this.entries.size + this.rejectedOffSite,
      admitted: this.entries.size,
      rejectedTraps: this.rejectedTraps,
      rejectedOffSite: this.rejectedOffSite,
      rejectedFrontierFull: this.rejectedFrontierFull,
      evicted: this.evicted,
      dispatched: this.dispatched,
      bySlot: Object.fromEntries(this.slotFetched),
      byFamily: Object.fromEntries(this.familyFetched),
    };
  }
}

function mergeSignals(a: DiscoverySignals, b: DiscoverySignals): DiscoverySignals {
  return {
    inSitemap: a.inSitemap || b.inSitemap,
    inPrimaryNav: a.inPrimaryNav || b.inPrimaryNav,
    inFooter: a.inFooter || b.inFooter,
    inboundLinks: Math.max(a.inboundLinks ?? 0, b.inboundLinks ?? 0),
    anchorText: a.anchorText ?? b.anchorText,
    breadcrumbTrail: a.breadcrumbTrail ?? b.breadcrumbTrail,
    depth: Math.min(a.depth, b.depth),
    ...(a.searchDemand !== undefined || b.searchDemand !== undefined ? { searchDemand: Math.max(a.searchDemand ?? 0, b.searchDemand ?? 0) } : {}),
  };
}

/** Search Console pages considered for a lift. */
const SEARCH_DEMAND_MAX_PAGES = 30;
const NON_PAGE_URL = /\.(pdf|jpe?g|png|gif|webp|avif|svg|ico|mp4|mov|webm|mp3|zip|docx?|xlsx?|pptx?|csv|xml|json|txt)$/i;
