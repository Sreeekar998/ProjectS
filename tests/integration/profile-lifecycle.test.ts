import { describe, it, expect } from "vitest";
import { createProject } from "@/lib/projects/repository";
import { createProfileVersion, getLatestProfileVersion, updateProfileVersion, confirmProfileVersion } from "@/lib/profile/repository";
import { mergeUserEdits } from "@/lib/profile/merge";
import { runWebsiteIntelligence, synthesizeFinalProfile } from "@/lib/profile/orchestrator";
import { buildMarketHint } from "@/lib/projects/market-hint";
import { getEventsSince } from "@/lib/events/bus";
import { insertEvidenceItems, listEvidenceByIds } from "@/lib/evidence/repository";
import { assertEvidenceIntegrity, evidenceCoverage, validateSynthesis } from "@/lib/profile/validator";
import { emptyProfile, type BusinessProfile } from "@/lib/profile/schema";
import type { EvidencePack } from "@/lib/evidence/types";
import { makeProfile, makeEvidenceSet } from "../helpers/profile-fixtures";

describe("profile versioning and user overrides", () => {
  it("persists a profile version and reads it back", async () => {
    const project = await createProject({ url: "https://version-test.example", marketScope: "global", language: "en" });
    const profile = makeProfile({ brandName: "Acme", archetype: "ecommerce_dtc_retail", industry: "Retail", offerings: ["Widgets"] });
    const created = await createProfileVersion(project.id, null, profile, { status: "complete" });
    const latest = await getLatestProfileVersion(project.id);
    expect(latest?.id).toBe(created.id);
    expect((latest?.profile as unknown as BusinessProfile).identity.brandName.value).toBe("Acme");
  });

  it("updates a partial version in place, then completes it", async () => {
    const project = await createProject({ url: "https://partial-test.example", marketScope: "global", language: "en" });
    const partial = await createProfileVersion(project.id, null, emptyProfile("partial-test.example"), { status: "partial" });
    expect(partial.status).toBe("partial");

    const complete = makeProfile({ brandName: "Partial Co", archetype: "b2b_saas_enterprise", industry: "Software", offerings: ["Analytics"] });
    const updated = await updateProfileVersion(partial.id, complete, { status: "complete" });
    expect(updated.id).toBe(partial.id);
    expect(updated.status).toBe("complete");
    // Still exactly one version: a progressive fill does not spam the history.
    const latest = await getLatestProfileVersion(project.id);
    expect(latest?.version).toBe(1);
  });

  it("records which fields the user edited", async () => {
    const project = await createProject({ url: "https://edited.example", marketScope: "global", language: "en" });
    const base = makeProfile({ brandName: "Before", archetype: "other", industry: "Retail" });
    await createProfileVersion(project.id, null, base, { status: "complete" });

    const edited = structuredClone(base);
    edited.identity.brandName = { value: "After", source: "user", evidenceIds: [], confidence: 100 };
    const version = await createProfileVersion(project.id, null, edited, {
      status: "complete",
      userEditedFields: ["identity.brandName"],
    });
    expect(version.version).toBe(2);
    expect(version.userEditedFields).toEqual(["identity.brandName"]);
    expect(version.fieldProvenance["identity.brandName"]?.source).toBe("user");
  });

  it("keeps user edits when analysis runs again", () => {
    const edited = makeProfile({ brandName: "User Chosen Name", archetype: "marketplace", industry: "Marketplaces", offerings: ["Handmade Goods"] });
    edited.identity.brandName.source = "user";
    edited.description = { value: "A description the user wrote.", source: "user", evidenceIds: [], confidence: 100 };

    const fresh = makeProfile({ brandName: "Re-inferred Name", archetype: "ecommerce_dtc_retail", industry: "Retail", offerings: ["Something Else"] });

    const merged = mergeUserEdits(fresh, edited, ["identity.brandName", "description"]);
    expect(merged.identity.brandName.value).toBe("User Chosen Name");
    expect(merged.description.value).toBe("A description the user wrote.");
    // Fields the user did NOT touch take the fresh inference.
    expect(merged.offerings.values).toEqual(["Something Else"]);
    expect(merged.quality.warnings.join(" ")).toMatch(/kept your edits/i);
  });

  it("confirming a version stamps who confirmed it", async () => {
    const project = await createProject({ url: "https://confirm.example", marketScope: "global", language: "en" });
    const version = await createProfileVersion(project.id, null, makeProfile({ brandName: "C", archetype: "other", industry: "Retail" }), { status: "complete" });
    await confirmProfileVersion(version.id, "test-operator");
    const latest = await getLatestProfileVersion(project.id);
    expect(latest?.confirmedAt).toBeTruthy();
    expect(latest?.confirmedBy).toBe("test-operator");
  });
});

