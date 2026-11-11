// Natural-language realization.
//
// A realizer turns a validated RealUserQueryFrame into a question. Every
// renderer declares the slots it requires; if the frame does not supply them
// with the right concept kinds, the renderer does not fire and the frame
// yields nothing. That is the structural guarantee: a nonsensical sentence is
// unconstructible rather than merely improbable.
//
// The deterministic renderers below are the zero-cost floor. When a provider
// key exists, `realizeWithProvider` rewrites the same frames into more varied
// natural phrasing — but the output still passes every validator, so a model
// slip cannot bypass a gate.

import { promptModelAvailable, promptStructured } from "./model-call";
import { isVerbPhrase } from "./semantic-concepts";
import type { PromptRegister, RealUserQueryFrame } from "./query-frames";

export interface RealizedPrompt {
  frameId: string;
  text: string;
  method: "template" | "model";
}

interface Renderer {
  id: string;
  /** Registers this renderer writes in. A frame only draws from its own. */
  registers: PromptRegister[];
  /** Returns null when the frame does not satisfy this renderer's slots. */
  render(frame: RealUserQueryFrame): string | null;
}

/** Article agrees with the word that FOLLOWS it, which in these frames is the
 * adjective ("a reliable athletic shoe"), not the head noun. Choosing from the
 * noun produced "an reliable athletic shoe". */
function article(nextWord: string): string {
  return /^[aeiou]/i.test(nextWord.trim()) ? "an" : "a";
}

/**
 * "running shoes" -> "running shoe". Returns null for mass nouns, where an
 * indefinite article is ungrammatical: "a reliable sportswear" is wrong, and
 * the renderer that needs a singular simply declines rather than emitting it.
 */
// No leading \b: "sportswear" and "menswear" end in "wear" without a word
// boundary before it, and those are exactly the cases that produced
// "a reliable sportswear".
const MASS_NOUNS =
  /(wear|apparel|clothing|footwear|equipment|gear|software|furniture|jewellery|jewelry|luggage|hardware|machinery|stationery|produce|advice|insurance|banking|catering|training|storage|planning|forecasting|management|inspection|dining|care|cuisine)$/i;

// Fields of practice ending in -ics take a plural form but singular sense:
// "orthopaedics", "analytics", "logistics". Treating them as count nouns
// yields "Which orthopaedics would you recommend?".
const FIELD_NOUNS = /(ics|ology|iatrics|surgery)$/i;

function singular(noun: string): string | null {
  // A singular only exists for a countable plural; "a reliable territory
  // management" is the failure this guard prevents.
  if (!isCountablePlural(noun)) return null;
  // Order matters: "shoes" must lose only the trailing "s". Stripping "es"
  // first turns it into "sho", which is how "a reliable running sho" happened.
  if (/(ches|shes|xes|sses)$/i.test(noun)) return noun.replace(/es$/i, "");
  if (/s$/i.test(noun) && !/ss$/i.test(noun)) return noun.replace(/s$/i, "");
  return noun;
}

/**
 * True when the category takes plural agreement ("Which running shoes are
 * best?"). A service or mass noun does not: "Which oncology would you
 * recommend?" and "Which quota planning are best?" are both ungrammatical,
 * and those frames must route through a provider-headed shape instead —
 * "Which hospitals are best for oncology?".
 */
function isCountablePlural(category: string): boolean {
  if (MASS_NOUNS.test(category) || FIELD_NOUNS.test(category)) return false;
  return /s$/i.test(category) && !/ss$/i.test(category);
}

/**
 * The noun that heads a question about a non-countable category. Derived from
 * the frame's own section context rather than guessed.
 */
