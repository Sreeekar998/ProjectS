# Known issues

These are engineering defects found by a read-only audit of the whole codebase on **2026-09-13**, then re-checked against the code by independent reviewers. They are known and not fixed. They are not intended behaviour, so don't build on them. Re-check the code before relying on an entry, and delete the entry when you fix it.

How each entry was established:
- **probe:** reproduced with a scratch script or run
- **e2e:** seen in the Playwright or browser run
- **code:** found by reading the code, not reproduced

Paths are relative to the repo root.

## Understand (crawl, evidence, profile)
- **SSRF guard gaps.** robots.txt and sitemap fetches use plain `fetch` with `redirect: "follow"` and no DNS/IP check. Sitemap URLs declared in robots.txt and sitemap-index children are not host-restricted. Playwright checks only the first hostname. Files: `src/lib/crawler/robots.ts`, `src/lib/crawler/sitemap.ts`, `src/lib/crawler/playwright-fallback.ts`. *(code)*
- **IPv6 blocklist gaps.** `classifyIpv6` in `src/lib/security/ip-guard.ts` does not block NAT64 `64:ff9b::/96`, IPv4-compatible `::a.b.c.d`, 6to4 `2002::/16` or multicast `ff00::/8`. The DNS check and `fetch()` also resolve the hostname separately, which leaves a rebinding window. *(probe)*
- **Non-Latin pages dropped as duplicates.** `src/lib/text/similarity.ts` keeps only `[a-z0-9]`, and Jaccard similarity of two empty sets is 1. A non-Latin page is therefore dropped as a near-duplicate of any of the last 15 selected pages within ±50% text length; shared digits such as a year don't help. Sentence splitting in `src/lib/evidence/builder.ts` also fails on non-Latin text. *(probe)*
- **"Apr" read as finance.** Three case-insensitive `apr` matches fire on the month "Apr":
  - `REGULATED_KEYWORDS.finance` in `src/lib/profile/deterministic-extractor.ts` (marks the profile regulated);
  - the finance archetype signal in `src/lib/profile/industry-classifier.ts`;
  - the `finance.lending` keyword in `src/lib/profile/taxonomy.ts`.
  One dated listing classified a shoe store as Lending & Mortgages, which also makes it regulated. *(probe)*
- **Other locale subtags still vote in the rules fallback.** `en-US`/`en_US` is now ignored and a locale never adds a country to the footprint, but `src/lib/profile/market-resolver.ts` still turns other region subtags (`en_GB`, `de_AT`) into a weight-1.6 country signal when no model runs. Business Understanding does not count locale tags. *(code)*
- **Edit bounds can still block a save.** "Edit profile" now sends only changed fields, but an operator edit that keeps a stored value outside the edit schema (a brand name over 80 characters, more than 12 markets on a rules-only profile) still returns 400. *(code)*
- **Stranded rows after a restart.** A restart mid-crawl still leaves the version `partial` and the `crawl_runs` row `running` in the database. The Understand page now detects it (no active job in this process) and offers "Analyse again", which replaces unconfirmed edits. *(code)*
- **Manual profile route can't serve its purpose.** `POST …/profile/manual` is meant for blocked crawls, but it returns 409 whenever any profile version exists, and every crawl, blocked ones included, writes one. No UI calls it. It only works on a never-crawled project. The e2e "Landscape and Prompt Intelligence" test seeds its project that way, so don't delete it. *(code)*
- **Failed versions can be confirmed.** Only `action: "confirm"` rejects `partial`. A `failed` version can be confirmed, so an empty profile can reach Landscape and create a target entity with an empty name. `action: "edit"` with `confirm: true` has no status guard at all. *(code)*
- **`locations` stays insert-only.** New prompt sets use places frozen from the profile location, so location edits reach prompts. The table still accumulates rows on every crawl, and `prompt-context@1` sets and the PATCH route on those sets still read it. *(code)*
- **User-edit preservation is never used.** Nothing calls `reanalyze()`, so `mergeUserEdits` runs only in tests, and a re-crawl does not keep user edits. *(probe)*
- **Pasted key ignored after restart.** A key saved in the UI is invisible to the Understand, Landscape and Prompts model calls (`lib/llm` uses `getCredential`) until `loadCredentials()` runs (collection code or the credentials route). Keys in `.env.local` are unaffected. *(code)*
- **Rules-only profiles are weak.** With no model route, Understand still produces a profile, but the description can be a keyword splice ("providing reviews, uncategorized, joseph and links") and there is no classification path or location card. *(probe)*
- **Area search quality on OpenStreetMap.** Without a Google Maps key, the intake and Location card area search (Photon) often returns buildings and formal names ("DIFC Gate building 3", "Dubai International Financial Centre") rather than the area name customers use. Acronym-equivalent names are merged in `resolveLocation`, but Google Places would give cleaner area results. *(probe)*
- **Search Console needs a Google OAuth client and, in Testing mode, reconnecting every 7 days.** It only reads properties the connected Google account can see, so demo sites owned by others get `no_matching_property`. Topics and prompts don't use Search Console data yet. *(code)*
- **Geocoding depends on public OpenStreetMap endpoints** (Nominatim 1 req/s, Photon autocomplete, 5–8 s uncached) unless `GOOGLE_MAPS_API_KEY` is set; the Google Places/Geocoding path has not been run. *(probe, code)*
- **Dead Gemini synthesis provider.** `GeminiProfileProvider` and `selectProvider` in `src/lib/profile/synthesizer.ts` are no longer called; Business Understanding replaced them. *(code)*
- **Usage ledger is in-process.** `lib/llm/ledger.ts` is lost on restart; only the per-profile summary in `quality` (models, estimated cost, call count) persists. Landscape and Prompts usage is not persisted anywhere. *(code)*
- **Uncited fields.**
  - ccTLD and locale-path markets are saved with `evidenceIds: []` at confidence 72, shown as Medium.
  - Industry-implied archetypes are saved with `evidenceIds: []` and `source: "evidence"` at up to 95.
  Both break the evidence invariant, for example for `www.nike.in`. *(probe)*
