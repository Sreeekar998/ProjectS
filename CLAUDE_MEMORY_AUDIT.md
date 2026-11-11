# Claude persistent context audit

Audited 2026-11-09 from a Claude Code session in the desktop app (Code tab), working directory `project-sun-phase2-app-v2`. Read-only: no instruction or memory file was changed.

**How this was verified.** `/memory` and `/context` are interactive terminal commands. They aren't available in this desktop session, so I couldn't run them. I checked three things instead:
- what the harness actually injected into this session (shown to me as `<system-reminder>` blocks);
- the files on disk;
- environment and settings keys (names only).

Labels used below:
- **Found**: exists on disk.
- **Loaded**: its text was in my context when the session started.
- **On demand**: loads only when triggered.
- **Not accessible**: I couldn't see it.

---

## 1. CLAUDE.md files

| File | Status | Notes |
|---|---|---|
| `project-sun-phase2-app-v2/CLAUDE.md` (154 lines, 26.6 KB, ≈6.5k tokens, modified 2026-10-15) | **Found, loaded** (full text) | The one project instruction file. Covers the map, hard lines, pipeline table, commands and the decisions that override the spec. |
| `~/.claude/CLAUDE.md` (user level) | Not found | No user-wide instructions exist. |
| `~/CLAUDE.md`, `Sun Project/CLAUDE.md` (ancestors) | Not found | |
| Nested `CLAUDE.md` under `src/`, `docs/`, `tests/`, `scripts/` and similar folders | Not found | |
| `CLAUDE.local.md` | Not found | |
| Managed or enterprise policy file (`/Library/Application Support/ClaudeCode/`) | Not found | |

## 2. Auto memory

Claude Code keys auto memory by the folder a session starts in. **There are two memory folders for Project Sun**, and a session loads only one of them.

| Memory folder | Files | Loaded in this session? |
|---|---|---|
| `~/.claude/projects/-Users-sreekarreddy-Sun-Project-project-sun-phase2-app-v2/memory/` (sessions started in the app folder) | `MEMORY.md` + 13 files | **Index loaded** (`MEMORY.md`, 13 one-line pointers, ≈500 tokens). The 13 files themselves are **on demand**: I read them only because this audit asked. |
| `~/.claude/projects/-Users-sreekarreddy-Sun-Project/memory/` (sessions started in the parent `Sun Project` folder) | `MEMORY.md` + 13 files | **Not loaded.** Invisible to any session started in the app folder unless someone reads it by path. |

Auto memory is enabled: no disabling env var or setting was found, and the index was injected. `~/.claude/settings.json` holds only `skipWorkflowUsageWarning`.

**App-folder memory (loaded index):**

| File | Type | Content |
|---|---|---|
| `project-sun-audit-constraints` | project | No hardcoding; no Actions layer; which pages may change; login rules (2026-09-10/11) |
| `verify-real-output` | feedback | Read the real prompts, runs and UI and iterate; passing tests isn't done |
| `project-sun-audit-reports` | reference | Links to the round 1 and round 2 audit artifacts (2026-09-11) |
| `chatgpt-gemini-only-labels` | feedback | UI names engines only as ChatGPT and Gemini |
| `kill-servers-end-of-response` | feedback | Keep :3000 running in the Terminal panel (2026-10-15; replaces the old kill rule) |
| `email-tone-no-as-discussed` | feedback | Email drafting tone |
| `project-sun-final-interview` | project | Managing Partner interview prep doc; which CV is correct |
| `interview-answer-style` | feedback | Short, leadership-led interview prep |
| `mac-spreadsheet-tooling` | project | openpyxl + `formulas`; no LibreOffice or Excel |
| `mac-media-tooling` | project | ffmpeg, mlx-whisper, Quartz |
| `project-sun-cost-model` | reference | Cost workbooks, how tokens were measured, headline figures (6 KB) |
| `project-sun-actions-cost-study` | reference | Actions-layer cost doc and unit rates (2026-10-08) |
| `workbook-delivery-rules` | feedback | Timestamped names; "Project", not "Project Sun"; no Velova; open in Sheets |

