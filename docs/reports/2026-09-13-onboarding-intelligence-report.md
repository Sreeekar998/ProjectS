# Onboarding intelligence rework: technical report

Date: 2026-09-13. Scope: everything up to and including prompt generation
(Understand → Landscape → Prompts). Measure and collection were not changed;
the data they read (prompt candidates, entities, frozen competitive sets) keeps
its shape.

## 1. Summary

The demo failed because one keyword rule decided the business type, one theme
default decided the market, and a closed archetype table then decided every
prompt. A Dubai salon became "healthcare" from the words "appointment" and
"treatment", its `en-US` theme tag made it a US business, and the prompt writer
was told its customers choose "between clinics, hospitals or doctors".

The rework replaces those single points of failure with an evidence-grounded
understanding step, a first-class location, local-aware competitor discovery and
geography-bound prompts. On a 17-business golden set (Dubai, London, Bengaluru,
New York, Singapore, Sydney, Toronto, Berlin, regional and national UK, Nike):

| Stage | Checks passed (run 1) | Notes |
|---|---|---|
| Understand | 153 / 155 | Two scope misses (a chain scoped to its head-office city, a nail chain with a Saudi branch read as international); the chain case is fixed and passed on re-run |
| Prompts | 99 / 102 | No clinic/doctor wording for any non-medical business; Discovery never branded; the place-binding and city-state bugs behind the misses are fixed and passed on re-run |
| Landscape | 48 / 68 | Weakest stage: researched local rivals are rarely found without paid or billed search |

Estimated OpenAI spend for the 17 businesses was $1.18 (about $0.005 for
Understand and $0.07–0.10 for Prompts per business), plus about $0.6 across two
re-runs of five and three businesses. Landscape ran on free Gemini. Per-case
tables and every failed check: `benchmarks/onboarding/results-2026-09-13.md`.

## 2. What was wrong (evidence from the demo database)

| Symptom in the demo | Root cause |
|---|---|
| Atelier 10 typed healthcare (confidence 91–95), regulated | `industry-classifier.ts` scored `healthcare 27.6` vs `local_service 2.2` from "appointment" and a `book_appointment` link on the home page; the model synthesis never touched archetype |
| "Can you recommend a doctor for hair colour and balayage in DIFC, Dubai?", "Which hospital should I visit for cleaning up a messy beard and neckline?" | `choiceUnitFor("healthcare")`, healthcare sentiment themes and trade-off criteria, template noun "hospitals" for any "treatment" |
| Market "United States", scope multi-country | `html lang: en-US` (WordPress default) counted as a country; four copies of one phone number as scope evidence |
| Only competitor: "Lash Extensions" | The heading "Lash Lift vs Lash Extensions" parsed as a rival; real DIFC salons rejected with geography 15 because their sites were unreachable or lacked "serving Dubai" |
| JSON-LD `HairSalon` ignored; sitemap index children never fetched; brand "atelier 10 wordmark cream" | Structured-data type allowlist missed the LocalBusiness family; sitemap index recursion bug; logo alt text as brand |
| Intake market and language selects | Stored and never read |

## 3. Research used

- Competitor products (`project-sun-competitor-research`): Velova appends "in {country}" to prompts and stores places as free-text chips; Peec's neighbourhood targeting is prompt text with country proxies; AthenaHQ multiplies flat locations into cost; Scrunch writes natural questions. Sun adopted place-in-prompt measurement with levelled places and rejected location multipliers. See `PROJECT-SUN-IMPLEMENTATION-NOTES.md` in that folder.
- Models, verified on the account on 2026-09-13: gpt-5.6-luna ($0.20/$1.20 per 1M), gpt-5.6-terra ($2/$12); Gemini 3.5–3.8 Flash free-tier text; Gemini 2.5 retired for this key (404); Gemini 3.x grounded search has no free quota (429).
- Geography: Google Places/Geocoding (store place ids only) when a key exists; OpenStreetMap Nominatim (1 req/s, cache), Photon autocomplete and Overpass otherwise. Country resolution uses `Intl.DisplayNames` and libphonenumber, not a fixed list.

## 4. What was implemented

### Understand
- Crawler: LocalBusiness-family JSON-LD (address, geo, opening hours, price range), map links and embeds with coordinates, tel/mail/social/booking-platform links, gzip sitemaps and index children, booking/menu/team/reviews page types, browser user-agent retry on 403/429/503.
- `lib/understanding`: site digest (pages under `p#`, facts under `f#`, untrusted text wrapped and neutralised) → one strict-schema extraction (brand, description, open classification path + closed `kind`, grouped offerings with prices, audience segments, addresses, service and nearby areas, scope, customer questions) → grounding (citations to evidence ids; unsupported brand, offering, audience, alias and address claims dropped) → location resolution (weighted country votes, structured-address merge, geocoding, neighbourhood from the website, branches, scope rules, computed confidence, `needsConfirmation`).
- Rules fallback fixed: salon vocabulary and booking platforms are local-service signals; "appointment"/"treatment"/"clinically" no longer healthcare; `en-US` ignored; a LocalBusiness address is a storefront, making a single storefront local even on a `.ae` domain; address-block false positives removed.
- UI: business type card (path, ruled out, one-click alternatives, change), location card (hierarchy, scope sentence, nearby areas, signals, map link, autocomplete change), grouped services, audience segments, progress step "Understanding the business"; intake asks only for the URL. Edits re-derive all mirrors through `understanding/edits.ts`.

