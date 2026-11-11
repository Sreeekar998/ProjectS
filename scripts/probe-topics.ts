// Prints the topic model's raw answer and the kept topics for a stored project's latest profile.
//   SUN_DATA_DIR=<scratch> npx tsx scripts/probe-topics.ts <projectId>   (reads .env.local keys)
import fs from "node:fs";
for (const line of fs.existsSync(".env.local") ? fs.readFileSync(".env.local", "utf8").split("\n") : []) {
  const match = line.match(/^([A-Z_][A-Z0-9_]*)=(.*)$/);
  if (match && !process.env[match[1]!]) process.env[match[1]!] = match[2]!.replace(/^["']|["']$/g, "");
}
(async () => {
  const { getLatestProfileVersion } = await import("../src/lib/profile/repository");
  const { generateTopicCandidates } = await import("../src/lib/landscape/topic-generation");
  const projectId = process.argv[2]!;
  const version = await getLatestProfileVersion(projectId);
  const result = await generateTopicCandidates(version!.profile as any, { projectId });
  console.log(`mode: ${result.mode}`);
  for (const topic of result.topics) console.log(`- ${topic.name} — ${topic.description}`);
  process.exit(0);
})();
