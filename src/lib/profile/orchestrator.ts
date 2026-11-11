// Progressive Brand Profile generation.
//
// This is the "do not make the user watch a spinner" requirement made real.
// The pipeline is driven by the crawl's per-page evidence callback: as soon as
// the homepage lands we can name the brand; a handful of pages later we have an
// industry and offerings; the market usually settles last. Each time a field
// materially changes, a `profile.field.updated` event carries it to the UI and
// a partial profile version is persisted so a browser refresh resumes.
//
// The final pass re-runs the deterministic baseline over the complete evidence
// set and then runs Business Understanding (`lib/understanding`): one
// structured model call over the site's own pages and facts, grounded back to
// evidence ids, followed by location resolution. Partial profiles stay
// rules-based so the crawl never waits on a model. With no model available, or
// if the call fails, the deterministic profile ships and says so.
//
// Two optional inputs join the final pass. The operator's intake answer
// ("Where are your customers?", `projects.market_scope`) is read once here and
// applied only to the final profile, by code; a rules-only profile still gets
// it through the location fallback, because silently dropping what the
// operator told us was the failure mode. Google Search Console, when the
// operator switched it on, is pulled alongside the crawl: its top pages steer
// the crawl planner, and its code-computed signals reach the digest and the
// location votes. The crawl never waits for it; understanding waits at most
// SUN_GSC_WAIT_MS (20 s) and then continues without it.

import { getDb } from "@/lib/db/client";
import { clearProviderSuspension } from "@/lib/llm/suspension";
import { locations } from "@/lib/db/schema";
import { newId } from "@/lib/ids";
import { appendEvent } from "@/lib/events/bus";
import { getProject } from "@/lib/projects/repository";
import { runCrawl, type CrawledPageRecord, type CrawlOutcome } from "@/lib/crawler/orchestrator";
import { mergeCrawlRunMetrics, type CrawlRunMetrics } from "@/lib/crawler/repository";
import { countryName } from "@/lib/geo/countries";
import { parseMarketHint, type MarketHint } from "@/lib/projects/market-hint";
import { buildSearchConsoleSignals, startSearchConsoleSync, summarizeForProfile, type SearchConsoleSyncHandle } from "@/lib/search-console/pipeline";
import type { GscMetricRow, GscPullResult, SearchConsoleSignals, SignalsContext } from "@/lib/search-console/types";
import { buildEvidencePack } from "@/lib/evidence/pack";
import type { EvidenceItem } from "@/lib/evidence/types";
import { buildDeterministicProfile, type PageSummary } from "./deterministic-extractor";
import { classifyIndustry } from "./industry-classifier";
import { DeterministicProfileProvider } from "./synthesizer";
import { isUnderstandingAvailable, runBusinessUnderstanding } from "@/lib/understanding";
import type { DigestPageInput } from "@/lib/understanding/digest";
import { applyLocationResult, resolveLocation, type LocationInput } from "@/lib/understanding/location";
import { assertEvidenceIntegrity, evidenceCoverage } from "./validator";
import { createProfileVersion, updateProfileVersion, getLatestProfileVersion, type BusinessProfileVersionRow } from "./repository";
import { emptyProfile, type BusinessProfile } from "./schema";
import { mergeUserEdits } from "./merge";

/** Emit a partial profile once this many pages have contributed evidence. */
const FIRST_PARTIAL_AFTER_PAGES = 1;
const REFRESH_EVERY_PAGES = 2;

export interface WebsiteIntelligenceOptions {
  /** Pull Google Search Console for this run (resolved by the crawl pipeline). Off when absent. */
  searchConsole?: { enabled: boolean };
  /** Test seam: replaces the Search Console facade. */
  searchConsoleSync?: typeof startSearchConsoleSync;
  /** Geocoding lookups (OpenStreetMap or Google). Tests turn this off. */
  allowNetwork?: boolean;
}

type SearchConsolePull = Extract<GscPullResult, { ok: true }>;

const DEFAULT_SEARCH_CONSOLE_WAIT_MS = 20_000;