- **A seasonal site gives a seasonal profile.** The crawl reads what the site publishes and nothing more: truffles.co.in (a Bengaluru burger and dessert chain on Wix) listed only its "Christmas Specials" menu on 2026-09-16, so the profile, topics and Discovery prompts leaned on plum cake and stollen. The Playwright render changes nothing here (the `?menu=` variants render the same default menu), and inventing the rest of the menu would break the no-fabrication rule. Operators fix this by editing offerings and topics before confirming. *(probe)*
- **Branch extraction varies between runs.** The understanding model reads the same locations page differently from one run to the next: Nawab's JVC branch (Circle Mall) was extracted in two of three runs and missed in the third, so the market area chosen at intake ("Jumeirah Village Circle") then had no branch to become the primary and a hint-built place stood in for it (city filled from the website, address absent). The Location card's "Measure customers across" list shows only the branches that were extracted. *(probe, 2026-09-16)*
- **Chains behind a store finder have no branch addresses.** A 44-branch salon chain (tipsandtoes.com) lists cities and areas but no addresses, so `location.branches` is empty, the tier plan has no city tier (scope international, primary a head office) and prompt places come from the head-office city plus the areas the site names. *(probe, 2026-09-16)*
- **Seed URL quirks.**
  - A locale-path seed (`/in/`) is classified as `other`, not `home`.
  - A seed on `app.`, `docs.` or `support.` treats the apex domain as off-site.
  - The intake "Market" select is stored but never read.
  *(probe, code)*

