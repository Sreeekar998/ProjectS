import { afterEach, describe, expect, it, vi } from "vitest";

// Keyless by default, exactly like the test environment; the AI-source and
// screening tests switch a fake route on and capture what the model is sent.
vi.mock("@/lib/llm", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/llm")>();
  return { ...actual, availableRoutes: vi.fn(() => []), generateStructured: vi.fn() };
});

import { availableRoutes, generateStructured } from "@/lib/llm";
import { discoverCompetitors } from "@/lib/landscape/competitors";
import { AiHypothesisCandidateSource, OpenKnowledgeCandidateSource } from "@/lib/landscape/competitor-sources";
import { screenCandidates } from "@/lib/landscape/competitor-screening";
import { createTargetKnowledgeMemo } from "@/lib/landscape/open-knowledge";
import { buildCompetitiveSearchProfile } from "@/lib/landscape/search-profile";
import { emptyBrandReach, planCompetitorTiers } from "@/lib/landscape/competitor-tiers";
import type { CompetitiveSearchProfile, CompetitorCandidateSource } from "@/lib/landscape/competitor-types";
import type { BrandReach, CompetitorTierPlan } from "@/lib/landscape/tier-types";
import type { Topic } from "@/lib/landscape/repository";
import { makeProfile } from "../../helpers/profile-fixtures";
import { rival, tierBusiness } from "../../helpers/tier-fixtures";

const topic = {
  id: "topic-1",
  projectId: "project-1",
  businessProfileVersionId: "profile-1",
  name: "Workflow automation",
  discoveryConcept: "workflow automation",
  description: "Confirmed topic",
  priority: 0,
  status: "confirmed",
  source: "system",
  evidenceIds: [],
  createdAt: new Date(),
} as Topic;

const candidate = {
  canonicalName: "Flow Rival Ltd",
  likelyDomain: "flow-rival.example",
  proposedType: "direct" as const,
  entityType: "company" as const,
  reason: "Competes for workflow automation buyers.",
  matchedDimensions: ["workflow automation", "operations teams"],
  confidence: 78,
  evidence: [{ source: "ai_hypothesis" as const, reason: "Structured market hypothesis.", evidenceIds: [], discoveredAt: 1 }],
  aliases: [],
};

