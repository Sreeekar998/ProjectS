# Plan 2: Future Application Development - Recommendations and Actions

**Version:** 1.0 · **Last updated:** 2026-11-10 13:55 IST (UTC+05:30) · **Created:** 2026-11-10 · Living document: see section 0.5 before relying on any figure.

**Status:** Direction, not approved for build. This plan describes how Project Sun could grow beyond Measure into a Recommendations and Actions layer. Nothing in it is implemented, and nothing in it is a change to make now.

**Prerequisite before any build.** `CLAUDE.md` says "Scope stops at Measure", and the product owner gave a standing instruction (2026-09-10 and 2026-09-11) not to build an Actions, recommendations or publishing layer. Both must be lifted explicitly, with a dated decision, before any of this plan is built. That includes the instrument fixes proposed for MVP weeks 1 and 2 (decision 1, section 16). Until then, treat this file as reference only.

## 0. About this plan

### 0.1 How to use this plan in a new session

1. **Read this file first, then decide whether the prerequisite has been lifted.** If it has not, do not write Actions code. Instrument fixes that also serve Measure belong to Plan 1.
2. **Re-check the code before relying on any figure.** Every Project Sun figure here was read from stored runs on 2026-11-09. On 2026-11-10 the code was at `observation-analysis@18` and `measure-policy@4`; on 2026-11-09 no stored analysis was at `@18` yet. Figures can shift after re-analysis.
3. **Do not repeat the research.** It is finished and condensed here and in the reader report. Repeat a lookup only to refresh a dated vendor fact, because vendors ship monthly.
4. **Where sources disagree, this file wins over its own inputs.** It follows the final reader report and `fix-decisions` (the red-team resolutions), which override the earlier `framework-v1` spec.
5. **Respect the live environment.** Use an isolated data dir, evidence dir, dist dir and port. Agree a schema-change window with the user before any migration (decision 6).
6. **Mark progress here.** When a decision is made or a phase passes, add a dated line under section 16 or section 14 rather than rewriting history.

### 0.2 Provenance

