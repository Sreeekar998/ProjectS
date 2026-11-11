---
paths:
  - "src/lib/crawler/**"
  - "src/lib/profile/**"
  - "src/lib/evidence/**"
  - "src/lib/security/**"
  - "src/lib/text/**"
  - "src/lib/geography/**"
  - "src/lib/understanding/**"
  - "src/lib/geo/**"
  - "src/lib/llm/**"
  - "src/app/api/geo/**"
  - "src/lib/projects/market-hint.ts"
  - "src/lib/search-console/**"
  - "src/app/api/integrations/**"
  - "src/lib/client/understand-*.ts"
  - "tests/unit/search-console/**"
  - "tests/integration/search-console-*.test.ts"
  - "src/components/features/business-type-card.tsx"
  - "src/components/features/location-card.tsx"
  - "tests/unit/understanding/**"
  - "tests/unit/geo/**"
  - "tests/unit/llm/**"
  - "benchmarks/onboarding/**"
  - "scripts/eval-onboarding.ts"
  - "src/lib/projects/**"
  - "src/app/trial/**"
  - "src/app/projects/*/understand/**"
  - "src/app/api/projects/route.ts"
  - "src/app/api/projects/*/crawl/**"
  - "src/app/api/projects/*/profile/**"
  - "src/app/api/projects/*/evidence/**"
  - "src/app/api/industries/**"
  - "src/components/features/analysis-progress.tsx"
  - "src/components/features/profile-fields.tsx"
  - "benchmarks/business-profile/**"
  - "scripts/benchmark-business-profile.ts"
  - "tests/unit/crawler/**"
  - "tests/unit/profile/**"
  - "tests/unit/security/**"
  - "tests/security/**"
  - "tests/integration/profile-lifecycle.test.ts"
  - "tests/integration/crawler-components.test.ts"
  - "tests/benchmark/business-profile.test.ts"
  - "tests/helpers/profile-fixtures.ts"
  - "tests/fixtures/fixture-server.ts"
---

# Understand stage (crawl → evidence → Brand Profile): guardrails

## How it flows
1. `POST /api/projects` runs `normalizeUrl`. `POST …/crawl` returns 202 and runs `runWebsiteIntelligence` in the background.
2. `runCrawl` (`crawler/orchestrator.ts`):
   - checks the seed with the SSRF guard, then reads robots.txt and the sitemap (each sitemap file is capped per file, ranked by `sitemapChildPriority` so post/tag/author/user files come last, and admitted round-robin by source to at most 60% of `maxUrls`, so nav links found later still fit);
   - pulls batches of up to 4 URLs from `CrawlPlanner` and fetches each through `safeFetchHtml`; the planner penalises URL-shape saturation (`shapeSaturation`) and, when the frontier is full, evicts its weakest displaceable entry for a nav-linked newcomer (`rejectedFrontierFull` / `evicted` in the stats). Postman once selected 22 blog and category pages and no product page;
   - reads menu, brochure, catalogue and price-list PDFs the site links to (`crawler/documents.ts`: a same-site `.pdf` whose file name or link text says what it is; at most `maxDocuments` per crawl, `maxDocumentBytes` each; text via `unpdf`, then the ordinary page extractor as a `menu` page, `fetch_method = pdf`). A three-Michelin-star restaurant kept every menu in PDFs and came out with "Food Menu" and "Wine Menu" as its offerings;
   - extracts, classifies and near-duplicate-checks every page.
3. A `crawl_pages` row is written for **every** attempted URL (failed, duplicate and thin pages get `is_selected=false` and a `selected_reason`). Each selected page also gets typed `evidence_items`, 1500-char `evidence_chunks` (150-char overlap), and its extracted main text saved as `evidence-store/<projectId>/<sha256>.txt`.
4. One `partial` profile version is updated in place as pages arrive. The Understand page never renders it: it shows only the progress rail until the version is `complete` (user, 2026-09-14).
5. `synthesizeFinalProfile` builds the final profile:
   - deterministic resolvers and `DeterministicProfileProvider` produce a baseline (partial versions are always rules-only);
   - with a model route, `runBusinessUnderstanding` (`lib/understanding`) reads a site digest (page text under `p#`, facts under `f#`), makes one strict-schema call (stage `extract`: gpt-5.6-luna, Gemini fallback), grounds every claim to evidence ids (unsupported claims are dropped), resolves the location and scope, and writes `classification`, `location`, `audienceSegments`, grouped offerings, `positioning`, `contact` plus the legacy mirrors;
   - a failed call keeps the rules profile with a warning; unknown evidence ids are stripped either way.
