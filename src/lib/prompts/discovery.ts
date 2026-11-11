// Discovery prompts: what a customer asks an assistant before any business is
// in mind, so the answer shows whether the brand comes up on its own.
//
// WHY IT IS BUILT THIS WAY (rebuilt 2026-09-14)
//
// The previous planner fixed every prompt as one need × exactly one detail
// (rotating none / situation / audience / budget / attribute) × a place, and
// asked a model to realise each plan word for word. Across 15 real businesses
// its 150 selected prompts were all 7–15 words long; 23% carried an em dash
// ("I want low-maintenance lashes—which Dubai salon should I book?"); 10%
// pasted a price band ("Help me find a DIFC colourist within AED 800–2,500");
// landmarks from the site became places ("which dental clinic near Hotel Jen");
// and the website's own selling points became requirements ("Looking for a
// Dubai hair salon that starts with a proper consultation", "Which proposal
// tool should I pick for document formatting?"). The heuristic scorer rated
// every one of them 81–96.
//
// Research on synthetic queries explains the pattern: a writer grounded in a
// company's own pages copies its wording and claims even when told not to, and
// instruction lists do not fix register — examples and filtering do. So:
//   * code still decides WHAT is measured: which need, whether and where a
//     place is named, and which slots may mention money;
//   * the writer sees needs in customer words, not the site's claims, is told
//     the claims to avoid, and writes two versions per slot in the shapes real
//     people use (a bare search, a question, a request, a short situation);
//   * a separate judge from another model family checks each prompt with
//     yes/no questions (does it ask for options, could several businesses
//     answer, does it echo the site, is it assembled) plus a naturalness
//     rating, and failures are never auto-selected;
//   * selection spreads the ten across needs, shapes, openings and places.
// Every draft still passes the same leakage, geography and language gates.

import { countryCodesMentioned, countryPhrase } from "@/lib/geo/countries";
import { choiceNounForKind, PLACE_BOUND_KINDS, type BusinessKind } from "@/lib/understanding/kinds";
import { routesForStage, generateStructured } from "@/lib/llm";
import type { ModelRoute } from "@/lib/llm/types";
import type { BusinessProfile } from "@/lib/profile/schema";
import type { Location } from "@/lib/geography/repository";
import type { PromptIntentModel } from "./intent-model";
import { promptStructured } from "./model-call";
import { choiceUnitForProfile } from "./choice-unit";

// @3: the writer asks for the PLACE for a business people visit ("salons in
// DIFC for highlights", never "find me highlights in DIFC"); B2B prompts are
// written as a team buying a category of tool, with B2B reference prompts
// for the judge; a premium business may be asked for as "luxury"/"high-end"
// the way a budget one is asked for as "cheap"; a service the business sells
// is never one of its "claims"; the judge checks that the thing asked for is
// a real category buyers compare providers in.
export const DISCOVERY_POLICY_VERSION = "discovery@3";

// --- Places --------------------------------------------------------------------

export interface DiscoveryGeography {
  placeBound: boolean;
  scope: string;
}

export interface DiscoveryPlace {
  /** The approved location's name, which validation binds the prompt to. */
  locationName: string;
  level: string;
  /** How a person writes it: "Koramangala", not "KHB Colony, 7th Block, Koramangala". */
  say: string;
  countryCode: string | null;
  /** The business's own area or city, another area its site names, or a market country. */
  role: "primary" | "nearby" | "country";
}

/**
 * Names a person would not use as the place in a recommendation question:
 * hotels, malls, stations, streets and corners the site mentions as
 * directions ("Regent Hotel", "next to Corner House", "Gildas, corner of Mary
 * and Albion Street"), and office parks that are only a head-office address
 * ("Quorum Business Park").
 */
const LANDMARK = /\b(hotel|mall|station|metro|airport|street|st|road|rd|lane|boulevard|blvd|corner|next to|near|opposite|behind|beside|building|tower|plaza|complex|floor|block|suite|unit|gate|exit|junction|roundabout|business park|office park|industrial estate|hospital|campus)\b/i;
/** A primary neighbourhood is the business's own area; only address-like names are unusable. */
const NOT_AN_AREA = /\b(hotel|mall|station|airport|building|tower|complex|floor|block|suite|unit|business park|office park|industrial estate)\b/i;

/** The part of a place name a person says, or null when it is a landmark or an address. */
export function spokenPlace(name: string, role: "primary" | "nearby"): string | null {
  // "KHB Colony, 7th Block, Koramangala": the last named part is the area people know.
  const parts = name.split(",").map((part) => part.trim()).filter(Boolean);
  const said = parts.at(-1) ?? name.trim();
  if (!said || /\d/.test(said) || said.length > 40) return null;
  if ((role === "nearby" ? LANDMARK : NOT_AN_AREA).test(said)) return null;
  return said;
}

/** How people usually write a country with a common short form. */
const COUNTRY_SAY: Record<string, string> = { AE: "the UAE", GB: "the UK", US: "the US" };

/** Common short forms people write for a country ("the UAE", "the UK"). */
const COUNTRY_SHORT: Record<string, RegExp> = {
  GB: /\b(uk|u\.k\.|britain)\b/i,
  // "us" is also a pronoun, so only the capitalised forms count.
  US: /\b(US|U\.S\.|USA|usa|America)\b/,
  AE: /\b(uae|emirates)\b/i,
  SA: /\b(ksa|saudi)\b/i,
};

