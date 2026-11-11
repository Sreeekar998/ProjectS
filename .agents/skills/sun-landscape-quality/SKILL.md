---
name: sun-landscape-quality
description: Diagnose and improve Landscape output (the 4–6 topics and the suggested competitors, their roles and scores) for real businesses. Use when competitors are irrelevant, missing, mis-typed or wrongly rejected, when topics are poor or too few, or when changing discovery, scoring, verification or topic logic under src/lib/landscape.
---

# Improving topics and competitor suggestions

The guardrails in `.Codex/rules/landscape.md` load automatically; this skill is the investigation workflow. Treat discovery as retrieval + entity resolution + ranking, not as a hunt for "X vs Y" sentences.

## 1. Start from the confirmed profile
Discovery reads the Brand Profile: brand, domain, industry, archetype, offerings, markets, and the legacy mirrors. If those are wrong, fix them first (`sun-profile-quality`).

## 2. Reproduce without destroying operator decisions
- **Preferred: probe without saving.**
  ```bash
  export GEMINI_API_KEY=...   # tsx doesn't read .env.local; without this the AI source silently finds nothing
  SUN_DATA_DIR=./data/verify npx tsx scripts/probe-discovery.ts <projectId>
  ```
  - It runs the full `discoverCompetitors` pipeline without writing discovery rows.
  - It prints each ranked candidate's name, role and total score. The sources column currently prints `[]`, and `rejectionReason` is not shown.
  - It calls Wikimedia and candidate sites.
  - **Always set `SUN_DATA_DIR`.** The default opens the user's `./data/sun.db` read-write and applies pending migrations.
- **Full stage:** use a **fresh** project in an isolated app (`sun-validate` §2). Re-running discovery on an existing project overwrites matched rows' status and type, and re-runs only in limited cases.
- **Record the "before" state** outside the repo: `curl -s localhost:3100/api/projects/<id>/landscape > <scratch>/landscape-before-<id>.json`.

## 3. Read what happened
- **Run summary.** `landscape.discovery` has `status`, `sourceStats` (raw candidates per source) and `metrics` (sourceCandidateCount, resolvedCandidateCount, verificationAttemptCount, verifiedCount, timings).
- **Per competitor:**
  - `status` and `discoveryStatus`;
  - `rejectionReason`: non-null means the system rejected it; `removed` with a null reason means the operator did;
  - `sourceContributions`, `competitorType`;
  - `confidence`: 0.7 × score + 0.3 × source confidence;
  - `scoreBreakdown`: `-1` means absent and excluded, but `structuralAffinity` is stored clamped to 0 even when absent;
  - `verificationStatus` and `verificationSummary`.
- **Events.** `GET /api/projects/<id>/events?since=0&stream=false`, filtered to `landscape.*`, shows `candidate_found` per source → `verifying` → `suggestion_ready`/`rejected` → `discovery_completed`.
- **A source with zero candidates may be broken rather than empty.** Source errors are swallowed into `[]`, and the AI source discards everything if one item fails zod. Temporary logging is often the fastest way to tell.

## 4. Localize the failure
| Symptom | Look first at |
|---|---|
| An obvious rival never proposed | Which source should find it: the comparison regex in `competitor-sources.ts`; the Gemini hypothesis (key visible to that process? schema without nested `maxItems`?); open knowledge in `open-knowledge.ts` (target resolved via Wikidata P856 or name fallback? market categories? IDF signature? wrongly excluded as a sub-brand or sibling?); `wiki-client.ts` throttles. Also check the 16-slot cut in `competitors.ts`: rejected and valid candidates are ranked together, so the rival may sit 17th with no row at all |
| Proposed but rejected or removed | Rejection rules in `competitor-scoring.ts` (the relationship regex is unanchored: `customer`, `supplier`…), identity `contradicted` by `competitor-verifier.ts`, merge rules in `competitor-entity.ts` |
| Wrong role (marketplace, adjacent, not_competitor) | Precedence in `roleFromSignals` (a marketplace proposal beats structural evidence). In merges, the first source's `proposedType`/`structuralAffinity` wins |
| Irrelevant candidate with a high score | Unverified candidates renormalise over very few dimensions; name-only website candidates are never verified |
| The target's own brands suggested | `isTargetEntity` and the scoring rejections cover target, parent and owned product lines. Sibling/owned-brand exclusion exists only inside `open-knowledge.ts`, so AI or website candidates can bypass it |
| Topics poor or fewer than 4 | `topics.ts` (clustering, 6-topic cap, question filter, and the template top-up that skips names >0.5 similar), `topic-templates.ts` (per-archetype lists), `neutralizeTopicName` in `search-profile.ts` (substring stripping) |

To probe pure functions without network or DB, write a scratch `tsx` script that imports `@/lib/landscape/{competitor-entity,competitor-scoring,topics,search-profile}` with hand-built profiles.

## 5. Fix generically
- **No brand lists.** Derive from structure (domains, categories, verification), and comment the incident behind each rule.
- **Keep "unknown ≠ zero":** absent dimensions stay out of the total.
- **Preserve operator decisions.** Upserts must keep confirmed, removed and `user_manual` rows.
- **Eligibility has 6 copies, in two styles** (see the rule file). Change them together.
- **Name forms and aliases feed prompts and analysis.** A change affects competitor leakage checks, Trade Off naming and analysis linking: bump `ANALYSIS_VERSION` and run the prompt tests.
- **Bump `COMPETITOR_DISCOVERY_POLICY_VERSION`** when discovery semantics change.

## 6. Prove it
1. **Tests.** Run `npx vitest run tests/unit/landscape tests/benchmark/competitor-intelligence.test.ts`. The benchmark covers only synthetic *verified* profiles, so add a fixture for your failure mode (merge order, unverified candidate, relationship word…).
2. **Before/after diff.** Re-run `probe-discovery.ts` or a fresh project for the original business **and** at least one unrelated archetype. Diff names, roles, scores and rejections against your saved "before" file.
3. **Live benchmark (only with the user's OK).**
   ```bash
   SUN_DATA_DIR=<scratch>/data SUN_EVIDENCE_DIR=<scratch>/ev npm run benchmark:competitors:live -- <manifest.json>
   ```
   It needs 10+ human-reviewed targets (see `benchmarks/competitor-live-manifest.example.json`) and `GEMINI_API_KEY` exported in the shell. It creates and confirms projects, live-crawls, and writes `benchmarks/competitor-live-results.json`.
4. **Downstream check.** Freeze the landscape, then regenerate prompts through the API (`POST /api/projects/<id>/prompts/generate?force=1` or `scripts/regenerate-prompts.ts`). The Prompts page only generates when no set exists. Confirm the Trade Offs name sensible rivals.
