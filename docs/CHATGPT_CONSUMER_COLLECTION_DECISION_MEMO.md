# Project Sun — ChatGPT consumer-answer collection: decision memo and design reference

**Status:** research and architecture analysis only. Nothing was implemented, no repository file was changed, no provider account was created, no credit was purchased, no paid request was run. This file lives outside the repo (`Phase 2/`) so it can be moved into `project-sun-phase2-app-v2/docs/` once its recommendation is confirmed.

**Date of evidence:** 2026-09-14. Provider pricing, docs and terms change often; every claim below carries a grade and a link so it can be re-checked.

**Evidence grades used throughout:** **VERIFIED** (read on an official docs/pricing/terms page, a court record or reputable legal reporting, or observed in the repo or its live SQLite database) · **PROVIDER CLAIM** (marketing or sales copy, not corroborated by payload, contract or independent evidence) · **INFERENCE** (my reasoning from verified facts) · **UNKNOWN** (could not be established; appears in the vendor checklist).

---

## 1. Executive conclusion

**There is no licensed way to automate the ChatGPT consumer interface.** None of Oxylabs, Bright Data, DataForSEO or cloro claims any authorization from OpenAI, and each one's contract makes the *customer* responsible for the target site's terms and requires the customer to indemnify the provider, with no indemnity back (VERIFIED, §5 and §6). The hiring partner's premise that a provider "carries the risk" is true only for the *operational* burden (browsers, proxies, CAPTCHAs, bans, UI drift). Legally, using a provider changes *which* theory applies to Project Sun (secondary theories instead of direct breach of OpenAI's terms), not *whether* one applies. The July 2026 ruling in *Reddit v. SerpApi, Oxylabs, AWMProxy and Perplexity* kept the **buyer** of scraped data in the case on conspiracy and anti-circumvention claims (VERIFIED, §5.3), which is the concrete form of that residual exposure.

**What the providers actually observe is real, but specific.** Bright Data, Oxylabs, DataForSEO's LLM Scraper and cloro all drive the real chatgpt.com web interface in a browser (VERIFIED for all four from their own docs and payloads, §5), as a **signed-out anonymous visitor**, in a **fresh conversation**, from a **proxy in the requested country**, with **web search forced or permitted**, and with **the model chosen by OpenAI and often not reported** (cloro VERIFIED; the other three INFERENCE from payloads, with logged-in/out officially UNKNOWN). That is a legitimate consumer surface: Ahrefs, Semrush, Peec, Profound and Otterly all state publicly that they collect ChatGPT this way (§5.6). It is not the same surface as a signed-in Free user with memory, custom instructions and the Free tier's GPT-5.6 Luna default, and no vendor documents which model or UI variant an anonymous session receives.

**Budget is not the discriminator.** Every consumer-UI candidate covers 90 observations for **$0** on a free tier or trial (Bright Data 5,000 records/month with no card; cloro 500 credits/month with no card; Oxylabs 769 rendered-result trial with no card; DataForSEO $1 trial credit) and the paid entry points are $10 to $50 (§7). Fidelity evidence, session disclosure and terms are what separate them.

**Recommendation in one paragraph.** Keep the existing by-hand `chatgpt_manual` route as the **source of truth** for anything labelled "ChatGPT" in the demo (it is the only route whose session conditions can be attested and the only automated-or-manual route with no contractual conflict). Add **one** third-party signed-out consumer route, **Bright Data's ChatGPT Scraper API first, cloro as the fallback candidate**, behind a budget-bounded fidelity experiment (§11) and the vendor checklist (§12), and label it honestly as *"ChatGPT, signed-out web session collected by <vendor>"*, never as "licensed". Relabel the current OpenAI, Groq and Cerebras lanes as *model/API benchmarks* and stop pooling them with consumer observations in Measure; if an authorized automated route is wanted, move `openai_api` to the Responses API with web search on `gpt-5.6-luna` (the model the Free tier FAQ names as the Free default) for roughly one cent per answer (VERIFIED pricing, §4). Keep Gemini in scope only as it is today (manual plus a clearly labelled API lane); do not spend budget on a Gemini provider in Phase 2.

---

## 2. Current-state architecture (verified against the repo and the live DB, read-only)

### 2.1 Routes that exist

| Route id | Kind | What actually answers | Engine scope | Search / sources as stored | Live DB rows in `provider_responses` |
|---|---|---|---|---|---|
| `openai_api` | automated, **paid** | `gpt-5-nano` via OpenAI Chat Completions, no tools, no web search, Project Sun system prompt, `max_completion_tokens` 6000 (`src/lib/openai/client.ts`) | chatgpt | `searchState=not_applicable`, `sourcesCaptureState=none_present`, `sourceUrls=[]` | 90 (model stored as `gpt-5-nano-2025-08-07`); avg latency 17.6 s |
| `cerebras_free_api` | automated, free tier | `gpt-oss-120b` (OpenAI open-weight) on Cerebras, no search | chatgpt | same | 0 (all 30 prompt runs `failed` with `http_402`) |
| `groq_free_api` | automated, free tier | `openai/gpt-oss-120b` on Groq, no search | chatgpt | same | 167 |
| `gemini_free_api` | automated, free tier | `gemini-flash-lite-latest`; asks for Google Search grounding, falls back to plain | gemini | **every stored row has `searchState=off`, `sourcesCaptureState=none_present`, `sourceUrls=[]`** — grounding has never succeeded on the current key | 388 |
| `chatgpt_manual` | by hand | operator asks at chatgpt.com, pastes answer and sources, asserts capture states | chatgpt | operator-asserted | 1 (the only stored observation with a source URL) |
| `gemini_manual` | by hand | same for gemini.google.com | gemini | operator-asserted | 0 |
| `consumer_browser_automation` | policy row only | — | — | — | disabled (`enabled=false`) |
| `licensed_partner_collector` | policy row only | — | — | — | disabled; "Future production route, contractually authorized. Seam only; not implemented." |

Default automated selection with no route list: one keyed route per engine in `COLLECTION_ROUTES` order (`gemini_free_api`, then for ChatGPT `openai_api` → `cerebras_free_api` → `groq_free_api`) — `createCollectionRun` in `src/lib/collection/orchestrator.ts`.

### 2.2 What a stored observation carries

Populated in practice: `providerExperience`, `route` (`api` | `consumer_app`), `method` (`automated` | `manual`), `visibleModelMode` (served snapshot only for OpenAI; the *requested* alias for Gemini and gpt-oss), `searchState`, `accountTier` (**hard-coded `free_tier` on every automated lane, including the paid OpenAI lane**; `unknown` on manual), `locale`, `responseText`, `sourceUrls`, `sourcesCaptureState`, `answerCaptureState`, `rawHash`, `latencyMs`, `observedAt`, `adapterVersion`, `policyVersion`.

Never populated (columns exist; no code writes them; the manual-capture API does not accept them): `observerRegion` (null on all 650 rows), `observerRegionSource` (always `unknown`), `intendedMarket`, `sessionProfile`, `inlineCitationUrls`. The vocabulary that would fill them already exists and is well designed: `collection/evidence-quality.ts` separates `none_present` from `not_captured`, `complete` from `truncated`/`unknown`, and defines a tri-state `SessionProfile` (signedIn, accountTier, temporaryChat, personalizationDisabled, customInstructionsDisabled, freshConversation); `collection/geography.ts` separates intended market from execution origin.

### 2.3 Runner shape

`src/lib/collection/runner.ts`: one in-process lane per route, configured in `LANES` (concurrency, a request-window or token-budget pacer, retry caps). Each lane calls `runAutomatedPromptRun`, which calls `adapterFor(route).run(...)`, a **synchronous request/response** contract returning `{ok, text, model, sources?, searched?, truncated, rate}` inside the client's own timeout (OpenAI 90 s, Cerebras 60 s, Groq 45 s, Gemini 20 s). The `jobs` table exists and is unused; there is no polling abstraction and no webhook receiver. Progress lives on `globalThis`; a restart loses it and the next Collect fails orphaned `running` rows as `interrupted`.

### 2.4 Downstream

- After insert, `normalizeProviderResponse` (legacy v1 parser) and `analyseObservationById` run synchronously. Analysis is pure and rule-based and reads only `responseText` and `sourceUrls`; `inlineCitationUrls` is never read.
- Measure (`src/lib/measure/engine.ts`) builds scopes `combined` plus one per `engineOf(providerExperience)`. `ROUTE_ENGINE` maps `openai_api`, `groq_free_api`, `cerebras_free_api` and `chatgpt_manual` all to `chatgpt`; unknown ids fall back to a name regex (`/chatgpt|openai|gpt/i` → chatgpt) or become their own scope.
- `comparability()` in `measure/service.ts` already declares a change in `providerExperiences` a break ("provider surfaces changed").
- Citation metrics count only `complete` and `none_present`; automated ungrounded lanes write `none_present`, so they contribute zeros to citation denominators.

### 2.5 Labelling today

- Console (`observation-console.tsx`): every automated ChatGPT-family route is headlined **"ChatGPT · Asked automatically"**; a footnote says automatic answers "come straight from OpenAI's and Google's models rather than the ChatGPT and Gemini apps".
- Measure method notes (`ROUTE_METHOD` in `measure/page.tsx`), collapsed by default: "ChatGPT, asked automatically: each question goes to OpenAI's gpt-5-nano model through the OpenAI API, without web search."
- Hard rule in `CLAUDE.md` and `.claude/rules/collection.md`: "Never automate the consumer ChatGPT or Gemini apps." This binds the app's own code; the `licensed_partner_collector` row is the intended seam for a *contractually authorized* third party. As §5 shows, no such party exists today, so that seam's premise cannot currently be satisfied and its name should not be reused for a provider route.

### 2.6 Corrections to the brief

The brief's summary is accurate. Three refinements: (1) `accountTier` is not merely unused, it is wrong on the paid lane; (2) the Gemini lane has never produced a grounded answer on the current key (0 of 388), so **no automated route in the live DB has ever returned a source URL**; (3) the Cerebras lane is currently unusable (all 30 stored prompt runs failed with `http_402`; a parallel edit to the collection rules on 2026-09-14 at 16:59 says Groq and Cerebras now map 402 to `billing_required`, which pauses the lane instead of failing rows), so the effective ChatGPT-family fallback chain is OpenAI → Groq. Note: several collection files (`orchestrator.ts`, `runner.ts`, `observation-console.tsx`, `groq/client.ts`, `.claude/rules/collection.md`) were edited by another agent at 16:57–16:59 during this research; the route list, lane configuration, console labels and the hard-coded `accountTier` were re-verified against the edited files and are unchanged.

---

## 3. Why the current API approach is insufficient (the exact fidelity problem)

