import { describe, it, expect } from "vitest";
import { brandCoreWord, buildForbiddenBrandTerms, scanForBrandLeakage, validateCandidate } from "@/lib/prompts/validators";
import { applyClassificationEdit } from "@/lib/understanding/edits";
import type { BusinessProfile } from "@/lib/profile/schema";
import type { CandidatePromptDraft } from "@/lib/prompts/types";
import { makeProfile } from "../../helpers/profile-fixtures";

function baseProfile(overrides: Partial<BusinessProfile> = {}): BusinessProfile {
  return {
    ...makeProfile({
      brandName: "Acme Running Co",
      archetype: "ecommerce_dtc_retail",
      industry: "running shoes",
      offerings: ["running shoes"],
      countries: ["United States"],
      domain: "acmerunning.com",
    }),
    identity: {
      brandName: { value: "Acme Running Co", source: "evidence", evidenceIds: [], confidence: 90 },
      aliases: { values: ["Acme Run"], source: "evidence", evidenceIds: [], confidence: 80 },
      domains: ["acmerunning.com"],
      canonicalDomain: "acmerunning.com",
      parentBrand: null,
    },
    ...overrides,
  };
}

function baseDraft(overrides: Partial<CandidatePromptDraft> = {}): CandidatePromptDraft {
  return {
    text: "What are the best running shoes for beginners?",
    cohort: "neutral_discovery",
    section: "Discovery",
    intent: "discover",
    journeyStage: "awareness",
    topicId: null,
    persona: null,
    useCaseConstraint: null,
    evaluationCriterion: null,
    competitorEntityId: null,
    sentimentTheme: null,
    geographyScope: "none",
    geographyText: null,
    locationId: null,
    language: "en",
    brandPolicy: "TARGET_FORBIDDEN",
    coverageCellKey: "test",
    evidenceBasis: [],
    contextBasis: [],
    generationMethod: "template",
    ...overrides,
  };
}

describe("buildForbiddenBrandTerms + scanForBrandLeakage", () => {
  const profile = baseProfile();
  const terms = buildForbiddenBrandTerms(profile);

  it("includes brand name, alias, and domain-derived terms", () => {
    expect(terms).toContain("acme running co");
    expect(terms).toContain("acme run");
    expect(terms).toContain("acmerunning");
  });

  it("catches the brand name embedded in a neutral question", () => {
    const result = scanForBrandLeakage("Is Acme Running Co good for trail running?", terms);
    expect(result.leaked).toBe(true);
  });

  it("catches an alias", () => {
    const result = scanForBrandLeakage("What do people think of Acme Run?", terms);
    expect(result.leaked).toBe(true);
  });

  it("catches a possessive/plural form via the pre-added variant", () => {
    const result = scanForBrandLeakage("Acme Running Cos reputation is good", terms.concat(["acme running cos"]));
    expect(result.leaked).toBe(true);
  });

  it("does not flag unrelated text", () => {
    const result = scanForBrandLeakage("What are the best running shoes for trail running?", terms);
    expect(result.leaked).toBe(false);
  });

  it("does not false-positive on partial word matches", () => {
    // "run" is a substring of "running" but must not match as a standalone word leak
    const result = scanForBrandLeakage("I want to run every morning", terms);
    expect(result.leaked).toBe(false);
  });

  it("includes evidence-backed proprietary product lines without blacklisting generic categories", () => {
    const proprietaryProfile = baseProfile({
      offerings: {
        ...baseProfile().offerings,
        values: ["running shoes"],
        items: [{ name: "Acme Running Co Velocity™", type: "product", confidence: 92, evidenceIds: ["ev-product"], pageCount: 3 }],
      },
    });
    const proprietaryTerms = buildForbiddenBrandTerms(proprietaryProfile);
    expect(proprietaryTerms).toContain("acme running co velocity");
    expect(proprietaryTerms).not.toContain("running shoes");
  });
});

