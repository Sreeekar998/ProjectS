import type { ReactNode } from "react";
import { cn } from "@/lib/cn";

// The decision bar at the foot of a stage: what state the stage is in, and
// the action that moves the journey on. Sticky so the reader never scrolls a
// long profile or prompt list looking for "Confirm". Printing hides it.

export function StickyActions({ status, children, className }: { status?: ReactNode; children: ReactNode; className?: string }) {
  return (
    <div className={cn("sticky bottom-0 z-30 mt-8 print:hidden", className)}>
      <div className="pointer-events-none absolute inset-x-0 -top-6 h-6 bg-gradient-to-t from-canvas to-transparent" aria-hidden="true" />
      <div className="sun-sheet flex flex-col gap-3 px-4 py-3 shadow-float sm:flex-row sm:items-center sm:justify-between sm:px-5">
        <div className="min-w-0 text-sm leading-5 text-ink-600">{status}</div>
        <div className="flex shrink-0 flex-wrap items-center gap-2">{children}</div>
      </div>
    </div>
  );
}
