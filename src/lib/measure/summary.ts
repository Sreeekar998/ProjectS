// A measurement in plain sentences, written from the numbers.
//
// The report and the Overview open with a short paragraph a marketing lead
// can read without a legend. Every sentence is assembled from counted
// fractions the engine already produced; no model writes it, so it cannot
// fail, invent a figure, or drift from the tables below it. Percentages
// appear only where the sample is large enough (LOW_N), and a missing answer
// is described as missing, never as absence.

import type { MeasurementComparison } from "./compare";
import type { BrandRow, MeasureResult, MetricValue } from "./types";

export interface SummarySentence {
  key: string;
  text: string;
}

export interface SummaryInput {
  measure: MeasureResult;
  brand: string;
  /** Engine display names in the order they should be spoken ("ChatGPT and Gemini"). */
  engineNames: string[];
  lowN: number;
  /** "combined" or one engine key. */
  scope?: string;
  previous?: { label: string; comparison: MeasurementComparison } | null;
}

function rate(metric: MetricValue, lowN: number): string {
  const base = `${metric.numerator} of ${metric.denominator}`;
  if (metric.denominator < lowN || metric.value === null) return base;
  return `${base} (${Math.round(metric.value * 100)}%)`;
}

function plural(count: number, singular: string, pluralForm = `${singular}s`): string {
  return count === 1 ? singular : pluralForm;
}

function joinNames(names: string[]): string {
  if (names.length <= 1) return names.join("");
  return `${names.slice(0, -1).join(", ")} and ${names[names.length - 1]}`;
}

/**
 * Whether share of voice can be read as a comparison. Its denominator holds
 * only the target and the frozen competitors, so when no competitor is named
 * in the Discovery answers the share is 100% by construction and says
 * nothing about the rivals the answers actually named. A Dubai gym showed
 * "3 of 3" while the answers named Fitness First, GymNation and MH3 Gym,
 * none of them tracked (feedback 2026-09-16).
 */
export interface ShareOfVoiceReading {
  comparable: boolean;
  /** Frozen competitors in the set. */
  competitors: number;
  /** Competitors named in at least one Discovery answer in this scope. */
  competitorsNamed: number;
  /** Untracked names in the same Discovery answers, most-named first. */
  untracked: Array<{ name: string; named: number }>;
}

export function shareOfVoiceReading(measure: Pick<MeasureResult, "presence" | "brands" | "metrics">, scope = "combined"): ShareOfVoiceReading {
  const presence = measure.presence[scope] ?? [];
  const competitors = presence.filter((row) => row.relation !== "target");
  const competitorsNamed = competitors.filter((row) => row.presenceEvents > 0).length;
  const metric = measure.metrics[scope]?.discovery_share_of_voice;
  const untracked = measure.brands
    .filter((row) => row.relation === "emerging")
    .map((row) => ({ name: row.name, named: scope === "combined" ? row.discoveryNamed : (row.namedByEngine[scope]?.named ?? 0) }))
    .filter((row) => row.named > 0)
    .sort((a, b) => b.named - a.named || a.name.localeCompare(b.name))
    .slice(0, 5);
  return { comparable: Boolean(metric && metric.denominator > 0 && competitorsNamed > 0), competitors: competitors.length, competitorsNamed, untracked };
}

/** The target's rank among tracked brands by Discovery answers naming them; ties share a rank. */
export function rankAmongTracked(brands: BrandRow[]): { rank: number; of: number } | null {
  const tracked = brands.filter((row) => row.relation !== "emerging");
  const target = tracked.find((row) => row.relation === "target");
  if (!target || tracked.length < 2) return null;
  const ahead = tracked.filter((row) => row.discoveryNamed > target.discoveryNamed).length;
  return { rank: ahead + 1, of: tracked.length };
}

