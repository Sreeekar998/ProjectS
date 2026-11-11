// Starts background collection for a project's approved prompt set, then polls
// lane progress and provisional measurement until the run completes. Times the
// run and when the first provisional metric became available.
//
//   npx tsx scripts/observe-run.ts <projectId>
const BASE = process.env.SUN_BASE ?? "http://localhost:3000";

async function api<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(`${BASE}${path}`, { ...init, headers: { "content-type": "application/json", ...(init?.headers ?? {}) } });
  const text = await res.text();
  if (!res.ok) throw new Error(`${init?.method ?? "GET"} ${path} -> ${res.status} ${text.slice(0, 300)}`);
  return (text ? JSON.parse(text) : {}) as T;
}
const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

/** A poll is not a transaction: one dropped request must not end the watch. */
async function poll<T>(path: string): Promise<T> {
  for (let attempt = 1; ; attempt++) {
    try {
      return await api<T>(path);
    } catch (error) {
      if (attempt >= 6) throw error;
      await sleep(3000 * attempt);
    }
  }
}

async function main() {
  const projectId = process.argv[2];
  if (!projectId) throw new Error("usage: observe-run.ts <projectId>");
  const { collectionRun } = await api<{ collectionRun: { id: string } }>(`/api/projects/${projectId}/collection-runs`, { method: "POST", body: "{}" });
  const t0 = Date.now();
  const started = await api<{ runner: any }>(`/api/collection-runs/${collectionRun.id}/collect`, { method: "POST" });
  console.log(`run ${collectionRun.id}: POST /collect returned in ${Date.now() - t0}ms (status ${started.runner?.status})`);

  let firstMetricSec: number | null = null;
  let lastMeasure = 0;
  for (;;) {
    await sleep(5000);
    const { runner } = await poll<{ runner: any }>(`/api/collection-runs/${collectionRun.id}/collect`);
    const sec = Math.round((Date.now() - t0) / 1000);
    const lanes = (runner?.lanes ?? [])
      .map((lane: any) => `${lane.provider}=${lane.succeeded}/${lane.total} ${lane.status}${lane.status === "paced" && lane.resumesAt ? `(${Math.max(0, Math.round((lane.resumesAt - Date.now()) / 1000))}s ${lane.paceReason})` : ""}${lane.retries ? ` retries=${lane.retries}` : ""}${lane.failed ? ` failed=${lane.failed}` : ""}${lane.etaMs ? ` eta=${Math.round(lane.etaMs / 1000)}s` : ""}`)
      .join("  |  ");
    console.log(`[${String(sec).padStart(4)}s] ${lanes}`);
    if (Date.now() - lastMeasure > 20_000 || runner?.status === "completed") {
      lastMeasure = Date.now();
      const { measure } = await poll<any>(`/api/projects/${projectId}/measure?collectionRunId=${collectionRun.id}`);
      const dv = measure?.metrics?.combined?.discovery_visibility;
      if (dv?.denominator > 0 && firstMetricSec === null) firstMetricSec = sec;
      console.log(`        provisional → captured ${measure?.coverage?.captured}/${measure?.coverage?.planned}, analysable ${measure?.coverage?.analysable}, discovery visibility ${dv?.numerator ?? 0}/${dv?.denominator ?? 0}`);
    }
    if (!runner || runner.status === "completed") break;
  }
  const { measure } = await api<any>(`/api/projects/${projectId}/measure?collectionRunId=${collectionRun.id}`);
  console.log(`\nDONE in ${Math.round((Date.now() - t0) / 1000)}s · first provisional metric at ${firstMetricSec ?? "n/a"}s`);
  console.log(`coverage ${JSON.stringify(measure.coverage)}`);
  for (const [key, value] of Object.entries<any>(measure.metrics.combined)) {
    console.log(`  ${key.padEnd(34)} ${value.value === null ? "N/A" : `${(value.value * 100).toFixed(1)}%`} (${value.numerator}/${value.denominator})`);
  }
  console.log(JSON.stringify({ collectionRunId: collectionRun.id }));
}
main().catch((error) => { console.error("FAILED:", error.message); process.exit(1); });

export {};
