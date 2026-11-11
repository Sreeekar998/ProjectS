# Measure: product, UX and data-quality audit

**Date:** 2026-11-09.
**Scope:** what happens after collection — how answers are interpreted, counted and presented. The collection pipeline (Oxylabs and the other providers, the runner, `provider_responses`) was not touched.
**Versions shipped:**
- `observation-analysis@18` (interpretation);
- `measure-policy@4` (calculation and findings).

**How it was checked:**
- Six real runs from a copy of `data/sun.db`, in an isolated app on :3107: two DIFC salons, a Pilates studio, a Dubai gym, a Bengaluru restaurant and a global CRM. The live database was not written.
- The full unit, integration and security suites, which pass.
- `scripts/measure-handcheck.ts`, which prints ALL AGREE on four of those runs. It recomputes the figures independently of the engine.
- Every view at desktop and 375 px width.

---

## 1. The Measure section as it was

One route, `/projects/[id]/measure`, with six tabs: Overview, Questions, Brands, Sources, Opportunities and Report. A hidden Answers view held the full text of every answer.

| View | What it showed |
|---|---|
| **Overview** (11 blocks) | Four tiles: "Named unprompted", "Share of every business named", "Head-to-head", "Reputation". Then "In short" (three sentences), "Who ChatGPT names", "Where the answers come from", "By place", "By topic", per-engine bars, an every-answer grid, "What changed", "What the figures rest on" and "Top findings". |
| **Questions** | Section switch; section panels (Discovery: named / ranked first / "answers naming no tracked brand", plus a tracked-only ranking with share-of-voice %); filters; one row per question × engine. |
| **Brands** | A bar list of tracked brands, a tracked-only share-of-voice bar, a table of tracked brands (named, share of voice, ranked first, average rank, head-to-head, own site cited) and, at the bottom, a list of untracked names. |
| **Sources** | Three citation rates, a five-number "what was counted" panel, a "by whose site" bar, a by-kind bar list, a site table, a page list and a separate "sites shaping answers you are missing from" list. |
| **Opportunities** | Up to eight finding types, one card per topic and per rival, a share bar summing their counts, and "what this is and isn't evidence of". |
| **Report** | All of the above as a printable document, with every definition. |

What was already right, and kept:
- every figure is `x of n` and opens the answers behind it;
- a gap is never counted as absence;
- sections never blend;
- the competitive set is frozen and runs are snapshotted;
- comparability breaks are explicit;
- there are no composite scores or estimated volumes.

The research below shows these are stronger than most of the market.

## 2. Issues found, and why they matter

### A. Interpretation errors that changed the numbers (most important)

1. **The analysis could not read ChatGPT's current list format.**
   - Since October 2026, ChatGPT on the web lists options as a numbered name alone, on a line or as a heading, with the area and rating below (`## 1. ELAN Lash & Brow Beauty Lounge` / `DIFC · Index Tower` / `4.9/5 · 1,272 reviews`).
   - The parser knew only bullets with bold labels and map entries. "best lash extension salons in Dubai" listed six ranked salons and was recorded as naming no business.
   - Across the latest salon run, the answers named 35 businesses; the analysis saw 7.
   - Consequences:
     - the headline **"Share of every business named" read 2 of 10 (20%) when the truth was 2 of 43 (≈5%)**;
     - "answers naming no tracked brand" read 5 of 10 when no answer lacked a business;
     - the every-answer grid showed grey "no brand" cells for answers listing six rivals.
2. **Ranks rested on almost nothing.** Rank eligibility counted only tracked brands, so a numbered list of untracked salons was "no options". "Ranked first" had a denominator of 0–1 in every project, and the #1 pick of a list was never recorded.
3. **The brand's own slot in a list read as a bare mention.** In "top picks… 4. Atelier 10", the salon was MENTION_ONLY while every rival around it was "recommended".
4. **Reputation misreads.** The only negative readings for the salon were answers that reported finding no complaints:
   - "I couldn't find a clearly documented public complaint…";
   - "…wouldn't interpret the lack of complaints as proof…";
   - a restated search ("to see whether anyone has reported safety problems…").

   They created a "Reputation concerns" finding from nothing. An older rule also dropped praise followed by "if you like…" as an "offer to search".

### B. Calculation and definition problems

