"use client";

import { useState, type ReactNode } from "react";
import { Badge, Input, Spinner } from "@/components/ui/primitives";
import { api, type EvidenceRecord } from "@/lib/client/api";
import { cn } from "@/lib/cn";

// Presentation for one Brand Profile field: value, provenance badge, an inline
// editor, and a "Why?" affordance that pulls the evidence behind the field.
// The evidence panel is deliberately opt-in — a marketing user sees a clean
// profile, and the provenance is one click away when they want to check it.

// Provenance badges, not confidence levels. Operators found "Medium/Low
// confidence" labels confusing and asked for them to go (feedback 2026-09-14);
// what stays is who shaped a value.

/** "Edited by you" when the operator changed this value; nothing otherwise. */
export function EditedBadge({ edited }: { edited: boolean }) {
  if (!edited) return null;
  return <Badge tone="brand">Edited by you</Badge>;
}

/** The operator's intake answer ("Where are your customers?") shaped this value. */
export function ToldUsBadge() {
  return <Badge tone="brand">You told us</Badge>;
}

/** The trigger every evidence affordance shares: a quiet, dotted "Why?". */
export function WhyButton({ open, onClick, label = "Why?", className }: { open: boolean; onClick: () => void; label?: string; className?: string }) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-expanded={open}
      className={cn(
        "focus-ring inline-flex items-center gap-1 rounded text-xs font-medium underline decoration-dotted underline-offset-[3px] transition-colors",
        open ? "text-sun-800 decoration-sun-500" : "text-ink-500 decoration-ink-300 hover:text-sun-800 hover:decoration-sun-500",
        className,
      )}
    >
      <span aria-hidden="true" className={cn("grid h-3.5 w-3.5 place-items-center rounded-full border text-[9px] font-bold", open ? "border-sun-500 bg-sun-100 text-sun-800" : "border-ink-300 text-ink-500")}>
        ?
      </span>
      {label}
    </button>
  );
}

/** The panel an evidence affordance opens: stored snippets, with where each came from. */
export function EvidencePanel({ children, className, label = "From the website" }: { children: ReactNode; className?: string; label?: string | null }) {
  return (
    <div className={cn("sun-evidence mt-2 px-3.5 py-3 text-xs leading-5 text-ink-700", className)}>
      {label && <p className="sun-eyebrow mb-1.5 text-sun-800">{label}</p>}
      {children}
    </div>
  );
}

