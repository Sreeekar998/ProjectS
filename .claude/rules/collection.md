---
paths:
  - "src/lib/collection/**"
  - "src/lib/providers/**"
  - "src/lib/brightdata/**"
  - "src/lib/cloro/**"
  - "src/lib/decodo/**"
  - "src/lib/gemini/**"
  - "src/lib/openai/**"
  - "src/lib/groq/**"
  - "src/lib/cerebras/**"
  - "src/lib/*/client.ts"
  - "src/lib/evidence/artifacts.ts"
  - "src/components/features/observation-console.tsx"
  - "src/app/api/projects/*/collection-runs/**"
  - "src/app/api/collection-runs/**"
  - "src/app/api/prompt-runs/**"
  - "src/app/api/providers/**"
  - "scripts/vendor-canary.ts"
  - "scripts/vendor-crosscheck.ts"
  - "scripts/mock-vendors.ts"
  - "scripts/observe-run.ts"
  - "scripts/e2e-journey.ts"
  - "tests/unit/collection/**"
  - "tests/unit/providers/**"
  - "tests/fixtures/vendor-payloads.ts"
  - "tests/integration/route-switch.test.ts"
  - "tests/integration/consumer-web-routes.test.ts"
  - "tests/integration/manual-observation.test.ts"
---

# Observe / collection: guardrails

## What collection is (since 2026-09-14)
Every active route observes a **consumer web surface**: a collection provider (Bright Data, cloro, Decodo) opens chatgpt.com or gemini.google.com in a **signed-out browser session** from the project's market country, sends the prompt with web search on, and returns what the page showed. The model-API lanes and by-hand capture were retired by operator decision the same day: API answers never searched the web and were not what a person sees; by-hand capture is no longer a product feature. Their route ids stay seeded and disabled so stored rows keep an honest label. The decision record is `docs/CHATGPT_CONSUMER_COLLECTION_DECISION_MEMO.md`.

**No provider is licensed or authorized by OpenAI or Google.** Each contract makes the customer responsible for lawful use and requires the customer to indemnify the provider. The product therefore never says "licensed"; every answer records which provider collected it.

## How it flows
1. **Creating a run.** The Measure console creates a run (`POST …/collection-runs`) with no route list; the server picks one consumer-web route per engine: the first in `COLLECTION_ROUTES` whose provider key is present and whose vendor is healthy (`nextRouteForEngine`). No key → `NoCollectionRouteError` (409 `no_collection_route`). Run creation requires the project's **latest** prompt-set version to be approved with exactly 30 `USER_APPROVED` rows. After that the console reuses the project's latest run, adding routes via `POST /api/collection-runs/[id]/routes`.
2. **Planning.** `planPromptRuns` creates one `prompt_run` per prompt × route. A consumer-web route is `planned` only when its policy row is `optional` and its key is present; otherwise `policy_disabled`. Retired routes (`openai_api`, `groq_free_api`, `cerebras_free_api`, `gemini_free_api`, `chatgpt_manual`, `gemini_manual`) always plan as `policy_disabled`; the API still accepts their ids so old scripts do not break.
3. **Running.** `POST /api/collection-runs/[id]/collect` starts the in-process runner (`runner.ts`): one lane per route, each with concurrency, a pacer and retry caps. Per lane, in order:
   - **Canary.** Unless the vendor passed one in the last 6 h, one brand-neutral prompt (`CANARY_PROMPT`) is asked and judged like a real answer (surface markers, not blank). Fail → vendor unhealthy for 6 h, lane `paused` with `paceReason = vendor_unhealthy`, and the run **hands over** (below). A bad key or no credits → `key_rejected` / `no_credits`, then hand over.
   - **Discovery first**, then Trade Offs, then Sentiment.
   - **Breaker.** Three `target_blocked` / `empty_response` / `schema_unrecognised` answers in a row → vendor unhealthy for 30 min, lane `paused` (`target_blocked`), hand over.
   - **Credits.** When the vendor reports fewer credits left than one answer costs (`creditsPerAnswer` in `LANES`), the lane pauses `no_credits` and hands over.
   - **Request cap.** `SUN_COLLECTION_MAX_REQUESTS_PER_LANE` (default 60, counting the canary) pauses the lane `budget_cap`.
   - **Quota and rate limits** pause as before (retry-after over 3 min, or 4 refusals in a row); a `billing_required` / `auth_failed` outcome puts that prompt back to `planned` without counting an attempt (`retryPromptRun(id, { countAttempt: false })`).
   - **Hand over** = `switchAutomatedRoute(run, from, to)` to the next keyed, healthy route for the same engine on the same surface; a new lane is appended and run in the same execution. The old lane records `continuedOn`. No route left → the lane stays paused and the run **re-checks by itself every 30 min for 24 h** (`recheckAt`).
4. **On success,** in order: evidence blob → `provider_responses` row (immutable, one per run) → artifacts (`payload.json`, `page.html` when returned) → v1 parser → `analyseObservationById` → run `succeeded`.
5. **By-hand path.** `recordManualObservation` and `POST /api/prompt-runs/[id]/manual-capture` remain for stored rows and QA fixtures only; the console no longer offers them and the policy rows are disabled.

