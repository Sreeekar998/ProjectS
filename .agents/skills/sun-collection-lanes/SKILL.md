---
name: sun-collection-lanes
description: Add or change an answer-collection route (a provider lane), the background runner, manual by-hand capture, or the observation console, and debug stuck, paused or failed collection. Use when touching src/lib/collection, src/lib/providers, the Gemini/OpenAI/Groq/Cerebras clients, the collection APIs or observation-console.tsx, or when a run shows missing or failed answers.
---

# Working on collection (Observe inside Measure)

The guardrails in `.Codex/rules/collection.md` load automatically. Two rules come before anything else:
- **Never automate the consumer ChatGPT or Gemini apps.**
- **Never start a paid lane (`openai_api`, or Gemini with billing enabled) or run `scripts/probe-openai.ts` without the user's explicit OK.**

## Anatomy
| Route id | Kind | Client | Lane (`runner.ts` LANES) | Engine |
|---|---|---|---|---|
| `gemini_free_api` | automated; free unless the key has billing enabled (grounded first, then plain fallback) | `lib/gemini/client.ts` (`gemini-flash-lite-latest`) | 3 concurrent, 14 requests/min window | gemini |
| `openai_api` | automated, **PAID** | `lib/openai/client.ts` (`gpt-5-nano`, 6000-token cap) | 4 concurrent, 60/min | chatgpt |
| `cerebras_free_api` | automated, free | `lib/cerebras/client.ts` (`gpt-oss-120b`) | 1 concurrent, 5/min | chatgpt |
| `groq_free_api` | automated, free | `lib/groq/client.ts` (`openai/gpt-oss-120b`) | 1 concurrent, token-budget pacer from headers | chatgpt |
| `chatgpt_manual`, `gemini_manual` | by hand (operator pastes) | — | — | chatgpt / gemini |

- **Default route per engine:** the first keyed route in `COLLECTION_ROUTES`. Gemini gets `gemini_free_api`; ChatGPT gets `openai_api` → `cerebras_free_api` → `groq_free_api`.
- **Keys are resolved in the server process:** its env (`.env.local`) or keys saved in its DB.
- **Planning** checks `route_policies.enabled` (from `ROUTE_POLICY_SEED`, applied by bootstrap).
- **Pooling:** Measure pools answers by engine (`providers/engines.ts`).
- **Console behaviour:** the console creates a run only when the project has none. Afterwards it adds routes to, and collects on, the project's latest run.

## Adding or changing a route
1. **Client:** `src/lib/<vendor>/client.ts`.
   - It never throws. It returns `{ok, text, error, latencyMs, model, sources?, searched?, finishReason?, rateLimit?}`.
   - Error vocabulary: `<vendor>_api_disabled` when there's no key (keep "disabled" so `isPermanentFailure` treats it as permanent), `rate_limited`, `billing_required`, `auth_failed`, `model_unavailable`, `http_<status>`, `timeout`, `network_error`, `empty_response`, `provider_error: …`.
   - Record the model the provider actually served. Keep output caps generous; truncation makes the answer `NEEDS_REVIEW`.
2. **Credentials:** add the provider union, env key and `credentialStatus()` entry in `providers/credentials.ts`, and the provider unions in `src/lib/client/api.ts`.
3. **Adapter:** wire `adapterFor` and classify new error codes in `isPermanentFailure`, both in `collection/orchestrator.ts`.
4. **Lane:** add the route to `LANES` in `runner.ts` (concurrency, pacer, retry limits).
5. **Policy:** add a `ROUTE_POLICY_SEED` entry and update `COLLECTION_ROUTES`/`MANUAL_ROUTES`. Then re-bootstrap the DB your app actually uses (`SUN_DATA_DIR=<that dir> npm run db:init`, or restart that server). A bare `npm run db:init` seeds the user's `./data` instead, and a missing row makes every run `policy_disabled`.
6. **Engine:** add the route to `ROUTE_ENGINE` in `engines.ts`. Unlisted routes are mapped by name regex or become their own scope.
7. **API validation:** extend the zod enums in `api/projects/[id]/collection-runs/route.ts` and `api/collection-runs/[id]/routes/route.ts` (including `replaces`), plus the credentials route and its DELETE provider check.
8. **UI:** update the console's `ROUTE_LABEL`, its `MANUAL_ROUTES` copy, `keys` shape, `chatgptRoute` preference, the stalled-lane list in `startAutomatic`, the paused-status copy and the key form. Also update the measure page's `ROUTE_METHOD` (the honest method note). The UI still says only "ChatGPT" or "Gemini".
9. **Stored fields:** every `provider_responses` row must carry the true `providerExperience` (route id), `route` (`api`/`consumer_app`), `method`, `adapterVersion`, `visibleModelMode` and capture states. Ungrounded APIs store `sourcesCaptureState: none_present`; this is deliberate, and those answers count as zeros in citation denominators.
10. **Renames:** keep the old id in `ROUTE_ENGINE`, and add it to `ROUTE_LABEL`/`ROUTE_METHOD`, because stored rows and idempotency keys keep it.
11. **Gemini-only branches.** Grounding and search are special-cased for `gemini_free_api`: `groundingCapable` in `runAutomatedPromptRun`, and `recheckSearchAllowance()` in `startCollection`. Generalise both for another grounded lane.
12. **Keyless planning.** `planPromptRuns` marks only `gemini_free_api` `policy_disabled` when its key is missing. Add the new lane there, or its keyless rows stay `planned` forever.
13. **Console auto-start.** `startAutomatic` hard-codes the Gemini route; extend it if the new lane is another engine's default.
14. **Engine honesty.** Pool a lane under ChatGPT or Gemini only if it serves that vendor's model family, or a stand-in disclosed in `ROUTE_METHOD`. Otherwise give it its own engine in `engines.ts`, and expect UI work.
15. **Existing geography columns.** For where an answer was asked, extend `observer_region`/`observer_region_source`/`intended_market` on `provider_responses` rather than adding new columns (see the rule file).

