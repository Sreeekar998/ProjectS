// Which answer engine an observation represents, and on which surface.
//
// A route is how an answer was collected. An engine is what a reader cares
// about: ChatGPT or Gemini. A surface says WHERE the answer was observed:
//
//   consumer_web  the assistant's own website (chatgpt.com, gemini.google.com),
//                 opened in a signed-out browser session by a collection
//                 provider — the product surface a visitor sees;
//   by_hand       the same websites, read by a person and pasted back
//                 (retired from the product on 2026-09-14; stored rows remain);
//   api           the vendor's model API, not the product (retired the same
//                 day: the answers never searched the web and were not what a
//                 person sees).
//
// Measure reports by engine; the collection console still shows each route.
// Client-safe: no server imports.

export type AnswerEngine = "chatgpt" | "gemini";
export type AnswerSurface = "consumer_web" | "by_hand" | "api";

const ROUTE_ENGINE: Record<string, AnswerEngine> = {
  chatgpt_cloro_web: "chatgpt",
  chatgpt_brightdata_web: "chatgpt",
  chatgpt_oxylabs_web: "chatgpt",
  chatgpt_decodo_web: "chatgpt",
  gemini_cloro_web: "gemini",
  // Retired routes stay mapped so stored observations keep their engine.
  groq_free_api: "chatgpt",
  cerebras_free_api: "chatgpt",
  openai_api: "chatgpt",
  chatgpt_manual: "chatgpt",
  chatgpt_plus_manual: "chatgpt",
  gemini_free_api: "gemini",
  gemini_manual: "gemini",
  gemini_apps_manual: "gemini",
};

export const ENGINE_LABEL: Record<AnswerEngine, string> = { chatgpt: "ChatGPT", gemini: "Gemini" };

export function engineOf(providerExperience: string): string {
  const known = ROUTE_ENGINE[providerExperience];
  if (known) return known;
  if (/gemini/i.test(providerExperience)) return "gemini";
  if (/chatgpt|openai|gpt/i.test(providerExperience)) return "chatgpt";
  return providerExperience;
}

/** Answers a person asked in the consumer app and pasted back (retired route family). */
/**
 * What a reader may know about where an answer came from: the engine and the
 * surface ("ChatGPT on the web", "Gemini, asked by hand"). Never the vendor
 * behind the route: that is internal (the stored route id, logs, settings).
 */
export function surfaceLabel(providerExperience: string): string {
  const engine = engineOf(providerExperience);
  const name = ENGINE_LABEL[engine as AnswerEngine] ?? (engine ? engine.charAt(0).toUpperCase() + engine.slice(1) : "Unknown");
  return isByHandRoute(providerExperience) ? `${name}, asked by hand` : isConsumerWebRoute(providerExperience) ? `${name} on the web` : name;
}

/** One method sentence per surface, for Methodology and the Report. */
export function surfaceMethod(providerExperience: string): string {
  const engine = engineOf(providerExperience);
  const site = engine === "gemini" ? "gemini.google.com" : "chatgpt.com";
  const name = ENGINE_LABEL[engine as AnswerEngine] ?? engine;
  if (isByHandRoute(providerExperience)) return `${name}, asked by hand (retired route): the operator asked the question on the site and pasted the answer.`;
  if (!isConsumerWebRoute(providerExperience)) return `${name}, asked automatically (retired route): the question went to a model API, without web search.`;
  return engine === "gemini"
    ? `${name} on the web: each question is asked at ${site} in a signed-out browser session, from the project’s market country.`
    : `${name} on the web: each question is asked at ${site} in a signed-out browser session, with web search on, from the project’s market country where that can be chosen.`;
}

export function isByHandRoute(providerExperience: string): boolean {
  return /_manual$/.test(providerExperience);
}

/** Answers collected from the assistant's website by a collection provider. */
export function isConsumerWebRoute(providerExperience: string): boolean {
  return /_web$/.test(providerExperience);
}

export function surfaceOf(providerExperience: string): AnswerSurface {
  if (isByHandRoute(providerExperience)) return "by_hand";
  if (isConsumerWebRoute(providerExperience)) return "consumer_web";
  return "api";
}
