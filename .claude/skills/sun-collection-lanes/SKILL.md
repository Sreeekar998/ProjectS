---
name: sun-collection-lanes
description: Add or change an answer-collection route (a collection-provider lane), the background runner with its canary, breaker and handover, or the observation console, and debug stuck, paused or handed-over collection. Use when touching src/lib/collection, src/lib/providers, the Bright Data, cloro or Decodo clients, the collection APIs or observation-console.tsx, or when a run shows missing, failed or unverified answers.
---

# Working on collection (Observe inside Measure)

The guardrails in `.claude/rules/collection.md` load automatically. Three rules come before anything else:
- **Project Sun's own code never drives chatgpt.com or gemini.google.com.** Collection providers do that under their own terms; we call their APIs.
- **A fallback changes the route, never the label.** Same engine, same surface, every row keeps its own route id.
- **Never spend a vendor credit in a test.** `tests/setup.ts` deletes the vendor keys; clients are exercised with a stubbed `fetch`, the app with `scripts/mock-vendors.ts`.

## Anatomy
| Route id | Site | Provider | Client | Lane (`runner.ts` LANES) | Engine |
|---|---|---|---|---|---|
| `chatgpt_brightdata_web` | chatgpt.com, signed out, search permitted, country honoured | Bright Data ChatGPT Scraper API (`gd_m7aof0k82r803d5bjm`); 202 after ~60 s, snapshot ready in 5–12 min; link placeholders restored from `links_attached` | `lib/brightdata/client.ts` | `SUN_BRIGHTDATA_CONCURRENCY` (5), 20/min, 1 record per answer | chatgpt |
| `chatgpt_cloro_web` | chatgpt.com, signed out, search forced, country honoured | cloro `POST /v1/monitor/chatgpt`; sync ~32 s | `lib/cloro/client.ts` | `SUN_CLORO_CONCURRENCY` (1), 30/min, 7 credits per answer | chatgpt |
| `chatgpt_oxylabs_web` | chatgpt.com rendered, search on, `geo_location` = country name | Oxylabs Web Scraper API `source=chatgpt`; push-pull job (POST /v1/queries → poll → results); untested live until an `OXYLABS_AUTH` user:password exists | `lib/oxylabs/client.ts` | `SUN_OXYLABS_CONCURRENCY` (3), 20/min, 1 result per answer | chatgpt |
| `chatgpt_decodo_web` | chatgpt.com rendered, search on, **country not controllable** (origin unknown), model reported | Decodo Web Scraping API `target=chatgpt`; sync ~1–2 min; parsed answer under `content.results` | `lib/decodo/client.ts` | 2 concurrent, 20/min, 1 request per answer | chatgpt |
| `gemini_cloro_web` | gemini.google.com, signed out | cloro `POST /v1/monitor/gemini` | `lib/cloro/client.ts` | shares cloro's gate and credits | gemini |
| retired: `openai_api`, `groq_free_api`, `cerebras_free_api`, `gemini_free_api`, `chatgpt_manual`, `gemini_manual` | — | — | — | seeded `enabled: "false"`; stored rows keep their labels | — |

- **Default route per engine:** the first keyed, healthy route in `COLLECTION_ROUTES` (`nextRouteForEngine`). ChatGPT: Bright Data → cloro → Decodo. Gemini: cloro.
- **Keys are resolved in the server process:** env (`BRIGHTDATA_API_TOKEN`, `CLORO_API_KEY`, `DECODO_AUTH_TOKEN`) or keys saved in its DB from the console's Providers form.
- **Planning** checks `route_policies.enabled` (from `ROUTE_POLICY_SEED`) and, for consumer-web routes, that the key is present.
- **Pooling:** Measure pools answers by engine (`providers/engines.ts`); the method notes name each provider (`providers/catalog.ts` `ROUTE_METHOD`).
- **Surfaces:** `surfaceOf(route)` is `consumer_web`, `by_hand` or `api`; a switch never crosses surfaces.

## The lane life-cycle (what to expect in the console)
`waiting → checking (canary) → running / paced → done`, or `paused` with a `paceReason`: `vendor_unhealthy` (canary failed; vendor skipped for 6 h), `target_blocked` (three blocked or blank answers in a row; 30 min), `no_credits`, `key_rejected`, `budget_cap` (per-lane request cap), or a quota sentence. A paused lane with `continuedOn` handed its remaining prompts to that route; the run appended a lane for it. A run with a stranded lane sets `recheckAt` and re-checks itself every 30 minutes for a day.