/** Whether the text names the place, in any form a person would write it. */
export function mentionsPlace(text: string, place: DiscoveryPlace): boolean {
  const escaped = (value: string) => value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const named = (value: string) => new RegExp(`(^|[^\\p{L}\\p{N}])${escaped(value)}(?=[^\\p{L}\\p{N}]|$)`, "iu").test(text);
  if (named(place.say.replace(/^the\s+/i, "")) || named(place.locationName)) return true;
  if (place.level === "country" && place.countryCode) {
    if (countryCodesMentioned(text).includes(place.countryCode)) return true;
    return COUNTRY_SHORT[place.countryCode]?.test(text) ?? false;
  }
  return false;
}

/**
 * The places Discovery prompts name, in the order they are handed out, and
 * how many slots in a row share one place-less turn.
 *
 * A business customers visit is answered per place — an assistant answering
 * over the API does not know where the asker is — so every slot names one: its
 * own area and its city most, a nearby area the site names now and then. A
 * national business names its country on two slots in three, an international
 * one on one in three, a global one rarely.
 */
export function discoveryPlaces(locations: Location[], geo: DiscoveryGeography | undefined): { places: DiscoveryPlace[]; placeEvery: number } {
  const toPlace = (location: Location, role: "primary" | "nearby"): DiscoveryPlace | null => {
    if (location.level === "country") {
      const say = (location.countryCode && COUNTRY_SAY[location.countryCode]) || countryPhrase(location.name);
      return { locationName: location.name, level: location.level, say, countryCode: location.countryCode ?? null, role: "country" };
    }
    const say = spokenPlace(location.name, role);
    return say ? { locationName: location.name, level: location.level, say, countryCode: location.countryCode ?? null, role } : null;
  };
  const keep = (values: Array<DiscoveryPlace | null>) => values.filter((value): value is DiscoveryPlace => value !== null);
  const byLevel = (level: string) => locations.filter((location) => location.level === level);

  if (geo?.placeBound) {
    const areas = [...byLevel("neighborhood"), ...byLevel("district")];
    const area = keep(areas.filter((location) => location.isPrimary).map((location) => toPlace(location, "primary")))[0];
    const nearby = keep(areas.filter((location) => !location.isPrimary).map((location) => toPlace(location, "nearby")));
    const cities = keep(byLevel("city").map((location) => toPlace(location, location.isPrimary ? "primary" : "nearby")));
    const region = keep(byLevel("region").map((location) => toPlace(location, "primary")))[0];
    const cycle: DiscoveryPlace[] = [];
    if (area) {
      // Measured around one area. People name the city most (about 60% of
      // local asks in the Search Arena sample) and the neighbourhood next; the
      // areas a site lists come last.
      const pattern: Array<DiscoveryPlace | undefined> = [cities[0], area, cities[0], nearby[0], cities[1] ?? cities[0], area, cities[0], nearby[1] ?? region];
      for (const place of pattern) if (place) cycle.push(place);
    } else if (cities.length > 0) {
      // Measured across the city (a chain with branches across it, or the
      // operator chose the city): the city leads three slots in four and the
      // branches' areas take the fourth in turn, so a chain measured across
      // Dubai still gets the "in JVC" asks people make, without one branch
      // standing for the business.
      const rounds = Math.max(1, nearby.length);
      for (let round = 0; round < rounds; round += 1) {
        cycle.push(cities[0]!, cities[0]!, cities[1] ?? cities[0]!);
        if (nearby[round]) cycle.push(nearby[round]!);
      }
    } else if (nearby.length > 0) {
      // Areas with no city known: rotate through them rather than hand out
      // no place at all (every prompt of a salon chain lost its place).
      cycle.push(...nearby);
    }
    if (cycle.length > 0) return { places: cycle, placeEvery: 1 };
    // A place-bound chain with no local places (national scope): fall through to countries.
  }
  const countries = keep(byLevel("country").map((location) => toPlace(location, "primary")));
  if (countries.length === 0) return { places: [], placeEvery: 0 };
  // A place-bound business with only countries (a national chain) still names one every time.
  return { places: countries, placeEvery: geo?.placeBound ? 1 : geo?.scope === "national" ? 1.5 : geo?.scope === "global" ? 5 : 3 };
}

// --- Money -----------------------------------------------------------------------

/**
 * A budget as people say it: one cap. The intent model returned ranges
 * ("AED 800–2,500") and whole sentences ("Often under $500 for smaller
 * repairs; larger work is quoted by project"), which the writer pasted as
 * "Recommend a Prospect Heights plumber for a $150 water heater repair".
 */
export function budgetCap(hint: string | null | undefined): string | null {
  if (!hint) return null;
  const match = hint.match(/\b(under|below|less than|up to)\s+(?:[A-Z]{3}\s?|[$£€₹¥]\s?)?[\d][\d.,]*(?:\s?[kK]\b)?(?:\s?(?:[A-Z]{3}|rupees|dollars|pounds|euros|dirhams))?(?:\s(?:a|per)\s(?:month|year|night|person|head|visit|session|hour|class|user))?/);
  if (!match) return null;
  const cap = match[0].trim();
  // A range hiding behind the cap ("under $150–$1,500") is still a range.
  return /[–-]\s?[$£€₹\d]/.test(hint.slice(hint.indexOf(match[0]) + match[0].length, hint.indexOf(match[0]) + match[0].length + 3)) ? null : cap;
}

// --- Slots -----------------------------------------------------------------------

/** What kind of ask a slot is: just the thing, the thing plus one everyday context, or a situation first. */
export type DiscoveryShape = "bare" | "context" | "situation";
/** The two surface forms each slot is written in. */
export type DiscoveryStyle = "search" | "question" | "request" | "story";

