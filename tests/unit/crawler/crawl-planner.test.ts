import { describe, it, expect } from "vitest";
import { CrawlPlanner, scoreCandidate } from "@/lib/crawler/crawl-planner";
import { DEFAULT_CRAWL_CONFIG, type CrawlConfig } from "@/lib/crawler/config";

const SEED = "https://example.test/";
const onSite = (url: string) => new URL(url).hostname === "example.test";

function config(overrides: Partial<CrawlConfig> = {}): CrawlConfig {
  return { ...DEFAULT_CRAWL_CONFIG, ...overrides };
}

describe("scoreCandidate", () => {
  const baseSignals = { depth: 1, inboundLinks: 1 };

  it("ranks the homepage above an arbitrary deep page", () => {
    const home = scoreCandidate({ pageType: "home", signals: { depth: 0 }, familyBudget: 6 });
    const other = scoreCandidate({ pageType: "other", signals: { depth: 2 }, familyBudget: 6 });
    expect(home.score).toBeGreaterThan(other.score);
  });

  it("ranks an offering index above an individual product", () => {
    const index = scoreCandidate({ pageType: "product_index", signals: baseSignals, familyBudget: 6 });
    const item = scoreCandidate({ pageType: "product", signals: baseSignals, familyBudget: 6 });
    expect(index.score).toBeGreaterThan(item.score);
  });

  it("scores legal and careers pages near or below zero", () => {
    const legal = scoreCandidate({ pageType: "legal", signals: baseSignals, familyBudget: 6 });
    const about = scoreCandidate({ pageType: "about", signals: baseSignals, familyBudget: 6 });
    expect(legal.score).toBeLessThan(about.score);
    expect(legal.breakdown.pageTypeValue).toBe(0);
  });

  it("rewards primary-navigation prominence", () => {
    const inNav = scoreCandidate({ pageType: "category", signals: { ...baseSignals, inPrimaryNav: true }, familyBudget: 6 });
    const plain = scoreCandidate({ pageType: "category", signals: baseSignals, familyBudget: 6 });
    expect(inNav.score).toBeGreaterThan(plain.score);
  });

  it("rewards sitemap membership and structured data", () => {
    const rich = scoreCandidate({ pageType: "category", signals: { ...baseSignals, inSitemap: true }, hasStructuredData: true, familyBudget: 6 });
    const plain = scoreCandidate({ pageType: "category", signals: baseSignals, familyBudget: 6 });
    expect(rich.score).toBeGreaterThan(plain.score);
  });

  it("penalizes depth", () => {
    const shallow = scoreCandidate({ pageType: "category", signals: { depth: 0 }, familyBudget: 6 });
    const deep = scoreCandidate({ pageType: "category", signals: { depth: 4 }, familyBudget: 6 });
    expect(deep.score).toBeLessThan(shallow.score);
  });

  it("penalizes a saturated URL family so a section cannot monopolise the budget", () => {
    const fresh = scoreCandidate({ pageType: "product", signals: baseSignals, familyBudget: 4, familyAlreadyFetched: 0 });
    const saturated = scoreCandidate({ pageType: "product", signals: baseSignals, familyBudget: 4, familyAlreadyFetched: 9 });
    expect(saturated.score).toBeLessThan(fresh.score);
  });

  it("penalizes a trap URL heavily", () => {
    const normal = scoreCandidate({ pageType: "category", signals: baseSignals, familyBudget: 6 });
    const trap = scoreCandidate({ pageType: "category", signals: baseSignals, familyBudget: 6, trapReason: "faceted_filter" });
    expect(trap.score).toBeLessThan(normal.score - 5);
  });

  it("penalizes a page in a different locale from the entry storefront", () => {
    const matching = scoreCandidate({ pageType: "category", signals: baseSignals, familyBudget: 6, seedLocale: "in", candidateLocale: "in" });
    const foreign = scoreCandidate({ pageType: "category", signals: baseSignals, familyBudget: 6, seedLocale: "in", candidateLocale: "fr" });
    expect(foreign.score).toBeLessThan(matching.score);
  });

  it("exposes every factor in the breakdown so scoring stays inspectable", () => {
    const { breakdown } = scoreCandidate({ pageType: "about", signals: baseSignals, familyBudget: 6 });
    expect(Object.keys(breakdown)).toEqual(
      expect.arrayContaining(["pageTypeValue", "navigationProminence", "sitemapMembership", "linkCentrality", "structuredData", "depthPenalty", "trapPenalty"]),
    );
  });
});

