import { describe, expect, it } from "vitest";
import { shareOfVoiceReading } from "@/lib/measure/summary";
import type { MeasureResult } from "@/lib/measure/types";

// A Dubai gym's Overview showed share of voice "3 of 3" (100%): none of its
// three frozen competitors was named in the ten Discovery answers, while the
// answers named Fitness First, GymNation and MH3 Gym, all untracked.
function measure(overrides: { competitorsNamed: number[]; untracked?: Array<[string, number]>; denominator?: number }): Pick<MeasureResult, "presence" | "brands" | "metrics"> {
  const competitors = overrides.competitorsNamed.map((named, index) => ({ entityId: `c${index}`, name: `Rival ${index + 1}`, relation: "confirmed_competitor", presenceEvents: named, observationIds: [], shareOfVoice: null, firstChoiceCount: 0 }));
  const total = 3 + overrides.competitorsNamed.reduce((sum, n) => sum + n, 0);
  return {
    presence: { combined: [{ entityId: "t", name: "The Warehouse Gym", relation: "target", presenceEvents: 3, observationIds: [], shareOfVoice: null, firstChoiceCount: 0 }, ...competitors] },
    brands: (overrides.untracked ?? []).map(([name, named]) => ({ entityId: null, name, relation: "emerging", discoveryNamed: named, namedByEngine: { chatgpt: { named, eligible: 10 } } })),
    metrics: { combined: { discovery_share_of_voice: { key: "discovery_share_of_voice", numerator: 3, denominator: overrides.denominator ?? total, value: 3 / (overrides.denominator ?? total), numeratorObservationIds: [], denominatorObservationIds: [] } } },
  } as unknown as Pick<MeasureResult, "presence" | "brands" | "metrics">;
}

describe("share of voice reading", () => {
  it("is not comparable when no tracked competitor was named, and names the untracked brands that were", () => {
    const reading = shareOfVoiceReading(measure({ competitorsNamed: [0, 0, 0], untracked: [["GymNation", 1], ["Fitness First", 2], ["JVC", 0]] }));
    expect(reading.comparable).toBe(false);
    expect(reading.competitors).toBe(3);
    expect(reading.competitorsNamed).toBe(0);
    expect(reading.untracked.map((row) => row.name)).toEqual(["Fitness First", "GymNation"]);
  });

  it("is comparable once any tracked competitor is named", () => {
    const reading = shareOfVoiceReading(measure({ competitorsNamed: [2, 0, 0] }));
    expect(reading.comparable).toBe(true);
    expect(reading.competitorsNamed).toBe(1);
  });

  it("is not comparable with no answers at all, and reads a single engine's counts for untracked names", () => {
    expect(shareOfVoiceReading(measure({ competitorsNamed: [1], denominator: 0 })).comparable).toBe(false);
    const scoped = shareOfVoiceReading(measure({ competitorsNamed: [0], untracked: [["GymNation", 2]] }), "chatgpt");
    expect(scoped.untracked).toEqual([{ name: "GymNation", named: 2 }]);
  });
});