export interface DiscoverySlot {
  slotIndex: number;
  needIndex: number;
  shape: DiscoveryShape;
  styles: [DiscoveryStyle, DiscoveryStyle];
  place: DiscoveryPlace | null;
  /** The only money a slot may mention. */
  budget: string | null;
}

const STYLES_FOR_SHAPE: Record<DiscoveryShape, [DiscoveryStyle, DiscoveryStyle]> = {
  bare: ["search", "question"],
  context: ["question", "request"],
  situation: ["story", "question"],
};

/** Discovery needs at most eight needs; more spreads ten prompts too thin. */
const MAX_DISCOVERY_NEEDS = 8;

/**
 * Side sales nobody chooses a business for. The intent model is told gift
 * cards and merchandise are not needs, yet a restaurant's set came back with
 * three of ten Discovery prompts about buying its gift vouchers.
 */
const SIDE_SALE = /\b(gift (cards?|vouchers?|certificates?|boxes?)|vouchers?|merchandise|merch|branded (clothing|apparel)|t-?shirts?|mugs?|tote bags?)\b/i;

/** The needs Discovery asks about, in the intent model's order, with their index there. */
export function discoveryNeeds(model: PromptIntentModel): Array<{ need: PromptIntentModel["needs"][number]; needIndex: number }> {
  return model.needs
    .map((need, needIndex) => ({ need, needIndex }))
    .filter(({ need }) => !SIDE_SALE.test(need.category))
    .slice(0, MAX_DISCOVERY_NEEDS);
}
const MAX_BUDGET_SLOTS = 2;

/**
 * The slots the writer fills. Every need gets a bare ask and a context ask;
 * every other need also gets a situation-first ask, so most prompts carry no
 * detail or one. Places are handed out across slots, never per need, so one
 * need is asked about in more than one place.
 */
export function planDiscoverySlots(model: PromptIntentModel, locations: Location[], geo: DiscoveryGeography | undefined, primaryCountry: string | null, pricePositioning?: string | null): DiscoverySlot[] {
  const { places, placeEvery } = discoveryPlaces(locations, geo);
  // Nobody shops a luxury salon as "affordable": a blind review flagged exactly that prompt.
  const premium = pricePositioning === "premium" || pricePositioning === "luxury";
  const slots: DiscoverySlot[] = [];
  let placed = 0;
  let budgets = 0;
  discoveryNeeds(model).forEach(({ need, needIndex }, position) => {
    const shapes: DiscoveryShape[] = position % 2 === 0 ? ["bare", "context", "situation"] : ["bare", "context"];
    for (const shape of shapes) {
      const slotIndex = slots.length;
      let place: DiscoveryPlace | null = null;
      if (places.length > 0 && placeEvery > 0) {
        // placeEvery 1.5 → two slots in three; 3 → one in three.
        const due = placeEvery === 1 || Math.floor((slotIndex + 1) / placeEvery) > Math.floor(slotIndex / placeEvery);
        if (due) place = places[placed++ % places.length]!;
      }
      let budget: string | null = null;
      if (shape === "context" && budgets < MAX_BUDGET_SLOTS) {
        if (premium && geo?.placeBound) {
          // The segment word people use for a high-end place ("best luxury
          // salons in dubai"), the mirror of "cheap" for a budget one. It is
          // the market position, not a claim of this business.
          budget = `a segment word such as "luxury" or "high-end" (never a price or a number)`;
        } else if (!premium) {
          const cap = budgetCap(need.budgetHint);
          // Money is in the home currency; a prompt about another country cannot use it.
          const usable = cap && (!place?.countryCode || !primaryCountry || place.countryCode === primaryCountry) ? cap : null;
          // For a place people visit, price is said as a word; a number only for things bought as products.
          budget = usable ? (geo?.placeBound ? `a price word such as "cheap" or "affordable" (not a number)` : usable) : null;
        }
      }
      if (budget) budgets += 1;
      slots.push({ slotIndex, needIndex, shape, styles: STYLES_FOR_SHAPE[shape], place, budget });
    }
  });
  return slots;
}

// --- Writing ---------------------------------------------------------------------

/**
 * Register guidance, from 1,265 English recommendation prompts in LMArena's
 * Search Arena logs (a hand-coded subset of 52 local-business asks) and the
 * prompt sets AI-visibility products track: median 13 words (9 for local
 * places); 42% start lowercase and 57% end without punctuation, 26% with "?";
 * "best" in 37–40%; places trail the ask ("salons in dubai"), never "a Dubai
 * salon"; 35% carry no constraint and 56% one; identity statements 3–10% and
 * written as a situation; money mostly as a word; em dashes 0.1%; "which" opens
 * 4% and "recommend" 1%. Examples are from other industries, so nothing here
 * is tuned to a business being measured.
 */
