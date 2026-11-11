// Scoring for the onboarding golden set (Understand → Landscape → Prompts).
//
// Pure functions over plain data so they can be unit-tested and reused by
// scripts/eval-onboarding.ts. Every check returns pass/fail with the observed
// value, so a report says what was wrong rather than only a number.

export type GoldenTier = "area" | "city" | "country";

export interface GoldenExpect {
  brand: string[];
  kinds: string[];
  city: string[];
  area: string[];
  country: string | null;
  scopes: string[];
  placeBound: boolean | null;
  healthcareWordsAllowed: boolean;
  /** Competitor tiers the Landscape plan should have, in order (tiers spec §9). */
  tiers?: GoldenTier[];
  /** Other plans that are also defensible (a destination restaurant with or without a country tier). */
  acceptTiers?: GoldenTier[][];
}

export interface GoldenResearchedCompetitor {
  name: string;
  url?: string;
  /** The tier this rival should land in; a list where two tiers are defensible. */
  tier?: GoldenTier | GoldenTier[];
}

export interface GoldenCase {
  id: string;
  url: string;
  expect: GoldenExpect;
  researched?: { competitors?: GoldenResearchedCompetitor[] } & Record<string, unknown>;
}

export interface Check {
  name: string;
  pass: boolean;
  observed: string;
}

const norm = (value: string | null | undefined) => (value ?? "").normalize("NFKD").replace(/[̀-ͯ]/g, "").toLowerCase().replace(/[^\p{L}\p{N}]+/gu, " ").trim();
const contains = (haystack: string | null | undefined, needle: string) => ` ${norm(haystack)} `.includes(` ${norm(needle)} `) || norm(haystack).includes(norm(needle));

export interface UnderstandingObserved {
  brand: string;
  aliases: string[];
  kind: string | null;
  path: string[];
  archetype: string;
  regulated: string[];
  location: { neighborhood: string | null; district: string | null; city: string | null; region: string | null; countryCode: string | null; formattedAddress: string | null } | null;
  nearbyAreas: string[];
  scope: string;
  offeringCount: number;
  audienceCount: number;
  descriptionLength: number;
  synthesisMode: string;
}

export function scoreUnderstanding(expect: GoldenExpect, observed: UnderstandingObserved): Check[] {
  const checks: Check[] = [];
  const names = [observed.brand, ...observed.aliases];
  checks.push({ name: "brand", pass: expect.brand.some((b) => names.some((n) => contains(n, b) || contains(b, n))), observed: names.join(" | ") });
  checks.push({ name: "business kind", pass: observed.kind !== null && expect.kinds.includes(observed.kind), observed: `${observed.kind ?? "none"} (${observed.path.join(" › ")})` });
  if (!expect.healthcareWordsAllowed) {
    checks.push({ name: "not healthcare", pass: observed.kind !== "healthcare_medical" && observed.archetype !== "healthcare" && !observed.regulated.includes("healthcare"), observed: `${observed.kind}/${observed.archetype}/${observed.regulated.join(",") || "unregulated"}` });
  }
  const loc = observed.location;
  if (expect.country) checks.push({ name: "country", pass: loc?.countryCode === expect.country, observed: loc?.countryCode ?? "none" });
  if (expect.city.length > 0) {
    const cityText = [loc?.city, loc?.region, loc?.district].filter(Boolean).join(" | ");
    checks.push({ name: "city", pass: expect.city.some((c) => contains(cityText, c)), observed: cityText || "none" });
  }
  if (expect.area.length > 0) {
    const areaText = [loc?.neighborhood, loc?.district, loc?.formattedAddress, ...observed.nearbyAreas].filter(Boolean).join(" | ");
    checks.push({ name: "neighbourhood/area", pass: expect.area.some((a) => contains(areaText, a)), observed: areaText || "none" });
  }
  checks.push({ name: "market scope", pass: expect.scopes.includes(observed.scope), observed: observed.scope });
  checks.push({ name: "offerings found", pass: observed.offeringCount >= 3, observed: String(observed.offeringCount) });
  checks.push({ name: "audience segments", pass: observed.audienceCount >= 2, observed: String(observed.audienceCount) });
  checks.push({ name: "description", pass: observed.descriptionLength >= 60, observed: `${observed.descriptionLength} chars` });
  return checks;
}