## Invariants
- **Project Sun's own code never drives chatgpt.com or gemini.google.com.** No browser automation, DOM reading, cookie or session reuse, or scraping in this repo. The providers do that under their own terms; we call their APIs.
- **A fallback changes the route, never the label.** `switchAutomatedRoute` refuses a different engine or a different surface. Every row keeps its own route id; Measure reports by engine and surface only. **No vendor is named in Measure** (console, method notes, Report, Answers, exports): `ROUTE_LABEL`/`ROUTE_METHOD` describe the site and session, `surfaceLabel()` in `providers/engines.ts` is the reader-facing name, and `measure/public.ts` re-keys route-scoped blocks for exports. Vendor names live only in `providers/catalog.ts`, the stored rows and logs; keys are set in `.env.local` or through `POST /api/providers/credentials` (no key form in the app).
- **Never label a provider "licensed"** in UI copy, method notes, route-policy notes or client material.
- **Free tiers, no surprises.** The canary, the credit check and the request cap exist so a run never crosses from free into paid by accident. A new vendor lane sets `creditsPerAnswer` honestly (cloro 7 sync; Bright Data and Decodo 1).
- **Gaps are not absences.** A failed, paused, handed-over-but-unfinished or unanalysed observation is a coverage gap. Clients return typed `{ok:false}`; no `provider_response` is written; Measure synthesizes `NOT_CAPTURED`.
- **Blank answers are failures.** `answerLooksEmpty` (no citations and under ~160 characters, or a widget placeholder) → `empty_response`, retried once, never stored. cloro bills these; that is why the cap exists.
- **Surface markers decide the label.** `markersPass` needs a known payload shape plus a site-only fact (chatgpt.com URL, `utm_source=chatgpt.com` on cited links, rendered HTML, the search queries the assistant ran). Without them the row is stored with `sourcesCaptureState = unknown`, `answerCaptureState = unknown`, an event `surface_unverified`, and it never enters a citation denominator.
- **Honest provenance on every row.** `route = consumer_app`, `method = automated_partner`, `accountTier = signed_out`, `visibleModelMode` = the model the page named or `unknown` (never guessed; cloro and Bright Data usually cannot read it), `searchState` = `on`/`off` from the vendor or `unknown`, `observerRegion` = the country sent to the vendor with `observerRegionSource = provider_declared`, `intendedMarket` = the prompt's place or the project market, `sessionProfile` = signed-out, fresh conversation, personalisation off, with the vendor and search mode in `notes`, `sourceUrls` = the page's citations, `inlineCitationUrls` = links in the answer body.
- **Source capture:** citations present → `complete`; vendor says search did not run and none → `none_present`; search on or unknown and none → `unknown` (a sources panel may have been missed; never a zero).
- **Country is execution origin, not market.** `observationGeography` sends the project's primary market country (or `SUN_COLLECTION_DEFAULT_COUNTRY`, default US) as the proxy country. It is recorded as where the answer was observed from, never as what the prompt is about.
- **Artifacts never fail a capture.** `storeArtifact` swallows errors; the raw payload and page are evidence, the answer text is the observation.
- **Controlled writes.** State changes go through `transition()`; legal edges live in `state-machine.ts`. `provider_responses` is insert-only.
- **Provider clients never throw.** Error vocabulary: `<vendor>_disabled`, `auth_failed`, `billing_required`, `rate_limited`, `timeout`, `network_error`, `empty_response`, `target_blocked`, `schema_unrecognised`, `engine_unsupported`, `http_<status>`, `provider_error: …`. Classify new codes in `isPermanentFailure` and `isTargetFailure` (`collection/orchestrator.ts`).
- **cloro concurrency is per key**, shared by the ChatGPT and Gemini lanes; the client's semaphore (`SUN_CLORO_CONCURRENCY`, default 1) enforces it, not the lanes.
- **Vendor health is in-process** (`vendor-health.ts`): a restart forgets it and the next Collect runs the canary again.

## Adding or changing a route touches all of these
- `src/lib/<vendor>/client.ts` implementing `ConsumerCollector` (`collection/consumer-collector.ts`): map the payload to `ConsumerAnswer` with markers; fail closed (`schema_unrecognised`) on an unknown shape.
- `providers/catalog.ts`: `VENDORS`, `CONSUMER_WEB_ROUTES` (preference order), `ROUTE_LABEL`, `ROUTE_METHOD`, `CREDENTIAL_PROVIDER_IDS`.
- `providers/credentials.ts`: `ENV_KEY`. `providers/engines.ts`: `ROUTE_ENGINE`.
- `collection/orchestrator.ts`: `COLLECTORS`. `runner.ts`: `LANES` (concurrency, pacer, retries, `creditsPerAnswer`).
- `ROUTE_POLICY_SEED` and `COLLECTION_ROUTES`; then re-bootstrap the DB your app uses (`SUN_DATA_DIR=<dir> npm run db:init`, or restart that server). A missing row makes every run `policy_disabled`.
- The zod enums derive from `ALL_ROUTE_IDS` / `AUTOMATED_ROUTE_IDS` / `CREDENTIAL_PROVIDERS`; the console derives its labels and key form from `catalog.ts`.
- Tests: a client test from a documented payload (`tests/fixtures/vendor-payloads.ts`), and the runner and integration suites.
- `scripts/mock-vendors.ts` if the app should be runnable against a stand-in for the new vendor.