describe("the brand's own short names in the Discovery lexicon", () => {
  function named(brandName: string, domain: string, businessType: string): BusinessProfile {
    const profile = makeProfile({ brandName, archetype: "local_service", industry: "Beauty", domain });
    profile.identity.canonicalDomain = domain;
    return applyClassificationEdit(profile, { businessType, kind: "personal_care_wellness", physicalPresence: "single_location" });
  }

  // A template Discovery prompt asked for "the laurance bridal brands" and
  // passed, because only the full name and the domain label were forbidden.
  it("forbids the word a business is called by when its domain is that word plus category words", () => {
    const profile = named("Laurance Hair & Beauty Salon", "laurancesalon.com", "Hair salon");
    expect(brandCoreWord(profile)).toBe("laurance");
    expect(scanForBrandLeakage("Find top the laurance bridal brands in Dubai", buildForbiddenBrandTerms(profile)).leaked).toBe(true);
  });

  it("never forbids a category word or a common first word", () => {
    expect(brandCoreWord(named("Hair Boutique Salon", "hairboutiqueunisexsalon.in", "Unisex hair salon"))).toBeNull();
    expect(brandCoreWord(named("The Quality Chop House", "thequalitychophouse.com", "Restaurant"))).toBeNull();
    const pizza = named("Pizza Kitchen", "pizzakitchen.com", "Pizza restaurant");
    expect(brandCoreWord(pizza)).toBeNull();
    expect(scanForBrandLeakage("Where can I get good pizza in Leeds?", buildForbiddenBrandTerms(pizza)).leaked).toBe(false);
  });

  it("adds the shorter form people say, as rival names already do", () => {
    const profile = named("Atelier 10 Salon", "atelier10.ae", "Beauty salon");
    expect(scanForBrandLeakage("Is Atelier 10 any good for colour?", buildForbiddenBrandTerms(profile)).leaked).toBe(true);
  });
});

