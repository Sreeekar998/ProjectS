// Comparative preference extraction.
//
// Shaped as the comparative-opinion-mining quintuple — subject, object,
// aspect, opinion, preference — because that representation keeps the hard
// cases expressible. A Trade Off answer frequently compares two brands and
// declines to pick one, or favours each on a different aspect; a single
// "winner" field would force one of those into a verdict the text never gave.

import type { Sentence } from "./discourse";
import type { DetectedMention } from "./mentions";
import type { Comparison, ComparativePreference, Confidence } from "./types";

/** Comparative adjectives that carry direction. */
// Generic comparative morphology, not a fixed adjective list. Answers compare
// on whatever dimension the category cares about — "shorter waiting times",
// "wider range", "lighter" — and enumerating adjectives per industry would be
// exactly the benchmark-specific logic this system must avoid.
const COMPARATIVE =
  /\b(?:better|worse|superior|inferior|outperforms?|beats?|edges? out|wins?|more \w+|less \w+|[a-z]{3,}er)\b(?=\s|,|\.|$)/i;

/**
 * Words ending in -er that are not comparatives. Nouns for people and things
 * are the common trap: "a Dubai-based master hairstylist …, while Atelier 10
 * is also listed" was read as Mokhtar Safadi preferred (2026-09-18).
 */
const NOT_COMPARATIVE =
  /^(?:other|either|neither|whether|however|rather|under|over|after|never|ever|user|offer|order|consider|proper|super|matter|better\b|master|member|number|manager|owner|founder|leader|partner|customer|provider|consumer|retailer|dealer|trainer|teacher|beginner|designer|barber|founder|centre|center|cover|water|letter|paper|power|poster|banner|filter|folder|flyer|sticker|cluster|chapter|corner|border|layer|laser|timer|toner|primer|polymer|together|remember|register|shower|flower|finisher|groomer|stylister)$/i;