function searchConsoleWaitMs(): number {
  const raw = process.env.SUN_GSC_WAIT_MS;
  const value = raw ? Number(raw) : NaN;
  return Number.isFinite(value) && value >= 0 ? value : DEFAULT_SEARCH_CONSOLE_WAIT_MS;
}

export interface ProfileRunResult {
  version: BusinessProfileVersionRow;
  profile: BusinessProfile;
  crawl?: CrawlOutcome;
}

/**
 * Runs the whole Website Intelligence pipeline for a project: crawl, evidence,
 * progressive synthesis, final refinement, persistence.
 */
export async function runWebsiteIntelligence(projectId: string, options: WebsiteIntelligenceOptions = {}): Promise<ProfileRunResult> {
  // A new analysis asks the paid models again: credits may have been added since a refusal.
  clearProviderSuspension();
  const project = await getProject(projectId);
  if (!project) throw new Error(`project ${projectId} not found`);
  // The only read of the intake hint. Partial profiles ignore it.
  const marketHint = parseMarketHint(project.marketScope);
  const searchConsoleEnabled = options.searchConsole?.enabled === true;
  const searchConsole: { handle: SearchConsoleSyncHandle | null } = { handle: null };
  let resolveSearchPages: (rows: GscMetricRow[]) => void = () => undefined;
  const searchPages = searchConsoleEnabled
    ? new Promise<GscMetricRow[]>((resolve) => {
        resolveSearchPages = resolve;
      })
    : undefined;

  const seedHostname = new URL(project.url).hostname;
  let partial: BusinessProfile = emptyProfile(project.registrableDomain);
  let partialVersion: BusinessProfileVersionRow | undefined;
  let pagesContributed = 0;
  const pageSummaries: PageSummary[] = [];
  const lastEmitted = new Map<string, string>();

  const emitChangedFields = (profile: BusinessProfile) => {
    const snapshots: Array<{ field: string; value: unknown; confidence: number }> = [
      { field: "brandName", value: profile.identity.brandName.value, confidence: profile.identity.brandName.confidence },
      { field: "description", value: profile.description.value, confidence: profile.description.confidence },
      { field: "industry", value: profile.industry.value, confidence: profile.industry.confidence },
      { field: "archetype", value: profile.archetype.value, confidence: profile.archetype.confidence },
      { field: "offerings", value: profile.offerings.items.map((o) => o.name), confidence: profile.offerings.confidence },
      { field: "brandIdentity", value: profile.brandIdentity.map((t) => t.value), confidence: profile.brandIdentity[0]?.confidence ?? 0 },
      { field: "targetAudience", value: profile.targetAudience.map((a) => a.value), confidence: profile.targetAudience[0]?.confidence ?? 0 },
      { field: "markets", value: profile.markets.map((m) => m.name), confidence: profile.markets[0]?.confidence ?? 0 },
      { field: "marketScope", value: profile.marketScope.value, confidence: profile.marketScope.confidence },
    ];
    for (const snapshot of snapshots) {
      const serialized = JSON.stringify(snapshot.value);
      if (serialized === "null" || serialized === '""' || serialized === "[]") continue;
      if (lastEmitted.get(snapshot.field) === serialized) continue;
      lastEmitted.set(snapshot.field, serialized);
      appendEvent(projectId, "profile.field.updated", {
        field: snapshot.field,
        value: snapshot.value,
        confidence: snapshot.confidence,
        stage: "partial",
      });
    }
  };

  const refreshPartial = async (evidence: EvidenceItem[]) => {
    partial = buildDeterministicProfile({
      evidence,
      pages: pageSummaries,
      canonicalDomain: project.registrableDomain,
      seedUrl: project.url,
      seedHostname,
    });
    // A partial profile still gets a real description so the screen is useful
    // before the crawl finishes.
    const draft = await new DeterministicProfileProvider().synthesizeProfile(
      buildEvidencePack({
        projectId,
        runId: "partial",
        canonicalDomain: project.registrableDomain,
        seedUrl: project.url,
        evidence,
        pages: pageSummaries,
        baseline: partial,
        industry: classifyIndustry(evidence),
      }),
      partial,
    );
    partial = draft.profile;
    emitChangedFields(partial);

    const existing = partialVersion;
    if (existing) {
      await updateProfileVersion(existing.id, partial, { status: "partial", synthesisMode: "deterministic" });
    } else {
      partialVersion = await createProfileVersion(projectId, null, partial, { status: "partial", synthesisMode: "deterministic" });
    }
  };

  appendEvent(projectId, "profile.synthesis.started", { mode: isUnderstandingAvailable() ? "llm_grounded" : "deterministic" });

  const crawl = await runCrawl(projectId, project.url, project.language, {
    searchConsoleRequested: searchConsoleEnabled,
    searchPages,
    // Started once the run row exists, so its events carry the crawl run id and
    // land between profile.synthesis.started and crawl.started (the Understand
    // page scopes its progress rail from the synthesis event).
    onRunCreated: (crawlRunId) => {
      if (!searchConsoleEnabled) return;
      try {
        const handle = (options.searchConsoleSync ?? startSearchConsoleSync)({
          projectId,
          projectUrl: project.url,
          registrableDomain: project.registrableDomain,
          crawlRunId,
        });
        searchConsole.handle = handle;
        handle.pages.then(resolveSearchPages, () => resolveSearchPages([]));
      } catch (err) {
        resolveSearchPages([]);
        appendEvent(projectId, "policy.status", { stage: "search_console", error: message(err) });
      }
    },
    onPageEvidence: async (page: CrawledPageRecord, _pageEvidence, allEvidence) => {
      pageSummaries.push({ id: page.id, url: page.url, pageType: page.pageType, title: page.title });
      pagesContributed++;
      const shouldRefresh = pagesContributed <= FIRST_PARTIAL_AFTER_PAGES || pagesContributed % REFRESH_EVERY_PAGES === 0;
      if (shouldRefresh) {
        try {
          await refreshPartial(allEvidence);
        } catch (err) {
          // A partial-refresh failure must never abort the crawl.
          appendEvent(projectId, "policy.status", { stage: "partial_profile", error: message(err) });
        }
      }
    },
  });

  if (crawl.status !== "completed" || crawl.evidence.length === 0) {
    const reason = crawl.blockReason ?? "no_evidence";
    const failedProfile = structuredClone(partial);
    // A blocked site is exactly when the website cannot say where the business
    // is, so the intake answer must still reach the profile the operator fills
    // in by hand (review 2026-09-14: DIFC and AE were dropped on this path).
    const hintWarnings =
      marketHint && !failedProfile.location
        ? await applyLocationWithoutModel(failedProfile, {
            evidence: crawl.evidence,
            seedHostname,
            allowNetwork: options.allowNetwork ?? true,
            hint: marketHint,
            searchConsole: null,
          })
        : [];
    // The crawl reason stays last: the Understand page shows the last warning
    // as the failure banner (verify 2026-09-14: an unmatched area hid the DNS reason).
    const failureWarning = crawlFailureMessage(reason);
    failedProfile.quality = {
      ...failedProfile.quality,
      warnings: [...failedProfile.quality.warnings, ...hintWarnings].filter((w, i, all) => w !== failureWarning && all.indexOf(w) === i).concat(failureWarning),
    };
    const existingVersion: BusinessProfileVersionRow | undefined = partialVersion;
    const version = existingVersion
      ? await updateProfileVersion(existingVersion.id, failedProfile, { status: "failed", crawlRunId: crawl.crawlRunId, synthesisMode: "deterministic" })
      : await createProfileVersion(projectId, crawl.crawlRunId, failedProfile, { status: "failed", synthesisMode: "deterministic" });
    appendEvent(projectId, "profile.failed", { reason, crawlRunId: crawl.crawlRunId });
    // The run still records what happened to the pull (a blocked site with a
    // connected property is exactly when the operator asks "did Google work?"),
    // without holding the job key while the pull finishes.
    const failedRunHandle = searchConsole.handle;
    if (failedRunHandle) {
      void failedRunHandle
        .result(searchConsoleWaitMs())
        .then((pull) => mergeCrawlRunMetrics(crawl.crawlRunId, searchConsoleRunMetrics(pull)))
        .catch(() => undefined);
    }
    return { version, profile: failedProfile, crawl };
  }

  // Rarely a real wait: the crawl usually outlasts the pull.
  const pull: GscPullResult | null = searchConsole.handle
    ? await searchConsole.handle.result(searchConsoleWaitMs()).catch((): GscPullResult => ({ ok: false, kind: "failed", reason: "google_unavailable" }))
    : null;

  const finalProfile = await synthesizeFinalProfile({
    projectId,
    crawlRunId: crawl.crawlRunId,
    marketHint,
    searchConsole: pull?.ok ? pull : null,
    allowNetwork: options.allowNetwork,
    evidence: crawl.evidence,
    pages: crawl.pages.filter((p) => p.isSelected).map((p) => ({ id: p.id, url: p.url, pageType: p.pageType, title: p.title })),
    pageTexts: crawl.pages
      .filter((p) => p.isSelected)
      .map((p) => ({ pageId: p.id, url: p.url, pageType: p.pageType, title: p.title, mainText: p.extracted.mainText, headings: p.extracted.headings, navLabels: p.extracted.navLabels })),
    canonicalDomain: project.registrableDomain,
    seedUrl: crawl.seedUrl,
    seedHostname,
  });

  emitChangedFields(finalProfile);
  if (pull) await mergeCrawlRunMetrics(crawl.crawlRunId, searchConsoleRunMetrics(pull));

  const completedVersion: BusinessProfileVersionRow | undefined = partialVersion;
  const version = completedVersion
    ? await updateProfileVersion(completedVersion.id, finalProfile, {
        status: "complete",
        crawlRunId: crawl.crawlRunId,
        synthesisMode: finalProfile.quality.synthesisMode,
      })
    : await createProfileVersion(projectId, crawl.crawlRunId, finalProfile, {
        status: "complete",
        synthesisMode: finalProfile.quality.synthesisMode,
      });

  await persistLocations(projectId, finalProfile);

  appendEvent(projectId, "profile.ready", {
    profileVersionId: version.id,
    version: version.version,
    confidence: finalProfile.quality.overallConfidence,
    synthesisMode: finalProfile.quality.synthesisMode,
    evidenceItems: finalProfile.quality.evidenceItemCount,
    pagesAnalyzed: finalProfile.quality.pagesAnalyzed,
    durationMs: crawl.metrics.durationMs,
  });

  return { version, profile: finalProfile, crawl };
}