### Landscape
- Topics from offering groups, audiences and questions (no brand, no place, no gift cards); rebuilt when the confirmed profile changes.
- Sources: place-anchored web search (opt-in paid), OpenStreetMap nearby businesses, model hypotheses with area, Wikidata category neighbours, website comparisons with corroboration rules; one like-for-like screening call; verifier reads the rival's address, footer and JSON-LD localities.
- Scoring: geography from positive evidence (distance, area, place mentions); unknown is neutral; rejected rows stay visible with reasons and "Confirm anyway"; operator decisions survive rediscovery; valid rivals no longer lose slots to rejected ones.

### Prompts
- Places from the confirmed location, frozen in the context snapshot (`prompt-context@2`) for generation, regeneration and approval.
- Every Discovery plan of a hyperlocal or local business names one place, rotating neighbourhood, nearby areas and city; national businesses, including chains that publish only a head office, name the country in two thirds of plans.
- Choice unit from the classification ("hair salons"), spoken brand names ("Atelier 10"), local area hints in a third of Trade Offs and Sentiment prompts.
- New validators: `geography_stacked`, `geography_too_broad`; places named in any prompt are bound and validated; `TARGET_REQUIRED` accepts supported short names.
- Routed models: intent model on luna, section writing on terra, Gemini fallback; each prompt records its model.

