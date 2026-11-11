import { z } from "zod";
import type { EvidenceChunk } from "@/lib/crawler/repository";
import { availableRoutes, generateStructured } from "@/lib/llm";
import type { CompetitorSourceType, CompetitiveSearchProfile, CompetitorCandidate, CompetitorCandidateSource, WebSearchProvider } from "./competitor-types";
import { planFromSearchProfile } from "./competitor-tiers";
import type { CompetitorTier } from "./tier-types";

const COMPETITIVE_CONTEXT = /\b(vs\.?|versus|compared (?:with|to)|alternative(?:s)? to|switch(?:ing)? from|instead of)\b/i;
const NON_COMPETITIVE_CONTEXT = /\b(partner|integration|integrates with|powered by|payment|supplier|customer|client|investor|certified by|hosted on|built on)\b/i;
const NAME_PATTERNS = [
  /\b(?:vs\.?|versus|compared (?:with|to)|alternative(?:s)? to|switch(?:ing)? from|instead of)\s+([A-Z][A-Za-z0-9&'.-]*(?:\s+[A-Z][A-Za-z0-9&'.-]*){0,3})/g,
  /([A-Z][A-Za-z0-9&'.-]*(?:\s+[A-Z][A-Za-z0-9&'.-]*){0,3})\s+(?:alternative|competitor|comparison)/g,
];
const GENERIC_NAMES = new Set(["our", "other", "the", "them", "competitor", "competitors", "alternative", "alternatives"]);

function nowEvidence(source: CompetitorSourceType, reason: string, evidenceIds: string[] = []) {
  return { source, reason, evidenceIds, discoveredAt: Date.now() } as const;
}

export class WebsiteExplicitCandidateSource implements CompetitorCandidateSource {
  readonly sourceType = "website_explicit" as const;
  constructor(private readonly chunks: EvidenceChunk[]) {}

  async discover(_profile: CompetitiveSearchProfile): Promise<CompetitorCandidate[]> {
    const found = new Map<string, CompetitorCandidate>();
    for (const chunk of this.chunks) {
      const snippets = chunk.text.split(/(?<=[.!?])\s+/).filter((snippet) => COMPETITIVE_CONTEXT.test(snippet) && !NON_COMPETITIVE_CONTEXT.test(snippet));
      for (const snippet of snippets) {
        for (const pattern of NAME_PATTERNS) {
          for (const match of snippet.matchAll(pattern)) {
            const name = match[1]?.trim().replace(/[.,;:]+$/, "");
            if (!name || name.split(" ").length > 4 || GENERIC_NAMES.has(name.toLowerCase())) continue;
            const key = name.toLowerCase().replace(/[^a-z0-9]/g, "");
            if (!key) continue;
            const reason = `Explicit comparison language on the target website: “${snippet.slice(0, 180)}${snippet.length > 180 ? "…" : ""}”`;
            const existing = found.get(key);
            if (existing) {
              existing.confidence = Math.min(90, existing.confidence + 10);
              existing.evidence.push(nowEvidence(this.sourceType, reason, [chunk.id]));
            } else {
              found.set(key, {
                canonicalName: name,
                likelyDomain: null,
                proposedType: "direct",
                entityType: "company",
                reason,
                matchedDimensions: ["explicit comparison"],
                confidence: 62,
                evidence: [nowEvidence(this.sourceType, reason, [chunk.id])],
                aliases: [],
              });
            }
          }
        }
      }
    }
    return [...found.values()].slice(0, 12);
  }
}

const AiCandidateItemSchema = z.object({
  name: z.string().min(1).max(100),
  likelyDomain: z.string().max(180).nullable().optional(),
  proposedType: z.enum(["direct", "substitute", "marketplace", "adjacent"]),
  reason: z.string().min(10).max(500),
  matchedDimensions: z.array(z.string().min(1).max(80)),
  confidence: z.number().min(0).max(100),
  entityType: z.enum(["company", "brand", "sub_brand", "product_line", "local_location"]).default("company"),
  parentName: z.string().nullable().optional(),
  aliases: z.array(z.string()).default([]),
  area: z.string().max(100).nullable().optional(),
  city: z.string().max(100).nullable().optional(),
  country: z.string().max(100).nullable().optional(),
  tier: z.enum(["area", "city", "country"]).nullable().optional().catch(null),
});
// Items are parsed one by one: one malformed item used to fail the whole
// response's zod parse and silently discard every valid hypothesis with it.
const AiCandidateResponseSchema = z.object({ competitors: z.array(z.unknown()) });
type AiCandidateResponse = z.infer<typeof AiCandidateResponseSchema>;
const MAX_PER_TIER = 6;
const MAX_TIERED_TOTAL = 18;