export interface SynthesizeInput {
  projectId: string;
  crawlRunId: string;
  evidence: EvidenceItem[];
  pages: PageSummary[];
  /** Page text for the understanding model. Without it only rules run. */
  pageTexts?: DigestPageInput[];
  canonicalDomain: string;
  seedUrl: string;
  seedHostname: string;
  /** Geocoding lookups (OpenStreetMap or Google). Tests turn this off. */
  allowNetwork?: boolean;
  /** The operator's intake answer; applied to the final profile only. */
  marketHint?: MarketHint | null;
  /** A successful Search Console pull for this run. */
  searchConsole?: SearchConsolePull | null;
}

/** The final pass: full-evidence baseline, then validated LLM refinement. */
export async function synthesizeFinalProfile(input: SynthesizeInput): Promise<BusinessProfile> {
  const baseline = buildDeterministicProfile({
    evidence: input.evidence,
    pages: input.pages,
    canonicalDomain: input.canonicalDomain,
    seedUrl: input.seedUrl,
    seedHostname: input.seedHostname,
  });

  const pack = buildEvidencePack({
    projectId: input.projectId,
    runId: input.crawlRunId,
    canonicalDomain: input.canonicalDomain,
    seedUrl: input.seedUrl,
    evidence: input.evidence,
    pages: input.pages,
    baseline,
    industry: classifyIndustry(input.evidence),
  });
  // The rules-based description and field clean-up run first; understanding
  // then replaces what it can ground, and whatever it cannot stays as is.
  const deterministic = await new DeterministicProfileProvider().synthesizeProfile(pack, baseline);
  let profile = deterministic.profile;
  const synthesisWarnings = [...deterministic.warnings];
  const navLabels = [...new Set(input.pageTexts?.find((p) => p.pageType === "home")?.navLabels ?? [])].slice(0, 30);
  const pull = input.searchConsole ?? null;
  // First pass: brand terms and places from the rules baseline. Recomputed
  // below with the final brand name and location. The operator hint is not a
  // place source here: Search Console is an independent vote, and a hint that
  // shaped its place mentions would then be "confirmed" by them (plan X5).
  const preliminarySignals = pull ? searchConsoleSignals(input.projectId, pull, searchConsoleContext(profile, input.canonicalDomain, navLabels)) : null;

  if (input.pageTexts && input.pageTexts.length > 0 && isUnderstandingAvailable()) {
    appendEvent(input.projectId, "profile.understanding.stage", { stage: "reading", pages: input.pageTexts.length });
    try {
      const understood = await runBusinessUnderstanding({
        projectId: input.projectId,
        evidence: input.evidence,
        pages: input.pageTexts,
        canonicalDomain: input.canonicalDomain,
        seedHostname: input.seedHostname,
        baseline: profile,
        allowNetwork: input.allowNetwork ?? true,
        marketHint: input.marketHint ?? null,
        searchConsole: preliminarySignals,
        onStage: (stage, detail) => appendEvent(input.projectId, "profile.understanding.stage", { stage, ...(detail ?? {}) }),
      });
      if ("error" in understood) {
        synthesisWarnings.push("The AI reading of the website failed, so this profile was built by rules only. Re-analyse to try again.");
        appendEvent(input.projectId, "policy.status", { stage: "business_understanding", error: understood.error });
      } else {
        profile = understood.profile;
        appendEvent(input.projectId, "profile.understanding.stage", {
          stage: "done",
          model: understood.model,
          costUsd: understood.costUsd,
          calls: understood.calls,
          droppedClaims: understood.rejected.length,
        });
      }
    } catch (err) {
      synthesisWarnings.push("The AI reading of the website failed, so this profile was built by rules only. Re-analyse to try again.");
      appendEvent(input.projectId, "policy.status", { stage: "business_understanding", error: message(err) });
    }
  }

  // Rules-only fallback: no model key, or the call failed. resolveLocation reads
  // structured addresses, phones, the domain ending and currency straight from
  // evidence, so the operator's answer still yields a real Location card
  // instead of vanishing with the model. "other" is not place-bound, so an area
  // gives a local or regional scope; the operator can correct the type.
  if (!profile.location && (input.marketHint || preliminarySignals?.sufficient)) {
    const warnings = await applyLocationWithoutModel(profile, {
      evidence: input.evidence,
      seedHostname: input.seedHostname,
      allowNetwork: input.allowNetwork ?? true,
      hint: input.marketHint ?? null,
      searchConsole: preliminarySignals,
    });
    synthesisWarnings.push(...warnings);
  }

  if (pull && preliminarySignals) {
    const finalSignals = searchConsoleSignals(input.projectId, pull, searchConsoleContext(profile, input.canonicalDomain, navLabels)) ?? preliminarySignals;
    try {
      profile.searchConsole = summarizeForProfile(finalSignals, pull.match, profile.offerings.values, pull.rawEvidenceHash);
    } catch (err) {
      appendEvent(input.projectId, "policy.status", { stage: "search_console", error: message(err) });
    }
  }

  // Hard invariant: nothing leaves this function citing an id that does not
  // exist. A failure here is a bug in synthesis, not a user-facing condition.
  const knownIds = new Set(input.evidence.map((e) => e.id));
  const integrity = assertEvidenceIntegrity(profile, knownIds);
  if (!integrity.ok) {
    for (const problem of integrity.problems.slice(0, 5)) {
      appendEvent(input.projectId, "policy.status", { stage: "evidence_integrity", problem });
    }
    stripUnknownEvidenceIds(profile, knownIds);
  }

  const coverage = evidenceCoverage(profile);
  profile.quality = {
    ...profile.quality,
    evidenceItemCount: input.evidence.length,
    pagesAnalyzed: input.pages.length,
    warnings: [
      ...profile.quality.warnings,
      ...synthesisWarnings,
      ...(coverage.gaps.length > 0 ? [`${coverage.gaps.length} field(s) lack supporting evidence and were flagged for review.`] : []),
    ].filter((w, i, all) => all.indexOf(w) === i).slice(0, 10),
  };

  return profile;
}

