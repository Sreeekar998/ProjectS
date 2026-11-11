// Runs the full competitor discovery pipeline for an existing project WITHOUT
// persisting anything, and prints the ranked suggestions an operator would see.
//
//   npx tsx scripts/probe-discovery.ts <projectId>
import { discoverCompetitors } from "@/lib/landscape/competitors";
import { listTopics } from "@/lib/landscape/repository";
import { listEvidenceChunksForProject } from "@/lib/crawler/repository";
import { getLatestProfileVersion } from "@/lib/profile/repository";
import { getProject } from "@/lib/projects/repository";
import { loadCredentials } from "@/lib/providers/credentials";
import type { BusinessProfile } from "@/lib/profile/schema";

async function main() {
  const projectId = process.argv[2];
  if (!projectId) throw new Error("usage: npx tsx scripts/probe-discovery.ts <projectId>");
  await loadCredentials();
  const [project, version, topics, chunks] = await Promise.all([getProject(projectId), getLatestProfileVersion(projectId), listTopics(projectId), listEvidenceChunksForProject(projectId)]);
  if (!project || !version) throw new Error("project or profile not found");
  const started = Date.now();
  const result = await discoverCompetitors(version.profile as unknown as BusinessProfile, topics, chunks, { locale: project.language, maxSuggestions: 16 });
  console.log(`discovery finished in ${Math.round((Date.now() - started) / 1000)}s · ${result.candidates.length} ranked candidates`);
  for (const candidate of result.candidates as unknown as Array<Record<string, any>>) {
    const name = candidate.canonicalName ?? candidate.name;
    const role = candidate.role ?? candidate.competitorType ?? candidate.proposedType;
    const score = candidate.score?.total ?? candidate.confidence ?? candidate.total;
    const sources = candidate.sources ?? candidate.sourceTypes ?? candidate.sourceContributions ?? [];
    console.log(`  ${String(name).padEnd(28)} ${String(role).padEnd(12)} ${String(score).padStart(4)}  ${JSON.stringify(sources)}`);
  }
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
