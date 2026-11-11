"use client";

import type { ReactNode } from "react";
import { JourneyNav } from "@/components/features/journey-nav";
import { LoadingStage, Skeleton, SkeletonCard, StepIcon, type LoadingStep } from "@/components/ui/loading-stage";
import { cn } from "@/lib/cn";

// Placeholder layouts shown while a stage page loads or generates, plus the
// panel for work that stopped before it finished.
//
// None of the skeletons contain real field labels: e2e asserts that profile
// labels such as "BRAND NAME" are absent until the analysis is complete.

/** The profile frame: an identity block, then two columns of field rows. */
export function ProfileSkeleton({ className }: { className?: string }) {
  return (
    <div aria-hidden="true" className={cn("space-y-4", className)}>
      <div className="sun-sheet p-5 sm:p-6">
        <Skeleton className="h-7 w-56 rounded-lg" />
        <Skeleton className="mt-3 h-3.5 w-full" />
        <Skeleton className="mt-1.5 h-3.5 w-4/5" />
      </div>
      <div className="grid gap-4 lg:grid-cols-2">
        <SkeletonCard rows={4} />
        <SkeletonCard rows={4} />
      </div>
    </div>
  );
}

/** A fact strip, then topics and competitors (optionally split into `tierCount` groups). */
export function LandscapeSkeleton({ tierCount = 0, className }: { tierCount?: number; className?: string }) {
  const groups = Math.max(1, Math.min(3, tierCount));
  return (
    <div aria-hidden="true" className={cn("space-y-5", className)}>
      <div className="grid gap-px overflow-hidden rounded-2xl border border-ink-200/75 bg-ink-200/60 sm:grid-cols-3">
        {[0, 1, 2].map((index) => (
          <div key={index} className="bg-white px-4 py-3.5">
            <Skeleton className="h-3 w-20" />
            <Skeleton className="mt-2.5 h-4 w-32" />
          </div>
        ))}
      </div>
      <SkeletonCard rows={5} />
      <div className="sun-sheet p-5">
        <div className="space-y-6">
          {Array.from({ length: groups }, (_, group) => (
            <div key={group} className="space-y-3">
              {tierCount > 0 && <Skeleton className="h-3 w-32" />}
              {Array.from({ length: tierCount > 0 ? 2 : 4 }, (_, row) => (
                <div key={row} className="space-y-2 rounded-xl border border-ink-100 px-3 py-3">
                  <Skeleton className="w-1/2" />
                  <Skeleton className="h-3 w-3/4" />
                </div>
              ))}
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

/** Three lens tiles and two section sheets. */
export function PromptsSkeleton({ className }: { className?: string }) {
  return (
    <div aria-hidden="true" className={cn("space-y-5", className)}>
      <div className="grid gap-3 sm:grid-cols-3">
        {[0, 1, 2].map((index) => (
          <div key={index} className="sun-sheet space-y-2.5 px-4 py-4">
            <Skeleton className="h-3 w-16" />
            <Skeleton className="h-6 w-14" />
            <Skeleton className="h-3 w-3/4" />
          </div>
        ))}
      </div>
      {[0, 1].map((card) => (
        <div key={card} className="sun-sheet space-y-3 p-5">
          <Skeleton className="h-4 w-28" />
          {[0, 1, 2].map((row) => (
            <div key={row} className="space-y-2 rounded-xl border border-ink-100 px-3 py-3">
              <Skeleton className="w-5/6" />
              <Skeleton className="h-3 w-24" />
            </div>
          ))}
        </div>
      ))}
    </div>
  );
}

/** The whole Measure frame while results load (moved out of the Measure page). */
export function MeasureSkeleton({ projectId }: { projectId: string }) {
  return (
    <main className="min-h-screen pb-24" aria-busy="true">
      <JourneyNav projectId={projectId} current="measure" />
      <div className="border-b border-ink-200/70 bg-paper">
        <div className="mx-auto max-w-6xl px-4 pb-6 pt-7 sm:px-6">
          <Skeleton className="h-3 w-28" />
          <Skeleton className="mt-3 h-8 max-w-lg rounded-lg" />
          <LoadingStage compact className="mt-4 max-w-md" title="Loading results" />
        </div>
      </div>
      <div className="mx-auto grid max-w-6xl gap-3 px-4 py-7 sm:grid-cols-2 sm:px-6 lg:grid-cols-4">
        {[0, 1, 2, 3].map((index) => (
          <Skeleton key={index} className="h-44 rounded-2xl border border-ink-100" />
        ))}
      </div>
    </main>
  );
}

/**
 * Work that stopped before it finished (a restart, or a failure). A static
 * panel on purpose: LoadingStage always animates while not complete, and a
 * pulsing indicator on a job that is no longer running reads as "still working".
 */
export function StageStopped({
  title,
  description,
  steps,
  note,
  children,
  className,
}: {
  title: string;
  description?: ReactNode;
  steps?: LoadingStep[];
  note?: ReactNode;
  children?: ReactNode;
  className?: string;
}) {
  return (
    <div role="status" aria-live="polite" className={cn("sun-sheet border-warn-500/30 p-5 sm:p-6", className)}>
      <div className="flex items-start gap-2.5">
        <span aria-hidden="true" className="mt-1 h-3 w-3 shrink-0 rounded-full bg-warn-500" />
        <div className="min-w-0">
          <div className="text-sm font-semibold text-ink-950">{title}</div>
          {description && <div className="mt-1 text-sm leading-6 text-ink-600">{description}</div>}
        </div>
      </div>
      {steps && steps.length > 0 && (
        <ol className="mt-4 space-y-2.5">
          {steps.map((step) => (
            <li key={step.key} className="flex items-start gap-2.5 text-sm">
              {/* A step that was running when the job stopped is shown as not done. */}
              <StepIcon state={step.state === "done" ? "done" : "pending"} />
              <div className="min-w-0">
                <div className={step.state === "done" ? "text-ink-800" : "text-ink-400"}>{step.label}</div>
                {step.detail && <div className="mt-0.5 truncate text-xs text-ink-400">{step.detail}</div>}
              </div>
            </li>
          ))}
        </ol>
      )}
      {note && <div className="mt-3 text-xs leading-5 text-ink-500">{note}</div>}
      {children && <div className="mt-4 flex flex-wrap gap-2">{children}</div>}
    </div>
  );
}
