import type { BusinessArchetype } from "@/lib/profile/schema";
import { normalizeForSimilarity } from "@/lib/text/similarity";
import type {
  CandidateBusinessProfile,
  CompetitiveSearchProfile,
  CompetitorCandidate,
  CompetitorRole,
  CompetitorScoreBreakdown,
  RankedCompetitorCandidate,
} from "./competitor-types";
import { canonicalizeDomain, isTargetEntity, normalizeEntityName } from "./competitor-entity";
import { assignCompetitorTier, hasLocalTier, planFromSearchProfile } from "./competitor-tiers";

type ScoreDimension = Exclude<keyof CompetitorScoreBreakdown, "total">;

// Structural affinity carries the largest single weight deliberately.
//
// The lexical dimensions compare the words two businesses publish about
// themselves, and that comparison is far weaker than it looks: Nike's
// navigation reads "Running / Jordan / Sportswear" and Adidas's reads
// "Originals / Terrex / Predator", so their token overlap is near zero even
// though they are the most obvious pair of competitors in the market. Ranking
// on those dimensions alone is what admitted Armani and Dickies — both of
// which DO share the generic token "clothing" — ahead of Adidas.
//
// Structural affinity measures shared market-category signature and explicit
// rivalry evidence instead, which is what actually predicts cross-shopping.
// The lexical dimensions remain as corroboration and as the only signal
// available for candidates no structural source could reach.
const DEFAULT_WEIGHTS: Record<ScoreDimension, number> = {
  structuralAffinity: 0.34,
  offeringOverlap: 0.14,
  jobUseCaseOverlap: 0.13,
  audienceOverlap: 0.07,
  categoryOverlap: 0.11,
  geographyOverlap: 0.07,
  archetypeCompatibility: 0.05,
  semanticSimilarity: 0.05,
  evidenceConfidence: 0.04,
};

const ARCHETYPE_WEIGHT_OVERRIDES: Partial<Record<BusinessArchetype, Partial<Record<ScoreDimension, number>>>> = {
  b2b_saas_enterprise: { offeringOverlap: 0.2, jobUseCaseOverlap: 0.24, audienceOverlap: 0.16, geographyOverlap: 0.03, categoryOverlap: 0.15 },
  ecommerce_dtc_retail: { offeringOverlap: 0.25, jobUseCaseOverlap: 0.16, audienceOverlap: 0.12, geographyOverlap: 0.1, categoryOverlap: 0.18 },
  local_service: { offeringOverlap: 0.17, jobUseCaseOverlap: 0.13, audienceOverlap: 0.08, geographyOverlap: 0.3, categoryOverlap: 0.14 },
  dealership: { offeringOverlap: 0.17, jobUseCaseOverlap: 0.12, audienceOverlap: 0.08, geographyOverlap: 0.28, categoryOverlap: 0.16 },
  restaurant_food_chain: { offeringOverlap: 0.18, jobUseCaseOverlap: 0.1, audienceOverlap: 0.08, geographyOverlap: 0.3, categoryOverlap: 0.16 },
  multi_location_chain: { offeringOverlap: 0.2, jobUseCaseOverlap: 0.13, audienceOverlap: 0.08, geographyOverlap: 0.21, categoryOverlap: 0.16 },
  healthcare: { offeringOverlap: 0.2, jobUseCaseOverlap: 0.14, audienceOverlap: 0.08, geographyOverlap: 0.24, categoryOverlap: 0.16 },
  finance: { offeringOverlap: 0.2, jobUseCaseOverlap: 0.2, audienceOverlap: 0.12, geographyOverlap: 0.1, categoryOverlap: 0.18 },
  travel_hospitality: { offeringOverlap: 0.15, jobUseCaseOverlap: 0.12, audienceOverlap: 0.11, geographyOverlap: 0.26, categoryOverlap: 0.16 },
};

const STOPWORDS = new Set(["and", "the", "for", "with", "from", "that", "this", "your", "our", "services", "solutions", "products", "company", "business"]);

function tokens(values: string[]): Set<string> {
  return new Set(
    values
      .flatMap((value) => normalizeForSimilarity(value).split(" "))
      .filter((token) => token.length > 2 && !STOPWORDS.has(token)),
  );
}

function overlap(left: string[], right: string[]): number {
  const a = tokens(left);
  const b = tokens(right);
  if (a.size === 0 || b.size === 0) return 0;
  let intersection = 0;
  for (const token of a) if (b.has(token)) intersection += 1;
  return Math.round((intersection / Math.max(1, Math.min(a.size, b.size))) * 100);
}

export function isPlaceBoundTarget(target: CompetitiveSearchProfile): boolean {
  const placeBound = target.understanding?.placeBound ?? ["local_service", "dealership", "restaurant_food_chain", "healthcare"].includes(target.businessArchetype);
  // A national chain competes nationally even though customers visit shops;
  // its head-office city is not a boundary for rivals.
  return placeBound && !["national", "international", "multi-country", "global"].includes(target.geography.scope);
}

