"use client";

import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState, use as usePromise } from "react";
import { useRouter } from "next/navigation";
import { JourneyNav } from "@/components/features/journey-nav";
import { AnalysisProgress } from "@/components/features/analysis-progress";
import { BusinessTypeCard } from "@/components/features/business-type-card";
import { LocationCard } from "@/components/features/location-card";
import { ChipEditor, EditedBadge, EvidenceLink, FieldShell, type ChipItem } from "@/components/features/profile-fields";
import { SearchDemandCard } from "@/components/features/search-demand-card";
import { ProfileSkeleton, StageStopped } from "@/components/features/stage-skeletons";
import { StageHeader } from "@/components/features/stage-header";
import { StickyActions } from "@/components/features/sticky-actions";
import { Button } from "@/components/ui/button";
import { LoadingStage } from "@/components/ui/loading-stage";
import { Badge, Card, CardBody, CardHeader, EmptyState, Input, Label, Notice, Select, Spinner, StatusDot, Textarea } from "@/components/ui/primitives";
import { cn } from "@/lib/cn";
import { api, ApiError, type ClassificationEditInput, type IndustryOption, type LocationEditInput, type ProfileEditsInput } from "@/lib/client/api";
import { currentCrawlCycle, restartAnswered, understandPhase, type UnderstandPhase } from "@/lib/client/understand-phase";
import { industryText } from "@/lib/client/profile-display";
import { deriveUnderstandProgress, lastCycleSyncEvent, understandSubtitle } from "@/lib/client/understand-progress";
import { useProjectEvents } from "@/lib/client/use-project-events";
import { BUSINESS_ARCHETYPES, MARKET_LEVELS, type BusinessProfile, type MarketLevel } from "@/lib/profile/schema";
import { ARCHETYPE_LABELS } from "@/lib/profile/taxonomy";

// Understand shows only the analysis progress until the analysis is finished,
// then the whole profile at once. Partial versions are never rendered: they
// carried rules-only guesses that replaced each other as pages arrived, which
// operators read as "random information" (feedback 2026-09-14). The view comes
// from `understandPhase` (lib/client/understand-phase.ts).

interface ProfileVersion {
  id: string;
  version: number;
  status: "partial" | "complete" | "failed";
  /** The crawl run that produced this version; tells a just-finished run from an older result. */
  crawlRunId: string | null;
  profile: BusinessProfile;
  confirmedAt: string | null;
  synthesisMode: string | null;
  userEditedFields: string[] | null;
}

interface EditState {
  brandName: string;
  /** The business's other websites (the crawled site is always first and not editable). */
  websites: ChipItem[];
  description: string;
  industryTaxonomyId: string;
  archetype: string;
  brandIdentity: ChipItem[];
  offerings: ChipItem[];
  targetAudience: ChipItem[];
  markets: Array<ChipItem & { level: MarketLevel }>;
}

/** Keep the finished rail on screen this long, so the operator sees 100% before the results replace it. */
const REVEAL_HOLD_MS = 600;
/** How long "Analyse again" may wait for the new cycle's first event before the page falls back to the stored state. */
const RESTART_WAIT_MS = 30_000;

