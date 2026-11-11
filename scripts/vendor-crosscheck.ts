// Cross-checks two collection providers on the same prompts, outside the
// product: the same question through each, then how far the answers agree on
// the brands they name and the domains they cite. Writes nothing to the
// database. This is the fidelity check for a vendor whose output cannot be
// compared with a by-hand reference; a broken or substituted vendor shows up
// as low agreement.
//
//   BRIGHTDATA_API_TOKEN=… CLORO_API_KEY=… npx tsx scripts/vendor-crosscheck.ts \
//     --a chatgpt_brightdata_web --b chatgpt_cloro_web --country AE --prompts prompts.txt [--repeat 1]
//
// prompts.txt: one prompt per line (blank lines ignored). Without --prompts,
// eight generic shopping prompts are used. Cost: prompts × repeat × 2 requests.

import fs from "node:fs";
import { brightDataCollector } from "../src/lib/brightdata/client";
import { cloroCollector } from "../src/lib/cloro/client";
import { decodoCollector } from "../src/lib/decodo/client";
import { oxylabsCollector } from "../src/lib/oxylabs/client";
import { markersPass, type ConsumerAnswer, type ConsumerCollector } from "../src/lib/collection/consumer-collector";
import { consumerWebRoute } from "../src/lib/providers/catalog";

const COLLECTORS: Record<string, ConsumerCollector> = { cloro: cloroCollector, brightdata: brightDataCollector, oxylabs: oxylabsCollector, decodo: decodoCollector };

const DEFAULT_PROMPTS = [
  "What are the best trail running shoes for beginners?",
  "Which running shoe brands are known for wide feet?",
  "Best budget noise-cancelling headphones this year",
  "Which project management tools are best for a small remote team?",
  "What are good places to buy specialty coffee beans online?",
  "Which electric toothbrush brands do dentists recommend?",
  "Best laptops for video editing under $1500",
  "Which meal kit delivery services are worth it?",
];

function arg(name: string): string | null {
  const index = process.argv.indexOf(name);
  return index >= 0 ? (process.argv[index + 1] ?? null) : null;
}

/** Capitalised words and word pairs that look like brand names. Rough on purpose: the same rule runs on both sides. */
function brandTokens(text: string): Set<string> {
  const stop = new Set(["The", "For", "If", "In", "On", "A", "An", "And", "Or", "But", "It", "They", "You", "Your", "Best", "Top", "Here", "These", "This", "That", "When", "What", "Which", "Also", "Most", "Some", "Many", "Both", "Check", "Consider", "Note", "Overall", "Pros", "Cons", "Why", "How", "Price", "Budget", "Good", "Great"]);
  const out = new Set<string>();
  for (const match of text.matchAll(/\b([A-Z][A-Za-z0-9'&-]{2,}(?:\s[A-Z][A-Za-z0-9'&-]{1,})?)\b/g)) {
    const token = match[1]!.trim();
    const first = token.split(" ")[0]!;
    if (stop.has(first) || stop.has(token)) continue;
    out.add(token.toLowerCase());
  }
  return out;
}

function domains(answer: ConsumerAnswer): Set<string> {
  const out = new Set<string>();
  for (const source of answer.sources) {
    try {
      out.add(new URL(source.url).hostname.replace(/^www\./, ""));
    } catch {
      // skip
    }
  }
  return out;
}

function jaccard(a: Set<string>, b: Set<string>): number {
  if (a.size === 0 && b.size === 0) return 1;
  const intersection = [...a].filter((item) => b.has(item)).length;
  const union = new Set([...a, ...b]).size;
  return union === 0 ? 0 : intersection / union;
}

async function main() {
  const routeA = arg("--a") ?? "chatgpt_brightdata_web";
  const routeB = arg("--b") ?? "chatgpt_cloro_web";
  const country = (arg("--country") ?? "US").toUpperCase();
  const repeat = Math.max(1, Number(arg("--repeat") ?? 1));
  const file = arg("--prompts");
  const prompts = file ? fs.readFileSync(file, "utf8").split("\n").map((line) => line.trim()).filter(Boolean) : DEFAULT_PROMPTS;
  const a = consumerWebRoute(routeA);
  const b = consumerWebRoute(routeB);
  if (!a || !b) throw new Error(`unknown route: ${!a ? routeA : routeB}`);
  if (a.engine !== b.engine) throw new Error("both routes must observe the same engine");
  const collectorA = COLLECTORS[a.vendor]!;
  const collectorB = COLLECTORS[b.vendor]!;
  if (!collectorA.isAvailable() || !collectorB.isAvailable()) throw new Error("both vendor keys must be present in the environment");

  console.log(`${routeA} vs ${routeB}  country=${country}  prompts=${prompts.length}  repeat=${repeat}\n`);
  const brandScores: number[] = [];
  const domainScores: number[] = [];
  let unverified = 0;
  let failures = 0;
  for (const prompt of prompts) {
    for (let i = 0; i < repeat; i += 1) {
      const [ra, rb] = await Promise.all([collectorA.collect({ engine: a.engine, prompt, country, locale: "en" }), collectorB.collect({ engine: b.engine, prompt, country, locale: "en" })]);
      if (!ra.ok || !rb.ok) {
        failures += 1;
        console.log(`✗ ${prompt.slice(0, 60)}  a=${ra.ok ? "ok" : ra.error}  b=${rb.ok ? "ok" : rb.error}`);
        continue;
      }
      if (!markersPass(ra.markers) || !markersPass(rb.markers)) unverified += 1;
      const brands = jaccard(brandTokens(ra.text), brandTokens(rb.text));
      const cited = jaccard(domains(ra), domains(rb));
      brandScores.push(brands);
      domainScores.push(cited);
      console.log(`${brands >= 0.5 ? "✓" : "~"} ${prompt.slice(0, 60).padEnd(60)} brands=${brands.toFixed(2)} domains=${cited.toFixed(2)} searched=${ra.searched ?? "?"}/${rb.searched ?? "?"} model=${ra.model ?? "?"}/${rb.model ?? "?"} credits=${ra.credits.charged ?? "?"}/${rb.credits.charged ?? "?"}`);
    }
  }
  const median = (values: number[]) => (values.length ? [...values].sort((x, y) => x - y)[Math.floor(values.length / 2)]! : NaN);
  console.log(`\nmedian brand-set agreement ${median(brandScores).toFixed(2)}  median cited-domain agreement ${median(domainScores).toFixed(2)}  unverified answers ${unverified}  failed pairs ${failures}`);
  console.log(median(brandScores) >= 0.5 && unverified === 0 ? "RESULT: vendors agree" : "RESULT: vendors disagree or an answer was unverified — inspect before trusting either");
}

main().catch((error) => {
  console.error("FAILED:", error instanceof Error ? error.message : error);
  process.exit(1);
});
