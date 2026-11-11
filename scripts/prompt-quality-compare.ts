// Compares the SHAPE of a prompt set against a reference corpus.
//
// These are not quality scores — no regex can judge whether a question is
// good — but they measure the specific failure modes seen in generated
// prompt sets: category labels in templates, no concrete context, one
// repeated opening, "brands" fixation. Reference prompts are read from a local
// file passed on the command line and are never written into the repository.
//
//   npx tsx scripts/prompt-quality-compare.ts <projectId> [referenceFile.md]
import fs from "node:fs";
import { getDb } from "@/lib/db/client";
import { promptCandidates, promptSets } from "@/lib/db/schema";
import { desc, eq } from "drizzle-orm";

const CONTEXT = /\b(for (my|a|an|the|someone|people|beginners|kids|women|men|daily|long|regular|weekend|casual|first|wide|flat|hot|heavy|intense)|with (good|a|an|quick|fast|strong)|under\s*[₹$€£¥]?\s*\d|if i|when i|my |i'm|i am|i've|in (india|the us|the uk|[A-Z][a-z]+))/i;
const GENERIC = /\b(recommend the best .{0,25}brands|(some )?popular .{0,25}(options|brands)|list (some )?popular|what are the best [a-z &]{3,25}\?$|for (free|fast) (shipping|delivery)|brands for (quality|value)|options available)\b/i;
const FIRST_PERSON = /\b(i|i'm|i've|me|my)\b/i;

function shape(prompts: string[]) {
  const n = prompts.length || 1;
  const openings = new Set(prompts.map((p) => p.toLowerCase().split(/\s+/).slice(0, 2).join(" ")));
  const words = prompts.map((p) => p.split(/\s+/).filter(Boolean).length);
  const register = (p: string) => (/\?\s*$/.test(p) ? "question" : /^(recommend|suggest|find|show|help|give|tell|list|can you|need|looking|searching|i )/i.test(p) ? "request/need" : "keyword/statement");
  const mix: Record<string, number> = {};
  for (const p of prompts) mix[register(p)] = (mix[register(p)] ?? 0) + 1;
  const pct = (count: number) => `${Math.round((count / n) * 100)}%`;
  return {
    count: prompts.length,
    meanWords: (words.reduce((a, b) => a + b, 0) / n).toFixed(1),
    concreteContext: pct(prompts.filter((p) => CONTEXT.test(p)).length),
    firstPerson: pct(prompts.filter((p) => FIRST_PERSON.test(p)).length),
    genericTemplate: pct(prompts.filter((p) => GENERIC.test(p)).length),
    mentionsBrandsWord: pct(prompts.filter((p) => /\bbrands?\b/i.test(p)).length),
    distinctOpenings: pct(openings.size),
    registerMix: Object.entries(mix).map(([k, v]) => `${k} ${pct(v)}`).join(", "),
  };
}

async function main() {
  const [projectId, referenceFile] = process.argv.slice(2);
  if (!projectId) throw new Error("usage: prompt-quality-compare.ts <projectId> [referenceFile.md]");
  const db = getDb();
  const set = await db.select().from(promptSets).where(eq(promptSets.projectId, projectId)).orderBy(desc(promptSets.createdAt)).get();
  if (!set) throw new Error("no prompt set");
  const rows = await db.select().from(promptCandidates).where(eq(promptCandidates.promptSetId, set.id)).all();
  const selected = rows.filter((row) => ["SELECTED", "USER_APPROVED"].includes(row.lifecycleState));
  const bySection = (section: string) => selected.filter((row) => row.section === section).map((row) => row.editedText ?? row.text);
  const table: Record<string, unknown> = {
    "Sun · Discovery": shape(bySection("Discovery")),
    "Sun · Trade Offs": shape(bySection("Trade Offs")),
    "Sun · Sentiment": shape(bySection("Sentiment Analysis")),
  };
  if (referenceFile && fs.existsSync(referenceFile)) {
    const text = fs.readFileSync(referenceFile, "utf8");
    // Reference prompts: bullet lines inside the first corpus section only.
    const section = text.split(/\n## /)[1] ?? text;
    const reference = section.split("\n").filter((line) => line.startsWith("- ")).map((line) => line.slice(2).trim());
    table["Reference · Discovery"] = shape(reference);
  }
  console.table(table);
  const sources = selected.reduce<Record<string, number>>((acc, row) => ((acc[row.generationSource ?? "?"] = (acc[row.generationSource ?? "?"] ?? 0) + 1), acc), {});
  console.log("selected by generation source:", JSON.stringify(sources));
}
main().catch((error) => { console.error(error); process.exit(1); });