/**
 * Geography relevance from positive evidence only, now decided per tier by
 * `assignCompetitorTier` (kept for older callers).
 *
 * The old rule scored a candidate 15 — and rejected it as "not local" — when
 * its website fetch failed or its copy lacked a phrase like "serving Dubai".
 * Real DIFC salons were rejected that way while name-only guesses passed.
 * Unknown stays neutral; only evidence that the rival is somewhere no planned
 * tier covers lowers the score.
 */
export function geographyEvidence(
  target: CompetitiveSearchProfile,
  candidate: CompetitorCandidate,
  profile: CandidateBusinessProfile | null,
): { score: number; elsewhere: string | null } {
  const assignment = assignCompetitorTier(planFromSearchProfile(target), target, candidate, profile);
  return { score: assignment.geographyScore, elsewhere: assignment.elsewhere };
}

function normalizedWeights(archetype: BusinessArchetype): Record<ScoreDimension, number> {
  const merged = { ...DEFAULT_WEIGHTS, ...(ARCHETYPE_WEIGHT_OVERRIDES[archetype] ?? {}) };
  const total = Object.values(merged).reduce((sum, value) => sum + value, 0);
  return Object.fromEntries(Object.entries(merged).map(([key, value]) => [key, value / total])) as Record<ScoreDimension, number>;
}

function roleFromSignals(candidate: CompetitorCandidate, score: Omit<CompetitorScoreBreakdown, "total">): CompetitorRole {
  const relationText = `${candidate.reason} ${candidate.matchedDimensions.join(" ")}`.toLowerCase();
  const reasonText = candidate.reason.toLowerCase();
  // Anchored to relationship statements. The bare word "customer" matched
  // ordinary reasons such as "customers of the target would also consider it",
  // which every search-sourced rival carries.
  if (/\b(supplier|vendor|integration partner|technology partner|reseller|distributor|investor|certification body|payment provider|cloud infrastructure)\b|\b(?:is|are|as) (?:a |an |their |its )?(?:customer|client)s? of\b/.test(relationText)) return "not_competitor";
  if (/directory|aggregator|booking platform|comparison site/.test(reasonText) || candidate.proposedType === "marketplace") return "marketplace";
  // A rationale that calls the rival a substitute, or an upmarket alternative
  // chosen "rather than" the target's kind of meal, decides the role before
  // any overlap score: Trèsind Studio ("a premium event meal rather than
  // casual thalis") shares every category signal with a casual North Indian
  // restaurant and still is not on the same shortlist.
  if (/\bsubstitut|\balternative (?:when|for customers|rather than)|\brather than (?:casual|everyday|a casual)|\bupmarket\b|\bhigher-end\b|\bpremium event meal\b/.test(reasonText)) return "substitute";
  // A strong shared market signature is direct-competitor evidence in its own
  // right; requiring lexical agreement on top of it is what demoted every
  // exact-category rival to "adjacent". The same evidence outranks a source's
  // "adjacent" proposal: checking the proposal first typed the single
  // highest-confidence rival of two unrelated test brands as adjacent.
  if (score.structuralAffinity >= 45) return "direct";
  if (score.offeringOverlap >= 45 && score.jobUseCaseOverlap >= 35 && score.categoryOverlap >= 35) return "direct";
  if (candidate.proposedType === "adjacent") return "adjacent";
  if (score.jobUseCaseOverlap >= 35 || candidate.proposedType === "substitute") return "substitute";
  if (candidate.proposedType === "direct" && score.categoryOverlap >= 25) return "direct";
  return "adjacent";
}