6. On success, the version becomes `complete`, `locations` rows are inserted, and `profile.ready` is emitted. On a handled failure, it becomes `failed` and `profile.failed` is emitted; no locations are written.
7. User edits create version+1.

## Invariants
- **Fetch safety.** Page and competitor-site fetches must resolve only to public IPs, re-checked on every redirect hop (`security/url-safety.ts`, `security/ip-guard.ts`, `crawler/fetcher.ts`). Never add a fetch path that bypasses `safeFetchHtml`. Known gaps are listed in `docs/KNOWN_ISSUES.md`:
  - robots.txt, sitemap and Playwright requests bypass the guard;
  - the IPv6 classifier misses NAT64, 6to4, IPv4-compatible and multicast ranges;
  - DNS check and fetch resolve separately.
- **Evidence-cited fields.** Inferred profile fields may cite only `evidence_items` ids from the current crawl run. Model output is validated field by field, and unknown ids are stripped before saving.
- **Computed confidence.** Confidence is computed, never taken from a model; no understanding schema has confidence fields.
  - Most fields use `computeConfidence` over their cited items (`profile/confidence.ts`, plus `SOURCE_TYPE_STRENGTH`/`PAGE_TYPE_STRENGTH` in `evidence/types.ts`).
  - Formula-based exceptions: archetype (score share and margin); the deterministic description (35 + 12 per field, max 85); ccTLD/locale markets (floor 72, no evidence); user edits (100).
- **Untrusted website text.** It never enters the system instruction. The understanding digest wraps it in `<website>` inside the user content and neutralises wrapper-closing tags (`sanitizeUntrusted`); code-computed signals sit outside the wrapper. A brand name must be written on the site to replace the baseline.
- **No fabrication.**
  - Understanding: classification labels are open but `kind` is closed (`understanding/kinds.ts`); offerings, audiences, aliases, addresses and neighbourhoods must be supported by site text (`Grounder.siteSupport`) or they are dropped and counted in a warning.
  - Rules fallback: industry must be an id from the closed taxonomy; below confidence 25 the classifier returns no id.
  - There is no fallback market. Neighbourhood names come from the site; a geocoder only fills a missing one, with a warning.
  - A `.com` domain or site language alone is not market evidence. `en-US`/`en_US` locale tags are ignored; other locale subtags still add a weak country signal in the rules fallback but never add a country to the footprint.
  - "appointment", "treatment" and "clinically" are not healthcare signals (a salon was classified as healthcare from them).
- **Version rows.** One crawl run owns one profile version row, updated in place (`partial` → `complete`/`failed`). Edits never mutate a version: they create version+1 with `source: "user"`, `evidenceIds: []`, confidence 100, and the edited paths added to `userEditedFields`.
- **Confirmation guards.** Only `action: "confirm"` checks status, and only rejects `partial` (409 `profile_incomplete`). A `failed` version can be confirmed, and `action: "edit"` with `confirm: true` has no status guard. The UI disables Edit/Confirm while partial.
- **Downstream gates differ by stage.**
  - Landscape generation requires the latest version confirmed, but reports failure only as a `landscape.competitor.discovery_failed` event after the 202.
  - Landscape confirm freezes against the latest version without checking `confirmedAt`.
  - Prompt generation uses the version pinned by the latest frozen competitive set and requires its `confirmedAt`.
- **Honest failures.** Never fabricate a profile.
  - A handled crawl failure emits `crawl.blocked` or `crawl.failed` plus `profile.failed`, and writes a `failed` version with a readable warning.
  - A crawl that fetched pages but produced no evidence emits `crawl.completed`, then `profile.failed` with reason `no_evidence`.
  - Unhandled exceptions are caught in `crawler/pipeline.ts`, which emits only `profile.failed` (stage `pipeline`) and `policy.status`. The partial version and the `running` crawl row stay unfinished.
