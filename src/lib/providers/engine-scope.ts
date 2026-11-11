// Which answer engines the product measures, and in what order providers are tried.
//
// SUN_ENGINES      comma list of engines to collect and show. Default "chatgpt":
//                  on 2026-09-15 the operator asked to hide Gemini for the client
//                  demo. "chatgpt,gemini" brings Gemini back; nothing about a
//                  hidden engine is deleted, it is simply not planned or offered.
// SUN_PREFERRED_ROUTES  comma list of route ids moved to the front of the
//                  provider order, e.g. "chatgpt_brightdata_web" to spend free
//                  Bright Data records on test runs and keep cloro credits for
//                  the demo. Unknown ids are ignored.
//
// Server-only (reads process.env); the client learns the result from the
// credentials endpoint.

import type { AnswerEngine } from "./engines";
import { engineOf } from "./engines";
import { COLLECTION_ROUTES } from "./route-policy-seed";

export const ALL_ENGINES: readonly AnswerEngine[] = ["chatgpt", "gemini"];

function parseList(raw: string | undefined): string[] {
  return (raw ?? "")
    .split(",")
    .map((item) => item.trim().toLowerCase())
    .filter(Boolean);
}

export function enabledEngines(): AnswerEngine[] {
  const requested = parseList(process.env.SUN_ENGINES);
  const chosen = ALL_ENGINES.filter((engine) => requested.includes(engine));
  return chosen.length > 0 ? chosen : ["chatgpt"];
}

export function engineEnabled(engine: string): boolean {
  return (enabledEngines() as string[]).includes(engine);
}

/** Collection routes in the order providers are tried: preferred ids first, then the seed order. */
export function orderedCollectionRoutes(): string[] {
  const preferred = parseList(process.env.SUN_PREFERRED_ROUTES).filter((id) => (COLLECTION_ROUTES as readonly string[]).includes(id));
  const rest = COLLECTION_ROUTES.filter((id) => !preferred.includes(id));
  return [...preferred, ...rest].filter((id) => engineEnabled(engineOf(id)));
}
