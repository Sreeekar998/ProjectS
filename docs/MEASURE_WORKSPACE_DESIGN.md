# Measure workspace: information architecture and measurement semantics

Written 2026-09-15 before the Measure rebuild. This is the contract the code
follows; `.claude/rules/analysis-measure.md` carries the invariants, this file
carries the decisions and why. Read it before changing Measure.

## 1. What Measure is for

A marketing lead opens Measure to answer, with evidence they can click through
to, five questions:

1. Is my brand recommended when a buyer does not name it? (Discovery)
2. When a buyer compares me with a rival, who wins, and on what? (Trade Offs)
3. When a buyer asks about me by name, how am I described? (Reputation)
4. Which sites and pages shape those answers, and are any of them mine? (Sources)
5. What changed since last time, and can I trust the comparison? (History)

Everything else — opportunities, exports, methodology — exists to make those
answers actionable and auditable. Collection stays inside Measure; there is no
Observe or Actions stage. Where a finding points at work (a page to write, a
site to approach), Measure names the evidence and stops. Prescribing the work
is the later Actions phase.

## 1a. Revision of 2026-11-09 (measure-policy@4, observation-analysis@18)

The audit in `MEASURE_AUDIT.md` (repo root) rebuilt the workspace around the
questions above. Where this document disagrees with the list below, the list
wins:

- **Views:** Overview · Competitors (URL key `brands`) · Questions (`performance`)
  · Sources · Report, plus Answers (`?view=answers`). Opportunities and
  Methodology are gone as tabs: findings are the Overview's "What needs
  attention" (`?view=opportunities` lands there), and method, definitions and
  coverage live in the Report and the "?" drawers.
- **Overview:** four headline figures (Visibility, Share of voice, Head-to-head,
  Reputation), each with its fraction and a plausible range (Wilson 95%); who the
  engine names (every business) beside where the brand is missing (topics and
  places); findings; where the answers come from (each answer once, by whose
  site it cited); what changed and what the figures rest on. "In short" (it
  repeated the tiles), the per-engine bars for a single engine, and the
  every-answer grid (now on Questions) were removed.
- **Competitors:** one table of every business named, tracked or not, replacing
  three leaderboards with three denominators.
- **Sources:** one ownership rate (the "when sources were shown" rate only when
  it differs), the answer-level mix, kinds counted by answers, one site table
  with a "cited when you were left out" filter (the separate candidates list is
  gone), pages behind a disclosure, and a "possibly yours" hint for a domain
  that spells the brand but is not recorded as its site.
- **Metrics:** "no business named" counts answers naming no business at all;
  untracked names are one business however spelled; topic leaders count every
  business; share among tracked brands and share of tracked-brand links are
  export-only. Reputation is read among the answers that gave an opinion.
- **Comparability:** a change inside the earlier run's plausible range is shown
  as "within range", never coloured as a gain or loss. The sampling posture is
  "Exploratory baseline".

## 2. Information architecture

One route, `/projects/[id]/measure`, one measurement selected at a time, six
views switched by a tab strip (`?view=`). The selected measurement is a
collection run (`?run=`); the default is the latest run for the project.

