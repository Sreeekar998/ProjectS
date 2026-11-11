// Website Intelligence benchmark harness.
//
// Two modes share one scorer:
//
//   Fixture mode  — drives the real planner, classifier, extractor, evidence
//                   builder and profile synthesis over locally-defined sites.
//                   No network, so it is safe and deterministic in CI.
//
//   Live mode     — drives the full production pipeline (including fetch and
//                   robots/sitemap) against real public websites. Explicitly
//                   invoked, never part of `npm test`.
//
// The scorer is the same in both modes, so a live regression and a fixture
// regression are directly comparable.

import { extractPage } from "@/lib/crawler/extractor";
import { classifyPage, type PageType } from "@/lib/crawler/page-classifier";
import { CrawlPlanner } from "@/lib/crawler/crawl-planner";
import { getCrawlConfig } from "@/lib/crawler/config";
import { canonicalizeUrl } from "@/lib/crawler/url-canonical";
import { parseRobotsTxt, pathAllowed, selectAgentGroup } from "@/lib/crawler/robots";
import { parseUrlset } from "@/lib/crawler/sitemap";
import { buildEvidenceForPage } from "@/lib/evidence/builder";
import type { EvidenceItem, NewEvidenceItem } from "@/lib/evidence/types";
import { buildEvidencePack } from "@/lib/evidence/pack";
import { buildDeterministicProfile, type PageSummary } from "@/lib/profile/deterministic-extractor";
import { classifyIndustry } from "@/lib/profile/industry-classifier";
import { DeterministicProfileProvider, selectProvider } from "@/lib/profile/synthesizer";
import { evidenceCoverage } from "@/lib/profile/validator";
import { containsHype } from "@/lib/profile/description-builder";
import type { BusinessProfile } from "@/lib/profile/schema";
import { materialize, type FixtureSite } from "./fixtures/sites";
import type { BenchmarkCase, SemanticExpectation } from "./manifest";

const FIXTURE_ORIGIN = "https://fixture.example";

// --- Fixture pipeline ------------------------------------------------------

export interface FixtureRunResult {
  profile: BusinessProfile;
  evidence: EvidenceItem[];
  pages: PageSummary[];
  selectedUrls: string[];
  plannerStats: ReturnType<CrawlPlanner["stats"]>;
  durationMs: number;
  timeToFirstFieldMs: number | null;
  synthesisMode: string;
}

/**
 * Runs a fixture site through the real pipeline, substituting an in-memory
 * page map for the network layer. Everything above the fetch — robots, sitemap
 * parsing, planning, diversity quotas, classification, evidence extraction and
 * synthesis — is the production code path.
 */
