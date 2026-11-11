---
paths:
  - "src/lib/prompts/**"
  - "src/lib/landscape/name-forms.ts"
  - "src/lib/understanding/kinds.ts"
  - "src/lib/text/similarity.ts"
  - "src/app/projects/*/prompts/**"
  - "src/app/api/projects/*/prompts/**"
  - "src/app/api/prompt-sets/**"
  - "tests/unit/prompts/**"
  - "tests/integration/prompt-review-actions.test.ts"
  - "tests/integration/custom-prompts.test.ts"
  - "tests/benchmark/arbitrary-sites.test.ts"
  - "scripts/regenerate-prompts.ts"
  - "scripts/prompt-quality-compare.ts"
---

# Prompt Intelligence: guardrails

## How it flows
1. `POST …/prompts/generate` returns 202 and runs `generatePromptSet`. It reads the **latest** frozen competitive set plus the confirmed profile version pinned by that set. It is idempotent per competitive set; `?force=1` creates a new version.
2. It stores a context snapshot, then drafts prompts:
   - **Deterministic floor**, always: semantic concepts → `frame-planner.ts` → `realizer.ts` templates.
   - **With a model route** (`model-call.ts` over `lib/llm` stage `prompts`; paid OpenAI approved): the site-grounded intent model (planner: gpt-5.6-luna; `intent-model@5` binds every need to a confirmed topic by index and carries `primaryMarket`, "Worldwide" for a global business), then 3 section calls with one retry each (writer: gpt-5.6-terra, then luna, then Gemini) in `intent-generation.ts`. Discovery's slots, writer and judge live in `discovery.ts` (`discovery@3`). If that yields no drafts, `realizeWithProvider` rewords the planned frames instead. A shortfall retry re-runs only the short sections (`sections` option) and reuses the first pass's intent model, so a retry costs one writer call, not four.
3. Every draft passes `validateCandidate` (policy gate), then `validateNaturalQuery` (natural-language gate).
4. Survivors go through per-section anchor-aware dedupe and a 100-point score. Discovery survivors, model-written first and then templates up to 60 in all, are judged in one `judge`-stage call (gpt-5.6-luna; `discovery.ts` `judgeDiscoveryPrompts`), and the verdict replaces the heuristic score: 92 when every model check passes (a passing template keeps its heuristic score), 30 (below the floor) when any fails, stored in `qualityBreakdown` with `cappedReason` and `judgeGiveaway`. The judge's `websiteClaims` come from `siteClaimsFor`, which drops claims made of what the business sells or is (offerings, business type, industry path) and grounding notes about the site itself ("The website highlights burgers and desserts in its title" once failed every burger prompt for a burger restaurant as "asks for the website's own claim", and four template Discovery prompts were selected instead). Trade Off and Sentiment survivors (model and template alike, up to 60, model first) are judged in parallel by `section-judge.ts` (`judgeSectionPrompts`: reads real, a real question, not assembled, names the right brands): a failing prompt scores 30, a passing model prompt 90, a passing template keeps its heuristic score. Without a judge route the heuristic scores stand. A deterministic greedy selector then fills each section, provider drafts first and templates as fallback. A shortfall triggers up to 3 section-scoped retries. Status becomes `reviewing`.
5. The reviewer can edit, select, deselect, reject, replace, regenerate, or add their own prompt.
6. Approve re-validates against the frozen snapshot. Rows become `USER_APPROVED`; the set records `approvedAt`, `approvedBy` and a `frozenHash`.
7. Collection requires the project's **latest** prompt-set version to be approved. An older approved version is ignored, so `?force=1` blocks new collection runs until the new version is approved.

## Invariants
- **Exactly 30.** An approvable set is 10 Discovery + 10 Trade Offs + 10 Sentiment Analysis (`SECTION_SELECT_COUNT`).
  - Other copies to change together: the literal 30 and the "exactly 10 prompts in each section" copy on the prompts page, `collection/orchestrator.ts`, and the `>= 30` wait in `scripts/e2e-journey.ts`.
  - History: this replaced 21 Discovery / 4 Trade Offs / 5 Sentiment ("21/4/5"; `IMPLEMENTATION_STATUS.md` writes it "21/5/4" in cohort order). Stale titles remain.