## Landscape (topics, competitors)
- **Local rivals are weak without paid or billed search.** On a free-tier Gemini key, grounded search returns 429 and Gemini 2.5 returns 404, so place-bound targets get rivals only from OpenStreetMap (best-effort: public Overpass instances returned 504/429/timeouts on 2026-09-13) and model memory (rejected unless a website verifies). In the golden run, none of the researched DIFC/Jumeirah rivals were suggested. OpenAI web search is implemented (`competitor-search.ts`) but off for Landscape until `SUN_ALLOW_PAID_LANDSCAPE=1` is approved. *(probe)*
- **Source merge keeps the first proposed type.** `resolveCompetitorCandidates` keeps the first source's `proposedType` unless that source was only a website comparison, so AI "adjacent" can still win over open-knowledge "direct". Structural affinity now takes the maximum. *(code)*
- **Relationship regex still matches "supplier"/"vendor" anywhere** in a reason (`src/lib/landscape/competitor-scoring.ts`); only customer/client were anchored. *(code)*
- **Retailers become marketplaces.** A `marketplace` proposal beats strong structural affinity, so retailer rivals of retailers can't be frozen. The UI can re-type only manual rows. *(probe)*
- **Absent structural score shows as 0.** The stored `scoreBreakdown.structuralAffinity` is clamped to 0 even when absent, although the total was computed with it excluded (-1). *(code)*
- **Stranded discovery runs are reaped only when Landscape generation next runs** (no background reaper). *(code)*
- **Freeze ignores confirmation.** Landscape confirm freezes against the latest profile version without checking `confirmedAt`. Prompt generation then fails, visible only as a `policy.status` event. *(code)*
- **Retry is often a no-op.** "Retry automatic discovery" does nothing when the last completed run for the same profile had any raw candidates. *(code)*
- **Inflated scores for unverified candidates.** They renormalise over very few dimensions: the snippet "compared to Last Season" produced a 72% "Last Season" suggestion. *(probe)*
- **AI source drops everything on one bad item.** The AI hypothesis source discards all suggestions if any single item fails zod. *(code)*
- **Topic problems.**
  - The rules fallback can return 3 candidates, below the 4-topic floor (the model path pads to 4 from rules).
  - `neutralizeTopicName` strips brand substrings without word boundaries (brand "Apple": "Pineapple Juice" → "Pine Juice").
  - The target entity is never renamed after profile edits (untouched system topics are now rebuilt).
  *(probe, code)*
- **PATCH landscape is fragile.** Updates are applied non-transactionally and not scoped to the project. An update entry with only `{id}` throws a 500 after earlier updates committed. Updates sent with `action: "confirm"` persist even when the confirm guard returns 400. *(code)*
- **`scripts/probe-discovery.ts` output gaps.** Its sources column always prints `[]` (sources live in `evidence[].source`), and it doesn't print `rejectionReason`. *(code)*

- **Open-knowledge giants on a global software target.** A category signature such as "Customer relationship management software companies" is specific enough to pass the shared-head rule, so Oracle, SAP and OpenText are suggested for Zendesk at confidence 46–58 beside the real rivals (Freshdesk, Intercom, HubSpot Service Hub, Salesforce, ServiceNow). They are low in the list and easy to reject; a rule that discounts conglomerates would need a company-size signal the sources do not give. *(probe, 2026-09-16)*
- **Banks typed direct for a spend-management platform.** For Qashio the screening model kept UAE banks' corporate-card programmes (ADIB, HSBC, Emirates NBD, Mashreq NeoBiz, Wio) as direct rivals. For the corporate-card purchase that is defensible; for the software purchase they are substitutes. The role rule reads only the rationale text. *(probe, 2026-09-16)*

## Prompts
- **Region prompts fail approval on old sets.** For `prompt-context@1` sets only, generation validates geography against the live `locations` table while approval rebuilds locations from the snapshot with regions labelled `country` (`geography_out_of_scope`). New sets freeze levelled places. *(probe)*
- **Stranded prompt sets stay `generating` in the database** after a restart or exception. The Prompts page now detects this and offers "Generate again" / "Try again" (with `force`). *(code)*
- **Stale set after re-confirm.** After the landscape is re-confirmed with changes, the Prompts page keeps showing the old set; it generates only when no set exists. *(code)*
- **Regenerate without a key always fails on template prompts.** It only reproduces existing wordings (0 of 83 frames gave new text) and returns 409. *(probe)*
- **Dead renderer.** The Discovery renderer `evaluate_criteria` is always rejected as too generic by `natural-validator.ts`. *(probe)*
- **Retries misbehave.**
  - Without a key, shortfall retries only reproduce duplicates.
  - With a key, each retry re-runs the whole intent model and all three section calls.
  - The first-pass-only counters in `generationStats` (`aiCallCount`, `providerDrafts`, `deterministicDrafts`, `framesPlanned`, `intentRetries`, `intentFailedSections`, `generationMs`) never count retry passes, so retry-pass Gemini calls go unreported. `generated`, `validated`, `duplicates` and `shortlisted` do include retries.
  *(code)*
