// Discourse analysis: sentences, clauses, negation scope, list structure.
//
// This is the layer that stops the parser from reading a string match as a
// finding. The previous implementation decided a mention was a recommendation
// if the word "recommend" appeared within 120 characters of it, which scores
// "I wouldn't recommend Nike here" as a recommendation for Nike — the exact
// inversion of what the sentence says.
//
// The approach follows NegEx, the standard rule-based negation algorithm from
// clinical NLP: find negation cues, then propagate their scope forward until a
// TERMINATION term — characteristically a contrastive conjunction like "but" —
// closes it. That single rule is what makes
//
//     "I wouldn't pick Nike, but Adidas is excellent"
//
// resolve correctly: Nike is inside the negation scope, Adidas is outside it.

import type { Span } from "./types";

export interface Clause {
  span: Span;
  /** Index of the sentence this clause belongs to. */
  sentenceIndex: number;
  /** True when a negation cue governs this clause. */
  negated: boolean;
  /** The cue that negated it, for explainability. */
  negationCue: string | null;
  /** True when the clause sits after a contrastive marker in its sentence. */
  contrastive: boolean;
  /** True when the clause is hedged ("may", "some people", "arguably"). */
  hedged: boolean;
}

export interface Sentence {
  span: Span;
  index: number;
  clauses: Clause[];
}

// NegEx cue set, adapted from clinical negation to buying language. These are
// the forms that actually appear in assistant answers about brands.
const NEGATION_CUES = [
  "would not", "wouldn't", "would n't",
  "do not", "don't",
  "does not", "doesn't",
  "did not", "didn't",
  "cannot", "can't", "can not",
  "should not", "shouldn't",
  "not recommend", "not suggest", "not choose", "not pick", "not the best",
  "avoid", "steer clear of", "skip",
  "no longer", "rather not",
  "less suitable", "not ideal", "not a good fit", "not suited",
  "isn't", "is not", "aren't", "are not",
  // Contracted copulas. Without these, only half of a double negation was
  // seen and the parity check inverted the wrong way.
  "'s not", "’s not", "'re not", "’re not", "wasn't", "weren't", "won't", "never",
];

// NegEx termination terms. A negation's scope ends here rather than running to
// the end of the sentence, which is what keeps "but Adidas is great" positive.
const TERMINATION_TERMS = [
  "but", "however", "although", "though", "whereas", "while",
  "except", "aside from", "other than", "that said", "on the other hand",
  "instead", "rather", "yet",
];

// Markers that introduce the clause carrying the writer's actual preference.
const CONTRAST_MARKERS = ["but", "however", "though", "although", "that said", "on the other hand", "yet", "whereas", "still"];

const HEDGE_TERMS = [
  "may", "might", "could", "possibly", "perhaps", "arguably", "some people",
  "some runners", "some users", "generally", "often", "tends to", "can be",
  "depending", "it depends", "your mileage", "subjective",
];