/**
 * The rules-only location pass: no model-read addresses or areas, only what
 * resolveLocation reads from evidence plus the operator hint and Search Console.
 * Shared by the final synthesis and the crawl-failure path. Returns warnings.
 */
async function applyLocationWithoutModel(
  profile: BusinessProfile,
  input: Pick<LocationInput, "evidence" | "seedHostname" | "allowNetwork" | "hint" | "searchConsole">,
): Promise<string[]> {
  const result = await resolveLocation({
    addresses: [],
    serviceAreas: [],
    nearbyAreas: [],
    countriesServed: [],
    llmScope: "",
    scopeRationale: "",
    locationCount: "unknown",
    kind: "other",
    presence: "unknown",
    ...input,
  });
  applyLocationResult(profile, result);
  return result.warnings;
}

function searchConsoleSignals(projectId: string, pull: SearchConsolePull, ctx: SignalsContext): SearchConsoleSignals | null {
  try {
    return buildSearchConsoleSignals(pull.snapshot, ctx);
  } catch (err) {
    // Search Console is optional: a bad snapshot must never cost the profile.
    appendEvent(projectId, "policy.status", { stage: "search_console", error: message(err) });
    return null;
  }
}

type MixLevel = SignalsContext["places"][number]["level"];

const MARKET_LEVEL_TO_MIX: Partial<Record<string, MixLevel>> = {
  neighborhood: "neighborhood",
  district: "neighborhood",
  city: "city",
  region: "region",
  country: "country",
  "multi-country": "country",
  multi_country: "country",
};

