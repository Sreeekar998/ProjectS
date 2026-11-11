// Aspect-based sentiment.
//
// Structured as the ACOS quadruple — aspect expression, aspect category,
// opinion expression, polarity — because whole-answer sentiment is too crude
// for the thing being measured. "Nike's quality is excellent, but prices are
// high and returns are frustrating" is one answer carrying three different
// verdicts, and a single POSITIVE/NEGATIVE label discards the part a brand
// could act on.
//
// The ACOS formulation also permits an IMPLICIT aspect, which matters here:
// assistant prose says "Nike is excellent" far more often than it names the
// dimension it means.
//
// No opinion evidence yields NO_SENTIMENT. It never yields POSITIVE.

import type { Sentence } from "./discourse";
import { clauseAt } from "./discourse";
import type { DetectedMention } from "./mentions";
import type { AspectSentiment, Confidence, EntitySentiment, Polarity, Span } from "./types";

/**
 * Buying aspects, kept generic on purpose.
 *
 * These are dimensions any purchase decision has, so the same lexicon serves
 * footwear, SaaS, hotels and hospitals. Project-specific vocabulary is layered
 * on top from the confirmed topics and evaluation criteria, so a business that
 * cares about "implementation effort" gets that category without the code
 * knowing anything about its industry.
 */
const ASPECT_CATEGORIES: Array<{ category: string; pattern: RegExp }> = [
  { category: "quality", pattern: /\b(quality|build|craftsmanship|materials?|durabilit|well[- ]made|construction)\b/i },
  { category: "price_value", pattern: /\b(price[sd]?|pricing|cost|value|expensive|cheap|affordab|budget|worth the money|premium)\b/i },
  { category: "comfort_fit", pattern: /\b(comfort|fit|sizing|cushioning|ergonom|feel)\b/i },
  { category: "performance", pattern: /\b(performance|speed|responsive|efficien|power|capabilit)\b/i },
  { category: "design", pattern: /\b(design|style|styling|look|aesthetic|appearance)\b/i },
  { category: "delivery", pattern: /\b(delivery|shipping|dispatch|arrival|lead time)\b/i },
  { category: "returns", pattern: /\b(returns?|refund|exchange|warrant)\b/i },
  { category: "support", pattern: /\b(support|customer service|help desk|onboarding|account manage)\b/i },
  { category: "reliability", pattern: /\b(reliab|consisten|uptime|dependab|stabilit|trust)\b/i },
  { category: "ease_of_use", pattern: /\b(ease of use|easy to use|usabilit|intuitive|learning curve|simple to)\b/i },
  { category: "selection", pattern: /\b(selection|range|variety|catalog|assortment|options available)\b/i },
  { category: "authenticity", pattern: /\b(authentic|genuine|counterfeit|fake|legit)\b/i },
];

const POSITIVE_TERMS =
  /\b(excellent|great|good|strong|solid|superb|outstanding|impressive|reliable|comfortable|durable|premium|top[- ]notch|well[- ]regarded|highly rated|favourabl\w*|favorabl\w*|praise\w*|love[ds]?|recommend\w*|best|leading|trusted|generous|fast|responsive|helpful|easy|affordable|straightforward|worth it)\b/i;