## Engine scope (2026-09-15, operator decision)
`SUN_ENGINES` (`providers/engine-scope.ts`) says which engines are collected and shown; the default is **ChatGPT only** ("hide Gemini for now"). A hidden engine gets no default route, `nextRouteForEngine` returns null for it, the console and Measure copy name only the enabled engines, and the engine switch disappears when one engine is measured. Stored Gemini rows are untouched. `SUN_PREFERRED_ROUTES` moves listed route ids to the front of the provider order (for example `chatgpt_brightdata_web` for free test runs while cloro credits are kept for the demo). The credentials endpoint returns `engines` and the ordered `routes` so the client never reads env.

## Route order (2026-09-15, after two live comparisons on the same six prompts)
ChatGPT: **Oxylabs → cloro → Bright Data → Decodo**; Gemini: cloro (hidden by default, see engine scope). Oxylabs (`lib/oxylabs/client.ts`, push-pull jobs, `OXYLABS_AUTH=username:password` of a Web Scraper API user) was fastest (median 43 s), the most local (34 `.in` sources, rupee prices) and reported the page's model on every answer; its free trial is about 770 rendered answers and it has no pay-as-you-go afterwards ($49 a month). cloro was next (69 s, clean text, country honoured; the operator accepted its $30 Lite plan if needed: `SUN_CLORO_CONCURRENCY=10` after upgrading). Bright Data is the free, slow fallback (5–14 minutes an answer). Decodo is last because it cannot be placed in a country. `SUN_PREFERRED_ROUTES` overrides the order without a code change.

## What the real vendors did (2026-09-15, first live requests)
- **Bright Data:** the sync endpoint answers 202 after ~60 s; the snapshot was ready after 339 s and 724 s. Country sent as `country` is echoed back; without one the exit is arbitrary (Swedish prices), so a country is always sent. `model` was null. Inline links arrive as `[n]` placeholders with the text in `links_attached[].position`; `restorePlaceholders` puts them back. Lane concurrency is 5 (`SUN_BRIGHTDATA_CONCURRENCY`), poll budget 15 min (`SUN_BRIGHTDATA_POLL_MAX_MS`).
- **cloro:** ~32 s per ChatGPT answer, ~35 s Gemini; `model` empty; sources with positions and utm tags; credits in headers (7 and 6 per answer).
- **Decodo:** ~1–2 min; the parsed answer is under `content.results`; `llm_model` populated (`gpt-5-6`); every request with `geo` failed with status 613, an untargeted request exited through Vietnam, so `geo` is opt-in (`SUN_DECODO_GEO=1`) and Decodo rows carry `observer_region = null`, `observer_region_source = unknown`. A `{"status":"failed"}` envelope (HTTP 200 or 400) is `target_blocked`.

## Pitfalls
- **Global idempotency key.** It is `sha256(project|promptSet|candidate|route|1)`, not run-scoped. A second run for the same approved set plans nothing on routes already planned, yet becomes the "latest" run.
- **No cross-process protection.** Two processes on one data dir can call vendors twice and spend credits twice.
- **Handover and history.** A handed-over lane shows `continuedOn`; its retired rows are `policy_disabled` with `lastError = moved_to_<route>`. Switching back to a route used earlier plans nothing (idempotency key).
- **Key precedence.** Env keys beat UI-stored keys; the DB cache fills only via `loadCredentials()`.
- **Progress is in memory.** Runner progress and vendor health are lost on restart; the next Collect fails `running` rows as `interrupted` and runs the canary again.
- **cloro's free tier** is 500 credits a month, 1 concurrent job: roughly 70 ChatGPT answers; a full 30-prompt run costs about 217 credits.
- **Decodo screenshots are not taken:** a screenshot request is a second conversation, so it would not picture the parsed answer.

## Validate
- `npx vitest run --no-cache tests/unit/collection tests/unit/providers tests/integration/route-switch.test.ts tests/integration/consumer-web-routes.test.ts tests/integration/manual-observation.test.ts` (keep vendor keys unset in the shell; `tests/setup.ts` deletes them).
- Real app without credits: run `npx tsx scripts/mock-vendors.ts`, start the `sun-verify-vendors` launch entry, approve a prompt set, press Collect, and read the lanes, Measure and the evidence drawer. `SUN_MOCK_VENDORS_MODE="brightdata=blocked"` exercises the handover.
- Real vendors: `scripts/vendor-canary.ts` (one request per keyed route) before the first run; `scripts/vendor-crosscheck.ts` (two vendors, eight prompts) before trusting a new vendor.
