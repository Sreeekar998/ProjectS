import { describe, expect, it } from "vitest";
import {
  GENERIC_SOURCE_LABEL,
  competitorSourceLabels,
  emptyTierLine,
  groupCompetitorsByTier,
  isEligibleCompetitor,
  shouldAutoGenerate,
  tierHeadingFor,
  tierOptions,
  tradeOffsHint,
  visibleCompetitors,
  type LandscapeRowLike,
} from "@/lib/client/landscape-view";
import type { LandscapeTierPlanDto } from "@/lib/landscape/tier-types";

const plan: LandscapeTierPlanDto = {
  primaryTier: "area",
  knownBrand: false,
  tiers: [
    { tier: "area", place: "Harbour Quarter", level: "neighborhood", heading: "In Harbour Quarter", subheading: "and nearby: Old Town", quota: 6 },
    { tier: "city", place: "Port City", level: "city", heading: "Across Port City", subheading: null, quota: 6 },
    { tier: "country", place: "United Arab Emirates", level: "country", heading: "Across the United Arab Emirates", subheading: null, quota: 6 },
  ],
};

function row(id: string, fields: Partial<LandscapeRowLike> = {}): LandscapeRowLike {
  return { id, status: "candidate", competitorType: "direct", tier: null, tierPlace: null, ...fields };
}

describe("visible rows", () => {
  it("hides rows the system rejected and rows the operator removed", () => {
    const rows = [row("a"), row("b", { status: "removed" }), row("c", { status: "confirmed" })];
    expect(visibleCompetitors(rows).map((r) => r.id)).toEqual(["a", "c"]);
    expect(visibleCompetitors(undefined)).toEqual([]);
  });

  it("eligible = confirmed and not a marketplace", () => {
    expect(isEligibleCompetitor(row("a", { status: "confirmed", competitorType: "adjacent" }))).toBe(true);
    expect(isEligibleCompetitor(row("a", { status: "confirmed", competitorType: "marketplace" }))).toBe(false);
    expect(isEligibleCompetitor(row("a", { status: "candidate" }))).toBe(false);
  });
});

describe("groupCompetitorsByTier", () => {
  it("groups in plan order with headings, counts and an empty-tier line, never listing removed rows", () => {
    const rows = [
      row("city1", { tier: "city", status: "confirmed" }),
      row("area1", { tier: "area" }),
      row("area2", { tier: "area", status: "confirmed" }),
      row("area3", { tier: "area" }),
      row("gone", { tier: "area", status: "removed" }),
    ];
    const groups = groupCompetitorsByTier(rows, plan);
    expect(groups.map((g) => g.key)).toEqual(["tier:area", "tier:city", "tier:country"]);
    expect(groups[0]).toMatchObject({ heading: "In Harbour Quarter", subheading: "and nearby: Old Town", countLine: "2 suggested · 1 confirmed", emptyLine: null });
    expect(groups[0]!.rows.map((r) => r.id)).toEqual(["area1", "area2", "area3"]);
    expect(groups[1]).toMatchObject({ countLine: "1 confirmed" });
    expect(groups[2]!.rows).toEqual([]);
    expect(groups[2]!.emptyLine).toBe("No suggestions found across the United Arab Emirates yet. Add one below.");
    expect(groups.flatMap((g) => g.rows).some((r) => r.id === "gone")).toBe(false);
  });

  it("renders one untitled list for a legacy project (no plan) or rows without tiers", () => {
    const rows = [row("a"), row("b", { status: "removed" }), row("c")];
    for (const groups of [groupCompetitorsByTier(rows, null), groupCompetitorsByTier(rows, undefined), groupCompetitorsByTier(rows, plan), groupCompetitorsByTier(rows, { ...plan, tiers: [] })]) {
      expect(groups).toHaveLength(1);
      expect(groups[0]).toMatchObject({ key: "all", heading: null, emptyLine: null });
      expect(groups[0]!.rows.map((r) => r.id)).toEqual(["a", "c"]);
    }
  });

  it("puts a tier outside the plan under its own heading, and untiered rows last", () => {
    const narrowPlan: LandscapeTierPlanDto = { ...plan, tiers: [plan.tiers[1]!] };
    const groups = groupCompetitorsByTier([row("c1", { tier: "city" }), row("k1", { tier: "country", tierPlace: "United Arab Emirates" }), row("u1")], narrowPlan);
    expect(groups.map((g) => g.key)).toEqual(["tier:city", "extra:country:united arab emirates", "untiered"]);
    expect(groups[1]!.heading).toBe("Across the United Arab Emirates");
    expect(groups[2]!.heading).toBeNull();
  });
});