export const DISCOVERY_STYLE = `HOW PEOPLE ACTUALLY ASK AN ASSISTANT FOR A RECOMMENDATION
- They type fast. Many messages are lowercase, most have no full stop or question mark, and a lot are search-style fragments ("best ramen in sapporo"). Some are careful full sentences. Mix both.
- They ask for a few options more often than for "the one": "best", "good", "top", "what are some", "places for", "who does".
- The place comes after the thing, as "in/at/around <place>": "barbers in soho", never "a Soho barber".
- They call the thing what a customer calls it, not a menu heading, feature or industry term ("a plumber for a leaking water heater", not "water heater repair or replacement services").
- Context is about THEM: what happened, what they are planning, who it is for. Never a feature, process or promise from a business's website ("a colourist who does a proper consultation first" is website copy; "my last colour went brassy" is a person).
- Most asks carry one plain detail or none: "for beginners", "that's good with kids", "open late", "not too expensive", "for a birthday dinner".
- They rarely say who they are. When they do, it is a situation in passing ("for my mum", "we have two kids"), never a label up front ("As a parent,", "I'm a nurse —").
- No em dashes, no semicolons, no advertising words ("premium", "high-quality", "top-notch", "seamless", "experience", "solutions").
- No time words ("today", "this week", "tomorrow", "right now"): the same prompt is asked again months later.
- Money, when it comes up, is usually a word ("cheap", "affordable", "not too pricey"); a number only as one cap ("under $50").
- Different people start differently. "Which…" and "Recommend…" are rare openers; do not cycle through stock openers like "Looking for", "Help me find", "Can you suggest".
- For a business people VISIT (a salon, restaurant, clinic, gym, shop), the thing they ask for is the PLACE or the PERSON that does the service, with the service as the reason: "best salons in dubai for balayage", "who does a good russian manicure in difc", "hair salon in leeds that's good with curly hair". Never the service on its own ("find me highlights in DIFC", "best haircuts in Dubai") — nobody types that.
- For a business or software product bought by companies, the asker is usually a team ("we", "our team", "our devs") naming the CATEGORY of tool they need and a bit of their situation (team size, what they use now, what broke): "what do small teams use for api testing", "we're a 12 person startup, which crm should we start with", "alternatives to spreadsheets for tracking invoices". A country is named only when the slot gives one.

EXAMPLES FROM OTHER INDUSTRIES — copy the register, never the subjects:
- best yoga studios in lisbon for complete beginners
- what are some good vets in Leeds for a dog that panics at the vet
- My cat is 14 and has a sensitive stomach. What dry food do people actually recommend?
- wedding photographer in cape town who does relaxed candid shots
- where can i rent a car at porto airport without a huge deposit
- Is there a family friendly hotel in Kyoto that isn't miles from everything?
- find me a time tracking tool for a 15 person agency, timesheets are a mess
- good bike shops in utrecht for a first road bike
- any decent online spanish courses that aren't just flashcards
- Who should I call in Denver for a furnace that keeps shutting off?
- what do most small saas teams use for error monitoring
- best crm for a 10 person sales team that hates data entry
- is there a good free alternative to quickbooks for a uk ltd company
- We send about 50k marketing emails a month and Mailchimp is getting expensive. What should we look at?`;

const STYLE_GUIDE: Record<DiscoveryStyle, string> = {
  search: "a search-style fragment, 3 to 9 words, usually lowercase, no question needed, usually with best, good, top or cheap (\"best ... in ...\", \"good ... for ...\")",
  question: "one question, 6 to 16 words; often typed lowercase or without the question mark",
  request: "one request or statement of the need, 6 to 16 words (\"find me…\", \"i need…\", \"show me…\", \"any good…\")",
  story: "one or two short sentences, 12 to 30 words: what happened or what they are planning, then the ask",
};

const SHAPE_GUIDE: Record<DiscoveryShape, string> = {
  bare: "just the thing (and the place, if the slot has one), no other detail",
  context: "the thing plus ONE plain detail about the customer or their need: the budget if the slot has one, otherwise a common situation, who it is for, or a common preference",
  situation: "start from a common situation or problem in the customer's own words, then ask for recommendations",
};

interface DiscoveryWriteResponse {
  prompts?: Array<{ slotIndex?: number; style?: string; text?: string }>;
}

const WRITE_SCHEMA = {
  type: "object",
  properties: {
    prompts: {
      type: "array",
      items: {
        type: "object",
        properties: { slotIndex: { type: "number" }, style: { type: "string", enum: ["search", "question", "request", "story"] }, text: { type: "string" } },
        required: ["slotIndex", "style", "text"],
      },
    },
  },
  required: ["prompts"],
};

export interface DiscoveryWriterInput {
  projectId?: string;
  profile: BusinessProfile;
  model: PromptIntentModel;
  slots: DiscoverySlot[];
  /** Every name the prompt must not contain: the brand, its aliases and every rival. */
  forbiddenNames: string[];
  /** The business's own claims, which a Discovery prompt must not repeat. */
  siteClaims: string[];
}

export interface WrittenDiscoveryPrompt {
  slot: DiscoverySlot;
  style: DiscoveryStyle;
  text: string;
  model: string;
}

const CLAIM_STOPWORDS = new Set(["with", "from", "that", "this", "your", "their", "into", "under", "over", "than", "more", "most", "very", "every", "across", "offered", "offers", "service", "services", "treatments", "treatment", "salon", "clinic", "restaurant", "shop", "store", "platform", "software", "tool", "tools", "business", "company", "experience", "setting", "care", "expert", "personalised", "personalized", "professional", "premium", "luxury", "luxurious", "calm", "quality", "high", "end", "level", "roof", "location", "techniques", "technique", "specialist", "specialists", "signature"]);

/** Grounding notes about the site rather than claims the business makes. */
const CLAIM_ABOUT_THE_SITE = /\b(website|web ?site|web ?page|homepage|the site|its title|page title)\b/i;

