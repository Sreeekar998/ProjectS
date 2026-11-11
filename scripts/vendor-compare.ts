// Head-to-head comparison of the collection providers on the same prompts,
// outside the product. Each prompt goes to every keyed ChatGPT route (and,
// with --gemini, to the Gemini route); every raw payload is written to --out
// so the comparison can be re-read later without spending again.
//
//   BRIGHTDATA_API_TOKEN=… CLORO_API_KEY=… DECODO_AUTH_TOKEN=… \
//     npx tsx scripts/vendor-compare.ts --prompts prompts.txt --country IN --out ./tmp/compare [--routes a,b] [--gemini]
//
// Cost: one request per prompt per route (Bright Data 1 record, Decodo 1
// request, cloro 7 credits; Gemini via cloro 6). Prints per-route figures
// (success, latency, model, search, citations, answer length, surface
// markers) and pairwise agreement on brands named and domains cited.

import fs from "node:fs";
import path from "node:path";
import { brightDataCollector } from "../src/lib/brightdata/client";
import { cloroCollector } from "../src/lib/cloro/client";
import { decodoCollector } from "../src/lib/decodo/client";
import { oxylabsCollector } from "../src/lib/oxylabs/client";
import { markersPass, type ConsumerAnswer, type ConsumerCollector, type ConsumerResult } from "../src/lib/collection/consumer-collector";
import { CONSUMER_WEB_ROUTES, consumerWebRoute } from "../src/lib/providers/catalog";

const COLLECTORS: Record<string, ConsumerCollector> = { cloro: cloroCollector, brightdata: brightDataCollector, oxylabs: oxylabsCollector, decodo: decodoCollector };

function arg(name: string): string | null {
  const index = process.argv.indexOf(name);
  return index >= 0 ? (process.argv[index + 1] ?? null) : null;
}
const flag = (name: string) => process.argv.includes(name);

const STOP = new Set(["The", "For", "If", "In", "On", "A", "An", "And", "Or", "But", "It", "They", "You", "Your", "Best", "Top", "Here", "These", "This", "That", "When", "What", "Which", "Also", "Most", "Some", "Many", "Both", "Check", "Consider", "Note", "Overall", "Pros", "Cons", "Why", "How", "Price", "Budget", "Good", "Great", "Under", "Key", "Tips", "Quick", "Look", "Buy", "Options", "Option", "Where", "Since", "While", "Just", "Yes", "No", "Sure", "Try"]);

/** Capitalised words and word pairs that look like brand names. Rough on purpose: the same rule runs on every side. */
function brandTokens(text: string): Set<string> {
  const out = new Set<string>();
  for (const match of text.matchAll(/\b([A-Z][A-Za-z0-9'&-]{2,}(?:\s[A-Z][A-Za-z0-9'&-]{1,})?)\b/g)) {
    const token = match[1]!.trim();
    const first = token.split(" ")[0]!;
    if (STOP.has(first) || STOP.has(token)) continue;
    out.add(token.toLowerCase());
  }
  return out;
}

