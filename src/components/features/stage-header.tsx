import type { ReactNode } from "react";
import { Eyebrow } from "@/components/ui/primitives";
import { cn } from "@/lib/cn";

// The header every stage page opens with: where the reader is in the journey,
// what this page decides, and (on the right) the state that decides whether
// they can move on. The title text is a contract with the e2e spec
// ("Your brand profile", "Topics & competitors", "Prompt Intelligence").

export const STAGE_INDEX: Record<string, number> = { understand: 1, landscape: 2, prompts: 3, measure: 4 };
export const STAGE_NAME: Record<string, string> = { understand: "Understand", landscape: "Landscape", prompts: "Prompts", measure: "Measure" };

export function StageHeader({
  stage,
  title,
  lede,
  aside,
  className,
  children,
}: {
  stage: "understand" | "landscape" | "prompts" | "measure";
  title: ReactNode;
  lede?: ReactNode;
  /** Status on the right: a chip, a count, a version. */
  aside?: ReactNode;
  className?: string;
  /** Anything below the lede (tabs, a scope strip). */
  children?: ReactNode;
}) {
  return (
    <header className={cn("flex flex-col gap-5", className)}>
      <div className="flex flex-col gap-4 lg:flex-row lg:items-end lg:justify-between">
        <div className="min-w-0 max-w-3xl">
          <Eyebrow tone="sun">
            Step {STAGE_INDEX[stage]} of 4 · {STAGE_NAME[stage]}
          </Eyebrow>
          <h1 className="sun-title mt-2">{title}</h1>
          {lede && <div className="mt-2.5 max-w-2xl text-[15px] leading-6 text-ink-600">{lede}</div>}
        </div>
        {aside && <div className="flex shrink-0 flex-wrap items-center gap-2 lg:justify-end">{aside}</div>}
      </div>
      {children}
    </header>
  );
}

/** A row of labelled facts under a header: what is fixed, what will be measured. */
export function FactStrip({ items, className }: { items: Array<{ label: string; value: ReactNode; hint?: ReactNode; tone?: "default" | "sun" | "ok" | "warn" }>; className?: string }) {
  return (
    <dl className={cn("grid gap-px overflow-hidden rounded-2xl border border-ink-200/75 bg-ink-200/60 sm:grid-cols-2 lg:grid-cols-4", className)}>
      {items.map((item) => (
        <div key={item.label} className="bg-white px-4 py-3.5">
          <dt className="sun-eyebrow text-ink-500">{item.label}</dt>
          <dd className={cn("mt-1.5 text-[15px] font-semibold leading-6", item.tone === "sun" ? "text-sun-800" : item.tone === "ok" ? "text-ok-600" : item.tone === "warn" ? "text-warn-600" : "text-ink-950")}>{item.value}</dd>
          {item.hint && <dd className="mt-0.5 text-xs leading-5 text-ink-500">{item.hint}</dd>}
        </div>
      ))}
    </dl>
  );
}
