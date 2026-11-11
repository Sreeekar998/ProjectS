// Prompt generation from the customer intent model.
//
// The intent model says WHAT customers need and in what context; this module
// asks a language model to say it the way customers do, one section at a time,
// and records which pieces of the model each prompt used. Those pieces become
// the prompt's coverage keys, so the selector spreads a section across real
// needs and situations instead of across phrasings of the same category.
//
// Style guidance is taken from how the prompts competitors track are actually
// written: a specific thing plus one or two concrete details, in varied chat
// openings, often first person. Exemplars are deliberately drawn from OTHER
// industries so nothing here is tuned to any benchmark business.
//
// Every draft still goes through the same brand-leakage, competitor, geography
// and natural-language validators as any other candidate.

import { appendEvent } from "@/lib/events/bus";
import { spokenName } from "@/lib/landscape/name-forms";
import { orderRivalsByTierMix } from "@/lib/landscape/competitor-tier-order";
import { PLACE_BOUND_KINDS, type BusinessKind } from "@/lib/understanding/kinds";
import { DISCOVERY_POLICY_VERSION, DISCOVERY_STYLE, planDiscoverySlots, siteClaimsFor, writeDiscoveryPrompts, type DiscoveryGeography } from "./discovery";
import { promptModelAvailable, promptStructured } from "./model-call";
import { placesMentioned } from "./geography";
import type { BusinessProfile } from "@/lib/profile/schema";
import type { Entity, Topic } from "@/lib/landscape/repository";
import type { Location } from "@/lib/geography/repository";
import type { CandidatePromptDraft, GeographyScope, Intent, PromptSection } from "./types";
import { inferRegister } from "./natural-validator";
import { buildIntentModel, type PromptIntentModel, type ShoppingNeed } from "./intent-model";

export interface IntentGenerationContext {
  projectId: string;
  profile: BusinessProfile;
  topics: Topic[];
  competitors: Entity[];
  locations: Location[];
  language: string;
}

export interface IntentGenerationResult {
  /** Section calls that returned nothing the first time and were asked again. */
  retries?: number;
  /** Sections that still returned nothing, so the template floor fills them. */
  failedSections?: string[];
  model: PromptIntentModel | null;
  drafts: CandidatePromptDraft[];
  calls: number;
}

/**
 * Trade Offs compare against the rivals a buyer actually weighs. Spreading ten
 * comparisons across every confirmed competitor paired Nike with AND1 and
 * Kappa, and Chipotle with an ice-cream chain, while the rivals customers
 * genuinely cross-shop got one prompt each.
 */
const MAX_TRADE_OFF_RIVALS = 5;
const TRADE_OFF_COUNT = 26;
const SENTIMENT_COUNT = 26;

const STYLE = `HOW REAL PEOPLE WRITE TO AI ASSISTANTS
- They say what they want and a bit of their situation, in their own words. First person is normal ("I'm training for…", "my feet get sore…"); a team buying for a company writes "we" and "our team".
- A prompt carries ONE concrete detail at most — a situation, a quality they care about, who it is for, a budget, or a place — and many carry none. Stacking several details into one sentence is what makes a prompt read as assembled.
- Openings vary naturally; many people type lowercase and leave off the question mark. Do not cycle through stock openers, and never use the same sentence frame more than twice in one batch.
- Everyday words, never a store's department labels, feature names or jargon. No em dashes and no colons used to splice two fragments ("Need a haircut: A or B?").
- Most prompts are 5 to 15 words; only a few run longer. One question per prompt. No marketing language. No dates and no words like "today", "right now" or a year.
- Audiences describe WHO is asking. Write as that person ("I'm vegetarian…", "we're a five person startup…"), never as a label ("Vegetarians need…", "Event planners…").
- Ask about the thing that has a quality, never about the quality alone ("shoes that hold up to daily runs", not "durability").
- Use the name people most commonly use for the thing, and the short name people say for a business.
- Delivery or shipping terms are never what a product is FOR ("shoes for free shipping" is wrong).
- The details you are given are IDEAS, not phrases to paste. Say them the way a person talks about their own situation.
  Not: "Looking for quiet rooms in a hotel for business travelers on a tight schedule"
  But: "I need a quiet hotel near the convention center for a work trip, any ideas?"

EXAMPLES FROM OTHER INDUSTRIES — copy the style, never the subjects:
- asana vs monday for a small agency
- Notion or Confluence for a 30 person team's docs?
- Is Wise or Revolut cheaper for sending money to India every month?
- Garmin or Apple Watch if I mostly run and swim
- Should I book the Ritz or the Four Seasons in Bangkok for a honeymoon
- is dyson worth it after a few years
- how reliable is revolut's support when a card gets blocked
- anyone had issues with wise transfers to india
- what do people think of blue apron these days
- Is Duolingo actually good for learning Japanese or just for streaks?`;

