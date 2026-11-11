// Natural-query validation.
//
// A gate that runs on the realized *text*, independent of the metadata that
// produced it. The previous pipeline had no such gate, which is why
// "Can you suggest a reliable running for a buyer?" reached the user: every
// metadata field was populated, so every metadata-shaped check passed.

export type NaturalRejectionCode =
  | "SEMANTIC_ROLE_CONFLICT"
  | "UNNATURAL_LANGUAGE"
  | "NO_CLEAR_USER_INTENT"
  | "OVERSTUFFED"
  | "TOO_GENERIC_FOR_DISCOVERY"
  | "UNSUPPORTED_CONTEXT"
  | "MALFORMED_PROMPT"
  | "ANALYST_VOICE"
  | "INTERNAL_VOCABULARY";

export interface NaturalValidationResult {
  ok: boolean;
  code?: NaturalRejectionCode;
  detail?: string;
}

/**
 * Phrases that only appear when a template concatenated metadata. Each of
 * these was observed in the failing implementation's real output.
 */
const METADATA_ARTEFACTS: Array<{ pattern: RegExp; detail: string }> = [
  { pattern: /\bfor a buyer\b/i, detail: '"a buyer" is an internal label, not how customers describe themselves' },
  { pattern: /\ba buyer (should|would|might|can)\b/i, detail: "analyst framing rather than a customer question" },
  { pattern: /\bfind the right option for\b/i, detail: "internal job-placeholder text" },
  { pattern: /\bproducts or services\b/i, detail: "generic category placeholder" },
  { pattern: /\b(providers?|options?) worth considering for find\b/i, detail: "malformed job splice" },
  { pattern: /\bapproach find\b/i, detail: "malformed job splice" },
  { pattern: /\bways to handle\b/i, detail: "internal phrasing" },
  { pattern: /\brelated to\s+(problem awareness|category fit|pricing & plans)\b/i, detail: "topic-label splice" },
  { pattern: /\bballanced|balanced picture emerges\b/i, detail: "analyst voice" },
  { pattern: /\bindependent discussions characterize\b/i, detail: "analyst voice" },
  { pattern: /\bpublicly available sources indicate\b/i, detail: "analyst voice" },
  { pattern: /\bhow consistently do public sources\b/i, detail: "analyst voice" },
  { pattern: /\b(keyword|seo|serp|prompt engineering)\b/i, detail: "search-marketing vocabulary" },
  { pattern: /\bcoverage cell|journey stage|brand policy\b/i, detail: "internal taxonomy leaked into text" },
];

const GERUNDS = "running|training|walking|hiking|cycling|swimming|climbing|lifting|jogging|sprinting|shopping|banking|dining|gaming|streaming";

/**
 * A determiner followed by a gerund that is *not* modifying a following noun.
 *
 * Enumerating the nouns that may follow ("shoes", "gear", …) is the wrong
 * shape — the list is unbounded and a miss rejects a perfectly good question
 * ("the best hiking boots"). What actually marks the defect is the gerund
 * sitting in the head-noun position with nothing after it: the phrase ends,
 * or runs straight into a preposition or punctuation.
 */
const BARE_GERUND_AS_NOUN = new RegExp(
  `\\b(a|an|the|reliable|good|best|suitable|affordable|quality)\\s+(${GERUNDS})\\s*(\\?|,|$|\\b(for|in|with|to|from|at|on|near|under|about)\\b)`,
  "i",
);

/**
 * "what kinds of running", "what types of training" — a gerund used as the
 * head noun of a category question, with no product noun after it.
 */
const KINDS_OF_GERUND = new RegExp(
  `\\b(kinds?|types?|sorts?|forms?) of\\s+(${GERUNDS})\\s*(\\?|,|$|\\b(for|in|with|to|are|is)\\b)`,
  "i",
);

/** "running options", "training options" — a category placeholder never filled. */
const ACTIVITY_PLUS_OPTIONS =
  /\b(running|training|walking|hiking|cycling|swimming|football|basketball|cricket|tennis|golf)\s+(options?|providers?|solutions?)\b/i;

const ANALYST_VOICE =
  /\b(what balanced picture|how do independent|what signals emerge|characterize|discourse|sentiment landscape|market perception analysis)\b/i;

const TOO_GENERIC_DISCOVERY =
  /^(what is|what are|how does|how do)\b.*\b(work|mean|defined)\b/i;

