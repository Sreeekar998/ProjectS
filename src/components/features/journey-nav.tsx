"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { LinkPending } from "@/components/features/link-pending";
import { api } from "@/lib/client/api";
import { cn } from "@/lib/cn";

// The journey chrome: the four stages as a stepper, with the website being
// measured beside them so the reader always knows which business the page is
// about. The nav doesn't gate navigation (server guards do), so every stage
// stays a link: done stages read as done, the current one as current, and the
// ones ahead still look like something you can open.

const STAGES = [
  { key: "understand", label: "Understand", href: "understand" },
  { key: "landscape", label: "Landscape", href: "landscape" },
  { key: "prompts", label: "Prompts", href: "prompts" },
  // Evidence collection is not a stage. It is a job that happens inside
  // Measure, the same way response collection sits inside the report in every
  // comparable product — the operator goes from approved prompts straight to
  // the thing they actually came for.
  { key: "measure", label: "Measure", href: "measure" },
];

// One fetch per project per page load; re-mounts (loading frames, Suspense
// fallbacks) read the cache instead of asking again.
const projectCache = new Map<string, { host: string | null }>();

function hostOf(url: string): string | null {
  try {
    return new URL(url).hostname.replace(/^www\./i, "");
  } catch {
    return null;
  }
}

function useProjectHost(projectId: string): string | null {
  const [host, setHost] = useState<string | null>(() => projectCache.get(projectId)?.host ?? null);
  useEffect(() => {
    if (projectCache.has(projectId)) {
      setHost(projectCache.get(projectId)!.host);
      return;
    }
    let cancelled = false;
    api
      .getProject(projectId)
      .then(({ project }) => {
        const next = { host: hostOf(project.url) };
        projectCache.set(projectId, next);
        if (!cancelled) setHost(next.host);
      })
      .catch(() => undefined);
    return () => {
      cancelled = true;
    };
  }, [projectId]);
  return host;
}

function StepGlyph({ index, state }: { index: number; state: "done" | "current" | "upcoming" }) {
  if (state === "done") {
    return (
      <span aria-hidden="true" className="grid h-5 w-5 shrink-0 place-items-center rounded-full bg-ink-900 text-[10px] font-bold text-white">
        <svg viewBox="0 0 12 12" className="h-3 w-3" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
          <path d="M2.5 6.5l2.3 2.3L9.5 3.8" />
        </svg>
      </span>
    );
  }
  return (
    <span
      aria-hidden="true"
      className={cn(
        "grid h-5 w-5 shrink-0 place-items-center rounded-full text-[11px] font-semibold tabular-nums",
        state === "current" ? "bg-sun-400 text-ink-950" : "border border-ink-300 text-ink-500",
      )}
    >
      {index}
    </span>
  );
}

export function JourneyNav({ projectId, current }: { projectId: string; current: string }) {
  const currentIdx = STAGES.findIndex((s) => s.key === current);
  const host = useProjectHost(projectId);
  return (
    <header className="sticky top-0 z-40 border-b border-ink-200/70 bg-paper/90 backdrop-blur-md print:hidden">
      <div className="mx-auto flex max-w-6xl flex-col gap-2 px-4 py-2.5 sm:px-6 lg:flex-row lg:items-center lg:justify-between lg:gap-6">
        <div className="flex min-w-0 items-center justify-between gap-3">
          <Link href="/" className="focus-ring flex shrink-0 items-center gap-2.5 rounded-md" aria-label="Project Sun home">
            <span className="sun-mark" aria-hidden="true">
              <span />
            </span>
            <span className="text-sm font-semibold tracking-tight text-ink-950">Project Sun</span>
          </Link>
          {host && (
            <span className="flex min-w-0 items-center gap-2 text-xs text-ink-500 lg:hidden">
              <span className="h-3 w-px bg-ink-200" aria-hidden="true" />
              <span className="truncate font-medium text-ink-700">{host}</span>
            </span>
          )}
        </div>
        <nav className="-mx-4 flex items-center gap-1 overflow-x-auto px-4 pb-0.5 sm:-mx-6 sm:px-6 lg:mx-0 lg:px-0 lg:pb-0" aria-label="Project journey">
          {STAGES.map((stage, idx) => {
            const state: "done" | "current" | "upcoming" = stage.key === current ? "current" : idx < currentIdx ? "done" : "upcoming";
            return (
              <div key={stage.key} className="flex shrink-0 items-center">
                {idx > 0 && <span aria-hidden="true" className={cn("mx-1 hidden h-px w-5 sm:block", idx <= currentIdx ? "bg-ink-400" : "bg-ink-200")} />}
                <Link
                  href={`/projects/${projectId}/${stage.href}`}
                  className={cn(
                    "focus-ring flex items-center gap-2 rounded-full py-1.5 pl-1.5 pr-3 text-sm font-medium transition-colors",
                    state === "current" && "bg-ink-950 text-white",
                    state === "done" && "text-ink-800 hover:bg-ink-100",
                    // Upcoming stages are lighter than completed ones but still
                    // plainly interactive: a stage you can open should look
                    // like you can open it.
                    state === "upcoming" && "text-ink-500 hover:bg-ink-100 hover:text-ink-800",
                  )}
                  aria-current={state === "current" ? "step" : undefined}
                >
                  <StepGlyph index={idx + 1} state={state} />
                  {stage.label}
                  <LinkPending className={state === "current" ? "bg-sun-300" : undefined} />
                </Link>
              </div>
            );
          })}
        </nav>
        {host && (
          <span className="hidden min-w-0 items-center gap-2 text-xs text-ink-500 lg:flex">
            <span className="sun-eyebrow text-ink-400">Measuring</span>
            <span className="truncate font-medium text-ink-800">{host}</span>
          </span>
        )}
      </div>
    </header>
  );
}
