---
paths:
  - "src/lib/db/**"
  - "drizzle/**"
  - "drizzle.config.ts"
  - "scripts/bootstrap*.ts"
  - "scripts/start.ts"
  - "scripts/db-reset.ts"
  - "scripts/clean-room.ts"
  - "src/lib/events/**"
  - "src/lib/client/**"
  - "src/lib/http/**"
  - "src/lib/cn.ts"
  - "src/app/api/projects/*/events/**"
  - "next.config.ts"
  - "next-env.d.ts"
  - "tsconfig.json"
  - "package.json"
  - "postcss.config.mjs"
  - "eslint.config.mjs"
  - ".env.example"
  - "playwright.config.ts"
  - "vitest.config.ts"
  - "tests/setup.ts"
  - "tests/integration/event-stream-shutdown.test.ts"
  - "tests/integration/full-pipeline.test.ts"
  - "tests/e2e/**"
  - "src/app/globals.css"
  - "src/components/ui/**"
---

# Platform: database, events, build and runtime guardrails

## Database and migrations
- **Driver.** better-sqlite3 (synchronous) + drizzle. `getDb()` opens `$SUN_DATA_DIR/sun.db` (WAL, `busy_timeout`) and applies `./drizzle` migrations, resolved from the current working directory, the first time a process uses it. There are no transactions and no foreign keys.
- **Lazy access.** Never call `getDb()`/`dataDir()`/`evidenceDir()` at module top level. Tests set `SUN_DATA_DIR` in `beforeAll`, and an eager call would open the real `./data/sun.db` and cache it on `globalThis`.
- **Route-policy seed.** `route_policies` rows come only from `scripts/bootstrap-inline.ts`, which runs on predev, build, start, db:init, tests and clean-room. A missing row reads as disabled, so every run on that route becomes `policy_disabled`. Bootstrap re-upserts the seed every time, overwriting manual edits.
- **Bootstrap migrates `./data` by default.** `npm run dev`, `npm run build`, `npm start` and `npm run db:init` all run it against `$SUN_DATA_DIR`, which defaults to the user's live DB. A pending migration in the code gets applied the next time any of them runs without `SUN_DATA_DIR`.
- **Adding a migration:**
  0. If the user's `npm run dev` is running, tell them **before** you save `schema.ts`. HMR loads the new table definition, and because drizzle selects every declared column, every query on that table fails until they restart, which also applies the migration to `data/sun.db`.
  1. Edit `schema.ts`.
  2. From the repo root on Node 20, run `npx drizzle-kit generate --name <slug>`.
  3. Review the new SQL, the snapshot and the `_journal.json` entry.
  4. Apply and exercise it on an **isolated** data dir first: `SUN_DATA_DIR=<scratch>/data SUN_EVIDENCE_DIR=<scratch>/evidence npm run db:init`, then run the tests and an isolated app.
  5. Use a copy of the user's DB only with their OK.
  6. Tell the user their own server applies it on its next restart. Don't restart it yourself.
- **Migration rules.**
  - Never edit an applied migration. The migrator only compares journal `when` against the applied `created_at`, so edits silently never run.
  - Never run `drizzle-kit push`, `migrate` or `studio`; the config points at `./data`.
  - For data backfills, append statements after `--> statement-breakpoint`, or use `generate --custom`.
  - Interactive rename prompts hang non-TTY shells. Split the rename or hand-write the SQL.
- **Restart after migrating.** A process that has already opened the DB won't see new columns until it restarts; hot-reloaded code fails with `no such column`.

## Events and SSE
- **Write through `appendEvent()` only.** It assigns the per-project sequence atomically. That sequence is the SSE id and the client cursor, so a gap or duplicate is permanent for an open page.
- **No async gap in the SSE route.** It must read the backlog and subscribe live with no real async I/O in between; the DB stays synchronous for this reason. Keep `Cache-Control: no-cache, no-transform` and `X-Accel-Buffering: no`, otherwise Next's compression buffers frames.
- **Keep the 2.5 s poll.** The always-on poll in `use-project-events.ts` fixed a React StrictMode race that left progress logs permanently empty. It also recovers events from other processes and after HMR.
- **Names are a contract.** Add new types to `SunEventType`. Clients match type strings **and payload keys** (the Understand progress rail renders straight from payloads), so renaming either silently breaks pages.
- **Shutdown.** `open-streams.ts` closes streams on SIGINT/SIGTERM, and the events route returns 503 while shutting down. Keep this (`tests/integration/event-stream-shutdown.test.ts`), or `next start` hangs on Ctrl+C while a tab is open.