function providerNoun(frame: RealUserQueryFrame): string {
  const category = frame.categoryConcept?.canonicalLabel.toLowerCase() ?? "";
  // Order matters and the tests are anchored: "training apparel" is a
  // consumer product, not a training course, so the education rule must not
  // win on the substring "training".
  // "care" and "treatment" were hospital words here, so a salon's "keratin
  // treatment" rendered "What are the best hospitals for keratin treatment?".
  if (/(cardiology|oncology|orthopaed|orthoped|neurology|paediatric|pediatric|surgery|clinic|diagnostics|hospital)/.test(category)) return "hospitals";
  if (/(\bcare\b|treatment|therapy)/.test(category)) return "providers";
  if (/(dining|catering|menu|cuisine|restaurant)/.test(category)) return "restaurants";
  if (/(forecasting|planning|management|inspection|analytics|automation|workflow|software|platform|crm|erp)/.test(category)) return "tools";
  if (/(loan|mortgage|savings|current account|banking|insurance|investment)/.test(category)) return "providers";
  if (/(course|degree|programme|certification|bootcamp)/.test(category)) return "providers";
  if (/(plumbing|cleaning|repair|installation|maintenance|removals|landscaping)/.test(category)) return "companies";
  return "brands";
}

/** Possessive that does not produce "Hospitals's". */
function possessive(name: string): string {
  return /s$/i.test(name) ? `${name}'` : `${name}'s`;
}

/**
 * The noun phrase a Discovery prompt is shopping for.
 *
 * Three shapes, because one does not fit every category:
 *   countable   -> "running shoes"            (shop the product directly)
 *   tool-like   -> "pipeline forecasting tools"  (compound reads naturally)
 *   service     -> "hospitals for oncology"   (you choose a provider, not a service)
 *
 * Returning a single phrase — rather than letting each renderer glue a
 * provider noun onto a category — is what stops the doubled preposition in
 * "Suggest good tools for deal inspection for enterprises".
 */
function categoryHead(frame: RealUserQueryFrame): string | null {
  const category = frame.categoryConcept?.neutralLabel;
  if (!category) return null;
  if (isCountablePlural(category)) return category;
  const provider = providerNoun(frame);
  // "tools" and "brands" compound cleanly in front; "hospitals" does not.
  if (provider === "tools" || provider === "brands") return `${category} ${provider}`;
  return `${provider} for ${category}`;
}

/** True when the head already carries a "for <category>" clause. */
function headCarriesFor(head: string): boolean {
  return / for /.test(head);
}

function inLocation(frame: RealUserQueryFrame): string {
  return frame.locationConcept ? ` in ${frame.locationConcept.canonicalLabel}` : "";
}

// --- Discovery renderers ---------------------------------------------------
//
// Every Discovery renderer requires `categoryConcept.neutralLabel`, which is
// exactly the guard that makes "a reliable running" impossible: an ACTIVITY
// only acquires a neutralLabel ("running shoes") when the business's own
// vocabulary supplied a purchasable head noun.

