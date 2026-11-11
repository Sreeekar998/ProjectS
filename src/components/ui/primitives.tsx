import { cn } from "@/lib/cn";
import type { HTMLAttributes, InputHTMLAttributes, TextareaHTMLAttributes, SelectHTMLAttributes, LabelHTMLAttributes, ReactNode, Ref } from "react";

// The product's small vocabulary of surfaces and controls. Pages compose these
// with `cn()`; nothing here knows about a stage.

// --- Surfaces -------------------------------------------------------------------

const cardTones = {
  /** A white sheet on the paper canvas. */
  default: "sun-sheet",
  /** A muted well: editors, alternatives, notes. */
  inset: "sun-inset",
  /** The one dark panel a page may carry. */
  ink: "sun-ink",
  /** A sun-tinted sheet for the stage-advancing moment (approved, frozen, ready). */
  sun: "rounded-2xl border border-sun-200 bg-sun-50",
};

export function Card({ className, tone = "default", ...props }: HTMLAttributes<HTMLDivElement> & { tone?: keyof typeof cardTones }) {
  return <div className={cn(cardTones[tone], className)} {...props} />;
}

export function CardHeader({ className, ...props }: HTMLAttributes<HTMLDivElement>) {
  return <div className={cn("border-b border-ink-100 px-5 py-4", className)} {...props} />;
}

export function CardBody({ className, ...props }: HTMLAttributes<HTMLDivElement>) {
  return <div className={cn("px-5 py-4", className)} {...props} />;
}

/** Small caps context line above a title. `tone="sun"` for stage context, `ink` for content. */
export function Eyebrow({ className, tone = "ink", ...props }: HTMLAttributes<HTMLParagraphElement> & { tone?: "sun" | "ink" }) {
  return <p className={cn("sun-eyebrow", tone === "sun" ? "text-sun-700" : "text-ink-500", className)} {...props} />;
}

// --- Badges and chips ---------------------------------------------------------------

const badgeTones = {
  neutral: "bg-ink-100 text-ink-700",
  outline: "border border-ink-200 bg-white text-ink-600",
  brand: "bg-brand-50 text-brand-600",
  sun: "bg-sun-100 text-sun-900",
  ok: "bg-ok-100 text-ok-600",
  warn: "bg-warn-100 text-warn-600",
  danger: "bg-danger-100 text-danger-600",
};

export function Badge({ tone = "neutral", className, ...props }: HTMLAttributes<HTMLSpanElement> & { tone?: keyof typeof badgeTones }) {
  return <span className={cn("inline-flex items-center gap-1 rounded-full px-2.5 py-0.5 text-xs font-medium", badgeTones[tone], className)} {...props} />;
}

/** A small live dot for states: collecting, done, paused. */
export function StatusDot({ tone = "neutral", pulse = false, className }: { tone?: "neutral" | "brand" | "sun" | "ok" | "warn" | "danger"; pulse?: boolean; className?: string }) {
  const color = { neutral: "bg-ink-400", brand: "bg-brand-500", sun: "bg-sun-500", ok: "bg-ok-500", warn: "bg-warn-500", danger: "bg-danger-500" }[tone];
  return (
    <span aria-hidden="true" className={cn("relative inline-flex h-2 w-2 shrink-0", className)}>
      {pulse && <span className={cn("absolute inline-flex h-full w-full rounded-full opacity-60 motion-safe:animate-ping motion-reduce:hidden", color)} />}
      <span className={cn("relative inline-flex h-2 w-2 rounded-full", color)} />
    </span>
  );
}

// --- Messages -------------------------------------------------------------------

const noticeTones = {
  info: "border-ink-200 bg-white text-ink-700",
  ok: "border-ok-500/30 bg-ok-100 text-ok-600",
  warn: "border-warn-500/30 bg-warn-100 text-warn-600",
  danger: "border-danger-500/30 bg-danger-100 text-danger-600",
  sun: "border-sun-200 bg-sun-50 text-ink-800",
};

/**
 * One voice for feedback: errors, saved notices, warnings. `role` defaults to
 * status; pass "alert" for errors the reader must see now.
 */
export function Notice({
  tone = "info",
  role = "status",
  title,
  className,
  children,
  action,
}: {
  tone?: keyof typeof noticeTones;
  role?: "status" | "alert";
  title?: ReactNode;
  className?: string;
  children?: ReactNode;
  action?: ReactNode;
}) {
  return (
    <div role={role} className={cn("flex flex-col gap-2 rounded-xl border px-4 py-3 text-sm leading-6 sm:flex-row sm:items-start sm:justify-between", noticeTones[tone], className)}>
      <div className="min-w-0">
        {title && <p className="font-semibold">{title}</p>}
        {children && <div className={title ? "mt-0.5" : undefined}>{children}</div>}
      </div>
      {action && <div className="shrink-0">{action}</div>}
    </div>
  );
}

// --- Segmented control --------------------------------------------------------------

