import { describe, expect, it } from "vitest";
import { formatRange, plausibleRange, withinPlausibleRange } from "@/lib/measure/precision";

// Known Wilson 95% intervals, worked by hand: centre (p + z²/2n)/(1 + z²/n),
// half-width z·√(p(1−p)/n + z²/4n²)/(1 + z²/n), z = 1.96.
describe("plausibleRange (Wilson 95%)", () => {
  it("matches the worked values for a ten-answer section", () => {
    const range = plausibleRange(2, 10)!;
    expect(range.low).toBeCloseTo(0.0567, 3);
    expect(range.high).toBeCloseTo(0.5098, 3);
    expect(formatRange(range)).toBe("5–51%");
  });

  it("keeps a real width at 0 of n and n of n, where the textbook interval collapses", () => {
    expect(plausibleRange(0, 10)!.low).toBe(0);
    expect(plausibleRange(0, 10)!.high).toBeCloseTo(0.2775, 3);
    expect(plausibleRange(10, 10)!.high).toBeCloseTo(1, 9);
    expect(plausibleRange(10, 10)!.low).toBeCloseTo(0.7225, 3);
  });

  it("narrows as the sample grows", () => {
    const small = plausibleRange(3, 10)!;
    const large = plausibleRange(30, 100)!;
    expect(large.high - large.low).toBeLessThan(small.high - small.low);
  });

  it("refuses an empty or impossible fraction rather than inventing a range", () => {
    expect(plausibleRange(0, 0)).toBeNull();
    expect(plausibleRange(3, 2)).toBeNull();
    expect(formatRange(null)).toBeNull();
  });

  it("reads a move from 2 of 10 to 3 of 10 as within the range, and 2 of 10 to 8 of 10 as outside it", () => {
    expect(withinPlausibleRange({ numerator: 2, denominator: 10 }, { numerator: 3, denominator: 10 })).toBe(true);
    expect(withinPlausibleRange({ numerator: 2, denominator: 10 }, { numerator: 8, denominator: 10 })).toBe(false);
    expect(withinPlausibleRange({ numerator: 0, denominator: 0 }, { numerator: 1, denominator: 10 })).toBe(false);
  });
});