export interface CompetitorObserved {
  name: string;
  domain: string | null;
  status: string;
  type: string | null;
  rejectionReason: string | null;
  tier?: GoldenTier | null;
}

const host = (url?: string | null) => {
  if (!url) return null;
  try {
    return new URL(/^https?:/.test(url) ? url : `https://${url}`).hostname.replace(/^www\./, "");
  } catch {
    return null;
  }
};

function matchesResearched(c: CompetitorObserved, r: { name: string; url?: string }): boolean {
  const rHost = host(r.url);
  const cHost = host(c.domain);
  const rCore = norm(r.name.replace(/\(.*\)/, ""));
  return Boolean((rHost && cHost && (rHost === cHost || rHost.endsWith(cHost) || cHost.endsWith(rHost))) || (rCore.length >= 4 && (contains(c.name, rCore) || contains(rCore, c.name))));
}

export function scoreCompetitors(researched: Array<{ name: string; url?: string }>, observed: CompetitorObserved[], brand: string): Check[] {
  const suggested = observed.filter((c) => c.status !== "removed");
  const matches = matchesResearched;
  const found = researched.filter((r) => suggested.some((c) => matches(c, r)));
  const foundAnywhere = researched.filter((r) => observed.some((c) => matches(c, r)));
  return [
    { name: "suggested competitors", pass: suggested.filter((c) => c.type !== "marketplace").length >= 3, observed: suggested.map((c) => `${c.name}${c.type === "marketplace" ? " (marketplace)" : ""}`).join(", ") || "none" },
    { name: "researched rivals suggested", pass: found.length >= Math.min(2, researched.length), observed: `${found.length}/${researched.length}: ${found.map((r) => r.name).join(", ")}` },
    { name: "researched rivals seen (incl. rejected)", pass: foundAnywhere.length >= found.length, observed: `${foundAnywhere.length}/${researched.length}` },
    { name: "target not suggested", pass: !suggested.some((c) => contains(c.name, brand) || contains(brand, c.name)), observed: brand },
  ];
}

export interface TierPlanObserved {
  tiers: GoldenTier[];
  primaryTier: GoldenTier | null;
}

const sameTiers = (a: GoldenTier[], b: GoldenTier[]) => a.length === b.length && a.every((tier, index) => tier === b[index]);

/**
 * Competitor tier checks (tiers spec §12). "tiers populated" is informational
 * for area and city on free-tier keys: without billed search those groups are
 * fed by map data and verified model guesses only (KNOWN_ISSUES).
 */
export function scoreTiers(golden: GoldenCase, plan: TierPlanObserved | null, observed: CompetitorObserved[]): Check[] {
  const expected = golden.expect.tiers;
  if (!expected) return [];
  const observedTiers = plan?.tiers ?? [];
  const accepted = [expected, ...(golden.expect.acceptTiers ?? [])];
  const suggested = observed.filter((c) => c.status !== "removed" && c.type !== "marketplace");
  const checks: Check[] = [
    { name: "tier plan", pass: accepted.some((tiers) => sameTiers(tiers, observedTiers)), observed: observedTiers.join(" + ") || "none" },
  ];
  const counts = observedTiers.map((tier) => `${tier} ${suggested.filter((c) => c.tier === tier).length}`);
  const primaryCount = plan?.primaryTier ? suggested.filter((c) => c.tier === plan.primaryTier).length : 0;
  checks.push({ name: "tiers populated", pass: observedTiers.length > 0 && observedTiers.every((tier) => suggested.some((c) => c.tier === tier)) && primaryCount >= 3, observed: `${counts.join(", ") || "none"}; primary ${plan?.primaryTier ?? "none"} ${primaryCount}` });
  const withTier = (golden.researched?.competitors ?? []).filter((r) => r.tier);
  const found = withTier.map((r) => ({ r, c: suggested.find((c) => matchesResearched(c, r)) })).filter((row) => row.c);
  const misplaced = found.filter(({ r, c }) => !(Array.isArray(r.tier) ? r.tier : [r.tier]).includes(c!.tier as GoldenTier));
  checks.push({ name: "researched rival tier", pass: misplaced.length === 0, observed: `${found.length - misplaced.length}/${found.length} found in an accepted tier${misplaced.length ? `; misplaced: ${misplaced.map(({ r, c }) => `${r.name} in ${c!.tier ?? "none"}`).join(", ")}` : ""}` });
  if (!expected.includes("country") && expected.includes("area")) {
    checks.push({ name: "no country tier for a strictly local business", pass: !observedTiers.includes("country") || (golden.expect.acceptTiers ?? []).some((tiers) => tiers.includes("country")), observed: observedTiers.join(" + ") || "none" });
  }
  if (sameTiers(expected, ["country"])) {
    checks.push({ name: "no area/city tier for HQ-only or online businesses", pass: !observedTiers.includes("area") && !observedTiers.includes("city"), observed: observedTiers.join(" + ") || "none" });
  }
  return checks;
}