// The wire schema deliberately carries NO array bounds.
//
// Gemini validates responseSchema against the OpenAPI subset and rejects the
// request outright — 400 INVALID_ARGUMENT, no partial result — when two
// sibling arrays both declare `maxItems` inside an outer array that also
// declares one. This schema had exactly that shape, and because the source
// swallows failures so a dead provider cannot end discovery, EVERY run with a
// Gemini key configured silently produced zero AI candidates. The symptom was
// indistinguishable from "the model had no suggestions".
//
// Bounds belong to the Zod parse below, which is the layer that actually
// guarantees them; the wire schema only has to describe the shape. The routed
// LLM layer converts this plain JSON Schema per provider.
const AI_RESPONSE_SCHEMA = {
  type: "object",
  properties: {
    competitors: {
      type: "array",
      items: {
        type: "object",
        properties: {
          name: { type: "string" },
          likelyDomain: { type: ["string", "null"] },
          proposedType: { type: "string", enum: ["direct", "substitute", "marketplace", "adjacent"] },
          reason: { type: "string" },
          matchedDimensions: { type: "array", items: { type: "string" } },
          confidence: { type: "number" },
          entityType: { type: "string", enum: ["company", "brand", "sub_brand", "product_line", "local_location"] },
          parentName: { type: ["string", "null"] },
          aliases: { type: "array", items: { type: "string" } },
          area: { type: ["string", "null"] },
          city: { type: ["string", "null"] },
          country: { type: ["string", "null"] },
          tier: { type: "string", enum: ["area", "city", "country"] },
        },
        required: ["name", "likelyDomain", "proposedType", "reason", "matchedDimensions", "confidence", "entityType", "parentName", "aliases", "area", "city", "country", "tier"],
        additionalProperties: false,
      },
    },
  },
  required: ["competitors"],
  additionalProperties: false,
};

const AI_SYSTEM = `You generate market-entity hypotheses for a competitor intelligence pipeline. Do not confirm competitors. Start with the rivals a typical customer of this business most often weighs for the same purchase: well-known brands belong in the list whenever they genuinely compete for it, while being famous or sharing a broad industry is never a reason on its own. Explore several purchasing-decision angles: same offering/category, same buyer job, same audience/use case, same geography when location matters, substitutes solving the job differently, and marketplaces that shape the decision. Exclude the target itself, its products and sub-brands, suppliers, customers, investors, infrastructure vendors, and ordinary integration partners.

Tiers: the input lists the geographic tiers to cover (area, city, country) with their places. For each tier listed, name up to 6 rivals that compete at that level and set "tier" to it. Area and city rivals must operate in that place (a chain counts through a branch there); give their area and city. Country rivals are chains or brands with reach across the country; give their country. For a neighbourhood business you may know few real rivals — return fewer rather than inventing names. When no tiers are listed, use "country" for every item.

Return fewer candidates when uncertain. Every item must state matched dimensions and a calibrated confidence from 0 to 100. Domains are hypotheses that will be checked against the candidate website; use null when unsure.`;

export class AiHypothesisCandidateSource implements CompetitorCandidateSource {
  readonly sourceType = "ai_hypothesis" as const;

  constructor(private readonly options: { projectId?: string } = {}) {}