const DISCOVERY_RENDERERS: Renderer[] = [
  {
    id: "best_brands_for_activity",
    registers: ["question"],
    render(frame) {
      const category = frame.categoryConcept?.neutralLabel;
      const activity = frame.activityConcept?.activityLabel;
      if (!category || !activity) return null;
      const head = isCountablePlural(category) ? `${category} brands` : providerNoun(frame);
      return `What are the best ${head} for ${activity}?`;
    },
  },
  {
    id: "best_category_plain",
    registers: ["question"],
    render(frame) {
      const head = categoryHead(frame);
      if (!head) return null;
      return `What are the best ${head}${inLocation(frame)}?`;
    },
  },
  {
    id: "recommend_for_audience_criterion",
    registers: ["question"],
    render(frame) {
      const audience = frame.audienceConcept?.canonicalLabel;
      const criterion = frame.criterionConcept?.canonicalLabel;
      const head = categoryHead(frame);
      if (!head || !audience || !criterion) return null;
      return headCarriesFor(head)
        ? `Which ${head} would you recommend if ${criterion.toLowerCase()} matters?`
        : `Which ${head} would you recommend for ${audience.toLowerCase()} who care about ${criterion.toLowerCase()}?`;
    },
  },
  {
    id: "recommend_for_audience",
    registers: ["question"],
    render(frame) {
      const head = categoryHead(frame);
      const audience = frame.audienceConcept?.canonicalLabel;
      if (!head || !audience) return null;
      return headCarriesFor(head)
        ? `Which ${head} are best${inLocation(frame)}?`
        : `Which ${head} are best for ${audience.toLowerCase()}${inLocation(frame)}?`;
    },
  },
  {
    id: "activity_with_criterion",
    registers: ["question"],
    render(frame) {
      const category = frame.categoryConcept?.neutralLabel;
      const activity = frame.activityConcept?.activityLabel;
      const criterion = frame.criterionConcept?.canonicalLabel;
      if (!category || !activity || !criterion) return null;
      return `Which ${category} are good for ${activity} if ${criterion.toLowerCase()} matters most?`;
    },
  },
  {
    id: "shortlist_criterion",
    registers: ["question"],
    render(frame) {
      const head = categoryHead(frame);
      const criterion = frame.criterionConcept?.canonicalLabel;
      if (!head || !criterion) return null;
      return `Which ${head} are known for ${criterion.toLowerCase()}${inLocation(frame)}?`;
    },
  },
  {
    id: "where_to_buy",
    registers: ["question"],
    render(frame) {
      const category = frame.categoryConcept?.neutralLabel;
      if (!category || !frame.locationConcept) return null;
      return `Where can I buy ${category} online in ${frame.locationConcept.canonicalLabel}?`;
    },
  },
  {
    id: "solve_job",
    registers: ["question"],
    render(frame) {
      const category = frame.categoryConcept?.neutralLabel;
      const job = frame.jobConcept?.activityLabel;
      // "if I need to ___" is a verb-phrase slot. A frame carrying a noun
      // phrase does not satisfy it, so this renderer declines rather than
      // emitting an ungrammatical sentence — the structural guarantee this
      // module is built on.
      if (!category || !job || !isVerbPhrase(job)) return null;
      return `Which ${category} should I look at if I need to ${job}?`;
    },
  },
  {
    id: "evaluate_criteria",
    registers: ["question"],
    render(frame) {
      const category = frame.categoryConcept?.neutralLabel;
      const activity = frame.activityConcept?.activityLabel;
      if (!category) return null;
      const suffix = activity ? ` for ${activity}` : "";
      return `What should I look for when choosing ${category}${suffix}?`;
    },
  },
  // --- keyword register -----------------------------------------------------
  // Bare shopping phrases, the way the reference products actually track them
  // ("best outsourced AI-native MVP development company for SaaS startups",
  // "Best electric cars under $50k"). Lowercase and no question mark on
  // purpose: this is a typed query, not a sentence.
  {
    id: "kw_best_category_audience",
    registers: ["keyword"],
    render(frame) {
      const head = categoryHead(frame);
      const audience = frame.audienceConcept?.canonicalLabel;
      if (!head || !audience) return null;
      return headCarriesFor(head) ? `best ${head}` : `best ${head} for ${audience.toLowerCase()}`;
    },
  },
  {
    id: "kw_best_category_location",
    registers: ["keyword"],
    render(frame) {
      const category = frame.categoryConcept?.neutralLabel;
      if (!category || !frame.locationConcept) return null;
      return `best ${category} brands in ${frame.locationConcept.canonicalLabel}`;
    },
  },
  {
    id: "kw_best_category_criterion",
    registers: ["keyword"],
    render(frame) {
      const head = categoryHead(frame);
      const criterion = frame.criterionConcept?.canonicalLabel;
      if (!head || !criterion) return null;
      return headCarriesFor(head) ? `best ${head}` : `best ${head} for ${criterion.toLowerCase()}`;
    },
  },
  {
    id: "kw_top_category_activity",
    registers: ["keyword"],
    render(frame) {
      const category = frame.categoryConcept?.neutralLabel;
      const activity = frame.activityConcept?.activityLabel;
      if (!category || !activity) return null;
      return `top ${category} for ${activity}`;
    },
  },

  // --- imperative register ---------------------------------------------------
  // "Recommend the best…", "Find top…", "Suggest…" — the second most common
  // shape in the captured Velova set.
  {
    id: "imp_recommend_category_location",
    registers: ["imperative"],
    render(frame) {
      const head = categoryHead(frame);
      if (!head) return null;
      return `Recommend the best ${head}${inLocation(frame)}`;
    },
  },
  {
    id: "imp_suggest_for_audience",
    registers: ["imperative"],
    render(frame) {
      const head = categoryHead(frame);
      const audience = frame.audienceConcept?.canonicalLabel;
      if (!head || !audience) return null;
      return headCarriesFor(head) ? `Suggest good ${head}` : `Suggest good ${head} for ${audience.toLowerCase()}`;
    },
  },
  {
    id: "imp_shortlist_criterion",
    registers: ["imperative"],
    render(frame) {
      const head = categoryHead(frame);
      const criterion = frame.criterionConcept?.canonicalLabel;
      if (!head || !criterion) return null;
      return `Recommend a shortlist of ${head} with strong ${criterion.toLowerCase()}`;
    },
  },
  {
    id: "imp_find_top_location",
    registers: ["imperative"],
    render(frame) {
      const head = categoryHead(frame);
      if (!head || !frame.locationConcept) return null;
      return `Find top ${head} in ${frame.locationConcept.canonicalLabel}`;
    },
  },

  {
    id: "reliable_single_item",
    registers: ["question"],
    render(frame) {
      const category = frame.categoryConcept?.neutralLabel;
      const audience = frame.audienceConcept?.canonicalLabel;
      if (!category || !audience) return null;
      const item = singular(category);
      if (!item) return null;
      return `Can you suggest ${article("reliable")} reliable ${item} for ${audience.toLowerCase()}?`;
    },
  },
];

