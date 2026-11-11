// A local stand-in for the three collection providers, for running the app
// and its lanes end to end without a vendor account or a spent credit.
//
//   npx tsx scripts/mock-vendors.ts            # listens on :3999
//   SUN_MOCK_VENDORS_PORT=4001 npx tsx scripts/mock-vendors.ts
//
// Point the app at it with
//   SUN_BRIGHTDATA_BASE_URL=http://localhost:3999/brightdata
//   SUN_CLORO_BASE_URL=http://localhost:3999/cloro
//   SUN_DECODO_BASE_URL=http://localhost:3999/decodo
// and any non-empty key for each provider (the mock accepts every key except
// the literal "bad-key", which it rejects with 401).
//
// Chaos, per vendor, through SUN_MOCK_VENDORS_MODE="brightdata=blocked,cloro=empty":
//   ok       normal answers (default)
//   blocked  502 / an error record, like a login wall or a challenge page
//   empty    a blank page with success status
//   nocredit 403 insufficient credits
//   slow     answers after 8 seconds
//   async    Bright Data only: 202 + snapshot, ready on the second poll
//
// Answers mention a few invented brands so Measure has something to count.
// The payload shapes follow each vendor's published docs (September 2026).

import http from "node:http";
import { URL } from "node:url";

const PORT = Number(process.env.SUN_MOCK_VENDORS_PORT ?? 3999);
const MODES = new Map(
  (process.env.SUN_MOCK_VENDORS_MODE ?? "")
    .split(",")
    .map((pair) => pair.trim())
    .filter(Boolean)
    .map((pair) => pair.split("=") as [string, string]),
);
const mode = (vendor: string) => MODES.get(vendor) ?? "ok";
const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

const BRANDS = ["Salomon", "Hoka", "TrailStride", "Brooks", "Nike", "Adidas", "Decathlon", "Asics"];
function answerFor(prompt: string): { text: string; markdown: string; sources: Array<{ url: string; title: string }> } {
  const seed = [...prompt].reduce((sum, ch) => sum + ch.charCodeAt(0), 0);
  const picks = [BRANDS[seed % BRANDS.length]!, BRANDS[(seed + 3) % BRANDS.length]!, BRANDS[(seed + 5) % BRANDS.length]!];
  const text = `For "${prompt.slice(0, 60)}" the usual picks are ${picks[0]}, ${picks[1]} and ${picks[2]}. ${picks[0]} is the safest all-round choice; ${picks[1]} suits people who want more cushioning; ${picks[2]} is the budget option. Check recent reviews before buying, as models change every season.`;
  const markdown = `For **${prompt.slice(0, 60)}** the usual picks are:\n\n1. **${picks[0]}** — safest all-round choice\n2. **${picks[1]}** — more cushioning\n3. **${picks[2]}** — budget option\n\nCheck recent reviews before buying, as models change every season.`;
  const sources = [
    { url: `https://www.runnersworld.com/gear/${encodeURIComponent(picks[0]!.toLowerCase())}-review?utm_source=chatgpt.com`, title: `${picks[0]} review` },
    { url: `https://reviews.example/${encodeURIComponent(picks[1]!.toLowerCase())}?utm_source=chatgpt.com`, title: `${picks[1]} buyer guide` },
  ];
  return { text, markdown, sources };
}

function readBody(req: http.IncomingMessage): Promise<string> {
  return new Promise((resolve) => {
    let data = "";
    req.on("data", (chunk) => (data += chunk));
    req.on("end", () => resolve(data));
  });
}

function send(res: http.ServerResponse, status: number, body: unknown, headers: Record<string, string> = {}) {
  const payload = typeof body === "string" ? body : JSON.stringify(body);
  res.writeHead(status, { "content-type": typeof body === "string" ? "text/html" : "application/json", ...headers });
  res.end(payload);
}