export default function UnderstandPage({ params }: { params: Promise<{ id: string }> }) {
  const { id: projectId } = usePromise(params);
  const router = useRouter();
  const { events, hydrated } = useProjectEvents(projectId);

  const [version, setVersion] = useState<ProfileVersion | null>(null);
  const [fetched, setFetched] = useState(false);
  const [inProgress, setInProgress] = useState<boolean | null>(null);
  const [mountedAt] = useState(() => Date.now());
  const [now, setNow] = useState(() => Date.now());
  const [industries, setIndustries] = useState<IndustryOption[]>([]);
  const [edit, setEdit] = useState<EditState | null>(null);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  // The business type and location cards edit one field each; while one is
  // open the whole-profile editor stays closed so two drafts never race.
  const [cardEditing, setCardEditing] = useState<{ classification: boolean; location: boolean }>({ classification: false, location: false });
  // A failed analysis can still be completed by hand.
  const [manualOpen, setManualOpen] = useState(false);
  const [restarting, setRestarting] = useState(false);
  // "Analyse again" was accepted: wait for the new cycle's events instead of
  // flashing the old failure. Holds the sequence the new cycle starts after.
  const [restart, setRestart] = useState<{ since: number; at: number } | null>(null);
  const [revealHold, setRevealHold] = useState(false);
  const [animateReveal, setAnimateReveal] = useState(false);

  const cycleEvents = useMemo(() => currentCrawlCycle(events), [events]);
  const progress = useMemo(() => deriveUnderstandProgress(cycleEvents), [cycleEvents]);
  const profile = version?.profile;
  const classification = profile?.classification;
  const location = profile?.location;
  const anyCardEditing = cardEditing.classification || cardEditing.location;

  const phase: UnderstandPhase = understandPhase({ fetched, version, events, hydrated, inProgress, mountedAt, now });
  const restartHeard = useMemo(() => restart !== null && restartAnswered(events, restart.since), [restart, events]);
  const restartPending = restart !== null && !restartHeard && now - restart.at < RESTART_WAIT_MS;
  const view: UnderstandPhase | "starting" | "reveal" = restartPending ? "starting" : phase === "ready" && revealHold ? "reveal" : phase;

  const refetch = useCallback(async () => {
    try {
      const { profileVersion, inProgress: running } = await api.getProfile(projectId);
      setVersion(profileVersion as ProfileVersion);
      setInProgress(typeof running === "boolean" ? running : null);
    } catch (err) {
      // A 404 simply means analysis has not produced a version yet.
      if (err instanceof ApiError && err.status === 404) {
        setVersion(null);
        setInProgress(null);
      } else {
        setError("Could not load the profile.");
      }
    } finally {
      setFetched(true);
    }
  }, [projectId]);

  useEffect(() => {
    void refetch();
    void api.getIndustries().then(({ industries }) => setIndustries(industries)).catch(() => setIndustries([]));
  }, [refetch]);

  // A clock for stall detection, the "not started" check and the slow note.
  const waiting = view === "loading" || view === "analysing" || view === "starting";
  useEffect(() => {
    if (!waiting) return;
    const timer = setInterval(() => setNow(Date.now()), 5_000);
    return () => clearInterval(timer);
  }, [waiting]);

  // While analysing, re-read `inProgress` now and then so a restart of the
  // server is noticed without waiting for the silence timer.
  useEffect(() => {
    if (view !== "analysing" || !hydrated) return;
    const timer = setInterval(() => void refetch(), 30_000);
    return () => clearInterval(timer);
  }, [view, hydrated, refetch]);

  // Re-read the stored profile when the cycle ends (or a new one starts), and
  // when another tab edits or confirms. Field events are not triggers any more:
  // nothing partial is shown.
  const refreshKey = useMemo(() => {
    const terminals = cycleEvents.filter((e) => e.type === "profile.ready" || e.type === "profile.failed").length;
    const decisions = events.filter((e) => e.type === "profile.edited" || e.type === "profile.confirmed").length;
    return `${cycleEvents[0]?.sequence ?? 0}:${terminals}:${decisions}`;
  }, [events, cycleEvents]);
  const firstRefreshKey = useRef(true);
  useEffect(() => {
    if (firstRefreshKey.current) {
      firstRefreshKey.current = false;
      return;
    }
    if (!edit && !anyCardEditing) void refetch();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [refreshKey]);

  useEffect(() => {
    if (restartHeard) setRestart(null);
  }, [restartHeard]);

  // When the analysis finishes during this visit, hold the completed rail
  // briefly, then fade the results in. A page that opens on a finished profile
  // shows it at once. Layout effect: the hold starts before the first paint of
  // the ready phase, so the profile never flashes in for a frame.
  const previousPhase = useRef<UnderstandPhase | null>(null);
  useLayoutEffect(() => {
    const previous = previousPhase.current;
    previousPhase.current = phase;
    if (phase !== "ready" || previous !== "analysing") return;
    setRevealHold(true);
    setAnimateReveal(true);
    const timer = setTimeout(() => setRevealHold(false), REVEAL_HOLD_MS);
    return () => {
      clearTimeout(timer);
      setRevealHold(false);
    };
  }, [phase]);

  useEffect(() => {
    if (phase === "ready") router.prefetch(`/projects/${projectId}/landscape`);
  }, [phase, projectId, router]);

  function startEdit() {
    if (!profile) return;
    setEdit({
      brandName: profile.identity.brandName.value,
      websites: profile.identity.domains.slice(1).map((value) => ({ value })),
      description: profile.description.value,
      industryTaxonomyId: profile.industry.taxonomyId ?? "",
      archetype: profile.archetype.value,
      brandIdentity: profile.brandIdentity.map((t) => ({ value: t.value })),
      offerings: profile.offerings.items.map((o) => ({ value: o.name, meta: o.type })),
      targetAudience: profile.targetAudience.map((a) => ({ value: a.value })),
      markets: profile.markets.map((m) => ({ value: m.name, level: m.level })),
    });
    setNotice(null);
  }

  function openManual() {
    setManualOpen(true);
    startEdit();
  }

  function cancelEdit() {
    setEdit(null);
    if (phase === "failed") setManualOpen(false);
  }

  async function save(alsoConfirm: boolean) {
    if (!edit || !profile) return;
    const edits = changedEdits(profile, edit);
    if (Object.keys(edits).length === 0) {
      if (phase === "failed") {
        // Confirming an unchanged failed profile would send an empty profile downstream.
        setError("Add at least the brand name and a description first.");
        return;
      }
      // Nothing changed: marking every field as the operator's own would only
      // stop a later re-analysis from refreshing it.
      if (alsoConfirm) {
        setEdit(null);
        await confirm();
      } else {
        setEdit(null);
        setNotice("Nothing changed.");
      }
      return;
    }
    setSaving(true);
    setError(null);
    try {
      const { profileVersion } = await api.patchProfile(projectId, {
        action: "edit",
        confirm: alsoConfirm,
        edits,
      });
      setVersion(profileVersion as ProfileVersion);
      setEdit(null);
      setNotice(alsoConfirm ? "Profile confirmed." : "Your changes were saved as a new version.");
      if (alsoConfirm) {
        // Stays pending until the Landscape route replaces this page.
        router.push(`/projects/${projectId}/landscape`);
        return;
      }
      setSaving(false);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Could not save your changes.");
      setSaving(false);
    }
  }

  /** One-field corrections from the business type and location cards. */
  async function saveCardEdit(edits: { classification: ClassificationEditInput } | { location: LocationEditInput }) {
    setError(null);
    setNotice(null);
    try {
      const { profileVersion } = await api.patchProfile(projectId, { action: "edit", edits });
      setVersion(profileVersion as ProfileVersion);
      setNotice("Your correction was saved as a new version.");
      void refetch();
    } catch (err) {
      throw new Error(err instanceof ApiError ? err.message : "Could not save your correction.");
    }
  }

  async function confirm() {
    setSaving(true);
    setError(null);
    try {
      await api.patchProfile(projectId, { action: "confirm" });
      router.push(`/projects/${projectId}/landscape`);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Could not confirm the profile.");
      setSaving(false);
    }
  }

  /** "Analyse again" (stalled or failed) and "Start analysis" (never started). */
  async function analyseAgain() {
    const before = events.at(-1)?.sequence ?? 0;
    setRestarting(true);
    setError(null);
    try {
      // No body: the server keeps the previous run's Search Console choice.
      const started = await api.startCrawl(projectId);
      if (started?.status !== "already_running") setRestart({ since: typeof started?.sinceSequence === "number" ? started.sinceSequence : before, at: Date.now() });
      setNow(Date.now());
      setEdit(null);
      setManualOpen(false);
      setNotice(null);
      await refetch();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Could not start the analysis.");
    } finally {
      setRestarting(false);
    }
  }

  const warnings = profile?.quality.warnings ?? [];
  const offeringGroups = useMemo(() => groupedOfferings(profile), [profile]);
  const audienceSegments = profile?.audienceSegments ?? [];
  const priceRange = profile?.positioning?.priceRange?.trim() || null;
  const bookingPlatforms = (profile?.contact?.bookingPlatforms ?? []).map(platformLabel).filter(Boolean);
  // List-valued fields carry provenance per item, so the section badge reads
  // it from the version's edited-field list instead.
  const editedFields = new Set(version?.userEditedFields ?? []);
  // Scoped to this cycle's run: a failed run's late pull result must not set the card's notice.
  const lastSyncEvent = useMemo(() => lastCycleSyncEvent(cycleEvents), [cycleEvents]);
  // A failed version's last warning is the crawl failure message. Other
  // warnings (dropped or unsupported findings) are never shown.
  const failureMessage =
    version?.status === "failed" && warnings.length > 0 ? warnings[warnings.length - 1]! : blockedMessage(progress.blocked?.reason ?? progress.failed?.reason);
  const showCard = Boolean(version && profile) && (view === "ready" || (view === "failed" && manualOpen));
  const restartButtonLabel = restarting ? (
    <>
      <Spinner /> Starting…
    </>
  ) : (
    "Analyse again"
  );

  const versionChip = version && profile && showCard ? (
    <Badge tone={version.confirmedAt ? "ok" : "sun"} className="gap-1.5">
      <StatusDot tone={version.confirmedAt ? "ok" : "sun"} />
      Version {version.version} · {version.confirmedAt ? "Confirmed" : "Awaiting your confirmation"}
    </Badge>
  ) : null;
  const metaLine = profile
    ? `${profile.quality.pagesAnalyzed} page${profile.quality.pagesAnalyzed === 1 ? "" : "s"} analysed · ${profile.quality.evidenceItemCount} pieces of evidence · ${version?.synthesisMode === "llm_grounded" ? "AI-assisted, grounded in the site" : "evidence-only"}`
    : "";

  return (
    <main className="min-h-screen pb-6">
      <JourneyNav projectId={projectId} current="understand" />
      <div className="mx-auto max-w-5xl px-4 py-8 sm:px-6">
        <StageHeader stage="understand" title="Your brand profile" lede={understandSubtitle(view)} aside={versionChip} />

        {error && !showCard && (
          <Notice tone="danger" role="alert" className="mt-6">
            {error}
          </Notice>
        )}

        {view === "loading" && (
          <>
            <LoadingStage className="mt-6" title="Loading your brand profile" />
            <ProfileSkeleton className="mt-6" />
          </>
        )}

        {view === "starting" && (
          <>
            <LoadingStage className="mt-6" title="Starting the analysis…" />
            <ProfileSkeleton className="mt-6" />
          </>
        )}

        {(view === "analysing" || view === "reveal") && (
          <>
            <div className="mt-6">
              <AnalysisProgress events={cycleEvents} hydrated={hydrated} now={now} />
            </div>
            <ProfileSkeleton className="mt-6" />
          </>
        )}

        {view === "stalled" && (
          <StageStopped
            className="mt-6"
            title="The analysis stopped before it finished"
            description="This can happen if the app restarted while it was working."
            steps={progress.steps}
            note="Analysing again starts fresh and replaces any changes you haven't confirmed."
          >
            <Button onClick={analyseAgain} disabled={restarting}>
              {restartButtonLabel}
            </Button>
          </StageStopped>
        )}

        {view === "not_started" && (
          <div className="mt-6">
            <EmptyState
              title="The analysis hasn't started"
              description="Start it now. It reads your website and builds the profile you confirm next."
              action={
                <Button onClick={analyseAgain} disabled={restarting}>
                  {restarting ? <Spinner /> : "Start analysis"}
                </Button>
              }
            />
          </div>
        )}

        {view === "failed" && (
          <Notice tone="warn" role="alert" title="We could not analyse this website" className="mt-6">
            <p>{failureMessage}</p>
            {!manualOpen && (
              <>
                <p className="mt-2 text-xs text-ink-600">Analysing again starts fresh and replaces any changes you haven&apos;t confirmed.</p>
                <div className="mt-3 flex flex-wrap gap-2">
                  <Button size="sm" onClick={analyseAgain} disabled={restarting}>
                    {restartButtonLabel}
                  </Button>
                  {version && profile && (
                    <Button size="sm" variant="secondary" onClick={openManual} disabled={restarting}>
                      Fill in the profile by hand
                    </Button>
                  )}
                </div>
              </>
            )}
          </Notice>
        )}

        {showCard && version && profile && (
          <div className={cn("mt-6 space-y-4", animateReveal && "motion-safe:animate-fade-in")}>
            {/* --- Identity: who this is, in one sheet --- */}
            <Card className="p-5 sm:p-6">
              <div className="flex flex-col gap-5 sm:flex-row sm:items-start sm:justify-between">
                <div className="min-w-0 flex-1">
                  <FieldShell label="Brand name" badge={<EditedBadge edited={profile.identity.brandName.source === "user"} />} className="border-0 py-0">
                    {edit ? (
                      <div className="space-y-4">
                        <Input value={edit.brandName} onChange={(e) => setEdit({ ...edit, brandName: e.target.value })} aria-label="Brand name" className="max-w-md text-base font-medium" />
                        <div>
                          <p className="text-xs font-medium text-ink-600">Other websites of this business</p>
                          <p className="mb-2 text-xs text-ink-500">Answers citing these count as citing your site. {profile.identity.domains[0] ? `${profile.identity.domains[0]} is always included.` : ""}</p>
                          <ChipEditor
                            items={edit.websites}
                            editing
                            onChange={(next) => setEdit({ ...edit, websites: next })}
                            emptyLabel=""
                            addLabel="Add a website, e.g. example-booking.com"
                          />
                        </div>
                      </div>
                    ) : (
                      <>
                        <div className="flex items-center gap-3">
                          <span aria-hidden="true" className="grid h-11 w-11 shrink-0 place-items-center rounded-xl bg-sun-100 text-base font-semibold text-sun-900">
                            {initialsOf(profile.identity.brandName.value)}
                          </span>
                          <div className="min-w-0">
                            <p className="text-2xl font-semibold leading-tight tracking-[-0.02em] text-ink-950">{profile.identity.brandName.value || <Placeholder />}</p>
                            <p className="mt-0.5 flex flex-wrap items-center gap-x-2 text-xs text-ink-500">
                              {profile.identity.domains[0] && <span className="font-medium text-ink-700">{profile.identity.domains[0]}</span>}
                              {profile.identity.domains.length > 1 && <span>also {profile.identity.domains.slice(1).join(", ")}</span>}
                              {profile.identity.aliases.values.length > 0 && <span>Also known as {profile.identity.aliases.values.join(", ")}</span>}
                            </p>
                          </div>
                        </div>
                        <EvidenceLink projectId={projectId} evidenceIds={profile.identity.brandName.evidenceIds} />
                      </>
                    )}
                  </FieldShell>
                </div>
                {!edit && (
                  <Button size="sm" variant="secondary" onClick={startEdit} disabled={anyCardEditing} className="shrink-0 self-start">
                    Edit profile
                  </Button>
                )}
              </div>

              <FieldShell label="Description" badge={<EditedBadge edited={profile.description.source === "user"} />} className="mt-5 border-t border-b-0 pb-0 pt-5">
                {edit ? (
                  <Textarea rows={3} value={edit.description} onChange={(e) => setEdit({ ...edit, description: e.target.value })} aria-label="Description" />
                ) : (
                  <>
                    <p className="max-w-3xl text-[15px] leading-7 text-ink-800">{profile.description.value || <Placeholder text="Not enough evidence yet" />}</p>
                    <EvidenceLink projectId={projectId} evidenceIds={profile.description.evidenceIds} />
                  </>
                )}
              </FieldShell>
              <p className="mt-4 border-t border-ink-100 pt-3 text-xs text-ink-500">{metaLine}</p>
            </Card>

            <div className="grid items-start gap-4 lg:grid-cols-2">
              {/* --- What it is: type, place, demand --- */}
              <Card>
                <CardHeader className="py-3">
                  <p className="sun-eyebrow text-ink-500">What it is</p>
                </CardHeader>
                <CardBody className="pt-0">
                  {classification ? (
                    <BusinessTypeCard
                      projectId={projectId}
                      classification={classification}
                      locked={Boolean(edit)}
                      onEditingChange={(open) => setCardEditing((c) => ({ ...c, classification: open }))}
                      onSave={(classificationEdit) => saveCardEdit({ classification: classificationEdit })}
                    />
                  ) : (
                    <>
                      {/* --- Industry --- */}
                      <FieldShell label="Industry" badge={<EditedBadge edited={profile.industry.source === "user"} />}>
                        {edit ? (
                          <Select value={edit.industryTaxonomyId} onChange={(e) => setEdit({ ...edit, industryTaxonomyId: e.target.value })} aria-label="Industry">
                            <option value="">Select an industry…</option>
                            {industries.map((industry) => (
                              <option key={industry.id} value={industry.id}>
                                {industry.label}
                              </option>
                            ))}
                          </Select>
                        ) : (
                          <>
                            <p className="text-base font-medium text-ink-950">{industryText(profile.industry.value) || <Placeholder text="Not classified — please choose one" />}</p>
                            <EvidenceLink projectId={projectId} evidenceIds={profile.industry.evidenceIds} />
                          </>
                        )}
                      </FieldShell>

                      {/* --- Business type --- */}
                      <FieldShell label="Business type" badge={<EditedBadge edited={profile.archetype.source === "user"} />}>
                        {edit ? (
                          <Select value={edit.archetype} onChange={(e) => setEdit({ ...edit, archetype: e.target.value })} aria-label="Business type">
                            {BUSINESS_ARCHETYPES.map((archetype) => (
                              <option key={archetype} value={archetype}>
                                {ARCHETYPE_LABELS[archetype] ?? archetype}
                              </option>
                            ))}
                          </Select>
                        ) : (
                          <>
                            <p className="text-base font-medium text-ink-950">{ARCHETYPE_LABELS[profile.archetype.value] ?? profile.archetype.value}</p>
                            <EvidenceLink projectId={projectId} evidenceIds={profile.archetype.evidenceIds} />
                          </>
                        )}
                      </FieldShell>
                    </>
                  )}

                  {/* --- Location (v2) --- */}
                  {location && (
                    <LocationCard
                      projectId={projectId}
                      location={location}
                      marketScope={profile.marketScope.value}
                      onlineBusiness={classification?.physicalPresence === "online_only"}
                      locked={Boolean(edit)}
                      onEditingChange={(open) => setCardEditing((c) => ({ ...c, location: open }))}
                      onSave={(locationEdit) => saveCardEdit({ location: locationEdit })}
                    />
                  )}

                  {/* --- Target market (older versions without a location) --- */}
                  {!location && (
                    <FieldShell
                      label="Target market"
                      badge={<EditedBadge edited={editedFields.has("markets")} />}
                      hint={profile.marketScope.value !== "unknown" ? `Scope: ${profile.marketScope.value.replace(/-/g, " ")}` : undefined}
                    >
                      {edit ? (
                        <div className="space-y-2">
                          <ChipEditor
                            items={edit.markets}
                            editing
                            onChange={(next) =>
                              setEdit({
                                ...edit,
                                markets: next.map((m) => ({ ...m, level: (edit.markets.find((x) => x.value === m.value)?.level ?? "country") as MarketLevel })),
                              })
                            }
                            emptyLabel="No markets yet"
                            addLabel="Add a market"
                          />
                          {edit.markets.map((market, index) => (
                            <div key={market.value} className="flex items-center gap-2">
                              <Label className="mb-0 w-40 shrink-0 truncate text-xs">{market.value}</Label>
                              <Select
                                value={market.level}
                                aria-label={`Level for ${market.value}`}
                                className="h-8 text-xs"
                                onChange={(e) => {
                                  const next = [...edit.markets];
                                  next[index] = { ...market, level: e.target.value as MarketLevel };
                                  setEdit({ ...edit, markets: next });
                                }}
                              >
                                {MARKET_LEVELS.map((level) => (
                                  <option key={level} value={level}>
                                    {level}
                                  </option>
                                ))}
                              </Select>
                            </div>
                          ))}
                        </div>
                      ) : (
                        <>
                          <ChipEditor
                            items={profile.markets.map((m) => ({ value: m.name, meta: m.level }))}
                            editing={false}
                            onChange={() => undefined}
                            emptyLabel="No market evidence found — we did not guess one."
                            addLabel=""
                          />
                          <EvidenceLink projectId={projectId} evidenceIds={profile.markets.flatMap((m) => m.evidenceIds).slice(0, 8)} />
                        </>
                      )}
                    </FieldShell>
                  )}

                  {/* --- Search demand (Google Search Console, when connected) --- */}
                  {!edit && <SearchDemandCard summary={profile.searchConsole} lastSyncEvent={lastSyncEvent} />}
                </CardBody>
              </Card>

              {/* --- What it offers, and to whom --- */}
              <Card>
                <CardHeader className="py-3">
                  <p className="sun-eyebrow text-ink-500">What it offers, and to whom</p>
                </CardHeader>
                <CardBody className="pt-0">
                  {/* --- Products & services --- */}
                  <FieldShell label="Products & services" badge={<EditedBadge edited={editedFields.has("offerings")} />}>
                    {!edit && offeringGroups.length > 0 ? (
                      <div className="space-y-3">
                        {offeringGroups.map((group) => (
                          <div key={group.name}>
                            <h4 className="mb-1.5 text-xs font-semibold text-ink-700">{group.name}</h4>
                            <ChipEditor items={group.items.map((value) => ({ value }))} editing={false} onChange={() => undefined} emptyLabel="" addLabel="" />
                          </div>
                        ))}
                      </div>
                    ) : (
                      <ChipEditor
                        items={edit ? edit.offerings : profile.offerings.items.map((o) => ({ value: o.name, meta: o.type }))}
                        editing={Boolean(edit)}
                        onChange={(next) => edit && setEdit({ ...edit, offerings: next })}
                        emptyLabel="No products or services could be identified."
                        addLabel="Add a product or service"
                      />
                    )}
                    {!edit && (priceRange || bookingPlatforms.length > 0) && (
                      <p className="mt-3 text-xs text-ink-500">
                        {priceRange && (
                          <>
                            Price range: <span className="font-medium text-ink-800">{priceRange}</span>
                          </>
                        )}
                        {priceRange && bookingPlatforms.length > 0 && " · "}
                        {bookingPlatforms.length > 0 && (
                          <>
                            Booking via <span className="font-medium text-ink-800">{bookingPlatforms.join(", ")}</span>
                          </>
                        )}
                      </p>
                    )}
                    {!edit && <EvidenceLink projectId={projectId} evidenceIds={profile.offerings.items.flatMap((o) => o.evidenceIds).slice(0, 8)} />}
                  </FieldShell>

                  {/* --- Brand identity --- */}
                  <FieldShell label="Brand identity" badge={<EditedBadge edited={editedFields.has("brandIdentity")} />}>
                    <ChipEditor
                      items={edit ? edit.brandIdentity : profile.brandIdentity.map((t) => ({ value: t.value }))}
                      editing={Boolean(edit)}
                      onChange={(next) => edit && setEdit({ ...edit, brandIdentity: next })}
                      emptyLabel="No distinctive positioning language found on the site."
                      addLabel="Add an attribute"
                    />
                    {!edit && <EvidenceLink projectId={projectId} evidenceIds={profile.brandIdentity.flatMap((t) => t.evidenceIds).slice(0, 8)} />}
                  </FieldShell>

                  {/* --- Target audience --- */}
                  <FieldShell label={audienceSegments.length > 0 ? "Who it's for" : "Target audience"} badge={<EditedBadge edited={editedFields.has("targetAudience")} />}>
                    {!edit && audienceSegments.length > 0 ? (
                      <ul className="space-y-3">
                        {audienceSegments.map((segment) => (
                          <li key={segment.label} className="flex gap-3">
                            <span aria-hidden="true" className="mt-2 h-1.5 w-1.5 shrink-0 rounded-full bg-sun-500" />
                            <div className="min-w-0">
                              <p className="flex flex-wrap items-center gap-x-2 text-sm font-medium text-ink-950">
                                {segment.label}
                                {GEO_RELATION_LABELS[segment.geoRelation] && (
                                  <span className="rounded-full border border-ink-200 px-2 py-px text-[10px] font-medium uppercase tracking-wide text-ink-500">{GEO_RELATION_LABELS[segment.geoRelation]}</span>
                                )}
                              </p>
                              {segment.description && <p className="mt-0.5 text-sm leading-6 text-ink-600">{segment.description}</p>}
                            </div>
                          </li>
                        ))}
                      </ul>
                    ) : (
                      <ChipEditor
                        items={edit ? edit.targetAudience : profile.targetAudience.map((a) => ({ value: a.value }))}
                        editing={Boolean(edit)}
                        onChange={(next) => edit && setEdit({ ...edit, targetAudience: next })}
                        emptyLabel="The site does not state who it is for."
                        addLabel="Add an audience"
                      />
                    )}
                    {!edit && (
                      <EvidenceLink
                        projectId={projectId}
                        evidenceIds={(audienceSegments.length > 0 ? audienceSegments.flatMap((a) => a.evidenceIds) : profile.targetAudience.flatMap((a) => a.evidenceIds)).slice(0, 8)}
                      />
                    )}
                  </FieldShell>
                </CardBody>
              </Card>
            </div>

            {profile.regulatedDomain.isRegulated && (
              <Notice tone="warn">
                Regulated domain detected ({profile.regulatedDomain.categories.join(", ")}) — advice-seeking prompts are blocked later in the journey.
              </Notice>
            )}

            {error && (
              <Notice tone="danger" role="alert">
                {error}
              </Notice>
            )}
            {notice && <Notice tone="ok">{notice}</Notice>}

            <StickyActions
              status={
                anyCardEditing && !edit ? (
                  "Save or cancel your correction above, then confirm the profile."
                ) : edit ? (
                  "Editing the profile. Saving creates a new version; your evidence stays attached to everything you did not change."
                ) : view === "failed" ? (
                  "Fill in at least the brand name and a description, then save and confirm."
                ) : version.confirmedAt ? (
                  <span>
                    <span className="font-medium text-ink-900">Confirmed.</span> Landscape, prompts and measurement are built on this version.
                  </span>
                ) : (
                  <span>
                    <span className="font-medium text-ink-900">Check, then confirm.</span> Everything downstream is measured against this profile.
                  </span>
                )
              }
            >
              {anyCardEditing && !edit ? null : edit ? (
                <>
                  <Button variant="secondary" onClick={cancelEdit} disabled={saving}>
                    Cancel
                  </Button>
                  {view !== "failed" && (
                    <Button onClick={() => save(false)} disabled={saving}>
                      {saving ? <Spinner /> : "Save changes"}
                    </Button>
                  )}
                  <Button variant="accent" onClick={() => save(true)} disabled={saving}>
                    {saving && view === "failed" ? <Spinner /> : "Save & confirm"}
                  </Button>
                </>
              ) : view === "failed" ? null : (
                <Button variant="accent" onClick={confirm} disabled={saving}>
                  {saving ? (
                    <>
                      <Spinner /> Opening Landscape…
                    </>
                  ) : (
                    "Confirm profile"
                  )}
                </Button>
              )}
            </StickyActions>
          </div>
        )}
      </div>
    </main>
  );
}

/** "Atelier Ten Salon" → "AT": a visual anchor without fetching a logo. */
function initialsOf(name: string): string {
  const parts = name.split(/\s+/).filter(Boolean);
  const initials = parts.slice(0, 2).map((part) => part[0]!.toUpperCase()).join("");
  return initials || "?";
}

const GEO_RELATION_LABELS: Record<string, string> = {
  lives_or_works_nearby: "Nearby",
  city_wide: "City-wide",
  visitors_or_tourists: "Visitors",
  regional: "Regional",
  national: "National",
  international: "International",
  online_anywhere: "Online",
};

/** "fresha" → "Fresha"; hostnames lose their www. and TLD noise stays readable. */
function platformLabel(value: string): string {
  const trimmed = value.trim().replace(/^https?:\/\//, "").replace(/^www\./, "").replace(/\/.*$/, "");
  return trimmed ? trimmed.charAt(0).toUpperCase() + trimmed.slice(1) : "";
}

/** The site's own grouping, with anything it did not group gathered under "Other". */
function groupedOfferings(profile: BusinessProfile | undefined): Array<{ name: string; items: string[] }> {
  const groups = profile?.offerings.groups ?? [];
  if (!profile || groups.length === 0) return [];
  const seen = new Set<string>();
  const out = groups
    .map((group) => ({
      name: group.name,
      items: group.items.filter((item) => {
        const key = item.toLowerCase();
        if (seen.has(key)) return false;
        seen.add(key);
        return true;
      }),
    }))
    .filter((group) => group.items.length > 0);
  const ungrouped = profile.offerings.items.map((o) => o.name).filter((name) => !seen.has(name.toLowerCase()));
  if (ungrouped.length > 0) out.push({ name: "Other", items: ungrouped });
  return out;
}

const sameList = (a: string[], b: string[]) => a.length === b.length && a.every((value, index) => value === b[index]);

/**
 * Only the fields the operator actually changed. Sending every field would
 * mark all of them as user edits, which drops their evidence and stops a
 * re-analysis from refreshing them. On profiles with a classification or a
 * location, those are corrected through their own cards, so the legacy
 * industry, archetype and market mirrors are never sent from here.
 */
function changedEdits(profile: BusinessProfile, edit: EditState): ProfileEditsInput {
  const edits: ProfileEditsInput = {};
  if (edit.brandName !== profile.identity.brandName.value) edits.brandName = edit.brandName;
  const websites = edit.websites.map((w) => w.value.trim()).filter(Boolean);
  if (!sameList(websites, profile.identity.domains.slice(1))) edits.domains = [...profile.identity.domains.slice(0, 1), ...websites];
  if (edit.description !== profile.description.value) edits.description = edit.description;
  if (!profile.classification) {
    if (edit.industryTaxonomyId && edit.industryTaxonomyId !== (profile.industry.taxonomyId ?? "")) edits.industryTaxonomyId = edit.industryTaxonomyId;
    if (edit.archetype !== profile.archetype.value) edits.archetype = edit.archetype;
  }
  const identity = edit.brandIdentity.map((t) => t.value);
  if (!sameList(identity, profile.brandIdentity.map((t) => t.value))) edits.brandIdentity = identity;
  const offerings = edit.offerings.map((o) => ({ name: o.value, type: (o.meta as "product" | "service" | "category" | "solution") ?? "category" }));
  if (!sameList(offerings.map((o) => `${o.name}|${o.type}`), profile.offerings.items.map((o) => `${o.name}|${o.type}`))) edits.offerings = offerings;
  const audience = edit.targetAudience.map((a) => a.value);
  if (!sameList(audience, profile.targetAudience.map((a) => a.value))) edits.targetAudience = audience;
  if (!profile.location) {
    const markets = edit.markets.map((m) => ({ name: m.value, level: m.level }));
    if (!sameList(markets.map((m) => `${m.name}|${m.level}`), profile.markets.map((m) => `${m.name}|${m.level}`))) edits.markets = markets;
  }
  return edits;
}

function Placeholder({ text = "Not found yet" }: { text?: string }) {
  return <span className="italic text-ink-300">{text}</span>;
}

function blockedMessage(reason?: string): string {
  switch (reason) {
    case "robots_disallowed":
      return "This site's robots.txt asks crawlers not to read it, so we collected no evidence.";
    case "private_address":
    case "blocked_hostname":
      return "That address resolves to a private or internal host and cannot be analysed.";
    case "dns_resolution_failed":
      return "That domain could not be resolved. Check the spelling and try again.";
    case "no_pages_fetched":
      return "No page on this site could be fetched. It may be offline or blocking automated requests.";
    default:
      return "The crawl could not complete.";
  }
}
