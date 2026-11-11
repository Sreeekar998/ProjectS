---
name: sun-prompt-quality
description: Diagnose and improve the 30-prompt measurement set, whether prompts sound unnatural or template-like, duplicate each other, leak the brand, give weak Trade Offs or Sentiment prompts, leave sections short, fail approval, or break review actions. Use for any change to prompt generation, validation, dedupe, scoring or selection under src/lib/prompts, and whenever someone asks whether the prompts are good.
---

# Improving the prompt set

The guardrails in `.claude/rules/prompts.md` load automatically; this skill is the working loop. The bar: would a normal customer actually type this into ChatGPT or Gemini, and would the answer name brands? Validators and quality scores can't answer that. Only reading the prompts can.

## 1. Reproduce on real projects, with the key the user has
- **Isolated app with a confirmed landscape.** Use a real project in the isolated app (`sun-validate` §2). With a model key present, the live path is the intent model plus `discovery.ts` (writer and judge), which has **no** automated coverage of model output: tests and the benchmark are keyless; only the pure Discovery planning, parsing, scoring and caps are unit-tested.
- **Several archetypes.** Cover at least 2–3 unrelated businesses (e.g. a local service, an ecommerce brand, a B2B SaaS); the engine must stay general.
- **Record the current output before changing code.**
  - `SUN_BASE=http://localhost:3100 npx tsx scripts/regenerate-prompts.ts <projectId>`: forces a new prompt-set version, waits, and prints the selected prompts by section, the generation stats, and rejection-code counts for Gemini drafts.
    - Caveat: the new version becomes the project's latest and is unapproved, so collection for that project is blocked until it is approved.
    - Caveat: reviewer Reject/Replace reasons are sentences, not `code: reason`, so its reason counts can mislead.
  - `SUN_DATA_DIR=./data/verify npx tsx scripts/prompt-quality-compare.ts <projectId> [reference.md]`: prints shape metrics (context, first person, generic templates, opening diversity, register mix). Always set `SUN_DATA_DIR`: the script opens that DB read-write, applies pending migrations, and defaults to the user's `./data/sun.db`.
  - Or read `GET /api/projects/<id>/prompts` directly.
- **Watch the cost.** Each keyed generation makes about 4+ Gemini calls, and more on retries or when the intent model fails. Don't loop blindly on the free quota.

## 2. Read the evidence
- **`promptSet.generationStats`:**
  - `providerDrafts` vs `deterministicDrafts`;
  - `intentNeeds`, `intentFailedSections`, `retryCount`, `duplicates`, `framesDiscarded`;
  - `aiCallCount` counts the first pass only.
- **Candidates:**
  - `lifecycleState` (UPPERCASE) and `section`;
  - `generationSource` (`gemini`, `template`, `user`);
  - `contextBasis`, `qualityScore`, `qualityBreakdown.cappedReason`;
  - `rejectedReason`: `code: reason` for gates and dedupe, sentences for reviewer actions;
  - `selectionReason`.
- **Events:**
  - `prompt.context.ready` (the second one carries the intent model);
  - `prompt.generation.section_failed`;
  - `policy.status` (background errors; the page never shows them);
  - `prompt_set.ready` (shortfalls).
- **Read all 30 selected prompts plus the alternatives.**
  - Is each natural and specific to a customer situation?
  - Discovery: no brand and no confirmed competitor.
  - Trade Offs: a confirmed rival, the target, and a real decision factor.
  - Sentiment Analysis: the brand and no rival.
  - No duplicate or near-duplicate wording.
  - Do the market and language fit?

