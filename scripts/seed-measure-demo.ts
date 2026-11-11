// Seeds one project with three measurement runs so the Measure workspace can
// be exercised, screenshot and hand-checked without a provider credit:
//
//   run 1 (14 days ago)  ChatGPT via Oxylabs + Gemini via cloro, complete, final
//   run 2 (7 days ago)   ChatGPT via cloro + Gemini via cloro, complete, final
//                        → comparable with run 1, with a "different provider" caution
//   run 3 (today)        prompt set v2 after a rival was added and the set re-frozen,
//                        partial (4 not collected, 1 needs a look, 1 awaiting analysis),
//                        still open → a methodology break against run 2
//
//   SUN_DATA_DIR=./data/verify-measure SUN_EVIDENCE_DIR=./data/verify-measure/evidence-store \
//   OXYLABS_AUTH=mock:oxylabs CLORO_API_KEY=mock-cloro SUN_ENGINES=chatgpt,gemini \
//     npx tsx scripts/seed-measure-demo.ts [--brand TrailStride] [--market IN]
//
// Refuses to run against ./data (the live database). Answers are templated
// (marked is_fixture) and every analysis is produced by the real analyzer.

import { eq } from "drizzle-orm";
import { getDb } from "../src/lib/db/client";
import { businessProfileVersions, collectionRuns, topics as topicsTable } from "../src/lib/db/schema";
import { newId } from "../src/lib/ids";
import { sha256Hex } from "../src/lib/text/similarity";
import { createProject } from "../src/lib/projects/repository";
import { insertTargetEntity, insertCompetitorCandidates, updateEntity, freezeCompetitiveSet } from "../src/lib/landscape/repository";
import { generatePromptSet, approvePromptSet } from "../src/lib/prompts/orchestrator";
import { listCandidates } from "../src/lib/prompts/repository";
import { createCollectionRun } from "../src/lib/collection/orchestrator";
import { listPromptRuns, updatePromptRun, insertProviderResponse } from "../src/lib/collection/repository";
import { finaliseCollectionRun } from "../src/lib/collection/finalise";
import { analyseObservationById } from "../src/lib/analysis/service";
import { makeProfile } from "../tests/helpers/profile-fixtures";

function arg(name: string, fallback: string): string {
  const index = process.argv.indexOf(name);
  return index >= 0 ? (process.argv[index + 1] ?? fallback) : fallback;
}

const DAY = 24 * 60 * 60 * 1000;

type Section = "Discovery" | "Trade Offs" | "Sentiment Analysis";
interface Variant {
  text: (ctx: { brand: string; rival: string; topic: string; product: string }) => string;
  /** Which source bundle to attach; "none" = page showed no sources, "unknown" = sources not captured. */
  sources: string;
}

const PRODUCT: Record<string, string> = { TrailStride: "TrailStride Ridge", Salomon: "Salomon Speedcross 6", Hoka: "Hoka Speedgoat 6", Brooks: "Brooks Cascadia 17" };
const product = (name: string) => PRODUCT[name] ?? name;

