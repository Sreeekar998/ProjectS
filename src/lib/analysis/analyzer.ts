// The analysis pipeline.
//
//   raw answer (immutable)
//        -> segment into sentences and clauses
//        -> detect mentions, link to project entities
//        -> assign a role per occurrence, from its clause
//        -> extract comparative preferences
//        -> decide rank eligibility, then position
//        -> extract aspect sentiment
//        -> normalize citations and ownership
//        -> VALIDATE every span against the original text
//        -> NormalizedObservation
//
// The validation step at the end is not ceremony. Every claim this layer makes
// carries offsets into the raw answer, and a claim whose offsets no longer
// resolve to the text it says they do is a bug that would otherwise reach
// Measure looking exactly like a fact.

import type { Entity } from "@/lib/landscape/repository";
import type { PromptSection } from "@/lib/prompts/types";
import type { AnswerCaptureState, SourcesCaptureState } from "@/lib/collection/evidence-quality";
import { sha256Hex } from "@/lib/text/similarity";
import { detectListStructure, segmentSentences } from "./discourse";
import { buildLinkTargets, detectEmergingCandidates, detectMentions, headToHeadForms, linkProvenHeadForms, optionLabelSpans, type DetectedMention, type EmergingContext } from "./mentions";
import { assignRole, buildRoleContext, linkTopicFragments } from "./roles";
import { extractComparisons, extractSelectionVerdict } from "./comparison";
import { buildPositions, determineRankEligibility } from "./position";
import { extractSentiment } from "./sentiment";
import { normalizeCitations } from "./citations";
import {
  ANALYSIS_VERSION,
  AGGREGATABLE_CONFIDENCE,
  type AnalysisEligibility,
  type AnalysisWarning,
  type EntityOccurrence,
  type NormalizedObservation,
  type OccurrenceRole,
  type Span,
} from "./types";

export interface AnalysisInput {
  observationId: string;
  promptCandidateId: string;
  section: PromptSection | null;
  providerExperience: string;
  /** The raw answer. Never modified. */
  responseText: string;
  sourceUrls: string[];
  /** False when the observation never captured successfully. */
  captured: boolean;
  /** Operator's source-capture assertion from Observe. Unknown by default. */
  sourceCaptureState?: SourcesCaptureState;
  /**
   * Whether the answer text is whole. A truncated answer is PARTIAL evidence:
   * a brand listed after the cut was never observed, so the answer cannot
   * support a presence denominator.
   */
  answerCaptureState?: AnswerCaptureState;
  entities: Entity[];
  aliasesByEntity: Map<string, string[]>;
  /** Confirmed topics / evaluation criteria, to widen aspect coverage. */
  projectAspects?: string[];
  /** The project's places and category words, so untracked names are businesses of this kind and never places. */
  emerging?: EmergingContext;
  /** The rival a Trade Off question names, so a verdict naming only one side can still be read. */
  questionRivalEntityId?: string | null;
}

