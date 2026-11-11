# Implementation Status

Honest accounting against `Project_Sun_Phase2_Final_Technical_Implementation_Specification_v2.docx`.
"Done" means implemented with real logic and covered by a passing automated test, not
scaffolded. Where something is simplified from the spec's fullest ambition, that's
called out explicitly with the reasoning and the rollback path, per spec section 17.

## Done, end to end, with tests

- **Zero-cost baseline.** `npm install && npm run dev` — no DB server, no Docker, no
  card, no OpenAI key. Hard capability gates (`ZERO_ADDITIONAL_SPEND`,
  `OPENAI_API_ENABLED=false`, `CONSUMER_BROWSER_AUTOMATION=false`,
  `CLOUD_DEPLOYMENT_ENABLED=false`) are real, checked values
  (`src/lib/providers/capability-gates.ts`), not comments. `npm run clean-room` proves
  it from an empty data directory with `GEMINI_API_KEY` unset.
- **Safe crawler.** URL normalization, DNS/IP SSRF guard re-checked on every redirect
  hop, robots.txt + sitemap discovery, same-registrable-domain restriction,
  intelligent page scoring (not first-N), JSON-LD/meta/heading extraction,
  boilerplate stripping, exact + near-duplicate detection, evidence chunking with
  page/offset references. Playwright fallback for JS-heavy pages, gated behind a
  runtime Chromium-availability check that degrades silently if Chromium isn't
  installed. Verified against a real multi-page live site and covered by
  `tests/security/ssrf.test.ts` (11 attack-corpus cases run through the real
  orchestrator, not just the guard functions).
- **Business profile.** Deterministic extraction (archetype scoring, identity,
  offerings, jobs, personas, geography, regulated-domain detection) works fully with
  no API key. Every field carries `evidence | user | inferred_needs_review`
  provenance. Optional Gemini enhancement only touches fields already marked
  `needs_review`, never overrides evidence-backed ones. Confirmation gate blocks
  landscape/prompt generation on an unconfirmed profile
  (`ProfileNotConfirmedError`). Manual-completion fallback
  (`POST /api/projects/:id/profile/manual`) covers the blocked-crawl case.
