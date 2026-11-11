---
name: sun-measurement-change
description: Change how answers are analysed (mentions, roles, ranks, comparisons, sentiment, citations, eligibility) or how Measure metrics are computed and displayed, and investigate a Measure number that looks wrong. Use for any change in src/lib/analysis, src/lib/measure, src/lib/metrics or the measure page, and before bumping ANALYSIS_VERSION or METRIC_POLICY_VERSION.
---

# Changing analysis or Measure

The guardrails in `.claude/rules/analysis-measure.md` load automatically: honesty rules, version rules, pitfalls. This skill is the workflow. Hand-recompute numbers and read real answers. The counting bugs here (plural brand names, negation, weak-mention rules, emerging-brand noise) were found by reading output, not by tests.

## 1. Decide which layer the problem is in
| Question | Layer | Files |
|---|---|---|
| Did we interpret one answer wrongly (missed or false mention, wrong role, rank, comparison, sentiment, citation owner, eligibility)? | Analyzer (per answer) | `src/lib/analysis/*`, `analysis/service.ts` (entity inventory) |
| Are the per-answer facts right but the aggregate wrong (denominator, section filter, pooling, outcome, by-rival rows)? | Engine | `src/lib/measure/engine.ts`, `measure/service.ts` (planned set, analysis choice, frozen set) |
| Is the formula right but the explanation wrong or missing? | Policy text | `src/lib/measure/policy.ts` (`METRIC_DEFINITIONS`, rendered verbatim in the "?" drawer) |
| Is the number right but displayed wrongly (`—` vs 0, `x of n` below n=5, provisional state, engine tabs, hint copy)? | UI | `src/app/projects/[id]/measure/page.tsx` (frame, tabs, run picker) and `src/components/features/measure/*` (one file per view; `shared.tsx` holds figures and drawers) |
| Is a run-to-run change wrong, or shown when it should not be (break vs caution, points vs counts)? | Comparison | `src/lib/measure/compare.ts`; rules published in `COMPARABILITY_RULES` |
| Is History wrong (a finalised run recomputed, a snapshot missing, the wrong previous run)? | Snapshots | `src/lib/measure/snapshots.ts`, `src/lib/collection/finalise.ts` |
| Is a brand, source or opportunity row wrong? | Engine builders | `buildBrands`, `buildSources`, `buildOpportunities`, `buildPromptRows` in `engine.ts`; definitions in `policy.ts` (`BRAND_COLUMN_DEFINITIONS`, `SOURCE_DEFINITIONS`, `OPPORTUNITY_DEFINITIONS`) |
| Are the capture states wrong (truncated, sources `none_present` vs `not_captured`)? | Collection | `collection/orchestrator.ts` (see `sun-collection-lanes`) |

## 2. Trace a suspicious number back to answers
1. **Read the Measure JSON.** `GET /api/projects/<id>/measure[?run=…]` returns `{measure, run, snapshot, previous, …definitions}`. A finalised run is served from its snapshot; add nothing to the URL to see the live computation, re-finalise or re-analyse instead.
   - `measure.prompts`: one row per question × engine with every fact (named, rank, verdict, portrayal, sources, status).
   - `measure.lineage`: versions actually served, pinned competitive set, engines, observer countries, models.
   - `measure.coverage`: planned, captured, analysable, needsReview, byProvider, byEngine.
   - `measure.scopes.{discovery,tradeOffs,sentiment}.excluded`.
   - Per metric, `measure.metrics.<combined|chatgpt|gemini>.<metric_key>`: numerator, denominator, numeratorObservationIds, denominatorObservationIds.
   - For share of voice and citation share, the id arrays don't match the counts.
2. **Read the stored analyses.** For the observation ids involved, read `observation_analyses.payload` (SQL, read-only): occurrences (entity, role, confidence, span), comparisons, positions, sentiment, citations, warnings, eligibility. Also read `provider_responses.response_text` and its capture states.
3. **Re-run the analyzer in a pure probe.** Write a scratch script that imports `@/lib/analysis/analyzer`, build the entities by hand (target, confirmed competitors, aliases), and run `npx tsx --tsconfig ./tsconfig.json <script>` from the repo root. For engine questions, feed hand-built observations to `computeMeasure` from `@/lib/measure/engine`.
4. **Hand-check.** `SUN_DATA_DIR=<isolated> npx tsx scripts/measure-handcheck.ts <projectId> [runId]` recomputes the headline figures from the stored rows without the engine and must print `ALL AGREE`.
5. **Name the rule.** Identify the exact rule that produced the wrong fact before changing anything.