## Debugging a run
- **API:**
  - `GET /api/collection-runs/<id>` returns per-row `state`, `lastError`, `attempts` and capture states, plus `runner.lanes[]` (`status`, `paceReason`, `resumesAt`, `etaMs`).
  - `GET /api/collection-runs/<id>/collect` returns live runner progress; it's `null` after a restart.
- **SQL (read-only):**
  - `select provider_experience,state,last_error,attempts,count(*) from prompt_runs group by 1,2,3,4`
  - `select provider_experience,route,method,adapter_version,search_state,sources_capture_state,answer_capture_state,visible_model_mode from provider_responses` (the schema comments listing route/method values are stale)
  - `events` of type `collection_run.progress` whose payload status is `analysis_failed` or `lane_failed`
- **Known traps** (details in `docs/KNOWN_ISSUES.md`):
  - A second run for the same approved set plans nothing on routes already used.
  - Switching back to an earlier route drops questions.
  - Permanent failures and over-cap rows are not re-queued by Collect; `POST /api/prompt-runs/<id>/retry` exists but no UI calls it.
  - The paused status can be overwritten on concurrent lanes.
  - Two runners double-call providers.
  - Keyless rows planned explicitly stay `planned` forever.
- **Captured but shown as not collected in Measure:** look for `analysis_failed`. Analysis errors are swallowed after the commit, and only `scripts/reanalyse.ts` retries them.

## Testing patterns
- **Provider client:** set the env key in `beforeEach`, `vi.stubGlobal("fetch", …)`, then delete the key and `vi.unstubAllGlobals()` in `afterEach` (see `tests/unit/providers/openai-client.test.ts`).
- **Gemini:** use `vi.mock("@google/genai")` plus `vi.resetModules()` per test. The client and its search memo are module state (`gemini-search-fallback.test.ts`).
- **Runner:** mock the orchestrator, repository, bus and credentials modules (`tests/unit/collection/runner.test.ts`).
- **Integration:** build an approved project as `tests/integration/route-switch.test.ts` does. Keep provider keys unset in the shell; route selection depends on which keys exist.
- **Worth adding tests for:** pause status on concurrent lanes, re-queue rules, second-run and switch-back idempotency, manual-capture defaults, the `answer_truncated` path.

## Validate in the real app
1. **Isolate.** Start an isolated app with `OPENAI_API_KEY=` blanked and no OpenAI key saved in its DB (`sun-validate` §2).
2. **Zero-cost path.** Approve a prompt set, then choose "Ask ChatGPT & Gemini by hand". Paste 2–3 answers, with and without sources, and include at least one Discovery answer that names the brand. Check coverage and `x of n` in Measure, plus the evidence drawer.
3. **Free lanes** (only if the user accepts quota use): run `SUN_BASE=http://localhost:3100 npx tsx scripts/observe-run.ts <projectId>`.
   - It POSTs a **new** collection run with no route list; the server picks one keyed route per engine. With an OpenAI key in the server's env or DB, that is the paid lane.
   - It starts collection and logs lane progress and provisional metrics.
   - The new run becomes Measure's latest (by-hand answers stay in the older run), and it plans nothing for routes already used on that prompt set. Use a project without an earlier run.
4. **Denominators.** Confirm failed and paused rows stay out of every denominator (`denominatorObservationIds` in the Measure JSON).