export function summariseMeasurement(input: SummaryInput): SummarySentence[] {
  const { measure, brand, lowN } = input;
  const scope = input.scope ?? "combined";
  const metrics = measure.metrics[scope] ?? {};
  const out: SummarySentence[] = [];
  const engines = joinNames(input.engineNames) || "The assistants";

  // Coverage first: everything below rests on it.
  const coverage = measure.coverage;
  const partial = coverage.analysable < coverage.planned;
  const gaps = coverage.notCollected + coverage.awaitingAnalysis + coverage.needsReview;
  out.push({
    key: "coverage",
    text:
      `${engines} produced ${coverage.analysable} analysable ${plural(coverage.analysable, "answer")} out of ${coverage.planned} planned${partial ? " so far" : ""}.` +
      (gaps > 0 ? ` ${gaps} ${plural(gaps, "answer is", "answers are")} outside every figure (${[coverage.notCollected > 0 ? `${coverage.notCollected} not collected` : "", coverage.awaitingAnalysis > 0 ? `${coverage.awaitingAnalysis} awaiting analysis` : "", coverage.needsReview > 0 ? `${coverage.needsReview} needing a look` : ""].filter(Boolean).join(", ")}); none of them counts as ${brand} being absent.` : ""),
  });

  // Discovery: named without being asked about.
  const visibility = metrics.discovery_visibility;
  if (!visibility || visibility.denominator === 0) {
    out.push({ key: "discovery", text: "No Discovery answer can be counted yet, so there is no figure for being named unprompted." });
  } else {
    // The most-named business in the same answers is the only reference
    // point offered: never a category benchmark. A tie is called a tie.
    // Untracked businesses count here: "more often than any tracked rival"
    // read as dominance while untracked salons were named as often.
    const namedIn = (row: BrandRow) => (scope === "combined" ? row.discoveryNamed : (row.namedByEngine[scope]?.named ?? 0));
    const everyone = measure.brands.filter((row) => namedIn(row) > 0).sort((a, b) => namedIn(b) - namedIn(a) || a.name.localeCompare(b.name));
    const leader = everyone[0];
    const rivalLeader = everyone.find((row) => row.relation !== "target");
    let leaderClause = "";
    if (leader && leader.relation === "target") {
      if (rivalLeader && namedIn(rivalLeader) === namedIn(leader)) leaderClause = `, level with ${rivalLeader.name}`;
      else if (rivalLeader) leaderClause = `, more often than any other business`;
    } else if (leader) {
      leaderClause = namedIn(leader) === visibility.numerator ? `, level with ${leader.name}` : `; ${leader.name} was named most often, in ${namedIn(leader)} of ${visibility.denominator}`;
    }
    const shareAll = metrics.discovery_share_all_names;
    const businesses = everyone.length;
    const shareClause =
      shareAll && shareAll.denominator > 0 && businesses > 1
        ? ` Those answers named ${businesses} different businesses; ${brand} took ${shareAll.numerator} of ${shareAll.denominator} mentions${shareAll.denominator >= lowN && shareAll.value !== null ? ` (${Math.round(shareAll.value * 100)}%)` : ""}.`
        : "";
    // Share of voice with no tracked competitor named is 100% by construction; say so rather than let a reader infer dominance.
    const voice = shareOfVoiceReading(measure, scope);
    const voiceClause =
      visibility.numerator > 0 && voice.competitors > 0 && voice.competitorsNamed === 0
        ? ` None of the ${voice.competitors} tracked ${plural(voice.competitors, "competitor")} was named in those answers, so share of voice cannot be compared${voice.untracked.length > 0 ? `; the names that did appear are untracked (${joinNames(voice.untracked.slice(0, 3).map((row) => row.name))})` : ""}.`
        : "";
    out.push({
      key: "discovery",
      text: `When buyers asked without naming a brand, ${brand} was named in ${rate(visibility, lowN)} ${plural(visibility.denominator, "answer")}${leaderClause}.${shareClause}${voiceClause}`,
    });
    const first = metrics.first_choice_rate;
    if (first && first.denominator > 0) {
      out.push({ key: "first_choice", text: `It was ranked first in ${rate(first, lowN)} of the answers that put options in a definite order.` });
    }
  }

  // Trade Offs: verdicts only.
  const outcomes = measure.tradeOffs[scope]?.outcomes;
  if (outcomes) {
    const wins = outcomes.TARGET_PREFERRED;
    const losses = outcomes.COMPETITOR_PREFERRED;
    const open = outcomes.TIE + outcomes.UNCLEAR;
    if (wins + losses + open > 0) {
      const rivals = (measure.tradeOffs[scope]?.byCompetitor ?? []).filter((row) => row.competitorPreferred > 0).sort((a, b) => b.competitorPreferred - a.competitorPreferred);
      const strongest = rivals[0];
      out.push({
        key: "tradeoffs",
        text:
          `In head-to-head questions, ${brand} was preferred in ${wins}, a rival in ${losses}${open > 0 ? `, and ${open} reached no clear winner` : ""}.` +
          (strongest ? ` ${strongest.name} was the rival preferred most often, in ${strongest.competitorPreferred} of ${strongest.targetPreferred + strongest.competitorPreferred} decided ${plural(strongest.targetPreferred + strongest.competitorPreferred, "comparison")} against it.` : ""),
      });
    }
  }

  // Reputation: portrayal when asked by name.
  const distribution = measure.sentiment[scope]?.distribution ?? {};
  const positive = distribution.POSITIVE ?? 0;
  const mixed = distribution.MIXED ?? 0;
  const negative = distribution.NEGATIVE ?? 0;
  const factual = (distribution.NEUTRAL ?? 0) + (distribution.NO_SENTIMENT ?? 0);
  const byName = positive + mixed + negative + factual;
  if (byName > 0) {
    // "overall" is the analysis's name for an opinion with no theme; it is not
    // a concern anyone can act on ("The concerns were about overall").
    const concerns = (measure.sentiment[scope]?.aspects ?? [])
      .filter((aspect) => aspect.negative + aspect.mixed > 0 && aspect.category !== "overall")
      .sort((a, b) => b.negative + b.mixed - (a.negative + a.mixed))
      .slice(0, 3)
      .map((aspect) => aspect.category.replace(/_/g, " "));
    const opinions = positive + mixed + negative;
    // Most by-name answers state facts. Reading the opinions against every
    // answer ("positive in 2 of 10") made a well-regarded business look
    // disliked, so the opinions are counted among the answers that gave one.
    out.push({
      key: "reputation",
      text:
        (opinions === 0
          ? `Asked about ${brand} by name, none of the ${byName} ${plural(byName, "answer")} gave an opinion; ${plural(byName, "it", "they")} stated facts.`
          : `Asked about ${brand} by name, ${opinions} of ${byName} ${plural(byName, "answer")} gave an opinion: ${positive} positive, ${mixed} mixed and ${negative} negative${factual > 0 ? `; ${factual} stated facts without one` : ""}.`) +
        (concerns.length > 0 ? ` The concerns were about ${joinNames(concerns)}.` : ""),
    });
  }

  // Sources: the target's own site, and who else shapes the answers.
  const owned = metrics.owned_citation_rate_when_sourced;
  if (owned && owned.denominator > 0) {
    const outside = measure.sources.domains.filter((row) => row.ownership !== "TARGET_OWNED").sort((a, b) => b.responsesCiting - a.responsesCiting)[0];
    out.push({
      key: "sources",
      text:
        `${brand}'s own site was cited in ${rate(owned, lowN)} of the answers that showed sources.` +
        (outside ? ` The most-cited other site was ${outside.domain}${outside.ownerName ? ` (${outside.ownerName})` : ""}, in ${outside.responsesCiting} ${plural(outside.responsesCiting, "answer")}.` : ""),
    });
  }

  // Change, only against a comparable run.
  const previous = input.previous;
  if (!previous) {
    out.push({ key: "change", text: "This is the first measurement of these questions; changes appear once a second run is collected on the same questions." });
  } else if (previous.comparison.comparability.level === "break") {
    out.push({ key: "change", text: `Not compared with the measurement of ${previous.label}: ${previous.comparison.comparability.breaks[0] ?? "the instrument changed"}.` });
  } else {
    const delta = previous.comparison.metrics[scope]?.discovery_visibility;
    const cautions = previous.comparison.comparability.cautions;
    const movement = delta && delta.direction
      ? delta.direction === "flat"
        ? `visibility stayed at ${delta.to.numerator} of ${delta.to.denominator}`
        : `visibility went from ${delta.from.numerator} of ${delta.from.denominator} to ${delta.to.numerator} of ${delta.to.denominator}${delta.points !== null ? ` (${delta.points > 0 ? "+" : ""}${delta.points} points)` : ""}`
      : "no discovery figure can be compared";
    out.push({
      key: "change",
      text: `Compared with ${previous.label}, ${movement}.${cautions.length > 0 ? ` Read with care: ${cautions.join("; ")}.` : ""}`,
    });
  }

  return out;
}