function slug(value: string): string {
  return value.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 60);
}

function describeNeeds(needs: ShoppingNeed[]) {
  return needs.map((need, index) => ({
    needIndex: index,
    category: need.category,
    situations: need.situations,
    attributes: need.attributes,
    audiences: need.audiences,
    budget: need.budgetHint,
  }));
}

function competitorsFor(ctx: IntentGenerationContext): Array<{ entityId: string; name: string }> {
  const eligible = ctx.competitors.filter((entity) => entity.kind === "competitor" && entity.status === "confirmed" && entity.competitorType !== "marketplace");
  // Confidence leads and directness is a bonus. Ranking directness first
  // dropped the most obvious rival of a restaurant chain (confidence 83,
  // typed "adjacent") below a roast-beef sandwich chain typed "direct".
  // Within that order, rivals are taken round-robin across geographic tiers so
  // a local business is compared with city-wide and national names too.
  return orderRivalsByTierMix(eligible, MAX_TRADE_OFF_RIVALS)
    // Rivals are named the way people say them ("Pancheros", not "Pancheros
    // Mexican Grill"), so the prompt reads naturally and the model has no
    // reason to shorten a name the validator then fails to find.
    .map((entity) => ({ entityId: entity.id, name: spokenName(entity.canonicalName, [entity.canonicalDomain, ...(entity.domains ?? [])]) }));
}

const SCOPE_LEVELS = ["country", "region", "city", "branch", "district", "neighborhood"];

function geographyFor(locationText: string | null | undefined, locations: Location[], text?: string): { scope: GeographyScope; text: string | null; locationId: string | null } {
  let match: Location | undefined;
  if (locationText) {
    const lower = locationText.toLowerCase();
    // Exact names first: "Dubai" is a substring of "Dubai Healthcare City", and
    // the substring-first lookup bound every Dubai prompt to the neighbourhood.
    match =
      locations.find((location) => location.name.toLowerCase() === lower) ??
      locations.find((location) => lower.includes(location.name.toLowerCase()) || location.name.toLowerCase().includes(lower));
  }
  // A prompt that names a confirmed place is bound to it even when no plan
  // asked for one, so the validator checks it and the reviewer sees it.
  if (!match && text) match = placesMentioned(text, locations)[0];
  if (!match) return { scope: "none", text: null, locationId: null };
  const scope = (SCOPE_LEVELS.includes(match.level) ? match.level : "country") as GeographyScope;
  return { scope, text: match.name, locationId: match.id };
}

interface DraftParts {
  text: string;
  section: PromptSection;
  intent: Intent;
  need: ShoppingNeed | null;
  keys: string[];
  persona?: string | null;
  situation?: string | null;
  criterion?: string | null;
  competitorEntityId?: string | null;
  sentimentTheme?: string | null;
  location?: string | null;
  /** provider:model that wrote the text. */
  model?: string;
  sequence: number;
}