function claimTokens(text: string): string[] {
  return text
    .toLowerCase()
    .split(/[^a-z0-9]+/)
    .filter((token) => token.length >= 4 && !CLAIM_STOPWORDS.has(token))
    .map((token) => (token.endsWith("s") && !token.endsWith("ss") ? token.slice(0, -1) : token));
}

/**
 * The business's own selling points, which Discovery prompts must not echo:
 * processes, guarantees, credentials, founders, packages, exact prices.
 *
 * A SERVICE the business sells is not a claim, even when its site calls it a
 * specialty. "Russian manicure and pedicure techniques" sat in the claims
 * list of a salon whose confirmed topic was Russian manicure, and the judge
 * failed every Russian-manicure prompt as "asking for the website's own
 * claim". Anything whose content words are covered by a need, an offering or
 * a topic is therefore left out, and so is bare market positioning
 * ("luxury", "premium"), which is a segment word people search with.
 */
export function siteClaimsFor(profile: BusinessProfile, model: PromptIntentModel): string[] {
  const claims = [...(profile.positioning?.differentiators ?? []), ...profile.brandIdentity.map((trait) => trait.value), ...(model.distinctiveClaims ?? [])];
  const sold = new Set(
    [
      ...model.needs.flatMap((need) => [need.category, ...need.synonyms]),
      ...profile.offerings.items.map((item) => item.name),
      ...profile.offerings.values,
      ...(profile.offerings.groups ?? []).flatMap((group) => [group.name, ...group.items]),
      // What kind of business it is is not a claim either: "Burgers and
      // desserts restaurant" made the judge fail every burger prompt.
      profile.classification?.businessType ?? "",
      profile.classification?.localCategory ?? "",
      ...(profile.classification?.path ?? []),
      profile.industry.primary ?? "",
      profile.industry.secondary ?? "",
    ].flatMap(claimTokens),
  );
  return [...new Set(claims.map((claim) => claim.trim()).filter((claim) => claim.length > 3))]
    .filter((claim) => {
      // A sentence about the website itself ("The website highlights burgers
      // and desserts in its title") describes the site, not the business.
      if (CLAIM_ABOUT_THE_SITE.test(claim)) return false;
      const tokens = claimTokens(claim);
      // Nothing left once positioning words are removed: "Luxury and calm salon setting".
      if (tokens.length === 0) return false;
      // Every content word names something the business sells: a service, not a claim.
      const soldTokens = tokens.filter((token) => sold.has(token));
      return soldTokens.length < tokens.length && soldTokens.length / tokens.length < 0.6;
    })
    .slice(0, 12);
}

function whoTheBusinessIs(profile: BusinessProfile): { kindOf: string; answerNames: string; placeNoun: string } {
  const choice = choiceUnitForProfile(profile);
  const kind = profile.classification?.kind as BusinessKind | undefined;
  const noun = kind ? choiceNounForKind(kind).plural : "businesses, brands or products";
  const placeNoun = (profile.classification?.localCategory ?? profile.classification?.businessType ?? noun).toLowerCase().replace(/^(a|an|the)\s+/, "");
  return { kindOf: choice.unit, answerNames: noun, placeNoun };
}

/** Whether customers go to the business (so Discovery asks for the place, not the service). */
function customersVisit(profile: BusinessProfile): boolean {
  const kind = profile.classification?.kind as BusinessKind | undefined;
  if (!kind) return false;
  return PLACE_BOUND_KINDS.has(kind) && profile.classification?.physicalPresence !== "online_only";
}

