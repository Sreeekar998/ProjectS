import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import {
  updateTopic,
  updateEntity,
  addTopic,
  addEntity,
  freezeCompetitiveSet,
  effectiveTier,
  getEntity,
  isDiscoveryPolicyStale,
  loadTierContext,
  mergeEntityCandidateProfile,
  type Entity,
  type TierContext,
} from "@/lib/landscape/repository";
import { getLandscape, landscapeJobKey } from "@/lib/landscape/orchestrator";
import { operatorTier, tierPlanDto } from "@/lib/landscape/competitor-tiers";
import type { LandscapeCompetitorTierFields } from "@/lib/landscape/tier-types";
import { isActive } from "@/lib/jobs/active";
import { getLatestProfileVersion } from "@/lib/profile/repository";
import { withErrorHandling, jsonError } from "@/lib/http/respond";
import { appendEvent } from "@/lib/events/bus";
import type { BusinessProfile } from "@/lib/profile/schema";
import { neutralizeTopicName } from "@/lib/landscape/search-profile";

export async function GET(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  return withErrorHandling(async () => {
    const { id: projectId } = await params;
    return NextResponse.json({ landscape: await landscapeResponse(projectId) });
  });
}

/** GET and PATCH return the same shape, so the page keeps its tier groups after an action. */
async function landscapeResponse(projectId: string) {
  const landscape = await getLandscape(projectId);
  // The operator re-confirmed a corrected profile after discovery ran: the
  // page re-runs discovery (and refreshes untouched topics) against it.
  const profileVersion = await getLatestProfileVersion(projectId);
  const confirmed = Boolean(profileVersion?.confirmedAt);
  const profileChanged = Boolean(confirmed && landscape.discovery && landscape.discovery.status !== "running" && landscape.discovery.businessProfileVersionId !== profileVersion!.id);
  // An older discovery policy re-runs only when no frozen set and no
  // operator-touched row exists; otherwise tiers are derived below, with no
  // network, so opening the page never silently re-runs discovery.
  const policyStale = confirmed && !profileChanged ? await isDiscoveryPolicyStale(projectId, landscape.discovery) : false;
  const tierContext = await loadTierContext(projectId, { run: landscape.discovery ?? null });
  return {
    ...landscape,
    // Rejected rows are still returned (status "removed"); the page filters them.
    competitors: landscape.competitors.map((competitor) => ({ ...competitor, ...tierFields(competitor, tierContext) })),
    tierPlan: tierPlanDto(tierContext?.plan ?? null),
    inProgress: isActive(landscapeJobKey(projectId)),
    stale: profileChanged || policyStale,
  };
}

function tierFields(entity: Entity, context: TierContext | null): LandscapeCompetitorTierFields {
  if (entity.status === "removed" && entity.rejectionReason) return { tier: null, tierPlace: null, tierEvidence: null };
  const tier = effectiveTier(entity, context);
  return { tier: tier?.tier ?? null, tierPlace: tier?.place ?? null, tierEvidence: tier?.evidence || null };
}

const TierEnum = z.enum(["area", "city", "country"]);

const PatchSchema = z.object({
  action: z.enum(["update", "confirm"]),
  topicUpdates: z.array(z.object({ id: z.string(), status: z.enum(["candidate", "confirmed", "removed"]).optional(), name: z.string().optional(), priority: z.number().optional() })).default([]),
  competitorUpdates: z
    .array(z.object({ id: z.string(), status: z.enum(["candidate", "confirmed", "removed"]).optional(), canonicalName: z.string().optional(), competitorType: z.enum(["direct", "substitute", "marketplace", "adjacent"]).optional(), tier: TierEnum.optional() }))
    .default([]),
  addTopic: z.object({ name: z.string().min(1), description: z.string().optional() }).optional(),
  addCompetitor: z.object({ canonicalName: z.string().min(1), competitorType: z.enum(["direct", "substitute", "marketplace", "adjacent"]).default("direct"), domain: z.string().max(180).optional(), tier: TierEnum.optional() }).optional(),
});

export async function PATCH(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  return withErrorHandling(async () => {
    const { id: projectId } = await params;
    const body = PatchSchema.parse(await req.json());

    for (const t of body.topicUpdates) {
      const { id, ...patch } = t;
      await updateTopic(id, patch);
    }
    let tierContext: TierContext | null | undefined;
    const context = async () => (tierContext === undefined ? (tierContext = await loadTierContext(projectId)) : tierContext);
    for (const c of body.competitorUpdates) {
      const { id, tier, ...patch } = c;
      const update = { ...patch, discoveryStatus: patch.status === "confirmed" ? "confirmed" : patch.status === "removed" ? "rejected" : undefined };
      if (Object.values(update).some((value) => value !== undefined)) await updateEntity(id, update);
      if (tier) {
        const entity = await getEntity(id);
        const ctx = await context();
        // Merged into candidate_profile: overwriting the JSON would drop the
        // rival's reported location and source pages.
        if (entity && entity.projectId === projectId && ctx) await mergeEntityCandidateProfile(id, { tier: operatorTier(tier, ctx.plan, ctx.target) });
      }
    }
    if (body.addTopic) {
      const profileVersion = await getLatestProfileVersion(projectId);
      if (profileVersion) {
        const profile = profileVersion.profile as unknown as BusinessProfile;
        await addTopic(projectId, profileVersion.id, { ...body.addTopic, discoveryConcept: neutralizeTopicName(body.addTopic.name, profile) });
      }
    }
    if (body.addCompetitor) {
      const ctx = await context();
      const tier = body.addCompetitor.tier ?? ctx?.plan.primaryTier ?? null;
      await addEntity(projectId, {
        canonicalName: body.addCompetitor.canonicalName,
        kind: "competitor",
        competitorType: body.addCompetitor.competitorType,
        domains: body.addCompetitor.domain ? [body.addCompetitor.domain] : [],
        candidateProfile: tier && ctx ? { tier: operatorTier(tier, ctx.plan, ctx.target) } : null,
      });
    }

    if (body.action === "confirm") {
      const landscape = await getLandscape(projectId);
      const confirmedTopicCount = landscape.topics.filter((t) => t.status === "confirmed").length;
      if (confirmedTopicCount < 4 || confirmedTopicCount > 6) {
        return jsonError(400, "topic_count_out_of_range", `Confirm between 4 and 6 topics before proceeding (currently ${confirmedTopicCount}).`);
      }
      // Same rule as the frozen set: any confirmed rival except a marketplace.
      const eligibleCompetitors = landscape.competitors.filter(
        (competitor) => competitor.status === "confirmed" && ["direct", "substitute", "adjacent"].includes(competitor.competitorType ?? ""),
      );
      if (eligibleCompetitors.length === 0) {
        return jsonError(400, "eligible_competitor_required", "Confirm at least one competitor that is not a marketplace before creating Trade Off prompts.");
      }
      const profileVersion = await getLatestProfileVersion(projectId);
      if (!profileVersion) return jsonError(404, "profile_not_found", "Confirmed business profile not found.");
      const competitiveSetVersion = await freezeCompetitiveSet(projectId, profileVersion.id);
      appendEvent(projectId, "landscape.confirmed", {
        topicCount: confirmedTopicCount,
        competitorCount: eligibleCompetitors.length,
        competitiveSetVersionId: competitiveSetVersion.id,
        version: competitiveSetVersion.version,
      });
    }

    return NextResponse.json({ landscape: await landscapeResponse(projectId) });
  });
}