const DISCOVERY: Record<string, Variant> = {
  present2: {
    sources: "editorial_owned",
    text: ({ brand, topic }) => `Top picks for ${topic}:\n\n1. **${product("Salomon")}** — aggressive lugs and a snug fit for technical terrain.\n2. **${product(brand)}** — light, with a rock plate that protects on sharp stone.\n3. **${product("Hoka")}** — the most cushioned option for long days.\n\nSalomon is the safest all-round choice.`,
  },
  first: {
    sources: "editorial_owned",
    text: ({ brand, topic }) => `The best options right now for ${topic}:\n\n1. **${product(brand)}** — light and protective, good value.\n2. **${product("Hoka")}** — plush cushioning.\n3. **${product("Salomon")}** — best grip in mud.\n\n${brand} is my top pick for beginners.`,
  },
  absent_untracked: {
    sources: "editorial_rival",
    // Brooks is named mid-sentence too: the analyzer proposes an untracked
    // brand only when it is written capitalised where grammar does not require it.
    // The list item and the prose use the same surface ("Brooks"): a product
    // suffix in the list would make them two different candidate names.
    text: ({ topic }) => `For ${topic} the usual picks are:\n\n1. **${product("Salomon")}** — waterproof and stable.\n2. **${product("Hoka")}** — cushioned for long descents.\n3. **Brooks** — a reliable hybrid.\n\nSalomon is the most popular choice among Indian buyers, though Brooks is catching up.`,
  },
  absent_two: {
    sources: "marketplace_community",
    text: ({ topic }) => `Top picks for ${topic}:\n\n1. **${product("Hoka")}** — comfortable over long distances.\n2. **${product("Salomon")}** — precise fit and grip.\n\nHoka is the better choice for most people.`,
  },
  brand_free: {
    sources: "reference",
    text: ({ topic }) => `It depends on the terrain. For ${topic}, look for a lugged outsole of 4 to 5 mm for mud, a rock plate for stony trails, and a snug heel to avoid blisters. Try shoes on late in the day when your feet are largest, and size up half a step for long descents.`,
  },
  prose_unranked: {
    sources: "none",
    text: ({ brand, topic }) => `Salomon and Hoka are both worth considering for ${topic}; ${brand} also makes a lighter option that beginners like. Any of the three will do for short outings.`,
  },
  hedged: {
    sources: "unknown",
    text: ({ brand, topic }) => `${brand} could be a good option for ${topic}, though Salomon is the more established choice.`,
  },
};

const TRADEOFF: Record<string, Variant> = {
  win: {
    sources: "editorial_rival",
    text: ({ brand, rival }) => `${brand} is the better choice here. ${brand} is lighter than ${rival} and its rock plate protects better on sharp stone, though ${rival} grips better on wet rock. If weight matters most, go with ${brand}.`,
  },
  win_price: {
    sources: "marketplace_community",
    text: ({ brand, rival }) => `${brand} is the better choice here. ${brand} is cheaper than ${rival} and lighter, while ${rival} offers more cushioning. On price, ${brand} is the better choice.`,
  },
  loss: {
    sources: "editorial_rival",
    text: ({ brand, rival }) => `${rival} is the better choice here. ${rival}'s outsole grips better than ${brand}'s and it is more durable, though ${brand} is cheaper. If durability matters most, go with ${rival}.`,
  },
  loss_comfort: {
    sources: "rival_only",
    text: ({ brand, rival }) => `${rival} is the better choice here. ${rival} is more comfortable than ${brand} on long runs because of its cushioning, though ${brand} has better grip. For comfort, ${rival} is the better choice.`,
  },
  tie: {
    sources: "none",
    text: ({ brand, rival }) => `Both are strong picks. ${brand} is lighter, while ${rival} is more cushioned; it comes down to whether you value weight or comfort. Neither is clearly better.`,
  },
  no_comparison: {
    sources: "owned_only",
    text: ({ brand }) => `${brand} sells trail shoes, hiking boots and socks through its own website and a few retailers in India. Prices start around ₹6,000 and most models come in half sizes.`,
  },
};