/** Two versions per slot from the writer; slot structure and places are checked in code. */
export async function writeDiscoveryPrompts(input: DiscoveryWriterInput): Promise<{ written: WrittenDiscoveryPrompt[]; ok: boolean; error?: string }> {
  const { profile, model, slots } = input;
  const who = whoTheBusinessIs(profile);
  const customerType = profile.classification?.customerType;
  const needs = discoveryNeeds(model).map(({ need, needIndex }) => ({
    needIndex,
    thing: need.category,
    alsoCalled: need.synonyms,
    commonSituations: need.situations,
    whoItIsFor: need.audiences,
  }));
  const visit = customersVisit(profile);
  const b2b = customerType === "b2b" || customerType === "b2g";
  const result = await promptStructured<DiscoveryWriteResponse>({
    role: "writer",
    schemaName: "discovery_prompts_v3",
    systemInstruction: `You write the messages real customers type into ChatGPT or Gemini when they want a recommendation.\n\n${DISCOVERY_STYLE}`,
    userContent: [
      "TASK: Write DISCOVERY prompts. The customer has no business in mind yet and wants to be pointed to some.",
      `The businesses that could answer are ${who.kindOf}${b2b ? ", and the customer is buying for a company" : ""}. A good answer to every prompt names specific ${who.answerNames} — so ask for a recommendation, a shortlist, where to go or which to pick. Never ask how to do something, what something is, or what to look for.`,
      visit
        ? `Customers come to this kind of business in person, so every prompt asks for the PLACE or the PERSON (a ${who.placeNoun}, "salons", "who does…", "where can I get…"), with the need as what they want done: "best ${who.placeNoun}s in <place> for <need>", "who does good <need> in <place>", "<place noun> in <place> that's good with <situation>". Never ask for the treatment or dish on its own ("find me <need> in <place>", "best <need> in <place>"): the answer to that is advice, not places.`
        : b2b
          ? "The asker is buying for a team. Write as a team would ('we', 'our team', 'our devs'), name the category of tool or service, and use the situations as what the team is dealing with (size, current tools, what keeps going wrong). No country unless the slot gives one."
          : "",
      "For EACH slot write exactly TWO prompts, one in each of the slot's two styles, and return the slotIndex and style with each. The two must read like two different people.",
      "Slot shapes:",
      ...Object.entries(SHAPE_GUIDE).map(([shape, guide]) => `- ${shape}: ${guide}`),
      "Styles:",
      ...Object.entries(STYLE_GUIDE).map(([style, guide]) => `- ${style}: ${guide}`),
      "Place: when a slot has a place, name it exactly once, after the thing, the way a person would (\"in Leeds\", \"around Shoreditch\"). A country is said the way a buyer would say it: \"in the UK\", \"for a UK company\", \"we're based in Canada\"; never tacked on at the end (\"which tools help in Canada\"). Never add a second place, a country after a city, a street, or \"near me\". A slot without a place names none.",
      "Money and segment: only slots with a budget mention money or a segment word, using exactly what the slot gives (a cap, or a word such as \"cheap\" or \"luxury\"). No other slot mentions a price, and no slot says \"premium\", \"high-quality\" or \"top-notch\".",
      "Use the needs' situations and audiences only as ideas for what a person might mention, in your own words. They are not phrases to copy.",
      "Say the thing the way a customer names it. When a thing reads like a combined label (\"hair colour and highlights\"), ask about just one part of it, or use one of its other names; never paste the whole label.",
      input.siteClaims.length > 0 ? `This business's own website claims — never build a prompt around any of these, and never ask for a business that does them: ${input.siteClaims.map((claim) => `"${claim}"`).join("; ")}.` : "",
      `Never name any brand, company, product line, store or website. Specifically never mention: ${[...new Set(input.forbiddenNames.filter(Boolean))].join(", ")}.`,
      "",
      JSON.stringify({ needs, slots: slots.map((slot) => ({ slotIndex: slot.slotIndex, needIndex: slot.needIndex, shape: slot.shape, styles: slot.styles, place: slot.place?.say ?? null, budget: slot.budget })) }, null, 1),
    ]
      .filter(Boolean)
      .join("\n"),
    schema: WRITE_SCHEMA,
    temperature: 0.9,
    timeoutMs: 150_000,
    projectId: input.projectId,
  });
  if (!result.ok || !result.data?.prompts) return { written: [], ok: false, error: result.error ?? "empty response" };
  return { written: parseWrittenDiscovery(result.data, slots, result.model), ok: true };
}

const AFTER_PLACE_OK = new Set(["for", "to", "that", "which", "who", "where", "with", "without", "under", "and", "or", "near", "around", "area", "is", "are", "do", "does", "can", "should", "would", "if", "when", "please", "on", "at", "in", "from", "by", "any", "anyone", "recommendations", "suggestions", "ideas", "options"]);

const BEFORE_PLACE_PREPOSITION = new Set(["in", "at", "around", "near", "from", "across", "within", "to", "of", "outside", "about", "into", "by", "for"]);

/** The place written before the thing, as in "a Dubai salon" or "show me Sydney restaurants". Exported for tests. */
export function placeUsedAsAdjective(text: string, place: DiscoveryPlace): boolean {
  const escaped = place.say.replace(/^the\s+/i, "").replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const pattern = new RegExp(`(?:^|([A-Za-z']+)\\s+)${escaped}\\s+([a-z][a-z'-]*)`, "gi");
  for (const match of text.matchAll(pattern)) {
    const before = (match[1] ?? "").toLowerCase();
    const after = match[2]!.toLowerCase();
    if (BEFORE_PLACE_PREPOSITION.has(before) || AFTER_PLACE_OK.has(after)) continue;
    return true;
  }
  return false;
}

/** Keeps each slot's two styles once each, with the slot's place said and no other money. Exported for tests. */
export function parseWrittenDiscovery(data: DiscoveryWriteResponse, slots: DiscoverySlot[], model: string): WrittenDiscoveryPrompt[] {
  const written: WrittenDiscoveryPrompt[] = [];
  const seen = new Set<string>();
  for (const prompt of data.prompts ?? []) {
    const slot = typeof prompt.slotIndex === "number" ? slots[prompt.slotIndex] : undefined;
    const text = typeof prompt.text === "string" ? prompt.text.replace(/\s+/g, " ").trim() : "";
    const style = prompt.style as DiscoveryStyle;
    if (!slot || !text || !slot.styles.includes(style) || seen.has(`${slot.slotIndex}:${style}`)) continue;
    // The slot's place is the measurement's location; a prompt without it asks a different question.
    if (slot.place && !mentionsPlace(text, slot.place)) continue;
    // "a Dubai salon", "which DIFC barber": nobody writes the place as an adjective.
    if (slot.place && placeUsedAsAdjective(text, slot.place)) continue;
    // Money the slot did not allow is a pasted detail.
    if (!slot.budget && /[$£€₹¥]\s?\d|\b\d[\d,.]*\s?(k\b|AED|SGD|AUD|CAD|INR|USD|GBP|EUR|dirhams|rupees|dollars|pounds|euros)|\b(AED|SGD|AUD|CAD|INR|USD|GBP|EUR)\s?\d/i.test(text)) continue;
    seen.add(`${slot.slotIndex}:${style}`);
    written.push({ slot, style, text, model });
  }
  return written;
}

// --- Judging ---------------------------------------------------------------------