export interface NaturalValidationInput {
  text: string;
  section: "Discovery" | "Trade Offs" | "Sentiment Analysis";
  /**
   * Defaults to "question" so existing callers keep the strict rules. A
   * keyword or imperative prompt is not malformed for lacking a question mark
   * — "best running shoes for beginners" and "Recommend the best running shoe
   * brands in India" are exactly how the reference products track queries.
   */
  register?: "keyword" | "imperative" | "question";
}

/**
 * Openings that make a non-question a real request.
 *
 * The earlier list held six verbs. People talking to an assistant also write
 * "Need durable running shoes with good cushioning for long distance",
 * "Looking for high-performance football gear for my weekend matches" and
 * "Help me find…" — the exact phrasing of the prompt sets competitors track
 * for the same sites — and every one of those was rejected as having "no
 * clear user intent". A request is a request whether it opens with a verb or
 * with the need.
 */
const IMPERATIVE_OPENINGS =
  /^(recommend|suggest|find|compare|list|show|give me|help me|tell me|point me|can you|could you|please|any (suggestions|recommendations|ideas)|need|i need|i'm looking|i am looking|looking for|searching for|shopping for|i want|want|trying to find|in the market for|i've just|i have just|i'm starting|i am starting|i'm training|i am training|planning)\b/i;

/** A keyword prompt still has to read as shopping intent, not a bare noun. */
export const KEYWORD_INTENT =
  /\b(best|top|cheapest|cheap|affordable|good|leading|recommended|reliable|worth it|vs\.?|versus|alternatives?|reviews?|near me|on sale|deals?|under\s*[₹$€£¥]?\s*\d)\b/i;

/**
 * Openings that make a sentence a question whether or not it ends in "?".
 *
 * Most real recommendation prompts carry no closing punctuation: in 1,265
 * English recommendation prompts from LMArena's Search Arena logs, 57% ended
 * without any and only 26% with "?" ("what are the best nail salons in dubai").
 * Reading a missing "?" as a keyword phrase rejected those as carrying "no
 * shopping intent".
 */