describe("evidence persistence and integrity", () => {
  it("round-trips typed evidence items", async () => {
    const items = makeEvidenceSet([
      { text: "Organization name: Roundtrip Co", sourceType: "jsonld", fieldHint: "brand_name" },
      { text: "Primary nav: Widgets", sourceType: "navigation", fieldHint: "offering" },
    ]).map(({ id: _id, ...rest }) => rest);

    const inserted = await insertEvidenceItems(items);
    expect(inserted).toHaveLength(2);
    const read = await listEvidenceByIds(inserted.map((i) => i.id));
    expect(read).toHaveLength(2);
    expect(read.map((r) => r.sourceType).sort()).toEqual(["jsonld", "navigation"]);
  });

  it("detects an evidence id that does not exist", () => {
    const profile = makeProfile({ brandName: "X", archetype: "other", industry: "Retail" });
    profile.identity.brandName.evidenceIds = ["ev_does_not_exist"];
    const result = assertEvidenceIntegrity(profile, new Set(["ev_real"]));
    expect(result.ok).toBe(false);
    expect(result.problems[0]).toContain("ev_does_not_exist");
  });

  it("reports evidence coverage gaps", () => {
    const profile = makeProfile({ brandName: "X", archetype: "ecommerce_dtc_retail", industry: "Retail", offerings: ["Widgets"] });
    // makeProfile leaves evidenceIds empty, so every populated field is a gap.
    const coverage = evidenceCoverage(profile);
    expect(coverage.ratio).toBeLessThan(1);
    expect(coverage.gaps.length).toBeGreaterThan(0);
  });
});

describe("synthesis validation", () => {
  const evidence = makeEvidenceSet([
    { id: "ev_1", text: "Organization name: Real Co", sourceType: "jsonld", fieldHint: "brand_name" },
    { id: "ev_2", text: "Primary nav: Running Shoes", sourceType: "navigation", fieldHint: "offering" },
  ]);
  const pack: EvidencePack = {
    projectId: "p",
    runId: "r",
    canonicalDomain: "real.example",
    seedUrl: "https://real.example/",
    items: evidence,
    pages: [],
    deterministic: {
      brandNameCandidates: [],
      offeringCandidates: [],
      marketCandidates: [],
      identityCandidates: [],
      audienceCandidates: [],
      industryCandidates: [],
      languages: [],
    },
  };
  const baseline = makeProfile({ brandName: "Real Co", archetype: "ecommerce_dtc_retail", industry: "Retail", offerings: ["Running Shoes"] });

  it("drops a field whose evidence ids do not exist", () => {
    const result = validateSynthesis(
      { description: { value: "A completely invented description of this business.", evidenceIds: ["ev_hallucinated"] } },
      pack,
      baseline,
    );
    expect(result.profile.description.value).toBe(baseline.description.value);
    expect(result.rejected.join(" ")).toMatch(/description/);
  });

  it("accepts a field that cites real evidence", () => {
    const result = validateSynthesis(
      { description: { value: "Online retailer selling running shoes in the United Kingdom.", evidenceIds: ["ev_1", "ev_2"] } },
      pack,
      baseline,
    );
    expect(result.profile.description.value).toContain("running shoes");
    expect(result.profile.description.source).toBe("evidence");
    expect(result.profile.description.confidence).toBeGreaterThan(0);
  });

  it("rejects an industry outside the closed taxonomy", () => {
    const result = validateSynthesis({ industryTaxonomyId: "made.up.sector", industryEvidenceIds: ["ev_1"] }, pack, baseline);
    expect(result.profile.industry.value).toBe(baseline.industry.value);
    expect(result.rejected.join(" ")).toMatch(/not in the taxonomy/);
  });

  it("rejects generic identity traits", () => {
    const result = validateSynthesis(
      { brandIdentity: [{ value: "Innovative", evidenceIds: ["ev_1"] }, { value: "Trusted", evidenceIds: ["ev_1"] }] },
      pack,
      baseline,
    );
    expect(result.profile.brandIdentity.map((t) => t.value)).not.toContain("Innovative");
    expect(result.rejected.join(" ")).toMatch(/too generic/);
  });

  it("rejects a market with no evidence — the easiest field to invent", () => {
    const result = validateSynthesis({ markets: [{ name: "Japan", level: "country", evidenceIds: [] }] }, pack, baseline);
    expect(result.profile.markets.map((m) => m.name)).not.toContain("Japan");
    expect(result.rejected.join(" ")).toMatch(/market "Japan"/);
  });

  it("rejects useless offering names", () => {
    const result = validateSynthesis(
      {
        offerings: [
          { name: "Products", type: "category", evidenceIds: ["ev_2"] },
          { name: "Services", type: "category", evidenceIds: ["ev_2"] },
          { name: "Running Shoes", type: "category", evidenceIds: ["ev_2"] },
          { name: "Trail Shoes", type: "category", evidenceIds: ["ev_2"] },
        ],
      },
      pack,
      baseline,
    );
    const names = result.profile.offerings.values.map((n) => n.toLowerCase());
    expect(names).not.toContain("products");
    expect(names).not.toContain("services");
    expect(names).toContain("running shoes");
  });
});