export interface DiscoveryVerdict {
  /** A good answer names specific businesses, brands, products or tools of this kind. */
  asksForOptions: boolean;
  /** The thing asked for is a category several providers sell and buyers compare, not a feature, capability or marketing phrase. */
  realCategory: boolean;
  /** The business genuinely offers this, and serves the place named. */
  offered: boolean;
  /** Several different businesses could reasonably be the answer. */
  severalCouldAnswer: boolean;
  /** Asks for one of the business's own specific claims (a process, guarantee, credential, package, exact price). */
  echoesClaim: boolean;
  /** Stacked details, pasted feature or label wording, odd place or money phrasing, advertising words, jargon. */
  assembled: boolean;
  /** Would sit unnoticed among the real prompts it is shown. */
  readsReal: boolean;
  /** Names or unmistakably describes one business (a name, nickname, signature item, founder). */
  pointsAtOne: boolean;
  /** The words that give a failing prompt away, or "". */
  giveaway: string;
}

/**
 * Real-style recommendation prompts the judge compares against, from
 * industries no measured business belongs to. A holistic "would a person type
 * this?" rating does not work: the model rated nearly every prompt 5 of 5,
 * including "Which Dubai salon can make my hair smoother without daily heat
 * styling?". Asked whether a prompt would stand out among real ones, it
 * separates the two.
 */
export const REFERENCE_PROMPTS = [
  "best coworking spaces in berlin for a week",
  "where can i get my bike serviced quickly in amsterdam",
  "good vets in austin that are open on weekends",
  "My landlord wants the gas boiler certificate renewed. Who does that in Manchester?",
  "what are some good moving companies in Chicago for a one bedroom",
  "which project management tool do small design studios actually use",
  "cheap car insurance for new drivers in ireland",
  "Taking my parents to Rome in May, what hotels are easy for older people to get around from?",
  "any recommendations for an accountant in Leeds for a small online shop",
  "top rated wedding venues in the lake district",
  "Is there a good driving school in Auckland for nervous learners?",
  "find me a web design agency in Porto for a small bakery site",
  "best electric toothbrush for sensitive gums",
  "who should I call in Denver for a furnace that keeps shutting off",
  // Business buyers, so B2B prompts are judged against their own register.
  "what do most small saas teams use for error monitoring",
  "best crm for a 10 person sales team that hates data entry",
  "is there a good free alternative to quickbooks for a uk ltd company",
  "We send about 50k marketing emails a month and Mailchimp is getting expensive. What should we look at?",
  "payroll software that handles contractors in three countries",
  "our support inbox is chaos, which helpdesk tools should a 20 person team look at",
];

const JUDGE_SYSTEM = `You audit prompts for a study of which businesses AI assistants recommend on their own.

Each prompt is meant to be a message a real customer types into ChatGPT or Gemini before they have any particular business in mind. You receive the business the study is about, what it offers, the places it serves, the specific claims its own website makes, a list of REAL prompts people have typed (other industries), and numbered prompts to audit.

Answer every check for every prompt, strictly and independently:
- asksForOptions: would a good answer name specific businesses, brands, products or tools of this kind? false for how-to, explanations, definitions, or "what should I look for". When customersVisit is true, the prompt must ask for the place or the person (salons, a clinic, "who does…", "where can I get…"); a prompt asking for the treatment or dish alone ("find me highlights in DIFC", "best haircuts in Dubai") is false, because the honest answer is advice about the treatment, not places.
- realCategory: is the thing asked for a real category of product or service that several providers sell and buyers compare (a "best X" list could exist for it: "api testing tools", "hair salons", "russian manicure")? false for a feature, a capability, a technology or a marketing phrase ("ai engineering assistants", "collaboration platforms for the api lifecycle", "smoothing solutions"), an internal or taxonomy term, or a combined label nobody says.
- offered: does this business offer this, in a place it serves? Areas listed under placesServed count. Judge the service, not the wording.
- severalCouldAnswer: could several different businesses reasonably be the answer? false when it is so tailored that only one business fits.
- echoesClaim: true only when it asks for a business that has one of the SPECIFIC websiteClaims — a process, guarantee, credential, founder, discount or package ("movers with a damage-free guarantee", "a gym that does a body scan before every plan"). Asking for a service, product type, occasion or common problem is never echoing, even when the business offers it, even when its website calls it a specialty, and even when its website mentions it (Russian manicure, balayage, private dining, custom orders, bulk orders, renovations, emergency call-outs). A segment word ("luxury", "cheap") is never a claim, and neither is the kind of business or the things it sells (its dishes, treatments, product types), even when a listed claim mentions them: "best burger restaurants in Bengaluru" for a burger restaurant is the ordinary Discovery prompt, not an echo.
- assembled: true only for one of these defects:
  (1) two or more separate details besides the place;
  (2) a quality, outcome or feature worded like a label or an advert instead of how people talk ("movers who handle items carefully", "a gym for clean equipment", "software for streamlined reporting", "a hotel for a restful stay");
  (3) the place written before the thing, or in a form no one writes ("a Lisbon gym", "in United Kingdom");
  (4) a price range or exact figure that reads pasted ("within EUR 80–250");
  (5) advertising words or trade jargon a customer would not use.
  Everyday context is NOT assembled: a situation or problem ("my boiler is leaking"), who it is for ("for my parents", "for a beginner"), an occasion ("for a birthday dinner"), or a plain preference ("cheap", "for long runs", "for a growing team"). A segment word ("luxury", "high-end", "cheap", "budget") is part of the thing asked for, the way "best" is, not a separate detail: "high-end salons in Dubai for balayage before my wedding" carries ONE detail (the wedding) and is not assembled.
- readsReal: false only when it clearly stands out from the REAL prompts — stiff, formal or wordy in a way none of them are. Plain sentences with ordinary capitalisation read real; so do blunt fragments.
- pointsAtOne: does it name or unmistakably describe one business (name, nickname, founder, signature item, exact address)?
- giveaway: when any check fails, the few words that give it away; otherwise "".
Judge the words only; assume nothing about the business beyond what you are given.`;

