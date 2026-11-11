"use client";

import type { ReactNode } from "react";
import { useParams } from "next/navigation";
import { JourneyNav } from "@/components/features/journey-nav";
import { StageHeader } from "@/components/features/stage-header";
import { LoadingStage } from "@/components/ui/loading-stage";
import { cn } from "@/lib/cn";

// The route-level loading frame for a stage page (`loading.tsx`). Next shows it
// the moment a navigation starts, so the previous page no longer sits frozen
// while the next route loads (feedback 2026-09-14: "show loading animation on
// every page"). The width matches each page's container so nothing jumps when
// the page replaces it. `loading.tsx` receives no params, so the id is read here.

export function RouteLoading({
  stage,
  title,
  width,
  children,
}: {
  stage: "understand" | "landscape" | "prompts";
  title: string;
  width: "max-w-3xl" | "max-w-4xl" | "max-w-5xl";
  children: ReactNode;
}) {
  const { id } = useParams<{ id: string }>();
  return (
    <main className="min-h-screen" aria-busy="true">
      <JourneyNav projectId={id} current={stage} />
      <div className={cn("mx-auto px-4 py-8 sm:px-6", width)}>
        <StageHeader stage={stage} title={title} />
        <LoadingStage className="mt-6" title={`Opening ${title.toLowerCase()}`} />
        <div className="mt-6">{children}</div>
      </div>
    </main>
  );
}