## 3. Make the change
- **Analyzer rules:**
  - Keep them general and English-rule-based: no LLM, no brand lists.
  - Keep spans exact.
  - Treat UNKNOWN or unclear as a valid outcome, not a zero.
  - Comment the real failure the rule addresses.
- **Engine rules:**
  - Preserve the honesty invariants: gaps leave both sides of the fraction; null, not 0; sections never blend; denominators stay frozen.
  - Every new rule gets an adversarial ("make the dashboard lie") test in `tests/unit/measure/adversarial.test.ts` and a known-arithmetic case in `engine.test.ts`.
- **Page copy:** the measure page repeats some counting rules in its hint text. Update that copy when semantics change.
- **Fixtures:**
  - Add new labelled cases to `tests/fixtures/analysis/gold-cases.ts`. Never tune against `holdout-cases.ts`.
  - Assume the code is wrong before the label. If a label is truly wrong, fix it with a `LABEL CORRECTED` note.
  - The harness doesn't assert eligibility, occurrence confidence, position bucket or aspect polarity. Add explicit assertions when those change.

## 4. Versions and re-analysis
- **`ANALYSIS_VERSION`** (`analysis/types.ts`): bump it whenever output for the same input changes. The rule file lists what counts, including `landscape/name-forms.ts`.
  - Without a bump, existing answers keep their old analysis.
  - With a bump, existing runs keep being served from older rows until re-analysed with `npx tsx scripts/reanalyse.ts <collectionRunId>`.
  - That command writes the DB (`./data` unless `SUN_DATA_DIR` is set), so **ask first** or use a copy. It also duplicates v1 `mentions`/`citations` rows on every run.
  - Afterwards, this must return 0:
    ```sql
    select count(*) from provider_responses pr
    join prompt_runs r on r.id = pr.prompt_run_id
    where r.collection_run_id = '<runId>'
      and not exists (select 1 from observation_analyses oa
                      where oa.provider_response_id = pr.id
                        and oa.analysis_version = '<new version>')
    ```
- **`METRIC_POLICY_VERSION`** (`measure/policy.ts`): bump it with any change to a numerator, denominator, unit, section, aggregation, brand/source/opportunity or comparability rule, including `AGGREGATABLE_CONFIDENCE`, which the engine reads live. Update the definitions in the same change. Live runs re-render instantly; finalised runs keep their snapshot at the old version (a break against new runs) until re-finalised. Say so in your report.
- **Re-analysis in the product:** Methodology shows "Re-analyse with current rules" whenever `lineage.staleAnalyses > 0`; it calls `POST /api/collection-runs/[id]/reanalyse` (additive rows, new snapshot for a finalised run). Prefer it over `scripts/reanalyse.ts`.

## 5. Prove it
1. **Run the tests:** `npx vitest run tests/unit/analysis tests/unit/measure tests/unit/metrics tests/unit/fixtures tests/integration/manual-observation.test.ts tests/integration/route-switch.test.ts tests/integration/measure-lineage.test.ts`.
2. **Check live output in an isolated app** (`sun-validate` §2), or seed one: `SUN_DATA_DIR=./data/verify-measure … npx tsx scripts/seed-measure-demo.ts` then the `sun-verify-measure` launch entry. Restart the server after re-seeding into a deleted directory (the SQLite handle is cached).
   - The seed gives three runs (two comparable, one break), both engines, wins/losses/absences, mixed and negative portrayal, owned and rival citations, four uncollected answers, one truncated answer and one awaiting analysis.
   - Compare the Measure JSON and the page against your hand computation.
   - Check that the "?" drawer text matches `METRIC_DEFINITIONS`.
3. **Compare a real run.** For an existing run (read-only, or on a DB copy), compare before/after numbers per metric and explain every change.
4. **Report:** before/after numbers, the answer text that justifies them, version bumps, and whether re-analysis ran.
