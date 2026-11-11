---
name: sun-profile-quality
description: Diagnose and improve what the Understand stage infers about a website (crawl coverage, evidence, Brand Profile fields and confidence). Use when a profile field is wrong or missing for a real site, a crawl is blocked, thin or slow, or when changing crawler, evidence or profile-resolver logic under src/lib/crawler, src/lib/evidence or src/lib/profile.
---

# Improving Brand Profile quality

The guardrails in `.claude/rules/website-intelligence.md` load automatically when you touch these files; this skill is the investigation workflow. Aim for a fix that generalises, not a patch for one site.

## 1. Reproduce on an isolated app
- **Start an isolated app** as in `sun-validate` §2 (scratch data dir, port 3100). Keep the Gemini key to reproduce what the user sees, or blank `GEMINI_API_KEY=` to study the deterministic baseline.
- **Create a profile without confirming anything:**
  ```bash
  curl -s -X POST localhost:3100/api/projects -H 'content-type: application/json' -d '{"url":"https://site/"}'
  curl -s -X POST localhost:3100/api/projects/<id>/crawl
  ```
  Then poll `GET /api/projects/<id>/profile` until `profileVersion.status` is `complete` or `failed`. The UI route `/trial/new?url=…` also works.
  - Don't use `scripts/e2e-journey.ts` here: right after printing the profile it confirms it and starts landscape discovery.
  - Confirming creates topics and the target entity from that profile, once per project. Later profile fixes won't show up in them.
- **Save the "before" state** outside the repo: `curl -s localhost:3100/api/projects/<id>/profile > <scratch>/profile-before-<id>.json`.

## 2. Collect the facts
- **Events:** `GET /api/projects/<id>/events?since=0&stream=false`.
  - Normal order: `profile.synthesis.started` → `crawl.started` → `crawl.page.discovered` → `crawl.sitemap.discovered` → `crawl.page.selected/classified/skipped` → `crawl.evidence.extracted` → `profile.field.updated`… → `crawl.completed` → `profile.ready`.
  - Handled failures end with `crawl.blocked`/`crawl.failed` + `profile.failed`. Pages fetched with no evidence end with `crawl.completed` then `profile.failed` (`no_evidence`).
  - Unhandled exceptions emit only `profile.failed` (stage `pipeline`).
  - Skipped pages carry fetch error codes.
- **Profile:** `GET /api/projects/<id>/profile` returns `{profileVersion}` with `status`, `version`, `synthesisMode`, `fieldProvenance`, `userEditedFields` and `profile` (warnings at `profile.quality.warnings`). Resolve cited ids with `GET /api/projects/<id>/evidence?ids=a,b`.
- **SQL (read-only):**
  - `crawl_runs.metrics`: urlsAdmitted, pagesFetched, pagesSelected, trapsRejected, bySlot, browserFallbacks.
  - `crawl_pages`: one row per attempted URL, with `page_type`, `slot_key`, `family_key`, `is_selected`, `selected_reason`, `score_breakdown`, `fetch_method`.
  - `evidence_items` grouped by `field_hint` for the run.

## 3. Localize the failure
| Symptom | Look first at |
|---|---|
| Important pages never fetched, or wrong pages fetched | `crawl-planner.ts` (scores, slot min/max, URL-family quotas; a big sitemap can fill the 400-URL frontier before nav links), `url-canonical.ts` (traps, off-site subdomains, locale seeds), `robots.ts`, `config.ts` |
| Fetched but skipped or unselected | fetch error codes in `fetcher.ts`, the selection rule and duplicate check in `crawler/orchestrator.ts`, `text/similarity.ts` |
| Content missing (JS-rendered site) | `extractor.ts` `essentialContentMissing`, `playwright-fallback.ts` (enabled? Chromium installed? `maxBrowserFallbacks`) |
| Evidence exists but the field is wrong | the resolver: `identity-resolver.ts` (brand), `offering-resolver.ts`, `market-resolver.ts` (markets and scope; note that `html lang`/`og:locale` region subtags become countries), `industry-classifier.ts` + `taxonomy.ts` (industry, archetype), `identity-traits.ts` (identity, audience), `deterministic-extractor.ts` (jobs, constraints, regulated domain), `description-builder.ts` |
| Deterministic baseline fine, final profile wrong | `synthesizer.ts` (what Gemini was asked, including page titles and baseline JSON), `pack.ts` (which evidence it saw), `validator.ts` (what was accepted or rejected) |
| Confidence looks wrong | `profile/confidence.ts` and the strength tables in `evidence/types.ts`. Some fields use formulas: archetype share/margin, description 35+12/field, ccTLD markets at 72 |

To probe pure functions without the DB, write a scratch script that imports `@/lib/profile/...` or `@/lib/crawler/...` and run `npx tsx --tsconfig ./tsconfig.json <script>` from the repo root with `SUN_DATA_DIR` pointing at a temp dir.

## 4. Fix generically
- **No site-specific rules.** Comment the real failure that motivated each rule.
- **Keep the evidence prefix contract.** The prefixes in `evidence/builder.ts` are parsed by the resolvers, `deterministic-extractor.ts` and `prompts/intent-model.ts`. Grep the fixed part of a prefix before rewording it.
- **Keep legacy mirrors in sync** (`offerings.values`/`items`, `personas`, `geography.*`) on every write path. Landscape reads them too.
- **No model-asserted facts.** Never let a model assert confidence or add facts without evidence. Inferred fields cite current-run `evidence_items` ids.
- **Test on a fresh project.** Topics and the target entity are created once per project, and prompt geography reads the insert-only `locations` table, so changes may not show up on an existing project.

## 5. Prove it
1. **Unit tests.** Add unit tests next to the change (`tests/unit/crawler`, `tests/unit/profile`), then run the suites in the rule file.
2. **Fixture benchmark.** Run `npx vitest run tests/benchmark/business-profile.test.ts`. Its harness re-implements the crawl loop, so orchestrator-level changes also need a live check.
3. **Real sites.** Re-run the same real site on a **fresh project**, plus at least one unrelated archetype (e.g. a local service and a B2B SaaS). Diff field by field against your saved "before" file.
4. **Live benchmark (ask first).** `SUN_DATA_DIR=./data/verify SUN_EVIDENCE_DIR=./data/verify/evidence-store npm run benchmark:business-profile -- --live --only <id>` creates projects, crawls real sites, calls Gemini only when `GEMINI_API_KEY` is exported (tsx ignores `.env.local`), and overwrites `benchmarks/business-profile/expected/live-report.md`.
5. **Report** before/after field values, pages and evidence counts, and the remaining gaps.
