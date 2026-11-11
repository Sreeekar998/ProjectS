import { getProfileVersion } from "@/lib/profile/repository";
import type { BusinessProfile } from "@/lib/profile/schema";
import { listEvidenceChunksForProject } from "@/lib/crawler/repository";
import { generateTopicCandidates } from "./topic-generation";
import { discoverCompetitors } from "./competitors";
import {
  createCompetitorDiscoveryRun,
  getLatestCompetitorDiscoveryRun,
  insertTopics,
  insertTargetEntity,
  listTopics,
  updateEntity,
  updateTopic,
  listEntities,
  updateCompetitorDiscoveryRun,
  upsertRankedCompetitorCandidate,
  isDiscoveryPolicyStale,
  runMetrics,
  type Topic,
  type Entity,
  type CompetitorDiscoveryRun,
} from "./repository";
import { appendEvent } from "@/lib/events/bus";
import { getProject } from "@/lib/projects/repository";
import { neutralizeTopicName } from "./search-profile";
import { COMPETITOR_DISCOVERY_POLICY_VERSION } from "./competitor-types";
import { isActive, release, tryAcquire } from "@/lib/jobs/active";
import type { CompetitorTierPlan } from "./tier-types";

// In-process job key for a project's Landscape generation, and the event
// sequence it started after, so a second POST can scope the client to the
// cycle that is already running.
type StartHolder = typeof globalThis & { __sunLandscapeStarts?: Map<string, number> };

export function landscapeJobKey(projectId: string): string {
  return `landscape:${projectId}`;
}

export function noteLandscapeStart(projectId: string, sinceSequence: number): void {
  const holder = globalThis as StartHolder;
  holder.__sunLandscapeStarts ??= new Map();
  holder.__sunLandscapeStarts.set(projectId, sinceSequence);
}

export function landscapeStartSequence(projectId: string): number | null {
  return (globalThis as StartHolder).__sunLandscapeStarts?.get(projectId) ?? null;
}

export class ProfileNotConfirmedError extends Error {
  constructor() {
    super("Business profile must be confirmed before landscape (topic/competitor) discovery can run.");
    this.name = "ProfileNotConfirmedError";
  }
}

export interface LandscapeResult {
  topics: Topic[];
  competitors: Entity[];
  target: Entity;
  discovery: CompetitorDiscoveryRun | undefined;
}

/** Initializes topics and the target once, then runs the existing Landscape
 * discovery lane progressively. Candidate rows and every progress event are
 * persisted, so a refresh can reconstruct the current state. */