## 3. Localize the failure
| Symptom | Look first at |
|---|---|
| Template prompts ungrammatical or spliced ("a reliable running") | `semantic-concepts.ts` (concept typing, head nouns), renderers in `realizer.ts`, slot rules in `query-frames.ts` |
| AI prompts generic, off-site or templated | `intent-model.ts` (site vocabulary from evidence, grounding filter, name exclusion, `distinctiveClaims`); Discovery: `discovery.ts` (`DISCOVERY_STYLE` register evidence, slot shapes and styles, places, the judge's checks and `REFERENCE_PROMPTS`); Trade Offs/Sentiment: `intent-generation.ts` (STYLE guide, rival–need pairing); the fallback `realizeWithProvider` when the intent path yielded nothing |
| Discovery prompt passed the gates but reads assembled, or a good one was not selected | `qualityBreakdown.cappedReason` and `judgeGiveaway` on the row; `discoveryVerdictScore`; `SECTION_KEY_CAPS` in `selector.ts` |
| A leaking prompt was selected (brand, nickname or rival in Discovery) | `validators.ts`: `buildTargetLeakageLexicon` (brand, plural, profile aliases, domains, proprietary offerings; **no** short name forms for the target), `buildCompetitorForbiddenTerms` (uses `name-forms.ts`), `scanForBrandLeakage`. Approval re-validates with the same lexicons. A nickname must exist as a profile alias to be caught |
| A good prompt rejected | The rejection code: `validators.ts` (policy: leakage, binding, geography, near-me, leading, multi-intent, time words, regulated advice) or `natural-validator.ts` (English naturalness heuristics; register is inferred from the text) |
| A bad prompt selected | `scoring.ts` (rubric, caps, 55 floor), `selector.ts` (0.55 quality / 0.30 coverage / 0.15 diversity; register, category and competitor caps; provider-first phase) |
| Duplicates in the final 30 | `dedupe.ts` (per section, `contextKey`, anchors; rows processed in DB order, so templates win ties), `text/similarity.ts` |
| Section ends at 8 or 9 of 10 | Frames discarded, gate rejections, the per-competitor cap (never relaxed; uneven rival pools come up short), keyless retries that only reproduce duplicates |
| Approval returns 409 | Approval re-runs both gates against the frozen snapshot. Common causes: region geography (the snapshot flattens it to `country`); an edited generated prompt that skipped the natural-language gate at PATCH time |
| A review action misbehaves | `updatePromptSelection`, `regeneratePromptCandidate`, `addCustomPrompt` in `orchestrator.ts`; the PATCH handler in `api/prompt-sets/[id]/route.ts` |

To probe pure functions without the DB, write a scratch script that imports `@/lib/prompts/{frame-generation,realizer,natural-validator,validators,scoring,selector}` and run `env -u GEMINI_API_KEY npx tsx --tsconfig ./tsconfig.json <script>`.

## 4. Change rules the general way
- **Fix root causes in the architecture** (planning, concept typing, gates), not individual sentences.
- **Never tune to a benchmark brand.** Take exemplars from other industries, and comment the real failure behind each rule.
- **Keep provenance and gate order in code.** A model can propose needs and factors, but code resolves rivals against the frozen set and validates everything.
- **Update every copy when counts or caps change:**
  - `SECTION_SELECT_COUNT`;
  - the literal 30 and the "exactly 10 prompts in each section" copy on the prompts page;
  - `collection/orchestrator.ts`;
  - the `>= 30` wait in `scripts/e2e-journey.ts`;
  - the rival cap and ranking copies.
  Bump `COVERAGE_POLICY_VERSION` if the selection policy changes.

## 5. Prove it
1. **Tests.** Run the suites in the rule file, then `npx vitest run tests/benchmark/arbitrary-sites.test.ts`. Compare the non-timing columns of `BENCHMARK_REPORT.md` (its footer text is hard-coded).
2. **Regenerate and diff.** Regenerate on the same real projects (`scripts/regenerate-prompts.ts` or `POST /api/projects/<id>/prompts/generate?force=1`) and diff the 30 prompts, section by section, against your saved output.
3. **Review actions.** **Before** approving, try one Regenerate, one Replace and one custom prompt; after approval these controls are hidden and the API returns 409. Then approve the new set, or explain why it can't be approved.
4. **Report.** Show the actual before/after prompt text, rejection counts by code, and anything still weak. Scores alone are not evidence.