- **Uneven rival pools come up short.** The per-competitor cap (`ceil(10 / rivals) + 1`) never relaxes, unlike the register and category caps. Two rivals whose 12 eligible candidates split 10/2 select only 8 Trade Offs; a 6/6 split fills all 10. *(probe)*
- **Gate holes.** `validateCandidate` accepts:
  - a Gemini-written Sentiment prompt naming a rival;
  - a Trade Off naming two rivals;
  - a Discovery prompt naming an unconfirmed brand.
  *(probe)*
- **Brand matching quirks.** `TARGET_REQUIRED` accepts the canonical name and its `shortNameForms` only ("HDFC" is still rejected for "HDFC Bank" because "Bank" is not a descriptor and `hdfcbank` is the domain label). Multi-word forbidden terms match as raw substrings ("ace hardware" matches "grace hardware"). *(probe)*
- **Target nicknames can leak into Discovery.** `buildTargetLeakageLexicon` (`src/lib/prompts/validators.ts`) uses brand, plural, profile aliases, domains and proprietary offerings, but not the short name forms used for competitors. "Brooks" for a target named "Brooks Sports" passes unless it is a profile alias. *(code)*
- **Review paths trust input.**
  - PATCH edits of generated prompts skip the natural-language gate, then fail later at approval with a raw message.
  - Through the API, review actions skip lifecycle checks: they can resurrect REJECTED rows or add an 11th prompt.
  - `prompt_sets` has no unique (projectId, version) index.
  *(code)*

## Observe (collection)
Collection moved to consumer-web routes through collection providers on 2026-09-14 (`docs/CHATGPT_CONSUMER_COLLECTION_DECISION_MEMO.md`). Entries below that name the retired API or by-hand routes describe stored rows and dormant code, not live lanes.
- **Vendor health and runner progress are in memory.** A restart forgets which provider failed its canary; the next Collect runs the canary again (one credit) and fails `running` rows as `interrupted`. *(code)*
- **No cross-check inside the product.** Two providers are never asked the same prompt in one run (it would double-count the engine). `scripts/vendor-crosscheck.ts` does it outside the product; a "vendors disagree" flag in Measure does not exist yet. *(code)*
- **cloro concurrency is per key, enforced in the client**, not per lane: with `SUN_CLORO_CONCURRENCY=1` the ChatGPT and Gemini cloro lanes take turns, so a 60-prompt run on cloro alone takes 30–45 minutes. *(code)*
- **Decodo screenshots are not taken:** a `headless: "png"` request is a second conversation and would not picture the parsed answer. *(code)*
- **Model is usually unknown on web routes.** Bright Data and cloro returned no model on 2026-09-15 (mobile-web format); Decodo reported `gpt-5-6`. Rows store `visible_model_mode = unknown` rather than a guess. *(probe)*
- **Decodo cannot target a country for ChatGPT.** Every request with `geo` (`IN`, `India`, `United States`) failed with status 613 on 2026-09-15, and an untargeted request exited through an arbitrary country (Vietnamese sites cited). The client no longer sends `geo` unless `SUN_DECODO_GEO=1`, and Decodo rows record `observer_region = null` with `observer_region_source = unknown`. *(probe)*
- **Bright Data answers take 5–12 minutes each.** The synchronous endpoint returns 202 after about a minute and the snapshot was ready after 339 s and 724 s in two probes. The lane runs five prompts at a time (`SUN_BRIGHTDATA_CONCURRENCY`), so a 30-prompt run takes about an hour; submitting all prompts as one snapshot would be faster and is not implemented. *(probe)*
- **Bright Data text arrives with link placeholders.** Inline links in the answer come back as `[1]`, `[2]` in `answer_text` and `answer_text_markdown`, with the link text in `links_attached[].position`; the client restores them. A placeholder with no matching position stays as-is. *(probe)*
- **Oxylabs free-trial duration is not published.** The route works live (7 of 7 on 2026-09-15, median 43 s, country honoured, model reported) but Oxylabs does not say how long the trial's 2,000 results stay available, and there is no pay-as-you-go after it ($49 a month). If the trial lapses before a demo, the run hands over to cloro (free tier: about two full runs) and then Bright Data. *(probe)*
- **Country coverage is vendor-defined.** A market country a vendor does not serve fails with a vendor error and the lane hands over; the app does not pre-check the vendor's country list. *(code)*
- **Bright Data billing for input errors is unclear** (product page says failed deliveries are free; the FAQ says input errors are billed); `include_errors=true` records are counted as vendor requests either way. *(code)*
- **Run creation ignores older approved sets.** `createCollectionRun` requires the project's **latest** prompt-set version to be approved. After `?force=1` or `scripts/regenerate-prompts.ts`, it throws a plain Error (a generic 500) even though an older approved set exists. *(code)*
- **Switching back drops questions.** Switching a run back to a route used earlier retires every unfinished question and plans nothing. *(probe)*
- **Failures not retried by Collect.** Later Collects never re-queue permanent failures (whatever `isPermanentFailure` matches: `*_disabled`, `auth_failed`, `billing_required`, `model_unavailable`, `http_400`–`404`) or rows whose attempts reached the lane cap, even after the cause is fixed. `POST /api/prompt-runs/[id]/retry` exists, but no UI calls it, and `lastError` is not shown. *(probe)*
- **Paused status lost.** On lanes with concurrency > 1 (Gemini, OpenAI), another worker can overwrite `paused`, which then becomes `done`. *(probe)*
- **Duplicate runners.** Concurrent `startCollection` calls, or two processes on one data dir, start two runners that make duplicate provider calls (paid on `openai_api`). *(probe)*
- **Crash window repeats.** A crash between the response insert and `succeeded` makes the next Collect re-ask the provider, hit `UNIQUE(prompt_run_id)`, fail the lane and leave the row `running`. Every later Collect repeats this, paying again on `openai_api`, until the attempts cap. *(probe)*
- **Keyless rows stranded (retired routes).** A consumer-web route planned without its key is `policy_disabled` for that run; since 2026-09-15 the idempotency key is run-scoped, so a new run plans it again once the key is connected. Rows of the retired API routes left `planned` by earlier runs are skipped silently forever. *(probe, code)*
- **Manual-capture gaps.**
  - Typed `failed`/`rate_limited` outcomes on `awaiting_import` rows throw.
  - Manual capture defaults a missing answer state to `complete`.
  - The route accepts `note` and drops it; no column exists.
  - `sessionProfile`, `intendedMarket`, `observerRegionSource` and `inlineCitationUrls` have columns but are never written, and the route doesn't accept them.
  *(probe, code)*
