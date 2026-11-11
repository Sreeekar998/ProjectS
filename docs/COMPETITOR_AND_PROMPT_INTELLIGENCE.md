# Competitor and Prompt Intelligence

This document describes Task 3: the production path from a confirmed Business
Profile to a frozen, approved PromptSet. It deliberately ends before Observe and
Measure.

## Invariants

- Competitor discovery uses only the confirmed Business Profile, confirmed website
  evidence, and configured source adapters. A model response is a hypothesis, never
  proof.
- Candidate names are normalized and resolved before ranking. The target brand,
  aliases, domains, products, parent brands, sibling brands, directories, and weakly
  related entities are rejected or classified rather than silently treated as direct
  competitors.
- A candidate score is an inspectable weighted combination of category overlap,
  customer-job overlap, audience overlap, geography overlap, business-model fit,
  website verification, and source support. Weights adapt by archetype.
- A user must confirm 4–6 topics and at least one competitor that is not a marketplace.
  Continue then creates an immutable CompetitiveSetVersion containing topic and
  competitor snapshots plus hashes.
- Prompt generation reads that frozen version and writes an immutable PromptContext
  snapshot before generating candidates. Regeneration therefore cannot silently use
  newly changed context.
- The final cohort is exactly 30 prompts: 10 Discovery, 10 Trade Offs, and 10 Sentiment
  Analysis. Discovery prompts forbid both target-brand and competitor leakage.
- Validation, deduplication, 100-point quality scoring, constrained selection, and
  review actions are deterministic application code. Optional Gemini calls can add
  phrasing candidates but cannot bypass those rules.
- Prompt approval revalidates the full cohort, records the approving actor and time,
  freezes the set, and does not automatically start observation.

## Competitor discovery pipeline

`buildCompetitiveSearchProfile` turns the confirmed profile — including the
business understanding (kind, local category, price position, offering groups,
audience) and the confirmed location down to neighbourhood and coordinates —
into the search profile. Sources implement `CompetitorCandidateSource`
(details and costs in `docs/ONBOARDING_INTELLIGENCE.md`):

1. search-grounded rivals anchored to the confirmed place (`competitor-search.ts`;
   paid OpenAI web search is opt-in for Landscape);
2. nearby same-category businesses from OpenStreetMap for place-bound businesses
   (`competitor-nearby.ts`);
3. structured model hypotheses through the routed LLM layer;
4. Wikidata/Wikipedia category neighbourhood;
5. comparison mentions on the target website, which need corroboration for local
   businesses;
6. a disabled web-search adapter seam and a typed seam for observed AI answers.

