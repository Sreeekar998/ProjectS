import type { EvidenceChunk } from "@/lib/crawler/repository";
import { normalizeForSimilarity, textSimilarity } from "@/lib/text/similarity";
import type { BusinessProfile } from "@/lib/profile/schema";
import type { Topic } from "./repository";
import { buildCompetitiveSearchProfile } from "./search-profile";
import { resolveCompetitorCandidates } from "./competitor-entity";
import { scoreCompetitorCandidate } from "./competitor-scoring";
import { verifyCompetitorWebsite } from "./competitor-verifier";
import {
  AiHypothesisCandidateSource,
  AuthorizedSearchCandidateSource,
  OpenKnowledgeCandidateSource,
  WebsiteExplicitCandidateSource,
  disabledWebSearchProvider,
} from "./competitor-sources";
import { GroundedSearchCandidateSource } from "./competitor-search";
import { NearbyPlacesCandidateSource } from "./competitor-nearby";
import { screenCandidates } from "./competitor-screening";
import { computeBrandReach, countByTier, hasLocalTier, planCompetitorTiers, selectByTierQuota } from "./competitor-tiers";
import { createTargetKnowledgeMemo, type TargetKnowledgeResolver } from "./open-knowledge";
import type { BrandReach, CompetitorTier, CompetitorTierPlan } from "./tier-types";
import type {
  CandidateBusinessProfile,
  CompetitiveSearchProfile,
  CompetitorCandidate,
  CompetitorCandidateSource,
  RankedCompetitorCandidate,
  WebSearchProvider,
} from "./competitor-types";

export interface CompetitorDiscoveryMetrics {
  startedAt: number;
  firstCandidateMs: number;
  firstVerifiedMs: number;
  totalMs: number;
  sourceCandidateCount: number;
  resolvedCandidateCount: number;
  verifiedCount: number;
  verificationAttemptCount: number;
  rejectedCount: number;
  suggestedByTier: Record<CompetitorTier, number>;
}

export type CompetitorDiscoveryEvent =
  | { type: "started"; profile: CompetitiveSearchProfile }
  | { type: "candidate_found"; candidate: CompetitorCandidate }
  | { type: "verifying"; candidate: CompetitorCandidate }
  | { type: "suggestion_ready"; candidate: RankedCompetitorCandidate }
  | { type: "rejected"; candidate: RankedCompetitorCandidate }
  | { type: "completed"; metrics: CompetitorDiscoveryMetrics };

export interface CompetitorDiscoveryOptions {
  locale?: string;
  sources?: CompetitorCandidateSource[];
  webSearchProvider?: WebSearchProvider;
  verify?: (candidate: CompetitorCandidate, target: CompetitiveSearchProfile) => Promise<CandidateBusinessProfile | null>;
  /** Attribution for the LLM usage ledger. */
  projectId?: string;
  screen?: (profile: CompetitiveSearchProfile, candidates: CompetitorCandidate[], options: { projectId?: string }) => Promise<CompetitorCandidate[]>;
  onEvent?: (event: CompetitorDiscoveryEvent) => void | Promise<void>;
  /** Suggestion cap when the plan has no tiers; a tiered plan uses its own cap. */
  maxSuggestions?: number;
  verificationConcurrency?: number;
  /** Tests: a fixed tier plan instead of planning from the profile. */
  tierPlan?: CompetitorTierPlan;
  /** Tests: a fixed known-brand result instead of the lookup. */
  brandReach?: BrandReach;
  /** Shared encyclopedic lookup for the target; one per run by default. */
  targetKnowledge?: TargetKnowledgeResolver;
  /** Time box for the known-brand lookup. */
  brandLookupTimeoutMs?: number;
}

const BRAND_LOOKUP_TIMEOUT_MS = 6_000;

/**
 * The known-brand signal only matters for businesses whose plan has local
 * tiers and no country tier yet (a salon that might be a famous brand); every
 * wider plan already compares country-wide. The lookup is time-boxed: on
 * timeout the brand is simply not known, never penalised.
 */
