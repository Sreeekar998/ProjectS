// Drives the whole product through its real HTTP API: create -> crawl ->
// understand -> landscape -> prompts -> observe -> analyse -> measure.
// Prints the actual output of every stage so it can be judged, not just
// asserted on.
const BASE = process.env.SUN_BASE ?? "http://localhost:3000";

async function api<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(`${BASE}${path}`, {
    ...init,
    headers: { "content-type": "application/json", ...(init?.headers ?? {}) },
  });
  const text = await res.text();
  if (!res.ok) throw new Error(`${init?.method ?? "GET"} ${path} -> ${res.status} ${text.slice(0, 400)}`);
  return text ? (JSON.parse(text) as T) : ({} as T);
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

async function waitFor<T>(label: string, fn: () => Promise<T | null>, timeoutMs = 240_000): Promise<T> {
  const deadline = Date.now() + timeoutMs;
  let lastError = "";
  while (Date.now() < deadline) {
    try {
      const value = await fn();
      if (value) return value;
    } catch (error) {
      lastError = error instanceof Error ? error.message : String(error);
    }
    await sleep(2500);
  }
  throw new Error(`timed out waiting for ${label}. last: ${lastError}`);
}

function heading(text: string) {
  console.log(`\n${"=".repeat(78)}\n${text}\n${"=".repeat(78)}`);
}

/**
 * `<url> [legacyMarket] [--country AE] [--area "DIFC, Dubai"] [--worldwide]`.
 * `--country` sends the intake "Where are your customers?" hint; `--area` is
 * sent as typed-but-unresolved text (`place: null`), which Understand geocodes,
 * so the script needs no place search. Without flags the legacy positional
 * market ("global" → no hint, "US" → a US hint) is sent as before.
 */
function parseArgs(argv: string[]) {
  const positional: string[] = [];
  const flags: Record<string, string | true> = {};
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i] ?? "";
    if (!arg.startsWith("--")) {
      positional.push(arg);
      continue;
    }
    const name = arg.slice(2);
    const next = argv[i + 1];
    if (name === "worldwide") flags.worldwide = true;
    else if (next !== undefined && !next.startsWith("--")) {
      flags[name] = next;
      i++;
    } else throw new Error(`--${name} needs a value`);
  }
  return { positional, flags };
}