**Parent-folder memory (not loaded):**
- active project directory;
- Node ≥ 20.11;
- never bare `next build`;
- paid OpenAI approval scope;
- Gemini free-tier limits;
- ChatGPT consumer-collection decision;
- Measure workspace build (2026-09-15);
- Landscape slowness cause;
- Measure vs Velova report;
- UI design system (2026-09-15);
- isolated dev-server copies;
- vendor latency sources;
- **Actions research 2026-10-24**, the most recent strategic item anywhere in memory.

## 3. Other instruction and context files

| File | Status | Notes |
|---|---|---|
| `.claude/rules/*.md` (7 files, 936 lines, ≈140 KB) | **Found, on demand** | Each has a `paths:` frontmatter, so it loads when Claude reads or edits a matching file. None loaded in this session (I opened no matching source file myself). Files: `analysis-measure`, `collection`, `journey-ui`, `landscape`, `platform`, `prompts`, `website-intelligence`. |
| `.claude/skills/sun-*` (6 skills, ≈49 KB) | **Found; names and descriptions loaded, bodies on demand** | `sun-validate`, `sun-profile-quality`, `sun-landscape-quality`, `sun-prompt-quality`, `sun-collection-lanes`, `sun-measurement-change`. A body loads only when the skill is invoked. |
| `.claude/launch.json` | Found, not context | Preview server entries (`project-sun`, `sun-verify`, `sun-verify-vendors`, `sun-verify-measure`, `sun-deck`). Read by preview tools, not by the model. |
| `.claude/settings.json`, `.claude/settings.local.json`, `.mcp.json` | Not found | No project permissions, hooks or MCP config. |
| `AGENTS.md` (2026-09-15) | **Found, not loaded** | A Codex copy of an older CLAUDE.md (uses `.Codex/` paths). Claude Code doesn't read `AGENTS.md`. |
| `.agents/skills/sun-*` (2026-09-14) | Found, not loaded | Codex copies of the six skills; older than `.claude/skills`. |
| `Sun Project/.claude/launch.json` | Found, not context | The parent folder's preview config (used for isolated dev-server copies). |
| `docs/*.md` (e.g. `KNOWN_ISSUES.md`, `MEASURE_WORKSPACE_DESIGN.md`, `ONBOARDING_INTELLIGENCE.md`, the decision memo) | Found, on demand | CLAUDE.md points to them; they're read only when referenced. |
| `README.md`, `IMPLEMENTATION_STATUS.md` | Found, on demand | CLAUDE.md flags both as partly stale. |
| Past session transcripts (`~/.claude/projects/*/*.jsonl`) | Found, not loaded | Raw history; not part of memory. |

**Not accessible:** claude.ai artifacts and Claude Docs that memory links to (round 1 and 2 audits, interview prep, the Actions research doc). I can open them only on request. I also couldn't check the desktop app's internal context accounting (the `/context` breakdown).

## 4. What I remember: a summary of the persistent context

**Product.** Project Sun measures one business's visibility in AI answers. The journey is Understand → Landscape → Prompts → Measure, with collection as a console inside Measure. It is a local-first, single-operator Next.js 15 + SQLite app for an interview and demo setting. Scope stops at Measure: there's no Actions layer in the product, though research and costing for one exist in memory.

**Hard lines** (CLAUDE.md and memory):
- No hardcoded brands, competitors, prompts or metric values in `src/`.
- Website text is untrusted data.
- The app never drives chatgpt.com or gemini.google.com. Answers come from collection providers in signed-out sessions: Oxylabs first, then cloro, Bright Data and Decodo. No provider is ever called "licensed".
- The UI names only "ChatGPT" and "Gemini" and never a vendor. Gemini is hidden by default.
- The model-API and by-hand collection lanes were retired on 2026-09-14.
- Honest numbers: a gap is not absence; a zero denominator shows `—`; partial runs say "so far".

**Approvals and spend:**
- Paid OpenAI for Understand and Prompts (2026-09-13) and Landscape (2026-09-15).
- Topics run on gpt-5.6-terra (2026-09-16).
- Collection stays within provider free tiers. cloro Lite at $30 is pre-approved if needed.

**Architecture conventions:**
- Versioned, append-only artefacts.
- Deliberate version bumps (`ANALYSIS_VERSION`, `METRIC_POLICY_VERSION` and similar).
- zod routes wrapped in `withErrorHandling`.
- In-process background jobs, which don't recover after a restart (only collection does).
- Rules-only analysis.

