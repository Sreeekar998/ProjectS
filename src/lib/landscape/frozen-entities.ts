// Frozen competitors as entity rows.
//
// Prompt generation and answer analysis both need the competitive set AS IT
// WAS FROZEN for the prompt set, not the live entities table: confirming a
// new rival next month must not change which brands last month's answers
// were linked against. This turns a snapshot back into Entity rows so the
// same linking code serves both.

import type { Entity } from "./repository";
import type { FrozenCompetitorSnapshot } from "@/lib/db/schema";
import type { FrozenCompetitorSnapshotV2 } from "@/lib/landscape/competitor-types";

export function snapshotEntities(projectId: string, snapshot: FrozenCompetitorSnapshot[]): Entity[] {
  return (snapshot as FrozenCompetitorSnapshotV2[]).map((competitor) => ({
    id: competitor.entityId,
    projectId,
    kind: "competitor",
    competitorType: competitor.competitorType,
    canonicalName: competitor.canonicalName,
    normalizedName: competitor.normalizedName,
    domains: competitor.canonicalDomain ? [competitor.canonicalDomain] : [],
    canonicalDomain: competitor.canonicalDomain,
    entityType: competitor.entityType,
    parentEntityId: null,
    relationship: null,
    status: "confirmed",
    discoveryStatus: "confirmed",
    confidence: competitor.confidence,
    reason: competitor.reason,
    geographyRelevance: null,
    evidenceIds: competitor.evidenceIds,
    source: competitor.provenance[0] ?? "system",
    sourceContributions: competitor.provenance,
    matchedDimensions: competitor.matchedDimensions,
    scoreBreakdown: competitor.scoreBreakdown,
    verificationStatus: competitor.verificationStatus,
    verificationSummary: null,
    rejectionReason: null,
    // Sets frozen since competitor tiers carry each rival's tier, which Trade
    // Offs use to mix rivals across levels; older sets have none.
    candidateProfile: competitor.tier ? { tier: { tier: competitor.tier, place: competitor.tierPlace ?? null } } : null,
    createdAt: new Date(),
  }));
}
