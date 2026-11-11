import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import {
  getLatestProfileVersion,
  createProfileVersion,
  confirmProfileVersion,
} from "@/lib/profile/repository";
import {
  BUSINESS_ARCHETYPES,
  MARKET_LEVELS,
  MARKET_SCOPES,
  OFFERING_TYPES,
  type BusinessProfile,
} from "@/lib/profile/schema";
import { INDUSTRY_BY_ID, industryLabel } from "@/lib/profile/taxonomy";
import { applyClassificationEdit, applyLocationEdit } from "@/lib/understanding/edits";
import { BUSINESS_KINDS, PHYSICAL_PRESENCE } from "@/lib/understanding/kinds";
import { withErrorHandling, jsonError } from "@/lib/http/respond";
import { appendEvent } from "@/lib/events/bus";
import { isActive } from "@/lib/jobs/active";
import type { BusinessProfileVersionRow } from "@/lib/profile/repository";
import { appOrigin } from "@/lib/search-console/config";
import { canonicalizeDomain } from "@/lib/landscape/competitor-entity";

/**
 * `profile.searchConsole` is the operator's private Search Console data (top
 * queries, clicks, countries, pages). A request whose Host isn't this app's own
 * address (a DNS-rebinding page, see appOrigin) gets the version without it; the
 * stored version is untouched.
 */
function visibleVersion<T extends BusinessProfileVersionRow | undefined>(req: NextRequest, version: T): T {
  if (!version || appOrigin(req) !== null || !("searchConsole" in version.profile)) return version;
  const { searchConsole: _searchConsole, ...profile } = version.profile;
  return { ...version, profile };
}

export async function GET(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  return withErrorHandling(async () => {
    const { id } = await params;
    const version = await getLatestProfileVersion(id);
    if (!version) {
      return jsonError(404, "profile_not_found", "No business profile has been generated yet for this project.");
    }
    // A `partial` version with no crawl in progress was stranded by a restart;
    // the page shows "stopped" instead of an endless rail.
    return NextResponse.json({ profileVersion: visibleVersion(req, version), inProgress: isActive(`crawl:${id}`) });
  });
}

const nullableText = z.string().max(120).nullable().optional();

const EditPayloadSchema = z.object({
  brandName: z.string().min(1).max(80).optional(),
  aliases: z.array(z.string().max(80)).max(10).optional(),
  /** Every website of the business. The crawled site stays first; the rest are sites the operator says are also theirs. */
  domains: z.array(z.string().trim().min(3).max(200)).max(6).optional(),
  description: z.string().min(1).max(600).optional(),
  industryTaxonomyId: z.string().optional(),
  industryLabel: z.string().min(1).max(120).optional(),
  archetype: z.enum(BUSINESS_ARCHETYPES).optional(),
  brandIdentity: z.array(z.string().min(1).max(60)).max(8).optional(),
  offerings: z
    .array(
      z.union([
        z.string().min(1).max(80),
        z.object({ name: z.string().min(1).max(80), type: z.enum(OFFERING_TYPES).optional() }),
      ]),
    )
    // A full-service business lists far more than 20 services (a salon's
    // hair, nail, lash and barber menus came to 28), and the cap rejected the
    // whole save.
    .max(40)
    .optional(),
  targetAudience: z.array(z.string().min(1).max(80)).max(8).optional(),
  markets: z
    .array(
      z.union([
        z.string().min(1).max(80),
        z.object({ name: z.string().min(1).max(80), level: z.enum(MARKET_LEVELS).optional() }),
      ]),
    )
    .max(12)
    .optional(),
  marketScope: z.enum(MARKET_SCOPES).optional(),
  /** "What kind of business is this?" correction (see understanding/edits.ts). */
  classification: z
    .object({
      businessType: z.string().trim().min(1).max(120),
      industry: z.string().trim().max(120).optional(),
      subIndustry: z.string().trim().max(120).nullable().optional(),
      kind: z.enum(BUSINESS_KINDS).optional(),
      physicalPresence: z.enum(PHYSICAL_PRESENCE).optional(),
    })
    .optional(),
  /** "Where is it?" correction; the scope and market mirrors follow from it. */
  location: z
    .object({
      primary: z.object({
        premise: nullableText,
        street: nullableText,
        neighborhood: nullableText,
        district: nullableText,
        city: nullableText,
        region: nullableText,
        country: nullableText,
        countryCode: nullableText,
        postalCode: nullableText,
        formattedAddress: z.string().max(300).nullable().optional(),
        provider: nullableText,
        providerId: z.string().max(300).nullable().optional(),
        lat: z.number().min(-90).max(90).nullable().optional(),
        lng: z.number().min(-180).max(180).nullable().optional(),
      }),
      marketScope: z.enum(MARKET_SCOPES).optional(),
      nearbyAreas: z.array(z.string().trim().min(1).max(120)).max(10).optional(),
      countriesServed: z.array(z.string().trim().min(1).max(120)).max(30).optional(),
      marketArea: z.object({ level: z.enum(["neighborhood", "district", "city", "region", "country"]), name: z.string().trim().min(1).max(120) }).nullable().optional(),
    })
    .optional(),
});