const JUDGE_SCHEMA = {
  type: "object",
  properties: {
    verdicts: {
      type: "array",
      items: {
        type: "object",
        properties: {
          index: { type: "number" },
          asksForOptions: { type: "boolean" },
          realCategory: { type: "boolean" },
          offered: { type: "boolean" },
          severalCouldAnswer: { type: "boolean" },
          echoesClaim: { type: "boolean" },
          assembled: { type: "boolean" },
          readsReal: { type: "boolean" },
          pointsAtOne: { type: "boolean" },
          giveaway: { type: "string" },
        },
        required: ["index", "asksForOptions", "realCategory", "offered", "severalCouldAnswer", "echoesClaim", "assembled", "readsReal", "pointsAtOne", "giveaway"],
      },
    },
  },
  required: ["verdicts"],
};

/**
 * Judge routes: the approved judge chain without the small free models, then
 * the free Gemini models that proved able to judge. Gemini 3.5 Flash-Lite
 * passed 28 of 30 prompts from the old generator that read as assembled, which
 * is no filter at all. Gemini 3.6 Flash failed only prompts gpt-5.6-luna also
 * failed (pasted prices, "clean finish", website claims), passing 18 of 30 old
 * prompts to luna's 45%, so it judges when OpenAI cannot answer (an empty
 * balance left one Boldin set unjudged). Gemini 3.8 Flash is often
 * rate-limited on the free key and comes last. With none available the
 * heuristic score stands.
 */
export function judgeRoutes(): ModelRoute[] {
  const chain = routesForStage("judge").filter((route) => !/flash-lite|gpt-oss/.test(route.model));
  const fallbacks: ModelRoute[] = [
    { provider: "gemini", model: "gemini-3.6-flash" },
    { provider: "gemini", model: "gemini-3.8-flash" },
  ];
  return [...chain, ...fallbacks.filter((fallback) => !chain.some((route) => route.model === fallback.model))];
}

export interface DiscoveryJudgeInput {
  projectId?: string;
  profile: BusinessProfile;
  model: PromptIntentModel | null;
  siteClaims: string[];
  names: string[];
  /** Places the business serves, as prompts may name them. */
  places: string[];
  texts: string[];
  /** Experiments only: judge with these routes instead. */
  routes?: ModelRoute[];
}

export async function judgeDiscoveryPrompts(input: DiscoveryJudgeInput): Promise<{ verdicts: Map<number, DiscoveryVerdict>; model: string | null }> {
  const verdicts = new Map<number, DiscoveryVerdict>();
  if (input.texts.length === 0) return { verdicts, model: null };
  const who = whoTheBusinessIs(input.profile);
  const payload = {
    business: {
      kind: who.kindOf,
      customersVisit: customersVisit(input.profile),
      buyer: input.profile.classification?.customerType ?? "unknown",
      description: input.profile.description.value,
      offers: [...new Set([...(input.model?.needs ?? []).map((need) => need.category), ...input.profile.offerings.items.slice(0, 12).map((item) => item.name)])],
      placesServed: input.places,
      namesThatIdentifyIt: input.names,
    },
    websiteClaims: input.siteClaims,
    realPrompts: REFERENCE_PROMPTS,
    prompts: input.texts.map((text, index) => ({ index, text })),
  };
  const result = await generateStructured<{ verdicts?: Array<Partial<DiscoveryVerdict> & { index?: number }> }>({
    stage: "judge",
    schemaName: "discovery_prompt_audit",
    schema: JUDGE_SCHEMA,
    systemInstruction: JUDGE_SYSTEM,
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
      asksForOptions: raw.asksForOptions !== false,
      realCategory: raw.realCategory !== false,
      offered: raw.offered !== false,
      severalCouldAnswer: raw.severalCouldAnswer !== false,
      echoesClaim: raw.echoesClaim === true,
      assembled: raw.assembled === true,
      readsReal: raw.readsReal !== false,
      pointsAtOne: raw.pointsAtOne === true,
      giveaway: typeof raw.giveaway === "string" ? raw.giveaway.slice(0, 160) : "",
    });
  }
  return { verdicts, model: `${result.provider}:${result.model}` };
}

/** Score for a prompt that failed a check: below the selection floor (MIN_SELECTABLE_SCORE 55). */
const FAILED_CHECK_SCORE = 30;
const PASSED_SCORE = 92;

/** A verdict as a 0–100 quality score and the first failed check, if any. */
export function discoveryVerdictScore(verdict: DiscoveryVerdict): { total: number; failed: string | null } {
  const failed = verdict.pointsAtOne
    ? "points at one business"
    : !verdict.asksForOptions
      ? "does not ask for options"
      : !verdict.realCategory
        ? "not a category buyers compare providers in"
      : !verdict.offered
        ? "not something the business offers there"
        : !verdict.severalCouldAnswer
          ? "only one business could answer"
          : verdict.echoesClaim
            ? "asks for the website's own claim"
            : verdict.assembled
              ? "reads as assembled"
              : !verdict.readsReal
                ? "stands out from real prompts"
                : null;
  return failed ? { total: FAILED_CHECK_SCORE, failed } : { total: PASSED_SCORE, failed: null };
}