5. **"Answers naming no tracked brand"** counted an answer listing six *untracked* salons as brand-free, and the Questions filter "No brand named" used the same rule.
6. **One business counted twice.** Untracked names were keyed by exact spelling, so "ALKEMY Salons" and "Alkemy Salons", or "It's Beauty" and "Its Beauty", were two businesses.
7. **Two "leaders" for the same answers.**
   - Topic leaders counted tracked brands only.
   - Place leaders counted every business.
8. **Findings padded and double-counted.**
   - Restatements:
     - "Rival sites cited" and "Your site not cited" restated Sources figures;
     - "missing from discovery" was split into one card per topic, three cards of "1 of 2" on ten questions.
   - Bad sums: the tab summed finding counts of different units (answers and brands) into "N findings from M answers".
9. **"By whose site it is"** summed answers per site, so one answer citing three directories counted three times. Its "89%" had no denominator a reader could check.
10. **Percentages on single answers.** Topic and place bars printed "1 of 1 100%" and "1 of 2 50%", against the product's own rule of no percentage below five answers.

### C. Information architecture and UX

11. **Every figure said twice.** "In short" repeated the four tiles in sentences directly below them.
12. **Three leaderboards with three denominators.**
    - Overview: every business.
    - Questions: tracked brands with a share-of-voice %.
    - Brands: tracked brands, with the share bar reading "Not comparable" whenever no tracked rival was named.

    In the real runs, 2 of 6 tracked rivals were named while 35 businesses appeared.
13. **Redundant citation figures.**
    - "Owned citation rate" and "…when sources were shown" are identical whenever every answer shows sources, which is every ChatGPT-on-the-web answer.
    - "Share of tracked-brand links" is near-meaningless for local businesses.
14. **Opportunities as a separate tab** read as a second dashboard. Every card restated a number shown elsewhere.
15. **Reputation read against every answer.** "2 of 10 positive" when 7 answers stated facts and 1 was negative made a well-regarded business look disliked.
16. **Hidden outcomes and broken labels.**
    - The head-to-head tile omitted "didn't compare".
    - "Who ChatGPT names" was hard-coded to ChatGPT.
    - The summary said "The concerns were about overall."
17. **No sense of precision.** One answer moves a ten-question section by ten points, yet "20%" stood alone, and the sampling label "Directional baseline" overstated a single sample of 30 questions.

## 3. What the market does (research summary)