async function resolvePlan(profile: BusinessProfile, searchProfile: CompetitiveSearchProfile, options: CompetitorDiscoveryOptions, knowledge: TargetKnowledgeResolver): Promise<CompetitorTierPlan> {
  if (options.tierPlan) return options.tierPlan;
  if (options.brandReach) return planCompetitorTiers(profile, searchProfile, options.brandReach);
  const withoutLookup = planCompetitorTiers(profile, searchProfile, computeBrandReach(profile, null, false));
  const couldChange = hasLocalTier(withoutLookup) && !withoutLookup.tiers.some((spec) => spec.tier === "country");
  // Injected sources (tests) never reach the network unless a lookup is injected too.
  if (!couldChange || !searchProfile.canonicalDomain || (options.sources && !options.targetKnowledge)) return withoutLookup;
  const timeoutMs = options.brandLookupTimeoutMs ?? BRAND_LOOKUP_TIMEOUT_MS;
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timedOut = new Promise<null>((resolve) => {
    timer = setTimeout(() => resolve(null), timeoutMs);
  });
  const facts = await Promise.race([knowledge.resolve(searchProfile.canonicalDomain).catch(() => null), timedOut]);
  if (timer) clearTimeout(timer);
  return planCompetitorTiers(profile, searchProfile, computeBrandReach(profile, facts, facts !== null));
}

/**
 * "Lash Lift vs Lash Extensions" on a salon's own blog made "Lash Extensions"
 * its only competitor. A comparison phrase on the target's site that names one
 * of the target's own offerings, with no other source agreeing, is content
 * about a service choice, not a rival business.
 */
function isOwnOfferingMention(candidate: CompetitorCandidate, profile: CompetitiveSearchProfile): boolean {
  if (!candidate.evidence.every((item) => item.source === "website_explicit")) return false;
  const name = normalizeForSimilarity(candidate.canonicalName);
  if (!name) return true;
  // Local businesses do not publish "X vs Y" rivalry pages; on their sites the
  // phrase compares treatments ("Volume Lashes vs Classic"), so a
  // comparison-only candidate needs another source to count.
  if (profile.understanding?.placeBound) return true;
  // Every word of the "name" is the target's own vocabulary: a service, not a company.
  const vocabulary = new Set(
    [...profile.offerings, ...profile.importantTopics.map((t) => t.name), profile.industry, profile.subIndustry ?? "", ...(profile.understanding?.offeringGroups.flatMap((g) => [g.name, ...g.items]) ?? [])]
      .flatMap((value) => normalizeForSimilarity(value).split(" "))
      .filter((token) => token.length > 2),
  );
  const nameTokens = name.split(" ").filter((token) => token.length > 2);
  if (nameTokens.length > 0 && nameTokens.every((token) => vocabulary.has(token) || vocabulary.has(token.replace(/s$/, "")))) return true;
  const offerings = [...profile.offerings, ...(profile.understanding?.offeringGroups.flatMap((group) => [group.name, ...group.items]) ?? [])];
  return offerings.some((offering) => {
    const normalized = normalizeForSimilarity(offering);
    return normalized.length > 2 && (normalized === name || normalized.includes(name) || name.includes(normalized) || textSimilarity(normalized, name) >= 0.6);
  });
}

async function mapBounded<T, R>(items: T[], concurrency: number, worker: (item: T) => Promise<R>): Promise<R[]> {
  const results = new Array<R>(items.length);
  let cursor = 0;
  async function run() {
    while (cursor < items.length) {
      const index = cursor++;
      results[index] = await worker(items[index]!);
    }
  }
  await Promise.all(Array.from({ length: Math.min(concurrency, items.length) }, () => run()));
  return results;
}