export async function runFixtureSite(rawSite: FixtureSite, options: { useProvider?: boolean } = {}): Promise<FixtureRunResult> {
  const site = materialize(rawSite, FIXTURE_ORIGIN);
  const started = Date.now();
  const config = getCrawlConfig({ playwrightFallbackEnabled: false });
  const byPath = new Map(site.pages.map((p) => [p.path, p]));

  const robots = site.robotsTxt
    ? (() => {
        const parsed = parseRobotsTxt(site.robotsTxt!);
        const { rules } = selectAgentGroup(parsed.groups);
        return { isAllowed: (path: string) => pathAllowed(path, rules), sitemaps: parsed.sitemaps };
      })()
    : { isAllowed: () => true, sitemaps: [] as string[] };

  const planner = new CrawlPlanner(config, `${FIXTURE_ORIGIN}/`, (url) => {
    try {
      return new URL(url).origin === FIXTURE_ORIGIN;
    } catch {
      return false;
    }
  });

  planner.discover(`${FIXTURE_ORIGIN}/`, { depth: 0, inboundLinks: 1 });
  if (site.sitemapXml) {
    for (const entry of parseUrlset(site.sitemapXml, "sitemap.xml", config.maxSitemapUrls)) {
      planner.discover(entry.loc, { depth: 1, inSitemap: true });
    }
  }

  const evidence: EvidenceItem[] = [];
  const pages: PageSummary[] = [];
  const selectedUrls: string[] = [];
  const seenHashes = new Set<string>();
  let evidenceCounter = 0;
  let timeToFirstFieldMs: number | null = null;

  while (planner.hasWork() && planner.budgetRemaining() > 0) {
    const batch = planner.takeBatch(config.concurrencyPerHost);
    if (batch.length === 0) break;

    for (const candidate of batch) {
      const path = new URL(candidate.url).pathname;
      if (!robots.isAllowed(path)) continue;
      const fixturePage = byPath.get(path) ?? byPath.get(path.replace(/\/$/, "")) ?? (path === "/" ? byPath.get("/") : undefined);
      if (!fixturePage || (fixturePage.status ?? 200) >= 400) continue;

      const extracted = extractPage(fixturePage.html, candidate.url);
      const classification = classifyPage({
        url: candidate.url,
        anchorText: candidate.signals.anchorText,
        breadcrumbTrail: extracted.breadcrumb,
        title: extracted.title,
        h1: extracted.h1,
        schemaTypes: extracted.schemaEntities.flatMap((e) => e.types),
        itemCardCount: extracted.itemCardCount,
        hasArticleBody: extracted.hasArticleBody,
        publishedDate: extracted.publishedDate,
      });
      planner.recordFetched(candidate, classification.pageType);

      for (const link of extracted.links) {
        const canonical = canonicalizeUrl(link.href);
        if (!canonical) continue;
        planner.discover(canonical, {
          depth: candidate.signals.depth + 1,
          inPrimaryNav: link.inNav,
          inFooter: link.inFooter,
          inboundLinks: 1,
          anchorText: link.text,
          breadcrumbTrail: extracted.breadcrumb,
        });
      }

      const wordCount = extracted.mainText.split(/\s+/).filter(Boolean).length;
      const duplicate = seenHashes.has(extracted.contentHash);
      const isSelected =
        !duplicate &&
        selectedUrls.length < config.maxSelectedPages &&
        (wordCount >= 25 || extracted.schemaEntities.length > 0 || extracted.cardTitles.length >= 3);
      if (!isSelected) continue;
      seenHashes.add(extracted.contentHash);

      const pageId = `pg_${selectedUrls.length}`;
      selectedUrls.push(candidate.url);
      pages.push({ id: pageId, url: candidate.url, pageType: classification.pageType, title: extracted.title });

      const built: NewEvidenceItem[] = buildEvidenceForPage(
        {
          runId: "bench",
          projectId: "bench",
          crawlPageId: pageId,
          url: candidate.url,
          canonicalUrl: extracted.canonicalUrl,
          pageType: classification.pageType,
        },
        extracted,
      );
      for (const item of built) {
        evidenceCounter += 1;
        evidence.push({ ...item, id: `ev_${evidenceCounter}`, extractedAt: new Date().toISOString() } as EvidenceItem);
      }
      if (timeToFirstFieldMs === null && evidence.length > 0) timeToFirstFieldMs = Date.now() - started;
    }
  }

  const baseline = buildDeterministicProfile({
    evidence,
    pages,
    canonicalDomain: "fixture.example",
    seedUrl: `${FIXTURE_ORIGIN}/`,
    seedHostname: "fixture.example",
  });
  const pack = buildEvidencePack({
    projectId: "bench",
    runId: "bench",
    canonicalDomain: "fixture.example",
    seedUrl: `${FIXTURE_ORIGIN}/`,
    evidence,
    pages,
    baseline,
    industry: classifyIndustry(evidence),
  });

  const provider = options.useProvider ? selectProvider() : new DeterministicProfileProvider();
  const synthesis = await provider.synthesizeProfile(pack, baseline);

  return {
    profile: synthesis.profile,
    evidence,
    pages,
    selectedUrls,
    plannerStats: planner.stats(),
    durationMs: Date.now() - started,
    timeToFirstFieldMs,
    synthesisMode: synthesis.mode,
  };
}