async function main() {
  const { positional, flags } = parseArgs(process.argv.slice(2));
  const url = positional[0] ?? "https://www.nike.com/";
  const legacyMarket = positional[1] ?? "global";
  const country = typeof flags.country === "string" ? flags.country.trim().toUpperCase() : null;
  const area = typeof flags.area === "string" ? flags.area.trim() : null;
  if (area && !country) throw new Error("--area needs --country (an area belongs to exactly one country)");
  if (flags.worldwide && (country || area)) throw new Error("--worldwide cannot be combined with --country or --area");
  const market = flags.worldwide
    ? { countryCodes: [], worldwide: true, area: null }
    : country
      ? { countryCodes: [country], worldwide: false, area: area ? { query: area, place: null } : null }
      : undefined;

  heading(`STAGE 0 — create project for ${url}`);
  const { project } = await api<{ project: { id: string; market: unknown } }>("/api/projects", {
    method: "POST",
    body: JSON.stringify(market ? { url, market, language: "en" } : { url, marketScope: legacyMarket, language: "en" }),
  });
  console.log(`project ${project.id}`);
  console.log(`market hint:  ${project.market ? JSON.stringify(project.market) : "none (detect from the website)"}`);

  heading("STAGE 1 — CRAWL + UNDERSTAND");
  await api(`/api/projects/${project.id}/crawl`, { method: "POST" });
  const profileVersion = await waitFor("business profile", async () => {
    const res = await api<{ profileVersion: { status: string; profile: Record<string, unknown> } }>(`/api/projects/${project.id}/profile`);
    return res.profileVersion?.status === "complete" ? res.profileVersion : null;
  });
  const p = profileVersion.profile as any;
  console.log(`brand:        ${p.identity?.brandName?.value}`);
  console.log(`description:  ${p.description?.value}`);
  console.log(`industry:     ${p.industry?.value}  (archetype ${p.archetype?.value}, conf ${p.archetype?.confidence})`);
  console.log(`offerings:    ${(p.offerings?.items ?? []).map((o: any) => `${o.name} [${o.type}]`).join(" | ")}`);
  console.log(`markets:      ${(p.markets ?? []).map((m: any) => m.name).join(", ")}`);
  if (p.location) {
    const hint = p.location.operatorHint;
    console.log(`location:     ${p.location.primary?.label ?? "-"}  (scope ${p.marketScope?.value}, needsConfirmation ${p.location.needsConfirmation})${hint ? `  hint "${hint.label}" → ${hint.outcome}` : ""}`);
  }
  console.log(`confidence:   ${p.quality?.overallConfidence}  (${p.quality?.pagesAnalyzed} pages, ${p.quality?.evidenceItemCount} evidence items, mode ${p.quality?.synthesisMode})`);

  await api(`/api/projects/${project.id}/profile`, { method: "PATCH", body: JSON.stringify({ action: "confirm" }) });
  console.log("profile confirmed");

  heading("STAGE 2 — LANDSCAPE (topics + competitors)");
  await api(`/api/projects/${project.id}/landscape/generate`, { method: "POST" });
  const landscape = await waitFor("landscape", async () => {
    const res = await api<{ landscape: { topics: any[]; competitors: any[]; discovery: any } }>(`/api/projects/${project.id}/landscape`);
    return res.landscape?.discovery?.status === "completed" ? res.landscape : null;
  }, 300_000);
  console.log(`TOPICS (${landscape.topics.length}):`);
  for (const t of landscape.topics) console.log(`   • ${t.name}${t.description ? ` — ${t.description}` : ""}`);
  const competitors = landscape.competitors ?? [];
  console.log(`\nCOMPETITORS (${competitors.length}):`);
  for (const c of competitors) {
    console.log(`   • ${String(c.canonicalName).padEnd(26)} ${String(c.canonicalDomain ?? "-").padEnd(24)} ${String(c.competitorType ?? "-").padEnd(12)} conf=${c.confidence ?? "-"}`);
    if (c.reason) console.log(`       ${String(c.reason).slice(0, 150)}`);
  }
  // Confirm everything the landscape proposed so the run can proceed.
  await api(`/api/projects/${project.id}/landscape`, {
    method: "PATCH",
    body: JSON.stringify({
      action: "confirm",
      topicUpdates: landscape.topics.map((t: any) => ({ id: t.id, status: "confirmed" })),
      competitorUpdates: competitors.map((c: any) => ({ id: c.id, status: "confirmed" })),
    }),
  });
  console.log("\nlandscape confirmed");

  heading("STAGE 3 — PROMPTS");
  await api(`/api/projects/${project.id}/prompts/generate`, { method: "POST" });
  const prompts = await waitFor("prompt set", async () => {
    const res = await api<{ promptSet: any; candidates: any[] }>(`/api/projects/${project.id}/prompts`);
    const selected = (res.candidates ?? []).filter((c: any) => ["SELECTED", "USER_APPROVED"].includes(c.lifecycleState));
    return selected.length >= 30 ? res : null;
  }, 300_000);
  const selected = prompts.candidates.filter((c: any) => ["SELECTED", "USER_APPROVED"].includes(c.lifecycleState));
  const bySection: Record<string, any[]> = {};
  for (const c of selected) {
    const section = c.section ?? c.cohort;
    (bySection[section] ??= []).push(c);
  }
  for (const [section, rows] of Object.entries(bySection)) {
    console.log(`\n--- ${section} (${rows.length}) ---`);
    for (const r of rows) console.log(`   • ${r.editedText ?? r.text}`);
  }
  const texts = selected.map((c: any) => (c.editedText ?? c.text).toLowerCase());
  console.log(`\nduplicate final texts: ${texts.length - new Set(texts).size}`);

  await api(`/api/prompt-sets/${prompts.promptSet.id}/approve`, { method: "POST", body: JSON.stringify({ approvedBy: "audit" }) });
  console.log("prompt set approved");
  if (process.env.SUN_SKIP_OBSERVE === "1") {
    console.log(JSON.stringify({ projectId: project.id, promptSetId: prompts.promptSet.id }));
    return;
  }

  heading("STAGE 4 — OBSERVE (background collection, progressive measurement)");
  const { collectionRun } = await api<{ collectionRun: { id: string } }>(`/api/projects/${project.id}/collection-runs`, {
    method: "POST",
    body: JSON.stringify({}),
  });
  console.log(`collection run ${collectionRun.id}`);
  const observeStartedAt = Date.now();
  const started = await api<{ runner: any }>(`/api/collection-runs/${collectionRun.id}/collect`, { method: "POST" });
  console.log(`collect returned in ${Date.now() - observeStartedAt}ms with status ${started.runner?.status}`);
  let firstMetricAt: number | null = null;
  let lastMeasureLog = 0;
  // A poll is not a transaction: one dropped request must not end the watch.
  const poll = async <T,>(path: string): Promise<T> => {
    for (let attempt = 1; ; attempt++) {
      try {
        return await api<T>(path);
      } catch (error) {
        if (attempt >= 6) throw error;
        await sleep(3000 * attempt);
      }
    }
  };
  for (;;) {
    await sleep(5000);
    const { runner } = await poll<{ runner: any }>(`/api/collection-runs/${collectionRun.id}/collect`);
    const elapsed = Math.round((Date.now() - observeStartedAt) / 1000);
    const lanes = (runner?.lanes ?? [])
      .map((lane: any) => `${lane.provider} ${lane.succeeded}/${lane.total} ${lane.status}${lane.status === "paced" && lane.resumesAt ? ` (${Math.max(0, Math.round((lane.resumesAt - Date.now()) / 1000))}s: ${lane.paceReason})` : ""}${lane.etaMs ? ` eta ${Math.round(lane.etaMs / 1000)}s` : ""}`)
      .join(" | ");
    console.log(`[${elapsed}s] ${lanes}`);
    if (Date.now() - lastMeasureLog > 30_000) {
      lastMeasureLog = Date.now();
      const partial = await poll<any>(`/api/projects/${project.id}/measure?collectionRunId=${collectionRun.id}`);
      const pm = partial.measure;
      const dv = pm?.metrics?.combined?.discovery_visibility;
      if (dv && dv.denominator > 0 && firstMetricAt === null) firstMetricAt = Date.now();
      console.log(`   provisional: captured ${pm?.coverage?.captured}/${pm?.coverage?.planned}, discovery visibility ${dv?.numerator ?? 0}/${dv?.denominator ?? 0}`);
    }
    if (!runner || runner.status === "completed") break;
  }
  console.log(`collection finished in ${Math.round((Date.now() - observeStartedAt) / 1000)}s; first provisional metric after ${firstMetricAt ? Math.round((firstMetricAt - observeStartedAt) / 1000) : "n/a"}s`);

  heading("STAGE 5 — MEASURE");
  const measure = await api<any>(`/api/projects/${project.id}/measure?collectionRunId=${collectionRun.id}`);
  const m = measure.measure ?? measure;
  const combined = m.metrics?.combined ?? {};
  console.log(`coverage: planned ${m.coverage?.planned}, captured ${m.coverage?.captured}, analysable ${m.coverage?.analysable}, needsReview ${m.coverage?.needsReview}`);
  console.log(`sections: discovery ${JSON.stringify(m.scopes?.discovery)}  tradeOffs ${JSON.stringify(m.scopes?.tradeOffs)}  sentiment ${JSON.stringify(m.scopes?.sentiment)}`);
  console.log("\nMETRICS (combined):");
  for (const [key, value] of Object.entries<any>(combined)) {
    const pct = value.value === null ? "N/A" : `${(value.value * 100).toFixed(1)}%`;
    console.log(`   ${key.padEnd(34)} ${pct.padStart(7)}   (${value.numerator}/${value.denominator})`);
  }
  console.log("\nPRESENCE (combined, Discovery only):");
  for (const row of (m.presence?.combined ?? []).slice(0, 12)) {
    console.log(`   ${String(row.name).padEnd(24)} present in ${row.observationIds?.length ?? row.presenceCount ?? 0} discovery answers  firstChoice=${row.firstChoiceCount ?? 0}`);
  }
  console.log(JSON.stringify({ projectId: project.id, collectionRunId: collectionRun.id }));
}

main().catch((error) => { console.error("\nFAILED:", error.message); process.exit(1); });

export {};
