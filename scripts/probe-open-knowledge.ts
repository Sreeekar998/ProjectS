// Prints what the open-knowledge (Wikipedia/Wikidata) source proposes for a stored project's profile. Keyless.
//   SUN_DATA_DIR=<scratch> npx tsx scripts/probe-open-knowledge.ts <projectId>
(async () => {
  const { getLatestProfileVersion } = await import("../src/lib/profile/repository");
  const { listTopics } = await import("../src/lib/landscape/repository");
  const { buildCompetitiveSearchProfile } = await import("../src/lib/landscape/search-profile");
  const { OpenKnowledgeCandidateSource } = await import("../src/lib/landscape/open-knowledge");
  const projectId = process.argv[2]!;
  const version = await getLatestProfileVersion(projectId);
  const topics = await listTopics(projectId);
  const search = buildCompetitiveSearchProfile(version!.profile as any, topics, "en");
  const out = await new OpenKnowledgeCandidateSource().discover(search);
  for (const c of out) console.log(`${c.confidence}\t${c.structuralAffinity}\t${c.canonicalName}\t${c.likelyDomain}\t${c.reason.slice(0, 150)}`);
  console.log(`${out.length} candidates`);
  process.exit(0);
})();