| View | Question it answers | Contents |
|---|---|---|
| Overview | How am I doing, and what changed? | Chart-first since 2026-09-16 (`components/features/measure/charts.tsx`): headline tiles with rings and change vs the previous comparable measurement, the three "In short" cards, who gets recommended (bars, target in the sun accent, rivals grey), where answers point (share bar + top sites), per-topic bars, ChatGPT vs Gemini grouped bars with a legend when both engines ran, every answer at a glance (outcome strip), coverage meter and the top findings with meters. Every mark opens the answers behind it. The collection console shows when a run is active or incomplete. |
| Questions (URL key `performance`) | Which questions did I win, lose or miss? | One row per question × engine: section, topic, outcome (named / not named / verdict / portrayal), rank, sources, owned citation, status (analysable, not collected, needs a look). Filters: engine, section, topic, outcome, brand named, cited mine. Every row opens the answer. |
| Brands | Who is named instead of me, and how do we compare? | The frozen competitive set plus untracked names: answers naming each brand, share of voice, ranked first, average explicit rank, head-to-head record against the target, own-site citations. |
| Sources | Which sites and pages shape the answers? | Domain table (ownership, kind guessed from the address, answers citing, links, per engine, cited in Discovery answers that did not name me), URL table, and source-gap candidates. |
| Opportunities | Where is the evidence pointing? | Evidence-backed findings grouped by type, each with counts, the answers behind it, what it is evidence of and what it is not. |
| Methodology | What exactly was measured, and can two runs be compared? | Lineage, versions served, provider/route coverage, every metric definition verbatim, sampling posture, comparability rules, the measurement history, site readiness signals from the Understand crawl, exports. |
| Report | Can I hand this on? | The measurement as one printable document (added 2026-09-15 evening, after reading Velova's Beacon report): cover with lineage, a one-paragraph summary written from the figures, headline fractions with deltas, what changed, engines side by side, the brand leaderboard, each section's questions with the outcome per engine, sites, findings with a quoted sentence, coverage, method and every definition. "Print or save as PDF" is the export. |
| Answers (URL key `answers`, not a tab) | What did the assistants actually say? | Every question with each engine's full answer as the site showed it, linked brands highlighted, sources labelled by owner, printable. Reached from the Report, the Export menu and Methodology. |

Mobile: tabs scroll horizontally; tables collapse to card lists under 640 px.

**Plain-language summary.** `measure/summary.ts` writes the Overview's "In one paragraph" panel and the report's summary from the engine's fractions, sentence by sentence (coverage, discovery with the most-named brand in the same answers, first choice, head-to-heads with the rival preferred most, reputation with its themes, own-site citation with the most-cited other site, change or the break). No model writes it, so it cannot fail or drift from the tables; percentages appear only at or above `LOW_N`, ties are called ties, and an empty section says nothing can be counted rather than printing a zero.

## 3. Measurement model

**A measurement is a collection run.** One run asks every approved prompt on
one route per enabled engine, once. Its measurement is computed from the
analyses stored for its responses, always by the pure engine.

**Live vs snapshot.** While a run is active or incomplete, Measure computes on
every request ("provisional"). When a run is finalised, an immutable
`measurement_snapshots` row stores the full result plus lineage. History reads
snapshots; a run without a snapshot is computed live and labelled provisional.

**Finalisation.** A run is finalised automatically when every planned answer
is collected and analysed, or by the operator ("Finish with what's collected")
when a run is stopped and partial. A finalised run accepts no more answers;
"Collect again" starts a new run. Finalisation cancels pending re-checks.

**`metric_snapshots` is retired.** It was never written and its per-metric,
basis-point rows cannot hold what History needs (presence rows, verdicts,
sources, coverage, lineage). One row per measurement holding the engine's
full result replaces it. The empty table is dropped in the same migration.

**Re-analysis.** After an `ANALYSIS_VERSION` bump, a run's stored analyses
stay at the old version until re-analysed. Measure reports the versions it
actually served (`lineage.analysisVersions`); a snapshot records them too. A
re-analysis writes new analysis rows and, for a finalised run, a new snapshot
version superseding the old one. Nothing is overwritten.

## 4. Comparability

Two measurements are compared only when the instrument is the same. Breaks
and cautions are computed from lineage, never assumed from dates.

**Breaks (no deltas shown, the pair is "not comparable"):**
- prompt set differs (the questions changed);
- competitive set version differs (denominators changed);
- analysis version served differs (evidence extraction changed);
- metric policy version differs (formulas changed);
- engines with analysable answers differ (one run has Gemini, the other not);
- samples per prompt differ.

**Cautions (deltas shown with a note):**
- collected through a different provider for the same engine and surface;
- observer country differs;
- coverage differs by more than 10 percentage points, or either run is partial;
- the page named a different model.

**Deltas.** A delta is shown only for a comparable pair, as percentage points
with the fractions beside it. Below `LOW_N` (5) answers on either side the
change is shown as counts ("2 of 4 → 3 of 4"), never as points. Null on
either side means no delta.

## 5. Lineage repairs (all in this change)

| Problem | Fix |
|---|---|
| Measure read the project's latest competitive set | Reads the prompt set's pinned `competitiveSetVersionId`; falls back to latest only for legacy sets and says so in lineage. |
| Analysis linked against live confirmed entities | Links against the run's frozen set: target (live row) + frozen competitors (snapshot names, aliases, domains) + parented product entities of those. `ANALYSIS_VERSION` → `observation-analysis@10`. |
| Lineage always showed the current analysis version | Reports versions actually served, `mixed` when more than one, and the count of answers at an older version, with a re-analyse action. |
| Global idempotency key blocked repeat runs | Key is scoped to the run: `sha256(run|candidate|route|sample)`. Adding a route to a run still never duplicates a prompt. |
| Page reused the old run after a new prompt set | The page shows the selected run and warns when a newer approved prompt set exists; "Collect again" creates a new run for the latest approved set. |
| By-rival rows booked rival-vs-rival comparisons | Only comparisons involving the target are attributed to a rival's row. `METRIC_POLICY_VERSION` → `measure-policy@2`. |
| `succeeded` was read as analysable | Run detail reports analysis state per answer (`analysed`, `needs_review`, `missing`); coverage separates "not collected" from "collected, awaiting analysis"; a re-analyse endpoint retries. |
| Measure accepted any run id for any project | The run must belong to the project (404 otherwise). |

## 6. Metrics

Existing metrics keep their definitions. Additions, each published in
`METRIC_DEFINITIONS` with event, denominator, sections and missing-data rule:

- **Average explicit rank** (per brand): mean of explicit ranks over
  rank-eligible Discovery answers where the brand holds a rank. Never derived
  from prose order.
- **Cited in Discovery answers that did not name you** (per domain): Discovery
  answers citing the domain where the target was absent. An answer-level fact;
  it does not say the page omits the brand.
- **Coverage split**: planned, collected, analysable, needs a look, not
  collected, awaiting analysis.

Deliberately absent, because the product cannot substantiate them: a composite
"visibility score", prompt volume or search demand, revenue or traffic
estimates, sentiment as a 0–100 number, and any figure interpolated between
runs. Where a competitor shows one of these, Methodology says why Measure does
not.

## 7. Sources

- **Ownership** comes only from the frozen competitive set and the target's
  domains: yours, a tracked rival's, or third party (which only means "not
  attributable to a tracked brand").
- **Kind** is guessed from the address with a small rule table (retailer or
  marketplace, editorial or review, community, reference, video or social,
  brand site, other) and labelled as a guess.
- **URL rows** list each cited page with its domain, ownership, answers citing
  it, sections and engines.
- **Source-gap candidates** are third-party domains cited in Discovery answers
  that did not name the target, ranked by how many such answers cite them. The
  copy says what was checked (the answers) and what was not (the pages). A
  persisted page fetch that would let Measure say "this page does not mention
  you" is deferred: it needs a crawl of third-party sites with its own robots,
  rate and storage rules, and belongs to the Actions phase.

## 8. Opportunities

Computed by the engine from analysable answers only, each with observation
ids and a published definition (what it is evidence of, what it is not):

| Type | Evidence | Not evidence of |
|---|---|---|
| Missing from discovery | Discovery answers naming ≥1 tracked rival and not the target, grouped by topic. | That the brand is unknown; one sample per prompt. |
| Head-to-head losses | Trade Off answers where a rival was preferred, with the aspects named. | A general verdict; one answer per pairing. |
| Reputation concerns | Sentiment answers where the target's portrayal is negative or mixed, with themes. | Sentiment across all answers; only by-name questions count. |
| Sites shaping answers you are missing from | Third-party domains cited in Discovery answers that did not name the target. | That those pages omit the brand (not checked). |
| Rival sites cited | Tracked rivals' own domains cited as sources. | — |
| Your site never cited | Answers that showed sources, none of them yours. | Answers that showed no sources. |
| Untracked brands recurring | Names outside the frozen set in ≥2 answers. | Anything measurable until they are added and a new run collected. |
| Coverage gaps | Not collected, awaiting analysis, needs a look. | Brand absence. |

No opportunity carries a benchmark, a volume, or a revenue figure.

**Quoted evidence.** Missing-from-discovery, head-to-head-loss and
reputation-concern findings carry up to two `examples`: the verbatim span
the analysis read (the sentence naming the rival, the comparison sentence
that preferred the rival, the negative or mixed opinion), rendered as prose
(markdown stripped) with the answer it came from, so a card quotes the
evidence rather than describing it. Snapshots written before 2026-09-15
have no `examples`; readers treat a missing list as empty.

## 9. Exports and report

- `GET …/measure/export?run=&format=csv`: the question table, one row per
  question × engine, with lineage columns. `format=brands-csv` is the brand
  leaderboard and `format=sources-csv` the cited sites (added 2026-09-16).
  `format` is validated (400 otherwise), a run from another project is 404.
  Files never name a collection vendor or carry a route id: the CSV's
  `surface` column and the JSON's `bySurface` / `surfaces` / per-row `surface`
  come from `measure/public.ts`, which re-keys every route-scoped block by
  surface ("ChatGPT on the web"). The API itself still returns route-keyed
  blocks for the workspace's engine tabs; the UI renders only surface labels.
  Cells are built by `measure/export.ts`: UTF-8 BOM, CRLF, quoted, and a
  leading `=`, `+`, `-` or `@` is prefixed with an apostrophe so a spreadsheet
  never runs an answer as a formula.
- `GET …/measure/export?run=&format=json`: the full measurement result,
  definitions and lineage.
- The UI's one Export control is `components/features/measure/export-menu.tsx`
  (menu on the page header, row on Methodology). Files download through
  `lib/client/download.ts` (fetch → blob → `<a download>`) so a failed export
  shows its message beside the menu instead of replacing the workspace with
  a JSON error page; the menu closes after a choice and the success note
  fades. The earlier `<details>` menu of plain `<a href>` links stayed open
  and navigated the tab to raw JSON on an error.
- `GET …/measure/answers?run=`: every collected answer of the run with its
  question, provenance, highlight surfaces and source ownership, computed
  once on the server from the same analysis Measure serves
  (`measure/answers.ts`, pure helpers in `measure/answer-evidence.ts` shared
  with the evidence drawer).
- Print: the Report view (`?view=report`) is the printable document and the
  Answers view (`?view=answers`) the printable appendix; `globals.css` sets
  the page margin and the `sun-print-page` / `sun-print-keep` break classes.
  Nav, controls, banners and drawers carry `print:hidden`. The Overview still
  prints as a one-page summary.

## 10. Technical readiness

Measure shows only what the Understand crawl already persisted for the
target site: robots.txt fetched and allowed, sitemap found, pages fetched and
selected, pages with structured data (schema types), canonical and hreflang
presence, and whether a JavaScript fallback was needed. No new crawling. A
fuller readiness audit (AI crawler directives, llms.txt, rendering checks) is
deferred to the Actions phase because it needs new fetches and its own policy.

## 11. Seeded demonstration

`scripts/seed-measure-demo.ts` builds, in an isolated data directory, one
project with two engines and three runs: two comparable complete runs (the
second collected through a different ChatGPT provider, a caution not a break),
and one later run on a new prompt set version after the competitive set
changed (a break), partial, with missing captures and an answer that needs a
look. Answers are templated so they exercise wins, losses, absences, explicit
rankings, mixed and negative portrayal, owned and rival citations, and
answers without sources. Every analysis is produced by the real analyzer.

## 12. Where this diverges from Velova and similar dashboards

- Every question is listed on the Overview as a question × engine grid; a cell
  opens the answer as the site showed it, with the linked brands highlighted
  and each source labelled by owner.
- No composite visibility score, no prompt volume, no "AI traffic" or revenue
  estimates: nothing the product cannot compute from its own evidence.
- No daily trend lines: a run is a point; history is a list of runs with
  comparability stated per pair.
- No sentiment scores: a distribution of portrayals with the sentences behind
  them.
- Position is an explicit rank or nothing; order of appearance in prose is
  never a rank.
- Every figure carries its fraction, every fraction opens its answers, and
  missing answers are never absences.
- Recommendations name evidence, not tactics; tactics are the Actions phase.
- The report's summary and the findings' quotes are written from the
  numbers and the analysed spans, never by a model, so there is no
  "Commentary unavailable" slot to fail.
- Brand and site marks are initials, not logos: no third-party logo service
  is called with the project's domains.
- Velova's verified page rescan ("GAP") remains the one thing it does that
  Measure does not; source-gap rows say "page not checked" until a
  persisted fetch with its own robots, rate and storage rules exists
  (Actions phase).

Research inputs: `Velova/Dashboard/*.pdf`, `Velova/velova-html/` and
`project-sun-competitor-research/`, summarised in `docs/MEASURE_COMPETITOR_NOTES.md`.

## 13. Implementation map (as built, 2026-09-15)

| Concern | Where |
|---|---|
| Result types, engine, definitions | `src/lib/measure/{types,engine,policy,source-kind}.ts` |
| Comparability and deltas | `src/lib/measure/compare.ts` |
| Service (pinned set, versions served, gaps) | `src/lib/measure/service.ts` |
| Snapshots, history, previous run | `src/lib/measure/snapshots.ts`, table `measurement_snapshots` (migration `0006`; `0007` drops `metric_snapshots`) |
| Finalisation | `src/lib/collection/finalise.ts`; runner auto-finalises complete runs; `POST /api/collection-runs/[id]/finalise` |
| Re-analysis | `reanalyseCollectionRun` in `src/lib/analysis/service.ts`; `POST /api/collection-runs/[id]/reanalyse` |
| Frozen-set linking | `linkableEntitiesForRun` in `src/lib/analysis/service.ts`, `src/lib/landscape/frozen-entities.ts` |
| Readiness signals | `src/lib/measure/readiness.ts` (crawl only) |
| Plain-language summary, tracked-brand rank | `src/lib/measure/summary.ts` (pure) |
| Answers report data | `src/lib/measure/answers.ts` (server), `src/lib/measure/answer-evidence.ts` (pure, client-safe) |
| APIs | `src/app/api/projects/[id]/measure/{route,history/route,export/route,answers/route}.ts` |
| UI | `src/app/projects/[id]/measure/page.tsx`, `src/components/features/measure/*` (one file per view, including `report-view.tsx` and `answers-view.tsx`; `shared.tsx` holds figures, `Ring`, `Mark`, drawers), console changes in `observation-console.tsx` |
| Demo data and checks | `scripts/seed-measure-demo.ts`, `scripts/measure-handcheck.ts`, launch entry `sun-verify-measure` |
| Tests | `tests/unit/measure/{engine,adversarial,workspace,summary,answer-evidence}.test.ts`, `tests/integration/measure-lineage.test.ts` |