// --- Scoring ---------------------------------------------------------------

export interface CheckResult {
  field: string;
  passed: boolean;
  detail: string;
}

export interface CaseScore {
  id: string;
  label: string;
  businessType: string;
  passed: boolean;
  checks: CheckResult[];
  metrics: {
    evidenceCoverage: number;
    evidenceGaps: string[];
    fieldsPopulated: number;
    offeringCount: number;
    identityTraitCount: number;
    marketCount: number;
    overallConfidence: number;
    pagesSelected: number;
    usefulPageShare: number;
    evidenceItems: number;
    durationMs: number;
    timeToFirstFieldMs: number | null;
    hypeTerms: string[];
  };
  profileSummary: {
    brandName: string;
    description: string;
    industry: string;
    archetype: string;
    offerings: string[];
    brandIdentity: string[];
    markets: string[];
    marketScope: string;
  };
}

const LOW_VALUE_PAGE_TYPES = new Set<PageType>(["legal", "careers", "editorial"]);

function matches(expectation: SemanticExpectation | undefined, haystack: string[], field: string): CheckResult[] {
  if (!expectation) return [];
  const joined = haystack.join(" | ").toLowerCase();
  const results: CheckResult[] = [];

  if (expectation.anyOf) {
    const hit = expectation.anyOf.filter((term) => joined.includes(term.toLowerCase()));
    results.push({
      field: `${field}.anyOf`,
      passed: hit.length > 0,
      detail: hit.length > 0 ? `matched ${hit.join(", ")}` : `none of [${expectation.anyOf.join(", ")}] in "${joined.slice(0, 160)}"`,
    });
  }
  if (expectation.allOf) {
    const missing = expectation.allOf.filter((term) => !joined.includes(term.toLowerCase()));
    results.push({
      field: `${field}.allOf`,
      passed: missing.length === 0,
      detail: missing.length === 0 ? "all present" : `missing ${missing.join(", ")}`,
    });
  }
  if (expectation.noneOf) {
    const violations = expectation.noneOf.filter((term) => joined.includes(term.toLowerCase()));
    results.push({
      field: `${field}.noneOf`,
      passed: violations.length === 0,
      detail: violations.length === 0 ? "clean" : `forbidden term(s) present: ${violations.join(", ")}`,
    });
  }
  return results;
}

