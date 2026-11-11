// How far a rate from a handful of answers can be trusted.
//
// Ten Discovery answers per run is a small sample: one answer moves the rate
// by ten points. The IAB's "Measuring Visibility in the AI Era" guideline
// (August 2026) asks for a rate to be reported with its range ("approximately
// 22%, plus or minus 4 points") and calls fewer than 50 queries exploratory;
// Evertune puts a 10-prompt topic asked once at about ±31 points. So every
// headline rate carries a plausible range beside its fraction.
//
// The range is the Wilson score interval at 95%: well behaved at 0 of n and
// n of n (where the textbook ±1.96·√(p(1−p)/n) collapses to zero width), and
// computed from the same counts the fraction shows, so it needs no data the
// measurement does not have. It treats the questions as independent draws; it
// says how much a different set of similar questions could move the rate, not
// how much re-asking the same question would (a run asks each question once,
// so that variation is not observed). Pure and client-safe.

export interface PlausibleRange {
  low: number;
  high: number;
}

const Z95 = 1.959964;

export function plausibleRange(numerator: number, denominator: number, z = Z95): PlausibleRange | null {
  if (denominator <= 0 || numerator < 0 || numerator > denominator) return null;
  const p = numerator / denominator;
  const z2 = z * z;
  const scale = 1 + z2 / denominator;
  const centre = (p + z2 / (2 * denominator)) / scale;
  const half = (z * Math.sqrt((p * (1 - p)) / denominator + z2 / (4 * denominator * denominator))) / scale;
  return { low: Math.max(0, centre - half), high: Math.min(1, centre + half) };
}

/** "6–51%": whole percentages, the low end rounded down and the high end up so the range never looks narrower than it is. */
export function formatRange(range: PlausibleRange | null): string | null {
  if (!range) return null;
  return `${Math.floor(range.low * 100)}–${Math.ceil(range.high * 100)}%`;
}

/**
 * Whether a later rate sits inside the earlier rate's plausible range, so the
 * change is no larger than a different handful of similar questions could
 * produce. Such a change is shown, but not as a gain or a loss.
 */
export function withinPlausibleRange(from: { numerator: number; denominator: number }, to: { numerator: number; denominator: number }): boolean {
  const range = plausibleRange(from.numerator, from.denominator);
  if (!range || to.denominator <= 0) return false;
  const value = to.numerator / to.denominator;
  return value >= range.low && value <= range.high;
}