type EditPayload = z.infer<typeof EditPayloadSchema>;

const PatchSchema = z.object({
  action: z.enum(["confirm", "edit"]),
  edits: EditPayloadSchema.optional(),
  /** When true on an "edit", the new version is also marked confirmed. */
  confirm: z.boolean().default(false),
  confirmedBy: z.string().default("interview_operator"),
});

/**
 * A user edit replaces both the value and its provenance: the field becomes
 * `source: "user"` with no evidence ids, because the user's correction is the
 * evidence. The edited paths are recorded on the version so a later re-analysis
 * can preserve them (see profile/merge.ts).
 */
function applyEdits(base: BusinessProfile, edits: EditPayload): { profile: BusinessProfile; editedPaths: string[] } {
  let next = structuredClone(base);
  const editedPaths: string[] = [];

  if (edits.brandName !== undefined) {
    next.identity.brandName = { value: edits.brandName, source: "user", evidenceIds: [], confidence: 100 };
    editedPaths.push("identity.brandName");
  }
  if (edits.aliases !== undefined) {
    next.identity.aliases = { values: edits.aliases, source: "user", evidenceIds: [], confidence: 100 };
    editedPaths.push("identity.aliases");
  }
  if (edits.domains !== undefined) {
    // A business can run more than one site (a salon's booking site and its
    // older marketing site). Citations of every one of them are the
    // business's own; the crawled site always stays first.
    const hosts = edits.domains.map((value) => canonicalizeDomain(value)).filter((host): host is string => Boolean(host && host.includes(".")));
    const own = canonicalizeDomain(base.identity.domains[0]);
    next.identity.domains = [...new Set([...(own ? [own] : []), ...hosts])].slice(0, 6);
    editedPaths.push("identity.domains");
  }
  if (edits.description !== undefined) {
    next.description = { value: edits.description, source: "user", evidenceIds: [], confidence: 100 };
    editedPaths.push("description");
  }
  if (edits.industryTaxonomyId !== undefined || edits.industryLabel !== undefined) {
    const category = edits.industryTaxonomyId ? INDUSTRY_BY_ID.get(edits.industryTaxonomyId) : undefined;
    next.industry = {
      value: category ? industryLabel(category.id) : (edits.industryLabel ?? next.industry.value),
      taxonomyId: category?.id ?? (edits.industryTaxonomyId ? null : next.industry.taxonomyId),
      primary: category?.sector ?? next.industry.primary,
      secondary: category?.category ?? next.industry.secondary,
      source: "user",
      evidenceIds: [],
      confidence: 100,
    };
    editedPaths.push("industry");
  }
  if (edits.archetype !== undefined) {
    next.archetype = { ...next.archetype, value: edits.archetype, source: "user", evidenceIds: [], confidence: 100 };
    editedPaths.push("archetype");
  }
  if (edits.brandIdentity !== undefined) {
    next.brandIdentity = edits.brandIdentity.map((value) => ({
      value,
      confidence: 100,
      evidenceIds: [],
      pageCount: 0,
      needsCheck: false,
    }));
    editedPaths.push("brandIdentity");
  }
  if (edits.offerings !== undefined) {
    const items = edits.offerings.map((entry) => {
      const name = typeof entry === "string" ? entry : entry.name;
      const type = typeof entry === "string" ? undefined : entry.type;
      const previous = base.offerings.items.find((o) => o.name.toLowerCase() === name.toLowerCase());
      return { name, type: type ?? previous?.type ?? ("category" as const), confidence: 100, evidenceIds: [], pageCount: previous?.pageCount ?? 0 };
    });
    // Keep the site's grouping for the items that survived the edit, so a
    // one-chip correction does not flatten "Hair / Nails / Barber" menus.
    const kept = new Set(items.map((i) => i.name.toLowerCase()));
    const groups = base.offerings.groups
      ?.map((group) => ({ name: group.name, items: group.items.filter((item) => kept.has(item.toLowerCase())) }))
      .filter((group) => group.items.length > 0);
    next.offerings = {
      values: items.map((i) => i.name),
      items,
      ...(groups && groups.length > 0 ? { groups } : {}),
      source: "user",
      evidenceIds: [],
      confidence: 100,
    };
    editedPaths.push("offerings");
  }
  if (edits.targetAudience !== undefined) {
    next.targetAudience = edits.targetAudience.map((value) => ({ value, confidence: 100, evidenceIds: [], pageCount: 0 }));
    next.personas = { values: edits.targetAudience, source: "user", evidenceIds: [], confidence: 100 };
    // Segments are the richer view of the same list: keep the ones whose label
    // the operator kept, and add the new ones without an invented description.
    if (base.audienceSegments) {
      next.audienceSegments = edits.targetAudience.map(
        (label) =>
          base.audienceSegments!.find((segment) => segment.label.toLowerCase() === label.toLowerCase()) ?? {
            label,
            description: "",
            geoRelation: "unknown",
            evidenceIds: [],
            confidence: 100,
          },
      );
    }
    editedPaths.push("targetAudience");
  }
  if (edits.markets !== undefined) {
    const markets = edits.markets.map((entry, index) => {
      const name = typeof entry === "string" ? entry : entry.name;
      const level = typeof entry === "string" ? undefined : entry.level;
      const previous = base.markets.find((m) => m.name.toLowerCase() === name.toLowerCase());
      return {
        name,
        level: level ?? previous?.level ?? ("country" as const),
        countryCode: previous?.countryCode ?? null,
        confidence: 100,
        evidenceIds: [],
        isPrimary: index === 0,
      };
    });
    next.markets = markets;
    next.geography = {
      ...next.geography,
      countries: markets.filter((m) => m.level === "country").map((m) => m.name),
      regions: markets.filter((m) => m.level === "region").map((m) => m.name),
      cities: markets.filter((m) => m.level === "city").map((m) => m.name),
      source: "user",
      evidenceIds: [],
    };
    editedPaths.push("markets");
  }
  if (edits.marketScope !== undefined) {
    next.marketScope = { value: edits.marketScope, source: "user", evidenceIds: [], confidence: 100 };
    if (!editedPaths.includes("markets")) editedPaths.push("markets");
  }
  // Classification first: the location edit derives the market scope from the
  // (possibly corrected) business kind and physical presence.
  if (edits.classification !== undefined) {
    next = applyClassificationEdit(next, edits.classification);
    editedPaths.push("classification", "industry", "archetype");
  }
  if (edits.location !== undefined) {
    next = applyLocationEdit(next, edits.location);
    editedPaths.push("location", "markets", "marketScope");
  }

  return { profile: next, editedPaths: [...new Set(editedPaths)] };
}

