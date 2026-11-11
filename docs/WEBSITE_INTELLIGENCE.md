# Website Intelligence → Brand Profile

How a submitted URL becomes an editable, evidence-grounded Brand Profile.

## Pipeline

```
Submitted URL
  → URL normalization + SSRF guard      src/lib/security/url-safety.ts
  → robots.txt (RFC 9309)               src/lib/crawler/robots.ts
  → sitemap / sitemap-index discovery   src/lib/crawler/sitemap.ts
  → Crawl Planner (score + diversity)   src/lib/crawler/crawl-planner.ts
  → HTTP fetch, browser only if needed  src/lib/crawler/fetcher.ts, playwright-fallback.ts
  → page classification                 src/lib/crawler/page-classifier.ts
  → structured data + content extract   src/lib/crawler/structured-data.ts, extractor.ts
  → typed Evidence items                src/lib/evidence/builder.ts, repository.ts
  → deterministic field resolvers       src/lib/profile/*-resolver.ts, industry-classifier.ts
  → rules-based description/clean-up    src/lib/profile/synthesizer.ts (DeterministicProfileProvider)
  → Business Understanding (model)      src/lib/understanding/* (digest → extraction → grounding → location)
  → validation + confidence             src/lib/profile/validator.ts, confidence.ts
  → CanonicalBusinessProfile            src/lib/profile/schema.ts
```

Business Understanding (classification, location, grouped offerings, audience
segments) is described in `docs/ONBOARDING_INTELLIGENCE.md`. The older
`GeminiProfileProvider` in `synthesizer.ts` is no longer called.

`src/lib/profile/orchestrator.ts` drives the whole thing and emits progress
events as each page's evidence lands, so the review screen fills in during the
crawl rather than after it.

## The invariant

**Every substantive profile field cites `evidenceIds` that exist.** A field
whose citations cannot be resolved is dropped, not trusted — see
`assertEvidenceIntegrity` and `evidenceCoverage` in `profile/validator.ts`. The
benchmark asserts 100% coverage on every case.

Confidence is **computed from evidence quality** (source type × page type,
agreement across distinct pages, structured/prose corroboration), never taken
from a model's self-report. See `profile/confidence.ts`.

## Running the benchmark

```bash
npm run test:benchmark                          # deterministic fixtures (also part of npm test)
npm run benchmark:business-profile -- --live    # real public websites, explicit only
npm run benchmark:business-profile -- --live --only live-stripe
```

Reports land in `benchmarks/business-profile/expected/`.

## Without a model key

The application starts, crawls, extracts evidence and produces a full profile
using the deterministic resolvers alone (no classification path, no location
card; the Understand page falls back to the Industry and Target market fields).
Semantic fields carry lower confidence and are marked for review. Nothing is
presented as AI-generated when it is not — `profile.quality.synthesisMode`
records which path ran, and `quality.models` / `quality.llmCostUsd` record which
models answered and their estimated cost.

## Tuning

Crawl bounds live in `src/lib/crawler/config.ts`; page-type value weights in
`page-classifier.ts` (`PAGE_TYPE_VALUE`); planner weights in
`crawl-planner.ts` (`WEIGHTS`); the industry vocabulary in
`profile/taxonomy.ts`; the identity-trait vocabulary in
`profile/identity-traits.ts`.
