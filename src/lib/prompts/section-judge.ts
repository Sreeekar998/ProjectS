// Judge for Trade Off and Sentiment prompts: would a real buyer type this?
//
// The heuristic scorer rates structure (a rival is named, a criterion is
// bound, the word count fits) and cannot tell "Postman vs Insomnia for api
// testing" from "Atelier 10 Salon vs 011 Italian Grooming DIFC reliability".
// Both carry a brand, a rival and a criterion; only one is a sentence a
// person would write. When a section is short of model-written prompts the
// template floor fills it, and those splices reached approved sets.
//
// Like the Discovery judge (discovery.ts) this is a filter, not a ranker: a
// few yes/no checks per prompt against real comparison and reputation
// questions from other industries, and a failed check puts the prompt below
// the selection floor. It runs once per section over model-written AND
// template survivors, so a mechanical template can no longer be selected in a
// section a model wrote for.

import { generateStructured } from "@/lib/llm";
import type { ModelRoute } from "@/lib/llm/types";
import type { BusinessProfile } from "@/lib/profile/schema";
import { judgeRoutes } from "./discovery";
import type { PromptSection } from "./types";

export interface SectionVerdict {
  /** Reads like a message a person typed, not a template with names dropped in. */
  readsReal: boolean;
  /** Trade Offs: a buyer would plausibly weigh these two on this. Sentiment: a real worry people check about a business of this kind. */
  realQuestion: boolean;
  /** Stacked details, a bare "X vs Y <criterion>" splice, a dangling fragment, jargon or advertising words. */
  assembled: boolean;
  /** Names the required brands and no other. */
  namesRight: boolean;
  giveaway: string;
}

/** Comparison and reputation questions people actually type, from industries no measured business belongs to. */
export const SECTION_REFERENCE_PROMPTS: Record<Exclude<PromptSection, "Discovery">, string[]> = {
  "Trade Offs": [
    "asana vs monday for a small agency",
    "Notion or Confluence for a 30 person team's docs?",
    "Should I book the Ritz or the Four Seasons in Bangkok for a honeymoon",
    "zara vs h&m quality for basics",
    "Is Wise or Revolut cheaper for sending money to India every month?",
    "Garmin or Apple Watch if I mostly run and swim",
    "clickup vs monday.com for a marketing team",
    "Would you go with Shopify or WooCommerce for a small shop that ships to the EU?",
  ],
  "Sentiment Analysis": [
    "is dyson worth it after a few years",
    "how reliable is revolut's support when a card gets blocked",
    "anyone had issues with wise transfers to india",
    "Is Marriott Bonvoy worth it if I only travel twice a year?",
    "what do people think of blue apron these days",
    "does zara clothing hold up after washing",
    "Is Duolingo actually good for learning Japanese or just for streaks?",
    "how is the customer service at monzo",
  ],
};

const SYSTEM = `You audit prompts for a study of how AI assistants describe and compare businesses.

Each prompt is meant to be a message a real customer types into ChatGPT or Gemini. TRADE OFF prompts compare the study's business with exactly one rival for a decision the customer is making. SENTIMENT prompts ask what the study's business is like before buying from it. You receive the business, its rivals, a list of REAL prompts people have typed (other industries), and numbered prompts to audit with their section.

Answer every check for every prompt, strictly and independently:
- readsReal: would it sit unnoticed among the REAL prompts? Plain sentences, blunt fragments, lowercase, missing punctuation and "X vs Y for <thing>" all read real. false when it is stiff, formal or wordy in a way none of them are, or built from labels ("<Brand> vs <Rival> reliability", "<Brand> customer service reviews DIFC").
- realQuestion: Trade Offs — would a buyer plausibly weigh these two businesses on this point for this kind of purchase? false when the comparison is on something neither would be chosen for, or the decision is contrived ("for reusing API schemas"). Sentiment — is this a real worry people check about a business of this kind (price, worth it, reliability, support, quality of the result, trust with something valuable, how it copes with the asker's situation), asked the way people ask it? false only for a feature or process description turned into a question ("Can X be trusted to work with CI/CD pipelines?", "How good is X at keeping editor work in sync?"), or when the prompt speaks to the business itself as "you" or "your" ("does X deliver balayage like the photos you show", "how close are X results to your reference photo"): the person is asking the assistant about the business, so it is "their photos", "the photos on its Instagram". "Would you recommend X" addresses the assistant and is fine. Asking how a product fits the asker's own setup or team is a real worry, not a feature question.
- assembled: true only for one of these defects: (1) THREE or more separate details besides the brands and the need ("for a small team in Dubai under AED 300 before Friday"), or two details that no one would put in one breath; (2) a criterion pasted as a bare noun phrase after the names ("<Brand> vs <Rival> reliability", "<Brand> pricing reviews DIFC"); (3) an em dash fragment or a colon splice ("Need a haircut: A or B?"); (4) advertising words or trade jargon a customer would not use; (5) a price written as a range or a pasted figure ("within AED 80–250").
  Everyday context is NOT assembled and is the normal way people ask: the need ("for a haircut", "for API testing"), ONE situation ("as our team grows", "when a card gets blocked", "for a solo developer", "if my gel polish keeps peeling"), who it is for, a plan or price tier ("on the free plan"), or a plain preference. For a business people visit, the area or city is ordinary context too ("A or B for a haircut in DIFC", "A vs B for lashes in Dubai"): one place with one need is how locals ask, never assembled. A prompt with the need plus one such detail, in plain words, passes.
- namesRight: Trade Offs name the business and exactly one of the listed rivals and nothing else; Sentiment names the business and no rival.
- giveaway: when any check fails, the few words that give it away; otherwise "".
Judge the words only; assume nothing about the businesses beyond what you are given. Names may be written the short way people say them.`;