describe("progressive competitor discovery service", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.mocked(availableRoutes).mockReturnValue([]);
    vi.mocked(generateStructured).mockReset();
  });

  // The previous implementation required a prose sentence asserting rivalry,
  // which on the Nike article exists in exactly one paragraph — the historical
  // Reebok market-share passage — so it returned Reebok and nothing else.
  // Retrieval is now classification and category based, and these tests pin
  // that: no rivalry text anywhere in the fixtures, yet the neighbourhood
  // still comes back.
  const searchProfile = {
    targetBrand: "Nike",
    aliases: [],
    canonicalDomain: "nike.example",
    parentBrand: null,
    industry: "Retail apparel",
    subIndustry: null,
    businessArchetype: "ecommerce_dtc_retail" as const,
    businessModel: "B2C" as const,
    offerings: ["running shoes"],
    jobsToBeDone: [],
    useCases: [],
    targetAudiences: [],
    personas: [],
    importantTopics: [],
    evaluationCriteria: [],
    geography: { scope: "global", cities: [], regions: [], countries: [], locale: "en" },
    evidenceIds: [],
  };

  // The open-knowledge source speaks two APIs: Wikipedia's action API at
  // formatversion 2 (pages are an ARRAY) and the Wikidata Query Service.
  // The stub mirrors both exactly, so a change in the response contract
  // fails here rather than silently returning an empty market.
  function stubOpenKnowledge(options: {
    categories: string[];
    members: Record<string, string[]>;
    facts?: Record<string, { qid: string; types?: string[]; website?: string | null; sitelinks?: number; owners?: string[]; countries?: string[] }>;
    morelike?: string[];
  }) {
    const facts = options.facts ?? {
      Adidas: { qid: "Q10", types: ["public company"], website: "https://www.adidas.com/", sitelinks: 120 },
      "Obscure Shoe Co": { qid: "Q11", types: ["business"], website: "https://obscure.example/", sitelinks: 1 },
      "Some Unrelated Firm": { qid: "Q12", types: ["business"], website: "https://unrelated.example/", sitelinks: 2 },
      "Nike Air Yeezy": { qid: "Q13", types: ["shoe model"], website: "https://www.nike.example/yeezy", sitelinks: 4 },
      "Nike Flywire": { qid: "Q14", types: ["product"], website: "https://www.nike.example/flywire", sitelinks: 2 },
    };
    const qidToTitle = new Map(Object.entries(facts).map(([title, fact]) => [fact.qid, title]));

    const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
      const url = new URL(String(input));
      const action = url.searchParams.get("action");
      const list = url.searchParams.get("list");
      const prop = url.searchParams.get("prop");

      if (url.hostname === "query.wikidata.org") {
        const query = url.searchParams.get("query") ?? "";
        // Sibling brands under a shared corporate parent.
        if (query.includes("?sibling")) return { ok: true, json: async () => ({ results: { bindings: [] } }) };
        // English Wikipedia sitelink for the resolved entity.
        if (query.includes("schema:isPartOf")) {
          return { ok: true, json: async () => ({ results: { bindings: [{ article: { value: "https://en.wikipedia.org/wiki/Nike,_Inc." } }] } }) };
        }
        // Batched facts for candidates: P31 types, website, sitelinks, owners.
        if (query.includes("?sitelink schema:about")) {
          const bindings = [...query.matchAll(/wd:(Q\d+)/g)]
            .map((match) => match[1]!)
            .filter((qid) => qidToTitle.has(qid))
            .map((qid) => {
              const fact = facts[qidToTitle.get(qid)!]!;
              return {
                item: { value: `http://www.wikidata.org/entity/${qid}` },
                types: { value: (fact.types ?? []).join("|") },
                ...(fact.website ? { website: { value: fact.website } } : {}),
                sitelinks: { value: String(fact.sitelinks ?? 0) },
                owners: { value: (fact.owners ?? []).join("|") },
                countries: { value: (fact.countries ?? []).join("|") },
              };
            });
          return { ok: true, json: async () => ({ results: { bindings } }) };
        }
        // Identity resolution by official website (P856).
        if (query.includes("wdt:P856 ?site")) {
          return {
            ok: true,
            json: async () => ({
              results: {
                bindings: [
                  {
                    item: { value: "http://www.wikidata.org/entity/Q1" },
                    itemLabel: { value: "Nike" },
                    itemDescription: { value: "American athletic equipment company" },
                    site: { value: "https://www.nike.example/" },
                  },
                ],
              },
            }),
          };
        }
        return { ok: true, json: async () => ({ results: { bindings: [] } }) };
      }

      if (url.hostname !== "en.wikipedia.org") return { ok: false, json: async () => ({}) };

      if (list === "search") {
        const search = url.searchParams.get("srsearch") ?? "";
        if (search.startsWith("morelike:")) {
          return { ok: true, json: async () => ({ query: { search: (options.morelike ?? []).map((title) => ({ title })) } }) };
        }
        return { ok: true, json: async () => ({ query: { search: [{ title: "Nike, Inc." }] } }) };
      }
      if (prop === "pageprops") {
        const titles = (url.searchParams.get("titles") ?? "").split("|");
        return {
          ok: true,
          json: async () => ({
            query: { pages: titles.filter((title) => facts[title]).map((title) => ({ title, pageprops: { wikibase_item: facts[title]!.qid } })) },
          }),
        };
      }
      if (prop === "categories") {
        const titles = (url.searchParams.get("titles") ?? "").split("|");
        return {
          ok: true,
          json: async () => ({
            query: {
              pages: titles.map((title) => ({
                title,
                // The target carries the signature; every candidate is filed
                // under whichever categories list it as a member.
                categories: (title === "Nike, Inc."
                  ? options.categories
                  : Object.entries(options.members).filter(([, members]) => members.includes(title)).map(([category]) => category)
                ).map((category) => ({ title: category })),
              })),
            },
          }),
        };
      }
      if (prop === "categoryinfo") {
        const titles = (url.searchParams.get("titles") ?? "").split("|");
        return {
          ok: true,
          json: async () => ({
            query: { pages: titles.map((title) => ({ title, categoryinfo: { pages: options.members[title]?.length ?? 0, subcats: 0 } })) },
          }),
        };
      }
      if (list === "categorymembers") {
        if (url.searchParams.get("cmtype") === "subcat") return { ok: true, json: async () => ({ query: { categorymembers: [] } }) };
        const title = url.searchParams.get("cmtitle") ?? "";
        const members = options.members[title] ?? [];
        return { ok: true, json: async () => ({ query: { categorymembers: members.map((page) => ({ title: page, ns: 0 })) } }) };
      }
      if (action === "query") return { ok: true, json: async () => ({ query: {} }) };
      return { ok: false, json: async () => ({}) };
    });
    vi.stubGlobal("fetch", fetchMock);
    return fetchMock;
  }

  it("retrieves the market neighbourhood from shared categories, with no rivalry text anywhere", async () => {
    stubOpenKnowledge({
      categories: ["Category:Athletic shoe brands", "Category:1964 establishments in Oregon"],
      members: { "Category:Athletic shoe brands": ["Nike, Inc.", "Adidas", "Obscure Shoe Co"] },
    });

    const candidates = await new OpenKnowledgeCandidateSource().discover(searchProfile);
    const names = candidates.map((candidate) => candidate.canonicalName);

    expect(names).toContain("Adidas");
    // More than one useful candidate is the whole point of the change.
    expect(candidates.length).toBeGreaterThan(1);
    expect(candidates.every((candidate) => candidate.evidence.every((item) => item.source === "open_knowledge"))).toBe(true);
  });

  it("ignores categories that describe founding year or geography rather than market", async () => {
    stubOpenKnowledge({
      categories: ["Category:1964 establishments in Oregon", "Category:Companies listed on the New York Stock Exchange"],
      members: { "Category:1964 establishments in Oregon": ["Some Unrelated Firm"] },
    });

    const candidates = await new OpenKnowledgeCandidateSource().discover(searchProfile);
    expect(candidates.map((candidate) => candidate.canonicalName)).not.toContain("Some Unrelated Firm");
  });

  it("never proposes the target's own sub-brands as competitors", async () => {
    stubOpenKnowledge({
      categories: ["Category:Athletic shoe brands"],
      members: { "Category:Athletic shoe brands": ["Nike Air Yeezy", "Nike Flywire", "Adidas"] },
    });

    const candidates = await new OpenKnowledgeCandidateSource().discover(searchProfile);
    const names = candidates.map((candidate) => candidate.canonicalName);
    expect(names.some((name) => /nike/i.test(name))).toBe(false);
    expect(names).toContain("Adidas");
  });

  it("returns an empty list rather than throwing when the knowledge endpoints fail", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => ({ ok: false, json: async () => ({}) })));
    await expect(new OpenKnowledgeCandidateSource().discover(searchProfile)).resolves.toEqual([]);
  });

  it("fans out sources, resolves duplicate entities, verifies websites, and emits progressive events", async () => {
    const profile = makeProfile({ brandName: "Flow Target", archetype: "b2b_saas_enterprise", industry: "workflow automation", offerings: ["workflow automation"], domain: "flow-target.example" });
    const sources: CompetitorCandidateSource[] = [
      { sourceType: "ai_hypothesis", async discover() { return [candidate]; } },
      { sourceType: "website_explicit", async discover() { return [{ ...candidate, canonicalName: "flow rival", evidence: [{ source: "website_explicit", reason: "Comparison page.", evidenceIds: ["ev-1"], discoveredAt: 2 }] }]; } },
    ];
    const events: string[] = [];
    const result = await discoverCompetitors(profile, [topic], [], {
      sources,
      verify: async () => ({
        displayName: "Flow Rival",
        canonicalDomain: "flow-rival.example",
        finalUrl: "https://flow-rival.example/",
        title: "Flow Rival workflow automation",
        description: "Approval workflow automation for operations teams",
        offerings: ["workflow automation"],
        audienceSignals: ["operations teams"],
        jobSignals: ["automate approval workflows"],
        useCaseSignals: ["workflow automation"],
        categorySignals: ["workflow automation"],
        geographySignals: [],
        contentTokens: ["workflow", "automation", "operations"],
        pagesFetched: ["/", "/product"],
        verificationStatus: "verified",
        verificationSummary: "Verified fixture.",
      }),
      onEvent: (event) => { events.push(event.type); },
    });
    expect(result.candidates).toHaveLength(1);
    expect(result.candidates[0]!.evidence).toHaveLength(2);
    expect(result.candidates[0]!.verificationStatus).toBe("verified");
    expect(events[0]).toBe("started");
    expect(events).toContain("candidate_found");
    expect(events).toContain("verifying");
    expect(events).toContain("suggestion_ready");
    expect(events.at(-1)).toBe("completed");
  });

  it("keeps successful source results when another source fails", async () => {
    const profile = makeProfile({ brandName: "Flow Target", archetype: "b2b_saas_enterprise", industry: "workflow automation", offerings: ["workflow automation"], domain: "flow-target.example" });
    const sources: CompetitorCandidateSource[] = [
      { sourceType: "ai_hypothesis", async discover() { throw new Error("fixture timeout"); } },
      { sourceType: "website_explicit", async discover() { return [{ ...candidate, likelyDomain: null, evidence: [{ source: "website_explicit", reason: "Comparison page.", evidenceIds: ["ev-1"], discoveredAt: 2 }] }]; } },
    ];
    const result = await discoverCompetitors(profile, [topic], [], { sources });
    expect(result.candidates).toHaveLength(1);
    expect(result.metrics.sourceCandidateCount).toBe(1);
  });
});