- **Double counting by engine.** By-hand routes added to the same run pool with that engine's automated route, so a prompt asked both ways counts twice for that engine. *(code)*
- **Mislabelled metadata.**
  - `accountTier` is `free_tier` on the paid OpenAI lane.
  - A Gemini answer from the ungrounded fallback records `searchState: off`.
  - Gemini and gpt-oss rows store the requested model name; only OpenAI rows store the model that actually answered.
  *(code)*
- **Plain errors become generic 500s.** Plain `Error`s from collection code reach the UI as a generic 500. *(code)*
- **Auto-finalise needs every planned answer.** A run closes by itself only when every planned answer is collected and analysed; a run left with permanent failures stays open until the operator presses "Finish with what's collected". A finalised run never reopens; a re-check timer cancelled by finalisation is not restarted. *(code)*
- **"Start a new measurement" plans the latest approved set only.** Older approved prompt-set versions cannot be collected from the UI. *(code)*
- **Stale capability gates.** `src/lib/providers/capability-gates.ts` hard-codes `openaiApiEnabled: false` and `zeroAdditionalSpend: true`, and collection never consults them. *(code)*

## Analysis and Measure
- **Hedged recommendations dropped.** "Nike could be a good option" is weak, so Nike is excluded from presence. The answer stays in `discovery_visibility`'s denominator, which deflates visibility. For share of voice the hedged mention leaves both numerator and denominator. *(probe)*
- **Target profile aliases are not linked.** Alias rows are written only for discovered competitors, so the target is matched only by its canonical name, derived short names and plural. Answers that use a profile alias (for example an abbreviation) don't count as target mentions. *(code)*
- **Rank heuristics too broad.**
  - Incidental ordinal words ("try them on first") make an unordered answer rank-eligible.
  - `ordered_prose` ranks count non-recommended brands.
  - Any numbered list makes an answer rank-eligible even when every rank is null.
  - A rank is read only at a brand's first mention, so a brand named before the list gets no rank.
  - The rank is the literal list marker, so two lists yield two "rank 1" brands.
  *(probe)*
