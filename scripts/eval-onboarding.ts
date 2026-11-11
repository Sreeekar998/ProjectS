// Onboarding evaluation over the golden businesses.
//
//   SUN_DATA_DIR=/tmp/x/data SUN_EVIDENCE_DIR=/tmp/x/evidence \
//     npx tsx scripts/eval-onboarding.ts --out /tmp/x/eval [--only 00-,05-] [--stages understand,landscape,prompts] [--with-env-keys] [--with-hints]
//
// --with-hints sends each case's expected country and first expected area (or
// city) as the intake "Where are your customers?" answer, so a run with and
// without hints shows whether the hint helps. Cases without an expected
// country get no hint.
//
// Side effects: crawls every case's website; with --with-env-keys it reads the
// provider keys in .env.local and makes model calls — Understand and Prompts
// may use PAID OpenAI routes (about $0.01 and $0.10 per business on
// 2026-09-13 prices), Landscape uses free Gemini routes unless
// SUN_ALLOW_PAID_LANDSCAPE=1. Refuses to run against the default ./data.
// The eval auto-confirms profiles, topics and system-suggested competitors so
// later stages can run; that is an evaluation shortcut, not an operator review.
// Competitors are auto-confirmed in the tier-mixed order Trade Offs use.

import fs from "node:fs";
import path from "node:path";
import { scoreCompetitors, scorePrompts, scoreTiers, scoreUnderstanding, summarize, type Check, type GoldenCase, type GoldenTier } from "../benchmarks/onboarding/score";

function arg(name: string): string | undefined {
  const index = process.argv.indexOf(`--${name}`);
  return index >= 0 ? process.argv[index + 1] : undefined;
}

