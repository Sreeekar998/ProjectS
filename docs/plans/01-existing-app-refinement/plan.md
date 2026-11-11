# Plan 1: Existing Application Refinement

**Version:** 1.0 · **Last updated:** 2026-11-10 13:55 IST (UTC+05:30) · **Created:** 2026-11-10 · Living document: see section 0.7 before relying on any figure.

**Status:** Plan only. Nothing in this file is implemented. Every item needs the product owner's go-ahead before it is built, and every schema change needs a migration window agreed with the user (decision D19). Plan 1 stays inside the current product scope (Understand → Landscape → Prompts → Measure; "Scope stops at Measure"), so unlike Plan 2 it does not require lifting the scope line. It does touch live data in places (re-analyzing stored runs, closing legacy runs) and spends collection credits or paid model calls in places (noise floor, re-collection, golden evaluations); each of those needs its own explicit approval.

**What this plan is for.** Refine the existing Project Sun app using everything learned from the 2026-11-09 audits and research, the original design documents, the Profound AEO Guide (chapters 1-4, with emphasis on promptology), other vendors' prompt-generation methods (including Peec's own setup documentation), and our own stored answers, without losing the original product vision or important existing functionality. It is the persistent record: the raw research notes it was built from sat in a session temp folder and are not persisted.

## 0. About this plan

### 0.1 How to use this plan in a new session

1. **Read in this order.** This section 0 (IDs, what to re-verify, provenance, Plan 2 links); section 1 (product intent and the must-not-lose list) before proposing any change; section 5 (roadmap) to find the current phase and the next decision checkpoint; then the full entry of the item you are working on (section 3.6 for PR items, section 4.8 for MS, DQ, GEO and PL items); then any open decision it depends on (section 6).
2. **Then inspect the code, not this file.** `CLAUDE.md` is the always-loaded map and the code is the source of truth. Follow its work loop (understand → inspect current code → root cause → implement → run the real app and read the actual output → iterate). Load the matching skill before changing an area: `sun-prompt-quality` (PR items), `sun-measurement-change` (MS, DQ analysis and policy items), `sun-collection-lanes` (collection, GEO-01/02, PL-07), `sun-landscape-quality` (DQ-02, MS-12, PL-08), `sun-profile-quality` (DQ-11, GEO-06, PL-08) and `sun-validate` (every phase gate).
3. **Respect the live environment** (`CLAUDE.md`, "Live environment"). Never experiment on `data/sun.db`, never `db:reset` it, never restart or kill the user's :3000 server, never run bare `next build`. Use your own `SUN_DATA_DIR`, `SUN_EVIDENCE_DIR`, dist dir and port; point `SUN_BASE` scripts at your isolated server. Read the live DB only with `sqlite3 -readonly "file:data/sun.db?immutable=1"`.
4. **Do not repeat the research.** It is finished and condensed here and in Plan 2. Repeat a lookup only to refresh a dated vendor fact; vendors ship monthly.
5. **Mark progress here, never rewrite history.** When an item ships, add a dated "Status:" line under its entry; when a decision is made, add a dated line to its row in section 6; when a phase gate passes, add a dated line under section 5. Never renumber or delete an item; mark it "superseded by …" instead. Remove fixed entries from `docs/KNOWN_ISSUES.md` as `CLAUDE.md` asks.
6. **Push back once.** Several items reopen deliberate operator decisions (the 10/10/10 split, the four-stage journey, English only). Present the evidence once; once the owner decides, implement the decision.

### 0.2 How item IDs work

| Prefix | Area | Where defined | Count |
|---|---|---|---|
| **PR-xx** | Prompt methodology: what is measured, how prompts are typed, worded, counted, refreshed and checked | Section 3.6 | PR-01 to PR-20 |
| **MS-xx** | Measure methodology and metrics: re-analysis, noise, repeats, cadence, change claims, new views | Section 4.8.1 | MS-01 to MS-12 |
| **DQ-xx** | Data quality and analysis accuracy: ownership, rival domains, names, sentiment, roles, comparisons, payload readers | Section 4.8.2 | DQ-01 to DQ-14 |
| **GEO-xx** | Geography and language: observer country, place mix, local records, in-country location, Google surfaces | Section 4.8.3 | GEO-01 to GEO-07 |
| **PL-xx** | Platform and other: lint, docs, boot recovery, SSRF, errors, robustness, upstream quality, dead code, budgets, Gemini, tests | Section 4.8.4 | PL-01 to PL-12 |

- **Priority** (from the research): **P0** now, **P1** next, **P2** later. **Phase** (section 5): **R0** hygiene, measurement gate and calibration; **R1** analysis accuracy, metric policy, prompt metadata and platform robustness; **R2** instrument v2 (all prompt-set and competitive-set changes bundled into one new baseline); **R3** engines, geography and languages.
- **"Break"** means a comparability break: `measure/compare.ts` already treats a different prompt set, competitive set, analysis version, metric policy, analysable engines or samples per question as a break, and provider, observer country, model and partial coverage as cautions.
- **SHARED (Plan 2)** marks an item Plan 2 also depends on (section 0.6).
- **Decisions** in this plan are **D1-D20** (section 6). Plan 2 has its own numbered decisions 1-20, gates Q1-Q8, triggers T1-T15 and red-team items M1-M13 and S1-S15; always write "Plan 2 decision 5", "Plan 2 gate Q4" and so on when citing them.
- **Short source codes** inside entries come from the 2026-11-09 research notes: L06-L11 are Profound 101 lessons; F2-06, F3-02 and similar are AEO Guide figure numbers; B8, B21, B25, B32 are blog entries, V9 a video and S40/S41 sources in the (unpersisted) notes. Section 7 gives the URLs.

### 0.3 What to re-verify first (data and code move)

Every Project Sun figure here was read from code or the live DB on 2026-11-09 or 2026-11-10. Before relying on one:

1. **Version constants** (code read 2026-11-10): `ANALYSIS_VERSION = observation-analysis@18` (`src/lib/analysis/types.ts:63`), `METRIC_POLICY_VERSION = measure-policy@4` (`src/lib/measure/policy.ts:32`), `COVERAGE_POLICY_VERSION = prompt-selection@5-10-10-10` (`src/lib/prompts/coverage-policy.ts:15`), `PROMPT_CONTEXT_POLICY_VERSION = prompt-context@2` (`src/lib/prompts/context.ts:8`), `DISCOVERY_POLICY_VERSION = discovery@3` (`src/lib/prompts/discovery.ts:50`), `INTENT_MODEL_VERSION = intent-model@5` (`src/lib/prompts/intent-model.ts:45`), `COMPETITOR_DISCOVERY_POLICY_VERSION = competitor-discovery@6` (`src/lib/landscape/competitor-types.ts:11`), `COMPETITOR_TIER_POLICY_VERSION = competitor-tiers@1` (`src/lib/landscape/tier-types.ts:15`). Grep them; if any moved, someone shipped part of this plan.
2. **Whether MS-01 has happened.** On 2026-11-10 zero stored analyses were at `@18`; the newest 60 were at `@17`, and finalized runs served snapshots at `@10`-`@17`. If analyses at the current version now exist, Plan 2 gate Q1 may already be clear.
3. **Run and job states.** 14 legacy collection runs still `active` and 1 crawl stranded `running` (PL-04). New runs since 2026-10-15 change every count in sections 2 and 4.
4. **Counts in sections 2.3 and 4.1** (52 projects; 51 prompt sets, 35 approved, 1,050 approved prompts; 27 runs; 1,065 answers; 1,519 analyses; 15 snapshots).
5. **`docs/KNOWN_ISSUES.md`.** About 100 entries; 13 of 14 spot-checked were still present on 2026-11-09. Re-check any entry before building on it.
6. **The user's server.** Is :3000 running, on which data dir? Never touch it; use your own port.
7. **Payload fields.** Fan-out queries and model labels vanished from October payloads; check the newest payloads before building DQ-10 or GEO-05.
8. **Vendor and provider facts.** Provider prices, free tiers and the Oxylabs trial length; Peec and Profound documentation (fetched 2026-11-10). Vendors change monthly.
9. **`CLAUDE.md` decisions.** The 10/10/10 split, `SUN_ENGINES`, paid-model approvals and the no-vendor-names rule can change by operator decision.
10. **Plan 2 status.** Whether its scope line was lifted and whether it already built any shared dependency (section 0.6).

### 0.4 Provenance

| Item | Detail |
|---|---|
| Research run | 2026-11-09, 18 streams (Peec webinar, docs and content; Profound product, content and AEO Guide; Scrunch; AthenaHQ; OtterlyAI and Rankscale; enterprise platforms; SEO suites; local tools and challengers; our Velova and Opinly captures; lever evidence; prioritization concepts; outcome methodology; Project Sun data; Project Sun intent) |
| Volume | About 1,240 source reads (not de-duplicated) |
| Verification | Independent verifiers re-checked 255 load-bearing claims: 209 confirmed, 46 partly confirmed and corrected before synthesis, 0 refuted. Verifier corrections are applied inline |
| Reader report | `docs/Project_Sun_Recommendations_and_Actions_Research_2026-11-09.docx` (canonical, fact-checked, condensed) |
| AEO Guide | Profound AEO Guide chapters 1-4 re-fetched and re-read on 2026-11-10; the text matched the 2026-11-09 deep read |
| Peec documentation | Five Peec docs pages fetched 2026-11-10 (setting up prompts, organizing the setup, identifying competitors, shopping prompts, brand profile); merged into section 3 as [DOC] |
| Small fetches 2026-11-10 | Five Profound 101 setup lessons and two Peec blog posts |
| Current-app audits | `PROJECT_STATUS.md` and `CLAUDE_MEMORY_AUDIT.md` (2026-11-09), `MEASURE_AUDIT.md` (2026-11-09, shipped `observation-analysis@18` and `measure-policy@4`), `docs/KNOWN_ISSUES.md` (2026-09-13, updated to 2026-11-09) |
| Code and DB checks | Code read 2026-11-10; read-only, immutable SQL checks on `data/sun.db` on 2026-11-10 (analysis versions, run and crawl status, prompt facets) |
| Design intent | Phase 2 Final Technical Implementation Specification v2 (the design document), Phase 2 Technical Implementation Plan, Phase 2 Implementation Plan (Independent), Stage 1 Brief, Stage 1 Design Dossier, Manager Brief 2026-09-16, founder discussion transcript 2026-09-03, intent synthesis 2026-11-09 |
| Raw notes | Research notes, verifications, synthesis files and the two draft parts of this plan sat in a session temp folder. **They are not persisted; this plan is the persistent record.** Paths into that folder in section 7 are kept for traceability only |

### 0.5 Labels

| Label | Meaning |
|---|---|
| [DOC] | Vendor or guide documentation, help center, API reference or changelog. "[DOC] (internal)" or "DOC (design intent)" marks a Project Sun document |
| [DEMO] | Seen in a vendor demo, webinar, video or our own capture |
| [CLAIM] | A vendor assertion not demonstrated, including uncontrolled case-study numbers |
| [3P] | An independent third party: a study, standard or industry body or press |
| [INFERRED] | Our interpretation, proposal or arithmetic |
| [UNAVAILABLE] | Looked for and not found or not accessible; nothing is guessed in its place |
| [PROVEN] | Shown by Project Sun's own stored data or current code |
| [HYPOTHESIS] | Plausible but unproven; an untested proposal |

Every change proposed in this plan is [INFERRED] unless labeled otherwise.

### 0.6 Relation to Plan 2 and shared dependencies

Plan 2 (`docs/plans/02-future-recommendations-and-actions/plan.md`) describes a future Recommendations and Actions layer. The plans are independent: Plan 1 is useful whether or not Plan 2 is ever built, and nothing here builds Actions. But Plan 2 blocks every recommendation behind a measurement gate (Plan 2 section 6, gates Q1-Q8) and puts "ownership claims, Q1-Q4, Q8, run checklist" into its MVP weeks 1-2 (Plan 2 section 14). Those items improve Measure on their own, so they live here, marked **SHARED (Plan 2)**. When Plan 2 starts, it builds only what Plan 1 has not delivered.

Plan 2's gates, for reference: **Q1** analysis or claims not current; **Q2** is this domain yours; **Q3** is this the rival's site; **Q4** collect from your market; **Q5** a loss or concern to read; **Q6** an untracked business in ≥3 answers (2 if Landscape suggested it); **Q7** an empty crawled page cited; **Q8** names checked.

| Plan 1 item ID | What | Why Plan 2 needs it | Plan 2 section |
|---|---|---|---|
| MS-01 | Re-analyze every live run at the current analysis version; stamp versions on Report, exports and findings | Gate Q1 blocks every card while analyses are stale | 6 (Q1); 14 (MVP W1-W2) |
| DQ-09 | Blind labeling of all web answers; handcheck extended to the current policy | The release rule (≥30 labeled detections from ≥3 business kinds, 95% Wilson lower bound ≥75%) and the misread classes come from these labels | 7.1; 14 (Phase 0) |
| DQ-01 (with DQ-11, DQ-14) | Evidenced own-domain (ownership) claims applied as a Measure overlay; outbound links stored as evidence; one primary project per business | Gate Q2; the ownership overlay is the one workflow step that changes Measure figures | 6 (Q2), 6.1; decision 4 (16) |
| DQ-02 | Rival domain verification; never freeze a failed verification | Gate Q3 | 6 (Q3) |
| GEO-01 (with GEO-02) | Observe from the business's market; country-capable routes for place-bound projects | Gate Q4; place-bound cards | 6 (Q4), 6.3 |
| DQ-03 (with MS-12) | Names checked; untracked names that recur fed to Landscape | Gates Q8 and Q6 | 6 (Q6, Q8), 6.2 |
| DQ-04, DQ-05, DQ-06, DQ-07 | Sentiment, role and rank, comparison and target-alias accuracy | Gate Q5; misreads become wrong cards | 6 (Q5), 6.3 |
| DQ-08 | Map links out of source metrics | A contaminating defect for source-based cards | 6.3; 12 |
| MS-02, MS-03, MS-04, PL-10 (prerequisites PL-03, PL-07) | Noise floor, repeat samples, cadence with "Runs due", answer budget | Nothing reaches "Repeated", matures, expires or gets a "Used" check without repeat runs | 8.2; 11.2; 14; decision 3 (16) |
| MS-05, MS-06, DQ-12 | Change ledger; stricter "moved" claims; honest search state and model label | Confounders and verdict caps in outcome verification; check runs need a recorded model | 11.1, 11.4; red-team S1 |
| DQ-10 (with MS-11, GEO-04, GEO-05) | Payload readers (fan-outs, ads, local records, citation titles, follow-up forms, entities, inline citations) | Cheapest new evidence; listing, ad and place cards (T4, T5, T14) | 7; 12.2 |
| PL-05 (with DQ-11) | SSRF hardening; crawl gaps are not site gaps | Cited-page checks, own-page Live checks, gate Q7 | 6 (Q7); 12.3; decision 12 (16) |
| PR-13, PR-12 | Diagnostic probes (Accuracy, Validation, Market perception) and frozen rewordings, outside the frozen set | Comprehension-versus-trust routing; re-asks; check-run targets and controls | 5.2; 11.1; decision 15 (16) |
| PR-04 / MS-07 (with MS-03) | Discovery count and samples per question | Changing the method after baselines freeze resets every plan | 11; decision 5 (16) |
| PL-11, GEO-07 | Gemini re-enable criteria; Google AI surfaces before local claims | Local wedge claims need a Google surface | decision 14 (16) |
| PR-01 | Attribute model with operator topic priority P1-P3 | Plan 2's ordering and "Start here" rule use owner priority (unset counts as P2) | 9.3 |
| PR-02, PR-05 | Typed prompt facets; branded vs unbranded separation everywhere | Triggers read each prompt's place, criterion and theme; "known when named" pairs Sentiment with Discovery | 5.2; 7; 8 |
| PR-06, GEO-03 | Place wording and levels; place mix and scope line beside the headline | Place claims only from place-named questions; T7; the place mix beside the headline | 6.3; 7; 9.3 |
| PR-17 | Stable prompt keys and partial comparability | Frozen check plans reference prompts across set versions | 11.1 |
| D19 (schema window) with MS-04, MS-05, DQ-01, DQ-14, PR-02, PR-12, PR-13, PR-17, PR-20, PL-09 | One agreed migration window, batched | New tables break the user's running server until it restarts | decision 6 (16) |

Plan 2 section 0.4 holds the reverse table and names these item IDs.

### 0.7 Version history and maintenance (living document)

This plan will change as decisions are made, items ship and the app moves. Treat the version and "Last updated" stamp at the top as the source of truth for how current it is, not any pointer elsewhere (CLAUDE.md, memory).

| Version | Date and time | Change |
|---|---|---|
| 1.0 | 2026-11-10 13:55 IST (UTC+05:30) | Created from the 2026-11-09 audits and research (18 streams, 255 claims re-checked), the Profound AEO Guide chapters 1-4 (re-read 2026-11-10), Peec's prompt-setup docs (fetched 2026-11-10) and the original design documents. 65 items (PR-01..20, MS-01..12, DQ-01..14, GEO-01..07, PL-01..12), phases R0-R3, decisions D1-D20. |

**How to update this plan:**

- **Stamp every material change.** Update "Last updated" with date, time and time zone, and add a row above. Minor version (1.1, 1.2) for corrections, added detail or a re-verified figure; major version (2.0) when a decision changes direction, a phase is re-planned or scope changes.
- **Item IDs are permanent.** Never renumber or reuse an ID. Instead of deleting, mark an item **Done** (date, where it shipped, version constant bumped), **Superseded by** another ID, **Dropped** (date and reason) or **Blocked** (by what).
- **Record decisions, dated.** When the product owner decides an open question, move it from open to decided in section 6 with the date, the choice and who decided; keep the options that were rejected.
- **Facts age.** Figures from stored data, code paths and version constants were true on the date they cite. Re-verify against the code and database (read-only) before acting, and note the re-verification date next to the figure.
- **Keep the plans in step.** Shared dependencies live in section 0.6 here and in Plan 2's section 0.4; when an item's ID, status or scope changes, update both tables in the same change. When an item ships, also update CLAUDE.md, docs/KNOWN_ISSUES.md or the relevant .claude/rules file if the shipped behavior changes what they say.
- **New research** goes into the relevant section with source URL, label and access date, plus a version-history row; do not overwrite earlier findings silently, mark them superseded.

## 1. Product vision and intent to preserve

### 1.1 What the design documents intended