describe("validateCandidate", () => {
  const profile = baseProfile();
  const forbiddenTerms = buildForbiddenBrandTerms(profile);
  const ctx = { profile, forbiddenTerms, approvedLocations: [] };

  it("passes a well-formed neutral question", () => {
    const result = validateCandidate(baseDraft(), ctx);
    expect(result.pass).toBe(true);
  });

  it("rejects brand leakage in a TARGET_FORBIDDEN prompt", () => {
    const result = validateCandidate(baseDraft({ text: "Is Acme Running Co the best running shoe brand?" }), ctx);
    expect(result.pass).toBe(false);
    expect(result.code).toBe("brand_leakage");
  });

  it("rejects confirmed competitor leakage in Discovery", () => {
    const result = validateCandidate(baseDraft({ text: "What are good alternatives to Rival Shoes?" }), {
      ...ctx,
      competitorForbiddenTerms: ["rival shoes"],
    });
    expect(result.pass).toBe(false);
    expect(result.code).toBe("competitor_leakage");
  });

  it("requires the frozen competitor and a criterion in Trade Offs", () => {
    const result = validateCandidate(
      baseDraft({
        text: "How does Acme Running Co compare with Rival Shoes for cushioning?",
        cohort: "target_comparison",
        section: "Trade Offs",
        brandPolicy: "TARGET_REQUIRED",
        competitorEntityId: "rival-1",
        evaluationCriterion: "cushioning",
      }),
      { ...ctx, confirmedCompetitors: [{ entityId: "rival-1", canonicalName: "Rival Shoes" }] },
    );
    expect(result.pass).toBe(true);
  });

  it("rejects a Trade Off competitor outside the frozen set", () => {
    const result = validateCandidate(
      baseDraft({
        text: "How does Acme Running Co compare with Invented Rival for cushioning?",
        cohort: "target_comparison",
        section: "Trade Offs",
        brandPolicy: "TARGET_REQUIRED",
        competitorEntityId: "invented",
        evaluationCriterion: "cushioning",
      }),
      { ...ctx, confirmedCompetitors: [{ entityId: "rival-1", canonicalName: "Rival Shoes" }] },
    );
    expect(result.pass).toBe(false);
    expect(result.code).toBe("invalid_competitor");
  });

  it("requires an industry-appropriate theme in Sentiment Analysis", () => {
    const result = validateCandidate(
      baseDraft({ text: "How is Acme Running Co generally regarded?", cohort: "branded_accuracy", section: "Sentiment Analysis", brandPolicy: "TARGET_REQUIRED" }),
      ctx,
    );
    expect(result.pass).toBe(false);
    expect(result.code).toBe("missing_sentiment_theme");
  });

  it("allows brand leakage in a TARGET_REQUIRED prompt (branded cohort)", () => {
    const result = validateCandidate(
      baseDraft({ text: "How is Acme Running Co generally regarded for reliability?", brandPolicy: "TARGET_REQUIRED", cohort: "branded_accuracy", section: "Sentiment Analysis", sentimentTheme: "reliability" }),
      ctx,
    );
    expect(result.pass).toBe(true);
  });

  it("rejects a TARGET_REQUIRED prompt missing the brand entirely", () => {
    const result = validateCandidate(baseDraft({ text: "What are the best running shoes?", brandPolicy: "TARGET_REQUIRED", cohort: "branded_accuracy", section: "Sentiment Analysis", sentimentTheme: "reliability" }), ctx);
    expect(result.pass).toBe(false);
    expect(result.code).toBe("missing_required_brand");
  });

  it("rejects leading/biased phrasing", () => {
    const result = validateCandidate(baseDraft({ text: "Why is this brand clearly the best running shoe option?" }), ctx);
    expect(result.pass).toBe(false);
    expect(result.code).toBe("leading_non_neutral");
  });

  it("rejects multi-intent (bundled) questions", () => {
    const result = validateCandidate(baseDraft({ text: "What are the best running shoes and where can I buy them and what do they cost?" }), ctx);
    expect(result.pass).toBe(false);
    expect(result.code).toBe("multi_intent");
  });

  it("rejects unstable relative-time references", () => {
    const result = validateCandidate(baseDraft({ text: "What running shoes are trending today?" }), ctx);
    expect(result.pass).toBe(false);
    expect(result.code).toBe("unstable_temporal_reference");
  });

  it("rejects uncontrolled 'near me' without a bound geography", () => {
    const result = validateCandidate(baseDraft({ text: "What are the best running shoe stores near me?" }), ctx);
    expect(result.pass).toBe(false);
    expect(result.code).toBe("geography_uncontrolled_near_me");
  });

  it("rejects a geography-scoped prompt whose location is not in the approved set", () => {
    const result = validateCandidate(
      baseDraft({ geographyScope: "city", geographyText: "Nowhereville" }),
      { ...ctx, approvedLocations: [{ id: "loc1", projectId: "p1", level: "city", name: "Austin", parentId: null, countryCode: null, evidenceIds: [], isPrimary: true } as never] },
    );
    expect(result.pass).toBe(false);
    expect(result.code).toBe("geography_out_of_scope");
  });

  it("blocks personalized medical advice requests for a regulated healthcare business", () => {
    const healthcareProfile = baseProfile({ regulatedDomain: { isRegulated: true, categories: ["healthcare"], source: "evidence" } });
    const result = validateCandidate(
      baseDraft({ text: "What medication should I take for my headache?" }),
      { profile: healthcareProfile, forbiddenTerms: buildForbiddenBrandTerms(healthcareProfile), approvedLocations: [] },
    );
    expect(result.pass).toBe(false);
    expect(result.code).toBe("regulated_personalized_advice");
  });

  it("rejects text that reads as neither a question nor a buyer search query", () => {
    const result = validateCandidate(baseDraft({ text: "The best running shoes are made of mesh." }), ctx);
    expect(result.pass).toBe(false);
    // Bare keyword queries ("best running shoes for beginners") are a register
    // real users type and the reference products track, so the rule is no
    // longer "must end in a question mark" — but a declarative sentence with
    // no query shape still fails.
    expect(result.code).toBe("schema_not_a_query");
  });
});
