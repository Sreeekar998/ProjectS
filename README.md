# Project Sun — Phase 2

AI-visibility measurement for a business's website: crawl it, understand it, build a
defensible 30-prompt measurement cohort, observe ChatGPT and Gemini honestly, and
explain every number down to the response that produced it.

Implements `Project_Sun_Phase2_Final_Technical_Implementation_Specification_v2.docx`.
See [`IMPLEMENTATION_STATUS.md`](./IMPLEMENTATION_STATUS.md) for what's done, what's
simplified, and why.

## Quick start

```bash
npm install
npm run dev
```

Open http://localhost:3000. That's it — no database server, no Docker, no account,
no card. The app creates its own SQLite database and evidence store on first run.

## Optional: provider API keys

A Gemini API key (`GEMINI_API_KEY` in `.env.local`, or connected from the observation
console) enables the customer intent model that writes the prompt cohort and an
automated Gemini API observation lane. An OpenAI API key (`OPENAI_API_KEY`) adds the
automated ChatGPT lane on `gpt-5-nano`. This lane is paid per token, about a tenth of a
cent per answer, from prepaid credit at https://platform.openai.com/settings/organization/billing.
When no OpenAI key is present, a Cerebras or Groq key serves the same lane free on the
open-weight gpt-oss-120b model. Without keys the pipeline falls back to deterministic
prompt templates, and the manual ChatGPT / Gemini app workflow works exactly the same.

```bash
cp .env.example .env.local
# edit .env.local and paste a key from https://aistudio.google.com/apikey
# and OPENAI_API_KEY from https://platform.openai.com/api-keys
npx tsx scripts/probe-openai.ts   # one real question: checks the key, balance and cost
```

## The interview demo sequence

1. **Marketing → Start Free Trial.** Enter any public website, a market, and a language.
2. **Understand.** Watch the crawl progress live, then review the evidence-backed
   business profile (brand, archetype, offerings, geography). Edit anything, confirm.
3. **Landscape.** Confirm 4–6 topics and the competitive set (add competitors manually
   if none were auto-detected — expected for many sites).
4. **Prompts.** Watch candidates stream in with live counters (generated / validated /
   rejected / duplicates / selected). Click **Why?** on any prompt to see its coverage
   cell, quality score, and selection reason. **Add your own prompt** to any section: it takes a
   slot (the prompt it replaces moves to the alternatives), must meet that section's rules
   (Discovery never names the brand or a competitor; Trade Offs names the brand and a confirmed
   competitor; Sentiment Analysis names the brand), and is frozen with the rest on approval.
   Approve once exactly 30/30 are selected.
5. **Observe** (the console on the Measure screen). Either collect automatically through
   the provider APIs — each provider runs as its own background lane, Discovery prompts
   first, paced to the limits the provider reports — or ask ChatGPT and Gemini by hand:
   copy a prompt, open the app, paste the full answer and its sources back. Both routes
   can be added to the same run. A provider whose quota runs out pauses instead of
   stalling; its prompts stay uncollected and are never counted as the brand being absent.
   No automation ever touches the consumer ChatGPT or Gemini apps.
6. **Measure.** Figures appear as answers arrive and stay marked **Provisional** until
   every planned observation is in. KPIs carry `x/n` denominators; click any card to see
   the exact prompt, response, matched mentions, citations, and provider metadata.

## Local setup requirements

- Node.js ≥ 20.11 (this repo was built and tested on Node 20.13 via `nvm`).
- No other services. No `DATABASE_URL`, no Redis, no S3. Provider keys are optional.
- The optional JS-rendering fallback for the submitted website needs a Chromium
  binary. Run this once if you want that fallback available (the app works without
  it — it just falls back to raw static HTML for that one page):

  ```bash
  npm run playwright:install
  ```

## Commands

| Command | What it does |
|---|---|
| `npm run dev` | Bootstraps the local DB/evidence store, then starts the app on :3000 |
| `npm start` | Runs the app in production mode on :3000; builds first only when there is no build or the code changed since the last one |
| `npm run build` | Production build only |
| `npm run lint` | ESLint |
| `npm run typecheck` | `tsc --noEmit` (strict) |
| `npm test` | Vitest: unit + integration + security + benchmark suites |
| `npm run test:e2e` | Playwright, drives a real browser through the core journey |
| `npm run db:init` | Re-run the local bootstrap (migrations + route-policy seed) |
| `npm run db:reset` | Delete the local database and evidence store |
| `npm run clean-room` | Proves the app boots and completes a project from a brand-new empty data dir with no `GEMINI_API_KEY` |
| `npm run test:benchmark` | Runs deterministic competitor and cross-archetype prompt-engine benchmarks, writing `BENCHMARK_REPORT.md` |
| `npm run benchmark:competitors:live -- benchmarks/competitor-live-manifest.json` | Runs the optional human-reviewed live competitor benchmark (requires 10+ targets and `GEMINI_API_KEY`) |
| `npm run verify` | lint + typecheck + test + build, in that order |