## Routes and background jobs
- **Handler shape.** Handlers wrap everything, including `Schema.parse(await req.json())`, in `withErrorHandling(async () => …)`. A ZodError then becomes 400 `{error:{code,message}}`.
  - Use `jsonError(404, "<thing>_not_found", "<message>")` for missing rows.
  - Domain guards should use 409, creates 201, and background starts 202 `{status:"started"}`. Some older guards return 400 codes.
  - New domain error classes must be added to `respond.ts`, or they become a redacted 500. A malformed JSON body also becomes a 500 today.
  - Some handlers are not thin (profile PATCH, prompt-sets PATCH, measure); don't copy them.
- **Background jobs.** Use `void job().catch(err => appendEvent(projectId, "<an event type the page consumes>", {error}))`. Persist partial progress to tables so a refresh can resume. There is no queue and no boot reconciliation.
- **Client modules stay server-free.** Modules imported by client components must not reach server code: `profile/schema`, `profile/taxonomy`, `providers/engines`, `prompts/types`, `client/*` and `cn` must not import `getDb`/`fs`.

## Next.js, build and tooling
- **Dist dirs.** Dev uses `.next`, `npm run build`/`npm start` use `.next-build`, Playwright uses `.next-e2e`. Two Next processes must never share one: a build while the user runs `npm start` breaks their server. Never run bare `next build`/`next start`. When :3000 is busy and no `PORT` is set, `next dev` warns and moves to another port while still using `.next`; with `PORT` set, it exits instead.
- **Watcher ignores.** Keep `data/` and `evidence-store/` in `watchOptions.ignored` (`next.config.ts`). Tailwind makes the root a context dependency, so SQLite and evidence writes caused a recompile loop that dropped SSE mid-crawl.
  - The array replaces Next's default ignores.
  - The setting is webpack-only, so don't switch dev to Turbopack without re-solving this.
  - Add any new runtime-written directory inside the repo.
- **Server packages.** Native or heavy server packages go in `serverExternalPackages` (`better-sqlite3`, `playwright`). `outputFileTracingRoot` is pinned to cwd because a parent directory has a `package-lock.json`.
- **Generated files.** Starting Next with any distDir rewrites `next-env.d.ts` and can append that distDir's types to `tsconfig.json`, which is a build input for `scripts/start.ts`. Stale generated route types break `tsc` after a route deletion until regenerated.
- **Commands that write files:**
  - `npm run dev`/`build`/`start`/`db:init` run the bootstrap (migrations + route-policy upsert) on `./data` unless `SUN_DATA_DIR` is set.
  - `npm run build` writes `.next-build` and rewrites `next-env.d.ts`.
  - `npm run typecheck` writes `tsconfig.tsbuildinfo`.
  - `npm test` rewrites `BENCHMARK_REPORT.md` and `benchmarks/business-profile/expected/fixture-report.md`, and needs internet.
  - Playwright writes `test-results/`, `playwright-report/`, `data/e2e/sun.db`, and crawl text into the shared `./evidence-store` (no `SUN_EVIDENCE_DIR`). Its dev server loads `.env.local` keys.
- **Scripts.** `tsx` scripts and vitest don't load `.env.local` (except `probe-openai.ts`). Scripts default to `./data` **and** `./evidence-store`, so set both `SUN_DATA_DIR` and `SUN_EVIDENCE_DIR` for experiments, and run from the repo root.
- **Styling.** Tailwind v4 tokens live in `globals.css` `@theme`, and only some shades exist (e.g. `danger-100/500/600`, no `-50`). A missing shade silently renders nothing. Compose classes with `cn()` and reuse `src/components/ui`.
- **No git, so snapshot.** Before risky edits, e.g. `tar -czf <scratch>/snap.tgz --exclude node_modules --exclude '.next*' --exclude data --exclude evidence-store .` (quote the glob). Never share `.env.local` or `data/sun.db`: `provider_credentials` stores keys in plaintext (the Search Console row is encrypted with a key derived from `GOOGLE_OAUTH_CLIENT_SECRET`).
