import { parse as parseTld } from "tldts";
import { normalizeForSimilarity } from "@/lib/text/similarity";
import type { CompetitorCandidate } from "./competitor-types";

const LEGAL_SUFFIXES = /\b(incorporated|inc|llc|ltd|limited|plc|corp|corporation|company|co|gmbh|ag|sa|pte|pvt|holdings?)\b/gi;

export function normalizeEntityName(name: string): string {
  return normalizeForSimilarity(name.replace(/[®™©]/g, " ").replace(LEGAL_SUFFIXES, " "));
}

export function canonicalizeDomain(value: string | null | undefined): string | null {
  if (!value) return null;
  try {
    const url = new URL(/^https?:\/\//i.test(value) ? value : `https://${value}`);
    const parsed = parseTld(url.hostname, { allowPrivateDomains: true });
    return (parsed.domain ?? url.hostname).toLowerCase().replace(/^www\./, "");
  } catch {
    return null;
  }
}

export function isTargetEntity(candidate: CompetitorCandidate, targetName: string, targetDomain: string, targetAliases: string[] = []): boolean {
  const targetNames = [targetName, ...targetAliases].map(normalizeEntityName);
  const candidateName = normalizeEntityName(candidate.canonicalName);
  const candidateDomain = canonicalizeDomain(candidate.likelyDomain);
  return targetNames.includes(candidateName) || Boolean(candidateDomain && candidateDomain === canonicalizeDomain(targetDomain));
}

/** Names copied from HTML titles and model output arrive as "Chaps &amp; Co.". */
function decodeEntities(value: string): string {
  return value
    .replace(/&amp;/gi, "&")
    .replace(/&#0*39;|&apos;|&rsquo;|&#8217;/gi, "'")
    .replace(/&quot;/gi, '"')
    .replace(/&nbsp;/gi, " ")
    .replace(/&ndash;|&#8211;/gi, "–");
}

/**
 * The name two sources must share to be one rival: spacing-insensitive, and
 * without a trailing place the target itself is in. Search returned "Akira Back
 * Dubai", "Zuma Dubai" and "SushiArt" while the model proposed "Akira Back",
 * "Zuma" and "Sushi Art", and a Dubai restaurant got both Akira Backs.
 */
export function competitorMergeKey(name: string, places: string[] = []): string {
  let key = normalizeEntityName(name);
  for (const place of places) {
    const suffix = normalizeEntityName(place);
    if (suffix && key.endsWith(` ${suffix}`) && key.length > suffix.length + 1) key = key.slice(0, -suffix.length - 1).trim();
  }
  return key.replace(/\s+/g, "");
}

/** Generic words a source appends to a company name: "Pluto Card" and "Pluto", "Gazebo Restaurant" and "Gazebo" are one rival. */
const GENERIC_NAME_TAILS = ["card", "cards", "app", "software", "platform", "restaurant", "restaurants", "cafe", "salon", "group", "company", "uae", "dubai"];

/** True when the two merge keys differ only by one generic tail on a head of at least five letters. */
export function sameBusinessKey(a: string, b: string): boolean {
  if (a === b) return true;
  const [short, long] = a.length <= b.length ? [a, b] : [b, a];
  if (short.length < 5 || !long.startsWith(short)) return false;
  return GENERIC_NAME_TAILS.includes(long.slice(short.length));
}

export function resolveCompetitorCandidates(candidates: CompetitorCandidate[], places: string[] = []): CompetitorCandidate[] {
  const merged: CompetitorCandidate[] = [];
  for (const rawCandidate of candidates) {
    const candidate = { ...rawCandidate, canonicalName: decodeEntities(rawCandidate.canonicalName), aliases: rawCandidate.aliases.map(decodeEntities) };
    const candidateDomain = canonicalizeDomain(candidate.likelyDomain);
    const candidateName = competitorMergeKey(candidate.canonicalName, places);
    if (!candidateDomain && !candidateName) continue;
    const existing = merged.find((item) => {
      const itemDomain = canonicalizeDomain(item.likelyDomain);
      const itemName = competitorMergeKey(item.canonicalName, places);
      return Boolean(candidateDomain && itemDomain && candidateDomain === itemDomain) || Boolean(candidateName && itemName && sameBusinessKey(itemName, candidateName));
    });
    if (!existing) {
      merged.push({
        ...candidate,
        canonicalName: candidate.canonicalName.trim(),
        likelyDomain: canonicalizeDomain(candidate.likelyDomain),
        aliases: [...new Set(candidate.aliases.map((alias) => alias.trim()).filter(Boolean))],
        matchedDimensions: [...new Set(candidate.matchedDimensions)],
      });
      continue;
    }
    existing.aliases = [...new Set([...existing.aliases, candidate.canonicalName, ...candidate.aliases])].filter(
      (alias) => normalizeEntityName(alias) !== normalizeEntityName(existing.canonicalName),
    );
    existing.evidence = [...existing.evidence, ...candidate.evidence];
    existing.matchedDimensions = [...new Set([...existing.matchedDimensions, ...candidate.matchedDimensions])];
    existing.confidence = Math.max(existing.confidence, candidate.confidence);
    // Keep the strongest structural evidence whichever source found it first:
    // taking only the first source's value lost open-knowledge and search
    // affinity whenever the AI lane also proposed the rival.
    if (candidate.structuralAffinity !== undefined) existing.structuralAffinity = Math.max(existing.structuralAffinity ?? 0, candidate.structuralAffinity);
    // A comparison mention on the target's own site says nothing about the
    // rival's type; a search or model source that knows the business does.
    if (existing.evidence.every((item) => item.source === "website_explicit") && candidate.evidence.some((item) => item.source !== "website_explicit")) {
      existing.proposedType = candidate.proposedType;
      existing.entityType = candidate.entityType;
    }
    // Merge where each source placed the rival field by field. Keeping only the
    // first location lost the map distance whenever the AI lane proposed the
    // same salon first, and distance is the strongest area-tier evidence.
    if (candidate.location) {
      const current = existing.location ?? null;
      existing.location = {
        area: current?.area ?? candidate.location.area ?? null,
        city: current?.city ?? candidate.location.city ?? null,
        country: current?.country ?? candidate.location.country ?? null,
        distanceMeters: typeof current?.distanceMeters === "number" ? current.distanceMeters : candidate.location.distanceMeters ?? null,
      };
    }
    if (candidate.tierHint?.length) existing.tierHint = [...(existing.tierHint ?? []), ...candidate.tierHint];
    if (candidate.chain) existing.chain = true;
    if (candidate.sourceUrls?.length) existing.sourceUrls = [...new Set([...(existing.sourceUrls ?? []), ...candidate.sourceUrls])].slice(0, 4);
    existing.reason = existing.evidence.length > 1 ? `${existing.reason} Multiple discovery signals agree.` : existing.reason;
    if (!existing.likelyDomain) existing.likelyDomain = canonicalizeDomain(candidate.likelyDomain);
  }
  return merged.sort((a, b) => b.confidence - a.confidence || a.canonicalName.localeCompare(b.canonicalName));
}
