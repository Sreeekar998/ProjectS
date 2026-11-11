// The Evidence model.
//
// Every substantive field on a Brand Profile must point back to one or more
// EvidenceItem ids. That is what separates this pipeline from "send the page
// text to a model and hope": a claim with no evidence id is not a low-quality
// claim, it is an invalid one, and the validator drops it.
//
// An EvidenceItem is deliberately small and typed. `sourceType` records *how*
// the fact was observed (structured data is stronger than a footer sentence),
// and `fieldHint` records what it is likely to support, so the synthesis layer
// can assemble a compact, relevant pack instead of a wall of text.

import type { PageType } from "@/lib/crawler/page-classifier";

export type EvidenceSourceType =
  | "jsonld"
  | "microdata"
  | "rdfa"
  | "meta"
  | "heading"
  | "navigation"
  | "breadcrumb"
  | "main_content"
  | "list_item"
  | "table"
  | "address"
  | "hreflang"
  | "currency"
  | "phone"
  | "image_alt"
  | "url_signal"
  | "other";

export type EvidenceFieldHint =
  | "brand_name"
  | "brand_alias"
  | "description"
  | "industry"
  | "archetype"
  | "offering"
  | "identity"
  | "market"
  | "audience"
  | "language"
  | "contact";

/**
 * Weight of a source type when computing field confidence. Explicit machine-
 * readable declarations outrank prose; navigation outranks body copy because
 * a business puts its actual offering structure in its own nav.
 */
export const SOURCE_TYPE_STRENGTH: Record<EvidenceSourceType, number> = {
  jsonld: 1.0,
  microdata: 0.85,
  rdfa: 0.8,
  hreflang: 0.85,
  breadcrumb: 0.75,
  navigation: 0.72,
  address: 0.8,
  meta: 0.6,
  heading: 0.58,
  currency: 0.55,
  phone: 0.55,
  url_signal: 0.5,
  list_item: 0.45,
  table: 0.45,
  main_content: 0.4,
  image_alt: 0.25,
  other: 0.2,
};

/**
 * Weight of the page an item came from. A claim sourced from the About page
 * is worth more than the same claim in a blog post.
 */
export const PAGE_TYPE_STRENGTH: Record<PageType, number> = {
  home: 1.0,
  about: 0.95,
  product_index: 0.9,
  service_index: 0.9,
  category: 0.8,
  solution: 0.8,
  industry: 0.78,
  store_locator: 0.8,
  pricing: 0.75,
  location: 0.75,
  product: 0.65,
  service: 0.68,
  contact: 0.7,
  case_study: 0.5,
  faq: 0.5,
  editorial: 0.3,
  careers: 0.25,
  legal: 0.2,
  menu: 0.9,
  booking: 0.6,
  team: 0.45,
  reviews: 0.4,
  gallery: 0.2,
  other: 0.4,
};

export interface EvidenceItem {
  id: string;
  runId: string;
  projectId: string;
  crawlPageId: string | null;
  url: string;
  canonicalUrl?: string | null;
  pageType: PageType;
  sourceType: EvidenceSourceType;
  text: string;
  fieldHint?: EvidenceFieldHint | null;
  /** Optional structured payload, e.g. a normalized address or schema node. */
  data?: Record<string, unknown> | null;
  extractedAt: string;
}

export type NewEvidenceItem = Omit<EvidenceItem, "id" | "extractedAt"> & {
  id?: string;
  extractedAt?: string;
};

/** Base 0-1 strength of a single item, before agreement across pages. */
export function evidenceStrength(item: Pick<EvidenceItem, "sourceType" | "pageType">): number {
  return SOURCE_TYPE_STRENGTH[item.sourceType] * PAGE_TYPE_STRENGTH[item.pageType];
}

export interface EvidencePack {
  projectId: string;
  runId: string;
  canonicalDomain: string;
  seedUrl: string;
  /** Compact, deduplicated items grouped for the synthesis prompt. */
  items: EvidenceItem[];
  /** Pages actually processed, for context and citation. */
  pages: Array<{ id: string; url: string; pageType: PageType; title: string | null }>;
  /** Deterministic pre-computation the model is asked to confirm, not invent. */
  deterministic: {
    brandNameCandidates: Array<{ value: string; score: number; evidenceIds: string[] }>;
    offeringCandidates: Array<{ name: string; type: string; support: number; evidenceIds: string[] }>;
    marketCandidates: Array<{ name: string; level: string; support: number; evidenceIds: string[] }>;
    identityCandidates: Array<{ value: string; pageCount: number; evidenceIds: string[] }>;
    audienceCandidates: Array<{ value: string; pageCount: number; evidenceIds: string[] }>;
    industryCandidates: Array<{ taxonomyId: string; label: string; primary: string; secondary: string | null; score: number; evidenceIds: string[] }>;
    languages: string[];
  };
}