function toDraft(parts: DraftParts, ctx: IntentGenerationContext): CandidatePromptDraft {
  const geography = geographyFor(parts.location, ctx.locations, parts.text);
  const topic = parts.need?.topicId ? ctx.topics.find((item) => item.id === parts.need!.topicId) : undefined;
  const register = inferRegister(parts.text);
  return {
    text: parts.text,
    cohort: parts.section === "Discovery" ? "neutral_discovery" : parts.section === "Trade Offs" ? "target_comparison" : "branded_accuracy",
    section: parts.section,
    intent: parts.intent,
    journeyStage: parts.section === "Discovery" ? "awareness" : parts.section === "Trade Offs" ? "consideration" : "decision",
    topicId: parts.need?.topicId ?? null,
    persona: parts.persona ?? null,
    useCaseConstraint: parts.situation ?? null,
    evaluationCriterion: parts.criterion ?? null,
    competitorEntityId: parts.competitorEntityId ?? null,
    sentimentTheme: parts.sentimentTheme ?? null,
    geographyScope: geography.scope,
    geographyText: geography.text,
    locationId: geography.locationId,
    language: ctx.language,
    brandPolicy: parts.section === "Discovery" ? "TARGET_FORBIDDEN" : "TARGET_REQUIRED",
    coverageCellKey: `intent:${slug(parts.section)}:${parts.sequence}`,
    evidenceBasis: ((topic?.evidenceIds as string[] | undefined) ?? []).slice(0, 6),
    contextBasis: ["source:intent_model", `register:${register}`, ...(parts.model ? [`model:${parts.model}`] : []), ...(geography.text ? [`place:${geography.scope}`] : []), ...parts.keys],
    generationMethod: "model",
    frameId: null,
    authoredBy: "system",
    register,
  };
}

const clean = (value: unknown): string | null => (typeof value === "string" && value.trim().length > 0 ? value.trim() : null);

// --- Discovery ---------------------------------------------------------------
//
// Planning, writing and judging live in `discovery.ts`; this turns the written
// prompts into drafts.

/** Businesses a customer visits, for profiles built before classification existed. */
const LOCAL_ARCHETYPES = new Set(["restaurant_food_chain", "travel_hospitality", "healthcare", "local_service", "dealership", "multi_location_chain"]);

export function discoveryGeographyFor(profile: BusinessProfile, locations: Location[]): DiscoveryGeography | undefined {
  // Only profile-bound place lists carry levels below city.
  if (!profile.classification || !locations.every((location) => location.id.startsWith("place-"))) return undefined;
  const kind = profile.classification.kind as BusinessKind;
  return { placeBound: PLACE_BOUND_KINDS.has(kind) && profile.classification.physicalPresence !== "online_only", scope: profile.marketScope.value };
}

/** Discovery drafts from the intent model: slots planned in code, written by the writer route. */
export async function discoveryDrafts(ctx: IntentGenerationContext, model: PromptIntentModel, forbiddenNames: string[]): Promise<CandidatePromptDraft[]> {
  const geo = discoveryGeographyFor(ctx.profile, ctx.locations) ?? { placeBound: LOCAL_ARCHETYPES.has(ctx.profile.archetype.value), scope: ctx.profile.marketScope.value };
  const slots = planDiscoverySlots(model, ctx.locations, geo, ctx.profile.location?.primary?.countryCode ?? null, ctx.profile.classification?.pricePositioning ?? null);
  const result = await writeDiscoveryPrompts({ projectId: ctx.projectId, profile: ctx.profile, model, slots, forbiddenNames, siteClaims: siteClaimsFor(ctx.profile, model) });
  if (!result.ok) {
    console.warn(`[intent-generation] discovery call returned no prompts: ${result.error}`);
    return [];
  }
  return result.written.map((written, index) => {
    const need = model.needs[written.slot.needIndex]!;
    const place = written.slot.place;
    // Provenance is the slot, not the model's own account of what it used.
    const keys = [
      `category:${slug(need.category)}`,
      `shape:${written.slot.shape}`,
      `style:${written.style}`,
      ...(place ? [`placeLevel:${place.level}`, `placeRole:${place.role}`] : []),
      ...(written.slot.budget ? ["budget:stated"] : []),
      `policy:${DISCOVERY_POLICY_VERSION}`,
    ];
    const purchase = /\b(where (can|should|do) i (buy|get|find)|buy|shop|store|online)\b/i.test(written.text);
    return toDraft(
      {
        text: written.text,
        section: "Discovery",
        intent: purchase ? "purchase" : "recommend",
        need,
        keys,
        persona: null,
        situation: null,
        criterion: null,
        location: place?.locationName ?? null,
        model: written.model,
        sequence: index,
      },
      ctx,
    );
  });
}

