// Route policy seed values. These are the startup capability gates; a route
// disabled here fails closed everywhere in the app rather than silently
// substituting another experience. Bootstrap re-upserts every row on start.
//
// Collection observes the CONSUMER WEB surfaces — chatgpt.com and
// gemini.google.com — through collection providers that open the site in a
// signed-out browser session and return what the page showed. Two families of
// route were retired on 2026-09-14 and stay here only so their stored rows
// keep an honest label: the model-API lanes (the answers never searched the web
// and were not what a person sees) and by-hand capture (no longer a product
// feature). None of the collection providers is licensed or authorized by
// OpenAI or Google; each contract makes the customer responsible for lawful
// use, and the notes below say so.

export const ROUTE_POLICY_SEED = [
  // ---- Consumer web routes (active) -------------------------------------
  {
    providerExperience: "chatgpt_brightdata_web",
    enabled: "optional" as const,
    permittedOperations: ["automated_observation"],
    requiresCard: false,
    retentionDays: 30,
    officialSourceUrl: "https://docs.brightdata.com/products/scrapers/chatgpt/introduction",
    notes:
      "chatgpt.com in a signed-out browser session run by Bright Data (ChatGPT Scraper API, dataset gd_m7aof0k82r803d5bjm), web search permitted, proxy exit in the project's market country (echoed back in the record). Each answer takes five to twelve minutes to be ready (measured 2026-09-15); the page's model is not reported. Enabled when BRIGHTDATA_API_TOKEN is present. Free tier 5,000 records a month, no card; $1.50 per 1,000 after. Not authorized by OpenAI; Bright Data's MSA makes the customer responsible and may retain delivered data. Snapshots kept 30 days by the vendor.",
  },
  {
    providerExperience: "chatgpt_cloro_web",
    enabled: "optional" as const,
    permittedOperations: ["automated_observation"],
    requiresCard: false,
    retentionDays: 1,
    officialSourceUrl: "https://cloro.dev/docs/api-reference/endpoint/monitor-chatgpt",
    notes:
      "chatgpt.com in a signed-out browser session run by cloro, web search forced on, proxy in the project's market country. Enabled when CLORO_API_KEY is present. Free tier 500 credits a month (7 credits per synchronous ChatGPT answer), one concurrent job; Lite plan $30 a month. Not authorized by OpenAI; cloro's terms make the customer responsible and leave rights in retrieved content with the customer. Rendered-page URLs expire after 24 hours, so the page is fetched and kept locally.",
  },
  {
    providerExperience: "chatgpt_oxylabs_web",
    enabled: "optional" as const,
    permittedOperations: ["automated_observation"],
    requiresCard: false,
    retentionDays: 1,
    officialSourceUrl: "https://developers.oxylabs.io/api-targets/llms-and-ai/chatgpt",
    notes:
      "chatgpt.com rendered in a browser session by Oxylabs (Web Scraper API, source chatgpt, push-pull jobs), web search on, geo_location set to the project's market country. Enabled when OXYLABS_AUTH (username:password of a Web Scraper API user) is present. Free trial up to 2,000 results (about 770 rendered ChatGPT answers), no card, KYC questionnaire; Micro plan $49 a month after, no pay-as-you-go. Not authorized by OpenAI; Oxylabs' terms make the customer responsible and require the customer to indemnify Oxylabs. Oxylabs is a defendant in Reddit v. SerpApi et al. Job results kept 24 hours by the vendor. Live on 2026-09-15: 7 of 7 answers, median 43 s, country honoured (Indian retailers and .in sources), model reported (gpt-5-6 / gpt-5-6-mini).",
  },
  {
    providerExperience: "chatgpt_decodo_web",
    enabled: "optional" as const,
    permittedOperations: ["automated_observation"],
    requiresCard: false,
    retentionDays: 1,
    officialSourceUrl: "https://help.decodo.com/docs/web-scraping-api-chatgpt",
    notes:
      "chatgpt.com rendered in a browser session by Decodo (Web Scraping API, target chatgpt, premium proxy pool), web search on. Country targeting is NOT sent: on 2026-09-15 every ChatGPT request with geo failed (status 613) and an untargeted request exited through an arbitrary country, so rows record the origin as unknown. Reports the model the page used (gpt-5-6 on 2026-09-15). Enabled when DECODO_AUTH_TOKEN is present. Free plan 2,000 standard requests a month, which is about 670 ChatGPT answers because they bill as premium, rendered requests; $19 a month after ($1.50 per 1,000 premium JS-rendered requests). Not authorized by OpenAI; Decodo's licence makes the customer responsible for third-party content claims.",
  },
  {
    providerExperience: "gemini_cloro_web",
    enabled: "optional" as const,
    permittedOperations: ["automated_observation"],
    requiresCard: false,
    retentionDays: 1,
    officialSourceUrl: "https://cloro.dev/docs/api-reference/endpoint/monitor-gemini",
    notes:
      "gemini.google.com in a signed-out browser session run by cloro, proxy in the project's market country. Enabled when CLORO_API_KEY is present. Shares the cloro credit and concurrency budget with the ChatGPT lane. Not authorized by Google.",
  },
  // ---- Retired: model-API lanes (2026-09-14) ----------------------------
  {
    providerExperience: "gemini_free_api",
    enabled: "false" as const,
    permittedOperations: ["automated_public_business_understanding", "automated_prompt_candidate_generation"],
    requiresCard: false,
    retentionDays: 30,
    officialSourceUrl: "https://ai.google.dev/gemini-api/terms",
    notes: "Retired as a collection lane on 2026-09-14: the Gemini model API, not the Gemini app, and search grounding never ran on the free key. The key still serves onboarding stages. Stored observations keep this route id.",
  },
  {
    providerExperience: "groq_free_api",
    enabled: "false" as const,
    permittedOperations: [],
    requiresCard: false,
    retentionDays: null as number | null,
    officialSourceUrl: "https://groq.com/terms-of-use/",
    notes: "Retired as a collection lane on 2026-09-14: OpenAI's open-weight gpt-oss-120b on Groq is a model, not ChatGPT, and it does not search the web. Stored observations keep this route id.",
  },
  {
    providerExperience: "cerebras_free_api",
    enabled: "false" as const,
    permittedOperations: [],
    requiresCard: false,
    retentionDays: null as number | null,
    officialSourceUrl: "https://inference-docs.cerebras.ai/support/rate-limits",
    notes: "Retired as a collection lane on 2026-09-14: gpt-oss-120b on Cerebras is a model, not ChatGPT, and it does not search the web. Stored observations keep this route id.",
  },
  {
    providerExperience: "openai_api",
    enabled: "false" as const,
    permittedOperations: [],
    requiresCard: true,
    retentionDays: null,
    officialSourceUrl: "https://developers.openai.com/api/docs/pricing",
    notes: "Retired as a collection lane on 2026-09-14: gpt-5-nano through the OpenAI API without web search is not the ChatGPT product. The key still serves onboarding stages. Stored observations keep this route id.",
  },
  // ---- Retired: by-hand capture (2026-09-14) -----------------------------
  {
    providerExperience: "chatgpt_manual",
    enabled: "false" as const,
    permittedOperations: ["manual_observation"],
    requiresCard: false,
    retentionDays: 30,
    officialSourceUrl: "https://openai.com/policies/terms-of-use",
    notes: "Retired from the product on 2026-09-14 (operator decision). The capture API remains for stored rows and QA fixtures; the console no longer offers it.",
  },
  {
    providerExperience: "gemini_manual",
    enabled: "false" as const,
    permittedOperations: ["manual_observation"],
    requiresCard: false,
    retentionDays: 30,
    officialSourceUrl: "https://policies.google.com/terms",
    notes: "Retired from the product on 2026-09-14 (operator decision). Same posture as chatgpt_manual.",
  },
  // ---- Never ---------------------------------------------------------------
  {
    providerExperience: "consumer_browser_automation",
    enabled: "false" as const,
    permittedOperations: [],
    requiresCard: false,
    retentionDays: null,
    officialSourceUrl: null,
    notes: "Disabled. Project Sun's own code never drives chatgpt.com or gemini.google.com: OpenAI's terms prohibit programmatically extracting Output, both sites disallow their chat paths in robots.txt, and doing it ourselves would make this project the party in direct breach. Collection providers carry that activity under their own terms.",
  },
  {
    providerExperience: "licensed_partner_collector",
    enabled: "false" as const,
    permittedOperations: [],
    requiresCard: false,
    retentionDays: null,
    officialSourceUrl: null,
    notes: "Never enabled: no collection provider is licensed or authorized by OpenAI or Google (research memo 2026-09-14). Kept so the name is not reused for an unlicensed route.",
  },
] as const;