export function EvidenceLink({
  projectId,
  evidenceIds,
  label = "Why?",
}: {
  projectId: string;
  evidenceIds: string[];
  label?: string;
}) {
  const [open, setOpen] = useState(false);
  const [items, setItems] = useState<EvidenceRecord[] | null>(null);
  const [loading, setLoading] = useState(false);

  if (evidenceIds.length === 0) return null;

  async function toggle() {
    if (open) {
      setOpen(false);
      return;
    }
    setOpen(true);
    if (items) return;
    setLoading(true);
    try {
      const { evidence } = await api.getEvidence(projectId, evidenceIds);
      setItems(evidence);
    } catch {
      setItems([]);
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="mt-2">
      <WhyButton open={open} onClick={toggle} label={label} />
      {open && (
        <EvidencePanel>
          {loading && (
            <div className="flex items-center gap-2 text-ink-500">
              <Spinner /> Loading evidence…
            </div>
          )}
          {items && items.length === 0 && <div className="text-ink-500">No stored evidence for this field.</div>}
          {items && items.length > 0 && (
            <ul className="space-y-3">
              {items.map((item) => (
                <li key={item.id}>
                  <div className="flex flex-wrap items-center gap-1.5">
                    <span className="rounded bg-white/80 px-1.5 py-0.5 text-[10px] font-medium uppercase tracking-wide text-ink-600 ring-1 ring-sun-200">{item.pageType.replace(/_/g, " ")}</span>
                    <span className="text-[10px] uppercase tracking-wide text-ink-500">{item.sourceType.replace(/_/g, " ")}</span>
                  </div>
                  <p className="mt-1 text-[13px] leading-5 text-ink-800">“{item.text}”</p>
                  <a
                    href={item.url}
                    target="_blank"
                    rel="noreferrer noopener"
                    className="focus-ring mt-0.5 inline-block max-w-full truncate rounded text-[11px] text-ink-500 underline underline-offset-2 hover:text-brand-600"
                  >
                    {item.url}
                  </a>
                </li>
              ))}
            </ul>
          )}
        </EvidencePanel>
      )}
    </div>
  );
}

export function FieldShell({
  label,
  badge,
  children,
  hint,
  className,
}: {
  label: string;
  badge?: ReactNode;
  children: ReactNode;
  hint?: string;
  className?: string;
}) {
  return (
    <section className={cn("border-b border-ink-100 py-4 first:pt-0 last:border-0 last:pb-0", className)}>
      <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
        <h3 className="sun-eyebrow text-ink-500">{label}</h3>
        {badge}
      </div>
      {children}
      {hint && <p className="mt-2 text-xs leading-5 text-ink-500">{hint}</p>}
    </section>
  );
}

export interface ChipItem {
  value: string;
  meta?: string;
}

/**
 * Editable chip list. Chips are the right control here because every one of
 * these fields is a small set the user adds to or removes from, and a textarea
 * would lose the item boundaries the pipeline keeps evidence for.
 *
 * Items carry no confidence marker: a "check" chip on attributes seen on one
 * page was a confidence level in disguise, and those labels were removed
 * (feedback 2026-09-14). The evidence stays one click away under "Why?".
 */
export function ChipEditor({
  items,
  editing,
  onChange,
  emptyLabel,
  addLabel,
}: {
  items: ChipItem[];
  editing: boolean;
  onChange: (next: ChipItem[]) => void;
  emptyLabel: string;
  addLabel: string;
}) {
  const [draft, setDraft] = useState("");

  if (!editing) {
    if (items.length === 0) return <p className="text-sm italic text-ink-400">{emptyLabel}</p>;
    return (
      <ul className="flex flex-wrap gap-1.5">
        {items.map((item) => (
          <li key={item.value} className="inline-flex items-center gap-1.5 rounded-full border border-ink-200 bg-paper px-3 py-1 text-sm text-ink-800">
            {item.value}
            {item.meta && <span className="text-[10px] uppercase tracking-wide text-ink-400">{item.meta}</span>}
          </li>
        ))}
      </ul>
    );
  }

  function add() {
    const value = draft.trim();
    if (!value) return;
    if (items.some((i) => i.value.toLowerCase() === value.toLowerCase())) {
      setDraft("");
      return;
    }
    onChange([...items, { value }]);
    setDraft("");
  }

  return (
    <div>
      <ul className="flex flex-wrap gap-1.5">
        {items.map((item) => (
          <li key={item.value} className="inline-flex items-center gap-1 rounded-full border border-ink-200 bg-white py-1 pl-3 pr-1 text-sm text-ink-800">
            {item.value}
            <button
              type="button"
              onClick={() => onChange(items.filter((i) => i.value !== item.value))}
              aria-label={`Remove ${item.value}`}
              className="focus-ring flex h-5 w-5 items-center justify-center rounded-full text-ink-400 transition hover:bg-danger-100 hover:text-danger-600"
            >
              ×
            </button>
          </li>
        ))}
      </ul>
      <div className="mt-2 flex gap-2">
        <Input
          value={draft}
          onChange={(event) => setDraft(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === "Enter") {
              event.preventDefault();
              add();
            }
          }}
          placeholder={addLabel}
          aria-label={addLabel}
          className="h-9"
        />
        <button type="button" onClick={add} className="focus-ring shrink-0 rounded-lg border border-ink-200 bg-white px-3 text-sm font-medium text-ink-800 transition hover:bg-paper">
          Add
        </button>
      </div>
    </div>
  );
}

/**
 * Opt-in explanation panel, styled like `EvidenceLink`, for reasons that are
 * not stored evidence rows (a classification rationale, how location signals
 * voted).
 */
export function Disclosure({ label = "Why?", children }: { label?: string; children: ReactNode }) {
  const [open, setOpen] = useState(false);
  return (
    <div className="mt-2">
      <WhyButton open={open} onClick={() => setOpen((v) => !v)} label={label} />
      {open && <EvidencePanel label="Why the analysis says so">{children}</EvidencePanel>}
    </div>
  );
}