const snapshots = new Map<string, { prompt: string; country: string | null; polls: number }>();
let cloroCredits = Number(process.env.SUN_MOCK_CLORO_CREDITS ?? 500);

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url ?? "/", `http://localhost:${PORT}`);
  const auth = req.headers.authorization ?? "";
  const body = req.method === "POST" ? await readBody(req) : "";
  const parsed = body ? (JSON.parse(body) as unknown) : null;
  console.log(`[mock-vendors] ${req.method} ${url.pathname}${url.search}`);

  if (auth.includes("bad-key")) return send(res, 401, { error: { code: "INVALID_OR_EXPIRED_API_KEY", message: "bad key" } });

  // ---- Bright Data --------------------------------------------------------
  if (url.pathname.startsWith("/brightdata/")) {
    const m = mode("brightdata");
    if (m === "slow") await sleep(8000);
    if (m === "nocredit") return send(res, 403, { error: "Free tier credits exhausted for this month" });
    if (url.pathname.endsWith("/datasets/v3/scrape")) {
      const input = (Array.isArray(parsed) ? parsed : (parsed as { input?: unknown[] })?.input ?? []) as Array<{ prompt: string; country?: string }>;
      const first = input[0] ?? { prompt: "" };
      if (m === "async") {
        const id = `s_${Date.now()}`;
        snapshots.set(id, { prompt: first.prompt, country: first.country ?? null, polls: 0 });
        return send(res, 202, { snapshot_id: id });
      }
      return send(res, 200, [brightDataRecord(first.prompt, first.country ?? null, m)]);
    }
    const progress = url.pathname.match(/\/datasets\/v3\/progress\/(.+)$/);
    if (progress) {
      const snap = snapshots.get(progress[1]!);
      if (!snap) return send(res, 404, { error: "unknown snapshot" });
      snap.polls += 1;
      return send(res, 200, { status: snap.polls >= 2 ? "ready" : "running" });
    }
    const snapshot = url.pathname.match(/\/datasets\/v3\/snapshot\/(.+)$/);
    if (snapshot) {
      const snap = snapshots.get(snapshot[1]!);
      if (!snap) return send(res, 404, { error: "unknown snapshot" });
      return send(res, 200, [brightDataRecord(snap.prompt, snap.country, "ok")]);
    }
    return send(res, 404, { error: "no such endpoint" });
  }

  // ---- cloro --------------------------------------------------------------
  if (url.pathname.startsWith("/cloro/")) {
    const m = mode("cloro");
    if (url.pathname.endsWith("/v1/credits")) return send(res, 200, { remaining: cloroCredits });
    if (url.pathname.startsWith("/cloro/html/")) return send(res, 200, `<html lang="en" data-build="mock"><body><main>${answerFor(decodeURIComponent(url.pathname.split("/").pop() ?? "")).markdown}</main></body></html>`);
    const monitor = url.pathname.match(/\/v1\/monitor\/(chatgpt|gemini)$/);
    if (monitor) {
      const engine = monitor[1]!;
      const { prompt, country } = parsed as { prompt: string; country: string };
      if (m === "slow") await sleep(8000);
      if (m === "nocredit" || cloroCredits < 7) return send(res, 403, { error: { code: "INSUFFICIENT_CREDITS", message: "Not enough credits" } });
      if (m === "blocked") return send(res, 502, { error: { code: "EXTERNAL_SERVICE_ERROR", message: `${engine} is unreachable from ${country}` } });
      cloroCredits -= 7;
      const headers = { "x-credits-charged": "7", "x-credits-remaining": String(cloroCredits), "x-latency-ms": "31000", "x-request-id": `req_${Date.now()}` };
      if (m === "empty") return send(res, 200, { success: true, result: { text: "I can't help with that.", markdown: "I can't help with that.", html: null, model: "", sources: [], citationPills: [], searchQueries: [] } }, headers);
      const answer = answerFor(prompt);
      return send(
        res,
        200,
        {
          success: true,
          result: {
            text: answer.text,
            markdown: answer.markdown,
            html: `http://localhost:${PORT}/cloro/html/${encodeURIComponent(prompt.slice(0, 80))}`,
            model: "",
            searchQueries: engine === "chatgpt" ? [`${prompt.slice(0, 40)} 2026`] : [],
            sources: answer.sources.map((source, index) => ({ position: index + 1, url: engine === "gemini" ? source.url.replace("utm_source=chatgpt.com", "") : source.url, label: source.title, description: null, datePublished: null, footnote: false })),
            citationPills: answer.sources.slice(0, 1).map((source) => ({ url: source.url, label: source.title, domain: new URL(source.url).hostname, citationPillId: 0, type: "searchResult", position: 1 })),
            shoppingCards: [],
            inlineProducts: [],
            entities: [],
            ads: [],
          },
        },
        headers,
      );
    }
    return send(res, 404, { error: { code: "NOT_FOUND", message: "no such endpoint" } });
  }

  // ---- Oxylabs (push-pull jobs) -------------------------------------------
  if (url.pathname.startsWith("/oxylabs/")) {
    const m = mode("oxylabs");
    if (url.pathname.endsWith("/v1/queries") && req.method === "POST") {
      const { prompt, geo_location } = parsed as { prompt: string; geo_location?: string };
      if (m === "nocredit") return send(res, 403, { message: "Your free trial results are exhausted" });
      const id = `${Date.now()}${Math.floor(Math.random() * 1000)}`;
      snapshots.set(`ox_${id}`, { prompt, country: geo_location ?? null, polls: 0 });
      return send(res, 201, { id, status: "pending", created_at: new Date().toISOString() });
    }
    const jobMatch = /\/v1\/queries\/([^/]+)(\/results)?$/.exec(url.pathname);
    if (jobMatch) {
      const job = snapshots.get(`ox_${jobMatch[1]}`);
      if (!job) return send(res, 404, { message: "job not found" });
      if (!jobMatch[2]) {
        job.polls += 1;
        // Done on the second poll, like a real ~20 s job.
        if (m === "blocked") return send(res, 200, { id: jobMatch[1], status: "faulted" });
        return send(res, 200, { id: jobMatch[1], status: job.polls >= 2 || m === "slow" ? "done" : "pending" });
      }
      const answer = answerFor(job.prompt);
      const content =
        m === "empty"
          ? { prompt: job.prompt, llm_model: "gpt-5-5", response_text: "", markdown_text: "", markdown_json: [], citations: [], search_queries: [], parse_status_code: 12000 }
          : {
              prompt: job.prompt,
              llm_model: "gpt-5-5",
              response_text: answer.text,
              markdown_text: answer.markdown,
              markdown_json: [],
              citations: answer.sources.map((source) => ({ title: source.title, url: source.url, text: new URL(source.url).hostname, description: "May 26, 2026" })),
              search_queries: [`${job.prompt.slice(0, 40)} ${job.country ?? ""}`.trim()],
              links: [],
              parse_status_code: 12000,
            };
      return send(res, 200, { results: [{ content, created_at: new Date().toISOString(), updated_at: new Date().toISOString(), page: 1, url: "https://chatgpt.com/?model=auto", job_id: jobMatch[1], status_code: 200, parser_type: "chatgpt" }] });
    }
    return send(res, 404, { message: "no such endpoint" });
  }

  // ---- Decodo -------------------------------------------------------------
  if (url.pathname.startsWith("/decodo/")) {
    const m = mode("decodo");
    if (url.pathname.endsWith("/v2/scrape")) {
      const { prompt, geo } = parsed as { prompt: string; geo?: string };
      if (m === "slow") await sleep(8000);
      if (m === "nocredit") return send(res, 403, { message: "Subscription limit reached" });
      if (m === "blocked") return send(res, 200, { results: [{ content: "<html>Just a moment…</html>", status_code: 403, url: "https://chatgpt.com/", task_id: `${Date.now()}` }] });
      const answer = answerFor(prompt);
      // The real shape (2026-09-15): the parsed answer nested under content.results.
      const parsedAnswer =
        m === "empty"
          ? { prompt, llm_model: "gpt-5-6", markdown_json: [], markdown_text: "", response_text: "", citations: [], search_queries: [], raw_response: [], parse_status_code: 12000 }
          : {
              prompt,
              llm_model: "gpt-5-6",
              markdown_json: [],
              markdown_text: answer.markdown,
              response_text: answer.text,
              citations: answer.sources.map((source) => ({ url: source.url, text: new URL(source.url).hostname, title: source.title, description: "2026" })),
              search_queries: [`${prompt.slice(0, 40)} ${geo ?? ""}`.trim()],
              raw_response: ["event: delta_encoding", 'data: "v1"'],
              parse_status_code: 12000,
            };
      const taskId = `${Date.now()}`;
      return send(res, 200, { results: [{ content: { results: parsedAnswer, errors: [], status_code: 200, task_id: taskId }, headers: {}, status_code: 200, task_id: taskId, created_at: new Date().toISOString(), updated_at: new Date().toISOString() }] });
    }
    return send(res, 404, { message: "no such endpoint" });
  }

  send(res, 404, { error: "unknown vendor prefix" });
});