## Adding or changing a route
1. **Client:** `src/lib/<vendor>/client.ts` exporting a `ConsumerCollector` (`collection/consumer-collector.ts`). It never throws. Map the vendor payload into `ConsumerAnswer`: text (markdown preferred), `model` only when the page named it, `searched` only when the vendor says, `sources` split into `citation` / `search_result` / `inline_link`, and **surface markers**. Fail closed with `schema_unrecognised` on an unknown shape; return `empty_response` for a blank page. Use the shared error vocabulary.
2. **Catalog:** `providers/catalog.ts` — `VENDORS` (name, key label and hint, docs URL, engines), `CONSUMER_WEB_ROUTES` (preference order), `ROUTE_LABEL`, `ROUTE_METHOD`, `CREDENTIAL_PROVIDER_IDS`. Client-safe: no server imports.
3. **Credentials:** `ENV_KEY` in `providers/credentials.ts`.
4. **Adapter:** add the collector to `COLLECTORS` in `collection/orchestrator.ts`; classify new error codes in `isPermanentFailure` / `isTargetFailure`.
5. **Lane:** add the route to `LANES` in `runner.ts` with an honest `creditsPerAnswer`.
6. **Policy:** add a `ROUTE_POLICY_SEED` row (`optional`, retention days, docs URL, a note that says who collects, how, and that the provider is not licensed by the site's owner) and add the id to `COLLECTION_ROUTES`. Re-bootstrap the DB your app uses.
7. **Engine:** add the route to `ROUTE_ENGINE` in `engines.ts`.
8. **Mock:** teach `scripts/mock-vendors.ts` the new vendor so the app can be verified without a credit.
9. **Tests:** a client test from a documented payload (`tests/fixtures/vendor-payloads.ts`), plus the runner and `consumer-web-routes` integration suites.
10. **Renames:** keep the old id in `ROUTE_ENGINE`, `ROUTE_LABEL` and `ROUTE_METHOD`; stored rows and idempotency keys keep it.

## Debugging a run
- **API:** `GET /api/collection-runs/<id>` returns per-row `state`, `lastError`, `attempts` and capture states, plus `runner` (`lanes[]` with `status`, `paceReason`, `resumesAt`, `continuedOn`, `requests`, `etaMs`; `recheckAt`). `GET /api/providers/credentials` returns which keys are present and which routes are keyed and healthy. `GET /api/provider-responses/<id>` lists the row's `artifacts` (`payload.json`, `page.html`).
- **Events** of type `collection_run.progress`: `canary_passed` / `canary_failed` (with markers, model, citations), `handover` (`from`, `to`), `handover_failed`, `surface_unverified` (an answer stored without site markers), `analysis_failed`, `lane_failed`.
- **SQL (read-only):**
  - `select provider_experience,state,last_error,attempts,count(*) from prompt_runs group by 1,2,3,4`
  - `select provider_experience,method,account_tier,search_state,sources_capture_state,answer_capture_state,visible_model_mode,observer_region from provider_responses`
- **Evidence:** `<evidence dir>/<project>/artifacts/<responseId>.payload.json` is the vendor payload verbatim; `.page.html` the rendered page when returned.
- **Known traps** (details in `docs/KNOWN_ISSUES.md`): a second run for the same approved set plans nothing on routes already used; switching back to an earlier route plans nothing; two runners double-call vendors; progress and vendor health are in memory.

## Testing patterns
- **Provider client:** set the env key in `beforeEach`, `vi.stubGlobal("fetch", …)` returning a documented payload, delete the key and `vi.unstubAllGlobals()` in `afterEach` (see `tests/unit/providers/brightdata-client.test.ts`). Bright Data's poll path uses fake timers.
- **Runner:** mock the orchestrator, repository, bus and credentials modules (`tests/unit/collection/runner.test.ts`); `resetVendorHealth()` in `beforeEach`.
- **Integration:** build an approved project as `tests/integration/consumer-web-routes.test.ts` does; keep vendor keys unset in the shell.

## Validate in the real app
1. **Mock vendors, no credits.** `npx tsx scripts/mock-vendors.ts` (port 3999), then the `sun-verify-vendors` launch entry (fake keys, mock base URLs, isolated data dir, port 3100). Approve a prompt set, press Collect, watch the lanes, then read Measure, the method notes and the evidence drawer.
2. **Handover.** Restart the mock with `SUN_MOCK_VENDORS_MODE="brightdata=blocked"` and Collect again: the Bright Data lane pauses `target_blocked` or `vendor_unhealthy` and a cloro lane appears.
3. **Real vendors** (spends credits; needs the operator's keys): `scripts/vendor-canary.ts` once per key; `scripts/vendor-crosscheck.ts --a chatgpt_brightdata_web --b chatgpt_cloro_web` on eight prompts before trusting a new vendor; then `scripts/observe-run.ts <projectId>` against an isolated server.
4. **Denominators.** Confirm paused, handed-over and unverified rows stay out of every denominator (`denominatorObservationIds` in the Measure JSON).
