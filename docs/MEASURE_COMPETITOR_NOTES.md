# Measure research notes: Velova and the GEO dashboard market

Condensed from two research passes on 2026-09-15: the eleven Velova dashboard
PDFs in `Velova/Dashboard` (read page by page) and the vendor archive in
`project-sun-competitor-research` (Peec, Profound, AthenaHQ, Otterly,
Rankscale, Scrunch, Brandlight, Bluefish; captured 2026-09-13, live re-fetch
not completed, so marketing-only claims are marked unverified). These notes
inform `MEASURE_WORKSPACE_DESIGN.md`; they are not a product spec.

## Velova, as observed

**Screens.** Overview (five KPI tiles with qualitative bands, daily trend,
per-engine cards, top action), Performance (Discovery / Comparison / Trust
tabs, prompt table with a 0–100 position score), Brands (rank "#68 of 80",
leaderboard with Manual / AI-discovered / Mentioned-once chips), Sources
(query buckets × twelve action channels, "GAP" chips, URL table with rescan),
Actions & Repairs (issue cards: Problem / Why it matters / Recommended fix /
affected prompts), AEO Readiness (additive point checks per pillar).

**Metric definitions it publishes.** Visibility = prompts mentioning the brand
÷ discovery prompts. First Choice = prompts ranked #1 ÷ discovery prompts.
Share of Voice = weighted presence (primary 100 / secondary 70 / mention 40).
Position Score = mean of 100 ÷ log2(rank + 1). Competitive rank = 0.40 SoV +
0.35 position + 0.25 first choice. Trust score: formula not published.

**Honesty devices worth keeping.** Fraction beside every rate ("1/20 runs",
"35 of 163"); one card per engine with "n / N mentions"; "Small sample."
verdicts; "Need at least 2 daily snapshots to draw a trend"; "Insufficient
prior data to compute deltas yet"; "GAP = recent scan confirmed your brand is
not on the page" (only when the page was actually fetched); "Not pitchable"
for rival and AI-tool domains; the Problem / Why it matters / Recommended fix
/ affected prompts issue anatomy with a quoted real excerpt.

**Problems observed in its own data.** The same prompt reported as "Position
1" in the prompt report, counted as first choice, and scored 19/100 (rank 5)
in the table. Position Score shown as N/A, 5, 2, 57 and 66 for the same run
under one label. Net sentiment 32.5%, 41.9% and 10.0% on one report. Brand
counts 79 / 80 / 81. "Top in category sees 25%" is the best brand in the same
run presented as a category benchmark. "Medium" first-choice band on one hit
in twenty. Win rate 81.3% that silently excludes "0W · 0L" rows. Template
leaks ("recommend Brand more clearly"). Nine "Commentary unavailable" slots.
FAQ schema double-counted across two AEO pillars; speculative files
(`ai-index.json`, `.well-known/mcp.json`) penalised as failures.

## Market patterns (Peec, Profound, AthenaHQ, Otterly, Rankscale, Scrunch)

- **Atomic record is one answer** (Peec "chat", Profound "run", Athena
  "response") = prompt × engine × country × day. Every dashboard metric is a
  count over those records, and the denominator is a first-class number
  (Profound `executions`, Athena "Responses Analyzed", Rankscale "24 runs").
- **Formulas published verbatim.** Peec: Visibility = responses mentioning
  the brand ÷ all responses; Share of Voice = brand mentions ÷ all brand
  mentions "including yours"; Position = average rank where the brand
  appears, counting every detected brand. Athena adds Mention Gap (mention %
  minus competitor mention %) and Citation Gap. Profound warns that its
  public sentiment endpoint "will not match the app's headline value".
- **History.** Daily runs; deltas "compared to the previous time period of the
  same length"; Athena draws "cohort" lines when prompts were added; Otterly
  makes prompt text and country immutable; Profound keeps history for
  disabled prompts and warns against averaging daily rows.
- **Prompt tables** carry visibility, position, mentions, sentiment, tags,
  topic, country, engine, and open the raw answer with mentions and citations
  highlighted. Scrunch's "Cited / Not cited" grid per prompt × engine is the
  simplest non-technical view.
- **Sources** at domain and URL grain: Retrieved (chats with at least one URL
  from the domain), citation share, citation rate; domain types You /
  Competitor / Editorial / Corporate / UGC / Reference / Institutional /
  Other; URL types (homepage, category, product, listicle, comparison,
  article…). "Not all sources are citations, but every citation is a source."
  Gap logic everywhere: "sources that appear frequently and mention lots of
  competitors" (Peec), "sort by competitor mention % descending, then rows
  where brand mention % is low" (Athena, after a page rescan).
- **Recommendations** follow Problem → Why this matters (with counts) →
  Evidence → What to do → Relative impact, with statuses and re-measure
  markers (Peec Impact page).
- **Needs data Project Sun does not have:** prompt volume, estimated
  impressions or value, category benchmarks and indices, stability or
  volatility scores (need repeated samples), 0–100 sentiment, traffic or
  revenue attribution, citation half-life.

## Applied to Project Sun

Adopt: fraction beside every rate; per-engine split first; published
definitions on every figure; a run is a point and history is a list of runs
with comparability stated per pair (cohort break made explicit, never a line
through it); prompt table with outcome per engine and the answer one click
away; domain and URL grain with ownership and a guessed kind; gap candidates
phrased at the answer level until a page fetch exists; issue anatomy with
counts, evidence and what the evidence does not show.

Avoid: composite scores and prominence weights; bands without thresholds;
one label with several denominators; benchmarks, volume, revenue or "buyer
attention" language; trend scaffolding from one snapshot; narrative slots
that can fail; win rates that hide undecided answers; verification claims
without a fetch; ranks that cannot be shown in the answer text.

## Velova HTML archive (added 2026-09-15, from `Velova/velova-html`)

The hydrated route captures add what the print PDFs hid: the model filter
offers five engines of which three have no data; Brands hides its honest
columns (Mentions, Prompts) behind `class="hidden"` while showing derived
percentages; Sources carries a banner "Sources currently support Latest and
specific dates only — the 30 days range falls back to lifetime data here";
every "Metric definition" button is an empty popover (definitions exist only
in the export PDF); there is no error-state copy anywhere, only skeletons; and
the GAP chip's tooltip is the one precise definition in the product: "GAP fires
only when a recent scan confirmed your brand is missing. UNCHECKED / Recheck
due / Could not scan render as their own muted chips so you can tell
unverified from confirmed-missing." Rank is derived two ways (first choice
says rank 1, the position score says rank 5 for the same answer), and channel
classification shifted between two renders on the same morning.

Applied to Project Sun: source-gap rows carry an explicit "page not checked"
chip until a persisted fetch exists; untracked brands named once are flagged
as such; the headline carries a same-run leader line ("Most named in this
run") instead of a category benchmark; definitions render in the product from
the policy module rather than living in an export; every state has copy.