- **Discovery** never names the target (brand, aliases, owned domains, branded offerings) or any confirmed competitor. A leak invalidates the measurement.
- **Trade Offs** bind one frozen non-marketplace rival, name it and the target, and carry an evaluation criterion. Rival eligibility here is `competitorType !== "marketplace"` (`intent-generation.ts`, `frame-generation.ts`), a copy of the landscape rule (see `.claude/rules/landscape.md`).
- **Sentiment Analysis** names the target with a theme and should name no competitor. Only frames and reviewer prompts enforce the no-competitor part today.
- **Every write path validates.**
  - Generate, PATCH edit, custom add/edit, regenerate and approve all call `validateCandidate` with context from the frozen snapshot plus the profile version.
  - Machine-written text must also pass `validateNaturalQuery`. PATCH edits of generated prompts skip that gate, but approval applies it to the edited text (only `generationSource: user` is exempt), so an accepted edit can still fail approval.
  - Approval is the real safety net; keep its re-validation.
- **Providers never break a generation.** Their output never bypasses the gates, and their failure never fails a generation: `generateStructured` never throws, and the deterministic floor always runs. Each model-written draft records `model:<provider>:<model>` in `contextBasis` and `generationSource: "model"` (`generationMethod: "model"`); rows written before 2026-09-16 say `gemini` whatever the model, so read provenance through `isModelSource()` / `generationMethodOf()` in `prompts/types.ts`, never by comparing the string.
- **Geography is profile-bound (`prompt-context@2`).** Places come from `promptGeographyFromProfile` and are frozen in the snapshot (`geography.places`, `placeBound`); generation, PATCH, regenerate and approval use `placesToLocations` of that list. Place-bound businesses get a place on every Discovery slot, chosen from the market area (`location.marketArea`): measured around an area (one storefront, or the operator chose a branch's area) the city leads, then that area, then nearby and other branch areas; measured across a city (a chain with branches across it, or the operator chose the city) the city takes three slots in four and the branch areas the fourth in turn, so no branch stands for the business; a chain of national or wider scope gets its venue cities (branches, and the cities its site lists as service areas when branches have no addresses) and their areas, one market country only when no city is known; never the other countries it has venues in; landmarks, streets, malls, hotels, office parks and address fragments are never handed out (`spokenPlace`); a place-bound business with a wider scope gets its venues in the market country (the storefront's area and city, branch areas and cities, never a head office and never venues abroad: REIF, with venues in Dubai and Cairo and scope international, once got "best kushiyaki restaurants in the UAE" and "in Egypt"); national scope for chains with only a head office gets the country on two slots in three, international one in three, global one in five. Countries are written the way people do ("the UAE", "the UK"). `geography_stacked` and `geography_too_broad` reject address-like strings and country-only local asks.
- **Choice unit from classification.** `choiceUnitForProfile` uses `classification.localCategory/businessType` and `kind`; `choiceUnitFor(archetype)` is only for profiles without classification.
- **What is measured, as far as possible, is decided in code.**
  - Frame path: the planner decides what is measured; templates or the realizer choose wording.
  - Intent path: the model proposes needs, situations, concerns and decision factors; code keeps only site-grounded, name-free items.
  - Discovery: `planDiscoverySlots` fixes each slot's need, shape (bare / context / situation-first), two styles, place and whether money may be mentioned (at most two slots, one cap, a price word for place-bound businesses). The writer phrases two versions per slot; code drops a version that loses the place, writes the place as an adjective ("a Dubai salon") or mentions money it was not given. The intent model's `distinctiveClaims` and the profile's `positioning.differentiators` are passed to the writer and judge as claims a Discovery prompt must not ask for.
  - Trade Offs: code resolves the rival against the frozen list and drops pairs outside the model's declared rival-needs.
  - Sentiment: the theme comes from the model's concern.
  - Website text is untrusted model input, and provider claims never pick the section.
- **No filler.**
  - An unrealizable frame is dropped.
  - Auto-selection needs a quality score ≥55.
  - A short section blocks approval instead of being padded.
- **Dedupe scope.** Dedupe runs per section. Near-duplicates (≥0.72, `text/similarity.ts`) are rejected only within the same context key, checked against anchors from earlier passes; retry passes once let exact duplicates into the final 30.
- **Never overwrite or delete.**
  - Approved sets are immutable; create a new version instead.
  - Rows are never deleted.
  - Gate and dedupe rejections store `rejectedReason` as `code: reason`; reviewer Reject and Replace store plain sentences.
- **General heuristics only.** No brand-specific rules. Exemplars come from other industries so the engine isn't tuned to benchmark brands.