export function analyzeObservation(input: AnalysisInput): NormalizedObservation {
  const now = Date.now();
  const base = {
    observationId: input.observationId,
    promptCandidateId: input.promptCandidateId,
    section: input.section,
    providerExperience: input.providerExperience,
    analysisVersion: ANALYSIS_VERSION,
    analysedAt: now,
    sourceHash: sha256Hex(input.responseText ?? ""),
    sourceCaptureState: input.sourceCaptureState ?? "unknown",
    reviewedBy: null,
    supersedesAnalysisId: null,
  };

  // A capture that never succeeded carries no evidence about any brand. It is
  // emitted as NOT_CAPTURED with empty findings so Measure can count it as
  // missing coverage rather than as an absent brand.
  if (!input.captured || !input.responseText || input.responseText.trim().length === 0) {
    return {
      ...base,
      eligibility: "NOT_CAPTURED",
      occurrences: [],
      comparisons: [],
      positions: [],
      rankEligibility: "no_options",
      sentiment: [],
      citations: [],
      emergingCandidates: [],
      warnings: [{ code: "not_captured", detail: "No successfully captured answer; absence of a brand cannot be inferred." }],
    };
  }

  const text = input.responseText;
  const sentences = segmentSentences(text);
  const list = detectListStructure(text);

  // In a head-to-head answer the two businesses the question named are
  // written the short way ("1847", "Chaps & Co"); those forms link here only.
  const headToHead = new Map<string, string[]>();
  if (input.section === "Trade Offs" && input.questionRivalEntityId) {
    for (const entity of input.entities) {
      if (entity.kind === "target" || entity.id === input.questionRivalEntityId) headToHead.set(entity.id, headToHeadForms(entity.canonicalName));
    }
  }
  const targets = buildLinkTargets(input.entities, input.aliasesByEntity, headToHead);
  const mentions = linkProvenHeadForms(text, detectMentions(text, targets), targets, input.emerging?.categoryTerms ?? []);

  const roleContext = buildRoleContext(text, sentences, list);
  linkTopicFragments(roleContext, mentions.map((m) => m.span.start));
  const roleByStart = new Map<number, OccurrenceRole>();

  const occurrences: EntityOccurrence[] = mentions.map((mention) => {
    const decision = assignRole(mention.span, roleContext);
    roleByStart.set(mention.span.start, decision.role);
    return {
      entityId: mention.entityId,
      name: mention.name,
      surfaceForm: mention.surfaceForm,
      relation: mention.relation,
      productSurface: mention.productSurface,
      role: decision.role,
      evidence: decision.evidence,
      mention: mention.span,
      roleBasis: decision.basis,
      // A weak surface match cannot produce a strong role claim: the role is
      // only as trustworthy as the link underneath it. An UNCLEAR role makes
      // no claim, so it cannot lower trust in the link: a brand named inside a
      // negated clause ("Nike does not charge for return shipping") was still
      // named. Treating it as uncertain presence sent every such answer to
      // review — nine of thirty Gemini answers in one run.
      confidence: decision.role === "UNCLEAR" ? mention.confidence : weakest(mention.confidence, decision.confidence),
    };
  });

  // A tracked business written as an option's own label ("4. Atelier 10",
  // "## 2. Bobby Pin Ladies Salon", a map entry) is offered as an option,
  // exactly as an untracked name in the same list is. A salon's #4 slot in
  // a list of "top picks" under a "## Luxury salons in Dubai" heading was
  // read as a bare mention while every rival around it was recommended.
  const labelSpans = optionLabelSpans(text);
  for (const occurrence of occurrences) {
    if (occurrence.role !== "MENTION_ONLY" && occurrence.role !== "BACKGROUND") continue;
    if (!labelSpans.some(([start, end]) => occurrence.mention.start >= start && occurrence.mention.start < end)) continue;
    occurrence.role = "RECOMMENDED";
    occurrence.roleBasis = "named as a listed option";
    roleByStart.set(occurrence.mention.start, "RECOMMENDED");
  }

  // Emerging candidates are resolved BEFORE comparison so an untracked brand
  // can be one side of a comparison. Without this, an answer weighing our
  // product against a competitor product we have never recorded looked like a
  // bare mention, and the competitive signal was lost entirely.
  const emergingRaw = detectEmergingCandidates(text, mentions, {
    places: [],
    categoryTerms: [],
    ...input.emerging,
    trackedNames: input.entities.map((entity) => entity.canonicalName),
  });
  const emergingAsMentions: DetectedMention[] = emergingRaw
    .filter((candidate) => candidate.name.length >= 4)
    .map((candidate) => ({
      entityId: null,
      name: candidate.name,
      relation: "unknown" as const,
      surfaceForm: "unlinked" as const,
      productSurface: null,
      span: candidate.spans[0]!,
      confidence: "weak" as const,
    }));

  // A comparison in which NEITHER side resolves to a tracked entity is not
  // evidence about this market. Markdown tables and headings produce plenty of
  // them — "Cushioning" against "Heavy", "Right Pair" against "Each Family
  // Member" — and because an UNCLEAR comparison forces the whole observation
  // into review, that table furniture was silently deleting real Discovery
  // answers from every metric. At least one side must be a brand.
  let comparisons = extractComparisons(text, sentences, [...mentions, ...emergingAsMentions].sort((a, b) => a.span.start - b.span.start))
    .filter((comparison) => {
      if (comparison.subjectEntityId || comparison.objectEntityId) return true;
      // An untracked brand may legitimately be one side, but only when it was
      // actually detected as a brand-like surface rather than a table cell.
      const emergingNames = new Set(emergingAsMentions.map((mention) => mention.name.toLowerCase()));
      return emergingNames.has(comparison.subjectName.toLowerCase()) && emergingNames.has(comparison.objectName.toLowerCase());
    });

  // A head-to-head answer often decides in a sentence that names only one
  // side ("I'd lean toward Atelier 10"). When the question named the rival
  // and no two-brand sentence reached a firm verdict, that selection is the
  // verdict, and weaker readings of the same pair give way to it.
  if (input.section === "Trade Offs" && input.questionRivalEntityId) {
    const target = input.entities.find((entity) => entity.kind === "target");
    const rival = input.entities.find((entity) => entity.id === input.questionRivalEntityId);
    if (target && rival) {
      const isPair = (c: { subjectEntityId: string | null; objectEntityId: string | null }) =>
        (c.subjectEntityId === target.id && c.objectEntityId === rival.id) || (c.subjectEntityId === rival.id && c.objectEntityId === target.id);
      // A split ("Atelier 10 if you want X, and 1847 if you want Y") is the
      // answer's decision too: a later "Atelier 10 would be my first choice
      // to try" under one of those conditions must not overturn it.
      const firm = comparisons.some((c) => isPair(c) && (((c.preference === "SUBJECT" || c.preference === "OBJECT") && c.confidence === "strong") || (c.preference === "TIE" && c.split)));
      if (!firm) {
        const verdict = extractSelectionVerdict(sentences, mentions, {
          targetEntityId: target.id,
          targetName: target.canonicalName,
          rivalEntityId: rival.id,
          rivalName: rival.canonicalName,
        });
        if (verdict) comparisons = [...comparisons.filter((c) => !isPair(c)), verdict];
      }
      // "I’d lean towards 1847 if you want … But Atelier 10 is a strong
      // alternative if …" then "My final verdict: Choose 1847 for …; choose
      // Atelier 10 if …": when the answer's last firm reading of the pair is a
      // split, that is its conclusion, and an earlier lean does not outvote it
      // (2026-10-15).
      const firmReadings = comparisons
        .filter((c) => isPair(c) && (c.split || ((c.preference === "SUBJECT" || c.preference === "OBJECT") && c.confidence === "strong")))
        .sort((a, b) => a.evidence.start - b.evidence.start);
      if (firmReadings.at(-1)?.split) comparisons = comparisons.filter((c) => !isPair(c) || c.preference === "TIE" || c.preference === "UNCLEAR" || c.preference === "NEITHER");
    }
  }

  // Reconcile roles with comparisons. Role assignment reads one clause;
  // a comparison spans a sentence or two. An entity the answer plainly set
  // against another is COMPARED even when its own clause says only that it is
  // "lighter" — but a stronger verdict already found (RECOMMENDED /
  // DISCOURAGED) is never downgraded to it.
  const comparedEntityKeys = new Set<string>();
  for (const comparison of comparisons) {
    comparedEntityKeys.add(comparison.subjectEntityId ?? comparison.subjectName.toLowerCase());
    comparedEntityKeys.add(comparison.objectEntityId ?? comparison.objectName.toLowerCase());
  }
  for (const occurrence of occurrences) {
    const key = occurrence.entityId ?? occurrence.name.toLowerCase();
    if (!comparedEntityKeys.has(key)) continue;
    if (occurrence.role === "MENTION_ONLY" || occurrence.role === "UNCLEAR") {
      occurrence.role = "COMPARED";
      occurrence.roleBasis = "entity participates in a comparison in this response";
      roleByStart.set(occurrence.mention.start, "COMPARED");
    }
  }

  const comparedNames = new Set(comparisons.flatMap((c) => [c.subjectName.toLowerCase(), c.objectName.toLowerCase()]));
  // Only surfaces in an option-like role are worth proposing; proper nouns
  // from background prose are noise. The strongest role across every mention
  // counts: judging the first mention alone dropped HubSpot from a CRM
  // answer because its first appearance was a table cell, while keeping
  // three integrations named once in prose. A name the detector saw as a
  // listed option (a table row, a bullet label, an own-site link opening a
  // row) is an option even when no clause around it recommends anything.
  const ROLE_RANK: Record<string, number> = { RECOMMENDED: 3, COMPARED: 2, DISCOURAGED: 2, MENTION_ONLY: 1, UNCLEAR: 0 };
  const emergingCandidates = emergingRaw
    .map((candidate) => {
      let role: OccurrenceRole = "UNCLEAR";
      for (const span of candidate.spans) {
        const decision = assignRole(span, roleContext);
        if ((ROLE_RANK[decision.role] ?? 0) > (ROLE_RANK[role] ?? 0)) role = decision.role;
      }
      if (role === "MENTION_ONLY" && comparedNames.has(candidate.name.toLowerCase())) role = "COMPARED";
      if (!["RECOMMENDED", "COMPARED", "DISCOURAGED"].includes(role) && candidate.listed) role = "RECOMMENDED";
      return { name: candidate.name, mentions: candidate.spans, role };
    })
    .filter((candidate) => ["RECOMMENDED", "COMPARED", "DISCOURAGED"].includes(candidate.role));

  // An answer's options are every business it offered, tracked or not. With
  // only tracked brands counted, a numbered list of six untracked salons was
  // "no options" and its first pick was never recorded, so "ranked first"
  // rested on almost no answers (observation-analysis@18).
  const recommendedEntities = new Set(
    occurrences.filter((o) => o.role === "RECOMMENDED").map((o) => o.entityId ?? o.name.toLowerCase()),
  );
  const recommendedUntracked = emergingCandidates.filter((candidate) => candidate.role === "RECOMMENDED");
  const numberedItems = list.items.filter((item) => item.marker !== null);
  const onNumberedLine = (start: number) => numberedItems.some((item) => start >= item.span.start && start < item.span.end);
  const numberedOptions =
    new Set(occurrences.filter((o) => o.role === "RECOMMENDED" && onNumberedLine(o.mention.start)).map((o) => o.entityId ?? o.name.toLowerCase())).size +
    recommendedUntracked.filter((candidate) => candidate.mentions.some((span) => onNumberedLine(span.start))).length;
  const { eligibility: rankEligibility, reason: rankReason } = determineRankEligibility(text, list, {
    options: recommendedEntities.size + recommendedUntracked.length,
    trackedOptions: recommendedEntities.size,
    numberedOptions,
  });
  // On a numbered list an untracked option holds its number too, so the
  // answer's first pick is recorded whoever it is. Prose order stays a
  // tracked-only reading: a rank from prose is a weaker claim, and untracked
  // names carry the detector's noise.
  const rankedUntracked: DetectedMention[] =
    rankEligibility === "explicit_ordered_list"
      ? recommendedUntracked.map((candidate) => ({
          entityId: null,
          name: candidate.name,
          relation: "unknown" as const,
          surfaceForm: "unlinked" as const,
          productSurface: null,
          span: candidate.mentions.find((span) => onNumberedLine(span.start)) ?? candidate.mentions[0]!,
          confidence: "weak" as const,
        }))
      : [];
  const positions = buildPositions(text, [...mentions, ...rankedUntracked].sort((a, b) => a.span.start - b.span.start), list, rankEligibility, roleByStart);

  const sentiment = extractSentiment(text, sentences, mentions, { projectAspects: input.projectAspects });
  const citations = normalizeCitations(input.sourceUrls, input.entities, mentions);

  const warnings = validate({ text, occurrences, positions, rankEligibility, rankReason, comparisons, sentiment });

  // Eligibility marks an analysis we cannot TRUST, not one that is merely
  // inconclusive.
  //
  // An UNCLEAR comparison used to force review. That contradicted the
  // published measurement policy, which states that ties, mixed verdicts and
  // unclear preferences "count in the denominator but not the numerator — they
  // are real outcomes, not gaps". Excluding them instead deleted the very
  // answers Decisiveness exists to count: a long head-to-head that resolves
  // four aspects confidently and hedges a fifth is a decisive answer with a
  // caveat, not an unreadable one. Twelve of twenty Trade Off observations
  // were being discarded this way.
  //
  // What genuinely invalidates an analysis is structural breakage (a span that
  // does not match its text, a rank that cannot exist) or uncertainty about
  // WHO was named — because every metric is keyed on entity presence.
  const structurallyBroken = warnings.some((w) => w.code === "span_mismatch" || w.code === "impossible_rank");
  const presenceUncertain = occurrences.some((o) => o.confidence === "uncertain");
  // A cut-off answer cannot establish absence: a brand listed after the cut
  // was never observed. It stays visible as evidence but out of every presence
  // denominator, exactly like any other incomplete capture. Model answers were
  // being truncated at a token cap and recorded as whole, which undercounted
  // every brand that appeared late in a long list.
  const truncated = input.answerCaptureState === "truncated";
  if (truncated) {
    warnings.push({ code: "answer_truncated", detail: "The captured answer is incomplete, so a brand's absence cannot be inferred from it." });
  }
  const eligibility: AnalysisEligibility = structurallyBroken || presenceUncertain || truncated ? "NEEDS_REVIEW" : "ELIGIBLE";

  return {
    ...base,
    eligibility,
    occurrences,
    comparisons,
    positions,
    rankEligibility,
    sentiment,
    citations,
    emergingCandidates,
    warnings,
  };
}