| Item | Detail |
|---|---|
| Research run | 2026-11-09, 18 streams: Peec webinar, docs and content; Profound product, content and AEO Guide; Scrunch; AthenaHQ; OtterlyAI and Rankscale; enterprise platforms; SEO suites; local tools and challengers; our Velova and Opinly captures; lever evidence; prioritization concepts; outcome methodology; Project Sun data; Project Sun intent |
| Volume | About 1,240 source reads (not de-duplicated); 98 vendor sources; about 170 video transcripts, including Peec's 2026-11-04 Actions webinar; two sales demos (Scrunch, AthenaHQ); more than 25 vendors |
| Verification | Independent verifiers re-checked 255 load-bearing claims: 209 confirmed, 46 partly confirmed and corrected before synthesis, 0 refuted. The intent stream (internal documents) was not verified |
| Design | Three framework proposals (A evidence-first, B manager-first, C build-pragmatic) were judged on seven criteria: A 32, C 31, B 28 of 35. The merged spec (`framework-v1`) was red-teamed: 13 must-fix issues (M1-M13), 15 should-consider issues (S1-S15) and 12 assumptions (A1-A12). All 13 must-fix issues were adopted, nine with modifications |
| Reader report | `docs/Project_Sun_Recommendations_and_Actions_Research_2026-11-09.docx` (canonical, fact-checked, condensed: sections 1-10 and appendices A sources, B method, C glossary) |
| Raw notes | Research notes, synthesis files, proposals, red team and fix decisions sat in a session temp folder. They are not persisted; this plan preserves their substance |
| Earlier work | Actions research report, 2026-10-24 (Claude Doc: https://claude.ai/artifact/P3M6wPyD5E94qp4SnPqPN8; notes in `Sun Project/research_notes/AI visibility recommendations research/`). Actions layer cost study, 2026-10-08 (https://claude.ai/code/artifact/31f99c57-98ed-44b9-9f10-5d5f3d389ca7) |
| Limits | Nobody logged into Peec or Profound; the Peec webinar screens were not seen (captions only); several sites blocked readers; no UAE or India evidence exists; the founder discussion is known only from an approximate machine transcript |

### 0.3 Labels

Important claims carry a label. Qualifiers follow in parentheses, for example "[3P] (vendor study)".

| Label | Meaning |
|---|---|
| [DOC] | Vendor documentation, help center, API reference or changelog. "[DOC] (internal)" marks a Project Sun document |
| [DEMO] | Seen in a vendor demo, webinar or our own capture (timestamp or file given) |
| [CLAIM] | A vendor assertion not demonstrated, including uncontrolled case-study numbers |
| [3P] | An independent third party: a study, standard or industry body |
| [INFERRED] | Our interpretation or proposal |
| [UNAVAILABLE] | Looked for and not found or not accessible; nothing is guessed in its place |
| [PROVEN] | Shown by Project Sun's own stored data or code |
| [SUPPORTED] | External evidence supports it, with its strength, for example "(moderate, correlational)" |
| [HYPOTHESIS] | Plausible but unproven |

"Owner" means the owner of the measured business (the client). "Product owner" means the person deciding what Project Sun builds. "Operator" means whoever runs Project Sun for a client. Every design choice in this plan is a proposal [INFERRED] unless labeled otherwise. No proposal promises or implies a visibility lift.

### 0.4 Relation to Plan 1 and shared dependencies

Plan 1 (`docs/plans/01-existing-app-refinement/plan.md`) refines the existing app. Several items there are prerequisites here. When starting Plan 2 work, check what Plan 1 has already delivered; anything still missing becomes Plan 2's MVP weeks 1-2.

| Shared dependency | Why Plan 2 needs it | Plan 2 reference | Plan 1 items |
|---|---|---|---|
| Re-analysis of stored runs at the current analysis version | Gate Q1 blocks every card while analyses are stale | Q1, section 6 | MS-01 (hand-check and labels: DQ-09) |
| Evidenced own-domain (ownership) claims applied to Measure | Atelier 10's "Your site cited" moves 15 to 20 of 30 if atelier10salon.ae is its own | Q2; decision 4 | DQ-01 (evidence from DQ-11; primary project DQ-14) |
| Rival-domain verification (never freeze failed domains) | Studio14's rivals were frozen to a parked domain and a California studio | Q3 | DQ-02 |
| Observer country from the business's market | A Bengaluru restaurant was observed from the US | Q4 | GEO-01, GEO-02 |
| Name checks on untracked businesses | "Fade", "Oval", "Round", "Trade Centre" detected as businesses | Q8 | DQ-03 (Q6 feed: MS-12) |
| Analysis accuracy (sentiment misreads, "never" negation, table cells, second picks stored as mere mentions, "RBAC" counted as a rival) | Misreads become wrong cards | Q5; section 6.3 | DQ-04, DQ-05, DQ-06, DQ-07; labels DQ-09 |
| Map links dropped as sources | google.com map links count as third-party sources (12 Atelier 10 answers) | Section 6.3 | DQ-08 |
| Repeat runs, cadence and answer budget | Without them nothing reaches Repeated, matures, expires or gets a Used check | Decision 3; M1 | MS-02, MS-03, MS-04, PL-10 (prerequisites PL-03, PL-07) |
| Payload parsing: local listings, sponsored cards, citation titles, ChatGPT search (fan-out) queries, follow-up forms | Cheapest new evidence; unlocks listing, ad and place cards | Section 12.2 | DQ-10 (with MS-11, GEO-04, GEO-05) |
| Safe page fetching after the SSRF fixes | Cited-page checks, live checks of own pages | Decision 12 | PL-05 (with DQ-11) |
| New diagnostic prompt types (Validation, Accuracy, Market perception) and rewordings, outside the frozen 30 | Comprehension vs trust routing; re-asks; outcome checks | Decision 15; section 5 | PR-13, PR-12 |
| Measure method (Discovery count; samples per question) | Changing it after baselines freeze resets every plan | Decision 5 | PR-04 / MS-07, MS-03 |
| Gemini and Google AI surfaces | Local wedge claims need a Google surface | Decision 14 | PL-11, GEO-07 |
| Model labels and provider handover | Check runs need a pinned provider and a recorded model | S1; section 11 | MS-05, MS-06, DQ-12, GEO-02 |
| A schema-change window | New tables break the user's running server until it restarts | Decision 6 | Plan 1 decision D19 (migrations for MS-04, MS-05, DQ-01, DQ-14, PR-02, PR-12, PR-13, PR-17, PR-20, PL-09) |

Plan 1 also supplies inputs this plan reads that the table does not list: PR-01 (operator topic priority P1-P3, used by section 9.3), PR-02 (typed prompt facets: place, criterion, theme, read by the triggers in section 7), PR-05 (branded vs unbranded separation; the "known when named" pair behind section 5.2), PR-06 and GEO-03 (place wording and the place mix beside the headline, section 6.3) and PR-17 (stable prompt keys across set versions, section 11.1). Plan 1 sequences all of these in its section 5 (phases R0-R3) and holds the reverse table in its section 0.6.

### 0.5 Version history and maintenance (living document)

This plan will change as decisions are made, items ship and the app moves. Treat the version and "Last updated" stamp at the top as the source of truth for how current it is, not any pointer elsewhere (CLAUDE.md, memory).

| Version | Date and time | Change |
|---|---|---|
| 1.0 | 2026-11-10 13:55 IST (UTC+05:30) | Created from the 2026-11-09 Recommendations and Actions research and the reader report docs/Project_Sun_Recommendations_and_Actions_Research_2026-11-09.docx: categories 0-7, gates Q1-Q8, triggers T1-T15, evidence, prioritization, action management, outcome verification, integrations, agents, roadmap, decisions 1-20. Section 0.4 gained Plan 1 item IDs the same day. |

**How to update this plan:**

- **Stamp every material change.** Update "Last updated" with date, time and time zone, and add a row above. Minor version (1.1, 1.2) for corrections, added detail or a re-verified figure; major version (2.0) when a decision changes direction, a phase is re-planned or scope changes.
- **Item IDs are permanent.** Never renumber or reuse an ID. Instead of deleting, mark an item **Done** (date, where it shipped, version constant bumped), **Superseded by** another ID, **Dropped** (date and reason) or **Blocked** (by what).
- **Record decisions, dated.** When the product owner decides an open question, move it from open to decided in section 16 with the date, the choice and who decided; keep the options that were rejected.
- **Facts age.** Figures from stored data, code paths and version constants were true on the date they cite. Re-verify against the code and database (read-only) before acting, and note the re-verification date next to the figure.
- **Keep the plans in step.** Shared dependencies live in section 0.4 here and in Plan 1's section 0.6; when an item's ID, status or scope changes, update both tables in the same change. When an item ships, also update CLAUDE.md, docs/KNOWN_ISSUES.md or the relevant .claude/rules file if the shipped behavior changes what they say.
- **New research** goes into the relevant section with source URL, label and access date, plus a version-history row; do not overwrite earlier findings silently, mark them superseded.

## 1. Product direction and principles

### 1.1 Vision

Project Sun measures how often ChatGPT names one business and stops at evidence. Measure's "What needs attention" list names the evidence and where to look next, and proposes no change, owner or follow-up check [PROVEN] (code: `src/components/features/measure/findings.tsx`, `src/lib/measure/policy.ts`). The direction proposed here is an **evidence-first layer** that turns findings into a short, checked weekly plan:

- an **operator Plan view inside Measure** (not a fifth journey stage), plus **owner exports** (a message, a one-page plan and hand-off notes);
- **measurement fixed first**, through eight gate checks (Q1-Q8) that block advice resting on wrong numbers;
- **rules decide; people approve**: code decides whether a card exists, its grade, order, expiry and verdict; an operator approves every MVP card; a model may later draft deliverables only;
- **honest outcomes**: Live, then Used, then Picked more often, with "can't tell yet" as a normal result.

It is validated before it is built: Phase 0 (1-2 weeks), then a 4-week concierge pilot with a go/no-go, alongside MVP weeks 1-2 that build only instrument fixes useful to Measure anyway.

### 1.2 Why now, and why carefully

- **The founder's product always included Act.** The Stage 1 brief defines Act as a weekly, prioritized plan of actions across Foundation, Content and Authority, each re-measured after execution [DOC] (internal: Stage 1 brief, paraphrased).
- **The manager brief (2026-09-16/17) named Actions the second next step**, starting with a verified check of cited pages ("this page does not mention you") [DOC] (internal).
- **Competitors shipped.** Peec launched Actions and routines on 2026-11-04; Writesonic announced a relaunch the same day [DEMO; CLAIM].
- **But the bets are untested.** No action has ever been executed through Project Sun [DOC] (internal); triggers are rare; and no project has comparable runs on two days [PROVEN]. Hence the pilot before the build.

### 1.3 The founder's requirements

| Source | Requirement |
|---|---|
| Stage 1 brief (due 2026-09-06) | Three divisions: Measure, Diagnose (sources behind each answer, citation gap, site readiness audit, entity check) and Act. Primary user: marketing lead at a Gulf enterprise; secondary: agency account manager. First weekly action plan within the journey |
| Founder LLM reference, section 17 | Pillars. **Foundation:** entity consistency, technical accessibility, structured data, crawlability, brand-information quality. **Content:** missing questions, factual density, comparison content, improved or new pages. **Authority:** cited third-party sources, digital PR, reviews, expert citations, mentions. Priority factors: impact, confidence, effort, urgency, prompt volume, competitor gap, topics, dependencies; a conceptual score, Expected impact × Confidence × Strategic importance ÷ Effort. Loop: Measure → Diagnose → Act → Execute → Re-measure → Show impact |
| Five weekly questions | How visible are we? Where are competitors beating us? Why? What should we do this week? Did last week's actions work? |
| Founder call, 2026-09-03 (approximate transcript) | Keep it simple for SMBs and solo operators without a marketing team; each action says **what we suggest, why (what is happening) and how it has to change**; the owner must be able to pass it to the right person; a last tab shows whether the feedback loop works; no feature lists [DOC] (internal) |
| Job description | Turn measurement into executed actions; site readiness audit, citation gap analysis, action tracking; integrations Cloudflare, GA4 and Search Console first |
| Phase 2 specification | "Actions excluded"; Diagnose and the Actions engine explicitly out of scope; architecture should let a future Diagnose/Actions layer consume the same observations without redesigning collection |

### 1.4 The persona tension

Three sources name three buyers: the brief (a Gulf enterprise marketing lead), the founder call (SMB owners without a marketing team, while citing very senior enterprise prospects, one a PR officer of a large UAE group), and the October report (operators and agencies). Persona changes vocabulary, plan size, engines and price. **Lean: an operator or agency serving local businesses, with owners reading exports** [INFERRED]. The app has one operator and no logins [PROVEN], and owners route work rather than do it. An enterprise PR lead would want share-of-voice trends, several engines and a backlog with owners; that is a different product (decision 2).

### 1.5 Differentiation

Project Sun should compete on trust, not breadth, where it trails [INFERRED].

| Differentiator | Holds today? | Note |
|---|---|---|
| Receipts linking each card to its exact answers | Yes | Measure links every figure to its answers [PROVEN]; Peec stores no answer ids [DOC] |
| A measurement-fix gate | In the design | No vendor has one; word it "we check our numbers first" |
| A graded diagnosis | Mostly "Seen once" for months | Weak as a selling point until repeat runs exist |
| Per-action verdicts against controls | Only from v3 | Mostly "can't tell yet" |
| Routing and hand-offs | In the design | Only Athena, Adobe and Rankscale name an owner [DOC] |
| No agent publishes or sends | A stance | Defensible, not a feature buyers ask for |
| Local UAE and India focus | Partly | Listings unparsed until v2; English and ChatGPT only [UNAVAILABLE] |

**Parity gaps buyers may notice:** one engine (Gemini hidden, Google AI surfaces unmeasured); one sample per prompt against competitors' daily runs; 30 prompts; no CMS or outreach drafts before v2; no multi-client agency view; no GA4 or Search Console data. Date every parity claim.

### 1.6 Integrity rules

These are the non-negotiables of the layer (from `framework-v1` section 1, with the red-team rewrites of rules 9 and 11).

| # | Rule | Enforcement |
|---|---|---|
| 1 | No trigger, no card: each card cites answer ids and spans, or a dated check, plus the rule and versions that fired | The engine emits nothing without evidence (test) |
| 2 | Gate before advice: an open measurement defect blocks every card it could change | A `blocked_by` map |
| 3 | Two evidence grades, in words: no percentages, stars or High/Medium/Low; never merged | Copy-guard extension |
| 4 | Only evidence promotes; people accept, dismiss or demote | State-machine tests |
| 5 | Every number in card text equals an evidence field | Claims linter; templates tested at n = 0, 1 and at least 5 |
| 6 | Every card says what it does not show, and when it would be wrong | Required fields |
| 7 | The check is written before the work | Hashed check plan |
| 8 | Falls and nulls are reported like wins | Verdict set (section 11) |
| 9 | Workflow never changes a recorded answer or its analysis. Two things can change a Measure figure, both logged in lineage and the Report: an evidenced ownership claim, and an instrument decision (new questions or rivals), which is a comparability break | Separate check-run kind; `purpose` filter |
| 10 | Untrusted text stays data | Wrapper (the `digest.ts` pattern [PROVEN]); no tools for a model that reads it |
| 11 | A trigger releases cards without operator approval only after at least 30 blind-labeled detections from at least three business kinds, with a 95% Wilson lower bound of at least 75%. Misses found are reported, not a recall rate. Publish the noise floor, then (v3) the false-"worked" rate | Labeled set; placebo groups |
| 12 | Engines are named only as ChatGPT or Gemini, never a collection vendor; no hardcoded brands or platform lists (platforms come from each client's citations) | Copy guard extended to `src/lib/actions` |

### 1.7 Constraints from the current app that bind this layer

- **Journey:** four stages; the user repeatedly rejected an Observe page, and the audit removed an Opportunities tab because it read as a second dashboard. A Plan tab needs an explicit decision; no fifth stage.
- **Honest numbers:** `x of n`, "—" for n = 0, "so far" for partial runs, Wilson ranges, "within range" inside the range, fraction first below 5 answers. Every card and check reuses these rules.
- **No composite score,** volume, traffic or revenue estimate, benchmark or model commentary; summaries are written by code. Card text is generated from numbers and spans.
- **Versioned and immutable,** with breaks (prompt set, competitive set, analysis, policy, engines, samples) and cautions (provider, country, model, coverage). The actions engine gets its own version; checks respect breaks.
- **No collection vendor** is named anywhere a reader sees (cards, method notes, exports, outcome reports).
- **No paid spend without approval** (`SUN_LLM_NO_PAID=1`); a rules-only first version runs without keys.
- **Collection budget:** ChatGPT only by default, one sample per prompt, a per-lane cap of 60 requests, canary and credit check; no other route to "check ChatGPT" (Project Sun never drives chatgpt.com).
- **Untrusted website text,** passed only inside a wrapper; fetched pages are stored as facts, not pages. No hardcoded brands or platform lists in `src/`.
- **Single operator, no auth, no scheduler,** in-process background work; a prompt set is approved only at exactly 30 (10/10/10), so extra probes need a separate "check" run kind; known SSRF gaps; signed-out ChatGPT with search always on (`search_state` "on" in 419 of 419), so memory-only answers are unobservable.

## 2. Competitor findings that shape the design

### 2.1 Method

We studied how more than 25 AI-visibility, SEO and local-search vendors turn measurement into recommendations, prioritizing Peec AI and Profound. Sources were accessed on 2026-11-09. Only Velova (captured 2026-09-05/06) and Opinly (2026-09-14) were used logged in. Vendor facts are dated; re-check before quoting them to a client.

### 2.2 Peec AI

**Framing.** Peec presents Actions as a **measure → act → prove** loop [DOC]. It measures daily answers per prompt × model × country (mentions, position, sentiment, retrieved sources, citations, fan-out queries), plus scraped source pages, server logs, GA4, Search Console, its own site audits and separate brand-perception runs ([docs: My website](https://docs.peec.ai/my-website.md)). Peec reports $20M ARR and 4,000+ customers [CLAIM]. The fullest account is the 2026-11-04 webinar (59:16) by Niklas Springer (Head of Product) and Marcin Debski ([webinar](https://www.youtube.com/watch?v=h-MGdZJbBH8)); we had its transcript only.

**Action types.** The API `types` enum lists 11 types; all but the manual type sit under four goals [DOC] ([API: List Actions](https://docs.peec.ai/api-reference/actions/list-actions.md); [docs: Actions](https://docs.peec.ai/actions.md)). Each action also carries `target` (owned or earned), `group` (OWNED, EDITORIAL, REFERENCE, UGC, OTHER), an optional page `archetype` (12 values) and a `category` (22 values).

| Goal | Action type | Trigger | Evidence shown | Webinar |
|---|---|---|---|---|
| Fix how AI reads your site | `ROBOTS_TXT` | robots.txt blocks AI search bots (checked against 40+ bots) | Bots and rules | |
| | `SEO_ISSUE` (category = audit check, incl. `agent_readiness`) | A failed Peec audit check, e.g. missing H1, broken Organization-schema link, docs page not served as Markdown | Description and steps; no brief | 00:12:17 |
| | `AGENT_CRAWL_ERROR` (added 2026-11-04) | Server logs show AI crawl failures | Affected pages | |
| Improve your own pages | `CONTENT_BRIEF` (+ archetype) | Rivals cited from a page type the brand lacks (docs example: comparison pages cited in 14 CRM conversations in 30 days) | Headline options, proof points, words to avoid, outline with evidence, prompts likely affected | 00:15:25-00:17:08 |
| | `CATEGORY_SITUATION_BRIEF` | Trigger [UNAVAILABLE] | Briefs in steps | |
| | `CONTENT_OPTIMISATION` (early access) | A page AI already uses compared with winning sources | Passage-level edits (blue ready, orange needs input) | |
| | `PDP_OPTIMISATION` | A product page lacks buyer information | Page and what to add | |
| Get mentioned elsewhere | `TEMPLATE_ACTION`: listicle inclusion, editorial pitch | A cited article names rivals, not you, plus an undocumented second relevance check | Why this matters, rival evidence, steps with text, outreach angle | 00:21:36-00:22:55 |
| | `TEMPLATE_ACTION`: review directories; community; social video | Such platforms prominent among sources | Platform, prompts, phrases, top domains | 00:29:42; 00:28:38 |
| Fix wrong claims | `CONTRADICTIONS_OWNED_SOURCES`; `CONTRADICTIONS_EXTERNAL_SOURCES` | An answer claim contradicts an active brand fact, traced to a URL | Claim, verified correction, passages, prompts, steps | 00:53:32-00:55:20 |
| Any | `MANUAL_ACTION` | Created by a user, agent, routine, MCP or API | Priority, due date, repeat | |

**Card anatomy [DOC].** Overview; topic, models and country; your page (or page to correct); **Why this matters** (counts, topic, page type, period); **Competitor evidence**; the brief; **What to do** (checkable steps); **Expected outcome** (impact band); additional context. The API adds impacted prompts with undefined coverage scores, competitor `ngrams`, source URLs and a 7/28/90-day reading window, but **no answer ids** ([API: Get Action](https://docs.peec.ai/api-reference/actions/get-action.md)). A Peec card cannot take a reader to the answers that triggered it and does not mark observed versus hypothesis [INFERRED].

**Relative impact.**

| Documented [DOC] | Said in the webinar [DEMO] |
|---|---|
| Five bands, Very low to Very high (API `MEDIUM` = UI "Moderate"), shown as three bars and a word; each action's expected lift ranked against every other action in the project, so filters never change it | Lift estimated as if the action were done perfectly, then banded and kept "decently vague" ([00:13:39](https://www.youtube.com/watch?v=h-MGdZJbBH8&t=819s)) |
| Since 2026-10-13: site fixes first, then owned, then earned; impact sorts within each group ([changelog](https://peec.ai/changelog)) | Drivers: prompts likely affected; how similar content moved other brands; prompts, topics and models an article reaches (00:13:39-00:14:32, 00:25:07-00:26:24) |
| `SEO_ISSUE` banded by severity; corrections carry no lift estimate (contradicting the docs line that all types are rated the same way) | "About 100 prompts across 6 models" was a hypothetical, not a threshold |
| No effort or confidence field anywhere | Confidence works as a gate: uncertain actions expire rather than appear (00:13:11) |

Formula, weights and cut-offs are [UNAVAILABLE]. A "visibility lift predictor" appears on the pricing page with no docs [CLAIM].

**Lifecycle and expiry.** UI states New (API PENDING), Planned, In progress (ACCEPTED; amber marker), Done (COMPLETED; back-datable up to five years; ticking every step does not complete it), Declined (REJECTED; restorable to New) and Expired; DELETED exists in the API [DOC]. Expiry is stated two ways and never reconciled: the API says untouched for 30 days [DOC]; the webinar says windows differ by action and an action expires when its data changes ([00:12:41](https://www.youtube.com/watch?v=h-MGdZJbBH8&t=761s)) [DEMO]. Generated actions cannot be re-categorized; user edits survive regeneration; the MCP status filter lists four statuses, not six [DOC].

**Impact page and the no-attribution stance.** The Impact page plots visibility, sentiment, position and share of voice over time with In progress and Done day markers [DOC]. Peec's FAQ says it does not attribute a change to an individual action [CLAIM] ([product: Actions](https://peec.ai/product/actions)), yet the docs word Impact causally [DOC]. Springer advised shipping data-backed changes together rather than isolating them ([00:51:01](https://www.youtube.com/watch?v=h-MGdZJbBH8&t=3061s)) [DEMO]. Per-content impact analysis and automatic detection of shipped work are on the roadmap (00:26:49) [DEMO].

**Precision guidance.** Peec's own guide says 50 prompts × 1 run a day give about ±6.1 points monthly, and detect only changes of about 12.4 points day to day, 4.7 week to week and 2.3 month to month [CLAIM] (method published) ([blog](https://peec.ai/blog/the-key-to-prompt-tracking)). We use its variance constants (0.0675 per-run non-branded variance; shared daily shock 0.015) as orders of magnitude in section 11.

**Case evidence [CLAIM].** SIXT (2026-10-28): 11 partner listings on 4 domains (2 rewritten, 1 partly, 1 control), two weeks before vs after; +320% citations for rewritten domains against +12.2% for the control; no significance test; the paper's author is employed by SIXT; in-window citations came mostly from Google AI surfaces and Perplexity, not ChatGPT ([SIXT case](https://peec.ai/blog/how-sixt-increased-ai-citations-of-its-partner-listings-by-320)). OnBoard: citation rate 1.45 → 2.33 against a control 1.61 → 1.72, while retrievals fell 199 → 166 and page visibility 22% → 9% (a guardrail lesson).

**Time to impact.** No figure. A place in a top-cited listicle may register "within days" once the model's cache refreshes; own content is slower; the speaker said no serious answer is possible ([00:33:34](https://www.youtube.com/watch?v=h-MGdZJbBH8&t=2014s)) [DEMO]. For corrections Peec says both "within days" and "months or never" [CLAIM].

**Agent and routines.** One click loads an action into the Peec Agent; changes need Approve unless Auto is on (00:17:33; [docs: Agent](https://docs.peec.ai/agent.md)) [DEMO] [DOC]. Demonstrated: brief → outline → Mintlify draft for the presenter's side project, Daisy (00:15:25-00:20:14); a Lemlist outreach campaign prepared before the session for a Forbes listicle naming Headspace's rivals (00:22:29); a correction for a demo CRM, almost certainly Attio, whose stated launch date was wrong (00:53:32-00:55:20); a 06:00 daily routine that checks agent readiness, files Linear tasks and emails a summary (00:44:18-00:46:52). No outcome was shown for any of them. Routines (launched 00:43:03) run Read-only, Ask before changes, or Change without asking.

**Blog playbook [CLAIM].** Mention and source gaps scored by how often AI uses a source that names rivals ([blog](https://peec.ai/blog/a-beginner-s-guide-to-brand-mention-gap-analysis-in-ai-search)); objections answered on top own pages; Yelp and Tripadvisor fixes for local listings, which rest on US partner data and do not transfer to the UAE or India [INFERRED]. Peec's Malte Landwehr says listicles fell from 20% to 8% of sources after GPT-5.6 ([video](https://www.youtube.com/watch?v=zUfwkh3eybM&t=239s)). Caveats: the February 2026 model is superseded but still callable via MCP; docs pages are undated.

### 2.3 Profound

Profound acts in three places [INFERRED]: Aim, an agent that writes Suggestions; analysis screens with a fixed next step; and the AEO Guide by Nick Lafferty (Profound) and Nigel Stevens (agency OGM) ([AEO Guide](https://www.tryprofound.com/aeo-guide)). Aim launched 2026-07-02 [CLAIM]; Projects shipped 2026-06-26 and were redesigned 2026-10-02 [DOC].

**Aim Suggestions [DOC].** A task or a Project (a goal plus tasks), with Category (Owned, Earned, Social, Paid), Sources (data categories such as Visibility, Citations, Web research), a Summary and a reasoned plan. Buttons: Start task, Create Project, Archive; archive feedback shapes later Suggestions ([docs: Aim](https://docs.tryprofound.com/projects/suggestions-from-aim.md)). Steering: job title, focus areas, priorities, custom instructions. Ranking is undocumented [UNAVAILABLE]; legacy task impact was an integer 1-5 whose rubric needs a login. No current expiry is documented (legacy Suggestions were replaced weekly). Agents can publish to a CMS with no manual step ([Agents FAQ](https://docs.tryprofound.com/agents/faq.md)).

**Diagnostic surfaces and next steps.**

| Area | Signal | Next step | Label |
|---|---|---|---|
| Visibility gaps | Visibility × citation share per topic (cut-offs undocumented) | Visible, not cited → citable content; cited, not visible → review how cited pages present the brand | [DOC] ([Interpret](https://docs.tryprofound.com/answer-engine-insights/interpret.md)) |
| Brand accuracy, sentiment | Model-judged atomic claims against one Knowledge Base; pages ranked by inaccurate or negative claims they drive | "Draft Outreach" agent | [DOC] ([FactCheck](https://docs.tryprofound.com/answer-engine-insights/factcheck/about.md)) |
| Citations and sources | Per-page citation half-life | Refresh in half-life order | [DOC]; advice [CLAIM] |
| Content | ML score against top-cited pages (beta), six weighted factors, projected gain per edit | Weighted edits | [DOC]; validity [CLAIM] |
| AI access | Rendered page vs the HTML a bot fetches; robots audit | Expose text, unblock bots | [DOC] |
| Competitive intelligence | Decisive-only win rate (74.4% of 78); positioning conflicts (15 of 51 citations); sites linking to a rival, not you | Who displaces you; which sites link to rivals | [DEMO] ([ch. 4](https://www.tryprofound.com/aeo-guide/chapter-4)); links [DOC] |

The Profound 101 course teaches three gates for any page [DEMO] (outdated): **not fetchable** (robots, noindex, paywall), **not chosen** (URL, title or snippet doesn't look like the answer), **not extractable** (answers buried, in accordions, behind heavy JavaScript, in images).

**AEO Guide routing [DOC].** "Validation" is a yes/no prompt asking whether the brand does a thing ([ch. 3](https://www.tryprofound.com/aeo-guide/chapter-3)).

| Signal | Diagnosis | Route |
|---|---|---|
| Low Discovery on a P1-P2 attribute; Validation says no | Comprehension gap | On-page: a plain page per capability |
| Low Discovery; Validation says yes | Trust gap | Off-page: citations, directories, reviews |
| Wrong fact traced to a citation | Accuracy | Third-party errors first |
| Recurring negative theme | Objection | Both fronts; rising means urgent |
| Not crawled / crawled, never cited / cited only generically | Access / credibility / extractability | Technical fix / substance / direct answers |

Off-page order by friction: align existing mentions with a positioning battlecard; get added to listicles, directories and review platforms; create new sources ([ch. 5](https://www.tryprofound.com/aeo-guide/chapter-5)).

**Prioritization.** Guide: start where importance, distance and feasibility overlap; no formula; an undefined P1-P3 scale [DOC]. Course: read rank, not score; high rank → defend by refreshing, low rank → attack by creating; business priority overrides the numbers; one topic, one fix, once a week ([Profound 101 L11](https://www.youtube.com/watch?v=hQVgIOcLTAI&t=46s)) [DEMO]. Sentiment triage: rising negative → investigate; a single negative mention with no trend → likely noise, don't act [DOC].

**Outcomes.** Watchlists, annotations (including automatic platform and prompt updates), a daily FactCheck baseline, decay curves and bot visits [DOC]; experiment tags set before shipping with untagged prompts as baseline ([lesson 10](https://www.youtube.com/watch?v=cSi01sPrbvI)) [DEMO]. Project-level impact appears in marketing [CLAIM], not current docs. Past numbers are rewritten when topics or tags change ([why past numbers change](https://docs.tryprofound.com/cookbook/metrics/why-past-numbers-change.md)) [DOC].

**Caveats.** Every Profound 101 lesson checked is bannered "outdated". The Guide contradicts itself on routing (exclusive in chapters 3-4, "emphasis" in 5) and on where to start. Ramp 3.2% → 22.2% and Airbyte 9% → 26% are uncontrolled [CLAIM] ([customers](https://www.tryprofound.com/customers)). Profound's randomized Markdown test (381 pages) found no significant bot-visit difference and did not measure answers [CLAIM] (method published). Profound's own recaps say ChatGPT's sources shifted in August 2026 (fan-out doubled, listicles −38%), so listicle-first advice may be stale [CLAIM].

### 2.4 Other platforms

Labels are [DOC] unless marked.

| Vendor | Recommends | Trigger and priority | Outcome tracking |
|---|---|---|---|
| [Scrunch](https://helpcenter.scrunchai.com/en/articles/17508012-pitch-a-page) | Page fixes, pitch and correction drafts; never sends | Rule joins; Winnability stars; Influence score (weights unpublished) | Pitched page re-read weekly: "Placed" only when it newly names you; corrections need two clean reads; `control_group` status |
| [AthenaHQ](https://docs.athenahq.ai/guides/site-health) | Content, outreach, developer tickets | Fix now / soon / nice to have; effort in minutes to days | Live check 24 h after delivery; Verified only by re-audit; 30 days before/after; 21-day expiry |
| [OtterlyAI](https://help.otterly.ai/ai-recommendations) | 15 (help) or 17 (API) rule types | Needs ≥15 prompts, ≥3 competitors, ≥3 runs; High/Medium/Low | Chart annotation |
| [Rankscale](https://help.rankscale.ai/articles/4771319766-turning-insights-into-actions) | Map-pack listing gaps; source order by citation share | Published tree, fixed order; time-to-fix ranges | Re-audit at 4 weeks |
| [Brandlight](https://brandlight.ai/blog/brandlight-vs-profound.md) | Edits, PR [CLAIM] | Undisclosed; hidden lift score (+4.2) [CLAIM] | Weekly per-URL contribution [CLAIM]; no public docs [UNAVAILABLE] |
| [Adobe](https://experienceleague.adobe.com/en/docs/brand-visibility/using/resources/impact-measurement-engine) | 14 opportunity types | Rules; Critical-Low | Impact Measurement Engine: experiment prompts outside the library, ~2 weeks, no control; engineers found FAQ schema showed no impact ([demo 00:46:38](https://www.youtube.com/watch?v=MO4VK6Zwsfk&t=2798s)) [DEMO] |
| [Conductor](https://www.conductor.com/docs/intelligence/recommendations.md) | Boost mentions | "Booster" count → 1-10; Signal / Interpretation / Why it matters / 1-3 actions | None per item; recommendations cannot be dismissed |
| [Yext](https://help.yext.com/hc/en-us/articles/37266875413403-Scout-FAQs) | 27 actions: listings, reviews, social | A metric >10% off the local top-5 average (published) | Live Tests at 4-6 weeks, no control; approved Action Center changes cannot be undone |
| [AirOps](https://docs.airops.com/campaigns/opportunities.md) | Create or refresh pages | LLM playbook; an Action created only on acceptance | 14-day expiry; scope frozen at acceptance; no control |
| [Writesonic](https://docs.writesonic.com/docs/action-center-actionables.md) | Technical and off-page tasks; drafts and sends pitches [CLAIM] | Undisclosed impact × effort (1-3 bars) | Undocumented rules |
| [HubSpot](https://knowledge.hubspot.com/seo/review-and-manage-aeo-recommendations) | AEO recommendations | H/M/L; projected "Citation lift" (no method) | — |
| [Gauge](https://docs.withgauge.com/navigating/action-center.md) | Content actions | Triage → Completed | Waits ≥14 days on the same prompts; statistic undocumented; warns a change is not proof |
| [Trakkr](https://trakkr.ai/learn/docs/features/results) | 3 ideas a week; five rungs from "tells you" to "handle it" | Retires stale facts | Frozen plan per action; Earned ≥ max(before × 1.25, before + 3); "Coincided", never "caused"; agent never grades itself; never auto-sends outreach |
| Semrush, Ahrefs | Opportunities; filters | Undocumented [3P] | Trends only |
| Local tools ([BrightLocal](https://help.brightlocal.com/hc/en-us/articles/37990748897810), Synup, Birdeye, Local Falcon, SOCi, Uberall) | Listings, Business Profile completeness, reviews against a named rival, local pages, fact accuracy | Maps data; fixed tiers | 1-3 points called noise; evidence US, UK, Australia |
| [Velova](https://velova.ai/actions) | One-line fix per issue; 12 channel playbooks [DEMO] | High/Medium/Low fired at n = 1-2 runs; identical items got different bands [DEMO] | "Resolved" merges done with no longer detected; every expected impact read "Commentary unavailable" [DEMO] |

Instructive details:
- **Velova shows what to avoid** (our capture) [DEMO]: HIGH from two runs; a brand listed 5th of 5 exported as "Position 1"; the placeholder "Brand" leaked into fix text. Useful idea: confirmed versus unchecked evidence states (GAP, UNCHECKED, Recheck due, Could not scan). Opinly (our capture) showed fabricated outputs such as a promised "+104%".
- **Local evidence does not travel:** OpenAI lists Yelp as a reservation partner for the US and Canada only, OpenTable globally and Resy in the US ([OpenAI help](https://help.openai.com/en/articles/9237897-chatgpt-search)) [DOC]; Steady Demand found Yelp visibly cited in about 1% of US ChatGPT runs but grounding about 96% of business cards [3P] (agency). No UAE or India study was found [UNAVAILABLE].

**Stages as first-class objects** [INFERRED from DOC/DEMO]. No product stores (a) a confidence grade on a recommendation, (b) a diagnosis with competing causes, or (c) a per-action outcome verdict against controls. Peec and AirOps merge recommendation and action into one object; Conductor has no action state; Velova overloads "action". Those three gaps are where Project Sun's evidence discipline would show.

### 2.5 Cross-vendor comparison

| Mechanism | Peec | Profound | Best elsewhere | Common weakness |
|---|---|---|---|---|
| Trigger | Per-type rules [DOC] | LLM agent [DOC] | Stated thresholds (Otterly, Yext) [DOC] | Unexplained model triggers |
| Evidence | Prompts, URLs; no answer ids [DOC] | Data categories [DOC] | Page statement beside the approved fact (Scrunch) [DOC] | Caveats not on cards |
| Priority | Unpublished bands [DOC] | Undocumented [DOC] | Recomputable counts (Conductor, Yext, Rankscale) [DOC] | Bands without formulas |
| Confidence | Expiry gate [DEMO] | None [DOC] | Data minimum (Otterly) [DOC] | No sampling error shown |
| Outcome | Chart markers [DOC] | Annotations [DOC]; closed loop [CLAIM] | Object re-checks (Scrunch, Trakkr) [DOC] | Before/after, no control |

**Where the market agrees [DOC]:** pitch cited pages that name rivals but not you; split owned from earned; brief → AI draft → human approval; check facts against a brand fact base; short, expiring queues; before/after outcomes, correlation only. Owned content is universal and earned work nearly so; local listings, commerce and measurement setup are thin [INFERRED].

**Where it is weak:** opaque priority (no band shown to predict results [UNAVAILABLE]); unproven outcomes (a 45-study review finds no stable causal effect [3P] (preprint) ([survey](https://arxiv.org/abs/2607.14035))); thin samples (the IAB says one response is not a measurement [3P] ([IAB](https://www.iab.com/guidelines/measuring-visibility-in-the-ai-era/))); no instrument checks; local businesses outside the US, UK and Australia unserved.

**Verified versus claimed.** Action catalogs are well documented (Peec 11, Adobe 14, Yext 27) [DOC]; no priority band has been shown to predict results; uplift evidence is weak (SIXT, conflicted; glasp.co ×1.82 ([preprint](https://arxiv.org/abs/2606.04362)) [3P]; Ramp and Airbyte [CLAIM]).

### 2.6 What we adopt and what we reject

| Adopt | From |
|---|---|
| "Placed": credit only when a page newly names the business; no credit if already in place | Scrunch [DOC] |
| "Verified" set only by re-audit, never by hand | AthenaHQ [DOC] |
| A frozen check plan per action; "coincided", never "caused"; falls reported | Trakkr [DOC] |
| Experiment prompts kept outside the main library and quota | Adobe [DOC] |
| A record of outside work, shown as a possible cause | Peec [DOC] |
| Experiment tags set before shipping | Profound [DEMO] |
| Minimum wait and caveat wording | Gauge [DOC] |
| Typed action set routed by who owns the cited page; Validation routing for comprehension vs trust | Peec, Profound [DOC] |

| Reject | Why |
|---|---|
| Relative impact bands | A top band always exists; no band shown to predict results |
| Silent expiry of uncertain actions; 30-day timers | Expiry should follow evidence, visibly |
| Agents that publish or send without a manual step | Effects cannot be verified within a run or two |
| High-priority items from one or two observations | Identical runs flip up to 3 of 10 outcomes |
| Listicle-first playbooks and US platform lists | ChatGPT's sources shifted; Yelp is a US/Canada partner |
| Vendor case studies as proof that actions work | All uncontrolled or conflicted |
| Completion scores | Google Ads reaches 100% by applying or dismissing everything |

## 3. Core concept: the eight-stage chain

### 3.1 Stages

Measure's findings stop at stage 3 today [PROVEN]. We add Observation to the brief's seven stages so that one answer is never shown as an insight. Sources: [NN/g](https://www.nngroup.com/articles/data-findings-insights-differences/) on data versus findings [3P]; [Torres](https://www.producttalk.org/opportunity-solution-trees/) on opportunity before solution [3P].

| Stage | Definition | Differs from the previous stage by | Practical test | Example |
|---|---|---|---|---|
| 1. Measurement | A defined count over a frozen instrument (prompt set, competitive set, engine, versions), with numerator, denominator and an insufficient-data rule | Being defined before data arrives | Recomputes from stored rows to the same x of n? n = 0 shows "—"? | Atelier 10 named in 2 of 10 Discovery answers (6-51%) |
| 2. Observation | One verifiable fact from one answer, citation or listing record, with its span or field | Being one unit, not an aggregate | Can you point to the sentence? | A lash answer names six salons with 189-2,092 reviews, not Atelier 10 |
| 3. Insight (a "finding"; code `Opportunity`) | A pattern across observations against a comparator, passing a repetition or materiality rule | Aggregating and comparing | Names its comparator and n? Survives a second run? | DIFC-worded questions named it in 9 of 10, city-wide 3 of 14 |
| 4. Diagnosis | Typed, graded candidate causes, each with evidence for and against and a falsifying check | Saying why; a hypothesis until checked | Competing causes, grades and a falsifier listed? | Question scope (strong) vs specialization (moderate) vs reviews (weak) |
| 5. Opportunity | A sized, addressable gap stated before any solution | Size and addressability, not cause; two solutions could close it | Sized in answers ("up to +k of n")? | 1 of 10 DIFC questions missed (addressable); 11 of 14 city-wide (maybe not) |
| 6. Recommendation | One proposed solution with owner type, effort, grade and check | Choosing a solution | Can it be accepted or declined without re-analysis and routed to one person? | Publish an all-in extension price |
| 7. Action | The business's commitment, with owner, status, due date and ship date | A commitment, not a proposal | A named owner and ship date? | Web editor updates /hair/ |
| 8. Outcome | Re-measurement against a metric fixed before the work: Live, Used, Picked more often; "Inconclusive" allowed | Evidence about the world after the action | Metric, prompts, controls and dates fixed before shipping? | Page re-read within 2 days |

Keep "findings" in the UI: the code name `Opportunity` collides with stage 5 [INFERRED].

### 3.2 Recommendations are not actions

**A recommendation is the system's proposal and belongs to the evidence. An action is a person's commitment and belongs to the business.** Peec's docs use the words interchangeably ([Peec docs](https://docs.peec.ai/actions.md)); AirOps creates an Action only on acceptance ([AirOps](https://docs.airops.com/getting-started/core-concepts.md)) [DOC]. We propose separate, linked objects.

| Test | Recommendation | Action |
|---|---|---|
| Created by | Rules, from evidence | A person, accepting one or writing their own |
| Holds | The change, x of n plus a quote, grade, check | Owner, deadline, status, ship date, proof of done |
| Changes when tomorrow's answers change? | Yes: updates, expires, returns | No: persists; its ship date anchors the check |
| Reassigned if the owner leaves? | Has only a role | Yes |
| Ends when | New evidence changes it | Closed with a verdict, canceled or reverted |

- **One recommendation, several actions.** An all-in extension price: the owner sets the range, the web editor updates /hair/, the front desk aligns the booking menu, the operator schedules the re-check.
- **Several recommendations, one action.** One rewritten lash page can serve an on-page fix and a lash hedge in Sentiment; link many-to-many so one ship date feeds both checks.
- **Actions without a recommendation.** A new branch, a price change, a redesign, a booking-platform switch. Record them: outcome checks must see them as possible causes.
- **Never actions.** Watch items; Decisions answered "no"; advice the evidence rules out (review gating is on the Never list per [Google's policy](https://support.google.com/contributionpolicy/answer/7400114)); paid placement (sponsored cards appeared beside 10 of 20 Atelier 10 by-name answers [PROVEN]), which is a business Decision and a Report line.

On screen: "Suggestions can change when new answers arrive. Once you accept one, it's your action until you close it."

### 3.3 Where the chain breaks

| Transition | Failure | Evidence | Guard |
|---|---|---|---|
| Instrument → Measurement | Wrong domains, country or analysis | Atelier 10's second domain; Studio14's rival domains; a Bengaluru restaurant collected from the US [PROVEN] | Gates Q1-Q4 block cards |
| Measurement → Observation | Misread labels | A no-complaint answer stored as negative [PROVEN]; Velova exported "Position 1" for 5th of 5 [DEMO] | Quote the span; operator approval |
| Observation → Insight | **Single-run noise** | Identical runs flipped 3 and 1 of 10 Discovery outcomes [PROVEN] | Watch until Repeated |
| Observation → Recommendation | Skipped diagnosis | 4 of 11 candidate actions wrong or redundant without a direct check (internal review, 2026-10-24) | Typed diagnosis |
| Insight → Diagnosis | **Citation read as cause** | 46% of unprompted brand mentions had no cited page naming the brand ([Chen & Koudas](https://arxiv.org/html/2610.15033v1)) [3P] (API, observational) | Say "cited", never "influential" |
| Recommendation → Action | Unbounded list | Clinicians override 49-96% of alerts ([van der Sijs](https://pmc.ncbi.nlm.nih.gov/articles/PMC1447540/)) [3P] | At most 3 actions and 1 decision a week |
| Action → Outcome | **Change read as effect** | Flips with no action [PROVEN]; Peec docs word Impact causally while its FAQ disclaims attribution | "Moved, cause unclear" verdict |

### 3.4 Six worked examples on stored data

Figures come from stored runs read by 2026-11-09; some carry analysis defects that newer code fixes. Scope: ChatGPT on the web, signed out, English questions. Examples 1, 3, 4 and 5 recur in sections 5.3, 6.1 and 10.7.

1. **Atelier 10 (DIFC salon): fix the measurement first.** On 2026-10-15 "Your site cited" read 15 of 30, but atelier10salon.ae (cited in 16 of 30, once beside the salon's phone; 16-25 of 30 across four runs) is unrecorded and counts as third party [PROVEN]; ownership is a strong [HYPOTHESIS]. Gate Q2; a recount, no client work. Advice on today's figures would be wrong by 5-14 answers in 30. Measure's "possibly yours" hint changes no figure and would flag an unrelated studio14-training.de [PROVEN] (code).
2. **Atelier 10: a Discovery gap where rivals are named.** For a DIFC men's haircut ChatGPT named The Gents Salon (446 reviews), UB Grooming (175) and 1847 (12); Atelier 10 has 111, category "Beauty salon" [PROVEN]. Reviews don't separate the chosen; place does (9 of 10 DIFC-worded vs 3 of 14 city-wide, pooled). Decide where to compete (default DIFC); if men's grooming matters, complete a directory profile that lists only a ladies' haircut (hand-checked 2026-10-24, not stored); no review card.
3. **Studio14 (Pilates, Dubai): three ways to be absent.** Own site cited in 29 of 30 answers (2026-09-18), yet left out of "luxury" studios (listings retrieved), semi-private (own pages cited) and the roll-shaper class (page cited, listing not retrieved); a run 63 minutes earlier named it in the last two [PROVEN; "retrieved" INFERRED]. Rival domains frozen wrong understate rival citations by up to 8. Q3 first; a Decision on "luxury" (default no); Watch the rest. No run in 7 weeks.
4. **Postman (B2B): a lost head-to-head aspect.** In 4 of 5 Insomnia Trade Offs, ChatGPT tied Git and local-first work to Insomnia, all citing Kong's comparison page [PROVEN]; "RBAC" was counted as a rival. A framing Decision (Card 3).
5. **Atelier 10: an unclear-price hedge and a misread concern.** A price answer began "Not completely"; the stored "reputation concern" was a no-complaint answer read as negative [PROVEN]. Re-analyze; owner decides; publish a price range (Card 1). The only example with client work ready now.
6. **Atelier 10 lashes: Peec-style outreach meets Profound-style routing.** Lash and brow Discovery 0 of 5 in October (September DIFC wording 2 of 2); favorable when asked by name [PROVEN]. Routing says trust gap, but no Validation prompt exists and place competes; whether cited pages omit the salon is [UNAVAILABLE]. Decision on priority (default no); pitch only fitting lists after UAE legal review; expect "Inconclusive". fresha.com (cited in all 8 answers without the salon) is a booking platform where the salon has a venue: a 2b Watch item, not outreach.

| Example | Steps before client work | Client work now |
|---|---|---|
| 1 Second domain | Fix measurement | None |
| 2 Rivals named | Decide; re-measure for "Picked" | After the decision |
| 3 Studio14 | Fix measurement; decide; re-measure | If a check finds the gap |
| 4 Postman | Fix measurement; decide; optional check | After the decision |
| 5 Price hedge | Fix measurement; decide | **Yes** |
| 6 Lash lists | Decide; re-measure | Page fix only |

Four of six cases need a measurement fix first, five need an owner decision, and one ends in client work ready now [INFERRED] (from stored data).

## 4. Recommendation categories

### 4.1 The ten starting hypotheses

An **action category** is defined by the object that changes and who changes it. A **lens** is defined by where a problem shows up (topic, place, source, rival). The founder asked that each action state what, why and how simply enough to route.

| Hypothesis | Verdict | Why | Lands in |
|---|---|---|---|
| 1 Website and technical | Narrow | Crawler access documented [DOC]; schema and page speed no effect within sites; llms.txt almost never fetched (usage, not effect) [3P] | 1 |
| 2 Brand and entity consistency | Split | Listings, wrong facts and own domains are different jobs | 2; 3; 0 |
| 3 Content | Split | Answering paragraphs hold up; formatting does not [3P] | 4; 5 |
| 4 Topic coverage | Lens | Doesn't say write, list or pitch | L1; new questions → 0 |
| 5 Third-party mentions | Keep | Most convergent evidence, mostly correlational [3P] | 6 |
| 6 Citations and sources | Lens | Shows where answers looked | L2, L3 → 4, 2, 6 |
| 7 Competitor gaps | Lens | A trigger; invites copying | L3, L4 → 5, 6 |
| 8 Digital PR | Merge | Correlational, big-brand [3P] (vendor study) | 6c |
| 9 Local visibility | Lens | Same work, different sources | L1, L7 → 2, 4, 7, 5d, 0 |
| 10 Trust and expertise | Split | Explicit facts help in the lab; author boxes no effect within sites [3P] | 4; 6, 7 |

Five assumptions fail [INFERRED]: "weak visibility means more content" (4 of 11 October candidates were wrong or redundant without a check); "technical foundations come first" (test sites are already cited: Studio14 29, Postman 26, Atelier 10 15 of 30 [PROVEN]); "local means Google plus Yelp" (Atelier 10's most-cited domain was fresha.com, 19 of 30 [PROVEN]); "a competitor gap is something to copy" (it is a trigger); "every finding deserves a task" (many are Watch, Decision or Pass to your team). Missing areas the hypotheses lacked: measurement fixes, fact correction, reviews, positioning, "let go", operations routing and paid placement as information. Commerce feeds wait: OpenAI's is limited to approved US, Canada and Mexico partners ([OpenAI commerce](https://developers.openai.com/commerce/guides/get-started.md)) [DOC].

### 4.2 The gate and seven categories

**Enablement rule.** A category can produce a Fix or Experiment only once Project Sun can check its condition directly. A dated owner confirmation counts and is labeled as one. Structured data becomes hygiene; "factual density" survives as explicit facts and prices.

| # | Owner-facing name (pillar) | Object of work; person | Sub-categories | Fix or Experiment allowed when | Phase |
|---|---|---|---|---|---|
| 0 | **Check our numbers** (gate, before all pillars) | Our instrument; operator, owner yes/no | Own and rival domains; untracked businesses; observer country and re-analysis; confirmed readings | Always (recount) | MVP |
| 1 | **Let ChatGPT read your site** (Foundation) | robots.txt, CDN, served HTML; developer | 1a crawler access; 1b text in served HTML; 1c platform controls; 1d booking links | robots per AI agent and an AI-agent fetch show a block | v2 |
| 2 | **Fix your listings** (Foundation) | Map, booking, directory profiles; listings manager | 2a map profiles; 2b booking and marketplace platforms; 2c directory profiles; 2d consistent details | Listing read, record ≤30 days old, or owner confirmation | MVP Watch; v2 |
| 3 | **Correct wrong facts** (Foundation own / Authority third-party) | Source of the false fact; content owner, PR | 3a own page; 3b own listing; 3c third-party request; 3d dated statement | Confirmed fact plus a read at the claim | v3 |
| 4 | **Say it on your website** (Content) | Own pages; website editor | 4a missing facts; 4b service and area pages (only where a branch exists or the service is delivered); 4c name business and place where answers quote; 4d stale facts | Own-page read or owner confirmation | MVP |
| 5 | **Choose your position** (Content + Decision) | Position on a criterion; owner, product marketing | 5a position on the deciding criterion; 5b who it's for; 5c framing; 5d compete or let go | Owner-confirmed facts | MVP 5d; v2 |
| 6 | **Ask to be on the pages ChatGPT reads** (Authority) | Third-party pages; marketing, PR | 6a existing mentions; 6b cited lists; 6c cited publications; 6d community; 6e original data | Page read shows you absent, a rival named, a legitimate way in | Watch MVP; v2 |
| 7 | **Reviews and reputation** (Authority) | Reviews; true complaints; owner, front desk | 7a reviews within platform rules; 7b replies; 7c objections; 7d true complaints | Platform counts separate chosen from not chosen in ≥2 runs; sentences re-read | MVP Pass to your team; v2 |

Pillar mapping: Foundation → 1, 2, 3 (own sources); Content → 4, 5; Authority → 6, 7, 3 (third-party). "Expert citations" count under 6 only when the expert sources are themselves cited. Category 0 runs before any pillar; 5d lets a plan recommend not competing. With no page fetch or fact store [PROVEN], the MVP fully serves only 0, owner-checked 4a and 5d, and Pass cards; the rest start as Watch.

### 4.3 Category by category

Outcome windows are "first look / confirm" estimates [INFERRED]. A condition must hold in 2+ answers or runs unless it is a defect in itself.

| # | Problem and evidence needed | Data: have / missing | Examples (local; B2B) | Business does | How we know | Lever evidence; vendors |
|---|---|---|---|---|---|---|
| 0 | Card figures wrong: own or rival domain miscounted, wrong country, outdated analysis | Have owners, rival checks, country, versions; missing evidenced ownership | "Is atelier10salon.ae yours? Cited in 16 of 30; if so your site was cited in 20 of 30, not 15" [PROVEN counts]; map Kong's Insomnia docs to its maker (all 4 Postman framing answers cite it) | Answers yes/no in minutes; operator re-analyzes | Immediate recount: "Changes our numbers, not ChatGPT" | [PROVEN] on our figures (5-14 of 30 answers); hygiene only at [Otterly](https://help.otterly.ai/ai-recommendations) |
| 1 | Own pages uncited in 2+ runs **and** a robots or AI-agent block. Our crawl failure alone never counts: we read /hair as empty, yet ChatGPT quoted its prices [PROVEN] | Have crawl; missing AI-agent fetch; Search Console gave no data in 51 crawls | "robots.txt blocks OAI-SearchBot; cited in 0 of 30"; "Serve prices in HTML" (both illustrative) | Developer fixes rules: hours to days | Live: re-fetch. Used: cited. ~24 h per OpenAI; first look ≥7 days, confirm 14-28 | Platform-documented, strong on mechanism, silent on size ([OpenAI crawlers](https://developers.openai.com/api/docs/bots)); Peec, Athena |
| 2 | Cited platforms omit or misdescribe the business, 2+ runs | Have cited URLs; listing records stored but unparsed | "Fresha was cited in all 8 answers that left Atelier 10 out" [PROVEN observation; effect HYPOTHESIS]; "Complete your G2 profile" (illustrative) | Claims profiles; adds services, prices: ~1 hour each | Live, then cited or retrieved. Already-cited platform 7-14 / 28-42 days; map-listing edit 14-28 / 42-56 [HYPOTHESIS] | Correlation only (weak to moderate); UAE/India [HYPOTHESIS]; listed prices OR 1.54 ([census](https://arxiv.org/abs/2608.07069)); Yext, Synup |
| 3 | A false price, hours or plan limit contradicting a confirmed fact in 2+ answers | Have answers, profile; missing fact store, page read | "Ask Tripadvisor to fix your hours: 3 of 10 answers say 9 pm, not 11"; "Correct the plan-limit help page" (illustrative) | Edits its source; sends publishers proof | Live, then claim rate over 2+ occasions ≥7 days apart; corrections can fade | Some evidence (weak; one case) ([Seer](https://www.seerinteractive.com/insights/geo-experiment-how-ai-highlighted-the-1-bad-review-we-got-in-24-years)); no-regret; Profound FactCheck, Peec, Scrunch |
| 4 | A by-name answer hedges, citing an own page (gaps in 9 of 80 answers, 2026-10-24 review) | Have answers, crawl; missing a hedge rule | ChatGPT said the full extension cost isn't clear upfront, quoting "Price upon consultation" rows [PROVEN]; "Add enterprise details" (illustrative) | Editor states the fact; no FAQ or schema | Next run quotes it; 14-21 / 35-56 days | Some evidence, for other outcomes: best-paragraph match +9.5% ChatGPT citations, API ([Chen & Koudas](https://arxiv.org/html/2610.15033v1)); no study measured a hedge; Peec content optimization |
| 5 | Rival preferred on a criterion; absent from a topic in 2+ answers | Have comparisons; missing repeat answers, condition extraction | "Compete for lash extensions? Six specialists named, not you" [PROVEN]; Insomnia tied to Git-first in 4 of 5 Postman head-to-heads [PROVEN] | Owner decides; states the position or lets go | Large falls only: 8 → 2 of 15 counts; 7 → 2 does not | Untested; versus pages correlate with B2B referrals ([Siege Media](https://www.siegemedia.com/research/versus-pages)) [3P vendor]; comparison pages ×0.34 citation odds at equal rank; no vendor offers "let go" |
| 6 | A cited third-party page omits the business, 2+ Discovery answers | Have URLs; missing page read (waits on SSRF fixes) | "Pitch the Pilates guide cited in 3 of 10"; "Pitch the API roundup" (illustrative) | Marketing joins lists, pitches | Placed, then cited; 7-14 / 28-42 days | Some evidence, mostly correlational: ×39.7 odds niche B2B, ×4.2 big consumer brands ([Chen & Koudas](https://arxiv.org/html/2610.15033v1)); Scrunch |
| 7 | Fewer reviews where platform counts separate chosen from not chosen; or a fair criticism in 2+ answers | Have portrayal; ratings partial in payloads | Studio14 beginners "under-guided" [PROVEN, once]; "Setup hard" (illustrative) | Neutral requests to all customers; fixes complaints | Months; first look 4-6 weeks | Correlation only, local entry: review volume OR 1.64, rating null ([census](https://arxiv.org/abs/2608.07069)); B2B [HYPOTHESIS]; Yext |

"Get more reviews" is **not supported by this run's data** for Atelier 10: businesses named instead had 12 to 2,853 reviews against its 111, and those not named were not examined [PROVEN].

### 4.4 Lenses and routing

Lenses add evidence lines to a card; they are never cards.

| Lens | Source today |
|---|---|
| L1 Discovery absence (by topic, place, criterion) | `discovery_gap`; `byTopic`; `byPlace`; stored but unused `evaluation_criterion` and sentiment theme |
| L2 Pipeline stage (section 5.1) | Answer-level citation mix; "retrieved" needs parsed listing records |
| L3 Source landscape | `source_gap`; Sources (`discoveryWithoutTarget`); kind guessed from host |
| L4 Head-to-head (verdicts, aspects, conditions) | `tradeoff_loss`; aspects mostly null |
| L5 Portrayal (negative, mixed, hedges, objections) | `reputation_concern` (Sentiment section only) |
| L6 Factual accuracy | None |
| L7 Place and name | September fan-out queries only, unparsed |
| L8 Measurement integrity | `coverage_gap`, `untracked_brand`, "possibly yours" hint, breaks |
| L9 Paid presence | 33 payloads (one provider), unparsed |

| Finding | Check before recommending | Category (then alternatives) |
|---|---|---|
| L8 any defect | — | 0, always first |
| L1 gap; platform pages cited | Is the business on that platform's page? Read the listing | 2 → 7 → 4 |
| L1 gap; editorial list cited | Fetch: brand absent, a rival named, an inclusion route; not a rival's or affiliate page | 6 → 4 |
| L1 gap; rivals named, no third-party source | Repeated? | Watch → 4 or 5 |
| L2 not retrieved (local) | Listing exists? Category matches? | 2 |
| L2 own site cited nowhere | Fetch with AI user agents; robots per bot | 1, only if a block shows |
| L2 retrieved, not chosen | What separates chosen from not chosen, read on the platform | 7 → 5 → Decision |
| L2 cited, not named | Does the cited passage name the business and place? | 4c |
| L2 named, not cited | Probably the model's prior; slow to change | None, or 4 |
| L3 own or rival domain counted as third party | Ownership | 0 |
| L4 loss on a criterion | Aspect correct? Position stated on the site? | 3 if wrong → 5a → 5d |
| L5 "couldn't find X" hedge | X absent, buried, or a crawl artifact? | 4a |
| L5/L6 wrong fact | Trace to the citations at the claim | 3a / 3b / 3c by source owner |
| L5 recurring true criticism | Read the sentences; ≥2 answers | 7d → 7c |
| L7 wrong place or name collision | Do listing and site name the place? | 2d → 4c → 0 |
| L9 rival ads on brand questions | — | Report line only |

### 4.5 What is never generated

| Group | Why | How it appears |
|---|---|---|
| **Not shown to help:** schema, FAQ blocks, summary boxes, author boxes (tested, no effect); llms.txt (almost never fetched); date-only refreshes (untested) | Null within sites ([Chen & Koudas](https://arxiv.org/html/2610.15033v1)); schema difference-in-differences null ([Ahrefs](https://ahrefs.com/blog/schema-ai-citations/)); 97% of llms.txt files never requested ([Ahrefs](https://ahrefs.com/blog/llmstxt-study/)) [3P vendor]; Google needs no special schema or AI files [DOC] | Method note "SEO hygiene, not an AI lever"; never a rejected card |
| "Add statistics and quotations" rewrites | All 80 live statistics rewrites unfaithful ([LIVE-GEO](https://arxiv.org/abs/2611.01126)) [3P] | Not generated |
| **Never (manipulation and policy):** fake, incentivized or selectively requested reviews; review prompts filtered by rating or sentiment, including booking-tool add-ons; asking customers to mention a service or keyword; staff review quotas; pressure on the premises; review swaps; seeded or undisclosed staff or agency posts; undisclosed paid placement; prompt injection; conflicted Wikipedia edits; pitches to rivals' own pages; doorway pages; pages served only to AI agents; outreach under another identity or from lookalike domains | [Google review policy](https://support.google.com/contributionpolicy/answer/7400114); [FTC rule](https://www.ftc.gov/news-events/news/press-releases/2024/08/federal-trade-commission-announces-final-rule-banning-fake-reviews-testimonials) [DOC] | Never; operator flags if a client already does it (for example a rating-gated booking add-on, to be verified first) |
| Paid placement | Not organic; sponsored cards on 10 of 20 Atelier 10 by-name answers (13 of 30 overall) on 2026-10-15 [PROVEN] | Report line; only one provider records ads, so other runs read "not recorded", never 0 |

**Regulated route.** For healthcare, finance and legal kinds (already detected as `regulatedDomain` [PROVEN] (code)), every card opens with "Check your licensing rules first", and price, claim, comparison, testimonial and review-request cards stay hidden until the owner confirms approval, recorded with its date. UAE health advertising needs a MOHAP license ([MOHAP](https://mohap.gov.ae/en/services/license-for-healthcare-advertisement-on-social-media)) and DHA's 2022 standard governs content [DOC] (pages found; details from news, not verified). Outreach consent rules for the UAE and India were not researched [UNAVAILABLE].

### 4.6 Local businesses: UAE and India

| Channel | Evidence | Category | Gap |
|---|---|---|---|
| Map profiles (Business Profile, Apple, Bing Places) | Google documents profiles as inputs to its own AI features ([Google](https://support.google.com/business/answer/7091)) [DOC]; Dubai ChatGPT map cards carry Google place ids; map links in 12 of 30 Atelier 10 answers [PROVEN] | 2a | Which provider feeds ChatGPT's business cards in the UAE and India [UNAVAILABLE] |
| Booking platforms (Fresha, Booksy, Practo) | fresha.com cited in 19 of 30 Atelier 10 answers, all 8 Discovery answers without the salon [PROVEN] | 2b; reviews 7a | Booksy, Practo never observed |
| Delivery apps (Talabat, Deliveroo, Zomato, Swiggy) | Nothing; three restaurant runs exist (The Banc 1 of 10; Truffles 3 of 10; Empire 0 of 10 from a US exit), cited domains unexamined | 2b; aggregator vs direct is a Decision | A read-only query of those runs is the cheapest next check |
| Directories (salonsindubai.ae, gymfinder.ae, dubai.med; Justdial, Sulekha) | salonsindubai.ae 8 of 30; gymfinder.ae 10 Studio14 answers; dubai.med 6 [PROVEN]; Indian directories never observed | Profile → 2c; editorial list → 6b | No study [UNAVAILABLE] |
| Review sites (Tripadvisor, Google) | Tripadvisor 14 of 30 Atelier 10 answers [PROVEN]; volume association from Bali only [3P] | 7a | No Gulf or India study |
| Instagram- and WhatsApp-first businesses | Reddit is 51% of ChatGPT's UAE social citations (India 76%) ([Profound](https://www.tryprofound.com/blog/how-query-language-reshapes-ai-citations)) [CLAIM]; own website ×1.92 entry odds (Bali) [3P] | 1, 4 [HYPOTHESIS] | Intake requires a URL, so Instagram-only businesses cannot be onboarded [PROVEN] (code) |
| Arabic and Hindi questions | Not studied; Peec says 43% of fan-outs for non-English prompts were in English [CLAIM] | 0 (a new prompt set is a break) | [UNAVAILABLE] |
| Place inside the country | Fan-outs for city-less questions named Abu Dhabi, Sharjah, Ras Al Khaimah [PROVEN]; ChatGPT API localizes to a declared city ([Chen & Koudas](https://arxiv.org/html/2610.24081v1)) [3P] | 0, then 2d, 4c | Consumer signed-out location channel untested |

Rules [INFERRED]: build each market's platform list from observed citations, never from US lists (Yelp, BBB, Foursquare), which also keeps the no-hardcoding rule; show a platform scoreboard (rating, reviews, categories) against the businesses chosen; supplier-side marketplace listings are category 2; aggregator vs direct is a Decision with a default; seasons (Ramadan, Diwali) go into the event log; listing cards say "Correlation only, on ChatGPT; Google documents listings for its own AI features, which we don't measure" (S8).

### 4.7 Overlaps and de-duplication

| Overlap | Rule |
|---|---|
| Listings (2) vs third-party pages (6) | By URL and who controls it: claimable profile → 2; editorial page → 6 |
| Facts (3) vs listings (2) vs own pages (4) | By state: wrong → 3; missing → 4 (own), 2 (listing) or 6 (third party) |
| Own pages (4) vs position (5) | "What, how much, do you" → 4; "versus, which, who is it for" → 5 |
| Reviews (7) vs listings (2) | Completeness → 2; volume and replies → 7 |
| Reputation (7) vs position (5) | Criticism in by-name answers → 7; lost comparison → 5; true complaint → Pass to your team |
| Access (1) vs measurement (0) | Re-test with AI agents before filing under 1 |
| Brand-written community posts (6d) | File under 6: others moderate the surface |

1. **One card per key:** category + canonical object (URL; else domain and path; else topic or place) + scope + the business's registrable domain. Other findings become evidence lines. Example: Atelier 10's men's haircut gap (L1), fresha.com cited (L3) and the gents venue not retrieved (L2) make one category 2 card with three evidence lines.
2. **Tie-break:** 0 → 3 → 1 (after a failed check) → 2 → 4 → 5 → 6 → 7; within that, Fixes before Experiments.
3. **Alternatives** share an `opportunity_key`; one sits in This week, the rest under "Other ways to address this".
4. **A question counts toward one This-week card per check window;** cards on the same prompts are run in sequence or checked as one bundle.
5. **Suppression:** a dismissed card returns only if its evidence doubles or its grade rises; done cards are not re-suggested inside their window; "Not now" returns after 4 cycles.

## 5. Diagnosis framework

### 5.1 Where in the answer pipeline the business was lost

Per Discovery answer without the business, after the gate [PROVEN per answer; class INFERRED]:

| Pattern | Points to | Caveat |
|---|---|---|
| Own pages cited somewhere in the run | Access works, so not technical | Only for the pages cited |
| Own pages never cited across 2 runs, and the robots or HTML check fails | Technical (1) | Per-agent robots read; logs |
| Own page cited, business not named (**cited, not named**) | Content: the passage doesn't credit you (4c), or selection | Studio14's two cases flipped within an hour |
| Listing absent from the answer's local records (**not retrieved**) | Listing or category (2) | "Retrieved" is our reading of payload records |
| Listing present, others named (**retrieved, not chosen**) | Selection: reviews, specialism, positioning (7, 5) | Named businesses had 12-2,853 reviews |
| By-name answer says a fact is unclear; profile says not stated | Information gap (4a) | Our crawl may have failed |
| Cited third-party pages checked, business absent | Authority (6) | Needs a page fetch |
| Place-worded and city-wide questions differ, or observer country wrong | Geography, or measurement (0, 5d) | Place inside the country uncontrolled |
| Named when asked, but answers say little is known | Weak entity presence | Search is always on, so memory-only answers are unobservable |
| Named, not cited | The model's prior | Slow to change; usually no card |

### 5.2 Comprehension gap versus trust gap

Profound's routing is the most useful published diagnosis [DOC]: low Discovery plus a Validation "no" (AI doesn't know you do it) is a **comprehension gap** → own pages (4a, 4b); low Discovery plus Validation "yes" (AI knows but doesn't recommend you) is a **trust gap** → third-party presence, listings and reviews (2, 6, 7); a wrong fact traced to a citation is **accuracy** → correct the source (3). Project Sun has no Validation prompts, so today the routing can only be inferred from by-name answers (Sentiment and Trade Offs) [INFERRED]. Adding Validation, Accuracy and Market-perception probes is decision 15 (v2-v3, owner-confirmed, outside the frozen 30). Use the course's three page gates (not fetchable / not chosen / not extractable) as diagnosis vocabulary for own pages.

### 5.3 Typed diagnoses with falsifying checks

- **Mandatory fields** in `diagnosis[]`: competing causes; evidence for and against each; a grade per cause; a check that would falsify it. A diagnosis never outlives its recommendation in the MVP.
- **Show a diagnosis only when a cause has evidence for or against it** (S14); owners see at most two evidence words per card.
- **Drop any diagnosis that does not separate the chosen businesses from the rest** (the review-count rule).
- **Stated reasons are not causes:** an answer saying it shortlisted on reviews does not make reviews the cause.

| Situation | Competing causes | Falsifying check |
|---|---|---|
| Price hedge citing /hair/ (Atelier 10) | Information gap; buried fact; crawl artifact; deliberate policy | Answer quotes the page (rules out crawl artifact); owner or page read confirms no total; owner says consultation pricing is deliberate (→ Decision) |
| Cited class page, studio not named (Studio14) | Listing lacks the class; page doesn't name the studio and place; normal variation | Re-ask: left out in ≥4 of 6 new looks; read listing categories; read the cited passage |
| DIFC men's haircut absence (Atelier 10) | Question scope; specialization; reviews | Place-worded vs city-wide counts; listing categories of chosen businesses; review counts of chosen and not chosen |
| Insomnia framing (Postman) | Answers repeat the rival maker's framing; Postman's page is silent; the framing is accurate | Kong page cited in all 4 (supports H1); read Postman's page (H2); product confirms support today (H3) |
| Reputation concern | Misread; fair criticism; wrong fact; "couldn't find" | Operator reads the sentence (Q5) |

## 6. Measurement gate (Q1-Q8)

Category 0 runs before any client card. An open gate item blocks every card it could change. Coverage gaps never become cards; they add "so far" and lower grades a step. Gate IDs were renamed from G1-G7 to Q1-Q8 so they do not collide with the data-fit defect list (section 6.3).

| Gate | Fires when | Card | Blocks | Phase |
|---|---|---|---|---|
| **Q1 Update results** | Served analysis version, policy version or claims hash is not current | "Update results: n answers were read with older rules" (operator) | Every client card | MVP W1-W2 |
| **Q2 Is this domain yours?** | A domain spells the brand **and** a second signal agrees (crawled handle or profile link; from v2, citation titles or listing websites), in ≥2 answers. One signal stays an operator hint | Question for you, with the recount as a "what if" line | Own-site cards | MVP W1-W2 |
| **Q3 Is this the rival's site?** | A rival's recorded domain failed verification, or it is uncited while a domain or path naming the rival is cited in ≥2 answers | Measurement fix: correct the domain, or map a rival's documentation path | Cards resting on those domains | MVP W1-W2 |
| **Q4 Collect from your market** | At least half the answers were observed outside the business's country | Measurement fix: re-collect | Place-bound cards | MVP W1-W2 |
| **Q5 Read losses and concerns** | A `reputation_concern` or `tradeoff_loss` exists | Operator reads it: misread, fair criticism, wrong fact, or "couldn't find" | Cards on that reading | MVP W3-W8 |
| **Q6 Track this business?** | An untracked business in ≥3 answers (≥2 if Landscape suggested it or a listing matches), after the Q8 name test | Operator Decision: track it (a new baseline, a break) | Nothing | MVP W3-W8 |
| **Q7 Re-read an empty page** | The crawler stored an empty page that an answer cites | Operator re-read; browser re-fetch from v2 | "Not stated" and "missing page" cards | MVP W3-W8 |
| **Q8 Names checked** | A card would name a business that is not in the frozen competitive set, not a Landscape suggestion, not operator-confirmed and (from v2) not matched to a listing record | Card says "plus k names we could not confirm as businesses" | Naming that business on any card | MVP W1-W2 |

**On stored data (2026-11-09) [PROVEN]:** Q1 fires for every project (no stored analysis at `@18`; live analyses span `@1`-`@17`, Measure snapshots `@10`-`@17` at policy `@2`-`@3`). Q2 fires for Atelier 10 (atelier10salon.ae in 16 of 30). Q3 fires for Studio14 (realpilates.ae parked and failed verification; thehundredpilates.com is a California studio yet marked verified; real-pilates.com and thehundred.ae are cited in 4 answers each as third party) and for Postman (Kong's Insomnia docs and apidog.io unrecorded). Q4 fires for the Bengaluru restaurant (Empire) observed from the US; every "detect from my website" project defaults to the US.

**Strictness (decision 9).** Block on Q1-Q4 and Q8; warn and downgrade on Q5-Q7. After 7 days without an owner answer, the default applies with a caveat (for Q2: "not yours", figures unchanged) (S15). Drop any gate whose pilot yield is under one useful item per ten clients (M11).

### 6.1 Ownership claims (M4)

The ownership overlay is the one workflow step that changes Measure figures, so it needs evidence.

1. **Target claims cover registrable domains only.** Each needs a person's confirmation **plus** at least one recorded corroboration: a link from the crawled site; the listing's website field; the same phone or street address on both sites; or a DNS or meta-tag token (required when contested).
2. **Pending claims change no figure;** they show only a "what if" line.
3. **Path-prefix claims** may only map a rival's documentation (for example `developer.konghq.com/insomnia/`); they can never raise the target's figures.
4. **Platform profiles** (Fresha, Instagram, map listings) appear on a separate line, "your profiles cited", never as "your site".
5. **The Report lists every claim** with who confirmed it, the evidence, the date and the before-and-after figures; withdrawals are recorded in the same lineage.
6. **Claims and plans key to the business's registrable domain.** The operator marks one primary project per business (atelier10.ae has 12 projects in the DB holding four runs and three prompt sets [PROVEN]); other projects show a banner.
7. **Atelier 10 today:** the crawl stored matching handles, but the listing's website field names only atelier10.ae and the crawler keeps no generic outbound links, so the claim stays pending until a matching phone, address or token is recorded.

Mechanism (proposal): a pure `applyOwnershipClaims` in `measure/engine.ts`, an append-only hashed `ownership_claims` table, the claims hash in lineage, and one policy bump (written as `measure-policy@5` on 2026-11-09; use the next version at build time). Re-analysis cannot do this (rows at one version never change), and a new competitive set would break comparability.

### 6.2 Names checked (M5)

"Fade", "Trade Centre", "Oval" and "Round" are still detected as businesses in salon runs; "Fade" led DIFC's place table [PROVEN] (`MEASURE_AUDIT.md` section 7). A single card saying "track Fade" would undo the trust receipts are meant to build. Q8 applies the name test above; confirmed names persist per business to save operator time.

### 6.3 Measurement defects that would contaminate recommendations

Beyond the Q-table rows above (stale analyses, own domain, rival domains, country, names):

| Defect | Evidence [PROVEN] | Handled by |
|---|---|---|
| Own domain, size of the error | atelier10salon.ae as owned: 15 → 20, 6 → 20, 17 → 25, 18 → 25 across four runs; Discovery 1 → 8 (September) | Q2, M4 |
| Sentiment and role misreads | "Couldn't find a complaint" read as negative (fixed in `@18` code, not applied); "never" negation, table cells, opinions without the brand name, second picks stored as mere mentions; 14 of 18 remaining negative or mixed readings unreviewed | Q5 |
| Place inside the country uncontrolled | Abu Dhabi, Sharjah, Ras Al Khaimah in fan-outs | Place claims only from place-named questions (M12) |
| Crawl gaps read as site gaps | `/hair`, `/nails`, `/lashe`, `/barber` stored as 200 with empty bodies (fetched without the slash); `/hair/` cited and quoted | Q7; MVP live checks of those pages read "couldn't read" and must say so |
| Map links as sources | google.com map links in 12 Atelier 10 answers | Exclude map hosts from plan inputs in the MVP; policy change in v2 |
| Missing model labels | All 60 October answers | Caveat on every verdict (S1) |
| Provider handover within a run | The run behind Card 1 mixed two providers | Check runs pin one provider (S1) |
| Ads recorded by one provider only | cloro has no ad field | "Not recorded", never 0 |
| Prompt mix dominates the level | Atelier 10's Discovery moved about 40 points between prompt sets (September 6-7 of 10 with 7 DIFC-worded prompts; October 2-3 with 1-2) | Show the place mix beside the headline (M6, S2) |
| One sample per question | Identical runs flipped 1 and 3 of 10; named businesses overlapped 0.38-0.46 (Jaccard), cited domains 0.54-0.64 | Watch until Repeated |
| Constant `search_state` | "on" in 419 of 419 | State that all answers used search |
| Several projects per business | atelier10.ae has 12 | Primary project per business |

## 7. Triggers (T1-T15)

A **look** is one eligible answer in a card's scope; an **occasion** is a calendar day (same-day reruns count as one). Reference runs are the latest finalized run plus earlier comparable ones (same prompt set, competitive set, versions, claims hash); "so far" runs never feed the plan. MVP inputs are already stored [PROVEN]: snapshot, analyses (spans, ownership, comparisons), responses (text, URLs, observer region), each prompt's place, criterion and theme (stored, unused), the profile, crawl pages and entity verification. Hedge and condition word lists are versioned with the actions engine, so changing them forces no re-analysis.

| ID | Trigger (exact rule) | Check needed before a Fix or Experiment | Card · category | Phase |
|---|---|---|---|---|
| T1 | Information gap: a by-name answer hedges ("isn't clear", "upon consultation", "ask for a quote") **and** cites an own page | Fact confirmed absent (read or owner); until then a two-minute Check-first question. If the fact is a price, policy or availability rule, a **Decision first**, then a Fix (S5) | Fix · 4a | **MVP** |
| T2 | Same hedge, no own page cited | Repeated; no page covers it | Watch → Experiment · 4b | v2 |
| T3 | Cited, not named: a Discovery answer cites an own URL and names other businesses | Repeated; cited passage lacks name and place | Watch → Fix · 4c (or 2a) | **MVP** |
| T4 | The target's listing record lacks a service S that the returned records and the profile carry | Record ≤30 days old, or live listing confirmed | Watch → Fix · 2a | v2 |
| T5 | Target's record returned but not named, repeatedly | Platform counts separate chosen from not chosen in ≥2 runs | Decision 5d / Experiment 7a | v2 |
| T6 | A third-party domain (not owned, not a rival's, not a map host, not the business's own profile platform) in ≥2 Discovery answers without the business | Page read: you absent, a rival named, a legitimate way in; Repeated | Watch (MVP) → Fix 2c / Experiment 6b, 6c (v2) | **MVP** (Watch) |
| T7 | Own-area presence ≥2× wider-area presence, ≥2 place-named answers a side | Q4 clear | Decision · 5d; if the default changes nothing, it sits under Later as "Your call, any time" (S2) | **MVP** |
| T8 | Named in 0 of ≥2 Discovery answers in a topic | Repeated | Watch → Decision 5d | **MVP** |
| T9 | Head-to-head loss confirmed by Q5, with the prompt's criterion | Repeated before any Fix | Watch / Decision 5a | v2 |
| T10 | ≥2 Trade Off answers tie a rival to the same condition ("pick X if …") | Owner confirms the facts | Decision → Fix · 5a | v2 |
| T11 | Fair criticism confirmed by Q5 in ≥2 answers or runs | — | Pass to your team · 7d | **MVP** |
| T12 | Own pages cited 0 times in ≥2 runs **and** robots.txt blocks OAI-SearchBot or an AI-agent fetch fails | — | Fix · 1a, 1b | v2 |
| T13 | A profile offering that no prompt asks about | — | Operator Decision: new prompt set (a break) | v2 |
| T14 | Sponsored cards on ≥3 by-name answers | — | Report information | v2 |
| T15 | Wrong fact in ≥2 answers, traced to its source | Fact store; read at the claim | Fix 3a, 3b / Experiment 3c | v3 |

**MVP subset:** T1, T3, T6 (Watch only), T7, T8, T11, with Q1-Q8. T2, T9 and T13 moved from the MVP to v2 to hold the MVP at 6-8 developer-weeks (S12).

### 7.1 Release rule and why the MVP is operator-approved

- **Rule:** a trigger releases cards without operator approval only after **≥30 blind-labeled detections from ≥3 business kinds, with a 95% Wilson lower bound ≥75%**: 28 of 30, 36 of 40 or 44 of 50 correct (roughly 90% observed precision). Wilson bounds: 27/30 → 74.4%; 28/30 → 78.7%; 36/40 → 76.9%; 44/50 → 76.2%. The earlier "≥90% on about 100 labeled answers" was statistically empty: 9 of 10 has a lower bound of 60%, 5 of 5 of 57%.
- **Volume:** T1 fired on 3 of 279 by-name answers (about 1.1%) and T3 on 3 of 140 Discovery answers (about 2.1%) [PROVEN]. Thirty detections need about 2,800 by-name answers (about 140 runs at 20 a run) or 1,400 Discovery answers (140 runs at 10). At 8 clients on weekly runs, about **17-18 weeks** [INFERRED].
- **Consequence:** no trigger passes during the pilot or MVP, so operator approval of every client card is the MVP's steady state.
- **Keep the narrow hedge list.** Broader phrases ("couldn't find", "not publicly listed") match 31 answers, many of them "no complaint found" sentences, so precision would fall.
- **Misses:** a blind second reader reads the 31 broad matches plus 50 random answers and reports misses found; a recall rate is reported only once ≥30 true positives exist (50 random answers at a 1-2% base rate hold about one positive).
- **Drift (S9):** monitor each trigger's firing rate per run; relabel golden runs quarterly; fail closed when a payload field disappears.

## 8. Evidence methodology

### 8.1 What observations prove, and what they cannot

| Statement | Example | Proves | Cannot prove |
|---|---|---|---|
| Observation | atelier10salon.ae cited in 16 of 30 answers of one run | What one answer said, that day | A pattern or reason |
| Measurement | Named in 2 of 10 Discovery answers (6-51%) | A level with uncertainty | Topic, place or rival rates; a trend |
| Diagnosis | All 4 answers tying Git-first work to Insomnia cited Kong's page | Condition and pattern co-occur | That fixing it changes answers |
| Outcome | "This action changed answers" | At best "consistent with the change" | Cause |

A citation shows retrieval, not influence (46% of ChatGPT's unprompted brand mentions had no cited page naming the brand [3P]). Most lever studies use developer APIs, whose cited domains overlapped the ChatGPT interface's by 12.0% in one audit ([Uberti-Bona Marin](https://arxiv.org/abs/2609.18729)) [3P]; within sites, retrieval explained 32% of ChatGPT citation variation and page features 2.8% [3P] (small API models).

### 8.2 Two questions, never merged

Borrowed from GRADE, which judges certainty of evidence apart from strength of recommendation ([GRADE handbook](https://gdt.gradepro.org/app/handbook/handbook.html)) [3P]. "Checked" paired with "Correlation only" is common and honest: the problem is real and the remedy uncertain.

**Question 1: is the problem real here? (diagnosis grade, computed, never rated)**

| Grade | Entry rule (all parts) | Opens |
|---|---|---|
| **Checked** | Condition verified on a recorded date (read, recounted, or confirmed by a person and labeled so) **and** either the pattern is Repeated or the condition is a defect in itself (a false fact, a block, an empty page, a missing fact, a listing missing a service sold) | Fix; Experiment if also Repeated |
| **Repeated** | The pattern holds in ≥2/3 of ≥6 looks taken after the card opened, on ≥2 days, with ≥2 wordings, every reading exact or strong; the triggering answer excluded | Watch, promoted once checked |
| **Seen once** | Anything less, or a reason resting only on outside research | Watch; Decision |

- **Downgrade one step** for an unreviewed misread class, a coverage gap, a check older than 30 days, or an outdated analysis.
- **Repeated details:** two frozen questions in one scope count as two wordings; every look since the card opened counts; each card gets at most one re-ask, so nobody can re-ask until a favorable batch appears. A mixed item (3 and 3) closes as "mixed" after its re-ask and reopens only on a new trigger in a later regular run.
- **Owners see counts** ("left out in 4 of 6 tries over 2 days"), never the word "Repeated". The method note states the false-promotion rate.
- **Check labels:** Recounted · Read by Project Sun on ‹date› · Confirmed by you (not read by us) · Checked by your account manager · Answers only. **Page states:** Doesn't name you · Names you · Couldn't read · Out of date.

| True naming rate | P(Repeated), old rule ≥2 of 3 | P(Repeated), new rule ≥4 of 6 | P(closed "not repeated", named ≥4 of 6) | P(mixed, 3-3) |
|---|---|---|---|---|
| 30% | 0.78 | 0.74 | 0.07 | 0.19 |
| 50% | 0.50 | 0.34 | 0.34 | 0.31 |
| 70% | 0.22 | 0.07 | 0.74 | 0.19 |
| 80% | 0.10 | 0.02 | 0.90 | 0.08 |

With 10 Watch scopes per client all truly named 70% of the time, expected false promotions fall from 2.2 to 0.7. "5 of 6" would cut false promotion to 1% but miss 58% of real gaps at a 30% naming rate; rejected. Repeated claims "left out more often than not here", not "always left out".

| Scope | Weekly runs | Fortnightly runs | With one re-ask (3 wordings × 2 days) |
|---|---|---|---|
| Topic, 3 frozen questions | 2 runs: 7 days after the second | 2 runs: 14 days | About 2 days |
| Topic, 2 frozen questions | 3 runs: 14 days | 3 runs: 28 days | About 2 days |
| Single question | Never (one wording) | Never | Re-ask (6) plus the next run's look |

**Question 2: does this kind of change usually help? (lever support; each label names the outcome its evidence measured)**

| Label | Meaning | Sub-categories |
|---|---|---|
| **Platform-documented** | The engine documents the mechanism; necessary, not sufficient | 1a, 1c |
| **Some evidence** | Within-site, quasi-experimental or controlled-live studies; modest; often other engines | 4a, 4c, 6b, 6c, 3a-3c |
| **Correlation only** | Cross-site associations | 2a-2d (on ChatGPT), 7a, PR |
| **Untested** | No study | 5a-5c |
| **Not shown to help** | Null in tests | AI-only markup and files |
| **Never** | Manipulation | Never generated |

### 8.3 Lever evidence (accessed 2026-11-09; none is a controlled test on consumer ChatGPT)

| Lever | Best evidence | Strength | Time to effect |
|---|---|---|---|
| Allow OAI-SearchBot; no firewall challenge; real HTML in the 200 | Opted-out sites not shown in ChatGPT search answers, except as navigational links ([OpenAI](https://developers.openai.com/api/docs/bots)) [DOC]; 20.9% of HTTP-200 pages lacked main content ([Zhang](https://arxiv.org/abs/2611.00884)) [3P] | Platform-documented | ~24 h for robots.txt [DOC] |
| Google-Extended; Search Console generative-AI control | Google docs ([crawlers](https://developers.google.com/crawling/docs/crawlers-fetchers/google-common-crawlers)) [DOC] | Platform-documented (Gemini, Google surfaces) | 1-2 days, generally a few |
| Answer the asked question in the answering paragraph | Best-paragraph match +9.5% ChatGPT citations; title match −0.2% on ChatGPT; within-site, 90 days, API models ([Chen & Koudas](https://arxiv.org/html/2610.15033v1)) [3P] | Some evidence | ~11 days to first citation on ChatGPT ([MaxAEO](https://maxaeo.ai/blog/time-to-citation-ai-search/)) [CLAIM] |
| State explicit facts and prices | Listed prices OR 1.54 for being recommended ([Bali census](https://arxiv.org/abs/2608.07069)) [3P] (vendor-funded, API, observational) | Some evidence (correlational) | As owned pages |
| Be named on pages the engine already cites | ×39.7 (ChatGPT) and ×17.7 (Gemini) odds for niche B2B, ×4.2 / ×6.3 for big consumer brands [3P] (observational, 55 questions, API); planted posts reached 8 of 10 platforms in 7 days ([Liu](https://arxiv.org/html/2610.11932v1)) [3P]; lists can hand rivals the answer (24.3% in one vendor study) | Some evidence (mostly correlational) | "Within days" anecdote ([Peec](https://www.youtube.com/watch?v=h-MGdZJbBH8&t=2037s)) [DEMO]; earned mentions median 22 days [CLAIM] |
| Partner listings you control | SIXT +320%, not ChatGPT [CLAIM] | Some evidence (one case) | 2 weeks |
| Local listings (categories, services, prices) | Google and Microsoft document current profiles for their own AI surfaces [DOC]; UAE and India unstudied | Correlation only on ChatGPT; [HYPOTHESIS] for UAE/India | Unmeasured |
| Review volume and rating | Volume OR 1.64, rating null for entry but OR 1.17 for first position [3P] (vendor-funded, pre-registered, Bali, API); contradicted in one of our runs [PROVEN] | Correlation only | Months |
| Correct false facts at the source | One vendor case: a correction cited the same day, claim stopped, then faded (Seer) [3P]; closed venues recommended 93 times [3P] | Some evidence; justified as a correction anyway | ≥2 later occasions |
| Name and serve the place | ChatGPT API follows the declared city: 8% business overlap across 15 US cities vs 32% for one city asked twice [3P] | Some evidence | It is the question |
| Formatting (headings, lists, tables) | At equal rank: headings ×1.28, longer pages ×0.59 per SD, list pages ×0.54 [3P] (observational) | Correlation only; redistributes credit | — |
| GEO rewrites, schema, llms.txt, FAQ blocks | Live tests mostly null ([LIVE-GEO](https://arxiv.org/abs/2611.01126); [Ahrefs](https://ahrefs.com/blog/schema-ai-citations/)) [3P] | Not shown to help | — |
| PR, news, Wikipedia | Web mentions correlate ~0.66 with AI visibility (75k large brands) [3P vendor]; no Wikipedia study | Correlation only; mostly out of reach for SMBs | Model releases |

Persistence figures are not constants: Profound's "11-day half-life" is measured from peak on a 14-day window (sustained pages 27-29 days) [CLAIM]. Use them to space follow-ups, not to predict.

### 8.4 Evidence pack and receipt

Every card carries: **scope** (x of n, section, topic or place, engine, sign-in, country, language, dates; no percentage below 5 answers; "—" when n = 0; "so far" while partial); **answers** (quoted spans ≤12 words, links, cited URLs with their recorded owner); **checks** (what, when, method, result, including "couldn't read"); **versions** (analysis, policy, actions engine, claims hash); **limits** (evidence of / not evidence of / wrong if, the existing `OPPORTUNITY_DEFINITIONS` pattern); and a **receipt** (rule, run and answer ids, checks, ordering keys, evidence hash) that "Recompute this card" reproduces exactly.

**Scope line (M12):** "ChatGPT on the web, signed out, asked from ‹country›, English questions." Place claims use only questions that name the place. Hand-offs repeat the scope line.

### 8.5 Wording rules, templates and the claims linter

| Allowed | Forbidden |
|---|---|
| "Named in 2 of 10 Discovery answers (15 Oct; plausible range 6-51%)" | "20% visibility"; any score |
| "3 answers not collected"; "—" when n = 0 | "0%" for missing data |
| "Likely reason, if the page check holds"; "We have not checked …" | "You are invisible because …"; "influential", "authoritative" |
| "Studies found an association"; "Effect unknown"; "Up to +1 of 2" | "Boost"; "guaranteed"; "+25%"; "proven" |
| "Consistent with your change (not proof)" | "Thanks to"; "drove" |
| "ChatGPT on the web, asked from the UAE, English questions" | "Across AI search"; "customers in ‹city›" |
| "Ask the editor to consider …" | "Get listed on …" for pages the business doesn't control; vendor names |

- **Owner vocabulary (exports only):** "recommendation / head-to-head / by-name question", "linked to as a source", "What we saw / Likely reason / What's at stake", "How sure we are", "Does this kind of change usually help?". Banned in exports: AEO, GEO, entity, schema, fan-out, share of voice, boost, rank #1, AI-ready, invisible. The operator Plan view keeps Measure's vocabulary ("share of voice" is Measure's own label) (M3).
- **Templates:** code writes every sentence from typed fields; URLs come only from the answers' citations or the profile; names from the frozen set or profile (after Q8); quotes are exact stored spans. Example (T1): "Asked by name about {fact}, ChatGPT said '{quote}' ({k} of {n} {section} questions, {date})." Templates are tested at n = 0, 1 and ≥5.
- **Claims linter:** every number must equal an evidence field; enforces the table above; forbids "proven" and vendor names; extends the existing copy-guard test to `src/lib/actions` and exports.
- **Untrusted text:** answer spans, website text, fetched pages and listings are data. They never instruct the system, never choose a URL or recipient, and are stored as facts with source, date and hash; the code that reads them has no tools ([OWASP LLM01](https://genai.owasp.org/llmrisk/llm01-prompt-injection/)) [3P]; the `<website>` wrapper pattern in `understanding/digest.ts` applies [PROVEN].

## 9. Prioritization

### 9.1 How vendors prioritize

"Impact" almost always means scope times gap, not a measured outcome [INFERRED]. Per section 2.4, only Yext (>10% off the local top-5 average) and Rankscale (rules) publish their ordering; Peec, Otterly, HubSpot and Velova use hidden-model bands; HubSpot, Goodie and Scrunch show unvalidated projections; AthenaHQ and Writesonic are the only ones with an effort field. Business value always comes from the user. Gating on data sufficiency (Otterly's 15 prompts, 3 competitors, 3 days) is sound; hiding the gate is not.

### 9.2 Frameworks considered, and why tiers instead of a score

The founder's brief asks for Expected impact × Confidence × Strategic importance ÷ Effort. All four ingredients stay, **ordered rather than multiplied**: impact → answers at stake, counted not forecast, plus lever support; confidence → the computed diagnosis grade; importance → the owner's P1-P3; effort → a class.

| Framework | Problem here | Use |
|---|---|---|
| ICE ([Gilad](https://itamargilad.com/the-tool-that-will-help-you-choose-better-product-ideas/)) | Self-rated, easy to game | No |
| RICE ([Intercom](https://www.intercom.com/blog/rice-simple-prioritization-for-product-managers/)) | Person-rated confidence | Reach as answers at stake |
| PIE, WSJF | PIE chases noise; WSJF needs calibrated numbers | Topic choice; enabling work first |
| GRADE | Needs judgment | **Yes:** certainty apart from strength |
| Lighthouse | No validated fix-to-answer model | Pattern only |
| Google Ads optimization score ([help](https://support.google.com/google-ads/answer/9061546)) | Reaches 100% by applying **or dismissing** everything | Anti-pattern |

Three models were tested on Atelier 10 [INFERRED]:
- **Model A, gated tiers (no number):** explainable, fits Measure's no-composite contract; lexicographic. **Chosen for the customer-facing order.**
- **Model B, answers at stake:** B = A × e(grade) × l(lever) ÷ c(effort), with A = Σ section weight × owner value × share of reference answers showing the defect. Trades off across categories, but every weight turns an ordinal level into a number by assumption; it moved one card from 0.60 to 0.36 under two reasonable staleness rules, and in the worked example the price card (0.45) and directory card (0.36) swapped under reasonable weights, hence a "within ×2 = one band" rule. **Rejected for now; revisit in v3** as an operator ordering aid once the ledger holds about 50 checked actions per lever.
- **Model C, six-factor points (1-5 each, summed):** compensatory, so reach and value buy past weak evidence; it scored the contradicted "get more reviews" card 16 of 30 beside a checked fix at 18. **Rejected.**

Other reasons: with three or fewer discordant questions no sign test reaches p < 0.10; Measure deliberately has no composite score [PROVEN]; relative bands always have a top.

### 9.3 The method

**Tiers** (a card enters the first tier whose rule it meets):

| Tier | Entry rule |
|---|---|
| 1. Check first | Measurement fixes affecting card evidence (those blocking the most cards first); owner questions batched into one message |
| 2. One decision | The one unblocking the most cards |
| 3. Fixes | Checked, unblocked, owner-controlled, effort XS-M, a usable lever. "Pass to your team" sits beside the Fixes, outside the hours budget |
| 4. Experiments | Checked and Repeated, with an approved check plan |
| 5. Later | Blocked; or "Your call, any time" (a Decision whose default changes nothing) |
| 6. Watching | Mostly Seen once; not actions |

**Order within a tier** (each key breaks ties in the one before): 1) grade (Checked and Repeated → Checked → Repeated → Seen once); 2) no-regret first; 3) owner priority P1 → P3 (unset counts as P2, flagged "not set"); 4) reach band; 5) smaller effort; 6) faster time to first check (recount → days → weeks → months); 7) first seen, older first; 8) dedupe key, for a stable order.

**Reach** is counted, never forecast ("1 of 2 price answers"): defect answers pooled over the reference runs, banded *several* (4+), *a few* (2-3) or *one*; within a band, Discovery comes first; by-name questions weigh only as a tie-break within a band. Banded because one answer moves a ten-question section 10 points.

**Business priority and demand (M6).** Search Console produced no data in any of 51 crawls (16 found no matching property; 34 had no connection) and there is no GA4 [PROVEN]. At plan setup the operator records "How do customers find you?" and "How much does ChatGPT matter to you? (a lot / some / little / don't know)" in `plan_settings`; if "little", no Experiments are suggested and only no-regret Fixes appear. The **No-regret flag** ("Useful even if ChatGPT ignores it", yes or no with a one-line reason) is order key 2. The status line shows the place mix beside the headline (for example "7 Dubai-wide, 2 DIFC, 1 Business Bay questions"). Every export says "We don't measure bookings, calls or revenue." Ask owner priorities when a card first needs them.

**Effort** sits on recommendations, never findings ([Torres](https://www.producttalk.org/opportunity-solution-trees/)), and never changes a grade. The owner can override any default; an optional "how long did it take?" calibrates defaults after about 20 actions of a type.

| Sub-category | Class | Hands-on | Waiting | Who else |
|---|---|---|---|---|
| Category 0 questions; 5d decisions | XS | Minutes, or one meeting | — | Just you |
| 4a, 4c, 3a | S | About an hour | Live in 1-2 days | Website editor |
| 2a-2d, 3b | S | About an hour per platform | Days | Listings manager |
| 1a, 1c | S-M | Hours to a day | ~24 h for robots.txt | Developer |
| 1b, 4b, 5a-5b | M | A day or two | Days | Editor and owner |
| 3c, 6a-6e | L | An hour per request | Weeks, outside your control | PR and a third party |
| 7a-7c | L | Ongoing | Months | Front desk |

**Weekly caps.** Start here: one card, the first unblocked owner-controlled Fix that touches a topic the owner marked P1 or P2 or a Discovery question (an unset priority does not count); otherwise the quickest Fix, labeled "Quick tidy-up" with what it won't change (S3). This week: at most 3 actions and 1 decision within the owner's weekly hours (default 3 h), at most one L card, refilled only from freed capacity, never padded ("Nothing new this week: 2 actions are being checked" is a valid plan). Next: 5. The brief asks for 3-5 a week; checks take 2-8 weeks, so we propose the lower cap. "Why this first" is one generated sentence, for example "Checked on your page · your priority P1 · about an hour · live check in 2 days".

**Dismissals cannot improve anything.** No plan score or completion percentage; a dismissed card returns only if its evidence doubles or its grade rises.

### 9.4 Worked example: Atelier 10, run of 2026-10-15

ChatGPT on the web, from the UAE, English: Discovery 2 of 10 (6-51%) [PROVEN]. Owner priorities not yet collected, so all topics count as P2, flagged.

| Card | Type | Reach · effort | Position |
|---|---|---|---|
| Update results (Q1) | Measurement fix | Every card · XS | Check first, alone until done |
| Is atelier10salon.ae yours? (cited 16 of 30) | Question for you | Several · XS | Owner message |
| Does /hair/ show a total extension price? | Question for you | 1 of 2 price answers · XS | Owner message |
| Publish an all-in hair-extension price (T1) | Decision, then Fix | 1 of 2 price answers · S | Start here, labeled "Quick tidy-up" unless hair extensions are P1 or P2 |
| Stay DIFC-first? (T7) | Decision, default changes nothing | DIFC 1 of 2, Dubai-wide 1 of 7, Business Bay 0 of 1 · XS | Later, "Your call, any time" |
| Cited lash lists (6b) | Experiment | One · L | Later (needs Repeated and a check plan) |
| Fresha cited in all 8 answers that left you out | Watch (2b) | — | Watching: "Are your venues on the Fresha pages those answers cite?" |
| "Get more reviews" | No card | — | Not supported by this run's data |

The week: one recount, one owner message, one card of about 75 minutes against a 3-hour budget; empty slots stay empty.

**Anti-patterns avoided:** completion scores (Google Ads); unvalidated lift (Goodie's 15-40% [CLAIM]); inconsistent bands (Velova); unbounded lists (49-96% alert override); thin data (3 of 10 flipped in an hour); a stated reason taken as cause; measurement error (5-14 of 30 answers).

## 10. Action management

### 10.1 Object model

Storage of the eight stages (proposal): Measurement and Insight stay in the snapshot (six live finding types); Observation uses analyses plus a new `object_checks` table; Diagnosis is a mandatory `diagnosis[]` field group inside `recommendations.body`; Opportunity is a field group plus an `opportunity_key` linking alternatives; Recommendation is an append-only `recommendations` table; Action and Outcome live in `actions` (frozen plan, results, verdict); ownership corrections in `ownership_claims`; events in `project_events` (v2).

| Table | Fields |
|---|---|
| `ownership_claims` | Entity; registrable domain (or a rival-documentation path prefix); owned or not; answered by; channel; evidence type and value; date; status (pending, evidenced, withdrawn). Append-only; latest row wins |
| `recommendations` | Keys (dedupe, opportunity); rule id; category and sub-category; card type; flags (no-regret, regulated); `blocked_by`; title; body (what we saw, `diagnosis[]`, steps, role, effort, lever label, stake, headroom, default, check template); evidence (answer ids, spans, URLs, runs, looks, checks); versions (analysis, policy, `actions-policy@1`, claims hash); state; approval (approver, date) |
| `actions` | Kind (recommended / custom / outside work); recommendation keys (0..n, many-to-many); role and free-text name (no logins); due date; status; back-datable ship date; proof (URL, date, snapshot hash); hashed check plan; append-only results; verdict |
| `object_checks` | Object type; question; result (present, absent, couldn't read, yes, no, not sure); facts; method; date |
| v2 | `collection_runs.purpose` (regular or check); `prompt_sets.kind`; `projects.plan_settings` (P1-P3, weekly hours, channel answers); `project_events` |

```
finding (in snapshot) --seeds--> recommendation <--opportunity_key--> alternatives
recommendation --blocked_by--> gate item | decision
recommendation <--many-to-many--> action --> check results --read--> object_checks, later runs
ownership_claims --overlay--> every run's figures (claims hash in lineage)
```

**Code shape (proposal).** `src/lib/actions/` mirrors Measure: a pure core (`policy.ts` with `ACTIONS_ENGINE_VERSION`, `RULE_DEFINITIONS`, `LEVER_SUPPORT`, `EFFORT_DEFAULTS`, `DO_NOT_GENERATE`; `signals.ts`, `rules/`, `engine.ts`, `templates.ts`) and a thin shell. Payload readers stay in `src/lib/collection`. Derivation is synchronous (on finalization, on any claim, check or setting change, and on GET when inputs changed): no queue, and a restart strands nothing. Tests: five golden runs with expected plans as fixtures, and a `plan-handcheck` script that prints ALL AGREE.

### 10.2 Card types and anatomy

| Card type | Meaning | Minimum evidence | Label shown |
|---|---|---|---|
| Question for you / Measurement fix | Owner yes/no / operator correction of the instrument | A recount | "Changes our numbers, not ChatGPT" |
| Fix | Cheap, reversible, owner-controlled | Checked | "Fact checked, effect unknown" |
| Experiment | Costlier; effect unproven | Checked + Repeated + approved check plan | "A test: may not work" |
| Decision | Only the business can choose | Any grade + a default + what each option sets in motion | "Your call; our default is …" |
| Watch | Seen once | — | "We look again first" |
| Pass to your team | True criticism: operations, not AI | Sentences read by a person in ≥2 answers or runs | "Not an AI task" |

Labels, not types: "Quick tidy-up" and "Your call, any time". Flags: **No-regret** and **Regulated**. Decision is a card type whose category tag still names the object of work.

Card fields: **Title** (verb + object + where); **What we suggest** (one sentence); **Why** (saw: a stored quote ≤12 words, x of n, section, date, scope, [Read it]; checked: object, date, method, result, or "not checked yet"); **How sure / Does it usually help?** (grade, reason, what would lower it / lever label naming its outcome); **How it has to change** (2-4 steps, each a verb, an object and a person); **Who and effort** (person, hands-on, waiting, who else); **How we'll know** (Live / Used / Picked with dates, or "No run is scheduled"; what we won't claim); **At stake / Depends on** (unweighted stake, headroom, figures not affected, blockers, alternatives).

### 10.3 Recommendation states (set by the system)

| State | Enters when | Leaves when |
|---|---|---|
| Watch | Seen once | Promoted (Repeated); or closed "not repeated" (named ≥4 of 6) or "mixed" (3-3) after its one re-ask |
| Awaiting approval | Passes its tier rule; trigger not yet released (every MVP card) | Operator approves or rejects |
| Ready / Blocked | Passes its tier rule / a gate item or decision is open | Accepted, dismissed, changed / re-derived when clear |
| Accepted | An action was created | Stays on record |
| Dismissed | With a reason | Returns if the evidence doubles or the grade rises |
| Mixed | Between the entry and exit thresholds | "Mixed since ‹date›"; cannot rise |
| Evidence changed | Pattern in ≤1 of ≥6 new looks, or the checked defect is gone | Reappears if the trigger returns |
| Closed | Not repeated, or mixed after the re-ask | Reopens only on a new trigger in a later regular run |
| No longer measurable | A comparability break removed its questions or rival | Kept in history |
| Needs re-validation | 4 untouched cycles, or a check older than 30 days | Re-checked |

**Expiry with hysteresis.** A card enters at ≥2/3 and leaves below 1/3; one favorable flip never expires a card; nothing is ever "resolved" (Velova merged done with no longer seen). This rejects Peec's 30-days-untouched rule. Probabilities assume independent answers [INFERRED]:

| Change | Rule | P at true naming 30% / 50% / 70% / 90% |
|---|---|---|
| Watch → Repeated | Left out in ≥4 of ≥6 new looks | 0.74 / 0.34 / 0.07 / <0.01 |
| Watch → closed, not repeated | Named in ≥4 of ≥6 | 0.07 / 0.34 / 0.74 / 0.98 |
| Ready or Accepted → Evidence changed | Pattern in ≤1 of ≥6 (named ≥5 of 6), or checked defect gone | 0.01 / 0.11 / 0.42 / 0.89 |

### 10.4 Action states (set by people; Live and verdicts only by evidence)

```
planned -> in progress -> done (ship date, proof) -> live -> checking -> closed (verdict)
   +-----------+-> canceled                               +-> reverted ("Inconclusive" unless already decided)
```

"Live", "used" and verdicts are never set by hand (Athena's rule). Actions never expire; after 4 untouched cycles the plan asks "Still planned?". **Outside work:** "Add something you did" (a redesign, price change, campaign, new branch) is tracked like an action and listed in every overlapping check as a possible cause (Peec records outside work).

**Dismiss reasons:** Not relevant to us (offers to lower that topic's priority; returns only if the evidence doubles); We can't do this (offers "Other ways to address this"); The evidence looks wrong (operator review; the answers join the labeled precision set); Not now (returns after 4 cycles, or sooner if the evidence doubles); Already done (a live check runs; a state already in place at acceptance earns no credit). Client exports show dismissed and expired counts with reasons; the Report logs "questions removed at your request" (S10).

### 10.5 Proof of done

Weakest to strongest: 1) reported done; 2) reported with a link or screenshot; 3) checked by the operator (URL, date, snapshot hash); 4) **Live**, read by Project Sun; 5) **Placed**, a third-party page newly names the business ([Scrunch](https://helpcenter.scrunchai.com/en/articles/17508012-pitch-a-page)). "Couldn't read" is its own state, never "absent". Progress is a line, never a score: "suggested 6 · accepted 3 · live 2 · checking 1 · dismissed 1".

| Object | Live: MVP | Live: v2/v3 | Used (next regular run) |
|---|---|---|---|
| Own page | Crawler re-fetch; empty body = "couldn't read" | Browser render | URL cited and the new fact quoted, matched on the number |
| Listing | Operator check | Parsed records; Places read | Business appears in local results; listing cited |
| Third-party page | Operator check | Facts-only fetch; Placed only if newly named | Still cited, now naming you |
| Decision or measurement fix | Immediate recount | — | Dependent cards re-derived |

### 10.6 Plan view and owner exports

**Plan view** (operator; `?view=plan` only if decision 7 approves a tab; Overview stays the landing view and free of workflow controls; the Report stays evidence-only and the plan is exported separately (S11)). Project-level and rolling from the latest finalized run plus comparable earlier runs; a banner shows when an older run or a non-primary project is selected. Cards can be grouped by person: Website editor · Listings · You decide · PR/marketing · Your team.

| Section | Holds | Cap |
|---|---|---|
| Status; Runs due | Headline with scope and place mix; due runs with "Start due runs", or "No run is scheduled" | — |
| Check first | Operator measurement fixes; owner yes/no questions batched into one message | All open |
| Awaiting approval | Client cards not yet approved | — |
| Start here | One card (section 9.3) | 1 |
| This week | Actions and one decision within the owner's hours | 3 + 1 |
| Next / Later | Over capacity / blocked, plus "Your call, any time" | 5 / collapsed |
| Watching | Seen once; next look; cost of a re-ask | Separate |
| In progress and results | Status, proof, check dates, verdicts (the founder's feedback tab) | — |
| History | Done, dismissed with reasons, expired | Operator only |

**First screen, Atelier 10 (run of 2026-10-15; may shift after re-analysis):** Check first holds Q1 (answers read at `@17`) and the owner question "Is atelier10salon.ae your website?" (cited in 16 of 30; if yours, your site was cited in 20 of 30, not 15). Start here: the all-in hair-extension price (Card 1). Your call, any time: "Where do you compete?" (default stay DIFC-first). Watching: Fresha cited in all 8 recommendation answers that omit you.

**Owner exports** (no vendor names, no route ids, as `measure/public.ts` does; personal names in quotes redacted):
- **Owner message,** WhatsApp or email length: batched yes/no questions, the Start-here card and who does it. Owners answer by message; the operator records each answer with its date and channel as an owner confirmation.
- **One-page plan,** printable, ending "We don't measure bookings, calls or revenue."
- **Hand-off note** per card, which the app never sends: *Hi ‹name›, could you ‹step› on ‹where›? Why: ‹one sentence›. It's done when ‹live condition›. It should take about ‹hands-on time›. Details: ‹card link›. Thanks, ‹owner›.* The agency version adds the quote, x of n, the check dates and the scope line.

Spending (re-asks, checks, cadence) is approved by whoever pays, the operator or agency, never from an owner card: "This check needs about 54 extra answers. 60 are approved for this client this month; 6 would remain."

### 10.7 Three example cards (corrected; operator view; real stored answers; none exists yet)

**Card 1. Atelier 10 (DIFC salon): an all-in extension price**

| Field | Content |
|---|---|
| Card type | Decision, then Fix. "Quick tidy-up" unless the owner marks hair extensions P1 or P2. Awaiting approval |
| Category | 4a missing facts. No-regret: yes (a clear total helps at booking whatever ChatGPT does) [INFERRED]. MVP |
| Title | Decide whether to publish an all-in price for hair extensions, then add it to your Hair page |
| What we suggest | If you are willing to publish one, give a range on atelier10.ae/hair/ that includes hair and application, say what moves it, and price removal and refitting |
| Why | Asked whether extension prices are clear before booking, ChatGPT began "Not completely" and said the full cost isn't clear upfront. It quoted the AED 265 fixing price and two "Price upon consultation" rows (removal and refitting per pack; removal) and cited atelier10.ae/hair/ and atelier10salon.ae. 1 of 2 price questions; 2026-10-15; ChatGPT on the web, signed out, asked from the UAE, English questions [PROVEN] (`pres_6549e07b`, `crun_6df9150f`). The stored analysis read it as "no sentiment" |
| Steps | 1) You decide whether to publish a range (consultation pricing may be deliberate; a published range must be honored). 2) Website editor: under "Hair extensions", add "From AED … to AED …, including hair and application", what moves the price, and removal and refitting prices, in a sentence naming Atelier 10 and DIFC. 3) If atelier10salon.ae is confirmed yours (Q2), change it there too. 4) Front desk: align the booking menu |
| Evidence | Seen once; Checked once you confirm the page shows no total ("Confirmed by you, not read by us": our crawler stored an empty /hair). In-situ evidence first: ChatGPT already reads this page. Usually helps: Some evidence, for other outcomes (citations within a site; being picked in Discovery; API models); neither measured an unclear-price remark |
| Effort | S: about 1 hour hands-on (you 15 minutes, editor about an hour); live in 1-2 days |
| How we will know | Live: you confirm, or the operator reads the page (our re-crawl reads "couldn't read" until v2). Used: the next regular run's price answer quotes the range, matched on the number; one answer is a signal, not a rate. Optional hedge check before you edit: 2 questions × 3 wordings × 2 days = 12 answers; the 12 "after" answers are bought only if ≥4 of 12 hedge; best verdict "Moved, cause unclear". Caveats: this run mixed two providers; no model label |
| At stake | 1 of 2 price answers; up to +1 of 2. Recommendation figures unaffected. We don't measure bookings, calls or revenue |
| Before this card | Q1 (read at `@17`); Q2 (pending until a phone, address or token corroborates) |
| Expires | Evidence changed when the page shows the total (checked) or the hedge appears in ≤1 of ≥6 new looks; needs re-validation if the check is older than 30 days |

*Owner message:* "Hi ‹name›, is atelier10salon.ae your website, and does your Hair page show a total price for hair extensions? ChatGPT said the full cost isn't clear upfront. If you publish a range, your editor can add it in about an hour; we can't promise ChatGPT will change its answer."

**Card 2. Studio14 (Pilates, Dubai): cited, not named**

| Field | Content |
|---|---|
| Card type | Watch (operator view); category not yet assigned (possible routes 2a or 4c); trigger T3; MVP with a v2 line |
| Title | Seen once: ChatGPT cited your roll-shaper class page but recommended other studios |
| What we suggest | Nothing to change yet. Look again first: one operator-approved re-ask of this question in 3 wordings on 2 days (6 answers), plus the next regular run. No run is scheduled today, so without the re-ask this cannot mature |
| Why | Asked which infrared roll shaper studios in Dubai help after workouts, ChatGPT cited studio14.ae/jumeirah/infrared-roll-shaper-class/ and named other businesses (2026-09-18, 18:45 UTC; scope line) [PROVEN] (`pres_29e93dbf`, `crun_efabc943`). About an hour earlier the same question named Studio14 (`pres_4a0e148b`, `crun_2a2329d1`). Between those runs, 3 of 10 recommendation questions changed with nothing done that we know of. No run since (7 weeks). Run context: Discovery 7 of 10; own site cited in 29 of 30 |
| Promotion rule (pre-written) | After the re-ask, if Studio14 is left out in ≥4 of ≥6 new looks (the 18 Sep answer excluded), check (a) does the listing name the class and (b) does the page name Studio14 and Dubai where answers quote it; suggest only what the check supports, for example "Add Infrared Roll Shaper to your listing's services" (Fix 2a, about 30 minutes, effect unknown). Named ≥4 of 6: closed "not repeated"; 3-3: closed "mixed" |
| Evidence | Seen once. Possible reasons, none checked: listing lacks the class; page lacks name and place; normal variation. v2 line: the answer's 12 local records were other businesses (one reads "Gym, EMS, Rollshaper") and Studio14's listing category is "Pilates studio" only; these are unparsed payload fields, "retrieved" is [INFERRED], and the record is past the 30-day limit |
| Who; effort | Operator approves the re-ask and runs the checks (operator minutes); owner nothing yet; a later Fix 2a would be XS-S |
| How we will know | Counts ("left out in 4 of 6 tries over 2 days"); P(false promotion) 7% if truly named 70% of the time |
| Before this card | Q1 (read at `@12`); Q3: correct realpilates.ae (parked) and thehundredpilates.com (a California studio) to real-pilates.com and thehundred.ae |
| Expires | Closes "not repeated" or "mixed" after its one re-ask; reopens only on a new trigger in a later regular run |

The judge demoted proposal B's version of this card from a Fix to a Watch: the listing evidence is a 7-week-old record and the pattern flipped within an hour.

**Card 3. Postman (B2B software): the Insomnia framing**

| Field | Content |
|---|---|
| Card type | Decision, then Fix; 5a; v2 (T10). No-regret: yes, if true (a clear, dated statement helps human evaluators too) |
| Title | Decide whether to tell buyers plainly that Postman suits Git-first, local-first teams |
| Options | A (default, once product confirms it is true today): say so plainly, with a date, on the comparison page these answers already cite. B: not your market; no change, and we stop flagging it (logged as a removal). C: answers describe Postman wrongly; correct your page and the third parties repeating it (category 3) |
| Why | Insomnia was the rival in 5 of 10 Trade Off questions. In 4 of those 5, ChatGPT tied Git-based or local-first work to Insomnia: one listed "Less cloud dependency" under Insomnia; another rated Postman's local/offline workflow "More limited". All 4 cited Kong's Insomnia documentation, its Insomnia-vs-Postman page in each. Postman's own comparison page was cited in 4 of 5 (web.postman.com 3, www.postman.com 1). 2026-09-16; asked from the US; one answer per question [PROVEN] (`crun_b4ec762f`) |
| Steps | 1) Product marketing with product confirms Git and local workflow support today. 2) Choose A, B or C. 3) For A: the web editor adds a dated statement to the comparison page, on both hostnames if both serve it |
| Evidence | Seen once: one run, consistent within it (4 of 5). H1 answers repeat the framing of Insomnia's maker (cited in all 4); H2 Postman's page doesn't say it (unchecked); H3 the framing is accurate. Usually helps: Untested; comparison pages were cited less often than other articles at equal rank (×0.34 odds, one observational study); no study tests positioning against a rival's framing |
| Effort | Decision under an hour; update M, about half a day |
| How we will know | Live: we re-read the page. Used: answers cite it beside the condition. Optional operator-approved framing check: 5 questions × 3 wordings = 15 answers before (on 2 days, not the 16 Sep run) and 15 after. Only a large fall counts: 8 → 2 of 15 (p = 0.025) does; 7 → 2 (0.054) and 6 → 2 (0.107) do not. Best verdict "Moved, cause unclear" |
| At stake | 4 of 5 Insomnia head-to-heads: a framing finding, not a loss count. We don't measure sign-ups or revenue |
| Before this card | Q1 (read at `@10`); Q3: record developer.konghq.com/insomnia/ as Insomnia's maker's documentation (a path-prefix rival mapping) |
| Expires | Evidence changed if the tie appears in ≤1 of ≥6 new Insomnia head-to-head looks; re-validation after 4 untouched cycles |

## 11. Outcome verification

### 11.1 Levels and the frozen check plan

| Level | Question | Check | Extra answers |
|---|---|---|---|
| **Live** | Does the change exist? | Re-read the page or listing: HTTP 200 and the changed text present; robots and firewall allow the engine's crawler | 0 |
| **Used** | Do answers use it? | URL cited, the fact quoted, the business among the local records, or the false claim gone, at the next run | 0 (shared with regular runs) |
| **Picked more often** | Named more on targets than on matched controls? | Check runs | 54-144 |

"Picked" is never read before "Live" passes. Own-domain citation is the strongest observed same-answer correlate of a mention (2.8% of answers named the brand with neither own-domain citation nor a branded search, 49.0% with own-domain citation alone [3P] (vendor CEO, API)), so "Used" is a fair leading indicator, not proof. Engines reuse cached copies, so a citation can appear with no logged fetch.

**Frozen and hashed at acceptance** (changing any field starts a new plan, as at Trakkr): action, lever, owner, **ship date** (anchor of every window); Live checks and who verifies; **one primary metric** (presence on targets by default; own-site citation for access and page work; claim occurrence for corrections; hedge rate for information gaps; condition attachment for positioning); **guardrails** (untouched frozen prompts, own-site citations, portrayal; OnBoard's citation rate rose while visibility fell); targets, controls, answers per probe, occasion dates, tier; a **minimum effect of interest** (default +20 points); and the instrument (engine, route, observer country, analysis version).

**Targets and controls.** Targets: the frozen prompts the action should move plus 2-3 rewordings each, at least 9 probes, same section, intent, place level and register; Discovery probes never name the brand; rewordings are frozen before the first baseline and shown to the owner ("Would customers ask this?"); they come from the Prompts pipeline and its validators, under paid-model approval if drafted by a model (S15). Controls: as many probes, same section and intent, **picked by the same trigger rule** (brand absent at trigger time) so regression to the mean hits both arms, not sharing the target pages (spillover biases toward zero), in no other open action. Actions sharing targets in one window are judged as one bundle. Baseline: at least 2 fresh occasions on different days before shipping; never reuse the triggering run.

**Check runs** never change Measure's figures, never enter History or the console's latest run: a `purpose` filter on every collection-run query, with tests. They pin one provider and stop rather than hand over; a preflight confirms the metric's fields still arrive (S1).

| Change inside the window | Effect on a verdict |
|---|---|
| Probe wording, answers per probe, provider route, observer country | Break: new baseline |
| Analysis version | Re-analyze the stored baseline, else a break |
| Model label change or logged platform event | Cap at "Moved, cause unclear" |
| Frozen prompt-set or competitive-set version | Break for frozen-set reads |
| Partial coverage | "So far"; incomplete probes excluded from both arms |

**Analysis.** Per probe, pooled follow-up rate minus pooled baseline rate (the probe is the unit because its answers are correlated; that correlation is unpublished and must be piloted [UNAVAILABLE]); effect = mean change on targets minus mean change on controls; exact one-sided permutation test over probe labels (9 + 9 probes give 48,620 splits) and a 90% probe-bootstrap interval; show raw counts, rivals' change on the same probes and the pre-trend. Prefer presence for verdicts: sentiment flipped in 45.5% of repeated cells against 6.8% for mentions [3P] (vendor-authored).

### 11.2 Tiers, power and cost

| Tier | Design | Extra answers | Detects | Best verdict | Phase |
|---|---|---|---|---|---|
| 0 Recount | Deterministic | 0 | — | Corrected | MVP |
| 1 Mechanism | Live check; Used from the next regular run | 0 | Change exists, is cited | Mechanism only | MVP |
| Re-ask | 3 wordings × 2 days | 6 | — | Promote / not repeated | v2 |
| 2 Directional | 9 targets × 3 answers × 1 occasion each side | ~54 | About +50 points (power 0.83; 0.27 at +20) | Moved, cause unclear | v2 |
| 3 Controlled | (9 targets + 9 controls) × 3 × (1 + 1), or × 2 × (2 + 2) | 108-144 | About 33 or 27 points (80% power) | Worked so far / No detectable change | v3 |
| 3+ | 15 + 15 probes × 3 × (2 + 2) | 360 | About 20 points | Same | Research |

Detection uses Peec's variance constants as orders of magnitude [CLAIM]. Simulation (1,500 replications) [INFERRED]: with no effect each design's own rule said "worked" ≤3% of the time; under a uniform platform shift with no effect, target-only rules said "worked" 35-98% of the time and matched controls 4-5%. The control result holds by construction; real events can hit intents unevenly. The only non-vendor field study with untreated control pages called its effect (×1.82) suggestive, not conclusive (placebo p = 0.16) ([Watanabe & Nakayashiki](https://arxiv.org/abs/2606.04362)) [3P].

**Power gate.** Before buying answers, check that a verdict is reachable; if not, run only Live and Used and say so. For before-and-after checks without controls: buy the "before" answers first (≥2 days, never the triggering run), and buy "after" answers only if even a perfect result (zero after) would give a one-sided Fisher p < 0.05. Thresholds: 6 a side needs ≥4 before (p = 0.030); 12 a side ≥4 (0.047); 15 a side ≥4 (0.050); 18 a side ≥5 (0.023). At 12 vs 12: 4 → 0 (0.047) and 6 → 1 (0.034) count; 5 → 1 (0.078) and 3 → 0 (0.109) do not, so the smallest countable fall is about 33 points. These treat answers as independent, which overstates certainty: a screening threshold, never the chance the change worked. Tier 3 is bought only if the targets' baseline leaves at least the minimum effect of headroom and the design's detectable effect is no larger than one that would change a decision.

**Cost.** At about $0.0015 an answer, a re-ask costs about $0.01, Tier 2 about $0.08, Tier 3 $0.15-0.22 [INFERRED] (internal prices). Approvals, free-tier limits, provider minimums and the 60-request lane cap bind before cost. Weekly runs give about 130 answers per client a month; extras are capped at 60 per client a month. Proposal: Tier 1 for every action; Tier 2 when a large move would change a decision; Tier 3 for 2-4 approved Experiments a month (v3).

**Noise floor.** Same prompts, nothing done that we know of: Studio14 went 8 → 7 of 10 with 3 questions flipped (63 minutes apart); Atelier 10 6 → 7 with 1 flipped (14 minutes apart) [PROVEN]. Peec's variance implies a 13.5% chance a prompt flips between two single runs. With 1-3 changed prompts the best one-sided sign-test p is 0.125; p < 0.05 needs 5 of 5, 7 of 8 or 8 of 9 in one direction. Two-run rises that count (two-sided Fisher p < 0.05): 0/10 → 5/10; 2/10 → 8/10; 3/10 → 9/10; 5/10 → 10/10.

### 11.3 Verdicts

The first rule that fits decides. Falls are reported like wins; a guardrail fall is shown beside any verdict.

| Verdict | Rule | Owner hears | Phase |
|---|---|---|---|
| Inconclusive (instrument changed) | A break in the window, no new baseline | "We changed how we measure; starting afresh" | MVP |
| Not verified | Live check failed or not run | "Not confirmed live yet" | MVP |
| Too early | Before the first-look date | "Too early: first look ‹date›" | MVP |
| Mechanism only | Live and Used; no picked-level test ran or it was undecided | "Live, and ChatGPT uses it. Can't tell yet whether it changed who gets picked" | MVP |
| Moved, cause unclear (up or down) | Targets moved ≥ the minimum, but at Tier 2, or controls or rivals moved alike, or a platform event fell in the window | "Changed, but we can't say it was your work" | v2 |
| Worked so far | Tier 3; effect ≥ minimum; permutation p < 0.05; no capping event or guardrail fall; "so far" until the confirmation read holds | "Consistent with your change (not proof)" | v3 |
| No detectable change | Tier 3; upper bound of the 90% interval below the minimum | "No change we could detect at the size that matters" | v3 |
| Inconclusive | Everything else, including reads of 1-3 frozen prompts | "Can't tell" | MVP |

**Lag windows** (first look / confirmation):

| Action | First look | Confirmation | Basis |
|---|---|---|---|
| Access fix | ≥7 days | 14-28 days | OpenAI ~24 h; Trakkr 14 days [DOC] |
| Fact correction | 2 reads ≥7 days apart | Claim absent in both | Scrunch two clean reads [DOC] |
| Cited-list inclusion | 7-14 days | 28-42 days | Peec anecdote [DEMO]; Trakkr 42 days [DOC] |
| Owned page | 14-21 days | 35-56 days | Vendor medians [CLAIM]; Yext 4-6 weeks [DOC] |
| Local listing | 14-28 days | 42-56 days | [HYPOTHESIS] |
| Reviews | Monthly | 3+ months | [HYPOTHESIS] |
| Model-memory levers (PR, Wikipedia) | Not per action | Across model releases | Unmeasured |

### 11.4 Confounders, the event log and the ledger

| Confounder | 2026 example | Effect |
|---|---|---|
| Model or default change | GPT-5.5 Instant default 5 May; GPT-5.6 default for Free and Go from early August [CLAIM]; model label missing on all 60 October answers [PROVEN] | Cap |
| Retrieval or citation regime | Citation collapses 2026-03-08 and 2026-04-19 [CLAIM] (seoClarity); `site:` fan-outs ~0.4% → ~17% around 8 Aug [CLAIM] | Cap |
| Provider, route, observer location | Mid-run handover; "auto" markets default to the US [PROVEN] | Break |
| Capture artifact | October payloads lost fan-out queries and model labels [PROVEN]; UTM-tagged answers fell on 14 Oct [CLAIM] | Caution; break if the metric needs the field |
| Analysis version | `@17` → `@18` | Re-analyze the baseline |
| The business's other work; competitors; seasons (Ramadan, Diwali) | Redesigns, rival list placements, ads | Bundle; controls; calendar caution |

Five ChatGPT-wide events in about 31 weeks (hand-picked, vendor-sourced) imply about 61% odds of one in any 6-week window [INFERRED], so controls are required above "Moved, cause unclear". The IAB says a sudden change across many brands on one platform almost always comes from the platform [3P].

**Ledger and calibration (v3, a research program, never a selling point).** Verdicts, nulls included, pooled by lever × business kind × engine; lever labels change only after about 50 checked actions per lever, which at 108-144 answers each is 5,400-7,200 answers per lever. Placebo groups: run the Tier 3 analysis on untreated groups and publish the false-"worked" rate.

**Worked illustration (hypothetical numbers):** a Dubai salon absent from both frozen keratin Discovery prompts gets added to a cited list. 9 targets (2 frozen + 7 rewordings) and 9 controls, 2 answers each, baselines on 2 days, follow-ups at days 14 and 35 (144 answers). Targets 1/36 → 11/36; controls 1/36 → 2/36; difference +25.0 points; permutation p = 715/48,620 = 0.015; 90% interval +11 to +39. Verdict: Worked so far, if no break and the day-35 read holds. The frozen-only view (0 of 2 → 1 of 2) is Inconclusive.

### 11.5 Honest claims by sample size

| Data | Can say | Cannot say |
|---|---|---|
| Live check only | "The change is live (read ‹date›)" | Anything about answers |
| One answer | "ChatGPT said …" | A pattern |
| One run | "Named in 2 of 10 (6-51%)" | A trend |
| 1-3 target prompts, one answer each | "Cited in 1 of 2 target answers"; "can't tell yet" | Moved, worked or no effect |
| Tier 2 (~54) | "Moved from 2 of 27 to 15 of 27 reworded answers; cause unclear" | Attribution |
| Tier 3 (108-144) | Large effects (~27-33 points): "consistent with the change, not proof" | Moderate effects |
| Pooled ledger | Which lever types tend to coincide with movement | Cause for any single action |
| Bookings, calls, leads | Nothing [PROVEN] | Business impact |

**What vendors do (section 2.4):** none shows a variability band or significance test on an action's before/after; the market converged on frozen plans and careful wording, not controls [INFERRED]. One more Trakkr idea worth adopting: flag "suspect days" when bot fetches fall >40% across unrelated brands. Whether owners pay for "can't tell yet" is untested (pilot).

## 12. Data requirements and integrations

### 12.1 What today's data supports

Status: **now** (stored fields suffice); **small addition** (parse payloads, re-read a page or robots.txt, confirm a domain); **integration** (outside API); **new measurement** (more answers). Of 29 recommendation types, 12 are available now in some form, 19 need a small addition, 6 an integration and 4 new measurement (some sit at two levels). "Now" rests on one run and needs operator approval. (The synthesis listed 35 finer rows, R1-R35, consolidated here.)

| Category | Recommendation types | Status |
|---|---|---|
| 0 | Confirm own and rival domains; track a recurring untracked name; collect from the right market | Now (domains → small addition) |
| 1 | Let ChatGPT's search crawler in; serve real text on pages answers need; check Google's and Microsoft's AI controls | Small addition → integration (logs); now → small addition; integration |
| 2 | Add a missing service; fix contradicting listing facts; diagnose each local absence; complete a cited-platform profile | Small addition → integration; small addition |
| 3 | Correct a wrong fact at its source; make name and place unambiguous | New measurement (name and place: small addition first) |
| 4 | Publish facts answers call unclear or ChatGPT asks buyers to choose; answer ChatGPT's own search wording; make a cited page credit you; cover a service line where absent | Small addition (search wording → new measurement); now (service line → new measurement) |
| 5 | Offerings to measure; deciding criterion; place-specific gap; respond to a rival's condition; compete or let go in a specialty | Now; small addition |
| 6 | Get onto pages cited without you; pitch editorial lists; earn mentions beyond cited pages | Now (page unchecked) → small addition; integration |
| 7 | Grow reviews; pass a recurring true criticism to the team | Small addition → integration; criticism now (human read) |
| Info | Report who advertises on your questions | Small addition |

Studio14's site was cited in 29 of 30 answers yet left out of 3 of 10 Discovery answers [PROVEN]: locally the bottleneck shows in listings and selection more than in citations [INFERRED].

**Field map for builders** (from the data-fit stream): `provider_responses` (`response_text`, `source_urls`, `inline_citation_urls`, `observer_region`, `visible_model_mode`); raw payloads `evidence-store/<project>/artifacts/<id>.payload.json` (unparsed); `observation_analyses.payload` (`occurrences`, `emergingCandidates`, `comparisons`, `sentiment`, `citations[]` with `ownership`, `ownerEntityId`, `ownerMentionedInText`); the Measure snapshot (`sources.domains[].discoveryWithoutTarget(Ids)`, `byTopic`, `byPlace`, `emerging`, `tradeOffs`, `lineage`); `prompt_candidates` (`topic_id`, `evaluation_criterion`, `sentiment_theme`, `competitor_entity_id`, `geography_text`, `cohort`); `business_profile_versions.profile` (`identity.domains`, `location`, `offerings`, `contact`, `quality.warnings`); `crawl_pages` (`error`, `word_count`, `title`, `headings`); `competitive_set_versions.competitor_snapshot` (`domains`, `canonicalDomain`, `verificationStatus`); `projects.market_scope`. Measure's six live finding types (`discovery_gap`, `tradeoff_loss`, `reputation_concern`, `source_gap`, `untracked_brand`, `coverage_gap`) seed cards; `coverage_gap` never becomes a recommendation; `rival_source` and `owned_uncited` were retired at `measure-policy@4` but still render on old snapshots.

### 12.2 Stored but unused

| Field | Coverage [PROVEN] | Unlocks | Limits |
|---|---|---|---|
| ChatGPT's search queries (fan-outs) | 359 of 393 answers (all of September, 1-4 each); none in October | Whether searches added another emirate; wording to match (place cards; category 4) | Probably lost to a page-format change [INFERRED]; going forward only via an opt-in provider flag (+2 credits an answer, needs approval) |
| Sponsored cards | 33 answers, 37 ads; Atelier 10 13 of 30 | Paid-placement Report line (T14) | One provider: "not recorded", never 0; 5 of 37 URLs carry `utm_medium=paid` |
| Local listing records (name, rating, review count, categories, tags, website, phone, address, lat/lng, hours) | Most local answers (e.g., 37/60 Studio14 Sept, 42/60 Atelier Sept, 19/30 Truffles); none for B2B | Listing gaps, contradictions, absence diagnosis, review comparisons, name validation (T4, T5, Q8) | 12-14 per answer, probably the retrieved candidate set, not proven displayed [INFERRED]; `is_claimed` null in 2,714 of 2,739; source [UNAVAILABLE] |
| Citation titles, publishers, positions | Nearly every answer | Page targets; "official site" labels for Q2 | Not page content |
| Follow-up questions (forms) | 9 of 26 answers (one provider) | What ChatGPT asks buyers (e.g., AED budget bands) | One provider |
| Businesses named (entities) | 16 of 26 (one provider) | Checking the untracked-name detector | One provider |

Parsing costs development time, not answers. Fields can vanish: field-presence checks per reader must fail closed.

### 12.3 Additions and integrations

| Addition | Unlocks | Cost / effort | Terms or privacy | Phase |
|---|---|---|---|---|
| Repeated samples (approved cadence) | Watch items mature; Used checks | ~130 answers per client a month weekly; a paid plan from ~$30 a month | No provider is authorized by OpenAI (`docs/CHATGPT_CONSUMER_COLLECTION_DECISION_MEMO.md`) | Phase 0; re-asks v2 |
| Payload readers | All of 12.2 | Development only | Cards never name a provider | v2 |
| Own-page re-reads | Q7; Live checks; fetches can succeed empty ([Zhang](https://arxiv.org/abs/2611.00884)) | Low | Honor robots.txt | MVP; browser v2 |
| Cited-page fetches (facts only) | "Doesn't name you" checks; T6 promotion | Medium; SSRF fixes first | Declared user agent, robots, rate limits; dated facts with expiry | v2 |
| robots.txt per AI agent | T12 ([OpenAI crawlers](https://developers.openai.com/api/docs/bots)) | Low | Never impersonate agents | v2 |
| Google Places / Business Profile | Live listing facts; listing Live checks | Medium | Place IDs storable; other content time-limited (30 days) ([Maps terms](https://cloud.google.com/maps-platform/terms/maps-service-terms)) [DOC] (via a search summary) | v3 |
| GA4 referrals from chatgpt.com | A demand signal ([Peec](https://docs.peec.ai/ai-referrals.md)) | Low | Tagging broke 2026-10-08 to 2026-10-16 ([Profound](https://www.tryprofound.com/blog/chatgpt-missing-utm-tags)) [CLAIM]; else a "how did you hear about us" tally | v2 |
| Bot logs | Failed AI fetches ([Peec](https://docs.peec.ai/crawl-insights.md)) | Medium | AI-agent lines only | On request |
| Search Console | Google AI impressions ([Google](https://support.google.com/webmasters/answer/16984139)) | Built; no data in 51 crawls [PROVEN] | Not ChatGPT | v3 |
| Bing Webmaster Tools | Microsoft AI citations ([Bing](https://blogs.bing.com/webmaster/2026/2/Introducing-AI-Performance-in-Bing-Webmaster-Tools-Public-Preview/)) | Low | Not ChatGPT | On request |
| Review platforms | Counts beyond listings | API access [UNAVAILABLE] | No incentives | v2-v3 |
| New prompt types (Validation, Accuracy, Market perception; rewordings) | Comprehension vs trust routing; wrong-fact checks; re-asks | Per answer | Outside the frozen 30 | v2-v3 |
| Gemini | Second engine; 5.4% cited domains shared with ChatGPT in one study ([study](https://arxiv.org/abs/2609.18729)) | 6 credits an answer on one provider | Google-Extended governs grounding [DOC] | v3 if budgeted |

Proposed order [INFERRED]: cadence approval and payload readers; own-page re-reads and robots.txt per AI agent; facts-only fetches once the SSRF gaps close; GA4 referrals where clients run GA4, else a tally; listing reads and Search Console in v3. The job description put Cloudflare, GA4 and Search Console first, but Search Console cannot see ChatGPT and bot logs show fetches, not answers.

### 12.4 The five data questions

| Question | Proves | Suggests | Cannot tell | Closes the gap |
|---|---|---|---|---|
| Do citation comparisons show content gaps? | Who was cited, on whose domain | Page pairs to compare | Page content; causation | Q2, Q3; page fetches; repeats |
| Where do rivals appear and we don't? | Who was named instead | Weak service lines | "Consistently"; content as cause | Repeats; page checks |
| Which domains influence answers? | Citation counts (fresha.com in all 8 Atelier 10 absences) | The retrieval set | Influence | Page reads; 2+ runs; absent-vs-present comparison |
| Where is brand information inconsistent? | Dated listing record vs crawl and answers | Entity confusion | Live state; effect on selection | Live listings; validation questions; ask the owner |
| Content, authority, technical or geography? | Per-answer pattern (section 5.1) | A class, after the gate | Cause; fix effect | Gate; repeats; reads |

## 13. AI-agent opportunities

### 13.1 What competitors' agents do (accessed 2026-11-09)

| Vendor | What the agent does | Autonomy and guardrails |
|---|---|---|
| Peec | Drafts content and outreach; routines since 2026-11-04 | Approve each change unless Auto is on ([Agent](https://docs.peec.ai/agent.md)) [DOC] |
| Profound | Plans, then writes to CMSs and GitHub | Can publish with no manual step ([Agents FAQ](https://docs.tryprofound.com/agents/faq.md)) [DOC] |
| Scrunch | Pitch and correction briefs | Drafts only; never sends [DOC] |
| AthenaHQ | CMS edit drafts, live check ~24 h later | Approval per change ([Site health](https://docs.athenahq.ai/guides/site-health-optimizations)) [DOC] |
| Yext | Listing values, review replies, posts | Approved changes cannot be undone in Action Center [DOC] |
| Local Falcon | Edits Google Business Profiles | Scheduled per-location rules [DOC] |
| Trakkr | Five rungs, "tells you" to "handle it" | Never auto-sends outreach [DOC] |
| Writesonic | Drafts and sends pitches | Approve each send or in bulk [CLAIM] |

No independent evaluation of agent output exists [UNAVAILABLE]; "hours saved" measures effort, not visibility. Drafting is table stakes; execution beyond it is new and unproven [INFERRED].

### 13.2 Candidate tasks

Use the least powerful automation that works: (a) deterministic jobs, (b) model drafting, (c) tool-using agents.

| Task | Kind | Fit | Earliest stage |
|---|---|---|---|
| Evidence packs (x of n, answer ids, spans, URLs, titles, versions; no vendor names) | (a) | Strong | Assist |
| Refresh and expire recommendations after each finalized run | (a) | Strong; needs a scheduler | Assist |
| Propose own and rival domains for a yes/no | (a) + confirmation | Strong; gates all citation advice | Assist |
| Hand-off notes; listing checklists from the records ChatGPT read | Template | Strong; the edit stays human | Assist |
| Outcome check plan with credit estimate | (a) + spend approval | Strong as a planner | Assist (plan); Act (run) |
| Briefs, page copy from approved facts | (b) | Good; risk of invented numbers | Draft |
| Correction requests; inclusion pitches with a fit check | (c) | Only once page checks exist; contacts are personal data | Draft |
| Review request wording | Template | Neutral, for all recent customers; Project Sun holds no customer data | Assist |
| "Did it land?" re-fetch | (a) + fetch | Good after SSRF fixes; "couldn't read" is its own state | Act → limited autonomy |
| "Why it changed" narrative | (b) | Poor; stays rule-based | Never |

**Must stay human:** accepting or dismissing recommendations; positioning, pricing and claims; approving facts; choosing recipients; sending, publishing and editing listings; approving spend; accepting verdicts; confirming domains and rivals.

### 13.3 Guardrails

| Risk | Rule |
|---|---|
| Outreach spam, impersonation | A person sends, from the business's own mailbox; agencies say whom they act for; no lookalike domains; contact provenance tracked and deleted on schedule; weekly caps; no agent posts in forums |
| Review solicitation | One neutral template for all customers; no satisfaction filter, incentive or drafted review text; platform rules linked ([Google](https://support.google.com/contributionpolicy/answer/7400114); [FTC](https://www.ftc.gov/news-events/news/press-releases/2024/08/federal-trade-commission-announces-final-rule-banning-fake-reviews-testimonials)) |
| Hallucinated facts | Drafts state only approved facts cited by id; code checks every number, price, name and URL; visible placeholders; label "Draft: check before publishing"; banned claims per business kind |
| Prompt injection | Never give one agent private data, untrusted content and an external send together ([OWASP LLM06](https://genai.owasp.org/llmrisk/llm062025-excessive-agency/)); agents reading untrusted text get no tools; code picks recipients and URLs from allowlists |
| Silent fetch failures; SSRF | "Couldn't read" ≠ absent; close SSRF first; declared user agent; robots.txt; rate limits; never bypass bot protection |
| Cost | Approval per spend type; monthly cap; estimate before every run; no model inside loops; honor `SUN_LLM_NO_PAID=1` |
| Accountability | A named approver per write (no authentication today [PROVEN]); append-only log; verdict rules set in advance; agent-started runs stay out of History |

### 13.4 A staged path

| Stage | Agents may | Must not | Preconditions | Exit test |
|---|---|---|---|---|
| 0. Today | Nothing; findings propose no change [PROVEN] | — | — | — |
| 1. Assist (rules only) | Evidence packs, checklists, template hand-offs, refresh and expiry, check-plan estimates, reminders | Call a model, fetch third-party pages, write outside Project Sun | Domains and rivals confirmed; observer country from the market; runs re-analyzed; action records; a scheduler for refresh | Blind review of hand-offs by 3-5 owners and agency staff; owners act on them |
| 2. Draft (optional model) | Briefs, page copy, correction and pitch emails, listing text; free-text criteria extraction | Send, publish, choose recipients, state an unapproved fact | Paid-model approval with a cap; fact store; code claim check; injection-safe inputs; vendor-name guard; ≥90% extraction precision on labeled answers; SSRF closed before fetch-based drafts | Sampled drafts contain no unapproved fact; most accepted with light edits |
| 3. Act with approval | One approved item at a time: a CMS draft (never live), a ticket, a mail draft, an approved check run, a re-fetch | Publish live, send, edit listings, batch-approve external sends | Identity with a named approver; least-privilege OAuth; a job queue that survives restarts; preview, diff, rollback; spend caps; platform-terms and UAE/India legal review | No incidents; low override rate; ledger filling |
| 4. Limited autonomy | Internal, reversible, capped jobs: re-checks, refresh, internal tickets, digests, pre-approved check runs within budget | External sends, live publishing, listing edits, review requests, verdicts, overspend | A Stage 3 record; kill switch; drift monitoring; automatic rollback | Quarterly review |

Stage 1 fits the MVP and v2; Stages 2-3 sit in v3; Stage 4 has no date. Whether to expose recommendations in tools businesses already use (an MCP with `get_actions` and `explain_change`, deferred in the Stage 1 plan) is decision 18.

## 14. Implementation roadmap

Each phase starts only if the one before passes; weeks are estimates [INFERRED]. Approve only Phase 0, the pilot and MVP W1-W2 at first; decide the rest at the go/no-go.

| Phase | Scope | Effort | Prerequisites and exit |
|---|---|---|---|
| **Phase 0** | Lift the scope line (decision 1); approve cadence and budget (decision 3); agree the schema-change window (decision 6); on an isolated copy re-analyze the golden runs at the current analysis version; correct Studio14's rival domains and the Bengaluru restaurant's observer country; after approval, run one repeat of each golden Discovery set on a different day (about 60-90 answers) for a noise floor; label blind all 279 by-name and 140 Discovery answers plus the 31 broad matches and 50 random answers; a clickable comprehension test of the three cards against a padded five-action plan with 5-8 owners and 2-3 agency staff | 1-2 developer-weeks | Expected plans agree on golden runs (ALL AGREE); comprehension pass mark: each person states what, why and who within 30 seconds, ≥4 of 5 route every card, trust in the honest plan no lower |
| **Concierge pilot** (4 weeks, alongside MVP W1-W2) | 5-8 businesses in Dubai and Bengaluru; the operator builds plans by hand with these rules and templates and delivers them through each owner's real channel; test "Start here only" against "1 + 2 + a decision"; test willingness to pay for "can't tell yet" | Operator time; 600-960 answers plus re-asks ≤60 per client (needs a spend approval: free tiers lack volume or country targeting) | **Go/no-go before W3, all four must hold:** (1) ≥half of Start-here cards live within 14 days; (2) ≥two-thirds of gate questions answered within 3 days; (3) ≥4 of 5 owners restate what, why and who; (4) median operator time ≤30 minutes per client per week. If it fails: a concierge service or a better Measure, not an Actions engine; fold W1-W2 fixes into Measure |
| **MVP W1-W2** (instrument fixes; useful to Measure anyway) | Evidenced ownership claims and the overlay (next `measure-policy` version); gates Q1-Q4 and Q8; the run due-date checklist ("Runs due: 3", "Start due runs") | 2 developer-weeks | Overlaps Plan 1; build only what Plan 1 has not delivered |
| **MVP W3-W8** | Q5-Q7; triggers T1, T3, T6 (Watch), T7, T8, T11; de-duplication, tiers, templates, claims linter; tables and routes; operator Plan view; owner exports (message, one-page plan, hand-off notes, CSV without vendor names or route ids); operator approval of every card; accept / dismiss / done / "I checked this"; re-crawl Live checks; Used from regular runs; Tier 1 verdicts; expiry; copy guard; `plan-handcheck`; an isolated end-to-end run | 4-6 developer-weeks (MVP total 6-8) | Atelier 10's plan matches section 9.4; Studio14's first item is its rival domains; no paid call, third-party fetch or extra answer |
| **v2** (only after go/no-go and a UAE/India legal review) | Scheduler with a job queue; payload readers (listings, titles, ads, fan-outs, forms); map hosts dropped as sources (policy change); T2, T4, T5, T9, T10, T12, T13, T14; SSRF fixes, then a facts-only fetch (declared agent, robots, rate limits) and T6 promotion; check runs (`purpose` filter), re-asks, Tier 2, credit approval; event log; channel and demand signals (GA4 or a tally); priorities and weekly hours; approved drafting (Stage 2 prerequisites) | At least 6 developer-weeks | Studio14's card gains its listing line; cited directories read "doesn't list you" or "couldn't read"; check runs stay out of History |
| **v3** (a research program, never sold as proof) | Tier 3; ledger; placebo groups; per-customer noise floor; fact store and T15; approved extraction at ≥90% precision; Business Profile and Search Console reads; Gemini if budgeted; agent stages 2-3 | About 8 developer-weeks plus calendar time | The ledger publishes its false-"worked" rate; no agent sends or publishes |

**MVP prerequisites:** decisions 1-6; Plan 1's measurement fixes (or W1-W2 build them); an approved cadence (without it, Fixes still come from defects in themselves, but Watch items never mature and the Plan view says "No run is scheduled"); an isolated data dir, port and dist dir for development.

**What not to build:** a fifth journey stage or an Observe/collect page; any composite or impact score, lift forecast or completion percentage; model-written cards, grades, orders or verdicts; anything that publishes, sends, edits listings or requests reviews; a fetcher before the SSRF fixes; cards for schema, llms.txt, FAQ blocks or statistics rewrites; hardcoded platform lists or brands; Tier 3 or the ledger as a selling point; v3 before a v2 go/no-go; vendor names anywhere a reader sees.

### 14.1 Costs

| Item | Figure | Label |
|---|---|---|
| Regular runs | Weekly ≈ 30 × 52 ÷ 12 ≈ 130 answers per client a month; fortnightly ≈ 65 | [INFERRED] |
| Extra answers (re-asks, checks) | Capped at 60 per client a month, operator-approved | Proposal |
| Unit price | About $0.0015 an answer (Oxylabs $1.50 per 1,000 with a $30 monthly minimum, 2026-10-07); cloro Lite $30 a month approved "if needed" | [DOC] (internal) |
| Free tiers at the needed country targeting | cloro ~70 ChatGPT answers a month; Decodo ~670 but cannot choose a country; Bright Data 5,000 records but ~10 minutes per answer in testing | [DOC] (internal) |
| Checks | Re-ask ~$0.01; Tier 2 ~$0.08; Tier 3 $0.15-0.22 | [INFERRED] |
| Paid drafting (v2, if approved) | ~$0.04 per brief; ~$0.003 per pitch; ~$0.05 per page rewrite; ~$0.10 per article; recommendation record $0.0014; claim check $0.0007 per branded answer | [DOC] (internal cost study, 2026-10-08) |
| Cost-study tier figures (daily cadence, 50/150/350 prompts, list prices 2026-10-07) | Actions layer adds about $0.40 / $1.74 / $10.26 per client a month (Small / Standard / Enterprise): recommendation-only $0.16 / $1.05 / $8.06, generation add-on $0.24 / $0.69 / $2.21; a minimum-viable version $0.17 / $0.58 / $2.20. Investor workbook "Balanced" Actions ≈ $0.83 / $3.05 / $9.40 | [DOC] (internal). These assume model passes the evidence-first MVP does not use; refresh before quoting |

**Operator time costs more than answers.** The brief assumed about 10 minutes per client per run. Design target: 15 minutes per client per week, measured in the pilot; if the pilot median exceeds 30, price operator time into the offer. Onboarding adds 25-40 minutes per client. At 100 clients the red-team estimate implies roughly 40-100 operator hours a week. Add operator minutes to the cost model beside answers and model calls.

| Task (per client per week) | Red team | Redesign | Change |
|---|---|---|---|
| Start runs, watch canary, finalize | 3-5 | 1-2 | Due-date checklist, batch start |
| Version check (Q1) | 1-2 | 0-1 | Automatic |
| Read losses and concerns (Q5) | 4-12 | 2-5 | Only new readings since the last run |
| Names and empty pages (Q7, Q8) | 2-6 | 1-3 | Confirmed names persist per business |
| Approve cards | 3-8 | 2-5 | Precomputed receipts |
| Owner questions | 3-8 | 2-4 | One batched message |
| Live checks | 3-8 | 1-4 | Accepted actions only |
| Approvals, hand-offs | 4-9 | 3-6 | Templates |
| **Total** | **23-58** | **12-30** | |

## 15. Risks, red-team issues and legal register

### 15.1 Main risks

| Risk | Guard |
|---|---|
| Owners don't act (untested) | Pilot go/no-go; one Start here; hand-off notes |
| Thin plans: four of six cases need a measurement fix first | Decisions with defaults; Watch shows its next look; "nothing to do yet" is acceptable |
| No repeat runs | Cadence as a prerequisite; "No run is scheduled" stated |
| Operator time (23-58 minutes) | Target 15; redesign 12-30; price it if the median exceeds 30 |
| Noise and misreads become cards | Q5, Q8, operator approval, Repeated at 4 of 6, hysteresis |
| Visibility is not demand | No-regret flag; channel question; v2 demand signal; "we don't measure bookings" |
| Evidence words read as weakness to senior buyers | One word and one reason on the front; receipts for agencies; tested against a padded plan |
| The overlay reads as rewriting history | Evidence required; append-only hashed claims; lineage; old snapshots kept |
| Check runs leak; platform shifts look like effects | `purpose` filter; controls; event log; capped verdicts; placebo groups |
| Schema edits break the live server | Agreed migration window; isolated copy first |
| Sector rules | Regulated route; Never list; legal review |

### 15.2 Red-team must-fix issues (all adopted; nine modified)

| # | Issue | Resolution | Where |
|---|---|---|---|
| M1 | Grades, Watch items and Used checks need repeat runs nobody schedules | Cadence approval is a prerequisite; due-date checklist in the MVP, scheduler in v2; "free" deleted from all wording | 8.2, 14, decision 3 |
| M2 | The 90% precision gate cannot pass or fail with 1-10 detections | ≥30 blind-labeled detections, 95% lower bound ≥75%; operator approves every MVP card; misses reported | 7.1 |
| M3 | Owner screen for a persona that won't open the app; "share of voice" banned beside Measure's own tile | Operator Plan view plus owner exports; owner vocabulary for exports only; spending approved by the payer | 10.6 |
| M4 | Ownership claims move figures without evidence | Registrable domains with corroboration; pending = "what if" only; profiles on a separate line; claims in the Report; keyed to the business | 6.1 |
| M5 | Name noise ("Fade") can appear on cards | Gate Q8 | 6.2 |
| M6 | Stakes count answers to our own questions; no demand signal | No-regret flag as order key; channel question gates AI-only work; place mix on the status line | 9.3 |
| M7 | Sector and platform rules not enforced | Regulated route; extended Never list; neutral review template; legal review before outreach drafting; no contact storage; redact names | 4.5 |
| M8 | MVP built before anyone knows owners act | Concierge pilot alongside W1-W2; go/no-go before W3 | 14 |
| M9 | "Repeated" at 2 of 3 promotes noise | ≥4 of ≥6 new looks, ≥2 days, ≥2 wordings, trigger excluded, one re-ask per card | 8.2 |
| M10 | Wording overclaims | Lever labels name their outcome; in-situ evidence first; "not supported by this run's data"; "nothing done that we know of"; ×0.34 wording; "Not shown to help" | 8.5, 10.7 |
| M11 | Operator time unbudgeted | 15-minute target tested in the pilot; redesign 12-30 | 14.1 |
| M12 | Language and place missing from the scope line | "…asked from ‹country›, English questions"; place claims only from place-named questions | 8.4 |
| M13 | Three factual errors in the examples | fresha.com is a 2b Watch item (the gents venue is on Fresha, 11 ratings, absent from its DIFC men's page, checked 24 Oct); sponsored cards 10 of 20 by-name answers (13 of 30 overall); gates renamed Q1-Q8. Also: Studio14's rival domains are wrongly recorded, not "siblings" | 3.4, 4.5, 6 |

**Should-consider (all adopted except S7, deferred):** S1 check runs pin one provider, model-label caveat, field preflight; S2 split "which places to measure" (instrument, a break) from "where do you compete" (business choice), T7 on place-named questions only; S3 Start here must touch P1/P2 or Discovery; S4 Fixes offer Live and Used, optional checks before work starts; S5 price, policy and availability gaps open a Decision first; S6 area pages only where a branch exists or the service is delivered; S7 no-website businesses deferred to decision 19; S8 listing cards say "correlation only, on ChatGPT"; S9 firing-rate monitors, dated lever labels with a named owner and quarterly review, golden runs relabeled quarterly, host tables as versioned data; S10 dismissed and expired counts in exports, removals logged, proof stores URL, date and snapshot hash, rule 9 reworded; S11 Plan tab only by decision, Report stays evidence-only; S12 MVP 6-8 weeks with a cut rule set; S13 ledger and placebos are research; S14 diagnoses only with evidence, at most two evidence words per export card; S15 7-day time-out defaults, rewordings via the Prompts pipeline.

**What the red team said to keep:** the gate first; no composite score; two evidence words never merged; receipts that recompute exactly; the power gate (its p-values reproduce exactly); no credit without a change; hysteresis; check runs out of History; drafts never sent; "can't tell yet" as a normal verdict.

**Can 30 prompts with one answer each support each card type?** One run supports measurement fixes, the rare checked Fix, Watch items and status-quo Decisions. Experiments, topic or place or per-rival rates, "Picked" from the frozen set and trigger calibration are not supported without the cadence or bought probes.

### 15.3 Legal and terms-of-service register

| Risk | Where | Evidence | Mitigation |
|---|---|---|---|
| Review solicitation | 7a | Google bans incentives, selective requests, requests for specific content, pressure on the premises and staff quotas [DOC]; FTC rule bans fake, pay-for-sentiment and undisclosed insider reviews [DOC]; India's IS 19000:2022 status unverified [3P] | Extended Never list; one neutral template; platform rules linked |
| Rating-gated review prompts in booking tools | 7a | A Fresha add-on ("Google Rating Boost") reportedly prompts only high raters [DOC] (search summary) | Never recommend one; flag for a policy check if a client uses one |
| Platform reviews need recorded visits | 7a | Fresha invites reviews after recorded appointments [DOC]; WhatsApp bookings leave no record | Ask only where the business records visits |
| Sector advertising rules | 4, 5, 6d, 7 for regulated kinds | MOHAP license; DHA 2022 standard (reportedly bans "the best", "100%") [DOC; details from news] | Regulated route; hide claim, price, comparison, testimonial cards until approval |
| Impersonation in outreach | 3c, 6b, 6c drafts | Writesonic sends from a vendor-warmed domain [CLAIM] | Business's own mailbox; agencies disclose; no lookalike domains |
| Personal data | Contacts; quotes | UAE and India rules not researched [UNAVAILABLE] | Store no contact details; redact personal names |
| Fetching third-party pages | v2 | Site terms vary; SSRF gaps open [PROVEN] | SSRF first; site terms; declared agent; robots; facts with expiry |
| Storing Maps or Places data | v3 | Place IDs storable; other content time-limited (30 days) [DOC] (search summary) | Store place IDs; refresh facts; re-check terms |
| Collection volume | Re-asks, check runs | No provider authorized by OpenAI; the customer indemnifies the provider; a data buyer stayed in *Reddit v. SerpApi* [DOC] (internal memo) | Legal sign-off per volume tier; the power gate keeps volume down |
| Consumer-protection exposure of published prices | 4a | Not researched [UNAVAILABLE] | Decision first; a published range must be honored |

### 15.4 Metric-gaming vectors

| Vector | Guard |
|---|---|
| Inflating "Your site cited" via platform path prefixes or unverified claims | M4 evidence rules; profiles on a separate line |
| Hiding inconvenient cards by dismissing them | Dismissed and expired counts with reasons in client exports |
| Re-asking until a card clears | Every look counts; one re-ask per card |
| Redefining the instrument (rewording toward the home district, dropping losing topics) | Breaks; place mix shown; "questions removed at your request" logged |
| Vanity completion ("accepted 3, live 2") | No score; reports lead with verdicts, including "can't tell" |
| Self-certified proof | Operator proof stores URL, date and snapshot hash |
| Easy Start-here picks | S3 rule |
| Lenient calibration by the trigger's builder | Blind second labeler |

**Rule assets that drift:** analysis parsers (with ChatGPT's October list layout the analysis saw only 7 of 35 named businesses until `@18`); English hedge and condition lists; payload readers (fields vanish); the lever-support table; host tables; dated competitor facts. Guards: firing-rate monitors, golden runs, versioned lists relabeled quarterly, fail-closed field checks, dated labels with an owner.

## 16. Open decisions and assumptions

Numbering follows the reader report. Decisions 1-6 come before any build; 7-13 shape the MVP after the pilot; 14-20 belong to v2 or later. Every lean is our proposal [INFERRED]; the product owner decides. Record each decision here with its date.

| # | Decision | Options | Lean and why | What would change our mind |
|---|---|---|---|---|
| 1 | Lift "Scope stops at Measure" and the standing instruction | 1) Keep. 2) Lift for Phase 0, pilot, MVP W1-W2. 3) Lift for the roadmap | 2: W1-W2 instrument fixes help Measure anyway; five October decisions still lack answers [PROVEN] | The pilot fails, or the user wants a concierge service with no in-app plan |
| 2 | First buyer | 1) Gulf enterprise marketing lead. 2) SMB owner. 3) Operator or agency serving local SMBs | 3, with owners reading exports; one operator, no logins | Enterprise pays for receipts and multi-engine trends, or owners want logins |
| 3 | Collection cadence and answer budget | 1) Operator-started (today). 2) Fortnightly (~65/client/month). 3) Weekly (~130) | Weekly in the pilot, fortnightly after; ≤60 extra answers per client a month; approve a paid plan ($30 minimum); a standing schedule is not yet approved | The noise floor is small enough that fortnightly gives the same plans |
| 4 | Ownership overlay | 1) None; corrections via a new competitive set (a break). 2) Evidenced domain claims with lineage | 2; pending claims show only "what if"; every claim in the Report | A client disputes a recount, or claims prove hard to evidence |
| 5 | Fix the Measure method first | 1) Method first. 2) Launch on the current 10 Discovery questions | 1 where cheap: re-analyze, fix rival domains and observer country, decide the Discovery count (the audit proposes 20-30) before baselines freeze | The pilot cannot wait; then label plans "baseline will reset" |
| 6 | Schema-change window | 1) Agreed window. 2) Isolated copy, migrate once | Both; agree before W1 | None; prerequisite |
| 7 | Placement | 1) Operator Plan tab in Measure. 2) Fifth stage. 3) Exports only. 4) Owner view | 1 plus owner exports; Overview stays first; Report evidence-only | Operators thrive on exports (choose 3); owners want to log in |
| 8 | Plan cadence and caps | 1) Weekly 3 + 1. 2) Fortnightly. 3) Monthly + weekly nudge. 4) Start here only | Refresh after each regular run; ≤3 + 1 within 3 h; pilot tests "Start here only" vs "1 + 2 + decision" | Under half act weekly (go monthly); owners clear plans early (raise the cap) |
| 9 | Gate strictness | 1) Block. 2) Warn and downgrade. 3) Block owner-facing only | Block Q1-Q4, Q8; warn Q5-Q7; operator approves cards until release | Owners ignore questions 7+ days (time-out defaults) |
| 10 | Outcome checks | 1) Live and Used. 2) + re-asks and Tier 2. 3) + Tier 3 | 1 in MVP, 2 in v2, strict power gate; Tier 3 is research | Clients pay for controlled verdicts; a Tier 3 pilot shows low rewording correlation |
| 11 | Paid drafting | 1) Templates. 2) Approved per type, capped (v2). 3) Default | 2; code checks facts; ~$0.04 a brief | Hand-off notes alone get the work done |
| 12 | Fetch cited pages | 1) Never; operator checks. 2) Facts-only after SSRF fixes. 3) Browser rendering | 1 in MVP, 2 in v2; fetched text stored as dated facts that trigger nothing | Legal flags UAE or India terms; operator checks fast enough at pilot scale |
| 13 | Scoring transparency | 1) Words only. 2) Show ordering keys. 3) Numeric aid (v3) | 1 and 2; revisit at ~50 checked actions per lever | Operators cannot explain the order |
| 14 | Gemini and Google surfaces | 1) ChatGPT only. 2) Gemini, budgeted. 3) Google surfaces before a local wedge | 1 for the pilot; decide 3 before any local claim (Google documents listings for its own AI features) | Prospects ask for Gemini or Google first |
| 15 | Prompts beyond the 30 | 1) None. 2) Rewordings for re-asks. 3) Accuracy probes. 4) Perception probes | 2 in v2, via the Prompts pipeline, owner-confirmed; Validation/Accuracy wait for the fact store (v3) | Wrong-fact patterns recur across pilot clients (bring 3 forward) |
| 16 | Integrations | GA4; Business Profile/Places; Search Console; bot logs; Bing | v2: GA4 chatgpt.com sessions (else a tally). v3: Business Profile, Search Console. Logs and Bing on request | Clients lack GA4; Google's terms bar needed storage |
| 17 | UAE and India languages and platforms | 1) English, ChatGPT, stated per card. 2) Arabic or Hindi set (a break). 3) Host tables per market | 1 plus versioned host tables from citations; languages only as new baselines | Most inquiries arrive in Arabic or Hindi |
| 18 | Agent scope | 1) Assist and draft. 2) Act with approval. 3) Limited autonomy. 4) Clients' own tools (MCP) | 1 through v2; never combine private data, untrusted content and an external send | Logins and an audit trail exist; clients want tickets in their tools |
| 19 | Businesses with no usable website | 1) Out of scope. 2) A foundation card ("no usable site, no own page cited") | 1 in the MVP; revisit after the pilot | Several targets run only on Instagram or WhatsApp |
| 20 | Unevidenced requests (schema, llms.txt, "more reviews") | 1) Refuse silently. 2) Method note. 3) Track as outside work | 2 and 3 | New controlled lever evidence (update dated labels) |

**Smaller design decisions still open:** whether Measure ever opens on the Plan (lean: no); copy-rule exceptions (grade words allowed in the operator view; "Dismissed by you" in History); when to ask owner priorities (when a card first needs them; unset = P2); weight of by-name questions (tie-break within a band only); whether cloro's fan-out flag (+2 credits an answer) should be approved; who confirms domain families and rival domains (operator in Landscape, or owner on a card).

### 16.1 Assumptions to challenge

**In the brief:** (A1) one persona first: three sources name three buyers; (A2) AI visibility is the goal: it is a proxy and we hold no demand data; (A3) every measurement maps to an action: most first plans are fixes, questions and Watch items; (A4) recommendations can be automatic: triggers are rare, so MVP cards are operator-approved; (A5) categories are exclusive: they overlap and mean "who changes what"; (A6) parity is desirable: breadth parity is out of reach; the gaps that might lose deals are Google surfaces and an agency view; (A7) 3-5 actions a week: checks take 2-8 weeks; monthly may fit; (A9) English ChatGPT suits the UAE and India: unproven; (A10) lifting scope means v1-v3: approve only through the MVP; (A11) the Measure method is ready: changing the Discovery count later resets plans; (A12) someone pays for the cadence and checks: needs a standing approval. Also: "technical foundations first", "local means Google plus Yelp", "more reviews help" and "every action is re-measured" are contradicted or limited by our data (sections 4.1, 11).

**In our own framework:** (F1) owners answer yes/no questions within days (pilot tests 3-day rates; 7-day defaults); (F2) ~15 operator minutes per client per week; (F3) signed-out ChatGPT from one country stands in for customers (its searches already named other emirates); (F4) a hedge marks a real information gap (some are policy or style); (F5) citations can route work (they show retrieval, not influence); (F6) API lever studies transfer to consumer ChatGPT (labels must name outcomes and limits); (F7) four businesses' data generalize (triggers need ≥3 business kinds); (F8) rules stay stable (October's layout hid named businesses until `@18`; payload fields vanished); (F9) answer prices stay near $0.0015 (minimums and plan changes decide affordability); (F10) owners act on no-regret Fixes even when the AI effect is unknown (the core bet; otherwise a concierge service); (A8) honesty sells ("can't tell yet" will be the commonest verdict; willingness to pay untested).

## 17. Glossary (canonical terms)

Use these names exactly in code, copy and later plans. Lists defined elsewhere are referenced, not repeated.

| Term | Meaning (where defined) |
|---|---|
| Eight stages | Measurement · Observation · Insight (a finding; code `Opportunity`) · Diagnosis · Opportunity · Recommendation · Action · Outcome (3.1) |
| Plan view; owner exports | Operator surface inside Measure (`?view=plan`, if approved); owner message, one-page plan, hand-off note (10.6) |
| Operator; owner; product owner | Runs Project Sun for a client; owner of the measured business; decides what Project Sun builds |
| Card types, labels, flags | 10.2 |
| Gates Q1-Q8; triggers T1-T15 | 6; 7 (MVP: T1, T3, T6, T7, T8, T11) |
| Categories 0-7; lenses L1-L9 | 4.2; 4.4 (lenses add evidence lines, never cards) |
| Look; occasion | One eligible answer in a card's scope; one calendar day |
| Diagnosis grade; lever support; check labels; page states | 8.2 |
| Recommendation states; action states; dismiss reasons | 10.3; 10.4 |
| Proof-of-done ladder | 10.5 |
| Outcome levels; check tiers; verdicts | 11.1; 11.2; 11.3 |
| Priority tiers; order keys; reach bands; effort classes | 9.3 |
| Comparability break | A setup change; counts never cross it |
| Ownership overlay | Evidenced domain claims applied to Measure figures with lineage (6.1) |
| Scope line | "ChatGPT on the web, signed out, asked from ‹country›, English questions" |
| Hedge; by-name answer | An answer saying a fact is unclear; an answer to a Trade Offs or Sentiment question |
| Wilson range | The plausible range shown with x of n (2 of 10 is 6-51%) |
| SSRF | Server-side request forgery, open on some fetch paths |

## 18. Sources

Accessed 2026-11-09 unless dated. The full register (148 rows; 84 key rows in the reader report's Appendix A) was in the temp folder; the key sources follow. Internal files are not public.

**Peec AI:** [Actions webinar, 2026-11-04](https://www.youtube.com/watch?v=h-MGdZJbBH8) [DEMO]; [docs: Actions](https://docs.peec.ai/actions.md); [API: List Actions](https://docs.peec.ai/api-reference/actions/list-actions.md); [API: Get Action](https://docs.peec.ai/api-reference/actions/get-action.md); [changelog](https://peec.ai/changelog); [Content optimization](https://docs.peec.ai/content-optimization.md); [Brand perception: Market](https://docs.peec.ai/brand-perception-market.md); [Agent](https://docs.peec.ai/agent.md); [AI referrals](https://docs.peec.ai/ai-referrals.md); [Crawl insights](https://docs.peec.ai/crawl-insights.md); [product: Actions](https://peec.ai/product/actions) [CLAIM]; [prompt tracking](https://peec.ai/blog/the-key-to-prompt-tracking) [CLAIM]; [SIXT case](https://peec.ai/blog/how-sixt-increased-ai-citations-of-its-partner-listings-by-320) [CLAIM]; [mention-gap guide](https://peec.ai/blog/a-beginner-s-guide-to-brand-mention-gap-analysis-in-ai-search) [CLAIM]; [Landwehr video](https://www.youtube.com/watch?v=zUfwkh3eybM&t=239s) [CLAIM].

**Profound:** [AEO Guide](https://www.tryprofound.com/aeo-guide) (chapters [3](https://www.tryprofound.com/aeo-guide/chapter-3), [4](https://www.tryprofound.com/aeo-guide/chapter-4), [5](https://www.tryprofound.com/aeo-guide/chapter-5)); [Suggestions from Aim](https://docs.tryprofound.com/projects/suggestions-from-aim.md); [Interpret](https://docs.tryprofound.com/answer-engine-insights/interpret.md); [FactCheck](https://docs.tryprofound.com/answer-engine-insights/factcheck/about.md); [Agents](https://docs.tryprofound.com/agents/about.md) and [FAQ](https://docs.tryprofound.com/agents/faq.md); [why past numbers change](https://docs.tryprofound.com/cookbook/metrics/why-past-numbers-change.md); Profound 101 [L10](https://www.youtube.com/watch?v=cSi01sPrbvI), [L11](https://www.youtube.com/watch?v=hQVgIOcLTAI) [DEMO, outdated]; [11-day half-life](https://www.tryprofound.com/blog/the-half-life-of-an-ai-citation-is-11-days), [query language](https://www.tryprofound.com/blog/how-query-language-reshapes-ai-citations), [missing UTM tags](https://www.tryprofound.com/blog/chatgpt-missing-utm-tags), [customers](https://www.tryprofound.com/customers) [CLAIM].

**Other platforms [DOC unless marked]:** [Scrunch Pitch a page](https://helpcenter.scrunchai.com/en/articles/17508012-pitch-a-page); [Scrunch Signals](https://helpcenter.scrunchai.com/en/articles/15879296-understanding-the-signals-tab); [AthenaHQ Site Health](https://docs.athenahq.ai/guides/site-health); [AthenaHQ Insights](https://docs.athenahq.ai/guides/insights); [OtterlyAI](https://help.otterly.ai/ai-recommendations); [Rankscale](https://help.rankscale.ai/articles/4771319766-turning-insights-into-actions); [Adobe opportunities](https://experienceleague.adobe.com/en/docs/brand-visibility/using/dashboards/opportunities/opportunities-overview) and [IME](https://experienceleague.adobe.com/en/docs/brand-visibility/using/resources/impact-measurement-engine); [Conductor](https://www.conductor.com/docs/intelligence/recommendations.md); [Yext Scout FAQ](https://help.yext.com/hc/en-us/articles/37266875413403-Scout-FAQs), [Types of Actions](https://help.yext.com/hc/en-us/articles/53810840451483-Types-of-Actions), [Live Tests](https://help.yext.com/hc/en-us/articles/56465488529819-Live-Tests); [AirOps opportunities](https://docs.airops.com/campaigns/opportunities.md), [measurement](https://docs.airops.com/campaigns/measurement.md); [Writesonic](https://docs.writesonic.com/docs/action-center-actionables.md); [HubSpot](https://knowledge.hubspot.com/seo/review-and-manage-aeo-recommendations); [Gauge](https://docs.withgauge.com/navigating/action-center.md); [Trakkr Results](https://trakkr.ai/learn/docs/features/results), [Actions](https://trakkr.ai/learn/docs/features/actions); [Promptwatch](https://promptwatch.com/docs/academy/how-actions-are-prioritized); [Searchable](https://docs.searchable.com/api-reference/opportunities/list-opportunities.md); [Evertune](https://docs.evertune.ai/en/articles/12271101-evertune-metrics); [Brandlight](https://brandlight.ai/blog/brandlight-vs-profound.md) [CLAIM]; [Goodie](https://higoodie.com/features/ai-optimization-actions/) [CLAIM]; [Velova](https://velova.ai/actions) [CLAIM] plus our captures (`Sun Project/Velova/Dashboard/`) [DEMO].

**Local tools:** [Local Falcon Agent](https://www.localfalcon.com/knowledge-base/kb64-how-to-use-falcon-agent-local-falcons-ai-agent-for-local-seo); [BrightLocal](https://help.brightlocal.com/hc/en-us/articles/37990748897810); [Synup](https://synup.com/kb/aeo/act-on-recommendations); [Birdeye](https://birdeye.com/updates/introducing-ai-search-optimization-agent-turn-ai-search-insights-into-actionable-recommendations/); [Insites benchmark](https://insites.com/blog/the-ai-visibility-benchmark-how-10000-local-businesses-actually-perform-in-chatgpt-and-perplexity/) [3P].

**Platform guidance and policy [DOC]:** [OpenAI crawlers](https://developers.openai.com/api/docs/bots); [ChatGPT search help](https://help.openai.com/en/articles/9237897-chatgpt-search); [OpenAI Commerce](https://developers.openai.com/commerce/guides/get-started.md); [Google AI features](https://developers.google.com/search/docs/appearance/ai-features); [Google common crawlers](https://developers.google.com/crawling/docs/crawlers-fetchers/google-common-crawlers); [Search Console AI report](https://support.google.com/webmasters/answer/16984139); [Business Profile ranking](https://support.google.com/business/answer/7091); [Bing AI Performance](https://blogs.bing.com/webmaster/2026/2/Introducing-AI-Performance-in-Bing-Webmaster-Tools-Public-Preview/); [Google review policy](https://support.google.com/contributionpolicy/answer/7400114); [FTC fake-review rule](https://www.ftc.gov/news-events/news/press-releases/2024/08/federal-trade-commission-announces-final-rule-banning-fake-reviews-testimonials); [Google Ads optimization score](https://support.google.com/google-ads/answer/9061546); [Maps service terms](https://cloud.google.com/maps-platform/terms/maps-service-terms); [MOHAP](https://mohap.gov.ae/en/services/license-for-healthcare-advertisement-on-social-media); [DHA standard (found, not opened)](https://www.dha.gov.ae/uploads/042022/Standards%20for%20Medical%20Advertisement%20Content%20in%20Social%20Media2022433965.pdf); [Fresha reviews](https://www.fresha.com/help-center/knowledge-base/clients/103752-ratings-and-reviews-overview); [OWASP LLM01](https://genai.owasp.org/llmrisk/llm01-prompt-injection/), [LLM06](https://genai.owasp.org/llmrisk/llm062025-excessive-agency/) [3P].

**Studies [3P]:** [Chen & Koudas, What Drives AI Citations?](https://arxiv.org/html/2610.15033v1) (preprint; vendor data help); [Chen & Koudas, location audit](https://arxiv.org/html/2610.24081v1); [Pitenin, Bali census](https://arxiv.org/abs/2608.07069) (vendor-funded); [Liu et al., public posts](https://arxiv.org/html/2610.11932v1); [Watanabe & Nakayashiki](https://arxiv.org/abs/2606.04362); [Martinez survey, 45 studies](https://arxiv.org/abs/2607.14035); [UI vs API audit](https://arxiv.org/abs/2609.18729); [Zhang, silent fetch failures](https://arxiv.org/abs/2611.00884); [LIVE-GEO](https://arxiv.org/abs/2611.01126); [Aggarwal et al., GEO (KDD 2024)](https://arxiv.org/abs/2311.09735); [ranking manipulation](https://arxiv.org/abs/2406.03589); [IAB guideline](https://www.iab.com/guidelines/measuring-visibility-in-the-ai-era/); [Ahrefs schema study](https://ahrefs.com/blog/schema-ai-citations/) and [llms.txt study](https://ahrefs.com/blog/llmstxt-study/) (vendor); [Seer](https://www.seerinteractive.com/insights/geo-experiment-how-ai-highlighted-the-1-bad-review-we-got-in-24-years) (vendor); [Siege Media](https://www.siegemedia.com/research/versus-pages) (vendor); [MaxAEO](https://maxaeo.ai/blog/time-to-citation-ai-search/) [CLAIM]; [Kumar, sentiment variability](https://arxiv.org/html/2606.20065) (vendor-authored).

**Methods [3P]:** [GRADE handbook](https://gdt.gradepro.org/app/handbook/handbook.html); [Torres, opportunity solution trees](https://www.producttalk.org/opportunity-solution-trees/); [NN/g data vs findings vs insights](https://www.nngroup.com/articles/data-findings-insights-differences/); [RICE](https://www.intercom.com/blog/rice-simple-prioritization-for-product-managers/); [ICE](https://itamargilad.com/the-tool-that-will-help-you-choose-better-product-ideas/); [van der Sijs, overridden alerts](https://pmc.ncbi.nlm.nih.gov/articles/PMC1447540/); [Lighthouse scoring](https://developer.chrome.com/docs/lighthouse/performance/performance-scoring).

**Internal:** `CLAUDE.md`; `MEASURE_AUDIT.md`; `PROJECT_STATUS.md`; `docs/MEASURE_WORKSPACE_DESIGN.md`; `docs/CHATGPT_CONSUMER_COLLECTION_DECISION_MEMO.md`; `docs/KNOWN_ISSUES.md`; code read-only (`src/lib/measure/{engine,policy,public}.ts`, `src/components/features/measure/findings.tsx`, `src/lib/understanding/{digest,edits,index}.ts`, `src/lib/analysis/types.ts`); `data/sun.db` read-only (runs `crun_6df9150f`, `crun_a2372971`, `crun_efabc943`, `crun_2a2329d1`, `crun_b4ec762f`); Stage 1 brief, founder LLM reference and job description (2026-09); founder discussion transcript (2026-09-03, approximate); Phase 2 specification; manager brief (2026-09-16); October Actions report and cost study (links in section 0.2); `docs/Project_Sun_Recommendations_and_Actions_Research_2026-11-09.docx`.

**Could not be accessed (nothing relies on them):** Peec webinar screens; Peec's "ownership study" and Listicle Rank Effect paper (HTTP 403); Profound's impact rubric (needs a logged-in MCP session) and gated webinars; the paid apps of Scrunch, AthenaHQ, Rankscale, Searchable, Promptwatch and Goodie; Scrunch webinars; G2 and Capterra pages; OpenAI help pages beyond ChatGPT search; SparkToro's original consistency study; trade press on the Yelp-OpenAI deal; Velova's current app; Project Sun output under its newest Measure version. No vendor publishes impact formulas, weights or band cut-offs, or predicted against realized impact; no independent causal study exists for Business Profile edits, review campaigns, NAP clean-up, Wikipedia pages, PR placements or review-site drives; no study covers local AI recommendations in the UAE or India.