/** What the Search Console signals need to know about this business: its names, places and vocabulary. */
function searchConsoleContext(profile: BusinessProfile, domain: string, navLabels: string[]): SignalsContext {
  const places: SignalsContext["places"] = [];
  const add = (name: string | null | undefined, level: MixLevel | undefined) => {
    const trimmed = name?.trim();
    if (!trimmed || !level || places.some((p) => p.name.toLowerCase() === trimmed.toLowerCase())) return;
    places.push({ name: trimmed, level });
  };
  const location = profile.location;
  if (location) {
    add(location.primary?.neighborhood, "neighborhood");
    add(location.primary?.district, "neighborhood");
    add(location.primary?.city, "city");
    add(location.primary?.region, "region");
    add(location.primary?.country, "country");
    for (const area of location.nearbyAreas) add(area, "nearby");
    for (const area of location.serviceAreas) add(area.name, MARKET_LEVEL_TO_MIX[area.level]);
    for (const branch of location.branches) add(branch.city, "city");
    for (const code of location.countriesServed) add(countryName(code), "country");
  }
  for (const market of profile.markets) add(market.name, MARKET_LEVEL_TO_MIX[market.level]);
  return {
    brandName: profile.identity.brandName.value,
    aliases: profile.identity.aliases.values,
    domain: profile.identity.canonicalDomain || domain,
    places: places.slice(0, 40),
    offeringVocabulary: [...new Set([...profile.offerings.values, ...navLabels])].slice(0, 80),
  };
}