describe("CrawlPlanner", () => {
  it("admits on-site URLs and rejects off-site ones", () => {
    const planner = new CrawlPlanner(config(), SEED, onSite);
    expect(planner.discover("https://example.test/about", { depth: 1 })).not.toBeNull();
    expect(planner.discover("https://other.test/about", { depth: 1 })).toBeNull();
    expect(planner.stats().rejectedOffSite).toBe(1);
  });

  it("deduplicates URLs that canonicalize to the same identity", () => {
    const planner = new CrawlPlanner(config(), SEED, onSite);
    planner.discover("https://example.test/about?utm_source=x", { depth: 1 });
    planner.discover("https://example.test/about/", { depth: 1 });
    planner.discover("https://example.test/about#team", { depth: 1 });
    expect(planner.stats().admitted).toBe(1);
  });

  it("never dispatches a trap URL", () => {
    const planner = new CrawlPlanner(config(), SEED, onSite);
    planner.discover("https://example.test/cart", { depth: 1 });
    planner.discover("https://example.test/checkout", { depth: 1 });
    expect(planner.takeBatch(5)).toHaveLength(0);
    expect(planner.stats().rejectedTraps).toBe(2);
  });

  it("caps how much of the budget one URL family may consume", () => {
    const planner = new CrawlPlanner(config({ maxPages: 20, maxPagesPerUrlFamily: 4, maxShareOfBudgetPerUrlFamily: 0.3 }), SEED, onSite);
    // 40 product URLs from one template, plus one About page.
    for (let i = 0; i < 40; i++) {
      planner.discover(`https://example.test/products/running/model-number-${i}`, { depth: 1, inSitemap: true });
    }
    planner.discover("https://example.test/about", { depth: 1 });

    const dispatched: string[] = [];
    while (planner.hasWork() && planner.budgetRemaining() > 0) {
      const batch = planner.takeBatch(5);
      if (batch.length === 0) break;
      for (const candidate of batch) {
        dispatched.push(candidate.url);
        planner.recordFetched(candidate, candidate.pageType);
      }
    }

    const productPages = dispatched.filter((u) => u.includes("/products/running/"));
    expect(productPages.length).toBeLessThanOrEqual(4);
    expect(dispatched).toContain("https://example.test/about");
  });

  it("pulls a starved required slot forward even when lower-scoring", () => {
    const planner = new CrawlPlanner(config({ maxPages: 6 }), SEED, onSite);
    // High-scoring category pages plus one low-prominence About page.
    for (let i = 0; i < 10; i++) {
      planner.discover(`https://example.test/shop/category-${i}`, { depth: 1, inSitemap: true, inPrimaryNav: true, inboundLinks: 9 });
    }
    planner.discover("https://example.test/about", { depth: 2 });

    const batch = planner.takeBatch(3);
    expect(batch.map((c) => c.url)).toContain("https://example.test/about");
  });

  it("respects the overall page budget", () => {
    const planner = new CrawlPlanner(config({ maxPages: 5 }), SEED, onSite);
    for (let i = 0; i < 50; i++) planner.discover(`https://example.test/section-${i}/page`, { depth: 1 });
    let dispatched = 0;
    while (planner.hasWork() && planner.budgetRemaining() > 0) {
      const batch = planner.takeBatch(4);
      if (batch.length === 0) break;
      dispatched += batch.length;
      for (const c of batch) planner.recordFetched(c, c.pageType);
    }
    expect(dispatched).toBeLessThanOrEqual(5);
  });

  it("merges signals when the same URL is discovered again", () => {
    const planner = new CrawlPlanner(config(), SEED, onSite);
    planner.discover("https://example.test/shop", { depth: 2 });
    const merged = planner.discover("https://example.test/shop", { depth: 1, inPrimaryNav: true, inSitemap: true });
    expect(merged?.signals.inPrimaryNav).toBe(true);
    expect(merged?.signals.inSitemap).toBe(true);
    expect(merged?.signals.depth).toBe(1);
    expect(planner.stats().admitted).toBe(1);
  });

  it("stops handing out work once the frontier is exhausted", () => {
    const planner = new CrawlPlanner(config(), SEED, onSite);
    planner.discover(SEED, { depth: 0 });
    expect(planner.takeBatch(5)).toHaveLength(1);
    expect(planner.hasWork()).toBe(false);
    expect(planner.takeBatch(5)).toHaveLength(0);
  });
});