// --- Trade Off renderers ---------------------------------------------------
//
// No bare "X vs Y <criterion>" splices: "Atelier 10 Salon vs 011 Italian
// Grooming DIFC reliability" and "HubSpot Blog reliability reviews" were
// selected when the writer left a section short. Templates are the floor for
// keyless runs; in a section a model wrote, the judge scores them too.

const TRADE_OFF_RENDERERS: Renderer[] = [
  {
    id: "vs_activity",
    registers: ["question"],
    render(frame) {
      const { targetBrand, competitorName } = frame;
      const activity = frame.activityConcept?.activityLabel;
      if (!targetBrand || !competitorName || !activity) return null;
      return `${targetBrand} vs ${competitorName}: which is better for ${activity}?`;
    },
  },
  {
    id: "or_criterion",
    registers: ["question"],
    render(frame) {
      const { targetBrand, competitorName } = frame;
      const criterion = frame.criterionConcept?.canonicalLabel;
      if (!targetBrand || !competitorName || !criterion) return null;
      return `${targetBrand} or ${competitorName}: which offers better ${criterion.toLowerCase()}?`;
    },
  },
  {
    id: "vs_category_criterion",
    registers: ["question"],
    render(frame) {
      const { targetBrand, competitorName } = frame;
      const category = frame.categoryConcept?.neutralLabel;
      const criterion = frame.criterionConcept?.canonicalLabel;
      if (!targetBrand || !competitorName || !category || !criterion) return null;
      return `For ${category}, how does ${targetBrand} compare with ${competitorName} on ${criterion.toLowerCase()}?`;
    },
  },
  {
    id: "vs_audience",
    registers: ["question"],
    render(frame) {
      const { targetBrand, competitorName } = frame;
      const audience = frame.audienceConcept?.canonicalLabel;
      const category = frame.categoryConcept?.neutralLabel;
      if (!targetBrand || !competitorName || !audience || !category) return null;
      return `Is ${targetBrand} or ${competitorName} a better choice of ${category} for ${audience.toLowerCase()}?`;
    },
  },
  {
    id: "vs_plain_category",
    registers: ["question"],
    render(frame) {
      const { targetBrand, competitorName } = frame;
      const category = frame.categoryConcept?.neutralLabel;
      if (!targetBrand || !competitorName || !category) return null;
      return `How do ${targetBrand} and ${competitorName} compare for ${category}?`;
    },
  },
  {
    id: "kw_vs_activity",
    registers: ["keyword"],
    render(frame) {
      const { targetBrand, competitorName } = frame;
      const activity = frame.activityConcept?.activityLabel ?? frame.categoryConcept?.neutralLabel;
      if (!targetBrand || !competitorName || !activity) return null;
      return `${targetBrand} vs ${competitorName} for ${activity}`;
    },
  },
  {
    id: "imp_compare_criterion",
    registers: ["imperative"],
    render(frame) {
      const { targetBrand, competitorName } = frame;
      const criterion = frame.criterionConcept?.canonicalLabel;
      const category = frame.categoryConcept?.neutralLabel;
      if (!targetBrand || !competitorName || !criterion || !category) return null;
      return `Compare ${targetBrand} and ${competitorName} on ${criterion.toLowerCase()} for ${category}`;
    },
  },
  {
    id: "switch_from",
    registers: ["question"],
    render(frame) {
      const { targetBrand, competitorName } = frame;
      const criterion = frame.criterionConcept?.canonicalLabel;
      if (!targetBrand || !competitorName || !criterion) return null;
      return `If ${criterion.toLowerCase()} is my priority, should I go with ${targetBrand} or ${competitorName}?`;
    },
  },
  {
    id: "which_better_activity_criterion",
    registers: ["question"],
    render(frame) {
      const { targetBrand, competitorName } = frame;
      const activity = frame.activityConcept?.activityLabel;
      const criterion = frame.criterionConcept?.canonicalLabel;
      if (!targetBrand || !competitorName || !activity || !criterion) return null;
      return `For ${activity}, does ${targetBrand} or ${competitorName} do better on ${criterion.toLowerCase()}?`;
    },
  },
  {
    id: "worth_paying_more",
    registers: ["question"],
    render(frame) {
      const { targetBrand, competitorName } = frame;
      const category = frame.categoryConcept?.neutralLabel;
      if (!targetBrand || !competitorName || !category) return null;
      return `Is ${targetBrand} worth choosing over ${competitorName} for ${category}?`;
    },
  },
];