/** First-person or advisory selection — the strongest preference signal. */
// ChatGPT writes "I’d" with a curly apostrophe and states its choice as "my
// initial pick would be X", "My verdict: X" or "I’m leaning towards X"; with
// only the straight "I'd" and "my pick is" recognised, four of ten Trade Off
// verdicts for a DIFC salon were never read (2026-10-15).
const SELECTION =
  /\b(?:i['’]?d (?:choose|pick|go with|opt for|recommend|suggest)|i would (?:choose|pick|go with|opt for|recommend|lean)|go with|choose|opt for|the better (?:choice|option) is|i['’]?d lean|i['’]?m leaning|my (?:initial |first |top |final |overall )?(?:pick|choice|verdict|recommendation)(?: would be| is|:))(?![a-z])/i;
const SELECTION_ALL = new RegExp(SELECTION.source, "gi");
/** A verdict written after the chosen name: "X has the stronger documented case", "X is the better choice", "X has the edge", "X would be my first choice". */
const CHOSEN_BEFORE = /\b(?<after>(?:has|makes|is)\s+(?:the\s+|a\s+)?(?:stronger|better|clearer|safer|best|clear)\s+(?:\w+\s+){0,2}(?:case|choice|option|fit|pick|bet)|has the edge|comes out ahead|would be my (?:first|top|initial)\s+\w+)\b/i;

/**
 * "If you're choosing between A and B, I'd lean toward A … especially if you
 * want a seamless result" frames the question once; that "if" is not one of
 * the answer's conditions, and counting it read a clear lean as no winner.
 */
const CHOICE_FRAMING = /\bif you(?:['’]re| are) (?:choosing|deciding|comparing|torn)\b/gi;

/** Each side recommended under its own condition: "A if you want X, and B if you want Y". */
function conditionalSplit(text: string): boolean {
  return /\bif\b[^.]*\bif\b/i.test(text.replace(CHOICE_FRAMING, ""));
}

/** The first of `mentions` after each selection verb in `text` (which starts at `base`). */
function selectedEntities(text: string, base: number, mentions: DetectedMention[]): Set<string> {
  const chosen = new Set<string>();
  for (const match of text.matchAll(SELECTION_ALL)) {
    const verbEnd = base + match.index! + match[0].length;
    const after = mentions.filter((m) => m.span.start >= verbEnd && m.span.start < base + text.length).sort((a, b) => a.span.start - b.span.start)[0];
    if (after) chosen.add(after.entityId ?? after.name.toLowerCase());
  }
  return chosen;
}

/** Equative comparison; negated, it favours the object. */
const EQUATIVE = /\bas\s+(\w+)\s+as\b/i;
const EQUATIVE_NEGATED = /\b(?:not|isn'?t|aren'?t|wasn'?t)\s+(?:quite\s+)?as\s+\w+\s+as\b/i;

/** Explicit refusals to choose. */
// "Y12 may be much more convenient depending on where you are" is a
// condition, not a verdict (2026-09-19: read as the rival preferred on an
// answer that concluded "Atelier 10 has the stronger documented case").
const NO_WINNER = /\b(neither|not necessarily best|no clear winner|depends on|depending on|both are|equally|either (?:one|works|is fine)|toss-?up|comes down to|whichever)\b/i;

/**
 * A comparative the answer declines to assert. "There isn't enough evidence to
 * say Bobby Pin lasts longer than Atelier 10" was recorded as the rival being
 * preferred, and "I couldn't find enough … to compare them fairly" as a loss
 * (2026-09-18): both say the answer could not decide.
 */
const HEDGED_CLAIM =
  /\b(?:(?:isn'?t|is not|not|no|without)\s+(?:enough\s+)?(?:reliable\s+|verifiable\s+|clear\s+|current\s+)*(?:evidence|information|data|proof)|(?:can'?t|cannot|couldn'?t|could not|hard to|difficult to|impossible to)\s+(?:say|tell|verify|confirm|compare|judge|find))\b/i;

/** Aspect head nouns worth naming in a comparison. */
const ASPECT_TERM =
  /\b(cushioning|comfort|fit|price|pricing|value|cost|quality|durability|support|performance|weight|style|styling|design|range|selection|delivery|shipping|returns?|service|reliability|features?|integration|scalability|ease of use|onboarding|coverage|availability)\b/i;

export function extractComparisons(text: string, sentences: Sentence[], mentions: DetectedMention[]): Comparison[] {
  const comparisons: Comparison[] = [];

  for (let i = 0; i < sentences.length; i++) {
    const sentence = sentences[i]!;
    const inSentence = mentions.filter((m) => m.span.start >= sentence.span.start && m.span.start < sentence.span.end);
    // Distinct entities only: "Nike ... Nike" is not a comparison.
    const distinct = dedupeByEntity(inSentence);
    if (distinct.length < 2) continue;

    // The verdict routinely lands in the NEXT sentence:
    //
    //   "Nike is lighter, while Adidas offers better cushioning.
    //    For daily running I'd choose Adidas."
    //
    // Scoring only the comparative sentence credited Nike for being "lighter"
    // and returned the opposite of what the answer recommends, so the window
    // extends one sentence forward to pick up the resolution.
    const next = sentences[i + 1];
    const verdictWindow = next ? { span: { ...next.span }, mentions: mentions.filter((m) => m.span.start >= next.span.start && m.span.start < next.span.end) } : null;

    const sentenceText = sentence.span.text;
    // Comparative words are read with the brand names blanked out: "Atelier"
    // ends in -er, and "…, while Atelier 10 is also listed" was read as a
    // comparison that preferred the rival (2026-09-18). Same length, so every
    // offset still points at the original text.
    const masked = maskMentions(sentenceText, sentence.span.start, inSentence);
    const equative = EQUATIVE.test(masked);
    const comparative = hasComparative(masked) || equative;
    const selectionHere = SELECTION.test(sentenceText);
    const selectionNext = Boolean(verdictWindow && SELECTION.test(verdictWindow.span.text) && verdictWindow.mentions.length > 0);
    const noWinner = NO_WINNER.test(sentenceText) || Boolean(verdictWindow && NO_WINNER.test(verdictWindow.span.text));
    if (!comparative && !selectionHere && !selectionNext && !noWinner && !/\b(vs\.?|versus|compared? (?:to|with))\b/i.test(sentenceText)) continue;

    const [subject, object] = distinct;
    const { preference, confidence, split } = decidePreference(sentence, distinct, {
      comparative,
      selection: selectionHere,
      noWinner,
      verdictWindow,
    }, masked);

    comparisons.push({
      subjectEntityId: subject!.entityId,
      subjectName: subject!.name,
      objectEntityId: object!.entityId,
      objectName: object!.name,
      aspect: ASPECT_TERM.exec(sentenceText)?.[0]?.toLowerCase() ?? null,
      opinion: COMPARATIVE.exec(masked)?.[0]?.toLowerCase() ?? null,
      preference,
      evidence: sentence.span,
      confidence,
      ...(split ? { split } : {}),
    });
  }

  return comparisons;
}

/** The sentence with every mention replaced by same-length filler, so a brand name is never read as a word of the sentence. */
function maskMentions(text: string, base: number, mentions: DetectedMention[]): string {
  let out = text;
  for (const mention of mentions) {
    const start = mention.span.start - base;
    const end = Math.min(text.length, mention.span.end - base);
    if (start < 0 || end <= start) continue;
    out = out.slice(0, start) + "_".repeat(end - start) + out.slice(end);
  }
  return out;
}

function dedupeByEntity(mentions: DetectedMention[]): DetectedMention[] {
  const seen = new Set<string>();
  const out: DetectedMention[] = [];
  for (const mention of mentions) {
    const key = mention.entityId ?? mention.name.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(mention);
  }
  return out;
}

/**
 * Which side the sentence favours.
 *
 * The decisive signal is which entity the SELECTION verb governs, which in
 * English is almost always the entity following it. That is what makes
 *
 *     "Nike is popular, but for marathon runners I'd pick ASICS"
 *
 * resolve to ASICS despite Nike appearing first — the case where naive
 * first-mention ordering gets the competitive answer exactly backwards.
 */
function decidePreference(
  sentence: Sentence,
  mentions: DetectedMention[],
  signals: {
    comparative: boolean;
    selection: boolean;
    noWinner: boolean;
    verdictWindow: { span: { start: number; end: number; text: string }; mentions: DetectedMention[] } | null;
  },
  masked: string = sentence.span.text,
): { preference: ComparativePreference; confidence: Confidence; split?: true } {
  const text = masked;
  const base = sentence.span.start;

  // An explicit refusal outranks everything: a sentence that compares and a
  // follow-up that says "neither" is a tie, not a win for whoever was faster.
  if (signals.noWinner) return { preference: "TIE", confidence: "strong" };

  // A claim the answer says it cannot support is not a verdict.
  if (HEDGED_CLAIM.test(text)) return { preference: "UNCLEAR", confidence: "strong" };

  // "If you need X, go with A; if you want Y, choose B" recommends both under
  // different conditions. Reading the first branch as the verdict invents a
  // preference the answer deliberately withheld.
  if (conditionalSplit(text)) return { preference: "TIE", confidence: "strong", split: true };

  // "Choose 1847 for the overall grooming experience; choose Atelier 10 if
  // you want a more personalised approach" picks each side for its own
  // purpose. Reading the first verb alone recorded Atelier 10 as preferred
  // on an answer that leaned the other way (2026-10-15).
  if (selectedEntities(text, base, mentions).size > 1) return { preference: "TIE", confidence: "strong", split: true };

  // "A is not as good as B" favours B. Handled before the generic comparative
  // branch, which would otherwise credit A for being adjacent to "good".
  if (EQUATIVE_NEGATED.test(text)) return { preference: "OBJECT", confidence: "strong" };
  if (EQUATIVE.test(text)) return { preference: "TIE", confidence: "weak" };

  // An explicit selection anywhere in the window outranks a bare comparative.
  // "X is lighter" describes a property; "I'd choose Y" is the recommendation.
  const window = signals.verdictWindow;
  if (window && SELECTION.test(window.span.text)) {
    const match = SELECTION.exec(window.span.text)!;
    const verbEnd = window.span.start + match.index + match[0].length;
    const chosen = window.mentions.filter((m) => m.span.start >= verbEnd).sort((a, b) => a.span.start - b.span.start)[0];
    if (chosen) {
      return { preference: chosen.entityId === mentions[0]!.entityId ? "SUBJECT" : "OBJECT", confidence: "strong" };
    }
  }

  if (signals.selection) {
    const match = SELECTION.exec(text);
    if (match?.index !== undefined) {
      const verbEnd = base + match.index + match[0].length;
      const after = mentions.filter((m) => m.span.start >= verbEnd).sort((a, b) => a.span.start - b.span.start)[0];
      if (after) {
        const isSubject = after.entityId === mentions[0]!.entityId;
        return { preference: isSubject ? "SUBJECT" : "OBJECT", confidence: "strong" };
      }
    }
  }

  if (signals.comparative) {
    const match = COMPARATIVE.exec(text);
    if (match?.index !== undefined) {
      const compAt = base + match.index;
      // The entity nearest before a comparative adjective is the one being
      // credited with it ("Adidas offers better cushioning").
      const before = mentions.filter((m) => m.span.end <= compAt).sort((a, b) => b.span.end - a.span.end)[0];
      if (before) {
        const isSubject = before.entityId === mentions[0]!.entityId;
        // A bare comparative without a selection verb is weaker evidence:
        // being "lighter" is not the same as being the recommendation.
        return { preference: isSubject ? "SUBJECT" : "OBJECT", confidence: "weak" };
      }
    }
  }

  return { preference: "UNCLEAR", confidence: "uncertain" };
}

/** Explicit comparatives — always comparative wherever they appear. */
const EXPLICIT_COMPARATIVE = /\b(better|worse|superior|inferior|outperforms?|beats?|edges? out|wins?|more \w+|less \w+)\b/i;
/** A sentence weighing two things usually marks the pivot. */
const CONTRAST_IN_SENTENCE = /\b(while|whereas|though|although|but|however|versus|vs\.?|compared? (?:to|with))\b/i;

function hasComparative(text: string): boolean {
  if (EXPLICIT_COMPARATIVE.test(text)) return true;
  for (const match of text.matchAll(/\b([a-z]{3,}er)\b/gi)) {
    const word = match[1]!;
    if (NOT_COMPARATIVE.test(word)) continue;
    // "faster than X" is comparative anywhere; a bare -er needs the sentence
    // to be structured as a weighing, or it is just an adjective.
    const after = text.slice((match.index ?? 0) + word.length, (match.index ?? 0) + word.length + 8);
    if (/^\s+than\b/i.test(after)) return true;
    if (CONTRAST_IN_SENTENCE.test(text)) return true;
  }
  return false;
}


/**
 * The verdict of a head-to-head answer that names only one side when it
 * decides. A Trade Off question names the target and one rival; answers often
 * close with "I'd lean toward Atelier 10 — but specifically ask for BIAB",
 * which names one brand, so the two-brand sentence rule never saw a verdict
 * and a misread from another sentence stood instead (2026-09-18: ChatGPT
 * leaned toward Atelier 10 in about 5 of 10 Trade Offs; 0 were recorded).
 *
 * Returns one comparison (chosen = SUBJECT preferred over the other side) for
 * the LAST selection sentence that governs exactly one of the two, unless that
 * sentence refuses to choose, hedges, or chooses conditionally between both,
 * or other selection sentences choose the other side.
 */
export function extractSelectionVerdict(
  sentences: Sentence[],
  mentions: DetectedMention[],
  sides: { targetEntityId: string; targetName: string; rivalEntityId: string; rivalName: string },
): Comparison | null {
  let verdict: Comparison | null = null;
  const chosen = new Set<string>();
  for (const sentence of sentences) {
    const text = sentence.span.text;
    const match = SELECTION.exec(text) ?? CHOSEN_BEFORE.exec(text);
    if (!match || NO_WINNER.test(text) || conditionalSplit(text)) continue;
    // A caveat after the choice qualifies it without taking it back: "I’d lean
    // toward Atelier 10 for a customised set, but I couldn’t verify enough
    // lash-specific reviews" still leans (2026-10-15). A hedge inside the
    // choosing clause still voids it.
    if (HEDGED_CLAIM.test(clauseAround(text, match.index))) continue;
    const verbEnd = sentence.span.start + match.index + match[0].length;
    const side = (m: DetectedMention) => m.entityId === sides.targetEntityId || m.entityId === sides.rivalEntityId;
    const sideMentions = mentions.filter((m) => side(m) && m.span.start >= sentence.span.start && m.span.start < sentence.span.end);
    const both = selectedEntities(text, sentence.span.start, sideMentions);
    if (both.size > 1) {
      for (const id of both) chosen.add(id);
      continue;
    }
    // "Atelier 10 has the stronger documented case" names the choice before the verdict.
    const governed = match.groups?.after !== undefined
      ? mentions.filter((m) => side(m) && m.span.start >= sentence.span.start && m.span.start < sentence.span.start + match.index).sort((a, b) => b.span.start - a.span.start)[0]
      : mentions.filter((m) => side(m) && m.span.start >= verbEnd && m.span.start < sentence.span.end).sort((a, b) => a.span.start - b.span.start)[0];
    if (!governed) continue;
    const chosenIsTarget = governed.entityId === sides.targetEntityId;
    chosen.add(governed.entityId!);
    verdict = {
      subjectEntityId: chosenIsTarget ? sides.targetEntityId : sides.rivalEntityId,
      subjectName: chosenIsTarget ? sides.targetName : sides.rivalName,
      objectEntityId: chosenIsTarget ? sides.rivalEntityId : sides.targetEntityId,
      objectName: chosenIsTarget ? sides.rivalName : sides.targetName,
      aspect: ASPECT_TERM.exec(text)?.[0]?.toLowerCase() ?? null,
      opinion: match[0].toLowerCase(),
      preference: "SUBJECT",
      evidence: sentence.span,
      confidence: "strong",
    };
  }
  // "Choose Zoho CRM if deals stall because people skip steps … Choose
  // Pipedrive if …" recommends each side under its own condition; the last
  // one is not the verdict (2026-09-19).
  if (chosen.size > 1) return null;
  return verdict;
}

/** The clause of `text` around `at`, cut at ", but", ";" and a spaced dash. */
function clauseAround(text: string, at: number): string {
  const BREAK = /,\s*but\b|;|\s[—–]\s/g;
  let start = 0;
  let end = text.length;
  for (const match of text.matchAll(BREAK)) {
    if (match.index! + match[0].length <= at) start = match.index! + match[0].length;
    else if (match.index! >= at) {
      end = match.index!;
      break;
    }
  }
  return text.slice(start, end);
}