describe("copy helpers", () => {
  it("lower-cases only the heading's first letter in the empty line", () => {
    expect(emptyTierLine("In Harbour Quarter")).toBe("No suggestions found in Harbour Quarter yet. Add one below.");
    expect(emptyTierLine("Worldwide")).toBe("No suggestions found worldwide yet. Add one below.");
  });

  it("builds headings for tiers the plan doesn't have", () => {
    expect(tierHeadingFor("area", "Harbour Quarter")).toBe("In Harbour Quarter");
    expect(tierHeadingFor("city", "Port City")).toBe("Across Port City");
    expect(tierHeadingFor("country", "United States")).toBe("Across the United States");
    expect(tierHeadingFor("country", "Worldwide")).toBe("Worldwide");
    expect(tierHeadingFor("city", null)).toBe("Across the city");
  });

  it("hints which tiers Trade Offs will compare when a planned tier has no confirmed rival", () => {
    const groups = groupCompetitorsByTier([row("a", { tier: "area", status: "confirmed" }), row("c", { tier: "city", status: "confirmed" }), row("k", { tier: "country" })], plan);
    expect(tradeOffsHint(groups)).toBe("Trade Offs will only compare rivals in Harbour Quarter and across Port City.");
    const allCovered = groupCompetitorsByTier(
      [row("a", { tier: "area", status: "confirmed" }), row("c", { tier: "city", status: "confirmed" }), row("k", { tier: "country", status: "confirmed" })],
      plan,
    );
    expect(tradeOffsHint(allCovered)).toBeNull();
    expect(tradeOffsHint(groupCompetitorsByTier([row("a", { tier: "area" })], plan))).toBeNull();
    expect(tradeOffsHint(groupCompetitorsByTier([row("a", { status: "confirmed" })], null))).toBeNull();
  });

  it("offers the plan's headings for Where it competes", () => {
    expect(tierOptions(plan)).toEqual([
      { value: "area", label: "In Harbour Quarter" },
      { value: "city", label: "Across Port City" },
      { value: "country", label: "Across the United Arab Emirates" },
    ]);
    expect(tierOptions(null)).toEqual([]);
  });
});

describe("shouldAutoGenerate", () => {
  it("starts generation for a new or stale landscape only", () => {
    expect(shouldAutoGenerate({ liveTopicCount: 0, hasDiscovery: false, stale: false, inFlight: false })).toBe(true);
    expect(shouldAutoGenerate({ liveTopicCount: 5, hasDiscovery: false, stale: false, inFlight: false })).toBe(true);
    expect(shouldAutoGenerate({ liveTopicCount: 5, hasDiscovery: true, stale: true, inFlight: false })).toBe(true);
    expect(shouldAutoGenerate({ liveTopicCount: 0, hasDiscovery: false, stale: false, inFlight: true })).toBe(false);
  });

  it("does not re-run on every visit after a failed run or a run that found nothing", () => {
    expect(shouldAutoGenerate({ liveTopicCount: 5, hasDiscovery: true, stale: false, inFlight: false })).toBe(false);
  });
});

describe("competitorSourceLabels", () => {
  it("labels map rivals and never renders a raw source key", () => {
    expect(competitorSourceLabels(["nearby_places"])).toEqual(["Found on the map nearby"]);
    expect(competitorSourceLabels(["web_search", "nearby_places"])).toEqual(["Found in web search", "Found on the map nearby"]);
    const unknown = competitorSourceLabels(["some_future_source", "another_key", null, undefined, ""]);
    expect(unknown).toEqual([GENERIC_SOURCE_LABEL]);
    expect(unknown.join(" ")).not.toMatch(/_/);
  });
});