describe("operator market hint without a model", () => {
  const evidence = makeEvidenceSet([
    { id: "ev_hint_name", text: "Organization name: Zeta Studio", sourceType: "jsonld", fieldHint: "brand_name" },
    { id: "ev_hint_copy", text: "Zeta Studio offers balayage, gel manicures and brow lamination.", sourceType: "main_content", fieldHint: "offering" },
  ]);
  const pages = [{ id: "pg_home", url: "https://zeta-studio.example/", pageType: "home" as const, title: "Zeta Studio" }];
  const synthesize = (marketHint: ReturnType<typeof buildMarketHint>) =>
    synthesizeFinalProfile({
      projectId: "prj_hint_fallback",
      crawlRunId: "crw_hint_fallback",
      evidence,
      pages,
      canonicalDomain: "zeta-studio.example",
      seedUrl: "https://zeta-studio.example/",
      seedHostname: "zeta-studio.example",
      allowNetwork: false,
      marketHint,
    });

  it("still applies the hint to a rules-only profile", async () => {
    const hint = buildMarketHint({
      countryCodes: ["AE"],
      worldwide: false,
      area: { query: "DIFC", place: { label: "", formattedAddress: null, premise: null, street: null, neighborhood: "DIFC", district: null, city: "Dubai", region: "Dubai", country: null, countryCode: "AE", postalCode: null, lat: 25.21, lng: 55.28, precision: null, provider: "photon", providerId: null } },
    });
    const profile = await synthesize(hint);
    expect(profile.quality.synthesisMode).toBe("deterministic");
    expect(profile.location?.operatorHint?.outcome).toBe("filled");
    expect(profile.location?.primary).toMatchObject({ neighborhood: "DIFC", city: "Dubai", countryCode: "AE" });
    // "other" is not place-bound, so a neighbourhood area gives a local scope.
    expect(profile.marketScope.value).toBe("local");
    expect(profile.markets.map((m) => m.name)).toEqual(expect.arrayContaining(["Dubai", "United Arab Emirates"]));
    expect(profile.geography.cities).toEqual(["Dubai"]);
  });

  it("leaves a rules-only profile without a location when no hint was given", async () => {
    const profile = await synthesize(null);
    expect(profile.location).toBeUndefined();
  });
});

