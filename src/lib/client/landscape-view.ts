import { countryPhrase } from "@/lib/geo/countries";
import type { CompetitorTier, LandscapeTierPlanDto } from "@/lib/landscape/tier-types";

// What the Landscape page shows once generation has finished. Pure and
// client-safe (unit-tested).
//
// - Rows the system rejected stay in the database (rediscovery guards and the
//   golden eval read them) but are never listed: operators asked not to see
//   rejected items or the reasons (feedback 2026-09-14).
// - Competitors are grouped by where they compete (area, city, country), in the
//   plan's order, because operators asked for local, city-wide and country-wide
//   rivals side by side. Projects discovered before tiers existed, or rows with
//   no tier, render as one untitled list.

/** Same rule as the API and the frozen competitive set: any confirmed rival except a marketplace. */
export const ELIGIBLE_COMPETITOR_TYPES = ["direct", "substitute", "adjacent"] as const;

export interface LandscapeRowLike {
  id: string;
  status: string;
  competitorType?: string | null;
  tier?: CompetitorTier | null;
  tierPlace?: string | null;
}

export function visibleCompetitors<T extends LandscapeRowLike>(rows: T[] | null | undefined): T[] {
  return (rows ?? []).filter((row) => row.status !== "removed");
}

export function isEligibleCompetitor(row: LandscapeRowLike): boolean {
  return row.status === "confirmed" && (ELIGIBLE_COMPETITOR_TYPES as readonly string[]).includes(row.competitorType ?? "");
}

export interface TierGroup<T> {
  key: string;
  tier: CompetitorTier | null;
  /** null for the untitled list. */
  heading: string | null;
  subheading: string | null;
  rows: T[];
  suggested: number;
  confirmed: number;
  /** "3 suggested · 1 confirmed"; empty when the group has no rows. */
  countLine: string;
  /** The muted line for a planned tier with no rows. */
  emptyLine: string | null;
  /** True when this tier came from the plan (false for leftovers). */
  planned: boolean;
}

function lowerFirst(value: string): string {
  return value ? value.charAt(0).toLowerCase() + value.slice(1) : value;
}

/** "No suggestions found across {city} yet. Add one below." */
export function emptyTierLine(heading: string): string {
  return `No suggestions found ${lowerFirst(heading)} yet. Add one below.`;
}

/** Heading for a row whose tier is not in the current plan (the profile changed after discovery). */
export function tierHeadingFor(tier: CompetitorTier, place: string | null | undefined): string {
  const name = (place ?? "").trim();
  if (!name) return tier === "area" ? "Nearby" : tier === "city" ? "Across the city" : "Across the country";
  if (tier === "area") return `In ${name}`;
  if (tier === "country") return name.toLowerCase() === "worldwide" ? "Worldwide" : `Across ${countryPhrase(name)}`;
  return `Across ${name}`;
}

function countLine(suggested: number, confirmed: number): string {
  return [suggested > 0 ? `${suggested} suggested` : null, confirmed > 0 ? `${confirmed} confirmed` : null].filter(Boolean).join(" · ");
}

function makeGroup<T extends LandscapeRowLike>(key: string, tier: CompetitorTier | null, heading: string | null, subheading: string | null, rows: T[], planned: boolean): TierGroup<T> {
  const suggested = rows.filter((row) => row.status !== "confirmed").length;
  const confirmed = rows.filter((row) => row.status === "confirmed").length;
  return {
    key,
    tier,
    heading,
    subheading,
    rows,
    suggested,
    confirmed,
    countLine: countLine(suggested, confirmed),
    emptyLine: rows.length === 0 && heading ? emptyTierLine(heading) : null,
    planned,
  };
}

/**
 * Groups visible competitors by tier, in plan order (area → city → country).
 * Returns one untitled group when there is no plan or no row carries a tier.
 * Rows with a tier the plan doesn't have get their own heading after the plan's
 * groups; rows without a tier come last, untitled.
 */
