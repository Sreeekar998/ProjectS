import fs from "node:fs";
import path from "node:path";
import { createProject } from "../src/lib/projects/repository";
import { runWebsiteIntelligence } from "../src/lib/profile/orchestrator";
import { confirmProfileVersion } from "../src/lib/profile/repository";
import { generateLandscape } from "../src/lib/landscape/orchestrator";
import { normalizeEntityName } from "../src/lib/landscape/competitor-entity";

interface ManifestEntry {
  label: string;
  url: string;
  marketScope: string;
  language?: string;
  relevantCompetitors: string[];
}

async function main() {
  if (!process.env.GEMINI_API_KEY) throw new Error("GEMINI_API_KEY is required for the manually invoked live competitor benchmark.");
  const manifestArg = process.argv[2];
  if (!manifestArg) throw new Error("Pass a reviewed benchmark manifest path. See benchmarks/competitor-live-manifest.example.json.");
  const manifestPath = path.resolve(process.cwd(), manifestArg);
  const entries = JSON.parse(fs.readFileSync(manifestPath, "utf8")) as ManifestEntry[];
  if (!Array.isArray(entries) || entries.length < 10) throw new Error("The live benchmark requires at least 10 diverse, manually reviewed targets.");

  const rows: Array<Record<string, unknown>> = [];
  for (const entry of entries) {
    const project = await createProject({ url: entry.url, marketScope: entry.marketScope, language: entry.language ?? "en" });
    const { version } = await runWebsiteIntelligence(project.id);
    await confirmProfileVersion(version.id, "live-benchmark-operator");
    const landscape = await generateLandscape(project.id, version.id);
    const topFive = landscape.competitors.filter((candidate) => candidate.status === "candidate").sort((a, b) => (b.confidence ?? 0) - (a.confidence ?? 0)).slice(0, 5);
    const expected = new Set(entry.relevantCompetitors.map(normalizeEntityName));
    const relevantCount = topFive.filter((candidate) => expected.has(normalizeEntityName(candidate.canonicalName))).length;
    rows.push({
      target: entry.label,
      topFive: topFive.map((candidate) => ({
        name: candidate.canonicalName,
        type: candidate.competitorType,
        confidence: candidate.confidence,
        reason: candidate.reason,
        manuallyRelevant: expected.has(normalizeEntityName(candidate.canonicalName)),
      })),
      precisionAtFive: topFive.length ? relevantCount / topFive.length : 0,
      duplicateEntityRate: topFive.length ? 1 - new Set(topFive.map((candidate) => candidate.canonicalDomain || candidate.normalizedName)).size / topFive.length : 0,
      metrics: landscape.discovery?.metrics ?? {},
    });
  }
  const output = { createdAt: new Date().toISOString(), rows, meanPrecisionAtFive: rows.reduce((sum, row) => sum + Number(row.precisionAtFive), 0) / rows.length };
  const outputPath = path.resolve(process.cwd(), "benchmarks/competitor-live-results.json");
  fs.writeFileSync(outputPath, `${JSON.stringify(output, null, 2)}\n`);
  console.log(`Live benchmark written to ${outputPath}`);
  console.log(`Mean Precision@5: ${(output.meanPrecisionAtFive * 100).toFixed(1)}%`);
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});
