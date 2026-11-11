// Asks each connected collection provider one brand-neutral question and
// prints what came back: whether the surface markers held, the model the page
// named, whether search ran, how many sources it showed, the credits charged
// and left, and latency. Writes nothing to the database.
//
//   BRIGHTDATA_API_TOKEN=… CLORO_API_KEY=… DECODO_AUTH_TOKEN=… npx tsx scripts/vendor-canary.ts [--country AE] [--route chatgpt_cloro_web]
//
// Costs one request per connected route (Bright Data 1 record, cloro 7
// credits, Decodo 1 request). Use it after connecting a key and before a demo.

import { CANARY_PROMPT } from "../src/lib/collection/consumer-collector";
import { COLLECTION_ROUTES } from "../src/lib/providers/route-policy-seed";
import { routeCredentialPresent, runVendorCanary } from "../src/lib/collection/orchestrator";

function arg(name: string): string | null {
  const index = process.argv.indexOf(name);
  return index >= 0 ? (process.argv[index + 1] ?? null) : null;
}

async function main() {
  const country = (arg("--country") ?? "US").toUpperCase();
  const only = arg("--route");
  const routes = COLLECTION_ROUTES.filter((route) => (only ? route === only : true));
  console.log(`canary prompt: "${CANARY_PROMPT}"  country: ${country}\n`);
  let failures = 0;
  for (const route of routes) {
    if (!routeCredentialPresent(route)) {
      console.log(`${route.padEnd(24)} skipped: no key in the environment`);
      continue;
    }
    const started = Date.now();
    const outcome = await runVendorCanary(route, country);
    const markers = outcome.markers ? Object.entries(outcome.markers).filter(([, v]) => v).map(([k]) => k).join(",") : "-";
    console.log(
      `${route.padEnd(24)} ${outcome.ok ? "PASS" : "FAIL"}  ${outcome.reason ?? ""}${outcome.detail ? ` (${outcome.detail.slice(0, 160)})` : ""}  model=${outcome.model ?? "unknown"} searched=${outcome.searched ?? "unknown"} citations=${outcome.citations} markers=[${markers}] credits=${outcome.credits ? `${outcome.credits.charged ?? "?"} charged / ${outcome.credits.remaining ?? "?"} left` : "n/a"} ${Math.round((Date.now() - started) / 1000)}s`,
    );
    if (!outcome.ok) failures += 1;
  }
  process.exit(failures > 0 ? 1 : 0);
}

main().catch((error) => {
  console.error("FAILED:", error instanceof Error ? error.message : error);
  process.exit(1);
});
