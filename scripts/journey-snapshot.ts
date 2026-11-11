// Runs Understand → Landscape → Prompts for ONE website on a scratch data dir and
// writes what the product actually produced (profile, topics, competitors, the
// 30 selected prompts, model usage) as JSON plus a readable Markdown file.
//
//   SUN_DATA_DIR=/tmp/x/data SUN_EVIDENCE_DIR=/tmp/x/evidence \
//     npx tsx scripts/journey-snapshot.ts <url> --out /tmp/x/out --label before \
//       [--worldwide | --country AE [--area "DIFC"]] [--stages understand,landscape,prompts] [--with-env-keys]
//
// Like eval-onboarding.ts it auto-confirms the profile, every topic and the
// top rivals (tier-mixed, up to 5) so later stages can run; that is a snapshot
// shortcut, not an operator review. --with-env-keys loads every variable in
// .env.local (paid OpenAI included) so the run uses the same routes as the app.
// Refuses to run against the default ./data.

import fs from "node:fs";
import path from "node:path";

function arg(name: string): string | undefined {
  const index = process.argv.indexOf(`--${name}`);
  return index >= 0 ? process.argv[index + 1] : undefined;
}
const has = (name: string) => process.argv.includes(`--${name}`);

const dataDir = process.env.SUN_DATA_DIR;
if (!dataDir || path.resolve(dataDir) === path.resolve("data") || !process.env.SUN_EVIDENCE_DIR) {
  console.error("Set SUN_DATA_DIR and SUN_EVIDENCE_DIR to scratch directories; this script never runs on ./data.");
  process.exit(2);
}
if (has("with-env-keys") && fs.existsSync(".env.local")) {
  for (const line of fs.readFileSync(".env.local", "utf8").split("\n")) {
    const match = line.match(/^([A-Z_][A-Z0-9_]*)=(.*)$/);
    if (match && !process.env[match[1]!]) process.env[match[1]!] = match[2]!.replace(/^["']|["']$/g, "");
  }
}
const url = process.argv[2];
if (!url || url.startsWith("--")) {
  console.error("usage: journey-snapshot.ts <url> --out <dir> [--label name] [--worldwide | --country XX [--area text]]");
  process.exit(2);
}
const outDir = arg("out") ?? path.join(path.dirname(dataDir), "snapshots");
const label = arg("label") ?? "run";
const stages = new Set((arg("stages") ?? "understand,landscape,prompts").split(","));

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

  fs.mkdirSync(outDir, { recursive: true });
  const started = Date.now();
  const record: Record<string, unknown> = { label, url, startedAt: new Date().toISOString() };
  const md: string[] = [`# ${label}: ${url}`, ""];
  try {
    const country = arg("country");
    const area = arg("area");
    const hint = has("worldwide")
      ? buildMarketHint({ countryCodes: [], worldwide: true, area: null })
      : country
        ? buildMarketHint({ countryCodes: [country.toUpperCase()], worldwide: false, area: area ? { query: area, place: null } : null })
        : null;
    record.hint = hint ? describeMarketHint(hint) : null;
    md.push(`Intake market: ${record.hint ?? "detect from website"}`, "");

    const project = await createProject({ url, marketHint: hint, language: "en" });
    record.projectId = project.id;
    const result = await runWebsiteIntelligence(project.id);
    const profile = result.profile;
    const loc = profile.location;
    record.profile = {
      brand: profile.identity.brandName.value,
      description: profile.description.value,
      classification: profile.classification,
      positioning: profile.positioning,
      offerings: profile.offerings.items.map((item) => item.name),
      offeringGroups: profile.offerings.groups ?? [],
      audience: (profile.audienceSegments ?? []).map((segment) => segment.label),
      customerJobs: profile.customerJobs.values,
      location: loc,
      scope: profile.marketScope.value,
      markets: profile.markets,
      geography: profile.geography,
      quality: profile.quality,
      pagesSelected: result.crawl?.pages.filter((page) => page.isSelected).map((page) => page.url),
    };
    md.push("## Understanding", "", `**Brand:** ${profile.identity.brandName.value}`, "", `**Description:** ${profile.description.value}`, "");
    md.push(`**Classification:** ${profile.classification?.path.join(" › ")} · kind ${profile.classification?.kind} · ${profile.classification?.customerType} · ${profile.classification?.physicalPresence} · price ${profile.classification?.pricePositioning}`, "");
    md.push(`**Scope:** ${profile.marketScope.value} · **Primary place:** ${loc?.primary?.label ?? "—"} (${loc?.primaryRole}) · **Countries served:** ${(loc?.countriesServed ?? []).join(", ") || "—"} · **Nearby:** ${(loc?.nearbyAreas ?? []).join(", ") || "—"}`, "");
    md.push(`**Markets mirror:** ${profile.markets.map((m) => `${m.name} (${m.level}${m.isPrimary ? ", primary" : ""})`).join("; ")}`, "");
    md.push(`**Geography mirror:** countries ${JSON.stringify(profile.geography.countries)} cities ${JSON.stringify(profile.geography.cities)}`, "");
    md.push(`**Pages selected:** ${result.crawl?.pages.filter((page) => page.isSelected).length ?? "?"} of ${result.crawl?.pages.length ?? "?"} fetched`, "");
    md.push("**Offerings (grouped):**", ...((profile.offerings.groups ?? []).length > 0 ? (profile.offerings.groups ?? []).map((g) => `- ${g.name}: ${g.items.join("; ")}`) : profile.offerings.items.map((item) => `- ${item.name}`)), "");
    md.push("**Audience:**", ...(profile.audienceSegments ?? []).map((s) => `- ${s.label} (${s.geoRelation})`), "");
    md.push(`**Differentiators:** ${(profile.positioning?.differentiators ?? []).join("; ") || "—"}`, "");
    md.push(`**Quality:** ${JSON.stringify({ models: profile.quality.models, cost: profile.quality.llmCostUsd, pages: profile.quality.pagesAnalyzed, warnings: profile.quality.warnings })}`, "");
    if (result.version.status !== "complete") throw new Error(`profile ${result.version.status}`);
    await confirmProfileVersion(result.version.id, "snapshot");

    if (stages.has("landscape") || stages.has("prompts")) {
      await generateLandscape(project.id, result.version.id);
      const landscape = await getLandscape(project.id);
      const tierContext = await loadTierContext(project.id, { run: landscape.discovery ?? null });
      const tierOf = (c: (typeof landscape.competitors)[number]) => (c.rejectionReason ? null : effectiveTier(c, tierContext));
      const topics = landscape.topics.filter((t) => t.status !== "removed").map((t) => ({ name: t.name, description: t.description }));
      const competitors = landscape.competitors.map((c) => ({
        name: c.canonicalName,
        domain: c.canonicalDomain,
        status: c.status,
        type: c.competitorType,
        tier: tierOf(c)?.tier ?? null,
        confidence: c.confidence,
        verification: c.verificationStatus,
        sources: c.sourceContributions,
        reason: c.reason,
        rejection: c.rejectionReason,
      }));
      record.landscape = { topics, competitors, tierPlan: tierContext?.plan.tiers.map((t) => ({ tier: t.tier, place: t.place })), discovery: landscape.discovery?.metrics };
      md.push("## Topics", "", ...topics.map((t) => `- **${t.name}** — ${t.description}`), "");
      md.push("## Competitors", "", `Tiers: ${(tierContext?.plan.tiers ?? []).map((t) => `${t.tier}=${t.place}`).join(", ") || "—"}`, "");
      md.push("Suggested:", ...competitors.filter((c) => !c.rejection).map((c) => `- ${c.name} (${c.type}, ${c.tier ?? "no tier"}, conf ${c.confidence}, ${c.verification}, ${(c.sources as string[] | null)?.join("+")}) — ${c.reason?.slice(0, 140)}`), "");
      md.push("Rejected (stored, hidden):", ...competitors.filter((c) => c.rejection).map((c) => `- ${c.name} (${c.verification}, ${(c.sources as string[] | null)?.join("+")}) — ${c.rejection?.slice(0, 160)}`), "");
    }

    if (stages.has("prompts")) {
      for (const topic of (await listTopics(project.id)).filter((t) => t.status !== "removed").slice(0, 6)) await updateTopic(topic.id, { status: "confirmed" });
      const rivals = orderRivalsByTierMix(
        (await listEntities(project.id)).filter((e) => e.kind === "competitor" && e.status === "candidate" && e.competitorType !== "marketplace"),
        5,
      );
      for (const rival of rivals) await updateEntity(rival.id, { status: "confirmed", discoveryStatus: "confirmed" });
      const confirmedTopics = (await listTopics(project.id)).filter((t) => t.status === "confirmed").length;
      if (rivals.length === 0 || confirmedTopics < 4) {
        record.prompts = { skipped: `needs 4-6 topics and a competitor (topics ${confirmedTopics}, rivals ${rivals.length})` };
        md.push("## Prompts", "", `Skipped: ${(record.prompts as { skipped: string }).skipped}`, "");
      } else {
        md.push(`Confirmed rivals for prompts: ${rivals.map((r) => r.canonicalName).join(", ")}`, "");
        await freezeCompetitiveSet(project.id, result.version.id);
        const set = await generatePromptSet(project.id, { force: true });
        const all = await listCandidates(set.id);
        const selected = all.filter((c) => c.lifecycleState === "SELECTED");
        const rows = selected.map((c) => ({
          section: c.section,
          text: c.editedText ?? c.text,
          place: c.geographyText,
          score: c.qualityScore,
          source: c.generationSource,
          model: ((c.contextBasis as string[] | null) ?? []).find((k) => k.startsWith("model:")) ?? "template",
          judge: (c.qualityBreakdown as Record<string, unknown> | null)?.cappedReason ?? null,
        }));
        record.prompts = rows;
        record.generationStats = set.generationStats;
        const rejectedModel = all.filter((c) => c.lifecycleState === "REJECTED" && c.generationSource !== "template");
        const reasons = rejectedModel.reduce<Record<string, number>>((acc, c) => ((acc[String(c.rejectedReason).split(":")[0]!] = (acc[String(c.rejectedReason).split(":")[0]!] ?? 0) + 1), acc), {});
        record.rejectedModelReasons = reasons;
        const judged = all.filter((c) => (c.qualityBreakdown as Record<string, unknown> | null)?.cappedReason && c.generationSource !== "template");
        record.judgeFailed = judged.map((c) => ({ section: c.section, text: c.text, reason: (c.qualityBreakdown as Record<string, unknown>).cappedReason, giveaway: (c.qualityBreakdown as Record<string, unknown>).judgeGiveaway }));
        md.push("## Prompts", "", `Stats: ${JSON.stringify(set.generationStats)}`, "");
        for (const section of ["Discovery", "Trade Offs", "Sentiment Analysis"]) {
          md.push(`### ${section}`, "", ...rows.filter((r) => r.section === section).map((r) => `- ${r.text}  \`${r.source} · ${r.model}${r.place ? ` · place: ${r.place}` : ""} · q${r.score}\``), "");
        }
        md.push("### Judge-failed model prompts (not selectable)", "", ...(record.judgeFailed as Array<{ section: string; text: string; reason: string; giveaway: string }>).slice(0, 40).map((j) => `- [${j.section}] ${j.text} — ${j.reason}${j.giveaway ? ` (“${j.giveaway}”)` : ""}`), "");
        md.push(`Model-written candidates rejected by gates: ${rejectedModel.length} ${JSON.stringify(reasons)}`, "");
      }
    }
    record.usage = summarizeUsage(project.id);
    md.push("## Model usage", "", "```json", JSON.stringify(record.usage, null, 1), "```", "");
  } catch (error) {
    record.error = error instanceof Error ? `${error.message}\n${error.stack ?? ""}` : String(error);
    md.push(`## ERROR`, "", String(record.error), "");
  }
  record.ms = Date.now() - started;
  const base = `${label}-${new URL(url).hostname.replace(/^www\./, "").replace(/[^a-z0-9.-]/gi, "_")}`;
  fs.writeFileSync(path.join(outDir, `${base}.json`), JSON.stringify(record, null, 2));
  fs.writeFileSync(path.join(outDir, `${base}.md`), md.join("\n"));
  console.log(`${label}: ${url} in ${Math.round((record.ms as number) / 1000)}s → ${path.join(outDir, `${base}.md`)}${record.error ? ` (ERROR: ${String(record.error).split("\n")[0]})` : ""}`);
  process.exit(record.error ? 1 : 0);
})();