describe("analysis error states", () => {
  it("marks the profile failed and emits a reason for an unresolvable domain", async () => {
    const project = await createProject({
      url: "https://this-domain-should-not-resolve-project-sun.invalid",
      marketScope: "global",
      language: "en",
    });
    const { version, profile, crawl } = await runWebsiteIntelligence(project.id);

    expect(crawl?.status).not.toBe("completed");
    expect(version.status).toBe("failed");
    // The distinction the UI depends on: a failure is reported, not papered
    // over with a confident empty profile.
    expect(profile.quality.warnings.join(" ")).toMatch(/could not/i);
    expect(profile.markets).toEqual([]);
    expect(profile.offerings.items).toEqual([]);

    const events = await getEventsSince(project.id, 0);
    const types = events.map((e) => e.type);
    expect(types).toContain("crawl.started");
    expect(types.some((t) => t === "crawl.blocked" || t === "crawl.failed")).toBe(true);
    expect(types).toContain("profile.failed");
  }, 30_000);

  it("still applies the intake country and area when the crawl fails", async () => {
    // Review 2026-09-14: a blocked site dropped the operator's DIFC/AE answer,
    // so the hand-filled profile had no Location card and no area tier.
    const project = await createProject({
      url: "https://this-domain-should-not-resolve-project-sun-hint.invalid",
      marketHint: buildMarketHint({
        countryCodes: ["AE"],
        worldwide: false,
        area: { query: "DIFC", place: { label: "", formattedAddress: null, premise: null, street: null, neighborhood: "DIFC", district: null, city: "Dubai", region: "Dubai", country: null, countryCode: "AE", postalCode: null, lat: 25.21, lng: 55.28, precision: null, provider: "photon", providerId: null } },
      }),
      language: "en",
    });
    const { version, profile } = await runWebsiteIntelligence(project.id, { allowNetwork: false });

    expect(version.status).toBe("failed");
    expect(profile.quality.warnings.at(-1)).toMatch(/could not/i);
    expect(profile.location?.operatorHint?.outcome).toBe("filled");
    expect(profile.location?.primary).toMatchObject({ neighborhood: "DIFC", city: "Dubai", countryCode: "AE" });
    expect(profile.markets.map((m) => m.name)).toEqual(expect.arrayContaining(["Dubai", "United Arab Emirates"]));
    // The stored failed version is what the manual form edits.
    const stored = (await getLatestProfileVersion(project.id))?.profile as unknown as BusinessProfile;
    expect(stored.location?.primary?.countryCode).toBe("AE");
  }, 30_000);

  it("keeps the crawl failure as the last warning when the area hint also warns", async () => {
    // Verify 2026-09-14: the page shows the last warning as the failure banner,
    // so an unmatched area must not replace the crawl reason there.
    const project = await createProject({
      url: "https://this-domain-should-not-resolve-project-sun-unmatched.invalid",
      marketHint: buildMarketHint({ countryCodes: ["AE"], worldwide: false, area: { query: "DIFC", place: null } }),
      language: "en",
    });
    const { version, profile } = await runWebsiteIntelligence(project.id, { allowNetwork: false });

    expect(version.status).toBe("failed");
    const warnings = profile.quality.warnings;
    expect(warnings.some((w) => /couldn't find “DIFC”/.test(w))).toBe(true);
    expect(warnings.at(-1)).toMatch(/could not/i);
    expect(warnings.at(-1)).not.toMatch(/DIFC/);
    const stored = (await getLatestProfileVersion(project.id))?.profile as unknown as BusinessProfile;
    expect(stored.quality.warnings.at(-1)).toBe(warnings.at(-1));
  }, 30_000);

  it("leaves a failed profile without a location when no hint was given", async () => {
    const project = await createProject({ url: "https://this-domain-should-not-resolve-project-sun-nohint.invalid", marketHint: null, language: "en" });
    const { version, profile } = await runWebsiteIntelligence(project.id, { allowNetwork: false });
    expect(version.status).toBe("failed");
    expect(profile.location).toBeUndefined();
    expect(profile.markets).toEqual([]);
  }, 30_000);

  it("rejects a private address before any request is made", async () => {
    await expect(createProject({ url: "http://127.0.0.1:8080", marketScope: "global", language: "en" })).rejects.toThrow();
  });
});