const CONFIDENCE_ORDER = { exact: 0, strong: 1, weak: 2, uncertain: 3 } as const;
type Conf = keyof typeof CONFIDENCE_ORDER;
function weakest(a: Conf, b: Conf): Conf {
  return CONFIDENCE_ORDER[a] >= CONFIDENCE_ORDER[b] ? a : b;
}

/**
 * Post-conditions the analysis must satisfy to be trusted.
 *
 * Schema validity is not the bar — a structurally perfect record can still
 * claim a span that does not exist, or a rank the response never gave. These
 * checks are the ones that catch that class of error.
 */
function validate(args: {
  text: string;
  occurrences: EntityOccurrence[];
  positions: NormalizedObservation["positions"];
  rankEligibility: NormalizedObservation["rankEligibility"];
  rankReason: string;
  comparisons: NormalizedObservation["comparisons"];
  sentiment: NormalizedObservation["sentiment"];
}): AnalysisWarning[] {
  const warnings: AnalysisWarning[] = [];

  const checkSpan = (span: Span, label: string) => {
    if (args.text.slice(span.start, span.end) !== span.text) {
      warnings.push({ code: "span_mismatch", detail: `${label} span does not match the raw text`, span });
    }
  };

  for (const occurrence of args.occurrences) {
    checkSpan(occurrence.mention, `mention of ${occurrence.name}`);
    checkSpan(occurrence.evidence, `evidence for ${occurrence.name}`);
  }
  for (const comparison of args.comparisons) checkSpan(comparison.evidence, "comparison");
  for (const entity of args.sentiment) for (const aspect of entity.aspects) checkSpan(aspect.evidence, "sentiment");

  // A rank may only exist where the response was rank-eligible.
  if (!["explicit_ordered_list", "ordered_prose"].includes(args.rankEligibility)) {
    for (const position of args.positions) {
      if (position.explicitRank !== null) {
        warnings.push({ code: "impossible_rank", detail: `rank ${position.explicitRank} on a ${args.rankEligibility} response` });
      }
    }
  } else if (args.positions.every((p) => p.explicitRank === null)) {
    warnings.push({ code: "rank_eligible_but_unassigned", detail: `${args.rankReason}, but no rank could be attached` });
  }

  const uncertain = args.occurrences.filter((o) => !AGGREGATABLE_CONFIDENCE.includes(o.confidence));
  if (uncertain.length > 0) {
    warnings.push({
      code: "low_confidence_occurrences",
      detail: `${uncertain.length} occurrence(s) below aggregation confidence: ${uncertain.map((o) => o.name).join(", ")}`,
    });
  }

  return warnings;
}