export async function generateLandscape(projectId: string, profileVersionId: string): Promise<LandscapeResult> {
  const profileVersion = await getProfileVersion(profileVersionId);
  if (!profileVersion || !profileVersion.confirmedAt) throw new ProfileNotConfirmedError();
  const project = await getProject(projectId);
  if (!project) throw new Error(`project ${projectId} not found`);
  const profile = profileVersion.profile as unknown as BusinessProfile;

  let topics = await listTopics(projectId);
  const entities = await listEntities(projectId);
  let target = entities.find((entity) => entity.kind === "target");
  // Topics were created once per project and never revisited, so correcting
  // the business type on Understand left topics built for the wrong business.
  // Untouched system suggestions from an older profile version are retired
  // and rebuilt; anything the operator confirmed, added or removed is kept.
  const liveTopics = topics.filter((topic) => topic.status !== "removed");
  const untouchedStale =
    liveTopics.length > 0 &&
    liveTopics.every((topic) => topic.status === "candidate" && topic.source === "system" && topic.businessProfileVersionId !== profileVersionId);
  if (untouchedStale) {
    for (const topic of liveTopics) await updateTopic(topic.id, { status: "removed" });
    topics = topics.map((topic) => (liveTopics.includes(topic) ? { ...topic, status: "removed" } : topic));
  }
  if (topics.filter((topic) => topic.status !== "removed").length === 0) {
    appendEvent(projectId, "landscape.topic.candidate", { status: "discovering" });
    const generated = await generateTopicCandidates(profile, { projectId });
    const inserted = await insertTopics(
      projectId,
      profileVersionId,
      generated.topics.map((topic) => ({ ...topic, discoveryConcept: neutralizeTopicName(topic.name, profile) })),
    );
    topics = [...topics, ...inserted];
    for (const topic of inserted) appendEvent(projectId, "landscape.topic.candidate", { topicId: topic.id, name: topic.name, mode: generated.mode });
  }
  if (!target) target = await insertTargetEntity(projectId, profile.identity.brandName.value, profile.identity.domains);
  else {
    // A website the operator added to the profile after the first Landscape
    // run is still the business's own site: the salon's second domain, cited
    // in 25 of 30 answers, was counted as a third party (2026-09-18).
    const known = (target.domains as string[] | null) ?? [];
    const merged = [...new Set([...known, ...profile.identity.domains])];
    if (merged.length !== known.length) {
      await updateEntity(target.id, { domains: merged });
      target = { ...target, domains: merged } as Entity;
    }
  }

  let latestRun = await getLatestCompetitorDiscoveryRun(projectId);
  // A run left "running" by a restart blocked discovery forever. Runs hold a
  // job key while they work, so a running row without one is stranded.
  if (latestRun?.status === "running" && !isActive(`discovery-run:${latestRun.id}`)) {
    await updateCompetitorDiscoveryRun(latestRun.id, { status: "failed", error: "stranded", completedAt: new Date() });
    latestRun = { ...latestRun, status: "failed", error: "stranded" };
  }
  if (latestRun?.status === "running") {
    // Live in this process: that run ends the cycle with its own terminal event.
    const current = await getLandscape(projectId);
    return { ...current, target: current.target ?? target };
  }
  const priorRunFoundNoCandidates = Number(latestRun?.metrics?.sourceCandidateCount ?? 0) === 0;
  const policyStale = await isDiscoveryPolicyStale(projectId, latestRun);
  if (latestRun?.status === "completed" && latestRun.businessProfileVersionId === profileVersionId && !priorRunFoundNoCandidates && !policyStale) {
    const current = await getLandscape(projectId);
    // Every generate cycle ends with exactly one terminal event. This early
    // return used to emit none, so the page waited on a poll to notice.
    appendEvent(projectId, "landscape.ready", {
      topicCount: current.topics.filter((topic) => topic.status !== "removed").length,
      competitorCount: current.competitors.filter((competitor) => competitor.status !== "removed").length,
      reused: true,
    });
    return { ...current, target: current.target ?? target };
  }

  const run = await createCompetitorDiscoveryRun(projectId, profileVersionId);
  const runKey = `discovery-run:${run.id}`;
  tryAcquire(runKey);
  const chunks = await listEvidenceChunksForProject(projectId);
  const sourceStats: Record<string, number> = {};
  let tierPlan: CompetitorTierPlan | null = null;
  try {
    const result = await discoverCompetitors(profile, topics.filter((topic) => topic.status !== "removed"), chunks, {
      locale: project.language,
      projectId,
      // A consideration set the operator prunes is more useful than a short
      // one they have to supplement by hand; every row still arrives as a
      // suggestion awaiting confirmation. Tiered plans carry their own cap
      // (16, or 18 with three tiers); this is the cap for untiered ones.
      maxSuggestions: 16,
      onEvent: async (event) => {
        if (event.type === "started") {
          tierPlan = event.profile.tiers ?? null;
          // Stored at start so a reload mid-run knows the groups being searched.
          await updateCompetitorDiscoveryRun(run.id, { metrics: runMetrics({ policyVersion: COMPETITOR_DISCOVERY_POLICY_VERSION, tierPlan }) });
          appendEvent(projectId, "landscape.competitor.discovery_started", {
            runId: run.id,
            policyVersion: COMPETITOR_DISCOVERY_POLICY_VERSION,
            tiers: (tierPlan?.tiers ?? []).map((spec) => ({ tier: spec.tier, place: spec.place })),
          });
          return;
        }
        if (event.type === "candidate_found") {
          for (const evidence of event.candidate.evidence) sourceStats[evidence.source] = (sourceStats[evidence.source] ?? 0) + 1;
          appendEvent(projectId, "landscape.competitor.candidate_found", {
            runId: run.id,
            name: event.candidate.canonicalName,
            source: event.candidate.evidence[0]?.source,
          });
          return;
        }
        if (event.type === "verifying") {
          appendEvent(projectId, "landscape.competitor.verifying", { runId: run.id, name: event.candidate.canonicalName, domain: event.candidate.likelyDomain });
          return;
        }
        if (event.type === "suggestion_ready" || event.type === "rejected") {
          const row = await upsertRankedCompetitorCandidate(projectId, event.candidate);
          appendEvent(projectId, event.type === "suggestion_ready" ? "landscape.competitor.suggestion_ready" : "landscape.competitor.rejected", {
            runId: run.id,
            entityId: row.id,
            name: row.canonicalName,
            type: row.competitorType,
            confidence: row.confidence,
            reason: row.reason,
            tier: event.candidate.tier?.tier ?? null,
          });
          return;
        }
        if (event.type === "completed") {
          // Merged, not replaced: the plan written at start must survive completion.
          await updateCompetitorDiscoveryRun(run.id, {
            status: "completed",
            sourceStats,
            metrics: runMetrics({ ...event.metrics, policyVersion: COMPETITOR_DISCOVERY_POLICY_VERSION, tierPlan }),
            completedAt: new Date(),
          });
          appendEvent(projectId, "landscape.competitor.discovery_completed", { runId: run.id, ...event.metrics });
        }
      },
    });
    appendEvent(projectId, "landscape.ready", { topicCount: topics.length, competitorCount: result.candidates.filter((candidate) => !candidate.rejectionReason).length });
  } catch (error) {
    const message = error instanceof Error ? error.message : "unknown_error";
    await updateCompetitorDiscoveryRun(run.id, { status: "failed", error: message, completedAt: new Date() });
    appendEvent(projectId, "landscape.competitor.discovery_failed", { runId: run.id, error: message });
  } finally {
    release(runKey);
  }

  const current = await getLandscape(projectId);
  return { ...current, target: current.target ?? target };
}

export async function getLandscape(projectId: string): Promise<{ topics: Topic[]; competitors: Entity[]; target: Entity | undefined; discovery: CompetitorDiscoveryRun | undefined }> {
  const [allTopics, allEntities, discovery] = await Promise.all([listTopics(projectId), listEntities(projectId), getLatestCompetitorDiscoveryRun(projectId)]);
  return {
    topics: allTopics,
    competitors: allEntities.filter((entity) => entity.kind === "competitor"),
    target: allEntities.find((entity) => entity.kind === "target"),
    discovery,
  };
}
