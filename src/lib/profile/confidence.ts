// Confidence is computed from evidence quality, not asserted by a model.
//
// A model that returns `confidence: 0.95` for a hallucinated field is worse
// than useless, so a model's number is never trusted directly. Instead:
//
//   strength      = best single item's source-type x page-type strength
//   agreement     = how many *distinct pages* independently support the claim
//   corroboration = whether a structured-data source agrees with a prose one
//
// The result is deterministic and reproducible: the same evidence always
// yields the same number, which makes low-confidence fields debuggable.

import { evidenceStrength, type EvidenceItem } from "@/lib/evidence/types";

export interface ConfidenceInput {
  items: EvidenceItem[];
  /** Conflicting observations found for the same field. */
  conflicts?: number;
  /** Caps the result, e.g. for a claim only a model could make. */
  ceiling?: number;
}

export function computeConfidence({ items, conflicts = 0, ceiling = 100 }: ConfidenceInput): number {
  if (items.length === 0) return 0;

  const bestStrength = Math.max(...items.map((i) => evidenceStrength(i)));
  const distinctPages = new Set(items.map((i) => i.crawlPageId ?? i.url)).size;
  const distinctSourceTypes = new Set(items.map((i) => i.sourceType)).size;
  const hasStructured = items.some((i) => i.sourceType === "jsonld" || i.sourceType === "microdata" || i.sourceType === "rdfa");
  const hasProse = items.some((i) => i.sourceType === "main_content" || i.sourceType === "heading");

  // Base: the strongest single source, 0-70 points.
  let score = bestStrength * 70;
  // Agreement across independent pages, up to +18.
  score += Math.min(18, (distinctPages - 1) * 7);
  // Multiple independent kinds of signal, up to +8.
  score += Math.min(8, (distinctSourceTypes - 1) * 3);
  // Structured data corroborated by visible copy is the strongest pattern.
  if (hasStructured && hasProse) score += 6;
  // Conflicting observations cut hard: a wrong confident field is the failure
  // mode this whole pipeline exists to avoid.
  score -= conflicts * 18;

  return Math.max(0, Math.min(ceiling, Math.round(score)));
}

/** Rolls per-field confidences into one headline number for the run. */
export function overallConfidence(fields: Array<{ confidence: number; weight: number }>): number {
  const totalWeight = fields.reduce((sum, f) => sum + f.weight, 0);
  if (totalWeight === 0) return 0;
  return Math.round(fields.reduce((sum, f) => sum + f.confidence * f.weight, 0) / totalWeight);
}
