---
name: sun-validate
description: End-to-end validation for Project Sun changes. Runs the right static and test gates, then runs the real app on an isolated data dir and checks actual stage output (profile, topics and competitors, prompts, Measure) plus the database. Use before calling any behaviour change done, when reproducing a bug in the running app, or when asked to run the app or check that it works.
---

# Validating a Project Sun change

Passing `tsc` and `vitest` is required but not enough. Most regressions here are quality regressions: a wrong profile field, an irrelevant competitor, a template-sounding prompt, a denominator that quietly changes. Only real output shows them. Pick the gates that match the blast radius, then look at the product.

## 0. Preconditions
- **Node.** `node -v` must be ≥ 20.11. On nvm v15/v16, `tsx` crashes with `SyntaxError: Unexpected token '{'`; on v17, Next refuses to start. Fix with `export PATH="$HOME/.nvm/versions/node/v20.13.0/bin:$PATH"`.
- **What's already running.** Check `lsof -nP -iTCP:3000 -iTCP:3100 -sTCP:LISTEN` and `ps -o command= -p $(lsof -tiTCP:3000 -sTCP:LISTEN)`. The user often keeps `npm run dev` (dist dir `.next`) or `npm start` (dist dir `.next-build`) on :3000 against the live DB (`data/sun.db`, real projects).
  - Don't run experiments against that server or its data, and don't kill it.
  - If it is `next start`, don't run `npm run build` or the production variant below without asking: they rewrite `.next-build`, which that server serves.
- **Snapshot first.** This is not a git repo. Before wide edits, run `tar -czf <scratch>/pre-change.tgz --exclude node_modules --exclude '.next*' --exclude data --exclude evidence-store .` (keep the glob quoted), then check that `tar -tzf <scratch>/pre-change.tgz | grep -E '^\./(data|evidence-store|\.next)'` prints nothing.

## 1. Static and test gates
| Gate | Command | Notes |
|---|---|---|
| Types | `npx tsc --noEmit --incremental false` (`npm run typecheck` also writes `tsconfig.tsbuildinfo`) | tsconfig includes `.next*/types`; stale generated route types can fail after a route deletion until regenerated. |
| Lint | `npm run lint` | Expect 0 errors. About 100 warnings already exist, mostly `no-explicit-any`. |
| Area tests | `npx vitest run --no-cache <paths>` | Each file gets a temp DB via `tests/setup.ts`. Tests run **without** `GEMINI_API_KEY`, so live AI paths are untested. Keep other provider keys unset in the shell. Suites are listed in each area's rule file. |
| All tests | `npm test` (≈20 s) | Needs internet (`tests/integration/full-pipeline.test.ts` crawls books.toscrape.com and calls Wikidata). Overwrites `BENCHMARK_REPORT.md` and `benchmarks/business-profile/expected/fixture-report.md`; timing columns always change, so compare the rest. |
| Build | `SUN_DATA_DIR=<scratch>/data SUN_EVIDENCE_DIR=<scratch>/ev npm run build` | Never run bare `next build`: it writes the dev server's `.next` (`ENOENT .next/server/app/page.js`; fix with `rm -rf .next` and restart dev). The build's bootstrap otherwise migrates the user's `./data/sun.db`, and it writes `.next-build`. |
| Clean boot | `npm run clean-room` | Fresh temp dir, no Gemini key: migrations, route-policy seed, project creation, capability gates. Does not start Next. |

## 2. Run the real app in isolation
Use a throwaway data dir, evidence dir, dist dir and port. Other agents may be validating at the same time, so first check that your port and dist dir are free (`lsof -nP -iTCP:3100 -sTCP:LISTEN`, `lsof +D .next-e2e`). If they are taken, pick your own port and data dir (for example 3101 and `./data/verify-<task>`). `.next-e2e` can serve only one process at a time. If it is busy, use a private `NEXT_DIST_DIR` (for example `.next-verify-<task>`); Next then appends that dir's types path to `tsconfig.json`, so restore `tsconfig.json` and delete the dir afterwards.
- **Dev server** (use this while iterating):
  ```bash
  SUN_DATA_DIR=./data/verify SUN_EVIDENCE_DIR=./data/verify/evidence-store NEXT_DIST_DIR=.next-e2e OPENAI_API_KEY= PORT=3100 npm run dev
  ```
  In the Claude desktop app, start it with the preview tool using the `sun-verify` entry in `.claude/launch.json`, which runs exactly this. Never start the `project-sun` entry: it is the user's :3000 live-DB setup. If the session's working directory is the parent `Sun Project` folder, the preview tool reads that folder's `launch.json`; add an equivalent entry there first.
