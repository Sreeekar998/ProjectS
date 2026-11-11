import { describe, expect, it } from "vitest";
import { clampLookbackDays } from "@/lib/search-console/config";
import { reportingWindow } from "@/lib/search-console/window";

describe("reportingWindow", () => {
  it("ends three Pacific calendar days before now, not three UTC days", () => {
    // 2026-09-14 02:00 UTC is still 13 September in California.
    expect(reportingWindow(new Date("2026-09-14T02:00:00Z"), 90)).toEqual({ startDate: "2026-06-13", endDate: "2026-09-10" });
    expect(reportingWindow(new Date("2026-09-14T12:00:00Z"), 90)).toEqual({ startDate: "2026-06-14", endDate: "2026-09-11" });
  });

  it("stays exact across a DST change", () => {
    // US DST ended 2026-11-01. 2026-11-03 07:30 UTC is 2 November 23:30 PST.
    expect(reportingWindow(new Date("2026-11-03T07:30:00Z"), 7)).toEqual({ startDate: "2026-10-24", endDate: "2026-10-30" });
    // DST began 2026-03-08. 2026-03-09 06:30 UTC is 8 March 23:30 PDT.
    expect(reportingWindow(new Date("2026-03-09T06:30:00Z"), 30)).toEqual({ startDate: "2026-02-04", endDate: "2026-03-05" });
  });

  it("is inclusive of both ends", () => {
    const { startDate, endDate } = reportingWindow(new Date("2026-09-14T12:00:00Z"), 28);
    expect((Date.parse(endDate) - Date.parse(startDate)) / 86_400_000 + 1).toBe(28);
  });

  it("clamps the lookback to 7–480 days", () => {
    expect(clampLookbackDays(1)).toBe(7);
    expect(clampLookbackDays(10_000)).toBe(480);
    expect(clampLookbackDays(Number.NaN)).toBe(90);
    const { startDate, endDate } = reportingWindow(new Date("2026-09-14T12:00:00Z"), 2);
    expect((Date.parse(endDate) - Date.parse(startDate)) / 86_400_000 + 1).toBe(7);
  });
});