export interface SegmentOption<T extends string> {
  value: T;
  label: ReactNode;
  count?: number | string | null;
}

/** A tab-like switch for scopes and filters (engine, question type). */
export function SegmentedControl<T extends string>({
  options,
  value,
  onChange,
  label,
  size = "md",
  className,
}: {
  options: Array<SegmentOption<T>>;
  value: T;
  onChange: (value: T) => void;
  label: string;
  size?: "sm" | "md";
  className?: string;
}) {
  return (
    <div role="tablist" aria-label={label} className={cn("inline-flex max-w-full flex-wrap gap-0.5 rounded-xl bg-ink-100 p-1", className)}>
      {options.map((option) => {
        const active = option.value === value;
        return (
          <button
            key={option.value}
            type="button"
            role="tab"
            aria-selected={active}
            onClick={() => onChange(option.value)}
            className={cn(
              "focus-ring rounded-lg font-medium transition-colors",
              size === "sm" ? "px-2.5 py-1 text-xs" : "px-3 py-1.5 text-sm",
              active ? "bg-white text-ink-950 shadow-sheet" : "text-ink-600 hover:text-ink-950",
            )}
          >
            {option.label}
            {option.count !== undefined && option.count !== null && <span className={cn("ml-1.5 tabular-nums", active ? "text-ink-500" : "text-ink-400", size === "sm" ? "text-[11px]" : "text-xs")}>{option.count}</span>}
          </button>
        );
      })}
    </div>
  );
}

// --- Form controls --------------------------------------------------------------------

// React 19 passes `ref` through as an ordinary prop on function components,
// so these primitives can stay plain functions and still be focusable from a
// parent (the analysis form focuses the URL field when no URL was carried in).
export function Input({ className, ref, ...props }: InputHTMLAttributes<HTMLInputElement> & { ref?: Ref<HTMLInputElement> }) {
  return (
    <input
      ref={ref}
      className={cn(
        "focus-ring h-10 w-full rounded-lg border border-ink-200 bg-white px-3 text-sm text-ink-900 shadow-sheet placeholder:text-ink-400 hover:border-ink-300 disabled:cursor-not-allowed disabled:bg-ink-50 disabled:text-ink-400",
        className,
      )}
      {...props}
    />
  );
}

export function Textarea({ className, ref, ...props }: TextareaHTMLAttributes<HTMLTextAreaElement> & { ref?: Ref<HTMLTextAreaElement> }) {
  return (
    <textarea
      ref={ref}
      className={cn(
        "focus-ring w-full rounded-lg border border-ink-200 bg-white px-3 py-2 text-sm leading-6 text-ink-900 shadow-sheet placeholder:text-ink-400 hover:border-ink-300",
        className,
      )}
      {...props}
    />
  );
}

export function Select({ className, children, ref, ...props }: SelectHTMLAttributes<HTMLSelectElement> & { ref?: Ref<HTMLSelectElement> }) {
  return (
    <select
      ref={ref}
      className={cn(
        "focus-ring h-10 w-full appearance-none rounded-lg border border-ink-200 bg-white bg-[url('data:image/svg+xml;utf8,<svg xmlns=%22http://www.w3.org/2000/svg%22 width=%2216%22 height=%2216%22 viewBox=%220 0 20 20%22 fill=%22%23767c8d%22><path d=%22M5.23 7.21a.75.75 0 0 1 1.06.02L10 11.17l3.71-3.94a.75.75 0 1 1 1.08 1.04l-4.25 4.5a.75.75 0 0 1-1.08 0l-4.25-4.5a.75.75 0 0 1 .02-1.06z%22/></svg>')] bg-[length:16px_16px] bg-[position:right_0.6rem_center] bg-no-repeat pl-3 pr-9 text-sm text-ink-900 shadow-sheet hover:border-ink-300 disabled:cursor-not-allowed disabled:bg-ink-50",
        className,
      )}
      {...props}
    >
      {children}
    </select>
  );
}

export function Label({ className, ...props }: LabelHTMLAttributes<HTMLLabelElement>) {
  return <label className={cn("mb-1.5 block text-sm font-medium text-ink-800", className)} {...props} />;
}

export function Spinner({ className }: { className?: string }) {
  return (
    <svg className={cn("h-4 w-4 animate-spin text-current", className)} viewBox="0 0 24 24" fill="none" aria-hidden="true">
      <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
      <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8v4a4 4 0 00-4 4H4z" />
    </svg>
  );
}

export function EmptyState({ title, description, action, className }: { title: string; description?: string; action?: ReactNode; className?: string }) {
  return (
    <div className={cn("flex flex-col items-center justify-center rounded-2xl border border-dashed border-ink-300 bg-paper px-6 py-12 text-center", className)}>
      <div className="text-sm font-semibold text-ink-900">{title}</div>
      {description && <div className="mt-1 max-w-md text-sm leading-6 text-ink-500">{description}</div>}
      {action && <div className="mt-4">{action}</div>}
    </div>
  );
}