function escapeRegex(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

const CUE_PATTERN = new RegExp(`\\b(${NEGATION_CUES.map(escapeRegex).join("|")})\\b`, "gi");
const TERMINATION_PATTERN = new RegExp(`\\b(${TERMINATION_TERMS.map(escapeRegex).join("|")})\\b`, "gi");
const CONTRAST_PATTERN = new RegExp(`\\b(${CONTRAST_MARKERS.map(escapeRegex).join("|")})\\b`, "i");
const HEDGE_PATTERN = new RegExp(`\\b(${HEDGE_TERMS.map(escapeRegex).join("|")})\\b`, "i");

/**
 * Sentence segmentation that preserves absolute offsets into the raw text.
 *
 * Offsets are the whole point — an analysis whose spans cannot be resolved
 * back to the original characters is not auditable. Abbreviations are handled
 * conservatively: it is far better to under-split (one long sentence) than to
 * split mid-clause and lose the relationship between a cue and its target.
 */
const ABBREVIATIONS = /\b(?:Inc|Ltd|Co|Corp|St|Mr|Mrs|Dr|vs|e\.g|i\.e|etc|Jr|Sr|No)\.$/i;

export function segmentSentences(text: string): Sentence[] {
  const sentences: Sentence[] = [];
  let start = 0;
  let index = 0;

  for (let i = 0; i < text.length; i++) {
    const char = text[i]!;
    const isBreak = char === "." || char === "!" || char === "?" || char === "\n";
    if (!isBreak) continue;

    // A newline always breaks; punctuation only breaks when the next
    // non-space character starts a new sentence.
    if (char !== "\n") {
      const head = text.slice(start, i + 1);
      if (ABBREVIATIONS.test(head.trimEnd())) continue;
      const next = text.slice(i + 1, i + 3);
      if (!/^\s/.test(next) && next !== "") continue;
    }

    const raw = text.slice(start, i + 1);
    if (raw.trim().length > 0) {
      sentences.push(makeSentence(text, start, i + 1, index++));
    }
    start = i + 1;
  }

  if (start < text.length && text.slice(start).trim().length > 0) {
    sentences.push(makeSentence(text, start, text.length, index));
  }
  return sentences;
}

function makeSentence(text: string, start: number, end: number, index: number): Sentence {
  const span: Span = { start, end, text: text.slice(start, end) };
  return { span, index, clauses: splitClauses(text, span, index) };
}

/**
 * Splits a sentence into clauses at contrastive and coordinating boundaries,
 * then marks each clause for negation, contrast and hedging.
 *
 * Clause-level rather than sentence-level because a single sentence routinely
 * carries opposite verdicts about two brands:
 *
 *     "Nike is lighter, but Adidas has better cushioning."
 */
function splitClauses(text: string, sentence: Span, sentenceIndex: number): Clause[] {
  const local = sentence.text;

  // Boundary offsets: contrast/termination markers, plus semicolons.
  const boundaries: number[] = [0];
  for (const match of local.matchAll(TERMINATION_PATTERN)) {
    if (match.index !== undefined && match.index > 0) boundaries.push(match.index);
  }
  // Semicolons and colons both start a new clause. The colon matters more
  // than it looks: "These options aren't ranked: Nike and ASICS are solid"
  // negates the ranking, not the brands, and without this boundary the
  // negation cue leaked across the colon and marked both brands UNCLEAR.
  for (const match of local.matchAll(/[;:]/g)) {
    if (match.index !== undefined) boundaries.push(match.index + 1);
  }
  boundaries.push(local.length);
  const sorted = [...new Set(boundaries)].sort((a, b) => a - b);

  const clauses: Clause[] = [];
  for (let i = 0; i < sorted.length - 1; i++) {
    const from = sorted[i]!;
    const to = sorted[i + 1]!;
    const chunk = local.slice(from, to);
    if (chunk.trim().length === 0) continue;

    // A negation cue governs its clause only. Because clause boundaries were
    // cut at NegEx termination terms, a cue cannot leak past "but".
    const cues = [...chunk.matchAll(new RegExp(CUE_PATTERN.source, "gi"))];
    // Two negations cancel: "it's not that Nike isn't worth considering" is a
    // (hedged) endorsement, and treating each cue independently inverted it.
    const negated = cues.length % 2 === 1;

    clauses.push({
      span: { start: sentence.start + from, end: sentence.start + to, text: chunk },
      sentenceIndex,
      negated,
      negationCue: negated ? (cues[0]?.[0] ?? null) : null,
      contrastive: i > 0 && CONTRAST_PATTERN.test(chunk),
      hedged: HEDGE_PATTERN.test(chunk),
    });
  }

  return clauses.length > 0
    ? clauses
    : [{ span: sentence, sentenceIndex, negated: false, negationCue: null, contrastive: false, hedged: false }];
}

/** The clause containing an absolute offset. */
export function clauseAt(sentences: Sentence[], offset: number): Clause | null {
  for (const sentence of sentences) {
    for (const clause of sentence.clauses) {
      if (offset >= clause.span.start && offset < clause.span.end) return clause;
    }
  }
  return null;
}

// ---------------------------------------------------------------------------
// List structure
// ---------------------------------------------------------------------------

export interface ListItem {
  /** Number from an explicitly numbered marker; null for bullets. */
  marker: number | null;
  span: Span;
}

export interface ListStructure {
  items: ListItem[];
  /** True when markers are numbered rather than bulleted. */
  numbered: boolean;
  /**
   * True when the text explicitly disclaims ordering ("in no particular
   * order", "these aren't ranked"). An explicit disclaimer outranks any
   * structural signal, including numbering.
   */
  explicitlyUnordered: boolean;
}

const UNORDERED_DISCLAIMER =
  /\b(in no particular order|not (?:in any |in a )?(?:particular )?order|aren'?t ranked|are not ranked|not ranked|no ranking|unranked|all (?:are |equally )?(?:solid|good|great|worth)|any of these)\b/i;

// A numbered markdown heading is a list item too: ChatGPT's answers from
// October 2026 list options as "## 1. ELAN Lash & Brow Beauty Lounge" with the
// area and rating on the lines below, and six ranked salons read as no list.
const LIST_ITEM_PATTERN = /^[ \t]*(?:#{1,6}[ \t]*(?=\d))?(?:(\d{1,2})[.)]|[-*•])[ \t]+(.+)$/gm;

export function detectListStructure(text: string): ListStructure {
  const items: ListItem[] = [];
  let numbered = false;
  for (const match of text.matchAll(LIST_ITEM_PATTERN)) {
    const marker = match[1] ? Number(match[1]) : null;
    if (marker !== null) numbered = true;
    items.push({ marker, span: { start: match.index!, end: match.index! + match[0].length, text: match[0] } });
  }
  return { items, numbered, explicitlyUnordered: UNORDERED_DISCLAIMER.test(text) };
}

/** Ordinal prose ordering: "my top pick is X, then Y, and finally Z". */
export const ORDERED_PROSE_PATTERN =
  /\b(top (?:choice|pick)|first(?:ly)?|second(?:ly)?|third(?:ly)?|then|followed by|next|finally|runner-?up|my pick|best (?:overall|choice))\b/i;
