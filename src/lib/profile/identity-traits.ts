// Brand identity traits, and audience.
//
// The failure mode here is well known: ask a model for "brand attributes" and
// every company on earth comes back "Innovative, Trusted, Customer-focused,
// High-quality". Those are not attributes, they are the absence of one.
//
// Two controls prevent it:
//   1. a curated vocabulary — each trait has concrete lexical evidence
//      patterns, so a trait can only be claimed if the site actually says
//      something specific;
//   2. a page-count threshold — a trait found on one page is surfaced with
//      `needsCheck: true` rather than adopted (this is the control that
//      catches the "eco-friendly Pilates studio" failure).

import { computeConfidence } from "./confidence";
import type { EvidenceItem } from "@/lib/evidence/types";
import type { PageType } from "@/lib/crawler/page-classifier";
import type { IdentityTrait } from "./schema";

export interface TraitDefinition {
  value: string;
  patterns: RegExp[];
  /** Traits that cannot both be true; the better-supported one wins. */
  conflictsWith?: string[];
}

export const IDENTITY_VOCABULARY: TraitDefinition[] = [
  { value: "Premium", patterns: [/\b(premium|luxury|luxurious|high-end|finest|exquisite|flagship|couture|first-class)\b/i], conflictsWith: ["Affordable"] },
  { value: "Affordable", patterns: [/\b(affordable|budget-friendly|value for money|low(est)? price|everyday low|cost-effective|no hidden fees|free to start)\b/i], conflictsWith: ["Premium"] },
  { value: "Performance-driven", patterns: [/\b(performance|engineered for|race-ready|pro-grade|professional-grade|competition|speed|precision-engineered|responsive cushioning|high-performance)\b/i] },
  { value: "Innovation-led", patterns: [/\b(patented|proprietary technology|breakthrough|r&d|research and development|next-generation|first of its kind|award-winning (design|technology))\b/i] },
  { value: "Sustainable", patterns: [/\b(sustainab|eco-friendly|recycled|carbon (neutral|negative|footprint)|net zero|ethically sourced|renewable|biodegradable|circular)\b/i] },
  { value: "Enterprise-focused", patterns: [/\b(enterprise|fortune 500|large organi[sz]ations|soc 2|iso 27001|sso|role-based access|dedicated account manager|sla)\b/i], conflictsWith: ["Small-business friendly"] },
  { value: "Small-business friendly", patterns: [/\b(small business(es)?|smb|startups?|solo|freelancers?|no credit card required|get started in minutes)\b/i], conflictsWith: ["Enterprise-focused"] },
  { value: "Craft & artisanal", patterns: [/\b(handcrafted|handmade|artisan|small-batch|hand-finished|bespoke tailoring|traditional methods|master craftsm)\b/i] },
  { value: "Family-focused", patterns: [/\b(family-(owned|run|friendly|oriented)|for families|kids|children|parents|generations)\b/i] },
  { value: "Community-oriented", patterns: [/\b(community|local(ly)? (owned|rooted)|give(s|n)? back|neighbou?rhood|members|club|together)\b/i] },
  { value: "Clinically rigorous", patterns: [/\b(clinically (proven|tested)|evidence-based|peer-reviewed|accredited|board-certified|nabh|jci|dermatologist-tested)\b/i] },
  { value: "Design-led", patterns: [/\b(design-led|minimalist|beautifully designed|aesthetic|iconic design|timeless design|award-winning design)\b/i] },
  { value: "Fast & convenient", patterns: [/\b(same-day|next-day|24\/7|round-the-clock|instant|in minutes|fast delivery|quick turnaround|express)\b/i] },
  { value: "Personalised service", patterns: [/\b(personali[sz]ed|tailored to|custom-built|one-to-one|dedicated (advisor|consultant)|bespoke solution)\b/i] },
  { value: "Trusted & established", patterns: [/\b(since \d{4}|founded in \d{4}|over \d+ years|decades of|\d+ (million|lakh|crore)\+? (customers|users|patients|clients))\b/i] },
  { value: "Security & compliance focused", patterns: [/\b(end-to-end encryption|gdpr|hipaa|pci dss|iso 27001|zero-trust|data residency|audited)\b/i] },
  { value: "Technically deep", patterns: [/\b(open source|sdk|api-first|documentation|self-hosted|architecture|latency|throughput|benchmarks?)\b/i] },
  { value: "Inclusive & accessible", patterns: [/\b(inclusive|accessib(le|ility)|all body types|every skin tone|wcag|adaptive|for everyone)\b/i] },
  { value: "Wide selection", patterns: [/\b(thousands of|widest range|extensive (range|catalog)|over \d+ (products|brands|styles)|everything you need)\b/i] },
  { value: "Expert-led", patterns: [/\b(our experts|specialists?|certified (technicians?|professionals?)|led by|team of experienced|industry veterans)\b/i] },
];