**Working style the user wants:**
- Read the real output and iterate.
- Push back once, then implement.
- Report honestly.
- Never touch the user's `data/sun.db` or :3000 server.
- Keep :3000 running in the Terminal panel.
- Use isolated data dirs and ports.
- There's no git, so snapshot before wide edits.
- Other agents edit concurrently.

**Non-engineering preferences:**
- Email tone.
- Interview-prep style and the correct CV.
- Workbook naming and delivery.
- Local Mac tooling for spreadsheets, media and PDFs.

## 5. What gets loaded in a new session

| Starts in `project-sun-phase2-app-v2` | Starts in `Sun Project` (parent) |
|---|---|
| App `CLAUDE.md` (full) | No CLAUDE.md (the parent has none). The app's CLAUDE.md loads only once files inside the app are read |
| App-folder `MEMORY.md` index | Parent-folder `MEMORY.md` index (different content) |
| Skill names and descriptions from `.claude/skills` | None of the app's skills (they live under the app folder) |
| Rules: on demand, by path | Rules: on demand, if app files are opened |
| Never: `AGENTS.md`, `.agents/`, docs, individual memory files, the other memory folder | Never: the app-folder memory |

Rough always-loaded cost from the app folder: CLAUDE.md ≈6.5k tokens plus the memory index ≈0.5k tokens. If all seven rule files were triggered in one session, they would add about 35k tokens.

## 6. Memory gaps: important context that isn't preserved, or isn't loaded

1. **The parent-folder memory is effectively orphaned.** From the app folder you can't see:
   - the Actions research direction (2026-10-24);
   - the isolated dev-server rule: a second `next dev` on the real tree fights :3000 over `next-env.d.ts`. CLAUDE.md doesn't mention it; only `rules/platform.md` does, and only on demand;
   - the Measure workspace and UI design-system history;
   - Gemini free-tier limits;
   - vendor latency sources.
2. **No `user`-type memory.** Nothing records who the user is (a Tech Lead candidate building the Project Sun demo), their role, or where the engagement stands after the interview stage.
3. **No "current state" pointer.** Memory and CLAUDE.md say little about what happened after 2026-10-15. The last DB activity was 2026-10-15; the last memory write was 2026-10-24 (parent folder). Not recorded anywhere:
   - 14 legacy collection runs still marked `active`;
   - one crawl stranded as `running`;
   - `npm run lint` failing because of `data/deck/.next`.
4. **The `sun-deck` server and `data/deck` aren't documented.** There's a launch entry, but no doc says what the deck is for.
5. **Gemini re-enable criteria** aren't recorded: the conditions for turning `SUN_ENGINES=chatgpt,gemini` back on.
6. **Engagement artefacts outside the repo** (`Sun Project/Phase 2`, the Velova and Peec captures, `research_notes/`) are only referenced from the parent-folder memory.

## 7. Conflicts, duplicates and outdated items

