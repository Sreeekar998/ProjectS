# Project Sun — Phase 2 app

Project Sun measures how visible one business is in AI answers. The pipeline:
1. Crawl the business website into an evidence-backed Brand Profile.
2. Confirm topics and competitors.
3. Build a frozen 30-prompt measurement set.
4. Collect ChatGPT and Gemini answers from the assistants' own websites through collection providers (Bright Data, cloro, Decodo) that open the site in a signed-out browser session.
5. Analyse every answer with deterministic rules.
6. Report `x of n` metrics that trace back to individual answers.

It is a local-first, single-operator Next.js 15 app (no auth, no tenancy) built for an interview/demo setting. It started from `Project_Sun_Phase2_Final_Technical_Implementation_Specification_v2.docx`, which is not in the repo, and has deliberately diverged from it (see "Decisions that override the spec").

This file is the always-loaded map. Area guardrails load automatically from `.Codex/rules/` when you touch matching files. Step-by-step workflows are in `.Codex/skills/`. Audited defects are listed in `docs/KNOWN_ISSUES.md`. Treat all of this as context, not law: the code is the source of truth, and you may improve on the current design when you can justify it.

## How to work here
- **Work loop.** Understand the request → inspect the current code (not memory, not these docs) → find the root cause → research when useful → pick the best approach → implement → **run the real app and read the actual output** → iterate. Passing tests do not mean done. Most regressions here are quality regressions (a wrong profile field, an irrelevant competitor, a template-sounding prompt, a shifted denominator) that only real output reveals.
- **Push back once.** If a requested approach is wrong, say so and propose a better one, with evidence. Once the user makes an explicit product decision, push back at most once, then implement it.
- **Parallel agents.** Other agents (Codex and others) edit this repo, sometimes at the same time. Re-read a file right before editing it (check `ls -lt`), work from the current state, and never overwrite unrelated changes. Use your own data dir, port and scratch files, and delete only what you created.
- **No git.** This is not a git repo, so there is no diff or revert. Snapshot before risky or wide edits (`sun-validate` §0), and don't `git init` unless asked.
- **Honest reporting.** Report only what you verified, and say what you did not verify.
- **Scope stops at Measure.** There is no Actions/recommendations layer. Change only the pages and areas a task covers.

## Live environment: don't damage it
- **The user's server and DB.** The user often runs `npm run dev` or `npm start` on :3000 against `data/sun.db`, which holds real projects. Don't experiment on that DB, don't `db:reset` it, and don't restart or kill a server that backs their work or a running job. The user prefers that no Project Sun servers are left running at the end of a response (they restart their own). If a server backs a page or job they are using, leave it and say so. Never kill the user's browser.
- **Default data dirs are the live ones.** Anything that bootstraps or opens the DB without `SUN_DATA_DIR`/`SUN_EVIDENCE_DIR` uses `./data` and `./evidence-store`, applies pending migrations there, and re-seeds `route_policies`. That includes `npm run dev/build/start/db:init/verify`, the benchmarks, and the tsx scripts (`probe-discovery`, `prompt-quality-compare`, `reanalyse`, …).
- **HTTP scripts default to :3000.** `e2e-journey.ts`, `regenerate-prompts.ts` and `observe-run.ts` default `SUN_BASE` to the user's :3000. Point them at your isolated server.
- **Schema edits affect running servers.** Editing `src/lib/db/schema.ts` breaks queries in a running dev server (HMR) until it restarts and migrates. Coordinate with the user first (`.Codex/rules/platform.md`).
- **`.env.local` has real keys:** Gemini, Groq, Cerebras and **paid** OpenAI. Next loads it; tsx scripts and vitest don't, except `scripts/probe-openai.ts`. Never print key values.

