# Onboarding intelligence: Understand → Landscape → Prompts (v2)

How a website becomes a confirmed business understanding, a local-aware
competitive landscape and a natural, geography-aware 30-prompt set. Written
2026-09-13 after the Atelier 10 demo failure (a DIFC hair salon classified as
healthcare, given doctor/clinic prompts and a US market). The code is the source
of truth; this file explains why it is shaped the way it is.

## 1. Understand

```
crawl (robots, sitemap indexes incl. gzip, planner)       lib/crawler
  → evidence items (JSON-LD LocalBusiness family, address,  lib/evidence/builder.ts
    geo, map links, tel links, booking platforms, social)
  → rules-based baseline profile (partial versions stream)   lib/profile/deterministic-extractor.ts
  → Business Understanding (one structured model call)      lib/understanding/index.ts
      site digest: page text under p# ids, facts under f#   lib/understanding/digest.ts
      schema: brand, description, open classification,      lib/understanding/extraction.ts
        offerings (grouped), audience, location, questions
      grounding: citations → evidence ids; unsupported      lib/understanding/grounding.ts
        claims dropped; confidence computed, never asked
      location + market scope (multi-signal + geocoder)     lib/understanding/location.ts
  → profile version (+ legacy mirrors), locations rows       lib/profile/orchestrator.ts
```