/** Area names a local business is known by (neighbourhood first, then city). */
function placeHintsFor(ctx: IntentGenerationContext): string[] {
  const geo = discoveryGeographyFor(ctx.profile, ctx.locations);
  if (!geo?.placeBound) return [];
  const primary = ctx.locations.filter((location) => location.isPrimary && (location.level === "neighborhood" || location.level === "city"));
  return primary.map((location) => location.name).slice(0, 2);
}

// --- Trade Offs --------------------------------------------------------------

interface TradeOffResponse {
  rivalNeeds?: Array<{ rival?: string; needIndexes?: number[] }>;
  prompts?: Array<{ rival?: string; factor?: string | null; needIndex?: number | null; text?: string }>;
}

// The model states which needs each rival genuinely competes on BEFORE writing
// a prompt, and prompts outside those pairs are discarded in code. Asking for
// sensible pairings in prose alone was not enough: a pizza chain was still
// compared with a burrito chain on corn tacos.
const TRADE_OFF_SCHEMA = {
  type: "object",
  properties: {
    rivalNeeds: {
      type: "array",
      items: {
        type: "object",
        properties: { rival: { type: "string" }, needIndexes: { type: "array", items: { type: "number" } } },
        required: ["rival", "needIndexes"],
      },
    },
    prompts: {
      type: "array",
      items: {
        type: "object",
        properties: {
          rival: { type: "string" },
          factor: { type: "string", nullable: true },
          needIndex: { type: "number", nullable: true },
          detailKind: { type: "string", enum: ["none", "situation", "factor", "budget", "audience"] },
          text: { type: "string" },
        },
        required: ["rival", "detailKind", "text"],
      },
    },
  },
  required: ["rivalNeeds", "prompts"],
};