function brightDataRecord(prompt: string, country: string | null, m: string) {
  if (m === "blocked") return { input: { prompt }, error: "Access denied: challenge page", error_code: "blocked" };
  const answer = answerFor(prompt);
  const empty = m === "empty";
  // Like the real records: the first brand is an inline link, delivered as a
  // "[1]" placeholder with the text in links_attached.
  const firstBrand = /\*\*([^*]+)\*\*/.exec(answer.markdown)?.[1] ?? null;
  const withPlaceholder = (text: string) => (firstBrand ? text.replace(firstBrand, "[1]") : text);
  return {
    url: `https://chatgpt.com/?q=${encodeURIComponent(prompt.slice(0, 80))}`,
    prompt,
    answer_text: empty ? "Map data is currently unavailable" : withPlaceholder(answer.text),
    answer_text_markdown: empty ? "*   Map data is currently unavailable" : withPlaceholder(answer.markdown),
    answer_html: `<html lang="en-US" data-build="prod-mock"><body><main>${empty ? "" : answer.markdown}</main></body></html>`,
    model: null,
    web_search_triggered: !empty,
    is_map: empty,
    shopping_visible: false,
    citations: empty ? [] : answer.sources.map((source, index) => ({ url: source.url, title: source.title, description: new URL(source.url).hostname, icon: null, domain: new URL(source.url).origin, cited: true, position: index + 1, answer_position: null })),
    search_sources: empty ? [] : answer.sources.map((source, index) => ({ url: source.url, title: source.title, snippet: null, rank: index + 1, date_published: null })),
    links_attached: empty || !firstBrand ? [] : [{ url: `https://www.${firstBrand.toLowerCase()}.com/?utm_source=chatgpt.com`, text: firstBrand, position: 1 }],
    prompt_sent_at: new Date().toISOString(),
    ...(country ? { country: country.toUpperCase() } : {}),
  };
}

server.listen(PORT, () => {
  console.log(`[mock-vendors] listening on http://localhost:${PORT} (modes: ${[...MODES.entries()].map(([k, v]) => `${k}=${v}`).join(", ") || "all ok"})`);
});