- **Menu pages get the digest budget they need.** `understanding/digest.ts` gives a page at `/menu` the menu budget (20,000 characters) whatever its content classified as; a rendered dish list with prices reads as "product" and got 1,800, which left the model with section names only ("Street food": "Street Food").
- **Bounded browser fallback.** The Playwright render is capped at `maxBrowserFallbacks` per run (default 4, `SUN_CRAWL_MAX_BROWSER_FALLBACKS`), waits until the page's text stops growing (up to about 4 s; a menu page read 56 words at 600 ms and 2,600 at 3 s) and appends the bodies of same-site iframes (an ordering menu framed on nawab.ae/menu was invisible to `page.content()`) and spent only on `RENDER_WORTHY_TYPES` pages whose essential content is missing (`essentialContentMissing`; the seed counts as missing below 180 words). The counter is checked before an await, so concurrent fetches can overshoot it. A render is adopted only if it yields more text; `metrics.browserFallbacks` and `browserRendersAdopted` are always written to the crawl run. Vitest and the fixture harness turn the fallback off; the Playwright e2e server does not.

## Couplings: change these together
- **Evidence text prefixes are a parsing contract.** They are written by `evidence/builder.ts` and regex-parsed by the identity, industry/archetype, market and offering resolvers, by `profile/deterministic-extractor.ts` (customer jobs from `FAQ:`/`H<n>:`), **and** by `prompts/intent-model.ts`. Some prefixes are templates (`<SchemaType> name:`, `<SchemaType> areaServed:`), so grep the fixed part (e.g. ` name:`) before rewording.
- **Legacy mirror fields.** `offerings.values`+`items`, `personas.values` (mirrors `targetAudience`) and `geography.countries/regions/cities` (mirrors `markets`) have several readers:
  - `prompts/context.ts`;
  - Landscape: `landscape/search-profile.ts`, which feeds AI hypotheses, audience/geography scoring and local-market rejection;
  - `landscape/topics.ts` and `neutralizeTopicName` (via `offerings.values`).
  Keep them in sync on every write path: `buildDeterministicProfile`, `applyEdits` (profile PATCH), `POST …/profile/manual`, `validateSynthesis`, `mergeUserEdits`. Known gap: `validateSynthesis` does not re-mirror `personas`.
