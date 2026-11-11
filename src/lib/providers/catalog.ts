// The collection providers and the routes they serve, for the console, the
// Measure page and the server alike.
//
// Client-safe: constants and pure functions only. Server code that needs keys
// or clients imports the vendor modules directly.
//
// Every route here observes a CONSUMER WEB surface: the provider opens the
// assistant's own website in a signed-out browser session, sends the prompt,
// and returns what the page showed. None of these providers is licensed or
// authorized by OpenAI or Google; each one's contract makes the customer
// responsible for lawful use. The product therefore never calls them
// "licensed", and every stored answer says which provider collected it.

import type { AnswerEngine } from "./engines";

export type CollectionVendor = "cloro" | "brightdata" | "oxylabs" | "decodo";

export interface VendorInfo {
  id: CollectionVendor;
  name: string;
  /** What the operator pastes in the key form. */
  keyLabel: string;
  keyHint: string;
  docsUrl: string;
  /** Sites this vendor can collect from, in this product. */
  engines: AnswerEngine[];
}

export const VENDORS: Record<CollectionVendor, VendorInfo> = {
  cloro: {
    id: "cloro",
    name: "cloro",
    keyLabel: "cloro API key",
    keyHint: "From cloro.dev. Free tier: 500 credits a month (7 per ChatGPT answer, 6 per Gemini), one request at a time; the $30 Lite plan allows ten at once. Fastest and cleanest answers in the 2026-09-15 comparison.",
    docsUrl: "https://cloro.dev/docs/api-reference/endpoint/monitor-chatgpt",
    engines: ["chatgpt", "gemini"],
  },
  brightdata: {
    id: "brightdata",
    name: "Bright Data",
    keyLabel: "Bright Data API token",
    keyHint: "From the Bright Data dashboard (Web Scraper API). Free tier: 5,000 records a month, no card.",
    docsUrl: "https://docs.brightdata.com/products/scrapers/chatgpt/introduction",
    engines: ["chatgpt"],
  },
  oxylabs: {
    id: "oxylabs",
    name: "Oxylabs",
    keyLabel: "Oxylabs Web Scraper API user, as username:password",
    keyHint: "Create a Web Scraper API user in the Oxylabs dashboard and paste its username and password joined by a colon. Free trial: up to 2,000 results (about 770 rendered ChatGPT answers), no card; Oxylabs asks every customer a short use-case questionnaire first. Fastest and most local in the 2026-09-15 comparison, and reports the page's model.",
    docsUrl: "https://developers.oxylabs.io/api-targets/llms-and-ai/chatgpt",
    engines: ["chatgpt"],
  },
  decodo: {
    id: "decodo",
    name: "Decodo",
    keyLabel: "Decodo Web Scraping API token",
    keyHint: "The Basic-auth token from the Decodo dashboard, or user:password. Free plan: 2,000 standard requests a month, about 670 ChatGPT answers (they bill as premium, rendered requests). Reports the model the page used, but cannot target a country for ChatGPT.",
    docsUrl: "https://help.decodo.com/docs/web-scraping-api-chatgpt",
    engines: ["chatgpt"],
  },
};

/** Collection vendors in preference order, for the settings page and key checks; never shown in Measure. */
export const COLLECTION_VENDOR_IDS: CollectionVendor[] = ["oxylabs", "cloro", "brightdata", "decodo"];
export const CREDENTIAL_PROVIDER_IDS = ["cloro", "brightdata", "oxylabs", "decodo", "gemini", "groq", "cerebras", "openai"] as const;
export type CredentialProviderId = (typeof CREDENTIAL_PROVIDER_IDS)[number];

export interface ConsumerWebRoute {
  id: string;
  engine: AnswerEngine;
  vendor: CollectionVendor;
  site: "chatgpt.com" | "gemini.google.com";
}

/**
 * Consumer-web routes in preference order per engine. The first route whose
 * vendor key is present and whose vendor is healthy is the default; the next
 * one is the fallback when a lane pauses.
 */
export const CONSUMER_WEB_ROUTES: readonly ConsumerWebRoute[] = [
  // Order set on 2026-09-15 after two live comparisons on the same six
  // approved prompts (country IN): Oxylabs was fastest (median 43 s), the most
  // local (34 .in domains cited, rupee prices in 5 of 6) and the only one to
  // report the page's model on every answer; cloro was next (69 s, clean
  // text, country honoured); Bright Data honoured the country but took 5–14
  // minutes an answer; Decodo cannot be placed in a country and is the last
  // resort. SUN_PREFERRED_ROUTES overrides this order without a code change.
  { id: "chatgpt_oxylabs_web", engine: "chatgpt", vendor: "oxylabs", site: "chatgpt.com" },
  { id: "chatgpt_cloro_web", engine: "chatgpt", vendor: "cloro", site: "chatgpt.com" },
  { id: "chatgpt_brightdata_web", engine: "chatgpt", vendor: "brightdata", site: "chatgpt.com" },
  { id: "chatgpt_decodo_web", engine: "chatgpt", vendor: "decodo", site: "chatgpt.com" },
  { id: "gemini_cloro_web", engine: "gemini", vendor: "cloro", site: "gemini.google.com" },
] as const;

