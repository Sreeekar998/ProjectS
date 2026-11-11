import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { BUSINESS_ARCHETYPES, emptyProfile, type BusinessProfile } from "@/lib/profile/schema";
import { INDUSTRY_BY_ID, industryLabel } from "@/lib/profile/taxonomy";
import { createProfileVersion, getLatestProfileVersion } from "@/lib/profile/repository";
import { getProject } from "@/lib/projects/repository";
import { withErrorHandling, jsonError } from "@/lib/http/respond";
import { appendEvent } from "@/lib/events/bus";

// Used when the crawl was blocked (robots disallow, private-address
// rejection, etc.) and no evidence-backed profile could be extracted — spec
// 3.4 requires a supported manual-completion path, never a bypass of the
// confirmation gate itself.
const BodySchema = z.object({
  brandName: z.string().min(1),
  archetype: z.enum(BUSINESS_ARCHETYPES),
  industry: z.string().min(1),
  industryTaxonomyId: z.string().optional(),
  description: z.string().max(600).default(""),
  offerings: z.array(z.string()).default([]),
  brandIdentity: z.array(z.string()).default([]),
  customerJobs: z.array(z.string()).default([]),
  personas: z.array(z.string()).default([]),
  decisionConstraints: z.array(z.string()).default([]),
  countries: z.array(z.string()).default([]),
  regulated: z.boolean().default(false),
  confirmedBy: z.string().default("interview_operator"),
});

export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  return withErrorHandling(async () => {
    const { id: projectId } = await params;
    const project = await getProject(projectId);
    if (!project) return jsonError(404, "project_not_found", `No project with id ${projectId}`);
    const existing = await getLatestProfileVersion(projectId);
    if (existing) return jsonError(409, "profile_already_exists", "A profile already exists; use PATCH to edit it instead.");

    const body = BodySchema.parse(await req.json());
    // A manually completed profile carries no evidence ids by design: the
    // user's own statement is the provenance, and every field is marked
    // `source: "user"` so nothing downstream mistakes it for inference.
    const category = body.industryTaxonomyId ? INDUSTRY_BY_ID.get(body.industryTaxonomyId) : undefined;
    const profile: BusinessProfile = {
      ...emptyProfile(project.registrableDomain),
      identity: {
        brandName: { value: body.brandName, source: "user", evidenceIds: [], confidence: 100 },
        aliases: { values: [], source: "user", evidenceIds: [], confidence: 0 },
        domains: [project.registrableDomain],
        canonicalDomain: project.registrableDomain,
        parentBrand: null,
      },
      description: { value: body.description, source: "user", evidenceIds: [], confidence: body.description ? 100 : 0 },
      archetype: { value: body.archetype, source: "user", evidenceIds: [], confidence: 100, scores: {} },
      industry: {
        value: category ? industryLabel(category.id) : body.industry,
        taxonomyId: category?.id ?? null,
        primary: category?.sector ?? body.industry,
        secondary: category?.category ?? null,
        source: "user",
        evidenceIds: [],
        confidence: 100,
      },
      brandIdentity: body.brandIdentity.map((value) => ({ value, confidence: 100, evidenceIds: [], pageCount: 0, needsCheck: false })),
      offerings: {
        values: body.offerings,
        items: body.offerings.map((name) => ({ name, type: "category" as const, confidence: 100, evidenceIds: [], pageCount: 0 })),
        source: "user",
        evidenceIds: [],
        confidence: body.offerings.length > 0 ? 100 : 0,
      },
      targetAudience: body.personas.map((value) => ({ value, confidence: 100, evidenceIds: [], pageCount: 0 })),
      markets: body.countries.map((name, index) => ({ name, level: "country" as const, countryCode: null, confidence: 100, evidenceIds: [], isPrimary: index === 0 })),
      marketScope: {
        value: body.countries.length > 1 ? ("multi-country" as const) : body.countries.length === 1 ? ("national" as const) : ("unknown" as const),
        source: "user",
        evidenceIds: [],
        confidence: body.countries.length > 0 ? 100 : 0,
      },
      customerJobs: { values: body.customerJobs, source: "user", evidenceIds: [], confidence: 100 },
      personas: { values: body.personas, source: "user", evidenceIds: [], confidence: 100 },
      decisionConstraints: { values: body.decisionConstraints, source: "user", evidenceIds: [], confidence: 100 },
      geography: { countries: body.countries, regions: [], cities: [], serviceAreaDescription: null, languages: [project.language], source: "user", evidenceIds: [] },
      regulatedDomain: { isRegulated: body.regulated, categories: [], source: "user" },
      quality: { overallConfidence: 100, evidenceItemCount: 0, pagesAnalyzed: 0, synthesisMode: "deterministic", warnings: ["Profile entered manually — no website evidence was collected."] },
    };

    const version = await createProfileVersion(projectId, null, profile, {
      confirmed: true,
      confirmedBy: body.confirmedBy,
      status: "complete",
      userEditedFields: ["identity.brandName", "description", "industry", "archetype", "offerings", "targetAudience", "markets", "brandIdentity"],
    });
    appendEvent(projectId, "profile.confirmed", { profileVersionId: version.id, version: version.version, manual: true });
    return NextResponse.json({ profileVersion: version }, { status: 201 });
  });
}