- **Production build** (closest to the user's demo command):
  ```bash
  SUN_DATA_DIR=./data/verify SUN_EVIDENCE_DIR=./data/verify/evidence-store OPENAI_API_KEY= PORT=3100 npm start
  ```
  It checks for source changes only at startup (bootstrap first, rebuild into `.next-build` if needed). Later edits aren't served until you restart it, and it shares `.next-build` with any other `npm start`.
- **Keys and cost.** Next loads `.env.local`, which defines Gemini, OpenAI, Groq and Cerebras keys, but never overrides variables already set.
  - `OPENAI_API_KEY=` blanks the paid lane. Also make sure no OpenAI key is saved in the verify DB's console, and never start automated collection on a paid lane without the user's explicit OK.
  - Groq and Cerebras are free tiers with quotas. Gemini is free only while billing is off: the Gemini collection lane asks with Google Search grounding first, which bills on billing-enabled keys.
  - One keyed prompt generation uses several Gemini calls. Blank `GEMINI_API_KEY=` when you want the deterministic path.

## 3. Walk the journey and read the output
Walk it **in the browser**; that is the real operator review. `SUN_BASE=http://localhost:3100 SUN_SKIP_OBSERVE=1 npx tsx scripts/e2e-journey.ts https://<site>/` is only a smoke run:
- it confirms the profile as-is;
- it confirms **every** topic and competitor row, including system-rejected ones, and prints no status or rejection reason;
- it approves the prompt set;
- it times out after 5 minutes if a section is short;
- without `SUN_SKIP_OBSERVE=1`, it starts automated collection.

1. **Start** at `/`. The hero form goes to `/trial/new?url=…`, which creates the project and redirects to `/projects/<id>/understand`.
2. **Understand.** Live progress, then profile fields with confidence badges. "Why?" must show real evidence (page type + snippet). Check brand, description, industry, offerings and markets against the real site, then Confirm.
3. **Landscape.** 4–6 topics. Competitor suggestions should be real rivals with a sensible role and evidence. Add one manually if none are relevant, then "Confirm & continue to prompts".
4. **Prompts.** Expect 30/30 = 10 Discovery + 10 Trade Offs + 10 Sentiment Analysis. Read every prompt:
   - it sounds like something a customer would actually type;
   - Discovery names no brand and no competitor;
   - Trade Offs name the brand, one confirmed rival and a decision factor;
   - Sentiment Analysis names the brand and **no competitor** (the validator doesn't enforce this for Gemini-written prompts);
   - no duplicates, and the market fits.

   Try Edit/Regenerate/Replace/"Add your own prompt" **before** approving; they disappear once the set is approved. Then approve.
5. **Measure.** "Ask ChatGPT & Gemini by hand" creates a collection run with the manual routes; "Collect automatically" uses keyed API lanes instead.
   - Use "Paste answer" to enter an answer with its sources.
   - Figures show `x of n` below 5 answers.
   - "See the answers →" appears on the Discovery headline cards only when the count is above 0, so paste at least one Discovery answer that names the brand. It opens the evidence drawer (`GET /api/provider-responses/:id`); other figures open it from their "See the N →" links.
- **Check for errors** in the browser console, network log and server log. Expected 404s: `GET /api/projects/:id/profile` before a profile exists, and `GET /api/projects/:id/measure` before a collection run exists.

## 4. Inspect the database (read-only)
```bash
node -e "const D=require('better-sqlite3');const db=new D('data/verify/sun.db',{readonly:true});
console.log(db.prepare('select type,count(*) n from events group by type order by n desc').all());
console.log(db.prepare('select status,generation_stats from prompt_sets').all());
console.log(db.prepare('select lifecycle_state,count(*) n from prompt_candidates group by 1').all());"
```
- **Case matters.** `prompt_candidates.lifecycle_state` is UPPERCASE (`SELECTED`, `USER_APPROVED`, `REJECTED`); `prompt_sets.status` and `prompt_runs.state` are lowercase.
- **Useful fields:**
  - `prompt_candidates.rejected_reason`
  - `crawl_runs.metrics` and `crawl_pages.selected_reason`
  - `observation_analyses.payload`
  - `provider_responses.provider_experience` (the true route id)
  - `events` rows of type `collection_run.progress` whose payload status is `analysis_failed` or `lane_failed`
- **Live DB.** Open the user's `data/sun.db` only with `{readonly:true}`, and say so.

## 5. Playwright e2e
`npm run test:e2e` reuses any server already on :3100. Otherwise it starts `npm run dev` with `SUN_DATA_DIR=./data/e2e NEXT_DIST_DIR=.next-e2e`.
- With no `SUN_EVIDENCE_DIR`, crawl text lands in the shared `./evidence-store`.
- It loads `.env.local`, so real Gemini calls happen.
- Desktop and mobile run in serial mode; the first failure skips the rest of that project.

Known failures as of 2026-09-13, identical before and after the cleanup:
- Desktop "full journey" waits for "Website connected", which never renders (`analysis-progress.tsx` reads `crawl.started.payload.domain`, which is never emitted).
- Mobile "Start free analysis CTA" and "both landing CTAs…" click a nav link hidden behind the mobile menu.
- Desktop landing-CTA tests are flaky: `/trial/new` can redirect to `/understand` before `toHaveURL` matches.

Reproduce against a baseline before calling a failure a regression.

## 6. Clean up and report
- Stop the servers you started.
- Delete only what **you** created: your verify data dir and, if you ran e2e, `data/e2e`, `test-results/` and `playwright-report/`. Before deleting `data/e2e`, list its project ids (`select id from projects`) and remove only those folders from `./evidence-store/`.
- `next-env.d.ts` is regenerated by whichever Next process ran last; restore it if you want zero churn.
- Report the gates you ran, the actual output you checked (prompts, competitors, numbers), and what you did not verify.