async function tradeOffDrafts(ctx: IntentGenerationContext, model: PromptIntentModel, brand: string, rivals: Array<{ entityId: string; name: string }>): Promise<CandidatePromptDraft[]> {
  if (rivals.length === 0) return [];
  const localPlaces = placeHintsFor(ctx);
  const result = await promptStructured<TradeOffResponse>({
    role: "writer",
    schemaName: "trade_off_prompts",
    systemInstruction: `You write the prompts real customers type into AI assistants.\n\n${STYLE}`,
    userContent: [
      `TASK: Write ${TRADE_OFF_COUNT} TRADE OFF prompts — a customer genuinely deciding between ${brand} and ONE rival for a specific need.`,
      "Each prompt adds at most ONE detail beyond the need and the rival — a situation, a factor, a budget or who it is for — and about a third add none. Aim for 5 to 16 words, and set detailKind to the one detail used.",
      `Each prompt names ${brand} and exactly one rival from the list, is about one need, and turns on one decision factor or a concrete situation from that need. Spread prompts across the rivals and vary the factor. The factor is what the buyer is weighing, in plain words ("price as the team grows", "how it handles curly hair"); never a bare label pasted after the names.`,
      "FIRST fill rivalNeeds: for each rival, the needIndexes for which it sells the same kind of item (an empty list when none). A rival selling a different kind of item for the same occasion does not count. THEN write prompts only for those rival–need pairs, always with a needIndex.",
      `Sound like a real decision in progress, the way people type it: "${brand} or <rival> for <need>?", "<rival> vs ${brand} if we mostly <situation>", "is ${brand} or <rival> better for <need>". Short comparisons with the need are fine ("${brand} vs <rival> for api testing"); a comparison with nothing after the names, or with a criterion pasted as a label ("… reliability"), is not. Never use the same sentence frame more than twice.`,
      localPlaces.length > 0
        ? `These are local businesses. In about a third of prompts, mention the area once where it helps ("in ${localPlaces[0]}"); never more than one place, never the country.`
        : "",
      "Do not presuppose the answer. Return rival (exactly as listed), factor, needIndex and text.",
      "",
      JSON.stringify({ brand, rivals: rivals.map((rival) => rival.name), decisionFactors: model.decisionFactors, needs: describeNeeds(model.needs), ...(localPlaces.length > 0 ? { areas: localPlaces } : {}) }, null, 1),
    ]
      .filter(Boolean)
      .join("\n"),
    schema: TRADE_OFF_SCHEMA,
    temperature: 0.6,
    timeoutMs: 120_000,
    projectId: ctx.projectId,
  });
  if (!result.ok || !result.data?.prompts) {
    console.warn(`[intent-generation] section call returned no prompts: ${result.error ?? "empty response"} after ${result.latencyMs}ms`);
    return [];
  }

  const allowed = new Map<string, Set<number>>();
  for (const entry of result.data.rivalNeeds ?? []) {
    const name = (entry.rival ?? "").trim().toLowerCase();
    if (name) allowed.set(name, new Set((entry.needIndexes ?? []).filter((value) => Number.isInteger(value))));
  }

  const drafts: CandidatePromptDraft[] = [];
  result.data.prompts.forEach((prompt, index) => {
    const text = clean(prompt.text);
    const rival = rivals.find((item) => item.name.toLowerCase() === (prompt.rival ?? "").trim().toLowerCase());
    if (!text || !rival) return;
    // Enforced, not requested: a comparison on a need the rival does not
    // compete on measures nothing a buyer would ever decide.
    if (typeof prompt.needIndex !== "number" || !allowed.get(rival.name.toLowerCase())?.has(prompt.needIndex)) return;
    const need = model.needs[prompt.needIndex] ?? null;
    // "Postman vs Insomnia for api testing" is how people type a comparison;
    // the need itself is the decision criterion when the writer gave no other.
    const factor = clean(prompt.factor) ?? (need ? `fit for ${need.category}` : null);
    const keys = [`competitor:${rival.entityId}`];
    if (need) keys.push(`category:${slug(need.category)}`);
    if (factor) keys.push(`factor:${slug(factor)}`);
    drafts.push(toDraft({ text, section: "Trade Offs", intent: "compare", need, keys, criterion: factor, competitorEntityId: rival.entityId, model: result.model, sequence: index }, ctx));
  });
  return drafts;
}

// --- Sentiment ---------------------------------------------------------------

interface SentimentResponse {
  prompts?: Array<{ concern?: string; needIndex?: number | null; text?: string }>;
}

const SENTIMENT_SCHEMA = {
  type: "object",
  properties: {
    prompts: {
      type: "array",
      items: {
        type: "object",
        properties: {
          concern: { type: "string" },
          needIndex: { type: "number", nullable: true },
          text: { type: "string" },
        },
        required: ["concern", "text"],
      },
    },
  },
  required: ["prompts"],
};