function searchConsoleRunMetrics(pull: GscPullResult): CrawlRunMetrics {
  if (!pull.ok) return { searchConsoleStatus: `${pull.kind}:${pull.reason}` };
  const { snapshot } = pull;
  return {
    searchConsoleStatus: "used",
    searchConsoleSiteUrl: snapshot.siteUrl,
    searchConsoleRows: snapshot.queries.length + snapshot.pages.length + snapshot.countries.length + snapshot.primaryCountryQueries.length,
  };
}

function stripUnknownEvidenceIds(profile: BusinessProfile, knownIds: Set<string>): void {
  const filter = (ids: string[]) => ids.filter((id) => knownIds.has(id));
  profile.identity.brandName.evidenceIds = filter(profile.identity.brandName.evidenceIds);
  profile.identity.aliases.evidenceIds = filter(profile.identity.aliases.evidenceIds);
  profile.description.evidenceIds = filter(profile.description.evidenceIds);
  profile.industry.evidenceIds = filter(profile.industry.evidenceIds);
  profile.archetype.evidenceIds = filter(profile.archetype.evidenceIds);
  profile.offerings.evidenceIds = filter(profile.offerings.evidenceIds);
  profile.offerings.items = profile.offerings.items.map((o) => ({ ...o, evidenceIds: filter(o.evidenceIds) }));
  profile.brandIdentity = profile.brandIdentity.map((t) => ({ ...t, evidenceIds: filter(t.evidenceIds) }));
  profile.targetAudience = profile.targetAudience.map((a) => ({ ...a, evidenceIds: filter(a.evidenceIds) }));
  profile.markets = profile.markets.map((m) => ({ ...m, evidenceIds: filter(m.evidenceIds) }));
  profile.geography.evidenceIds = filter(profile.geography.evidenceIds);
}