describe("competitor tiers in the discovery sources", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.mocked(availableRoutes).mockReturnValue([]);
    vi.mocked(generateStructured).mockReset();
  });

  const KNOWN: BrandReach = { known: true, points: 6, signals: [], checkedOpenKnowledge: true };

  function salon() {
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

  function tiered(reach: BrandReach = emptyBrandReach()): { target: CompetitiveSearchProfile; plan: CompetitorTierPlan } {
    const profile = salon();
    const target = buildCompetitiveSearchProfile(profile, []);
    const plan = planCompetitorTiers(profile, target, reach);
    target.tiers = plan;
    return { target, plan };
  }

  // Minimal Wikimedia stub for a known local brand whose category neighbours
  // sit in two countries. Counts the official-website lookups.
  function stubKnowledge() {
    const facts: Record<string, { qid: string; site: string; countries: string }> = {
      "Maison Nine": { qid: "Q1", site: "https://maisonnine.example/", countries: "AE" },
      // Listed in two countries, foreign first: its location must be the plan's country.
      "Local Rival": { qid: "Q20", site: "https://local-rival.example/", countries: "US|AE" },
      "Foreign Rival": { qid: "Q21", site: "https://foreign-rival.example/", countries: "FR" },
    };
    const byQid = new Map(Object.entries(facts).map(([title, fact]) => [fact.qid, title]));
    const counts = { byWebsite: 0 };
    vi.stubGlobal("fetch", vi.fn(async (input: RequestInfo | URL) => {
      const url = new URL(String(input));
      const json = (body: unknown) => ({ ok: true, status: 200, json: async () => body });
      if (url.hostname === "query.wikidata.org") {
        const query = url.searchParams.get("query") ?? "";
        if (query.includes("?sibling")) return json({ results: { bindings: [] } });
        if (query.includes("schema:isPartOf")) return json({ results: { bindings: [{ article: { value: "https://en.wikipedia.org/wiki/Maison_Nine" } }] } });
        if (query.includes("?sitelink schema:about")) {
          const bindings = [...query.matchAll(/wd:(Q\d+)/g)].map((m) => m[1]!).filter((qid) => byQid.has(qid)).map((qid) => {
            const fact = facts[byQid.get(qid)!]!;
            return { item: { value: `http://www.wikidata.org/entity/${qid}` }, types: { value: "business" }, website: { value: fact.site }, sitelinks: { value: "12" }, owners: { value: "" }, countries: { value: fact.countries } };
          });
          return json({ results: { bindings } });
        }
        if (query.includes("wdt:P856 ?site") && query.includes("VALUES ?site")) {
          counts.byWebsite += 1;
          return json({ results: { bindings: [{ item: { value: "http://www.wikidata.org/entity/Q1" }, itemLabel: { value: "Maison Nine" }, itemDescription: { value: "salon business" }, site: { value: "https://maisonnine.example/" } }] } });
        }
        return json({ results: { bindings: [] } });
      }
      const prop = url.searchParams.get("prop");
      const list = url.searchParams.get("list");
      if (list === "search") return json({ query: { search: [] } });
      if (prop === "pageprops") {
        const titles = (url.searchParams.get("titles") ?? "").split("|");
        return json({ query: { pages: titles.filter((t) => facts[t]).map((t) => ({ title: t, pageprops: { wikibase_item: facts[t]!.qid } })) } });
      }
      if (prop === "categories") {
        const titles = (url.searchParams.get("titles") ?? "").split("|");
        return json({ query: { pages: titles.map((title) => ({ title, categories: [{ title: "Category:Hair salon companies" }] })) } });
      }
      if (prop === "categoryinfo") return json({ query: { pages: [{ title: "x", categoryinfo: { pages: 3, subcats: 0 } }] } });
      if (list === "categorymembers") {
        if (url.searchParams.get("cmtype") === "subcat") return json({ query: { categorymembers: [] } });
        return json({ query: { categorymembers: ["Maison Nine", "Local Rival", "Foreign Rival"].map((title) => ({ title, ns: 0 })) } });
      }
      return json({ query: {} });
    }));
    return counts;
  }

  it("drops a foreign-country open-knowledge candidate for a known local brand, and keeps it for a global plan", async () => {
    stubKnowledge();
    const { target } = tiered(KNOWN);
    const local = await new OpenKnowledgeCandidateSource().discover(target);
    expect(local.map((c) => c.canonicalName)).toEqual(["Local Rival"]);
    expect(local[0]!.location?.country).toBe("United Arab Emirates");
    expect(local[0]!.tierHint).toEqual([{ tier: "country", source: "open_knowledge" }]);

    stubKnowledge();
    const global: CompetitiveSearchProfile = { ...target, geography: { ...target.geography, scope: "global" }, tiers: undefined, understanding: { ...target.understanding!, placeBound: false, physicalPresence: "online_only" } };
    const names = (await new OpenKnowledgeCandidateSource().discover(global)).map((c) => c.canonicalName).sort();
    expect(names).toEqual(["Foreign Rival", "Local Rival"]);
  }, 60_000);

  it("does not run for a plan without a country tier", async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
    const { target } = tiered();
    expect(await new OpenKnowledgeCandidateSource().discover(target)).toEqual([]);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("resolves the target's entity once per run for the brand check and the source together", async () => {
    const counts = stubKnowledge();
    const knowledge = createTargetKnowledgeMemo();
    const profile = salon();
    let plan: CompetitorTierPlan | undefined;
    await discoverCompetitors(profile, [], [], {
      targetKnowledge: knowledge,
      sources: [new OpenKnowledgeCandidateSource({ knowledge })],
      // The lookup can only add a country tier; keep it from deciding here.
      onEvent: (event) => {
        if (event.type === "started") plan = event.profile.tiers;
      },
    });
    expect(plan?.brandReach.checkedOpenKnowledge).toBe(true);
    expect(counts.byWebsite).toBe(1);
    await knowledge.resolve("maisonnine.example");
    expect(counts.byWebsite).toBe(1);
  }, 60_000);

  it("keeps the valid items when one AI hypothesis is malformed, carries tier hints and caps local confidence", async () => {
    vi.mocked(availableRoutes).mockReturnValue([{ provider: "gemini", model: "fake" }] as never);
    const item = (name: string, tier: string, confidence: number) => ({ name, likelyDomain: null, proposedType: "direct", reason: "Competes for the same customers.", matchedDimensions: ["hair"], confidence, entityType: "company", parentName: null, aliases: [], area: null, city: "Dubai", country: null, tier });
    vi.mocked(generateStructured).mockImplementation(async (request) => {
      const raw = { competitors: [item("Salon One", "area", 95), { name: 42 }, item("Chain Two", "country", 0.9), item("Salon Three", "city", 70)] };
      return { ok: true, data: request.validate ? request.validate(raw) : raw, provider: "gemini", model: "fake", latencyMs: 1, attempts: [] } as never;
    });
    const { target } = tiered(KNOWN);
    const found = await new AiHypothesisCandidateSource().discover(target);
    expect(found.map((c) => c.canonicalName)).toEqual(["Salon One", "Chain Two", "Salon Three"]);
    expect(found.map((c) => c.tierHint?.[0]?.tier)).toEqual(["area", "country", "city"]);
    expect(found.map((c) => c.confidence)).toEqual([60, 80, 60]);
  });

  it("never puts the business's name or places in the AI or screening system instructions", async () => {
    vi.mocked(availableRoutes).mockReturnValue([{ provider: "gemini", model: "fake" }] as never);
    vi.mocked(generateStructured).mockResolvedValue({ ok: false, error: "fake", provider: "none", model: "", latencyMs: 0, attempts: [] } as never);
    const { target } = tiered(KNOWN);
    await new AiHypothesisCandidateSource().discover(target);
    await screenCandidates(target, [rival("Salon Gamma", { location: { area: "DIFC", city: "Dubai", country: null } })]);
    const calls = vi.mocked(generateStructured).mock.calls.map(([request]) => request);
    expect(calls.map((request) => request.schemaName)).toEqual(["competitor_hypotheses", "competitor_screening"]);
    for (const request of calls) {
      for (const forbidden of ["Maison Nine", "maisonnine", "DIFC", "Dubai", "Business Bay", "United Arab Emirates"]) {
        expect(request.systemInstruction).not.toContain(forbidden);
      }
      // The tiers travel as user content.
      expect(request.userContent).toContain("\"tier\":\"area\",\"place\":\"DIFC\"");
    }
  });

  it("does not reject an out-of-city chain screened as a country-tier rival when the plan has a country tier", async () => {
    const chain = rival("Chain Salons", { likelyDomain: "chainsalons.example", location: { area: null, city: "Abu Dhabi", country: "United Arab Emirates" }, structuralAffinity: 70 });
    const screen = async (_profile: CompetitiveSearchProfile, candidates: typeof chain[]) => candidates.map((candidate) => ({ ...candidate, screening: { keep: true, relevance: 75, reason: "A chain across the country.", tier: "country" as const } }));
    const withCountry = await discoverCompetitors(salon(), [], [], { sources: [{ sourceType: "web_search", discover: async () => [chain] }], tierPlan: tiered(KNOWN).plan, screen, verify: async () => null });
    expect(withCountry.candidates[0]!.rejectionReason).toBeNull();
    expect(withCountry.candidates[0]!.tier).toMatchObject({ tier: "country", basis: "country_footprint" });
    const localOnly = await discoverCompetitors(salon(), [], [], { sources: [{ sourceType: "web_search", discover: async () => [chain] }], tierPlan: tiered().plan, screen, verify: async () => null });
    expect(localOnly.candidates[0]!.rejectionReason).toMatch(/Abu Dhabi/);
  });

  it("emits started → … → completed with the plan attached and counts suggestions by tier", async () => {
    const events: string[] = [];
    let startedTiers: string[] = [];
    const result = await discoverCompetitors(salon(), [], [], {
      tierPlan: tiered(KNOWN).plan,
      sources: [{
        sourceType: "web_search",
        discover: async () => [
          rival("Next Door", { location: { area: null, city: null, country: null, distanceMeters: 400 }, structuralAffinity: 70 }),
          rival("Across Town", { location: { area: "Jumeirah", city: "Dubai", country: null }, structuralAffinity: 70 }),
          rival("Elsewhere", { location: { area: null, city: "Abu Dhabi", country: null }, structuralAffinity: 70 }),
        ],
      }],
      verify: async () => null,
      onEvent: (event) => {
        events.push(event.type);
        if (event.type === "started") startedTiers = event.profile.tiers!.tiers.map((spec) => spec.tier);
      },
    });
    expect(events[0]).toBe("started");
    expect(events.at(-1)).toBe("completed");
    expect(startedTiers).toEqual(["area", "city", "country"]);
    expect(result.metrics.suggestedByTier).toEqual({ area: 1, city: 1, country: 0 });
    expect(result.candidates.find((c) => c.canonicalName === "Elsewhere")!.rejectionReason).toMatch(/Abu Dhabi/);
  });
});