// --- Sentiment renderers ---------------------------------------------------

const SENTIMENT_RENDERERS: Renderer[] = [
  {
    id: "considered_reliable",
    registers: ["question"],
    render(frame) {
      const { targetBrand, sentimentTheme } = frame;
      const category = frame.categoryConcept?.neutralLabel;
      if (!targetBrand || !sentimentTheme) return null;
      if (!category) return null;
      return `Is ${targetBrand} considered reliable for ${category}?`;
    },
  },
  {
    id: "reputation_for_theme",
    registers: ["question"],
    render(frame) {
      const { targetBrand, sentimentTheme } = frame;
      if (!targetBrand || !sentimentTheme) return null;
      return `What is ${possessive(targetBrand)} reputation for ${sentimentTheme.toLowerCase()}?`;
    },
  },
  {
    id: "customers_happy",
    registers: ["question"],
    render(frame) {
      const { targetBrand, sentimentTheme } = frame;
      if (!targetBrand || !sentimentTheme) return null;
      return `Are customers generally happy with ${possessive(targetBrand)} ${sentimentTheme.toLowerCase()}${inLocation(frame)}?`;
    },
  },
  {
    id: "good_value",
    registers: ["question"],
    render(frame) {
      const { targetBrand } = frame;
      const category = frame.categoryConcept?.neutralLabel;
      if (!targetBrand || !category) return null;
      return `Does ${targetBrand} generally offer good value for ${category}?`;
    },
  },
  {
    id: "common_complaints",
    registers: ["question"],
    render(frame) {
      const { targetBrand, sentimentTheme } = frame;
      if (!targetBrand || !sentimentTheme) return null;
      return `What do people commonly say about ${possessive(targetBrand)} ${sentimentTheme.toLowerCase()}?`;
    },
  },
  {
    id: "worth_buying_from",
    registers: ["question"],
    render(frame) {
      const { targetBrand } = frame;
      const category = frame.categoryConcept?.neutralLabel;
      if (!targetBrand || !category) return null;
      return `Is ${targetBrand} a good brand to buy ${category} from${inLocation(frame)}?`;
    },
  },
  {
    id: "kw_worth_it",
    registers: ["keyword"],
    render(frame) {
      const { targetBrand } = frame;
      const category = frame.categoryConcept?.neutralLabel;
      if (!targetBrand || !category) return null;
      // "Is Nike running shoes worth it?" — the copula has to agree with the
      // category noun, which is plural for most shoppable products and
      // singular for mass nouns ("Is Nike sportswear worth it?").
      return `${isCountablePlural(category) ? "Are" : "Is"} ${targetBrand} ${category} worth it?`;
    },
  },
  {
    id: "any_complaints",
    registers: ["question"],
    render(frame) {
      const { targetBrand, sentimentTheme } = frame;
      if (!targetBrand || !sentimentTheme) return null;
      return `Do people have complaints about ${possessive(targetBrand)} ${sentimentTheme.toLowerCase()}?`;
    },
  },
  {
    id: "quality_regarded",
    registers: ["question"],
    render(frame) {
      const { targetBrand, sentimentTheme } = frame;
      const audience = frame.audienceConcept?.canonicalLabel;
      if (!targetBrand || !sentimentTheme || !audience) return null;
      return `How is ${targetBrand} regarded by ${audience.toLowerCase()} for ${sentimentTheme.toLowerCase()}?`;
    },
  },
];