export function scoreCase(
  testCase: BenchmarkCase,
  run: { profile: BusinessProfile; pages: PageSummary[]; evidence: EvidenceItem[]; durationMs: number; timeToFirstFieldMs: number | null },
): CaseScore {
  const { profile } = run;
  const checks: CheckResult[] = [];
  const e = testCase.expect;

  checks.push(...matches(e.brandName, [profile.identity.brandName.value], "brandName"));
  checks.push(...matches(e.description, [profile.description.value], "description"));
  checks.push(...matches(e.industrySector, [profile.industry.primary], "industrySector"));
  checks.push(...matches(e.industryCategory, [profile.industry.secondary ?? "", profile.industry.value], "industryCategory"));
  checks.push(...matches(e.archetype, [profile.archetype.value], "archetype"));
  checks.push(...matches(e.brandIdentity, profile.brandIdentity.map((t) => t.value), "brandIdentity"));
  checks.push(...matches(e.markets, profile.markets.map((m) => m.name), "markets"));
  checks.push(...matches(e.marketScope, [profile.marketScope.value], "marketScope"));
  checks.push(...matches(e.selectedPageTypes, run.pages.map((p) => p.pageType), "selectedPageTypes"));

  const offeringNames = profile.offerings.items.map((o) => o.name);
  if (e.offerings) {
    checks.push(...matches({ noneOf: e.offerings.noneOf }, offeringNames, "offerings"));
    if (e.offerings.minCount !== undefined) {
      checks.push({
        field: "offerings.minCount",
        passed: offeringNames.length >= e.offerings.minCount,
        detail: `${offeringNames.length} offering(s), expected >= ${e.offerings.minCount}`,
      });
    }
    if (e.offerings.anyOf) {
      const joined = offeringNames.join(" | ").toLowerCase();
      const hits = e.offerings.anyOf.filter((term) => joined.includes(term.toLowerCase()));
      const required = e.offerings.minMatches ?? 1;
      checks.push({
        field: "offerings.concepts",
        passed: hits.length >= required,
        detail: `${hits.length}/${required} expected concepts matched (${hits.join(", ") || "none"}) in [${offeringNames.join(", ")}]`,
      });
    }
  }

  // Evidence coverage is a hard requirement, not a per-case expectation.
  const coverage = evidenceCoverage(profile);
  checks.push({
    field: "evidenceCoverage",
    passed: coverage.ratio === 1,
    detail: coverage.ratio === 1 ? "every populated field cites evidence" : `${coverage.gaps.length} field(s) without evidence: ${coverage.gaps.join(", ")}`,
  });

  const hypeTerms = containsHype(profile.description.value);
  checks.push({
    field: "description.noHype",
    passed: hypeTerms.length === 0,
    detail: hypeTerms.length === 0 ? "factual" : `promotional language: ${hypeTerms.join(", ")}`,
  });

  const usefulPages = run.pages.filter((p) => !LOW_VALUE_PAGE_TYPES.has(p.pageType)).length;
  const usefulPageShare = run.pages.length === 0 ? 0 : usefulPages / run.pages.length;

  return {
    id: testCase.id,
    label: testCase.label,
    businessType: testCase.businessType,
    passed: checks.every((c) => c.passed),
    checks,
    metrics: {
      evidenceCoverage: coverage.ratio,
      evidenceGaps: coverage.gaps,
      fieldsPopulated: coverage.populated,
      offeringCount: offeringNames.length,
      identityTraitCount: profile.brandIdentity.length,
      marketCount: profile.markets.length,
      overallConfidence: profile.quality.overallConfidence,
      pagesSelected: run.pages.length,
      usefulPageShare,
      evidenceItems: run.evidence.length,
      durationMs: run.durationMs,
      timeToFirstFieldMs: run.timeToFirstFieldMs,
      hypeTerms,
    },
    profileSummary: {
      brandName: profile.identity.brandName.value,
      description: profile.description.value,
      industry: profile.industry.value || "(none)",
      archetype: profile.archetype.value,
      offerings: offeringNames,
      brandIdentity: profile.brandIdentity.map((t) => `${t.value}${t.needsCheck ? " (check)" : ""}`),
      markets: profile.markets.map((m) => `${m.name} [${m.level}]`),
      marketScope: profile.marketScope.value,
    },
  };
}

export function renderScoreTable(scores: CaseScore[]): string {
  const header = "| Business type | Brand | Industry | Archetype | Offerings | Market | Evidence | Pages | Conf | Pass |";
  const divider = "|---|---|---|---|---|---|---|---|---|---|";
  const rows = scores.map((s) => {
    const offerings = s.profileSummary.offerings.slice(0, 3).join(", ") + (s.profileSummary.offerings.length > 3 ? ` +${s.profileSummary.offerings.length - 3}` : "");
    return `| ${s.businessType} | ${s.profileSummary.brandName || "—"} | ${s.profileSummary.industry} | ${s.profileSummary.archetype} | ${offerings || "—"} | ${s.profileSummary.markets[0] ?? "—"} | ${Math.round(s.metrics.evidenceCoverage * 100)}% | ${s.metrics.pagesSelected} | ${s.metrics.overallConfidence} | ${s.passed ? "yes" : "NO"} |`;
  });
  return [header, divider, ...rows].join("\n");
}

export function renderFailures(scores: CaseScore[]): string {
  const failing = scores.filter((s) => !s.passed);
  if (failing.length === 0) return "No failed assertions.";
  return failing
    .map((s) => {
      const failed = s.checks.filter((c) => !c.passed).map((c) => `    - ${c.field}: ${c.detail}`);
      return `  ${s.label}\n${failed.join("\n")}`;
    })
    .join("\n\n");
}