function domains(answer: ConsumerAnswer): Set<string> {
  const out = new Set<string>();
  for (const source of answer.sources) {
    if (source.kind === "inline_link") continue;
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

const median = (values: number[]) => (values.length ? [...values].sort((x, y) => x - y)[Math.floor(values.length / 2)]! : NaN);
const mean = (values: number[]) => (values.length ? values.reduce((s, v) => s + v, 0) / values.length : NaN);

interface Row {
  route: string;
  prompt: string;
  result: ConsumerResult;
  file: string;
}

async function main() {
  const country = (arg("--country") ?? "US").toUpperCase();
  const out = arg("--out") ?? "./tmp/vendor-compare";
  const file = arg("--prompts");
  if (!file) throw new Error("--prompts <file> is required (one prompt per line)");
  const prompts = fs.readFileSync(file, "utf8").split("\n").map((line) => line.trim()).filter(Boolean);
  const requested = arg("--routes")?.split(",").map((s) => s.trim()).filter(Boolean);
  const routes = CONSUMER_WEB_ROUTES.filter((route) => (requested ? requested.includes(route.id) : route.engine === "chatgpt" || flag("--gemini"))).filter((route) => COLLECTORS[route.vendor]!.isAvailable());
  if (routes.length === 0) throw new Error("no keyed routes to compare");
  fs.mkdirSync(out, { recursive: true });
  console.log(`routes: ${routes.map((r) => r.id).join(", ")}  country=${country}  prompts=${prompts.length}  out=${out}\n`);

  const rows: Row[] = [];
  // Every route runs alongside the others. Within a route, prompts run with
  // the vendor's own concurrency: Bright Data snapshots take minutes each and
  // the account allows many at once; cloro's gate is in its client; Decodo
  // is polite at two.
  const CONCURRENCY: Record<string, number> = { brightdata: 6, cloro: Number(process.env.SUN_CLORO_CONCURRENCY ?? 1), oxylabs: 3, decodo: 2 };
  await Promise.all(
    routes.map(async (route) => {
      const collector = COLLECTORS[route.vendor]!;
      const queue = prompts.map((prompt, index) => ({ prompt, index }));
      const worker = async () => {
        for (;;) {
          const item = queue.shift();
          if (!item) return;
          const { prompt, index } = item;
          const started = Date.now();
          const result = await collector.collect({ engine: route.engine, prompt, country, locale: "en" });
          const filePath = path.join(out, `${String(index + 1).padStart(2, "0")}-${route.id}.json`);
          fs.writeFileSync(filePath, JSON.stringify({ route: route.id, prompt, country, startedAt: new Date(started).toISOString(), result: result.ok ? { ...result, html: result.html ? `<${result.html.length} bytes, stored separately>` : null } : result }, null, 2));
          if (result.ok && result.html) fs.writeFileSync(filePath.replace(/\.json$/, ".html"), result.html);
          rows.push({ route: route.id, prompt, result, file: filePath });
          const tag = result.ok ? `ok ${Math.round(result.latencyMs / 1000)}s model=${result.model ?? "?"} searched=${result.searched ?? "?"} citations=${result.sources.filter((s) => s.kind === "citation").length} len=${result.text.length}${markersPass(result.markers) ? "" : " UNVERIFIED"}` : `FAIL ${result.error}${result.detail ? ` (${result.detail.slice(0, 80)})` : ""} ${Math.round(result.latencyMs / 1000)}s`;
          console.log(`[${route.id}] ${index + 1}/${prompts.length} ${tag}`);
        }
      };
      await Promise.all(Array.from({ length: Math.min(CONCURRENCY[route.vendor] ?? 1, prompts.length) }, () => worker()));
    }),
  );

  console.log("\n=== per route ===");
  for (const route of routes) {
    const own = rows.filter((row) => row.route === route.id);
    const ok = own.filter((row): row is Row & { result: ConsumerAnswer } => row.result.ok);
    const latencies = own.map((row) => row.result.latencyMs / 1000);
    const cites = ok.map((row) => row.result.sources.filter((s) => s.kind === "citation").length);
    const models = new Set(ok.map((row) => row.result.model ?? "unknown"));
    const searched = ok.filter((row) => row.result.searched === true).length;
    const verified = ok.filter((row) => markersPass(row.result.markers)).length;
    const credits = ok.map((row) => row.result.credits.charged ?? 0).reduce((s, v) => s + v, 0);
    const brands = ok.map((row) => brandTokens(row.result.text).size);
    console.log(
      `${route.id.padEnd(24)} success ${ok.length}/${own.length}  latency median ${median(latencies).toFixed(0)}s (max ${Math.max(...latencies).toFixed(0)}s)  model ${[...models].join("|")}  searched ${searched}/${ok.length}  citations mean ${mean(cites).toFixed(1)}  brands/answer mean ${mean(brands).toFixed(1)}  answer chars mean ${mean(ok.map((r) => r.result.text.length)).toFixed(0)}  verified ${verified}/${ok.length}  credits ${credits}`,
    );
    for (const row of own.filter((r) => !r.result.ok)) console.log(`   failed: "${row.prompt.slice(0, 50)}" → ${row.result.ok ? "" : `${row.result.error} ${row.result.detail ?? ""}`}`);
  }

  console.log("\n=== pairwise agreement (Jaccard, per prompt, median) ===");
  for (let i = 0; i < routes.length; i += 1) {
    for (let j = i + 1; j < routes.length; j += 1) {
      const a = routes[i]!.id;
      const b = routes[j]!.id;
      const brandScores: number[] = [];
      const domainScores: number[] = [];
      for (const prompt of prompts) {
        const ra = rows.find((row) => row.route === a && row.prompt === prompt)?.result;
        const rb = rows.find((row) => row.route === b && row.prompt === prompt)?.result;
        if (!ra?.ok || !rb?.ok) continue;
        brandScores.push(jaccard(brandTokens(ra.text), brandTokens(rb.text)));
        domainScores.push(jaccard(domains(ra), domains(rb)));
      }
      console.log(`${a} vs ${b}: brands ${median(brandScores).toFixed(2)}  cited domains ${median(domainScores).toFixed(2)}  (${brandScores.length} prompts compared)`);
    }
  }

  console.log("\n=== brands named per prompt ===");
  for (const prompt of prompts) {
    console.log(`\n"${prompt.slice(0, 90)}"`);
    for (const route of routes) {
      const r = rows.find((row) => row.route === route.id && row.prompt === prompt)?.result;
      console.log(`  ${route.id.padEnd(24)} ${r?.ok ? [...brandTokens(r.text)].slice(0, 12).join(", ") : `— ${r && !r.ok ? r.error : ""}`}`);
    }
  }
  fs.writeFileSync(path.join(out, "summary.json"), JSON.stringify(rows.map((row) => ({ route: row.route, prompt: row.prompt, ok: row.result.ok, error: row.result.ok ? null : row.result.error, latencyMs: row.result.latencyMs, model: row.result.ok ? row.result.model : null, searched: row.result.ok ? row.result.searched : null, citations: row.result.ok ? row.result.sources.filter((s) => s.kind === "citation").length : null, brands: row.result.ok ? [...brandTokens(row.result.text)] : null, domains: row.result.ok ? [...domains(row.result)] : null, verified: row.result.ok ? markersPass(row.result.markers) : null, credits: row.result.ok ? row.result.credits : null, file: row.file })), null, 2));
  console.log(`\nraw payloads and summary.json written to ${out}`);
}

main().catch((error) => {
  console.error("FAILED:", error instanceof Error ? error.message : error);
  process.exit(1);
});