| # | Item | Problem | Current truth (code / CLAUDE.md) |
|---|---|---|---|
| 1 | `project-sun-audit-constraints` (app memory) | Says consumer ChatGPT/Gemini are observed **manually only** and automated lanes use provider APIs. Its "Round 2: UI only on Measure + manual console" rule is also dated | Superseded on 2026-09-14: API and manual lanes retired, collection providers adopted |
| 2 | `chatgpt-gemini-only-labels` (app memory) | Mentions "asked by hand", gpt-oss-120b behind the ChatGPT lane, and says key-setup text may name Groq or Google AI Studio | Lanes retired; since 2026-09-16 no vendor is named anywhere in the app (copy-guard test) |
| 3 | `kill-servers-end-of-response` (app memory) | The file name says "kill"; the body says keep :3000 running | The body is correct; only the name is misleading |
| 4 | `AGENTS.md` vs `CLAUDE.md` | AGENTS.md (Sep 15) says leave no servers running, Landscape paid "not approved", lists Gemini/Groq/Cerebras lanes, "Collect automatically", `.Codex/` paths | CLAUDE.md (Oct 15) is current. AGENTS.md is stale for Codex agents |
| 5 | `.agents/skills` vs `.claude/skills` | Codex copies are older. `sun-collection-lanes` still describes the Gemini/OpenAI/Groq lanes and manual capture; `sun-measurement-change` and `sun-prompt-quality` differ too | `.claude/skills` is current |
| 6 | Parent memory `paid-openai-approval-scope` | Its index line says "Landscape stays free unless user approves"; its body says not to move Landscape to Terra | Landscape is approved and paid; topics run on gpt-5.6-terra (`src/lib/llm/routing.ts` topics route) |
| 7 | Parent memory `chatgpt-consumer-collection-decision` | Says the memo lives outside the repo and recommends keeping `chatgpt_manual` as the source of truth | The memo is now `docs/CHATGPT_CONSUMER_COLLECTION_DECISION_MEMO.md`; manual capture is retired |
| 8 | Parent memory `landscape-slowness-cause` | "Paid Landscape is the pending fix" | Done on 2026-09-15 |
| 9 | CLAUDE.md, intro step 4 | Lists providers as "Bright Data, cloro, Decodo" | Oxylabs is first (the same file's hard lines; `src/lib/oxylabs` exists). The pipeline table's `lib/{brightdata,cloro,decodo}` also omits `oxylabs` |
| 10 | CLAUDE.md, Commands | "Lint: 0 errors" | `npm run lint` reports 537 errors, all from `data/deck/.next` build output; source alone has 0 errors and 116 warnings |
| 10b | CLAUDE.md, Pipeline table and "Docs you can't trust" | Lists a Methodology view; exports as `csv\|json`; says the comments in `providers/credentials.ts` and `route-policy-seed.ts` are misleading; says cloro charges 6 credits per Gemini answer | No Methodology tab (method is a section of the Report); exports are `csv`, `brands-csv`, `sources-csv`, `json`; both comments are now accurate; the runner budgets 7 credits for Gemini (`collection/runner.ts` LANES) |
| 11 | Duplicates | Node version, never bare `next build`, keep :3000 running, paid approvals and no-vendor-names each appear in CLAUDE.md **and** in memory | Harmless while they agree. Items 1, 2 and 6 show how copies drift apart |
| 12 | Scope of memory | Personal preferences (email tone, interview, Mac tooling) are stored in project-scoped memory | They don't follow the user to other projects |
| 13 | `project-sun-audit-reports` | Points to 2026-09-11 audit artifacts | Those predate collection providers, the Measure rebuild and the UI redesign |

## 8. Recommendations: where context should live

| Put it in | What belongs there | Concrete actions (for you to approve; none taken) |
|---|---|---|
| **`CLAUDE.md`** (always loaded; shared with every agent; stays true of the code) | Product hard lines, architecture map, commands, safety rules for the live server and DB, conventions, decisions that override the spec. Keep it under ~150 lines and move details to rules or docs | Fix items 9, 10 and 10b. Add the `next-env.d.ts` isolated-server rule. Add a one-line pointer to `PROJECT_STATUS.md` for current state |
| **Auto memory** (per user; per start folder; index always loaded) | Dated user decisions and approvals, user preferences and corrections, pointers to external artifacts, facts about this machine. One fact per file; delete superseded ones | Merge the still-valid parent-folder memories into the app folder (or vice versa) so one index holds everything. Rewrite or delete items 1, 2 and 6–8. Rename item 3. Add a `user` memory (role and engagement stage). Run `consolidate-memory` periodically |
| **Project docs** (`docs/`, on demand) | Status, design contracts, research memos, known issues, cost models | Keep `PROJECT_STATUS.md` and `docs/KNOWN_ISSUES.md` current and date them. Retire or banner `IMPLEMENTATION_STATUS.md` |
| **`.claude/rules`** (path-scoped) | Area guardrails that matter only when touching that code | Already well organised. Keep incident-named rules here rather than in CLAUDE.md |
| **`AGENTS.md` and `.agents/`** | Codex's copy | Regenerate from CLAUDE.md and `.claude/skills` (path rename only), or reduce AGENTS.md to "read CLAUDE.md", so the two never diverge again |
| **User-level `~/.claude/CLAUDE.md`** (currently absent) | Preferences that apply to every project: email tone, interview style, Mac tooling | Move the non-Project-Sun memories here or into user-scope memory |

For long sessions: CLAUDE.md and the memory index survive context compaction because they're re-injected; conversation details don't. So write any decision made mid-session to memory (dated) or to a doc before the session ends.