function renderersFor(section: RealUserQueryFrame["section"]): Renderer[] {
  if (section === "Discovery") return DISCOVERY_RENDERERS;
  if (section === "Trade Offs") return TRADE_OFF_RENDERERS;
  return SENTIMENT_RENDERERS;
}

/**
 * Deterministic realization. Returns every question this frame can legally
 * produce — often zero, which is the correct answer for an under-specified
 * frame and the reason the pool is planned with oversupply.
 */
export function realizeFrameDeterministic(frame: RealUserQueryFrame, limit = 3): RealizedPrompt[] {
  const out: RealizedPrompt[] = [];
  const seen = new Set<string>();
  // Rotate the renderer order by frame id so two similar frames do not both
  // pick renderer #1 and collapse into the same sentence.
  const all = renderersFor(frame.section);
  // A frame written in the keyword register must not be realized by a
  // question renderer, or the register planning has no effect.
  const renderers = all.filter((renderer) => renderer.registers.includes(frame.register));
  if (renderers.length === 0) return out;
  const offset = Math.abs(hashString(frame.id)) % renderers.length;
  for (let i = 0; i < renderers.length && out.length < limit; i++) {
    const renderer = renderers[(offset + i) % renderers.length]!;
    const text = renderer.render(frame);
    if (!text) continue;
    const key = text.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    out.push({ frameId: frame.id, text, method: "template" });
  }
  return out;
}

function hashString(value: string): number {
  let hash = 0;
  for (let i = 0; i < value.length; i++) hash = (hash * 31 + value.charCodeAt(i)) | 0;
  return hash;
}

// --- Provider-backed realization -------------------------------------------