export function consumerWebRoute(id: string): ConsumerWebRoute | null {
  return CONSUMER_WEB_ROUTES.find((route) => route.id === id) ?? null;
}

export function vendorOfRoute(id: string): CollectionVendor | null {
  return consumerWebRoute(id)?.vendor ?? null;
}

export function routesForEngine(engine: AnswerEngine): ConsumerWebRoute[] {
  return CONSUMER_WEB_ROUTES.filter((route) => route.engine === engine);
}

/** Why a lane stopped. Quota and vendor trouble come back by themselves; the rest need the operator. */
export type PausedReason = "quota" | "no_credits" | "key_rejected" | "vendor_unhealthy" | "target_blocked" | "budget_cap";

export function pausedReasonOf(paceReason: string | null | undefined): PausedReason {
  if (paceReason === "no_credits" || paceReason === "key_rejected" || paceReason === "vendor_unhealthy" || paceReason === "target_blocked" || paceReason === "budget_cap") {
    return paceReason;
  }
  return "quota";
}

/**
 * How each route is shown. Readers see the engine and where the answer came
 * from; which provider ran the browser is method detail, kept short here and
 * spelled out in Measure's method notes.
 */
export const ROUTE_LABEL: Record<string, { name: string; detail: string; kind: "web" | "api" | "manual" }> = {
  chatgpt_brightdata_web: { name: "ChatGPT", detail: "From chatgpt.com", kind: "web" },
  chatgpt_cloro_web: { name: "ChatGPT", detail: "From chatgpt.com", kind: "web" },
  chatgpt_oxylabs_web: { name: "ChatGPT", detail: "From chatgpt.com", kind: "web" },
  chatgpt_decodo_web: { name: "ChatGPT", detail: "From chatgpt.com", kind: "web" },
  gemini_cloro_web: { name: "Gemini", detail: "From gemini.google.com", kind: "web" },
  // Retired routes: stored rows still render with an honest label.
  gemini_free_api: { name: "Gemini", detail: "Model API (retired route)", kind: "api" },
  groq_free_api: { name: "ChatGPT", detail: "Model API (retired route)", kind: "api" },
  cerebras_free_api: { name: "ChatGPT", detail: "Model API (retired route)", kind: "api" },
  openai_api: { name: "ChatGPT", detail: "Model API (retired route)", kind: "api" },
  chatgpt_manual: { name: "ChatGPT", detail: "Asked by hand (retired route)", kind: "manual" },
  gemini_manual: { name: "Gemini", detail: "Asked by hand (retired route)", kind: "manual" },
};

/** The one-line method note for a route, for Measure. */
export const ROUTE_METHOD: Record<string, string> = {
  // Method texts name the site and the session, never the collection
  // infrastructure behind it: which vendor collected an answer is internal
  // (the provider_responses row, logs and the collection settings page).
  chatgpt_brightdata_web: "ChatGPT on the web: each question is asked at chatgpt.com in a signed-out browser session, with web search allowed, from the project’s market country.",
  chatgpt_cloro_web: "ChatGPT on the web: each question is asked at chatgpt.com in a signed-out browser session, with web search on, from the project’s market country.",
  chatgpt_oxylabs_web: "ChatGPT on the web: each question is asked at chatgpt.com in a signed-out browser session, with web search on, from the project’s market country.",
  chatgpt_decodo_web: "ChatGPT on the web: each question is asked at chatgpt.com in a signed-out browser session, with web search on; where these answers were observed from is not known.",
  gemini_cloro_web: "Gemini on the web: each question is asked at gemini.google.com in a signed-out browser session, from the project’s market country.",
  gemini_free_api: "Gemini, asked automatically (retired route): each question went to Google’s Gemini Flash-Lite model, without web search.",
  groq_free_api: "ChatGPT, asked automatically (retired route): each question went to OpenAI’s open-weight gpt-oss-120b model, which does not search the web.",
  cerebras_free_api: "ChatGPT, asked automatically (retired route): each question went to OpenAI’s open-weight gpt-oss-120b model, which does not search the web.",
  openai_api: "ChatGPT, asked automatically (retired route): each question went to OpenAI’s gpt-5-nano model through the OpenAI API, without web search.",
  chatgpt_manual: "ChatGPT, asked by hand (retired route): a person asked at chatgpt.com and pasted back the answer and its sources.",
  gemini_manual: "Gemini, asked by hand (retired route): a person asked at gemini.google.com and pasted back the answer and its sources.",
};