## Product scope and hard lines
- **Journey:** `/` → `/trial/new` → four `JourneyNav` stages: **Understand → Landscape → Prompts → Measure**. Collection is not a stage; it is the observation console on Measure, and `/projects/[id]/collect` only redirects there. Don't reintroduce an Observe or collect page (the user rejected it repeatedly).
- **Project Sun's own code never drives chatgpt.com or gemini.google.com.** No browser driving, DOM reading, cookie/session reuse or scraping in this repo. Collection goes through collection providers (Oxylabs first, then cloro, Bright Data, Decodo for ChatGPT; cloro for Gemini) that open the site in a signed-out browser session under their own terms; we call their APIs. Order chosen 2026-09-15 from two live comparisons (Oxylabs fastest and most local, reports the model); cloro's $30 Lite plan is approved if needed (`SUN_CLORO_CONCURRENCY=10` once upgraded). **Gemini is hidden for now:** `SUN_ENGINES` defaults to `chatgpt` (`providers/engine-scope.ts`); `SUN_ENGINES=chatgpt,gemini` brings it back, and `SUN_PREFERRED_ROUTES` reorders providers (e.g. free Bright Data test runs). No provider is licensed by OpenAI or Google and the product never says "licensed" (`docs/CHATGPT_CONSUMER_COLLECTION_DECISION_MEMO.md`).
- **Retired on 2026-09-14 (operator decision):** the model-API collection lanes (`openai_api`, `groq_free_api`, `cerebras_free_api`, `gemini_free_api`) and by-hand capture (`chatgpt_manual`, `gemini_manual`). Their route ids stay seeded and disabled so stored rows keep an honest label. Don't reintroduce either as a product lane.
- **No paid spend without explicit user approval.** The app must work with no keys.
  - Onboarding model calls go through `lib/llm` stage routing. On 2026-09-13 the user approved paid OpenAI for **Understand and Prompts** ("good quality but cost effective"): gpt-5.6-luna for understanding and prompt planning, gpt-5.6-terra for prompt writing (~$0.01 + ~$0.10 per business). **Landscape stages stay on free Gemini** unless `SUN_ALLOW_PAID_LANDSCAPE=1` (not approved). `SUN_LLM_NO_PAID=1` turns every paid route off.
  - Collection providers have free tiers (Bright Data 5,000 records a month, cloro 500 credits a month at 7 per ChatGPT answer and 6 per Gemini answer, Decodo 2,000 standard requests a month which is about 670 ChatGPT answers); the runner's canary, credit check and per-lane request cap keep a run inside them. Credit-spending commands: `scripts/vendor-canary.ts`, `scripts/vendor-crosscheck.ts`, `scripts/observe-run.ts`, `scripts/e2e-journey.ts` without `SUN_SKIP_OBSERVE=1`, and "Collect answers" in the UI; `scripts/mock-vendors.ts` with the `sun-verify-vendors` launch entry runs everything without a credit.
  - A Gemini key is free only while billing is off: the Gemini lane asks for Google Search grounding first, and grounding bills on billing-enabled keys. The account's key is free-tier: Gemini 2.5 models return 404 for it and Gemini 3.x grounding returns 429 (no free quota).
  - Groq and Cerebras are free tiers with quotas.
  - Paid-capable commands: `scripts/probe-openai.ts` (always paid); `scripts/observe-run.ts` and `scripts/e2e-journey.ts` without `SUN_SKIP_OBSERVE=1` (they start collection on the target server's keyed routes); "Collect automatically" in the UI.
- **Website text is untrusted data.** It never enters a model's system instructions, and profile synthesis passes it as id-addressed evidence.
- **No hardcoded brands, expected competitors, prompts or metric values in `src/`.** Generality is judged on arbitrary sites. Nike is one regression check; always test unrelated business types too. Measuring-stick lists belong in `benchmarks/` or `scripts/`.
- **UI labels:** results name answer engines only as **ChatGPT** and **Gemini** ("on the web"; older rows "asked by hand" or a retired API route). Which provider collected an answer, the model the page named and the search state live in Measure's collapsed method notes. The console's Providers form names Oxylabs, cloro, Bright Data and Decodo so the operator knows which key to paste.
- **Honest numbers:**
  - A failed, uncaptured or unanalysed answer is a coverage gap, never brand absence.
  - A zero denominator renders `—`, never 0%.
  - Partial runs are marked "so far".

## Pipeline and data flow
| Stage | Entry (UI / API) | Core code | Persists | Gate |
|---|---|---|---|---|
| Understand | `/trial/new`, `/projects/[id]/understand`; `POST /api/projects`, `POST …/crawl` (202), `GET /api/geo/search`, `POST /api/geo/place` | `lib/crawler`, `lib/evidence`, `lib/profile`, `lib/understanding` (classification, location), `lib/llm`, `lib/geo`, `lib/security` | `crawl_runs`, `crawl_pages` (every attempted URL), `evidence_items` (cited by profile fields), `evidence_chunks` (read by competitor discovery), `business_profile_versions`, `locations`; page text in `evidence-store/` | Profile version confirmed (`PATCH …/profile`); every edit creates a new version |
| Landscape | `/projects/[id]/landscape`; `POST …/landscape/generate` (202), `PATCH …/landscape` | `lib/landscape` | `topics`, `entities`, `aliases`, `competitor_discovery_runs`, `competitive_set_versions` (append-only, hashed) | 4–6 confirmed topics + ≥1 confirmed non-marketplace competitor → frozen competitive set |
| Prompts | `/projects/[id]/prompts`; `POST …/prompts/generate` (202; `?force=1` makes a new version), `PATCH /api/prompt-sets/[id]`, `…/custom-prompts`, `…/approve` | `lib/prompts` | `prompt_context_snapshots`, `prompt_sets` (versioned), `prompt_candidates` (never deleted) | Approve exactly 30 (10 Discovery / 10 Trade Offs / 10 Sentiment Analysis) → `USER_APPROVED` + set `frozenHash` |
| Observe (inside Measure) | console on `/projects/[id]/measure`; `POST …/collection-runs`, `POST /api/collection-runs/[id]/routes`, `POST /api/collection-runs/[id]/collect` (202), `GET/POST/DELETE /api/providers/credentials` | `lib/collection` (orchestrator, runner with canary/breaker/handover, `consumer-collector.ts`, `vendor-health.ts`), `lib/providers` (`catalog.ts`, seed, credentials, engines), `lib/{brightdata,cloro,decodo}` | `collection_runs`, `prompt_runs` (state machine), `provider_responses` (immutable, one per run), `provider_credentials`, `route_policies`; vendor payload and page in `evidence-store/<project>/artifacts/` | — |
| Analysis | runs synchronously after each capture | `lib/analysis` (rule-based, no LLM); legacy `lib/metrics` v1 parser still writes `mentions`/`citations` | `observation_analyses` (one row per response × `ANALYSIS_VERSION`) | — |
| Measure | `GET /api/projects/[id]/measure?run=` (live, or the finalised run's snapshot), `…/measure/history`, `…/measure/export?format=csv\|json`, `POST /api/collection-runs/[id]/finalise`, `POST …/reanalyse` | `measure/service.ts` → pure `measure/engine.ts`; `measure/compare.ts` (breaks, cautions, deltas); `measure/snapshots.ts`; `collection/finalise.ts`; definitions in `measure/policy.ts`; page `projects/[id]/measure/page.tsx` + `components/features/measure/*` (Overview, Performance, Brands, Sources, Opportunities, Methodology) | `measurement_snapshots` (one row per finalised run per versions served); `collection_runs.completed_at/finalised_by` | `docs/MEASURE_WORKSPACE_DESIGN.md` |

Couplings that surprise people:
- **Each stage reads the latest upstream artefact:**
  - Landscape generation needs the **latest** profile version confirmed. Landscape confirm freezes against it without re-checking.
  - Prompts use the latest frozen competitive set and the profile version *that set* pins, which must be confirmed.
  - Creating a collection run requires the **latest** prompt-set version to be approved. After that, the console keeps reusing the project's latest run.
  - Measure shows the selected run (`?run=`, default latest) and pins every denominator to the competitive set the prompt set was generated from; analysis links against that frozen set too. A run is closed automatically when every answer is collected and analysed, or by "Finish with what's collected"; a closed run never reopens, and "Collect again" starts a new one (run-scoped idempotency keys).
  - Analysis links mentions against *live* confirmed entities.
- **Geography:** prompts use the levelled places (neighbourhood, nearby areas, city, region, country) derived from the pinned profile's `location` and frozen into the prompt context snapshot (`prompt-context@2`), for generation, regeneration and approval alike. Only older snapshots without `geography.places` still read the insert-only `locations` table.
- **Classification:** `profile.classification.kind` (closed family in `understanding/kinds.ts`) drives regulated handling, place-bound behaviour, the archetype mirror and the prompt choice unit. `archetype` is now a mirror for older readers.
- **Name forms:** `lib/landscape/name-forms.ts` feeds competitor leakage terms, the spoken target and rival names in Trade Off/Sentiment prompts ("Atelier 10" for "Atelier 10 Salon" on atelier10.ae) and the `TARGET_REQUIRED` check, plus mention linking for every entity in analysis. The target's own Discovery leakage lexicon is built separately in `prompts/validators.ts`.

## Runtime model (details: `.Codex/rules/platform.md`)
- **One server process per data dir.** React 19 client pages call zod-validated JSON routes through `src/lib/client/api.ts`.
- **Background work is in-process.** Long work runs fire-and-forget (`void job()` + 202). There is no queue (the `jobs` table is unused) and no boot reconciliation.
  - A restart mid-job strands rows: crawl runs stay `running` and their profile version stays `partial`, discovery runs stay `running`, prompt sets stay `generating`.
  - Only collection recovers orphaned rows.
- **SQLite:** better-sqlite3 (synchronous) + drizzle. `getDb()` applies `drizzle/` migrations the first time a process uses the DB.
- **Progress:** `appendEvent()` writes per-project sequenced `events`. Clients use SSE plus an always-on 2.5 s poll. Most pages treat events as refetch triggers, but the Understand progress rail renders payload fields directly, so event type strings and payload keys are both contracts.

## Commands (repo root, Node ≥ 20.11)
nvm still has Node v15–v17. On v15/v16 `tsx` dies with a misleading `SyntaxError: Unexpected token '{'`, and on v17 Next refuses to start. Fix: `export PATH="$HOME/.nvm/versions/node/v20.13.0/bin:$PATH"`.

| Command | Notes |
|---|---|
| `npm run dev` | Bootstrap, then `next dev` on :3000 (`.next`). With :3000 busy and no `PORT`, it moves to another port but still uses `.next`; with `PORT` set it exits |
| `npm start` | The user's demo command. At startup it runs the bootstrap and rebuilds `.next-build` if sources changed, then serves `.next-build`. Later edits aren't served until restart |
| `npm run build` | Bootstrap + `NEXT_DIST_DIR=.next-build next build`. **Never run bare `next build`**: it clobbers the dev server's `.next`. For validation set `SUN_DATA_DIR`/`SUN_EVIDENCE_DIR`, and don't rebuild while the user's `npm start` serves `.next-build` |
| `npm run typecheck` · `npm run lint` | Strict tsc (writes `tsconfig.tsbuildinfo`). Lint: 0 errors; about 100 pre-existing warnings, mostly `no-explicit-any` |
| `npm test` | Vitest: unit, integration, security, benchmark. Needs internet. Overwrites `BENCHMARK_REPORT.md` and `benchmarks/business-profile/expected/fixture-report.md` |
| `SUN_DATA_DIR=<scratch>/data SUN_EVIDENCE_DIR=<scratch>/evidence npx tsx scripts/eval-onboarding.ts --out <scratch>/out --with-env-keys` | Golden-set evaluation of Understand → Landscape → Prompts over `benchmarks/onboarding/golden-businesses.json`. Crawls real sites; with `--with-env-keys` makes paid Understand/Prompts calls (about $0.1 per business). Refuses `./data` |
| `npm run test:e2e` | Playwright on :3100 (`.next-e2e`, `data/e2e`, desktop + mobile). Reuses any server already on :3100; writes evidence into the shared `./evidence-store`; makes real Gemini calls. Has known pre-existing failures |
| `npm run clean-room` | Fresh temp DB: migrations, route-policy seed, one project, capability gates. Does not start Next |
| `npm run db:init` · `npm run db:reset` | Bootstrap · delete the DB and evidence store. Both target `./data` unless `SUN_DATA_DIR` is set, so never run them on the user's data without asking |
| `npx drizzle-kit generate --name <slug>` | New migration after editing `schema.ts` (no npm script). Follow the steps in `.Codex/rules/platform.md` |
| `SUN_BASE=<isolated> SUN_SKIP_OBSERVE=1 npx tsx scripts/e2e-journey.ts <url>` | Smoke run of the whole journey over HTTP, printing each stage's output. It confirms the profile, **every** topic and competitor row (including system-rejected ones) and approves the prompts; without `SUN_SKIP_OBSERVE=1` it also starts collection. It is not an operator review |
| `scripts/regenerate-prompts.ts`, `prompt-quality-compare.ts`, `observe-run.ts`, `probe-discovery.ts`, `reanalyse.ts` | Output-inspection tools with side effects: a new unapproved prompt-set version, DB writes, quota or paid calls. Read the matching skill before running one |

## Validation (details: `sun-validate` skill)
1. **Tests:** run targeted vitest for the area. Each test file gets a temp DB, and tests run **without** a Gemini key, so the live AI paths have no automated coverage.
2. **Static checks:** `npm run typecheck` and `npm run lint`, plus an isolated `npm run build` when routes, config or dependencies change.
3. **Real app:** run it on your own data dir, evidence dir, dist dir and port. The `sun-verify` entry in `.Codex/launch.json` does this; copy it with unique values if another agent may be using it. Walk the affected stages and read the real output.
4. **Baseline:** compare against a baseline before calling an e2e or benchmark failure a regression.

## Conventions (details in the rule files)
- **Data access:** prefer the per-domain `repository.ts`. Route handlers wrap everything, including `Schema.parse(await req.json())`, in `withErrorHandling`, so a ZodError becomes a 400. Map new domain errors in `src/lib/http/respond.ts`.
- **Immutability:** versioned artefacts are never deleted, and frozen or approved ones are never mutated; create a new version instead. Competitive set versions, provider responses and observation analyses are append-only.
- **Bump versions on purpose:**
  - `ANALYSIS_VERSION` when analysis output changes;
  - `METRIC_POLICY_VERSION` for metric semantics, together with the definition text;
  - `COMPETITOR_DISCOVERY_POLICY_VERSION` for discovery;
  - `COVERAGE_POLICY_VERSION` for prompt selection policy.
- **Heuristics:** general and English-centric. Code comments name the real incident behind each rule; keep that style.
- **Client code:** client-imported modules stay server-free. Style with `cn()`, `src/components/ui/*` and the Tailwind v4 tokens in `src/app/globals.css`; a missing shade silently renders nothing.

## Decisions that override the spec (don't "fix" these back)
- **Section split.** 10/10/10 replaced the original 21 Discovery / 4 Trade Offs / 5 Sentiment Analysis split (written "21/4/5", or "21/5/4" in cohort order). The old numbers linger in `IMPLEMENTATION_STATUS.md`, some test titles and the benchmark report footer.
- **Business understanding.** An open, evidence-grounded classification (industry path + closed `kind`) and a first-class location replaced the fixed industry/archetype choice and country-only markets. The intake page asks only for the URL; language defaults to English (`docs/ONBOARDING_INTELLIGENCE.md`).
- **Collection (2026-09-14).** Consumer-web routes through collection providers replaced both the model-API lanes and by-hand capture: the operator ruled that API answers do not serve the product and that a by-hand panel makes the app look bad. One provider per engine per run; the next keyed provider takes over when one fails (same engine, same surface, never relabelled). Engine labels (ChatGPT/Gemini) pool the web answers; each row still stores its real route, provider, session profile and the country it was observed from.
- **Measurement.** Deterministic, versioned analysis (`lib/analysis`) and policy-driven Measure (`lib/measure`) replaced the v1 metrics. `lib/metrics` survives only as the legacy mention/citation parser.
- **Prompt generation.** The frame planner, realizer and Gemini intent model replaced the per-cell template generator. `coverage-policy.ts` "cells" are vestigial: persisted and counted, nothing more.

## Docs and comments you can't fully trust
- **`README.md`** is partly stale:
  - "5-screen journey";
  - the drawer "shows matched mentions";
  - "Provisional" (the UI says "so far");
  - `clean-room` "completes a project";
  - the repository-pattern claim;
  - the SSRF "Security posture" (overstated; see KNOWN_ISSUES);
  - `cp .env.example .env.local` copies stale crawl limits.
- **`docs/WEBSITE_INTELLIGENCE.md`** overstates the evidence invariant for rules-only profiles: some markets and archetypes carry no evidence ids.
- **Stale:**
  - `IMPLEMENTATION_STATUS.md` (a 2026-09-09 snapshot);
  - the `LandscapeNotConfirmedError` message ("direct or substitute" only);
  - `.env.example`;
  - the `capability-gates.ts` constants `openaiApiEnabled:false` / `zeroAdditionalSpend:true`, which only clean-room asserts.
- **Misleading code comments:**
  - `providers/credentials.ts` says keys are not cached (they are, after `loadCredentials()`);
  - `route-policy-seed.ts` says two free routes carry collection (there are four automated routes, one paid);
  - `gemini/client.ts` says the resolved model is recorded (the requested alias is);
  - `schema.ts` comments on `prompt_runs.provider_experience`, `provider_responses.route/method` (actual values: `api`/`consumer_app`, `automated`/`manual`) and `provider_credentials.provider`.
- **Misleading names:**
  - `metric.snapshot.updated` is a spec event family; nothing is snapshotted.
  - `coverageCellKey` holds frame/intent keys, not cells.
  - `normalizeProviderResponse` is the legacy v1 parser, not the analysis "normalization".

## Guidance index
- **Rules** (auto-loaded by path): `.Codex/rules/website-intelligence.md`, `landscape.md`, `prompts.md`, `collection.md`, `analysis-measure.md`, `platform.md`, `journey-ui.md`.
- **Skills:**
  - `sun-validate`: end-to-end validation
  - `sun-profile-quality`: crawl and Brand Profile
  - `sun-landscape-quality`: topics and competitors
  - `sun-prompt-quality`: the 30 prompts
  - `sun-collection-lanes`: routes, runner, manual capture
  - `sun-measurement-change`: analysis and metrics
- **`docs/ONBOARDING_INTELLIGENCE.md`:** Understand → Landscape → Prompts v2 (classification, location, local competitor sources, prompt geography, model routing and costs, golden evaluation).
- **`docs/KNOWN_ISSUES.md`:** defects from a read-only audit on 2026-09-13, each tagged probe, e2e or code. Check it before assuming a behaviour is intended, and remove entries you fix.