## Pitfalls
- **The live AI path is untested in vitest.** Tests and the benchmark run keyless (`tests/setup.ts` deletes every provider key). Discovery slots, places, written-prompt parsing, verdict scoring and selection caps (`discovery-plan.test.ts`, `discovery-selection.test.ts`), `choiceUnitForProfile` and the geography validators have unit tests; model calls, the judge's own accuracy, rival-need filtering and Trade Off/Sentiment parsing do not.
- **The judge is a filter, not a ranker.** A holistic 1–5 naturalness rating passed nearly everything; Gemini 3.5 Flash-Lite passed 28 of 30 assembled prompts. Checks are yes/no with a giveaway quote, compared against `REFERENCE_PROMPTS` (other industries). Its boundaries matter both ways: an "assembled" definition with loose examples failed ordinary context ("for long road runs") on 30 of 35 candidates. Re-run the judge probe on saved candidates before changing `JUDGE_SYSTEM`.
- **Regenerate compares new wordings with other wordings, not the original.** A rewording is meant to resemble the prompt it rewords; counting the original rejected every rewording of a short Discovery search.
- **No price asks for premium or luxury businesses** (`classification.pricePositioning`); a blind review flagged "affordable brow shaping" for a luxury salon.
- **Real prompts often lack "?".** `inferRegister` reads a sentence opening with a question word as a question with or without the mark, and `validateCandidate` treats it as a query (57% of real recommendation prompts carry no closing punctuation). A declarative sentence still fails `schema_not_a_query`, and how-to / "what should I look for" asks still fail `TOO_GENERIC_FOR_DISCOVERY`.
- **Target short names are forbidden in Discovery.** The leakage lexicon adds the brand's `shortNameForms` (unless made only of its category words) and `brandCoreWord` ("Laurance" for "Laurance Hair & Beauty Salon" on laurancesalon.com), after a template alternative asked for "the laurance bridal brands".
- **Discovery selection caps** (`SECTION_KEY_CAPS`): two per opening, one each for "which/recommend/suggest/looking/help" first words, one money prompt, two nearby-area places, three situation-first, two story-style, four search-style, and two per need once there are five needs. Use `scripts/eval-onboarding.ts` on scratch dirs and the `sun-prompt-quality` skill.
- **Scores are not quality.** Malformed splices once scored 90+.
- **Coverage "cells" are vestigial.** In `coverage-policy.ts` they are only persisted and counted in events. `sentimentThemesFor`, `tradeOffCriteriaFor` and `COVERAGE_POLICY_VERSION` are live. `coverageCellKey` holds a frame id, `intent:<section>:<i>` or `user:…`.
- **Section vs cohort.** Section is the primary axis. Prompt code reads `section ?? sectionForCohort(cohort)`; `sectionForCohort` is private to `orchestrator.ts` and copied inline in the PATCH route and page. Analysis, Measure and the runner read `section` only.
- **Legacy geography.** For `prompt-context@1` snapshots (no `geography.places`), generation and PATCH still read the live `locations` table while approval and regenerate rebuild from the snapshot with regions labelled `country`.
- **Rival ranking is duplicated.**
  - Weights differ in `frame-generation.ts` `plannerCompetitors` (confidence +20 for direct), `intent-generation.ts` `competitorsFor` (+8, name tie-break) and `coverage-policy.ts` (+8, no cap).
  - The 5-rival cap `MAX_TRADE_OFF_RIVALS` is defined twice, in `frame-planner.ts` and `intent-generation.ts`.
- **Stuck generation.** An exception after the set row is created, or a restart, leaves the set `generating`; only a direct `?force=1` recovers, and no UI sends it. Background errors go to `policy.status`, which the page ignores.
- **English only.** Gates, templates and model instructions are English.
- **Brand matching.** `TARGET_REQUIRED` accepts the canonical brand name or its `shortNameForms` (the spoken name the writer uses). Multi-word forbidden terms match as raw substrings.
- **SQL case.** `prompt_candidates.lifecycle_state` is UPPERCASE (`SELECTED`, `USER_APPROVED`). `prompt_sets.status` and `prompt_runs.state` are lowercase.

## Validate
- `npx vitest run tests/unit/prompts tests/integration/prompt-review-actions.test.ts tests/integration/custom-prompts.test.ts tests/integration/manual-observation.test.ts tests/integration/route-switch.test.ts`. `tests/setup.ts` removes every provider key.
- `npx vitest run tests/benchmark/arbitrary-sites.test.ts` runs 13 synthetic business cases (11 archetypes) plus a pool check, all keyless. It rewrites `BENCHMARK_REPORT.md`, whose footer is hard-coded.
- Then regenerate on real projects and read all 30 prompts plus the alternatives (`sun-prompt-quality` skill).