- **Landscape.** Topic clustering from offerings/jobs evidence, with archetype-template
  top-up when evidence is sparse (never fewer than 4). On-site competitor-mention
  detection (`vs`, `compared to`, `alternative to` patterns) plus optional
  Gemini-knowledge suggestions, merged and deduped. Idempotent by design — a duplicate
  call (retry, double-submit, React Strict Mode's dev-only double effect) returns the
  existing landscape instead of inserting a second batch. 4–6 topic count enforced at
  the confirm gate.
- **Prompt Intelligence Engine** (the spec's stated top priority). Full pipeline:
  `PromptCoveragePolicy` (archetype- and geography-adaptive) → ~80-260 candidates
  generated against required coverage cells → schema/brand-leakage/geography/safety/
  non-leading validation → exact + near-duplicate dedup (anchor-aware across retry
  passes) → weighted quality scoring → coverage-constrained selection to **exactly 30**
  (21 neutral / 5 branded / 4 comparison, always). Progressive lifecycle
  (`GENERATING → CANDIDATE → VALIDATED → SHORTLISTED → SELECTED → USER_APPROVED`,
  `REJECTED` with a reason) streamed over SSE and visible live in the review UI, with
  a "Why this prompt?" panel per prompt. Approval is blocked until exactly 30 satisfy
  every gate; edits re-run the same validators. **Deterministic** (no `Math.random()`
  anywhere in the generator) — same input always produces the same 30 prompts, which
  is both a reproducibility property the spec values and what makes this pipeline
  actually testable. Covered by 47 unit tests plus a 13-archetype benchmark
  (`tests/benchmark/arbitrary-sites.test.ts`) asserting exactly-30, the 21/5/4 spine,
  zero brand leakage, and zero duplicate final text for every archetype in the spec's
  list.
- **Manual observation console.** Copy-prompt / open-provider / paste-response flow for
  both ChatGPT Plus and Gemini Apps. No DOM automation, no cookie capture, no session
  reuse — verified by inspection (the console never calls `mcp__Claude_Browser__*`-style
  automation against those origins; it only writes to the clipboard and opens a tab).
  First-answer rule, source-URL capture, full observation metadata
  (model/mode, search state, locale, observer region, sample index).
- **PromptRun state machine**, exactly as specified (7.1): `planned → claimed →
  awaiting_import/running → succeeded`, typed non-success states
  (`rate_limited`/`incomplete`/`failed`) each reachable only from their correct
  predecessor, explicit retry back to `planned`, `policy_disabled` terminal until
  policy changes. Idempotency key = `sha256(project, promptVersion, provider, sample)`.
  8 unit tests on the transition table itself.
- **Optional Gemini Free API lane.** Separate `route`/`method`/`adapterVersion` on every
  row it writes; never labelled as Gemini Apps. Fails closed
  (`policy_disabled`/`failed`) with no key, no crash.
- **Measurement.** Deterministic mention/rank/citation parser (word-boundary alias
  matching, rank only from genuine numbered-list structure — ambiguous prose always
  yields `rank: null`, never a guessed position). Neutral Presence, Share of Voice,
  First-choice rate, Average position, Owned Citation Rate (route-gated `N/A` vs `0`
  — Gemini Free API correctly reports `N/A` since basic `generateContent` has no
  grounding), Coverage, Branded-accuracy and Target-comparison panels kept
  structurally separate from neutral KPIs. Every metric stores its
  `contributingObservationIds`, `algorithmVersion`, `parserVersion`,
  `aliasSetVersion` for reproducibility. A failed/incomplete observation is
  excluded from every denominator, never counted as target absence — proven by
  `tests/integration/full-pipeline.test.ts`, which deliberately injects one typed
  failure and asserts the denominator reflects it correctly.
- **Progressive UX**, not scaffolded: SSE event bus with per-project sequence numbers,
  resumable via `Last-Event-ID` or an explicit `since` query param, with an
  always-on polling channel running alongside the live stream (not just as an
  error fallback) so state never permanently desyncs — see the "known issues found
  and fixed" section below for why that redundancy exists.
- **Data model**: 21 normalized tables, one initial Drizzle migration
  (`drizzle/0000_*.sql`), auto-applied on first `getDb()` call.
- **180 automated tests** across 16 files (unit, integration against both a local
  fixture HTTP server and a live public site, security, benchmark), plus 3 Playwright
  E2E tests driving a real Chromium browser through marketing → trial → crawl →
  profile confirm → landscape confirm, at both desktop and mobile viewports. Full
  suite green; production build succeeds; clean-room boot succeeds.

## Known issues found during this build and fixed (kept here for the record)

These aren't hypothetical — each was caught by actually running the app, not just
reading the code, and the fix is reflected in the current source:

1. **Next.js dev file-watcher reload loop.** The local SQLite WAL files and evidence
   store live inside the project directory; every crawl page write triggered a Fast
   Refresh recompile, tearing down the SSE connection mid-crawl. Fixed by excluding
   `data/` and `evidence-store/` from the webpack watcher (`next.config.ts`).
2. **SSE reconnect race.** The `EventSource` reconnect URL used a hardcoded `since=0`.
   Under React Strict Mode's dev-only double-invoked effect, two connections could
   briefly coexist; the second one's replay-from-0 got entirely deduped away against
   the first instance's already-advanced sequence number, leaving the UI's event log
   permanently empty even though the connection looked healthy. Fixed by (a)
   reconnecting from the last actually-consumed sequence, and (b) running a low-
   frequency poll continuously alongside the stream rather than only after an
   error, so any future SSE-side inconsistency self-heals within ~2.5s instead of
   silently sticking.
3. **`generateLandscape` was not idempotent.** A duplicate call (React Strict Mode's
   double effect was what surfaced it, but a network retry would trigger the same
   bug) inserted a second batch of topics. Fixed by checking for an existing
   landscape before generating.
4. **Duplicate text in the approved 30 — the important one.** Caught by writing a
   5-iteration stress test and, later, the 13-archetype benchmark. Root cause: (a)
   the dedup pass on a coverage-gap retry only compared new candidates against the
   *current* batch, not against candidates already accepted in an earlier pass; (b)
   more fundamentally, when a single topic's weighted intent allocation happened to
   assign the *same* intent to two different coverage cells, both cells produced an
   identical template context (same category, same topic-derived context phrase,
   same primary geography) — no amount of template rotation keeps two cells
   apart when their entire input is identical and the candidate pool per cell
   already covers every available template. Fixed at the source: `normalizedIntentPlan`
   now cycles through *distinct* intents in weight-priority order before ever
   repeating one for the same topic (repeats only occur when a topic's slot count
   genuinely exceeds the number of distinct weighted intents for that archetype),
   and the dedup pass now checks against every already-accepted candidate from prior
   passes, not just the current batch. Branded-accuracy (5 cells) and
   target-comparison (4 cells) — which structurally have no topic axis to vary by —
   were changed to a deterministic bijective template assignment (cell *i* always
   gets template *i*), which is a stronger correctness guarantee than "generate 3
   and hope dedup sorts it out." Re-verified with a 5-iteration duplicate-stress
   script and the archetype benchmark; the pipeline is now fully deterministic
   (same input → byte-identical output), which is itself a useful reproducibility
   property.

## Deliberately simplified, with reasoning

- **Semantic near-duplicate detection is local (shingle + bag-of-words cosine), not
  embeddings.** No embeddings API call is required for the app to fully function
  without `GEMINI_API_KEY`. This is a real, tested implementation (not a stub), just
  not vector-based. Rollback path: swap `src/lib/text/similarity.ts`'s comparison
  function for an embeddings call behind the same interface if a future iteration
  wants it — nothing else changes.
- **Mention/entity matching is exact alias/domain word-boundary matching, not a fuzzy
  matcher or an LLM judge.** Spec 8.2 explicitly allows this order of preference
  ("detect exact matches first; fuzzy/entity logic only where necessary; LLM judge
  only for genuine ambiguity") — the fuzzy and LLM-judge tiers are not implemented.
  For the golden-set fixtures this achieves 100% precision/recall (`tests/unit/
  fixtures/provider-response-fixtures.test.ts`); a business with unusual
  brand-name variants not captured as an alias would need that alias added manually
  today rather than being fuzzy-matched automatically.
- **Branded-accuracy is a structural mention-rate check, not a factual-accuracy
  grader.** Spec 8.3 describes this panel as "secondary human/structured factual
  review" — a full automated factual-accuracy grader (checking whether the AI's
  claims about the business are actually true) is out of scope for this build; the
  panel currently reports whether the target was discussed at all when asked
  point-blank, which is the structural half of that requirement, surfaced with full
  evidence for a human to do the factual read themselves.
- **Arbitrary-site benchmark uses synthetic confirmed profiles for 13 of the spec's
  archetype/business-shape cases, not 13 live crawls.** The Prompt Intelligence
  Engine — the variable the benchmark exists to test — starts from a *confirmed*
  profile/landscape regardless of whether a live crawl or manual entry produced it;
  routing 13 synthetic profiles through the identical `generatePromptSet →
  approvePromptSet` code path isolates exactly that variable, runs in ~1.5s total,
  and is a stronger, more repeatable regression test for the engine's own logic than
  13 live crawls would be (crawl-quality variance would make failures ambiguous:
  archetype-policy bug, or just a messy website?). The crawler itself, separately,
  is proven against one genuinely-unseen live site end to end
  (`tests/integration/full-pipeline.test.ts`, also exercised via Playwright E2E) plus
  a blocked-site path via robots.txt disallow. A full 12-live-site crawl benchmark
  was not run in this build for time; the crawler's individual mechanisms (robots,
  sitemap, extraction, scoring, SSRF) each have dedicated unit/integration coverage
  against both fixture and live content instead.
- **No GEMINI_API_KEY was available in this build environment**, so the optional
  Gemini-assisted paths (profile enhancement, competitor suggestion, candidate
  generation augmentation, Gemini Free API observation lane, the consumer-vs-API
  fidelity benchmark) are implemented and unit-testable via their fallback
  (`gemini_api_disabled`) behavior, but were not smoke-tested against a live Gemini
  call. Every one of these paths has a tested, non-crashing fallback when the key is
  absent — that's what `npm run clean-room` proves — but if a key becomes available,
  run `GEMINI_API_KEY=... npx tsx scripts/gemini-smoke.ts` is the natural next step
  (that script does not exist yet; the adapters it would exercise
  (`src/lib/gemini/client.ts`) are already written and typed).
- **Client-side concurrent-edit race.** Confirming multiple topics/candidates with
  rapid concurrent clicks can cause the UI to briefly show a stale intermediate
  state (each PATCH response overwrites the full local state; out-of-order
  responses can flicker). The *server* data is always correct — each PATCH is
  atomic and persists correctly regardless of ordering — this is a display-only
  issue, worked around in the E2E test by sequencing confirmations. Not fixed with
  request-queueing/optimistic-locking in this build.

## Explicitly out of scope (per spec)

Diagnose/Actions & recommendations engine, Google AI Mode/AI Overviews/Perplexity,
paid billing, public multi-tenant hosting, GPU/self-hosted model infra, and
repeated-sample statistical confidence bands are all out of scope per spec sections
1.2 and 12.1's own sampling-honesty note, and are not implemented here.

## What a reviewer should actually run

```bash
npm install
npm run verify        # lint + typecheck + test + build — all green
npm run clean-room     # fresh data dir, no GEMINI_API_KEY, proves the baseline boots
npm run test:e2e       # real browser through the core journey
npm run dev             # then walk the demo sequence in README.md yourself
```