const MIN_PAGES_FOR_CONFIDENT_TRAIT = 2;
const MAX_TRAITS = 6;

export function resolveBrandIdentity(evidence: EvidenceItem[]): IdentityTrait[] {
  const hits = new Map<string, { pages: Set<string>; evidenceIds: string[]; weight: number }>();

  for (const item of evidence) {
    // Positioning language lives in prose, headings and taglines — not in a
    // nav label or a table cell, where matching would be noise.
    if (!["main_content", "heading", "meta", "jsonld", "microdata", "rdfa"].includes(item.sourceType)) continue;
    for (const trait of IDENTITY_VOCABULARY) {
      if (!trait.patterns.some((p) => p.test(item.text))) continue;
      const entry = hits.get(trait.value) ?? { pages: new Set<string>(), evidenceIds: [], weight: 0 };
      entry.pages.add(item.crawlPageId ?? item.url);
      if (entry.evidenceIds.length < 6 && !entry.evidenceIds.includes(item.id)) entry.evidenceIds.push(item.id);
      // A claim on the About page or in structured data outranks one buried in
      // a product description.
      entry.weight += item.pageType === "about" || item.pageType === "home" ? 2 : 1;
      hits.set(trait.value, entry);
    }
  }

  const byId = new Map(evidence.map((e) => [e.id, e]));
  const scored = [...hits.entries()]
    .map(([value, entry]) => {
      const items = entry.evidenceIds.map((id) => byId.get(id)).filter((i): i is EvidenceItem => Boolean(i));
      const needsCheck = entry.pages.size < MIN_PAGES_FOR_CONFIDENT_TRAIT;
      return {
        value,
        pageCount: entry.pages.size,
        weight: entry.weight,
        evidenceIds: entry.evidenceIds,
        needsCheck,
        // A single-page trait is capped low: surfaced for review, not adopted.
        confidence: computeConfidence({ items, ceiling: needsCheck ? 45 : 92 }),
      } satisfies IdentityTrait & { weight: number };
    })
    .sort((a, b) => b.pageCount - a.pageCount || b.weight - a.weight);

  // Resolve mutually exclusive traits in favour of the better-supported side.
  const accepted: Array<IdentityTrait & { weight: number }> = [];
  for (const trait of scored) {
    const definition = IDENTITY_VOCABULARY.find((t) => t.value === trait.value);
    const conflict = definition?.conflictsWith?.some((other) => accepted.some((a) => a.value === other));
    if (conflict) continue;
    accepted.push(trait);
    if (accepted.length >= MAX_TRAITS) break;
  }

  return accepted.map(({ weight: _weight, ...trait }) => trait);
}

// --- Target audience -------------------------------------------------------

