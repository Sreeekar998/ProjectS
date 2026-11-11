# Project Sun vs Opinly.ai: section-by-section comparison (intake → prompt generation)

**Date:** 2026-09-14 · **Audience:** Project Sun builder (technical); written to double as interview/demo prep
**Scope:** Opinly onboarding routes 01–11 vs Sun's Landing → `/trial/new` → Understand → Landscape → Prompts, with a short Measure/provenance section.
**Method:** read-only code review, read-only `sqlite3 -readonly data/sun.db`, one fresh eval run in an isolated scratch data dir. The Opinly teardown was read in full.

**Citation conventions**
- Sun claims cite repo-relative `file:line`, a DB table/row, or the fresh-run output.
- Opinly claims cite the teardown file plus an evidence label: **Observed / Inference / Vendor-stated / Unknown**.
- Opinly's dashboard sits behind a card wall and is **Unknown**. "Not in onboarding" never means "Opinly lacks it".

Legend used in tables: ✅ present · ◐ partial / with caveats · ❌ absent on the captured surface · ? unknown.

---

## 1. TL;DR

- **Overall verdict.** Before payment, the two products do very different jobs.
  - **Opinly:** ~2 minutes and one typed domain get you a data-free Competitive Score (44), then a card wall. The browser made no request to the brand's website through commit (network/08, network/11, Observed). A server-side crawl after commit is Unknown (WEBSITE-INGESTION.md §2 caveat).
  - **Sun:** reads the site and gives you an evidence-cited Brand Profile, tiered competitors, 4–6 topics and 30 reviewable prompts, all with no card. The fresh run took 305 s and cost an estimated $0.073 in model calls.
  - **Where Sun is ahead:** what is actually learned about the business, and honest numbers.
  - **Where Opinly is ahead, even before payment:**
    - intake friction (fewer clicks, name search with a logo)
    - language × country and multi-market choice
    - an explicit degraded-state contract
    - cross-session resume
    - a section progress indicator
    - a one-screen recap
    - an export (H3, H4, M4, M5, #17)
  - Opinly's actual measurement product is Unknown.
- **Biggest win: knowing the business.** For atelier10.ae, Opinly's onboarding learns `{name: "Atelier10", domain, favicon}` plus the operator's self-picked "Local Business" and "English × UAE". Sun derives:
  - "Atelier 10 Salon, luxury full-service beauty salon", from HairSalon JSON-LD
  - a premise-level address (Staybridge Suites, 6th Floor, Sheikh Zayed Road, DIFC) with coordinates
  - 34 grouped services and audience segments
  - evidence links on the main profile fields (the price/booking line and rules-only fields are the exceptions)
- **Second win: honest numbers.** Sun shows no visibility score before measurement. One leak: the Prompts Why? panel still shows prompt-selection scores ("Quality n/100"; M14). Remove them before a demo (§11 #5). Measure shows `x of n`, `—` for empty denominators and "so far" on partial runs, with definitions and drill-down to the answers. Opinly's 44 / "56% have a better score" re-render identically with zero data-bearing requests (network/08, Observed); 56 is simply 100 − 44.
- **Prompts are now demo-grade in Discovery (single run; one ungrammatical prompt passed the judge).** On current code, all 10 atelier10 Discovery prompts name a place, none uses the place as an adjective (the old run had 8/10 like "a Dubai salon"), nails are covered, and golden prompt checks pass 8/8. Opinly shows no prompt before payment.
- **Biggest honest gap: local competitor recall.** Every atelier10 run so far found 0/5 researched DIFC rivals. The fresh run surfaced 2 rivals, both from model memory:
  - "The Grooming Company" carries a **"Website verified"** badge, but the pages actually read were its parent group's site (omorfiagroup.com).
  - It was frozen as the old run's *only* rival, so all 10 Trade Offs compared against it.
  - In the one fresh run, grounded search returned 429 and OSM Overpass returned `[]` (cause unverified: sources swallow errors).
- **Biggest thing to copy: an explicit degraded-state contract.** When Opinly's directory returned `upstreamFailed: true`, the UI switched to manual entry with blameless copy (network/03, Observed). Sun's equivalents fail silently:
  - Landscape sources swallow errors as `[]`.
  - Model fallbacks go unannounced.
  - Prompts shows a generic failure when Landscape isn't confirmed.
  - Measure shows API errors as the empty state.
- **Other takeaways worth acting on:**
  - a "Recent analyses" resume list (8 duplicate atelier10.ae projects exist today)
  - a Website field on manual competitor add
  - a Final-checks-style recap before freezing
  - a visible price/estimate next to collection (pending re-check: see the collection rework note in §2.3)
  - an as-of date on Measure
- **Moved under this report:** at 19:39–20:32 the same day, collection was rewired to consumer-web vendor routes (Bright Data, cloro, Decodo), and the API and by-hand lanes were retired. Collection-specific claims below reflect the code as of 19:37 (§2.3).
- **Refuse:** data-free scores and forecasts, decorative "Checking SOG…" loaders, pre-enabled paid add-ons, segmentation questions that change nothing, geo-IP market defaults, a name directory as the source of identity, and skippable competitors.

---

## 2. Evidence base & caveats

### 2.1 Opinly capture

| Item | Detail |
|---|---|
| Surface covered | Onboarding routes **01–11** only (Brand/Agency → company search → competitors → growth interstitial → role/team/business type → Competitive Score → Locations → Final checks → paywall). Captured as semantic DOM (`html/`), page text (`notes/pagetext/`) and API shapes (`network/`). |
| Not covered | Dashboard: `/dashboard` redirects to `/pricing` (network/11, Observed). Crawl, prompts, metrics, citations, cadence and collection method are all **Unknown**. |
| Session | An already-authenticated Clerk session, so sign-up time is excluded from "~2 minutes" (USER-FLOW.md, README.md). |
| Teardown inconsistencies | (1) `network/10` says "Confirm and continue" was **not** captured; `network/11` and WEBSITE-INGESTION.md §2 document the click and the paywall requests. We rely on network/11. The WEBSITE-INGESTION.md header ("up to but not including Confirm and continue") and USER-FLOW.md ("Reached: routes 01-10", though its table marks 11 captured) carry the same inconsistency. (2) The Attribution step is in PARAMETERS.md §7 only (no html, pagetext or network capture), and its "Section 4 of 6" label clashes with route 08. Treated as unverified. (3) The "not semantic" competitor-search claim rests on "interior design dubai", which returned `upstreamFailed: true`, so it is confounded (network/03). Downgraded to Inference. (4) No screenshots are on disk (screenshots/README.md), so visual claims (gauge colours, "India pre-highlighted", the growth chart) rest on text notes only. (5) The teardown's local-prompt examples ("interior designers in Jumeirah", "architects near DIFC"; TAKEAWAYS §4, PROMPT-GENERATION.md) were written for the mislabelled design studio. Re-read them with the brand as a salon. |
| Server-side crawl | Every "zero requests to atelier10.ae" in this report means **no browser-visible request through commit** (network/08, network/11, Observed). WEBSITE-INGESTION.md §2 itself says a crawl may run server-side and asynchronously after commit. That is **Unknown**, not absent. |
| "Design studio" label | This is the **teardown author's** label (README.md), not an Opinly output. Opinly's autocomplete ranked the correct domain first, with a look-alike "Atelier10 Design Studi…" (ronaksinghvi.com) second (notes/pagetext/02, Observed). The operator's competitor pick, Bishop Design, is *presumably* an interior-design firm given the tester's query "interior design dubai" (Inference; bishopdesign.com was not checked). The mislabel → pick link is likewise Inference. |

### 2.2 What atelier10.ae actually is (verified)

A **luxury beauty salon** (hair, nails, lashes & brows, barber):
- Address: 6th Floor, Staybridge Suites Dubai Financial Centre, Sheikh Zayed Road, Dubai. Coordinates 25.2118, 55.2740.
- Founder Joseph Mansour; open 10:00–20:00 daily; phone +971 4 572 8973; Fresha booking.
- JSON-LD `HairSalon` with `aggregateRating` 5.0 / 94.

Sources: evidence item "Declared schema type: HairSalon" (fresh `ev_00b21855…`, live `ev_05737541`); `evidence-store/prj_fef2f186…/777c2ff0….txt`, `a0292c18….txt`, `ca054fb1….txt`; `crawl_pages.json_ld`.

CLAUDE.md's "Atelier 10 Salon" is correct. One point is not verified: whether the hotel sits inside DIFC proper, since the JSON-LD address also says "Trade Center First".

### 2.3 Sun evidence used

| Source | What | Notes |
|---|---|---|
| Code review | Every page, feature component and lib path cited below | Read-only. UI states are derived from code, not from a browser session. |
| Live DB `data/sun.db` (read-only) | 36 projects. **8 atelier10.ae projects** created 2026-09-11 → 2026-09-13; the latest is `prj_fef2f186-22fc-4cf9-84e2-1a03acdb3a2f` (created 2026-09-13 20:16:38 UTC; crawl `crw_1e338200`; profile `bpv_d3e65980`; competitive set `csv_18428a0a`; prompt set `pset_1c6f1d66`, status `reviewing`, 0 prompt runs) | All 8 have `market_scope = "global"`, so none used the new intake hint. Also used: `boldin.in` `pset_1b8e2d76` (the only approved discovery@2 set), `nike.in` `crun_4df4d2c3` / `crun_9a0f2ed8` (Measure), `wipro.com` `prj_a8f1fdf1` (national discovery). |
| Fresh current-code run (2026-09-14) | **Completed, exit 0, 305 s.** `SUN_DATA_DIR`/`SUN_EVIDENCE_DIR` pointed at the session scratchpad (`…/scratchpad/fresh/`), `npx tsx scripts/eval-onboarding.ts --only 00- --with-env-keys --with-hints`, Node v20.13.0, `SUN_ALLOW_PAID_LANDSCAPE` and `SUN_LLM_NO_PAID` unset. Project `prj_867e0018…`. | Nothing was written to `./data` or `./evidence-store`. The runner calls orchestrators directly (not the HTTP routes), sent the hint `{countryCodes:["AE"], area:{query:"DIFC", place:null}}` (bypassing the UI's must-pick rule), auto-confirmed the profile, topics and up to 5 rivals, and **did not approve prompts**. Single run, so variance is unmeasured. The scratch output is session-local and not durable. |
| Golden benchmark | `benchmarks/onboarding/golden-businesses.json` case `00-dubai-luxury-salon-atelier10`; prior results `benchmarks/onboarding/results-2026-09-13.md` | |
| Code snapshot | Code verified as of **2026-09-14 19:37** (report write time) | Other agents kept editing afterwards; see the note below |

> **Collection rework landed after this snapshot (re-checked 2026-09-14, read-only).** Between 19:39 and 20:32:
> - `src/lib/providers/engines.ts`, `catalog.ts`, `route-policy-seed.ts`, `src/lib/collection/consumer-collector.ts`, `orchestrator.ts`, `src/lib/brightdata/client.ts`, `src/components/features/observation-console.tsx` and `src/app/projects/[id]/measure/page.tsx` changed.
> - Collection now uses **consumer-web vendor routes**: `chatgpt_brightdata_web`, `chatgpt_cloro_web`, `chatgpt_decodo_web`, `gemini_cloro_web`. Each is `enabled: "optional"` when its vendor key is present; the route-policy notes say "Not authorized by OpenAI".
> - The model-API lanes and by-hand capture are **"retired … on 2026-09-14"** (`engines.ts:9-13`, `route-policy-seed.ts:5-13`).
> - The console now reads "Connect a collection provider" / "Bright Data collects ChatGPT; cloro collects ChatGPT and Gemini; Decodo collects ChatGPT… All three have a free tier."
> - CLAUDE.md:32 ("Never automate the consumer ChatGPT or Gemini apps… Automated lanes use provider APIs only", last edited 07:57) is now **stale against the code**. This follows the user's 2026-09-14 collection memo in `Phase 2/`; this report does not re-litigate it.
>
> **Affected here and pending re-verification:** §4.7 collection rows, §6.6 lane details, inspire #6, #20, #38 and #39, M2, M12 and M19, §9 #6's demo, §11 #6–#7. Onboarding (Understand → Prompts) findings are unaffected.

### 2.4 Cost incurred

- **Fresh run:** estimated **$0.0729** at list prices across 28 model calls (18 failed).
  - Understand extract: `gpt-5.6-luna`, $0.0056.
  - Prompts: luna + terra, $0.0640.
  - Discovery judge: luna, $0.0032.
  - Landscape (topics, competitors, search): $0, on the free Gemini chain.
  - Paid OpenAI was used only on the stages the user approved (Understand, Prompts). No collection ran, so there was no Measure spend.
- **This review:** $0 (reads only).

### 2.5 Not verified

- Rendered UI: nothing was opened in a browser, and click counts are estimates derived from code.
- Whether The Grooming Company or Sisters Beauty Lounge actually operate in DIFC.
- The cause of the empty Overpass results: sources catch errors as `[]`, so an error and a true empty look the same.
- The conflict path of intake-hint reconciliation (no live example exists).
- Run-to-run variance.

---

## 3. Journey at a glance

### 3.1 Route map

| # | Opinly route (onboarding) | User action | Real or decorative (label) | Sun counterpart |
|---|---|---|---|---|
| 01 | "Let's setup your workspace": Brand / Agency, 6-segment bar, "Section 1 of 6" | 1 click | Real save; dashboard effect Unknown (Observed) | None: single operator, no tenancy (CLAUDE.md:11) |
| 02 | Company search "Company name or website" | Type, pick a row | Real directory lookup `{name, domain, logo}`; **no browser-visible request to the site** (Observed; server-side crawl Unknown) | Landing hero field → `/trial/new` Website (`src/app/trial/new/page.tsx:342-355`) |
| 03 | "Who are your competitors?" search / manual / Skip | Optional | Real list; no suggestions, no relevance check (Observed) | Landscape auto-discovery + manual add (`src/app/projects/[id]/landscape/page.tsx:427-476`) |
| 04 | "Opinly will grow Atelier10's traffic by 104%" | Continue | **Decorative**: no request produces it (Observed; fabricated = Inference, high) | None |
| 05–07 | Role, team size, business type (auto-advance radios) | 3 clicks | Real saves; segmentation only (Inference) | None asked; classification derived in Understand |
| (§7) | Attribution + "tried other trackers" | ? | PARAMETERS.md §7 only; unverified | None |
| 08 | Competitive Score 44, 4 sub-scores, "+ 12 others", PNG export | Wait ~10–12 s | **Decorative loader + data-free score** (Observed; domain-seeded = Inference, very high) | Understand progress rail driven by real pipeline events (`src/lib/client/understand-progress.ts:115-181`) |
| 09 | "Where are your customers based?" 44 languages × 112 locales | Multi-select | Real input, country grain; India pre-selected (Observed) | `/trial/new` country + optional area (`page.tsx:357-459`) |
| 10 | "Final checks" summary | Confirm and continue | Real read-back of the typed inputs (Observed) | No single summary; review happens on the Understand / Landscape / Prompts gates |
| 11 | Paywall: $4/mo + $59/mo LLM Visibility (pre-on), card on Day 3 | Card | Commercial gate (Observed) | None: "No card needed for this local Phase 2 trial" (`src/components/marketing/landing-sections.tsx:308`) |
| — | `/dashboard/<company>/…` | — | **Unknown** (redirects to `/pricing`) | Understand → Landscape → Prompts → Measure |

### 3.2 Friction and time to value

| Metric | Opinly (onboarding) | Project Sun |
|---|---|---|
| Screens before first output | 7 screens to a data-free score (route 08); 10 to Final checks; real output behind the card wall (Unknown) | 1 intake screen, then stage pages |
| Required typed input | 1 domain (competitor optional) | 1 website (URL or bare domain) |
| Optional inputs | Competitor domains, locales (+ 3 segmentation radios) | Country (single), area/city, Search Console |
| Clicks on the happy path | ~8 after typing, to Final checks (estimate from html/01–10) | ~11–13 to start collection: Analyse, Confirm profile, 4–6 topic Confirms, ≥1 competitor Confirm, Confirm & continue, Approve 30, Continue, Collect. Code-derived estimate (journey-ux). |
| Time to first output | ~2 min to Final checks (USER-FLOW.md, Observed); the output is data-free | Profile ready **16–93 s** after submit, median ~40 s, across the 12 most recent projects (`events.profile.ready − projects.created_at`, re-checked). Fresh eval: 305 s end to end to 30 prompts, excluding review. Old live atelier10 run: ~6.4 min including two operator confirms. |
| Requests to the brand's site | **0 browser-visible** through commit (network/08, network/11, Observed); server-side crawl after commit Unknown | robots.txt, sitemaps, 30 page fetches (`crawl_runs crw_1e338200`) |
| First real output | Behind the card wall (Unknown) | Evidence-cited Brand Profile, before any metric |
| Commercial gate | Card wall; $59 add-on switched on | None. The paid OpenAI collection lane is auto-preferred when a key exists, with no price shown (see §10). |

Not like-for-like: Opinly's path ends at a paywall, Sun's at measured answers. Opinly wins on click count; Sun wins on time to *real* output. Opinly's paywall promises "Live in 60 seconds, no setup calls" (html/11, Observed copy); Sun's honest equivalent is ~40 s to a profile and 305 s to 30 prompts.

### 3.3 The Overview → Actions loop mapping

USER-FLOW.md maps Opinly onto the brief's narrative and calls it a contrast slide (teardown framing, Observed):

| Brief stage | Opinly onboarding | Project Sun |
|---|---|---|
| Overview | Competitive Score card, **shown before any data exists** | Understand's evidence-cited profile, shown **after** the crawl |
| Prompt Generation | Absent from onboarding (dashboard Unknown) | Prompts: 30 reviewed, approved and frozen |
| Analysis | A 10 s animation stands in for it | Measure: deterministic, versioned analysis, `x of n` |
| Actions | Absent from onboarding | **Out of scope by decision** (CLAUDE.md "Scope stops at Measure") |
| Feedback Loop | Absent from onboarding | **Out of scope by decision** |

Sequencing is the point: Opinly puts output before data; Sun puts data before output.

---

## 4. Parameters, side by side

Every operator-facing parameter, verbatim where it matters. An Opinly ❌ always means "not in onboarding (dashboard unknown)".

### 4.1 Identity / brand

| Parameter | Opinly | Project Sun | Feeds |
|---|---|---|---|
| Workspace type | ✅ Brand "Track your own company" / Agency "Track multiple companies"; 1 click (html/01, Observed). Company caps 1/3/10 by plan (Vendor-stated); dashboard effect ? | ❌ Single operator, no auth or tenancy, by design (CLAUDE.md:11) | Opinly: workspace mode |
| Brand entry | ✅ Debounced "Company name or website" → `companies.autoCompleteCompany` returns `{name, domain, logo}` + `upstreamFailed`. "Enter manually instead": Website (required, `acme.com`) + Company name (optional, derived from the domain) (network/02, pagetext/03, Observed) | ◐ `#url`, **required**, placeholder `https://example.com`. URL or bare domain only. Names containing spaces are rejected ("<input>" is not a valid URL). Single-word names such as "Atelier10" pass as hostnames, create a project, and fail later at crawl (no DNS/TLD check; ties to #29 and the orphan-project note in §6.2). Server: `z.string().trim().min(1).max(2048)` + `normalizeUrl`, which allows http/https only, rejects private/loopback IP literals and blocked hosts, strips tracking params. **No DNS/reachability check** (`src/app/api/projects/route.ts:11`; `src/lib/security/url-safety.ts:47-94`) | Sun: `projects.url`, `registrable_domain`, crawl seed |
| Landing handoff | n/a | ✅ Hero/final CTA "Analyze my brand →" (US spelling; intake says "Analyse"). Pushes `/trial/new?url=`, which **pre-fills, does not start**. Query params: `url`, `start=1` (auto-start once), `country=<ISO2>`, `worldwide=1`, `gsc_return`/`gsc_status` (`src/components/marketing/website-start-form.tsx:6-20`; `src/app/trial/new/page.tsx:72-76, 88-93, 225-273`) | Intake state |
| Brand name | ◐ Directory name "Atelier10" | ✅ Derived from site JSON-LD + model ("Atelier 10 Salon", alias "Atelier 10", 4 evidence ids). Editable "Brand name" 1–80; aliases ≤10×80 via API (`src/app/api/projects/[id]/profile/route.ts:51-79`) | Leakage lexicon, name forms, mention linking |
| Logo | ✅ Google `s2/favicons` on result rows and chips (network/02, Observed) | ❌ Not displayed; logo src stored only as evidence (`src/lib/evidence/builder.ts:199-200`) | Visual confirmation |
| Description / positioning | ❌ | ✅ Description 1–600 with Why?; Brand identity chips ≤8×60; differentiators stored, not shown | Prompt context |
| Offerings | ❌ | ✅ ≤40, grouped as on the site, type product/service/category/solution; price range + booking platforms line | Topics, intent model |
| Contact / hours / rating | ❌ | ◐ Phones, emails and socials stored (model path only); hours are evidence only; `aggregateRating` never extracted; **none displayed** (`src/lib/understanding/index.ts:345-362`) | Nothing downstream |
| Correct identity later | ◐ Back on every step; Edit pencil on Role & Industry only (html/10, Observed) | ✅ Whole-profile editor + Business type / Location card editors; every edit creates a new version (`src/app/projects/[id]/understand/page.tsx:405-704`) | Versioned profile |

### 4.2 Geography & language

| Parameter | Opinly | Project Sun | Feeds |
|---|---|---|---|
| Market country | ✅ "Where are your customers based?": searchable **multi-select** grouped by language, **44 languages × 112 locales = 90 distinct countries**. **India pre-selected** (Observed; geo-IP = Inference). Qatar, Kuwait, Oman, Lebanon, Iraq and China are absent (computed from the Observed list) | ◐ "Where are your customers?" combobox, **single choice**, Optional. **Default "Detect from my website"** (`auto`, "From your address, phone and domain"). Then "Worldwide / online" ("Customers anywhere, e.g. an online store or software"), then all ISO 3166-1 + Kosovo = **252 options**. Aliases like `uae`, `uk`→GB, `cote`. No geo-IP or locale default, by design (`src/app/trial/new/page.tsx:30-36, 357-378`; `src/lib/geo/country-search.ts:17-116`). API accepts ≤10 countries; the UI sends 1 (`src/lib/projects/market-hint.ts:27-68`) | `projects.market_scope` MarketHint → `resolveLocation` |
| Area / city | ❌ 0 cities, regions or radius | ✅ "Area or city", shown only after a country is picked. Placeholder "Neighbourhood, area or city"; levels region→premise, strict in-country; 2–120 chars, 350 ms debounce. Typed-but-unpicked text with suggestions blocks submit ("Choose a place from the list, or clear this field."); a search outage degrades to "Place search is unavailable. We'll look up “q” during analysis." OpenStreetMap here (no `GOOGLE_MAPS_API_KEY`) (`page.tsx:380-459`; `src/components/features/place-search.tsx:62-294`) | Area (3 km) / city / country competitor tiers; prompt places |
| Language | ✅ Paired with country (e.g. Arabic × UAE). Whether prompts are localised: Unknown | ❌ `language` API-only, `default("en")`, no UI. Logged as `targetLanguage` but **never passed as Accept-Language** (`src/app/api/projects/route.ts:16`; `src/lib/crawler/orchestrator.ts:138, 525-529`). Gates and prompts are English only; non-Latin pages get dropped as near-duplicates (docs/KNOWN_ISSUES.md:15) | — |
| Hint vs website | ❌ No site read in onboarding | ✅ Rule-based, applied **after** the website's own votes. Recorded as an `operator_stated` signal of weight 4 but **not summed**. Outcomes: `filled` / `agreed` / `noted` / `conflict` / `overrode` / `unresolved`; conflict and unresolved force confirmation (`src/lib/understanding/location.ts:431-495, 716-721`, re-checked). CLAUDE.md:114's "strongest location vote" is loose wording | Location card "You told us…" |
| Location editor | ❌ | ✅ "Change location": place search ("Area, address or building"); Neighbourhood/City/Region/Country ≤120; "Where customers come from" (7 options, default "Work it out from the location"); nearby areas ≤10; countries served ≤30 (online/wide scope only); conflict buttons "Keep <place>" / "Use the website's location" (`src/components/features/location-card.tsx:56-63, 251-587`) | Tiers, prompt geography |

### 4.3 Competitors

| Parameter | Opinly | Project Sun | Feeds |
|---|---|---|---|
| Discovery | ❌ No suggestion call (network/03, Observed) | ✅ 6 sources in parallel (website regex, grounded search per tier, OSM nearby, AI hypotheses, Wikidata/Wikipedia, authorized search disabled) → resolve → LLM screening → `safeFetchHtml` verification (≤4 pages, 7.5 s, 350 KB) → scoring → per-tier quotas (`src/lib/landscape/competitors.ts:141-235`) | Frozen competitive set |
| Manual entry | ✅ Search, or Website (**required**) + Company name (optional, auto-derived). "Add Company" disabled until Website is filled; "Skip for now" | ◐ "Add a competitor…" **name only** (the API accepts `domain`; the page never sends it). No verification, screening or dedupe; always inserts a confirmed `user_manual` row (`landscape/page.tsx:281-289, 462-474`; `route.ts:72, 105-115`; `src/lib/landscape/repository.ts:182-214`) | — |
| Relationship | ❌ | ✅ Direct (default) / Substitute / Marketplace / aggregator / Adjacent. Marketplaces are never frozen, compared or tracked (`repository.ts:463-466`); re-typing is possible on manual rows only | Trade Offs eligibility |
| Where it competes (tier) | ❌ | ✅ Headings "In {area}" / "Nearby", "Across {city}", "Across {country}" / "Worldwide"; default `plan.primaryTier`. For atelier10: "In DIFC" + "Across Dubai", primary city (`src/lib/landscape/competitor-tiers.ts:224-328, 658-662`) | Grouping, Trade Off round-robin |
| Caps | No in-product cap; 3/8/10 by plan (Vendor-stated) | Suggestions 16 (18 with 3 tiers); tier quotas e.g. area+city [6,10]; up to 8 rejected rows stored; manual adds uncapped; Trade Offs use ≤5 rivals (`competitor-tiers.ts:215-222`) | — |
| Gate | Skippable | ≥1 confirmed non-marketplace competitor **required** (`landscape/page.tsx:316-323`) | Prompts |
| Explainability | Logo + name + domain link | "Why?": Matched on / Evidence (tier evidence, verification summary, "Located in …", "Its website mentions …", Source page). No domain on the row itself | — |

### 4.4 Business type / segmentation

| Parameter | Opinly | Project Sun | Feeds |
|---|---|---|---|
| Business type | ✅ Radio: Freelancer · E-commerce · Blogger · Affiliate Marketer · Local Business · Marketing / SEO Agency · Professional Services · Tech Company · Other (Observed). Effect on measurement: Inference, none seen | ✅ **Derived**: open classification path + 1 of 23 closed kinds. Editor: Business type (required, ≤120), Industry (≤120), Kind of business (23), How customers reach it (One location customers visit / Several locations or branches / Goes to customers in an area / Online only / Not sure), plus "Suggestions:" chips (`src/components/features/business-type-card.tsx:21-245`; `src/lib/understanding/kinds.ts:17-68`) | Place-bound behaviour, regulated gate, prompt choice unit |
| Role | ✅ Founder · Marketing Director · Marketing Manager · Social Media Manager · Content Creator · Other | ❌ (refused on purpose) | Opinly: segmentation (Inference) |
| Team size | ✅ Just Me · 2-5 · 6-10 · 11-20 · 20+ | ❌ | same |
| Attribution / trackers | ? Instagram · YouTube · Facebook · Google · Twitter · Other (+ "Custom traffic source"); "Have you tried any other trackers?" Yes/No (PARAMETERS.md §7 only, uncaptured) | ❌ | same |

### 4.5 Topics / personas / intent

| Parameter | Opinly | Project Sun | Feeds |
|---|---|---|---|
| Topics | ❌ | ✅ Model asked for "5 or 6" (temperature 0.3), grounded in offering groups, brand- and place-free, with a rules fallback. Per-row Confirm/Remove; "Add a topic…". Gate: **4–6 confirmed rows** (counts rows, so duplicates pass) (`src/lib/landscape/topic-generation.ts:20-147`; `route.ts:117-122`) | `topicSnapshot` → intent model (soft guidance) |
| Audience / personas | ❌ | ✅ Up to 6 segments with geo tags (Nearby, City-wide, Visitors, Regional, National, International, Online) | Prompt context |
| Customer intent model | ❌ / ? | ✅ Not shown to the user. 5–8 shopping needs (grounded) · 5–8 concerns · 5–7 decision factors (name-filtered only) · 3–6 distinctive claims kept out of Discovery (`src/lib/prompts/intent-model.ts:173-326`) | Discovery slots, Trade Off criteria, Sentiment themes |
| Search demand | ❌ | ◐ Search Console queries collected on Understand; **not used** by topics or prompts (docs/SEARCH_CONSOLE.md:3-10) | — |

### 4.6 Prompts

| Parameter | Opinly | Project Sun | Feeds |
|---|---|---|---|
| Seed / preview / approval | ❌ In onboarding. "manage the prompts you monitor" via MCP (Vendor-stated; CRUD = Inference) | ✅ Exactly **30 = 10 Discovery / 10 Trade Offs / 10 Sentiment Analysis**; "Approve n / 30 prompts" enabled only at 30; approval re-validates and writes `frozenHash` (`src/lib/prompts/orchestrator.ts:607-660`) | Collection gate |
| Row actions | ? | ✅ Why? (Context, Brand policy, Scoring, Selected because) · Edit (8–300 chars, "Save and revalidate") · Regenerate · Replace · Deselect · Reject (`src/app/projects/[id]/prompts/page.tsx:510-553`) | PATCH `/api/prompt-sets/[id]` |
| Add your own | ? | ✅ Per section, ≤300 chars, "Check and add" at ≥8. "Replaces" select appears when the section is full; plain-language rule failures (`page.tsx:564-625`) | Custom prompts skip the natural-language gate and the judge |
| Alternatives | ? | ◐ "Review N validated alternatives": **first 12 in DB order** (unsorted; mostly template splices) (`src/lib/prompts/repository.ts:80-83`) | Select |
| Filters | ? | ✅ "Search prompts…", "All topics", "All intents" (options come from all candidates, including rejected ones) | Client-side |
| Generation force | ? | `POST …/prompts/generate?force=1`, offered only on the failed/stalled panels | New version |

### 4.7 Engines / models

| Parameter | Opinly | Project Sun | Feeds |
|---|---|---|---|
| Engines | ◐ No control in onboarding. Paywall copy names ChatGPT, Gemini, Claude (vendor claim seen in-app) | ◐ ChatGPT + Gemini only. Engine tabs All / ChatGPT / Gemini with counts (`src/app/projects/[id]/measure/page.tsx:334-351`) | Scope switch |
| Search-integrated surfaces (Google AI Overviews, AI Mode, Perplexity) | ❌ Not in the vendor-stated coverage list (TAKEAWAYS §7, MEASUREMENT-METHODOLOGY.md §6, Vendor-stated) | ❌ Not covered. See decision item #41 | — |
| Collection routes | ? Undisclosed (API vs scraping Unknown) | **⚠ Superseded after 19:37 (§2.3):** now consumer-web vendor routes `chatgpt_brightdata_web` / `chatgpt_cloro_web` / `chatgpt_decodo_web` / `gemini_cloro_web`; the routes below are retired. At snapshot time: ✅ `gemini_free_api` (`gemini-flash-lite-latest`), `groq_free_api` / `cerebras_free_api` (`gpt-oss-120b`), `openai_api` (`gpt-5-nano`, **paid**), `chatgpt_manual`, `gemini_manual`. Consumer-app automation disabled by policy (`src/lib/providers/route-policy-seed.ts:69-77`) | Measure method notes |
| Key form | n/a | **Superseded:** now "Connect a collection provider" (Bright Data / cloro / Decodo). At snapshot time: Provider: Gemini (Google AI Studio key) (default) / ChatGPT (OpenAI key) / ChatGPT (Cerebras key); Connect at ≥8 chars. The only "paid per question" copy lives here, and the form is hidden when a key exists (`src/components/features/observation-console.tsx:311-348`) | Credentials |
| Onboarding model routing | ? | extract `gpt-5.6-luna` → Gemini fallbacks. Prompts `gpt-5.6-terra` → luna → Gemini. Judge luna. Landscape = free Gemini chain unless `SUN_ALLOW_PAID_LANDSCAPE=1` (not approved) (`src/lib/llm/routing.ts:32-81, 157-170`) | Cost, quality |

### 4.8 Cadence / metering / pricing

| Parameter | Opinly | Project Sun |
|---|---|---|
| Sampling cadence | "Daily keyword tracking" (Vendor-stated); "Daily rank tracking across up to 3 competitors" (paywall copy, Observed); LLM cadence Unknown | 1 sample per prompt × route, labelled "Directional baseline"; no schedule (`src/lib/measure/policy.ts:186-191`) |
| Plans / price | PERSONAL $4/mo (from $6), 3-day trial, card charged Day 3; **LLM Visibility $59/mo switched on** (`aria-checked="true"`); currency USD/EUR/GBP, no AED (Observed). Keywords 50/100/300, competitors 3/8/10, companies 1/3/10 (Vendor-stated) | No pricing. Internal model cost ≈ $0.07 per onboarding (fresh run). Paid lane auto-preferred when an OpenAI key exists (user decision, CLAUDE.md:35) with **no estimate shown** |
| Export | ✅ "Download report as PNG" (output Unknown) | ❌ No export, print or CSV |

### 4.9 Integrations

| Parameter | Opinly | Project Sun |
|---|---|---|
| Google Search Console | ❌ | ✅ Optional `#gsc-toggle`, `webmasters.readonly`. Consent happens **before** a project exists; draft kept in `sessionStorage` `sun.intake.draft.v1` (15-min TTL); `SUN_GSC_LOOKBACK_DAYS` 90 (7–480), `SUN_GSC_WAIT_MS` 20000. Only useful for sites the connected account owns: the one live pull (boldin.in) skipped with `no_matching_property` (`src/components/features/search-console-toggle.tsx:31-157`; docs/SEARCH_CONSOLE.md) |
| MCP / llms.txt | Remote MCP `mcp.opinly.ai/mcp` (OAuth); llms.txt on docs (Vendor-stated) | ❌ |
| CMS publishing | WordPress/Shopify/Webflow/Wix/Framer (paywall copy; capability Vendor-stated) | ❌ Out of scope (stops at Measure) |
| Telemetry | Sentry, PostHog, first-party `/track`, GA4/GTM, Klaviyo, Meta, Google Ads, OpenAI ad pixel, Tolt (network/01, Observed) | None (local-first); `console.error` + events table only |

### 4.10 Sources / citations

| Parameter | Opinly | Project Sun |
|---|---|---|
| Citation surface | ❌ Not in onboarding (Observed). Marketing site claims "Brand mentions and citation sources in AI assistants" (SOURCES-AND-CITATIONS.md, Vendor-stated); dashboard Unknown | ✅ Measure "Your own site" panel ("Answers citing your site", "…of answers that showed sources") + "Most-cited sites" ("Answers citing each site, and total links to it."), capture-state aware (`src/lib/measure/policy.ts:108-137`; `src/app/projects/[id]/measure/page.tsx:285-291`) |
| Source-type classification (owned / earned / social / directory / news / forum / review) | ? Unknown | ◐ Owned and rival domain tags only; no source-type taxonomy |
| Per-model / per-country attribution | ? Unknown | ◐ Per engine via the engine tabs; no per-country breakdown |
| Backlink graph ↔ AI citations joined | ? Unknown (two separate models, Inference) | ❌ No backlink data (out of scope) |
| Local source ecosystems (Google Business Profile, regional directories, local press, Instagram; TAKEAWAYS §4) | ❌ Geography is attached to the query only (SOURCES-AND-CITATIONS.md, Observed) | ❌ Not modelled. See #42 |

---

## 5. Opinly page-by-page review

### 01 · Brand or Agency (`/onboarding`, Section 1 of 6)
- **Sees:** 6-segment progress bar, "Section 1 of 6", "Let's setup your workspace", "Track your company against competitors or your clients' companies vs their competitors", two large buttons Brand / Agency. No Back button.
- **Works:** one click advances; `profile.profile` (tRPC) on load; Clerk session already live. On load, Meta pixel, Google Ads, Klaviyo, PostHog, Sentry and the OpenAI ad-pixel SDK all fire (html/01, network/01, Observed).
- **Verdict:** frictionless and honest. It says nothing about the business, but the progress bar orients the user well.
- **Sun equivalent:** none (no tenancy). Sun has no step counter on `/trial/new` or a stage counter before JourneyNav. **Opinly better** on orientation; the multi-brand need is better met locally by a resume list than by a workspace fork.

### 02 · Company search + select
- **Sees:** Back; "Search for your company and we'll gather the information we need."; input "Company name or website" with Clear search; rows show favicon, name and domain. For "atelier10.ae": **Atelier10 / atelier10.ae** (first), **"Atelier10 Design Studi…" / ronaksinghvi.com**, **atelier100 / atelier100.com**. The pick becomes a chip with "Remove company", then Continue.
- **Works:** debounced `companies.autoCompleteCompany {search}` returns `{companies:[{name,domain,logo}], upstreamFailed}`; logos come from `google.com/s2/favicons`; Continue sends `partialSaveOnboardingData {companyData}`. **No browser-visible request to atelier10.ae** (network/02, Observed; third-party directory = Inference, high; server-side crawl after commit Unknown).
- **Verdict:** fast, and the correct domain ranked first. It is a name/domain match, not an understanding of the business: no category, no description, and a look-alike one row away. The "we'll gather the information" copy is not backed by any observed gathering during onboarding.
- **Sun equivalent:** `/trial/new` Website field. **Opinly better** on accepting a name and showing a logo. **Sun better** on what is learned (§6.3). Sun has no identity preview before the 30–90 s crawl, so a typo creates an orphan project.

### 03 · Competitors + manual fallback (Section 2 of 6)
- **Sees:** "Who are your competitors?", "Search for a competitor", "Enter manually instead", "Skip for now". When the vendor failed, a panel appeared automatically: **"Company search is temporarily unavailable. Pop the website in below and we'll do the rest."** It has Website (required, `acme.com`), Company name (optional, `Acme`), Cancel, and Add Company (disabled until Website is filled). The resulting chip: "Bishopdesign / bishopdesign.com".
- **Works:** same endpoint as the brand search; `upstreamFailed: true` swaps in the manual UI; the name is derived client-side by stripping the TLD and capitalising (network/03, Observed). No suggestion call. The "not semantic" claim is confounded, because the only category query ran during the outage (Inference).
- **Verdict:** **best-practice degraded-state contract**, designed into the API response. Domain-first manual entry gives a stable identity key. Weaknesses: the user must already know their rivals, and onboarding ran no visible check that Bishop Design (presumably an interior-design firm; Inference, not verified) competes with a salon. The pick was the tester's input; onboarding accepted it without any visible check (Observed). Any dashboard-side check is Unknown.
- **Sun equivalent:** Landscape. **Sun better** on discovery, relationship type, tiers, verification and Why?. **Opinly better** on the degraded-state pattern and on manual entry carrying a website.

### 04 · Growth interstitial (labelled Section 3 of 6)
- **Sees:** "Opinly boosts company growth", **"Opinly will grow Atelier10's traffic by 104%"**, a decorative two-line chart (Aug–Nov in pagetext; Sept–Nov in the html), "Users typically see results within 1 month.", Continue.
- **Works:** brand name templated client-side; only `partialSaveOnboardingData` and analytics fire (network/04, Observed). The figure is fabricated (Inference, high).
- **Verdict:** a forecast before any data. Adds a step and costs trust.
- **Sun equivalent:** none, deliberately. **Sun better.**

### 05–07 · Role, team size, business type (Section 3 of 6)
- **Sees:** three auto-advancing radiogroups (options verbatim in §4.4); test answers Founder / Just Me / Local Business.
- **Works:** each click fires `partialSaveOnboardingData`, `static.opinly.ai/track` and a POST `/` (read as a Server Action, Inference). No measurement-configuration call (network/05-07, Observed).
- **Verdict:** each question costs only one click, but none visibly shapes measurement. "Local Business" never unlocks a city field.
- **Sun equivalent:** none asked; kind and industry come from evidence and can be edited on Understand. **Sun better** (less friction, more precise).

### (§7) · Attribution + other trackers
- Listed only in PARAMETERS.md §7 (Instagram · YouTube · Facebook · Google · Twitter · Other + "Custom traffic source"; Yes/No). No DOM, pagetext or network capture, and missing from the Final checks inventory. **Unverified.** Not compared.

### 08 · Competitive Score (Section 4 of 6)
- **Sees:** ~10–12 s radial gauge with a label cycling "Checking SEO…", "Checking EMIDY…", "Checking SYMLNC…", "Checking SOG…", "Checking Paid Ads…". Then **44 "Competitive Score"**, "56% have a better score", Keywords 4/10, Backlink Quality 3/10, Organic Traffic 7/10, AI Visibility 6/10, a static "+ 12 others", "Download report as PNG".
- **Works:** after going Back three steps and returning, the page re-rendered **byte-identically** with only 4× `/track` (2 B) and one 26 B partial save. No response body contained score strings; 44 + 56 = 100 (network/08, controlled experiment, Observed). Domain-seeded client-side generation (Inference, very high).
- **Coherence (Inference, network/08):** "Organic Traffic 7/10" next to "Backlink Quality 3/10" for a small studio is internally incoherent, which further suggests a generated origin.
- **Verdict:** a decorative loader and a data-free metric with no definition, date, sample or engine list. The PNG export makes that number easy to share. The dashboard may compute real metrics (Unknown).
- **Sun equivalent:** the Understand progress rail (real event counts) and Measure (definitions, `x of n`, drill-down). **Sun better**, and it is the core demo contrast.

### 09 · Locations (Section 5 of 6)
- **Sees:** "Where are your customers based?", search box, options grouped by language with counts ("English (26)", "Spanish (17)"…), **India pre-selected**; test choice English × United Arab Emirates.
- **Works:** option list is in the client bundle (no fetch when opened); every toggle fires `partialSaveOnboardingData` (network/09, Observed; static config and geo-IP = Inference).
- **Verdict:** richer than Sun on **language** and **multi-select**. Coarser on geography: country is the floor, with 0 cities and GCC gaps. The wrong pre-selection can silently become the market.
- **Sun equivalent:** `/trial/new` country + area. **Sun better** on geography and defaults; **Opinly better** on language and multiple markets.

### 10 · Final checks (Section 6 of 6)
- **Sees:** "Final checks" / "All set? Here's a quick look at what you've entered." Brand or Agency: Brand · Website: atelier10.ae · Competitor urls: **Bishopdesign** (a name, not a URL) · Locations: UAE United Arab Emirates · Role & Industry (Team Size Just Me, Role Founder, Industry Local Business) with the only Edit pencil · Back · "Confirm and continue".
- **Works:** read-back of saved partial state. Commit fires `onboarding.saveOnboarding` (977 B), `profile.profile`, `billing.getLlmVisibilityAddonListPrice` and a final partial save (network/11, Observed).
- **Verdict:** a genuinely good one-glance review. It can only confirm what the user typed, because onboarding inferred nothing.
- **Sun equivalent:** no single summary. Review is spread across the Understand confirm, the Landscape gate and Prompts approval. **Opinly better** on the "what will be measured" recap; **Sun better** on what can actually be corrected.

### 11 · Paywall
- **Sees:** "Outrank competitors on autopilot."; "**Your Competitive Score: 44/100** — 56% of competitors have a better score. Start your trial to close the gap."; PERSONAL $6 → **$4/mo**; trial timeline Today / Day 2 reminder email / Day 3 card charged; bullets incl. "Daily rank tracking across up to 3 competitors" and "Live in 60 seconds, no setup calls"; "Add LLM Visibility" switch **ON**, "See how ChatGPT, Gemini and Claude answer for your brand… $59/mo after your trial"; USD/EUR/GBP; GYMSHARK · Lemonade · BOSCH logos.
- **Works:** `/dashboard` redirects to `/pricing` (network/11, Observed).
- **Verdict:** the data-free number is reused as the conversion lever, and the wording escalates to "of competitors", a population nobody measured. The paid add-on is pre-enabled, so a user who reads "$4" is on track for **$63/mo** (teardown arithmetic, $4 + $59). Prices first appear on this final paywall (USER-FLOW.md: "No price shown at any point until the very end"), though still before card capture.
- **Sun equivalent:** none (no card). **Sun better** on trust. Sun's own paid-lane disclosure gap is covered in §10.

### Cross-cutting · Incremental save / resume
- `partialSaveOnboardingData` after every section (network/02, 03, 05–09, 11, Observed). Restore-on-reload is stated in network/02, but no reload test is described.
- **Sun equivalent:** every artefact is persisted as it is produced, and a refresh rejoins running jobs. But there is **no project list** to find a project again, and the same URL creates a duplicate. **Opinly better** on cross-session re-entry; **parity** within a flow.

### Dashboard (`/dashboard/<company>/…`)
- **Unknown.** Vendor-stated: prompt management through the MCP connector, citation sources, daily keyword tracking. Nothing in this report claims Opinly lacks any dashboard capability.

---

## 6. Project Sun page-by-page review

### 6.1 Landing (`/`)

| Section | What the user sees | How it works / quality | Opinly counterpart |
|---|---|---|---|
| LandingNav | Logo; anchors Product, How it works, AI Visibility, Methodology, FAQ (≥lg); "Start free analysis →" (≥sm); hamburger below sm | Both CTAs link to `/trial/new`. **Tablet gap:** at 640–1023 px the anchors (`lg:flex`) and the hamburger (`sm:hidden`) are both hidden (`src/components/marketing/landing-nav.tsx:14-23`). Known mobile e2e failures come from the CTA sitting inside the menu (docs/KNOWN_ISSUES.md:159-161) | 6-segment progress bar (html/01) |
| Hero + WebsiteStartForm | Badge "AI visibility, measured with evidence"; H1 "Know where your brand stands in AI answers."; one field (`https://` prefix, placeholder `yourcompany.com`) + "Analyze my brand →"; chips "01 Start with your website · 02 Review what Sun understands · 03 No card required" | Trims the value and pushes `/trial/new?url=…`. Pre-fills rather than auto-starting, so the operator sees the market and Search Console questions (`src/app/page.tsx:22-47`). US/UK spelling mismatch with intake | Company search (02) |
| HeroProductPreview | Dark mock: Presence 42% (8 of 19), Share of Voice 28% (8 of 29), Coverage 87% (26 of 30), with an **"Illustrative data"** pill | Static and labelled; the percentages match their fractions (`src/app/page.tsx:64-97`). Metric names don't match Measure's labels | Opinly shows 44 as *your* score (network/08) |
| Marketing sections + FAQ | Workflow, prompt intelligence, measurement, evidence, methodology; every sample figure labelled ("All values above are illustrative examples, not measured customer results.") | Static (`src/components/marketing/landing-sections.tsx:118, 160, 185, 226`). Copy doesn't mention the market/area or Search Console questions | Social proof logos (html/11) |
| Final CTA | "Enter your website. See how your brand is represented." + form + "Public website required · No card needed for this local Phase 2 trial" | Same form, id `final-website` (`landing-sections.tsx:303-308`) | Paywall (11) |

### 6.2 Intake (`/trial/new`)

**Header variants** (`src/app/trial/new/page.tsx:313-331`):
- empty: "Analyse your brand" / "Enter your website. We work out what the business does and where its customers are; you confirm it next."
- handed-over URL: "Ready to analyse <host>" / "Add where your customers are, or just start. We'll detect it from the website."
- auto-start: "Starting your analysis" / "Connecting to <url> and planning the crawl…"

No step counter; "← Back" returns to `/`.

| Field | Behaviour and states | Evidence |
|---|---|---|
| Route loading | `TrialSkeleton` renders both as the route `loading.tsx` and as the `Suspense` fallback while search params resolve | `src/app/trial/new/loading.tsx`; `page.tsx:44-50` |
| Website `#url` | Native `required`; whitespace-only input refocuses the field. Server errors return `400 unsafe_url_*` into a red `role=alert`, with focus back on `#url`. Fallback message: "Could not start the analysis. Check the URL and try again." | `page.tsx:153-223, 342-355, 492-494` |
| Where are your customers? | ARIA APG combobox: type-ahead folds diacritics; Enter never submits pending text; Escape clears; blur restores. "No country matches “q”."; an sr-only live count. Changing the country clears the area | `src/components/features/country-combobox.tsx:43-281` |
| Area or city | States: idle (<2 chars) → searching → results → empty ("No places match. We'll look up “q” during analysis.") / unavailable ("Place search is unavailable…") → resolving (submit disabled) → picked chip "title · subtitle" + × → error "Choose a place from the list, or clear this field." (`role=alert`, `aria-invalid`) | `page.tsx:380-459`; `place-search.tsx:124-291` |
| Use Google Search Console | States: loading skeleton ("Checking Google Search Console…") · status failed ("Couldn't check Search Console. You can continue without it.") · not configured (".env.local" instructions + Setup steps; developer copy on an operator screen) · `SUN_GSC_DISABLED` · redirect URI unavailable · not connected ("You'll sign in with Google next (read-only access), then the analysis starts.") · `reconnect_required` · connected (auto-on, "Connected to Google Search Console (n properties) · Disconnect") · denied/error notices | `src/lib/search-console/view.ts:16-92`; `search-console-toggle.tsx:31-157` |
| Submit | "Analyse my brand" → spinner + "Starting analysis…", all fields disabled; one start per page load; a bfcache return re-enables the form. Flow: `POST /api/projects` (201) → `POST …/crawl` (202) → push to Understand | `page.tsx:117-161, 201-207, 275-291` |

**Quality notes**
- **Strengths:** one required field; careful keyboard and focus handling; an honest degraded path for place search; no project before Google consent; no geo-IP default.
- Every submit creates a new project row (8 for atelier10.ae).
- A crawl-start failure leaves an orphan project.
- The market hint can't be edited after creation (no `update(projects)` in src).
- `GET /api/projects` exists but has no client.
- No intake test drove the area path in live data: all 36 live projects predate it or skipped it (28 `global`, 6 raw `IN`, 1 `auto`, 1 JSON hint with no area).

### 6.3 Understand (`/projects/[id]/understand`)

**Phases** (`src/lib/client/understand-phase.ts:68-124`; `page.tsx:332-403`)

| Phase | What the user sees |
|---|---|
| loading | RouteLoading + ProfileSkeleton, "Loading your brand profile" |
| starting | "Starting the analysis…" (indeterminate) |
| analysing | **AnalysisProgress rail** "Understanding <domain>", with elapsed m:ss and steps: "Website connected — <domain>" · (Reading Google Search Console) · "Discovering site structure" ("N URLs found (M from sitemap)") · "Reading the most useful pages" ("x of y selected pages processed") · "Extracting evidence" ("N observations collected") · "Understanding the business" ("Reading N pages the way a customer would" → "Working out where the business is and who it serves" → "Checking every finding against the website") · "Putting your profile together". After 3 min of silence: "This is taking longer than usual. The page updates by itself." |
| reveal | Completed rail held 600 ms, then the profile fades in. Partial versions are never rendered |
| stalled | "The analysis stopped before it finished" / "This can happen if the app restarted while it was working." + "Analyse again" (inProgress=false on an open cycle, or 10 min of silence) |
| not_started | EmptyState "The analysis hasn't started" + "Start analysis" (after 15 s) |
| failed | Warn alert "We could not analyse this website" + a stored reason (robots: "This site's robots.txt asks crawlers not to index it…"; DNS: "That domain could not be resolved…"; no pages: "No page on this site could be fetched…"; **leaks the raw "(no_evidence)" code**) + "Analyse again" / "Fill in the profile by hand" |
| GET error (non-404) | Alert "Could not load the profile." with **no retry button** |

**Progress honesty.** Counts are real. The percentage is a weighted composite: pages fill to 70% (90% without a model), stage floors are 75/85/93/97, it caps at 99 until `profile.ready`, and it never moves backwards. On the atelier10 run the bar peaked at 61%, jumped to the 75% floor and **sat there through the ~20 s model call**. "26 of 30 selected pages processed" mislabels the fetch plan as "selected" (`src/lib/client/understand-progress.ts:39, 115-181`).

**Behind the rail (atelier10 old run `crw_1e338200`):**
- robots allowed; 3 WordPress sitemaps with 90 URLs; 270 URLs discovered, 92 admitted.
- 30 fetched, 0 Playwright fallbacks, 4 near-duplicates dropped; 26 selected.
- 1,957 evidence items in 68.9 s; one `gpt-5.6-luna` call at ≈ $0.0054, 0 dropped claims.
- Both page caps were hit. 20 of the 26 selected pages are the salon's local-SEO blog posts (classified `editorial` via `schema:Blog`), and `/category/uncategorized/` took a slot.
- **Fresh run:** 26 pages, 1,946 evidence items, 28.5 s crawl.
- `llms.txt` is not read anywhere in src.

**Ready card sections**

| Section | What the user sees (atelier10, fresh) | How it works | Quality |
|---|---|---|---|
| Header | "Version 1 · Awaiting your confirmation · 26 pages analysed · 1946 pieces of evidence · AI-assisted" + "Edit profile" | `synthesisMode` llm_grounded → "AI-assisted", else "evidence-only" | Honest counts. "evidence-only" is the **only** visible sign that the model failed; the stored warning is hidden (`page.tsx:304-307, 405-421`) |
| Brand name | "Atelier 10 Salon" · "Also known as: Atelier 10" · Why? | Kept only when 2–80 chars, not logo noise, and written on the site (support ≥0.99) | Correct. Earlier runs produced "atelier 10 wordmark cream" (logo alt text; including one AI-assisted run) and "ATELIER 10" |
| Description | "…a luxury beauty salon in Dubai Financial Centre (DIFC), offering hair, nails, lashes, brows and men’s barber services in a calm, premium setting. It serves clients at Staybridge Suites on Sheikh Zayed Road…" | Requires resolvable citations; hype stripped; ≤600 chars | Accurate against the home, about and contact texts |
| Business type card | "Beauty & Personal Care › Hair & Beauty Salons › Luxury full-service beauty salon"; headline "Beauty salon"; chips "Personal care & wellness", "One location customers visit", "Premium"; Why? cites HairSalon structured data; "Change" → editor with Suggestions (Hair salon, Barber shop, Nail salon) | Open classification + closed kind; `ruledOut` stored but hidden (the copy guard forbids "Ruled out"); confidence 92, hidden | **Correct.** All 7 earlier atelier10 profiles had archetype `healthcare`, which produced "Which hospital should I visit for cleaning up a messy beard and neckline?" (SELECTED in `pset_16f32b27`). Fresh `ruledOut` includes "Healthcare or medical clinic" |
| Location card | "You told us" badge; "DIFC, Dubai, United Arab Emirates"; "Staybridge Suites, 6th Floor, Sheikh Zayed Road, Trade Center First, DIFC, Dubai, Dubai, AE"; "You told us: DIFC, United Arab Emirates · matches your website"; hierarchy chips; "Customers mostly come from across Dubai."; "Nearby: Business Bay, Sheikh Zayed Road"; "View on map"; Why? lists 8 signals | Signals: structured address (3), coordinates (3), website address (2.5), `.ae` domain (2), phone (2), currency (1.2), countries served (1), plus the operator hint (4, rule-applied). Precision premise, confidence 95 | **Premise-level and right.** Flaws: a highway listed as a "nearby area" and later frozen as a neighbourhood; "Downtown Dubai" appears on 11 of 26 page texts but is missing; the hierarchy places "Trade Center First" above DIFC; the extraction instructions use Dubai examples, which flatters this test (`src/lib/understanding/extraction.ts:250-254`) |
| Search demand card | Hidden (no Search Console connection) | Renders `profile.searchConsole` | Not exercised |
| Brand identity | Fresh: Premium · Personalised service · Community-oriented · Expert-led · Trusted & established · Wide selection | Model differentiators are kept only at 3–60 chars with support ≥0.6 (`src/lib/understanding/index.ts:186-203`) | **Regressed.** All 4 fresh differentiators exceeded 60 chars, so generic rules chips remain. Old run: "Luxury and sanctuary-style salon setting", "Russian manicure and specialist hair services" |
| Products & services | Hair (11), Nails (8), Lashes & Brows (10), Barber (5); "Price range: AED 100 - AED 1500 · Booking via Fresha" | Site groups preserved; the edit view flattens them to chips | Specific and site-worded. The price and booking line has no Why? of its own |
| Who it's for | Busy professionals working in or around DIFC (Nearby) · Dubai residents seeking premium beauty maintenance · Men seeking premium grooming · Brides and bridal parties (City-wide) · International and regional returning hair clients (International) | ≤6 grounded segments; confidence hidden | Grounded; weaker segments at confidence 27–35 |
| Regulated-domain banner | Hidden for atelier10. When `regulatedDomain.isRegulated`: "Regulated domain detected (<categories>) — advice-seeking prompts are blocked later in the journey." | Warn-tone strip under the audience field (`understand/page.tsx:662-667`) | Honest and early. Says "Regulated domain", which is system vocabulary rather than the operator's |
| Older-version variant | Versions without classification or location show legacy "Industry" + "Business type" selects and a "Target market" field instead of the Business type and Location cards | `understand/page.tsx:451-488, 571-574` | Keeps old projects readable |
| Why? evidence panel | Opens "Loading evidence…", then the cited items, or "No stored evidence for this field."; the link is hidden when a field has no evidence ids; audience ids are capped at 8 | `src/components/features/profile-fields.tsx:27-103`; `understand/page.tsx:657` | The mechanism behind every provenance claim. Rules-only fields render no Why? at all |
| Editor buttons | Business type editor "Save business type" (empty type is refused with validation copy); Location editor "Save location" | `business-type-card.tsx`; `location-card.tsx` | Each save creates a new profile version |
| Stored, not shown | Phone +97145728973, info@atelier10.ae, 8 socials, hours (evidence only), `aggregateRating` 5.0/94 (not extracted), 4 quality warnings (e.g. "20% off" on home vs "half price" on services), customer questions (`customerJobs`, which do feed Landscape and Prompts) | — | Captured but invisible to the operator |
| Actions | "Confirm profile" → "Opening Landscape…"; the edit view offers Save changes / Save & confirm / Cancel; notices "Your changes were saved as a new version." / "Nothing changed." | `PATCH …/profile`; edits create version+1 (source user, confidence 100) | Versioned and inspectable. **"Analyse again" discards unconfirmed edits**, and a ready profile has no re-analyse action (`reanalyze()`/`mergeUserEdits` unused; docs/KNOWN_ISSUES.md:27). Failed versions can be confirmed server-side (KNOWN_ISSUES:25). Chip editors don't enforce server caps, so a raw 400 appears |

**Opinly counterpart:** routes 02 + 05–07 + 09 + 10 together. They know name, domain, favicon, a self-picked "Local Business" and a country. **Sun is decisively ahead** on this stage. Opinly is ahead only on the explicit degraded-state message and the favicon.

### 6.4 Landscape (`/projects/[id]/landscape`)

**States** (`src/app/projects/[id]/landscape/page.tsx:126-247, 343-491`)

| State | What the user sees |
|---|---|
| loading | "Loading topics and competitors" + LandscapeSkeleton |
| profile_unconfirmed | "Confirm your brand profile first" / "Topics and competitors are built from the confirmed profile." + "Back to Understand" |
| error | "Not ready yet" / "Could not load the landscape." (**no retry**) |
| generating | "Building your landscape" steps: Reading your confirmed profile → Choosing the topics buyers ask about ("n topics drafted") → Searching for competitors ("n possible competitors found") → Checking their websites and locations ("x of n checked") → Ranking the closest competitors ("n suggestions ready"); skeleton sized to the tier count; slow note after 3 min |
| stalled | "Competitor search stopped before it finished" + "Start again" (or "Restart the app, then open this page again.", which is a non-action) |
| ready | Topics card + Competitors card (tier groups) + add row + gate |
| failed | "We couldn't finish finding competitors" / "Add the competitors you know, or try the automatic search again." + "Retry automatic discovery"; manual add still works. The actual cause (`failedMessage`) is computed but **never rendered** (`src/lib/client/stage-progress.ts:163`) |
| empty | "No suggestions yet… Anything you add is labelled as added by you." + Retry, which is **usually a no-op** because a completed run for the same profile is reused (`src/lib/landscape/orchestrator.ts:112-124`) |

**Progress honesty gaps**
- "x of n checked" sits at 0 through all of verification, then jumps (events fire after all verifications finish).
- In the fresh run, "15 possible competitors found" counted 9 website-regex service names ("Hybrid", "Volume La", "BIAB", "Full Service If"…) against only 6 resolved candidates.

**Topics card:** "n/4–6 confirmed" badge; per-row Confirm/Remove; "Add a topic…".
- **Fresh run:** Hair styling and colour treatments · Russian manicure and nail care · Eyelash extensions and brow styling · Men hair grooming and barbering · Luxury salon experience. The last one names a place ("busy professionals in Dubai Financial Centre") and its "Covers" list doesn't fit.
- **Old run:** a double generation race inserted **8 topic rows (4 names twice) and 2 target entities**. The gate counts rows, so `csv_18428a0a` froze "Hair colour and styling" twice and **no nails topic**.
- The generate route now holds an in-process lock (`src/app/api/projects/[id]/landscape/generate/route.ts:14-21`), but duplicate names still aren't caught.
- There is no bulk confirm, so every system topic needs its own click.

**Competitors card:** "Target: Atelier 10 Salon", "n eligible confirmed".
- **Groups:** "In DIFC · and nearby: Business Bay, Sheikh Zayed Road" and "Across Dubai" (plan area quota 6 + city quota 10, primary city).
- **Row:** name, type badge, "Website verified", reason, source label ("AI hypothesis"), Why?, Confirm, Reject/Remove.
- **Fresh run:**
  - **The Grooming Company** (In DIFC). Reason: "Offers premium men's barbering and grooming services in the same district." Why? says "Matched on: same offering/category · same buyer job · same geography" and "Verified against 3 high-value pages on thegroomingcompany.com."
  - **Sisters Beauty Lounge** (Across Dubai), "Major regional premium multi-service salon chain offering hair, nails, and lashes."
  - 4 model guesses hidden: Pastels Salon, Trevor Sorbie Dubai, Nail Lounge (DNS failure), Belle Femme (network error).
- **Pipeline reality on free keys:**
  - grounded search `rate_limited` → 0
  - Overpass `[]` at 2 km and 6 km
  - open knowledge 0
  - website regex 26 hits, all dropped for a place-bound target
  - AI hypothesis 6
  - 159.5 s total
- **Old run:** 11 raw → 3 resolved → 1 suggestion (The Grooming Company, confirmed and frozen). Beautique Salon and Pastels Salon were rejected with "Suggested from general knowledge only; no search result or website confirmed this business in the area." (live `entities`, re-checked). Pastels' guessed domain failed verification; Beautique had no domain.

**Why the Grooming Company row misleads**
- `offeringOverlap 0`, yet "same offering/category" is shown.
- "Located in DIFC" comes only from the model (`sourceUrls []`); the site's own mentions say only "Dubai".
- The verifier followed a redirect to **omorfiagroup.com** (parent-group news pages) and passed its identity check, which accepts any name token over 2 chars (stopwords like "the" count). The summary still names the pre-redirect domain (`src/lib/landscape/competitor-verifier.ts:166-195`).
- The same entity was *rejected* in 4 earlier atelier10 runs.

**Add row:** "Add a competitor…" (name only) + relationship + "Where it competes" + "Add competitor". A PATCH failure shows **no error**, because `applyLandscapePatch` has no catch, and pressing Enter during another mutation clears the input without adding it (`page.tsx:257-289`).

**Gate:** "Confirm & continue to prompts", enabled only with 4–6 confirmed topics and ≥1 non-marketplace rival. Hints: "Confirm N more topic(s) (4–6 are required).", "Keep no more than 6 topics before continuing.", "Confirm at least one competitor that is not a marketplace for Trade Off prompts.", plus "Trade Offs will only compare rivals in …" when a planned tier has no rival. Nothing warns before freezing a *single* rival.

**Freeze:** append-only `competitive_set_versions` with a sha256 over profile version, topic/competitor snapshots and policy version; hash-equal sets are reused (`src/lib/landscape/repository.ts:453-513`). Operator decisions survive rediscovery.

**National contrast:** `wipro.com` got 16 country rivals (Infosys, TCS, HCLTech, Tech Mahindra, Capgemini…). They include **Capco**, which Wipro owns (external knowledge), and AI-authored names like "Accenture India".

**Opinly counterpart:** route 03 (manual, skippable, unchecked) plus nothing else. **Sun ahead** on discovery, typing, tiers, explainability and topics. **Opinly ahead** on the degraded-state flag, domain-first manual entry and showing the domain on the chip. Live local recall is Sun's weakest output (§10).

### 6.5 Prompts (`/projects/[id]/prompts`)

**States** (`src/app/projects/[id]/prompts/page.tsx:124-358`)

| State | What the user sees |
|---|---|
| loading | "Loading your prompts"; a missing set **auto-POSTs generate** (approved paid writer route) |
| generating | "Writing your 30 prompts": Reading your confirmed business, topics and competitors → Planning the questions: 10 Discovery, 10 Trade Offs, 10 Sentiment ("84 question ideas planned", which counts template frames) → Writing and checking candidate questions ("303 passed the checks") → Removing near-duplicates and scoring ("234 strong candidates", which includes below-floor and judge-failed rows) → Choosing the final 30 |
| failed | "We couldn't finish writing the prompts" / "Something went wrong while the prompts were being written. Your confirmed topics and competitors are unchanged." + Try again / Back to Landscape. **If Landscape was never confirmed**, the guard throws *inside* the 202 job, so the user gets this generic, partly false copy and "Try again" fails the same way (`src/app/api/projects/[id]/prompts/generate/route.ts:19-32`; `src/lib/prompts/orchestrator.ts:278-282`) |
| stalled | "Prompt generation stopped before it finished" + "Generate again" |
| error | "Prompts aren't available yet" + Back to Landscape |
| ready | Badge "n / 30 selected"; tiles Discovery / Trade Offs / Sentiment Analysis n/10; filters; section cards; "Approve n / 30 prompts" |
| approved | "Prompt set approved and frozen. Future edits create a new version; this exact cohort will not change." + "Measure these 30 prompts →" / "Continue to Measure →". No control actually starts that new version |

**Pipeline:**
1. Frozen context snapshot (`prompt-context@2`, levelled places).
2. Intent model: needs, concerns, decision factors, claims. Stored only in an event payload.
3. Discovery slots (need × shape × style × place × money) → terra writer (temperature 0.9) → parse filters (drops place-as-adjective and unoffered money) → luna yes/no judge (92 pass / 30 fail).
4. Trade Off writer (temperature 0.6, rival–need pairs) and Sentiment writer (temperature 0.8, concern → theme).
5. Deterministic template floor always runs.
6. Gates: leakage, rival binding, geography, natural language → per-section dedupe (≥0.72) → greedy selection with caps.

(`src/lib/prompts/discovery.ts`, `intent-generation.ts`, `validators.ts`, `selector.ts`)

**Section cards:** descriptions verbatim:
- "Brand-neutral buyer questions that test whether AI independently chooses the target."
- "Buying-decision comparisons against confirmed competitors (never marketplaces)."
- "Neutral branded questions about business-appropriate reputation themes."

Rows carry intent, place and theme badges. Why? shows Context (raw keys, including `model:openai:gpt-5.6-terra`), Brand policy, **"Quality n/100 · Coverage n/100 · Diversity n/100"** (against the journey-ui "no quality scores" rule) and "Selected because".

**Quality of the fresh atelier10 set:** golden prompts 8/8. Verbatim examples in §7.
- **Discovery:** natural and local; best in class.
- **Trade Offs:** criterion-bound, but carries the truncated name "The Grooming" and one template filler.
- **Sentiment:** salon-appropriate, but two themes are duplicated.

**Review-tool weaknesses**
- "Review N validated alternatives" shows the first 12 rows in DB order, and these are template splices ("Is Atelier 10 Salon trusted when it comes to trust?", "Recommend the best balayage brands").
- Replace ranks affinity before score and can swap in a judge-failed row.
- Edit errors come back as raw JSON at the page foot.
- The only current-policy approved set in the DB (boldin.in) was written entirely by **free fallback gemini-3.6-flash**, **0 of 21 Discovery prompts were judged**, and 17 of 26 model Trade Offs died because the writer schema makes `factor` optional while the gate requires a criterion. A template "Compare BOLDIN and Beardo on free shipping for brightening head serum – 30ml" was approved.

**Opinly counterpart:** nothing in onboarding (no prompt input, preview or approval); post-purchase prompt management is Vendor-stated. **Sun ahead on everything visible**; how Opinly generates prompts is Unknown.

### 6.6 Measure & provenance (short)

> **⚠ Collection details below are superseded** by the 19:39–20:32 rework (§2.3). The console now connects Bright Data / cloro / Decodo and labels answers "ChatGPT on the web" (`measure/page.tsx:42`). Lane names, the paid `gpt-5-nano` lane and the by-hand steps described here are retired. The Measure provenance mechanics (definitions, `x of n`, `—`, "so far", drill-down) were not part of that change, but line numbers in `measure/page.tsx` may have shifted.

**Atelier10 has never reached Measure.** Its prompt sets are unapproved, so the page shows "Collect the answers" / "Ask ChatGPT and Gemini the approved questions. Results appear here as soon as the first answers arrive." Both collect buttons would fail with the generic "Something went wrong processing this request." because `createCollectionRun` throws a plain Error (`src/lib/collection/orchestrator.ts:77-78`).

**Strengths**
- `?` drawers ship metric definitions (event / denominator / sections / missing data) in the same API response as the numbers (`src/lib/measure/policy.ts:47-158`).
- `x of n` beside every rate; `%` only at n≥5; `—` + "No answers to count yet." when empty; "so far" chips and dashed cards while partial.
- A sticky banner states "Figures marked “so far” use only the answers collected. Missing answers are left out of every figure, never counted as the brand being absent."
- Lane cards explain pauses ("Paused: today’s free limit is used up. Collects again after <time>.") and say "left out of the results, never counted as a miss".
- "See the answers →" opens up to 25 contributing answers.
- Method notes name each route's model and show `questions vN · observation-analysis@9 · measure-policy@1`.
- Raw answers are stored insert-only with a sha256 blob hash.

**Gaps**
- **No as-of date anywhere** (`computedAt` is returned but unused).
- API errors are masked as the empty state.
- A paid `gpt-5-nano` lane starts in one click when an env OpenAI key exists, with no price shown.
- Gemini's quota-driven no-search fallback isn't disclosed (all 388 stored `gemini_free_api` answers have `search_state off`), and ungrounded answers dilute `owned_citation_rate` (nike.in `crun_9a0f2ed8`: 0 of 33, 32 of them uncitable).
- Exclusions are computed but never shown.
- Measure reads the *latest* competitive set rather than the pinned one (KNOWN_ISSUES:134).
- The "Recommended unprompted" label counts discouraged mentions too.
- No export or run history.

**Opinly counterpart:** a data-free 44 with no definitions. **Sun ahead** on provenance; **parity** on the missing as-of date; **Opinly ahead** on a shareable export (Observed control) and engine breadth (Claude, vendor claim).

---

## 7. Same brand, head-to-head: atelier10.ae

### 7.1 What each product knew about the business

| Field | Opinly (onboarding, Observed) | Sun, old live run (`prj_fef2f186`, 2026-09-13, no hint) | Sun, fresh run (2026-09-14, hint AE + DIFC) |
|---|---|---|---|
| Requests to the site | 0 browser-visible through commit (server-side crawl Unknown) | 90 sitemap URLs → 270 discovered → 92 admitted → 30 fetched → 26 selected; 1,957 evidence; 68.9 s | 26 selected; 1,946 evidence; 28.5 s |
| Name | "Atelier10" (directory) + favicon | "Atelier 10 Salon", alias "Atelier 10" | same |
| What it is | Operator-picked "Local Business". A look-alike "Atelier10 Design Studi…" sits in the results; the teardown author's "design studio" label is not an Opinly output | Beauty & Personal Care › Hair & Beauty Salons › **Luxury full-service beauty salon**; kind `personal_care_wellness`; b2c, in person, single location, premium; rationale cites HairSalon JSON-LD | same, plus `ruledOut` "Healthcare or medical clinic"; alternatives Hair salon / Barber shop / Nail salon |
| Location | **English × United Arab Emirates** (country grain; India pre-selected on load) | **Premise:** Staybridge Suites, 6th Floor, Sheikh Zayed Road, Trade Center First, DIFC, Dubai; lat 25.2118 / lng 55.2740; scope local (90); confidence 95 | same + "You told us: DIFC, United Arab Emirates · matches your website" (outcome `agreed`) |
| Offerings | — | 30 in 4 site groups (Hair 8, Nails 8, Lashes & Brows 10, Barber 4); AED 100–1,500; Fresha | 34 (Hair 11, Nails 8, Lashes & Brows 10, Barber 5); "Microblading" inconsistency gone |
| Audience | — | 6 segments (confidence 8–79, hidden) | 5 segments (3 at 72–80) |
| Brand identity | — | "Luxury and sanctuary-style salon setting", "Personalised service and calm, premium experience", "Russian manicure and specialist hair services" | Generic: Premium, Personalised service, Community-oriented, Expert-led, Trusted & established, Wide selection (60-char cap regression) |
| Contact / hours / rating | — | Stored but hidden: phone, email, 8 socials; hours as evidence only; rating 5.0/94 not extracted | same |
| Data-quality flags | — | 4 hidden warnings (e.g. 20% off vs half price) | stored, hidden |
| Model cost (Understand) | n/a | $0.0054 (luna, 1 call) | $0.0056 |
| Score shown | **44, AI Visibility 6/10, "56% have a better score"** (data-free) | none | none |

**History matters for honesty:**
- All **7 earlier atelier10 profiles** had archetype `healthcare` and produced hospital prompts.
- Three used a logo alt text or all-caps brand name.
- The current classification is the product of recent fixes and a paid understanding route. On the rules-only path (no model), the profile is much weaker: keyword-splice description, no business type card, no Location card without a hint.

### 7.2 Topics

| Opinly | Sun old (frozen `csv_18428a0a`) | Sun fresh (auto-confirmed) |
|---|---|---|
| None in onboarding (dashboard unknown) | 4 rows = **3 distinct** topics: Hair colour and styling (×2), Eyelash extensions and brow styling, Men hair and beard grooming. **No nails**, although 8 nail services and a brand identity attribute exist | Hair styling and colour treatments · Russian manicure and nail care · Eyelash extensions and brow styling · Men hair grooming and barbering · Luxury salon experience (flawed: names a place, unrelated "Covers" list) |

### 7.3 Competitors (incl. Bishop Design)

| | Opinly | Sun old | Sun fresh |
|---|---|---|---|
| Rivals | **Bishopdesign / bishopdesign.com**, typed by the tester | **The Grooming Company** only (frozen). Beautique Salon, Pastels Salon rejected as memory-only | The Grooming Company (In DIFC) + **Sisters Beauty Lounge** (Across Dubai). 4 model guesses hidden after domain checks failed |
| Source | Operator input; no suggestion call | AI hypothesis; website regex produced service names, all filtered | AI hypothesis (6); search 429, Overpass `[]`, open knowledge 0 |
| Checks | None visible; accepted silently | "Website verified" on the parent group's site (omorfiagroup.com) | same defect on Grooming; Sisters is a relevant city-tier rival |
| Researched DIFC rivals (The Salon Luxe, Y12, It's Beauty DIFC, HAIRPLAY, Laurance) | n/a | 0/5 | **0/5** |

**Bishop Design relevance.** Bishop Design is *presumably* an interior-design firm, given the tester's query "interior design dubai" (Inference; bishopdesign.com was not checked in this review). If so, it is **off-category** for a beauty salon. The pick was the tester's, and plausibly followed from the "design studio" mislabel (Inference). Onboarding accepted it without any visible check (Observed), and with no visible site ingestion it had nothing to check against. Any dashboard-side check is Unknown.

- If it is a design firm, Sun would not *suggest* it: screening rejects candidates that aren't like-for-like.
- Sun would, however, also accept it silently as a manual add, because manual rows bypass screening.
- Across runs, Sun's own rivals have flip-flopped:
  - "Lash Extensions", which is an offering, was confirmed as a competitor in `prj_81bff33d` and `prj_23057ecd`.
  - Pastels Salon and Trevor Sorbie Dubai were confirmed in `prj_032e6375`.

### 7.4 The 30 prompts, verbatim best and worst

Opinly: none visible before payment. Its prompt quality is Unknown. Both full 30-prompt sets are reproduced verbatim in **Appendix B**, so the shape counts below can be audited.

| Section | Old live set `pset_1c6f1d66` (prompt-selection@4, terra) | Fresh set (prompt-selection@5, discovery@2, terra + luna judge) |
|---|---|---|
| Discovery: best | "Where should I get a hair treatment in DIFC?" · "I need polished brows for work; which salon in Business Bay?" | "best blow-dry in DIFC" · "My polish never lasts, where in DIFC should I get gel nails?" · "i need a men's haircut in DIFC before an event" · "Where can I get balayage in Dubai for my first colour?" |
| Discovery: worst | "Can you suggest a Dubai salon for a haircut that suits me?" (place used as an adjective, 8/10 like this) · "What Dubai salon should I use for regular work grooming?" (vague). **0 nail prompts.** Good prompts wrongly rejected as TOO_GENERIC ("What Dubai salon does natural-looking lash extensions?") | "My brows grow in different directions and makeup is not helping. Where in Business Bay does good brow lamination?" (19 words, ungrammatical; judge passed it at 92). Two of 10 ask for brow lamination |
| Discovery: shape | Places Dubai 6 / DIFC 3 / Business Bay 1; hair 5, lashes/brows 3, men 2, nails 0 | 10/10 placed, **0/10 adjective places**; Dubai 5 / DIFC 4 / Business Bay 1; hair 4, nails 2, lashes/brows 3, men 1 |
| Trade Offs: best | "Which gives a more consistently good haircut, Atelier 10 or The Grooming?" | "Will a Russian manicure last better at Atelier 10 or Sisters Beauty Lounge?" · "Is gel removal safer at Atelier 10 or Sisters Beauty Lounge?" |
| Trade Offs: worst | **All 10 vs "The Grooming"** (single rival, truncated name), e.g. "I want neat nude gel nails—which is better, Atelier 10 or The Grooming?" and "I want a comfortable pedicure—should I book Atelier 10 or The Grooming?" (4 em dashes; selection score as low as 0.0213) | "Compare Atelier 10 Salon and The Grooming Company on overall value for balayage" (template filler, generic criterion, a service the rival doesn't offer) · "Who does a sharper skin fade, Atelier 10 or The Grooming?" |
| Trade Offs: shape | 1 rival × 10 | 6 vs Sisters, 4 vs Grooming; all 10 criterion-bound; 6 criterion-less drafts rejected |
| Sentiment: best | "How careful is Atelier 10 in DIFC with previously bleached hair?" · "Can I trust Atelier 10 to choose lashes for my eye shape?" | "How clean is the manicure equipment at Atelier 10?" · "Is Atelier 10 careful when removing gel polish?" · "Is Atelier 10 actually calm, or does it feel rushed?" |
| Sentiment: worst | "Has anyone had trouble with more damage after Atelier 10 treatments?" (awkward) | "Can I trust Atelier 10's booking process to be straightforward?"; two themes duplicated (punctuality ×2, "genuinely calm and premium" ×2) |
| Alternatives shown to reviewer | "Atelier 10 Salon vs The Grooming Company licensed" (61) · "Is Atelier 10 Salon trusted when it comes to trust?" | First 12 per section are template splices, e.g. "Recommend the best balayage brands" (no place), "Suggest good balayage brands for busy professionals working in or around difc" |
| Historic worst (older atelier10 sets) | "Which hospital should I visit for cleaning up a messy beard and neckline?" (`pset_16f32b27`) · "ATELIER 10 vs Lash Extensions for hair colour" (`pset_6eeac8dc`) | — |

### 7.5 Quality scores

| Scorecard | Understand | Landscape | Prompts | Cost | Time |
|---|---|---|---|---|---|
| Sun fresh (golden case 00) | **10/10** | **5/8**. Failed: suggested competitors; researched rivals 0/5; tiers populated only area 1 + city 1 | **8/8** (10/10/10, no clinic wording, Discovery unbranded, 10/10 placed, city + neighbourhood levels, 5 neighbourhood prompts, 21 distinct openings, 4–19 words) | $0.073 | 305 s |
| Sun 2026-09-13 runs 1 / 2 / 3 (`results-2026-09-13.md`) | 10/10 each | 3/4 · 2/4 · 3/4 (4 checks then); 0/5 researched rivals each | 8/8 · skipped · 8/8 | $0.072 · $0.005 · $0.071 | — |
| Opinly | — | — | — | $4 + $59/mo retail (not comparable) | ~2 min to a data-free 44 |

### 7.6 Old run → fresh run delta

| | Change | Evidence |
|---|---|---|
| **Improved** | Discovery place-as-adjective 8/10 → 0/10; nails 0 → 2; Trade Off rivals 1 → 2, all criterion-bound; audience confidences up; Microblading inconsistency gone; crawl 68.9 → 28.5 s (single-run network timing, not attributed to code) | live vs fresh `prompt_candidates`, `business_profile_versions`, `crawl_runs` |
| **Regressed** | Brand identity chips generic (60-char cap); discovery 96 → 160 s; topic "Luxury salon experience" | fresh `profile.brandIdentity`, `competitor_discovery_runs.metrics` |
| **Unchanged** | The Grooming Company verified on its parent site and spoken as "The Grooming"; 0/5 researched rivals; Sheikh Zayed Road treated as a neighbourhood; contact, hours and warnings hidden | both DBs |
| **Confounds** | Old run had no intake hint (`market_scope "global"`); prompt-selection@4 vs @5; free-tier Gemini availability differs per run (18/28 calls failed in the fresh run) | `projects.market_scope`, `prompt_sets.selection_policy_version`, eval usage ledger |

---

## 8. Take inspiration / copy

Items are deduplicated across dimensions and ordered by priority. Every item respects the CLAUDE.md hard lines as of the 19:37 snapshot: no unapproved paid spend (Landscape stays free), no hardcoded brands or places, no Observe/collect surface outside Measure, no recommendations layer, website text only rendered and never put into model instructions.

> **⚠ Collection items pending re-verification.** The "no consumer-app automation / API lanes only" line was superseded by the 2026-09-14 collection rework (§2.3). Items **#6, #20, #38, #39** were written against the retired API and by-hand lanes; re-read them against the wired vendor routes before acting. No other item depends on the collection lanes.

Effort: **S** ≤ half a day · **M** 1–3 days · **L** > 3 days.

### 8.1 P1

| # | Idea | Opinly source (label) | Why it matters | How to apply in Sun (files) | Already partly in Sun? | Effort | Copy / adapt |
|---|---|---|---|---|---|---|---|
| 1 | **Per-source degraded state for competitor discovery**, shown as a coverage note | `upstreamFailed` → manual panel, "Company search is temporarily unavailable. Pop the website in below and we'll do the rest." (network/03, Observed; PROJECT-SUN-TAKEAWAYS.md §2) | In the fresh atelier10 run search was rate-limited, Overpass empty, and Landscape fell back to flash-lite (18/28 calls failed). The page presents 2 rivals as a normal result, and the operator can't tell weak recall from a thin market | Record `{source, status: ok\|empty\|unavailable\|skipped, reason}` per source in `src/lib/landscape/competitors.ts:165-178` instead of swallowing errors to `[]`; also screening ran/skipped (`competitor-screening.ts:71`) and topic mode llm/rules. Persist in run metrics (`src/lib/landscape/orchestrator.ts:130-186`); return from GET (`src/app/api/projects/[id]/landscape/route.ts:35-61`). One neutral line on the Competitors card (`landscape/page.tsx:427-447`), e.g. "Web and map search were unavailable for this run, so suggestions are limited. Add 2–3 <localCategory> businesses your customers compare you with." Noun from `classification.localCategory`. No provider names, no rejected rows, no "enable paid search" prompt | Job-level failed/empty/stalled states only; `sourceStats` counts found candidates only | M | adapt |
| 2 | **Check guards before a 202 and surface typed failure codes** (Prompts, Landscape, collection, Measure) | Error state carried in the API contract (network/02–03, Observed) | Opening Prompts before Landscape is confirmed shows "Something went wrong… Your confirmed topics and competitors are unchanged." and Try again repeats it. Collecting on an unapproved set (every atelier10 project) gives a generic 500. Measure shows any API error as "Collect the answers" | (a) `src/app/api/projects/[id]/prompts/generate/route.ts`: check `getLatestCompetitiveSetVersion` bounds before `tryAcquire`, throw `LandscapeNotConfirmedError` → 409. Same `confirmedAt` check in `landscape/generate/route.ts`. (b) In background catches, append a stable `code`; `src/lib/client/stage-progress.ts` returns it, and pages render copy keyed on the code (never raw `err.message`), with "Back to Landscape" as the primary action. Render landscape `failedMessage` the same way. (c) `src/lib/collection/orchestrator.ts:78` → typed `PromptSetNotApprovedError` mapped in `src/lib/http/respond.ts` to 409 `prompt_set_not_approved`; console shows "Approve 30 questions first" + link. (d) `src/app/projects/[id]/measure/page.tsx:80-88`: only 404 `no_collection_run` → empty; anything else → error panel + Retry | 409 mappings exist but never run for background guards (`respond.ts:31-39`); `failedMessage` computed but unused | S | copy |
| 3 | **Say when Understand or Prompts ran on a narrower path** | same | A failed model call only flips a tiny "evidence-only" tag. The approved boldin.in set was written by the free fallback, 0/21 judged, with a template Trade Off, and the reviewer saw none of this | Build `degraded` from **persisted** data only (the LLM ledger is in-process: KNOWN_ISSUES:34): `synthesisMode` + `quality` for the profile; `prompt_sets.generationStats` (add `discoveryJudgeAttempted`, model-written vs template-filled selected counts, `section_failed`). One plain line per page/section: "AI analysis was unavailable, so this profile uses what the website states directly. Analyse again later for a fuller profile." / "Checked by a second reviewer: no" / "1 of 10 filled from templates". Files: `src/lib/profile/orchestrator.ts:350-381`, `src/app/projects/[id]/understand/page.tsx:405-421`, `src/lib/prompts/orchestrator.ts:383-400, 461-465`, `src/app/projects/[id]/prompts/page.tsx:420-423`. Don't reintroduce a warnings list (copy guard) | "· evidence-only" tag (`understand/page.tsx:413`); counters exist, unshown | S–M | adapt |
| 4 | **"Recent analyses" resume list + reuse an existing project for the same URL** | `partialSaveOnboardingData` after every step (network/02 §3, Observed; restore stated); PROJECT-SUN-TAKEAWAYS.md §8 | Close the tab and the project is lost; 8 atelier10.ae and 11 nike.in projects exist. "Where did my analysis go?" is an easy demo loss. Also covers the light agency need without tenancy | Add `api.listProjects` (`src/lib/client/api.ts`). Enrich `GET /api/projects` (`src/app/api/projects/route.ts:38-43`) with brand name from the latest profile and the furthest gate met (profile confirmed / set frozen / prompts approved / answers collected), because `projects.status` is always "created". List on `/trial/new` below the card; in `start()` (`page.tsx:201`) match `registrableDomain` and offer "Open existing analysis" / "Start fresh". No schema change, no auth | GET route exists, no caller | M | adapt |
| 5 | **Website field on manual competitor add, verified like discovered rivals**; revive a matching stored row; warn before freezing a single rival | Manual entry: Website required, name derived (pagetext/03, network/03, Observed) | Local recall is 0/5, so manual adds are the realistic path, but they carry no domain, verification, place evidence or dedupe. Retyping a rejected real rival creates a duplicate row. The single-rival warning is emitted and then filtered out, so the old run froze 1 rival and 10 identical Trade Offs | Optional Website input in `landscape/page.tsx:462-473`, sent as `addCompetitor.domain` (already accepted, `route.ts:72, 112`). Verify via `competitor-verifier.ts:100` (SSRF-safe) and store place evidence with `mergeEntityCandidateProfile`; keep the operator's tier and confirmed status (never auto-reject). In `route.ts:105-115` match existing rows by `canonicalDomain`/`normalizedName` (all statuses) and confirm that row instead of inserting. Show the frame-planner single-rival warning (`src/lib/prompts/frame-planner.ts:241`) under the gate when eligible rivals = 1, and accept stage `prompt_frame_plan` in `stage-progress.ts:170` | API field exists; warning emitted at `prompts/orchestrator.ts:352` but filtered | M | adapt |
| 6 | **Price/estimate line next to collection, with one true total**: the opposite of a pre-toggled add-on. *(Pending re-verification: written against the retired API lanes, §2.3)* | $59/mo switch `aria-checked="true"` (network/11, Observed); PROJECT-SUN-TAKEAWAYS.md §9 ("show the true total before the card field") | At snapshot time, an env OpenAI key meant "Collect automatically" started paid `gpt-5-nano` calls in one click, and the only "paid per question" copy sat in a hidden form. The new vendor routes also have free tiers with paid overage (route-policy notes: Bright Data $1.50 per 1,000 records after 5,000/month; cloro 7 credits per answer on 500/month) | Return a server-side plan summary: routes, questions, free-tier vs paid status, an approximate estimate. Render one line per connected provider plus a single total ("about $X for this run, or within free tier") beside the Collect button (`src/components/features/observation-console.tsx`). Never label a tier "free" unless the server knows it is (e.g. Gemini grounding bills on billing-enabled keys, CLAUDE.md). Keep any default the user chose | Provider copy "All three have a free tier" (console, post-rework) | S | adapt |
| 7 | **As-of line on Measure** ("Answers collected <dates> · figures computed <time>") | Undated, undefined score (network/08, Observed); PROJECT-SUN-TAKEAWAYS.md §3 | Neither product dates its figures. A single-sample baseline without a date can't be compared or forwarded | In `src/lib/measure/service.ts`, min/max `observedAt` over the loaded responses (`:42-45`), passed through `MeasureResult` (`src/lib/measure/types.ts:100-132`); keep the engine pure. Render in the header meta (`measure/page.tsx:153-161`) and MethodNotes (`:869-873`). Metadata only, so no policy bump | `computedAt` returned, unused (`engine.ts:112`) | S | adapt |

### 8.2 P2

| # | Idea | Opinly source (label) | Why | How to apply in Sun (files) | Already partly? | Effort | Copy / adapt |
|---|---|---|---|---|---|---|---|
| 8 | **Final-checks recap before freezing Landscape** | "Final checks… Here's a quick look at what you've entered." (html/10, Observed) | Duplicate topics, a missing nails topic, a duplicate target row and a single weak rival all passed unnoticed into `csv_18428a0a` | Summary card above "Confirm & continue" (`landscape/page.tsx:479-491`): place, distinct confirmed topics (flag repeats and offering groups with no topic), rivals by tier, "Trade Offs draw on up to 5 of these, mixed across areas". Count distinct normalised names in both gates (`page.tsx:311`, `route.ts:119`); guard a second target row (`orchestrator.ts:98`) | `tradeOffsHint`, requirement lines | S–M | adapt |
| 9 | **"What this set is built from" before Approve** (reusable on Measure's no-run state) | same | Approving freezes the instrument, yet the needs, concerns, places and rival counts behind it are invisible | Read the intent model from the persisted `prompt.context.ready` event (`src/lib/events/bus.ts:116`) in `GET /api/projects/[id]/prompts`; render needs covered, places with counts, rivals with counts above Approve (`prompts/page.tsx:483-499`) with links back to Landscape and Understand | Per-row badges only | M | adapt |
| 10 | **Echo intake answers while Understand runs** ("Analysing atelier10.ae · Customers: DIFC, Dubai (you told us)") | html/10 (Observed) | The rail never shows the market answer; confirmation appears only 30–90 s later | Return the parsed market from `GET /api/projects/[id]` (reuse `withMarket`, `src/app/api/projects/route.ts:20-22`), add `api.getProject`, render `describeMarketHint` under the rail header | Rail shows domain + Search Console step | S | adapt |
| 11 | **Show the checked domain on each competitor row**; fix the verifier summary to name the post-redirect domain | Chip shows logo + domain link (html/03, Observed) | The operator can't see that "Website verified" came from omorfiagroup.com | Render `canonicalDomain` under the name in CompetitorRow (`landscape/page.tsx:553-561`); `competitor-verifier.ts:187` uses the final URL. No third-party favicons | "Source page" link in Why? for search/OSM rows only | S | adapt |
| 12 | **One-click "Confirm suggested topics"** | Auto-advancing one-click radios (pagetext/05-07, Observed) | 4–6 individual Confirm clicks is the heaviest click step | Topics header button sends one PATCH with `topicUpdates[]` (the route already loops, `route.ts:67, 80-83`); show only when 4–6 candidates with distinct names exist | no | S | adapt |
| 13 | **Stage completion in JourneyNav** (✓ / "needs step 2") | 6-segment bar, "Section N of 6" (html/01, Observed) | All links look identical, so users walk into Prompts or Measure and hit confusing failures | Gate summary in `GET /api/projects/[id]` → `src/components/features/journey-nav.tsx`; links stay clickable (journey-ui.md:17,27) | aria-current only | M | adapt |
| 14 | **Show local facts read-only**: hours, phone, email, socials, rating, service areas | Opinly extracts only name/domain/logo (WEBSITE-INGESTION.md §5, Observed); PROJECT-SUN-TAKEAWAYS.md §5 (recommendation) | These facts ground local AI answers; Sun already fetched them for atelier10 and hides them | Emit an `aggregateRating` evidence item (`src/lib/evidence/builder.ts:123-126`; the prefix is a parse contract, so grep resolvers); carry hours and rating into `profile.contact` on both model and rules paths (`src/lib/understanding/index.ts:345-362`, `src/lib/profile/orchestrator.ts`); read-only "Contact & hours" field with evidence after Products & services (`understand/page.tsx:553-568`); render `serviceAreas` in `location-card.tsx`. **No "your hours are missing" action** | Stored, not rendered | M | adapt |
| 15 | **Keep operator corrections on re-analysis; offer re-analyse on a ready profile** | Nothing entered is lost (network/02, loose analogy) | "Analyse again" wipes edits, so fixing a crawl problem costs the corrections | Run the `reanalyze()`/`mergeUserEdits` path (`src/lib/profile/orchestrator.ts:585-597`, `src/lib/profile/merge.ts:48-56`) from `src/lib/crawler/pipeline.ts:55-58`, passing the Search Console option; add "Re-analyse website" to the ready header and note it needs re-confirming | merge code exists, unused | M | adapt |
| 16 | **More than one market country for non-place-bound businesses** | Locations multi-select (PARAMETERS.md §8, Observed) | GCC/online businesses sell into UAE + KSA; the API takes 10, the UI 1 | Chip list under CountryCombobox only when no area is set (`page.tsx`; `src/lib/client/intake-draft.ts:223-243`); `resolveLocation` already scopes multi-country as international (`location.ts:676-680`) | schema allows 10 | M | adapt |
| 17 | **Shareable Measure/profile snapshot that carries its provenance** | "Download report as PNG" (html/08, Observed control) | People forward screenshots; ours should carry x of n, engines, dates and versions | "Print summary" in the Measure header (`measure/page.tsx:163-168`) with `@media print`, MethodNotes opened on `beforeprint`, footer with lineage, dates and "Directional baseline". Never a % without its fraction. Optionally a print route for the confirmed profile + frozen set (not a journey stage) | no | M | adapt |
| 18 | **Honest progress counts** | Decorative "Checking SOG…" (network/08, Observed) as anti-pattern | "15 possible competitors found" counted service-name noise; the Understand bar sat at 75% through the model call; "x of n checked" stays at 0 | Emit `candidate_found` after resolution (`competitors.ts:180-181`); indeterminate percent during the reading stage (`understand-progress.ts:128-131`); reword "x of y planned pages read" (`:164`) | Event-derived rail | S | adapt |
| 19 | **Blameless failure voice with no silent failures** | Manual-entry copy (html/03, Observed) | Landscape PATCH errors vanish; "Restart the app" is a non-action; the Prompts failure copy can be false | Catch in `applyLandscapePatch` → `role=alert` near the card (`landscape/page.tsx:257-270`); Retry on "Not ready yet" (`:364-368`); replace "Restart the app…" with Start again (`:390`); `role=alert` on landscape (`:478`) and console (`observation-console.tsx:522`) errors; conditional Prompts copy (`prompts/page.tsx:325`) | Understand failure copy is good | S | copy |
| 20 | **Disclose search/grounding per route and fix the citation definition text** *(pending re-verification, §2.3: the consumer-web routes run with web search permitted/forced)* | API vs scraping undisclosed (MEASUREMENT-METHODOLOGY.md §6, Unknown) | Beating "undisclosed" needs accurate disclosure: all stored Gemini answers didn't search, and `owned_citation_rate` text claims an operator confirmed "none shown" | Count `searchState` per route in `src/lib/measure/service.ts` (not the engine); "searched the web in x of n" in MethodNotes; update ROUTE_METHOD Gemini line (`measure/page.tsx:37`) and the Sources empty copy (`:288-291`); fix `src/lib/measure/policy.ts:113` text via the sun-measurement-change skill | gpt-oss/OpenAI lines already say "without web search" | S | adapt |
| 21 | **Pin Measure to the prompt set's competitive set; report real lineage** | Identical re-render ≠ validity (network/08, Observed) | Re-confirming Landscape silently rewrites past share of voice | `service.ts:90-95` reads `prompt_sets.competitive_set_version_id`; distinct analysis versions at `:133`; render the set version in MethodNotes. Denominator change → bump `METRIC_POLICY_VERSION` + definitions | KNOWN_ISSUES:134, 136 | M | adapt |
| 22 | **Show what Measure left out** ("18 counted · 2 not collected yet · 1 couldn't be read reliably") | "+ 12 others" hidden label (html/08, Observed) | Exclusions are computed but invisible (KNOWN_ISSUES:142) | Section scope prop gets `{eligible, excluded}` from `measure.scopes.*.excluded` (`engine.ts:185-194`); avoid "Needs review" (copy guard) | computed | S | adapt |
| 23 | **Evidence drawer says why, when and via which route** | PROJECT-SUN-TAKEAWAYS.md §3 (recommendation) | The drawer proves an answer exists, not which words counted or when it was asked | Render `observedAt`, `visibleModelMode`, `searchState` already returned by `src/app/api/provider-responses/[id]/route.ts:30-36`; add the current analysis occurrences and highlight spans; "show all n answers" via `denominatorObservationIds`; "x could not be loaded" | drawer exists | M | adapt |
| 24 | **Start a new prompt version after approval** | "manage the prompts you monitor" (Vendor-stated; CRUD Inference) | The banner promises new versions but no control exists; the stale set stays after a Landscape re-confirm | "Start a new version" → `generate?force=1`; notice when `competitiveSetVersionId` ≠ latest. **Must ship with the Measure console collection fix** (KNOWN_ISSUES:92-93) | backend `force` exists | M | adapt |
| 25 | **Use Search Console demand to order Discovery needs** | Keyword substrate (PROMPT-GENERATION.md; Vendor-stated areas, Inference link) | Real customer wording is collected on Understand and discarded | When `profile.searchConsole.sufficient`, pass `demandByOffering` + capped `topNonBrandQueries` as untrusted userContent into `buildIntentModel` (`intent-model.ts:250-274`); order slots by demand (`discovery.ts:199-241`); existing gates stay | collected, unused | M | adapt |
| 26 | **Local-first diagnostics**: error boundaries + persisted stage timings | Sentry/PostHog (network/01, Observed), no pixels | No error boundary; stage timings need ad-hoc SQL; usage lost on restart | `src/app/error.tsx`, `src/app/projects/[id]/error.tsx`; a new event type for stage usage (add to `SunEventType`, `src/lib/events/bus.ts`); read-only timing script in `scripts/`. Refuse third-party trackers | events table | M | adapt |
| 27 | **Reconcile stranded rows once at server boot** (never from scripts) | Incremental save (network/02, Observed) | A nike.in crawl has been "running" since 2026-09-11 | `src/instrumentation.ts` `register()` (nodejs runtime) marks running/partial/generating rows failed with reason `stranded` and appends events. Don't hook `getDb()` (tsx scripts share `./data`). Coordinate with the user first, because it writes the live DB | detection only | M | adapt |

### 8.3 P3

| # | Idea | Opinly source (label) | Why it matters | How to apply (files) | Already partly in Sun? | Effort | Copy / adapt |
|---|---|---|---|---|---|---|---|
| 28 | Language as a market dimension (e.g. Arabic × UAE) | 44 languages × 112 locales (PARAMETERS.md §8, Observed; localisation Unknown) | Dubai customers also ask assistants in Arabic. Every gate is English, and `normalizeTerm` strips non a-z characters, so an Arabic brand name would fall out of the leakage lexicon | **Prerequisites first:** Unicode-aware `src/lib/text/similarity.ts` (KNOWN_ISSUES:15) and `normalizeTerm` (`src/lib/prompts/validators.ts:24-32`), plus `acceptLanguage` passed in `crawler/orchestrator.ts:525-529`. Then either (a) **a separate project per market language**, which works today with no coupling change, or (b) multi-set support that pins collection runs and Measure to an explicit prompt-set id. (b) depends on fixing KNOWN_ISSUES:92-93 and 134, because Prompts, collection and Measure all read the *latest* version, so a per-language version would replace the English set rather than sit beside it. Keeps 10/10/10 | API field `language` defaults to "en" (`src/app/api/projects/route.ts:16`); the fetcher supports `acceptLanguage` (`src/lib/crawler/fetcher.ts:9, 76`) but it is never passed | L | adapt |
| 29 | Identity preview after URL entry ("Looks like: Atelier 10 Salon") | Result rows with name + favicon (html/02, Observed) | Catches typos, single-word names that pass as hostnames, and wrong domains before a 30–90 s crawl and an orphan project. Reading the site itself avoids directory look-alikes like Opinly's second row | Debounced `POST /api/site/preview` using `normalizeUrl` + `safeFetchHtml` of the home page only; render title/og:site_name as text under `#url`. No Google favicon service | No (logo alt text is only a name signal, `src/lib/evidence/builder.ts:199-200`) | M | adapt |
| 30 | Stage strip on the intake card ("Next: Understand → Landscape → Prompts → Measure, you confirm each step") | html/01 progress bar (Observed) | Tells a non-technical buyer that review steps follow, which reinforces the confirm-before-measure story at first touch | Static strip in `trial/new/page.tsx:321-331` + skeleton row | Partly: landing hero micro-steps (`src/app/page.tsx:39-43`); JourneyNav only on project pages | S | adapt |
| 31 | Operator-friendly copy when Search Console isn't configured | network/03 blameless copy (Observed) | The disabled switch tells the operator to edit `.env.local` and restart: developer copy on a buyer-facing demo screen | Lead with "Search Console isn't set up on this computer. You can continue without it." (test-matched phrase, `tests/unit/search-console/view.test.ts:21`); move env instructions into Setup steps (`src/lib/search-console/view.ts:48-63`) | Partly: status-failure copy (`view.ts:45-46`); geo search degraded flag (`src/app/api/geo/search/route.ts:58-60`) | S | copy |
| 32 | Brand logo on the profile | Favicon (network/02, Observed) | A cheap cue that the right site was read; Opinly's version is low-fidelity and third-party | Use the logo src already in evidence (`builder.ts:199-200`); no third-party service; mind low-contrast wordmarks (Atelier 10's is cream) | Logo src stored in evidence (`cropped-Atelier-10-Wordmark-Cream-scaled-1.png`), never displayed | S | adapt |
| 33 | Operator "not us" names for look-alike brands | Look-alike row ronaksinghvi.com (pagetext/02, Observed) | A same-name business exists, so the short form "Atelier 10" could link its mentions to the target once answers are analysed | Optional `identity` exclusions under Brand name → mention linking in `src/lib/analysis`, bump `ANALYSIS_VERSION` | No | M | adapt |
| 34 | Read-only local MCP server + `/llms.txt` | mcp.opinly.ai/mcp, llms.txt (Vendor-stated) | A GEO tool an agent can query is a cheap 2026 differentiator; llms.txt is a credibility signal | stdio MCP script in `scripts/` over existing GET routes on explicit `SUN_BASE`; no writes, no collection | No | L | adapt |
| 35 | Typed API responses end to end | tRPC shared types (network/01, Observed) | `api.ts` returns `any` for profileVersion, landscape, promptSet, measure and more, so a renamed payload key breaks pages silently (same bug class as the event-key contract) | Export response types next to routes; replace `any` in `src/lib/client/api.ts` | Request bodies zod-validated server-side; `StartJobResponse` typed (`src/lib/client/api.ts:81-84`) | M | adapt |
| 36 | Keep half-typed prompt drafts across reloads | Per-step partial save (network/02, Observed) | A half-typed own prompt or inline edit is lost on reload or navigation (event refetches don't clear it) | `sessionStorage` keyed by promptSetId + section/candidate (`prompts/page.tsx:527-531, 574-625`) | Each review action persists server-side (`src/app/api/prompt-sets/[id]/route.ts:118-121`) | S | copy |
| 37 | State the metered atom ("60 planned answers = 30 questions × 2 routes × 1 sample") | Keyword-metered plans (PARAMETERS.md §10, Vendor-stated) | Makes precision legible and contrasts with keyword-metered GEO | Derived from `coverage.byProvider` + `lineage.samplesPerPrompt` in MethodNotes (`measure/page.tsx`) | `observation_coverage` definition text exists (`src/lib/measure/policy.ts:143`), never rendered; `lineage.samplesPerPrompt` returned (`src/lib/measure/service.ts:136`), never rendered | S | adapt |
| 38 | First real answer card during the first collection (inside Measure only). *Pending re-verification (§2.3)* | TAKEAWAYS §3 "one live prompt" (recommendation) | If a "wow" moment is wanted, it should be a genuine answer with its fraction, never a gauge | Promote the first Discovery answer from the Latest answers feed (`observation-console.tsx`) with "named {brand}: yes/no (1 of 1 so far)". No new collection path | Live "Latest answers" feed and Discovery-first ordering (`src/lib/collection/runner.ts:189`) | S | adapt |
| 39 | Header qualifier stating how answers were collected. *Pending re-verification: labels changed to "ChatGPT on the web" (§2.3)* | Undisclosed method behind "ChatGPT, Gemini and Claude" copy (html/11) | "How ChatGPT and Gemini talk about {brand}" must not overclaim the surface; at snapshot time the qualifier lived only in collapsed notes | `measure/page.tsx` header; allowed labels only. The title copy is a user product decision, so propose it | Header shows "· N asked by hand" when both kinds exist; post-rework `routeLabel` adds "on the web" (`measure/page.tsx:42`) | S | adapt |
| 40 | Neutral site-derived description of a manually added rival ("Its website describes itself as: …") | Bishopdesign accepted without a visible check (html/03, Observed) | An off-category rival entered by hand would distort Trade Offs; Sun screens discovered candidates but confirms manual rows directly | Depends on #5; show the verifier's title/description in Why? as provenance; no rejection or warning copy | Partly: screening exists for discovered pools only | M | adapt |
| 41 | **Decision, not a build item:** search-integrated surfaces (Google AI Overviews, AI Mode, Perplexity) | Opinly's vendor-stated coverage omits all three; the teardown recommends them as a Sun pillar (TAKEAWAYS §7, MEASUREMENT-METHODOLOGY.md §6) | Closest to commercial intent, and absent from both products | AI Overviews and AI Mode have no provider API, so collecting them means SERP scraping or a paid vendor. That conflicts with "no paid spend without approval" and belongs with the user's consumer-web collection memo (`Phase 2/`). Record the decision; don't build ahead of it | No | — | decide |
| 42 | Group cited domains by relationship using data Sun already has | SOURCES-AND-CITATIONS.md (source classification Unknown; "citation sources" Vendor-stated); TAKEAWAYS §4 local sources | Turns "Most-cited sites" into owned / rival / your-social / other without guessing a taxonomy | Classify cited hosts against the project's own domain, confirmed competitor domains and `profile.contact.socialProfiles` hosts in `src/lib/measure/service.ts`; render tags in the "Most-cited sites" panel. Any directory, press or Google Business Profile domain list must stay out of `src/` (CLAUDE.md: lists belong in `benchmarks/` or `scripts/`) | Owned and rival tags already shown (`measure/page.tsx:285-291`) | S–M | adapt |

### 8.4 Refuse: do not copy

- **Data-free scores, forecasts and cohort percentiles** (44, "56% have a better score", "+104%"; network/04, network/08, network/11, Observed). Keep Understand, Landscape and Prompts score-free. Add a Measure-scoped copy-guard pattern (`/\bscore\b|percentile|better than \d+%/`), and remove the existing "Quality n/100" line from the Prompts Why? panel (`prompts/page.tsx:545`).
- **Decorative scanning animations** ("Checking EMIDY…"). Progress stays event-derived.
- **Pre-enabled paid add-ons** (network/11). Paid spend is always explicit and priced (see #6); Landscape stays free unless `SUN_ALLOW_PAID_LANDSCAPE` is approved.
- **Segmentation questions that change nothing** (role, team size, attribution, trackers; network/05-07, Observed). Every intake question must name its downstream consumer.
- **Geo-IP or browser-locale market defaults** (India pre-selected for a UAE brand; network/09). Keep "Detect from my website" (`trial/new/page.tsx:30-36`). A "Global" default once turned a Dubai salon into a US business.
- **A name directory as the source of identity**, or sending typed names or domains to third-party directories or favicon services (network/02). Identity stays evidence-cited from the site.
- **Brand/Agency workspace fork** (html/01). No tenancy backend exists, so the choice would be fake; the resume list (#4) covers the need locally.
- **Skippable competitors** (pagetext/03). Trade Offs need ≥1 eligible rival; reduce friction via #5 and #12 instead.
- **Flat, geography-less competitor lists or country-only markets** (PARAMETERS.md §8). Keep tiers and the area search; close gaps generically (no place lists).
- **Removing confirm gates to speed up the demo** (PROMPT-GENERATION.md, Observed zero prompt input). Confirmed context is what makes local prompts possible.
- **A live-measurement teaser before prompts are approved** (TAKEAWAYS §3). It would put collection outside Measure's console and show an unframed n=1 answer.
- **Turning structured-data findings into "Actions"** (TAKEAWAYS §5). Scope stops at Measure; display the diagnostics only.
- **Keyword metering** (PARAMETERS.md §10). The prompt × route answer stays the unit.
- **A typeahead over stored or rejected competitor names** (a copy of the network/03 autocomplete). It would put rejected items back on screen (journey-ui rule); use silent match-and-revive (#5).
- **Accepting operator-typed rivals with no check at all** (html/03). Keep a neutral site-derived note (#40), but never auto-reject an operator's choice.

---

## 9. Where we excel (outperforming them)

Scope reminder: each comparison is against Opinly's onboarding. Its dashboard is Unknown.

| # | Claim | Evidence | Demo moment |
|---|---|---|---|
| 1 | **We read the site; Opinly's onboarding makes no visible request to it before showing scores about it.** | Old run `crw_1e338200`: 90 sitemap URLs, 30 fetched, 26 selected, 1,957 evidence items (68.9 s). Opinly: zero browser-visible requests to atelier10.ae through commit (network/08, network/11, Observed); a server-side crawl after commit is Unknown (WEBSITE-INGESTION.md §2) | Start a scratch atelier10.ae analysis and narrate the live rail ("N URLs found", "x of y selected pages processed", "N observations collected") next to Opinly's "Checking SYMLNC…" |
| 2 | **We know what the business is, with cited evidence.** | "Atelier 10 Salon", Beauty & Personal Care › Hair & Beauty Salons › Luxury full-service beauty salon; rationale cites `Declared schema type: HairSalon`; healthcare ruled out (`bpv_d3e65980`; fresh profile; golden Understand 10/10). Opinly: `{name, domain, logo}` + self-picked "Local Business" (network/02, pagetext/10, Observed) | Business type → Why? → "Show the website evidence". Then Opinly's Final checks. Frame it as "Opinly asks you; Sun reads the site", **not** "Opinly called it a design studio" (the teardown author did). Caveat: 7 older profiles said healthcare |
| 3 | **Premise-level local geography flows into competitors and prompts.** | Location precision premise, DIFC, lat/lng, scope local, confidence 95; tier plan "In DIFC" + "Across Dubai"; 10/10 Discovery prompts placed at city/neighbourhood level (fresh). Opinly's finest grain: English × UAE, 0 cities (PARAMETERS.md §8, Observed). Fixture test proves intake DIFC → tiers → prompt places (`tests/integration/intake-to-landscape-geography.test.ts:48-66`) | Location card → "View on map"; Prompts place badges (DIFC, Business Bay, Dubai) next to Opinly's locale list. **Use a fresh set** (the stored one uses places as adjectives) and rehearse the area pick: Photon may return building names (KNOWN_ISSUES:30) |
| 4 | **No visibility number without evidence** (one leak: prompt-selection "Quality n/100" in the Prompts Why? panel, M14; remove before demo, §11 #5). | No visibility score before measurement; Measure `—` for zero denominators, `x of n` with `%` only at n ≥ 5, "so far" on partial runs (`src/lib/measure/engine.ts:59-71`; `measure/page.tsx:33, 357-404`; `tests/unit/measure/adversarial.test.ts:138-153`). Opinly: 44 and "56% have a better score" with no data (network/08, Observed) | Opinly's paywall headline next to Sun's atelier10 Measure page, which shows no number. **Stop at the empty state:** the collect buttons error on an unapproved set, and would use the paid lane once approved |
| 5 | **Definitions travel with the numbers, and figures open the answers behind them.** | `?` drawer renders `METRIC_DEFINITIONS` shipped in the same response (`src/lib/measure/policy.ts:47-158`; `route.ts:22-28`); "See the answers →" opens up to 25 contributing answers (`measure/page.tsx:905-967`) | On complete run nike.in `crun_4df4d2c3`: click `?` on Share of voice, then "See the answers →" under it. Avoid drilling from "Recommended unprompted": that label also counts discouraged mentions (M13, KNOWN_ISSUES:141), so say "named", not "recommended". Don't claim cross-run reproducibility (competitive set not pinned) |
| 6 | **Coverage gaps are never counted as brand absence.** | `NOT_CAPTURED` / `NEEDS_REVIEW` leave both numerator and denominator (`engine.ts:81-83`); lane copy "left out of the results, never counted as a miss" (`observation-console.tsx:412-416`) | boldin.in partial run banner "Missing answers are left out of every figure…". **Do not click "Collect N remaining"**: it now starts the consumer-web vendor routes (§2.3; demo pending re-verification) |
| 7 | **The operator confirms everything that shapes the measurement.** | Versioned profile edits, Business type and Location editors, intake-hint conflict box, topic/competitor confirm with Why?, prompt edit/replace/add-own with revalidation, exact 30 approval with frozen hash (`understand/page.tsx:204-271`; `location-card.tsx:251-290`; `prompts/orchestrator.ts:607-660`). Opinly: one Edit pencil on Role & Industry (html/10, Observed) | On a scratch project: Business type → Change → pick a Suggestion → Save, then show "Edited by you" + "Version 2" |
| 8 | **Measurement-safe prompt design.** | Brand-neutral Discovery with a leakage lexicon (name, aliases, short forms, domains, every confirmed rival); Trade Offs bound to one frozen rival + criterion; Sentiment bound to a theme (`validators.ts:95-164, 254-278`). Fresh golden prompts 8/8 | Add own Discovery prompt "best salons like Atelier 10 in DIFC" and read the plain refusal |
| 9 | **For national and known brands, competitors are discovered from multiple sources, typed and tiered.** For local businesses, automatic suggestions are thin: atelier10's rivals came from model memory, 0/5 researched rivals were recalled, and one was mis-verified (H1, H2). Manual add with a website (#5) is the realistic local path. | 6-source pipeline, marketplace exclusion, tier groups (`competitors.ts:141-235`; `competitor-tiers.ts:224-328`). National case wipro.com: 16 country rivals; Tech Mahindra shows "Website verified" + "Listed in India on Wikidata". Opinly: manual only in onboarding (network/03, Observed) | Wipro Landscape → Why? on Tech Mahindra. **Reject Capco (Wipro-owned) first.** Don't use atelier10 for this claim |
| 10 | **No card, no auth, an honest landing page.** | "No card needed for this local Phase 2 trial"; every sample figure labelled illustrative (`landing-sections.tsx:118, 160, 185, 226, 308`). Opinly: card wall, $59 add-on pre-on (html/11, Observed) | Show "All values above are illustrative examples…" next to Opinly's Day 3 card-charge timeline |
| 11 | **Intake asks one required question and refuses to guess the market.** | `trial/new/page.tsx:30-36, 342-458`; APG comboboxes with focus restore (`country-combobox.tsx:163-230`). Opinly: India pre-selected (network/09, Observed) | Pick UAE, type "DIFC", pick the chip; mention the "Place search is unavailable…" fallback |
| 12 | **Cheap per business.** | Fresh run ≈ $0.073 total (Understand $0.0056, Prompts $0.064, judge $0.003, Landscape $0). Only the Understand cost persists in the DB | Say it verbally. It is an internal cost, not comparable to Opinly's retail price |
| 13 | **Stopped jobs end in a way forward, not an endless spinner, and a refresh resumes.** | StageStopped panels with Analyse again / Start again / Generate again; event replay + SSE + 2.5 s poll (`src/lib/client/use-project-events.ts:82-107`; `tests/e2e/core-journey.spec.ts:162`) | Reload mid-Landscape and the same step and counts return. Only restart a server that is isolated (own `SUN_DATA_DIR` and port, never the user's :3000) |

---

## 10. Where we're weaker or exposed

Severity reflects demo risk plus product impact. "Opinly" appears where they are observably ahead in onboarding.

### High

| # | Weakness | Evidence |
|---|---|---|
| H1 | **Local rival recall is poor.** 0/5 researched DIFC rivals on every atelier10 run; the fresh run had 2 suggestions, both from model memory. Grounded search returns 429 on free Gemini, OSM returns `[]`, open knowledge 0. The old run froze a single rival | golden `checks.landscape` 5/8; `competitor_discovery_runs.source_stats {website_explicit:26, ai_hypothesis:6}`; 0/31 live runs have any web_search or nearby_places candidate; KNOWN_ISSUES:47 |
| H2 | **Verification can "verify" the wrong site, and the badge overstates it.** The identity token check accepts any token over 2 chars (no stopwords) and follows redirects; the summary names the pre-redirect domain. The Grooming Company was verified on omorfiagroup.com, shown as "Located in DIFC" (model claim) and "same offering/category" (offeringOverlap 0), and frozen | `src/lib/landscape/competitor-verifier.ts:166-195`; `competitor-entity.ts:5-9`; live `entities ent_84522831`; fresh entity row |
| H3 | **Failures that reach the operator as the wrong message or nothing.** Prompts before Landscape confirm shows false generic copy and a futile Try again; Landscape PATCH errors are silent and Enter can swallow input; collection on an unapproved set returns a generic 500; Measure shows API errors as empty. **Opinly ahead** on the degraded-state contract | `prompts/generate/route.ts:19-32`; `landscape/page.tsx:257-289`; `collection/orchestrator.ts:77-78`; `measure/page.tsx:80-88` |
| H4 | **No way back into a project; the same URL duplicates.** No project list; `GET /api/projects` has no client. **Opinly ahead** (account-bound saves) | `src/lib/client/api.ts:95-99`; DB 8 atelier10.ae / 11 nike.in projects |
| H5 | **Prompt quality control silently didn't run on the only current-policy approved set.** boldin.in: written by free fallback gemini-3.6-flash, 0/21 Discovery judged, 17/26 model Trade Offs rejected because the writer schema makes `factor` optional while the gate requires it, and a template Trade Off approved ("…on free shipping for brightening head serum – 30ml") | `pset_1b8e2d76`; `intent-generation.ts:277-280, 334-338`; `validators.ts:273` |
| H6 | **The reviewer's "validated alternatives" are mostly template splices**, shown first in insertion order ("Is Atelier 10 Salon trusted when it comes to trust?"). The sorted list the selector computes is discarded | `prompts/page.tsx:417, 466-475`; `repository.ts:80-83`; `selector.ts:285-288` |
| H7 | **No as-of date on Measure** (parity with Opinly, but it undermines our provenance story) | `engine.ts:112` (`computedAt` unused) |

### Medium

| # | Weakness | Evidence |
|---|---|---|
| M1 | Model degradation is invisible: OpenAI suspension falls back to Gemini labelled "AI-assisted"; template fallbacks aren't shown; quality warnings are hidden | `.claude/rules/website-intelligence.md:112`; `understand/page.tsx:304-307, 413` |
| M2 | Paid `gpt-5-nano` collection starts in one click with no price when an env OpenAI key exists *(pending re-verification after the collection rework, §2.3)* | `observation-console.tsx:204, 234-250, 324-328` |
| M3 | "Analyse again" discards unconfirmed edits; no re-analyse on a ready profile; failed versions can be confirmed server-side | `pipeline.ts:55-58`; KNOWN_ISSUES:24-27 |
| M4 | No language dimension: `language` is always "en" and not sent as Accept-Language; non-Latin pages dropped as near-duplicates. **Opinly ahead** on the control | `route.ts:16`; `crawler/orchestrator.ts:525-529`; KNOWN_ISSUES:15 |
| M5 | Single market country at intake (API takes 10). **Opinly ahead** (multi-select) | `market-hint.ts:27`; `intake-draft.ts:229-236` |
| M6 | Area search on keyless OSM/Photon returns building or formal names; no live project has used an area hint; the conflict path is unexercised | KNOWN_ISSUES:30, 32; `projects.market_scope` |
| M7 | Local facts (hours, phone, email, socials, rating) extracted or stored but never shown; rating never extracted | `builder.ts:123-124`; `understanding/index.ts:345-362` |
| M8 | Topic gate counts rows, not names: duplicates froze; nails dropped from the old set; the "Luxury salon experience" topic is flawed | `route.ts:119`; `csv_18428a0a`; fresh topics |
| M9 | Rival name forms: "The Grooming" (descriptor "Company" stripped); AI aliases widen to parent brands (Freshdesk→Freshworks) and freeze into leakage/linking; owned brands suggested (Capco for Wipro) | `name-forms.ts:37-56`; DB `aliases`; `prj_a8f1fdf1` |
| M10 | Manual competitor add is name-only: no verification, tier evidence or dedupe. **Opinly ahead** (domain-first) | `landscape/page.tsx:281-289`; `repository.ts:182-214` |
| M11 | "Retry automatic discovery" is a no-op from the ready-but-empty state | `landscape/orchestrator.ts:112-124`; KNOWN_ISSUES:54 |
| M12 | Citation honesty: ungrounded API answers count as "showed no sources" (nike.in 0 of 33); Gemini no-search fallback undisclosed; definition text wrong for automated rows *(pending re-verification after the collection rework, §2.3)* | `collection/orchestrator.ts:574-578`; `policy.ts:113`; KNOWN_ISSUES:110 |
| M13 | Measure reads the latest competitive set, not the pinned one; exclusions hidden; "Recommended unprompted" counts discouraged mentions | KNOWN_ISSUES:134, 141, 142 |
| M14 | Prompts Why? shows "Quality n/100" and raw model ids, against the journey-ui and UI-label rules; the copy guard misses both | `prompts/page.tsx:543-545`; `tests/unit/ui/copy-guard.test.ts:11-12` |
| M15 | Replace can promote below-floor or judge-failed rows; edit errors come back as raw JSON far from the row; edits skip the natural-language gate and can fail later at Approve | `prompts/orchestrator.ts:734-744`; `api/prompt-sets/[id]/route.ts:108-116` |
| M16 | Trade Off/Sentiment writers carry em dashes and stock openers ("Help me find…") that Discovery bans; no code filter | `intent-generation.ts:63, 72`; boldin.in approved set (3 em dashes) |
| M17 | Intent model not stored on the set (event payload only); writers at temperature 0.6–0.9, so regeneration isn't reproducible and the plan isn't auditable in the UI | `prompts/orchestrator.ts:290-292, 339-344` |
| M18 | Single-rival Trade Offs: with 1 confirmed rival, all 10 slots measure one pairing, and the warning is never shown | `selector.ts:108-111`; `stage-progress.ts:170` |
| M19 | Header "How ChatGPT and Gemini talk about {brand}" over API-model answers (deliberate labelling decision; qualifier only in collapsed notes) *(pending re-verification after the collection rework, §2.3)* | `measure/page.tsx:152`; CLAUDE.md UI labels |
| M20 | No error boundaries; stranded DB rows never reconciled (nike.in crawl "running" since 2026-09-11); usage ledger lost on restart. **Opinly ahead** on observability | no `error.tsx` in `src/app`; KNOWN_ISSUES:34, 147 |
| M21 | Accessibility gaps: Measure drawer has no focus trap or return; tablists lack arrow keys; Landscape and console errors lack `role=alert` | `measure/page.tsx:334-351, 969-993`; `observation-console.tsx:522` |
| M22 | Run-to-run variance on the same site: earlier atelier10 profiles said healthcare and produced hospital prompts; brand name "atelier 10 wordmark cream"; rivals flip-flop between runs | 8 atelier10 projects in `business_profile_versions`, `entities` |

### Low

- **Landscape and crawl**
  - Crawl budget skews to blog pages (20/26 selected); `/category/uncategorized/` selected.
  - Differentiators over 60 chars silently dropped (fresh brand identity regressed to generic chips).
  - A highway is typed as a neighbourhood; "Downtown Dubai" missed; Dubai-only extraction examples flatter this test (`extraction.ts:250-254`).
  - Landscape rows appear only after ~96–160 s, then need per-item clicks; "x of n checked" sits at 0 during verification; failure cause computed but not rendered.
  - No logo displayed (`builder.ts:199-200`); `businessModel`/`customerType` stored but hidden (`src/lib/profile/schema.ts`); `llms.txt` not read (no reference in src); robots.txt 5xx treated as allow-all, a deliberate choice so an outage doesn't look like a ban (`src/lib/crawler/robots.ts:157-161, 176-178`); robots/sitemap/Playwright requests bypass the SSRF guard (KNOWN_ISSUES:13).
  - Topics are soft guidance to prompt writing (needs attach to a topic only by token overlap, so coverage isn't guaranteed; `src/lib/prompts/intent-model.ts:160-170`).
- **Prompts and Measure**
  - Custom prompts aren't bound to geography or topic (`topicId: null`, `geographyScope: "none"` at `src/lib/prompts/orchestrator.ts:874, 881-882`).
  - Filter options come from all candidates, including rejected rows (`prompts/page.tsx:271-272`).
  - Progress wording ("strong candidates", "question ideas planned") overstates (`src/lib/client/stage-progress.ts:247, 250`).
  - `frozenHash` is written on approval (`prompts/orchestrator.ts:656-658`) but never re-verified anywhere in src.
  - No export or run history.
  - Profile confirmation defaults `confirmedBy` to "interview_operator" (`src/app/api/projects/[id]/profile/route.ts:125`). The earlier `accountTier "free_tier"` and by-hand `operator` notes are superseded by the collection rework (§2.3).
- **UI, docs and tests**
  - Landing/intake spelling drift ("Analyze"/"Analyse"); tablet nav gap (640–1023 px); developer-facing Search Console setup copy on the intake screen.
  - Doc drift:
    - KNOWN_ISSUES:43 says the market select is never read.
    - ONBOARDING_INTELLIGENCE.md:32-33 and :94-95 describe UI the code hides.
    - `prompts.md:78` is stale about `force` and `policy.status`.
    - CLAUDE.md:114 calls the hint "strongest vote", but it is applied by rule.
  - The live AI prompt path has no automated tests (tests run keyless).

---

## 11. Recommended next steps

Ordered by demo risk, then leverage. All respect the CLAUDE.md hard lines:
- no paid Landscape routes
- no consumer-app automation
- no hardcoded brands or places
- collection only in the Measure console
- nothing past Measure
- use isolated `SUN_DATA_DIR` and ports for any verification run, never the user's :3000 or `./data`

| # | Action | Files | Effort | Why now |
|---|---|---|---|---|
| 1 | **Make competitor verification trustworthy and visible.**<br>• Drop stopwords from the identity token check.<br>• Require the matched identity on the *final* URL's domain, and treat a cross-domain redirect as unverified or neutral.<br>• Name the post-redirect domain in the summary.<br>• Render the checked domain on each row.<br>• Show "Located in …" only from site evidence, or label it as a suggestion, without confidence wording. | `src/lib/landscape/competitor-verifier.ts:166-195`, `src/lib/landscape/competitor-entity.ts:5-9`, `src/app/projects/[id]/landscape/page.tsx:553-579`, `src/lib/landscape/competitor-sources.ts:203-213`; follow the `.claude/rules/landscape.md` policy-version rules | S–M | The flagship demo brand currently shows a mis-verified rival under a "Website verified" badge (H2) |
| 2 | **Ship the degraded-state contract (inspire #1–#3).**<br>• Guards before 202 with typed 409s.<br>• `prompt_set_not_approved` for collection.<br>• Measure error vs empty split.<br>• Per-source discovery status with a coverage note.<br>• Persisted degraded flags on Understand and Prompts. | `prompts/generate/route.ts`, `landscape/generate/route.ts`, `src/lib/http/respond.ts`, `src/lib/collection/orchestrator.ts:78`, `src/lib/landscape/competitors.ts:165-178`, `src/lib/landscape/orchestrator.ts:130-186`, `src/lib/client/stage-progress.ts`, stage pages | M | The pattern most worth copying from Opinly; it also turns H1 from looking like a bug into an honest "limited coverage" message |
| 3 | **Manual competitor add with a website, verification, match-and-revive, and a single-rival warning** (inspire #5). Then one-click topic confirm and a Final-checks recap with distinct-name gate counting (#8, #12). | `landscape/page.tsx:462-491`, `api/projects/[id]/landscape/route.ts:72, 105-121`, `repository.ts:182-214`, `competitor-verifier.ts`, `prompts/frame-planner.ts:241`, `stage-progress.ts:170` | M | The realistic fix for local recall without paid search; prevents duplicate topics and single-rival sets from freezing |
| 4 | **Recent analyses list + same-URL reuse** (inspire #4). | `src/app/api/projects/route.ts:38-43`, `src/lib/client/api.ts`, `src/app/trial/new/page.tsx:201` | M | Demo recoverability; stops duplicate projects |
| 5 | **Prompts review hygiene.**<br>• Make Trade Off `factor` required in the writer schema, or supply a criterion.<br>• Sort alternatives by quality and hide below-floor and judge-failed rows from the list and from Replace.<br>• Remove "Quality n/100" and model ids from Why? (and extend the copy guard).<br>• Record `discoveryJudgeAttempted` and show a template-fill count per section. | `src/lib/prompts/intent-generation.ts:277-280`, `src/lib/prompts/repository.ts:80-83`, `src/app/api/projects/[id]/prompts/route.ts:18`, `src/lib/prompts/orchestrator.ts:461-465, 734-744`, `src/app/projects/[id]/prompts/page.tsx:417, 543-545`, `tests/unit/ui/copy-guard.test.ts`; bump the prompt policy version per `.claude/rules/prompts.md` | S–M | H5/H6: the review tool is the "human in the loop" we demo, and it currently surfaces template splices |
| 6 | **Measure provenance quick wins** (inspire #6, #7, #20). *The as-of line (#7) stands; re-check #6 and #20 against the vendor routes first (§2.3).*<br>• as-of line<br>• paid-lane estimate next to Collect<br>• per-route "searched the web in x of n"<br>• corrected `owned_citation_rate` definition text | `src/lib/measure/service.ts`, `src/lib/measure/types.ts`, `measure/page.tsx:37, 153-161, 288-291, 853-873`, `observation-console.tsx:295-321`, `src/lib/measure/policy.ts:113` (via the sun-measurement-change skill; text-only fix, no denominator change) | S each | Closes the one provenance field neither product has, and removes the undisclosed-spend risk before any live collection demo |
| 7 | **Demo prep, no code.**<br>• Regenerate atelier10 on an isolated data dir with current code.<br>• Reject The Grooming Company and keep Sisters Beauty Lounge (or add known DIFC rivals manually by name).<br>• Approve prompts.<br>• Rehearse the DIFC area pick in the UI.<br>• For Measure, use nike.in `crun_4df4d2c3` for drill-downs and the boldin.in partial run for gap honesty, without clicking "Collect N remaining" (it now starts the vendor routes; re-rehearse after the rework, §2.3).<br>• Pre-reject Capco on wipro.com.<br>• Frame the Opinly contrast as onboarding-only (dashboard Unknown) and attribute "design studio" to the teardown author. | — | S | Every demo moment in §9 has a known trap; this list removes them |

---

## Appendix A: claims removed or corrected during verification

Condensed from each dimension's VERIFICATION LOG, plus contradictions resolved while writing this report.

### A.0 Resolved while writing this report

| Topic | Conflict | Resolution (evidence) |
|---|---|---|
| Intake hint precedence | The Understand dimension described the hint as a weight-4 vote "above structured address 3"; the intake dimension said it is applied by rule | **Rule-based.** `resolveLocation` applies filled / agreed / noted / conflict / overrode after the website's own votes. The hint is only *recorded* as an `operator_stated` signal with `HINT_WEIGHT` 4 (`src/lib/understanding/location.ts:431-495, 716-721`, re-read). CLAUDE.md:114's "strongest location vote" is loose wording |
| Understand timing | Intake: "16–93 s, median ~40 s over 12 recent projects". Journey-ux: "could not reproduce; 27–92 s since 2026-09-13" | **Both hold; different measures.** Re-queried `events.profile.ready − projects.created_at` for the 12 most recent projects: 16.0, 27.5, 28.9, 31.7, 34.3, 39.1, 40.5, 42.7, 50.3, 80.9, 85.0, 92.5 s (median ≈ 40 s). Journey-ux measured `profile.synthesis.started → ready` |
| Old-run competitor rejections | Landscape: rejected as "memory-only". Real-output: "Pastels dns_resolution_failed; Beautique no domain" | **Both hold.** `rejection_reason` for both is "Suggested from general knowledge only; no search result or website confirmed this business in the area."; `verification_status` is `failed` (Pastels) and `not_applicable` (Beautique) (live `entities`, re-queried) |
| Tiers on the old atelier10 project | Intake: "no tier data". Landscape: renders "In DIFC" + "Across Dubai" | **Both hold.** No tiers are *stored* (run predates competitor-discovery@6); GET derives the plan and row tiers at read time from the confirmed profile (`src/lib/landscape/repository.ts:320-331`; `competitor-tiers.ts:734-762`). Rendering not observed in a browser |
| Crawl counts | "90 URLs found (90 from sitemap)" vs "270 discovered / 92 admitted" | **Different counters.** The rail reads sitemap discovery; `crawl_runs.metrics` count all discovered and admitted URLs. `metrics.bySlot` counts the 30 *fetched* pages (editorial 24); 26 *selected* = 20 editorial + 6 others |

### A.1 Intake
- 10 atelier10 projects → **8** (36 total). `market_scope` values corrected to 28 `global`, 6 raw `IN`, 1 `auto`, 1 JSON (Wipro, no area).
- The only live Search Console pull was boldin.in (`no_matching_property`), not atelier10.
- Wipro's "noted" outcome removed as proof of correct reconciliation: `location.ts:448-453` cites exactly that output as the incident the rule was changed to prevent.
- "Under ~1.5 min" → 16–93 s, median ~40 s, with the caveat that this is a profile to confirm, not a metric.
- "Street-to-neighbourhood geography drives prompts" narrowed: street and premise picks are accepted but don't reach tiers or prompts; proven only by a fixture test.
- Opinly fairness:
  - Removed "the directory framed it as a design studio".
  - "Not semantic" downgraded to Inference.
  - Attribution step marked unverified.
  - Added 90 distinct countries and Iraq to the gaps.
- Line refs fixed (domain-ending vote `location.ts:279`, `PLACE_BOUND_KINDS` :187, needsConfirmation :716-718, tiers `competitor-tiers.ts:236-285`).

### A.2 Understand
- Search Console switch is not simply "default off": it turns on when already connected.
- Failed-view copy corrected to `crawlFailureMessage`; added the raw `no_evidence` leak.
- Brand identity: the 2 dropped differentiators were cut by the 60-char cap, not by grounding.
- Removed the "Microblading listed while flagged" weakness (that warning concerned courses).
- `customerQuestions` are saved as `customerJobs`, which do feed Landscape and Prompts.
- Structured-data line refs fixed; the LocalBusiness subtype set is ~190, not ~150.
- "Logo not captured" → the logo src is stored in evidence, just not displayed.
- Contact collected only on the model path.
- "Every field traceable" overstated → price/booking lines and rules-only fields lack citations.
- Crawl-failure and untrusted-text rows changed to `unknown` (strawman vs Opinly).
- Honest-gaps claim noted as not visible in the UI; demoing corrections must use a scratch project (editing confirmed v1 re-gates Landscape).

### A.3 Landscape
- Removed "no atelier10 project has a tier plan" → derived at read time.
- Infosys is **not** "Website verified" (http_403) → demo swapped to Tech Mahindra.
- The verification weakness was raised to high (stopword "the", parent-site redirect, pre-redirect domain in the summary).
- `nearby_places` 0/31 cause not attributable to 429 (the @6 runs had country-only plans).
- Model chains corrected per stage; `SUN_LLM_<STAGE>` is not paid-filtered.
- Topic fallback tops up with templates.
- Landscape doesn't read `market_scope` directly.
- Retry is a no-op only from ready-empty.
- "Progress is real" qualified ("x of n checked" stays at 0; `failedMessage` unused).
- Added the Enter-clears-input bug and duplicate topics in frozen v1.
- Opinly chip favicon → Inference.
- Persistence verdict → `unknown`.
- Typeahead-over-rejected-rows idea rewritten as silent match-and-revive (journey-ui rule).
- Logo idea → domain text only.

### A.4 Prompts
- selectionReason never claimed the judge ran; the real issues are embedded "Quality N/100" and staleness after edits.
- Em dashes exist in the current approved boldin.in set too; root cause is the shared STYLE guide.
- **Added:** 17/26 Trade Offs rejected for a missing criterion (optional `factor`), and the only discovery@2 set was written by free Gemini.
- Filter options come from all candidates, including rejected rows.
- Generation time 31 s–2.4 min, not "minutes".
- Geography demo requires a regenerated set (stored set has 8/10 adjective places).
- Opinly: India pre-select Observed but geo-IP Inference; "not semantic" → Inference.
- Locale idea rewritten as a full 30-prompt set per language (keeps 10/10/10).
- Removed "add answer count (60)" (the denominator varies).
- Draft-persistence rationale corrected (lost on reload, not on refetch).

### A.5 Measure / provenance
- nike.in `crun_4df4d2c3`: 90 analysed answers → **60**.
- boldin.in partial lane corrected (29 planned + 1 rate_limited); pause copy needs a live runner; paid-lane click hazard added.
- Added: atelier10 has no approved prompt set, so the collect buttons error.
- Manual capture "records who pasted" overstated: operator is always "interview_operator".
- Evidence drawer data already returned, just not rendered.
- The "every ratio has a ? drawer" claim narrowed.
- Competitor-set methodology break not enforced (`comparability()` is test-only).
- Opinly verdicts on coverage/citation/versioning → `unknown`; $63/mo marked as teardown arithmetic.
- "First real answer" idea moved inside Measure (hard line).
- Engine-label idea restricted to allowed labels.
- A global "score" copy-guard ban would fail on `prompts/page.tsx:545`, so it is scoped.
- Pinning the competitive set requires a `METRIC_POLICY_VERSION` bump.

### A.6 Journey / UX
- Landing field refs fixed; 252 country options.
- Search Console auto-on.
- Topic insert status `candidate` at `repository.ts:32`.
- Understand timing "16–92 s" could not be reproduced by that dimension (resolved in A.0).
- weExcel "only reported numbers" reworded (Understand % is a heuristic); "labelled dashboard" → every sample figure labelled.
- Paid collection severity high → medium (user-approved lane; the gap is visibility).
- Measure error masking severity high → medium.
- "Confirm cost" idea refuse → adapt; must not override the openai-first decision.
- Stranded-row reconciliation moved from `getDb()` to server-boot `instrumentation.ts` (scripts share `./data`).
- Degraded flag must use persisted data (ledger is in-process).
- Nav gate state effort S → M.
- "Persistence within a flow" → parity.
- Bishop Design reframed as the tester's input.
- Added refusals: instant teaser, skippable competitors.

### A.7 Real output (live DB)
- Selected pages: 24/26 blog → **20/26** (bySlot counts fetched pages).
- The progress rail does not show model or cost.
- Selected prompts were written by **terra**, not "Gemini" (`generation_source` is a label).
- Rejected-at-validation: 16 language + 1 leakage + 1 other.
- Removed the "fast or scripted walk" inference (`interview_operator` is the API default).
- Confirm button not rendered on partial versions (not "disabled").
- Business type button is "Change"; Suggestions appear only in the editor.
- Scope sentence is "Customers mostly come from across Dubai."; `marketScope` confidence 90.
- Relationship select only on manual rows.
- Earlier brand-name and healthcare history added.
- Name-collision verdict → different_approach; reviews/rating → unknown; diagnostics → different_approach.
- Opinly company-search strawman removed.
- Attribution screen uncorroborated.
- Local-facts "Actions" part refused (scope).

### A.8 Fresh run
- Intent filter lists 6 intents from all candidates.
- `tradeOffsHint` ref corrected (`landscape-view.ts:135-143`) and null in this run.
- Add-competitor API already accepts `domain`.
- Judge counts 37 judged / 6 failed.
- Audience "72–80" → 3 of 5.
- Brand identity regression root-caused to the 60-char cap.
- Grooming "Website verified" traced to omorfiagroup.com.
- Alternatives are "first 12 in API order".
- Added the quality-score/model-id Why? weakness.
- Grooming Trade Offs: 3 use "The Grooming", severity high → medium.
- weExcel strawman ("Opinly got the category wrong") and "faster crawl" removed; cost claim reframed as internal and not comparable.
- Rejection-honesty caveat: DNS-based rejection can drop real businesses.
- Added refusals: onboarding live prompt, Actions.
- The eval hint `place:null` bypasses the UI's must-pick rule, so the UI area path is untested.
- Prior results corrected: run 2 was 2/4 with prompts skipped at $0.005.

### A.9 Unresolved or unverifiable

- Nothing contradictory remains between dimensions.
- Still unverified:
  - rendered UI and page ordering (no browser session)
  - whether The Grooming Company or Sisters Beauty Lounge operate in DIFC, and whether the 4 hidden model rivals exist under other domains
  - the Overpass `[]` cause
  - whether Staybridge Suites sits inside DIFC proper
  - Opinly's dashboard (Unknown throughout)
  - run-to-run variance (single fresh run)

### A.10 Post-synthesis revision (critic pass)

A completeness critic checked this report against the Opinly folder, the code and the verified dimension results. 22 gaps were raised (3 high), and all were applied by hand after the automated revision agent stalled:
- **Fairness:** every "zero requests to the site" now carries the teardown's own server-side crawl caveat. Bishop Design's category and the mislabel → pick link are labelled Inference.
- **Consistency:** the TL;DR no longer says Sun "matches or beats everything"; it lists where Opinly is ahead. "Evidence links on every field" and "no score before measurement" are qualified (M14). §9 #9 is scoped to national brands.
- **Staleness:** a dated note (§2.3) and inline tags cover the 19:39–20:32 collection rework (consumer-web vendor routes; API and by-hand lanes retired), which was re-checked read-only.
- **Coverage added:**
  - search-integrated surfaces (§4.7, #41)
  - Sources / citations (§4.10, #42)
  - the Overview → Actions loop mapping (§3.3)
  - Opinly details: "Live in 60 seconds", the $63/mo total, the sub-score incoherence, price-visibility wording
  - teardown inconsistencies (4)–(5)
  - intake loading, the regulated-domain banner, legacy fields, Why? panel states, editor buttons
- **Corrections:**
  - §4.1 brand entry: single-word names pass intake and fail at crawl.
  - §3.2 screens-to-first-output split into 7 / 10.
  - #6 no longer labels Gemini "free" unconditionally and shows one total.
  - #28 no longer implies a per-language version can sit beside the English set.
  - The P3 table regained its Why and Already-partly columns.
  - Low-list refs added and checked; superseded collection notes dropped.
- **Durability:** Appendix B reproduces both selected 30-prompt sets verbatim, so the report stays auditable after the session scratchpad is gone.

---

## Appendix B: the 30 selected prompts, verbatim

Extracted read-only from `prompt_candidates` (`lifecycle_state = SELECTED`), in section and sequence order. Neither set was approved.

**Fresh-run scorecard** (`scripts/eval-onboarding.ts`, case `00-dubai-luxury-salon-atelier10`, 2026-09-14): Understand **10/10** · Landscape **5/8** · Prompts **8/8** · est. **$0.073** · **305 s**. Landscape failures:
- suggested competitors: The Grooming Company, Sisters Beauty Lounge
- researched rivals suggested: 0/5
- tiers populated: area 1, city 1

### B.1 Old live set: `pset_1c6f1d66` (`prj_fef2f186`, 2026-09-13, prompt-selection@4, no intake hint)

| # | Section | Prompt | Place | Rival | Criterion / theme |
|---|---|---|---|---|---|
| 1 | Discovery | Can you suggest a Dubai salon for a haircut that suits me? | Dubai | — | — |
| 2 | Discovery | Help me find a Dubai salon for balayage that grows out naturally | Dubai | — | — |
| 3 | Discovery | Looking for a Dubai salon for natural-looking hair colour | Dubai | — | — |
| 4 | Discovery | Where should I get a hair treatment in DIFC? | DIFC | — | — |
| 5 | Discovery | Which Dubai salon can smooth my hair without cutting it? | Dubai | — | — |
| 6 | Discovery | Which Dubai salon can give me a more lifted lash look? | Dubai | — | — |
| 7 | Discovery | Looking for a DIFC salon for lashes before an event | DIFC | — | — |
| 8 | Discovery | I need polished brows for work; which salon in Business Bay? | Business Bay | — | — |
| 9 | Discovery | What Dubai salon should I use for regular work grooming? | Dubai | — | — |
| 10 | Discovery | Help me find a DIFC salon to shape my untidy beard | DIFC | — | — |
| 11 | Trade Offs | Which gives a more consistently good haircut, Atelier 10 or The Grooming? | — | The Grooming Company | Quality and consistency of the final hair, nail, lash or brow result |
| 12 | Trade Offs | Does Atelier 10 or The Grooming take time to assess my hair first? | — | The Grooming Company | Whether the practitioner provides a personalised consultation before treatment |
| 13 | Trade Offs | Is Atelier 10 or The Grooming better value for a proper haircut? | — | The Grooming Company | Price compared with the level of personal attention and premium salon setting |
| 14 | Trade Offs | I want neat nude gel nails—which is better, Atelier 10 or The Grooming? | — | The Grooming Company | How natural, polished and comfortable the result looks and feels |
| 15 | Trade Offs | I need my feet looking good for open shoes—Atelier 10 or The Grooming? | — | The Grooming Company | How natural, polished and comfortable the result looks and feels |
| 16 | Trade Offs | Is Atelier 10 or The Grooming handier for a pedicure in DIFC? | DIFC | The Grooming Company | Convenience for clients working or staying near DIFC and Sheikh Zayed Road |
| 17 | Trade Offs | I want a comfortable pedicure—should I book Atelier 10 or The Grooming? | — | The Grooming Company | How natural, polished and comfortable the result looks and feels |
| 18 | Trade Offs | Who does better men’s haircuts and beard trims, Atelier 10 or The Grooming? | — | The Grooming Company | Quality and consistency of the final hair, nail, lash or brow result |
| 19 | Trade Offs | Will Atelier 10 or The Grooming advise on a beard shape? | — | The Grooming Company | Whether the practitioner provides a personalised consultation before treatment |
| 20 | Trade Offs | I need a sharp haircut before a meeting—Atelier 10 or The Grooming? | — | The Grooming Company | How natural, polished and comfortable the result looks and feels |
| 21 | Sentiment Analysis | Is Atelier 10 in DIFC good at giving men precise fades? | DIFC | — | Whether the stylist can match the requested haircut, colour or reference image |
| 22 | Sentiment Analysis | Has anyone had trouble with more damage after Atelier 10 treatments? | — | — | Whether colour, bleach or extensions will worsen existing dryness or damage |
| 23 | Sentiment Analysis | How careful is Atelier 10 in DIFC with previously bleached hair? | DIFC | — | Whether colour, bleach or extensions will worsen existing dryness or damage |
| 24 | Sentiment Analysis | Is Atelier 10 in DIFC known for lash lifts that last? | DIFC | — | How long gel nails, lash extensions, lash lifts or colour results will last |
| 25 | Sentiment Analysis | Can I trust Atelier 10 to choose lashes for my eye shape? | — | — | Whether lash and brow treatments will suit the client’s eye shape and natural hair or lashes |
| 26 | Sentiment Analysis | Are Atelier 10 brow treatments good for a natural-looking result? | — | — | Whether lash and brow treatments will suit the client’s eye shape and natural hair or lashes |
| 27 | Sentiment Analysis | Can I trust Atelier 10 with weak natural nails? | — | — | Whether nail preparation is hygienic and gentle rather than damaging to the natural nail |
| 28 | Sentiment Analysis | Is Atelier 10 worth the price for a polished haircut? | — | — | Whether the premium price is justified by the consultation, precision and finish |
| 29 | Sentiment Analysis | How good is Atelier 10 for a sharp haircut and beard trim? | — | — | Whether the premium price is justified by the consultation, precision and finish |
| 30 | Sentiment Analysis | What is the appointment experience like at Atelier 10 in DIFC? | DIFC | — | How convenient the DIFC location, appointment availability and booking process are |

### B.2 Fresh set: `pset_99290858` (current code, 2026-09-14, prompt-selection@5-10-10-10, hint AE + DIFC)

| # | Section | Prompt | Place | Rival | Criterion / theme |
|---|---|---|---|---|---|
| 1 | Discovery | My current cut has grown out badly. Which salons in Dubai should I try for a haircut? | Dubai | — | — |
| 2 | Discovery | Where can I get balayage in Dubai for my first colour? | Dubai | — | — |
| 3 | Discovery | best blow-dry in DIFC | DIFC | — | — |
| 4 | Discovery | i need my hair styled in Dubai for a celebration | Dubai | — | — |
| 5 | Discovery | Where can I get a gel manicure in Dubai for a holiday? | Dubai | — | — |
| 6 | Discovery | My polish never lasts, where in DIFC should I get gel nails? | DIFC | — | — |
| 7 | Discovery | Where should I get eyelash extensions in Dubai? | Dubai | — | — |
| 8 | Discovery | best brow lamination in DIFC | DIFC | — | — |
| 9 | Discovery | My brows grow in different directions and makeup is not helping. Where in Business Bay does good brow lamination? | Business Bay | — | — |
| 10 | Discovery | i need a men's haircut in DIFC before an event | DIFC | — | — |
| 11 | Trade Offs | Compare Atelier 10 Salon and The Grooming Company on overall value for balayage | — | The Grooming Company | overall value |
| 12 | Trade Offs | Who does a sharper skin fade, Atelier 10 or The Grooming? | — | The Grooming Company | Quality and consistency of the stylist or technician's work |
| 13 | Trade Offs | Is Atelier 10 or The Grooming easier to book in DIFC? | DIFC | The Grooming Company | Convenient location, appointment availability and punctuality |
| 14 | Trade Offs | Does Atelier 10 or The Grooming give better value for men's cuts? | — | The Grooming Company | Price compared with the level of experience and finish |
| 15 | Trade Offs | Is Atelier 10 worth more than Sisters Beauty Lounge for a haircut? | — | Sisters Beauty Lounge | Price compared with the level of experience and finish |
| 16 | Trade Offs | Which gives a blow-dry that lasts longer, Atelier 10 or Sisters Beauty Lounge? | — | Sisters Beauty Lounge | Longevity of the result and how much maintenance it needs |
| 17 | Trade Offs | Will a Russian manicure last better at Atelier 10 or Sisters Beauty Lounge? | — | Sisters Beauty Lounge | Longevity of the result and how much maintenance it needs |
| 18 | Trade Offs | Is gel removal safer at Atelier 10 or Sisters Beauty Lounge? | — | Sisters Beauty Lounge | Care taken to protect hair, nails and lashes from damage |
| 19 | Trade Offs | For natural wedding lashes, Atelier 10 or Sisters Beauty Lounge? | — | Sisters Beauty Lounge | How natural the hair colour, lashes, brows or nails look |
| 20 | Trade Offs | Which is easier to visit in Dubai, Atelier 10 or Sisters Beauty Lounge? | Dubai | Sisters Beauty Lounge | Convenient location, appointment availability and punctuality |
| 21 | Sentiment Analysis | Is Atelier 10 in DIFC good at getting brow shapes right? | DIFC | — | Whether the salon can match the requested haircut, colour or brow shape |
| 22 | Sentiment Analysis | Does Atelier 10 actually consider face shape before cutting hair? | — | — | Whether the stylist will assess face shape, hair texture and previous colour before treatment |
| 23 | Sentiment Analysis | How well do eyelash extensions from Atelier 10 hold up? | — | — | How long gel nails, lash extensions or a lash lift are likely to last |
| 24 | Sentiment Analysis | Is Atelier 10 careful when removing gel polish? | — | — | Whether extensions, bleach or other treatments could damage natural hair, nails or lashes |
| 25 | Sentiment Analysis | How clean is the manicure equipment at Atelier 10? | — | — | How clean and hygienic the manicure, pedicure and lash equipment is |
| 26 | Sentiment Analysis | Does Atelier 10 usually run on time for a blow-dry? | — | — | Whether the appointment will run on time for a workday or event |
| 27 | Sentiment Analysis | How reliable is Atelier 10 in DIFC with appointment times? | DIFC | — | Whether the appointment will run on time for a workday or event |
| 28 | Sentiment Analysis | Is Atelier 10 actually calm, or does it feel rushed? | — | — | Whether the salon is genuinely calm and premium rather than rushed or crowded |
| 29 | Sentiment Analysis | Does Atelier 10 feel premium for a lash appointment? | — | — | Whether the salon is genuinely calm and premium rather than rushed or crowded |
| 30 | Sentiment Analysis | Can I trust Atelier 10's booking process to be straightforward? | — | — | How easy it is to book, reschedule or find the salon near DIFC and Sheikh Zayed Road |
