"use client";

import { useMemo } from "react";
import { LoadingStage } from "@/components/ui/loading-stage";
import type { SunEventPayload } from "@/lib/client/use-project-events";
import { deriveUnderstandProgress, type UnderstandProgress } from "@/lib/client/understand-progress";
import { SLOW_AFTER_MS } from "@/lib/client/understand-phase";

// The live progress rail for one analysis cycle. Its job is to make the wait
// legible: what the crawler is doing right now and how far the analysis has
// got. It shows no profile data: nothing from the analysis appears until it is
// finished (feedback 2026-09-14). The derivation lives in
// `lib/client/understand-progress.ts`.

export function AnalysisProgress({
  events,
  hydrated = true,
  now,
  compact = false,
}: {
  /** The current cycle only (`currentCrawlCycle`). */
  events: SunEventPayload[];
  hydrated?: boolean;
  /** A ticking clock from the page, for the slow note. */
  now?: number;
  compact?: boolean;
}) {
  const progress: UnderstandProgress = useMemo(() => deriveUnderstandProgress(events), [events]);

  if (progress.blocked || progress.failed) return null;

  if (!hydrated) {
    return <LoadingStage compact={compact} title="Resuming the analysis…" percent={null} />;
  }
  // The crawl was requested but has not announced itself yet: no 0% rail with
  // every step pending, just an honest wait.
  if (events.length === 0) {
    return <LoadingStage compact={compact} title="Starting the analysis…" percent={null} />;
  }

  const slow = !progress.completed && typeof now === "number" && progress.lastEventAt !== null && now - progress.lastEventAt > SLOW_AFTER_MS;
  return (
    <LoadingStage
      compact={compact}
      title={progress.completed ? "Analysis complete" : `Understanding ${progress.domain || "your website"}`}
      percent={progress.percent}
      steps={progress.steps}
      startedAt={progress.startedAt}
      complete={progress.completed}
      note={slow ? "This is taking longer than usual. The page updates by itself." : undefined}
    />
  );
}
