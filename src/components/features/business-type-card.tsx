"use client";

import { useId, useState } from "react";
import { Disclosure, EditedBadge, EvidenceLink, FieldShell } from "@/components/features/profile-fields";
import { Button } from "@/components/ui/button";
import { Input, Label, Notice, Select, Spinner } from "@/components/ui/primitives";
import type { ClassificationEditInput } from "@/lib/client/api";
import type { BusinessClassification } from "@/lib/profile/schema";
import { BUSINESS_KIND_LABELS, BUSINESS_KINDS, PHYSICAL_PRESENCE, type BusinessKind, type PhysicalPresence } from "@/lib/understanding/kinds";

// "What kind of business is this?" as a confirmation, not a form. A Dubai hair
// salon was once filed under healthcare because the operator had to pick from a
// closed list; now the page shows the open classification the website supports,
// with the nearest alternatives as quick fills inside the Change editor.
//
// Categories the analysis considered and set aside are stored but not shown,
// and neither are the reasons: next to the answer they read as rejected items,
// which operators asked not to see (feedback 2026-09-14). No confidence label
// either; "Edited by you" is the only badge.

export const PRESENCE_LABELS: Record<PhysicalPresence, string> = {
  single_location: "One location customers visit",
  multi_location: "Several locations or branches",
  service_area: "Goes to customers in an area",
  online_only: "Online only",
  unknown: "Not sure",
};

const PRICE_LABELS: Record<string, string> = {
  budget: "Budget",
  mid_market: "Mid-range",
  premium: "Premium",
  luxury: "Luxury",
};

function kindLabel(kind: string): string {
  return BUSINESS_KIND_LABELS[kind as BusinessKind] ?? kind.replace(/_/g, " ");
}

/** "Personal care & wellness (salons, spas, barbers)" → "Personal care & wellness". */
function shortKindLabel(kind: string): string {
  return kindLabel(kind).replace(/\s*\(.*\)\s*$/, "");
}

interface Draft {
  businessType: string;
  industry: string;
  kind: string;
  physicalPresence: string;
}