const REALIZER_SYSTEM = `You write the questions ordinary prospective customers actually type into AI assistants like ChatGPT, Gemini and Perplexity.

You are given semantic FRAMES. Each frame states what the question must be about — the category being shopped for, optionally an activity, audience, decision criterion, location, brand or competitor. Your job is only to phrase it.

RULES:
- Write how a real person types. Short and direct is normal and good.
- Never concatenate metadata labels into a sentence. "Which running options are available for Jordan?" is a failure. "Which running shoes are good for beginners?" is correct.
- Use the supplied category noun phrase as the grammatical head. Do not invent a different category.
- Do not name any company in a DISCOVERY frame — not the target, not a competitor, not a product line. Discovery measures whether the assistant volunteers brands on its own.
- In TRADE_OFFS use exactly the supplied brand and competitor, no others.
- In SENTIMENT use the supplied brand and theme, and phrase it the way a customer checking reviews would.
- Vary sentence openings across the batch. Do not start every question the same way.
- Do not stuff every available detail into one question. Mix short questions with more specific ones.
- No marketing language, no leading phrasing ("why is X the best"), no analyst phrasing ("what balanced picture emerges").
- One question per frame. Return the frame id with it.`;

interface RealizerResponse {
  questions: Array<{ frameId: string; text: string }>;
}

const REALIZER_SCHEMA = {
  type: "object",
  properties: {
    questions: {
      type: "array",
      items: {
        type: "object",
        properties: { frameId: { type: "string" }, text: { type: "string" } },
        required: ["frameId", "text"],
      },
    },
  },
  required: ["questions"],
};

function describeFrame(frame: RealUserQueryFrame): Record<string, unknown> {
  return {
    frameId: frame.id,
    section: frame.section.toUpperCase().replace(/\s+/g, "_"),
    intent: frame.buyerIntent,
    depth: frame.depth,
    category: frame.categoryConcept?.neutralLabel ?? null,
    activity: frame.activityConcept?.activityLabel ?? null,
    audience: frame.audienceConcept?.canonicalLabel ?? null,
    criterion: frame.criterionConcept?.canonicalLabel ?? null,
    location: frame.locationConcept?.canonicalLabel ?? null,
    brand: frame.targetBrand,
    competitor: frame.competitorName,
    sentimentTheme: frame.sentimentTheme,
    goal: frame.conversationalGoal,
  };
}

/**
 * Realizes a small coherent batch of frames through the provider. Batches are
 * grouped by section so the model holds one set of rules at a time; a failed
 * batch simply yields nothing and the deterministic floor still applies.
 */
export async function realizeWithProvider(frames: RealUserQueryFrame[]): Promise<RealizedPrompt[]> {
  if (!promptModelAvailable() || frames.length === 0) return [];

  // Rewording fixed frames needs no premium writer.
  const result = await promptStructured<RealizerResponse>({
    role: "planner",
    schemaName: "realized_frames",
    systemInstruction: REALIZER_SYSTEM,
    userContent: JSON.stringify({ frames: frames.map(describeFrame) }, null, 1),
    schema: REALIZER_SCHEMA,
    temperature: 0.6,
    timeoutMs: 60_000,
  });
  if (!result.ok || !result.data?.questions) return [];

  const byId = new Map(frames.map((f) => [f.id, f]));
  const out: RealizedPrompt[] = [];
  for (const question of result.data.questions) {
    const frame = byId.get(question.frameId);
    if (!frame) continue;
    const text = question.text?.trim();
    if (!text || text.length < 12 || text.length > 220) continue;
    out.push({ frameId: frame.id, text, method: "model" });
  }
  return out;
}

export const REALIZER_BATCH_SIZE = 8;

/** Splits frames into provider-sized batches grouped by section. */
export function batchFrames(frames: RealUserQueryFrame[], size = REALIZER_BATCH_SIZE): RealUserQueryFrame[][] {
  const bySection = new Map<string, RealUserQueryFrame[]>();
  for (const frame of frames) {
    const list = bySection.get(frame.section) ?? [];
    list.push(frame);
    bySection.set(frame.section, list);
  }
  const batches: RealUserQueryFrame[][] = [];
  for (const list of bySection.values()) {
    for (let i = 0; i < list.length; i += size) batches.push(list.slice(i, i + size));
  }
  return batches;
}