Merged candidates pass one like-for-like screening call (`competitor-screening.ts`)
before verification. Geography is scored from positive evidence (distance,
reported area, place mentions on the rival's own site); an unreachable website is
neutral, not "not local".

A source's proposed role never outranks strong structural evidence: a candidate with a
shared market signature is typed `direct` even when a source proposed `adjacent`. The
frozen competitive set includes every confirmed rival except marketplaces.

The service runs sources with partial-failure isolation, resolves duplicate entities,
performs bounded SSRF-safe candidate-site verification where a plausible domain is
available, computes component scores, classifies candidate role, and persists every
ranked or rejected result. Progress is emitted and stored as discovery-started,
candidate-found, verifying, suggestion-ready, source-failed, and completed events.

## Prompt pipeline

With a Gemini key, prompts are written from a **customer intent model** built from the
confirmed profile and the site's own navigation vocabulary: 6–9 needs at the level a
customer shops at (each with situations, qualities, audiences and a budget), concrete
pre-purchase concerns, and decision factors. Needs that are not grounded in the site
vocabulary are dropped. Three section calls then write candidates:

- **Discovery** (`discovery.ts`) — code plans slots per need: a bare ask, an ask with
  one everyday detail, and (every other need) a situation-first ask, each with a place
  for businesses customers visit (city most, then the neighbourhood, then an area the
  site names; never a landmark) and money on at most two slots. The writer writes two
  versions per slot in the register real people use (search fragments, plain
  questions, requests, short situations; lowercase and missing punctuation allowed),
  with the site's own claims listed as off limits. A judge (gpt-5.6-luna) checks each
  survivor — asks for options, offered there, several businesses could answer, does
  not ask for the site's claim, not assembled, reads like the reference real prompts,
  names no business — and a prompt failing any check is never auto-selected.
- **Trade Offs** — the five highest-confidence non-marketplace rivals, named the way
  people say them. The model first declares which needs each rival sells the same kind
  of item for, and prompts outside those rival–need pairs are discarded in code.
- **Sentiment Analysis** — grounded in the intent model's concerns.

A section call that returns nothing is retried once (`intentRetries`,
`intentFailedSections` counters). The deterministic coverage policy and templates remain
the floor: they are used without a key, and with a key they only fill slots the
provider-written candidates cannot. Regenerate a set with
`POST /api/projects/:id/prompts/generate?force=1`.

Each candidate then goes through the same pipeline:

1. validates policy, target/competitor identity rules, confirmed context, safety, and
   usable question form;
2. removes exact duplicates and context-aware semantic near-duplicates;
3. scores quality using the inspectable 100-point rubric;
4. selects ten candidates per section using quality, incremental coverage gain
   (needs, details, places, rivals, concerns) and diversity gain with deterministic
   tie-breaking;
5. exposes selected prompts and validated alternatives for user review.

The review API supports edit-and-revalidate, regenerate-one, replace-with-alternative,
deselect, reject, and select. All changes persist and survive refresh.

## No hidden model behavior

Without model keys, the full competitor review and prompt pipeline remains
usable through website evidence, manual competitor confirmation, deterministic
templates, validation, scoring, and selection. With keys, the routed LLM layer
(`lib/llm`) contributes competitor hypotheses, screening, topics and prompt
writing; each prompt records the model that wrote it as a `model:` context key. Model output is
schema-checked, source-labelled, revalidated, deduplicated, scored, and never allowed
to mutate the frozen context or approve a result.

## Verification and benchmarks

```bash
npm run test:unit
npm run test:integration
npm run test:security
npm run test:benchmark
npm run test:e2e
npm run typecheck
npm run lint
npm run build
```

The deterministic competitor benchmark covers 12 business types and records
Precision@5 against labelled fixtures. The live onboarding evaluation over 17
researched businesses is `scripts/eval-onboarding.ts` (see
`docs/ONBOARDING_INTELLIGENCE.md`). The prompt benchmark covers 13 archetype cases,
asserts the 10/10/10 composition, checks target and competitor leakage, confirmed
topic/geography grounding, trade-off bindings, sentiment themes, duplicates, approval,
and writes generation stage timings to `BENCHMARK_REPORT.md`.

For live competitor research, copy
`benchmarks/competitor-live-manifest.example.json` to
`benchmarks/competitor-live-manifest.json`, provide at least ten user-reviewed targets
with expected competitors, configure `GEMINI_API_KEY`, then run:

```bash
npm run benchmark:competitors:live -- benchmarks/competitor-live-manifest.json
```

This live benchmark is intentionally not filled with invented labels. Its output is
written to `benchmarks/competitor-live-results.json` for human review.

## Known limitations

- Search-grounded competitor discovery needs either paid OpenAI web search
  (`SUN_ALLOW_PAID_LANDSCAPE=1`) or a billing-enabled Gemini key; on a free Gemini key
  local rivals come only from OpenStreetMap (best-effort) and model hypotheses, which
  are rejected unless verified.
- Candidate website verification depends on discovering or supplying a plausible
  canonical domain. Name-only model hypotheses remain explicitly unverified.
- Semantic deduplication uses deterministic lexical similarity, not an embedding
  service. It is conservative and scoped by prompt context to avoid collapsing valid
  coverage cells.
- Work runs in-process with bounded concurrency. Events and intermediate rows persist,
  but a production multi-worker deployment would need a durable queue and distributed
  event transport.
- Regulated-industry checks protect phrasing and unsupported claims; they are not a
  substitute for legal or clinical review.
- Discovery can miss household-name rivals. In the Nike test project neither Puma nor
  Gymshark was proposed; both appear in Measure's untracked-brands list because answers
  recommend them, but a person must add them to the next competitive set.
- Product and sub-brand names ("Air Max", "Pegasus") resolve to their brand only when
  stored as product entities; otherwise they are listed as untracked names.
- Prompt wording varies between generations (writer temperature 0.6–0.8; OpenAI
  reasoning models ignore temperature), so two regenerations
  of the same project produce different, individually validated cohorts.