export async function PATCH(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  return withErrorHandling(async () => {
    const { id: projectId } = await params;
    const body = PatchSchema.parse(await req.json());
    const current = await getLatestProfileVersion(projectId);
    if (!current) {
      return jsonError(404, "profile_not_found", "No business profile has been generated yet for this project.");
    }

    if (body.action === "confirm") {
      if (current.status === "partial") {
        return jsonError(409, "profile_incomplete", "Analysis is still running. Wait for it to finish before confirming.");
      }
      await confirmProfileVersion(current.id, body.confirmedBy);
      appendEvent(projectId, "profile.confirmed", { profileVersionId: current.id, version: current.version });
      const confirmed = await getLatestProfileVersion(projectId);
      return NextResponse.json({ profileVersion: visibleVersion(req, confirmed) });
    }

    const baseProfile = current.profile as unknown as BusinessProfile;
    const { profile, editedPaths } = applyEdits(baseProfile, body.edits ?? {});
    if (editedPaths.length === 0) {
      return jsonError(400, "no_edits", "No editable fields were supplied.");
    }

    // Edits are versioned rather than applied in place, so the inferred
    // profile and the user's corrections both remain inspectable.
    const previouslyEdited = current.userEditedFields ?? [];
    const newVersion = await createProfileVersion(projectId, current.crawlRunId, profile, {
      confirmed: body.confirm,
      confirmedBy: body.confirmedBy,
      status: "complete",
      synthesisMode: (current.synthesisMode as "deterministic" | "llm_grounded" | null) ?? profile.quality.synthesisMode,
      userEditedFields: [...new Set([...previouslyEdited, ...editedPaths])],
    });
    appendEvent(projectId, "profile.edited", {
      profileVersionId: newVersion.id,
      version: newVersion.version,
      fields: editedPaths,
    });
    if (body.confirm) {
      appendEvent(projectId, "profile.confirmed", { profileVersionId: newVersion.id, version: newVersion.version, edited: true });
    }
    return NextResponse.json({ profileVersion: visibleVersion(req, newVersion) });
  });
}