// Trailing word boundaries were silently blocking plurals: `complaint\b`
// cannot match "Complaints", so "Complaints about Nike's support are common"
// scored NO_SENTIMENT on a plainly negative sentence. Stems that take
// inflections are written open-ended.
/** "your main issue", "my problem": the asker's situation, not a verdict. "The issues with X" stays negative. */
// "if your main issues are frizz, puffiness, difficult styling" lists the
// asker's problems to the end of the sentence; "if your nails are weak or
// prone to breaking" describes the asker, not the salon (2026-09-19).
const ASKER_PROBLEM = /\b(?:your|my|you(?:'re| are) (?:having|dealing with))\s+(?:\w+\s+){0,2}(?:issues?|problems?|concerns?)(?:\s+(?:you|I)\s+(?:describe|mention|have)\w*)?\b(?:\s+(?:are|is|include|includes)\b[^.;!?\n]*)?/gi;
const ASKER_CONDITION = /\bif\s+(?:your|you(?:'re|\s+are|\s+have|\s+get))\b[^.;,!?\n]*/gi;
/** An offer to look further ("If you want, I can dig through reviews for complaints about…") states no opinion. */
// "If you like" is an offer only when the answer then offers something ("If
// you'd like, I can…"); "a solid choice for a one-off workout, especially if
// you like serious strength training" is praise with a condition, and was
// dropped as an offer (observation-analysis@18).
const OFFER = /\b(?:if you(?:['’]d)? (?:want|like)\b[^.;!?\n]{0,24}\b(?:i can|i could|i['’]ll|i will|let me)|want me to|shall i|i can (?:also )?(?:dig|look|check|search|pull|find|go through|compare))\b/i;
/**
 * Reporting that no complaints turned up is not a complaint: "I couldn't find
 * a clearly documented public complaint specifically about unexpected charges
 * for keratin treatments at this salon" was the only negative reading of a
 * DIFC salon's run (observation-analysis@18). The negation list has "can't"
 * but not "couldn't", and adding it would also invert "I couldn't recommend
 * them more", so the absence of a complaint is masked here instead.
 */
/**
 * Restating what was looked for is not a finding either: "I looked into
 * Atelier 10 in Dubai’s DIFC to see whether anyone has reported safety
 * problems with their lash extensions", and "I wouldn't interpret the lack of
 * complaints as proof that it never happens", were both read as negative
 * opinions of a salon that the same answers found no complaint about.
 */
const SEARCH_RESTATED =
  /\b(?:to\s+(?:see|check|find out|learn|confirm|verify)\s+(?:whether|if)|whether\s+(?:anyone|anybody|people|customers|clients|guests|users)\s+(?:has|have|had)\s+(?:reported|had|experienced|complained|raised|mentioned))\b[^.;!?\n]*|\b(?:lack|absence)\s+of\s+(?:\w+\s+){0,2}(?:complaints?|reports?|negative reviews?|issues?|problems?)\b/gi;
const NO_COMPLAINT_FOUND =
  /\b(?:could(?:n['’]t| not)|did(?:n['’]t| not)|can(?:no|['’])t|was(?:n['’]t| not) able to|unable to)\s+(?:find|see|locate|identify|spot)\b[^.;!?\n]{0,90}?\b(?:complaints?|issues?|problems?|criticisms?|negative reviews?)\b|\bno\s+(?:\w+\s+){0,3}(?:complaints?|issues?|problems?|negative reviews?)\b[^.;!?\n]{0,60}?\b(?:were|was|have been|has been)\s+(?:found|reported|documented|recorded)\b/gi;

const NEGATIVE_TERMS =
  /\b(poor|bad|weak|disappoint\w*|frustrat\w*|complain\w*|criticis\w*|criticiz\w*|expensive|overpriced|pricey|slow|unreliable|unhelpful|uncomfortable|flimsy|cheap(?:ly)? made|issues?|problems?|struggl\w*|lacking|lacks|limited|narrow|difficult|confusing|hard to|mixed reviews|inconsistent|declin\w*|debatable|questionable|underwhelming|middling|patchy|hit[- ]or[- ]miss)\b/i;

/** Price framed as high is negative; the adjective alone is not. */
const PRICE_NEGATIVE = /\b(price[sd]?|pricing|cost[s]?|fees?)\b[^.]{0,24}\b(?:are|is|can be|tend to be|run)\s+(?:quite\s+|fairly\s+|a bit\s+)?(high|steep|premium)\b/i;

/** Comparative framing inside a single clause naming two brands. */
const COMPARATIVE_IN_CLAUSE =
  /\b(?:as\s+\w+\s+as|better than|worse than|more \w+ than|less \w+ than|[a-z]{3,}er than|compared? (?:to|with)|versus|vs\.?)\b/i;

/** Intensity-neutral factual framing that should not become an opinion. */
const FACTUAL_ONLY = /\b(founded|established|headquarter|was created|history|owns|acquired|revenue|market share|is a|are a)\b/i;

export interface SentimentOptions {
  /** Confirmed topics / evaluation criteria, used to extend aspect coverage. */
  projectAspects?: string[];
}

export function extractSentiment(
  text: string,
  sentences: Sentence[],
  mentions: DetectedMention[],
  options: SentimentOptions = {},
): EntitySentiment[] {
  const extraAspects = (options.projectAspects ?? [])
    .map((term) => term.trim().toLowerCase())
    .filter((term) => term.length > 3);

  const byEntity = new Map<string, { name: string; entityId: string | null; aspects: AspectSentiment[] }>();

  for (const mention of mentions) {
    const key = mention.entityId ?? mention.name.toLowerCase();
    if (!byEntity.has(key)) byEntity.set(key, { name: mention.name, entityId: mention.entityId, aspects: [] });
  }

  // Opinion-target propagation. A sentence names its subject once and then
  // keeps talking about it:
  //
  //   "Nike's quality is excellent, but prices are high and returns are
  //    frustrating."
  //
  // Scoring only the clause containing the literal mention saw the praise and
  // none of the criticism, and reported the brand POSITIVE on an answer that
  // is plainly mixed. Where a sentence mentions exactly one entity, its later
  // clauses inherit that entity as the opinion target.
  const clauseTargets: Array<{ clause: ReturnType<typeof clauseAt>; mention: DetectedMention }> = [];
  for (const sentence of sentences) {
    const inSentence = mentions.filter((m) => m.span.start >= sentence.span.start && m.span.start < sentence.span.end);
    const distinct = new Map(inSentence.map((m) => [m.entityId ?? m.name.toLowerCase(), m]));
    for (const clause of sentence.clauses) {
      const own = inSentence.filter((m) => m.span.start >= clause.span.start && m.span.start < clause.span.end);
      if (own.length > 0) {
        for (const mention of own) clauseTargets.push({ clause, mention });
      } else if (distinct.size === 1) {
        // Unambiguous topic continuation only. With two brands in a sentence,
        // an unattributed clause could belong to either, so it is skipped
        // rather than guessed.
        clauseTargets.push({ clause, mention: [...distinct.values()][0]! });
      }
    }
  }

  // Clauses that compare two different entities are excluded from generic
  // polarity. "Adidas is not as good as ASICS" carries one opinion word and
  // two brands; applying the clause polarity to both marked the FAVOURED
  // brand negative — the exact opposite of what the sentence says. The
  // comparison record already carries who was preferred, so the honest move is
  // to let it, rather than split a single opinion two ways.
  const comparativeClauseSpans = new Set<number>();
  for (const sentence of sentences) {
    for (const clause of sentence.clauses) {
      const inClause = mentions.filter((m) => m.span.start >= clause.span.start && m.span.start < clause.span.end);
      const distinct = new Set(inClause.map((m) => m.entityId ?? m.name.toLowerCase()));
      if (distinct.size >= 2 && COMPARATIVE_IN_CLAUSE.test(clause.span.text)) comparativeClauseSpans.add(clause.span.start);
    }
  }

  for (const { clause, mention } of clauseTargets) {
    const key = mention.entityId ?? mention.name.toLowerCase();
    if (!clause) continue;
    if (comparativeClauseSpans.has(clause.span.start)) continue;
    const clauseText = clause.span.text;

    // A clause whose only content is biographical is not an opinion.
    if (FACTUAL_ONLY.test(clauseText) && !POSITIVE_TERMS.test(clauseText) && !NEGATIVE_TERMS.test(clauseText)) continue;

    const positive = POSITIVE_TERMS.exec(clauseText);
    // The asker's own problem is not an opinion about the business: "Yes, if
    // your main issue is frizz from Dubai humidity, Atelier 10's keratin
    // smoothing looks like a reasonable option" was scored negative for the
    // salon on "issue" (2026-09-18).
    if (OFFER.test(clauseText)) continue;
    const opinionText = clauseText
      .replace(ASKER_PROBLEM, (match) => " ".repeat(match.length))
      .replace(ASKER_CONDITION, (match) => " ".repeat(match.length))
      .replace(NO_COMPLAINT_FOUND, (match) => " ".repeat(match.length))
      .replace(SEARCH_RESTATED, (match) => " ".repeat(match.length));
    const negative = NEGATIVE_TERMS.exec(opinionText) ?? PRICE_NEGATIVE.exec(opinionText);
    if (!positive && !negative) continue;

    // Negation inverts the opinion it governs, using the same clause scoping
    // the role classifier uses.
    let polarity: Polarity =
      positive && negative ? "MIXED" : positive ? "POSITIVE" : "NEGATIVE";
    if (clause.negated && polarity !== "MIXED") {
      polarity = polarity === "POSITIVE" ? "NEGATIVE" : "POSITIVE";
    }

    const matchedCategory =
      ASPECT_CATEGORIES.find((entry) => entry.pattern.test(clauseText)) ??
      (extraAspects.some((term) => clauseText.toLowerCase().includes(term)) ? { category: "project_topic", pattern: /$^/ } : null);

    const aspectTermMatch = matchedCategory ? matchedCategory.pattern.exec(clauseText) : null;

    if (!byEntity.has(key)) byEntity.set(key, { name: mention.name, entityId: mention.entityId, aspects: [] });
    byEntity.get(key)!.aspects.push({
      entityId: mention.entityId,
      entityName: mention.name,
      // Null aspect term is the ACOS "implicit aspect" case, not a gap.
      aspectTerm: aspectTermMatch?.[0] ?? null,
      aspectCategory: matchedCategory?.category ?? "overall",
      opinionTerm: (positive?.[0] ?? negative?.[0]) ?? null,
      polarity,
      evidence: clause.span as Span,
      confidence: confidenceFor(clause.hedged, Boolean(matchedCategory)),
    });
  }

  return [...byEntity.values()].map(({ name, entityId, aspects }) => ({
    entityId,
    entityName: name,
    overallPortrayal: rollUp(aspects),
    aspects: dedupeAspects(aspects),
  }));
}

function confidenceFor(hedged: boolean, hasAspect: boolean): Confidence {
  if (hedged) return "weak";
  return hasAspect ? "strong" : "weak";
}

/**
 * Rolls aspects into one portrayal.
 *
 * Disagreement across aspects is MIXED rather than an average: a brand praised
 * on quality and criticised on price is not "slightly positive", and averaging
 * would erase precisely the tension a brand needs to see.
 */
function rollUp(aspects: AspectSentiment[]): Polarity {
  if (aspects.length === 0) return "NO_SENTIMENT";
  const set = new Set(aspects.map((a) => a.polarity));
  if (set.has("MIXED")) return "MIXED";
  const positive = set.has("POSITIVE");
  const negative = set.has("NEGATIVE");
  if (positive && negative) return "MIXED";
  if (positive) return "POSITIVE";
  if (negative) return "NEGATIVE";
  return "NEUTRAL";
}

/** One verdict per (entity, category); keeps the strongest evidence. */
function dedupeAspects(aspects: AspectSentiment[]): AspectSentiment[] {
  const order: Record<Confidence, number> = { exact: 0, strong: 1, weak: 2, uncertain: 3 };
  const best = new Map<string, AspectSentiment>();
  for (const aspect of aspects) {
    const key = `${aspect.entityId ?? aspect.entityName}|${aspect.aspectCategory}|${aspect.polarity}`;
    const existing = best.get(key);
    if (!existing || order[aspect.confidence] < order[existing.confidence]) best.set(key, aspect);
  }
  return [...best.values()];
}