/**
 * Routes automated collection runs, in preference order per engine. The
 * first route whose vendor key is present (and whose vendor is healthy) is
 * the default for its engine; the next is the fallback when a lane pauses.
 */
export const COLLECTION_ROUTES = ["chatgpt_oxylabs_web", "chatgpt_cloro_web", "chatgpt_brightdata_web", "chatgpt_decodo_web", "gemini_cloro_web"] as const;

/** Retired automated routes: still accepted by the API for old scripts, always planned as policy_disabled. */
export const LEGACY_AUTOMATED_ROUTES = ["gemini_free_api", "openai_api", "cerebras_free_api", "groq_free_api"] as const;

/** Retired by-hand routes: the capture API still accepts their stored rows. */
export const MANUAL_ROUTES = ["chatgpt_manual", "gemini_manual"] as const;

/** Every route id a request may name. */
export const ALL_ROUTE_IDS = [...COLLECTION_ROUTES, ...LEGACY_AUTOMATED_ROUTES, ...MANUAL_ROUTES] as const;

/** Every automated route id, active or retired (the `replaces` side of a switch). */
export const AUTOMATED_ROUTE_IDS = [...COLLECTION_ROUTES, ...LEGACY_AUTOMATED_ROUTES] as const;

export function isManualRoute(providerExperience: string): boolean {
  return (MANUAL_ROUTES as readonly string[]).includes(providerExperience);
}