const SENTIMENT: Record<string, Variant> = {
  positive: {
    sources: "editorial_owned",
    text: ({ brand }) => `${brand} is generally well regarded. Reviewers praise its comfort and light weight, and ${brand}'s customer service gets good marks for quick replacements.`,
  },
  positive_value: {
    sources: "marketplace_community",
    text: ({ brand }) => `${brand} has a good reputation for value. ${brand} is comfortable and well made for the price, and most buyers say ${brand} is reliable on rocky trails.`,
  },
  mixed: {
    sources: "editorial_owned",
    text: ({ brand }) => `${brand} is comfortable and light, but ${brand} is not durable: many reviewers say the outsole wears out within a few months.`,
  },
  mixed_service: {
    sources: "unknown",
    text: ({ brand }) => `${brand} gets praise for comfort and value. However, ${brand} has a poor record on customer service, with frequent reports of slow returns.`,
  },
  negative: {
    sources: "marketplace_community",
    text: ({ brand }) => `${brand} has a poor reputation for durability. Many reviewers report the upper tearing within months, and ${brand}'s returns are slow and frustrating.`,
  },
  negative_service: {
    sources: "none",
    text: ({ brand }) => `${brand} has a poor reputation for customer service. Many buyers report slow returns and unanswered emails, and ${brand}'s sizing runs small.`,
  },
  factual: {
    sources: "reference",
    text: ({ brand }) => `${brand} is an Indian trail running shoe brand founded in 2019 and headquartered in Bengaluru. It sells trail shoes, hiking boots and socks online.`,
  },
};

function sourcesFor(bundle: string, engine: "chatgpt" | "gemini", brandDomain: string, index: number): { urls: string[]; state: "complete" | "none_present" | "unknown"; searched: "on" | "off" } {
  const utm = engine === "chatgpt" ? "?utm_source=chatgpt.com" : "";
  const slug = ["rocky-trails", "monsoon", "beginners", "long-distance", "budget"][index % 5];
  const bundles: Record<string, string[]> = {
    editorial_owned: [`https://www.runnersworld.com/gear/best-trail-running-shoes-${slug}${utm}`, `https://${brandDomain}/shoes/ridge${utm}`],
    editorial_rival: [`https://www.runnersworld.com/gear/best-trail-running-shoes-${slug}${utm}`, `https://www.salomon.com/en-in/shop/trail-running${utm}`, `https://www.outdoorgearlab.com/topics/shoes-and-boots/best-trail-running-shoes${utm}`],
    marketplace_community: [`https://www.amazon.in/dp/B0TRAIL${index}${utm}`, `https://www.reddit.com/r/trailrunning/comments/${slug}${utm}`],
    reference: [`https://en.wikipedia.org/wiki/Trail_running${utm}`],
    rival_only: [`https://www.hoka.com/en/in/trail${utm}`, `https://www.salomon.com/en-in/shop/trail-running${utm}`],
    owned_only: [`https://${brandDomain}/shoes${utm}`, `https://${brandDomain}/faq${utm}`],
  };
  if (bundle === "none") return { urls: [], state: "none_present", searched: "off" };
  if (bundle === "unknown") return { urls: [], state: "unknown", searched: "on" };
  return { urls: bundles[bundle] ?? [], state: "complete", searched: "on" };
}

/** Per-run scripts: variant per (section, prompt index × engine), 20 entries each. */
interface RunScript {
  daysAgo: number;
  routes: string[];
  discovery: string[];
  tradeOff: string[];
  sentiment: string[];
  /** Zero-based slots (section index × 20 grid) that are left uncollected. */
  failed?: Array<[Section, number]>;
  truncated?: Array<[Section, number]>;
  awaitingAnalysis?: Array<[Section, number]>;
  finalise: boolean;
}

