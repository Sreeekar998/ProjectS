// Search Analytics reporting window.
//
// Google dates Search Console data in Pacific time and the newest 2–3 days are
// still preliminary, so the window ends three Pacific calendar days before
// `now`. Computing it from UTC dates shifted the end date by a day for a
// request made in the evening in California.
//
// Pure and client-safe.

import { clampLookbackDays } from "./config";

const PACIFIC = "America/Los_Angeles";
const DAY_MS = 86_400_000;
const DATA_DELAY_DAYS = 3;

function pacificCalendarDate(now: Date): { year: number; month: number; day: number } {
  const parts = new Intl.DateTimeFormat("en-US", { timeZone: PACIFIC, year: "numeric", month: "2-digit", day: "2-digit" }).formatToParts(now);
  const pick = (type: string) => Number(parts.find((part) => part.type === type)?.value);
  return { year: pick("year"), month: pick("month"), day: pick("day") };
}

function isoDay(utcMidnight: number): string {
  return new Date(utcMidnight).toISOString().slice(0, 10);
}

/** `{ startDate, endDate }` as YYYY-MM-DD, inclusive, `lookbackDays` long (clamped to 7–480). */
export function reportingWindow(now: Date, lookbackDays: number): { startDate: string; endDate: string } {
  const days = clampLookbackDays(lookbackDays);
  const today = pacificCalendarDate(now);
  // Calendar arithmetic on a UTC midnight is exact: no DST in UTC.
  const end = Date.UTC(today.year, today.month - 1, today.day) - DATA_DELAY_DAYS * DAY_MS;
  const start = end - (days - 1) * DAY_MS;
  return { startDate: isoDay(start), endDate: isoDay(end) };
}