**Stage 1 Brief (the founder's formal requirements, due 2026-09-06)** [DOC (design intent)].
- Three divisions: **Measure** (where the brand stands in AI answers, per engine, locale and topic, with sample sizes and confidence bands), **Diagnose** (sources behind each answer, citation gap versus competitors, a site readiness audit, an entity check) and **Act** (a weekly prioritized plan across Foundation, Content and Authority, each re-measured after execution). Plan 1 covers only Measure and the stages that feed it; Diagnose and Act belong to Plan 2.
- Primary user: the marketing lead at a Gulf enterprise. Secondary: an agency account manager running many brands.
- Engines in the MVP: ChatGPT, Gemini, Google AI Overviews and AI Mode, Perplexity.
- A first useful insight within ten minutes. The brief asks the design to address non-determinism of AI answers, brand-mention detection, cost per tracked prompt and what providers' terms allow storing.

**Founder discussion, 2026-09-03** [DEMO] (approximate machine transcript; verify any line before quoting).
- Keep the product simple and useful for small and medium businesses and for solo operators with no marketing team.
- Give what is needed and solve the practical problem; do not pile on features.
- Shape: a simple overview, a ranking-style analysis, then actions, then a last tab showing whether the feedback loop works.
- Models must be easy to switch in the back end.
- Prospects are very senior (for example the PR officer of one of the biggest groups in the UAE).

**Stage 1 Design Dossier (2026-09-07)** [DOC (design intent)].
- Measure shows where the brand stands by engine, locale and topic "with sample size and confidence, not false precision".
- First value through progressive results and priority jobs; ten minutes is a service-level target for a directional, evidence-backed result.
- No paid observation begins until the client confirms business, market, competitors, topics and the initial prompt set.
- Report successful n and a Wilson interval for proportions; bootstrap intervals for ranks. Compare only comparable cohorts; annotate drift with a health canary, an overlap cohort and structural-break annotations. A usage ledger at the prompt-run level. Search Console is not AI prompt volume.

**Phase 2 Final Technical Implementation Specification v2 (the design document, September 2026)** [DOC (design intent)].
- **Design thesis.** Take a website the system has never seen, understand the business with evidence, construct a defensible 30-prompt measurement instrument, observe real AI answers through permitted routes, and explain every metric from the underlying evidence. Build one complete vertical slice.
- **Non-negotiables.** An unseen public website completes the journey without database edits or preconfigured data; understanding is evidence-backed, editable and confirmed before prompts are generated or measured; exactly 30 prompts are approved per initial measurement version; neutral discovery and recommendation prompts carry zero target-brand leakage; geography is first-class (global, national, regional, local, multi-location); the prompt set generalizes across B2B, ecommerce, retail, restaurants, dealerships, local services, healthcare, finance, education, hospitality and marketplaces; every result names the actual surface and route measured, and no API result is labeled as consumer ChatGPT or Gemini; runnable for ₹0/$0 additional spend; every headline metric drills down to prompt-level response evidence with valid denominators and coverage; progressive results are mandatory; Actions stay outside Phase 2.
- **Priority order.** 1 Prompt Intelligence ("Bad prompts invalidate the entire measurement"; the primary technical differentiator); 2 business understanding and landscape; 3 collection fidelity and policy; 4 measurement integrity; 5 UI polish.
- **Prompt engine.** Do not ask a model for "30 good questions". Define the coverage the confirmed business needs, generate about 80-120 structured candidates against required coverage cells, run hard schema, brand, geography and safety gates, exact and semantic dedupe, a weighted quality score (0.30 business fit, 0.20 buyer value, 0.15 intent clarity, 0.15 evidence support, 0.10 market fit, 0.10 distinctiveness, minus a redundancy penalty; weights are pilot parameters, not truth), then a constrained selector that satisfies coverage, topic representation, geography rules and branded/neutral separation (not simply the top 30), user review, re-run gates, freeze. **Fixed spine, adaptive shell:** the count, the neutral-first cohort, zero leakage in the neutral cohort, neutral-only Presence and Share of Voice, versioning and the hard gates are fixed; topics, intent mix, personas, constraints, geography granularity and wording adapt to the business archetype. The default spine was **21 neutral / 5 branded accuracy / 4 target comparison**, explicitly "not a claim that every future production customer must use it forever".
- **Prompt dimensions.** Cohort, intent, journey stage, topic, persona or context (one, only when it materially changes the answer), use case or constraint, geography (none/country/region/city/branch; explicit text and observer capability stored separately), language/locale, brand policy (`TARGET_FORBIDDEN`, `COMPETITOR_ALLOWED`, `TARGET_REQUIRED`, `CONTROLLED`), archetype and evidence basis.
- **Gates.** Count; neutrality (alias, domain, possessive and product-name scan); business fit; buyer realism; a single primary intent; non-leading (no false premise or requested positive conclusion); geographic validity; distinctiveness (one survivor per duplicate cluster); regulated safety (no personalized medical, financial or legal advice); reproducibility (no relative dates or implicit "near me" without a controlled observer location).
- **"Why this prompt?"** Topic, intent and journey, persona, geography, brand policy, archetype, evidence and selection reason; rejection reasons preserved so the engine is observable.
- **Progressive results.** Every long stage streams valid partial results; prompt lifecycle GENERATING → CANDIDATE → VALIDATED → SHORTLISTED → SELECTED → USER_APPROVED, with REJECTED carrying a reason; live counters; resumable SSE.
- **Geography.** Five dimensions: business coverage, prompt place (text), observer location (record, never pretend it is controlled), language/locale, provider availability. Do not multiply 30 prompts by every city, persona and locale; multi-market production can later create matched prompt families.
- **Measure.** The response is the atomic fact; metrics are reproducible views over eligible observations; mention, recommendation/rank and citation are separate facts; ambiguous order gives `null`, not invented precision. Five core metrics: Neutral Presence; Competitive Share of Voice (N/A at zero tracked mentions); First-choice rate; Average position (explicit ranks only); Owned citation rate; plus Coverage. Branded accuracy and target comparison are separate panels, excluded from neutral KPIs. Dashboard bands: context, coverage strip, KPI row, provider comparison, topic and geography (small n marked directional), competitor table (emerging brands separate), evidence drawer.
- **Sampling honesty.** One observation per prompt and provider is a directional baseline; "repeated matched samples and uncertainty bands are a later production design".
- **Evaluation.** At least 12 materially different sites; prompt-quality human labels (buyer-realistic and relevant above 85%, biased or leading under 5%, accepted without editing above 70% as a pilot target); duplicates under 5% before review; a labeled golden response set of about 50-100 fixtures for mention, citation and rank precision and recall.
- **Decision log revisit triggers.** Prompt count: pilot or repeated-run evidence justifies a taxonomy change. Prompt structure: measured business-type coverage shows a better spine. Metrics: labeled evaluation supports additional metrics such as sentiment. Sampling: production monitoring requires repeated matched samples and uncertainty.
- **The chain to preserve.** Evidence → Understanding → Human Confirmation → Business-aware Prompt Coverage → 80-120 Candidates → Policy-constrained 30-Prompt Cohort → Permitted High-fidelity Observation → Canonical Evidence → Transparent Measurement. The spec says to preserve this chain even when components evolve.

**Phase 2 Implementation Plan, Independent (2026-09-09)** [DOC (design intent)].
- Ten fixed strata always totaling 30: neutral **N1** category discovery, **N2** constrained recommendation, **N3** comparison and alternatives (unbranded framing), **N4** problem / job to be done, **N5** evaluation criteria, **N6** local / purchase intent; branded (diagnostic only, never in Presence or Share of Voice) **B1** entity / identity, **B2** reputation and evaluation, **B3** head-to-head, **B4** alternatives-to-brand. Guardrails at approval: Cohort N ≥ 20, N1 ≥ 3, N2 ≥ 3, B1 ≥ 2 (the entity check is never optional), Cohort B ≤ 10. Adaptive weights by archetype.
- A five-part neutral-cohort integrity system: (1) generation-time blinding from an allowlist of fields, enforced by types and a unit test; (2) a leakage gate (alias match with token boundaries and fuzzy distance; trade-name match; distinctive n-grams from the brand's site; positioning similarity to the brand's copy); (3) category anchoring (at least three confirmed competitors must be plausible answers to the category, else widen one level and retry; the "eco-friendly Pilates" failure produces a flattering, not an obviously wrong, dashboard); (4) a post-run neutrality audit (brand diversity and HHI concentration per prompt; flags shown, never applied silently); (5) cohort separation in the metric layer with a unit test.
- The **Volunteer Gap**: recommended-when-asked (branded) minus Presence (neutral); "the models know you but rarely offer you".
- A diversity score (1 − mean pairwise similarity); paraphrases in the sampling layer rather than in cohort slots (a stored, pre-approved paraphrase for top-priority prompts, reported as a stability indicator, never folded into the headline); "never pad with paraphrases"; no prompt volume, impressions or AI-search dollar value.
- An offline eval harness: archetype fixtures and an adversarial leakage suite (prompts that smuggle the brand through a slogan, product name, domain fragment, misspelling, translation or positioning phrase); CI asserts stratum quotas, Cohort N ≥ 20, zero leakage escapes, diversity and intent coverage.
- Every metric card is a button that opens its observations: "the single feature that separates a measurement product from a dashboard".

**Phase 2 Technical Implementation Plan (research cut-off 2026-09-09)** [DOC (design intent)]. Hybrid of fixed cohort rules and minimum quotas with adaptive wording, topics, personas and geography, then a frozen version (its 12-slot core was superseded by 30). Absence from the confirmed set never removes a brand from raw evidence; recurring new brands appear in an "emerging entities" list for the next prompt-set version. A branded-accuracy check against the confirmed profile as groundwork. "Citation presence is not citation correctness." Five core Measure metrics; sentiment deferred until a separate labeled evaluation set exists.

**Manager Brief, 2026-09-16/17** [DOC (internal)].
- The product in one paragraph: read the site, work out the business and where it operates, find its competitors, write 30 questions a real customer might type, ask them on the real ChatGPT website, measure how often the business is recommended, how it compares, how it is described and which websites shape the answers; every number traces to its answer.
- Collection moved to consumer-web providers because an API answer is a different product (no web search, no sources, no location; 0 of 478 stored API answers cited a source, against 12-15 sources per web answer).
- "One answer per question is a directional baseline, not a statistic"; fractions, not percentages, on small samples.
- Next steps in priority order: (1) a baseline and a follow-up a week apart on the same 30 questions, compared only when questions, competitors and rules are unchanged; (2) Actions (Plan 2); (3) switch Gemini on; (4) Search Console at onboarding; (5) a job queue and durable runner; (6) provider contracts; (7) sample more than once per question (three samples steady the headline at three times the cost); (8) the collection method in writing for clients.

### 1.2 Principles to preserve

These run through every design document and the current code. Plan 1 items must keep them.

1. **The journey.** `/` → `/trial/new` → Understand → Landscape → Prompts → Measure (four `JourneyNav` stages). Collection is a console inside Measure, never a stage.
2. **Evidence-backed understanding with human confirmation.** Every critical profile fact points to page evidence or is marked user-supplied; nothing downstream runs on an unconfirmed profile, landscape or prompt set; every edit creates a new version.
3. **The prompt instrument.** Over-generate → gate → judge → select, with every rejection reason stored; a fixed count, frozen and hashed at approval; neutral Discovery with zero target leakage by construction; branded prompts never in visibility; geography as a first-class dimension; generality across business types, judged on arbitrary sites with no hardcoded brands, competitors, prompts or metric values in `src/`.
4. **Honest `x of n` Measure.** The answer is the atomic fact; every figure is `x of n` and opens its answers; a failed, uncaptured or unanalyzed answer is a coverage gap, never brand absence; a zero denominator renders `—`; partial runs say "so far"; ranges and explicit comparability breaks; definitions travel with the numbers; versioned, append-only artefacts.
5. **Progressive results.** Long stages surface valid partial results as they arrive.
6. **Local-first, single operator.** SQLite, local evidence store, no auth or tenancy; boring to start.
7. **Zero-cost first.** The app works with no keys; paid spend only with explicit approval (`SUN_LLM_NO_PAID=1` turns every paid route off); collection stays inside provider free tiers unless the operator tops up.
8. **Fidelity and honesty about the surface.** Consumer-web answers only; every answer records its route, provider, session profile and observer country; engines are named only "ChatGPT" and "Gemini"; no collection vendor is named anywhere in the app; nothing is ever called "licensed".
9. **Website text is untrusted data.** It never enters a model's system instructions.
10. **Simplicity for the reader.** The founder's SMB and solo-operator audience: give what is needed, in plain words.

### 1.3 Deliberate divergences that stay

`CLAUDE.md` ("Decisions that override the spec") records operator decisions that replaced parts of the spec. **Do not "fix" them back.** An item that reopens one (PR-04 for the split, PR-13 for branded accuracy, PR-15 for languages) does so only as an explicit owner decision, with evidence presented once.

| Divergence | Decided | What it replaced | Plan 1 stance |
|---|---|---|---|
| **10/10/10 sections** (10 Discovery, 10 Trade Offs, 10 Sentiment Analysis) | Operator decision (`prompt-selection@5-10-10-10`) | The spec's 21 neutral / 5 branded accuracy / 4 comparison ("21/4/5", or "21/5/4" in cohort order) | Stays unless the owner decides otherwise under D1 (PR-04/MS-07). Branded accuracy returns only as probes outside the frozen set (PR-13) |
| **Open business understanding**: evidence-grounded classification (industry path plus closed `kind`), first-class location; language defaults to English | 2026-09-13 | Fixed industry and archetype choice; country-only markets | Stays; PR-01 adds operator-confirmed attributes on top |
| **Intake** (website, optional market with Worldwide or a local area, optional Search Console); market stored as JSON in `projects.market_scope` and applied as the strongest location vote; competitors planned in area / city / country tiers; rejected items and confidence labels hidden | 2026-09-14 | URL + market + language | Stays; GEO-01 uses the confirmed market area when intake is "auto" |
| **Collection through providers**: consumer-web routes (Oxylabs, then cloro, Bright Data, Decodo for ChatGPT; cloro for Gemini); one provider per engine per run; handover on failure without relabeling; model-API lanes and by-hand capture retired, their route ids kept disabled | 2026-09-14 (order 2026-09-15) | Manual ChatGPT Plus and Gemini Apps capture plus optional Gemini free API | Stays. Project Sun's own code never drives chatgpt.com or gemini.google.com |
| **No collection vendor named anywhere in the app** (copy-guard test over `src/app` and `src/components`) | 2026-09-16 | Route transparency in the UI | Stays; every Plan 1 UI item must pass the copy guard |
| **Gemini hidden by default** (`SUN_ENGINES=chatgpt`) | 2026-09-16 | ChatGPT + Gemini in every run | Stays until D17 (PL-11) |
| **Paid OpenAI for onboarding**: Understand and Prompts (2026-09-13), Landscape (2026-09-15, `SUN_ALLOW_PAID_LANDSCAPE=1`), topics on gpt-5.6-terra (2026-09-16) | Operator approvals | ₹0/$0 incremental spend with free Gemini | Stays; any new model call in Plan 1 needs its own approval |
| **Deterministic, versioned analysis** (`lib/analysis`) and **policy-driven Measure** (`lib/measure`) | September 2026 | v1 metrics (`lib/metrics` survives as the legacy parser) | Stays; Plan 1 changes ship as version bumps |
| **Prompt generation**: frame planner, realizer and intent model; Discovery planned as slots in the register of real prompts and judged per prompt; coverage "cells" vestigial | 2026-09-14 onward | Per-cell template generator | Stays; PR-03 replaces vestigial cells with real targets |
| **Every-business share of voice in the headline**; tracked-only share and citation share in exports only | 2026-11-09 Measure audit | Spec's tracked-only Competitive Share of Voice | Stays: tracked-only share reads 100% by construction when no tracked rival is named |
| **Measure workspace**: Overview (with findings), Competitors, Questions, Sources, Report, hidden Answers; Opportunities folded into Overview findings | 2026-09-15; 2026-11-09 | Spec dashboard bands | Stays; no fifth journey stage, no Observe or collect page |

### 1.4 Must-not-lose: existing functionality

Any refinement must keep these working (checked against code and docs on 2026-11-09/10).

- **Intake:** website, optional market (any country, Worldwide, or a local area), optional read-only Search Console connection (encrypted refresh token, reconnect every 7 days).
- **Understand:** SSRF-guarded crawl (robots, sitemap, menu and brochure PDFs, Playwright fallback), page evidence in `evidence-store/`, `crawl_pages` for every attempted URL, evidence-cited profile fields, classification `kind`, location and market area (including the `isDistrictOfOwnCity` rule), the two geographies (where the business is vs where customers are measured), profile versions with a confirm gate and operator edits.
- **Landscape:** 4-6 topics; competitor discovery from the site, an AI hypothesis, Wikipedia/Wikidata, web search and OpenStreetMap; screening, scoring, verification and area / city / country tiers; marketplace exclusion; name forms for spoken targets and rivals; a frozen, hashed, append-only competitive set.
- **Prompts:** the frozen `prompt-context@2` snapshot with leveled places; Discovery slots calibrated on real prompts; the Discovery judge with its giveaway quote and the section judge; the leakage lexicon; selection caps and per-section dedupe; review actions (edit, select, deselect, reject, replace, regenerate, add custom) with re-validation on every write; approval re-validation and `frozenHash`; rejected candidates kept with reasons.
- **Collection console:** canary, credit check, breaker, handover to the next keyed provider, per-lane request cap (`SUN_COLLECTION_MAX_REQUESTS_PER_LANE`, default 60), run-scoped idempotency keys, auto-finalize, "Finish with what's collected", "Collect again", orphan recovery for prompt runs.
- **Evidence:** immutable `provider_responses` (route, provider, session profile, observer country, model when known), vendor payloads in `evidence-store/<project>/artifacts/`.
- **Analysis:** rules-only, versioned, one row per response × version; additive re-analysis (`POST /api/collection-runs/[id]/reanalyse`).
- **Measure:** snapshots per finalized run per versions; five tabs plus Answers; Wilson plausible ranges; breaks and cautions; findings with "evidence of / not evidence of / where to look next"; exports (`csv`, `brands-csv`, `sources-csv`, `json`) re-keyed by surface; printable Report; history and run picker.
- **Progress:** per-project sequenced events with SSE and a 2.5 s poll; event families for crawl, profile, landscape and prompt candidates (`prompt.candidate.validated`, `…shortlisted`, `…selected`, `prompt.counters.updated` and others) [PROVEN, code read 2026-11-10].
- **Switches and guards:** `SUN_LLM_NO_PAID`, `SUN_ENGINES`, `SUN_PREFERRED_ROUTES`, the copy-guard test, no-key operation.
- **Verification tooling:** `scripts/measure-handcheck.ts`, `scripts/mock-vendors.ts` and the `sun-verify*` launch entries, `scripts/eval-onboarding.ts` over 17 golden businesses (`benchmarks/onboarding/golden-businesses.json`), `npm run clean-room`, `scripts/e2e-journey.ts`.

### 1.5 Where the spec's intent is still unmet

| Intent (source) | Status today | Plan 1 items |
|---|---|---|
| Repeated matched samples and uncertainty for production monitoring (spec §8.4, §16; Stage 1 brief "confidence bands"; manager brief steps 1 and 7) | Wilson ranges exist; repeated samples do not. No project has comparable runs on two days. This is the largest gap between vision and build | MS-02, MS-03, MS-04, MS-06, PR-12 |
| Branded accuracy cohort (5 of 30) and the Volunteer Gap (spec §5.1; independent plan §11.4) | Dropped in the 10/10/10 decision; the Volunteer Gap was never built | PR-13 (probes outside the frozen set), PR-05 ("known when named" as two fractions, never subtracted) |
| Coverage policy with required cells (spec §5.3) | Cells are vestigial; selection runs by needs, slots, places and caps | PR-01, PR-03 |
| 80-120 candidates | Oversupply 32 / 26 / 26 = 84 candidates [PROVEN, code] | Met in count; PR-03 adds coverage targets |
| Persona only when it materially changes the answer (spec §5.4) | 95 of 350 Discovery prompts carry persona, mostly template labels | PR-14 |
| "Why this prompt?" with evidence (spec §5.8) | Raw `contextBasis` keys, including model ids; no evidence | PR-02, PR-19 |
| Non-leading, leakage-free neutral prompts (spec §5.5-5.6) | Implemented and stricter than most vendors, but with known gate holes; no post-run neutrality audit; distinctive n-gram and positioning-similarity checks not built | PR-20, PR-08, PR-09 |
| Diversity score (independent plan) | Not shown | PR-03 |
| Prompt-quality human labels (spec §12.1) | None; scores are not quality | PR-18 |
| Golden response set for analysis (spec §12.2) | Unit fixtures exist; no blind-labeled set of real web answers | DQ-09 |
| Arbitrary-site benchmark (spec §12.1, ≥12 sites) | 17 golden onboarding businesses; no Measure-side golden set | PR-18, MS-02 (six golden Measure projects) |
| ChatGPT + Gemini (spec scope); Google surfaces (Stage 1 brief) | Gemini built and hidden; no Google surface | PL-11, GEO-07 |
| Observer location recorded, never pretended (spec §4.3) | Observer country comes from the intake hint, else the US default | GEO-01, GEO-02, GEO-03, GEO-05 |
| One primary language, locale stored (spec §4.3) | English only; non-Latin pages dropped by the crawler | GEO-06, PR-15 |
| Emerging entities for the next prompt-set version (technical plan) | Untracked names listed; not fed back to Landscape | MS-12 |
| Owned citation needs a confirmed owned domain; presence is not correctness | Ownership only from recorded domains; one domain moves "Your site cited" by 5-14 in 30 | DQ-01 |
| Sentiment only after a labeled evaluation set (technical plan) | Reputation exists; unlabeled | DQ-04, DQ-09 |
| Per engine, locale and topic with sample sizes (Stage 1 brief) | Topic and place cells hold 1-3 answers each | PR-04 / MS-07, MS-03; topic and place cells counts only |
| Database-backed jobs with leases (spec §2.1) | In-process jobs; `jobs` table unused; no boot reconciliation | PL-03, PL-07, PL-09 |
| SSRF checks on every fetch (spec §3.1) | robots, sitemap and Playwright fetches bypass the guard | PL-05 |
| Progressive results (spec §10.2) | Event families exist for every stage [PROVEN, code]; whether every page renders partial results as they arrive was not re-verified in the UI on 2026-11-10 | Verify in R0 (section 5) |
| Simplicity for SMB owners (founder) | Measure is honest but dense; the review panel shows internal keys | PR-19, GEO-03 (scope line in plain words) |

## 2. Current application baseline

Sources: `PROJECT_STATUS.md` (audited 2026-11-09 at 10:10, before the Measure audit shipped), `MEASURE_AUDIT.md` (2026-11-09), `docs/KNOWN_ISSUES.md`, `CLAUDE_MEMORY_AUDIT.md`, code read and read-only DB checks on 2026-11-10. Measure-specific state is in section 4.1.

### 2.1 Status at a glance

| Check | Result |
|---|---|
| Overall | A working end-to-end demo for **ChatGPT**: website → Brand Profile → topics and competitors → 30 approved prompts → answers collected through providers → rules-based analysis → Measure workspace. Gemini built but hidden by default [PROVEN] |
| Last code change | 2026-11-09 (Measure audit: `observation-analysis@18`, `measure-policy@4`, new `precision.ts`, Measure views). Before that 2026-10-15 (trade-off verdicts at `@17`, Report and Answers views, prompts orchestrator, Search Console intake toggle) |
| Last data activity | 2026-10-15 (last collection runs; an Oxylabs → cloro handover on a UAE project) |
| Typecheck | Passes |
| Tests | 115 files, 1,183 tests pass after the Measure audit (1,160 before it). Benchmark and Playwright e2e suites not run: they overwrite report files or make real model calls |
| Lint | `npm run lint` fails with 537 errors, all inside `data/deck/.next` (build output of the `sun-deck` launch entry, not ignored by `eslint.config.mjs`); source has 0 errors and 116 warnings (PL-01) |
| Size | About 56.7k lines of TypeScript in `src/`; 27 DB tables; 8 migrations (latest `0007`, 2026-09-15) |
| Stack | Next.js 15.5 (App Router), React 19.1, TypeScript 5.9, Tailwind v4; better-sqlite3 + drizzle-orm, zod; Playwright (crawl fallback, e2e); Vitest 3; Node ≥ 20.11 |
| Runtime model | One server process per data dir; in-process fire-and-forget jobs (`void job()` + 202); no queue (the `jobs` table is unused); no boot reconciliation, so a restart strands crawl runs, discovery runs and generating prompt sets; only collection recovers orphans |

### 2.2 Version constants (code read 2026-11-10)

`observation-analysis@18`, `measure-policy@4`, `prompt-selection@5-10-10-10`, `prompt-context@2`, `discovery@3`, `intent-model@5`, `competitor-discovery@6`, `competitor-tiers@1` (file paths in section 0.3).

### 2.3 Data facts (live DB, read-only)

| Fact | Value | Label |
|---|---|---|
| Projects; prompt sets | 52 projects; 51 prompt sets, 35 approved (1,050 approved prompts, mixed versions) | [PROVEN] |
| Collection runs | 27: 13 `completed`, 14 still `active` (model-API lanes, created 2026-09-10 to 09-16, before auto-finalize existed) | [PROVEN] |
| Answers | 1,065: 645 from the retired model-API lanes (to 2026-09-14); 419 ChatGPT on the web (393 Oxylabs, 26 cloro); 1 captured by hand | [PROVEN] |
| Analyses; snapshots | 1,519 analyses, zero at `@18` (newest 60 at `@17`); 15 measurement snapshots | [PROVEN] |
| Stranded rows | 1 crawl `running` | [PROVEN] |
| Prompt facets (approved sets) | All 350 Discovery prompts have journey stage "awareness"; persona set on 95 of 350 Discovery prompts, mostly template labels; topic on 331 of 350 Discovery but 174 of 350 Sentiment prompts; Measure ignores criterion and theme | [PROVEN] |
| Search Console | 51 crawls: `skipped:no_matching_property` 16, `reconnect_required` 1, absent 34 (before the step existed); `used` never appears; one credential row | [PROVEN] |
| Duplicate projects | atelier10.ae has 12 projects holding four runs and three prompt sets | [PROVEN] |

### 2.4 Journey and functionality status

| Area | Status | Notes |
|---|---|---|
| Intake (market, area, Search Console toggle) | Complete | Market stored in `projects.market_scope` |
| Understand: crawl, evidence, profile, classification, location | Complete | Rules-only profiles (no key) are weak |
| Landscape: topics, competitor discovery and tiers | Complete | Local rivals weak without paid search or a Google Maps key |
| Prompts: generation, review, approval of exactly 30 (10/10/10) | Complete | The live model path has no automated coverage (tests run keyless) |
| ChatGPT collection via four providers with handover | Complete | Oxylabs the main route; Bright Data takes 5-12 minutes per answer |
| Rules-based analysis | Complete at `@18` in code | No stored analysis at `@18` yet; accuracy issues remain (section 4.3) |
| Measure workspace | Complete | Overview (four tiles, findings), Competitors, Questions, Sources, Report, hidden Answers; exports; snapshots; history |
| Gemini collection (cloro) | Built, hidden | `SUN_ENGINES=chatgpt,gemini` turns it on |
| Search Console | Partial | Feeds Understand only; never produced data in 51 crawls |
| Background-job recovery | Partial | Only collection repairs orphans |
| Manual capture, retry and outcome APIs | API only | No UI calls them (kept for stored rows and QA) |
| LLM cost ledger | Partial | In memory; persisted only for Understand |
| Recurring or scheduled measurement | Not present | Every run is operator-started; cost workbooks assume daily |
| Auth, multi-tenancy, deployment | Not present by design | Every API route, including credential storage, is unauthenticated; safe only on a local bind |
| More AI surfaces (Perplexity, AI Overviews, Copilot) | Not wired | |
| Actions / recommendations | Out of scope | Plan 2 |

### 2.5 Known defects by stage

From `docs/KNOWN_ISSUES.md` (about 100 entries, 13 of 14 spot-checked still present on 2026-11-09), `PROJECT_STATUS.md` and `MEASURE_AUDIT.md`. Each defect names the Plan 1 item that fixes it; "no item" means it stays in `KNOWN_ISSUES.md` and should be folded into the nearest item when that code is touched.

**Understand**
- SSRF guard gaps: robots and sitemap fetches use plain `fetch` with redirects and no DNS/IP check; sitemap children not host-restricted; Playwright checks only the first hostname; IPv6 gaps (NAT64 `64:ff9b::/96`, `::a.b.c.d`, `2002::/16`, `ff00::/8`); a DNS-rebinding window → PL-05.
- Non-Latin pages dropped as near-duplicates (`text/similarity.ts` keeps only `[a-z0-9]`); sentence splitting fails on non-Latin text (`evidence/builder.ts`) → GEO-06.
- "Apr" read as finance in three places (one dated listing made a shoe store "Lending & Mortgages" and regulated) → PL-08.
- Failed profile versions can be confirmed (an empty profile can reach Landscape) → PL-08.
- Empty-body pages stored as 200 with 0 words (atelier10.ae `/hair`, `/nails`, `/lashe`, `/barber` fetched without the trailing slash) → DQ-11.
- Stranded crawl rows after a restart → PL-03.
- No item: other locale subtags still vote in the rules fallback; edit bounds can block a save; the manual-profile route returns 409 whenever any version exists; user-edit preservation (`mergeUserEdits`) runs only in tests; a pasted key is ignored by model calls until `loadCredentials()` runs; rules-only profiles are weak; OpenStreetMap area search returns buildings and formal names; `locations` stays insert-only.

**Landscape**
- Freeze ignores confirmation (`confirmedAt` not checked); landscape PATCH non-transactional and not project-scoped; retailers typed as marketplaces; topic neutralizing strips brand substrings without word boundaries ("Pineapple Juice" → "Pine Juice"); the AI source drops everything on one bad item; inflated scores for unverified candidates (a 72% "Last Season") → PL-08.
- Rival domains frozen without valid verification (Studio14: realpilates.ae parked and `failed`; thehundredpilates.com a California studio marked "verified") → DQ-02.
- The competitive set misses the rivals the assistants name (Dubai gym: EMD Fitness, F45, Gold's tracked; Fitness First, GymNation, MH3 named); unconfirmed suggestions later named by ChatGPT (The Gents Salon, 1847, Nails LAB; MYGLOW, Contrology) → MS-12.
- No item: source merge keeps the first proposed type; the relationship regex matches "supplier"/"vendor" anywhere; an absent structural score shows as 0; stranded discovery runs reaped only on the next generation; "Retry automatic discovery" often a no-op; open-knowledge giants (Oracle, SAP, OpenText) suggested for a global software target; UAE banks typed direct for a spend-management platform; `probe-discovery.ts` output gaps.

**Prompts**
- Gate holes: a model-written Sentiment prompt naming a rival, a Trade Off naming two rivals, a Discovery prompt naming an unconfirmed brand; target nicknames can leak (short forms not in the target lexicon); multi-word forbidden terms match raw substrings ("ace hardware" in "grace hardware"); review routes trust input (PATCH skips the natural gate until approval; the API can resurrect rejected rows or add an 11th prompt; no unique (projectId, version) index); uneven rival pools select fewer than 10 Trade Offs → PR-20 (caps also PR-10).
- Stale set after a landscape re-confirm → PR-17. Stranded `generating` sets → PR-20, PL-03.
- Retries re-run everything; keyless regenerate fails (0 of 83 frames gave new text); a dead `evaluate_criteria` renderer; region prompts fail approval on old `prompt-context@1` sets → no item (fold into PR-20 when touched).
- English only → PR-15. Live model path untested → PR-18.
- Thin metadata and raw keys in "Why this prompt is here" → PR-02, PR-19. Place wording decides measured levels → PR-06.

**Collection**
- Observer country from the intake hint only; "auto" markets observed from the US (Empire, Bengaluru, 30 of 30 from a US exit) → GEO-01. Decodo cannot target a country; vendor country lists not pre-checked → GEO-02.
- Vendor health and runner progress in memory; duplicate runners; a crash window between insert and `succeeded`; failures never re-queued and no retry UI; `paused` overwritten → PL-07. Run creation ignores older approved sets (plain 500) → PL-06.
- Model usually unknown on some routes; all 60 October answers lack a model label; `search_state` always "on" → DQ-12, MS-05.
- Oxylabs trial length unpublished → PL-10. cloro concurrency per key; Decodo screenshots not taken; Bright Data placeholders and 5-12 minute answers; "Start a new measurement" plans only the latest approved set; switching back to an earlier route drops questions; manual-capture gaps; mislabeled metadata on retired lanes; auto-finalize needs every planned answer → no item.
- Stale `capability-gates.ts` constants → PL-09.

**Analysis and Measure**
- Zero analyses at `@18`; old snapshots served → MS-01.
- Hedged recommendations dropped; numbered options without a listing cue depend on the lead-in; incidental ordinals make eligibility; two lists give two "rank 1" → DQ-05.
- Comparison credit errors ("A and B are fine, but I'd choose C" credits B); "To choose between…" read as a verdict; aspects mostly null; "RBAC" as a rival → DQ-06.
- Negation and table-cell misreads; opinions without the brand; hedged criticism missed; conditional framing → DQ-04.
- Target aliases not linked → DQ-07. Name noise ("Fade", "Trade Centre", "Oval", "Round"; branches counted twice; athletes and retailers for a shoe brand) → DQ-03.
- Source kind is a host/path guess; map links counted as sources → DQ-08. Own domain unrecorded (atelier10salon.ae) → DQ-01.
- Emerging list blends sections; `scripts/reanalyse.ts` duplicates v1 rows; non-404 API errors masked → DQ-13.
- Readiness panel reads the crawl only → no item (Plan 2 territory).

**Platform and tooling**
- Lint failing on `data/deck/.next` → PL-01. Docs drift (README, `IMPLEMENTATION_STATUS.md`, `.env.example`, `BENCHMARK_REPORT.md` footer "21/4/5", `AGENTS.md` and `.agents/skills`, `CLAUDE.md` drift, `.claude/rules/collection.md` calling the idempotency key global) → PL-02.
- No boot reconciliation → PL-03. Bad JSON bodies return 500 → PL-06. 14 legacy `active` runs and 1 stranded crawl → PL-04.
- Dead code (retired OpenAI/Groq/Cerebras clients, `GeminiProfileProvider`, unused LLM stages, `jobs` table, `is_fixture`, coverage "cells") → PL-09.
- `full-pipeline.test.ts` can pass without measuring; known e2e failures (mobile CTA hidden behind the menu; desktop CTA redirect race) → PL-12.
- Stale builds after reverts (`scripts/start.ts` checks only mtimes at startup); `npm test` overwrites `BENCHMARK_REPORT.md` and a fixture report; narrow watcher ignores → no item.
- Outside Measure: the landing page shows hardcoded marketing figures ("Demo brand", "Competitor A-C", 42%, "8 of 19") in `src/app/page.tsx` and `components/marketing/landing-sections.tsx` → no item (marketing copy; not project data).

**Memory and docs context** (`CLAUDE_MEMORY_AUDIT.md`): two Claude memory folders exist and a session loads only one; parent-folder memories (the Actions research direction, the isolated dev-server `next-env.d.ts` rule, Gemini limits) are invisible from the app folder; several memories are outdated (manual collection, Landscape "not approved"). These do not change the app; PL-02 covers the repo-side drift, and this plan is the persistent record that avoids relying on memory.

## 3. Prompt methodology

### 3.1 Scope and sources for this section

Prompt methodology only: how measured questions are chosen, worded, typed, counted, refreshed and checked. Measure and data items are in section 4. Written 2026-11-10 from research on disk plus small fetches to fill named gaps: five Profound 101 setup lessons, two Peec blog posts, and five Peec documentation pages (setting up prompts, organizing the setup, identifying competitors, shopping prompts, brand profile; https://docs.peec.ai/<name>.md). An earlier draft marked Peec's prompt-setup docs [UNAVAILABLE] because the docs host did not resolve; the pages were fetched later the same day and are merged below as [DOC]. Peec's blog and our September onboarding capture remain as [CLAIM] and [DEMO].

### 3.2 Profound AEO Guide, chapters 1-4

The guide (Nick Lafferty of Profound; Nigel Stevens of OGM, his agency) is undated; figures place it no earlier than mid-June 2026 [INFERRED]. Text re-fetched 2026-11-10 matches our 2026-11-09 deep read. Verifier corrections are applied inline and listed at the end.

#### 3.2.1 Chapter 1: framing and the problems AEO solves

- **What changed** [DOC]. A ranked list became a synthesized recommendation with a point of view; third-party sources speak for the brand inside the answer, so a brand can appear and still lose to an unasked qualifier ("suits smaller teams").
- **Every search is long-tail** [DOC]: people ask more specific questions; assistants ask follow-up questions when detail is missing; personalization adds context the user never typed.
- **Associations vs attributes** [DOC]. Associations are what AI reflects today, in two dimensions: included or not, and how characterized. Attributes are the target state (ICP, pain points, use cases where you win). The guide says associations have replaced rankings as the unit of measurement.
- **Two ways to be wrong** [DOC]: factual errors (wrong integration, price, capability status), findable and fixable; positional errors, where the blend (a creative-ops platform called "DAM software") never makes the company's own case. The facts "may or may not" be right (verifier: our deep read overstated this as "accurate but blended").
- **Two problems** [DOC]: *authority* (appear for bare category asks) vs *long-tail relevance* (win constrained asks, e.g. DTC over $5M needing Shopify). Start with the weaker one.
- **Framework** [DOC]: decide who you are; baseline by asking the prompts buyers ask; close the gap, owned surfaces first.
- **Candor** [DOC, contributor quotes]: prompt tracking is synthetic and mostly single-turn while real research is multi-turn and personalized (John-Henry Scherck); a positioning evidence map compares customer, company, third-party and AI language (Gaetano DiNardi).
- **Implication** [INFERRED]. Our Discovery measures inclusion and Sentiment measures characterization; nothing checks positioning fit or facts. Authority vs long-tail maps onto our Discovery slot shapes (bare vs context/situation), which we store but do not report.

#### 3.2.2 Chapter 2: identity, "why you win", "what you're not", data, themes, attributes, priority

- **Identity before tracking** [DOC]. The *ideal state* is a loop refined after the first audit.
- **Why you win** [DOC]. Answers are comparative; recommendation follows fit to a situation. **What you're not** is the same question reversed: serving everyone yields an AI picture that fits everyone and is chosen by no one (exceptions: category-defining brands, specialists that truly scale).
- **Template** [DOC]: we are a [category] for [audience] who need [capability]; we win because [differentiator]; we are not [not-for].
- **Mine existing data** [DOC]. Volumes help but are not enough. External: real user prompts (Profound Prompt Volumes), review sites, competitor presence, analysts, Reddit. Internal: sales calls, tickets, usage, NPS, win/loss. B2B leans on first-party data; consumer brands on public data. Scherck: AEO should amplify validated positioning, not invent it.
- **Themes** [DOC]: patterns within each source; cross-reference (independent sources agreeing = high confidence); weigh by volume ("onboarding difficulty" in 40% of negative reviews and 1 in 3 calls outranks "API flexibility" in two reviews); check with PMM, sales, support.
- **Attribute list** [DOC]: product category (with buyer wording variants), industry/vertical (consumer: lifestyle segments), pain points, use cases, integrations/compatibility, persona/ICP, plus company-specific categories (ShipBob: fulfillment-center location). Profound's own matrix adds Features and Models and omits Integrations; the text says it carries weights but the published table has none. Chain: identity → attributes → prompts → measurement.
- **Prioritization** [DOC]: per attribute, importance (moves purchases?), distance (gap to ideal), feasibility (can we influence it?); start where all three overlap (figure F2-06). Factual attributes (certifications, compliance, integrations, pricing) go to Accuracy prompts.
- **P1-P3** [DOC/INFERRED]. Chapter 4 uses a Priority 1-3 scale it attributes to Chapter 2 (P1 decides the consideration set; P3 won't cost a client); Chapter 2 never defines it (editorial gap).
- **Strengths conflict** [DOC]: leave alone (Ch 2) vs double down (Ch 4) vs amplify before rivals do (Ch 5).
- **Implication** [INFERRED]. We capture identity-like fields (`profile.brandIdentity`, `positioning.differentiators`, offerings, audience) and 4-6 topics, but no "not for", no operator priority and no attribute → prompt mapping.

#### 3.2.3 Chapter 3: Promptologie

**Coverage, not completeness** [DOC]. Buyers arrive through long conversations, dense single prompts or personalized exchanges; volumes show what is asked, not how answers change with added detail. Tracked prompts need not match buyer wording; they must be representative and varied enough to trust the read per attribute. Start small in one funnel area (Noah Greenberg).

**Portfolio per attribute** [DOC]. Spread prompts across each attribute so no single phrasing sinks the read; inspect prompts to find failures, but judge at the rolled-up attribute (Profound Topic or Tag). Query Fanout generates variants; hand-written variants follow the same logic. **PSUC** (Scherck): Persona, Segment, Use Case; a vendor present for a generic prompt may vanish once industry, size, geography or integration constraints are added.

**One-word label test** [DOC/DEMO]. OGM asked one question with four category labels (GEO / AI search optimization / AI visibility / answer engine optimization tools), 8 platforms, 14 days: visibility swings of 25-50 points (Profound 25, another tool 34); on one prompt and day Profound ranged from 7% (Perplexity) to 100% (AI Mode). Caveats: figure F3-02 shows 7-50 (Semrush 7, Surfer 50); OGM is the co-author's agency; one label is the ambiguous acronym "GEO" the chapter itself warns about, so part of the swing may be category ambiguity [INFERRED]; SparkToro/Gumshoe found very different human prompts still yielded a fairly stable top set (top four in 55-77% of 994 answers) [3P].

**Six types, each with a success criterion** [DOC]. A prompt whose output mismatches its type "is acting as" another type and yields unusable data (figure F3-03).

| Type | Question | Must produce | Failure → fix | Example (paraphrased) |
|---|---|---|---|---|
| Discovery | Recommended when exploring? | A list of brands | Tips → add a trigger word (software, tool, platform, provider, solution) | "best 3PL providers for a retail D2C business" ✓; "how do I improve my email marketing" ✗ |
| Competitor | Who wins a named head-to-head? | A firm pick | "Compare X and Y" hedges → specific use case + two brands + explicit ask to recommend | "email platform with the best AI features: ActiveCampaign or HubSpot?" |
| Validation | Does AI know we do X? | Yes or no | List → direct yes/no about the named brand | "Does Profound offer prompt volume tracking?" |
| Accuracy | Are specs, prices, integrations right? | Diff vs source of truth | — | A phone sold in five colors; AI lists three, one wrong |
| Sentiment | How are we evaluated? | Evaluation, pros and cons | Brand list → ask for an evaluation | "Evaluate Profound as an AEO tool, pros and cons" |
| Market perception | How is the category framed? | Table stakes vs differentiators; criteria | — | "What is a DAM platform and how should I evaluate one?" |

- **Discovery** [DOC]: run each new prompt and confirm brand names come back.
- **Competitor** [DOC]: you can win every Discovery list and lose every head-to-head; the prompt asks the endpoint of a winding conversation directly.
- **Validation routing** [DOC]: in Discovery → goal state; in Validation only → trust gap, fix off-page; in neither → comprehension gap, fix on-page. Verifier: Ch 5 calls this *emphasis* while Ch 3-4 state it absolutely; figure F3-09 adds a "rare and unstable" quadrant (Discovery yes, Validation no) that contradicts the text; LLM yes/no answers show model-dependent bias (Braun 2025: a "no" tilt on agree/disagree items) [3P]; and since brand-named prompts over-draw owned pages, a "yes" may only prove an owned page is retrievable [INFERRED].
- **Accuracy** [DOC]: supply the truth; answers are checked against it (FactCheck). **Sentiment**: tagging by attribute avoids one blended score (an optional tip, not part of the criterion, per verifier). **Market perception**: you can be visible yet lose because the buying framework favors rivals' strengths.

**Writing prompts that work** [DOC].
1. *Intent alignment*: run the prompt and read answers before committing (about five minutes catches most problems).
2. *No leading prompts*: naming the hoped-for answer makes the data worthless.
3. *Cut vague terms*: acronyms (GEO: generative engine optimization vs GIS vs geothermal) and polysemous categories (CRO, "attribution platforms", "content management platform") yield "Frankenstein" answers; spell it out once. Tracking has no follow-up turn: the first parse is the data.
4. *Match response format to type*: tips (missing trigger word), "it depends" (missing use case), list for a yes/no (not direct), brand list for Sentiment (acting as Discovery).
5. Contributor templates (DiNardi): category, ICP/use-case, pain/problem, comparison "[brand] vs [competitor] for [use case]", brand perception ("what is [brand] best known for").

**How many; branded vs unbranded** [DOC/DEMO]. No count per attribute. A manual start of about twenty prompts for two weeks is endorsed. Screenshots: 154-262 prompts per topic; 26 in one client tag; 7 in one tag with per-prompt visibility about 49-83%. No explicit branded rule: Discovery and Market perception are unbranded by design, the other four branded. Profound 101's setup lesson says to keep brand names out of tracked prompts because they skew visibility [DOC].

#### 3.2.4 Chapter 4: the first audit

- **Purpose** [DOC]. One prompt, one platform, one moment is a data point; the audit passes over every attribute and engine. Outputs: Opportunities (low rank, low score or absent where you should appear), Objections (recurring negatives), Strengths (the intro promises two and lists three).
- **Step 1** [DOC]. *Visibility score*: share of Discovery responses naming you. *Visibility rank*: standing among all brands. Pull the top 20 brands (Air found ClickUp and Asana, non-DAM tools, implying adjacent attributes). Rank/score table: high/high settled; high rank + low score inconsistent; lower rank + high score leaders own it; models agreeing = consensus. Caveat: "high rank, low score" is read as first-when-present, which is in-answer position, a different and less stable measure [INFERRED/3P].
- **Step 2** [DOC]. Rank and score per attribute and platform, weighted by P1-P3; every attribute gets a strengths and a weaknesses column.
- **Step 3, label variance** [DOC/DEMO]. Read visibility across every label buyers use; each collapse is a target. MyCase P1 "legal practice management software" <70% → 85% by April after one page refresh; ActiveCampaign's Channels cluster #4 / 44% (Dec) → #1 (Apr) → 63.5% (May) after 7 new and 12+ updated pages, 26 prompts. Verifier: uncontrolled vendor anecdotes; the MyCase chart has no date axis; figure F4-05 reads 43.2%; causal captions are CLAIM.
- **Citations scoped to Discovery** [DOC]: brand-named prompts over-draw the brand's own pages. Air: no domain above 4% share. Chasiotis: tracking only "best X" ignores informational prompts where perception forms.
- **Opportunities and objections** [DOC]: absence on P1/P2 = Opportunity; P3 gap = data point (figure F4-07). Objections: broad or specific, aligned positives, trend.
- **Competitor head-to-head** [DOC/DEMO]: per rival, by platform (split = specific gap) and by aspect. A Profound agent found 58 wins of 100 (rival 20) and 74.4% of 78 decisive answers; the decisive number is the one to watch.
- **Market perception** [DOC]: no brands; compare AI's criteria with your ideal state. **Platforms** [DOC/CLAIM]: agreement is a confidence check, not a target (verifier: figure F4-13 shows one prompt swinging 33-100% day to day).

#### 3.2.5 Verifier caveats that matter for prompt work

Beyond those noted inline: the guide defines no prompts-per-attribute count, no test for "settled", no cadence, no multi-turn method and nothing for local businesses; and our three sections are close analogues of three of its six types, not matches.

### 3.3 Other vendors' prompt methodologies

#### 3.3.1 Comparison

| Vendor | Unit and grouping | Generation | Typing / personas / regions | Branded handling | Demand source | Counts | Refresh | Sampling |
|---|---|---|---|---|---|---|---|---|
| **Profound** | Prompts in Topics in Categories; Tags across [DOC] | Attribute → prompts; Query Fanout variants [DOC] | `prompt_type`; Platform × Region × Persona × Tag; personas appended as text (L07) [DOC] | Keep brands out of tracked prompts; citations from Discovery only [DOC] | Prompt Volumes (licensed opt-in panel, modeled; 35 countries incl. India, UAE unconfirmed) [DOC/CLAIM] | 10-25 coverage topics; 2-5 depth topics; "3-5" and "10-25" per topic, unreconciled (L06, outdated) [DOC]; demo 195 prompts / 15 topics [DEMO] | Tag before shipping; config edits rewrite past numbers (rewording does not) [DOC] | Once daily suffices for large sets; 10/day cut visibility SD 11%, citation-share SD 40% [CLAIM] |
| **Peec** | One topic per prompt (folder; "No Topic" otherwise), any number of tags with AND/OR filters [DOC]; start with 3-5 topics [DOC] | Brand Profile → topics reviewed before prompts → suggestions; Prompt discovery in four steps (profile, markets, topics, distribution) [DOC]; manual, CSV (≤200 characters a prompt) [DOC]; onboarding capture: crawl → ≤10 topics → ~8 prompts each, 40 of 50 picked, review steps [DEMO, 2026-09-05] | Automatic intent (informational / commercial / transactional) and branding, one value each, reclassifiable; persona per prompt; country per prompt (ISO alpha-2, the location it runs from); prompts generated per market (location + language) [DOC]; weighted personas summing to 100% [DEMO] | "Branded" = names your brand **or a competitor**; Prompt discovery default 20% branded; shopping guide 15-20%; filter Non-branded at any time, "no need to create a separate project" [DOC] (an earlier source suggested brand comparisons in a separate project [CLAIM]) | Prompt Volume 1-5, industry-relative, from web search trends and keyword weighting [DOC]; GSC queries → questions [CLAIM] | Shopping coverage = categories (3-5) × buyer contexts (2-4) × intent stages (2-3) [DOC]; 10-20 awareness + 20-30 consideration [CLAIM] | Active, Archived (keeps history), Deleted (erases history); brand-setting edits reprocess past chats [DOC]; 30 days, then refine; freeze for comparisons [CLAIM] | Active prompts run once a day [DOC]; prompts before runs: 50×1/day ±6.1 pp/month vs 10×5/day ±13.2 [CLAIM] |
| **AthenaHQ** | Topics with countries, tags, personas, schedules [DOC] | "Discover" from site, GSC, Reddit/YouTube, competitor keywords [DOC] | TOFU/MOFU/BOFU; 4 intents; head/mid/long tail [DOC] | ~10 starter prompts tagged Branded/Non-Branded [DOC, Sep, not re-checked] | QVEM volume and CPC "value" [DOC] | Customers: 500+ (Cozy Earth); tens of thousands (SoFi) [CLAIM/DEMO] | Per-prompt schedules [DOC] | — |
| **Scrunch** | Topics × questions [DOC] | Auto, geo-localized [DEMO, Sep]; reusable templates [CLAIM] | Personas (Core: 1 persona, 1 language) [CLAIM]; country routing + city in text [DOC] | Mix across journey stages [DOC, Sep, not re-checked] | Trends / volume estimator [CLAIM] | "topics × 5-8 questions" [DOC, Sep, not re-checked] | Prune prompts adding no unique cited URLs (Coverage % / Resilience %, ≥2 weeks) [DOC] | — |
| **OtterlyAI** | Fixed country per prompt; tags; text immutable [DOC] | Prompt Research; fan-out tool [DOC] | Funnel; intent [DOC] | Warns if *any* branded prompt [DOC] | Intent Volume 1-5 from Google volume [DOC] | ≥15 prompts per country; ≤10% top-of-funnel; recs need ≥15 prompts, ≥3 rivals, ≥3 runs [DOC] | — | 10 → 100 prompts cut coverage variation ~73% [CLAIM] |
| **Rankscale** | Intent × depth [DOC] | "Semantic reconstruction" [CLAIM] | Transactional / consideration / informational × niche / category [DOC] | Branded "Good" at ≥95% detection [DOC] | Reconstructed volume, "density" [CLAIM] | Floor/Standard/Elite benchmarks [DOC] | Order of attack: branded first, then intent × depth [DOC] | 8 signals over 7 runs [DOC] |
| **Semrush / Ahrefs / Writesonic** | Topic and prompt databases [DOC] | Ahrefs: People Also Ask + keyword DB + fan-out [DOC, Sep] | — | — | Semrush AI Volume; Ahrefs Google volume × platform ratio (ChatGPT 0.115, Gemini 0.011, Perplexity 0.01, AIO 0.20); Writesonic "ChatGPT volume" [DOC] | Semrush 10, up to 25 per product [DOC, Sep, not re-checked] | — | — |
| **Velova** (our capture) | 3 buckets, topic chip [DEMO, 2026-09-05/06] | Editable prompt context → personas → 94-prompt pool [DEMO] | Personas with funnel stage and vocabulary; city level; GSC seed [DEMO] | Branded answers **pooled** into one base [DEMO] | None [DEMO] | "Start with 15-30"; Starter cap 30 [DEMO] | Regenerate [DEMO] | 10 Discovery × 2 engines [DEMO] |
| **Local tools, Trakkr** | Synup: same 16 prompts monthly; BrightLocal: 10 suggested, 9 grid points each [DOC] | — | — | BrightLocal teaches branded and "dual branded" audits [DEMO] | — | — | Trakkr freezes each action's measure, window and bar [DOC] | Synup drops location-only answers; ziptie needs 2 consecutive absences [DOC/CLAIM] |

#### 3.3.2 Peec's prompt-setup documentation (fetched 2026-11-10)

All [DOC] unless marked; undated pages; paraphrased.

- **Prompts, not keywords.** Prompts are longer and conversational, and they carry context and constraints ("What CRM would work best for a sales team of 10 people?" rather than "Best CRM software"). The model reads the *intent* (recommendation, instructions, comparison), the *context* (audience such as "for beginners", use case such as "for remote teams", constraints such as "under $100" or "with less than 50 employees") and answers both.
- **Phrasing.** Same buying need, different wording → similar recommendations; different buying need → different recommendations. Peec concludes that exact phrasing matters little over time and that you do not need multiple variations of the same question; focus on the right intent and context. Its shopping guide qualifies this: for the most important prompts a few variations can give a steadier view, because individual prompts fluctuate day to day.
- **Informational prompts need brand context.** "How do I…" prompts rarely name brands unless the prompt asks which tools or platforms to use; the same fix as Profound's trigger word.
- **Intent types (automatic).** Every prompt gets one of three: *Informational* (learn or get instructions; few brand mentions), *Commercial* (comparing options before a decision; these reliably surface brands and are the core of most tracking) and *Transactional* (ready to act, often naming a product or price, e.g. "HubSpot pricing for a 10-person team"). Intent filters Visibility and Share of Voice and drives the intent mix in Prompt discovery.
- **Branding (automatic).** *Branded* means the prompt mentions your brand or a competitor; *Non-branded* is generic. Every prompt has exactly one value for branding and one for intent; the operator can reclassify either per prompt. Tip: filtering non-branded and commercial prompts shows where visibility can grow without brand searches.
- **Topics and tags.** Each prompt belongs to exactly one topic (a folder; topic-less prompts sit under "No Topic"); tags are many per prompt, filterable with AND/OR, exportable, and handle overlapping attributes ("enterprise" and "decision-stage"). Create topics first: they produce more targeted suggestions and let you read visibility at topic level. Start with 3 to 5 broad areas, then expand with manual prompts.
- **Four ways to add prompts.** Manual (one per line; Location = the country the prompt runs from; topic; tags); bulk CSV (prompt text ≤200 characters, ISO 3166-1 alpha-2 location with the project default when blank, a topic, tags in later columns); suggestions from the website, industry context and existing topics; Prompt discovery.
- **Prompt discovery.** Four steps: *Profile* (what you sell, who buys it, buyer personas, up to 200 characters of extra context); *Markets* (locations and languages; prompts are generated per market); *Topics* (reviewed, renamed or deleted before any prompt is generated); *Distribution* (branded vs unbranded share and intent mix, each summing to 100%; defaults 20% branded and 25/50/25 informational/commercial/transactional, said to suit most brands). Results regroup by branding, intent, persona, market or language to check coverage from another angle; accept or reject one by one, or "Activate all" per group; accepted prompts count toward the plan limit.
- **Coverage overview.** Compares accepted prompts with the requested distribution for each topic, country and persona: *On target*, *Not started* or *Empty*; "Generate more prompts" fills a gap from the overview.
- **Prompt Volume.** A relative demand score from 1 to 5, built from web search trends and keyword weighting and scaled to the business's own keyword landscape, not a global average. Ordinal and modeled.
- **Lifecycle and limits.** Active prompts run once a day and count toward the plan; Archived prompts stop running but keep their chats and sources in analytics; Deleted prompts erase all history; Suggested prompts do not count until accepted. Country limits apply per project.
- **Prompt-table columns beyond the main metrics** (Visibility, Share of Voice, Position, Win rate, Sentiment): Shopping (% of chats with a shopping carousel), Product comparison, Images, Ads (% of chats that triggered an ad), Persona, Fact-checking (whether claims from the prompt are checked against your facts), Links (share of chats whose answer links to a page in its own text), Map (% of chats showing a map), Web Search (% of chats that triggered a web search). These do not depend on the brand being named.
- **Competitors.** A benchmark that gives a figure context (15% means more beside a rival's 45%). Suggested brands: names mentioned alongside yours at least twice, shown with mention counts, with Track or Reject. Manual setup: a display name (not used for counting); a *tracked name*, the shortest unique form people and AI models use ("BMW", not "BMW Deutschland"; case-insensitive); aliases found by reviewing recent chats; a case-sensitive regular expression for dictionary words ("Apple", "Orange") or "US" vs "us"; domains (with alternates and subdomains) that classify sources as You or Competitor; social platforms (YouTube, Reddit, LinkedIn, TikTok, Medium, Instagram, Facebook, Quora). Saving reprocesses existing chats with the new settings.
- **Shopping prompts** (brands selling their own products; multi-brand retailers and marketplaces need another approach). *Category prompts* ("best running shoes for beginners") measure every matched product in the category; *product prompts* ("Is the Nike Pegasus good for flat feet?") go deeper on one. Most of the set is non-branded discovery; branded prompts about 15-20%, e.g. "best alternatives to [your brand]" and one or two comparisons with top rivals phrased as a real buying decision ("I'm training for my first marathon, should I choose [your product] or [competitor product]?"), which often yield side-by-side attribute tables. Product prompts: about three per product for catalogs up to about 100 products; prioritize hero products; group long-tail products under one tag. Three dimensions: *category* (top 3-5 to start, 10-30 for large catalogs; one topic per category, or product lines when the catalog is one category), *buyer context* (2-4 per category: the constraint that changes the answer, such as "for flat feet" or "under €120"), *intent stage* (2-3 per buyer context; mostly commercial and transactional); coverage = categories × buyer contexts × intent stages. Three rules: distinct buying situations beat rewordings; name something shoppable in every prompt; prefer commercial intent. Shopping results appear more for physical products than for services.
- **Brand Profile.** Collected when a domain is connected: company name; description (used in every prompt Peec generates, so it must be specific); industry; brand identity adjectives; products and services; personas; target market; audience distribution across user types. Reviewed before Topics during onboarding and editable later (saving refreshes topic and prompt suggestions); also the base for Brand Perception and Prompt discovery.

**What Peec's docs change for Project Sun** [INFERRED]:
1. They confirm three of our principles: branded and unbranded read apart (principle 4); the place belongs in the prompt text while the run location is a separate country setting (principle 9); demand data is ordinal and modeled (principle 11).
2. **Phrasing tension.** "Exact phrasing doesn't matter much" seems to conflict with Profound's one-word label test (25-50 point swings) and our place-wording data (Atelier 10: 9 of 10 DIFC-worded vs 3 of 14 city-wide). Read closely, Peec's claim covers rewording *within the same intent and context*; a category label, a place or a constraint is context, which Peec itself says changes recommendations. So: category labels and places get the ambiguity lint and explicit levels (PR-06, PR-07); rewordings of the same need feed stability reads only (PR-12), never the headline; distinct buying situations get the slots (PR-03, PR-09).
3. **Mutable history.** Peec reprocesses past chats when brand settings change and erases history when a prompt is deleted; Profound's configuration edits also rewrite past numbers. Project Sun's append-only analyses, snapshots, lineage and the evidenced ownership overlay (DQ-01) are deliberately stricter; retired prompts keep their reason (PR-17).
4. **Ownership and aliases are operator-entered in Peec, without evidence.** DQ-01 requires corroboration; DQ-07 adopts Peec's habit of reading recent answers for the forms models actually use; the shortest-unique tracked name matches our `name-forms.ts` rule.
5. **Suggested competitors at two co-mentions** match MS-12's threshold of two Discovery answers.
6. Peec's Brand Profile has no "why we win" or "not for"; PR-01's source remains Profound Chapter 2.
7. Peec treats personas as a generation and grouping dimension; we keep persona out of the headline (PR-14) because signed-out collection carries no persona except in text.
8. **Branded share and intent mix** of our set by Peec's definitions: section 3.5.5.
9. Peec's Ads %, Map %, Links % and Web Search % columns are payload facts; Project Sun already stores the inputs for ads, map results and inline links (section 4.6) but not an honest search state (DQ-10, MS-11, DQ-08, DQ-12).
10. Peec's "Fact-checking" column supports Accuracy probes (PR-13); its recommended branded prompt "best alternatives to [your brand]" is the independent plan's B4 stratum.

#### 3.3.3 Notable rules each teaches

- **Profound 101 setup lessons (all marked outdated)** [DOC]. L06: one topic when competitors, criteria and content strategy coincide; prompts = category base + qualifiers (ICP, criterion, constraint, comparison), with commercial intent. L07: volume needs 1-2-word head terms; no sufficiency threshold. L08: personas are test harnesses; add only details that change interpretation. L09: ChatGPT runs about 2 fan-out queries per execution; prioritize high-share variations; the year gets injected; fan-outs differ by persona. L10/L11: tag by intent (informational prompts drag commercial scores); tag experiments before shipping. Demos: a topic average hid one prompt falling 26%; auto-generated "evaluate [brand] on [topic]" prompts skew citation analysis [DEMO].
- **Peec documentation** [DOC]: section 3.3.2 (distribution defaults 20% branded and 25/50/25 intents; coverage overview against a declared distribution; one topic and one value per classification; shopping coverage formula; suggested competitors at two co-mentions; archive keeps history, delete erases it).
- **Peec, "The key to prompt tracking" (2026-09-29)** [CLAIM, method published]: tag branded and non-branded separately; don't read single prompts; judge the portfolio over time (monthly); add prompts before runs; freeze the set. Per-run variance 0.0225 branded vs 0.0675 non-branded; 40% of non-branded prompts are "contested" (10-90%) vs 10% branded; 50 prompts once a day detect 12.4 / 4.7 / 2.3 pp daily / weekly / monthly. Verifier: a variance-components model with an assumed shared daily shock ρ = 0.015.
- **Peec, "How to choose the right prompts" (2026-01-22)** [CLAIM]: stages awareness, consideration, brand evaluation (tracked separately: Tesla 100% in "Tesla vs Rivian" vs ~60% on evaluation prompts), purchase (retail/DTC only); sources GSC, sales calls, Reddit, site navigation and pricing tiers; local templates "best [category] in [city]", "near [neighborhood]"; run core prompts per region (Revolut 60% UK vs 40% US); rejects "top 50 by volume".
- **Peec, other** [DOC/DEMO/CLAIM]: an A-F grader for topic balance, tag hygiene, funnel coverage, branded split, duplicates; a bias auditor for prompts worded in the brand's favor (2026-10-13); Market and Objections run on a separate researched prompt set (V9 00:12:03-00:12:26); a fact that "Never comes up" signals missing prompt coverage; 78% of non-English ChatGPT sessions include English fan-outs and 43% of fan-outs are English, Arabic and Hindi unstudied (B21). Our capture of 48 prompts in 6 topics was almost all "find/recommend/list providers": count is not intent coverage [DEMO].
- **AthenaHQ** [DOC/DEMO]: each suggestion explains why it was suggested with evidence counts; keyword gaps show demand, not citation; mine recorded calls for prompts (S41 00:07:21); SoFi buckets narrow intents (S40 00:17:24).
- **Scrunch** [DOC/CLAIM]: prune by marginal cited-URL coverage. Location study (US, with partner Stacker): 96% of "near me" recommendations were in the user's state; two cities shared 2% of names vs 12% for the same city asked twice; restaurants, hotels and home services 89-100% city-unique; put the place in the text. Verifier: its own tests did localize when location was set.
- **Velova** [DEMO]: good: big pool plus curation helpers, personas with funnel stage and vocabulary, customer-voice pain points. Bad: 41 brand mentions (Gemini 20 + GPT 21) form the trust base while 1 of 20 Discovery runs named the brand, so visibility reads 5% on one panel and 66.7% / 70% on another; HIGH priority from 2 runs; "Position 1" for a brand listed fifth.
- **Variance evidence** [3P]: IAB (2026-08-03): one response is not a measurement; decision-grade needs stable per-query distributions, ≥weekly cadence, documented within-7-day variation and confidence levels; <50 queries is exploratory; position and sentiment need more reproducibility. SparkToro × Gumshoe (SEJ, 2026-01-30; Gumshoe sells tracking): same list in <1% of repeats, same order <0.1% (2,961 runs); share steadier than position. Martinez: 3-5 paraphrases per information need. Schulte et al.: ≥7 runs per prompt per day as a directional floor. Kumar (vendor): sentiment flips 6.7× more than mention. Grossman et al.: small rewordings shift AI Overview sources.
- **Fan-out** [CLAIM/3P]: ChatGPT fan-outs share ~13% of the prompt's words (Perplexity 88%); location is most preserved; the year is often added (Profound B8). ChatGPT searches the user's exact query in only 0-5.5% of runs and adds an unnamed brand to 28% of queries (third-party studies in our evidence file).

### 3.4 Cross-cutting principles for a measurement prompt set

All [INFERRED] unless a source is named.

1. **Type before wording**: each prompt has a job and an expected output, checked against real answers (Profound Ch 3).
2. **Identity and priority before prompts**: prompts derive from an explicit attribute list with priorities (Profound Ch 2; Peec, Athena, Velova start from a profile).
3. **Portfolios over single prompts**: several prompts per priority attribute, read in aggregate (Profound; Peec rules 2-3; IAB).
4. **Never pool branded and unbranded answers** (Peec rule 1 and its automatic branding classification; Velova; Profound's citation scoping; Otterly). We already do this for visibility.
5. **Freeze and version the instrument; compare like with like** (Peec rule 5; our frozen hash; Profound's and Peec's reprocessed history as counter-examples).
6. **Prompts buy precision, repeats buy change detection** (Peec B25 and our reconciliation of vendor claims).
7. **Neutrality is structural**: keep the brand and its distinctive claims out of unbranded prompts by construction, and audit after the run (independent plan; Peec auditor).
8. **Disambiguate up front**: no follow-up turn exists (Profound Ch 3; our emirate fan-outs).
9. **Place is part of the question**, at the level the business competes; observer location is a separate recorded variable (Scrunch; Peec's per-prompt run country; our DIFC data).
10. **Realism is not neutrality**: natural prompts can still be leading, too narrow or self-flattering.
11. **Demand data is ordinal at best**: all vendor volumes are modeled (Peec's 1-5 score is relative to the business's own keyword landscape).
12. **Diagnostics live outside the headline**: validation, accuracy and framing probes must not change the frozen set or its denominators.
13. **Declare the distribution, then check coverage against it** (Peec Prompt discovery and coverage overview [DOC]; Peec grader [DOC/DEMO]): the set states its intended mix (sections, topics and priorities, place levels, intents, branded share) and review shows each part as on target, not started or empty. Unmet targets are stated, never padded.
14. **Every prompt carries exactly one value per classification, machine-assigned and operator-correctable** (Peec's automatic branding and intent [DOC]): facets are set at creation, frozen at approval, never blank and never free text.
15. **Distinct buying situations before rewordings** (Peec shopping rules [DOC]; Profound portfolios [DOC]): a new need, constraint or place earns a slot; a rewording of the same need earns only a stability read.

### 3.5 Project Sun's prompt system today

#### 3.5.1 How generation works (code read 2026-11-10)

- **Inputs and snapshot.** `POST /api/projects/[id]/prompts/generate` (202) runs `generatePromptSet` (`src/lib/prompts/orchestrator.ts`) on the latest frozen competitive set and its pinned confirmed profile. A hashed context snapshot (`prompt-context@2`) freezes leveled places from `promptGeographyFromProfile`.
- **Paths.** A deterministic floor (`frame-planner.ts` → `realizer.ts`) always runs. With a model route (paid OpenAI approved for Prompts, 2026-09-13), an intent model (`intent-model@5`, gpt-5.6-luna) proposes 6-9 site-grounded needs bound to topics, plus concerns and decision factors; writers (gpt-5.6-terra first) draft Discovery (`discovery.ts`, `discovery@3`), Trade Offs and Sentiment (`intent-generation.ts`).
- **Discovery slots.** `planDiscoverySlots` fixes per need a shape (bare / context / situation-first on alternate needs), two styles (search, question, request, story), a place on due slots and money on at most two (a segment word such as "luxury", never a price, for premium place-bound businesses). Two versions per slot, written in a register measured on 1,265 LMArena Search Arena prompts (median 13 words, 9 for local; 42% lowercase; 57% without closing punctuation; "best" in 37-40%; places trail the ask; identity statements 3-10%) [DOC, code comment].
- **Gates and judges.** `validateCandidate` (brand policy, leakage lexicon incl. short name forms, confirmed context, `geography_stacked` / `geography_too_broad`, regulated safety) and `validateNaturalQuery` (`TOO_GENERIC_FOR_DISCOVERY` rejects how-to, criteria and explanatory asks). A Discovery judge (yes/no checks with a giveaway quote: asks for options, real category, offered there, several could answer, not the site's own claim, not assembled, reads real, not pointing at one business) scores failures 30, below the 55 floor; `section-judge.ts` judges Trade Offs and Sentiment.
- **Select.** Per-section dedupe (≥0.72 within a context key), a 100-point score, a greedy selector with caps (`SECTION_KEY_CAPS`); oversupply 32 / 26 / 26 candidates.
- **Sections.** Exactly 30 (`prompt-selection@5-10-10-10`): 10 Discovery (target and rivals forbidden), 10 Trade Offs (target + one frozen non-marketplace rival + criterion; ≤5 rivals), 10 Sentiment Analysis (target + concern theme; no rival). Coverage "cells" are vestigial.
- **Review and freeze.** Edit, select, deselect, reject, replace, regenerate, add custom; every write path re-validates; approval re-validates against the snapshot and records `frozenHash`. Collection requires the latest set to be approved.
- **Metadata** (`prompt_candidates`): the spec's dimensions as columns, plus `contextBasis` keys (discovery@3: `shape`, `style`, `placeLevel`, `placeRole`, `budget`), scores and reasons.

#### 3.5.2 Strengths to preserve

- Neutral Discovery by construction, stricter than most vendors: target, aliases, domains, branded offerings, short name forms and rivals forbidden; site claims off-limits to writer and judge [PROVEN].
- Realism calibrated on real prompts and enforced in code.
- Over-generate → gate → judge → select, with every rejection reason stored (the spec's core principle).
- Frozen, hashed, immutable sets; denominators pinned to the set's competitive set.
- Visibility already Discovery-only (`measure/policy.ts`); "No business named" (`answer_brand_free_rate`) already detects Discovery answers that gave advice instead of options.
- Trade Off verdict classes support the guide's decisive-only win rate.
- Geography is frozen and leveled, with incident-driven market-area rules.

#### 3.5.3 Documented weaknesses

`docs/KNOWN_ISSUES.md`, Prompts [PROVEN]: gate holes (a model-written Sentiment prompt naming a rival, a Trade Off naming two rivals, a Discovery prompt naming an unconfirmed brand); target nicknames can leak (short forms not in the target lexicon); raw-substring matching ("ace hardware" in "grace hardware"); uneven rival pools select fewer than 10 Trade Offs; review routes trust input (PATCH skips the natural gate until approval; API can resurrect rejected rows or add an 11th prompt; no unique (projectId, version) index); stale set after Landscape re-confirm; stranded `generating` sets; retries re-run everything; keyless regenerate fails; a dead `evaluate_criteria` renderer; English only; the live model path is untested.

From the Measure audit and stored answers:
- **Sample size** [PROVEN]: 10 Discovery answers per run (2 of 10 → plausible 6-51%); identical runs 63 and 14 minutes apart flipped 3 and 1 of 10, with named-business overlap 0.38-0.46. `MEASURE_AUDIT.md` recommends 20-30 Discovery questions, then 3 re-asks to calibrate "within range".
- **Wording decides place scope** [PROVEN counts; cause HYPOTHESIS]: across three projects Atelier 10 (one DIFC storefront) was named in 9 of 10 DIFC-worded questions (plausible 60-98%), 3 of 14 city-wide (8-48%) and 0 of 6 elsewhere. September's DIFC-heavier wording gave 6-7 of 10; October's 2 of 10; lash and brow 2 of 2 (DIFC wording) vs 0 of 5 (city-wide or Business Bay). The "drop" is mostly an instrument change.
- **Place confusion in ChatGPT's searches** [PROVEN, September payloads]: city-less by-name and head-to-head questions were searched with other emirates (one Studio14 run: 7 queries naming Abu Dhabi; another: 3 Sharjah, 1 Abu Dhabi, 1 Ras Al Khaimah); one search added a wrong category ("Studio14 salon UAE" for a Pilates studio). Our writers add the area to only about a third of local Trade Off and Sentiment prompts. Search queries were stored in 359 of 393 September answers and none in October.
- **Clarifying questions** [PROVEN]: 9 of 26 cloro answers carried a follow-up form (AED budget bands, area, style).
- **Name noise** [PROVEN]: "Fade", "Trade Centre", "Offers Russian" read as businesses; Postman vs "RBAC" read as a head-to-head win. Analysis defects, but ambiguous prompt terms invite them.
- **Thin metadata** [PROVEN; read-only DB 2026-11-10; 35 approved sets, 1,050 prompts, mixed versions]: all 350 Discovery prompts have journey stage "awareness"; persona is set on 95 of 350 Discovery prompts, mostly template labels; topic on 331 of 350 Discovery but 174 of 350 Sentiment; Measure ignores criterion and theme. The newest approved set (a Dubai salon) still includes a template prompt with an audience label ("…for dubai residents seeking premium beauty care") and model prompts spelling out "Dubai International Financial Centre" rather than "DIFC".
- **Review UX** [PROVEN, `prompts/page.tsx`]: "Why this prompt is here" joins raw `contextBasis` keys, including model ids.
- **Search Console** [PROVEN]: feeds Understand only; 51 crawls had no data (34 not connected, 16 no matching property).

#### 3.5.4 Mapping Profound's six types onto our three sections

| Profound type | Project Sun | Fit | Differences [INFERRED] |
|---|---|---|---|
| Discovery | Discovery | Close | Ours forbids rivals and the site's own claims, which Profound's capability-conditioned examples would include; both reject how-to/criteria asks; visibility Discovery-only in both |
| Competitor | Trade Offs | Close analogue, not identical | Profound needs use case + explicit ask and calls "compare X and Y" too soft; our writer accepts short "Brand vs Rival for need" and handles hedges afterwards via verdict classes and decisive-only win rate (verifier claim 15) |
| Sentiment | Sentiment Analysis | Close analogue | Profound asks for pros and cons, optionally per attribute; ours names the target with one concern theme, stored but not reported |
| Validation | None | Missing | Our Sentiment writer explicitly forbids turning a feature into a question, i.e. the Validation form; the independent plan's "Volunteer Gap" was never built |
| Accuracy | None | Missing | The spec's `branded_accuracy` cohort (5 of 30) was dropped in the 10/10/10 decision; the cohort enum survives; the confirmed profile is a ready source of truth |
| Market perception | None | Missing | Rightly blocked from the headline by `TOO_GENERIC_FOR_DISCOVERY`; no other home exists |

#### 3.5.5 Our set through Peec's classifications [INFERRED]

- **Branded share.** By Peec's rule (a prompt naming your brand or a competitor is branded), 20 of our 30 prompts are branded: all 10 Trade Offs and all 10 Sentiment prompts, 67% of the set, against Peec's Prompt-discovery default of 20% and its shopping guidance of 15-20%. Our headline metrics already read Discovery only, so this is not contamination of visibility; it is an allocation of each run's answers. Two thirds of every run go to by-name questions, whose per-run variance Peec puts at about a third of non-branded prompts (0.0225 vs 0.0675 [CLAIM]), while the 10 Discovery answers carry every presence metric. Under PR-04's options the branded share would be 67% (A, 10/10/10), 33% (B, 20/5/5), 50% (C, 20/10/10) and 40% (D, 30/10/10). This supports the lean toward more Discovery (D1) without implying Peec's 20% suits a by-name diagnostic design like ours.
- **Intent mix.** Our Discovery prompts are almost all commercial ("recommend options"); `TOO_GENERIC_FOR_DISCOVERY` rejects informational asks, consistent with Peec's note that informational prompts rarely name brands. No planned share asks with transactional intent (book, visit, price, where to buy), which the spec's archetype table emphasized for local services, restaurants and dealerships ("strong visit/contact/purchase intent") and the independent plan's N6 stratum covered. Peec's default mix is 25/50/25. For our instrument, informational asks belong with Market perception probes (PR-13), not the headline; a declared purchase or visit share inside Discovery for place-bound kinds is open (D9).
- **Topic count.** Peec starts with 3-5 topics; ours are 4-6. Consistent.
- **Coverage shape.** Peec's shopping formula (categories × buyer contexts × intent stages) gives 3 × 2 × 2 = 12 prompts at its smallest starting shape and 5 × 4 × 3 = 60 at its largest. Our 10 Discovery prompts over 4-6 topics give about two per topic, below Peec's smallest non-branded shape; PR-03's minimums (≥3 Discovery prompts per P1 topic across ≥2 shapes) and PR-04's count address this.
- **Run location.** Peec's location is a per-prompt country (ISO alpha-2) and city or district lives only in the text, as in Project Sun (`observer_region` per answer; place in the prompt). Consistent with principle 9.

#### 3.5.6 What the design spec intended vs what exists

| Spec (Phase 2 Final Specification v2, "Prompt Intelligence": "Bad prompts invalidate the entire measurement") | Today |
|---|---|
| Coverage policy first; 80-120 candidates against required cells; constrained selection of exactly 30 | Over-generation and selection exist; cells vestigial; selection by needs, slots, places, caps |
| Spine 21 neutral / 5 branded accuracy / 4 comparison; adaptive weights by archetype | 10/10/10 by operator decision; no accuracy cohort |
| Dimensions incl. persona "only when it materially changes the answer" and evidence basis | Columns exist; journey and persona carry little; evidence not shown |
| Gates incl. non-leading and reproducibility (no relative dates; no implicit "near me") | Implemented |
| Weighted quality score (pilot parameters) | Replaced by judge verdicts plus a heuristic score |
| "Why this prompt?" with topic, intent, persona, geography, evidence, selection reason | Exists with raw keys, no evidence |
| Independent plan: generation-time blinding, distinctive n-gram and positioning-similarity checks, category anchoring (≥3 rivals plausible), post-run neutrality audit, paraphrases in the sampling layer, no volume claims | Partly: forbidden names and site claims; the judge's "several could answer" approximates anchoring; no post-run audit; no paraphrase sampling |

### 3.6 Prompt refinement items (PR)

P0 now; P1 next; P2 later. "Break" = a new prompt-set version, which `measure/compare.ts` already treats as a comparability break. Version constants today: `COVERAGE_POLICY_VERSION = prompt-selection@5-10-10-10`, `PROMPT_CONTEXT_POLICY_VERSION = prompt-context@2`, `DISCOVERY_POLICY_VERSION = discovery@3`, `INTENT_MODEL_VERSION = intent-model@5`, `ANALYSIS_VERSION = observation-analysis@18`, `METRIC_POLICY_VERSION = measure-policy@4`. Each entry gives Problem, Change, Sources, Code, Dependencies, Comparability, Cost and Acceptance; "Peec docs" lines mark what Peec's documentation (fetched 2026-11-10) adds. Phases are in section 5.

| ID | Item | Priority | Break? | Phase |
|---|---|---|---|---|
| PR-01 | Attribute model driving prompts | P1 | New sets | R2 (capture may land in R1) |
| PR-02 | Full metadata on every prompt | P0 | No | R1 (derived backfill R0) |
| PR-03 | Coverage matrix and categorization | P1 | New sets | R2 |
| PR-04 | Discovery count vs the 30 constraint | P0 decision, P1 build | Yes | Decide at CP1; build R2 |
| PR-05 | Branded vs unbranded separation everywhere | P0 | Metric policy | R1 |
| PR-06 | Place wording and geography levels | P0 | New sets | Decide at CP1; lint and metadata R1; wording R2 |
| PR-07 | Ambiguity and vague-term lint | P1 | No | R1 |
| PR-08 | Post-run prompt-format audit | P0 | No | R0 (stored fields); classifier R1 |
| PR-09 | Attribute-conditioned and long-tail Discovery | P1 | New sets | R2 |
| PR-10 | Trade Offs as true Competitor prompts | P1 | New sets | Stored-data comparison R0; build R2 |
| PR-11 | Sentiment by attribute and theme | P1 | Metric policy | Measure grouping R1; generation R2 |
| PR-12 | Rewordings, prompt groups, repeat sampling | P1 (noise floor P0) | No for headline | Noise floor R0 (via MS-02); alternates R2 |
| PR-13 | Diagnostic probes outside the frozen set | P1 / P2 | No | Accuracy and Validation R2 track; others R3 |
| PR-14 | Persona handling | P2 | New sets | R2 (labels); R3 (probes) |
| PR-15 | Arabic and Hindi baselines | P2 | Separate baseline | R3 |
| PR-16 | Demand signals and limits | P2 | No | R3 |
| PR-17 | Refresh, versioning, partial comparability | P1 | Defines breaks | R1 |
| PR-18 | Golden-set evaluation of prompt quality | P0 | No | R0, then every phase |
| PR-19 | Prompts-stage QA and review UX | P1 | No | R1; matrix and test ask R2 |
| PR-20 | Close known gate holes and review defects | P0 | No | R0 (index in the R1 schema window; caps with PR-10 in R2) |

#### PR-01 Attribute model driving prompts (P1)
- **Problem.** Prompts come from model-proposed needs; no operator statement of why the business wins, what it is not for, or which topics matter. The research report's worked example had to treat every topic as P2 "not set" [PROVEN].
- **Change.** Add to the confirmed profile/landscape: category in buyer words (with variants), audience, need, why-we-win (1-3), not-for (1-3); per topic an operator priority P1/P2/P3 with the Ch 2 rationale (distance is known only after a first run). Topic = attribute group. The intent model receives these as operator-confirmed structured data (never site text in system instructions). Allocation follows priority (PR-03); "not for" items exclude Discovery and probe wording.
- **Sources.** Profound Ch 1-2, Ch 4 opportunities by priority [DOC]; Athena/Barclays demand-importance-influence [DEMO]. Peec docs: Peec's Brand Profile (name, description, industry, identity adjectives, offerings, personas, target market, audience distribution) is reviewed before topics and refreshes suggestions when edited, but has no why-we-win, not-for or priority fields [DOC]; PR-01 goes further.
- **Code.** `src/lib/profile/schema.ts`, `src/lib/understanding`, `src/lib/landscape`, `prompts/context.ts`, `intent-model.ts`, `coverage-policy.ts`, Understand and Landscape pages.
- **Dependencies.** Profile versioning; topic confirm; Measure shows priority beside topics (never inside a number); Plan 2's "Start here" rule and ordering use P1/P2 (Plan 2 section 9.3).
- **Comparability.** `prompt-context@3`, `COVERAGE_POLICY_VERSION` and `INTENT_MODEL_VERSION` bumps; new sets only.
- **Cost.** At most one small model call (prefill); no answers.
- **Acceptance.** Golden businesses: priority set in under a minute; each P1 topic meets its Discovery quota; no "not for" term in Discovery; prefilled why-we-win items cite evidence ids.

#### PR-02 Full metadata on every prompt (P0)
- **Problem.** Key facets sit in free-text `contextBasis` or unused columns; journey and persona carry no information [PROVEN]; Measure cannot slice by them.
- **Change.** One typed facet record per prompt, frozen at approval: `promptType` (discovery, head_to_head, sentiment; later validation, accuracy, market_perception), `topicId`/`attributeId`, `intent`, `funnelStage` (derived from intent and shape, not defaulted), `shape`, `placeLevel`/`placeRole`, `audienceOrSituation`, `branded` (from brand policy), `rivalId`, `criterion`, `theme`, `wordingGroupId` (PR-12), `generator`. Backfill views for existing sets from `contextBasis`, marked "derived".
- **Sources.** Peec, Athena, Otterly, Profound type prompts by intent, funnel, branded flag, tags, regions; Profound L10 on untagged mixing [DOC/DEMO]. Peec docs: every prompt gets exactly one branding value and one intent value (informational / commercial / transactional) automatically at creation, reclassifiable by the operator, used as filters on every metric [DOC]; adopt the same "one value, never blank, correctable before approval" rule for `branded` and `intent`.
- **Code.** `prompts/types.ts`, `orchestrator.ts`, `discovery.ts`, `intent-generation.ts`; a JSON column or reuse of existing columns (`src/lib/db/schema.ts` changes follow `.claude/rules/platform.md`); `measure/engine.ts`.
- **Dependencies.** Section 4 (facet splits in Measure); PR-03, PR-06, PR-09, PR-11; the schema window (D19) if a column is added.
- **Comparability.** None; new Measure splits bump `METRIC_POLICY_VERSION` only if a definition changes.
- **Cost.** None.
- **Acceptance.** 100% of new approved prompts carry every applicable facet; tests fail if a Discovery prompt lacks `shape` or (place-bound) `placeLevel`, or a Trade Off lacks `rivalId`/`criterion`.

#### PR-03 Coverage matrix and categorization (P1)
- **Problem.** Coverage is implicit in slots and caps; reviewers cannot see whether P1 topics, shapes and place levels are covered; count is not intent coverage (Peec capture) [DEMO].
- **Change.** Show a matrix per set: topics/attributes (with priority) × section × shape × place level (Discovery), × rival and criterion (Trade Offs), × theme (Sentiment). Selection minimums: each P1 topic ≥3 Discovery prompts across ≥2 shapes (one bare = authority, one context/situation = long tail); P2 1-2; P3 optional; ≥2 Trade Offs per rival for up to 5 rivals; ≥4 distinct Sentiment themes. Show intent coverage and a diversity number (1 − mean pairwise similarity), as the independent plan proposed. Unmet minimums are stated, never padded.
- **Sources.** Profound portfolios; Peec grader; independent plan §11 [DOC/INFERRED]. Peec docs: Prompt discovery declares a distribution (branded share; intent mix summing to 100%) and a coverage overview marks each topic, country and persona On target, Not started or Empty, with "Generate more" from the overview; the shopping guide sizes coverage as categories × buyer contexts (the constraint that changes the answer) × intent stages [DOC]. Adopt the declared-distribution-plus-status display (principle 13); the "buyer context" dimension maps to our context/situation shapes.
- **Code.** `coverage-policy.ts` (real targets replace vestigial cells), `selector.ts`, `orchestrator.ts`, Prompts page.
- **Dependencies.** PR-01, PR-02, PR-04; D9 (intent mix).
- **Comparability.** `COVERAGE_POLICY_VERSION` bump; new sets.
- **Cost.** None.
- **Acceptance.** Golden sets meet minimums or say which and why; a reviewer can name thin P1 topics without opening prompts.

#### PR-04 Discovery count and the 30-prompt constraint (P0 decision, P1 build)
- **Problem.** About 2 Discovery prompts per topic, one answer each; ranges of ±~30 points [PROVEN]. Precision depends on prompt count (Peec) [CLAIM]; IAB calls <50 queries exploratory [3P]. 10/10/10 is an explicit operator decision (it replaced the spec's 21/4/5), so this is the operator's call.
- **Options.** (A) 30 at 10/10/10, precision via repeats (PR-12). (B) 30 at 20/5/5: 1 Trade Off per rival and 5 Sentiment answers make those sections unreadable. (C) 40 at 20/10/10. (D) 50 at 30/10/10.
- **Lean.** (C) as measurement set v2, Discovery allocated by priority. Wilson half-width at 50% drops from about ±31 (n=10) to ±21 (n=20). Branded sections have lower per-run variance (0.0225 vs 0.0675) and need fewer prompts. If 30 is fixed, (A), with Discovery labeled directional until repeats exist.
- **Peec docs.** By Peec's definition 67% of today's set is branded, against its 20% default and 15-20% shopping guidance [DOC]; option C brings that to 50% (section 3.5.5). Peec's smallest non-branded coverage shape is 12 prompts [DOC, arithmetic INFERRED].
- **Code.** `SECTION_SELECT_COUNT`, `SECTION_CANDIDATE_TARGET` (`types.ts`), `discovery.ts`, selection caps, the literal 30 and "exactly 10" copy, `collection/orchestrator.ts`, `scripts/e2e-journey.ts` (`>= 30`), `.claude/rules/prompts.md`, `CLAUDE.md`.
- **Dependencies.** Operator decision (D1); budget (`SUN_COLLECTION_MAX_REQUESTS_PER_LANE` default 60 fits 40 answers, not 40 × 2); Measure sample-size labels; Plan 2 cards (Plan 2 section 10; Plan 2 decision 5). Same decision as MS-07.
- **Comparability.** Full break; e.g. `prompt-selection@6-20-10-10`.
- **Cost.** +10 answers per run (+33%): about $0.015 at Oxylabs' entry rate; 40 of cloro's ~70 free monthly answers per run.
- **Acceptance.** Dated decision; golden businesses fill 20 Discovery prompts within scaled caps; P1 topics get ≥3.

#### PR-05 Branded vs unbranded separation everywhere (P0)
- **Problem.** Visibility is Discovery-only, but citation metrics span all sections, where brand-named prompts over-draw owned pages [PROVEN, `policy.ts`]; Velova shows the cost of pooling [DEMO].
- **Change.** Every metric names its sections; category-shaping citation views (who shapes answers, rival-only sources) read Discovery only; owned-citation rates per section. Show "known when named" as two fractions side by side, never subtracted: favorable by-name portrayal (Sentiment) and Discovery presence for the same topic (the Volunteer Gap idea). Probes (PR-13) never enter visibility denominators.
- **Sources.** Profound Ch 4; Peec rule 1; Otterly; Rankscale [DOC/CLAIM]. Peec docs: automatic Branded/Non-branded classification on every prompt, with a "non-branded and commercial" filter recommended for reading growth opportunities [DOC].
- **Code.** `measure/policy.ts`, `engine.ts`, Sources view; `branded` facet.
- **Dependencies.** Section 4 owns the metric change (ships in the `measure-policy@5` bundle); PR-02.
- **Comparability.** `METRIC_POLICY_VERSION` bump with definitions; recomputable from stored analyses.
- **Cost.** None.
- **Acceptance.** A unit test fails if a TARGET_REQUIRED observation reaches a Discovery or category-citation denominator; every number shows its section.

#### PR-06 Place wording and geography levels (P0)
- **Problem.** Place wording moved Atelier 10 from 9 of 10 (DIFC) to 3 of 14 (city-wide); city-less by-name prompts sent searches to other emirates; prompts spell out "Dubai International Financial Centre" [PROVEN]; operators never state where they compete.
- **Change.** (1) An explicit, confirmed competing level per business (district, city, country), optionally per P1 topic, defaulted from market-area rules. (2) A declared Discovery place mix (e.g. one storefront: 60% district, 40% city) with presence reported per level, never blended. (3) Every Trade Off and Sentiment prompt for a place-bound business names its city once (district city-qualified), not "about a third". (4) Spoken short forms (DIFC, JLT) resolved from geocoder and site, with a lint on long official names. (5) Record observer country and, when exposed, exit city; flag city-less by-name prompts.
- **Sources.** Scrunch location study [CLAIM]; Peec local templates [CLAIM]; Profound B8 (location most preserved in fan-outs) [CLAIM]; our data [PROVEN]. Peec docs: the run location is a per-prompt country setting, separate from any place in the text; prompts are generated per market (location and language) [DOC].
- **Code.** `prompts/geography.ts`; `discovery.ts` (`discoveryPlaces`, `spokenPlace`, `planDiscoverySlots`); `intent-generation.ts` (`placeHintsFor` use); `validators.ts`; `understanding/market-area.ts`; Measure `byPlace`.
- **Dependencies.** Understand market area; Landscape competitor tiers; Measure by-level splits (GEO-03); collection observer metadata (GEO-01, GEO-05); D5.
- **Comparability.** `prompt-context@3`, `DISCOVERY_POLICY_VERSION` bump; label September vs October Atelier runs as different instruments.
- **Cost.** None.
- **Acceptance.** Place-bound golden businesses: 100% of by-name prompts carry the city; place shares match the declared mix ±1; no place form longer than the site uses; Measure shows per-level counts.

#### PR-07 Ambiguity and vague-term lint (P1)
- **Problem.** "Studio14" searched as a salon; "RBAC" read as a rival [PROVEN]; acronyms and polysemous categories are the guide's top data trap [DOC].
- **Change.** A deterministic pre-approval lint (warnings with suggested rewrites): unexpanded acronyms ("role-based access control (RBAC)"); category words with several senses (seeded from the business's industry path, never a brand list); business names that are common words or collide with other places or businesses (geocoder, untracked names); place names shared across emirates or cities; bare feature-label Trade Off criteria.
- **Sources.** Profound Ch 3 [DOC]; independent plan's category anchoring [INFERRED]. Peec docs: brand names that are dictionary words ("Apple", "Orange") or collide with common tokens ("US" vs "us") need special matching rules [DOC]; the same names are ambiguity risks in prompt text.
- **Code.** `validators.ts` or a new `lint.ts`; `natural-validator.ts`; Prompts page.
- **Dependencies.** PR-19; Landscape untracked names; Understand industry path.
- **Comparability.** None.
- **Cost.** None.
- **Acceptance.** Catches seeded acronym fixtures and the RBAC and "Studio14 salon" patterns; under one false warning per set in blind review.

#### PR-08 Post-run prompt-format audit (P0)
- **Problem.** We judge prompts before answers exist; Profound's main QA reads answers against the type's expected format [DOC]. "No business named" exists per run but is not attributed to prompts across runs.
- **Change.** Per prompt, across runs: Discovery answers naming no business; clarification-only answers (cloro follow-up forms, cue phrases); Discovery answers naming only one business repeatedly (independent plan's brand-diversity and concentration audit); Trade Off TIE/UNCLEAR/NO_COMPARISON by wording form; Sentiment answers listing rivals. Above a stated rate (e.g. 2 of 3 runs), flag "replace at next version" with the reason. Clarification-only answers are coverage gaps, never absence.
- **Sources.** Profound format checks [DOC]; Synup excludes location-only answers [DOC]; independent plan [INFERRED]. Peec docs: informational prompts rarely return brands unless they ask which tools to use [DOC]; Peec's "Never comes up" fact signal (section 3.3.3) points the same way.
- **Code.** `src/lib/analysis` (clarification classifier), `measure/engine.ts` (per-prompt audit), Prompts page.
- **Dependencies.** Section 4 (eligibility); PR-17.
- **Comparability.** Diagnostics: none. Making clarification answers ineligible: `METRIC_POLICY_VERSION`, possibly `ANALYSIS_VERSION` (ship in the `@19` / `measure-policy@5` bundles).
- **Cost.** None.
- **Acceptance.** All 13 completed runs show audit rows; Atelier follow-up forms classified as clarification; no headline change without a policy bump.

#### PR-09 Attribute-conditioned and long-tail Discovery (P1)
- **Problem.** The judge fails prompts that "ask for the website's own claim", and `siteClaimsFor` puts differentiators off-limits. That protects neutrality but bars Profound-style long-tail prompts where a buyer's real constraint is the business's strength; an incident already forced an exception for services.
- **Change.** Allow attribute-conditioned prompts only if the constraint is a buyer need (not site copy) and passes category anchoring (≥3 confirmed or plausible rivals could satisfy it). Unique claims (founders, proprietary methods, exact packages) stay forbidden. Tag `conditioned=true`; report bare (authority) vs context/situation (long-tail) presence separately.
- **Sources.** Profound Ch 1 and Ch 3, PSUC; independent plan's anchoring and distinctive n-gram checks [DOC/INFERRED]. Peec docs: prompts carry context and constraints (audience, use case, budget, size), and the "buyer context" is the constraint that changes the answer, 2-4 per category [DOC].
- **Code.** `discovery.ts` (`siteClaimsFor`, judge payload, `JUDGE_SYSTEM`; re-run the judge probe on saved candidates first, per the rules file); `intent-model.ts`; Measure split.
- **Dependencies.** PR-01, PR-02, PR-08 (catches prompts only the target answers); D6.
- **Comparability.** `DISCOVERY_POLICY_VERSION`, `COVERAGE_POLICY_VERSION`; new sets.
- **Cost.** None.
- **Acceptance.** Blind review reads them as buyer asks; no conditioned prompt names only the target in ≥2 of 3 runs.

#### PR-10 Trade Offs as true Competitor prompts (P1)
- **Problem.** Short "X vs Y for need" forms are allowed, unlike Profound's explicit-ask rule; undecided share by form is unmeasured; uneven rival pools come up short [PROVEN].
- **Change.** First, from stored analyses (no new answers), measure undecided share by form (vs-form, "or" question, explicit "which would you pick for…"). If explicit asks decide more often, require them in at least half. Spread evenly (≥2 per top rival), relax the per-rival cap for uneven pools, and report decisive-only win rate per rival and criterion with counts.
- **Sources.** Profound Ch 3-4 [DOC]; Velova's tiny-n W/L records as anti-pattern [DEMO]. Peec docs: comparisons with top rivals should be phrased as a real buying decision with the buyer's situation ("I'm training for my first marathon, should I choose…"), and such comparisons often return side-by-side attribute tables [DOC]; this supports the explicit-ask form and gives `evaluation_criterion` more to read.
- **Code.** `intent-generation.ts` (`tradeOffDrafts`), `selector.ts`, `section-judge.ts`, `measure/engine.ts`.
- **Dependencies.** Section 4 (DQ-06, MS-10); PR-02; PR-20 (cap relaxation travels with this item); D7.
- **Comparability.** `COVERAGE_POLICY_VERSION`; new sets.
- **Cost.** None.
- **Acceptance.** The stored-data comparison is published first; undecided share does not rise; every rival with prompts has ≥2.

#### PR-11 Sentiment by attribute and theme (P1)
- **Problem.** Every Sentiment prompt has a theme, but Measure reports one blend; only 174 of 350 have a topic [PROVEN].
- **Change.** Bind each Sentiment prompt to topic and theme; Measure groups portrayal by both with counts ("2 of 3 price answers mixed"). Optionally add an explicit pros-and-cons form to a share.
- **Sources.** Profound Ch 3 [DOC]; Peec theme-tagged sentiment prompts [CLAIM]; Kumar on sentiment noise [3P].
- **Code.** `intent-generation.ts` (`sentimentDrafts`), `measure/engine.ts`.
- **Dependencies.** Section 4 (MS-10 does the Measure grouping); PR-02.
- **Comparability.** `METRIC_POLICY_VERSION`.
- **Cost.** None.
- **Acceptance.** 100% of new Sentiment prompts have topic and theme; per-theme counts with "seen once" below a stated minimum.

#### PR-12 Rewordings, prompt groups and repeat sampling (P1; noise floor P0)
- **Problem.** One answer per prompt; identical runs flip 1-3 of 10; wording alone moved place results [PROVEN]; with ≤3 discordant prompts no outcome reaches p < 0.10 [INFERRED].
- **Change.** (1) P0, with approval: re-ask one golden project's Discovery set 3 times over two days to publish a noise floor (delivered by MS-02, which covers six golden projects). (2) Freeze 2 validated alternate wordings per prompt at approval (same need, shape, place) under a `wordingGroupId`. (3) Headline uses canonical wording; alternates feed stability reads ("named in x of n across wordings"), never folded into the headline. (4) Plan 2's check runs reuse the groups (3-5 rewordings over ≥2 days with matched controls; Plan 2 section 11.1).
- **Sources.** Martinez; Peec rules 2 and 4; independent plan (paraphrases in sampling, not slots); IAB [3P/CLAIM/DOC]. Peec docs: rewordings of the same intent give similar results, so variations are not needed in general, but for the most important prompts a few variations give a steadier view because single prompts fluctuate daily [DOC]; consistent with alternates for stability reads only.
- **Code.** `orchestrator.ts`; schema already has `samplesPerPrompt` and `sampleIndex`; `src/lib/collection` runner; `measure/precision.ts`; `compare.ts` (samples mismatch is already a BREAK).
- **Dependencies.** Credit approval; section 4 (MS-02, MS-03); Plan 2 (section 11); D4.
- **Comparability.** Headline unchanged; group metrics need `METRIC_POLICY_VERSION`.
- **Cost.** Noise floor about 60-90 answers once for one project (MS-02's six-project version is ~300); ongoing +10 (or +20 with PR-04) per run for one alternate per Discovery prompt.
- **Acceptance.** A published noise floor; two frozen alternates per approved prompt; stability shown separately.

#### PR-13 Diagnostic probes outside the frozen set (P1 Accuracy and Validation; P2 Market perception and alternatives)
- **Problem.** We cannot tell trust from comprehension gaps, detect wrong facts or see the category frame, yet Plan 2's cards route on exactly these (Plan 2 section 5.2) [PROVEN gap].
- **Change.** A "probe" run kind that never enters History, snapshots or headline denominators (aligned with Plan 2's check runs, section 11.1), operator-started with a credit estimate:
  - **Accuracy**: questions from confirmed profile facts (hours, area/address, branches, services, price positioning, booking channel); deterministic match, with "not stated" distinct from "wrong". Highest value for local businesses.
  - **Validation**: for Discovery-absent P1/P2 attributes, a neutral yes/no ("does [brand] in [city] do [service]?") in two wordings, both polarities where natural (acquiescence bias); never read from one answer.
  - **Market perception** (P2): "how do I choose a [category] in [city]" per P1 topic; compare criteria named with confirmed why-we-win attributes.
  - **Alternatives-to-rival** (P2): "alternatives to [rival] in [city]" as Landscape feedback (the spec's "competitor alternatives" family), not a visibility metric. Peec's recommended branded prompt "best alternatives to [your brand]" (the independent plan's B4) is a candidate fifth probe on the same terms.
- **Sources.** Profound Ch 3-4 with verifier caveats; the spec's dropped `branded_accuracy` cohort; Peec's separate perception prompt set; Plan 2 decision 15 (rewordings v2, accuracy probes v3) [DOC/DEMO/INFERRED]. Peec docs: a per-prompt "Fact-checking" column (claims checked against your facts) and the alternatives-to-brand prompt [DOC].
- **Code.** New `src/lib/prompts/probes.ts`; `src/lib/collection` (run kind); `src/lib/analysis` (yes/no/hedge reader, fact matcher; new analysis types under an `ANALYSIS_VERSION` bump); a Measure diagnostic panel.
- **Dependencies.** Plan 2 gates and triggers (sections 6 and 7: Validation after a repeated Discovery absence; Accuracy on demand or when by-name answers state checkable facts); PR-01; credit approval; the schema window for the run kind (D19); D10.
- **Comparability.** None for the headline by construction.
- **Cost.** Accuracy 6-10 answers per probe run; Validation 2-4 per attribute; Market perception 1-2 per P1 topic.
- **Acceptance.** A unit test proves probe answers cannot reach any Measure denominator; results show n and "seen once" below 2; accuracy verdicts match hand labels ≥95% on fixtures.

#### PR-14 Persona handling (P2)
- **Problem.** Persona is set on 95 of 350 Discovery prompts, mostly template audience labels that read assembled; real prompts carry identity statements only 3-10% of the time [PROVEN]. Signed-out collection has no memory, so persona can only be text.
- **Change.** No persona dimension in the headline. Keep situation-in-passing ("for my mum") as `audienceOrSituation`; drop template audience labels from the floor. For B2B where segment changes answers (PSUC), offer two-segment persona probes (P2).
- **Sources.** Profound L08 [DOC]; spec ("only when it materially changes the answer"); Velova/Peec personas as generation aids [DEMO]. Peec docs: personas are part of the Brand Profile, a column on every prompt and a coverage-overview dimension [DOC]; useful for generation and grouping, not as a measured dimension in a signed-out instrument [INFERRED].
- **Code.** `realizer.ts`, `frame-planner.ts`, `discovery.ts`, `probes.ts`.
- **Dependencies.** PR-13 run kind; D8.
- **Comparability.** New sets.
- **Cost.** Probes only: 2 answers per need per segment.
- **Acceptance.** Lint finds no label-style audience phrase in approved prompts; persona probes report per-segment counts.

#### PR-15 Arabic and Hindi baselines (P2)
- **Problem.** Everything is English; UAE and India customers may ask in Arabic or Hindi. Evidence is indirect: ChatGPT fans out in English for many non-English prompts (Arabic and Hindi unstudied) [CLAIM]; Profound calls English tracking "a proxy at best" for Arabic prompts in Saudi Arabia and the UAE [CLAIM].
- **Change.** A separate, natively generated language set and baseline per project (never mixed with English), with transliteration-aware leakage lexicons, Arabic-script place names and mention detection. Pilot one project after approval.
- **Sources.** Plan 2 decision 17 lean (English plus host tables; languages only as new baselines). Peec docs: a market is a location plus a language and prompts are generated per market [DOC].
- **Code.** `validators.ts`, `natural-validator.ts`, `discovery.ts` register data, `landscape/name-forms.ts`, `src/lib/analysis`.
- **Dependencies.** Analysis support (GEO-06 first); operator decision (D18); budget.
- **Comparability.** A separate instrument; never a break of the English set.
- **Cost.** Doubles answers per run for that project.
- **Acceptance.** Native-speaker review of the set; leakage tests pass on transliterations; Measure labels language as its own instrument.

#### PR-16 Demand signals and limits (P2)
- **Problem.** No demand signal guides need choice; Search Console is unused by Prompts and was absent in 51 crawls [PROVEN]; vendor volumes are modeled [DOC/CLAIM].
- **Change.** Ordinal, explainable hints only: when Search Console is connected, map non-branded queries to needs ("seen in your search queries, n"); optionally GA4 landing pages. Never show prompt volume, impressions or value. Operator priority (PR-01) overrides.
- **Sources.** Independent plan's refusal to model volume; Profound demo ("order-of-magnitude"); Peec B32 GSC method and its rejection of volume-only lists [DOC/DEMO/CLAIM]. Peec docs: Prompt Volume is a 1-5 score relative to the business's own keyword landscape, built from web search trends [DOC], i.e. ordinal and modeled.
- **Code.** `src/lib/search-console`, `intent-model.ts`, Prompts page.
- **Dependencies.** Search Console token flow (reconnect every 7 days); `docs/SEARCH_CONSOLE.md` privacy rules; D11.
- **Comparability / cost.** None.
- **Acceptance.** When connected, ≥1 need per business shows query evidence; no volume number appears.

#### PR-17 Refresh, versioning and partial comparability (P1)
- **Problem.** Any new version is a full break, so fixing one weak prompt resets trends; the Prompts page keeps a stale set after re-confirm [PROVEN]; Profound shows the opposite risk, mutable history [DOC].
- **Change.** A stable `promptKey` (section × need × shape × place, plus rival or theme) carried across versions when wording is unchanged; Measure compares the matched subset ("28 of 30 unchanged") as a labeled caution while the full set stays a break. Refresh triggers: profile or landscape re-confirm, PR-08 flags, operator request, a quarterly review; every retirement stores a reason; the page warns when the set is older than the landscape.
- **Sources.** Peec rule 5; Profound's renamed-topic nuance; Trakkr's frozen measures [CLAIM/DOC]. Peec docs: archived prompts keep their history while deleted prompts erase it, and brand-setting edits reprocess past chats [DOC]; our retirements keep the row and the reason, never erase.
- **Code.** `orchestrator.ts`, `repository.ts`, `measure/compare.ts`, Prompts page.
- **Dependencies.** Section 4 owns compare rules (`METRIC_POLICY_VERSION`); the schema window if `promptKey` needs a column (D19); D12. Must exist before the R2 instrument so later versions can match against it.
- **Comparability.** Defines it: matched subsets are cautions, not equivalence.
- **Cost.** None.
- **Acceptance.** A set keeping 28 prompts shows a matched-subset comparison; the stale-set case is visible on load.

#### PR-18 Golden-set evaluation of prompt quality (P0)
- **Problem.** Scores are not quality (malformed splices once scored 90+); a holistic judge passed 28 of 30 assembled prompts; the live model path is untested [DOC/PROVEN].
- **Change.** Extend `benchmarks/onboarding/score.ts`: section fill; leakage (zero tolerance); judge failure rate by reason; place mix vs declared; by-name prompts with city; label-style audiences; acronym warnings; duplicates; matrix minimums; register statistics vs the LMArena profile. Add blind human labels (realism, neutrality, type fit) for about 150 prompts across the 17 golden businesses and measure judge agreement before any `JUDGE_SYSTEM` change. Add a stored-answer fixture to score PR-08. Add the spec's pilot targets as reported numbers: buyer-realistic and relevant above 85%, biased or leading under 5%, accepted without editing above 70%.
- **Sources.** Peec grader dimensions; the spec's arbitrary-site suite and prompt-quality targets; the prompts rules file [DOC]; the independent plan's adversarial leakage suite (slogan, product name, domain fragment, misspelling, translation, positioning phrase).
- **Code.** `benchmarks/onboarding/*`, `scripts/eval-onboarding.ts` (scratch dirs; paid calls), `tests/unit/prompts/*`.
- **Dependencies.** Existing Prompts paid-call approval; scratch data dirs.
- **Comparability.** None.
- **Cost.** About $0.10 per business per evaluation run; no answers.
- **Acceptance.** A baseline report exists before PR-04, PR-06 or PR-09; each later change reports deltas on the same set.

#### PR-19 Prompts-stage QA and review UX (P1)
- **Problem.** The "why" panel shows raw keys and model ids; no matrix, lint, judge giveaway or prior-run flags [PROVEN].
- **Change.** Words, not keys: topic and priority, type, shape, place and level, rival and criterion or theme, evidence basis, why selected, judge verdict and giveaway, lint warnings, earlier-run flags. Add the coverage matrix, a pool view with "top N per topic" helpers (Velova's good pattern) and an optional, credit-estimated "test ask" of up to 3 prompts before approval (Profound's spot-check), off by default.
- **Sources.** Spec §5.8; Athena's "why this prompt was suggested"; Profound Ch 3 [DOC/DEMO]. Peec docs: review regroups by branding, intent, persona, market or language; "Activate all" per group; topics move from Suggested to Active as prompts are accepted, with counts on hover [DOC].
- **Code.** `src/app/projects/[id]/prompts/page.tsx`, `src/components/features/*`, `src/lib/client/api.ts`.
- **Dependencies.** PR-02, PR-03, PR-07, PR-08; no collection vendor named anywhere in the app.
- **Comparability.** None.
- **Cost.** Test asks only: up to 3 answers.
- **Acceptance.** Any prompt's purpose is explainable without internal ids; no raw `contextBasis` key renders; copy-guard test passes.

#### PR-20 Close known gate holes and review defects (P0)
- **Problem.** KNOWN_ISSUES Prompts entries let invalid prompts or states through [PROVEN].
- **Change.** Section-specific rival rules in `validateCandidate`; unconfirmed-brand detection from Landscape suggestions and untracked names; target short forms in the leakage lexicon; token-boundary matching; lifecycle checks on review routes; a unique (projectId, version) index; relaxed per-rival caps; boot recovery for stranded sets. Remove each entry when fixed.
- **Sources.** "A leak invalidates the measurement" (rules file); the spec's hard gates.
- **Code.** `validators.ts`, `selector.ts`, `src/app/api/prompt-sets/**`, `schema.ts` (with coordination), `docs/KNOWN_ISSUES.md`.
- **Dependencies.** Schema coordination only (the index rides the D19 window); boot recovery shares code with PL-03; cap relaxation ships with PR-10 so selection changes once.
- **Comparability.** None for approved sets; `COVERAGE_POLICY_VERSION` if selection changes.
- **Cost.** None.
- **Acceptance.** A regression test per listed case.

## 4. Measure, data quality and other improvements

Written 2026-11-10 from on-disk research (no new research), with one read-only, immutable SQL check on 2026-11-10 (analysis versions, run and crawl status). Items marked **SHARED (Plan 2)** are prerequisites for Plan 2's measurement gate (section 0.6); they improve Measure whether or not Plan 2 ships.

### 4.1 Measure today: baseline and what to preserve

#### 4.1.1 State on 2026-11-10

| Fact | Value | Label |
|---|---|---|
| Versions | `observation-analysis@18` (`analysis/types.ts:63`), `measure-policy@4` (`measure/policy.ts:32`), `competitor-discovery@6`, `competitor-tiers@1`, `prompt-selection@5-10-10-10` | [PROVEN] |
| Live DB | 52 projects; 51 prompt sets (35 approved); 27 runs: 13 `completed`, 14 still `active` (model-API lanes, created 2026-09-10 to 09-16, before auto-finalize); 1,065 answers (645 retired API lanes, 419 ChatGPT on the web: 393 Oxylabs, 26 cloro; 1 by hand); 1,519 analyses; 15 snapshots; 1 crawl stranded `running`; last activity 2026-10-15 | [PROVEN], re-checked 2026-11-10 |
| Analysis versions stored | **Zero rows at `@18`**; newest 60 at `@17` (re-checked 2026-11-10, `sqlite3 -readonly "file:data/sun.db?immutable=1"`, WAL empty) | [PROVEN] |
| What the operator sees | 13 finalized runs serve snapshots at `@10`-`@17` / policy@2-@3 (`snapshots.ts:152-156`); the 14 active legacy runs are computed live by policy@4 over `@1`-`@9` analyses | [PROVEN] |
| Web answers' metadata | Observer country AE 299, US 90, IN 30 (country only); model `gpt-5-6` 351, mini 8, `unknown` 60 (every October answer); `search_state` `on` 419 of 419 (adapters cannot record "off") | [PROVEN] |

#### 4.1.2 Views and metrics

Five tabs on `/projects/[id]/measure`: **Overview** (four tiles: Visibility, Share of voice, Head-to-head, Reputation, each with fraction, plausible range and change; who is named beside where you are missing; findings; source mix; what changed), **Competitors** (`?view=brands`, every business named), **Questions** (`?view=performance`, every-answer grid), **Sources**, **Report**; plus hidden **Answers** (`?view=answers`). Exports: `csv`, `brands-csv`, `sources-csv`, `json` (findings only in JSON), re-keyed by surface; no vendor named (`tests/unit/ui/copy-guard.test.ts`).

| Key (UI label) | Numerator / denominator | Section |
|---|---|---|
| `discovery_visibility` (Visibility) | Eligible Discovery answers naming the target (exact/strong) / eligible Discovery answers | Discovery |
| `discovery_share_all_names` (Share of voice) | Target presence events / events of every business, tracked or detected (one per answer and business; `businessKey` merges spellings) | Discovery |
| `discovery_share_of_voice`, `citation_share` | Tracked-only share; tracked-brand URL share (exports only since @4) | Discovery; all |
| `first_choice_rate` (Ranked first) | Target at explicit rank 1 / rank-eligible Discovery answers | Discovery |
| `answer_brand_free_rate` (No business named) | Answers naming no business at all / eligible Discovery answers | Discovery |
| `tradeoff_decisiveness`, `tradeoff_target_win_rate` (Gave a verdict, Won when decided) | Answers preferring a side / answers with a target comparison; target preferred / decisive answers | Trade Offs |
| Reputation | Target portrayal among opinions ("2 of 3 opinions positive; 7 stated facts") | Sentiment Analysis |
| `owned_citation_rate` (Your site cited) | Answers citing ≥1 TARGET_OWNED URL / answers with trustworthy source capture (a "when sources were shown" variant only when different) | all |

Blocks: coverage, presence, Trade Off outcomes per rival, sentiment aspects, sources with the answer-level mix (yours / a tracked rival's / third-party only / none), emerging names, `byTopic` and `byPlace` leaders, prompt and brand rows (`engine.ts:195-942`). Findings (`buildOpportunities`, `engine.ts:989-1185`): `discovery_gap`, `tradeoff_loss`, `reputation_concern` (Sentiment answers only), `source_gap`, `untracked_brand`, `coverage_gap`; `rival_source` and `owned_uncited` retired at @4 but still render on old snapshots.

**Precision and change.** Wilson 95% "plausible range" on headline rates with ≥5 answers (`precision.ts`, `LOW_N = 5`): 7/10 → 39.7-89.2%, 2/10 → 5.7-51.0%. Breaks (`compare.ts:39-63`): different prompt set, competitive set, analysis versions, policy, analysable engines, samples per question. Cautions: provider, observer country, model, partial coverage. Deltas only when both denominators are ≥5, flagged `withinRange` when inside the earlier range. Posture: "Exploratory baseline", one answer per question per engine.

#### 4.1.3 Preserve (non-negotiable)

1. Every figure is `x of n` and opens its answers; the spec requires every headline metric to drill to prompt-level evidence with valid denominators [DOC].
2. Gaps are never absences; zero denominators show `—`; partial runs say "so far".
3. Sections never blend; branded prompts never enter visibility.
4. Frozen, pinned competitive set; snapshots per (run, versions); explicit breaks; append-only responses and analyses.
5. Cited is not present; undecided is not a loss; no opinion is `NO_SENTIMENT`.
6. No vendor named in Measure; deterministic rules-only reading.

**Keep absent:** composite scores (Rankscale says they hide the diagnosis [DOC]); a headline ranking position (SparkToro: repeated prompts returned the same list under 1% of the time [3P]); 0-100 sentiment; estimated impressions, volumes or dollars; qualitative bands on tiny samples; same-run "category benchmarks"; relabeled history; LLM commentary; any Actions layer.

**Against the original vision.** The spec's five metrics were Neutral Presence, tracked-only Share of Voice (N/A at zero), First-choice rate, Average position and Owned citation rate, plus Coverage [DOC spec §8.3]. All survive; the headline share deliberately became every-business share (tracked-only reads 100% by construction when no tracked rival is named). The spec also said production monitoring "requires repeated matched samples and uncertainty" [DOC spec §16]. Uncertainty now exists; repeated samples do not. That is the largest gap between vision and build.

**What the 2026-11-09 audit changed (keep).** `@18` reads ChatGPT's October list format (numbered names with a listing cue below, `numberedName`), makes a tracked option label RECOMMENDED, counts untracked options for rank eligibility, and stops reading "no complaint found" as negative. Policy@4 merges spellings, redefines "No business named", counts every business in topic leaders, consolidates findings, adds the source mix and ranges. On an isolated copy: Discovery businesses detected 468 → 598; rank-eligible Discovery answers 7 → 28 of 130; no verdict or presence changed; Atelier 10 share of voice 2/10 → 2/43 [PROVEN, `MEASURE_AUDIT.md` §6]. None of it reaches live data until each run is re-analyzed (MS-01).

The audit's before → after on six real runs [PROVEN, `MEASURE_AUDIT.md` §6]:

| Business | Visibility | Share of voice (every business) | Businesses named | No business named | Ranked first | Negative / mixed | Findings |
|---|---|---|---|---|---|---|---|
| Atelier 10 (Oct run) | 2/10 → 2/10 | 2/10 → 2/43 | 7 → 35 | 5/10 → 0/10 | 0/1 → 0/10 | 1/0 → 0/0 | 7 → 3 |
| Atelier 10 (Oct, other project) | 3/10 → 3/10 | 3/11 → 3/36 | 9 → 32 | 6/10 → 1/10 | 0/0 → 1/8 | 2/1 → 0/0 | 10 → 4 |
| Studio14 (Pilates) | 7/10 → 7/10 | — → 7/43 | 20 → 24 | 2/10 → 0/10 | 0/1 → 0/0 | 0/1 → 0/1 | 6 → 5 |
| The Warehouse Gym | 3/10 → 3/10 | — → 3/47 | 17 → 43 | 7/10 → 0/10 | 0/0 → 0/0 | 1/0 → 1/0 | 6 → 5 |
| Truffles (restaurant) | 3/10 → 3/10 | — → 3/46 | 43 → 36 | 7/10 → 0/10 | 0/0 → 0/0 | 0/0 → 0/0 | 6 → 4 |
| Pipedrive (CRM) | 7/10 → 7/10 | — → 7/45 | 11 → 21 | 3/10 → 0/10 | 0/1 → 0/2 | 1/2 → 1/2 | 6 → 5 |

("—": the stored snapshot predates the metric. Truffles' business count fell because older versions counted places and adjectives such as "Indiranagar" and "Good". The gym's remaining negative is real.)

### 4.2 Measurement methodology and reliability

#### 4.2.1 Single-sample noise, on our own data

A run is 30 questions with one answer each; ten Discovery questions carry every presence metric, so one answer moves Visibility 10 points. Topic and place cells hold 1-3 answers; Reputation often rests on 2-4 actual opinions.

| Same set, Oxylabs, AE, `@12` | Gap | Visibility | Discovery flips | Jaccard, businesses named | Jaccard, domains (Disc / Sent) | Same sentiment |
|---|---|---|---|---|---|---|
| Studio14 `crun_2a2329d1` → `crun_efabc943` | 63 min | 8 → 7 of 10 | **3 of 10** | 0.46 | 0.54 / 0.37 | 6 of 10 |
| Atelier 10 `crun_9acf2d8e` → `crun_47f41883` | 14 min | 6 → 7 of 10 | 1 of 10 | 0.38 | 0.64 / 0.78 | 7 of 10 |

[PROVEN, independently recomputed]; "nothing changed in between" is [INFERRED]. No project has comparable runs on two days [PROVEN]. Outside evidence agrees: Peec's variance model implies a 13.5% chance a non-branded prompt flips between two single runs [CLAIM]; ChatGPT same-day query overlap 2.7%, cited-page overlap 15% [3P, API]; sentiment flipped in 45.5% of repeated cells against 6.8% for mentions [3P, vendor-authored].

#### 4.2.2 What the range covers, and what samples support

The Wilson range covers question-set variation, not re-ask variation, which one run cannot observe (`precision.ts:12-16`). Widths: 28 points at 0/10 or 10/10, 45-53 from 2/10 to 8/10. `withinRange` is lenient: 2/10 → 6/10 leaves the earlier range, yet two-sided Fisher p = 0.17 [INFERRED]. The IAB reports rates with a margin ("approximately 22%, plus or minus 4 points"), calls under 50 queries exploratory, and requires a re-baseline after a major model or query-set change [3P]. Evertune puts a 10-prompt topic asked once at ±31 points; Momentic ±15 [DOC/CLAIM].

| Claim | One 30-question run? |
|---|---|
| "This answer said X"; "cited in k of n"; a section level with its range | Yes |
| Topic, place or per-rival rates; stable leaders or ranks; "consistently" | No |
| "Moved" between runs (Fisher, p < 0.05) | Only large moves: 0/10 needs ≥5/10; 2/10 → 8/10; 3/10 → 9/10; 5/10 → 10/10; 6/30 → 15/30; 10/50 → 20/50 |
| Detect a true rise 20% → 50% | Power 13% at 10 answers, 60% at 30, 85% at 50 (independence assumed; repeats are correlated, so lower). 80% power needs ~82 per arm for 20→40%, 388 for 50→60% [INFERRED] |

Peec's precision guide [CLAIM, 2026-09-29; confirmed, from a variance-components model]: 50 prompts × 1 run a day gives ±10.5 pp daily, ±6.1 pp monthly, and detects 12.4 / 4.7 / 2.3 pp changes daily / weekly / monthly; 10 prompts × 5 runs gives ±13.2 pp monthly; branded per-run variance ~0.0225 against non-branded ~0.0675; 40% of non-branded prompts are contested (named 10-90% of the time). Advice: prompts drive precision, runs drive change detection; add prompts before runs; separate branded prompts; freeze the set.

#### 4.2.3 Repeat runs, cadence and budget

- **"Repeated"** (one definition, shared with Plan 2 section 8.2): the pattern holds in ≥2/3 of ≥6 looks after the trigger, on ≥2 days, with ≥2 wordings, readings exact or strong; trigger excluded; at most one re-ask. False promotion 7% at a 70% true naming rate (the old 2-of-3 rule: 22%); a 3-3 split closes as "mixed" [INFERRED].
- **Cadence:** weekly ≈ 130 answers per client per month (30 × 52 ÷ 12); fortnightly ≈ 65; extras capped at 60 per client per month, matching the per-lane cap (`SUN_COLLECTION_MAX_REQUESTS_PER_LANE`, `runner.ts:230`).
- **Budget:** cloro free ≈ 70 ChatGPT answers a month (500 credits, 7 each; a full run ≈ 217); Decodo ≈ 670 but cannot target a country; Bright Data 5,000 records at 5-12 minutes an answer; Oxylabs trial 2,000 results (duration unpublished), then $1.50 per 1,000 with a $30 minimum (7 Oct) or $49 for 37,692 answers (16 Sep). cloro Lite at $30 is pre-approved "if needed"; a standing schedule is not. At ~$0.0015 an answer [INFERRED], approvals, minimums and the cap bind before money.
- **Intent vs reality:** the brief assumes a weekly loop; cost workbooks moved to daily on 2026-10-08 [DOC internal]; no run since 2026-10-15 [PROVEN].

#### 4.2.4 Comparability breaks and a change ledger

`compare.ts` knows *that* lineage differs, not *why* a series moved. 2026 events that would go unrecorded:
- **Model changes:** GPT-5.5 Instant default 5 May; GPT-5.6 default for Free and Go from early August [CLAIM]; model label missing on all 60 October answers [PROVEN].
- **Retrieval regime:** citation collapses 8 Mar and 19 Apr [CLAIM, seoClarity]; `site:` fan-outs ~0.4% → ~17% around 8 Aug [CLAIM]; list pages fell from ~20% to ~8% of sources after GPT-5.6 [CLAIM, Peec].
- **Collection:** provider handover inside Atelier 10's 15 Oct run (26 cloro, 4 Oxylabs); "auto" markets observed from the US [PROVEN].
- **Capture:** fan-out queries and model label vanished from October payloads [PROVEN]; ChatGPT's UTM tagging broke 8-16 Oct [CLAIM, Profound].
- **Instrument:** Atelier 10's level moved ~40 points between prompt sets in line with place wording [PROVEN counts].
- **Seasons:** Ramadan, Diwali, summer.

Five ChatGPT-wide events in ~31 weeks imply ~61% odds of one in any 6-week window [INFERRED]; the IAB says a sudden change across many brands on one platform almost always comes from the platform [3P]. Hence MS-05 (ledger) and MS-06 (handover and country become breaks for place-bound before/after claims; "model not recorded" a caution).

#### 4.2.5 API answers are not consumer answers

ChatGPT's interface and API answers shared 12.0% of cited domains; the ChatGPT and Gemini interfaces 5.4% [3P]. Retrieval explained 32% of within-site citation variation on ChatGPT against 2.8% for page features, and 46% of mentions of brands the question did not name had no cited page naming them [3P, small API models, observational]. So: keep consumer-web collection; never import API-study numbers as benchmarks; never call a cited domain "influential"; keep the API lanes retired.

### 4.3 Analysis accuracy

Rules-only English analysis (`src/lib/analysis/*`). Each class below came from real stored answers.

| Misread | Real example | `@18` status | Item |
|---|---|---|---|
| No complaint read as complaint | "I couldn't find a clearly documented public complaint…" → NEGATIVE; Atelier 10's only Reputation concern | Fixed in code, not applied | MS-01 |
| Second pick as mention-only | "## 2. Atelier 10"; "I would start with THE RALUCA or Atelier 10" | Fixed for option labels; bare numbered prose without a listing cue still depends on the lead-in | DQ-05 |
| "Here are the best…:" | Same list `no_options` after it, ranked after "Top picks for X:" | Partly fixed | DQ-05 |
| Hedged recommendation dropped | "Nike could be a good option": out of presence, answer kept in denominator | Open | DQ-05 |
| Rank heuristics | Incidental ordinals make eligibility; two lists give two "rank 1"; a brand named before its list gets no rank | Open | DQ-05 |
| Feature as rival | Postman "won" against "RBAC" (`crun_b4ec762f`, `@10`) | Open in stored data | DQ-06 |
| Verdict credit | "A and B are fine, but I'd choose C" credits B; "To choose between A and B…" read as a verdict | Open | DQ-06 |
| Aspects null | Atelier Oct Trade Offs: only "availability", "service" | Open | DQ-06 |
| Negation and table cells | "…and I don't see many complaints" → DISCOURAGED; "If you've never done Pilates" → DISCOURAGED + NEGATIVE; "…patchy colour \| Atelier 10" (Trade Offs: roles, not Reputation) | Open | DQ-04 |
| Opinion without the brand; missed hedged criticism | "Opinions on X are mixed. Its cushioning…" → NO_SENTIMENT; "a few beginners felt they didn't receive enough explanation" (Studio14); "Not completely… full cost isn't clear upfront" (Atelier) | Open | DQ-04 |
| Conditional framing | Pipedrive "If you mean people importing old deals…" reads negative | Open | DQ-04 |
| Name noise | "Fade" was the DIFC place leader; "Trade Centre", "Oval", "Round"; branches counted twice; athletes and retailers for a shoe brand | Partly fixed | DQ-03 |
| Target aliases | Alias rows only for competitors | Open | DQ-07 |
| Source kind and map links | Host/path guess; fresha.com unknown; google.com map links in 12 of 30 Atelier answers counted as sources | Open | DQ-08 |
| Wrong owned and rival domains | atelier10salon.ae third party; Studio14 rivals wrong | Open (instrument) | DQ-01, DQ-02 |

Also: Studio14's one rank-eligible answer under `@12` is not eligible under `@18`, untraced; 14 of the 18 remaining negative or mixed readings across 130 by-name answers are unread by a person; the emerging list blends sections [PROVEN].

#### 4.3.1 Human blind-labeling plan (Phase 0, SHARED with Plan 2)

1. Label **all 279 by-name answers** and **all 140 Discovery answers** of the web runs at `@18`, on an isolated copy: presence and role, businesses named (and whether each is a business), rank, verdict and side, aspect, portrayal, own and rival domains.
2. A second reader, blind to the analyzer, reads the **31 broad-match hedge answers** plus **50 random answers** and reports misses.
3. A rule releases unreviewed output only after ≥30 labeled detections from ≥3 business kinds with a 95% Wilson lower bound ≥75% (28/30, 36/40, 44/50). At 1-2% base rates (Plan 2 trigger T1 hedges 3 of 279; "cited, not named" 3 of 140) that takes months, so report misses, not recall, until 30 true positives exist [INFERRED].
4. Relabel golden runs quarterly: ChatGPT's October layout silently cut detection to 7 of 35 businesses until `@18`.

Effort: ~3 operator-days.

### 4.4 Metrics: keep, change, add

| Metric or view | Decision | Reason |
|---|---|---|
| Visibility | Keep | Core metric. It counts DISCOURAGED mentions too, so the UI says "named", not "recommended"; add "recommended in" only after role labels pass (DQ-09) |
| Share of voice (every business) | Keep, harden | Only as good as name detection; add names-checked and "k names not confirmed" (DQ-03) |
| Tracked-only share, citation share | Exports only | Tracked share is 100% by construction when no rival is named; real runs named 2 of 6 tracked rivals among 35 businesses |
| Ranked first; average position | Keep; never a position score | Velova exported "Position 1" for a brand listed 5th of 5, hidden by a 100/log₂(rank+1) score and a composite rank (0.40·SoV + 0.35·Position + 0.25·First Choice) [DEMO]. Show the list behind every rank |
| Gave a verdict / Won when decided | Keep (decisive-only) | No vendor publishes an equivalent; "didn't compare" shown |
| Reputation among opinions | Keep; a person reads concerns | Until labels pass |
| Your site cited | Keep; fix the instrument | Needs evidenced ownership (DQ-01) |
| Branded vs unbranded denominators | Keep separate | Velova's 41-mention base was 40 of 41 branded and read 70% beside 5% unbranded [DEMO]; Peec branded variance ~0.0225 vs ~0.0675 [CLAIM]; Peec classifies every prompt Branded or Non-branded automatically [DOC] |
| Ranges | Keep for levels; add a two-sample test for "moved" | MS-06 |
| Per-question consistency | Add at ≥3 runs | MS-08 |
| Cited vs named | Add | Studio14 cited 29 of 30, absent from 3 of 10 Discovery answers (MS-09) |
| By criterion and theme | Add | `evaluation_criterion`, `sentiment_theme` stored, unused (MS-10, PR-11) |
| Sponsored presence | Add as a report line | Ads beside 13 of 30 Atelier answers (10 of 20 by-name); "not recorded", never 0, where a provider lacks ads (MS-11). Peec shows an "Ads" column (% of chats that triggered an ad) beside its main metrics [DOC] |
| Untracked named most | Add as a Landscape feed | Dubai gym: Fitness First, GymNation, MH3 named; EMD, F45, Gold's tracked (MS-12) |
| Topic and place cells | Counts only | 1-3 answers each |
| Place mix | Add beside the headline | GEO-03 |

### 4.5 Geographic relevance

**Three geographies.** Where the business is (`location.primary`, `branches`), where customers are measured (`location.marketArea`, frozen into `prompt-context@2`), and where the answer was observed from [PROVEN code]. The spec forbids pretending the observer location is controlled [DOC spec §4].

**Observer country.** `observationGeography` (`collection/orchestrator.ts:520-529`) reads only the intake hint; `market_scope='auto'` falls back to `SUN_COLLECTION_DEFAULT_COUNTRY` (US). Empire Restaurant, Bengaluru (`crun_da3bffdd`), was collected 30 of 30 from a US exit, so its 0/10 Visibility describes a US user; every "Detect from my website" project is observed from the US [PROVEN]. Decodo cannot target a country (an untargeted request exited through Vietnam); vendor country lists are not pre-checked.

**Question wording dominates local levels.** Pooled across three Atelier 10 projects, the salon was named in 9 of 10 DIFC-worded Discovery questions (60-98%), 3 of 14 city-wide (8-48%) and 0 of 6 other districts (0-39%); in the latest single run, 1 of 2 DIFC, 1 of 7 Dubai-wide, 0 of 1 Business Bay [PROVEN]. September's 6-7 of 10 vs October's 2-3 was a different place mix, not a decline. Review counts did not separate the chosen businesses (12 to 2,853 against the salon's 111). "Which places we measure" is an instrument choice (a break); "where we compete" is a business choice.

**City inside the country is uncontrolled.** For city-less by-name and head-to-head questions, ChatGPT's September searches named other emirates: one Studio14 run had 7 queries naming Abu Dhabi, the other 3 Sharjah, 1 Abu Dhabi, 1 Ras Al Khaimah; one query was `"Studio14" salon UAE`; one answer offered "a different Studio14" [PROVEN]. Consistent with a varying exit inside the UAE [INFERRED]. OpenAI says ChatGPT search uses approximate IP location and rewrites "near me" to a city [DOC]. An API study found near-me lists for different US cities shared 8% of businesses against 32% for one city asked twice; Gemini followed only the network country [3P, consumer UI untested].

**Local listings sit in the payloads.** Oxylabs streams carry records (name, rating, review count, categories, tags, website, phone, address, lat/lng, hours) in most local answers (37/60 Studio14 Sept, 42/60 Atelier Sept, 19/30 Truffles; none for B2B); cloro `map[]` in 9 of 26 (26 of 27 `bright-feed`); `is_claimed` null in 2,714 of 2,739 [PROVEN]. Oxylabs records look like the retrieved set (12-14 per answer), not proven displayed [INFERRED]. They separate not retrieved / retrieved, not named (both Studio14 listings among 14 records for "luxury reformer pilates"; six others named) / cited, not named.

**Signed out, not personalized.** `session_profile` attests signed out, personalization off, fresh chat, search forced, by construction [PROVEN]. Logged-in users may see other answers [HYPOTHESIS]; the scope line should say "signed out".

**Language.** English prompts and analysis. The crawler drops non-Latin pages as duplicates (`text/similarity.ts`), sentence splitting fails on non-Latin text, and `cleanOptionName` drops Arabic and Hebrew script [PROVEN]. No study covers Arabic or Hindi prompts [3P gap]; such a set would be a new baseline.

**Google surfaces and Gemini.** Gemini is built and hidden. Google documents keeping Business Profile current for its AI features, and Maps grounding feeds Gemini's geographic answers [DOC], so the best-documented local lever acts on surfaces Project Sun does not measure; ChatGPT and Gemini interfaces share 5.4% of cited domains [3P].

**UAE and India gap.** No local AI-sourcing study covers either [UNAVAILABLE]. US/UK/AU vendor data: Google Business Profile 28.63% of local AI citations; Yelp in 80% of ChatGPT local answers [CLAIM, BrightLocal]; Yelp partners only in the US and Canada; BrightLocal does not cover the UAE or India [DOC]. Yext benchmarks a location against the average of the top 5 businesses in its Google search, acting when >10% off, scanning from ~2 miles away [DOC]; grid tools sample many points per prompt [DOC/CLAIM]. Project Sun cannot grid inside a country, and its own data contradicts a simple review benchmark, so local source questions need in-market measurement.

### 4.6 Data quality and unused data

#### 4.6.1 Stored but never parsed

| Data | Coverage [PROVEN] | Unlocks | Limits |
|---|---|---|---|
| Fan-out queries (Oxylabs `search_queries`) | 359 of 393 (all September; mean 1.15); 0 of 34 October; cloro 0 of 26 (flag `SUN_CLORO_SEARCH_QUERIES`, +2 credits per a code comment) | Place drift, entity ambiguity | Gone since October [INFERRED: format change] |
| Ads (Oxylabs `ads[]`) | 33 answers, 37 ads; `crun_a2372971` 13 of 30 (D 3, TO 3, S 7); ITS BEAUTY on 6, no tracked rival | Sponsored line | 5 of 37 URLs carry `utm_medium=paid`; all carry `oppref`/`olref`; not in cloro's schema |
| Local records | See section 4.5 | Name checks, absence split, distance | Retrieved vs shown unclear; source unknown |
| Citation titles, publishers, positions | 392 Oxylabs; cloro `sources[]`, `citationPills[]` | Page-level sources; "official site" ownership evidence | Panel order is not influence |
| Follow-up forms (cloro) | 9 of 26 | What ChatGPT asks buyers (AED budget bands, area) | One run |
| cloro `entities[]` | 16 of 26; listed 3-6 businesses in three answers `@17` called brand-free | Detector validation | One provider |
| `inline_citation_urls` | cloro only, 111 on 26 rows | Body vs panel links | Not passed to analysis (`service.ts:247`) |

#### 4.6.2 The measurement gate (instrument defects)

| Plan 2 gate | Defect and evidence [PROVEN] | Item |
|---|---|---|
| Q1 | No `@18` analyses; old snapshots served | MS-01 |
| Q2 | atelier10salon.ae (16 of 30 answers) counted third party. As owned: 15→20 (`crun_6df9150f`), 6→20 (`crun_a2372971`), 17→25 (`crun_9acf2d8e`), 18→25 (`crun_47f41883`); September Discovery 1→8. Likely, not proven: the crawl stored matching handles (X, YouTube @Atelier10Salon; LinkedIn atelier-10-salon), but keeps no generic outbound links (118 rejected) and the listing names only atelier10.ae | DQ-01 |
| Q3 | Studio14 rivals frozen to realpilates.ae (parked, `verificationStatus: "failed"`) and thehundredpilates.com (a California studio, "verified"), both `ai_hypothesis`; real sites real-pilates.com and thehundred.ae count third party (4 answers each); Postman's konghq.com, apidog.io unrecorded. A verification defect, not a domain family | DQ-02 |
| Q4 | Bengaluru restaurant observed from the US | GEO-01 |
| Q7 | `/hair`, `/nails`, `/lashe`, `/barber`: 200, empty body, 0 words, plain HTTP, no browser fallback, fetched without the trailing slash; ChatGPT cited `/hair/` and quoted AED 265 and "Price upon consultation"; the profile's price warning is partly a crawl artifact | DQ-11 |
| Q8 | "Fade" as a business and DIFC leader | DQ-03 |
| — | Constant `search_state`; no model label in October; map links as sources; lenient `withinRange`; atelier10.ae has 12 projects; "possibly yours" (`shared.tsx:204-209`) is target-only and would flag studio14-training.de | DQ-12, DQ-08, MS-06, DQ-14 |

**Search Console never produced data.** Across 51 crawls: `skipped:no_matching_property` 16, `reconnect_required` 1, absent 34 (before the step existed); `used` never appears; one credential row exists [PROVEN]. It cannot see ChatGPT anyway [DOC]. Keep optional; build nothing on it (PR-16 uses it only as an ordinal hint when connected).

### 4.7 Other improvements to the existing app

From `PROJECT_STATUS.md`, `KNOWN_ISSUES.md` (~100 entries; 13 of 14 spot-checked still present) and research:
- **Tooling:** lint fails with 537 errors, all in `data/deck/.next`; source has 0 errors, 116 warnings (PL-01).
- **Docs drift:** README, `IMPLEMENTATION_STATUS.md`, `.env.example` (100/25 crawl bounds vs code 400/30; missing `SUN_ALLOW_PAID_LANDSCAPE`, `SUN_LLM_NO_PAID`, `GOOGLE_MAPS_API_KEY`), `BENCHMARK_REPORT.md` footer "21/4/5", `AGENTS.md` and `.agents/skills`, CLAUDE.md (Methodology view, "csv|json", omits `lib/oxylabs`, "Lint: 0 errors", two comments already fixed), and `.claude/rules/collection.md`, which still calls the idempotency key global though `orchestrator.ts:152` is run-scoped [PROVEN, 2026-11-10] (PL-02).
- **Robustness:** no boot reconciliation; bad JSON and run-creation errors → 500; vendor health and progress in memory; duplicate runners; crash window; no retry UI; `paused` lost (PL-03, PL-06, PL-07).
- **Hygiene:** 14 legacy `active` runs, 1 stranded crawl (PL-04).
- **Security:** robots, sitemap and Playwright fetches bypass the SSRF guard; IPv6 gaps (NAT64 `64:ff9b::/96`, `::a.b.c.d`, `2002::/16`, `ff00::/8`); DNS rebinding window; no auth. A prerequisite for any page fetch (PL-05).
- **Dead code:** retired OpenAI/Groq/Cerebras clients, `GeminiProfileProvider`, unused LLM stages, the `jobs` table, `is_fixture`, coverage "cells", stale `capability-gates.ts` constants (PL-09).
- **Upstream quality that moves Measure:** failed profile versions confirmable; freeze ignores confirmation; non-transactional landscape PATCH; retailers typed as marketplaces; "Apr" as finance; topic stripping without word boundaries; unconfirmed suggestions later named by ChatGPT (The Gents Salon, 1847, Nails LAB; MYGLOW, Contrology) (PL-08, MS-12).
- **Budget and engines:** LLM ledger persisted only for Understand; Oxylabs trial length unknown; no Gemini re-enable criteria (PL-10, PL-11).
- **Tests:** `full-pipeline.test.ts` can pass without measuring; known e2e failures (PL-12).
- **Outside Measure:** the landing page shows hardcoded marketing figures (`src/app/page.tsx`, `landing-sections.tsx`); no item.

### 4.8 Measure refinement items

Fields: Problem · Change · Code · Depends · Versions/comparability · Cost · Done when. Costs are [INFERRED] (dd = developer-days). Ship analyzer fixes DQ-03 to DQ-07 (with DQ-10 and PR-08's classifier) as one `observation-analysis@19` and policy changes as one `measure-policy@5`, so operators re-analyze once (section 5.3). Plan 2 refers to the ownership overlay's policy bump as `measure-policy@5`; use the next version at build time.

**Links to the prompt methodology (section 3):** MS-07 (Discovery count reopens the 10/10/10 contract; same decision as PR-04); MS-03 and MS-02 (re-ask rewordings must come from the Prompts pipeline and its validators, under paid-model approval; PR-12); GEO-03 (the place mix is set by prompt geography; PR-06); DQ-06 and MS-10 (they rely on each prompt's `evaluation_criterion` and `sentiment_theme`; PR-10, PR-11); MS-12 (new rivals feed Trade Off prompts in the next set).

| ID | Item | Priority | Shared | Phase |
|---|---|---|---|---|
| MS-01 | Re-analyze every live run; stamp versions | P0 | Plan 2 Q1 | R0 |
| MS-02 | Measure the noise floor | P0 | Plan 2 Phase 0 | R0 |
| MS-03 | Repeat samples within a run | P1 | Plan 2 section 11 | R2 (with the v2 baseline) |
| MS-04 | Cadence approval and "Runs due" | P1 | Plan 2 run checklist | R1 (scheduler later) |
| MS-05 | Change ledger | P1 | Plan 2 section 11.4 | R1 |
| MS-06 | Stricter change claims | P1 | Plan 2 section 11 | R1 |
| MS-07 | Decide the Discovery sample size | P1 (decision) | Plan 2 decision 5 | Decide CP1; build R2 |
| MS-08 | Per-question consistency | P2 | — | R3 |
| MS-09 | Cited vs named | P2 | — | R1 |
| MS-10 | By criterion and theme | P2 | — | R1 |
| MS-11 | Sponsored presence line | P2 | Plan 2 T14 | R1 |
| MS-12 | "Named most, not tracked" to Landscape | P1 | Plan 2 Q6 | R1 (tracking additions in R2) |
| DQ-01 | Evidenced ownership claims | P0 | Plan 2 Q2 | R1 (first, in the schema window) |
| DQ-02 | Rival domain verification | P0 | Plan 2 Q3 | R0 (corrections via DQ-01 or R2) |
| DQ-03 | Names checked; less noise | P1 | Plan 2 Q8 | R1 |
| DQ-04 | Sentiment accuracy | P1 | Plan 2 Q5 | R1 |
| DQ-05 | Role and rank accuracy | P1 | Plan 2 6.3 | R1 |
| DQ-06 | Comparison accuracy | P1 | Plan 2 6.3 | R1 |
| DQ-07 | Target aliases | P1 | Plan 2 6.3 | R1 |
| DQ-08 | Source hygiene | P1 | Plan 2 6.3 | R1 |
| DQ-09 | Blind labeling and handcheck | P0 | Plan 2 Phase 0, 7.1 | R0 |
| DQ-10 | Payload readers and field-presence monitor | P1 | Plan 2 12.2 | R1 (first in the analysis bundle) |
| DQ-11 | Crawl gaps are not site gaps | P1 | Plan 2 Q7 | R1 (after PL-05) |
| DQ-12 | Honest search state and model | P2 | Plan 2 S1 | R1 |
| DQ-13 | Legacy Measure clean-ups | P2 | — | R1 |
| DQ-14 | One primary project per business | P2 | Plan 2 6.1 | R1 (schema window) |
| GEO-01 | Observe from the business's market | P0 | Plan 2 Q4 | R0 |
| GEO-02 | Country-capable routes for place-bound projects | P1 | Plan 2 Q4 | R1 |
| GEO-03 | Place mix and scope line | P1 | Plan 2 6.3, 9.3 | R1 |
| GEO-04 | Local absence split and distance | P2 | Plan 2 T5 | R3 |
| GEO-05 | In-country location | P2 | Plan 2 12.2 | R3 |
| GEO-06 | Language readiness | P2 | Plan 2 decision 17 | Crawler fixes R1; sets R3 |
| GEO-07 | Google surfaces before local claims | P2 (decision) | Plan 2 decision 14 | R3 decision |
| PL-01 | Lint | P0 | — | R0 |
| PL-02 | Docs drift | P1 | — | R0, then continuous |
| PL-03 | Boot reconciliation | P1 | Plan 2 v2 scheduler | R1 |
| PL-04 | Close legacy runs | P1 | — | R0 |
| PL-05 | SSRF hardening | P1 (P0 before any page fetch) | Plan 2 decision 12 | R1 |
| PL-06 | Error mapping | P1 | — | R0 |
| PL-07 | Collection robustness | P1 | Plan 2 cadence | R1 |
| PL-08 | Upstream quality | P1 | — | R1 |
| PL-09 | Dead code | P2 | — | R3 (table drops in a schema window) |
| PL-10 | Budget and cost ledger | P1 | Plan 2 14.1 | R1 |
| PL-11 | Gemini re-enable criteria | P2 (decision) | Plan 2 decision 14 | R3 |
| PL-12 | Test honesty | P2 | — | R1 |

#### 4.8.1 Methodology and metrics (MS)

**MS-01 · Re-analyze every live run; stamp versions · P0 · SHARED (Plan 2 Q1)**
Problem: 0 `@18` analyses; snapshots show a nonexistent reputation concern and retired findings. Change: with the owner's OK, "Update results" on each completed run (`POST /api/collection-runs/[id]/reanalyse`, additive); show analysis and policy versions on Report, exports and findings. Code: `reanalyse/route.ts`, `snapshots.ts`, `report-view.tsx`, `export.ts`. Depends: :3000 on current code. Versions: superseding snapshots; none new. Cost: 0 answers; 0.5 dd. Done when: every completed run serves `@18`/policy@4 and `scripts/measure-handcheck.ts` prints ALL AGREE on both Atelier October projects, Studio14 and Pipedrive.

**MS-02 · Measure the noise floor · P0 · SHARED (Plan 2 Phase 0)**
Problem: two same-day pairs only; "within range" uncalibrated. Change: re-collect each golden set (Atelier 10, Studio14, Warehouse Gym, Truffles, Pipedrive, Postman) once on another day (6 × 30 = 180 answers); on a third day, ask each Discovery set twice more (6 × 20 = 120), giving every Discovery question 4 looks over 3 days; publish flip rate, Jaccards and sentiment agreement in the method note. This also delivers PR-12 step 1. Code: collection as-is; a read-only script. Depends: MS-01, credit approval. Versions: none. Cost: ~300 answers; 1 dd. Done when: a measured flip rate with interval words "within range".

**MS-03 · Repeat samples within a run · P1**
Problem: schema has `samples_per_prompt` and `prompt_runs.sample_index`, but the orchestrator hard-codes `sampleIndex: 1` and the key ends `|1` (`orchestrator.ts:152,161`). Change: k = 2-3 for Discovery; key on sample index; per-question "named in m of k" and Visibility as the mean per-question rate with a question-clustered range. Code: `orchestrator.ts`, `runner.ts`, `engine.ts` (`buildMetrics`), `precision.ts`, `policy.ts`. Depends: MS-02, MS-04; D2. Versions: METRIC_POLICY bump; sample change is already a break (so it starts with the R2 baseline); no migration. Cost: +10-20 answers a run; 3-4 dd. Done when: a k=3 run shows m-of-k per question and handcheck agrees.

**MS-04 · Cadence approval and "Runs due" · P1 · SHARED (Plan 2 run checklist)**
Problem: operator-started only; nothing can repeat or mature. Change: per-project cadence, provider order and monthly answer cap; the console lists due runs with their answer cost and one "Start due runs" action; an unattended scheduler waits for PL-03 and PL-07. Code: observation console, `orchestrator.ts`. Depends: decision D3. Versions: migration (schema window, D19). Cost: weekly ≈ 130 answers a client a month; 2 dd (scheduler 5+). Done when: due runs show cost and remaining cap.

**MS-05 · Change ledger · P1**
Problem: model swaps, handovers, country changes and lost fields leave no trace. Change: dated per-project events, automatic (versions, sets, handover, observer country, model label lost or changed, field-presence drop) and manual (platform events, seasons, the business's own work); History and comparisons list events in the window. Code: `compare.ts`, `snapshots.ts`, History UI; new `measurement_events` table. Depends: DQ-10. Versions: migration (D19). Cost: 3 dd. Done when: Atelier 10's 15 Oct run shows "handover" and "model not recorded".

**MS-06 · Stricter change claims · P1**
Change: keep Wilson for levels; call a change "moved" only at two-sided Fisher (or per-question paired) p < 0.05, else "within normal variation"; handover and observer-country change are breaks for place-bound before/after claims; "model not recorded" is a caution whenever either side lacks a label. Code: `compare.ts:39-112`, `precision.ts`, `shared.tsx`. Versions: METRIC_POLICY bump. Cost: 1.5 dd. Done when: tests show 0/10→5/10 moved, 2/10→6/10 not, a handover pair a break for a salon.

**MS-07 · Decide the Discovery sample size · P1 (decision)**
Problem: 10 Discovery questions give ±25-30-point ranges; the audit advises 20-30. Change: if approved, a new prompt set with more Discovery questions, other sections at 10. Code: `prompts/coverage-policy.ts`; see PR-04 (section 3.6). Depends: D1. Versions: COVERAGE_POLICY bump; break. Cost: +10-20 answers a run. Done when: decision recorded.

**MS-08 · Per-question consistency · P2**
Change: Questions shows "named in m of r comparable runs" at r ≥ 3, never across a break. Code: `performance-view.tsx`, `measure/service.ts`. Versions: policy bump. Cost: 2 dd.

**MS-09 · Cited vs named · P2**
Change: Discovery matrix of own page cited × target named, with answers per cell (Studio14's three cited-not-named answers); never "influence". Code: `buildSources`, `sources-view.tsx`. Depends: DQ-01, DQ-08. Versions: policy bump. Cost: 1.5 dd.

**MS-10 · By criterion and theme · P2**
Change: group verdicts by `evaluation_criterion` and portrayals by `sentiment_theme`, counts only. Code: `measure/service.ts` (join `prompt_candidates`), `engine.ts`. Versions: policy bump. Cost: 2 dd. Done when: Atelier's price-clarity questions group.

**MS-11 · Sponsored presence line · P2**
Change: "Sponsored cards beside k of n answers (by-name k of n)" with advertisers; rows without an ad field read "not recorded"; never in organic metrics. Peec shows the same fact as an "Ads" column beside its main metrics [DOC]. Depends: DQ-10. Versions: policy bump. Cost: 1 dd. Done when: `crun_a2372971` shows 13 of 30 (10 of 20); the cloro run "not recorded".

**MS-12 · "Named most, not tracked" to Landscape · P1**
Change: untracked names in ≥2 Discovery answers that pass names-checked, flagged when Landscape suggested them before, with "track this" (new set, new baseline). Peec suggests competitor brands mentioned alongside the target at least twice, with mention counts and Track/Reject [DOC]; the same threshold. Code: `buildEmerging`, `lib/landscape`. Depends: DQ-03. Versions: COMPETITOR_DISCOVERY bump; break (tracking additions batch into the R2 baseline). Cost: 3 dd. Done when: Studio14 surfaces Kure (3) and MYGLOW (3, "suggested earlier").

#### 4.8.2 Data quality and accuracy (DQ)

**DQ-01 · Evidenced ownership claims · P0 · SHARED (Plan 2 MVP W1-W2, Q2)**
Problem: ownership only from recorded domains (`citations.ts:34-55`); one domain moves "Your site cited" by 5-14 in 30. Change: registrable-domain claims needing a person's confirmation plus one recorded corroboration (crawled-site link, listing website, same phone or address, DNS/meta token if contested); pending claims show only "if yours, 20 of 30"; platform profiles on a separate "your profiles cited" line; every claim, its evidence and before/after figures in the Report; path prefixes only map rivals' documentation. Peec lets an operator add own and competitor domains, subdomains and social profiles without evidence and reprocesses past chats on save [DOC]; DQ-01 keeps history and requires evidence. Code: `citations.ts` or an engine overlay, `engine.ts`, `snapshots.ts`, `compare.ts`, `sources-view.tsx`; new `ownership_claims` table. Depends: DQ-11, DQ-14; D13. Versions: `measure-policy@5`, lineage field, migration (D19). Cost: 4-5 dd. Done when: a pending claim moves no figure; an evidenced one does and is listed.

**DQ-02 · Rival domain verification · P0 · SHARED (Plan 2 Q3)**
Change: never freeze a failed verification; require the page's place or category to match the rival; cross-check listing `website_url`; prompt the operator when a cited domain spells a rival in ≥2 answers; correct Studio14 and record Postman's rivals. Code: `lib/landscape` verification, `frozen-entities.ts:36`. Depends: DQ-10. Versions: COMPETITOR_DISCOVERY bump; corrected set = break unless DQ-01 maps it. Cost: 3 dd. Done when: a failed verification blocks freeze in a test.

**DQ-03 · Names checked; less noise · P1 · SHARED (Plan 2 Q8)**
Change: a name counts as a business in leaders, findings and Competitors only if tracked, suggested, operator-confirmed, or matched to a listing record or cloro entity; else "plus k names not confirmed"; reject the project's own places; merge branch suffixes. Code: `mentions.ts` (`detectEmergingCandidates`, `cleanOptionName`), `engine.ts` (`leaderOf`, `businessKey`). Depends: DQ-10. Versions: ANALYSIS and METRIC_POLICY bumps. Cost: 3 dd plus the sweep probe. Done when: no place or style name leads any cell in the six audit runs.

**DQ-04 · Sentiment accuracy · P1**
Change: negation scope ("never", clause parity), table cells, opinions whose sentence omits the brand, hedged criticisms, conditional framing; one test per real answer. Code: `sentiment.ts`, `discourse.ts`, `roles.ts`. Depends: DQ-09. Versions: ANALYSIS bump. Cost: 3-4 dd. Done when: labeled cases pass, no correct reading lost.

**DQ-05 · Role and rank accuracy · P1**
Change: hedged recommendations kept with a weak flag (label data decides counting); numbered options rank whatever the lead-in; incidental ordinals give no eligibility; ranks per list; rank a brand named before its item; trace Studio14's eligibility change. Code: `position.ts`, `analyzer.ts`, `discourse.ts`. Versions: ANALYSIS bump (both versions if `AGGREGATABLE_CONFIDENCE` changes). Cost: 3 dd. Done when: "Here are the best X:" and "Top picks for X:" give the same ranks.

**DQ-06 · Comparison accuracy · P1**
Change: credit the chosen side; "To choose between" is no verdict; link verdicts in separate sections; a comparison object must be a business (no "RBAC"); fill null aspects from `evaluation_criterion`, labeled. Code: `comparison.ts`, `analyzer.ts:186-228`. Depends: DQ-03. Versions: ANALYSIS bump. Cost: 3 dd. Done when: Postman's RBAC win disappears.

**DQ-07 · Target aliases · P1**
Change: alias rows for the target from confirmed profile aliases and name forms. Peec's practice of reviewing recent answers for the forms models use, and tracking the shortest unique name [DOC], is the operator habit to pair with it. Code: `analysis/service.ts` (`linkableEntitiesForRun`), `name-forms.ts`. Versions: ANALYSIS bump. Cost: 1 dd.

**DQ-08 · Source hygiene · P1**
Change: map links (google.com/maps, maps.app.goo.gl, Apple Maps) excluded from source metrics and `source_gap`, shown as "map links"; host tables in `source-kind.ts` become versioned per-market data (fresha, salonsindubai, justdial). Code: `source-kind.ts`, `buildSources`, `buildOpportunities`. Versions: METRIC_POLICY bump. Cost: 1.5 dd. Done when: Atelier's 12 map-link answers leave the source list.

**DQ-09 · Blind labeling and handcheck · P0 · SHARED (Plan 2 Phase 0)**
Change: the plan in section 4.3.1; labels as gold/holdout fixtures in `tests/fixtures/analysis/`; extend `measure-handcheck.ts` to policy@4/@5 blocks. Depends: MS-01. Cost: ~3 operator-days + 1 dd. Done when: per-field accuracy with lower bounds is in the method note and gates DQ-03 to DQ-07.

**DQ-10 · Payload readers and field-presence monitor · P1**
Change: an additive, versioned extractor (e.g. `payload-extract@1`) reads artifacts for fan-out queries, ads, local records, citation titles/positions, follow-up forms, cloro entities and inline citations; each run records field presence and warns on drops. Code: service-level reader over `evidence-store/<project>/artifacts/*.payload.json`, stored in `NormalizedObservation`. Versions: ANALYSIS bump; no migration. Cost: 4-5 dd. Done when: stored runs reproduce 359/393 queries, 33 ads, 9/26 maps.

**DQ-11 · Crawl gaps are not site gaps · P1**
Change: on `empty_body` for selected page types, retry with the trailing slash and the browser fallback; "Not stated on the site" warnings say "could not read" when the page failed; store outbound registrable domains as ownership evidence. Code: `lib/crawler`, `playwright-fallback.ts`, `lib/profile`. Depends: PL-05. Cost: 2 dd. Done when: atelier10.ae `/hair/` is read with words.

**DQ-12 · Honest search state and model · P2**
Change: adapters return off/unknown honestly; drop the "answers without search are least stable" caveat for forced routes; "model not recorded" visible. Code: `oxylabs/client.ts:149-150,211`, `cloro/client.ts:155-167`, `policy.ts:217-222`. Versions: adapter version. Cost: 0.5 dd.

**DQ-13 · Legacy Measure clean-ups · P2**
Change: emerging list from Discovery only (or labeled by section); stop `scripts/reanalyse.ts` duplicating v1 rows or retire it; show non-404 API errors. Code: `engine.ts:680-695`, `scripts/reanalyse.ts`, measure `page.tsx`. Versions: policy bump. Cost: 1.5 dd.

**DQ-14 · One primary project per business · P2 · SHARED**
Change: key claims and history to the registrable domain; one primary project, banners on the rest. Versions: migration (D19). Cost: 2 dd. Done when: atelier10.ae's 12 projects show one primary.

#### 4.8.3 Geography (GEO)

**GEO-01 · Observe from the business's market · P0 · SHARED (Plan 2 Q4)**
Change: intake hint, else the confirmed profile's market-area country, else the default; when ≥half the answers come from outside the business country, withhold place cells and findings with a banner; re-collect Empire from IN. Code: `orchestrator.ts:520-529`, `engine.ts`, `overview-view.tsx`. Cost: 1 dd + 30 answers. Done when: a "detect from website" Indian project is observed from IN.

**GEO-02 · Country-capable routes for place-bound projects · P1**
Change: skip routes that cannot honor the country (Decodo) in handover for place-bound kinds; record `countrySource` in lineage. Code: `runner.ts`, `providers/catalog.ts`. Cost: 1 dd. Done when: a simulated Decodo handover for a Dubai salon stops with a typed reason.

**GEO-03 · Place mix and scope line · P1**
Change: "k of 10 questions name your district, m your city" beside Discovery figures; Report and exports carry "ChatGPT on the web, signed out, asked from <country>, English questions"; place claims only from place-named questions; summaries never say "customers in <city>" or "across AI search". Code: `summary.ts`, `overview-view.tsx`, `report-view.tsx`, `policy.ts`. Versions: policy bump. Cost: 1.5 dd.

**GEO-04 · Local absence split and distance · P2**
Change: per absent Discovery answer with local records: not retrieved / retrieved, not named / cited, not named; distance to named businesses; counts only. Depends: DQ-10, DQ-03. Cost: 2 dd. Done when: Studio14's luxury answer reads "retrieved, not named".

**GEO-05 · In-country location · P2**
Change: store places named in fan-out queries as an "implied location" note; ask providers whether city or coordinate targeting exists [UNAVAILABLE]; never claim a city-level observer. Depends: DQ-10. Cost: 1 dd.

**GEO-06 · Language readiness · P2**
Change: fix non-Latin dedupe (`text/similarity.ts`) and sentence splitting (`evidence/builder.ts`) now; Arabic or Hindi sets later, as new baselines (PR-15). Cost: 2 dd.

**GEO-07 · Google surfaces before local claims · P2 (decision)**
Change: decide on Gemini or a Google AI surface before selling local visibility; meanwhile listing wording says "correlation only on ChatGPT". Depends: PL-11; D17.

#### 4.8.4 Platform and other (PL)

**PL-01 · Lint · P0** — add `data/**` to `eslint.config.mjs` ignores; done when lint reports 0 errors. 0.1 dd.

**PL-02 · Docs drift · P1** — fix the drift listed in section 4.7, banner stale docs, regenerate or slim `AGENTS.md`/`.agents/skills`, fix the `mock-vendors.ts` header, delete fixed KNOWN_ISSUES entries. 1 dd.

**PL-03 · Boot reconciliation · P1** — mark orphaned crawls, partial profile versions, running discovery runs and generating prompt sets as interrupted with retry; prerequisite for a scheduler. 2 dd.

**PL-04 · Close legacy runs · P1** — with the owner's OK, close the 14 `active` API-lane runs via "Finish with what's collected" (keeping retired labels) and fail the stranded crawl through the app; never delete. 0.5 dd.

**PL-05 · SSRF hardening · P1 (P0 before any page fetch)** — route robots, sitemap and Playwright through the guard; host-restrict sitemap children; block the IPv6 ranges; pin resolved IPs; auth on credentials if ever off localhost. Required for DQ-11 and any cited-page fetch. 3 dd.

**PL-06 · Error mapping · P1** — JSON `SyntaxError` → 400; typed 4xx for run creation, including the older-approved-set case. 1 dd.

**PL-07 · Collection robustness · P1** — persist vendor health and progress; a per-data-dir runner lock; one transaction for insert and `succeeded`; a retry action showing `lastError`; keep `paused`. 3-4 dd; prerequisite for any cadence.

**PL-08 · Upstream quality · P1** — block confirming `failed` profiles; check `confirmedAt` at freeze; transactional, project-scoped PATCH; retailer vs marketplace typing; word-boundary topic neutralizing; "Apr" not finance; tolerate one bad AI item; cap unverified scores. COMPETITOR_DISCOVERY bump where discovery changes. 4 dd.

**PL-09 · Dead code · P2** — remove retired clients, `GeminiProfileProvider`, unused LLM stages, stale capability gates; drop `jobs` and `is_fixture` in a schema window (D19). 1.5 dd.

**PL-10 · Budget and cost ledger · P1** — monthly answer budget per project and provider (with MS-04); show remaining trial and credits where reported; persist the LLM ledger for Landscape and Prompts. 2 dd.

**PL-11 · Gemini re-enable criteria · P2 (decision)** — an approved budget (6 cloro credits an answer, ~180 a run; note the runner budgets 7 credits for Gemini per `CLAUDE_MEMORY_AUDIT.md`, so check `collection/runner.ts` LANES first); a person-reviewed same-day check of 30 prompts; country honored; copy-guard and per-engine scopes verified; then `SUN_ENGINES=chatgpt,gemini` (an engine change is a break). Depends: D17.

**PL-12 · Test honesty · P2** — `full-pipeline.test.ts` must approve, collect and measure; fix the mobile CTA and redirect-race e2e tests. 1.5 dd.

## 5. Integrated refinement roadmap

All of this section is a proposal [INFERRED]. It sequences the 65 items (PR-01 to PR-20, MS-01 to MS-12, DQ-01 to DQ-14, GEO-01 to GEO-07, PL-01 to PL-12) so that stored data is re-analyzed once per analysis bundle, metric definitions change once per policy bundle, and **each live project's prompt instrument breaks comparability exactly once** (R2). Effort figures are the developer-day (dd) estimates from section 4.8, summed [INFERRED]; PR items carry no effort estimate yet.

### 5.1 Phase overview

| Phase | Goal | Items | Breaks a baseline? | Answers / spend | Effort (MS/DQ/GEO/PL only) |
|---|---|---|---|---|---|
| **R0** Hygiene, measurement gate and calibration | Make today's numbers trustworthy and measure how noisy they are, without changing the instrument | PL-01, PL-02, PL-04, PL-06, MS-01, DQ-09, DQ-02 (code), GEO-01, MS-02 (= PR-12 step 1), PR-18 (baseline), PR-20 (validators, lifecycle, token boundaries, stranded sets), PR-08 (audit from stored fields), PR-10 (stored-data comparison only), PR-02 (derived backfill view only); evidence prepared for the CP1 decisions (section 5.5) | No (re-analysis supersedes snapshots at new versions, which is already an expected break between versions) | MS-02 ~300 answers; GEO-01 30 answers; PR-18 about $0.10 per business per run (17 businesses ≈ $1.70) | ~9 dd + ~3 operator-days |
| **R1** Analysis accuracy, metric policy, prompt metadata, platform robustness | Fix how answers are read and counted; type every prompt; make collection durable enough for a cadence | Schema window (D19); **A1** analysis bundle: DQ-10, DQ-03, DQ-04, DQ-05, DQ-06, DQ-07, PR-08 classifier → `observation-analysis@19`; **A2** policy bundle: DQ-01, PR-05, MS-06, DQ-08, GEO-03 (with GEO-01's banner), MS-09, MS-10, PR-11 (Measure grouping), MS-11, DQ-13, PR-08 eligibility (if approved), MS-05 display → `measure-policy@5`; DQ-12, GEO-02 (adapter/lineage); DQ-14, MS-04, MS-05, PL-10; PL-03, PL-05, DQ-11, PL-07, PL-08, PL-12, GEO-06 (crawler part), MS-12 (surface only); prompt side: PR-02, PR-06 parts 4-5, PR-07, PR-17, PR-19 (words not keys, lint, flags), PR-20 index; PR-01 capture UI optional | No new prompt-set baseline. Re-analysis at `@19` and re-snapshot at policy@5 are one version break per run, applied once | No new answers required (verification uses stored answers and isolated copies) | ~62-67 dd plus the sweep probes |
| **R2** Instrument v2: one new baseline | Ship every change that alters prompt sets or competitive sets together, then collect new baselines | PR-01, PR-03, PR-04 / MS-07 (if approved), PR-06 parts 1-3, PR-09, PR-10 (+ PR-20 cap relaxation), PR-11 (generation binding), PR-12 (frozen alternates), PR-14 (drop template labels), PR-19 (matrix, pool view, test ask), MS-03 (if D2 adopts repeats), MS-12 "track this" additions, DQ-02 corrections not mapped by DQ-01; parallel track outside the headline: PR-13 Accuracy and Validation probes | **Yes, once per project**: new `prompt-context`, `discovery`, `intent-model`, `prompt-selection` (and sample count) versions; recorded in the change ledger | Generation ≈ $0.10-0.15 per business; baselines 30-40 answers per project (+10-20 if repeats or alternates); probes 6-10 (Accuracy) or 2-4 per attribute (Validation) | MS-03 3-4 dd; PR items unestimated |
| **R3** Engines, geography and languages | Add instruments that are separate baselines, and the slower diagnostics | PL-11 / GEO-07 (decision D17), PR-15 / GEO-06 sets (D18), PR-13 Market perception and alternatives, PR-14 B2B persona probes, PR-16 (D11), MS-08 (after ≥3 comparable runs), GEO-04, GEO-05, PL-09 | Each engine or language is its own instrument; enabling Gemini is an engine change (a break for cross-run comparisons) | Gemini ~180 cloro credits a run (6 credits × 30; check the runner's 7-credit budget); a language set doubles answers for its project | ~6.5 dd (MS-08, GEO-04, GEO-05, PL-09) plus PR items |
| **Continuous** | Keep docs and known issues honest | PL-02 updates; delete fixed `KNOWN_ISSUES.md` entries; dated status lines in this plan | — | — | — |

### 5.2 Item index

Every item, where it lands, what it bumps and what it waits for. "Bumps" lists version constants or a migration; "—" means none.

| ID | Title | Priority | Phase | Bumps | Breaks baseline? | Depends on |
|---|---|---|---|---|---|---|
| PR-01 | Attribute model driving prompts | P1 | R2 (capture may land in R1) | prompt-context, COVERAGE, INTENT_MODEL | Yes (new sets) | Profile versioning, topic confirm |
| PR-02 | Full metadata on every prompt | P0 | R1 (derived backfill R0) | Migration if a column (D19) | No | PR-03, PR-06, PR-09, PR-11 consume it |
| PR-03 | Coverage matrix and categorization | P1 | R2 | COVERAGE | Yes | PR-01, PR-02, PR-04, D9 |
| PR-04 | Discovery count vs the 30 constraint | P0 decision, P1 build | CP1 decision; R2 build | COVERAGE (`prompt-selection@6-…`) | Yes | D1; budget; PR-18 baseline |
| PR-05 | Branded vs unbranded separation everywhere | P0 | R1 (A2) | METRIC_POLICY | Policy version only | PR-02 |
| PR-06 | Place wording and geography levels | P0 | CP1 decision; R1 parts 4-5; R2 parts 1-3 | prompt-context, DISCOVERY | Yes (parts 1-3) | D5; GEO-01, GEO-03, GEO-05; PR-18 baseline |
| PR-07 | Ambiguity and vague-term lint | P1 | R1 | — | No | PR-19 |
| PR-08 | Post-run prompt-format audit | P0 | R0 (stored fields); R1 classifier | ANALYSIS (classifier), METRIC_POLICY (eligibility) | No | PR-17 |
| PR-09 | Attribute-conditioned and long-tail Discovery | P1 | R2 | DISCOVERY, COVERAGE | Yes | PR-01, PR-02, PR-08, D6 |
| PR-10 | Trade Offs as true Competitor prompts | P1 | R0 comparison; R2 build | COVERAGE | Yes | PR-02, DQ-06, D7 |
| PR-11 | Sentiment by attribute and theme | P1 | R1 (Measure, via MS-10); R2 (generation) | METRIC_POLICY | Policy version; new sets for binding | PR-02 |
| PR-12 | Rewordings, prompt groups, repeat sampling | P1 (noise floor P0) | R0 (via MS-02); R2 alternates | Migration for `wordingGroupId` (D19); METRIC_POLICY for group reads | No for headline | MS-02, D4, credits |
| PR-13 | Diagnostic probes outside the frozen set | P1 / P2 | R2 track (Accuracy, Validation); R3 (others) | ANALYSIS (new types); migration for run kind (D19) | No | PR-01, D10, credits |
| PR-14 | Persona handling | P2 | R2 (labels); R3 (probes) | — (new sets) | Yes (with R2) | PR-13, D8 |
| PR-15 | Arabic and Hindi baselines | P2 | R3 | Separate instrument | Separate baseline | GEO-06, D18 |
| PR-16 | Demand signals and limits | P2 | R3 | — | No | Search Console, D11 |
| PR-17 | Refresh, versioning, partial comparability | P1 | R1 | METRIC_POLICY (compare rules); migration if a column | Defines breaks | D12 |
| PR-18 | Golden-set evaluation of prompt quality | P0 | R0, then every phase | — | No | Paid-call approval |
| PR-19 | Prompts-stage QA and review UX | P1 | R1; R2 matrix and test ask | — | No | PR-02, PR-03, PR-07, PR-08 |
| PR-20 | Close known gate holes and review defects | P0 | R0; index R1; caps R2 | Migration (index); COVERAGE (caps) | No for approved sets | PL-03 (shared recovery code) |
| MS-01 | Re-analyze every live run; stamp versions | P0 | R0 | — (supersedes snapshots) | Version break per run, as designed | Owner OK |
| MS-02 | Measure the noise floor | P0 | R0 | — | No | MS-01, credits |
| MS-03 | Repeat samples within a run | P1 | R2 | METRIC_POLICY; samples (already a break) | Yes (with R2) | MS-02, MS-04, D2 |
| MS-04 | Cadence approval and "Runs due" | P1 | R1 | Migration (D19) | No | D3; PL-03, PL-07 before a scheduler |
| MS-05 | Change ledger | P1 | R1 | Migration (D19) | No | DQ-10 |
| MS-06 | Stricter change claims | P1 | R1 (A2) | METRIC_POLICY | Policy version | — |
| MS-07 | Decide the Discovery sample size | P1 (decision) | CP1; R2 | COVERAGE | Yes | D1 (same as PR-04) |
| MS-08 | Per-question consistency | P2 | R3 | METRIC_POLICY | Policy version | ≥3 comparable runs |
| MS-09 | Cited vs named | P2 | R1 (A2) | METRIC_POLICY | Policy version | DQ-01, DQ-08 |
| MS-10 | By criterion and theme | P2 | R1 (A2) | METRIC_POLICY | Policy version | PR-02 |
| MS-11 | Sponsored presence line | P2 | R1 (A2) | METRIC_POLICY | Policy version | DQ-10 |
| MS-12 | "Named most, not tracked" to Landscape | P1 | R1 (surface); R2 (tracking) | COMPETITOR_DISCOVERY | Yes when tracked (R2) | DQ-03 |
| DQ-01 | Evidenced ownership claims | P0 | R1 (first) | METRIC_POLICY; migration (D19) | Policy version (overlay, not a new set) | DQ-11, DQ-14, D13 |
| DQ-02 | Rival domain verification | P0 | R0 (code); corrections via DQ-01 or R2 | COMPETITOR_DISCOVERY | Yes for corrected sets unless mapped | DQ-10 (listing cross-check) |
| DQ-03 | Names checked; less noise | P1 | R1 (A1, A2) | ANALYSIS, METRIC_POLICY | Version break | DQ-10 |
| DQ-04 | Sentiment accuracy | P1 | R1 (A1) | ANALYSIS | Version break | DQ-09 |
| DQ-05 | Role and rank accuracy | P1 | R1 (A1) | ANALYSIS | Version break | DQ-09 |
| DQ-06 | Comparison accuracy | P1 | R1 (A1) | ANALYSIS | Version break | DQ-03 |
| DQ-07 | Target aliases | P1 | R1 (A1) | ANALYSIS | Version break | — |
| DQ-08 | Source hygiene | P1 | R1 (A2) | METRIC_POLICY | Policy version | — |
| DQ-09 | Blind labeling and handcheck | P0 | R0 | — | No | MS-01 |
| DQ-10 | Payload readers and field-presence monitor | P1 | R1 (A1, first) | ANALYSIS | Version break | D15 |
| DQ-11 | Crawl gaps are not site gaps | P1 | R1 | — | No | PL-05 |
| DQ-12 | Honest search state and model | P2 | R1 | Adapter version | Caution only | — |
| DQ-13 | Legacy Measure clean-ups | P2 | R1 (A2) | METRIC_POLICY | Policy version | — |
| DQ-14 | One primary project per business | P2 | R1 | Migration (D19) | No | — |
| GEO-01 | Observe from the business's market | P0 | R0 (banner in A2) | — | Observer-country change is a caution (a break for place-bound claims after MS-06) | Credits for Empire re-collection |
| GEO-02 | Country-capable routes for place-bound projects | P1 | R1 | Lineage field | No | — |
| GEO-03 | Place mix and scope line | P1 | R1 (A2) | METRIC_POLICY | Policy version | PR-06 (mix), GEO-01 |
| GEO-04 | Local absence split and distance | P2 | R3 | — | No | DQ-10, DQ-03 |
| GEO-05 | In-country location | P2 | R3 | — | No | DQ-10 |
| GEO-06 | Language readiness | P2 | R1 (crawler); R3 (sets) | — | No | — |
| GEO-07 | Google surfaces before local claims | P2 (decision) | R3 | — | — | PL-11, D17 |
| PL-01 | Lint | P0 | R0 | — | No | — |
| PL-02 | Docs drift | P1 | R0, continuous | — | No | — |
| PL-03 | Boot reconciliation | P1 | R1 | — | No | — |
| PL-04 | Close legacy runs | P1 | R0 | — | No | Owner OK, D14 |
| PL-05 | SSRF hardening | P1 (P0 before any page fetch) | R1 | — | No | — |
| PL-06 | Error mapping | P1 | R0 | — | No | — |
| PL-07 | Collection robustness | P1 | R1 | — | No | — |
| PL-08 | Upstream quality | P1 | R1 | COMPETITOR_DISCOVERY | No (new discovery runs only) | — |
| PL-09 | Dead code | P2 | R3 (drops in a schema window) | Migration (D19) | No | — |
| PL-10 | Budget and cost ledger | P1 | R1 | — | No | MS-04 |
| PL-11 | Gemini re-enable criteria | P2 (decision) | R3 | Engine set | Yes (engine change) | D17, budget |
| PL-12 | Test honesty | P2 | R1 | — | No | — |

### 5.3 Items that must ship together

| Bundle | Constant or change | Items | Why together | Operator effect |
|---|---|---|---|---|
| **A1 Analysis** | `ANALYSIS_VERSION` `@18` → next (`@19`) | DQ-10 (first: readers validate names, D15), DQ-03, DQ-04, DQ-05, DQ-06, DQ-07, PR-08's clarification classifier | Every analyzer change forces "Update results" on every run; one bump means one re-analysis and one version break per run. Bump both versions if `AGGREGATABLE_CONFIDENCE` changes (DQ-05) | One "Update results" per run |
| **A2 Metric policy** | `METRIC_POLICY_VERSION` `@4` → next (`@5`, the version Plan 2 names for the ownership overlay) | DQ-01, PR-05, MS-06, DQ-08, GEO-03 (with GEO-01's banner), MS-09, MS-10 + PR-11 (Measure side), MS-11, DQ-13, PR-08 eligibility (if approved), MS-05 display, DQ-03's metric part, PR-17 compare rules | Definitions travel with numbers; a policy bump alone does not rewrite snapshots until runs are re-analyzed or re-finalized, so ship A1 and A2 together and re-snapshot once | One re-snapshot per run (with A1) |
| **A3 Schema window** (D19) | Migrations | DQ-01 (`ownership_claims`), MS-05 (`measurement_events`), MS-04 (cadence fields), DQ-14 (primary project), PR-02 (facet column, if used), PR-17 (`promptKey`), PR-12 (`wordingGroupId`), PR-13 (run kind / purpose), PR-20 (unique (projectId, version) index); PL-09 drops (`jobs`, `is_fixture`) if ready | Editing `schema.ts` breaks queries in a running dev server until it restarts and migrates; one agreed window, rehearsed on an isolated copy | One coordinated restart of the user's server |
| **B Instrument v2** | `PROMPT_CONTEXT_POLICY_VERSION` → `prompt-context@3`; `DISCOVERY_POLICY_VERSION` → next; `INTENT_MODEL_VERSION` → next; `COVERAGE_POLICY_VERSION` → `prompt-selection@6-<split>`; samples per question if MS-03 | PR-01, PR-03, PR-04 / MS-07, PR-06 parts 1-3, PR-09, PR-10 + PR-20 caps, PR-11 binding, PR-12 alternates, PR-14, MS-03, MS-12 tracked rivals and unmapped DQ-02 corrections (new competitive set) | Each of these alone is a full comparability break; bundling means each project's trend resets once, recorded in the change ledger with its reason | Regenerate, review, approve, collect a new baseline per project |
| **C Later policy** | `METRIC_POLICY_VERSION` next after A2 | MS-03 metrics (m of k, clustered range) if not in B, PR-12 group reads, MS-08 | Small, can ride B or follow it | Re-snapshot |
| **D Competitor discovery** | `COMPETITOR_DISCOVERY_POLICY_VERSION` `@6` → next | DQ-02 (R0, alone if urgent), then PL-08 and MS-12 together (R1) | Affects only new discovery runs; frozen sets are unchanged, so two bumps are acceptable | None for existing projects |
| **E Adapters and lineage** | Adapter versions; lineage fields | DQ-12, GEO-02 (`countrySource`) | Recorded per answer; caution-level only | None |
| **F Separate instruments** | New baselines, never breaks of the English ChatGPT set | PR-15 language sets; PR-13 probe runs; PL-11 Gemini (an engine change, which `compare.ts` treats as a break for cross-run comparisons that pool engines) | Never pooled with the headline | Each needs its own approval and budget |

### 5.4 Phase details, dependencies and validation

#### R0: hygiene, measurement gate and calibration

- **Order.** PL-01 → PL-02 (docs that mislead the next session first) → PL-06 → with the owner's OK, PL-04 and MS-01 on the live data (rehearse both on an isolated copy first) → DQ-09 (labels need `@18` analyses) → DQ-02 code fix → GEO-01 (code, then Empire re-collection with approval) → MS-02 (credits approved; on an isolated copy unless the owner wants the runs in the live DB) → PR-18 baseline report → PR-20 validator, lifecycle and token-boundary fixes → PR-08 audit from stored fields → PR-10 stored-data comparison of undecided share by form → PR-02 derived backfill view. Also verify progressive results page by page (section 1.5) and record the result here.
- **Validation.** Targeted vitest per area; `npm run typecheck`; `npm run lint` must reach 0 errors after PL-01; `scripts/measure-handcheck.ts` prints ALL AGREE on both Atelier October projects, Studio14 and Pipedrive after MS-01; blind labels per section 4.3.1 with per-field accuracy and Wilson lower bounds in the method note; MS-02 publishes flip rate, Jaccards and sentiment agreement; PR-18 baseline report on the 17 golden businesses with scratch `SUN_DATA_DIR` and `SUN_EVIDENCE_DIR` (the script refuses `./data`). Follow `sun-validate`: isolated data dir, evidence dir, dist dir and port.
- **Exit (checkpoint CP1).** Q1, Q3 and Q4 clear for the golden projects; noise floor published; PR-18 baseline exists; PR-10 comparison published.

#### R1: analysis accuracy, metric policy, prompt metadata, platform robustness

- **Order.** Schema window (A3) → DQ-01 and DQ-14 → A1 analysis bundle (DQ-10 first, then DQ-03, DQ-04, DQ-05, DQ-06, DQ-07, PR-08 classifier), each fix tested against DQ-09 labels → A2 policy bundle → one re-analysis and re-snapshot of every completed run. In parallel: PL-03 and PL-07 (prerequisites for MS-04's due-runs list to be trusted), PL-05 then DQ-11, PL-08, PL-12, GEO-02, GEO-06 crawler fixes, MS-04, MS-05, PL-10, DQ-12, MS-12 surfacing. Prompt side: PR-02 facets, PR-17 keys, PR-07 lint, PR-19 words-not-keys panel, PR-06 parts 4-5 (short-form lint, observer metadata and city-less by-name flags), PR-20 index, optional PR-01 capture UI.
- **Validation.** Per `sun-measurement-change`: the analyzer sweep probe over the stored consumer-web answers before and after (the 2026-11-09 audit's sweep covered 390 answers), handcheck ALL AGREE, labeled fixtures pass with no correct reading lost, "Done when" criteria of each item; copy-guard test; migration rehearsed on an isolated copy and an isolated `npm run build` (`NEXT_DIST_DIR` not the user's); e2e on an isolated port (compare against a baseline before calling an e2e failure a regression); Plan 2's six worked examples recomputed on stored data as a cross-check if Plan 2 is active.
- **Exit (checkpoint CP2).** Every completed run serves A1/A2 versions; Q2 and Q8 resolvable; per-field accuracy meets the release rule or the misses are reported; R2 contents and the baseline date per project decided.

#### R2: instrument v2 (one new baseline)

- **Order.** PR-01 (attributes and priority) → PR-06 parts 1-3 (competing level and place mix) → PR-03 (coverage targets) with PR-04's count → PR-09 and PR-10 (with PR-20 caps) → PR-11 binding, PR-14 label removal → PR-12 alternates frozen at approval → MS-12 and DQ-02 competitive-set changes → regenerate on isolated copies of the golden projects → review → approve → collect baselines (approval) → MS-03 if adopted. PR-13 Accuracy and Validation probes may run in parallel once the run kind exists, because they never touch the headline.
- **Validation.** Per `sun-prompt-quality`: read every generated prompt for at least six materially different business kinds (not only salons or Nike; include B2B software, a restaurant, a global ecommerce brand, a regulated business), judging realism, neutrality, place wording and type fit; PR-18 deltas against the R0 baseline (zero leakage; matrix minimums met or stated; place mix within ±1; by-name prompts with city 100%; label-style audiences 0); blind human labels on about 150 prompts and judge agreement before any `JUDGE_SYSTEM` change; `SUN_BASE=<isolated> SUN_SKIP_OBSERVE=1 npx tsx scripts/e2e-journey.ts <url>` on an isolated server; then, with approval, one collected run per golden project and one repeat (MS-02 style) to recalibrate the noise floor for the new instrument.
- **Exit (checkpoint CP3).** Owner approves instrument v2 for live projects; each project's break is recorded in the change ledger (MS-05) with its reason.

#### R3: engines, geography and languages

- **Order.** Decisions first (D17 Gemini or Google; D18 languages; D10 probe order; D11 demand; D8 persona probes), then each as its own instrument: PL-11 checklist (budget, person-reviewed same-day check of 30 prompts, country honored, copy guard and per-engine scopes); PR-15 one-project pilot after GEO-06; PR-13 Market perception and alternatives; PR-14 B2B persona probes; PR-16 ordinal hints; MS-08 after three comparable runs; GEO-04, GEO-05; PL-09.
- **Validation.** Gemini: same-day 30-prompt check read by a person; language sets: native-speaker review and transliteration leakage tests; probes: the unit test that no probe answer reaches a Measure denominator, and accuracy verdicts ≥95% against hand labels.

### 5.5 Decision checkpoints

| Checkpoint | When | Owner decides | Evidence in hand |
|---|---|---|---|
| **CP0** Start | Before R0 | Go-ahead for R0; OK to run "Update results" (MS-01) and close legacy runs (PL-04, D14) on live data; credits for MS-02 (~300 answers) and the Empire re-collection (30); paid golden evaluation (PR-18) | This plan; section 2 |
| **CP1** End of R0 | After the noise floor and baselines | D1 Discovery count; D2 repeats vs questions; D3 cadence and budget; D4 rewordings; D5 competing level; D7 explicit-ask Trade Offs; D9 intent mix; D12 refresh cadence; D13 ownership overlay; D15 readers first; D16 cloro search-query flag; D19 schema window date | Noise floor; PR-10 comparison; PR-18 baseline; labels |
| **CP2** End of R1 | After A1/A2 re-analysis | R2 contents and baseline date per project; generation spend; baseline collection credits; D6 attribute-conditioned Discovery; D8 persona; D20 meaning of local records | Label accuracy; re-analyzed Measure; PR-08 flags |
| **CP3** After R2 golden validation | Before live regeneration | Approve instrument v2 for live projects; D10 probe order; D17 Gemini or Google; D18 language pilot; D11 demand signals | PR-18 deltas; blind labels; golden baselines |

### 5.6 Guardrails for every phase

- No new journey stage, no Observe or collect page, no Actions layer (Plan 2 is separate and needs its own scope decision).
- No collection vendor named in any page, export or method note (copy-guard test); engines only "ChatGPT" and "Gemini"; never "licensed".
- No composite score, prompt volume, impressions, dollar value, 0-100 sentiment or headline rank position.
- No paid spend or credit use without explicit approval; the app keeps working with no keys.
- No hardcoded brands, competitors, prompts or metric values in `src/`; measuring-stick lists live in `benchmarks/` or `scripts/`.
- Never mutate frozen or approved artefacts; create new versions; responses and analyses stay append-only.
- Never touch the user's :3000 server or `data/sun.db` outside approved actions; never run bare `next build`; never rebuild `.next-build` while the user's `npm start` serves it; snapshot before wide edits (no git).

## 6. Open decisions and questions

Merged from the prompt and Measure research parts and de-duplicated. Every lean is our proposal [INFERRED]; the product owner decides. Record each decision in its row with a date; never delete a row. "Plan 2" references point to Plan 2 section 16 unless stated.

| # | Decision | Items | Options | Lean | What would change it | Plan 2 link |
|---|---|---|---|---|---|---|
| D1 | Discovery count and the 30-prompt constraint | PR-04, MS-07 | (A) 10/10/10 at 30, precision via repeats; (B) 20/5/5 at 30; (C) 20/10/10 at 40; (D) 30/10/10 at 50 | (C) as measurement set v2, a new set after MS-01/MS-02, Discovery allocated by priority; if 30 is held, (A) plus repeats with Discovery labeled directional. 10/10/10 is a deliberate operator decision, so present this once | 30 held as a product promise; tighter credits; prompt quality drops at 20 Discovery prompts (PR-18 shows it); budget | Decision 5 |
| D2 | Repeats vs more questions | MS-03, PR-04 | k=3 on 10 Discovery questions; k=1 on 20-30 | More questions for levels; repeats for checks | MS-02 shows high per-question variance with stable set rates | Decision 3; section 11 |
| D3 | Cadence and answer budget | MS-04, PL-10 | Operator-started (today); fortnightly (~65 answers a client a month); weekly (~130) | One noise-floor round now (~300 answers), then fortnightly on a paid Oxylabs plan ($30 minimum); weekly by approval | A measured flip rate well under 1 in 10 | Decision 3 |
| D4 | Rewordings in slots or in samples | PR-12 | Paraphrase slots inside the set; frozen alternates in the sampling layer | Sampling layer (alternates feed stability reads only); Peec's docs also reserve variations for the most important prompts | The noise floor shows wording dominates run-to-run variation | Decision 15 |
| D5 | Where each business competes | PR-06 | Market-area default; per business; per P1 topic | Per business with defaults; per topic only for multi-area businesses | Owners cannot answer (then default and label) | — |
| D6 | Attribute-conditioned Discovery | PR-09 | Never; with anchoring; freely | With anchoring plus the post-run concentration audit | The audit shows they name only the target | — |
| D7 | Require explicit-ask Trade Offs | PR-10 | Keep forms; require for half | Decide after the stored-data comparison | No difference by form | — |
| D8 | Persona in the headline | PR-14 | A persona dimension; situation-in-passing only | Situation only; B2B persona probes | Owners report segment-dependent decisions | — |
| D9 | Intent mix inside Discovery (new 2026-11-10, from Peec's docs) | PR-02, PR-03 | Commercial "recommend options" only (today); a declared purchase or visit share for place-bound kinds; a Peec-style mix including informational asks (Peec default 25/50/25) | No informational asks in the headline (they belong to Market perception probes, PR-13); consider a declared purchase or visit share for place-bound kinds inside PR-03 | PR-08 shows transactional wording returns business lists as reliably as recommendation wording, or owners say booking-intent questions matter most | — |
| D10 | First probes | PR-13 | Accuracy; Validation; Market perception | Accuracy, then Validation with repeats | Repeated wrong facts (Accuracy up); repeated P1 Discovery absence (Validation up) | Decision 15 |
| D11 | Demand data | PR-16 | None; ordinal Search Console hints; modeled volume | Ordinal Search Console hints only | An auditable licensed source | Decision 16 |
| D12 | Refresh cadence of the prompt set | PR-17 | On change; quarterly; monthly | On change plus a quarterly review | Frequent PR-08 flags or market shifts | — |
| D13 | Ownership: overlay or re-freeze | DQ-01 | Evidenced overlay (next metric policy); a new competitive set (a break) | Overlay; pending claims "what if" only | A client disputes a recount | Decision 4 |
| D14 | The 14 legacy `active` runs | PL-04 | Finish; leave; hide | Finish, keep retired labels; never delete | Owner wants them live | — |
| D15 | Payload readers before analyzer fixes | DQ-10; DQ-03 to DQ-07 | Readers first; fixes first | Readers first: they validate names | Payload formats keep changing | Section 12.2 |
| D16 | cloro search-query flag (+2 credits an answer) | DQ-10, GEO-05 | Off; on for local | On for place-bound projects once a checklist exists | Oxylabs restores fan-out queries | Smaller decisions (16) |
| D17 | Gemini or Google surfaces | PL-11, GEO-07 | ChatGPT only; Gemini; Google first | ChatGPT until MS-01/MS-02; decide Google before any local claim | Prospects ask first | Decision 14 |
| D18 | Arabic or Hindi | PR-15, GEO-06 | English only, stated on the scope line; parallel baselines | English stated on the scope line, plus a one-project pilot after GEO-06 | Evidence that most inquiries are in Arabic or Hindi | Decision 17 |
| D19 | Schema-change window | MS-04, MS-05, DQ-01, DQ-14, PR-02, PR-12, PR-13, PR-17, PR-20, PL-09 | An agreed window; an isolated copy | Both, batched (bundle A3) | None; prerequisite | Decision 6 |
| D20 | Meaning of Oxylabs local records | GEO-04, DQ-03 | Retrieved set; shown set | Retrieved, labeled as our reading | Vendor docs or a side-by-side | — |

**Decision log** (add dated lines here): none yet as of 2026-11-10.

## 7. Sources

Merged and de-duplicated from both research parts. `R` = the session temp folder `/private/tmp/claude-501/-Users-sreekarreddy-Sun-Project-project-sun-phase2-app-v2/3407c037-9d38-4ead-9946-69866fde5bed/scratchpad/recover` (**not persisted**; kept for traceability). Persistent copies of the design documents are listed where they exist.

| Source | Label | Date | URL or file path |
|---|---|---|---|
| Profound, AEO Guide ch. 1-4 | DOC | undated (≥ mid-June 2026); fetched 2026-11-10 | https://www.tryprofound.com/aeo-guide/chapter-1 (… chapter-4); `R/aeo/chapter-{1..4}.txt` |
| Profound, AEO Guide ch. 5 (routing emphasis, via verifier) | DOC | as above | https://www.tryprofound.com/aeo-guide/chapter-5 |
| Our guide deep read and verification | INFERRED / DOC | 2026-11-09 | `R/recovered/research/profound-aeo-guide.md`, `.verification.md` |
| Profound 101 outline and setup lessons (topics and prompts, volume, personas, prompt expansion, advanced setups; all marked outdated) | DOC | course 2026-07; fetched 2026-11-10 | https://university.tryprofound.com/courses/profound-101 |
| Profound 101 L10/L11, L11 Finding Opportunities | DEMO | 2026-07-24 | https://www.youtube.com/watch?v=cSi01sPrbvI ; https://www.youtube.com/watch?v=hQVgIOcLTAI |
| Profound blog: once a day; fan-outs; query language | CLAIM | 2026-07-08; 2026-04-30; 2026-04-21 | https://www.tryprofound.com/blog/is-once-a-day-enough ; …/what-ai-engines-actually-search-for ; …/how-query-language-reshapes-ai-citations |
| Profound docs: how metrics are calculated; why past numbers change | DOC | read 2026-11-09 | https://docs.tryprofound.com/cookbook/metrics/how-metrics-are-calculated ; https://docs.tryprofound.com/cookbook/metrics/why-past-numbers-change.md |
| Profound, missing UTM tags | CLAIM | 2026-10 | https://www.tryprofound.com/blog/chatgpt-missing-utm-tags |
| Profound content and product research (+ verifications); September teardown | mixed | 2026-11-09; 2026-09-13 | `R/recovered/research/profound-content*.md`, `profound-product*.md`; `Sun Project/project-sun-competitor-research/02-profound/PROMPT-GENERATION.md` |
| Peec docs: Setting up your prompts | DOC | undated; fetched 2026-11-10 | https://docs.peec.ai/setting-up-your-prompts.md |
| Peec docs: Organizing your setup | DOC | undated; fetched 2026-11-10 | https://docs.peec.ai/organizing-your-setup.md |
| Peec docs: Identifying your competitors | DOC | undated; fetched 2026-11-10 | https://docs.peec.ai/identifying-your-competitors.md |
| Peec docs: Setting up shopping prompts | DOC | undated; fetched 2026-11-10 | https://docs.peec.ai/setting-up-shopping-prompts.md |
| Peec docs: Brand profile | DOC | undated; fetched 2026-11-10 | https://docs.peec.ai/project-profile.md |
| Peec blog "The key to prompt tracking" | CLAIM (method published) | 2026-09-29; fetched 2026-11-10 | https://peec.ai/blog/the-key-to-prompt-tracking |
| Peec blog "How to choose the right prompts for LLM tracking" | CLAIM | 2026-01-22; fetched 2026-11-10 | https://peec.ai/blog/how-to-choose-the-right-prompts-for-llm-tracking |
| Peec blog "ChatGPT searches in English, even when you don't" | CLAIM | 2026-02-12 | https://peec.ai/blog/chatgpt-searches-in-english-even-when-you-don-t |
| Peec changelog; Brand Perception webinar | DOC; DEMO | 2026-10-13; 2026-09-25 | https://peec.ai/changelog ; https://www.youtube.com/watch?v=LdS9qM_S2_U |
| Peec video, list pages after GPT-5.6 | CLAIM | 2026 | https://www.youtube.com/watch?v=zUfwkh3eybM&t=239s |
| Peec onboarding capture; Peec research files (+ verifications) | DEMO; mixed | 2026-09-05; 2026-11-09 | `Sun Project/project-sun-competitor-research/01-peec-ai/notes/03-topics-and-prompt-generation.md`; `R/recovered/research/peec-*.md` |
| AthenaHQ docs (Discover, Prompts); SoFi podcast; Uberall interview; research file | DOC; DEMO; mixed | undated; 2026-05-26; 2026-03-17; 2026-11-09 | https://docs.athenahq.ai/discover ; https://www.youtube.com/watch?v=3UYxd62wPQM ; https://www.youtube.com/watch?v=nUzqS3MQhfo ; `R/recovered/research/athena*.md` |
| Scrunch help: Topic Prompt Optimizations; Prompt strategy guide; location study; research file | DOC; DOC; CLAIM; mixed | 2026-08-14; 2025-11-20; 2026-11-04; 2026-11-09 | https://helpcenter.scrunchai.com/en/articles/14117302-topic-prompt-optimizations ; https://helpcenter.scrunchai.com/en/articles/12872036-scrunch-prompt-strategy-guide ; https://scrunch.com/blog/ai-reads-your-local-paper-location-and-ai-answers/ ; `R/recovered/research/scrunch*.md` |
| OtterlyAI help (Recommendations, KPIs); stability study | DOC; CLAIM | 2026-10-05; 2026-09-11 | https://help.otterly.ai/ai-recommendations ; https://otterly.ai/blog/ai-search-visibility-stability/ |
| Rankscale Academy (prioritize prompts); Rankscale metrics | DOC | 2026-04-27; read 2026-11-09 | https://rankscale.ai/resources/modules/diagnose/how-to-prioritize-prompts ; https://help.rankscale.ai/articles/1188645477-metrics-in-rankscale ; `R/recovered/research/otterly-rankscale*.md` |
| Evertune methodology | DOC | read 2026-11-09 | https://www.evertune.ai/platform/methodology |
| Semrush KB; Ahrefs AI adjusted volume; Writesonic Citation Opportunities | DOC | 2026-03-11; 2026-09-03; 2026-02-25 | https://www.semrush.com/kb/1626-ai-visibility-features ; https://help.ahrefs.com/en/articles/16755865-what-is-ai-adjusted-volume-and-how-is-it-calculated ; https://docs.writesonic.com/docs/citation-opportunity.md |
| Local tools and challengers (Synup, BrightLocal, Trakkr) | mixed | 2026-11-09 | `R/recovered/research/local-and-challengers*.md` |
| BrightLocal AI directory sources; coverage | CLAIM; DOC | 2026-08-26; 2026-08-12 | https://www.brightlocal.com/resources/ai-directory-sources/ ; https://help.brightlocal.com/hc/en-us/articles/203103168 |
| Yext Scout FAQs; scanning methodology | DOC | 2026-10-20/21 | https://help.yext.com/hc/en-us/articles/37266875413403-Scout-FAQs ; https://help.yext.com/hc/en-us/articles/37153363787419-Scanning-Methodology |
| Velova captures and teardown | DEMO | 2026-09-05/06 | `R/recovered/research/velova-captures*.md`; `Sun Project/project-sun-competitor-research/05-velova/PROMPT-GENERATION.md` |
| IAB, Measuring Visibility in the AI Era | 3P | 2026-08-03 | https://www.iab.com/guidelines/measuring-visibility-in-the-ai-era/ |
| SEJ on SparkToro × Gumshoe | 3P (study COI) | 2026-01-30 | https://www.searchenginejournal.com/ai-recommendations-change-with-nearly-every-query-sparktoro/566242/ |
| Martinez GEO survey; Grossman et al. (SIGIR 2026); Braun, acquiescence bias | 3P | 2026-07-15; 2026-04-30; 2025-09-10 | https://arxiv.org/html/2607.14035v1 ; https://arxiv.org/abs/2604.27790 ; https://arxiv.org/abs/2509.08480 |
| Uberti-Bona Marin et al. (12.0%; 5.4% shared cited domains) | 3P | 2026-09-16 | https://arxiv.org/abs/2609.18729 |
| Chen & Koudas, What Drives AI Citations? | 3P | 2026-10-10 | https://arxiv.org/html/2610.15033v1 |
| Chen & Koudas, location audit | 3P | 2026-10-16 | https://arxiv.org/html/2610.24081v1 |
| Ranqo (sentiment flips) | 3P (vendor-authored) | 2026 | https://arxiv.org/html/2606.20065 |
| seoClarity citation decline | CLAIM | 2026 | https://www.seoclarity.net/chatgpt-citation-decline-analysis |
| OpenAI Help, ChatGPT search | DOC | read 2026-11-09 | https://help.openai.com/en/articles/9237897-chatgpt-search |
| Google, AI features; Maps grounding | DOC | 2025-12-10; read 2026-11-09 | https://developers.google.com/search/docs/appearance/ai-features ; https://ai.google.dev/gemini-api/docs/maps-grounding |
| Outcome methodology and evidence levers (+ verifications) | mixed | 2026-11-09 | `R/recovered/research/outcome-methodology*.md`, `evidence-levers*.md` |
| Project Sun stored-data research and verification; data fit; methodology; chain; worked examples | PROVEN / INFERRED | 2026-11-09 | `R/recovered/research/project-sun-data*.md`; `R/recovered/synthesis/data-fit.md`, `methodology.md`, `chain.md`; `R/recovered/04-examples-block.md` |
| Red team; fix decisions (substance preserved in Plan 2 sections 8.2, 11, 15) | INFERRED | 2026-11-09 | `R/recovered/design/redteam.md`, `fix-decisions.md` |
| Final report chapters 4-7, 10 | INFERRED | 2026-11-09 | `R/final/04-workflows.md`, `05-evidence.md`, `06-framework.md`, `07-data.md`, `10-decisions.md` |
| Research report (reader version) | mixed | 2026-11-09 | `docs/Project_Sun_Recommendations_and_Actions_Research_2026-11-09.docx` (persistent); `R/final/*.md` |
| Phase 2 Final Technical Implementation Specification v2 (the design document) | DOC (design intent) | 2026-09 | `~/Downloads/Project_Sun_Phase2_Final_Technical_Implementation_Specification_v2.docx` (not in the repo); text extract `R/design-docs/Phase2_Final_Technical_Implementation_Specification_v2.txt` |
| Phase 2 Technical Implementation Plan; Zero-Cost Revised version | DOC (design intent) | research cut-off 2026-09-09 | `Sun Project/Phase 2/Project_Sun_Phase2_Technical_Implementation_Plan.docx`; `…_Zero_Cost_Revised.docx`; extract `R/design-docs/Project_Sun_Phase2_Technical_Implementation_Plan.txt` |
| Phase 2 Implementation Plan (Independent), incl. §11 strata and the neutral-cohort integrity system | DOC (design intent) | 2026-09-09 | `Sun Project/Phase 2/Project_Sun_Phase2_Implementation_Plan_Independent.docx`; `Sun Project/Claude outputs/Project_Sun_Phase2_Implementation_Plan_Independent.md` |
| Stage 1 Brief | DOC (design intent) | due 2026-09-06 | `Sun Project/work/source-text/Interview__Project Sun - Tech Lead - Stage 1 Brief.pdf.txt` |
| Stage 1 Design Dossier Final | DOC (design intent) | 2026-09-07 | `Sun Project/Stage 1 Submission/Project_Sun_Stage1_Design_Dossier_Final.docx` |
| Manager Brief (and the earlier `Changes` cut) | DOC (internal) | 2026-09-16/17 | `Sun Project/Phase 2/PROJECT_SUN_MANAGER_BRIEF_2026-09-16.docx`; `Sun Project/Phase 2/Changes.docx` |
| Founder discussion transcript (approximate machine transcript) | DEMO | recorded 2026-09-03 | `Sun Project/Claude outputs/Founder_Discussion_Transcript_2026-09-03.md` |
| Intent synthesis (Project Sun intent, constraints, prior Actions conclusions) | DOC / INFERRED | 2026-11-09 | `R/recovered/research/project-sun-intent.md` |
| Collection decision memo | DOC (internal) | 2026-09-14 | `docs/CHATGPT_CONSUMER_COLLECTION_DECISION_MEMO.md` |
| Project status audit; Claude memory audit | PROVEN | 2026-11-09 | `PROJECT_STATUS.md`; `CLAUDE_MEMORY_AUDIT.md` |
| Measure audit | PROVEN | 2026-11-09 | `MEASURE_AUDIT.md` |
| Known issues | PROVEN | 2026-09-13, updated to 2026-11-09 | `docs/KNOWN_ISSUES.md` |
| Measure design; rules | DOC (internal) | 2026-09-15 to 2026-11-09 | `docs/MEASURE_WORKSPACE_DESIGN.md`; `.claude/rules/analysis-measure.md`, `collection.md`, `prompts.md` |
| Other repo docs | DOC (internal) | read 2026-11-10 | `CLAUDE.md`, `docs/ONBOARDING_INTELLIGENCE.md`, `docs/COMPETITOR_AND_PROMPT_INTELLIGENCE.md`, `docs/SEARCH_CONSOLE.md` |
| Repo code | PROVEN (code) | read 2026-11-10 | `src/lib/prompts/{types,discovery,intent-generation,coverage-policy,context,intent-model}.ts`, `src/lib/db/schema.ts`, `src/lib/measure/*`, `src/lib/analysis/types.ts`, `src/lib/collection/{orchestrator,runner}.ts`, `src/lib/landscape/{competitor-types,tier-types}.ts`, `src/app/projects/[id]/prompts/page.tsx`; `benchmarks/onboarding/golden-businesses.json` (17 cases) |
| Live DB, read-only counts (35 approved sets, 1,050 prompts; versions; run and crawl status) | PROVEN | 2026-11-10 | `data/sun.db` via `sqlite3 -readonly "file:data/sun.db?immutable=1"` |
| Plan 2 (future Recommendations and Actions) | DOC (internal) | 2026-11-10 | `docs/plans/02-future-recommendations-and-actions/plan.md` |