export function scoreCompetitorCandidate(
  target: CompetitiveSearchProfile,
  candidate: CompetitorCandidate,
  candidateProfile: CandidateBusinessProfile | null,
): RankedCompetitorCandidate {
  const canonicalDomain = canonicalizeDomain(candidateProfile?.canonicalDomain ?? candidate.likelyDomain);
  const normalizedName = normalizeEntityName(candidate.canonicalName);
  let rejectionReason: string | null = null;

  if (isTargetEntity(candidate, target.targetBrand, target.canonicalDomain, target.aliases)) rejectionReason = "Candidate resolves to the target brand or its domain.";
  if (target.parentBrand && normalizeEntityName(target.parentBrand) === normalizedName) rejectionReason = "Candidate is the target's parent entity.";
  if (candidate.entityType === "product_line" && candidate.parentName && normalizeEntityName(candidate.parentName) === normalizeEntityName(target.targetBrand)) {
    rejectionReason = "Candidate is a target-owned product line, not a competing entity.";
  }
  if (candidateProfile?.verificationStatus === "contradicted") rejectionReason = candidateProfile.verificationSummary;

  const candidateOfferings = candidateProfile?.offerings ?? candidate.matchedDimensions;
  const candidateJobs = [...(candidateProfile?.jobSignals ?? []), ...(candidateProfile?.useCaseSignals ?? [])];
  const candidateAudience = candidateProfile?.audienceSignals ?? [];
  const candidateCategories = candidateProfile?.categorySignals ?? candidate.matchedDimensions;
  const sourceConfidence = Math.min(100, candidate.confidence + Math.max(0, candidate.evidence.length - 1) * 8);
  const hasVerifiedRelationshipSignal = candidateProfile?.verificationStatus === "verified" && candidate.evidence.some(
    (item) => item.source === "website_explicit" || item.source === "open_knowledge",
  );
  // Every lexical dimension is READ FROM THE CANDIDATE'S OWN WEBSITE. When
  // that fetch did not succeed we do not know the candidate's offerings — we
  // have not learnt that it has none. Scoring the unknown as 0 made a blocked
  // or slow website indistinguishable from an irrelevant business, and since
  // the biggest brands are exactly the ones most likely to refuse an unknown
  // crawler, it systematically demoted them: for a footwear target it ranked
  // two obscure regional brands above Adidas purely because their sites let
  // the verifier in. -1 marks a dimension as ABSENT so the weighted average is
  // renormalised over the dimensions actually observed, which is the same rule
  // the measurement layer applies to failed observations.
  const lexicalObserved = candidateProfile?.verificationStatus === "verified";
  // Membership in a tier carries geography, so a city-wide rival is ranked
  // among city-wide rivals instead of losing its slot to neighbourhood ones.
  const plan = planFromSearchProfile(target);
  const tier = assignCompetitorTier(plan, target, candidate, candidateProfile);
  const absent = -1;
  const raw = {
    // Undefined means "this source had no structural evidence", which must not
    // be scored as "structurally unrelated" — that would punish the website
    // and AI sources for a signal they never claimed to produce.
    // Screening relevance is a judgement of cross-shopping from the whole
    // candidate pool, so it stands in for structural evidence when stronger.
    structuralAffinity: Math.max(candidate.structuralAffinity ?? absent, candidate.screening?.keep ? candidate.screening.relevance : absent),
    offeringOverlap: lexicalObserved ? overlap(target.offerings, candidateOfferings) : absent,
    jobUseCaseOverlap: lexicalObserved
      ? overlap([...target.jobsToBeDone, ...target.useCases], candidateJobs.length ? candidateJobs : candidate.matchedDimensions)
      : absent,
    audienceOverlap: lexicalObserved
      ? overlap([...target.targetAudiences, ...target.personas], candidateAudience.length ? candidateAudience : candidate.matchedDimensions)
      : absent,
    categoryOverlap: lexicalObserved
      ? overlap([target.industry, target.subIndustry ?? "", ...target.importantTopics.map((topic) => topic.discoveryConcept)], candidateCategories)
      : absent,
    geographyOverlap: tier.geographyScore,
    archetypeCompatibility: candidate.proposedType === "direct" ? 85 : candidate.proposedType === "substitute" ? 65 : 45,
    semanticSimilarity: lexicalObserved
      ? overlap(
          [target.industry, ...target.offerings, ...target.jobsToBeDone, ...target.targetAudiences],
          candidateProfile?.contentTokens ?? [candidate.reason, ...candidate.matchedDimensions],
        )
      : absent,
    evidenceConfidence: lexicalObserved ? Math.max(75, sourceConfidence) : sourceConfidence,
  };
  // A candidate identified in an explicit public rivalry/comparison context
  // and verified on its own website has stronger evidence than a shallow
  // heading-only overlap calculation can express. It is still a suggestion,
  // never an automatic confirmation.
  if (hasVerifiedRelationshipSignal) {
    raw.offeringOverlap = Math.max(raw.offeringOverlap, 35);
    raw.jobUseCaseOverlap = Math.max(raw.jobUseCaseOverlap, 35);
    raw.categoryOverlap = Math.max(raw.categoryOverlap, 45);
  }
  // A verification that could not run must not read as a contradiction.
  if (candidateProfile && candidateProfile.verificationStatus === "failed") {
    rejectionReason = rejectionReason && rejectionReason.startsWith("Insufficient") ? null : rejectionReason;
  }
  const weights = normalizedWeights(target.businessArchetype);
  const present = (Object.keys(raw) as ScoreDimension[]).filter((dimension) => raw[dimension] >= 0);
  const weightMass = present.reduce((sum, dimension) => sum + weights[dimension], 0) || 1;
  const total = Math.round(present.reduce((sum, dimension) => sum + raw[dimension] * weights[dimension], 0) / weightMass);
  const score: CompetitorScoreBreakdown = { ...raw, structuralAffinity: Math.max(0, raw.structuralAffinity), total };
  const role = roleFromSignals(candidate, raw);
  if (role === "not_competitor") rejectionReason = "Evidence indicates a supplier, partner, customer, or infrastructure relationship rather than buyer competition.";
  if (candidate.screening && !candidate.screening.keep && !rejectionReason) {
    rejectionReason = `Not a like-for-like rival: ${candidate.screening.reason}`;
  }
  // Map neighbours are found for being close, not for being alike. One
  // screened as a weak match (an Applebee's beside an Aleppo tasting-menu
  // restaurant) is shown with its reason instead of topping the list on
  // distance alone.
  if (
    !rejectionReason &&
    candidate.screening?.keep &&
    candidate.screening.relevance < 45 &&
    candidate.proposedType !== "marketplace" &&
    candidate.evidence.every((item) => item.source === "nearby_places" || item.source === "ai_hypothesis")
  ) {
    rejectionReason = `Weak like-for-like match (${candidate.screening.relevance}/100): ${candidate.screening.reason}`;
  }
  // Only evidence of another place that no planned tier covers rejects on
  // geography. A city-wide rival is never rejected for being outside the
  // neighbourhood, a country-wide chain is never rejected for being in another
  // city when the plan has a country tier, and country-only plans reject
  // nothing on geography.
  if (!rejectionReason && tier.tier === null && tier.elsewhere && hasLocalTier(plan) && candidate.proposedType !== "marketplace") {
    const widest = plan.tiers.find((spec) => spec.tier === "city") ?? plan.tiers.find((spec) => spec.tier === "area");
    const outside = widest && widest.place !== "Nearby" ? widest.place : "the area around this business";
    rejectionReason = `Based in ${tier.elsewhere}, outside ${outside}.`;
  }
  // A model's guess at a neighbourhood or city business that no search result
  // and no website confirms is the classic hallucinated rival. A model's memory
  // of national chains (Costa, McDonald's for a UK bakery chain) is reliable
  // enough to suggest for a country-only plan, but not as the country-wide
  // rivals of a local known brand, where it guesses the wrong country's chains.
  const memoryOnly = candidate.evidence.every((item) => item.source === "ai_hypothesis") && candidateProfile?.verificationStatus !== "verified";
  // A fetch that failed is not a business that does not exist. Pastels Salon,
  // a real Dubai chain, was rejected as "general knowledge only" because its
  // site timed out. When the site answered at all (a timeout, a 403, a 5xx:
  // anything but a hostname that does not resolve) and the like-for-like
  // screen kept the candidate with real relevance, it stays as a suggestion
  // with its confidence capped and the failed check written on it. A name
  // with no website at all needs a stronger screening verdict.
  const fetchError = candidateProfile?.verificationStatus === "failed" ? (candidateProfile.verificationError ?? "unavailable") : null;
  const siteExists = fetchError !== null && !/^(dns|blocked|private|invalid_redirect|unsupported_redirect|redirect_missing|too_many_redirects)/.test(fetchError);
  const relevance = candidate.screening?.keep ? candidate.screening.relevance : 0;
  const rescuedByScreening = memoryOnly && ((siteExists && relevance >= 50) || (!candidate.likelyDomain && relevance >= 65));
  if (!rejectionReason && memoryOnly && !rescuedByScreening && (tier.tier === "area" || tier.tier === "city" || (tier.tier === "country" && hasLocalTier(plan)))) {
    rejectionReason = tier.tier === "country"
      ? "Suggested from general knowledge only; no search result or website confirmed this business."
      : "Suggested from general knowledge only; no search result or website confirmed this business in the area.";
  }
  // A candidate with strong structural evidence clears the bar on that alone.
  if (!rejectionReason && total < 28 && raw.structuralAffinity < 40) {
    rejectionReason = "Insufficient multi-dimensional evidence of a shared purchasing decision.";
  }

  const unverifiedSuggestion = !rejectionReason && rescuedByScreening;
  return {
    ...candidate,
    // An unverified rival is a weaker suggestion than a verified one.
    confidence: unverifiedSuggestion ? Math.min(candidate.confidence, 52) : candidate.confidence,
    normalizedName,
    canonicalDomain,
    candidateProfile,
    role,
    score,
    rejectionReason,
    verificationStatus: candidateProfile?.verificationStatus ?? "not_applicable",
    verificationSummary: unverifiedSuggestion
      ? `${siteExists ? `Its website could not be read (${fetchError})` : "No website was found for it"}; kept because the like-for-like screen rated it ${relevance}/100: ${candidate.screening?.reason ?? ""}`.trim()
      : (candidateProfile?.verificationSummary ?? "No candidate domain was available for website verification."),
    tier,
  };
}