## Architecture

```
src/
  app/                    Next.js App Router — pages + API route handlers
    api/                  REST-ish JSON API (Zod-validated at every boundary)
    projects/[id]/...     The 5-screen journey: understand, landscape, prompts, collect, measure
  lib/
    db/                   Drizzle ORM schema (SQLite dialect) + migration-on-boot client
    crawler/              SSRF-safe fetcher, robots/sitemap, page scoring, HTML extraction
    profile/              Deterministic business-profile extraction + optional Gemini enhancement
    landscape/             Topic clustering + competitor discovery
    prompts/               The Prompt Intelligence Engine (coverage policy → generation →
                            validation → dedup → scoring → constrained selection → approval)
    collection/             PromptRun state machine, background collection runner (provider
                            lanes, pacing, quota pause), manual capture, Gemini/Groq adapters
    analysis/               Per-observation analysis: mentions, roles, ranks, comparisons,
                            sentiment, citations
    measure/                Metric policy + engine that computes Measure from stored analyses
    metrics/                Mention/citation parser behind the evidence drawer's matches
    events/                 SSE event bus (project-scoped, sequence-numbered, resumable)
    security/               SSRF guard (IP-range classification + DNS revalidation)
    providers/              Route-policy / capability-gate registry
  components/               UI kit (Button, Card, Badge, ...) + feature components
drizzle/                    SQL migrations (generated by drizzle-kit, committed to the repo)
tests/
  unit/                     Pure-function tests — no I/O
  integration/               Real HTTP against a local fixture server, or a live public site
  security/                   SSRF corpus run through the real crawl orchestrator
  benchmark/                  Cross-archetype prompt-engine generality
  e2e/                        Playwright, drives a real Chromium browser
  fixtures/                   Deterministic fixture data + a local fixture HTTP server
```

**Repository pattern.** Every domain module talks to SQLite through a `repository.ts`
file, never through raw Drizzle calls scattered around route handlers. That's the seam
the spec asks for so a future PostgreSQL migration doesn't touch domain logic — swap
`drizzle-orm/better-sqlite3` for `drizzle-orm/node-postgres`, regenerate migrations,
done.

**Jobs.** Long-running work (crawl, prompt generation) runs in-process, fire-and-forget,
from the API route handler that kicks it off; progress streams out over SSE. This is
deliberately simpler than a separate worker process or job queue — at the scale of one
interview trial (≤120 candidates, ≤60 observations), an in-process async function with a
resumable event log is the right tool, not premature infrastructure.

**Evidence.** Two stores, on purpose: SQLite holds normalized, queryable facts (crawl
pages, mentions, citations, observation analyses); the local filesystem
(`evidence-store/<projectId>/<sha256>.txt`) holds raw content-addressed blobs (page
text, provider responses) with TTL/export/delete support, kept separate so raw-evidence
retention policy can change without touching the normalized schema.

## Security posture

- **SSRF**: every crawl target is DNS-resolved and IP-range-checked before *and after*
  every redirect hop (`src/lib/security/url-safety.ts`, `ip-guard.ts`). Loopback,
  private, link-local (including the `169.254.169.254` cloud metadata endpoint),
  multicast, and IPv4-mapped-IPv6 bypass attempts are all covered —
  see `tests/security/ssrf.test.ts`.
- **Prompt injection**: crawled website text is passed to the optional Gemini calls
  explicitly labelled as untrusted data to summarize, never as instructions, and the
  extraction path has no tool/secret access regardless.
- **No consumer automation**: nothing in this codebase submits a prompt into ChatGPT or
  Gemini Apps, reads their DOM, or stores a session cookie. The manual console only
  copies text to the clipboard and opens a new tab.
- **Secrets**: `GEMINI_API_KEY` is read server-side only; it's never sent to the client
  bundle or logged.


## Website Intelligence → Brand Profile

Both landing-page entry points — the nav's **Start free analysis** and the
**Analyse my brand** forms — route into the same analysis workflow at
`/trial/new`. A URL entered on the landing page is carried through and the
analysis starts on its own; the user never types it twice. With no URL, the
field is focused and ready.

The pipeline replaces the old "fetch homepage → send text to an LLM" approach
with an evidence-grounded one: bounded planned crawl → typed evidence →
deterministic field resolvers → optional grounded LLM refinement → validation.
Every substantive profile field cites evidence ids that must resolve, and
confidence is computed from evidence quality rather than asserted by a model.

See [docs/WEBSITE_INTELLIGENCE.md](docs/WEBSITE_INTELLIGENCE.md) for the
architecture, the evidence invariant, and how to run the benchmark.

See [docs/COMPETITOR_AND_PROMPT_INTELLIGENCE.md](docs/COMPETITOR_AND_PROMPT_INTELLIGENCE.md)
for Task 3 architecture, invariants, review semantics, benchmark methodology, and
known limitations.

```bash
npm run test:benchmark                          # deterministic fixture benchmark
npm run benchmark:business-profile -- --live    # live cross-industry benchmark
```
