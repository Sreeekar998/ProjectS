"use client";

import { useLinkStatus } from "next/link";
import { cn } from "@/lib/cn";

// A small pulse inside a <Link> while its navigation is pending. In `next dev`
// a stage route can take seconds to compile on first visit, and a click on the
// journey nav looked like it did nothing until the next page arrived.
// Must render inside a <Link> (useLinkStatus reads the nearest one).

export function LinkPending({ className }: { className?: string }) {
  const { pending } = useLinkStatus();
  return (
    <span
      aria-hidden="true"
      className={cn(
        "ml-1.5 inline-block h-1.5 w-1.5 rounded-full bg-brand-500 transition-opacity",
        pending ? "opacity-100 motion-safe:animate-pulse" : "opacity-0",
        className,
      )}
    />
  );
}