  async discover(profile: CompetitiveSearchProfile): Promise<CompetitorCandidate[]> {
    if (availableRoutes("competitors").length === 0) return [];
    const u = profile.understanding;
    const plan = planFromSearchProfile(profile);
    const result = await generateStructured<AiCandidateResponse>({
      stage: "competitors",
      schemaName: "competitor_hypotheses",
      schema: AI_RESPONSE_SCHEMA,
      systemInstruction: AI_SYSTEM,
      userContent: JSON.stringify({
        target: { brand: profile.targetBrand, domain: profile.canonicalDomain, parentBrand: profile.parentBrand },
        market: {
          industry: profile.industry,
          subIndustry: profile.subIndustry,
          businessType: u?.businessType ?? null,
          classificationPath: u?.path ?? [],
          placeBound: u?.placeBound ?? null,
          physicalPresence: u?.physicalPresence ?? null,
          pricePositioning: u?.pricePositioning ?? null,
          archetype: profile.businessArchetype,
          businessModel: profile.businessModel,
        },
        description: u?.description ?? null,
        offerings: u?.offeringGroups.length ? u.offeringGroups : profile.offerings,
        jobsToBeDone: profile.jobsToBeDone,
        audiences: [...(u?.audienceSegments ?? []), ...profile.targetAudiences, ...profile.personas].slice(0, 10),
        topics: profile.importantTopics.map((topic) => topic.discoveryConcept),
        evaluationCriteria: profile.evaluationCriteria,
        geography: profile.geography,
        tiers: plan.tiers.map((spec) => ({ tier: spec.tier, place: spec.place, nearby: spec.tier === "area" ? spec.places.slice(1) : undefined })),
      }),
      temperature: 0.2,
      reasoningEffort: "low",
      maxOutputTokens: 6000,
      projectId: this.options.projectId,
      validate: (data) => {
        const parsed = AiCandidateResponseSchema.safeParse(data);
        return parsed.success ? parsed.data : null;
      },
    });
    if (!result.ok || !result.data) return [];
    const placeBound = u?.placeBound ?? false;
    const planned = new Set<CompetitorTier>(plan.tiers.map((spec) => spec.tier));
    const perTier: Record<string, number> = {};
    const out: CompetitorCandidate[] = [];
    // Bound here rather than on the wire (see AI_RESPONSE_SCHEMA), and prefer
    // truncating a long list to discarding the whole response.
    for (const raw of result.data.competitors) {
      const item = AiCandidateItemSchema.safeParse(raw);
      if (!item.success) continue;
      const candidate = item.data;
      const tier = candidate.tier && planned.has(candidate.tier) ? candidate.tier : null;
      if (planned.size > 0) {
        const bucket = tier ?? "none";
        if ((perTier[bucket] ?? 0) >= MAX_PER_TIER) continue;
        perTier[bucket] = (perTier[bucket] ?? 0) + 1;
        if (out.length >= MAX_TIERED_TOTAL) break;
      } else if (out.length >= 16) break;
      // The schema says "number" and the model is free to read that as a 0-1
      // probability or a 0-100 score; it returns 0.95 as often as 95. Taken
      // literally, a 0.95 became a confidence of 1 and every AI-sourced
      // candidate sorted below every other source. Normalise both readings.
      // A model's memory of neighbourhood and city businesses is the least
      // reliable kind, so local hypotheses are capped lower.
      const localCap = tier ? tier !== "country" : placeBound;
      out.push({
        canonicalName: candidate.name,
        likelyDomain: candidate.likelyDomain ?? null,
        proposedType: candidate.proposedType,
        entityType: candidate.entityType,
        parentName: candidate.parentName ?? null,
        reason: candidate.reason,
        matchedDimensions: candidate.matchedDimensions,
        confidence: Math.min(localCap ? 60 : 80, Math.round(candidate.confidence <= 1 ? candidate.confidence * 100 : candidate.confidence)),
        evidence: [nowEvidence(this.sourceType, candidate.reason)],
        aliases: candidate.aliases,
        location: candidate.area || candidate.city || candidate.country ? { area: candidate.area ?? null, city: candidate.city ?? null, country: candidate.country ?? null } : null,
        ...(tier ? { tierHint: [{ tier, source: this.sourceType }] } : {}),
      });
    }
    return out;
  }
}

// Open-knowledge retrieval moved to ./open-knowledge.ts, which replaced the
// rivalry-sentence scraper with category-neighbourhood retrieval. Re-exported
// here so existing importers keep working.
export { OpenKnowledgeCandidateSource } from "./open-knowledge";

export class AuthorizedSearchCandidateSource implements CompetitorCandidateSource {
  readonly sourceType = "authorized_search" as const;
  constructor(private readonly provider: WebSearchProvider) {}

  async discover(profile: CompetitiveSearchProfile): Promise<CompetitorCandidate[]> {
    if (!this.provider.enabled) return [];
    const category = profile.subIndustry || profile.industry || profile.offerings[0] || "providers";
    const audience = profile.targetAudiences[0] || profile.personas[0];
    const market = profile.geography.cities[0] || profile.geography.countries[0];
    const queries = [
      `${category} providers`,
      `best ${category}${audience ? ` for ${audience}` : ""}`,
      `${profile.targetBrand} alternatives`,
      `${profile.jobsToBeDone[0] || category} solutions${market ? ` in ${market}` : ""}`,
    ];
    const results = (await Promise.all(queries.map((query) => this.provider.search(query, 5)))).flat();
    return results.map((result) => ({
      canonicalName: result.title.split(/[|–—-]/)[0]!.trim(),
      likelyDomain: result.url,
      proposedType: "adjacent",
      entityType: "company",
      reason: result.snippet || `Appeared in authorized search results for ${category}.`,
      matchedDimensions: ["search query", category],
      confidence: 38,
      evidence: [{ source: this.sourceType, reason: result.snippet, evidenceIds: [], discoveredAt: Date.now() }],
      aliases: [],
    }));
  }
}

export const disabledWebSearchProvider: WebSearchProvider = {
  id: "disabled",
  enabled: false,
  async search() {
    return [];
  },
};