What ChatGPT Free is today (VERIFIED, OpenAI Help Center "ChatGPT Free Tier FAQ", updated last month, https://help.openai.com/en/articles/9275245): "Free users have access to GPT-5.6 Luna"; Free users can "Search the web and obtain up-to-date information"; "Ads may appear in the Free tier in certain countries." Temporary Chat now has a personalised/non-personalised switch (VERIFIED, https://help.openai.com/en/articles/8914046-temporary-chat-faq: "Non-personalized temporary chats do not use memory, custom instructions, or plugins"). Logged-out chatgpt.com (observed in-browser 2026-09-14) offers a chat box with no login and the footer "ChatGPT is AI. By using it, you agree to our Terms & Privacy Policy."

| Axis | ChatGPT consumer (signed-in Free) | `openai_api` today | Effect on Measure |
|---|---|---|---|
| Model | GPT-5.6 Luna default; "Think" routing where offered | gpt-5-nano | brand recall and ranking come from a different, smaller model |
| Product layer | OpenAI's undisclosed system prompt, formatting, safety layer, ads in some countries | Project Sun's own three-line system instruction | register, list length, hedging differ |
| Retrieval | web search available and commonly auto-triggered for shopping/local queries; source panel and inline citations | none (`searched=false`, `sourceUrls=[]`) | **every citation metric is structurally zero** on this route |
| Personalisation | memory, custom instructions, history unless a non-personalised Temporary Chat | none | API is *cleaner* than a typical user, not dirtier |
| Geography | account country, IP and locale shape search results and ads | none; `observerRegion` null | a UAE prompt answered from nowhere in particular |
| Sampling | one conversation, one turn | same | n=1 directional either way |

Independent corroboration of where the gap is largest (VERIFIED as a published experiment, not re-run): Promptwatch's same-day comparison found the ChatGPT UI returned sources on 84% of prompts versus 26% for the API, with 25.6% overlap of cited sources (https://promptwatch.com/blog/ui-vs-api-for-ai-search-visibility, 17 Aug 2026).

So the API answer is not useless. For **Discovery presence**, the model-family overlap is real and the answers are usable as a benchmark. For **citations** it measures nothing, and for **ranking and hedging** it measures a different product layer. The honest label is "OpenAI model benchmark (API)", which is what the collapsed method notes already say and what the console headline "ChatGPT · Asked automatically" does not.

---

## 4. Research method and evidence grading

- **Repository:** every file named in the brief plus the collection API routes, manual-capture, outcome and retry routes, `measure/policy.ts`, `client/api.ts`, `analysis/*`, tests and fixtures; read-only SQL against `data/sun.db` (row counts, field population, latencies, failure codes).
- **Primary web sources read directly:** OpenAI Terms of Use, Help Center (Free tier, Temporary Chat, release notes), API pricing, web-search tool docs and the `chat-latest` model page; chatgpt.com logged-out page and robots.txt; cloro docs and terms; DataForSEO help-center, pricing and terms; Bright Data product page, free-tier page and MSA; Oxylabs product, pricing and GitHub reference client; SearchApi and Decodo docs; ScrapeBadger product, pricing and terms; the open-source GetCito GEO tool that the hiring partner's list appears to come from.
- **Six parallel research agents** (Oxylabs, Bright Data, DataForSEO, cloro, alternatives, legal), each instructed to quote and grade. Their decisive claims were spot-checked against the primary URL before use; where a claim could not be re-verified it is graded accordingly.
- **Not done:** no accounts, no purchases, no requests to any provider, no prompts submitted to chatgpt.com, no repository changes. Two documentation hosts (`docs.brightdata.com`, `docs.scrapebadger.com`) did not resolve from this environment; Bright Data docs were read through a mirror by the research agent and cross-checked against the product page and MSA, which did resolve.

---

## 5. Provider research

### 5.1 Bright Data — ChatGPT Scraper API

- **Product** (VERIFIED): Web Scraper API "AI search scrapers", dataset "ChatGPT Search – Search by Prompt", `dataset_id = gd_m7aof0k82r803d5bjm`. Docs https://docs.brightdata.com/products/scrapers/chatgpt/introduction ; API reference https://docs.brightdata.com/api-reference/scrapers/ai-search-apis/chatgpt-search-by-prompt ; product https://brightdata.com/products/web-scraper/chatgpt ; pricing https://brightdata.com/pricing/web-scraper. Sync `POST /datasets/v3/scrape` "accepts up to 20 inputs and waits up to 1 minute", otherwise returns 202 with a `snapshot_id`; async `trigger` → `progress/{id}` → `snapshot/{id}`; snapshots downloadable for 30 days; polling "takes 30 seconds to several minutes".
- **Inputs** (VERIFIED): `url` must be `https://chatgpt.com/`; `prompt` (≤4,096 chars, "Each prompt triggers a separate ChatGPT search query"); `country` ("Country from which to perform the search", 212 codes published on GitHub); `web_search` (default true; "This field is a permission, not a guarantee"; "the Web Search button is enabled and the model may click it"); `additional_prompt` (a follow-up turn); `require_sources`.
- **Outputs** (VERIFIED as documented): `answer_text`, `answer_text_markdown`, `answer_html` (full page HTML), `model`, `web_search_triggered`, `citations[]`, `search_sources[]`, `links_attached[]`, `recommendations[]`, `country`, `is_map`, `shopping_visible`, `prompt_sent_at` ("the exact time the scraper clicks 'Send'"). No screenshot. In the three records captured in the docs in September 2026 the `model` field is **null**.
- **What it is** (VERIFIED): browser automation of chatgpt.com — "handles proxies, browser automation, and parsing"; "OpenAI changes how its pages are served, and the … collectors are updated to match"; returned URL `https://chatgpt.com/?q=…`. Product FAQ "sending automated requests to the ChatGPT website" (PROVIDER CLAIM). Captured answers contain UI widget text ("Map data is currently unavailable") and, in one US example, Russian labels — INFERENCE that locale and UI state leak.
- **Session:** "Each request starts a fresh ChatGPT session. There is no memory or context carried over" (VERIFIED). Logged-in versus logged-out: **not documented** (UNKNOWN); the AUP forbids "Collection of nonpublic information (i.e data behind login)" and the deep link is `?q=`, so INFERENCE: signed-out. Search cannot be forced, only permitted; `web_search_triggered` reports what happened. Model not selectable; which model answers is UNKNOWN.
- **Geography:** `country` gives location-targeted results (a JP example returned Japanese map widgets with `web_search_triggered:false`); execution origin is not disclosed in the output; residential proxies are a PROVIDER CLAIM.
- **Pricing** (VERIFIED): every new account gets "5,000 free credits per month (~$7.50 value)", "No credit card, no promo code, no commitment", one credit per delivered record for the Web Scraper API, credits renew monthly and are forfeited, hard stop (https://docs.brightdata.com/general/account/billing-and-pricing/free-tier). Pay-as-you-go "$1.50 per 1,000 records" (September 2026); "add as little as $10 to get started"; Scale plan $499/month. Failed records: **conflict** — product page "no charges for failed deliveries" versus FAQ "Records that fail because the input was incorrect are still billed"; billing for a `require_sources` error is UNKNOWN. KYC is documented for residential proxies, not for the Web Scraper API (INFERENCE: none for this product).
- **Terms** (VERIFIED, MSA "Last Updated June 16, 2026", https://brightdata.com/license): §3.5 Client "shall not use the Services in violation of applicable law or regulations or any third party rights"; §8 Client defends Bright Data against third-party claims; no assignment of data ownership; §10.2 "Bright Data may retain data it has collected or delivered to its Clients and may use it for its own purposes in its sole discretion"; §3.8 no distribution or sale of Data "in order to offer a similar or competitive product" (internal storage, analytics and display are not restricted — INFERENCE); §1.2 compliance review "may include a Know Your Client process"; §11.4 Israeli law, Tel Aviv courts. **No OpenAI authorization is claimed anywhere** (VERIFIED absence).
- **Reliability signals:** the sibling Grok scraper has been blocked since June 2026 ("renewed blocking issue on Grok's side"); a Bright Data MCP pull request of 9 Sep 2026 notes the Grok tool "still POSTs a billable trigger, and still returns nothing"; `model:null` and embedded widget error text in current ChatGPT captures. "99.95% success rate" is a PROVIDER CLAIM.

### 5.2 Oxylabs — Web Scraper API, `source: "chatgpt"`

- **Product** (VERIFIED): https://developers.oxylabs.io/api-targets/llms-and-ai/chatgpt (the older `/scraping-solutions/…/targets/chatgpt` URL is a 404); product page https://oxylabs.io/products/scraper-api/serp/chatgpt ; pricing https://oxylabs.io/products/scraper-api/web/pricings ; reference client https://github.com/oxylabs/chatgpt-scraper. `POST https://data.oxylabs.io/v1/queries`, Basic auth. **Push-Pull only:** "Realtime and Proxy Endpoint are not available for chatgpt, gemini, and perplexity sources." JavaScript rendering is forced ("Do not include `render` in your request payload"). Batch up to 5,000 prompts.
- **Inputs** (VERIFIED): `prompt` (<4,000 chars), `search` (bool), `parse`, `geo_location` ("Specify a country to route the request from" — the proxy exit country), `callback_url` (recommended), `browser_instructions`. No model, device or conversation parameter.
- **Outputs** (VERIFIED): `llm_model` (docs sample `gpt-5-5`; a July 2025 sample file shows `gpt-4o`), `response_text`, `markdown_text`, `markdown_json`, `citations[]` (URLs carry `?utm_source=chatgpt.com`), `search_queries[]`, `links[]`, `shopping_products[]`, `ads[]`, `parse_status_code`; raw page HTML retrievable via the job's `results?type=raw` link. No screenshot. Result URL `https://chatgpt.com/?model=auto`.
- **What it is:** product FAQ "simulates real user interactions with ChatGPT UI" (PROVIDER CLAIM, but explicit); the published payload sends no cookies and receives fresh `__Host-next-auth.csrf-token` and `oai-did` cookies — INFERENCE: signed-out; officially UNKNOWN. Docs warn that "The composition of response may vary depending on whether the query was made from a desktop or mobile device", with no device control.
- **Mechanics** (VERIFIED): jobs are `pending` / `done` / `faulted`; "You are not charged for any faulted jobs"; retry count and maximum job duration are not documented (UNKNOWN); rate limit on the free trial is 10 jobs/s (3 rendered); domain throttling to 1 req/s if success drops below 40%; one published job took about 36 s.
- **Pricing** (VERIFIED): free trial "Up to 2,000 results", which the help-center table converts to **769 JS-rendered results**, "you will not be asked to enter your payment information"; trial duration is **not stated on any official page** (UNKNOWN). **No pay-as-you-go.** Micro plan $49/month (+VAT) with 37,692 rendered results at $1.35/1K. Any 2xx/4xx page is billable even when parsing fails; 5xx/6xx are free. **KYC:** "Every customer has to answer a KYC questionnaire to get access to our solutions" and "Only 75% of customers are approved" (https://oxylabs.io/kyc-and-safety); whether the questionnaire gates trial activation is UNKNOWN.
- **Terms** (VERIFIED, General Conditions 25 Sep 2024, https://oxylabs.io/legal/oxylabs-general-conditions ; AUP https://oxylabs.io/legal/oxylabs-acceptable-use-policy): GC 4.2.6 the customer must comply with "any relevant terms of service"; GC 8.1 "You are solely responsible for the Data you Access by using the Services"; AUP forbids use that would "Be in violation of relevant terms of use/service or other legal documents" and collection of non-public data; GC 7.3 customer indemnifies Oxylabs for "any and all claims by any third party in connection with the Customer's use of Services"; Oxylabs' own indemnity (7.1) covers only IP infringement by its software; liability cap two months' fees; silent on ownership and retention of scraped data; Lithuanian law. **No OpenAI authorization**; the product FAQ says "Oxylabs recommends reviewing the target's Terms of Service and getting legal advice before scraping."
- **Reliability and legal signals:** changelog 14 Jul 2026 — search requests "now retry citation extraction automatically, roughly doubling citation coverage" (INFERENCE: citations were previously missing on a large share of results); 23 Jun 2026 output-envelope change; the network status page (`uptime.oxylabs.io`) did not resolve on 2026-09-14. Oxylabs is a named defendant in *Reddit v. SerpApi et al.* (S.D.N.Y. 1:25-cv-08736), with its motion to dismiss stayed (VERIFIED via reporting, §5.7).

### 5.3 DataForSEO — two different ChatGPT products

DataForSEO sells both an API-backed product and a scraper, and the distinction matters (VERIFIED, help center updated 27.02.2026, https://dataforseo.com/help-center/what-is-llm-scraper-api-and-what-data-does-it-provide):

- **ChatGPT LLM Responses** (`/v3/ai_optimization/chat_gpt/llm_responses/…`): "sends requests directly to the official LLM API providers, such as OpenAI or Anthropic" and "the output reflects what the underlying model produces, not what appears in the platform's interface." API-shaped parameters (`model_name` with dated snapshots, `temperature`, `top_p`, `max_output_tokens`, `system_message`, `web_search`, `web_search_country_iso_code`); cited URLs carry `?utm_source=openai`. **This is an OpenAI-API proxy with a markup and is excluded as a consumer route.** Pricing: Live $0.0006 per task plus the OpenAI cost (a documented gpt-4.1-mini + web-search sample cost $0.029631).
- **ChatGPT LLM Scraper** (`/v3/ai_optimization/chat_gpt/llm_scraper/…`, docs https://docs.dataforseo.com/v3/ai_optimization-chat_gpt-llm_scraper-overview/, launched 19 Aug 2025): "LLM Scraper directly scrapes the web interface of an LLM that users see and interact with"; the overview says it retrieves "results from ChatGPT Search mode"; the response's `check_url` is `https://chatgpt.com/?q=…&hints=search` (VERIFIED) — the anonymous entry point with **search forced on by the URL** (INFERENCE: signed-out). Inputs: `keyword` (≤2,000 chars), `location_code` (required, own list; mechanism undocumented — UNKNOWN), `language_code`, `force_web_search`, `expand_citations`, `priority`, webhooks. Outputs: markdown, typed items (`chat_gpt_text` with `sources`, tables, navigation lists, images, local businesses, products, and `chat_gpt_ad` with `is_rendered`), `search_results` (URLs with `utm_source=chatgpt.com`), `fan_out_queries`, `brand_entities`, plus a raw-HTML endpoint. No model field. "It lacks the ability to customize LLM's behavior and conversation memory."
- **Mechanics** (VERIFIED): Live is synchronous, "up to 120 seconds" in docs (the pricing page says 90 s), 30 concurrent Live tasks per account; Standard is task_post → tasks_ready/task_get or webhooks, "up to 45 minutes"; results retrievable 30 days; no documented automatic retry.
- **Pricing** (VERIFIED): Scraper Standard **$0.0012**, Priority **$0.0024**, Live **$0.004** per results page (https://dataforseo.com/pricing/ai-optimization/llm-scraper); "Our minimum payment amount is $50" and funds never expire (https://dataforseo.com/help-center/minimum-payment); "Register now and get $1 for free unlimited testing" (same page, dated 11.04.2023 — PROVIDER CLAIM as to current availability); "We charge your balance only when you get a result" (FAQ, PROVIDER CLAIM).
- **Terms** (VERIFIED, "UPDATED: 12 JUNE, 2026", DataForSEO OÜ, Estonia, https://dataforseo.com/terms-of-service): 7.1 SERP data "shall not be used to compete with or adversely affect the business interests of the search engine providers"; 7.2 the customer will "indemnify, defend, and hold harmless DataForSEO from any and all claims … including any use of SERP data that violates the terms of service or legal rights of the search engine providers." The terms say **nothing** about ownership, storage, analytics, display or resale of returned data, nothing about retention, and never mention OpenAI or ChatGPT; governing law is not stated (UNKNOWN). **No OpenAI authorization.**
- **Reliability signals:** seven additive schema changes to the Scraper in twelve months (ads, products, brand entities, fan-out, expanded citations) — active adaptation to UI change; docs warn "no guarantee web sources will be cited" and "annotations may return empty".

### 5.4 cloro — identity confirmed as cloro.dev

- **Identity** (VERIFIED): **cloro.dev** (cloro.ai and cloro.io redirect there); "Cloro Incorporation Ltd.", address "168 Triq San Kristofru Valletta VLT 1467 Malta" (privacy page); terms "governed by … the laws of Ireland" (§13.1); "Founded October 2025"; API launched 9 Oct 2025 per changelog. Founder/CEO Ricardo Batista; a paid-newswire press release (25 Aug 2026) claims "250 paying customers" (PROVIDER CLAIM). No funding disclosed; "1-10 employees" (snippet). Ruled out: cloro.com (parked), cloro.app (Spanish pool-maintenance SaaS), Clorox. The company is eleven months old; its GitHub organisation has 21 repos with at most two stars each; review sites covering it are affiliate-linked (cloro runs a 40% affiliate programme).
- **Product** (VERIFIED, https://cloro.dev/docs/api-reference/endpoint/monitor-chatgpt): `POST https://api.cloro.dev/v1/monitor/chatgpt`; `prompt` (1–10,000 chars), `country` (required), `state` (US only), `include.markdown`/`html` (free), `include.rawResponse`/`searchQueries`/`ads`/`shopping` (+2 credits), `legacy` (desktop UI instead of mobile-web), `disableWebSearch`. Response: `text`, `markdown`, `html` (URL to the rendered page, 24-hour expiry), `model`, `searchQueries`, `sources[]{position,url,label,description,datePublished,footnote}`, `citationPills[]`, `shoppingCards`, `inlineProducts`, `entities`, `ads[]{brand,cards,rendered}`, `rawResponse` (SSE events). No model parameter; "cloro does not return image screenshots". Async task/batch/webhook endpoints exist; async results are deleted after 24 hours.
- **What it is** (VERIFIED, the clearest documentation of any vendor): "cloro does not call the ChatGPT API. Each request runs through a real browser session against ChatGPT's web interface, routed through a proxy"; "Response fidelity: the `html` field is the actual page the provider rendered; `result.*` fields are extracted from that page." Its reference repo describes "getting past Cloudflare JA4 TLS fingerprinting and Turnstile".
- **Session** (VERIFIED, https://cloro.dev/docs/guides/providers): "cloro uses logged-out sessions — no account of any kind, free or paid — so responses reflect what an unauthenticated visitor sees." "cloro does not control which model the provider uses; that is the provider's decision" (an older note says ChatGPT "cycles between gpt-5-3 and gpt-5-3-mini"). `result.model` is "Empty on responses served through OpenAI's mobile-web format", which since 26 Aug 2026 "serves 98% of responses". "This endpoint enables ChatGPT's web search mode on every request"; `disableWebSearch: true` means "ChatGPT then searches only when it decides to, which for most prompts means no search." **Contradiction to resolve in writing:** cloro's own blog (21 Aug 2026) lists cloro as "Managed auth — handles login, session cookies, and 2FA persistence"; the docs are the operative statement.
- **Geography** (VERIFIED): "each request routes through a proxy in the country (and, for US requests on supported providers, the state) you specify — the AI provider sees that location's anonymous user"; "`country` controls geo-routing, not language"; published caveat that "A model trained heavily on US English content sometimes defaults to US-centric references even when served from another region." Proxy type and where the browsers run are UNKNOWN. Login-wall risk acknowledged: "If a provider begins requiring login in a region, requests from that region will fail until the provider relaxes the requirement" (Copilot login-wall incidents of 5–6 Jul 2026 lasted 16 and 18 hours).
- **Mechanics:** sync, "Typical response time is 30–45 seconds" (PROVIDER CLAIM); automatic retries up to 10 attempts; 5-minute maximum; free-tier concurrency 1; 429 without `Retry-After`; success "Above 99% on average" (PROVIDER CLAIM); **empty-but-`success:true` answers are billed** and must be retried by the client; SLA §1.5 expressly excludes "target platform unavailability or changes (including interface updates, access controls, or anti-scraping measures)". Status page shows three ChatGPT degraded events between 6 Aug and 12 Sep 2026 and an ongoing Perplexity major outage on 13–14 Sep.
- **Pricing** (VERIFIED, https://cloro.dev/pricing/): **Free 500 credits per month, 1 concurrent job, no card**; no pay-as-you-go and no top-ups; Lite $30/month (37,500 credits), Hobby $100, Starter $250, and up; credits do not roll over; "We do not offer refunds." ChatGPT costs 5 credits async or 7 sync, plus 2 for any include extra. Failed extractions are not charged; cancelled requests are.
- **Terms** (VERIFIED, https://cloro.dev/terms/ 19 Jul 2026; DPA https://cloro.dev/dpa/): §7.5 "You shall ensure that your use of the Services for automated data gathering activities (a) does not violate the applicable terms of service, robots.txt directives, or other access restrictions of the target website or platform, except to the extent that Applicable Laws expressly permit you to do so"; §10.1 "Customer shall defend, indemnify, and hold harmless cloro … arising out of or related to: (a) Customer's use of the Services, including any data accessed, collected, or processed by Customer through the Services"; §6.2 "you retain all rights, title, and interest in and to your data and any content that you submit or retrieve through your use of the Services" — cloro does not restrict storage, analysis or display (INFERENCE). Retention of sync prompts and responses on cloro's side is UNKNOWN. **No OpenAI authorization**; the README says "cloro reads publicly visible responses from its own sessions … check your own jurisdiction and terms."

### 5.5 Additional serious candidates (none claims OpenAI authorization; all signed-out)

| Vendor | Evidence it is the consumer UI | Country | Search control | Citations | Free allowance / first paid step | Notable terms or risk |
|---|---|---|---|---|---|---|
| **SearchApi.io** `engine=chatgpt` (launched 2 Jul 2026; https://www.searchapi.io/docs/chatgpt-api) | strong artifacts: `request_url` = chatgpt.com/?q=…, `html_url` "full event stream (auth tokens redacted)", `response_metadata.model` (`gpt-5-5`), `is_web_search_performed` | **none** (VERIFIED absence) | `web_search` bool | character-indexed `citations`, `reference_links`, `web_results` | 100 free requests / Developer $40 per month (10K) | "Legal Protection Guarantee" applies only from the $100 per month Production tier and only to SearchApi's own collection, capped $2M; customer indemnifies for the rest. Category risk: *Google v. SerpApi* (filed Dec 2025) |
| **Decodo** (ex-Smartproxy) `target=chatgpt` (https://help.decodo.com/docs/web-scraping-api-chatgpt) | "A browser session renders the chat interface"; `headless=png` returns a **screenshot** — the only vendor offering one | `geo` | `search` bool (default false) | `citations`, `search_queries`, `links`, `llm_model` | 2K free requests (unit accounting unclear) / $19 per month | customer indemnifies; async integration "recommended"; premium proxy pool |
| **Scrape.do** ChatGPT Scraper | "scrapes the public chatgpt.com web product"; "No login, no cookies, no session state"; model = "Whichever model chatgpt.com serves to anonymous users" | `geoCode` | `model` param, no toggle | `content_references`, `raw_sse` | 1,000 credits = 40 calls / $29 per month | prompt cap 1,024 chars |
| **ScrapingBee** ChatGPT API | indirect ("does not access … authenticated user sessions"); `add_html` returns rendered page | `country_code` | `search` bool | inline links only, no citations array | 1,000 credits ≈ 66 calls / $19 per month | user "solely responsible" for target terms; indemnifies |
| **ScrapeBadger** (https://scrapebadger.com/chatgpt-scraper) | "Requests go to the consumer product anonymously — no OpenAI account and no OpenAI API key" | `country` | `web_search` auto/force/off | character-indexed citations, `web_search_triggered`, `model` | 1,000 credits = 50 asks / $10 top-up (≈$0.003 per ask); failures free | terms (22 Apr 2026): EU governing law, customer indemnifies, "no claim of ownership over data"; very new operator; its Apify wrapper shows 2 users |
| **Apify** official `apify/chatgpt-search-scraper` | weak (copy-paste artifact in listing) | none | none | `sources`, `queryFanOut` | $5 per month free credit; $3 per 1K | Apify terms: actors "are not part of the Services provided by Apify"; customer indemnifies |
| **Nimble**, **Scrapeless** | thin or ambiguous documentation | — | — | — | free tiers; pricing inconsistent or unpublished | treat as experiments only |

Excluded with reason: **SerpApi** (no ChatGPT engine; roadmap issue says "might be out of scope"; defendant in *Google v. SerpApi*); **NetNut and ProxyJet** (domains seized by the FBI on 2 Jul 2026 in the Popa botnet action — do not use); HasData (Google AI Mode only); Zyte, ScraperAPI, ZenRows, Crawlbase, Serper, SOAX, Thordata (no ChatGPT endpoint); Scrapfly (DIY guide only, with its own warning that "OpenAI's consumer terms can restrict automated access to chatgpt.com"); DataForSEO LLM Responses and any Apify actor that wraps the OpenAI API (not consumer output).

### 5.6 How GEO platforms say they collect ChatGPT (independent context)

Quoted from their own pages (VERIFIED as statements; none of these platforms discloses its vendor): Peec AI — "Peec AI uses UI scraping rather than APIs for most tracked engines — it simulates real user interactions through the actual web interface" (https://peec.ai/ai-instructions). Profound — "Profound captures AI responses directly from the consumer browsing experience rather than from model APIs" (https://www.tryprofound.com/ai-instructions). Otterly — "posting questions and prompts through the website of the AI search (like chatgpt.com etc)"; "we only use API for Claude tracking" (https://help.otterly.ai/how-otterlyai-collects-data). Semrush AI Visibility Toolkit — "Prompt responses are captured from real requests and not via any APIs of LLMs"; it tracks "the latest model of ChatGPT in search mode" (https://www.semrush.com/kb/1607-semrush-ai-visibility-data). Ahrefs Brand Radar — "All prompts run through the free, publicly available web interfaces of ChatGPT, Gemini, Perplexity, Copilot…" (https://ahrefs.com/blog/brand-radar-methodology/). Scrunch — "a mix of browser automation and official platform APIs". Evertune — base models via paid API, "ChatGPT Search" via the consumer app. AthenaHQ — no public disclosure. The open-source GEO tool GetCito (MIT; 414 stars; https://github.com/ai-search-guru/getcito-worlds-first-open-source-aio-aeo-or-geo-tool) integrates "BrightData, Oxylabs, Olostep, Cloro, and DataForSEO for scraping" with a config example `chatgpt:brightdata:online` — very likely the origin of the hiring partner's vendor list.

The industry norm is therefore exactly what these vendors sell: an anonymous, signed-out, search-mode ChatGPT session. That is useful for comparability with competitors' numbers; it does not make the surface "what a normal signed-in user sees", and none of the platforms claims OpenAI's permission either.

### 5.7 Legal and contractual defensibility (risk analysis, not legal advice)

**OpenAI's consumer terms** (VERIFIED, effective 1 Jan 2026, https://openai.com/policies/terms-of-use/): users may not "Automatically or programmatically extract data or Output", may not "circumvent any rate limits or restrictions or bypass any protective measures or safety mitigations", and may not "Use Output to develop models that compete with OpenAI". Users "own the Output". Business users indemnify OpenAI. The logged-out chatgpt.com composer carries the notice "By using it, you agree to our Terms & Privacy Policy" (observed), which is a stronger assent notice than the account-holder-framed terms that failed for Meta in *Meta v. Bright Data*; whether it binds a signed-out visitor is a *Berman v. Freedom Financial*-style conspicuousness question (INFERENCE). `chatgpt.com/robots.txt` disallows `/backend-anon/conversation$` and `/backend-anon/sentinel/*` for all agents (VERIFIED) — not a DMCA technological measure (*Ziff Davis v. OpenAI*, S.D.N.Y. Dec 2025) but evidence that automated anonymous conversation is not consented to.

**OpenAI's API terms** (VERIFIED, Services Agreement effective 1 Jan 2026, https://openai.com/policies/business-terms/): §3.3(f) prohibits extracting data "other than as permitted through the Services"; §4.1 the customer owns Output; storage, analysis, benchmarking and display of API output are not restricted (INFERENCE from absence). The API route is the only automated route with no contractual conflict.

**Case law that frames the risk** (VERIFIED via court records or reputable legal reporting): *Van Buren* (2021) and *hiQ v. LinkedIn* (9th Cir. 2022) — access to public pages is not "without authorization" under the CFAA, but hiQ still ended in a $500,000 consent judgment and injunction on contract and fake-account grounds; *Meta v. Bright Data* (N.D. Cal., Jan 2024) — logged-off scraping of public data was not "use" under Meta's terms; *X Corp v. Bright Data* — dismissed May 2024, amended access-based claims allowed Nov 2024, settlement in principle June 2025 (terms confidential); *Amazon v. Perplexity* (9th Cir., 4 Aug 2026) — when a user directs an agent with their own credentials "it was the user who 'accessed' Amazon's computers", CFAA weak, and the court "expressly leaves open other claims, including breach of terms of service and contract- or tort-based theories"; *Google v. SerpApi* (N.D. Cal., 20 Jul 2026) — DMCA circumvention claims largely dismissed because search results are not a copyrighted work behind the measure; **Reddit v. SerpApi, Oxylabs, AWMProxy and Perplexity** (S.D.N.Y. 1:25-cv-08736, order of 31 Jul 2026) — Judge Engelmayer "predominately" denied SerpApi's and Perplexity's motions to dismiss, sustaining §1201(a)(1)(A) claims against both, §1201(a)(2) against SerpApi, and New York civil conspiracy against both, on the theory that "SerpApi provided a product capable of circumventing Google's access controls, and Perplexity AI paid for it" (https://www.law360.com/articles/2508228/reddit-ai-data-scraping-case-mostly-survives-dismissal ; https://www.mlex.com/mlex/articles/2508237/us-judge-allows-reddit-anti-circumvention-claims-vs-perplexity-ai-serpapi); Oxylabs' motion is stayed.

**The four distinctions the brief asked for:**

1. *Technically capable of collecting the consumer UI:* Bright Data, Oxylabs, DataForSEO Scraper, cloro, SearchApi, Decodo, Scrape.do, ScrapingBee, ScrapeBadger — yes (VERIFIED or strongly evidenced).
2. *Contractually authorized by OpenAI:* **none** (VERIFIED absence across every terms page, docs page and marketing page read).
3. *Assumes operational burden:* all of them — browsers, proxies, Cloudflare/Turnstile, bans, UI drift (cloro even names "a maintenance team to chase ChatGPT's anti-automation updates").
4. *Makes Project Sun's use defensible:* **none does by contract.** Every reviewed provider (Oxylabs GC 7.3, Bright Data MSA §8, DataForSEO 7.2, cloro §10.1, ScrapingBee, Decodo, Apify, ScrapeBadger) makes the customer responsible for lawful use and requires the customer to indemnify the provider; none indemnifies the customer for target-site claims. SearchApi's "Legal Protection Guarantee" is the only provider-side backstop found, and it starts at $100 per month and excludes the customer's "use, storage, redistribution, or commercialization of data".

What a provider genuinely changes: Project Sun never touches chatgpt.com, so it is not in privity with OpenAI for that collection; its exposure moves from direct breach of terms to secondary theories (tortious interference, conspiracy, §1201(a)(2) "providing" theories) that require knowledge and inducement — the theories now being tested against Perplexity as a *buyer* in the Reddit case (INFERENCE anchored in that ruling). Providers' own acceptable-use policies forbid logged-in and non-public collection (Oxylabs AUP; Bright Data AUP "data behind login"), so any vendor that *did* run logged-in accounts would be breaching its own AUP — another reason to insist on a written statement of session conditions.

**Downstream use.** OpenAI's terms do not restrict a party who obtained Output from storing, analysing or displaying it; the Sharing & Publication Policy (2022, incorporated by the terms) asks for human review, attribution and an "AI-generated" label when Output is shared. The U.S. Copyright Office's January 2025 report treats machine-determined expression as unprotected, so answer text itself is not anyone's copyrighted work; snippets quoted from cited pages are "Third Party Output" and should be displayed short and attributed. Brand prompts and answers are normally not personal data; a DPA is prudent, not essential.

**Practical exposure at this scale (INFERENCE):** for a single operator running 30–90 prompts, OpenAI's realistic remedy against the *provider* is IP blocking or UI hardening, and against Project Sun essentially nil; the litigated cases all involve industrial volumes and resale. The real risks are **supply interruption** (a login wall or UI change stops the route with no SLA recourse — cloro's SLA excludes exactly this) and **mislabelled evidence** (calling an anonymous search-mode session "what a ChatGPT user sees").

---

## 6. Comparison of serious options

| Criterion | Bright Data | cloro | Oxylabs | DataForSEO LLM Scraper | SearchApi | Official OpenAI API (chat-latest / gpt-5.6-luna + web_search) | Manual `chatgpt_manual` |
|---|---|---|---|---|---|---|---|
| Consumer-UI evidence | VERIFIED (browser automation; page HTML; click timestamp) | VERIFIED (real browser; rendered HTML; SSE) | PROVIDER CLAIM explicit + payload evidence | VERIFIED (Search-mode scrape; raw HTML) | strong artifacts | not consumer (authorised model access) | the reference |
| Session disclosed | fresh session VERIFIED; signed-out UNKNOWN | **signed-out VERIFIED** (blog contradiction to reconcile) | signed-out INFERENCE only | anonymous INFERENCE only | anonymous INFERENCE | stateless by construction | fully attestable (Temporary Chat, non-personalised) |
| Model reported | field exists; null in Sep 2026 captures | empty on ~98% | `llm_model` populated (gpt-5-5) | none | `model` populated | exact snapshot | badge visible to operator |
| Search control / observation | permission + `web_search_triggered` | forced on by default; `disableWebSearch`; no boolean | `search` toggle; `search_queries` | forced by entry URL; `force_web_search` | `web_search` bool + `is_web_search_performed` | tool call visible; `sources` list | observed |
| Citations | citations, search_sources, links_attached | sources with positions, citationPills | citations (coverage historically poor) | per-item sources, search_results, ads rendered | character-indexed | `url_citation` annotations + full `sources` | copied by operator |
| Geography | `country` (212); origin undisclosed | proxy country + US state; origin undisclosed | `geo_location` proxy exit | `location_code` required; mechanism undocumented | **none** | `user_location` (market hint, not origin) | operator-declared |
| Screenshot / HTML | HTML | HTML URL (24 h) | raw HTML | raw HTML | event stream | n/a | operator screenshot |
| Legal posture | customer indemnifies; provider may retain data; Israeli law; favourable logged-out precedent | customer indemnifies; customer owns retrieved content; Irish law; SLA excludes anti-scraping | customer indemnifies; Lithuanian law; defendant in Reddit case | customer indemnifies (SERP wording); ToS silent on LLM data | LPG only ≥$100/mo | **no conflict** (Services Agreement) | **no conflict** (human use) |
| Reliability signals | mature vendor; sibling Grok blocked; UI leakage | 11-month-old company; 3 degraded events in 6 weeks | mature; status page unreachable; citation-coverage fix Jul 2026 | mature; schema churn | engine 10 weeks old | stable | operator time |
| Latency / mechanics | sync ≤60 s for ≤20 inputs, else async poll | sync 30–45 s | **async only** (callback/poll) | Live ≤120 s sync; Standard ≤45 min | sync 7–18 s | 5–30 s sync | 2–3 min per prompt |
| Fits current runner | needs job/poll adapter (or blocking adapter with 5-min cap) | yes | needs job/poll adapter | Live: yes; Standard: job adapter | yes | yes (today's adapter shape) | exists |
| Cost 30/60/90 (§7) | $0 / $0 / $0 | $0 / $0 / $30 | $0 / $0 / $0 (trial) | $0.04–0.14 on $1 trial; else $50 deposit | $0 / $0 / $40 | ≈$0.5–3 / 1–6 / 1.4–10 | $0 + 1–4.5 h |
| Onboarding friction | none (no card) | none (no card) | **KYC questionnaire**; trial length unknown | $50 deposit after $1 trial | none | key already present | none |

---

## 7. Concrete cost model

Assumptions: 30/60/90 *successful* observations require 36/72/108 attempts (20% retry and failure allowance). "Signup cash" is money that must be paid before the first request; "consumption" is what the volume would cost at list price if no free allowance applied.

| Option | Signup cash | Free allowance | List unit price | Consumption 30 / 60 / 90 | Cash actually needed 30 / 60 / 90 | First paid step |
|---|---|---|---|---|---|---|
| Bright Data ChatGPT Scraper API | $0 (no card) | 5,000 records per month | $1.50 per 1K | $0.05 / $0.11 / $0.16 | **$0 / $0 / $0** | $10 top-up (PAYG) |
| cloro | $0 (no card) | 500 credits per month, 1 concurrent | 5 credits async, 7 sync (+2 extras) | 180 / 360 / 540 credits async | **$0 / $0 / $30** (async; sync exceeds 500 at 60) | Lite $30 per month, non-refundable |
| Oxylabs Web Scraper API | $0 (no card; KYC questionnaire) | 769 rendered results (duration unstated) | $1.35 per 1K (Micro) | $0.05 / $0.10 / $0.15 | **$0 / $0 / $0** on trial | Micro $49 per month + VAT, no PAYG |
| DataForSEO ChatGPT LLM Scraper | $0 for the $1 trial credit (claimed); **$50 minimum deposit** otherwise | $1 credit | $0.0012 Std / $0.0024 Priority / $0.004 Live | $0.04–0.14 / $0.09–0.29 / $0.13–0.43 | **$0** on trial credit; **$50** if the trial is unavailable | $50 deposit, non-expiring |
| SearchApi.io | $0 | 100 requests | $4 per 1K (Developer) | $0.14 / $0.29 / $0.43 | $0 / $0 / **$40** (Developer plan needed above 100) | $40 per month |
| ScrapeBadger | $0 | 1,000 credits = 50 asks | ≈$0.003 per ask | $0.11 / $0.22 / $0.32 | $0 / $10 / $10 | $10 top-up |
| Decodo | $0 | 2K requests (accounting unclear) | $1.50 per 1K | ≈$0.05 / $0.11 / $0.16 | ≈$0 | $19 per month |
| OpenAI API, gpt-5.6-luna + web_search (official, not consumer) | already funded | — | ≈$0.013 per answer (300 in / 1,500 out tokens at $0.20/$1.20 per 1M, one $0.01 search call, ~6K search-content tokens) | ≈$0.5 / $0.9 / $1.4 | same | — |
| OpenAI API, chat-latest + web_search (official, not consumer) | already funded | — | ≈$0.09 per answer (same token assumptions at $5/$30 per 1M) | ≈$3.2 / $6.5 / $9.7 | same | — |
| Manual `chatgpt_manual` | $0 | — | operator time 2–3 min per prompt | 60–90 min / 2–3 h / 3–4.5 h | $0 | — |

Pricing sources: Bright Data free tier and PAYG (https://docs.brightdata.com/general/account/billing-and-pricing/free-tier ; https://brightdata.com/products/web-scraper/chatgpt); cloro (https://cloro.dev/pricing/ ; https://cloro.dev/docs/guides/billing); Oxylabs (https://oxylabs.io/products/scraper-api/web/pricings ; help-center results table); DataForSEO (https://dataforseo.com/pricing/ai-optimization/llm-scraper ; https://dataforseo.com/help-center/minimum-payment); SearchApi (https://www.searchapi.io/pricing); ScrapeBadger (https://scrapebadger.com/pricing); Decodo (https://decodo.com/scraping/web/pricing); OpenAI (https://developers.openai.com/api/docs/pricing).

**Budget verdict:** the $30–$50 testing budget is more than sufficient for any single provider, and sufficient for the validation experiment in §11 run against **two** providers plus the official API control, with money left over. Where cash is required it is a plan minimum ($30 cloro, $40 SearchApi, $49 Oxylabs, $50 DataForSEO deposit), not consumption. What the budget cannot buy is legal authorization, a session-condition warranty or an SLA against OpenAI changing the interface.

---

## 8. Architecture implications

### 8.1 What fits without redesign

- **The `provider_responses` row can carry a provider observation honestly**, using existing columns: `route = "consumer_app"`; `visibleModelMode` from the vendor's model field (null → `"unknown"`); `searchState` from `web_search_triggered` (Bright Data, SearchApi) or inferred `on` when sources/search queries are non-empty and `unknown` otherwise (cloro, DataForSEO); `sourceUrls` from the vendor's citations array; `inlineCitationUrls` from inline/attached links where the vendor separates them (Bright Data `links_attached`, cloro `citationPills`); `sourcesCaptureState = complete` when the vendor returned a citations array, `none_present` when `web_search_triggered=false`, `not_captured` when the vendor reports a sources error; `answerCaptureState = complete` (vendors return whole answers) unless the payload signals an empty or partial answer; `latencyMs`, `adapterVersion`, `policyVersion` as today. The raw vendor JSON (and HTML where returned) goes to the evidence store next to the text; `rawHash` stays a hash of the text so existing tooling is unaffected.
- **Analysis needs no change.** It reads `responseText` and `sourceUrls` only.
- **Comparability is already handled.** A new route id changes `providerExperiences`, which `comparability()` reports as a break.

### 8.2 What must change

1. **Three new enum values, not new columns:** `method = "automated_partner"` (distinct from `automated` API calls and `manual`); `observerRegionSource = "provider_declared"`; `accountTier = "signed_out"`. This keeps the evidence-quality vocabulary honest instead of reusing `free_tier`.
2. **Populate the five dormant fields** for the new route: `observerRegion` (the country sent), `observerRegionSource = provider_declared`, `intendedMarket` (the prompt's market from the prompt-context snapshot), `sessionProfile` (`{signedIn:false, accountTier:"none", temporaryChat:null, personalizationDisabled:true, customInstructionsDisabled:true, freshConversation:true, notes:"<vendor statement, dated>"}` — only after the vendor confirms these in writing, otherwise `null`), `inlineCitationUrls`.
3. **Route policy:** do not enable `licensed_partner_collector` — its note says "contractually authorized", which is false for every vendor. Add a new row per vendor (e.g. `chatgpt_brightdata_web`, `chatgpt_cloro_web`) with `enabled: "optional"`, `requiresCard: false`, `retentionDays` from the vendor (30 for Bright Data snapshots, 1 for cloro), `officialSourceUrl` pointing at the vendor's docs, and a `notes` string that states plainly: signed-out chatgpt.com session collected by a third party; not authorized by OpenAI; customer indemnifies vendor.
4. **Engine grouping and Measure scopes.** `engineOf` should still map the new route to `chatgpt`, but Measure needs a second dimension: **surface** (`consumer` vs `api`). Pool `chatgpt_manual` and the partner route under "ChatGPT" only after the §11 experiment passes; until then the partner route is its own scope ("ChatGPT, signed-out web via <vendor>"). Move `openai_api`, `groq_free_api` and `cerebras_free_api` out of the consumer pool into an "OpenAI model benchmark (API)" scope. This is the one place where UI work is unavoidable: the console `ROUTE_LABEL` headline, the measure page `ROUTE_METHOD` and the engine filter.
5. **Runner: a job abstraction is needed for Bright Data and Oxylabs, not for cloro.** cloro's sync endpoint (30–45 s) and DataForSEO Live (≤120 s) fit today's adapter contract with a raised timeout and concurrency 1. Bright Data's sync endpoint waits at most one minute for up to 20 inputs and otherwise returns a `snapshot_id`; Oxylabs is push-pull only. Two options: (a) a *blocking adapter* that submits and polls inside `run()` with a 5-minute cap and lane concurrency 1–2 — adequate for a 30-prompt demo, no new tables; (b) a *job lane* that submits a batch, records job ids in the unused `jobs` table, polls on the SSE tick and materialises `provider_responses` as results arrive — the right shape for production and for restart safety, which today's in-memory runner lacks. Recommendation: (a) for the validation phase, (b) before any recurring collection. Either way the lane's pacer should be a request window sized to the vendor's free-tier concurrency (cloro 1; Bright Data and Oxylabs well above need).
6. **Typed failures:** extend the client error vocabulary with `partner_auth_failed`, `partner_quota_exhausted`, `partner_target_blocked` (the vendor reports a login wall or CAPTCHA failure) and `partner_empty_answer` (cloro's billed-but-empty case) and classify the first two as permanent in `isPermanentFailure`.
7. **Credentials:** add the vendor to the `CredentialProvider` union, env key (`BRIGHTDATA_API_TOKEN` or `CLORO_API_KEY`), `credentialStatus()`, the credentials route and its DELETE check, and the client API unions.
8. **Validation enums:** the zod route enums in the collection-runs and routes API, including `replaces`.
9. **Tests and fixtures:** adapter unit tests from recorded vendor payloads (fixture-labelled, never presented as live); a runner test for the blocking or job adapter; an integration test asserting the honest labels (`method`, `accountTier`, `observerRegionSource`) on a partner row.
10. **Mixing with history:** existing rows are untouched. A partner observation and a manual observation of the same prompt in one run would double-count under a pooled ChatGPT scope exactly as manual plus API does today (a known issue); keep the "one consumer route per engine per run" rule and treat manual captures as the reference set, not as extra samples.

### 8.3 Where the current architecture should be reconsidered regardless of provider

- `accountTier` must stop being hard-coded `free_tier`; the paid OpenAI lane is not free tier.
- The Gemini lane's `searchState=off` on an ungrounded fallback should be `not_applicable` or `unknown`; today it asserts that Gemini declined to search when in fact search was refused by quota.
- The console headline should carry the surface, not only the engine: "ChatGPT (app, by hand)", "ChatGPT (signed-out web, via vendor)", "OpenAI model benchmark (API)".

---

## 9. Engine-scope recommendation

**Support ChatGPT and Gemini, but separate surfaces from engines.**

- **ChatGPT consumer** — `chatgpt_manual` now; a signed-out partner route added after the §11 experiment passes, labelled as such. This is the headline scope.
- **OpenAI model benchmark (API)** — `openai_api` retained as an authorised, cheap, always-available benchmark, ideally moved to the Responses API with web search on `gpt-5.6-luna` so citations exist; Groq and Cerebras kept only as free stand-ins for the same benchmark scope, with Cerebras currently unusable (`http_402`).
- **Gemini consumer** — `gemini_manual` only. **Gemini model benchmark (API)** — `gemini_free_api`, relabelled to say that search grounding has not been available on the key. Do not buy a Gemini provider in Phase 2; the same fidelity and terms questions apply and the budget is better spent validating one ChatGPT route properly.

A ChatGPT-only Phase 2 is acceptable if the partner cannot spare operator time for Gemini manual capture, but nothing in the codebase or budget forces it.

---

## 10. Ranked recommendation

**Preferred option — "manual truth, one validated signed-out partner route, relabelled API benchmarks".**
1. Keep `chatgpt_manual` as the source of truth for the ChatGPT consumer scope in the demo (30 prompts ≈ 60–90 minutes of operator time; every session field attestable; no contractual conflict).
2. Run the §11 fidelity experiment against **Bright Data** (first) and **cloro** (second), both on free tiers, with the official API as a control. Bright Data first because it is a mature vendor with the richest documented metadata (`web_search_triggered`, citations, search sources, attached links, HTML, send timestamp, 212 countries), a free tier that covers everything without a card, and a litigation record that favours logged-out public collection; cloro second because it documents session conditions most clearly and is synchronous, but is an eleven-month-old company whose `model` field is empty on almost all responses and whose SLA excludes the one failure that matters.
3. Enable whichever passes, labelled "ChatGPT, signed-out web session collected by <vendor>", with `method = automated_partner`, `accountTier = signed_out`, `observerRegionSource = provider_declared` and a dated vendor statement in `sessionProfile.notes`.
4. Relabel `openai_api`, `groq_free_api`, `cerebras_free_api` as "OpenAI model benchmark (API)" and un-pool them from the consumer scope.

**Fallback option — "manual truth plus authorised API benchmark, no provider".** If the vendor checklist (§12) comes back with refusals on session disclosure, or the experiment fails, ship Phase 2 with `chatgpt_manual` as the only consumer route and `openai_api` upgraded to the Responses API with web search on `gpt-5.6-luna` (≈$1.40 for 90 answers). This is honest, authorised and cheap; it gives citations for the first time on an automated lane; it is simply not a consumer measurement and must not be labelled as one.

**Why not the others:** Oxylabs — KYC questionnaire for every customer, trial length unstated, push-pull only, $49 per month with no PAYG, a defendant in the Reddit case, and citation coverage that the vendor itself only "roughly doubled" in July 2026. DataForSEO Scraper — cheapest per result and synchronous, but a $50 deposit once the $1 trial is spent, search forced by the entry URL with no way to observe a non-search answer, no model field, and terms that say nothing about LLM data at all; a reasonable third candidate if both preferred vendors fail. SearchApi — no country parameter, which the geography model in the repo exists to record.

**Important disadvantages of the preferred option:** it still depends on unauthorised collection by a third party under a contract that makes Project Sun the indemnifying party; the surface is a signed-out search-mode session that no vendor can tie to a named model; supply can stop without recourse; and the "licensed provider" framing the hiring partner used cannot be stated in the product or to clients.

**Confidence:** high that no licensed or indemnified route exists and that budget is not the constraint; high that the four named providers observe the real web interface; moderate on Bright Data versus cloro as the better first candidate (the experiment decides); moderate on the logged-out inference for Bright Data, Oxylabs and DataForSEO until confirmed in writing.

**Conditions that would change the ranking:** a written OpenAI authorization or an official OpenAI product exposing ChatGPT-search answers (would make that the preferred automated route); a vendor offering a customer-facing indemnity for its collection method at a plan the budget allows (would elevate that vendor); Bright Data gating the ChatGPT scraper behind KYC or removing the free tier; cloro publishing a populated `model` field again; an adverse ruling against Oxylabs in the Reddit case (would remove Oxylabs entirely); OpenAI putting anonymous chatgpt.com behind a login wall (would collapse every automated consumer route to manual).

---

## 11. Validation plan for the later implementation phase (budget-bounded; do not run now)

**Goal.** Decide, with stored evidence, whether a provider route may be pooled under "ChatGPT" with manual captures, and which vendor to keep.

**Prompts.** 8 of the 30 approved prompts: 4 Discovery, 2 Trade Offs, 2 Sentiment; at least 2 market-bound (search-triggering) and 2 generic.

**Reference set (by hand, $0).** For each prompt, two manual captures at chatgpt.com under controlled sessions: (a) signed-out, fresh tab; (b) signed-in Free account, **non-personalised Temporary Chat**. Record model badge, whether "Searching the web" appeared, source-panel URLs, inline citation URLs, settings region, timestamp, screenshot hash. 16 manual observations. The signed-out-versus-Temporary-Chat overlap is measured first and sets the ceiling: no candidate is asked to beat ChatGPT's own run-to-run noise.

**Candidates.** The same 8 prompts through Bright Data and cloro, 3 repetitions each spaced at least an hour apart, `country` set to the project's market, `web_search` left at the vendor default; plus the official API control (`gpt-5.6-luna` with `web_search`, `user_location` = market). That is 24 attempts per route; at the free tiers and list prices in §7 the whole experiment costs under $3 in consumption and $0 in cash if the free tiers behave as documented, with $30–50 headroom for one paid plan if a trial is unavailable.

**Metadata per observation** (all existing columns): `visibleModelMode`, `searchState`, `sourceUrls`, `inlineCitationUrls`, `sourcesCaptureState`, `answerCaptureState`, `sessionProfile`, `observerRegion` + `observerRegionSource`, `intendedMarket`, `latencyMs`, `adapterVersion`; the raw vendor payload and HTML in the evidence store.

**Metrics** (computed by the existing analyzer, no new code): per prompt, Jaccard overlap of the set of brands named versus the reference; agreement on target presence; agreement on first-named brand; overlap of cited domains; search-state agreement; model-badge agreement; and the vendor's own success and empty-answer rates.

**Pass criteria (proposed).** Median brand-set Jaccard ≥ 0.6 against the signed-out reference; target-presence agreement ≥ 75%; search-state agreement ≥ 75%; the vendor payload discloses search state on 100% and model on ≥ 90% of results (or the vendor confirms in writing that the model is not exposed by the interface); no evidence of silent fallback to a model API (identical text to an API call, missing sources when the reference showed a panel, absent search metadata).

**Fail.** Any criterion below threshold, or a vendor answer to §12 that contradicts its documentation. A failed vendor stays labelled "AI answer via <vendor> (method unverified)" in its own scope or is removed.

**Deliverable.** A fixture-style JSON of every observation, a one-page results table, and the enable/disable decision recorded in the route policy `notes`.

---

## 12. Questions requiring vendor confirmation (pre-purchase checklist)

Send to each shortlisted vendor's sales or support and keep the written answers with the route-policy row.

*Provenance*
1. For the ChatGPT product, is every answer obtained by driving the chatgpt.com web interface in a browser, with no fallback to the OpenAI API or any other model under any condition? If a fallback exists, how is it flagged in the payload?
2. Which chatgpt.com entry point and UI variant is used (`?q=` deep link, `hints=search`, mobile-web vs desktop), and can we choose?
3. Is the `model` field populated from the interface? When it is empty, what does that mean, and can the model be obtained another way?

*Session and account*
4. Are requests made signed-out, or with accounts? If accounts: whose, which tier (Free/Go/Plus/Team), how many, how obtained, and are they shared across customers?
5. Is each prompt a brand-new conversation with no memory, history, custom instructions or personalisation? Is Temporary Chat used?
6. Is web search forced, permitted or off by default, and does the payload state whether search actually ran on each answer?
7. Which country does the request originate from (proxy exit) and what type of IP (residential, ISP, datacenter)? Is the execution country disclosed per result? Does `country` change anything other than the exit IP?

*Authorization and risk*
8. Does the vendor hold any licence, permission or agreement from OpenAI covering this collection? (Expect "no"; get it in writing.)
9. Does the vendor's collection comply with its own acceptable-use policy (public data only, no login)? Will the vendor state that in writing?
10. Who is responsible if OpenAI objects to the collection? Will the vendor indemnify the customer for claims arising from its collection method? On which plan?
11. Are there restrictions on the customer storing, analysing, displaying or deriving metrics from the returned answers and citations? May excerpts be shown to the customer's clients?
12. Does the vendor retain prompts, answers or HTML after delivery, for how long, and for what purposes? Is deletion on request available? Is a DPA available and which subprocessors and jurisdictions are involved?

*Commercials*
13. Exact free allowance for this product (records, credits, duration), any KYC or use-case review required before the first request, and whether the ChatGPT product is gated.
14. Minimum deposit or plan, refund policy, and whether unused balance expires.
15. Which outcomes are billed: failed jobs, empty answers, answers without sources, cancelled jobs, input errors?
16. Whether country targeting, HTML, screenshots or follow-up prompts cost extra.

*Operations*
17. Typical and maximum completion time; concurrency and rate limits on the free tier; retry policy and how "faulted" is decided.
18. How the vendor signals a login wall, CAPTCHA failure or UI change, and what the customer sees when the target changes format (schema version field?).
19. Status page and incident history for the ChatGPT product specifically over the last 90 days.
20. Any planned changes to the ChatGPT product's session model, entry point or pricing.

---

## 13. Final decision gate

Project Sun may call an automated route **"ChatGPT consumer"** and pool it with manual captures only when all of the following exist:

1. A provider payload that discloses **search state on every result** and **model on the great majority**, or a written vendor statement that the interface does not expose the model.
2. A **written vendor statement** of session conditions — signed-out or account (and tier), fresh conversation, no personalisation, execution country and IP type — matching what the documentation says.
3. The §11 experiment **passed**, with the fixture stored in the repo.
4. Terms or a written addendum that permit storage, analysis, display and derived metrics, state retention and deletion, and state who is responsible for the manner of collection.
5. The row is stored with `route = consumer_app`, `method = automated_partner`, `accountTier = signed_out`, `observerRegionSource = provider_declared`, a populated `sessionProfile`, and a method note that says the session is signed-out, collected by a named third party, and **not authorized by OpenAI**.

If 1–3 are absent, the label must be **"AI answer via <vendor> (method unverified)"** in its own Measure scope, never pooled under ChatGPT. If 4 is absent, the route may still run for the demo, but the method note must say that the collection is not authorized by OpenAI and is carried on Project Sun's own risk under the vendor's indemnity clause. The word **"licensed"** must not appear in the product, the method notes or client-facing material for any of the vendors reviewed.

---

## 14. Addendum (2026-09-14, follow-up questions): other platforms, fallback mechanism, other risks, and doing the browsing ourselves

### 14.1 Platforms beyond the four named

Considered and graded in §5.5: SearchApi.io, Decodo, Scrape.do, ScrapingBee, ScrapeBadger, Apify (official actor plus three third-party actors), Nimble, Scrapeless. Excluded with reasons: SerpApi (no ChatGPT engine; defendant in *Google v. SerpApi*), NetNut and ProxyJet (FBI domain seizure, July 2026), HasData, Zyte, ScraperAPI, ZenRows, Crawlbase, Serper, SOAX, Thordata, Scrapfly, Firecrawl, Browserbase, Browserless. Also considered: OpenAI's own routes (`chat-latest`, Responses API web search), Google's own route (Gemini API grounding), and the GEO platforms themselves (Peec, Profound, Otterly, Scrunch, AthenaHQ, Semrush, Ahrefs, Evertune, Rankscale, Promptwatch), none of which sells raw per-prompt consumer answers as an API except Profound's request-only read API. The two providers worth adding to a shortlist beyond Bright Data and cloro are **Decodo** (the only vendor offering a screenshot per answer, which is the strongest evidence artefact for a demo) and **SearchApi** (best-documented payload, but no country parameter).

### 14.2 The fallback mechanism (design)

Principle: a fallback may change the *route*, never the *label*. Substituting an API answer for a consumer answer silently would be the exact fidelity error the product exists to avoid, and `comparability()` already treats a route change as a break.

Per-engine route ladder, each rung its own Measure surface:

1. **Consumer, by hand** (`chatgpt_manual`) — the reference and the last resort; always available; the console already offers "ask the remaining by hand".
2. **Consumer, signed-out web via vendor A** (Bright Data) — primary automated consumer route once validated.
3. **Consumer, signed-out web via vendor B** (cloro; Decodo as third) — same surface, second vendor. Both adapters normalise to the same `AdapterResult` plus a provenance block, so switching vendors is a config change, not a code change. `switchAutomatedRoute` should gain a "same surface" guard next to its existing "same engine" guard.
4. **Authorised API with browsing** (OpenAI Responses API + `web_search`, Gemini API + Google Search grounding) — never a substitute for rungs 1–3 in the consumer scope; it is the always-available *benchmark* surface that keeps the demo alive when every consumer route is down.

Mechanisms that make the ladder work:

- **Canary before a run.** One fixed prompt per vendor before each collection; cost under a cent. Fail the canary (no `web_search_triggered`/sources field, no `chatgpt.com` markers in citations, schema keys missing, `success:true` with an empty body) and the lane pauses with `paceReason = vendor_unhealthy` instead of burning 30 credits.
- **Silent-fallback detector.** Every partner payload is checked for surface markers before it becomes a `provider_response`: citation URLs carrying `utm_source=chatgpt.com`, presence of `search_queries`/`searchQueries`, page HTML or event stream present, vendor schema version unchanged. A payload without markers is stored as evidence but the row gets `method = automated_partner`, `sourcesCaptureState = unknown` and a warning, and it is excluded from the consumer scope until reviewed.
- **Circuit breaker per lane.** Pause after N consecutive `partner_target_blocked` or empty answers (the runner already pauses on quota and billing failures; add these codes).
- **Budget guard.** Read the vendor's remaining-credit headers (`X-Credits-Remaining`, Bright Data free-tier hard stop) and refuse to start a run that would cross from free into paid without explicit approval, mirroring the paid-OpenAI rule.
- **Two-vendor cross-check on a subset.** Run 5 of the 30 prompts through both vendors each run; a brand-set Jaccard below 0.5 raises a "vendors disagree" flag on the run.
- **Job table for restart safety.** Async vendors (Bright Data snapshots, Oxylabs push-pull) record job ids in the unused `jobs` table so a server restart resumes polling instead of orphaning rows.
- **Demo insurance.** The 30 manual captures are recorded before the demo; no live vendor call is on the critical path of the presentation.

### 14.3 Other issues to expect

- **Forced search inflates citation rates.** cloro forces search by default, DataForSEO's entry URL forces it, Bright Data and Oxylabs permit it. A typical signed-in user gets search only when ChatGPT decides. Record the search *mode* (forced / auto / off) in `sessionProfile.notes`, and expect consumer-route citation metrics to run above what a Temporary-Chat user sees.
- **Anonymous ≠ Free-tier.** Vendor samples show `gpt-5-5`; the Free tier FAQ names GPT-5.6 Luna. Which model the anonymous surface gets, per country and day, is undocumented everywhere. Store the model when the payload has it, `unknown` otherwise; never infer it.
- **UI variants and experiments.** Mobile-web versus desktop response format (cloro `legacy`), ads in the Free tier in some countries, shopping cards, map widgets, A/B tests. Vendors adapt after the fact (DataForSEO changed its schema seven times in a year; Oxylabs changed its envelope in June 2026). Pin the adapter to a payload schema version and fail closed on unknown shapes.
- **Geography leaks both ways.** A proxy in the UAE does not make the model answer as a UAE user ("Pre-trained answers leak through", cloro's own caveat), and captured answers have shown foreign-locale widget text. Keep `observerRegion` (proxy country, provider-declared) separate from `intendedMarket` and never present the first as the second.
- **Prompt confidentiality.** Bright Data's MSA §10.2 lets it "retain data it has collected or delivered to its Clients and may use it for its own purposes". A client's prompt set reveals the client, its competitors and its priorities. This is a business-confidentiality issue independent of OpenAI's terms; cloro's terms leave rights with the customer, DataForSEO's are silent. Ask question 12 in §12 before sending a real client's prompts to any vendor.
- **Billing edge cases.** cloro bills empty-but-successful answers; Oxylabs bills any 2xx page even when parsing fails; Bright Data's documentation disagrees with itself on input errors. Budget for 20% waste and log every billed failure.
- **Prompt length caps.** Oxylabs 4,000 characters, Bright Data 4,096, DataForSEO 2,000, Scrape.do 1,024. Project Sun's prompts are short today; add a validation so a long custom prompt fails before it is sent.
- **Onboarding friction.** Oxylabs requires a KYC questionnaire and approves about three quarters of applicants; DataForSEO needs a $50 deposit after the trial; cloro's free tier allows one concurrent job, so 30 sync prompts take 15–25 minutes.
- **Login walls and Cloudflare.** Every vendor's business depends on anonymous chatgpt.com access continuing. cloro's Copilot lanes were down for a day and a half when Microsoft added a login wall; Bright Data's Grok lane has been dark since June. There is no SLA recourse for this anywhere.
- **Sampling.** All of this is still n=1 per prompt. The `samplesPerPrompt` column exists; use it once a vendor is validated, because three samples at $0.0015 each are cheaper than one wrong headline number.
- **Expectation gap with the hiring partner.** They believe a licensed provider carries the risk. The memo's §5.7 is the evidence that this is not so; the labelling rules in §13 are how the product stays honest about it.

### 14.4 Doing the browsing ourselves — what is possible, what is not, and the workarounds

**Unattended headless automation of chatgpt.com or gemini.google.com by Project Sun's own code: not recommended, and the repo's hard rule against it should stay.**
- Legal: it puts Project Sun in direct privity with OpenAI's consumer terms ("Automatically or programmatically extract data or Output"; "bypass any protective measures"), which is the *strongest* theory against a scraper; a vendor at least moves that to secondary theories. Google's Gemini terms and robots.txt are equally explicit, as the user already knows.
- Technical: chatgpt.com sits behind Cloudflare with JA4 TLS fingerprinting and Turnstile challenges (cloro's own reference repo describes "getting past" both). Datacenter IPs get a challenge on the first prompt, so a working scraper needs residential proxies with sticky sessions, which are sold by the same vendors, gated by KYC, and priced per gigabyte. Defeating a challenge is the act that turns a terms dispute into a §1201 circumvention claim (the theory now proceeding in *Reddit v. SerpApi*). Then there is the maintenance: the mobile-web format change in July 2026 broke every vendor's parser at once.
- What it would buy: independence from vendors, at the cost of becoming the least-defensible party in the chain and owning a parser that OpenAI changes without notice. For a single operator that is a bad trade.

**Three own-infrastructure paths that do give web browsing and stay inside the terms:**

1. **Authorised APIs with browsing, owned by Project Sun's code (the backbone).** OpenAI Responses API with the `web_search` tool: search can be *forced* ("Use `tool_choice: "required"` or a specific web search tool choice when search must run"), the response carries `url_citation` annotations with character offsets and a full `sources` list, `user_location` takes a country and city, and the cost is $10 per 1,000 search calls plus tokens — about $0.013 per answer on `gpt-5.6-luna` (the Free tier's named model) or about $0.09 on `chat-latest` ("the latest Instant model currently used in ChatGPT"). Gemini API with Grounding with Google Search: on the **paid tier** (billing enabled, which the repo's rules currently forbid without approval) Gemini 3.x models get **"5,000 free search requests per month (shared across all Gemini 3.x models), then $14 per 1,000 requests"**; on the free tier grounding is "Not available", which is exactly why 0 of 388 stored Gemini rows ever searched. The model decides when to search (it cannot be forced), billing is per search query, responses carry `url_citation` annotations, and the terms require displaying Google's search suggestions. Turning on Gemini billing and switching the OpenAI lane to the Responses API gives both engines browsing, citations and a benchmark that never depends on a scraper, for well under $5 a month at demo volumes. This is the answer to "we need web browsing for sure" that needs no vendor and no workaround.

2. **Operator-driven capture through official features (consumer fidelity without a scraper).** The human still asks each prompt in their own session, which is what the terms allow; the *transfer* is what gets automated.
   - **ChatGPT data export** (Settings → Data controls → Export; available on Free, Go, Plus and Pro; a ZIP with the chat history, delivered by email, "up to 7 days" but usually far sooner). After the 30 prompts are asked by hand in fresh Temporary-Chat-off conversations, one export gives every answer verbatim in JSON. Whether the export includes the model slug and the search citations per message must be confirmed by inspecting one export (UNKNOWN until then; the help page describes only "your chat history"). If it does, this replaces paste-by-hand with a loss-free import and populates `visibleModelMode`, `sourceUrls` and `inlineCitationUrls` from OpenAI's own record.
   - **Shared conversation links.** ChatGPT's Share feature publishes a conversation at a public URL by the user's deliberate act; Project Sun fetching that one page is fetching content the user chose to publish through an official feature. Google's Gemini app has an equivalent public-link share. Grey-zone risk is low because there is no automation of the asking, but check the page markup carries sources.
   - **Google Takeout** exports Gemini Apps activity for the operator's own account (UNKNOWN whether responses and sources are included; verify with one export).
   - **A "Sun Logger" tool the operator invokes inside ChatGPT.** ChatGPT can call user-configured MCP connectors and plugins. The operator asks the pristine prompt, waits for the answer, then in a second turn says "send your previous answer verbatim with every source URL to Sun Logger". The assistant, at the user's instruction, passes its own Output to the tool; the first answer is unaffected because the instruction comes after it. This removes paste error and captures sources structurally. Caveats: connector availability by plan must be checked (UNKNOWN; likely paid), the assistant may paraphrase rather than copy (compare the tool payload with the on-screen text), and the second turn must never precede the first.
   - What stays banned: a script that drives the operator's browser, reads the DOM or reuses cookies. Reading the DOM programmatically is "automatically or programmatically extract" in plain words, however the session was opened.

3. **Vendors as an interchangeable accelerator, never the backbone** (§14.2). With path 1 as the always-on benchmark and path 2 as the consumer reference, a scraping vendor becomes optional capacity for repeated consumer sampling, and losing one costs a label change, not the product.

**Bottom line on "so that we do not rely on them always":** rely on the authorised APIs for browsing-capable automation, on the operator's own account plus official export or share features for consumer fidelity, and on vendors only for scale, behind the ladder in §14.2. Own headless scraping would make Project Sun the most exposed party while still depending on vendors for residential IPs.

## 15. Decision record (2026-09-14): API routes excluded

The operator decided that model-API routes do not serve the product's purpose and are out of scope for collection. Consequences for the plan above:

- The consumer route ladder per engine becomes: **by hand → Bright Data (signed-out web) → cloro (signed-out web) → by hand**. Both vendor adapters should be built from the start (both free at demo volume) so a vendor outage is a config switch, not a code change; Decodo is the third candidate if a screenshot per answer is wanted for evidence.
- `openai_api`, `groq_free_api`, `cerebras_free_api` and `gemini_free_api` are removed from default selection and set `enabled: "false"` in the route policy; stored rows stay readable under their existing labels and `comparability()` already marks the break. Section 3's fidelity table becomes the justification for that removal; §8.2 item 4 (API benchmark scope) and §14.4 path 1 are no longer needed.
- Gemini consumer collection follows the same posture as ChatGPT: by hand first, then the same vendor's Gemini scraper (Bright Data lists Gemini among its AI-search scrapers; cloro exposes a Gemini endpoint; DataForSEO launched a Gemini LLM Scraper in February 2026) after ChatGPT has passed the §11 experiment. The Gemini vendor payloads were not researched to the same depth and need the §12 checklist before use.
- Because every automated route now depends on anonymous access to the consumer sites, the manual route is the only guaranteed fallback and the demo must not have a live vendor call on its critical path (§14.2).
- Web search: all shortlisted vendor routes force or permit search; store `searchState = on` with `sessionProfile.notes = "search forced by vendor"` so the citation metrics carry their caveat.

## 16. Decision record (2026-09-14): by-hand capture excluded from the product

The operator also decided that a by-hand route in the product makes the app look bad and is out of scope as a user-facing feature. Consequences:

- **Collection is vendor-only.** Per engine: Bright Data (primary) → cloro (secondary) → Decodo (third; the only vendor returning a screenshot). All adapters are built up front so a blocked vendor is a settings switch. When every vendor is down the lane pauses and the prompts stay coverage gaps ("not collected"), which Measure already handles; nothing is ever filled in from another surface.
- **The console's "Ask by hand" panel is removed from the UI** (`chatgpt_manual`/`gemini_manual` rows set `enabled: "false"`; code and stored rows kept). The key form becomes the vendor-key form.
- **Fidelity checking moves out of the product into QA.** The §11 experiment still needs a reference. It is done once, privately, by the operator opening chatgpt.com and saving screenshots of 8 prompts, and those screenshots become a test fixture, not an app feature. If even that is unwanted, the fallback check is cross-vendor agreement (Bright Data vs cloro vs Decodo screenshot) on the same 8 prompts, which detects a broken or substituted vendor but cannot prove closeness to a signed-in user.
- **Demo insurance without manual captures:** run the full 30-prompt collection through the primary vendor several days before the demo and again the day before; the immutable evidence store keeps both runs; the demo presents a stored run and, optionally, a small live run. A paused lane is shown honestly as paused.
- **Labels:** "ChatGPT (web)" and "Gemini (web)" in the console and Measure headline; the collapsed method note states signed-out session, web search forced by vendor, collected by <vendor>, not authorized by OpenAI or Google. The §13 gate still decides whether the word "consumer" may be used.
- **Risk posture:** the product now rests entirely on unauthorised third-party collection under contracts that make Project Sun the indemnifying party (§5.7). This should be said to the hiring partner in writing before build starts.

## 17. Vendor selection rationale and the fallback proposal (vendor-only design)

### 17.1 Why these three (effectiveness first; cost was not the discriminator)

Every shortlisted vendor is free at 90 observations, so price could not separate them. The ranking is on evidence of effectiveness, with the honest caveat that **no independent measured success rate or latency exists for any vendor's ChatGPT route**; every "99%" figure is a provider claim, so effectiveness is provisional until the canary and the 8-prompt check run.

| Vendor | Chosen for | Would be dropped if |
|---|---|---|
| Bright Data (primary) | richest documented payload (`web_search_triggered`, citations, search sources, attached links, page HTML, send timestamp), 212 countries, fresh session per request stated in docs, mature company with a favourable logged-out-scraping record, sync path for ≤20 prompts | `model` stays null and the vendor cannot say which model answers; captured answers keep showing foreign-locale widget text; KYC or free-tier removal appears |
| cloro (secondary) | clearest written session conditions of any vendor (signed-out, real browser, proxy in country), synchronous 30–45 s, `disableWebSearch` control, sources with positions, rendered HTML | the blog-versus-docs contradiction on login is resolved the wrong way; ChatGPT degraded events keep recurring; `model` never returns |
| Decodo (third) | the only vendor returning a screenshot of the rendered answer, which is the strongest evidence artefact for a demo; `search` and `geo` controls; established proxy company | screenshot or parse quality is poor on the canary; async-only integration proves heavier than documented |

Bench (not integrated at first, adapters cheap once the interface exists): Oxylabs (held back for KYC gating, async-only, Reddit litigation, and a citation-coverage fix only shipped in July 2026), DataForSEO LLM Scraper (held back for the $50 deposit, forced search-mode entry, no model field, terms silent on LLM data), SearchApi (no country parameter), ScrapeBadger (too new to depend on).

### 17.2 The fallback proposal, level by level

| Level | Trigger | Action | Where it lives |
|---|---|---|---|
| 0 Canary | before every run, per vendor | one fixed prompt; check surface markers (`chatgpt.com` citation tags, search metadata present, schema keys present, non-empty body); a failed canary marks the vendor unhealthy for 6 hours and the run starts on the next vendor | runner, new `vendorHealth` map |
| 1 Retry | a single request fails transiently | bounded retries inside the lane, as today (`maxTransientRetries`); empty-but-success answers count as failures | existing runner |
| 2 Lane breaker | 3 consecutive blocked or empty answers, or a vendor error code meaning "target blocked" | lane pauses; unfinished prompts are re-planned on the next healthy vendor for the same engine and the same surface (`switchAutomatedRoute` extended with a same-surface guard); collected answers stay | orchestrator |
| 3 Run pause | every integrated vendor unhealthy | run pauses; console says "ChatGPT (web) is unreachable through all providers"; Measure shows "so far" with gaps; automatic re-check every 30 minutes for 24 hours, then manual resume | runner, console |
| 4 Bench | two primaries dark for more than 48 hours | integrate the next bench vendor behind the same adapter interface (about a day of work each); the vendor checklist must be answered first | engineering |
| Demo | always | a full stored run days before and the day before; no live vendor call on the critical path | operations |
| Cross-check | every run | 5 of 30 prompts also sent to the secondary vendor; brand-set overlap below 0.5 flags "vendors disagree" on the run | orchestrator, Measure warning |
| Budget guard | before every run | read remaining free credits; refuse to cross into paid without explicit approval | runner |

Mixing rule: after a switch, one run may contain answers from more than one vendor for the same engine. Every row keeps its vendor; the headline stays "ChatGPT (web)"; the method note lists which vendors contributed and how many answers; a change in the vendor mix between runs is a comparability break, as `comparability()` already reports.

## 18. Implementation status (2026-09-15)

Built in `project-sun-phase2-app-v2` on the operator's instruction, vendor-only:

- **Clients:** `src/lib/brightdata/client.ts` (sync scrape + 202/snapshot polling), `src/lib/cloro/client.ts` (ChatGPT and Gemini, per-key concurrency gate, rendered-page fetch, credit headers), `src/lib/decodo/client.ts` (Basic auth, parsed target). All implement `ConsumerCollector` (`src/lib/collection/consumer-collector.ts`): one answer shape, surface markers, blank-page detection, typed failures, fail-closed on unknown payloads.
- **Routes:** `chatgpt_brightdata_web` → `chatgpt_cloro_web` → `chatgpt_decodo_web`; `gemini_cloro_web`. Retired routes (four API lanes, two by-hand) seeded `enabled: "false"`; stored rows keep their labels. By-hand panel removed from the console; the capture API remains for QA fixtures.
- **Runner:** canary before a run (6 h trust), breaker after three blocked or blank answers, credit check, per-lane request cap (default 60), quota pauses, hand-over to the next keyed healthy vendor for the same engine and surface, automatic re-check every 30 min for 24 h when no vendor is left. Vendor health in `src/lib/collection/vendor-health.ts`.
- **Provenance:** every row `route = consumer_app`, `method = automated_partner`, `accountTier = signed_out`, `visibleModelMode` from the page or `unknown`, `searchState` from the vendor or `unknown`, `observerRegion` + `observerRegionSource = provider_declared`, `intendedMarket`, `sessionProfile` (signed-out, fresh conversation, provider and search mode in notes), `sourceUrls`, `inlineCitationUrls`; vendor payload and rendered page kept as artifacts under `evidence-store/<project>/artifacts/`.
- **Labels:** console and Measure say "ChatGPT (web)" / "Gemini (web)"; method notes name the provider, the session, the country and that no provider is licensed by OpenAI or Google.
- **Tooling:** `scripts/mock-vendors.ts` (stand-in for all three vendors, with chaos modes), `scripts/seed-approved-project.ts`, `scripts/vendor-canary.ts`, `scripts/vendor-crosscheck.ts`; launch entry `sun-verify-vendors`.
- **Verified:** 1,098 vitest tests pass (two suites ported to the new routes); an isolated app run against the mock collected 60 of 60 answers with honest provenance and artifacts; with Bright Data forced into a blocked state, the canary failed, the run handed over to cloro and finished 60 of 60 with the ChatGPT scope still planned at 30.
- **Live checks with the operator's keys (2026-09-15, country IN):**
  - **cloro** passed its canary on both engines first time: ChatGPT in 32 s with 3 citations carrying `utm_source=chatgpt.com` and the rendered page; Gemini in 35 s with 2 citations. `model` empty. 7 and 6 credits charged; 487 left after both.
  - **Bright Data** answers 202 after about 60 s and the snapshot was ready after 339 s and 724 s in two probes. The country sent as `country` is echoed in the record; a request without one exited through an arbitrary country (Swedish prices in the shopping cards). `model` was null. Inline links arrive as `[1]`, `[2]` placeholders with the text in `links_attached[].position`, so the client restores them before the text is stored. The first client attempt hit an uncaught body-read error; body reads are now guarded and the poll budget is 15 minutes.
  - **Decodo** succeeded only without a country: every request with `geo` (`IN`, `India`, `United States`) failed with status 613, and the untargeted answer cited Vietnamese sites, so the exit is arbitrary. It is the only vendor that reported the model (`gpt-5-6`) and it returned 12 citations in 59 s. Decodo rows therefore record the origin as unknown and Decodo stays the third choice.
  - Findings are recorded in the route-policy notes, the collection rules and `docs/KNOWN_ISSUES.md`.
- **Six-prompt head-to-head (2026-09-15, six approved Nike India prompts, country IN, `scripts/vendor-compare.ts`; raw payloads kept outside the repo):**

| | Bright Data | cloro | Decodo |
|---|---|---|---|
| Answers | 6 of 6 | 6 of 6 | 6 of 6 |
| Latency, median (max) | 613 s (836 s) | 69 s (119 s) | 132 s (139 s) |
| Answers priced in ₹ / mentioning India | 5 / 5 of 6 | 4 / 5 of 6 | 2 / 2 of 6 (four in ₫, R$ or €: Vietnam, Brazil, Portugal exits) |
| Indian (.in) domains in sources, total | 10 | 5 | 13 |
| Sources per answer (page's sources panel) | 4.5 | 6.2 | 12.2 |
| Searched | 5 of 6 (one answer without search: permitted mode) | 6 of 6 (forced) | 6 of 6 (forced) |
| Model reported | never | 1 of 6 (gpt-5-6) | 6 of 6 (gpt-5-6) |
| Embedded images per answer (now stripped from the stored text) | 2.5 | 0 | 2.2 |
| Surface markers | all passed | all passed | all passed |
| Cost of the six | 6 records (of 5,000 free) | 42 credits (445 of 500 left after the canaries) | 6 requests (of about 670 free) |

  Brand-set agreement between any two providers was low (median Jaccard about 0.17), which is ChatGPT's own run-to-run variance plus a crude tokenizer; the headline picks overlapped where it matters (PUMA All-Pro NITRO 2 and Nike Giannis on every provider for basketball; ASICS Novablast and Nike Pegasus on cloro and Decodo for running). Bright Data's "Where can I find good lifestyle sneakers?" named malls in Ludhiana, so its proxy exit is a real Indian city, not only a country.
- **Verdict:** cloro gave the best answers per prompt (fast, clean text, correct country, richest sources panel with positions) but its free tier covers about one full ChatGPT-plus-Gemini run a month. Bright Data is the free-volume workhorse (country honoured, verified markers, thousands of answers a month) at the cost of ten-minute latency, occasional widget text and no model name. Decodo cannot be placed in a market for ChatGPT, so it stays a last resort with the origin recorded as unknown. Default order kept: Bright Data → cloro → Decodo for ChatGPT; cloro for Gemini.

## 19. Decision record (2026-09-15): cloro first, Oxylabs added, and the pre-demo fidelity check

**Six-prompt head-to-head on approved Nike India prompts, country IN (raw payloads kept outside the repo):**

| | Bright Data | cloro | Decodo |
|---|---|---|---|
| Answers | 6 of 6 | 6 of 6 | 6 of 6 |
| Time per answer, median (worst) | 10 min (14 min) | 69 s (119 s) | 132 s (139 s) |
| Priced in rupees / mentions India | 5 / 5 of 6 | 4 / 5 of 6 | 2 / 2 of 6 |
| Sources per answer (page's sources panel) | 4.5 | 6.2 | 12.2 |
| Web search ran | 5 of 6 (page decided) | 6 of 6 (forced) | 6 of 6 (forced) |
| Model reported by the page | never | once (gpt-5-6) | always (gpt-5-6) |
| Brand-set overlap with the other two (median Jaccard) | 0.17 | 0.17 | 0.13–0.17 |

The low overlap is mostly ChatGPT's own run-to-run variance (a person asking twice gets different shortlists) plus a rough brand tokenizer; the qualitative picks did overlap (PUMA All-Pro NITRO 2 and Nike Giannis on the basketball prompt across all three; ASICS Novablast and Nike Pegasus on running across cloro and Decodo).

**Decision (operator):** cloro is the primary ChatGPT route because the demo needs speed; the $30 Lite plan is approved (37,500 credits a month, ten concurrent jobs; set `SUN_CLORO_CONCURRENCY=10` once upgraded, after which a 60-answer run takes about 7 minutes instead of 35). Order is now cloro → Bright Data → Oxylabs → Decodo for ChatGPT, cloro for Gemini. Bright Data remains the free fallback; Decodo is last because it cannot be placed in a country.

**Oxylabs** is built (`src/lib/oxylabs/client.ts`, route `chatgpt_oxylabs_web`, push-pull jobs, `geo_location` as a country name) from the documentation and is untested until credentials exist. To obtain them: sign in at dashboard.oxylabs.io, open Scraper APIs → Web Scraper API, start the free trial (up to 2,000 results, no card; Oxylabs asks a short use-case questionnaire and approves about three quarters of applicants), create an API user (a username and password, not a token), and paste them into the Providers form as `username:password` or set `OXYLABS_AUTH=username:password` in `.env.local`. Then run `scripts/vendor-canary.ts --route chatgpt_oxylabs_web --country IN` and `scripts/vendor-compare.ts --routes chatgpt_cloro_web,chatgpt_oxylabs_web`.

**How the providers get the answer, plainly.** All four run headless browsing for us: a real browser session opens chatgpt.com signed out, through a proxy in the requested country, sends the prompt, and returns what the page rendered (text, the sources panel, and for cloro and Bright Data the page HTML itself). None calls the OpenAI API. What the platform shows is therefore the real ChatGPT web answer for an anonymous visitor in that country. Three differences from a signed-in person remain and are stated in the method notes: no memory or personalisation, web search forced on (cloro, Decodo, Oxylabs) or permitted (Bright Data), and the model badge not visible to the scraper.

**Pre-demo side-by-side check (by the operator, outside the product, no credits):**
1. Open a fresh private browser window, go to chatgpt.com, do not sign in.
2. Ask, one per new chat, three of the approved prompts that the platform collected the same day: "Can you suggest some good running shoes under ₹12,000?", "Looking for basketball shoes under ₹15,000 — what should I pick?", "Should I get Nike running shoes or Reebok since I am training for a first half marathon?".
3. For each, note: did it search the web (the "Searching" indicator); the brands named; the sources panel domains; the model badge if shown; prices in rupees.
4. Compare with the platform's answers (evidence drawer on Measure). Expect the same currency, largely the same brand families, and overlapping source domains; do not expect identical text.
5. If the platform's answers systematically miss the currency or the market, stop and re-run the canary before the demo.

## 20. Decision record (2026-09-15, later): ChatGPT only, Oxylabs tested, Oxylabs first

**ChatGPT only.** `SUN_ENGINES` (`src/lib/providers/engine-scope.ts`) now defaults to `chatgpt`; Gemini is hidden from route selection, the console and Measure until `SUN_ENGINES=chatgpt,gemini` is set. Stored Gemini rows are untouched. `SUN_PREFERRED_ROUTES` reorders providers without a code change.

**Oxylabs, live, same six prompts, country IN (trial credentials):**

| | Oxylabs | cloro | Bright Data | Decodo |
|---|---|---|---|---|
| Answers | 6 of 6 | 6 of 6 | 6 of 6 | 6 of 6 |
| Time per answer, median (worst) | 43 s (54 s) | 69 s (119 s) | 10 min (14 min) | 132 s (139 s) |
| Rupee prices / mentions India | 5 / 4 of 6 | 4 / 5 of 6 | 5 / 5 of 6 | 2 / 2 of 6 |
| `.in` domains cited, total | 34 | 5 | 10 | 13 |
| Sources per answer / unique domains | 15.8 / 9.3 | 6.2 / 3.5 | 4.5 / 2.7 | 12.2 / 7.3 |
| Model reported by the page | every answer (gpt-5-6 on 4, gpt-5-6-mini on 2) | 1 of 6 | never | every answer |
| Brand overlap with cloro (median Jaccard) | 0.21 | — | 0.17 | 0.16 |
| Free allowance | about 770 rendered answers, no card | 500 credits a month (about 70 answers) | 5,000 records a month | about 670 requests a month |
| After the free allowance | $49 a month, no pay-as-you-go | $30 a month | $1.50 per 1,000 | $19 a month |

Oxylabs cited Indian retailers (Flipkart, Myntra, Nykaa, Amazon.in) and Indian brands (Nivia, Kipsta) and reported the model on every answer, including that two of six prompts were answered by `gpt-5-6-mini`: the anonymous surface does route some prompts to the smaller model, which is exactly the kind of fact the platform should record rather than assume. Oxylabs is the only vendor whose trial is not monthly, whose trial duration is unpublished, that has no pay-as-you-go afterwards, and that is a named defendant in *Reddit v. SerpApi et al.*

**Decision:** Oxylabs first, cloro second, Bright Data third, Decodo last. On the free trial Oxylabs covers roughly 25 full 30-prompt runs at about five minutes each, so the cloro Lite plan is not needed for 5–10 test runs; cloro's free tier (445 credits left, about two runs) and Bright Data (free, slow) remain as automatic fallbacks. If the Oxylabs trial lapses before the demo, buy the cloro Lite plan the day before and set `SUN_CLORO_CONCURRENCY=10`.

## Appendix A — Source index (grouped)

**Repository and DB (VERIFIED 2026-09-14):** `AGENTS.md`, `CLAUDE.md`, `.claude/rules/collection.md`, `.claude/rules/analysis-measure.md`, `.claude/skills/sun-collection-lanes/SKILL.md`, `docs/KNOWN_ISSUES.md`, `src/lib/collection/{orchestrator,runner,repository,evidence-quality,geography,state-machine}.ts`, `src/lib/providers/{route-policy-seed,engines,credentials,capability-gates}.ts`, `src/lib/{openai,gemini,groq,cerebras}/client.ts`, `src/lib/db/schema.ts`, `src/lib/analysis/service.ts`, `src/lib/measure/{service,engine,policy}.ts`, `src/components/features/observation-console.tsx`, `src/app/projects/[id]/measure/page.tsx`, `src/app/api/projects/[id]/collection-runs/route.ts`, `src/app/api/collection-runs/[id]/{route,collect/route,routes/route}.ts`, `src/app/api/prompt-runs/[id]/{manual-capture,outcome,retry}/route.ts`, `tests/integration/{route-switch,manual-observation}.test.ts`, `tests/fixtures/provider-responses.json`; read-only queries on `data/sun.db`.

**OpenAI:** Terms of Use https://openai.com/policies/terms-of-use/ · Services Agreement https://openai.com/policies/business-terms/ · Usage Policies https://openai.com/policies/usage-policies/ · Sharing & Publication Policy https://openai.com/policies/sharing-publication-policy/ · Free Tier FAQ https://help.openai.com/en/articles/9275245 · Temporary Chat FAQ https://help.openai.com/en/articles/8914046-temporary-chat-faq · Release notes https://help.openai.com/en/articles/6825453-chatgpt-release-notes · API pricing https://developers.openai.com/api/docs/pricing · Web search tool https://developers.openai.com/api/docs/guides/tools-web-search · chat-latest https://developers.openai.com/api/docs/models/chat-latest · robots https://chatgpt.com/robots.txt

**Bright Data:** https://docs.brightdata.com/products/scrapers/chatgpt/introduction · https://docs.brightdata.com/api-reference/scrapers/ai-search-apis/chatgpt-search-by-prompt · https://docs.brightdata.com/general/account/billing-and-pricing/free-tier · https://brightdata.com/products/web-scraper/chatgpt · https://brightdata.com/pricing/web-scraper · https://brightdata.com/license · https://brightdata.com/acceptable-use-policy · https://github.com/brightdata/answer-engines-country-codes · https://github.com/brightdata/brightdata-mcp/pull/180 · https://brightdata.com/blog/ai/ai-visibility-tracker

**Oxylabs:** https://developers.oxylabs.io/api-targets/llms-and-ai/chatgpt · https://developers.oxylabs.io/products/web-scraper-api/integration-methods/push-pull · https://developers.oxylabs.io/products/web-scraper-api/usage-and-billing/billing-information · https://developers.oxylabs.io/help-center/billing-and-payments/how-does-web-scraper-api-pricing-work · https://developers.oxylabs.io/changelog · https://oxylabs.io/products/scraper-api/serp/chatgpt · https://oxylabs.io/products/scraper-api/web/pricings · https://oxylabs.io/legal/oxylabs-general-conditions · https://oxylabs.io/legal/oxylabs-acceptable-use-policy · https://oxylabs.io/kyc-and-safety · https://github.com/oxylabs/chatgpt-scraper

**DataForSEO:** https://docs.dataforseo.com/v3/ai_optimization-chat_gpt-llm_scraper-overview/ · https://docs.dataforseo.com/v3/ai_optimization-chat_gpt-llm_scraper-live-advanced/ · https://docs.dataforseo.com/v3/ai_optimization-chat_gpt-llm_responses-live/ · https://dataforseo.com/help-center/what-is-llm-scraper-api-and-what-data-does-it-provide · https://dataforseo.com/pricing/ai-optimization/llm-scraper · https://dataforseo.com/pricing/ai-optimization/llm-responses · https://dataforseo.com/help-center/minimum-payment · https://dataforseo.com/terms-of-service · https://dataforseo.com/update/chatgpt-llm-scraper-api

**cloro:** https://cloro.dev/docs/api-reference/endpoint/monitor-chatgpt · https://cloro.dev/docs/guides/providers · https://cloro.dev/docs/guides/billing · https://cloro.dev/docs/guides/error-handling · https://cloro.dev/docs/changelog · https://cloro.dev/pricing/ · https://cloro.dev/terms/ · https://cloro.dev/privacy/ · https://cloro.dev/dpa/ · https://cloro.dev/about/ · https://cloro.dev/blog/best_chatgpt_scraper/ · https://status.cloro.dev/ · https://github.com/cloro-dev/chatgpt-scraper

**Alternatives:** https://www.searchapi.io/docs/chatgpt-api · https://www.searchapi.io/pricing · https://www.searchapi.io/legal/terms · https://help.decodo.com/docs/web-scraping-api-chatgpt · https://decodo.com/scraping/web/pricing · https://scrape.do/documentation/chatgpt-api/ · https://www.scrapingbee.com/documentation/chatgpt/ · https://www.scrapingbee.com/terms-and-conditions/ · https://scrapebadger.com/chatgpt-scraper · https://scrapebadger.com/pricing · https://scrapebadger.com/legal/terms · https://apify.com/apify/chatgpt-search-scraper · https://apify.com/scrape.badger/chatgpt-scraper · https://docs.apify.com/legal/general-terms-and-conditions · https://github.com/serpapi/public-roadmap/issues/2618 · https://krebsonsecurity.com/2026/07/fbi-seizes-netnut-proxy-platform-popa-botnet/ · https://github.com/ai-search-guru/getcito-worlds-first-open-source-aio-aeo-or-geo-tool

**GEO platform disclosures:** https://peec.ai/ai-instructions · https://www.tryprofound.com/ai-instructions · https://help.otterly.ai/how-otterlyai-collects-data · https://scrunch.com/faqs/what-methods-does-scrunch-use-to-collect-data-from-ai-platforms · https://www.semrush.com/kb/1607-semrush-ai-visibility-data · https://ahrefs.com/blog/brand-radar-methodology/ · https://docs.evertune.ai/en/articles/12451590-ai-models-available · https://promptwatch.com/blog/ui-vs-api-for-ai-search-visibility

**Legal:** hiQ v. LinkedIn (9th Cir. 2022) https://cdn.ca9.uscourts.gov/datastore/opinions/2022/04/18/17-16783.pdf ; consent judgment https://www.proskauer.com/blog/hiq-and-linkedin-reach-proposed-settlement-in-landmark-scraping-case · Van Buren https://www.supremecourt.gov/opinions/20pdf/19-783_k53l.pdf · Berman v. Freedom Financial https://cdn.ca9.uscourts.gov/datastore/opinions/2022/04/05/20-16900.pdf · Meta v. Bright Data https://blog.ericgoldman.org/archives/2024/01/game-on-bright-data-scores-major-victory-in-web-scraping-dispute-with-meta-guest-blog-post.htm · X Corp v. Bright Data https://blog.ericgoldman.org/archives/2025/01/catching-up-on-the-heavyweight-scraping-battle-between-x-and-bright-data-guest-blog-post.htm ; https://www.mlex.com/mlex/articles/2357003/x-corp-nears-settlement-with-bright-data-in-us-case-over-data-scraping · Ryanair v. Booking https://blog.ericgoldman.org/archives/2025/03/court-overturns-a-bad-jury-verdict-against-scraping-ryanair-v-booking-guest-blog-post.htm · Amazon v. Perplexity (9th Cir. 4 Aug 2026) https://www.cooley.com/news/insight/2026/2026-08-06-ninth-circuit-rules-on-ai-agent-access-to-third-party-websites-under-cfaa · Google v. SerpApi https://ppc.land/google-loses-dmca-bid-to-treat-search-scraping-like-dvd-piracy/ · Reddit v. SerpApi et al. https://www.courtlistener.com/docket/71720563/reddit-inc-v-serpapi-llc/ ; https://www.law360.com/articles/2508228/reddit-ai-data-scraping-case-mostly-survives-dismissal ; https://www.mlex.com/mlex/articles/2508237/us-judge-allows-reddit-anti-circumvention-claims-vs-perplexity-ai-serpapi ; https://www.loeb.com/en/insights/publications/2026/08/reddit-v-serpapi-llc · Ziff Davis v. OpenAI (robots.txt) https://chatgptiseatingtheworld.com/2025/12/16/judge-stein-rejects-ziff-davis-dmca-claim-based-on-openais-alleged-circumvention-of-robots-txt-judge-shuts-down-novel-theory-b-c-robots-txt-does-not-control-access/ · U.S. Copyright Office Part 2 https://www.copyright.gov/ai/Copyright-and-Artificial-Intelligence-Part-2-Copyrightability-Report.pdf

## Appendix B — Explicit unknowns

Bright Data: logged-in versus logged-out; which model answers; billing of `require_sources` errors; whether KYC ever applies to this scraper. Oxylabs: same session questions; free-trial duration; whether the KYC questionnaire gates the trial; internal retry count and job timeout; status history. DataForSEO: whether the $1 trial credit still exists; how `location_code` is applied for the ChatGPT scraper; governing law; any terms on LLM data. cloro: physical seat of the company; server-side retention of sync prompts and responses; proxy type; where browsers run. All vendors: which chatgpt.com model and UI variant an anonymous session receives in a given country on a given day; whether OpenAI shows the same answer to a signed-in Free user. Legal: final X/Bright Data settlement terms; the outcome of Oxylabs' stayed motion in the Reddit case; the specific anti-bot measures on chatgpt.com and whether any vendor defeats them.