function crawlFailureMessage(reason: string): string {
  switch (reason) {
    case "robots_disallowed":
      return "This site's robots.txt asks crawlers not to index it, so no evidence could be collected. You can complete the profile manually.";
    case "no_pages_fetched":
      return "No page on this site could be fetched. It may be offline, blocking automated requests, or behind a login.";
    case "private_address":
    case "blocked_hostname":
      return "That address resolves to a private or internal host and cannot be analysed.";
    case "dns_resolution_failed":
      return "That domain could not be resolved. Check the spelling and try again.";
    default:
      return `The crawl could not complete (${reason}). You can complete the profile manually.`;
  }
}

function message(err: unknown): string {
  return err instanceof Error ? err.message : "unknown_error";
}

async function persistLocations(projectId: string, profile: BusinessProfile): Promise<void> {
  const db = getDb();
  const rows: Array<typeof locations.$inferInsert> = [];
  for (const market of profile.markets) {
    // Levels now include neighborhood and district (a DIFC salon competes
    // in DIFC first). Multi-country and global rows keep the old "country" level.
    const level = market.level === "multi-country" || market.level === "global" ? "country" : market.level;
    rows.push({
      id: newId("loc"),
      projectId,
      level,
      name: market.name,
      parentId: null,
      countryCode: market.countryCode,
      evidenceIds: market.evidenceIds,
      isPrimary: market.isPrimary,
    });
  }
  // No fabricated fallback location: a business with no geography evidence
  // simply has none yet, and the prompt-coverage policy treats an empty
  // locations table as "no geography available".
  if (rows.length > 0) await db.insert(locations).values(rows).run();
}

/**
 * Re-runs analysis for an existing project, preserving any field the user has
 * edited. Used by the "re-analyse" action.
 */
export async function reanalyze(projectId: string): Promise<ProfileRunResult> {
  const previous = await getLatestProfileVersion(projectId);
  const result = await runWebsiteIntelligence(projectId);
  if (!previous?.userEditedFields?.length) return result;

  const merged = mergeUserEdits(result.profile, previous.profile as unknown as BusinessProfile, previous.userEditedFields);
  const version = await updateProfileVersion(result.version.id, merged, {
    status: "complete",
    userEditedFields: previous.userEditedFields,
    synthesisMode: merged.quality.synthesisMode,
  });
  return { ...result, version, profile: merged };
}
