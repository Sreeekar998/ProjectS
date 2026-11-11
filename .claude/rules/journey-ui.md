---
paths:
  - "src/app/page.tsx"
  - "src/app/layout.tsx"
  - "src/app/trial/**"
  - "src/app/projects/**"
  - "src/components/**"
  - "tests/e2e/**"
---

# Journey and UI: guardrails

These are product expectations the user set repeatedly. Each area rule file adds guardrails for its own page.

- **Four stages.** Understand → Landscape → Prompts → Measure (`components/features/journey-nav.tsx`).
  - Collection lives in the observation console on Measure; `/projects/[id]/collect` only redirects. Don't add an Observe or collect stage.
  - The nav doesn't gate navigation; server guards do.
- **No dead ends.**
  - Every stage offers the next step once its gate is met: Prompts approval shows "Continue to Measure →", and partial Measure results offer "Continue collecting".
  - Never gate forward navigation on 100% completion, because collection runs normally end partial.
  - Failures show a readable message and a way forward, not a spinner that never ends.
- **Progress first, results when complete (user, 2026-09-14).**
  - Understand, Landscape and Prompts show a staged `LoadingStage` (`components/ui/loading-stage.tsx`) with counts and skeletons while work runs, and reveal results only when the stage finishes. Understand never renders a partial profile version.
  - Every project route has a `loading.tsx`, and nav links show `LinkPending` while a route compiles or loads.
  - Measure is the exception: it keeps partial "so far" results, per the honest-numbers rule.
  - Pages refetch persisted state when relevant events arrive, so a refresh resumes where the user was; stalled jobs (server restarted) show "Analyse again" / "Start again", never an endless spinner.
  - Upcoming nav stages still look clickable.
- **Nothing rejected, no confidence levels.** Don't show rejected or dropped items, rejection reasons, "ruled out" lists, "% match", quality scores or High/Medium/Low confidence labels in the app. Provenance badges ("Edited by you", "You told us") are fine. `tests/unit/ui/copy-guard.test.ts` enforces the copy.
- **Honest labels and numbers.**
  - Results name engines only as ChatGPT and Gemini; route and model details go in collapsed method notes. The key form may name providers.
  - Show `x of n` below 5 answers and `—` for a null value, and mark figures "so far" while a run is incomplete.
  - Never display a failed or missing observation as 0% or as brand absence.
  - Keep copy in sync with behaviour. Marketing copy once still described a 21/5/4 split and manual-only collection.
- **Entry flow.**
  - Both landing CTAs route to `/trial/new`: the nav "Start free analysis" link and the "Analyze my brand" forms (`#hero-website`, `#final-website`).
  - A URL carried in `?url=` pre-fills `#url` and focuses the market question (`#market-country`) without starting, so the operator sees the market and Search Console options; `?url=…&start=1` auto-starts once (scripts, deep links).
  - The intake form: website, "Where are your customers?" (all ISO countries plus Worldwide, then an optional area search `#market-area` for one country), and the Search Console switch (`#gsc-toggle`, disabled with setup steps when no OAuth client is configured). The Search Console round trip saves the draft in `sessionStorage` (`sun.intake.draft.v1`) and never creates a project before consent.
  - `tests/e2e/core-journey.spec.ts` relies on these ids and labels.
- **Client page conventions.**
  - Project pages are `"use client"`, unwrap `params` with React `use`, render `JourneyNav` with `current`, and fetch only through `src/lib/client/api.ts`.
  - Compose classes with `cn()` and `src/components/ui/*`. Put `buttonVariants` on a `Link` rather than nesting a `<button>` inside it; nested buttons click unreliably.
  - Use only Tailwind tokens defined in `globals.css`. A missing shade (e.g. `danger-50`) renders nothing.
- **Mobile.** Check 390 px width: no horizontal overflow, and remember the nav CTA is hidden behind the mobile menu there.
- **Validate** in the running app on desktop and mobile widths (`sun-validate`), then run the e2e spec if you touched labels, ids or navigation.
