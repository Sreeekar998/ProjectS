// Role assignment: what did the answer actually DO with this entity?
//
// "Brand appears" and "AI presented the brand as an option" are different
// events, and collapsing them is the single largest source of inflated
// visibility numbers. Every role here is decided from the clause the mention
// sits in — never from a character window, which cannot see negation or
// contrast and therefore reads "I wouldn't recommend Nike" as a Nike
// recommendation.

import type { Clause, ListStructure, Sentence } from "./discourse";
import { clauseAt } from "./discourse";
import type { Confidence, OccurrenceRole, Span } from "./types";

/** Verbs and framings that present something as a thing to choose. */
const RECOMMENDATION_SIGNAL =
  /\b(recommend|suggest|consider|go with|opt for|pick|choose|worth (?:a look|considering|checking|\w+ing)|(?:good|solid|great|strong|reasonable|decent|safe)\s+(?:option|choice|pick|bet|alternative)s?|top (?:choice|pick)s?|best (?:option|choice|bet)s?|i'?d (?:(?!say|think|note|add|argue|guess|expect)\w+)|look (?:at|into)|check out|try)\b/i;

/** Framing that presents a fact about a company rather than an option. */
const BACKGROUND_SIGNAL =
  /\b(founded|established|headquarter|history|was created|is one of the (?:largest|biggest|oldest)|market (?:leader|share)|revenue|acquired|owns|owned by|according to|per their|states that|claims that|reports that|website says|operates|sells through|has (?:stores|locations|offices)|employs|publishes|provides a|offers a (?:guide|tool|calculator))\b/i;

/** Explicit comparison framing with no verdict attached. */
const COMPARISON_SIGNAL =
  /\b(compare[ds]?|comparison|versus|vs\.?|stack(?:s)? up|side by side|as good as|better than|worse than)\b/i;

/**
 * Inline enumeration that offers options without a recommendation verb.
 *
 * "Popular sportswear brands for athletes include Nike, Adidas and ASICS" is
 * an answer to a shopping question and presents all three as choices, but it
 * contains no "recommend", "consider" or list markup, so signal-based and
 * list-based detection both missed it and under-counted visibility.
 *
 * The qualifier is what makes it an offer. "Its main competitors include
 * Adidas" enumerates the same way and offers nothing, which is why a bare
 * "<noun> include" is not enough.
 */
const ENUMERATION_OFFER =
  /\b(?:popular|top|best|leading|good|great|solid|recommended|well[- ]regarded|notable|major|strong)\s+(?:[\w-]+\s+){0,3}(?:brands?|options?|choices?|providers?|companies|makers?|vendors?|picks?|contenders?)\b[^.]{0,40}?\b(?:include|are|would be)\b/i;

/** Explicit advice against, beyond plain negation. */
const DISCOURAGE_SIGNAL =
  /\b(avoid|steer clear|wouldn'?t (?:recommend|suggest|pick|choose|go)|not (?:recommend|ideal|suited|the best|a good fit|for (?:this|that))|less suitable|skip)\b/i;

export interface RoleDecision {
  role: OccurrenceRole;
  basis: string;
  confidence: Confidence;
  evidence: Span;
}

export interface RoleContext {
  sentences: Sentence[];
  list: ListStructure;
  /** Absolute offsets of list items that carry a recommendation framing. */
  recommendationListSpans: Array<[number, number]>;
  /**
   * Mention offset -> the clause that actually carries its verdict, when the
   * verdict lives in the NEXT sentence because this one is a bare topic
   * fragment ("Nike? Not for this use case.").
   */
  continuationClause: Map<number, Clause>;
}

/**
 * Decides whether the enclosing list is offering options.
 *
 * A list is treated as a recommendation list when the text around it frames it
 * that way, or when it enumerates candidate answers to a shopping question.
 * Bare enumeration inside a factual paragraph is not promoted.
 */
export function buildRoleContext(text: string, sentences: Sentence[], list: ListStructure): RoleContext {
  const recommendationListSpans: Array<[number, number]> = [];
  if (list.items.length >= 2) {
    // Look at the 200 characters before the first item — the lead-in that
    // typically says what the list is ("Here are a few good options:").
    const first = list.items[0]!;
    const leadIn = text.slice(Math.max(0, first.span.start - 200), first.span.start);
    const framed = RECOMMENDATION_SIGNAL.test(leadIn) || /\b(options|brands|choices|picks|alternatives|contenders)\b/i.test(leadIn);
    if (framed) {
      for (const item of list.items) recommendationListSpans.push([item.span.start, item.span.end]);
    }
  }
  return { sentences, list, recommendationListSpans, continuationClause: new Map() };
}

/**
 * Links bare topic fragments to the sentence that answers them.
 *
 * A "fragment" is a sentence whose content is essentially just an entity — a
 * rhetorical header. Assistant prose uses this constantly, and the verdict
 * always lands in the sentence after it.
 */
export function linkTopicFragments(context: RoleContext, mentionOffsets: number[]): void {
  for (let i = 0; i < context.sentences.length - 1; i++) {
    const sentence = context.sentences[i]!;
    const mentionsHere = mentionOffsets.filter((o) => o >= sentence.span.start && o < sentence.span.end);
    if (mentionsHere.length !== 1) continue;

    // Strip the mention and punctuation; a fragment has almost nothing left.
    const residual = sentence.span.text.replace(/[^A-Za-z\s]/g, " ").trim().split(/\s+/).filter(Boolean);
    if (residual.length > 3) continue;

    const next = context.sentences[i + 1]!;
    const nextHasOwnEntity = mentionOffsets.some((o) => o >= next.span.start && o < next.span.end);
    if (nextHasOwnEntity) continue;

    context.continuationClause.set(mentionsHere[0]!, next.clauses[0] ?? { ...next.clauses[0]! });
  }
}

export function assignRole(mentionSpan: Span, context: RoleContext): RoleDecision {
  const own = clauseAt(context.sentences, mentionSpan.start);
  const continuation = context.continuationClause.get(mentionSpan.start) ?? null;
  // When the entity's own sentence is a bare fragment, the following clause is
  // where the answer actually says something about it.
  const clause = continuation ?? own;
  const evidence: Span = clause?.span ?? mentionSpan;
  const clauseText = clause?.span.text ?? mentionSpan.text;

  const inRecommendationList = context.recommendationListSpans.some(([s, e]) => mentionSpan.start >= s && mentionSpan.start < e);

  const negated = clause?.negated ?? false;
  const hedged = clause?.hedged ?? false;
  const discourage = DISCOURAGE_SIGNAL.test(clauseText);
  const recommends = RECOMMENDATION_SIGNAL.test(clauseText);
  const background = BACKGROUND_SIGNAL.test(clauseText);
  const enumerationOffer = ENUMERATION_OFFER.test(clauseText);
  const compares = COMPARISON_SIGNAL.test(clauseText);
  // "<Entity> is <positive>" offers the entity itself. Distinguished from
  // "<Entity>'s <aspect> is <positive>", which evaluates one attribute and is
  // sentiment rather than an offer — the possessive is what separates them.
  const entityIsPositive =
    /\b(?:is|are|remains?|stays?)\s+(?:a\s+|an\s+|the\s+)?(?:very\s+|quite\s+|really\s+|still\s+)?(?:reliable|excellent|great|solid|strong|good|dependable|outstanding|the one|worth)\b/i.test(clauseText) &&
    !/['’]s\s+(?:\w+\s+){1,3}(?:is|are|can be|tends? to be)\b/i.test(clauseText);

  // Order matters. Discouragement is checked before recommendation because the
  // two share vocabulary — "wouldn't recommend" contains "recommend" — and the
  // negated reading is the correct one.
  if (discourage || (negated && recommends)) {
    return {
      role: "DISCOURAGED",
      basis: negated ? `negated recommendation (cue: "${clause?.negationCue ?? "negation"}")` : "explicit advice against",
      confidence: hedged ? "weak" : "strong",
      evidence,
    };
  }

  // A negated clause that is not about recommending is not evidence of an
  // option either way ("Nike isn't a budget brand").
  if (negated && !recommends) {
    return { role: "UNCLEAR", basis: `mention inside a negated clause (cue: "${clause?.negationCue ?? "negation"}")`, confidence: "uncertain", evidence };
  }

  if (inRecommendationList) {
    return { role: "RECOMMENDED", basis: "item in a list framed as options", confidence: "strong", evidence };
  }

  if (recommends) {
    return { role: "RECOMMENDED", basis: "recommendation verb in the same clause", confidence: hedged ? "weak" : "strong", evidence };
  }

  if (enumerationOffer && !background) {
    return { role: "RECOMMENDED", basis: "named in an enumeration framed as options ('popular brands include…')", confidence: hedged ? "weak" : "strong", evidence };
  }

  if (entityIsPositive && !background && !compares) {
    return { role: "RECOMMENDED", basis: "entity presented as a good option ('is reliable', 'is the one')", confidence: hedged ? "weak" : "strong", evidence };
  }

  // Comparison is checked after recommendation: "I'd choose Nike over Adidas"
  // recommends Nike even though it is also a comparison. Preference in that
  // sentence is captured separately as a comparison quintuple.
  if (compares) {
    return { role: "COMPARED", basis: "comparison framing without a verdict in this clause", confidence: "strong", evidence };
  }

  if (background) {
    return { role: "BACKGROUND", basis: "factual/attributive framing rather than an option", confidence: "strong", evidence };
  }

  return { role: "MENTION_ONLY", basis: "named with no option or opinion signal in the clause", confidence: "strong", evidence };
}
