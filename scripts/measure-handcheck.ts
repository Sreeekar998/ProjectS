// Recomputes a run's headline figures straight from the stored analysis rows
// with plain loops and SQL, independently of the Measure engine, and prints
// both side by side. A disagreement is a bug in one of the two.
//
//   SUN_DATA_DIR=./data/verify-measure npx tsx scripts/measure-handcheck.ts <projectId> [collectionRunId]

import { and, desc, eq, inArray } from "drizzle-orm";
import { getDb } from "../src/lib/db/client";
import { collectionRuns, competitiveSetVersions, entities, observationAnalyses, promptCandidates, promptRuns, promptSets, providerResponses, type FrozenCompetitorSnapshot } from "../src/lib/db/schema";
import { measureRun } from "../src/lib/measure/service";
import type { NormalizedObservation } from "../src/lib/analysis/types";

async function main() {
  const projectId = process.argv[2];
  if (!projectId) throw new Error("usage: measure-handcheck.ts <projectId> [collectionRunId]");
  const db = getDb();
  const run = process.argv[3]
    ? await db.select().from(collectionRuns).where(eq(collectionRuns.id, process.argv[3])).get()
    : await db.select().from(collectionRuns).where(eq(collectionRuns.projectId, projectId)).orderBy(desc(collectionRuns.createdAt)).get();
  if (!run) throw new Error("no run");
  const promptSet = (await db.select().from(promptSets).where(eq(promptSets.id, run.promptSetId)).get())!;
  const frozen = (await db.select().from(competitiveSetVersions).where(eq(competitiveSetVersions.id, promptSet.competitiveSetVersionId!)).get())!;
  const competitorIds = new Set((frozen.competitorSnapshot as FrozenCompetitorSnapshot[]).map((c) => c.entityId));
  const target = (await db.select().from(entities).where(and(eq(entities.projectId, projectId), eq(entities.kind, "target"))).get())!;
  const candidates = await db.select().from(promptCandidates).where(eq(promptCandidates.promptSetId, run.promptSetId)).all();
  const sectionOf = new Map(candidates.map((c) => [c.id, c.section]));
  const rows = (await db.select().from(promptRuns).where(eq(promptRuns.collectionRunId, run.id)).all()).filter((r) => r.state !== "policy_disabled");
  const responses = await db.select().from(providerResponses).where(inArray(providerResponses.promptRunId, rows.map((r) => r.id))).all();
  const analyses = await db.select().from(observationAnalyses).where(inArray(observationAnalyses.providerResponseId, responses.map((r) => r.id))).all();
  const byResponse = new Map<string, NormalizedObservation>();
  for (const row of analyses) {
    const existing = byResponse.get(row.providerResponseId);
    if (!existing || row.analysisVersion > existing.analysisVersion) byResponse.set(row.providerResponseId, row.payload as unknown as NormalizedObservation);
  }

  // --- hand computation -----------------------------------------------------
  const strong = (o: NormalizedObservation["occurrences"][number]) => o.entityId && (o.confidence === "exact" || o.confidence === "strong");
  const present = (a: NormalizedObservation) => new Set(a.occurrences.filter(strong).map((o) => o.entityId!));
  const eligible = [...byResponse.values()].filter((a) => a.eligibility === "ELIGIBLE");
  const discovery = eligible.filter((a) => sectionOf.get(a.promptCandidateId) === "Discovery");
  const tradeOffs = eligible.filter((a) => sectionOf.get(a.promptCandidateId) === "Trade Offs");
  const sentiment = eligible.filter((a) => sectionOf.get(a.promptCandidateId) === "Sentiment Analysis");

  const named = discovery.filter((a) => present(a).has(target.id)).length;
  let targetEvents = 0;
  let trackedEvents = 0;
  for (const a of discovery) for (const id of present(a)) { if (id === target.id) { targetEvents++; trackedEvents++; } else if (competitorIds.has(id)) trackedEvents++; }
  const rankable = discovery.filter((a) => ["explicit_ordered_list", "ordered_prose"].includes(a.rankEligibility));
  const first = rankable.filter((a) => a.positions.some((p) => p.entityId === target.id && p.explicitRank === 1)).length;
  // measure-policy@4: no business at all, tracked or untracked.
  const brandFree = discovery.filter((a) => ![...present(a)].some((id) => id === target.id || competitorIds.has(id)) && a.emergingCandidates.length === 0).length;
  // Share of every business named, with untracked names keyed independently of the engine.
  const key = (name: string) => name.toLowerCase().replace(/['’]/g, "").replace(/\s+&\s+/g, " and ").replace(/[^a-z0-9&]+/g, " ").trim();
  let allEvents = 0;
  for (const a of discovery) {
    const tracked = [...present(a)].filter((id) => id === target.id || competitorIds.has(id)).length;
    allEvents += tracked + new Set(a.emergingCandidates.map((candidate) => key(candidate.name))).size;
  }

  let wins = 0, losses = 0, ties = 0, unclear = 0, none = 0;
  for (const a of tradeOffs) {
    const relevant = a.comparisons.filter((c) => c.subjectEntityId === target.id || c.objectEntityId === target.id);
    if (relevant.length === 0) { none++; continue; }
    const verdicts = new Set(relevant.map((c) => c.preference === "TIE" ? "TIE" : c.preference === "UNCLEAR" || c.preference === "NEITHER" ? "UNCLEAR" : ((c.preference === "SUBJECT") === (c.subjectEntityId === target.id)) ? "WIN" : "LOSS"));
    if (verdicts.has("WIN") && verdicts.has("LOSS")) ties++;
    else if (verdicts.has("WIN")) wins++;
    else if (verdicts.has("LOSS")) losses++;
    else if (verdicts.has("TIE")) ties++;
    else unclear++;
  }
  const portrayal: Record<string, number> = {};
  for (const a of sentiment) { const p = a.sentiment.find((s) => s.entityId === target.id)?.overallPortrayal ?? "NO_SENTIMENT"; portrayal[p] = (portrayal[p] ?? 0) + 1; }

  const trustworthy = eligible.filter((a) => a.sourceCaptureState === "complete" || a.sourceCaptureState === "none_present");
  const ownedCited = trustworthy.filter((a) => a.citations.some((c) => c.ownership === "TARGET_OWNED")).length;
  const sourced = trustworthy.filter((a) => a.citations.length > 0).length;
  let ownedUrls = 0, trackedUrls = 0;
  for (const a of trustworthy) for (const c of a.citations) { if (c.ownership === "TARGET_OWNED") { ownedUrls++; trackedUrls++; } else if (c.ownership === "COMPETITOR_OWNED") trackedUrls++; }
  const notCollected = rows.filter((r) => !responses.some((x) => x.promptRunId === r.id)).length;
  const awaiting = responses.filter((x) => !byResponse.has(x.id)).length;
  const review = [...byResponse.values()].filter((a) => a.eligibility === "NEEDS_REVIEW").length;

  // --- engine ---------------------------------------------------------------
  const m = await measureRun(projectId, run.id);
  const c = m.metrics.combined!;
  const table: Array<[string, string, string]> = [
    ["planned / collected / analysable", `${rows.length} / ${responses.length} / ${eligible.length}`, `${m.coverage.planned} / ${m.coverage.captured} / ${m.coverage.analysable}`],
    ["not collected / awaiting / needs a look", `${notCollected} / ${awaiting} / ${review}`, `${m.coverage.notCollected} / ${m.coverage.awaitingAnalysis} / ${m.coverage.needsReview}`],
    ["discovery visibility", `${named} / ${discovery.length}`, `${c.discovery_visibility!.numerator} / ${c.discovery_visibility!.denominator}`],
    ["share of voice (events)", `${targetEvents} / ${trackedEvents}`, `${c.discovery_share_of_voice!.numerator} / ${c.discovery_share_of_voice!.denominator}`],
    ["first choice", `${first} / ${rankable.length}`, `${c.first_choice_rate!.numerator} / ${c.first_choice_rate!.denominator}`],
    ["share of every business (events)", `${targetEvents} / ${allEvents}`, `${c.discovery_share_all_names!.numerator} / ${c.discovery_share_all_names!.denominator}`],
    ["no business named", `${brandFree} / ${discovery.length}`, `${c.answer_brand_free_rate!.numerator} / ${c.answer_brand_free_rate!.denominator}`],
    ["trade-offs W / L / tie / unclear / none", `${wins} / ${losses} / ${ties} / ${unclear} / ${none}`, `${m.tradeOffs.combined!.outcomes.TARGET_PREFERRED} / ${m.tradeOffs.combined!.outcomes.COMPETITOR_PREFERRED} / ${m.tradeOffs.combined!.outcomes.TIE} / ${m.tradeOffs.combined!.outcomes.UNCLEAR} / ${m.tradeOffs.combined!.outcomes.NO_COMPARISON}`],
    ["decisiveness", `${wins + losses} / ${wins + losses + ties + unclear}`, `${c.tradeoff_decisiveness!.numerator} / ${c.tradeoff_decisiveness!.denominator}`],
    ["win rate", `${wins} / ${wins + losses}`, `${c.tradeoff_target_win_rate!.numerator} / ${c.tradeoff_target_win_rate!.denominator}`],
    ["portrayal", JSON.stringify(Object.fromEntries(Object.entries(portrayal).sort())), JSON.stringify(Object.fromEntries(Object.entries(m.sentiment.combined!.distribution).filter(([, v]) => v > 0).sort()))],
    ["owned citation rate", `${ownedCited} / ${trustworthy.length}`, `${c.owned_citation_rate!.numerator} / ${c.owned_citation_rate!.denominator}`],
    ["owned rate when sourced", `${ownedCited} / ${sourced}`, `${c.owned_citation_rate_when_sourced!.numerator} / ${c.owned_citation_rate_when_sourced!.denominator}`],
    ["citation share (urls)", `${ownedUrls} / ${trackedUrls}`, `${c.citation_share!.numerator} / ${c.citation_share!.denominator}`],
  ];
  let mismatches = 0;
  console.log(`run ${run.id} · prompt set v${promptSet.version} · competitive set v${frozen.version} (${competitorIds.size} rivals)`);
  console.log("metric".padEnd(42), "by hand".padEnd(34), "engine");
  for (const [label, hand, engine] of table) {
    const ok = hand === engine;
    if (!ok) mismatches++;
    console.log((ok ? "  " : "!!") + label.padEnd(40), hand.padEnd(34), engine);
  }
  console.log(mismatches === 0 ? "ALL AGREE" : `${mismatches} MISMATCH(ES)`);
  process.exit(mismatches === 0 ? 0 : 1);
}
main().catch((error) => { console.error(error); process.exit(1); });