**Classification is open, with a closed policy family.** The model writes the
industry → sub-industry → business type path in its own words ("Beauty and
Personal Care › Hair and Beauty Salons › Luxury full-service beauty salon") and
picks one `kind` from `understanding/kinds.ts` (23 families such as
`personal_care_wellness`, `healthcare_medical`, `b2b_saas_software`). The kind
drives policy only: regulated handling, whether customers choose by place, the
legacy archetype mirror and the prompt choice unit. Alternatives and ruled-out
categories are stored and shown ("Ruled out: healthcare or medical clinic").
The old 39-entry taxonomy and 12 archetypes remain as the no-model fallback.

**Location is first-class.** `profile.location` holds a primary `GeoPlace`
(premise, street, neighbourhood, district, city, region, country, coordinates),
branches, service areas, nearby areas the site names, countries served, every
signal that voted, and `needsConfirmation`. Country votes: structured address
3, reverse-geocoded coordinates 3, model-read address 2.5, ccTLD 2 (vanity
endings like `.io` ignored), validated phone numbers 2, single-country currency
1.2, countries served 1. Page language tags are never counted. Neighbourhood
names come from the website, not the geocoder (OpenStreetMap calls the DIFC
block "Trade Centre 1"). Geocoding uses Google when `GOOGLE_MAPS_API_KEY` is
set, otherwise OpenStreetMap (Nominatim, 1 request/s, cached 30 days in
`$SUN_DATA_DIR/geo-cache.json`; Photon for autocomplete).

**Market scope** is decided by rules over the resolved place: a single place-bound
business with a neighbourhood is `hyperlocal` (the model may widen it to `local`
for destination businesses), a city `local`, several cities `regional`/`national`,
online businesses by countries served (`national`, `international`, `global`).

**Untrusted input.** Website text reaches the model only inside `<website>` in the
user content; tag-like sequences that could close the wrapper are neutralised.
Signals computed by code are shown before the wrapper.

**Confirmation, not a form.** The Understand page shows a business type card
(path, alternatives as one-click chips) and a location card (hierarchy, scope
sentence, nearby areas, "Why?" signals, OpenStreetMap link, autocomplete change
via `GET /api/geo/search` and `POST /api/geo/place`). Edits go through
`understanding/edits.ts`, which updates the mirrors (industry, archetype,
regulated domain, markets, geography, scope) so later stages never read a
half-edited profile. The intake page asks only for the URL; language defaults to
English.

## 2. Landscape

Topics come from `landscape/topic-generation.ts`: 4–6 neutral noun-phrase
demand areas grounded in offering groups, audiences and customer questions
(no brand, no place names). Since 2026-09-16 each topic must pass the
"category of purchase" test: something buyers compare providers in ("API
testing tools", "hair colour and balayage"), never a feature, a capability or
a branded sub-product ("Postman's AI Engineer" and "AI engineering assistance"
were both produced from one feature page); `looksProprietary` drops names that
still carry the brand. The stage runs on gpt-5.6-terra first (for a global API
platform luna kept 4 topics and dropped monitoring and distribution; terra
returned 6, about $0.01 a business). Untouched system topics are rebuilt when
the confirmed profile version changes. Rules clustering (now preferring the
site's own service groups) is the fallback.

Competitor sources (policy `competitor-discovery@5`):

| Source | What it adds | Cost |
|---|---|---|
| `web_search` (`competitor-search.ts`) | Search-grounded rivals anchored to the confirmed place ("hair salon in DIFC", "near Business Bay"), with area, city and source page | OpenAI web search is paid and **opt-in** for Landscape (`SUN_ALLOW_PAID_LANDSCAPE=1`); Gemini grounding needs a billing-enabled key |
| `nearby_places` (`competitor-nearby.ts`) | Named same-category businesses within 2–6 km from OpenStreetMap (Overpass); category → map tags chosen by a model, generic table as fallback | Free, best-effort (public instances rate-limit) |
| `ai_hypothesis` | Model rivals with area/city; place-bound hypotheses capped at 60 and rejected unless a website or another source confirms them | Free Gemini by default |
| `open_knowledge` | Wikidata/Wikipedia category neighbourhood (brands) | Free |
| `website_explicit` | "X vs Y" mentions; for place-bound businesses and service-name mentions it needs corroboration | Free |

After merging, `competitor-screening.ts` makes one like-for-like judgement over
the pool (drops a perfume shop next to a salon, types booking platforms as
marketplaces) before any website fetch. The verifier reads footer, `<address>`
and JSON-LD localities and records which of the target's place names a rival's
site mentions. Geography is scored from positive evidence only: map distance,
reported area, place mentions, structured localities. Unknown is neutral (50);
a rival is rejected as non-local only when evidence places it elsewhere, and
only for hyperlocal, local and regional targets (a national chain's head-office
city is not a boundary). Memory-only rivals are rejected for hyperlocal and local
targets only.
Rediscovery keeps operator decisions, rejected rows stay visible with reasons
("Confirm anyway"), and valid suggestions no longer share slots with rejections.

## 3. Prompts

Policy `prompt-selection@4-10-10-10`, context `prompt-context@2`, intent model
`intent-model@2`.

- **Places** come from the confirmed location (`prompts/geography.ts`) and are
  frozen into the context snapshot, so generation, regeneration and approval
  validate against one list. Hyperlocal and local businesses get the neighbourhood,
  nearby areas and city (never the country); regional ones their branch cities and
  region; national businesses, including national chains with only a head office
  published, the country in two thirds of Discovery prompts; global ones rarely.
  A city-state's name counts once (city, not a stacked country).
- **Discovery** (rebuilt 2026-09-14, `discovery.ts`, `intent-model@4`). Across 15
  businesses the one-detail planner's 150 selected prompts were all 7–15 words, 23%
  carried an em dash, 10% a pasted price band, 18% a place written as an adjective,
  and many asked for the website's own selling points. Discovery now plans slots
  (bare / one everyday detail / situation-first), writes two versions per slot in the
  register measured in real recommendation prompts (LMArena Search Arena: median 13
  words, 42% lowercase, 57% without closing punctuation, places after the thing), and
  judges each survivor with yes/no checks before selection. The choice unit still
  comes from the classification.
- **Trade Offs and Sentiment** name the brand the way people say it (`spokenName`,
  e.g. "Atelier 10"), and local businesses mention their area in about a third.
- **Validators** add `geography_stacked` ("DIFC, Dubai, UAE") and
  `geography_too_broad` (a local business's Discovery prompt naming only the
  country), bind any confirmed place a prompt names, and accept supported short
  brand forms.

## 4. Models and cost

All calls go through `lib/llm` (stage routing, strict JSON schemas per provider,
one transient retry per route, usage ledger with cost estimates; failures are
reported per stage in `summarizeUsage().byStage[stage].errors`).

| Stage | Default chain | Why |
|---|---|---|
| Understand (`extract`) | gpt-5.6-luna → Gemini 3.5 Flash-Lite → 3.6 Flash | Luna: cheapest strict-schema model with a 1M context; ~$0.005 per business in tests |
| Prompts planner / writer | luna / gpt-5.6-terra → luna → Gemini 3.8 → 3.6 Flash | Compared on 2026-09-16 over a salon and an API platform: luna writes acceptable prompts for ~$0.007 a set, terra's read more specific and less list-like ("I keep getting weird data back from an endpoint. What API clients should I try?") for ~$0.06–0.07; judge failure rates were the same. Terra stays first because prompt quality is the product and the difference is cents |
| Discovery and section judges (`judge`) | gpt-5.6-luna → Gemini 3.5 Flash-Lite → gpt-oss | Yes/no checks per prompt with a giveaway quote; Discovery in one call, Trade Off/Sentiment in one call (`section-judge.ts`); ~$0.01 per set together |
| Topics | gpt-5.6-terra → luna → Gemini 3.8 → 3.6 → 3.5 Flash-Lite (OpenAI only with `SUN_ALLOW_PAID_LANDSCAPE=1`) | Topics are the abstraction needs, prompts and competitors bind to; terra kept monitoring and distribution for an API platform where luna dropped them (~$0.01 a business) |
| Competitors, search | gpt-5.6-luna → Gemini 3.8 → 3.7 → 3.5 Flash-Lite (OpenAI only with `SUN_ALLOW_PAID_LANDSCAPE=1`) | Approved for testing on 2026-09-15 because the free Gemini 3.x routes answered 503 for a minute a call |

Paid OpenAI routes are allowed for Understand and Prompts (operator approval,
2026-09-13); `SUN_LLM_NO_PAID=1` disables every paid route and
`SUN_LLM_<STAGE>="openai:model,gemini:model"` pins a chain. Gemini 2.5 models are
retired for this account (404) and Gemini 3.x grounded search has no free-tier
quota (429), so the free search route only works on billing-enabled keys. Gemini
calls are costed at $0 unless `SUN_GEMINI_BILLING=1`.

## 5. Evaluation

`benchmarks/onboarding/golden-businesses.json` holds 17 researched businesses
(Atelier 10 regression; Dubai salon, restaurant, café, dental clinic, B2B fintech,
multi-branch nail chain; London, Bengaluru, New York, Singapore, Sydney, Toronto,
Berlin, regional UK, national UK; Nike). `benchmarks/onboarding/score.ts` scores
brand, kind, "not healthcare", country/city/neighbourhood, scope, offerings,
audience, researched rivals, 10/10/10, clinic wording, unbranded Discovery,
placed Discovery and geography levels.

```bash
SUN_DATA_DIR=/tmp/sun-eval/data SUN_EVIDENCE_DIR=/tmp/sun-eval/evidence \
  npx tsx scripts/eval-onboarding.ts --out /tmp/sun-eval/out --with-env-keys [--only 00-,05-] [--stages understand]
```

It crawls real sites and, with `--with-env-keys`, makes paid Understand and
Prompts calls; it refuses to run on `./data`.

## 6. Intake market, Search Console, competitor tiers and journey states (2026-09-14)

User feedback after the first rework asked for a market location on the entry
page, area / city / country competitors, a Search Console option, no results
before the analysis is complete, no rejected items or confidence labels, and a
loading animation on every page.

**Intake market.** `/trial/new` asks "Where are your customers?": a searchable
list of every ISO 3166-1 country (`lib/geo/iso3166.ts`, names from
`Intl.DisplayNames`) plus Worldwide, then, for one country, an optional area
search (`/api/geo/search`, OpenStreetMap Photon unless `GOOGLE_MAPS_API_KEY`).
The answer is a `MarketHint` stored as JSON in `projects.market_scope`
(`lib/projects/market-hint.ts`; legacy values parse to no hint). In
`resolveLocation` it is an `operator_stated` vote of weight 4, above a
structured address (3) and Search Console (2). It fills or overrides the
country, city and neighbourhood; a written address that contradicts it becomes
a conflict the Location card asks the operator to resolve ("You told us" badge).
Area names that are the same place ("DIFC" and "Dubai International Financial
Centre") keep the website's form. The hint also applies on a failed crawl and in
the rules-only fallback. The picker shows each country's flag (`lib/geo/flags.ts`,
regional-indicator emoji; a globe for Worldwide) and the committed choice keeps
its flag in the field and on the Location card; Windows, which draws no flag
emoji, falls back to the ISO code.

**Worldwide (2026-09-16).** Four geographies were conflated before: the head
office, the market served, the market the operator chose and the place answers
are observed from. For a business customers do not visit, choosing Worldwide now
means the office is *not* a market: `countriesServed` is emptied (or the office
country dropped unless the site names it among several served countries),
`markets` reads "Worldwide" first, the `geography` city/region mirrors exclude
the office, `marketCountries()` returns no country, the prompt context has no
places to hand out and the intent model gets `primaryMarket: "Worldwide"` with
no currency. Before this, Worldwide for Postman still produced "in the US" and
"for our San Francisco team" prompts. Place-bound businesses are unchanged: the
storefront's country is always a market. Chains with several branches in one
city are `local` ("3 locations, all in Bengaluru"), not national; only a head
office with many locations elsewhere becomes national.

**Market area (2026-09-16).** Local-search systems keep a business's
locations apart from the geography its customers are measured in, and so does
Project Sun now: `location.marketArea` (`understanding/market-area.ts`) is the
operator's intake or Location-editor area when it resolved to a place, else
the business's own footprint (one storefront → its neighbourhood; several
locations in one city → the city; a service-area business → its city; wider →
region or country; online → the market country or Worldwide). A city hint for
a chain keeps the first-listed address as one location among the others and
measures across the city; an area hint that names a branch makes that branch
the primary and measures around it. Prompt places, the intent model's
`primaryMarket`, competitor tiers and the Location card all read the market
area. Before this, Nawab (four Dubai branches, "Dubai" chosen) had four of ten
Discovery prompts in Jabel Ali, the branch whose address the website listed
first. The card's editor offers "Measure customers across": the whole city or
any one location's area.

**Products and services.** Offering groups are categories of what is sold,
never the website's structure ("Food menu", "Drinks menu", "Online ordering
categories" were groups for a restaurant). Menus and catalogues are summarised:
one group per section with two to five representative items, so a 150-dish
menu becomes about eight groups. The crawl now reads JS-rendered and iframed
menus (browser render waits for the text to settle and appends same-site
frames), which is where most restaurant menus live.

**Search Console.** Optional and read-only (`docs/SEARCH_CONSOLE.md`). It needs a
Google Cloud OAuth client in `.env.local`; without one the switch is disabled
with setup steps and nothing is requested from Google. When connected, the last
90 days of queries, pages and countries (brand queries split out in code) give
crawl priority to high-demand pages, a country vote, customer wording for the
understanding model (outside `<website>`, never citable) and a Search demand
section on Understand. Topics and prompts don't use it yet.

**Competitor tiers** (`lib/landscape/competitor-tiers.ts`, policy
`competitor-discovery@6`, `competitor-tiers@1`):

| Tier | When | Example group |
|---|---|---|
| Area | Strictly local: a single place-bound storefront with a neighbourhood or coordinates | "In DIFC" (nearby areas listed) |
| City | Almost everything with a city: place-bound, service-area and other locally scoped businesses, and place-bound groups of national or international scope whose primary address is a venue; not online-only software and not a national chain's head-office city | "Across Dubai" |
| Country | National, regional or international scope, a known brand (Wikidata entity, multi-location, many locations; no brand lists), or no local tier. Three countries for a regional chain or an online international business; one (the market) for a place-bound international business | "Across the United Arab Emirates", "Worldwide" |

Each source is tier-aware: one web-search brief per tier, model hypotheses with
a tier field, OpenStreetMap neighbours only for the area tier, open knowledge
only for the country tier. Suggestions are capped per tier (for example 6/6/6
for all three, 6/10 area+city). Tiers are stored in `entities.candidate_profile`
and on new frozen competitive sets; Measure reads only entity ids and names, so
it is unchanged. Trade Off prompts mix rivals across tiers.

**Journey states.** Understand shows only the staged progress rail and a
skeleton until `profile.ready`, then the whole profile; a restart mid-crawl
shows "Analyse again". Landscape and Prompts render immediately with a staged
`LoadingStage` and reveal results when generation completes; every project route
has `loading.tsx`. The UI no longer shows confidence levels, match percentages,
quality scores, rejected competitors, dropped claims or "ruled out" categories;
the data is still stored. Generate routes guard against duplicate runs in the
same process (`lib/jobs/active.ts`) and return `sinceSequence` so pages follow
only their own run's events.
