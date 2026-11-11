// Shared, throttled clients for the two public knowledge endpoints.
//
// Both Wikipedia's action API and the Wikidata Query Service rate-limit
// anonymous callers, and they do it independently, so each gets its own
// serialised queue with its own spacing. Discovery previously fired requests
// concurrently and took the 429s as "this source found nothing", which is how
// a transient limit turned into a silently empty competitor set.

const USER_AGENT = "ProjectSunCompetitorDiscovery/3.0 (https://projectsun.local; competitive-intelligence research)";
const WIKIPEDIA_API = "https://en.wikipedia.org/w/api.php";
const WIKIDATA_SPARQL = "https://query.wikidata.org/sparql";

/** Serialises calls and keeps a minimum gap between them. */
class Throttle {
  private chain: Promise<unknown> = Promise.resolve();
  private last = 0;
  constructor(private readonly gapMs: number) {}
  run<T>(task: () => Promise<T>): Promise<T> {
    const next = this.chain.then(async () => {
      const wait = this.gapMs - (Date.now() - this.last);
      if (wait > 0) await new Promise((resolve) => setTimeout(resolve, wait));
      this.last = Date.now();
      return task();
    });
    // A rejection must not poison the queue for every later caller.
    this.chain = next.then(
      () => undefined,
      () => undefined,
    );
    return next;
  }
}

const wikipediaThrottle = new Throttle(190);
const wikidataThrottle = new Throttle(1100);

const TIMEOUT_MS = 20_000;
const MAX_ATTEMPTS = 4;

async function fetchJson(url: URL, accept: string): Promise<unknown | null> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
  try {
    const response = await fetch(url, { headers: { accept, "user-agent": USER_AGENT }, signal: controller.signal });
    // 429/503 are "come back later", not "no such data" — the caller retries.
    if (response.status === 429 || response.status === 503) return { __retry: true };
    if (!response.ok) return null;
    return await response.json();
  } catch {
    return null;
  } finally {
    clearTimeout(timer);
  }
}

/** One Wikipedia action-API call. Returns null on definitive failure. */
export async function wikipedia<T>(params: Record<string, string>): Promise<T | null> {
  const url = new URL(WIKIPEDIA_API);
  for (const [key, value] of Object.entries({ format: "json", formatversion: "2", ...params })) url.searchParams.set(key, value);
  for (let attempt = 0; attempt < MAX_ATTEMPTS; attempt++) {
    const body = await wikipediaThrottle.run(() => fetchJson(url, "application/json"));
    if (body && typeof body === "object" && "__retry" in body) {
      await new Promise((resolve) => setTimeout(resolve, 700 * 2 ** attempt));
      continue;
    }
    return (body as T) ?? null;
  }
  return null;
}

interface SparqlBinding {
  [key: string]: { value: string } | undefined;
}

/** One SPARQL query against the Wikidata Query Service. [] on failure. */
export async function sparql(query: string): Promise<SparqlBinding[]> {
  const url = new URL(WIKIDATA_SPARQL);
  url.searchParams.set("query", query);
  url.searchParams.set("format", "json");
  for (let attempt = 0; attempt < MAX_ATTEMPTS; attempt++) {
    const body = await wikidataThrottle.run(() => fetchJson(url, "application/sparql-results+json"));
    if (body && typeof body === "object" && "__retry" in body) {
      await new Promise((resolve) => setTimeout(resolve, 1500 * 2 ** attempt));
      continue;
    }
    const parsed = body as { results?: { bindings?: SparqlBinding[] } } | null;
    return parsed?.results?.bindings ?? [];
  }
  return [];
}

export type { SparqlBinding };
