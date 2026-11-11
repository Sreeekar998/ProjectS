// Seeds one project with a confirmed profile, confirmed topics, one confirmed
// competitor, a frozen competitive set and an APPROVED 30-prompt set, so the
// Measure console can be exercised without a crawl or a model key.
//
//   SUN_DATA_DIR=./data/verify-vendors SUN_EVIDENCE_DIR=./data/verify-vendors/evidence-store \
//     npx tsx scripts/seed-approved-project.ts [--brand TrailStride] [--market AE]
//
// Refuses to run against ./data (the live database). Prints the project id.
// The profile is a fixture, not a crawl; use it for collection and Measure
// checks only.

import { getDb } from "../src/lib/db/client";
import { businessProfileVersions, topics as topicsTable } from "../src/lib/db/schema";
import { newId } from "../src/lib/ids";
import { createProject } from "../src/lib/projects/repository";
import { insertTargetEntity, insertCompetitorCandidates, updateEntity, freezeCompetitiveSet } from "../src/lib/landscape/repository";
import { generatePromptSet, approvePromptSet } from "../src/lib/prompts/orchestrator";
import { makeProfile } from "../tests/helpers/profile-fixtures";

function arg(name: string, fallback: string): string {
  const index = process.argv.indexOf(name);
  return index >= 0 ? (process.argv[index + 1] ?? fallback) : fallback;
}

async function main() {
  const dataDir = process.env.SUN_DATA_DIR ?? "./data";
  if (dataDir === "./data" || dataDir === "data") throw new Error("Refusing to seed the live database; set SUN_DATA_DIR to an isolated directory.");
  await import("./bootstrap-inline").then((m) => m.bootstrapInline());

  const brand = arg("--brand", "TrailStride");
  const market = arg("--market", "AE").toUpperCase();
  const domain = `${brand.toLowerCase().replace(/[^a-z0-9]+/g, "")}.example`;
  const profile = makeProfile({
    brandName: brand,
    archetype: "ecommerce_dtc_retail",
    industry: "trail running shoes",
    offerings: ["trail running shoes", "hiking boots", "trail socks"],
    audiences: ["Beginners", "Regular runners", "Ultra runners"],
    countries: [market === "AE" ? "United Arab Emirates" : market],
    cities: [],
    regulated: false,
    domain,
  });
  const project = await createProject({ url: `https://${domain}/`, marketScope: market, language: "en" });
  const db = getDb();
  const now = new Date();
  const profileVersionId = newId("bpv");
  await db.insert(businessProfileVersions).values({ id: profileVersionId, projectId: project.id, version: 1, crawlRunId: null, profile: profile as unknown as Record<string, unknown>, fieldProvenance: {}, confirmedAt: now, confirmedBy: "seed", createdAt: now }).run();
  for (const [priority, name] of ["Trail running shoes", "Hiking boots", "Waterproof footwear", "Running accessories", "Outdoor apparel"].entries()) {
    await db.insert(topicsTable).values({ id: newId("top"), projectId: project.id, businessProfileVersionId: profileVersionId, name, description: "seeded topic", priority, status: "confirmed", source: "system", evidenceIds: [], createdAt: now }).run();
  }
  await insertTargetEntity(project.id, brand, profile.identity.domains);
  const rivals = await insertCompetitorCandidates(project.id, [
    { canonicalName: "Salomon", competitorType: "direct", domains: ["salomon.com"], reason: "seeded rival", confidence: 80, evidenceIds: [] },
    { canonicalName: "Hoka", competitorType: "direct", domains: ["hoka.com"], reason: "seeded rival", confidence: 80, evidenceIds: [] },
  ]);
  for (const rival of rivals) await updateEntity(rival.id, { status: "confirmed" });
  await freezeCompetitiveSet(project.id, profileVersionId);
  const promptSet = await generatePromptSet(project.id);
  const approved = await approvePromptSet(promptSet.id, "seed");
  if (approved.status !== "approved") throw new Error(`prompt set not approved: ${approved.status}`);
  console.log(JSON.stringify({ projectId: project.id, promptSetId: promptSet.id, brand, market }));
  console.log(`open /projects/${project.id}/measure`);
}

main().catch((error) => {
  console.error("FAILED:", error instanceof Error ? error.message : error);
  process.exit(1);
});