const AUDIENCE_PATTERNS: Array<{ label: string; pattern: RegExp }> = [
  { label: "Enterprises", pattern: /\b(enterprises?|large organi[sz]ations|fortune \d+|global teams)\b/i },
  { label: "Small businesses", pattern: /\b(small businesses?|smbs?|small and medium|local businesses?)\b/i },
  { label: "Startups", pattern: /\b(startups?|founders?|early-stage)\b/i },
  { label: "Developers", pattern: /\b(developers?|engineers?|engineering teams?)\b/i },
  { label: "Marketers", pattern: /\b(marketers?|marketing teams?|growth teams?|cmos?)\b/i },
  { label: "Designers", pattern: /\b(designers?|design teams?|creatives?)\b/i },
  { label: "IT & security teams", pattern: /\b(it teams?|security teams?|cisos?|sysadmins?)\b/i },
  { label: "Finance teams", pattern: /\b(finance teams?|cfos?|accountants?|controllers?)\b/i },
  { label: "Athletes", pattern: /\b(athletes?|runners?|players?|sportspersons?|for training)\b/i },
  { label: "Families", pattern: /\b(families|family|parents?|households?)\b/i },
  { label: "Students", pattern: /\b(students?|learners?|graduates?|aspirants?)\b/i },
  { label: "Patients", pattern: /\b(patients?|caregivers?)\b/i },
  { label: "Homeowners", pattern: /\b(homeowners?|home owners?|residents?|tenants?)\b/i },
  { label: "Travellers", pattern: /\b(travell?ers?|guests?|holidaymakers?|tourists?)\b/i },
  { label: "Drivers & vehicle owners", pattern: /\b(drivers?|car owners?|vehicle owners?|motorists?)\b/i },
  { label: "Investors", pattern: /\b(investors?|traders?|shareholders?)\b/i },
  { label: "Retailers & resellers", pattern: /\b(retailers?|resellers?|distributors?|dealers?|stockists?)\b/i },
  { label: "Manufacturers & industry", pattern: /\b(manufacturers?|factories|plants?|industrial clients?)\b/i },
  { label: "Healthcare providers", pattern: /\b(clinicians?|doctors?|hospitals?|practices?|providers?)\b/i },
  { label: "Agencies", pattern: /\b(agencies|agency partners?|consultancies)\b/i },
  { label: "Sellers & merchants", pattern: /\b(sellers?|merchants?|vendors?|shop owners?)\b/i },
  { label: "Professionals", pattern: /\b(professionals?|practitioners?|specialists?)\b/i },
];

/** Only counts audience words in a "for X" / "built for X" framing. */
const AUDIENCE_FRAMING =
  /\b(for|built for|designed for|made for|ideal for|trusted by|serving|helps?|helping|used by|our (clients?|customers?|users?|patients?|students?|guests?) (are|include))\b/i;

/** Pages where a business explains who it serves. */
const AUDIENCE_BEARING_PAGE_TYPES = new Set<PageType>(["home", "about", "solution", "industry", "service_index", "service", "pricing", "faq", "case_study"]);

export function resolveTargetAudience(evidence: EvidenceItem[]): Array<{ value: string; confidence: number; evidenceIds: string[]; pageCount: number }> {
  const hits = new Map<string, { pages: Set<string>; evidenceIds: string[]; weight: number }>();

  for (const item of evidence) {
    const isAudienceSchema = item.fieldHint === "audience" && (item.sourceType === "jsonld" || item.sourceType === "microdata");
    if (!isAudienceSchema && !AUDIENCE_FRAMING.test(item.text)) continue;
    if (!["main_content", "heading", "meta", "jsonld", "microdata", "navigation"].includes(item.sourceType)) continue;
    // A business states who it serves on the pages where it explains itself.
    // A product listing that happens to contain the word "for students" is a
    // catalogue entry, not a positioning statement.
    if (!isAudienceSchema && !AUDIENCE_BEARING_PAGE_TYPES.has(item.pageType)) continue;

    for (const { label, pattern } of AUDIENCE_PATTERNS) {
      if (!pattern.test(item.text)) continue;
      const entry = hits.get(label) ?? { pages: new Set<string>(), evidenceIds: [], weight: 0 };
      entry.pages.add(item.crawlPageId ?? item.url);
      if (entry.evidenceIds.length < 6 && !entry.evidenceIds.includes(item.id)) entry.evidenceIds.push(item.id);
      entry.weight += isAudienceSchema ? 3 : item.pageType === "home" || item.pageType === "solution" || item.pageType === "industry" ? 2 : 1;
      hits.set(label, entry);
    }
  }

  const byId = new Map(evidence.map((e) => [e.id, e]));
  return [...hits.entries()]
    .map(([value, entry]) => ({
      value,
      pageCount: entry.pages.size,
      weight: entry.weight,
      evidenceIds: entry.evidenceIds,
      confidence: computeConfidence({
        items: entry.evidenceIds.map((id) => byId.get(id)).filter((i): i is EvidenceItem => Boolean(i)),
        ceiling: entry.pages.size >= 2 ? 88 : 50,
      }),
    }))
    .sort((a, b) => b.pageCount - a.pageCount || b.weight - a.weight)
    .slice(0, 5)
    .map(({ weight: _weight, ...rest }) => rest);
}