describe("CrawlPlanner search demand (Google Search Console top pages)", () => {
  const row = (key: string, clicks: number, impressions = clicks * 20) => ({ key, clicks, impressions, ctr: 0.05, position: 5 });

  it("scores search demand as its own inspectable factor, below page type", () => {
    const lifted = scoreCandidate({ pageType: "service", signals: { depth: 1, searchDemand: 1 }, familyBudget: 6 });
    const plain = scoreCandidate({ pageType: "service", signals: { depth: 1 }, familyBudget: 6 });
    expect(lifted.breakdown.searchDemand).toBe(2);
    expect(plain.breakdown.searchDemand).toBe(0);
    expect(lifted.score - plain.score).toBeCloseTo(2, 3);
  });

  it("lifts a page people reach from Google above an equal page of the same type", () => {
    const planner = new CrawlPlanner(config(), SEED, onSite);
    planner.discover("https://example.test/services/alpha", { depth: 1 });
    planner.discover("https://example.test/services/beta", { depth: 1 });
    expect(planner.applySearchDemand([row("https://example.test/services/beta", 80), row("https://example.test/services/alpha", 0, 0)])).toBe(1);
    expect(planner.takeBatch(1).map((c) => c.url)).toEqual(["https://example.test/services/beta"]);
  });

  it("admits an unseen top page at depth 1 without a sitemap mark", () => {
    const planner = new CrawlPlanner(config(), SEED, onSite);
    planner.applySearchDemand([row("https://example.test/prices?utm_source=google", 12)]);
    const [candidate] = planner.takeBatch(1);
    expect(candidate?.url).toBe("https://example.test/prices");
    expect(candidate?.signals).toMatchObject({ depth: 1, inSitemap: false });
    expect(candidate?.signals.searchDemand).toBe(1);
  });

  it("ignores other hosts, trap URLs and files", () => {
    const planner = new CrawlPlanner(config(), SEED, onSite);
    const before = planner.stats();
    const applied = planner.applySearchDemand([
      row("https://other.test/services", 500),
      row("https://example.test/cart", 400),
      row("https://example.test/menu.pdf", 300),
      row("https://example.test/images/hero.jpg", 200),
      row("not a url", 100),
    ]);
    expect(applied).toBe(0);
    expect(planner.stats()).toEqual(before);
    expect(planner.hasWork()).toBe(false);
  });

  it("takes effect at the next batch when the rows arrive late", () => {
    const planner = new CrawlPlanner(config(), SEED, onSite);
    for (const slug of ["a", "b", "c", "d"]) planner.discover(`https://example.test/services/${slug}`, { depth: 1 });
    const first = planner.takeBatch(1)[0]!;
    for (const c of [first]) planner.recordFetched(c, c.pageType);
    const untouched = ["a", "b", "c", "d"].map((s) => `https://example.test/services/${s}`).filter((u) => u !== first.url);
    const late = untouched[untouched.length - 1]!;
    planner.applySearchDemand([row(late, 30)]);
    expect(planner.takeBatch(1)[0]?.url).toBe(late);
  });

  it("never raises the page budget", () => {
    const planner = new CrawlPlanner(config({ maxPages: 5 }), SEED, onSite);
    planner.discover(SEED, { depth: 0 });
    const budget = planner.budgetRemaining();
    planner.applySearchDemand(Array.from({ length: 40 }, (_, i) => row(`https://example.test/landing-${i}/page`, 100 - i)));
    expect(planner.budgetRemaining()).toBe(budget);
    let dispatched = 0;
    while (planner.hasWork() && planner.budgetRemaining() > 0) {
      const batch = planner.takeBatch(4);
      if (batch.length === 0) break;
      dispatched += batch.length;
      for (const c of batch) planner.recordFetched(c, c.pageType);
    }
    expect(dispatched).toBeLessThanOrEqual(5);
    // At most 30 Search Console pages are considered.
    expect(planner.stats().admitted).toBeLessThanOrEqual(31);
  });
});