### Platform
- `lib/llm`: stage routing, OpenAI Responses strict JSON schema, Gemini schema conversion, web search, embeddings, usage ledger with per-stage errors, paid-route gate (`SUN_ALLOW_PAID_LANDSCAPE`, `SUN_LLM_NO_PAID`, `SUN_LLM_<STAGE>` overrides).
- No database schema change or migration (the operator's dev server was running); new data lives in profile JSON and snapshot JSON.

Main files: `src/lib/understanding/*`, `src/lib/llm/*`, `src/lib/geo/*`, `src/lib/landscape/{competitor-search,competitor-nearby,competitor-screening,topic-generation}.ts`, `src/lib/prompts/{geography,model-call}.ts`, `src/components/features/{business-type-card,location-card}.tsx`, `src/app/api/geo/*`, plus changes across the crawler, evidence builder, profile resolvers, landscape scoring and prompt generation. Full list: section 9.

## 5. Before and after: Atelier 10

| | Demo (before) | Now |
|---|---|---|
| Brand | ATELIER 10 / "atelier 10 wordmark cream" | Atelier 10 Salon (alias Atelier 10) |
| Type | healthcare, regulated | Beauty and Personal Care › Hair and Beauty Salons › Luxury full-service beauty salon; healthcare explicitly ruled out |
| Location | UAE + United States, multi-country | Staybridge Suites, 6th Floor, Sheikh Zayed Road, DIFC, Dubai (25.2118, 55.2740); scope local; nearby Business Bay, Sheikh Zayed Road |
| Offerings | 11 flat labels | 28 in four groups (Hair, Nails, Lashes & Brows, Barber), price range AED 100–1500, booking via Fresha |
| Topics | Men's Haircut, Classic Manicure, Nail Care, Lash Lift | Hair styling and colour treatments; Manicure and pedicure services; Eyelash and eyebrow services; Men's grooming and barbering; Bridal hair and styling services |
| Competitors | Lash Extensions | Suggestions such as Chaps & Co Barbershop, The Grooming Company, Sisters Beauty Lounge; memory-only guesses shown as rejected with reasons (see limitations) |

Discovery prompts, before (all ten selected used doctor/clinic/hospital):
- "Can you recommend a doctor for hair colour and balayage in DIFC, Dubai?"
- "Help me find a clinic for a russian e file manicure."
- "Which hospital should I visit for cleaning up a messy beard and neckline?"

Discovery prompts, after (golden run):
- "Which salon should I book in DIFC for a haircut?"
- "I'm heading on holiday—which salon in Business Bay should I visit for a pedicure?"
- "Recommend a DIFC barber for grooming between AED 150 and 500."
- "I need a Dubai salon that checks my old colour before colouring my hair."

Trade Offs, before: "Compare ATELIER 10 and Lash Extensions on general patient experience for damaged hair treatments". After: "I need colour before my wedding — Atelier 10 or Sisters Beauty Lounge?"

## 6. Models and cost

| Stage | Model chain | Measured cost per business |
|---|---|---|
| Understand | gpt-5.6-luna → Gemini 3.5 Flash-Lite → 3.6 Flash | $0.004–0.005 |
| Prompts | luna (planner) + gpt-5.6-terra (writer) → luna → Gemini | $0.06–0.09 |
| Topics, competitors, search | Gemini 3.8 → 3.7 → 3.5 Flash-Lite (OpenAI opt-in) | $0 on the free tier |

Terra was kept for prompt writing because the output is the product; switching the
writer to luna (`SUN_LLM_PROMPTS="openai:gpt-5.6-luna,gemini:gemini-3.8-flash"`)
would cut prompt cost roughly tenfold and was not evaluated side by side.

## 7. Testing done

- Unit, integration, security and competitor benchmark suites: 52 files, 527 tests passed, including new tests for location resolution, grounding and digest sanitisation, edits, countries/phones, schema dialects and paid gating, local-business crawler signals, local competitor geography, search brief, nearby source, comparison-mention filter, prompt geography and validators, salon fallback, and evaluation scoring.
- `tsc` strict clean; ESLint 0 errors on changed areas; isolated `next build` (own dist dir and data dir) compiled successfully.
- Real runs on isolated data dirs only: Atelier 10 Understand, Landscape and Prompts probes; rules-only Atelier 10; Understand page on an isolated server (desktop and 390 px) with both edit flows; the 17-business golden evaluation (`scripts/eval-onboarding.ts`) and two re-runs after fixes (dental clinic, B2B fintech, Singapore clinic, national bakery chain, Atelier 10).
- Not tested: Google Places/Geocoding (no key), OpenAI web search for competitors (spend not approved), the Playwright e2e suite (label assertions updated but not run), a UI walk through Landscape and Prompts pages after the landscape page changes.

## 8. Limitations and next steps

1. **Local competitor discovery needs search.** Approve OpenAI web search for Landscape (`SUN_ALLOW_PAID_LANDSCAPE=1`, roughly $0.01 per search call plus a few thousand luna tokens), enable billing on the Gemini key, or add a Google Maps key. Until then, neighbourhood rivals come from OpenStreetMap (unreliable public servers) and model memory, which is shown as rejected for local businesses.
2. Weak rivals confirmed by an operator still make the writer drop comparisons, and template Trade Offs fill the gap with keyword splices.
3. Scope for multi-branch chains depends on the site listing branches; Tips & Toes read as international from a Saudi branch.
4. Nike was crawled as its India storefront from this network, so some prompts mention India.
5. Short-name rules can clip names awkwardly ("The Grooming" for "The Grooming Company").
6. The usage ledger is in memory; persist per-stage cost and errors on runs.
7. Next: side-by-side writer comparison (terra vs luna), embeddings-based prompt dedupe, Google Places for autocomplete and nearby rivals, and an operator review pass on the Landscape page.

## 9. Files changed

Added: `benchmarks/onboarding/*`, `docs/ONBOARDING_INTELLIGENCE.md`, `scripts/eval-onboarding.ts`, `src/app/api/geo/*`, `src/components/features/business-type-card.tsx`, `src/components/features/location-card.tsx`, `src/lib/geo/*`, `src/lib/llm/*`, `src/lib/understanding/*`, `src/lib/landscape/competitor-nearby.ts`, `competitor-screening.ts`, `competitor-search.ts`, `topic-generation.ts`, `src/lib/prompts/geography.ts`, `model-call.ts`, and tests under `tests/unit/{understanding,geo,llm,benchmarks}`, `tests/unit/crawler/local-business-signals.test.ts`, `tests/unit/landscape/local-discovery.test.ts`, `tests/unit/profile/salon-classification.test.ts`, `tests/unit/prompts/local-geography.test.ts`.

Modified: `.claude/rules/{landscape,prompts,website-intelligence}.md`, `CLAUDE.md`, `docs/{COMPETITOR_AND_PROMPT_INTELLIGENCE,KNOWN_ISSUES,WEBSITE_INTELLIGENCE}.md`, `package.json` (libphonenumber-js), API routes for landscape, profile and prompt sets, the Understand, Landscape and intake pages, `analysis-progress.tsx`, `profile-fields.tsx`, `lib/client/api.ts`, crawler (`crawl-planner`, `extractor`, `fetcher`, `page-classifier`, `sitemap`, `structured-data`), `events/bus.ts`, `evidence/{builder,types}.ts`, landscape (`competitor-entity`, `-scoring`, `-sources`, `-types`, `-verifier`, `competitors`, `orchestrator`, `repository`, `search-profile`, `topics`), profile (`deterministic-extractor`, `industry-classifier`, `market-resolver`, `merge`, `orchestrator`, `schema`), prompts (`context`, `coverage-policy`, `frame-generation`, `intent-generation`, `intent-model`, `orchestrator`, `realizer`, `types`, `validators`), `tests/e2e/core-journey.spec.ts`, `tests/setup.ts`, `tests/unit/crawler/structured-data.test.ts`.