- **`locations` is insert-only.** Every completed crawl appends rows (now including `neighborhood`/`district` levels) and nothing updates or deletes them. New prompt sets ignore it and use places frozen from the profile location (`prompts/geography.ts`); only `prompt-context@1` snapshots still read it. Old runs' `evidence_items`/`evidence_chunks` also persist and are read by discovery and the intent model.
- **Profile edit contract.** `PATCH …/profile` accepts `classification` and `location` edits applied by `understanding/edits.ts`, which re-derives industry, archetype, regulated domain, markets, geography and scope. Change the helpers, not the route, when mirrors change.
- **Other websites of the business.** `PATCH …/profile` also takes `domains` (up to six hosts, canonicalised; the crawled domain always stays first and is not editable), edited on the Understand card as "Other websites of this business". Landscape merges `identity.domains` into the target entity's `domains` on every run (`landscape/orchestrator.ts`), so an own site added after the first Landscape run counts as the business's own source once Landscape has run again and the answers are analysed (or re-analysed). A salon's second domain, cited in 25 of 30 answers, had been counted as a third party (2026-09-18).
- **The progress rail reads payload keys.** The keys are listed at the top of `src/lib/client/understand-progress.ts`; the cycle starts at the last `profile.synthesis.started`, and `search_console.sync.*` events (matched by `crawlRunId`) add a Search Console step. `profile.field.updated` and `droppedClaims` are no longer read. Payload renames break the rail and the e2e journey.
- **Market area (`location.marketArea`, 2026-09-16).** Where customers are measured, decided once in `resolveLocation` (`understanding/market-area.ts` `decideMarketArea`) and again on edits (`applyLocationEdit`): the operator's intake area when it resolved to a place (a city hint → the city; an area hint that names one of a chain's branches → that branch becomes the primary and the first-listed address joins the branches), else the footprint (one storefront → its neighbourhood, several locations in one city → the city, service area → the city, wider → region/country, online → the market country or Worldwide). `marketAreaOf(profile)` derives it for older versions. Readers: `prompts/geography.ts` (places), `prompts/intent-model.ts` (`primaryMarket`), `landscape/competitor-tiers.ts` (a chosen branch area opens an area tier for a multi-location business), the Location card (a city-wide chain is shown as its city with every location listed; "Measure customers across" in the editor). Never let a branch's address stand for the market.
- **Intake market hint.** `projects.market_scope` holds a `MarketHint` JSON (`lib/projects/market-hint.ts`). Location precedence: operator hint (4) > structured address (3) > Search Console country (2) > weak website signals. For a business customers do not visit, a website country backed only by a currency, phone prefix or domain ending (no written place) is overridden by the hint; only a written address or coordinates keep a head office abroad ("noted"). Wipro with India chosen once came out "head office in United Kingdom" from one £ price. The location card's "Serves customers across …" names `countriesServed[0]` (the market), not the head office's country. **Worldwide** for a business customers do not visit means the office is not a market: `countriesServed` drops the office country (unless the site names it among several served countries), `markets` starts with "Worldwide", the city/region mirrors leave the office out (`officeIsMarket`), and `marketCountries()` returns no country, so competitors, prompt places and the intent model see a global business rather than "in the US". Place-bound businesses always keep the storefront's country. The hint also applies in the rules-only fallback and on a failed crawl.
- **The fixture benchmark does not run `runCrawl`.** `benchmarks/business-profile/harness.ts` re-implements the crawl loop, so selection, dedupe, depth or failure changes in `crawler/orchestrator.ts` need mirroring there or a live check.
- **Stored profile JSON is cast, not parsed** (`BusinessProfileSchema` is unused at runtime). New fields must tolerate older versions lacking them.

## Pitfalls
- `runCrawl` refuses loopback, so it can't crawl the local fixture server. Tests use pure functions, the harness, `.invalid` domains, or live sites.
- Heuristics are English/Latin-script-centric (similarity normalizer, sentence splitting, regex vocabularies).
- A key pasted in the UI is invisible to Business Understanding after a restart, until something calls `loadCredentials()`.
- **Routed model calls degrade silently.** When OpenAI has no credits (429 `credit_balance_exhausted` / type `insufficient_quota`, classified `billing_required`) or rejects the key, `lib/llm/suspension.ts` skips that provider for 2 minutes (lifted by `saveCredential`, any successful call to it, and the start of every Understand or Prompts run, so a top-up with the same key is used at once), and every stage runs on its Gemini fallbacks: Understand on Flash-Lite, prompt writing on 3.6 Flash. Check `profile.understanding.stage` `model`, the prompt rows' `model:` context keys, or `summarizeUsage().byStage[…].errors` before judging output quality. A Gemini 503 overload waits 3 s and 8 s before falling to the next (weaker) model.
- `synthesisMode: llm_grounded` ("AI-assisted") means the understanding call returned a valid response; `quality.models`, `llmCostUsd` and warnings say what was dropped.
- Geocoding uses public OpenStreetMap endpoints (Nominatim 1 req/s, Photon) unless `GOOGLE_MAPS_API_KEY` is set; the Google path is untested. Results are cached in `$SUN_DATA_DIR/geo-cache.json`.
- `tests/setup.ts` deletes all provider keys, so the live understanding path has no automated coverage beyond pure-function tests; use `scripts/eval-onboarding.ts` on scratch dirs.
- `POST …/crawl` refuses a second run in the same process (`already_running`) and returns `sinceSequence`; the guard is in memory, so it resets on restart.

## Validate
- `npx vitest run tests/unit/crawler tests/unit/profile tests/unit/security tests/integration/profile-lifecycle.test.ts tests/integration/crawler-components.test.ts tests/security/ssrf.test.ts`
- `npx vitest run tests/benchmark/business-profile.test.ts` rewrites `expected/fixture-report.md` and doesn't exercise `runCrawl`.
- For real sites, follow the `sun-profile-quality` skill.