const RUNS: RunScript[] = [
  {
    daysAgo: 14,
    routes: ["chatgpt_oxylabs_web", "gemini_cloro_web"],
    discovery: ["present2", "absent_untracked", "absent_two", "first", "absent_untracked", "brand_free", "absent_two", "prose_unranked", "absent_untracked", "present2", "absent_two", "absent_untracked", "first", "hedged", "absent_untracked", "prose_unranked", "absent_two", "present2", "absent_untracked", "brand_free"],
    tradeOff: ["loss", "win", "loss_comfort", "tie", "loss", "win_price", "loss", "tie", "win", "loss_comfort", "no_comparison", "loss", "win", "tie", "loss", "win_price", "loss_comfort", "tie", "no_comparison", "win"],
    sentiment: ["positive", "mixed", "positive_value", "negative", "positive", "factual", "mixed", "positive", "positive_value", "mixed_service", "positive", "negative", "factual", "positive", "mixed", "positive_value", "negative_service", "positive", "mixed", "factual"],
    finalise: true,
  },
  {
    daysAgo: 7,
    routes: ["chatgpt_cloro_web", "gemini_cloro_web"],
    discovery: ["first", "present2", "absent_untracked", "first", "present2", "brand_free", "absent_two", "prose_unranked", "absent_untracked", "present2", "absent_two", "first", "absent_untracked", "hedged", "present2", "absent_two", "first", "absent_untracked", "absent_two", "brand_free"],
    tradeOff: ["win", "win_price", "loss", "tie", "win", "loss_comfort", "win", "tie", "win", "loss", "no_comparison", "win_price", "loss", "win", "loss", "win", "loss_comfort", "tie", "no_comparison", "win"],
    sentiment: ["positive", "positive_value", "mixed", "positive", "positive", "factual", "positive_value", "positive", "mixed", "positive", "negative", "positive", "positive_value", "mixed", "positive", "positive", "negative_service", "positive_value", "mixed", "factual"],
    finalise: true,
  },
  {
    daysAgo: 0,
    routes: ["chatgpt_oxylabs_web", "gemini_cloro_web"],
    discovery: ["first", "present2", "absent_untracked", "present2", "first", "brand_free", "absent_two", "prose_unranked", "absent_untracked", "present2", "absent_two", "first", "absent_untracked", "hedged", "present2", "absent_two", "absent_untracked", "first", "absent_two", "absent_untracked"],
    tradeOff: ["win", "loss", "win_price", "tie", "win", "loss_comfort", "win", "tie", "loss", "win", "no_comparison", "loss", "win", "tie", "loss", "win_price", "loss_comfort", "win", "loss", "win"],
    sentiment: ["positive", "mixed", "positive_value", "negative", "positive", "factual", "mixed", "positive", "positive_value", "positive", "negative", "positive", "positive_value", "mixed", "positive", "positive", "negative_service", "positive", "mixed", "positive_value"],
    failed: [["Discovery", 4], ["Discovery", 17], ["Trade Offs", 9], ["Sentiment Analysis", 15]],
    truncated: [["Discovery", 8]],
    awaitingAnalysis: [["Sentiment Analysis", 2]],
    finalise: false,
  },
];

