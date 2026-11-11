import { afterEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";
import { eq } from "drizzle-orm";
import { getDb } from "@/lib/db/client";
import { businessProfileVersions, collectionRuns, competitorDiscoveryRuns } from "@/lib/db/schema";
import { newId } from "@/lib/ids";
import { createProject } from "@/lib/projects/repository";
import {
  createCompetitorDiscoveryRun,
  freezeCompetitiveSet,
  getEntity,
  getLatestCompetitiveSetVersion,
  getLatestCompetitorDiscoveryRun,
  insertCompetitorCandidates,
  insertTargetEntity,
  insertTopics,
  readTierPlan,
  updateCompetitorDiscoveryRun,
  updateEntity,
  upsertRankedCompetitorCandidate,
} from "@/lib/landscape/repository";
import { generateLandscape } from "@/lib/landscape/orchestrator";
import { buildCompetitiveSearchProfile } from "@/lib/landscape/search-profile";
import { emptyBrandReach, planCompetitorTiers } from "@/lib/landscape/competitor-tiers";
import { scoreCompetitorCandidate } from "@/lib/landscape/competitor-scoring";
import { COMPETITOR_DISCOVERY_POLICY_VERSION, type FrozenCompetitorSnapshotV2 } from "@/lib/landscape/competitor-types";
import { GET, PATCH } from "@/app/api/projects/[id]/landscape/route";
import { POST as generate } from "@/app/api/projects/[id]/landscape/generate/route";
import { getEventsSince, latestSequence } from "@/lib/events/bus";
import { isActive, release, tryAcquire } from "@/lib/jobs/active";
import { measureRun } from "@/lib/measure/service";
import type { BusinessProfile } from "@/lib/profile/schema";
import { rival, tierBusiness } from "../helpers/tier-fixtures";

function salon(): BusinessProfile {
  return tierBusiness({
    brand: "Maison Nine",
    domain: "maisonnine.example",
    kind: "personal_care_wellness",
    physicalPresence: "single_location",
    scope: "hyperlocal",
    primaryRole: "storefront",
    primary: { neighborhood: "DIFC", city: "Dubai", country: "United Arab Emirates", countryCode: "AE", lat: 25.21, lng: 55.28 },
    nearbyAreas: ["Business Bay"],
  });
}

async function setup(options: { confirmed?: boolean; profile?: BusinessProfile } = {}) {
  const profile = options.profile ?? salon();
  const project = await createProject({ url: "https://maisonnine.example/", marketScope: "global", language: "en" });
  const versionId = newId("bpv");
  const now = new Date();
  const confirmed = options.confirmed ?? true;
  await getDb()
    .insert(businessProfileVersions)
    .values({ id: versionId, projectId: project.id, version: 1, crawlRunId: null, profile: profile as unknown as Record<string, unknown>, fieldProvenance: {}, confirmedAt: confirmed ? now : null, confirmedBy: confirmed ? "test" : null, createdAt: now })
    .run();
  const target = buildCompetitiveSearchProfile(profile, []);
  const plan = planCompetitorTiers(profile, target, emptyBrandReach());
  target.tiers = plan;
  return { projectId: project.id, versionId, profile, target, plan };
}

const params = (id: string) => ({ params: Promise.resolve({ id }) });
const getLandscape = async (projectId: string) => (await (await GET(new NextRequest(`http://localhost/api/projects/${projectId}/landscape`), params(projectId))).json()).landscape;
const patchLandscape = async (projectId: string, body: unknown) =>
  (await (await PATCH(new NextRequest(`http://localhost/api/projects/${projectId}/landscape`, { method: "PATCH", body: JSON.stringify(body) }), params(projectId))).json()).landscape;

/** No test here may reach the network; any fetch fails loudly and is counted. */
function blockNetwork() {
  const fetchMock = vi.fn(async () => {
    throw new Error("network blocked in test");
  });
  vi.stubGlobal("fetch", fetchMock);
  return fetchMock;
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe.sequential("competitor tiers: persistence", () => {
  it("stores the tier on upsert, keeps an operator's tier through rediscovery, and stores no tier for a rejected row", async () => {
    const { projectId, target, plan } = await setup();
    const near = scoreCompetitorCandidate(target, rival("Salon Near", { location: { area: "DIFC", city: "Dubai", country: null }, sourceUrls: ["https://maps.example/near"] }), null);
    const row = await upsertRankedCompetitorCandidate(projectId, near);
    expect((row.candidateProfile as Record<string, unknown>).tier).toMatchObject({ tier: "area", place: "DIFC", basis: "area_name", policy: "competitor-tiers@1" });

    // The operator confirms it and moves it to the city tier.
    const moved = await patchLandscape(projectId, { action: "update", competitorUpdates: [{ id: row.id, status: "confirmed", tier: "city" }] });
    expect(moved.competitors.find((c: { id: string }) => c.id === row.id)).toMatchObject({ tier: "city", tierPlace: "Dubai", tierEvidence: "Placed here by you", status: "confirmed" });

    await upsertRankedCompetitorCandidate(projectId, near);
    const after = await getEntity(row.id);
    const profile = after!.candidateProfile as Record<string, unknown>;
    expect(after!.status).toBe("confirmed");
    expect(profile.tier).toMatchObject({ tier: "city", basis: "operator" });
    expect(profile.reportedLocation).toEqual({ area: "DIFC", city: "Dubai", country: null });
    expect(profile.sourceUrls).toEqual(["https://maps.example/near"]);
    expect(plan.tiers.map((spec) => spec.tier)).toEqual(["area", "city"]);

    const far = await upsertRankedCompetitorCandidate(projectId, scoreCompetitorCandidate(target, rival("Salon Far", { location: { area: null, city: "Abu Dhabi", country: null } }), null));
    expect(far.status).toBe("removed");
    expect((far.candidateProfile as Record<string, unknown>).tier).toBeNull();
  });

  it("stores the plan in the discovery run at start and keeps it through completion", async () => {
    const { projectId, versionId } = await setup();
    await insertTopics(projectId, versionId, ["Hair colour", "Nails", "Lashes", "Brows"].map((name) => ({ name, description: "t", evidenceIds: [] })));
    let planMidRun: ReturnType<typeof readTierPlan> = null;
    // Sources run after the plan is stored; the map lookup is the first fetch.
    vi.stubGlobal("fetch", vi.fn(async (input: RequestInfo | URL) => {
      if (String(input).includes("overpass") && !planMidRun) planMidRun = readTierPlan(await getLatestCompetitorDiscoveryRun(projectId));
      throw new Error("network blocked in test");
    }));
    await generateLandscape(projectId, versionId);
    const run = await getLatestCompetitorDiscoveryRun(projectId);
    expect(run!.status).toBe("completed");
    expect(planMidRun).not.toBeNull();
    const stored = readTierPlan(run);
    expect(stored!.tiers.map((spec) => `${spec.tier}:${spec.place}`)).toEqual(["area:DIFC", "city:Dubai"]);
    expect(stored).toEqual(planMidRun);
    const metrics = run!.metrics as Record<string, unknown>;
    expect(metrics.policyVersion).toBe(COMPETITOR_DISCOVERY_POLICY_VERSION);
    expect(metrics.suggestedByTier).toEqual({ area: 0, city: 0, country: 0 });
    const started = (await getEventsSince(projectId, 0)).find((event) => event.type === "landscape.competitor.discovery_started");
    expect((started!.payload as { tiers: unknown }).tiers).toEqual([{ tier: "area", place: "DIFC" }, { tier: "city", place: "Dubai" }]);
    expect(readTierPlan({ metrics: { tierPlan: { version: "competitor-tiers@0" } } as never })).toBeNull();
  }, 30_000);

  it("freezes tier and place (derived for a legacy row) and Measure still resolves rivals by id and name", async () => {
    const { projectId, versionId, target } = await setup();
    await insertTargetEntity(projectId, "Maison Nine", ["maisonnine.example"]);
    const tiered = await upsertRankedCompetitorCandidate(projectId, scoreCompetitorCandidate(target, rival("Salon Across", { location: { area: "Jumeirah", city: "Dubai", country: null } }), null));
    const [legacy] = await insertCompetitorCandidates(projectId, [{ canonicalName: "Salon Legacy", competitorType: "direct", domains: [], reason: "test", confidence: 80, evidenceIds: [], source: "web_search" }]);
    // A row stored before tiers: a reported location and no tier key.
    await updateEntity(legacy!.id, { status: "confirmed", candidateProfile: { reportedLocation: { area: "DIFC", city: "Dubai", country: null }, sourceUrls: [] } });
    await updateEntity(tiered.id, { status: "confirmed" });

    const set = await freezeCompetitiveSet(projectId, versionId);
    const snapshot = set.competitorSnapshot as FrozenCompetitorSnapshotV2[];
    const byName = Object.fromEntries(snapshot.map((row) => [row.canonicalName, row]));
    expect(byName["Salon Across"]).toMatchObject({ tier: "city", tierPlace: "Dubai" });
    expect(byName["Salon Legacy"]).toMatchObject({ tier: "area", tierPlace: "DIFC" });
    expect(await getLatestCompetitiveSetVersion(projectId)).toMatchObject({ id: set.id });
    // Freezing again with nothing changed reuses the version.
    expect((await freezeCompetitiveSet(projectId, versionId)).id).toBe(set.id);

    const collectionRunId = newId("col");
    await getDb().insert(collectionRuns).values({ id: collectionRunId, projectId, promptSetId: "pst_none", providerExperiences: [], createdAt: new Date() }).run();
    const measure = await measureRun(projectId, collectionRunId);
    const rivals = (measure.presence.combined ?? []).filter((row) => row.relation === "confirmed_competitor").map((row) => [row.entityId, row.name]).sort();
    expect(rivals).toEqual([[legacy!.id, "Salon Legacy"], [tiered.id, "Salon Across"]].sort());
    expect(measure.lineage.competitiveSetVersionId).toBe(set.id);
  });
});

describe.sequential("competitor tiers: landscape API", () => {
  it("returns the tier plan, per-row tiers and rejected rows, and reaches no network", async () => {
    const fetchMock = blockNetwork();
    const { projectId, versionId, target } = await setup();
    const run = await createCompetitorDiscoveryRun(projectId, versionId);
    await updateCompetitorDiscoveryRun(run.id, { status: "completed", metrics: { sourceCandidateCount: 3 } as never });
    await upsertRankedCompetitorCandidate(projectId, scoreCompetitorCandidate(target, rival("Salon Near", { location: { area: null, city: null, country: null, distanceMeters: 700 } }), null));
    await upsertRankedCompetitorCandidate(projectId, scoreCompetitorCandidate(target, rival("Salon Far", { location: { area: null, city: "Abu Dhabi", country: null } }), null));
    const landscape = await getLandscape(projectId);
    expect(landscape.tierPlan).toEqual({
      tiers: [
        { tier: "area", place: "DIFC", level: "neighborhood", heading: "In DIFC", subheading: "and nearby: Business Bay", quota: 8 },
        { tier: "city", place: "Dubai", level: "city", heading: "Across Dubai", subheading: null, quota: 8 },
      ],
      primaryTier: "area",
      knownBrand: false,
    });
    expect(landscape.inProgress).toBe(false);
    const byName = Object.fromEntries(landscape.competitors.map((row: { canonicalName: string }) => [row.canonicalName, row]));
    expect(byName["Salon Near"]).toMatchObject({ tier: "area", tierPlace: "DIFC", tierEvidence: "700 m away" });
    // Rejected rows stay in the JSON; the page filters them.
    expect(byName["Salon Far"]).toMatchObject({ status: "removed", tier: null, tierPlace: null });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("merges a tier move without clobbering the stored location and adds a manual rival in the chosen or primary tier", async () => {
    const { projectId, target } = await setup();
    const row = await upsertRankedCompetitorCandidate(projectId, scoreCompetitorCandidate(target, rival("Salon Mapped", { location: { area: "DIFC", city: "Dubai", country: null }, sourceUrls: ["https://maps.example/a"] }), null));
    await patchLandscape(projectId, { action: "update", competitorUpdates: [{ id: row.id, tier: "city" }] });
    const stored = (await getEntity(row.id))!.candidateProfile as Record<string, unknown>;
    expect(stored.tier).toMatchObject({ tier: "city", place: "Dubai", basis: "operator" });
    expect(stored.reportedLocation).toEqual({ area: "DIFC", city: "Dubai", country: null });
    expect(stored.sourceUrls).toEqual(["https://maps.example/a"]);
    expect((await getEntity(row.id))!.status).toBe("candidate");

    const added = await patchLandscape(projectId, { action: "update", addCompetitor: { canonicalName: "Hand Added", competitorType: "direct" } });
    expect(added.competitors.find((c: { canonicalName: string }) => c.canonicalName === "Hand Added")).toMatchObject({ tier: "area", tierPlace: "DIFC", status: "confirmed" });
    const addedCity = await patchLandscape(projectId, { action: "update", addCompetitor: { canonicalName: "Hand Added City", tier: "city" } });
    expect(addedCity.competitors.find((c: { canonicalName: string }) => c.canonicalName === "Hand Added City")).toMatchObject({ tier: "city", tierPlace: "Dubai" });
  });

  it("marks an older-policy run stale only when there is no frozen set and no operator-touched row", async () => {
    const fetchMock = blockNetwork();
    const { projectId, versionId, target } = await setup();
    const run = await createCompetitorDiscoveryRun(projectId, versionId);
    await updateCompetitorDiscoveryRun(run.id, { status: "completed", metrics: { sourceCandidateCount: 4, policyVersion: "competitor-discovery@5" } as never });
    const row = await upsertRankedCompetitorCandidate(projectId, scoreCompetitorCandidate(target, rival("Salon Near", { location: { area: "DIFC", city: "Dubai", country: null } }), null));
    expect((await getLandscape(projectId)).stale).toBe(true);

    await updateEntity(row.id, { status: "confirmed" });
    expect((await getLandscape(projectId)).stale).toBe(false);

    // A generate call on the touched project reuses the run: no rediscovery.
    await insertTopics(projectId, versionId, ["Hair colour", "Nails", "Lashes", "Brows"].map((name) => ({ name, description: "t", evidenceIds: [] })));
    await insertTargetEntity(projectId, "Maison Nine", ["maisonnine.example"]);
    await generateLandscape(projectId, versionId);
    expect((await getLatestCompetitorDiscoveryRun(projectId))!.id).toBe(run.id);

    // Untouched again, but with a frozen set: still not stale.
    await updateEntity(row.id, { status: "candidate" });
    expect((await getLandscape(projectId)).stale).toBe(true);
    await updateEntity(row.id, { status: "confirmed" });
    await freezeCompetitiveSet(projectId, versionId);
    await updateEntity(row.id, { status: "candidate" });
    const frozenView = await getLandscape(projectId);
    expect(frozenView.stale).toBe(false);
    // Tiers are read from the rows (or derived for older ones); nothing is fetched.
    expect(frozenView.competitors.find((c: { id: string }) => c.id === row.id)).toMatchObject({ tier: "area", tierPlace: "DIFC" });
    expect(fetchMock).not.toHaveBeenCalled();
  });
});

describe.sequential("competitor tiers: generate route and cycle events", () => {
  it("returns sinceSequence, refuses a second generation while one runs, and releases the job", async () => {
    blockNetwork();
    // An unconfirmed profile makes the background job fail fast, with no network.
    const { projectId } = await setup({ confirmed: false });
    const before = latestSequence(projectId);
    const first = await generate(new NextRequest(`http://localhost/api/projects/${projectId}/landscape/generate`, { method: "POST" }), params(projectId));
    expect(first.status).toBe(202);
    expect(await first.json()).toEqual({ status: "started", sinceSequence: before });
    await vi.waitFor(() => expect(isActive(`landscape:${projectId}`)).toBe(false));
    const failed = await getEventsSince(projectId, before);
    expect(failed.map((event) => event.type)).toEqual(["landscape.competitor.discovery_failed"]);

    expect(tryAcquire(`landscape:${projectId}`)).toBe(true);
    try {
      const second = await generate(new NextRequest(`http://localhost/api/projects/${projectId}/landscape/generate`, { method: "POST" }), params(projectId));
      expect(second.status).toBe(202);
      const body = await second.json();
      expect(body.status).toBe("already_running");
      expect(typeof body.sinceSequence).toBe("number");
      expect((await getLandscape(projectId)).inProgress).toBe(true);
    } finally {
      release(`landscape:${projectId}`);
    }
  });

  it("ends a reused cycle with one landscape.ready event, and restarts a stranded run", async () => {
    blockNetwork();
    const { projectId, versionId } = await setup({ profile: tierBusiness({ brand: "Bake Chain", domain: "bakechain.example", kind: "restaurant_food_beverage", category: "Bakery", physicalPresence: "multi_location", scope: "national", primaryRole: "headquarters", primary: { city: "Newcastle upon Tyne", country: "United Kingdom", countryCode: "GB" } }) });
    await insertTopics(projectId, versionId, ["Pastries", "Coffee", "Breakfast", "Lunch"].map((name) => ({ name, description: "t", evidenceIds: [] })));
    await insertTargetEntity(projectId, "Bake Chain", ["bakechain.example"]);
    const done = await createCompetitorDiscoveryRun(projectId, versionId);
    await updateCompetitorDiscoveryRun(done.id, { status: "completed", metrics: { sourceCandidateCount: 5, policyVersion: COMPETITOR_DISCOVERY_POLICY_VERSION } as never });

    const since = latestSequence(projectId);
    await generateLandscape(projectId, versionId);
    const reused = await getEventsSince(projectId, since);
    expect(reused.map((event) => event.type)).toEqual(["landscape.ready"]);
    expect(reused[0]!.payload).toMatchObject({ reused: true, topicCount: 4 });

    // A run left "running" by a restart holds no job key: it is marked failed and discovery runs again.
    const stranded = await createCompetitorDiscoveryRun(projectId, versionId);
    const sinceStranded = latestSequence(projectId);
    await generateLandscape(projectId, versionId);
    const strandedRow = await getDb().select().from(competitorDiscoveryRuns).where(eq(competitorDiscoveryRuns.id, stranded.id)).get();
    expect(strandedRow).toMatchObject({ status: "failed", error: "stranded" });
    const latest = await getLatestCompetitorDiscoveryRun(projectId);
    expect(latest!.id).not.toBe(stranded.id);
    expect(latest!.status).toBe("completed");
    const types = (await getEventsSince(projectId, sinceStranded)).map((event) => event.type);
    expect(types[0]).toBe("landscape.competitor.discovery_started");
    expect(types.filter((type) => type === "landscape.ready" || type === "landscape.competitor.discovery_failed")).toEqual(["landscape.ready"]);
    expect(isActive(`discovery-run:${latest!.id}`)).toBe(false);
  }, 30_000);
});