async function sentimentDrafts(ctx: IntentGenerationContext, model: PromptIntentModel, brand: string, rivals: string[]): Promise<CandidatePromptDraft[]> {
  if (model.concerns.length === 0) return [];
  const localPlaces = placeHintsFor(ctx);
  const result = await promptStructured<SentimentResponse>({
    role: "writer",
    schemaName: "sentiment_prompts",
    systemInstruction: `You write the prompts real customers type into AI assistants.\n\n${STYLE}`,
    userContent: [
      `TASK: Write ${SENTIMENT_COUNT} SENTIMENT prompts — a customer checking what ${brand} is really like before buying or booking.`,
      `Each prompt names ${brand} (and no other brand), is about one concern from the list, and may mention one need. It asks what people think of ${brand}, whether it is worth it, how it holds up, what went wrong for others, or what the experience is really like.`,
      `Spread prompts across the concerns, and write each the way that worry is actually asked: "is ${brand} worth it for <need>", "what do people think of ${brand}", "anyone had problems with ${brand} <need>", "how is ${brand} for <situation>", "${brand} reviews for <need>". Do not turn a feature or a process into a question ("Can ${brand} be trusted to work with CI pipelines?", "How good is ${brand} at keeping work in sync?"); ask about the outcome a customer cares about. The asker is talking to the assistant about ${brand}, never to ${brand}: write "their photos" or "its Instagram", never "the photos you show" or "your salon".`,
      localPlaces.length > 0
        ? `${brand} is a local business. In about a third of prompts, identify it by its area once ("${brand} in ${localPlaces[0]}"); never add the country.`
        : "",
      `Never presuppose the answer. Never mention: ${rivals.join(", ") || "any other brand"}.`,
      "Return concern (exactly as listed), needIndex (or null) and text.",
      "",
      JSON.stringify({ brand, concerns: model.concerns, needs: describeNeeds(model.needs) }, null, 1),
    ]
      .filter(Boolean)
      .join("\n"),
    schema: SENTIMENT_SCHEMA,
    temperature: 0.8,
    timeoutMs: 120_000,
    projectId: ctx.projectId,
  });
  if (!result.ok || !result.data?.prompts) {
    console.warn(`[intent-generation] section call returned no prompts: ${result.error ?? "empty response"} after ${result.latencyMs}ms`);
    return [];
  }

  const drafts: CandidatePromptDraft[] = [];
  result.data.prompts.forEach((prompt, index) => {
    const text = clean(prompt.text);
    const concern = model.concerns.find((item) => item.toLowerCase() === (prompt.concern ?? "").trim().toLowerCase()) ?? clean(prompt.concern);
    if (!text || !concern) return;
    const need = typeof prompt.needIndex === "number" ? model.needs[prompt.needIndex] ?? null : null;
    const keys = [`concern:${slug(concern)}`];
    if (need) keys.push(`category:${slug(need.category)}`);
    drafts.push(toDraft({ text, section: "Sentiment Analysis", intent: "verify", need, keys, sentimentTheme: concern, model: result.model, sequence: index }, ctx));
  });
  return drafts;
}

export interface IntentGenerationOptions {
  /** Only these sections are written (a retry for a short section); default all three. */
  sections?: PromptSection[];
  /** Reuse an intent model from an earlier pass instead of asking the planner again. */
  intentModel?: PromptIntentModel | null;
}

/**
 * Builds the intent model and generates all three sections from it. The three
 * section calls are independent and run concurrently. A retry passes the
 * sections that came up short and the model from the first pass, so a
 * shortfall in Trade Offs costs one writer call, not a planner call and three
 * writer calls.
 */