async function seedRun(projectId: string, brand: string, brandDomain: string, rivalNames: Map<string, string>, topicNames: Map<string, string>, script: RunScript, label: string) {
  const db = getDb();
  const run = await createCollectionRun(projectId, script.routes);
  const startedAt = Date.now() - script.daysAgo * DAY - 2 * 60 * 60 * 1000;
  await db.update(collectionRuns).set({ createdAt: new Date(startedAt) }).where(eq(collectionRuns.id, run.id)).run();
  const candidates = await listCandidates(run.promptSetId);
  const byId = new Map(candidates.map((candidate) => [candidate.id, candidate]));
  const rows = (await listPromptRuns(run.id)).filter((row) => row.state !== "policy_disabled");

  // Stable order: section, then candidate sequence, then engine, so the
  // script's 20-slot grids map to the same questions on every seed.
  const sectionOrder: Record<string, number> = { Discovery: 0, "Trade Offs": 1, "Sentiment Analysis": 2 };
  rows.sort((a, b) => {
    const ca = byId.get(a.promptCandidateId)!;
    const cb = byId.get(b.promptCandidateId)!;
    return (sectionOrder[ca.section ?? ""] ?? 3) - (sectionOrder[cb.section ?? ""] ?? 3) || ca.sequence - cb.sequence || a.providerExperience.localeCompare(b.providerExperience);
  });
  const slotBySection = new Map<Section, number>();
  let analysed = 0;
  let skipped = 0;
  for (const row of rows) {
    const candidate = byId.get(row.promptCandidateId)!;
    const section = candidate.section as Section;
    const slot = slotBySection.get(section) ?? 0;
    slotBySection.set(section, slot + 1);
    const engine = row.providerExperience.startsWith("gemini") ? "gemini" : "chatgpt";
    const observedAt = new Date(startedAt + slot * 40_000 + (engine === "gemini" ? 15_000 : 0));

    if (script.failed?.some(([s, i]) => s === section && i === slot)) {
      await updatePromptRun(row.id, { state: "failed", attempts: 3, lastError: "target_blocked", attemptHistory: [{ at: observedAt.getTime(), state: "failed", note: "target_blocked" }] });
      skipped += 1;
      continue;
    }

    const table = section === "Discovery" ? DISCOVERY : section === "Trade Offs" ? TRADEOFF : SENTIMENT;
    const keys = section === "Discovery" ? script.discovery : section === "Trade Offs" ? script.tradeOff : script.sentiment;
    const variant = table[keys[slot % keys.length]!]!;
    const rival = (candidate.competitorEntityId && rivalNames.get(candidate.competitorEntityId)) || "Salomon";
    const topic = (candidate.topicId && topicNames.get(candidate.topicId)?.toLowerCase()) || "trail running shoes";
    const text = variant.text({ brand, rival, topic, product: product(brand) });
    const sources = sourcesFor(variant.sources, engine, brandDomain, slot);
    const truncated = script.truncated?.some(([s, i]) => s === section && i === slot) ?? false;
    const responseId = newId("pres");
    const oxylabs = row.providerExperience === "chatgpt_oxylabs_web";
    await insertProviderResponse({
      id: responseId,
      promptRunId: row.id,
      providerExperience: row.providerExperience,
      route: "consumer_app",
      method: "automated_partner",
      visibleModelMode: oxylabs ? "gpt-5-6" : "unknown",
      searchState: sources.searched,
      accountTier: "signed_out",
      locale: "en",
      observerRegion: "IN",
      observerRegionSource: "provider_declared",
      intendedMarket: "IN",
      sessionProfile: { signedIn: false, accountTier: "signed_out", temporaryChat: null, personalizationDisabled: null, customInstructionsDisabled: null },
      responseText: truncated ? text.slice(0, Math.floor(text.length * 0.6)) : text,
      sourceUrls: sources.urls,
      inlineCitationUrls: [],
      answerCaptureState: truncated ? "truncated" : "complete",
      sourcesCaptureState: sources.state,
      rawHash: sha256Hex(text),
      latencyMs: oxylabs ? 43_000 : 70_000,
      observedAt,
      adapterVersion: `${row.providerExperience}-seed@1`,
      parserVersion: null,
      policyVersion: "route-policy@2",
      isFixture: true,
      fixtureLabel: `measure-demo:${label}`,
    });
    await updatePromptRun(row.id, { state: "succeeded", attempts: 1, attemptHistory: [{ at: observedAt.getTime(), state: "succeeded" }] });
    if (script.awaitingAnalysis?.some(([s, i]) => s === section && i === slot)) continue;
    await analyseObservationById(projectId, responseId);
    analysed += 1;
  }
  if (script.finalise) await finaliseCollectionRun(run.id, "auto");
  console.log(`${label}: run ${run.id} — ${analysed} analysed, ${skipped} not collected, ${script.finalise ? "finalised" : "left open"}`);
  return run.id;
}