export const QUESTION_OPENINGS = /^(what|what's|whats|which|who|where|how|is there|are there|is|are|can|could|should|would|will|does|do|any)\b/i;

/**
 * Recovers the register from stored text. Persisted rows predate the register
 * field, and an edited prompt may have changed shape, so validation on read
 * infers it rather than trusting a stale value.
 */
export function inferRegister(text: string): "keyword" | "imperative" | "question" {
  const trimmed = text.trim();
  if (IMPERATIVE_OPENINGS.test(trimmed)) return "imperative";
  if (trimmed.endsWith("?")) return "question";
  // "My dog panics at the vet. Is there a clinic in Leeds that's good with nervous pets"
  const lastSentence = trimmed.split(/(?<=[.!?])\s+/).at(-1) ?? trimmed;
  if (QUESTION_OPENINGS.test(lastSentence)) return "question";
  return "keyword";
}

/**
 * Questions that ask the assistant to name things without a shopping keyword.
 * "What court sneakers grip well on dusty floors?" and "Where can we get tacos
 * for a party?" elicit a shortlist exactly as "best" does, but the keyword list
 * alone rejected them — seven of Nike's provider-written Discovery prompts in
 * one run. Explanatory openings ("what is", "what happens") stay excluded.
 */
const ASKS_TO_IDENTIFY =
  /^what'?s?\s+(?!is\b|are\b|was\b|were\b|does\b|do\b|did\b|makes?\b|causes?\b|happens?\b|if\b|about\b|the difference\b)([\w'-]+\s+){1,4}(are|is|have|has|provide|provides|offer|offers|feature|features|come|comes|work|works|fit|fits|hold|holds|last|lasts|keep|keeps|give|gives|stay|stays|suit|suits|would|should|can|could|will|won'?t|don'?t|doesn'?t)\b|\bwhere\s+(can|could|should|would|do|to)\b|\bany (ideas|recommendations|picks)\b|\bplaces? to\b/i;

export function validateNaturalQuery({ text, section }: NaturalValidationInput): NaturalValidationResult {
  const trimmed = text.trim();
  // The register is read from the text, never trusted from the plan. The
  // planner used to fix a register before any wording existed and reject any
  // realization that did not match it, so a language model's natural question
  // for a "keyword" slot was thrown away — 39 of 59 model-written candidates in
  // one Nike run died this way, while the stiff template for the same slot
  // survived.
  const register = inferRegister(trimmed);

  if (trimmed.length < 12) return { ok: false, code: "MALFORMED_PROMPT", detail: "too short to be a real query" };
  if (trimmed.length > 220) return { ok: false, code: "OVERSTUFFED", detail: "longer than a person would type" };

  const questionMarks = (trimmed.match(/\?/g) ?? []).length;
  if (questionMarks > 1) return { ok: false, code: "MALFORMED_PROMPT", detail: "multiple questions in one prompt" };

  if (register === "question") {
    // A question may end without "?" (see QUESTION_OPENINGS); one in the middle is two thoughts spliced.
    if (questionMarks > 0 && !trimmed.endsWith("?")) return { ok: false, code: "MALFORMED_PROMPT", detail: "question mark is not final" };
  } else if (register === "imperative") {
    if (!IMPERATIVE_OPENINGS.test(trimmed)) {
      return { ok: false, code: "NO_CLEAR_USER_INTENT", detail: "imperative prompt does not open with a request verb" };
    }
  } else if (register === "keyword") {
    // "Best trainers for daily jogging?" is how people type. A trailing
    // question mark on a short phrase is punctuation, not a register error.
    if (!KEYWORD_INTENT.test(trimmed)) {
      return { ok: false, code: "TOO_GENERIC_FOR_DISCOVERY", detail: "keyword prompt carries no shopping intent" };
    }
  }

  const words = trimmed.split(/\s+/).filter(Boolean);
  if (words.length < 4) return { ok: false, code: "MALFORMED_PROMPT", detail: "too few words" };
  if (words.length > 34) return { ok: false, code: "OVERSTUFFED", detail: `${words.length} words is not a typed query` };

  if (BARE_GERUND_AS_NOUN.test(trimmed)) {
    return { ok: false, code: "SEMANTIC_ROLE_CONFLICT", detail: "an activity is being used as a purchasable noun" };
  }
  if (ACTIVITY_PLUS_OPTIONS.test(trimmed)) {
    return { ok: false, code: "SEMANTIC_ROLE_CONFLICT", detail: "activity paired with an unfilled category placeholder" };
  }
  if (KINDS_OF_GERUND.test(trimmed)) {
    return { ok: false, code: "SEMANTIC_ROLE_CONFLICT", detail: "an activity is standing in for a product category" };
  }

  for (const artefact of METADATA_ARTEFACTS) {
    if (artefact.pattern.test(trimmed)) {
      const code: NaturalRejectionCode = /analyst voice/.test(artefact.detail) ? "ANALYST_VOICE" : "INTERNAL_VOCABULARY";
      return { ok: false, code, detail: artefact.detail };
    }
  }
  if (ANALYST_VOICE.test(trimmed)) return { ok: false, code: "ANALYST_VOICE", detail: "reads like a research brief, not a customer" };

  // An empty slot always leaves a tell: doubled spaces, a dangling
  // preposition, or a stranded connector.
  if (/\s{2,}/.test(trimmed)) return { ok: false, code: "MALFORMED_PROMPT", detail: "doubled whitespace from an empty slot" };
  if (/\b(for|with|in|about|between|on)\s*\??$/i.test(trimmed)) {
    return { ok: false, code: "MALFORMED_PROMPT", detail: "dangling preposition from an empty slot" };
  }
  if (/\b(and|or|for|with)\s+(and|or|for|with)\b/i.test(trimmed)) {
    return { ok: false, code: "MALFORMED_PROMPT", detail: "stranded connector from an empty slot" };
  }
  if (/\bundefined\b|\bnull\b|\{\w+\}/i.test(trimmed)) {
    return { ok: false, code: "MALFORMED_PROMPT", detail: "unresolved placeholder" };
  }

  // A word repeated three times running is a splice artefact
  // ("running for running in running").
  const lowerWords = words.map((w) => w.toLowerCase().replace(/[^a-z]/g, "")).filter((w) => w.length > 3);
  const counts = new Map<string, number>();
  for (const word of lowerWords) counts.set(word, (counts.get(word) ?? 0) + 1);
  for (const [word, count] of counts) {
    if (count >= 3) return { ok: false, code: "MALFORMED_PROMPT", detail: `"${word}" repeats ${count} times` };
  }
  // The topic-splice signature is a word used in TWO DIFFERENT ROLES: once as
  // ordinary lowercase text and once capitalized as a pasted label
  // ("…best suited to Running"). Requiring that mixed casing matters — two
  // companies legitimately share a suffix ("Cedarview Hospitals vs Apollo
  // Hospitals", "HDFC Bank vs ICICI Bank"), and treating that as a splice
  // silently deleted an entire confirmed competitor from the Trade Off set.
  //
  // A capital that sits inside a MULTI-WORD proper name is part of that name,
  // not a pasted label. Brands routinely end in their own category word —
  // Blue Bottle Coffee, Intelligentsia Coffee, Apollo Hospitals, HDFC Bank,
  // Delta Air Lines — and without this the rule deleted every Trade Off
  // prompt that named such a brand alongside its category, which is most of
  // them: "Blue Bottle Coffee vs Starbucks for single origin coffee beans"
  // was thrown away for using the word "coffee" twice.
  const bareWords = words.map((word) => word.replace(/[^A-Za-z]/g, ""));
  const isCap = bareWords.map((bare) => bare.length > 0 && bare[0] === bare[0]!.toUpperCase());
  const capitalizedMidSentence = new Set<string>();
  const lowercaseAnywhere = new Set<string>();
  bareWords.forEach((bare, index) => {
    if (bare.length < 4) return;
    if (!isCap[index]) {
      lowercaseAnywhere.add(bare.toLowerCase());
      return;
    }
    if (index === 0) return;
    const partOfProperName = (isCap[index - 1] ?? false) || (isCap[index + 1] ?? false);
    if (!partOfProperName) capitalizedMidSentence.add(bare.toLowerCase());
  });
  for (const word of capitalizedMidSentence) {
    if (lowercaseAnywhere.has(word)) {
      return { ok: false, code: "SEMANTIC_ROLE_CONFLICT", detail: `"${word}" appears both as text and as a pasted label` };
    }
  }

  // Delivery terms describe how a thing is bought, never what it is for.
  // "best athletic shoes for free shipping" was being generated and selected.
  if (section === "Discovery" && /\bfor (free|fast|quick|express|same[- ]day|next[- ]day) (shipping|delivery)\b/i.test(trimmed)) {
    return { ok: false, code: "SEMANTIC_ROLE_CONFLICT", detail: "delivery terms are used as what the product is for" };
  }

  if (section === "Discovery" && register !== "keyword") {
    if (TOO_GENERIC_DISCOVERY.test(trimmed)) {
      return { ok: false, code: "TOO_GENERIC_FOR_DISCOVERY", detail: "explanatory question unlikely to elicit brands" };
    }
    // Discovery exists to see whether the assistant names providers on its
    // own. A question with no shopping verb rarely will.
    // The Discovery test is specifically: would the assistant's answer contain
    // a shortlist of brands? "What should I look for when choosing running
    // gear?" returns buying criteria, not providers, so it fails — even though
    // it is a perfectly natural sentence.
    if (/\b(what should i look for|what to look for|how do i choose|things to consider|what matters when)\b/i.test(trimmed)) {
      return { ok: false, code: "TOO_GENERIC_FOR_DISCOVERY", detail: "asks for criteria, so the answer would not name providers" };
    }
    if (
      !/\b(best|recommend|recommended|recommendations?|suggest|suggestions?|good|decent|great|suitable|worth|which|who|top|reliable|buy|get|shop|options?|brands?|providers?|companies|suppliers?|firms?|makers?|shortlist|need|looking for|searching for|help me find|show me|find me|where can i|is there|are there|places?|spots?|hire|(find|show|point|give|send) (me|us)|should (i|we) (use|try|consider|look at|go with|pick|choose|call|book|see|go to)|where in \S+(\s\S+)? (can|should|do|to))\b/i.test(
        trimmed,
      ) &&
      !ASKS_TO_IDENTIFY.test(trimmed)
    ) {
      return { ok: false, code: "TOO_GENERIC_FOR_DISCOVERY", detail: "not framed to elicit brand or provider names" };
    }
  }

  return { ok: true };
}

/** Counts how many context dimensions the sentence actually carries. */
export function contextDensity(text: string): number {
  let density = 0;
  if (/\bfor\b/i.test(text)) density += 1;
  if (/\bin\b\s+[A-Z]/.test(text)) density += 1;
  if (/\bif\b|\bwhen\b|\bwho (care|need|want)\b/i.test(text)) density += 1;
  if (/\bwith\b/i.test(text)) density += 1;
  return density;
}