export function groupCompetitorsByTier<T extends LandscapeRowLike>(rows: T[], plan: LandscapeTierPlanDto | null | undefined): TierGroup<T>[] {
  const visible = visibleCompetitors(rows);
  const tiers = plan?.tiers ?? [];
  if (tiers.length === 0 || !visible.some((row) => row.tier)) return [makeGroup("all", null, null, null, visible, false)];

  const used = new Set<T>();
  const groups: TierGroup<T>[] = tiers.map((spec) => {
    const inTier = visible.filter((row) => row.tier === spec.tier);
    for (const row of inTier) used.add(row);
    return makeGroup(`tier:${spec.tier}`, spec.tier, spec.heading, spec.subheading, inTier, true);
  });

  const leftovers = visible.filter((row) => !used.has(row));
  const extraKeys: string[] = [];
  const extras = new Map<string, T[]>();
  for (const row of leftovers) {
    if (!row.tier) continue;
    const key = `extra:${row.tier}:${(row.tierPlace ?? "").toLowerCase()}`;
    if (!extras.has(key)) {
      extras.set(key, []);
      extraKeys.push(key);
    }
    extras.get(key)!.push(row);
  }
  for (const key of extraKeys) {
    const groupRows = extras.get(key)!;
    const first = groupRows[0]!;
    groups.push(makeGroup(key, first.tier!, tierHeadingFor(first.tier!, first.tierPlace), null, groupRows, false));
  }
  const untiered = leftovers.filter((row) => !row.tier);
  if (untiered.length > 0) groups.push(makeGroup("untiered", null, null, null, untiered, false));
  return groups;
}

/**
 * Non-blocking hint under Confirm when some planned tier has no confirmed
 * eligible rival: Trade Off prompts only compare confirmed rivals.
 * "Trade Offs will only compare rivals in {area} and across {city}."
 */
export function tradeOffsHint<T extends LandscapeRowLike>(groups: TierGroup<T>[]): string | null {
  const planned = groups.filter((group) => group.planned && group.heading);
  if (planned.length < 2) return null;
  const covered = planned.filter((group) => group.rows.some(isEligibleCompetitor));
  if (covered.length === 0 || covered.length === planned.length) return null;
  const names = covered.map((group) => lowerFirst(group.heading!));
  const list = names.length === 1 ? names[0] : `${names.slice(0, -1).join(", ")} and ${names.at(-1)}`;
  return `Trade Offs will only compare rivals ${list}.`;
}

const SOURCE_LABEL: Record<string, string> = {
  website_explicit: "Website evidence",
  ai_hypothesis: "AI hypothesis",
  authorized_search: "Search discovery",
  web_search: "Found in web search",
  open_knowledge: "Open knowledge",
  nearby_places: "Found on the map nearby",
  user_manual: "Added manually",
  observed_ai_response: "Observed in AI answers",
  system: "System evidence",
};

/** Shown for a source key the page has no label for. */
export const GENERIC_SOURCE_LABEL = "Discovery evidence";

/**
 * Readable, de-duplicated labels for a row's evidence sources. Unknown keys get
 * the generic label: area-tier map rivals showed the raw key "nearby_places"
 * under their name (review 2026-09-14), so internal keys never reach the page.
 */
export function competitorSourceLabels(sources: ReadonlyArray<string | null | undefined>): string[] {
  const labels = sources.filter((source): source is string => typeof source === "string" && source.trim() !== "").map((source) => SOURCE_LABEL[source] ?? GENERIC_SOURCE_LABEL);
  return [...new Set(labels)];
}

/** Options for the "Where it competes" select when adding a competitor. */
export function tierOptions(plan: LandscapeTierPlanDto | null | undefined): Array<{ value: CompetitorTier; label: string }> {
  return (plan?.tiers ?? []).map((spec) => ({ value: spec.tier, label: spec.heading }));
}

/**
 * Whether opening the page should start generation. A failed run or a run that
 * found nothing no longer re-runs on every visit (that hid the page behind the
 * loading panel each time); those states offer an explicit retry instead.
 */
export function shouldAutoGenerate(input: { liveTopicCount: number; hasDiscovery: boolean; stale: boolean; inFlight: boolean }): boolean {
  if (input.inFlight) return false;
  return input.liveTopicCount === 0 || !input.hasDiscovery || input.stale;
}