async function main() {
  const dataDir = process.env.SUN_DATA_DIR ?? "./data";
  if (dataDir === "./data" || dataDir === "data") throw new Error("Refusing to seed the live database; set SUN_DATA_DIR to an isolated directory.");
  await import("./bootstrap-inline").then((m) => m.bootstrapInline());

  const brand = arg("--brand", "TrailStride");
  const market = arg("--market", "IN").toUpperCase();
  const domain = `${brand.toLowerCase().replace(/[^a-z0-9]+/g, "")}.example`;
  const profile = makeProfile({
    brandName: brand,
    archetype: "ecommerce_dtc_retail",
    industry: "trail running shoes",
    offerings: ["trail running shoes", "hiking boots", "trail socks"],
    audiences: ["Beginners", "Regular runners", "Ultra runners"],
    countries: [market === "IN" ? "India" : market],
    cities: [],
    regulated: false,
    domain,
  });
  const project = await createProject({ url: `https://${domain}/`, marketScope: market, language: "en" });
  const db = getDb();
  const now = new Date();
  const profileVersionId = newId("bpv");
  await db.insert(businessProfileVersions).values({ id: profileVersionId, projectId: project.id, version: 1, crawlRunId: null, profile: profile as unknown as Record<string, unknown>, fieldProvenance: {}, confirmedAt: now, confirmedBy: "seed", createdAt: now }).run();
  const topicNames = new Map<string, string>();
  for (const [priority, name] of ["Trail running shoes", "Hiking boots", "Waterproof footwear", "Running accessories", "Outdoor apparel"].entries()) {
    const id = newId("top");
    topicNames.set(id, name);
    await db.insert(topicsTable).values({ id, projectId: project.id, businessProfileVersionId: profileVersionId, name, description: "seeded topic", priority, status: "confirmed", source: "system", evidenceIds: [], createdAt: now }).run();
  }
  await insertTargetEntity(project.id, brand, [domain]);
  const rivals = await insertCompetitorCandidates(project.id, [
    { canonicalName: "Salomon", competitorType: "direct", domains: ["salomon.com"], reason: "seeded rival", confidence: 85, evidenceIds: [] },
    { canonicalName: "Hoka", competitorType: "direct", domains: ["hoka.com"], reason: "seeded rival", confidence: 80, evidenceIds: [] },
  ]);
  const rivalNames = new Map<string, string>();
  for (const rival of rivals) {
    await updateEntity(rival.id, { status: "confirmed" });
    rivalNames.set(rival.id, rival.canonicalName);
  }
  await freezeCompetitiveSet(project.id, profileVersionId);
  const promptSet = await generatePromptSet(project.id);
  if ((await approvePromptSet(promptSet.id, "seed")).status !== "approved") throw new Error("prompt set v1 not approved");

  const run1 = await seedRun(project.id, brand, domain, rivalNames, topicNames, RUNS[0]!, "run1");
  const run2 = await seedRun(project.id, brand, domain, rivalNames, topicNames, RUNS[1]!, "run2");

  // The landscape changes: a third rival is confirmed, the set is re-frozen
  // and a new prompt set is generated and approved. The next run measures a
  // different instrument, so History must show a break, not a trend.
  const [brooks] = await insertCompetitorCandidates(project.id, [{ canonicalName: "Brooks", competitorType: "direct", domains: ["brooksrunning.com"], reason: "seeded rival (added later)", confidence: 75, evidenceIds: [] }]);
  await updateEntity(brooks!.id, { status: "confirmed" });
  rivalNames.set(brooks!.id, "Brooks");
  await freezeCompetitiveSet(project.id, profileVersionId);
  const promptSet2 = await generatePromptSet(project.id, { force: true });
  if ((await approvePromptSet(promptSet2.id, "seed")).status !== "approved") throw new Error("prompt set v2 not approved");
  const run3 = await seedRun(project.id, brand, domain, rivalNames, topicNames, RUNS[2]!, "run3");

  console.log(JSON.stringify({ projectId: project.id, promptSets: [promptSet.id, promptSet2.id], runs: [run1, run2, run3], brand, market }));
  console.log(`open /projects/${project.id}/measure`);
}

main().catch((error) => {
  console.error("FAILED:", error instanceof Error ? error.stack ?? error.message : error);
  process.exit(1);
});