const SCHEMA = {
  type: "object",
  properties: {
    verdicts: {
      type: "array",
      items: {
        type: "object",
        properties: {
          index: { type: "number" },
          readsReal: { type: "boolean" },
          realQuestion: { type: "boolean" },
          assembled: { type: "boolean" },
          namesRight: { type: "boolean" },
          giveaway: { type: "string" },
        },
        required: ["index", "readsReal", "realQuestion", "assembled", "namesRight", "giveaway"],
      },
    },
  },
  required: ["verdicts"],
};

export interface SectionJudgeInput {
  projectId?: string;
  profile: BusinessProfile;
  /** The business as it is written in prompts. */
  brand: string;
  /** Rival names as written in prompts, with the recorded names. */
  rivals: string[];
  section: Exclude<PromptSection, "Discovery">;
  texts: string[];
  routes?: ModelRoute[];
}

export async function judgeSectionPrompts(input: SectionJudgeInput): Promise<{ verdicts: Map<number, SectionVerdict>; model: string | null }> {
  const verdicts = new Map<number, SectionVerdict>();
  if (input.texts.length === 0) return { verdicts, model: null };
  const payload = {
    business: {
      name: input.brand,
      kind: input.profile.classification?.businessType ?? input.profile.industry.value,
      buyer: input.profile.classification?.customerType ?? "unknown",
      description: input.profile.description.value,
    },
    rivals: input.rivals,
    section: input.section,
    realPrompts: SECTION_REFERENCE_PROMPTS[input.section],
    prompts: input.texts.map((text, index) => ({ index, text })),
  };
  const result = await generateStructured<{ verdicts?: Array<Partial<SectionVerdict> & { index?: number }> }>({
    stage: "judge",
    schemaName: "section_prompt_audit",
    schema: SCHEMA,
    systemInstruction: SYSTEM,
    userContent: `<study>\n${JSON.stringify(payload, null, 1)}\n</study>`,
    temperature: 0,
    reasoningEffort: "low",
    timeoutMs: 120_000,
    projectId: input.projectId,
    routes: input.routes ?? judgeRoutes(),
  });
  if (!result.ok || !result.data?.verdicts) return { verdicts, model: null };
  for (const raw of result.data.verdicts) {
    if (typeof raw.index !== "number" || raw.index < 0 || raw.index >= input.texts.length) continue;
    verdicts.set(raw.index, {
      readsReal: raw.readsReal !== false,
      realQuestion: raw.realQuestion !== false,
      assembled: raw.assembled === true,
      namesRight: raw.namesRight !== false,
      giveaway: typeof raw.giveaway === "string" ? raw.giveaway.slice(0, 160) : "",
    });
  }
  return { verdicts, model: `${result.provider}:${result.model}` };
}

const FAILED_CHECK_SCORE = 30;
const PASSED_SCORE = 90;

/** A verdict as a 0–100 quality score and the first failed check, if any. */
export function sectionVerdictScore(verdict: SectionVerdict): { total: number; failed: string | null } {
  const failed = !verdict.namesRight
    ? "does not name the right brands"
    : verdict.assembled
      ? "reads as assembled"
      : !verdict.realQuestion
        ? "not a decision or worry a real buyer has"
        : !verdict.readsReal
          ? "stands out from real prompts"
          : null;
  return failed ? { total: FAILED_CHECK_SCORE, failed } : { total: PASSED_SCORE, failed: null };
}
