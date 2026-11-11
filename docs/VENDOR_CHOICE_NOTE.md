# Why Project Sun collects ChatGPT answers through Oxylabs

A demo talking note. Every figure comes from the live comparison of
2026-09-15 (six identical Nike-India prompts, country India, through each
provider) and from the providers' own pricing pages; details in
`CHATGPT_CONSUMER_COLLECTION_DECISION_MEMO.md` §7, §19 and §20.

## How the answers are collected

Each provider runs a real browser for us: it opens chatgpt.com as a
signed-out visitor, through a proxy in the client's market country, types the
question with web search on, waits for the page to render, and returns what
the page showed: the answer, the sources panel, the search queries ChatGPT
ran, and (where the page shows it) the model name. Nothing calls the OpenAI
API, so what the platform shows is the real ChatGPT web answer an anonymous
visitor in that country gets.

For Oxylabs specifically: JavaScript rendering is always on for its ChatGPT
source (their docs forbid even passing a `render` flag, because it is
forced), the job is submitted and polled ("push-pull"), and the parsed result
carries `response_text`, `markdown_text`, `llm_model`, `citations` and
`search_queries`. Every answer records which provider collected it, the
country it was asked from, the model the page named and the sources it
showed; Measure's Methodology view shows all of this.

Three honest differences from a signed-in person, stated in the product:
no memory or personalisation (fresh, anonymous session), web search forced
on, and no provider is licensed or authorised by OpenAI.

## The four providers, side by side

| | Oxylabs | cloro | Bright Data | Decodo |
|---|---|---|---|---|
| Answers returned | 6 of 6 | 6 of 6 | 6 of 6 | 6 of 6 |
| Time per answer, median (worst) | 43 s (54 s) | 69 s (119 s) | 10 min (14 min) | 132 s (139 s) |
| Answered from the market country | yes | yes | yes | no (cannot target a country) |
| Local evidence (`.in` domains cited, 6 answers) | 34 | 5 | 10 | 13 |
| Sources per answer | 15.8 | 6.2 | 4.5 | 12.2 |
| Model the page named | every answer (gpt-5-6, gpt-5-6-mini) | 1 of 6 | never | every answer |
| Free allowance | ~770 rendered answers, no card | 500 credits a month (~70 answers) | 5,000 records a month | ~670 answers a month |
| After the free allowance | $49 a month (37,692 answers), no pay-as-you-go | $30 a month (37,500 credits, ~5,350 answers) | $1.50 per 1,000 | $19 a month |
| Concurrency we run | 5 (configurable) | 1 free, 10 on the $30 plan | 5 | 2 |
| Time for a 30-question run | about 5 minutes | 15–25 min free, ~5 min on Lite | about an hour | about 30 minutes |

## Why Oxylabs first, in one breath

Fastest of the four, most local (Indian retailers and brands in the sources,
the most `.in` domains), the richest source lists, and the only one that
reported the model on every answer, including that some questions are
answered by the smaller `gpt-5-6-mini`, which is exactly the kind of fact a
measurement product should record rather than assume.

## What to say about the others

- **cloro** is second: the cleanest answer text and the only provider with a
  Gemini scraper, but slower and the page rarely names the model. It is the
  automatic fallback and the route for Gemini if Gemini is switched on.
- **Bright Data** is third: free and reliable, but five to fourteen minutes
  per answer, so a run takes an hour.
- **Decodo** is last: it cannot be pinned to a country, so answers come from
  random locations, which is wrong for a market-specific measurement.

The product tries them in that order and hands a stopped run to the next
provider by itself (checked with a test question first, paused after
repeated failures, re-checked every half hour for a day).

## What to be straight about

- Oxylabs' free trial has no published end date and no pay-as-you-go after
  it: the first paid step is $49 a month. cloro's $30 plan is the cheaper
  paid fallback if the trial lapses.
- Oxylabs asks every new customer a short use-case questionnaire and approves
  about three quarters; it is also a named defendant in *Reddit v. SerpApi
  et al.* (its motion is stayed). Nothing about that changes what the
  product shows; it is a supplier risk, covered by the fallback chain.
- One answer per question per run is a directional baseline, not a stable
  estimate; the product says so on every figure and compares runs only when
  the questions, competitors and rules are unchanged.

## What scale costs

A run is 30 approved questions, once each, per engine: 30 ChatGPT answers
(60 with Gemini via cloro, 6 credits each).

| Cadence | ChatGPT answers a month | Oxylabs | cloro | Bright Data |
|---|---|---|---|---|
| 1 client, weekly | 120 | trial, then $49 plan | free tier covers ~70; Lite $30 | free |
| 10 clients, weekly | 1,200 | $49 (Micro plan holds 37,692) | Lite $30 (holds ~5,350) | free (5,000) |
| 100 clients, weekly | 12,000 | $49 (still inside Micro) | above Lite; next tier not verified | ~$10.50 over the free 5,000 |
| Per answer at list price | | $0.00135 | ≈$0.0056 (7 credits) | $0.0015 |

The money is never the constraint; the plan minimums, the provider's
concurrency (which sets run time) and the monthly allowance are. Budget about
20% extra for retries and billed failures (Oxylabs bills any rendered page,
even one it could not parse). Doubling the prompt count doubles all of the
above; the product currently plans exactly 30 approved questions per run.