export interface PromptObserved {
  section: string;
  text: string;
  geographyScope: string;
  geographyText: string | null;
}

const HEALTHCARE_WORDS = /\b(clinic|clinics|doctor|doctors|hospital|hospitals|patient|patients|physician|medical)\b/i;

export function scorePrompts(expect: GoldenExpect, prompts: PromptObserved[], brandForms: string[]): Check[] {
  const discovery = prompts.filter((p) => p.section === "Discovery");
  const checks: Check[] = [];
  checks.push({ name: "10/10/10", pass: ["Discovery", "Trade Offs", "Sentiment Analysis"].every((s) => prompts.filter((p) => p.section === s).length === 10), observed: ["Discovery", "Trade Offs", "Sentiment Analysis"].map((s) => prompts.filter((p) => p.section === s).length).join("/") });
  if (!expect.healthcareWordsAllowed) {
    const bad = prompts.filter((p) => HEALTHCARE_WORDS.test(p.text));
    checks.push({ name: "no clinic/doctor wording", pass: bad.length === 0, observed: bad.map((p) => p.text).join(" | ") || "none" });
  }
  const leaked = discovery.filter((p) => brandForms.some((b) => b.length >= 3 && contains(p.text, b)));
  checks.push({ name: "discovery unbranded", pass: leaked.length === 0, observed: leaked.map((p) => p.text).join(" | ") || "none" });
  if (expect.placeBound) {
    const placed = discovery.filter((p) => p.geographyScope !== "none");
    const levels = new Set(placed.map((p) => p.geographyScope));
    checks.push({ name: "discovery names a place", pass: placed.length >= 8, observed: `${placed.length}/10` });
    checks.push({ name: "several geography levels", pass: levels.size >= 2, observed: [...levels].join(", ") || "none" });
    if (expect.area.length > 0) {
      const areaPrompts = discovery.filter((p) => p.geographyScope === "neighborhood" || p.geographyScope === "district");
      checks.push({ name: "neighbourhood-level prompts", pass: areaPrompts.length >= 2, observed: String(areaPrompts.length) });
    }
  }
  const openings = new Set(prompts.map((p) => norm(p.text).split(" ").slice(0, 2).join(" ")));
  checks.push({ name: "varied openings", pass: openings.size >= 15, observed: `${openings.size} distinct two-word openings in ${prompts.length}` });
  const lengths = prompts.map((p) => p.text.split(/\s+/).length);
  checks.push({ name: "natural length", pass: lengths.filter((n) => n >= 4 && n <= 24).length >= prompts.length - 2, observed: `${Math.min(...lengths)}-${Math.max(...lengths)} words` });
  return checks;
}

export function summarize(checks: Check[]): { passed: number; total: number } {
  return { passed: checks.filter((c) => c.pass).length, total: checks.length };
}
