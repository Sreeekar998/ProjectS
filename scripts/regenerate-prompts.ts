// Forces a new prompt-set version for an existing project, waits for
// selection, and prints the selected prompts by section.
//
//   npx tsx scripts/regenerate-prompts.ts <projectId>
const BASE = process.env.SUN_BASE ?? "http://localhost:3000";

async function api<T>(path: string, init?: RequestInit): Promise<T> {
  for (let attempt = 1; ; attempt++) {
    try {
      const res = await fetch(`${BASE}${path}`, { ...init, headers: { "content-type": "application/json", ...(init?.headers ?? {}) } });
      const text = await res.text();
      if (!res.ok) throw new Error(`${init?.method ?? "GET"} ${path} -> ${res.status} ${text.slice(0, 300)}`);
      return (text ? JSON.parse(text) : {}) as T;
    } catch (error) {
      if (init?.method === "POST" || attempt >= 6) throw error;
      await new Promise((resolve) => setTimeout(resolve, 3000 * attempt));
    }
  }
}
const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

async function main() {
  const projectId = process.argv[2];
  if (!projectId) throw new Error("usage: regenerate-prompts.ts <projectId>");
  const before = await api<{ promptSet: { id: string } | null }>(`/api/projects/${projectId}/prompts`);
  const t0 = Date.now();
  await api(`/api/projects/${projectId}/prompts/generate?force=1`, { method: "POST" });
  for (;;) {
    await sleep(5000);
    const now = await api<{ promptSet: any; candidates: any[] }>(`/api/projects/${projectId}/prompts`);
    if (!now.promptSet || now.promptSet.id === before.promptSet?.id) continue;
    if (now.promptSet.status === "generating") continue;
    const selected = now.candidates.filter((c) => ["SELECTED", "USER_APPROVED"].includes(c.lifecycleState));
    console.log(`prompt set ${now.promptSet.id} (${now.promptSet.status}) in ${Math.round((Date.now() - t0) / 1000)}s · generated ${now.candidates.length} · selected ${selected.length}`);
    const stats = now.promptSet.generationStats ?? {};
    console.log(`stats: intentNeeds=${stats.intentNeeds ?? 0} providerDrafts=${stats.providerDrafts ?? 0} deterministicDrafts=${stats.deterministicDrafts ?? 0} rejectedLanguage=${stats.rejectedLanguage ?? 0} duplicates=${stats.duplicates ?? 0}`);
    for (const section of ["Discovery", "Trade Offs", "Sentiment Analysis"]) {
      const rows = selected.filter((c) => c.section === section);
      console.log(`\n--- ${section} (${rows.length}) ---`);
      for (const row of rows) console.log(`   • [${row.generationSource}] ${row.editedText ?? row.text}`);
    }
    const rejected = now.candidates.filter((c) => c.lifecycleState === "REJECTED" && (c.generationSource === "model" || c.generationSource === "gemini"));
    const reasons = rejected.reduce<Record<string, number>>((acc, c) => ((acc[String(c.rejectedReason).split(":")[0]!] = (acc[String(c.rejectedReason).split(":")[0]!] ?? 0) + 1), acc), {});
    console.log(`\nprovider-written candidates rejected: ${rejected.length} ${JSON.stringify(reasons)}`);
    return;
  }
}
main().catch((error) => { console.error("FAILED:", error.message); process.exit(1); });

export {};