- **Comparison extraction errors.**
  - "A and B are fine, but I'd choose C" credits B.
  - "To choose between A and B…" is read as a verdict for A.
  - A verdict in a separate markdown section is never linked.
  *(probe)*
- **Negation leaks.** Negation parity spans the whole clause: "Nike is a solid option and I don't see many complaints" becomes DISCOURAGED. *(probe)*
- **Emerging list blends sections.** The "Also named, but not tracked" list shown under Discovery is built from eligible answers in every section. *(code)*
- **Duplicate v1 rows.** Every run of `scripts/reanalyse.ts` re-inserts v1 `mentions`/`citations` rows as duplicates, and it re-analyses nothing unless the version was bumped or rows are missing. *(code)*
- **Measure page display bugs.**
  - A non-404 API error is masked as the empty "Collect the answers" state (a foreign run id shows its own message).
  - Visibility counts any presence, including DISCOURAGED mentions; the UI calls it "named", never "recommended" (measure-policy@4).
  *(probe, code)*
- **List-only untracked brands need a category.** A brand that appears only as a list label ("3. **Brooks Cascadia 17** —", "* Athleaders Global —") or a map listing ("Kids Unlimited UAE" / "4.8•Fitness center") is proposed as untracked only when the analysis has the project's category words (every run with a prompt-context snapshot, or a profile); a plain sentence-initial mention with no list shape, and a bold colon label ("* **Durability:** …"), are not proposed. A name that appears only as a citation label whose host is not its own site ("[ProFlio Studio](profilo-studio.com)", spelled differently) is treated as a source and never proposed. Since `observation-analysis@15` whole option labels and map entries are read first, but still only with a context. *(code, probe 2026-09-16)*
- **Share of voice (every business named) is only as good as untracked-name detection.** Since `observation-analysis@18` numbered names and headings with a listing below ("1. Maria Dowling", "## 1. ELAN Lash & Brow Beauty Lounge") are read, which took a DIFC salon run from 2 of 10 to 2 of 43 mentions, and spelling variants ("ALKEMY Salons"/"Alkemy Salons") are one business (measure-policy@4). Remaining noise seen 2026-11-09: a place ("Trade Centre"), a haircut style ("Fade") and face shapes ("Oval", "Round") read as businesses. Its denominator includes every untracked business the analysis detected, so a missed name or a place read as a business moves it. In a DIFC salon run at `@16` every Discovery name is a salon, but two branches still count twice ("Pastels Salon" and "Pastels Salon Jumeirah"; "Matryoshka Beauty Salon" and "Matryoshka Russian Beauty Salon") and one keeps its area ("Ivy Beauty & Bubbles Hub Marquise Square"), so the denominator is a little high (2 of 53, about 2 of 51 if merged). Names from other sections ("Aftercare", "Joseph", "REALLY") appear in the list with 0 Discovery answers and do not enter the share. Other kinds (a shoe brand, see below) still leak athletes and retailers. *(probe 2026-09-19)*
- **The competitive set can miss the rivals the assistants actually name.** Landscape builds the set from the website and web search; for a Dubai gym it confirmed EMD Fitness, F45 Training and Gold's Gym UAE, none of which ChatGPT named unprompted, while Fitness First, GymNation and MH3 Gym (named in the answers) stayed untracked. Share of voice then reads "Not comparable" until those are confirmed and a new run collected. Using "who the assistants name for this category" as a competitor-discovery signal is not built. *(probe 2026-09-16)*
- **Untracked names for a global brand still include athletes, retailers and rival product lines.** For a shoe or apparel brand the answers name signature athletes ("Vince Carter"), retailers ("Zappos", "Myntra" when not in a buying sentence) and products of untracked rivals ("Lululemon Nulu", "Old Skool" without "Vans" nearby); products of the tracked brands are learned across the run, but a rival's product is dropped only when the rival's name precedes it in the same answer. Local businesses (gyms, restaurants, salons) and software products (a CRM lists only software tools) are clean; for software, integrations named as options ("Zapier", "Zendesk") stay, since the answers present them as platforms the product works with. *(probe 2026-09-16)*
- **"Here are the best …:" defeats list ranking (partly fixed in `@18`).** Since `observation-analysis@18` a tracked name written as an option label (a bold label, a numbered name with a listing below, a map entry) is RECOMMENDED whatever the lead-in, and untracked options count toward rank eligibility. A bare numbered line with prose under it and no listing cue still depends on the lead-in: a numbered list introduced by "Here are the best X:" is analysed as `no_options` with MENTION_ONLY roles, while "Top picks for X:" or "The best options right now:" before the same list yields `explicit_ordered_list` and RECOMMENDED. *(probe, 2026-09-15)*
- **Comparison aspects are mostly null.** "X is more durable than Y" yields a comparison with no aspect; only a few phrasings ("value", "cushioning") name one, so the head-to-head loss cards often list no aspects. *(probe)*
- **Sentiment needs the brand in the opinion sentence.** "Opinions on X are mixed. Its cushioning is comfortable, but the outsole wears quickly" is NO_SENTIMENT because the opinion clauses do not name X. *(probe)*
- **Snapshots serve past versions by design.** A finalised run keeps serving the analysis and policy versions it was closed with, and Methodology shows a re-analyse action when the analyzer moved on; a `METRIC_POLICY_VERSION` bump alone does not rewrite snapshots until the run is re-analysed or re-finalised. *(code)*
- **Source kind is a guess.** `measure/source-kind.ts` classifies third-party domains from a short host and path rule table; unknown hosts fall to "Other" and a retailer with an unusual domain can be labelled editorial. The label never enters a metric. *(code)*
- **Readiness reads the crawl only.** The Methodology "Technical readiness signals" panel shows what the Understand crawl stored (robots, sitemap, structured data, canonical, hreflang, JS fallback); seeded and crawl-less projects show none, and nothing is re-fetched. *(code)*
## Platform and tooling
- **No boot reconciliation.** Orphaned crawl runs (`running`), profile versions (`partial`), discovery runs (`running`) and prompt sets (`generating`) are never repaired. Only prompt runs recover, at the next Collect. *(code)*
- **Stale builds after reverts.** `scripts/start.ts` rebuilds only when some input file's mtime is newer than the last build, and it checks only at startup. Deleting or renaming a file, or restoring files with older mtimes (for example from a `tar` snapshot), doesn't trigger a rebuild; run `npm run build` by hand. *(code)*
- **Stale `.env.example`.**
  - Its crawl block is labelled "defaults shown" but sets 100 URLs / 25 pages (code defaults are 400/30), so copying it lowers the bounds.
  - Its Playwright comment implies opt-in, but the fallback is on unless set to `false`.
  - It lists the unused `SUN_EVIDENCE_TTL_DAYS`.
  - It lacks `GROQ_API_KEY`/`CEREBRAS_API_KEY`.
  *(code)*
- **Test runs overwrite reports.** `npm test` overwrites `BENCHMARK_REPORT.md` and `benchmarks/business-profile/expected/fixture-report.md`. There is no git, so snapshot them first if you need the old versions. The `BENCHMARK_REPORT.md` footer is hard-coded to "21/4/5". *(code)*
- **Bad JSON bodies return 500.** Malformed or missing JSON bodies return 500 instead of 400 on most POST/PATCH routes. *(code)*
- **Watcher ignores are narrow (unverified risk).** `next.config.ts` `watchOptions.ignored` replaces Next's defaults and does not ignore `.next*`, `test-results/` or `playwright-report/`. *(code)*
- **Full-pipeline test can pass without testing.** `tests/integration/full-pipeline.test.ts` passes without approving, collecting or measuring unless generation selects exactly 30 prompts. *(code)*
- **E2E failures.**
  - The mobile "Start free analysis CTA" test, and the mobile run of "both landing CTAs…", fail on a nav link hidden behind the mobile menu.
  - The desktop landing-CTA tests race the `/trial/new` → `/understand` redirect.
  *(e2e, code)*
