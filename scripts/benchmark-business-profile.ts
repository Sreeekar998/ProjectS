// Website Intelligence benchmark runner.
//
//   npm run benchmark:business-profile              # fixtures, offline
//   npm run benchmark:business-profile -- --live    # real public websites
//   npm run benchmark:business-profile -- --live --only live-stripe
//
// The live mode drives the exact production pipeline (`runWebsiteIntelligence`)
// against real sites, so what it reports is what an interviewer would see if
// they typed the same URL into the app. It is deliberately NOT part of `npm
// test`: it depends on third-party availability and takes minutes, not seconds.

import fs from "node:fs";
import path from "node:path";
import type { CaseScore } from "../benchmarks/business-profile/harness";

async function main() {
  const args = process.argv.slice(2);
  const live = args.includes("--live");
  const onlyIndex = args.indexOf("--only");
  const only = onlyIndex >= 0 ? args[onlyIndex + 1] : undefined;

  const dataDir = process.env.SUN_DATA_DIR ?? "./data";
  process.env.SUN_DATA_DIR = dataDir;
  const { bootstrapInline } = await import("./bootstrap-inline");
  await bootstrapInline();

  const { FIXTURE_CASES, LIVE_CASES } = await import("../benchmarks/business-profile/manifest");
  const { runFixtureSite, scoreCase, renderScoreTable, renderFailures } = await import("../benchmarks/business-profile/harness");
  const { siteById } = await import("../benchmarks/business-profile/fixtures/sites");

  const scores: CaseScore[] = [];
  const errors: Array<{ id: string; error: string }> = [];

  if (!live) {
    for (const testCase of FIXTURE_CASES) {
      if (only && testCase.id !== only) continue;
      const site = siteById(testCase.id);
      if (!site) continue;
      const run = await runFixtureSite(site, { useProvider: true });
      scores.push(scoreCase(testCase, run));
      report(`fixture  ${testCase.label}`);
    }
  } else {
    const { createProject } = await import("../src/lib/projects/repository");
    const { runWebsiteIntelligence } = await import("../src/lib/profile/orchestrator");

    for (const testCase of LIVE_CASES) {
      if (only && testCase.id !== only) continue;
      if (!testCase.liveUrl) continue;
      report(`live     ${testCase.label} — ${testCase.liveUrl}`);
      const startedAt = Date.now();
      try {
        const project = await createProject({ url: testCase.liveUrl, marketScope: "global", language: "en" });
        const { profile, crawl } = await runWebsiteIntelligence(project.id);
        scores.push(
          scoreCase(testCase, {
            profile,
            pages: (crawl?.pages ?? []).filter((p) => p.isSelected).map((p) => ({ id: p.id, url: p.url, pageType: p.pageType, title: p.title })),
            evidence: crawl?.evidence ?? [],
            durationMs: Date.now() - startedAt,
            timeToFirstFieldMs: crawl?.metrics.timeToFirstPageMs ?? null,
          }),
        );
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        errors.push({ id: testCase.id, error: message });
        report(`         FAILED: ${message}`);
      }
    }
  }

  const passed = scores.filter((s) => s.passed).length;
  const report_ = [
    `# Website Intelligence benchmark — ${live ? "live websites" : "deterministic fixtures"}`,
    "",
    `Run on ${new Date().toISOString()}. ${passed}/${scores.length} cases met every expectation.`,
    errors.length > 0 ? `${errors.length} case(s) could not be run: ${errors.map((e) => `${e.id} (${e.error})`).join("; ")}` : "",
    "",
    renderScoreTable(scores),
    "",
    "## Quality metrics",
    "",
    "| Case | Evidence coverage | Offerings | Identity traits | Markets | Useful-page share | Pages | Evidence | Duration |",
    "|---|---|---|---|---|---|---|---|---|",
    ...scores.map(
      (s) =>
        `| ${s.label} | ${Math.round(s.metrics.evidenceCoverage * 100)}% | ${s.metrics.offeringCount} | ${s.metrics.identityTraitCount} | ${s.metrics.marketCount} | ${Math.round(s.metrics.usefulPageShare * 100)}% | ${s.metrics.pagesSelected} | ${s.metrics.evidenceItems} | ${(s.metrics.durationMs / 1000).toFixed(1)}s |`,
    ),
    "",
    "## Failed assertions",
    "",
    renderFailures(scores),
    "",
    "## Per-case detail",
    "",
    ...scores.map((s) =>
      [
        `### ${s.label}`,
        `- business type: ${s.businessType}`,
        `- brand: ${s.profileSummary.brandName || "(none)"}`,
        `- description: ${s.profileSummary.description || "(none)"}`,
        `- industry: ${s.profileSummary.industry}`,
        `- archetype: ${s.profileSummary.archetype}`,
        `- offerings: ${s.profileSummary.offerings.join(", ") || "(none)"}`,
        `- brand identity: ${s.profileSummary.brandIdentity.join(", ") || "(none)"}`,
        `- markets: ${s.profileSummary.markets.join(", ") || "(none)"} (scope ${s.profileSummary.marketScope})`,
        `- pages: ${s.metrics.pagesSelected}, evidence: ${s.metrics.evidenceItems}, confidence: ${s.metrics.overallConfidence}`,
        `- duration: ${(s.metrics.durationMs / 1000).toFixed(1)}s`,
        "",
      ].join("\n"),
    ),
  ]
    .filter(Boolean)
    .join("\n");

  const outPath = path.join(process.cwd(), "benchmarks", "business-profile", "expected", live ? "live-report.md" : "fixture-report.md");
  fs.mkdirSync(path.dirname(outPath), { recursive: true });
  fs.writeFileSync(outPath, report_, "utf-8");

  report("");
  report(renderScoreTable(scores));
  report("");
  report(`${passed}/${scores.length} cases passed. Report written to ${path.relative(process.cwd(), outPath)}`);
  if (errors.length > 0) report(`${errors.length} case(s) errored — see the report.`);
  // A live run reports; it does not gate CI, so it never exits non-zero on
  // a site being down. Fixture runs are gated by `npm test` instead.
}

function report(line: string): void {
  process.stdout.write(`${line}\n`);
}

main().catch((err) => {
  console.error("[benchmark] failed:", err);
  process.exit(1);
});
