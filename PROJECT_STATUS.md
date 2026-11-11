# Project Sun: application status

Audited 2026-11-09. Read-only: no application code, configuration, schema or data was changed. Everything below comes from the current code, file timestamps, a read-only look at `data/sun.db`, and checks run on 2026-11-09. Where something comes from memory or docs rather than code, it says so. This is not a git repo, so "history" means file dates and the dated decisions in CLAUDE.md and memory.

## 1. Current status at a glance

| Check | Result (2026-11-09) |
|---|---|
| Overall | A working end-to-end demo for **ChatGPT**: website → Brand Profile → topics and competitors → 30 approved prompts → answers collected through providers → rules-based analysis → Measure workspace. Gemini is built but hidden by default. |
| Last code change | 2026-10-15: analysis trade-off verdicts, Measure Report and Answers views, prompts orchestrator, intake Search Console toggle. Since then only docs and spreadsheets changed (to 2026-10-08) and research outside the repo (2026-10-24). |
| Typecheck | Passes (`tsc --noEmit`, run with `--incremental false` so no build info was written). |
| Tests | 113 files, **1,160 tests passed** (unit + integration + security, about 37 s). The benchmark and Playwright e2e suites were **not run**: they overwrite report files or make real model calls. |
| Lint | `npm run lint` **fails with 537 errors**, all inside `data/deck/.next` (build output of the `sun-deck` launch entry, which `eslint.config.mjs` doesn't ignore). Source code alone has 0 errors and 116 warnings. |
| Dev server | Nothing was listening on :3000 at audit time. |
| Codebase size | About 56.7k lines of TypeScript in `src/`. 27 DB tables, 8 migrations (latest `0007`, 2026-09-15). |
| Live DB (`data/sun.db`, read-only) | 52 projects; 51 prompt sets (35 approved); 27 collection runs (13 completed, **14 still `active`**, all created 2026-09-10 to 09-16, before auto-finalise existed); 1,065 stored answers; 1,519 analyses; 15 measurement snapshots. Last activity 2026-10-15. |
| Answers by source | 645 from the **retired** model-API lanes (to 2026-09-14). 419 from ChatGPT on the web: 393 via Oxylabs, 26 via cloro (a handover on 2026-10-15). 1 captured by hand. |

**Stack:**
- Next.js 15.5 (App Router), React 19.1, TypeScript 5.9, Tailwind v4.
- better-sqlite3 + drizzle-orm, zod.
- Playwright (crawl fallback and e2e), Vitest 3.
- Node ≥ 20.11.

## 2. Development steps completed

Dates come from file timestamps, CLAUDE.md decision dates and memory.

| Date (2026) | Milestone |
|---|---|
| 09-09 | App scaffolded from the Phase 2 specification (first migration; `IMPLEMENTATION_STATUS.md` snapshot). |
| 09-10 – 09-11 | Two audit rounds: engineering; prompts, observation and Measure. Engine labels were reduced to ChatGPT/Gemini. |
| 09-13 | Onboarding intelligence v2: open classification with a closed `kind`, first-class location. Paid OpenAI approved for Understand and Prompts. Engineering handover written (CLAUDE.md, `.claude/rules`, `sun-*` skills, `docs/KNOWN_ISSUES.md`). |
| 09-14 | New intake: website, optional market or area, optional Search Console. Discovery prompts rewritten as planned slots. Collection decision memo. **Model-API and by-hand collection lanes retired** in favour of collection providers. |
| 09-15 | Oxylabs made the first ChatGPT provider. Measure rebuilt as a tabbed workspace with snapshots, history, pinned lineage and run-scoped idempotency (migrations 0006/0007). Paid Landscape approved. Full UI redesign. Report and Answers views added. |
| 09-16 | No collection vendor named anywhere in the app (enforced by a copy-guard test). Two geographies (where the business is vs where it's measured). Topics moved to gpt-5.6-terra. Gemini hidden by default. |
| 09-18 – 09-19 | Real collection runs. Analysis and Measure refinements. `KNOWN_ISSUES.md` updated (last change 09-19). |
| 10-07 – 10-08 | Cost models and investor workbooks (in `docs/*.xlsx`); cost study for an Actions layer. No code change. |
| 10-15 | Analysis trade-off verdicts (`ANALYSIS_VERSION` = `observation-analysis@17`). Report and Answers updates. Prompt orchestrator and Search Console intake toggle. Latest collection runs (a UAE project, Oxylabs → cloro handover). |
| 10-24 | Research report on turning Measure evidence into actions: a Claude Doc plus notes in `Sun Project/research_notes/`. Lives outside the repo; no code. |

## 3. Current workflow (operator journey)

`/` landing page → `/trial/new` intake → four stages in `JourneyNav`:

1. **Understand** (`/projects/[id]/understand`)
   - Enter a URL and an optional market (a country, Worldwide, or a local area). Optionally connect Search Console (read-only OAuth).
   - The app crawls the site: robots, sitemap, menu and brochure PDFs, Playwright fallback. It stores page evidence and builds a Brand Profile: classification, location, offerings, audiences, and so on. Model use is one paid `extract` call (gpt-5.6-luna, with Gemini as fallback); the rest is deterministic.
   - The operator edits any field (each edit makes a new version) and **confirms**. If the crawl is blocked, a manual-completion route exists.
2. **Landscape** (`/projects/[id]/landscape`)
   - The app generates 4–6 topics and competitor suggestions. Competitors come from the site, an AI hypothesis, Wikipedia/Wikidata, web search and OpenStreetMap places. They're screened, scored, verified and planned in area / city / country tiers.
   - The operator confirms, removes, retypes or adds items.
   - Confirming needs 4–6 topics and at least one non-marketplace competitor. It freezes a hashed competitive set.
3. **Prompts** (`/projects/[id]/prompts`)
   - The app generates a candidate pool from the frozen set and the market area. A planner (luna) feeds writers (terra) and a judge (luna).
   - The operator selects, rejects, replaces, regenerates, edits or adds custom prompts.
   - Approving needs **exactly 30: 10 Discovery, 10 Trade Offs, 10 Sentiment Analysis**. Approval freezes the set.
4. **Measure** (`/projects/[id]/measure`)
   - The observation console: "Collect answers" runs the background runner. It does a canary request per provider, stops a failing provider with a breaker, and hands over to the next keyed provider (ChatGPT order: Oxylabs → cloro → Bright Data → Decodo). A per-lane request cap applies.
   - Each answer is analysed by rules as soon as it's captured.
   - A run closes automatically when complete, or through "Finish with what's collected". Closing writes a snapshot. "Collect again" starts a new run.
   - Views: **Overview, Questions, Brands, Sources, Opportunities, Report**, plus a hidden **Answers** view (`?view=answers`). There's a run picker with history and deltas.
   - Exports: CSV (questions, brands, sources) and JSON. The Report prints to PDF.

## 4. Understanding of Project Sun

**Objective.** Show a business, honestly and traceably, how visible it is in consumer AI assistants compared with its competitors. Every figure is an `x of n` count that links back to individual stored answers. The app is a single-operator, local-first demo built for an interview and demo setting. Product scope stops at Measure.

**Architecture:**

```
Browser (React 19 pages) ──zod JSON──► Next.js route handlers (withErrorHandling)
                                          │
   lib/crawler, evidence, profile,        │  fire-and-forget jobs (void job() + 202),
   understanding, geo, search-console ────┤  progress via `events` table → SSE + 2.5 s poll
   lib/landscape ─────────────────────────┤
   lib/prompts ───────────────────────────┤  lib/llm stage routing (OpenAI paid where approved,
   lib/collection + providers ────────────┤  Gemini free fallback; SUN_LLM_NO_PAID kills paid)
     └─ lib/{oxylabs,cloro,brightdata,decodo} (vendor APIs; never our own browser)
   lib/analysis (rules, versioned) ───────┤
   lib/measure (pure engine + policy) ────┘
                                          ▼
                SQLite (better-sqlite3 + drizzle, ./data/sun.db) + evidence-store/ files
```

**Principles in the code:**
- Versioned, append-only artefacts: profile versions, competitive sets, prompt sets, provider responses, analyses, snapshots.
- Deliberate version constants: `observation-analysis@17`, `measure-policy@3`, `competitor-discovery@6`, `prompt-selection@5-10-10-10`.
- Website text is treated as untrusted evidence.
- No brand-specific code in `src/`.
- Coverage gaps are never counted as brand absence; zero denominators show `—`.

## 5. Functionality status

| Area | Status | Notes |
|---|---|---|
| Intake (market, area, Search Console toggle) | ✅ Complete | Market stored in `projects.market_scope`. |
| Understand: crawl, evidence, profile, classification, location | ✅ Complete | Rules-only profiles (no key) are weak (KNOWN_ISSUES). |
| Landscape: topics, competitor discovery and tiers | ✅ Complete | Local rivals are weak without paid search or a Google Maps key. |
| Prompts: 30-prompt generation, review, approval | ✅ Complete | Live model paths have no automated coverage (tests run keyless). |
| ChatGPT collection via 4 providers, with handover | ✅ Complete | Oxylabs is the main route. Bright Data takes 5–12 minutes per answer. |
| Rules-based analysis | ✅ Complete | Several accuracy issues are listed in KNOWN_ISSUES (hedged recommendations, aliases, rank heuristics, negation). |
| Measure workspace, snapshots, history, exports, Report, Answers | ✅ Complete | |
| Gemini collection (cloro) | 🟡 Built, hidden | `SUN_ENGINES` defaults to `chatgpt`; `SUN_ENGINES=chatgpt,gemini` turns it on. |
| Search Console | 🟡 Partial | Feeds Understand only (crawl planning, location, Search Demand card). Not used by Landscape, Prompts or Measure. Must reconnect every 7 days. |
| Opportunities view | 🟡 Partial by design | 8 evidence-review finding types with "where to look next" text. No actions or recommendations. |
| Background-job recovery | 🟡 Partial | Only collection repairs orphans. Crawls, discovery runs and prompt sets are stranded after a restart (one crawl is stranded in the live DB). |
| Manual capture, retry and outcome APIs | 🟡 API only | Client wrappers exist but no UI calls them (kept for stored rows and QA). |
| LLM cost ledger | 🟡 Partial | In memory; persisted only for Understand. |
| Actions / recommendations layer | ⛔ Not started (out of scope) | Research and costing exist outside the code (2026-10-08 and 10-24). |
| Recurring or scheduled measurement | ⛔ Not present | Every run is started by the operator. The cost models assume daily cadence. |
| Auth, multi-tenancy, deployment | ⛔ Not present by design | Every API route, including credential storage, is unauthenticated. Safe only on a local bind. |
| More AI surfaces (Perplexity, AI Overviews, Copilot…) | ⛔ Not wired | Oxylabs offers several per memory; only ChatGPT (and hidden Gemini) is wired. |

## 6. Known gaps, mocked functionality and issues

**Mocked or illustrative (where it shows up):**
- **Landing page:** hardcoded marketing figures ("Demo brand", "Competitor A–C", 42%, "8 of 19"…) in `src/app/page.tsx` and `components/marketing/landing-sections.tsx`. These aren't project data, but the product UI shows them.
- **QA only (never in the product):**
  - `scripts/mock-vendors.ts`: fake versions of all 4 vendors on :3999, used by the `sun-verify-vendors` and `sun-verify-measure` launch entries. Its header still says "three" providers.
  - `scripts/seed-measure-demo.ts` and `seed-approved-project.ts`: templated answers; both refuse to run on `./data`.
  - `provider_responses.is_fixture`: always written `false`, never read.

**Vestigial code:**
- `jobs` table: never used.
- Retired-lane clients (`lib/openai|groq|cerebras/client.ts`): reachable only from tests.
- `GeminiProfileProvider`: never instantiated. The `classify`, `synthesize` and `locate` LLM stages have no callers.
- Coverage-policy "cells": persisted, nothing more.
- `lib/metrics`: v1 parser, still writes the `mentions`/`citations` tables that the evidence drawer reads.
- `capability-gates.ts` constants: `openaiApiEnabled:false`, which contradicts paid onboarding.

**Open defects:** `docs/KNOWN_ISSUES.md` (last updated 2026-09-19) lists about 100 items across all stages. A spot check of 14 found 13 still present. Highest impact:
- **Security** (matters only off localhost):
  - robots, sitemap and Playwright fetches bypass the SSRF guard;
  - IPv6 and NAT64 gaps plus a DNS-rebinding window;
  - no auth.
- **Robustness:**
  - no boot reconciliation (stranded jobs);
  - malformed JSON bodies return 500;
  - run creation throws plain errors (500);
  - vendor health and runner progress live in memory.
- **Measurement accuracy:**
  - hedged recommendations dropped;
  - target aliases not linked;
  - "Here are the best…" defeats ranking;
  - comparison aspects mostly null;
  - sentiment needs the brand in the opinion sentence;
  - source kind is a guess.
- **Profile and Landscape quality:**
  - non-Latin pages dropped as duplicates;
  - "Apr" read as finance;
  - failed profile versions can be confirmed;
  - landscape PATCH isn't transactional;
  - retailers typed as marketplaces.

**Data hygiene:** 14 legacy `active` collection runs and 1 stranded `running` crawl in the live DB.

**Stale documentation:**
- `README.md`: names retired lanes, "5-screen journey", "Provisional", overstated SSRF posture.
- `IMPLEMENTATION_STATUS.md`: 2026-09-09 snapshot; 21/5/4 split, 21 tables, manual console "Done".
- `.env.example`: wrong crawl defaults; missing `SUN_ALLOW_PAID_LANDSCAPE`, `SUN_LLM_NO_PAID`, `GOOGLE_MAPS_API_KEY` and others.
- `BENCHMARK_REPORT.md`: still says "21/4/5".
- `AGENTS.md` and `.agents/skills`: an older Codex copy.
- **`CLAUDE.md` has drifted on a few points:**
  - it lists a Methodology view (method now lives inside Report);
  - it lists exports as csv|json (there are four formats);
  - `lib/{brightdata,cloro,decodo}` omits `lib/oxylabs`;
  - it says "Lint: 0 errors";
  - it calls two code comments misleading, but those comments are already fixed.

## 7. Recommended next steps (in priority order)

1. **Housekeeping (low risk, under a day):**
   - Add `data/**` to the eslint ignores so `npm run lint` is meaningful again.
   - Fix the CLAUDE.md drift above.
   - Regenerate or slim down `AGENTS.md` and `.agents/skills`.
   - Banner or refresh `README.md`, `IMPLEMENTATION_STATUS.md` and `.env.example`.
   - With your OK, close the 14 legacy runs and the stranded crawl through the app.
2. **Robustness before any wider demo:**
   - Boot-time reconciliation for crawls, discovery runs and prompt sets.
   - Map JSON `SyntaxError` and run-creation errors to 4xx.
   - Persist runner and vendor-health state, or rebuild it on restart.
3. **Measurement accuracy (the product's core promise):**
   - Work the Analysis/Measure items in KNOWN_ISSUES, starting with hedged recommendations, target aliases, the ranking intro pattern and negation.
   - Re-analyse stored runs and check them by hand (`scripts/measure-handcheck.ts`).
   - Bump `ANALYSIS_VERSION`.
4. **Product decisions needed from you:**
   - Bring back Gemini (cloro Lite at $30 is pre-approved).
   - Add recurring or scheduled runs (the cost models assume daily).
   - Wire more surfaces through Oxylabs.
   - Start the Actions layer. The 2026-10-24 research recommends M0: a rules-only "Plan" view inside Measure, with measurement fixes first. This would lift the "scope stops at Measure" line, so it needs an explicit decision.
5. **Security, if it ever leaves localhost:**
   - Close the SSRF gaps (route every fetch through the guard, pin resolved IPs, add IPv6 ranges).
   - Add authentication, at least for `/api/providers/credentials`.
6. **Cleanup:**
   - Remove dead clients, `GeminiProfileProvider` and the unused LLM stages.
   - Plan dropping the `jobs` table (a schema change, so coordinate with the running server).