export async function generateIntentDrafts(ctx: IntentGenerationContext, options: IntentGenerationOptions = {}): Promise<IntentGenerationResult> {
  const fullBrand = ctx.profile.identity.brandName.value;
  // Written the way people say it ("Atelier 10", not "Atelier 10 Salon"),
  // using the same generic short-form rule as rival names; the validator and
  // analysis both accept these forms.
  const brand = spokenName(fullBrand, [ctx.profile.identity.canonicalDomain, ...ctx.profile.identity.domains]);
  const rivals = competitorsFor(ctx);
  const everyRivalName = ctx.competitors.filter((entity) => entity.kind === "competitor").map((entity) => entity.canonicalName);
  const wanted = new Set<PromptSection>(options.sections ?? ["Discovery", "Trade Offs", "Sentiment Analysis"]);

  const reused = options.intentModel ?? null;
  const model =
    reused ??
    (await buildIntentModel({
      projectId: ctx.projectId,
      profile: ctx.profile,
      topics: ctx.topics,
      locations: ctx.locations,
      excludedNames: [fullBrand, brand, ...ctx.profile.identity.aliases.values, ...everyRivalName],
    }));
  if (!model) return { model: null, drafts: [], calls: 1 };

  // One retry per section. A single slow or failed call used to drop a whole
  // section to the template floor ("Suggest good athletic shoes for
  // athletes") for that prompt set; the retry costs a call only when needed.
  let retries = 0;
  const failedSections: string[] = [];
  const withRetry = async (section: string, run: () => Promise<CandidatePromptDraft[]>): Promise<CandidatePromptDraft[]> => {
    for (let attempt = 0; attempt < 2; attempt += 1) {
      const drafts = await run().catch(() => [] as CandidatePromptDraft[]);
      if (drafts.length > 0) return drafts;
      if (attempt === 0) retries += 1;
    }
    failedSections.push(section);
    return [];
  };
  const [discovery, tradeOffs, sentiment] = await Promise.all([
    wanted.has("Discovery") ? withRetry("Discovery", () => discoveryDrafts(ctx, model, [fullBrand, brand, ...ctx.profile.identity.aliases.values, ...everyRivalName])) : Promise.resolve([]),
    wanted.has("Trade Offs") ? withRetry("Trade Offs", () => tradeOffDrafts(ctx, model, brand, rivals)) : Promise.resolve([]),
    wanted.has("Sentiment Analysis") ? withRetry("Sentiment Analysis", () => sentimentDrafts(ctx, model, brand, everyRivalName)) : Promise.resolve([]),
  ]);
  if (failedSections.length > 0 && ctx.projectId) {
    appendEvent(ctx.projectId, "prompt.generation.section_failed", { sections: failedSections, fallback: "template" });
  }
  return { model, drafts: [...discovery, ...tradeOffs, ...sentiment], calls: (reused ? 0 : 1) + wanted.size + retries, retries, failedSections };
}

// --- Rewording one reviewed prompt ---------------------------------------------

/**
 * New wordings for one prompt, holding what it measures fixed.
 *
 * Regenerate on a provider-written prompt has no template frame to rebuild
 * from. The brand, the rival and the single detail stay; only the wording and
 * the opening change, so a replacement still measures the same thing.
 */
export async function rephrasePrompt(draft: CandidatePromptDraft, options: { brand: string; rivalName: string | null }): Promise<CandidatePromptDraft[]> {
  if (!promptModelAvailable()) return [];
  const names = draft.section === "Discovery" ? null : [options.brand, options.rivalName].filter(Boolean).join(" and ");
  const result = await promptStructured<{ prompts?: Array<{ text?: string }> }>({
    role: "writer",
    schemaName: "rephrased_prompts",
    // Discovery rewrites follow the Discovery register (discovery.ts); the shared
    // style's examples name brands, which a Discovery prompt never does.
    systemInstruction: draft.section === "Discovery"
      ? `You write the messages real customers type into ChatGPT or Gemini when they want a recommendation.\n\n${DISCOVERY_STYLE}`
      : `You write the prompts real customers type into AI assistants.\n\n${STYLE}`,
    userContent: [
      `Rewrite this ${draft.section} prompt three different ways a real person might type it.`,
      "Keep exactly what it asks for and its one detail. Change only the wording and the opening, and keep it short.",
      names ? `Every version must still name ${names}.` : "Never name any brand, company, product line, store or website.",
      "",
      draft.geographyText ? `Keep the place "${draft.geographyText}" exactly once.` : "",
      `Prompt: ${draft.text}`,
    ]
      .filter(Boolean)
      .join("\n"),
    schema: {
      type: "object",
      properties: { prompts: { type: "array", items: { type: "object", properties: { text: { type: "string" } }, required: ["text"] } } },
      required: ["prompts"],
    },
    temperature: 0.9,
    timeoutMs: 60_000,
  });
  if (!result.ok || !result.data?.prompts) return [];
  const original = draft.text.trim().toLowerCase();
  const texts = [...new Set(result.data.prompts.map((prompt) => clean(prompt.text)).filter((text): text is string => text !== null && text.toLowerCase() !== original))];
  return texts.slice(0, 3).map((text) => {
    const register = inferRegister(text);
    return { ...draft, text, register, contextBasis: [...draft.contextBasis.filter((key) => !key.startsWith("register:")), `register:${register}`] };
  });
}