export function BusinessTypeCard({
  projectId,
  classification,
  locked,
  onEditingChange,
  onSave,
}: {
  projectId: string;
  classification: BusinessClassification;
  /** True while the whole-profile editor is open. */
  locked: boolean;
  onEditingChange?: (editing: boolean) => void;
  onSave: (edit: ClassificationEditInput) => Promise<void>;
}) {
  const [draft, setDraft] = useState<Draft | null>(null);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const ids = useId();

  const plain = classification.localCategory?.trim() || classification.businessType;
  const detail =
    classification.businessType && classification.businessType.trim().toLowerCase() !== plain.trim().toLowerCase() ? classification.businessType : null;
  // How customers reach the business ("One location customers visit") is not
  // shown as a chip: on the card it added nothing and raised questions
  // (feedback 2026-09-19). It stays in the data and in the Change editor.
  const facts = [PRICE_LABELS[classification.pricePositioning] ?? null].filter((f): f is string => Boolean(f));
  const alternatives = classification.alternatives.filter((a) => a.businessType.trim());

  function open(prefill?: Partial<Draft>) {
    setDraft({
      businessType: classification.businessType,
      industry: classification.industry,
      kind: (BUSINESS_KINDS as readonly string[]).includes(classification.kind) ? classification.kind : "other",
      physicalPresence: (PHYSICAL_PRESENCE as readonly string[]).includes(classification.physicalPresence) ? classification.physicalPresence : "unknown",
      ...draft,
      ...prefill,
    });
    setError(null);
    onEditingChange?.(true);
  }

  function close() {
    setDraft(null);
    setError(null);
    onEditingChange?.(false);
  }

  async function save() {
    if (!draft) return;
    const businessType = draft.businessType.trim();
    if (!businessType) {
      setError("Describe the business type in a few words.");
      return;
    }
    setSaving(true);
    setError(null);
    const industry = draft.industry.trim();
    try {
      await onSave({
        businessType: businessType.slice(0, 120),
        ...(industry ? { industry: industry.slice(0, 120) } : {}),
        // A new industry makes the old sub-industry wrong ("Healthcare › Hair
        // and Beauty Salons"), so it is dropped rather than carried over.
        ...(industry && industry.toLowerCase() !== classification.industry.trim().toLowerCase() ? { subIndustry: null } : {}),
        kind: draft.kind,
        physicalPresence: draft.physicalPresence,
      });
      setDraft(null);
      onEditingChange?.(false);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not save the business type.");
    } finally {
      setSaving(false);
    }
  }

  // Quick fills inside the editor only, without the model's "why" for each.
  const alternativeChips = alternatives.length > 0 && (
    <div className="mt-3 flex flex-wrap items-center gap-2">
      <span className="text-xs text-ink-500">Suggestions:</span>
      {alternatives.map((alternative) => (
        <button
          key={alternative.businessType}
          type="button"
          disabled={locked || saving}
          onClick={() => open({ businessType: alternative.businessType, kind: (BUSINESS_KINDS as readonly string[]).includes(alternative.kind) ? alternative.kind : draft?.kind })}
          className="focus-ring rounded-full border border-dashed border-ink-300 bg-white px-3 py-1 text-xs text-ink-700 transition hover:border-sun-500 hover:bg-sun-50 hover:text-sun-900 disabled:cursor-not-allowed disabled:opacity-50"
        >
          {alternative.businessType}
        </button>
      ))}
    </div>
  );

  return (
    <FieldShell label="Business type" badge={<EditedBadge edited={classification.source === "user"} />}>
      {classification.path.length > 1 && (
        <nav aria-label="Category path">
          <ol className="flex flex-wrap items-center gap-x-1 gap-y-0.5 text-xs text-ink-500">
            {classification.path.map((part, index) => (
              <li key={`${part}-${index}`} className="flex items-center gap-1">
                {index > 0 && <span aria-hidden="true">›</span>}
                <span className={index === classification.path.length - 1 ? "font-medium text-ink-700" : undefined}>{part}</span>
              </li>
            ))}
          </ol>
        </nav>
      )}

      <div className="mt-1 flex items-start justify-between gap-3">
        <div className="min-w-0 flex-1">
          <p className="text-lg font-semibold leading-7 tracking-[-0.01em] text-ink-950">{plain || <span className="italic text-ink-400">Not classified yet</span>}</p>
          {detail && <p className="mt-0.5 text-sm text-ink-600">{detail}</p>}
        </div>
        {!draft && (
          <Button size="sm" variant="secondary" className="shrink-0" onClick={() => open()} disabled={locked} aria-label="Change business type">
            Change
          </Button>
        )}
      </div>

      <div className="mt-2 flex flex-wrap gap-1.5">
        <span title={kindLabel(classification.kind)} className="rounded-full bg-ink-100 px-2.5 py-0.5 text-xs font-medium text-ink-700">
          {shortKindLabel(classification.kind)}
        </span>
        {facts.map((fact) => (
          <span key={fact} className="rounded-full border border-ink-200 bg-paper px-2.5 py-0.5 text-xs text-ink-600">
            {fact}
          </span>
        ))}
      </div>

      {draft ? (
        <div className="sun-inset mt-3 p-4">
          <div className="grid gap-3 sm:grid-cols-2">
            <div className="sm:col-span-2">
              <Label htmlFor={`${ids}-type`}>Business type</Label>
              <Input
                id={`${ids}-type`}
                value={draft.businessType}
                maxLength={120}
                onChange={(e) => setDraft({ ...draft, businessType: e.target.value })}
                placeholder="e.g. Hair salon, Italian restaurant, Payroll software"
              />
            </div>
            <div className="sm:col-span-2">
              <Label htmlFor={`${ids}-industry`}>Industry</Label>
              <Input
                id={`${ids}-industry`}
                value={draft.industry}
                maxLength={120}
                onChange={(e) => setDraft({ ...draft, industry: e.target.value })}
                placeholder="e.g. Beauty and Personal Care"
              />
            </div>
            <div>
              <Label htmlFor={`${ids}-kind`}>Kind of business</Label>
              <Select id={`${ids}-kind`} value={draft.kind} onChange={(e) => setDraft({ ...draft, kind: e.target.value })}>
                {BUSINESS_KINDS.map((kind) => (
                  <option key={kind} value={kind}>
                    {BUSINESS_KIND_LABELS[kind]}
                  </option>
                ))}
              </Select>
            </div>
            <div>
              <Label htmlFor={`${ids}-presence`}>How customers reach it</Label>
              <Select id={`${ids}-presence`} value={draft.physicalPresence} onChange={(e) => setDraft({ ...draft, physicalPresence: e.target.value })}>
                {PHYSICAL_PRESENCE.map((presence) => (
                  <option key={presence} value={presence}>
                    {PRESENCE_LABELS[presence]}
                  </option>
                ))}
              </Select>
            </div>
          </div>
          {alternativeChips}
          {error && (
            <Notice tone="danger" role="alert" className="mt-3">
              {error}
            </Notice>
          )}
          <div className="mt-3 flex flex-wrap gap-2">
            <Button size="sm" onClick={save} disabled={saving}>
              {saving ? <Spinner /> : "Save business type"}
            </Button>
            <Button size="sm" variant="secondary" onClick={close} disabled={saving}>
              Cancel
            </Button>
          </div>
        </div>
      ) : null}

      {!draft && (classification.rationale || classification.evidenceIds.length > 0) && (
        <Disclosure>
          {classification.rationale && <p>{classification.rationale}</p>}
          <EvidenceLink projectId={projectId} evidenceIds={classification.evidenceIds} label="Show the website evidence" />
        </Disclosure>
      )}
    </FieldShell>
  );
}