Sources: public docs and help centres, read on 2026-11-09, plus the team's September captures in `Sun Project/`. Full notes with 46 sources came from a research agent. The key references:
- IAB, *Measuring Visibility in the AI Era* (Aug 2026);
- Profound docs: [metrics](https://docs.tryprofound.com/cookbook/metrics/how-metrics-are-calculated), [why past numbers change](https://docs.tryprofound.com/cookbook/metrics/why-past-numbers-change);
- [Peec AI](https://peec.ai/ai-instructions) and its [changelog](https://peec.ai/changelog);
- [AthenaHQ Olympus](https://docs.athenahq.ai/guides/olympus);
- [Evertune methodology](https://www.evertune.ai/platform/methodology);
- [Rankscale metrics](https://help.rankscale.ai/articles/1188645477-metrics-in-rankscale);
- [Momentic](https://momenticmarketing.com/blog/ai-search-questions);
- SparkToro/Gumshoe via [SEJ](https://www.searchenginejournal.com/ai-recommendations-change-with-nearly-every-query-sparktoro/566242/).

**Table stakes everyone shows:**
- mention rate (visibility);
- share of voice;
- average position;
- sentiment;
- cited domains and URLs with an "owned" flag;
- a competitor leaderboard;
- per-engine splits;
- trends;
- a prompt table that opens the answer.

**What differs:** the same label hides different maths.
- Profound drops answers naming no brand from visibility; Peec keeps them.
- Peec counts every mention per answer; Profound counts once.
- Ahrefs weights share of voice by modelled search volume.

So numbers from different vendors are not comparable.

**Adopted:**
- **Report a range with each rate.**
  - The IAB asks for "approximately 22%, plus or minus 4 points" and calls fewer than 50 queries "exploratory".
  - Evertune puts a ten-prompt topic asked once at ±31 points.
  - Momentic gives ±15 at ten prompts.
  - → A plausible range on every headline rate, "within range" on small changes, and the posture relabelled "Exploratory baseline".
- **One label, one denominator** (Profound and Writesonic contradict themselves) → tracked-only share of voice leaves the workspace, and one "Share of voice" remains.
- **A prompt × engine outcome grid** (Scrunch) → kept, moved to Questions.
- **Every gap visible with its own status** (Knowatoa NR/NA, Peec's grey no-run days) → already ours, kept.
- **Count each answer once by what it cited** → the answer-level source mix.

**Avoided:**
- composite scores, which Rankscale's own glossary says "hide the diagnosis";
- a headline "ranking position": SparkToro found repeated prompts returned the same list under 1% of the time;
- a 0–100 sentiment score;
- estimated impressions or dollar values;
- qualitative bands on tiny samples;
- "category" benchmarks taken from the same run;
- relabelling history (Profound's "reports reflect the current configuration only").

**Where Project Sun is ahead:**
- gaps are never absence;
- a frozen set with explicit comparability breaks;
- Discovery keeps brand-free answers in the denominator;
- branded prompts are kept out of visibility;
- decisiveness plus win rate (no vendor publishes an equivalent);
- consumer-web collection: API answers share only 12% of cited domains with the website.

**Where it is behind:**
- one sample of ten questions per section;
- competitors ask each prompt daily, across engines and markets.

This is a methodology limit (§7), not something a dashboard can fix.

## 4. Recommended information architecture (implemented)

Four views and a report, ordered by the questions a marketing lead asks:

| View | Answers | Contents |
|---|---|---|
| **Overview** | How visible am I, who is recommended instead, what needs attention, what changed? | **Headline:** four tiles — Visibility, Share of voice, Head-to-head, Reputation — each with its fraction, a plausible range and its change. **Comparison:** who the engine names (every business) beside where you are missing (topics and places). **What needs attention:** the findings. **Context:** where the answers come from (each answer once); what changed and what the figures rest on. |
| **Competitors** (`?view=brands`) | Who else is named, and how do I compare? | One table of every business named, tracked or not: named in discovery, share of voice, ranked first, average position, head-to-head and own site cited. Rows for tracked rivals that were never named. |
| **Questions** (`?view=performance`) | Which questions did I win, lose or miss? | The every-answer grid, each section's figures, and the question table with fixed filters. |
| **Sources** | Whose sites shape the answers, and is mine one of them? | Your site cited, the answer-level mix, kinds by answers, and one site table with a "cited when you were left out" filter. Pages sit behind a disclosure. A "possibly yours" hint for unrecorded own domains. |
| **Report** | Can I hand this on? | The same figures as one printable document, plus every definition the workspace uses. |

Old `?view=opportunities` links open the Overview at its findings.

## 5. Metrics: kept, changed, removed, added

| Metric | Decision | Why |
|---|---|---|
| Visibility (`discovery_visibility`) | **Kept**, renamed from "Named unprompted" | The market's core metric. The definition is unchanged: presence in Discovery answers, gaps excluded. |
| Share of voice (`discovery_share_all_names`) | **Kept as the only share**, renamed from "Share of every business named" | It answers "how much of the answer was me". Now correct after @18. It is labelled as dependent on detection. |
| Share among tracked brands (`discovery_share_of_voice`) | **Removed from the workspace**, kept in exports | It reads 100% by construction whenever no tracked rival is named, which happened in most real runs. |
| Ranked first (`first_choice_rate`) | **Kept**, now meaningful | Its denominator went from 0–1 to 8–10 answers on the salon runs. |
| Average position (brand rows) | **Kept, extended to untracked businesses** | Untracked options on numbered lists now hold their numbers. |
| No business named (`answer_brand_free_rate`) | **Redefined** | It now means no business at all, tracked or untracked. Shown quietly in Questions as context, not as a result. |
| Gave a verdict / Won when decided | **Kept** | Unique, and keeps undecided answers visible. The tile now also shows "didn't compare". |
| Reputation distribution | **Kept, read among opinions** | "2 of 3 opinions positive; 7 stated facts". Never a 0–100 score. |
| Your site cited (`owned_citation_rate`) | **Kept**; the "when sources were shown" variant appears only when it differs | Removes a duplicate number. |
| Share of tracked-brand links (`citation_share`) | **Removed from the workspace**, kept in exports | URL-volume share among tracked brands; near-meaningless for local businesses. |
| Answer-level source mix | **Added** | Each answer once: yours / a tracked rival's / third-party only / none. Replaces a bar that summed answers per site. |
| Plausible range (Wilson 95%) | **Added** to every headline rate with five or more answers | IAB guidance. Computed from the same counts, so it needs no new data. Changes inside the range are shown neutral. |
| Findings | **Consolidated** | One "left out of recommendations" finding (with the businesses named instead) and one "head-to-heads lost" (by rival, with aspects). "Rival sites cited" and "your site not cited" retired. Quotes must be sentences, not names. |

No metric was added without a defined calculation; each is in `METRIC_DEFINITIONS` / `SOURCE_DEFINITIONS` and the "?" drawers.

## 6. Changes implemented

**Interpretation (`observation-analysis@18`)**
- **Numbered option lines** — `src/lib/analysis/mentions.ts`:
  - `numberedName` reads numbered lines and headings that carry only a name. It requires a listing cue below (rating, phone, "Area · kind", website link) so advice lists stay out.
  - Branch suffixes and a leading "The" are handled.
  - A shorter reference folds into its listed name ("UB Grooming" → "UB Grooming Salon").
  - "&"/"and" spellings of a tracked name link to it.
- **List structure** — `discourse.ts`: numbered headings are list items.
- **Roles and ranks:**
  - `analyzer.ts`: a tracked name inside an option label is RECOMMENDED. Rank eligibility counts untracked options, and untracked options on numbered lines hold their rank.
  - `position.ts`: numbering ranks only when the options are what is numbered.
- **Sentiment** — `sentiment.ts`: "no complaint found", "lack of complaints" and a restated search are not opinions; "if you like…" is an offer only when an offer follows.

**Calculation (`measure-policy@4`)** — `src/lib/measure/engine.ts`, `policy.ts`, `compare.ts`, the new `precision.ts`:
- **Counting:**
  - `businessKey`: one business however spelled;
  - "no business named" redefined;
  - topic leaders count every business, with counts.
- **Output:**
  - consolidated findings;
  - the answer-level source mix;
  - untracked ranks in brand rows;
  - the "within range" flag on changes.
- **Wording:**
  - the reputation summary;
  - the "Exploratory baseline" label;
  - definitions rewritten to match.

**Presentation:**
- **Views:**
  - `overview-view.tsx` and `brands-view.tsx` (Competitors) rewritten; Overview loses "In short" and the misleading percentages;
  - `sources-view.tsx` simplified;
  - `performance-view.tsx`: the every-answer grid moved in, filters fixed, the tracked-only ranking removed;
  - new `findings.tsx`; `opportunities-view.tsx` retired;
  - `report-view.tsx` updated to the same metric set;
  - page tabs reduced to five.
- **Shared:**
  - `charts.tsx`: no percentage below five answers;
  - `shared.tsx`: range note, neutral "within range" changes, theme labels.

**Tests (all pass: 115 files, 1,183 tests):**
- `tests/unit/analysis/option-labels.test.ts`: six @18 cases from real answers;
- `no-complaint-found.test.ts`;
- `tests/unit/measure/precision.test.ts`: worked Wilson values;
- `workspace.test.ts`: policy@4 arithmetic;
- `adversarial.test.ts`: six untracked salons are not "no business";
- `summary.test.ts`: reputation wording.

One gold label was corrected, with a `LABEL CORRECTED` note: two options with no order is `not_rankable`.

**Verification on real data** (isolated copy; live DB untouched):
- **Analyzer sweep, 390 consumer-web answers:**
  - Discovery businesses detected rose from 468 to 598 (+28%);
  - rank-eligible Discovery answers rose from 7 to 28 of 130;
  - **no head-to-head verdict, target presence or eligibility changed**;
  - every added name was a real business.
- **Sentiment sweep, 130 by-name answers:** 7 false negatives removed and 2 dropped positives restored, each read by hand; no correct reading lost.
- **Hand-check:** `measure-handcheck.ts` printed ALL AGREE on four runs (two salons, a Pilates studio, a CRM).

**Before → after on six real runs:**

| Business | Visibility | Share of voice (every business) | Businesses named | No business named | Ranked first | Negative / mixed | Findings |
|---|---|---|---|---|---|---|---|
| Atelier 10 (Oct run) | 2/10 → 2/10 | **2/10 → 2/43** | 7 → 35 | 5/10 → 0/10 | 0/1 → 0/10 | 1/0 → 0/0 | 7 → 3 |
| Atelier 10 (Oct, other project) | 3/10 → 3/10 | **3/11 → 3/36** | 9 → 32 | 6/10 → 1/10 | 0/0 → 1/8 | 2/1 → 0/0 | 10 → 4 |
| Studio14 (Pilates) | 7/10 → 7/10 | — → 7/43 | 20 → 24 | 2/10 → 0/10 | 0/1 → 0/0 | 0/1 → 0/1 | 6 → 5 |
| The Warehouse Gym | 3/10 → 3/10 | — → 3/47 | 17 → 43 | 7/10 → 0/10 | 0/0 → 0/0 | 1/0 → 1/0 | 6 → 5 |
| Truffles (restaurant) | 3/10 → 3/10 | — → 3/46 | 43 → 36 | 7/10 → 0/10 | 0/0 → 0/0 | 0/0 → 0/0 | 6 → 4 |
| Pipedrive (CRM) | 7/10 → 7/10 | — → 7/45 | 11 → 21 | 3/10 → 0/10 | 0/1 → 0/2 | 1/2 → 1/2 | 6 → 5 |

"—": the stored snapshot predates the metric.

Notes on the table:
- **Truffles:** its business count fell because older analysis versions counted places and adjectives ("Indiranagar", "Good").
- **Remaining negatives:** the gym's is real ("I found some public complaints involving children/supervision…").

**Documentation updated:**
- `.claude/rules/analysis-measure.md`;
- `docs/MEASURE_WORKSPACE_DESIGN.md` (revision section);
- `docs/KNOWN_ISSUES.md` (three entries);
- `CLAUDE.md` (the Measure line);
- `scripts/measure-handcheck.ts` (new definitions plus an independent share check).

**What you need to do to see it on your data:**
- **Re-analyse each project.** Existing runs keep serving their old snapshots by design. Each Measure page shows "N answers were read with older rules → Update results". Clicking it re-analyses that run (additive rows; the answers are untouched) and re-snapshots it at @18 / policy@4.
- **Expect a comparability break.** Runs at different versions are, correctly, a break against each other until both are updated.
- **Restart the server.** The :3000 server was not running when I checked. `npm run dev` picks up the changes.

## 7. Remaining limitations and recommendations

**Limits of this work**
- **Untracked-name noise remains.** A place ("Trade Centre"), a haircut style ("Fade") and face shapes ("Oval", "Round") still appear as businesses in salon runs. Share of voice and the Competitors table inherit this; their definitions say so. A brand-level fix needs better place and category knowledge, not more regex.
- **Borderline readings.** Two that were not changed:
  - Pipedrive's "If you mean people importing old deals… the common problems are…" still reads negative;
  - Studio14's one rank-eligible answer under @12 is not rank-eligible under @18; I did not trace why.
- **Not every sentence was read.** I read 4 of the 18 negative or mixed readings that remain across the 130 by-name answers (the gym's and Pipedrive's); the other 14 are unreviewed.
- **Own-domain gaps.** atelier10salon.ae, cited in 16 answers, is not recorded as the salon's site. Measure now flags it as "possibly yours", but the figures change only once it is added under Understand.
- **Not run:** the Playwright e2e and benchmark suites (they make real model calls or overwrite reports), and an isolated `npm run build`. The typecheck, lint (0 errors) and all other suites pass.

**Recommended next steps, in order**
1. **Re-analyse every live project** with "Update results", so the dashboard stops showing @10–@17 numbers.
2. **Fix the method, not the dashboard.** The largest remaining weakness is sample size, so:
   - raise Discovery to 20–30 questions, as Peec and Momentic advise ("add prompts before adding runs");
   - then re-ask the Discovery set 3 times once, to measure run-to-run variation and calibrate "within range". The IAB requires this before calling a change real.
3. **Use the answers to improve Landscape.** Feed "businesses the engine names most" back into competitor discovery. In most real runs the tracked set missed the businesses ChatGPT actually recommends.
4. **Make the Questions view easier to scan.** Add per-question consistency across comparable runs ("named in 2 of 3 runs") in place of single-run outcomes once there are three or more runs.
5. **Show which cited sources lead to being named.** Add a cited-versus-named view (Profound's "Cited, not visible" quadrant) using the answer-level mix already computed.
6. **Reduce untracked-name noise with project knowledge.** Use the project's own place list and the map/listing structure more strictly, measured with the existing sweep probe before and after.