export async function discoverCompetitors(
  profile: BusinessProfile,
  topics: Topic[],
  evidenceChunks: EvidenceChunk[],
  options: CompetitorDiscoveryOptions = {},
): Promise<{ profile: CompetitiveSearchProfile; candidates: RankedCompetitorCandidate[]; metrics: CompetitorDiscoveryMetrics }> {
  const startedAt = Date.now();
  const searchProfile = buildCompetitiveSearchProfile(profile, topics, options.locale ?? "en");
  const knowledge = options.targetKnowledge ?? createTargetKnowledgeMemo();
  // The plan is attached before any source starts: every source reads the
  // tiers it should search, and the page can name the groups while it runs.
  const plan = await resolvePlan(profile, searchProfile, options, knowledge);
  searchProfile.tiers = plan;
  await options.onEvent?.({ type: "started", profile: searchProfile });

  const sources = options.sources ?? [
    new WebsiteExplicitCandidateSource(evidenceChunks),
    new GroundedSearchCandidateSource({ projectId: options.projectId }),
    new NearbyPlacesCandidateSource({ projectId: options.projectId }),
    new AiHypothesisCandidateSource({ projectId: options.projectId }),
    new OpenKnowledgeCandidateSource({ knowledge }),
    new AuthorizedSearchCandidateSource(options.webSearchProvider ?? disabledWebSearchProvider),
  ];
  let firstCandidateAt = 0;
  const sourceLists = await Promise.all(
    sources.map(async (source) => {
      try {
        const candidates = await source.discover(searchProfile);
        for (const candidate of candidates) {
          if (!firstCandidateAt) firstCandidateAt = Date.now();
          await options.onEvent?.({ type: "candidate_found", candidate });
        }
        return candidates;
      } catch {
        return [];
      }
    }),
  );

  const raw = sourceLists.flat();
  // The target's own places are not part of a rival's name: "Akira Back Dubai" is "Akira Back".
  const targetPlaces = [...searchProfile.geography.cities, ...(searchProfile.geography.neighborhoods ?? []), ...searchProfile.geography.countries];
  const resolved = resolveCompetitorCandidates(raw, targetPlaces).filter(
    (candidate) =>
      candidate.canonicalName.trim().length > 1 &&
      candidate.canonicalName.toLowerCase() !== searchProfile.targetBrand.toLowerCase() &&
      !isOwnOfferingMention(candidate, searchProfile),
  );
  // Injected sources (tests) skip screening unless a screen is injected too.
  const screened = options.sources && !options.screen ? resolved : await (options.screen ?? screenCandidates)(searchProfile, resolved, { projectId: options.projectId });
  const verify = options.verify ?? verifyCompetitorWebsite;
  let firstVerifiedAt = 0;
  let verificationAttemptCount = 0;
  let verifiedCount = 0;
  const ranked = await mapBounded(screened, options.verificationConcurrency ?? 3, async (candidate) => {
    let candidateProfile: CandidateBusinessProfile | null = null;
    if (candidate.likelyDomain && candidate.screening?.keep !== false) {
      verificationAttemptCount += 1;
      await options.onEvent?.({ type: "verifying", candidate });
      candidateProfile = await verify(candidate, searchProfile);
      if (candidateProfile?.verificationStatus === "verified") {
        verifiedCount += 1;
        if (!firstVerifiedAt) firstVerifiedAt = Date.now();
      }
    }
    return scoreCompetitorCandidate(searchProfile, candidate, candidateProfile);
  });

  // Valid suggestions get the slots; rejected candidates (up to 8) are still
  // stored for rediscovery guards and evaluation, never shown. Ranking them
  // together let a rejected row push a valid rival to 17th, where it vanished
  // without a row. With tiers, each level gets its own share of the slots.
  const ordered = ranked.sort((a, b) => b.score.total - a.score.total || b.confidence - a.confidence || a.canonicalName.localeCompare(b.canonicalName));
  const valid = ordered.filter((candidate) => !candidate.rejectionReason);
  // Rejected rows are kept for rediscovery guards and evaluation. Encyclopedic
  // category neighbours the like-for-like screen threw out (UiPath, Notion and
  // ClickUp for an API platform) are taxonomy noise, not businesses an
  // operator might confirm anyway, so they are not stored at all.
  const worthKeeping = (candidate: RankedCompetitorCandidate) =>
    !(candidate.evidence.every((item) => item.source === "open_knowledge") && candidate.screening?.keep === false);
  const suggestions = [
    ...(plan.tiers.length > 0 ? selectByTierQuota(plan, valid) : valid.slice(0, options.maxSuggestions ?? 12)),
    ...ordered.filter((candidate) => Boolean(candidate.rejectionReason) && worthKeeping(candidate)).slice(0, 8),
  ];
  for (const candidate of suggestions) {
    await options.onEvent?.({ type: candidate.rejectionReason ? "rejected" : "suggestion_ready", candidate });
  }
  const finishedAt = Date.now();
  const metrics: CompetitorDiscoveryMetrics = {
    startedAt,
    firstCandidateMs: firstCandidateAt ? firstCandidateAt - startedAt : -1,
    firstVerifiedMs: firstVerifiedAt ? firstVerifiedAt - startedAt : -1,
    totalMs: finishedAt - startedAt,
    sourceCandidateCount: raw.length,
    resolvedCandidateCount: resolved.length,
    verifiedCount,
    verificationAttemptCount,
    rejectedCount: suggestions.filter((candidate) => Boolean(candidate.rejectionReason)).length,
    suggestedByTier: countByTier(suggestions.filter((candidate) => !candidate.rejectionReason)),
  };
  await options.onEvent?.({ type: "completed", metrics });
  return { profile: searchProfile, candidates: suggestions, metrics };
}