const dataDir = process.env.SUN_DATA_DIR;
if (!dataDir || path.resolve(dataDir) === path.resolve("data") || !process.env.SUN_EVIDENCE_DIR) {
  console.error("Set SUN_DATA_DIR and SUN_EVIDENCE_DIR to scratch directories; this script never runs on ./data.");
  process.exit(2);
}
if (process.argv.includes("--with-env-keys")) {
  for (const line of fs.readFileSync(".env.local", "utf8").split("\n")) {
    const match = line.match(/^([A-Z_]+)=(.*)$/);
    if (match && /API_KEY$/.test(match[1]!) && !process.env[match[1]!]) process.env[match[1]!] = match[2]!.replace(/^["']|["']$/g, "");
  }
}
const outDir = arg("out") ?? path.join(path.dirname(dataDir), "eval");
const only = arg("only")?.split(",").filter(Boolean);
const stages = new Set((arg("stages") ?? "understand,landscape,prompts").split(","));
const withHints = process.argv.includes("--with-hints");
const golden = JSON.parse(fs.readFileSync("benchmarks/onboarding/golden-businesses.json", "utf8")) as { cases: GoldenCase[] };
const cases = golden.cases.filter((c) => !only || only.some((prefix) => c.id.startsWith(prefix)));

(async () => {
  const { bootstrapInline } = await import("./bootstrap-inline");
  await bootstrapInline();
  const { createProject } = await import("../src/lib/projects/repository");
  const { runWebsiteIntelligence } = await import("../src/lib/profile/orchestrator");
  const { confirmProfileVersion } = await import("../src/lib/profile/repository");
  const { generateLandscape, getLandscape } = await import("../src/lib/landscape/orchestrator");
  const { listTopics, listEntities, updateTopic, updateEntity, freezeCompetitiveSet, loadTierContext, effectiveTier } = await import("../src/lib/landscape/repository");
  const { orderRivalsByTierMix } = await import("../src/lib/landscape/competitor-tier-order");
  const { buildMarketHint, describeMarketHint } = await import("../src/lib/projects/market-hint");
  const { generatePromptSet } = await import("../src/lib/prompts/orchestrator");
  const { listCandidates } = await import("../src/lib/prompts/repository");
  const { summarizeUsage } = await import("../src/lib/llm");
  const { shortNameForms } = await import("../src/lib/landscape/name-forms");
  fs.mkdirSync(outDir, { recursive: true });
  const rows: string[] = [];

  for (const golden of cases) {
    const started = Date.now();
    const record: Record<string, unknown> = { id: golden.id, url: golden.url };
    const checks: Record<string, Check[]> = {};
    try {
      const hint = withHints && golden.expect.country
        ? buildMarketHint({ countryCodes: [golden.expect.country], worldwide: false, area: (golden.expect.area[0] ?? golden.expect.city[0]) ? { query: golden.expect.area[0] ?? golden.expect.city[0]!, place: null } : null })
        : null;
      record.hint = hint ? describeMarketHint(hint) : null;
      const project = await createProject({ url: golden.url, marketHint: hint, language: "en" });
      const result = await runWebsiteIntelligence(project.id);
      const profile = result.profile;
      const primary = profile.location?.primary ?? null;
      record.profile = {
        brand: profile.identity.brandName.value,
        classification: profile.classification,
        location: profile.location,
        scope: profile.marketScope.value,
        markets: profile.markets,
        description: profile.description.value,
        offerings: profile.offerings.groups ?? profile.offerings.values,
        audience: profile.audienceSegments ?? profile.targetAudience,
        quality: profile.quality,
        pages: result.crawl?.pages.filter((p) => p.isSelected).length,
      };
      checks.understand = scoreUnderstanding(golden.expect, {
        brand: profile.identity.brandName.value,
        aliases: profile.identity.aliases.values,
        kind: profile.classification?.kind ?? null,
        path: profile.classification?.path ?? [profile.industry.value],
        archetype: profile.archetype.value,
        regulated: profile.regulatedDomain.categories,
        location: primary ? { neighborhood: primary.neighborhood, district: primary.district, city: primary.city, region: primary.region, countryCode: primary.countryCode, formattedAddress: primary.formattedAddress } : null,
        nearbyAreas: profile.location?.nearbyAreas ?? [],
        scope: profile.marketScope.value,
        offeringCount: profile.offerings.items.length,
        audienceCount: (profile.audienceSegments ?? profile.targetAudience).length,
        descriptionLength: profile.description.value.length,
        synthesisMode: profile.quality.synthesisMode,
      });
      if (result.version.status !== "complete") throw new Error(`profile ${result.version.status}`);
      await confirmProfileVersion(result.version.id, "eval");

      if (stages.has("landscape") || stages.has("prompts")) {
        await generateLandscape(project.id, result.version.id);
        const landscape = await getLandscape(project.id);
        const tierContext = await loadTierContext(project.id, { run: landscape.discovery ?? null });
        const tierOf = (c: (typeof landscape.competitors)[number]) => (c.rejectionReason ? null : effectiveTier(c, tierContext));
        record.landscape = {
          topics: landscape.topics.filter((t) => t.status !== "removed").map((t) => ({ name: t.name, description: t.description })),
          tierPlan: tierContext ? { tiers: tierContext.plan.tiers.map((t) => ({ tier: t.tier, place: t.place, quota: t.quota })), primaryTier: tierContext.plan.primaryTier, brandReach: tierContext.plan.brandReach } : null,
          competitors: landscape.competitors.map((c) => ({ name: c.canonicalName, domain: c.canonicalDomain, status: c.status, type: c.competitorType, tier: tierOf(c)?.tier ?? null, tierPlace: tierOf(c)?.place ?? null, score: (c.scoreBreakdown as Record<string, number> | null)?.total, sources: c.sourceContributions, reason: c.reason, rejection: c.rejectionReason, location: (c.candidateProfile as Record<string, unknown> | null)?.reportedLocation ?? null })),
          discovery: landscape.discovery?.metrics,
        };
        const observedCompetitors = landscape.competitors.map((c) => ({ name: c.canonicalName, domain: c.canonicalDomain, status: c.status, type: c.competitorType, rejectionReason: c.rejectionReason, tier: (tierOf(c)?.tier ?? null) as GoldenTier | null }));
        checks.landscape = [
          ...scoreCompetitors(golden.researched?.competitors ?? [], observedCompetitors, profile.identity.brandName.value),
          ...scoreTiers(golden, tierContext ? { tiers: tierContext.plan.tiers.map((t) => t.tier), primaryTier: tierContext.plan.primaryTier } : null, observedCompetitors),
        ];
      }

      if (stages.has("prompts")) {
        for (const topic of (await listTopics(project.id)).filter((t) => t.status !== "removed").slice(0, 6)) await updateTopic(topic.id, { status: "confirmed" });
        // Best-scored suggestions first, mixed across tiers the way Trade Offs
        // pick rivals, so a local business is confirmed with city-wide and
        // country-wide rivals too.
        const rivals = orderRivalsByTierMix(
          (await listEntities(project.id)).filter((e) => e.kind === "competitor" && e.status === "candidate" && e.competitorType !== "marketplace"),
          5,
        );
        for (const rival of rivals) await updateEntity(rival.id, { status: "confirmed", discoveryStatus: "confirmed" });
        const confirmedTopics = (await listTopics(project.id)).filter((t) => t.status === "confirmed").length;
        if (rivals.length === 0 || confirmedTopics < 4) {
          record.prompts = { skipped: `needs 4-6 topics and a competitor (topics ${confirmedTopics}, rivals ${rivals.length})` };
        } else {
          await freezeCompetitiveSet(project.id, result.version.id);
          const set = await generatePromptSet(project.id, { force: true });
          const selected = (await listCandidates(set.id)).filter((c) => c.lifecycleState === "SELECTED");
          record.prompts = selected.map((c) => ({ section: c.section, text: c.editedText ?? c.text, geographyScope: c.geographyScope, geographyText: c.geographyText, model: ((c.contextBasis as string[] | null) ?? []).find((k) => k.startsWith("model:")) ?? "template" }));
          checks.prompts = scorePrompts(
            golden.expect,
            selected.map((c) => ({ section: c.section ?? "", text: c.editedText ?? c.text, geographyScope: c.geographyScope ?? "none", geographyText: c.geographyText })),
            [profile.identity.brandName.value, ...profile.identity.aliases.values, ...shortNameForms(profile.identity.brandName.value, profile.identity.domains)],
          );
        }
      }
      record.usage = summarizeUsage(project.id);
    } catch (error) {
      record.error = error instanceof Error ? error.message : String(error);
    }
    record.checks = checks;
    record.ms = Date.now() - started;
    fs.writeFileSync(path.join(outDir, `${golden.id}.json`), JSON.stringify(record, null, 2));
    const cell = (name: string) => (checks[name] ? `${summarize(checks[name]!).passed}/${summarize(checks[name]!).total}` : "—");
    const usage = record.usage as { costUsd?: number } | undefined;
    rows.push(`| ${golden.id} | ${cell("understand")} | ${cell("landscape")} | ${cell("prompts")} | ${usage?.costUsd?.toFixed(3) ?? "—"} | ${Math.round((record.ms as number) / 1000)}s | ${record.error ?? ""} |`);
    console.log(rows.at(-1));
    for (const [stage, list] of Object.entries(checks)) for (const check of list) if (!check.pass) console.log(`    ✗ ${stage}: ${check.name} — ${check.observed.slice(0, 200)}`);
  }
  const report = ["# Onboarding evaluation", "", `Cases: ${cases.length}. Stages: ${[...stages].join(", ")}. Cost is estimated at list prices (Gemini free-tier calls cost $0).`, "", "| Case | Understand | Landscape | Prompts | Est. USD | Time | Error |", "|---|---|---|---|---|---|---|", ...rows].join("\n");
  fs.writeFileSync(path.join(outDir, "report.md"), report);
  console.log(`\nReport: ${path.join(outDir, "report.md")}`);
  process.exit(0);
})();
