// Offering resolution: raw candidates -> useful commercial categories.
//
// The failure this module exists to prevent is returning
//   ["Pegasus 41", "Vomero 18", "Structure 25", "InfinityRN 4", …]
// when the answer is
//   ["Running Shoes", "Basketball Footwear", "Training Apparel"].
//
// The opposite failure matters just as much: ["Products", "Services",
// "Solutions"] is technically correct and completely useless. So the pipeline
// is: collect candidates -> reject noise -> consolidate near-duplicates ->
// prefer category-level names -> rank by cross-page support.

import type { EvidenceItem } from "@/lib/evidence/types";
import { evidenceStrength } from "@/lib/evidence/types";
import { computeConfidence } from "./confidence";
import type { BusinessArchetype, Offering, OfferingType } from "./schema";

export interface OfferingCandidate {
  name: string;
  normalized: string;
  type: OfferingType;
  support: number;
  pageIds: Set<string>;
  evidenceIds: string[];
  sourceKinds: Set<string>;
  /**
   * True when every observation of this name was an individual item — a
   * `Product` node's own name, or the H1 of a single product/service page.
   * "Velocity 3 Men's Road Shoe" is an instance; "Running Shoes" is a
   * category. Instances are the thing a buyer does NOT need in a profile,
   * so they are only used when nothing better survives.
   */
  isInstance: boolean;
}

/** Words that are never an offering on their own. */
const GENERIC_TERMS = new Set([
  "products",
  "product",
  "services",
  "service",
  "solutions",
  "solution",
  "offerings",
  "shop",
  "store",
  "home",
  "about",
  "about us",
  "contact",
  "contact us",
  "blog",
  "news",
  "careers",
  "login",
  "log in",
  "sign in",
  "sign up",
  "register",
  "cart",
  "bag",
  "basket",
  "checkout",
  "search",
  "menu",
  "more",
  "all",
  "view all",
  "shop all",
  "see all",
  "learn more",
  "read more",
  "get started",
  "explore",
  "discover",
  "overview",
  "features",
  "pricing",
  "plans",
  "faq",
  "faqs",
  "help",
  "support",
  "resources",
  "company",
  "team",
  "press",
  "privacy",
  "terms",
  "legal",
  "cookies",
  "sitemap",
  "newsletter",
  "subscribe",
  "follow us",
  "my account",
  "account",
  "wishlist",
  "new",
  "sale",
  "offers",
  "deals",
  "gift cards",
  "gifts",
  "brands",
  "collections",
  "categories",
  "shop now",
  "buy now",
  "book now",
  "our story",
  "why us",
  "how it works",
  "case studies",
  "customers",
  "partners",
  "events",
  "webinars",
  "documentation",
  "docs",
  "api",
  "status",
  "download",
  "downloads",
  "français",
  "español",
  "english",
  // Section/page names. These are what a site calls a *listing* of its
  // offerings, never an offering itself, and they recur across every industry.
  "capabilities",
  "our capabilities",
  "industries",
  "industries we serve",
  "our services",
  "what we do",
  "our work",
  "our menu",
  "specialities",
  "specialties",
  "our specialities",
  "our specialties",
  "departments",
  "branches",
  "our branches",
  "locations",
  "our locations",
  "our hospitals",
  "our stores",
  "our doctors",
  "doctors",
  "find a branch",
  "find a store",
  "store locator",
  "areas we cover",
  "areas we serve",
  "service areas",
  "reservations",
  "book appointment",
  "book a table",
  "appointments",
  "platform",
  "the platform",
  "integrations",
  "portal",
  "patient portal",
]);

/**
 * Merchandising furniture: a way of SLICING the catalogue, not a line of
 * business.
 *
 * Ranking offerings by evidence support alone surfaces whatever the global
 * navigation repeats on every page, and on a retail site that is the
 * promotional rail — "Top Picks Under ₹4999", "Fresh Drops", "New Arrivals".
 * Those are price points and campaigns; a buyer never shops for one, and a
 * measurement prompt built from one is nonsense in any language.
 */
const MERCHANDISING_PATTERN = new RegExp(
  [
    // Price-point filters, in any currency.
    String.raw`(?:^|\s)(?:under|below|upto|up to|from)\s*[₹$€£¥]?\s*\d`,
    String.raw`[₹$€£¥]\s?\d`,
    String.raw`^\d+%\s*off`,
    // Promotional rails and merchandising sections.
    String.raw`^(?:sale|clearance|outlet|deal|offer|bestseller|best seller|top pick|top rated|trending|featured|fresh drop|just in|new arrival|last chance|limited edition|coming soon|back in stock|final sale|gift (?:guide|card|idea|set)|shop by \w+|member \w+|exclusive)`,
    // Seasonal campaigns.
    String.raw`^(?:spring|summer|autumn|fall|winter|holiday|christmas|black friday|cyber monday|diwali|ramadan|easter|valentine)`,
  ].join("|"),
  "i",
);

/**
 * Head nouns that make a phrase something a customer can actually buy.
 *
 * This is the difference between "Shoes" and "Running": both are true of the
 * business, but only one is a purchasable category, and only one can head the
 * grammar of a buyer's question.
 */
const COMMERCIAL_HEAD =
  /\b(shoes?|sneakers?|trainers?|boots?|sandals?|slides?|footwear|apparel|clothing|wear|jackets?|coats?|hoodies?|sweatshirts?|shirts?|t-?shirts?|tops?|trousers?|pants?|jeans?|shorts?|skirts?|dresses|leggings?|socks?|underwear|swimwear|jerseys?|kits?|hats?|caps?|bags?|backpacks?|accessor(?:y|ies)|equipment|gear|balls?|watches?|eyewear|glasses|jewell?ery|furniture|sofas?|beds?|mattress(?:es)?|laptops?|phones?|tablets?|headphones?|cameras?|tools?|machines?|vehicles?|cars?|suvs?|trucks?|bikes?|tyres?|tires?|books?|cosmetics?|skincare|makeup|serums?|supplements?|vitamins?|foods?|snacks?|drinks?|beverages?|coffee|teas?|wines?|beers?|software|platforms?|suites?|systems?|solutions?|services?|plans?|policies|accounts?|loans?|mortgages?|cards?|insurance|treatments?|therapy|surgery|care|diagnostics?|imaging|scans?|courses?|programs?|programmes?|degrees?|classes?|rooms?|menus?|pizzas?|burgers?|bowls?|burritos?|tacos?|sandwiches|salads?|consulting|support|maintenance|repairs?|installation|cleaning|delivery|catering|dining|tours?)\b/i;

/** Imperative brand copy: "Just Do The Work", "Elevate Your Pre-Game Routine". */
const IMPERATIVE_SLOGAN =
  /^(just|don'?t|do|make|get|find|elevate|unleash|own|live|be|go|move|run|train|play|feel|dream|create|build|keep|stay|never|always|let|bring|take|push|chase|rise|win|gear up|level up)\b/i;

function looksLikeSlogan(name: string): boolean {
  const words = name.trim().split(/\s+/);
  if (words.length < 3) return false;
  // "Build Your Own Bundle" heads a real configurator on some sites, so a
  // phrase that still names a purchasable thing is kept.
  if (COMMERCIAL_HEAD.test(name)) return false;
  return IMPERATIVE_SLOGAN.test(name);
}

const NOISE_PATTERN =
  /^(\d+|[^a-z0-9]+|.{0,2})$|^\W|^(copyright|©|all rights|follow|share|next|previous|back to|skip to)/i;

/** A name that looks like a specific SKU rather than a category. */
const SKU_PATTERN = /\b(\d{2,}|v\d|mk\s?\d|gen\s?\d|\d+\s?(ml|mg|gb|tb|kg|oz|cm|mm|inch|"|'))\b/i;

const PLURAL_RULES: Array<[RegExp, string]> = [
  [/ies$/, "y"],
  [/ses$/, "s"],
  [/ches$/, "ch"],
  [/shes$/, "sh"],
  [/xes$/, "x"],
  [/s$/, ""],
];

export function singularize(word: string): string {
  if (word.length <= 3) return word;
  for (const [pattern, replacement] of PLURAL_RULES) {
    if (pattern.test(word)) return word.replace(pattern, replacement);
  }
  return word;
}

export function normalizeOfferingName(raw: string): string {
  return raw
    .toLowerCase()
    .replace(/[®™©]/g, "")
    .replace(/[^\p{L}\p{N}\s&/+-]/gu, " ")
    .replace(/\s+/g, " ")
    .trim()
    .split(" ")
    .map(singularize)
    .join(" ");
}

export function titleCase(value: string): string {
  const small = new Set(["and", "or", "for", "of", "the", "a", "an", "in", "on", "with", "to", "&"]);
  return value
    .split(/\s+/)
    .map((word, index) => {
      if (index > 0 && small.has(word.toLowerCase())) return word.toLowerCase();
      if (word.length <= 3 && word === word.toUpperCase()) return word; // keep acronyms
      return word.charAt(0).toUpperCase() + word.slice(1);
    })
    .join(" ");
}

function looksLikeOffering(name: string): boolean {
  const lower = name.toLowerCase().trim();
  if (lower.length < 3 || lower.length > 60) return false;
  if (GENERIC_TERMS.has(lower)) return false;
  if (NOISE_PATTERN.test(lower)) return false;
  if (lower.split(/\s+/).length > 6) return false;
  if (MERCHANDISING_PATTERN.test(lower)) return false;
  if (looksLikeSlogan(name)) return false;
  // Sentences and questions are copy, not offerings.
  if (/[.!?]$/.test(name.trim()) && name.split(/\s+/).length > 3) return false;
  return true;
}

/** How the evidence's source type maps to an offering type. */
function inferOfferingType(item: EvidenceItem, name: string): OfferingType {
  const text = item.text.toLowerCase();
  if (/^(product|productmodel|individualproduct|productgroup|vehicle|car|menuitem)/i.test(item.text)) return "product";
  if (/^(service|medicalprocedure|medicaltherapy|course|financialproduct|loanorcredit|bankaccount)/i.test(item.text)) return "service";
  if (text.includes("breadcrumb") || item.sourceType === "breadcrumb") return "category";
  if (item.pageType === "solution" || item.pageType === "industry") return "solution";
  if (item.pageType === "service" || item.pageType === "service_index") return "service";
  if (item.pageType === "category" || item.pageType === "product_index") return "category";
  if (/\b(service|consulting|support|maintenance|repair|installation|training|care|treatment|advisory)\b/.test(name.toLowerCase())) return "service";
  return "product";
}

const PREFIX_STRIP =
  /^(shop|browse|explore|discover|view|see|our|all|new|the)\s+/i;

function stripLeadingVerb(value: string): string {
  let out = value.trim();
  for (let i = 0; i < 2; i++) out = out.replace(PREFIX_STRIP, "").trim();
  return out;
}

export interface CollectOptions {
  archetype?: BusinessArchetype;
  maxCandidates?: number;
}

/** Pass 1: harvest raw candidates from offering-hinted evidence. */
export function collectOfferingCandidates(evidence: EvidenceItem[], options: CollectOptions = {}): OfferingCandidate[] {
  const byNormalized = new Map<string, OfferingCandidate>();

  const add = (rawName: string, item: EvidenceItem, weight: number, isInstance = false) => {
    const name = stripLeadingVerb(rawName);
    if (!looksLikeOffering(name)) return;
    const normalized = normalizeOfferingName(name);
    if (!normalized || GENERIC_TERMS.has(normalized)) return;

    const existing = byNormalized.get(normalized);
    const contribution = weight * evidenceStrength(item);
    if (existing) {
      // One category-level sighting is enough to stop a name being treated
      // as a bare SKU.
      existing.isInstance = existing.isInstance && isInstance;
      existing.support += contribution;
      existing.pageIds.add(item.crawlPageId ?? item.url);
      if (existing.evidenceIds.length < 8 && !existing.evidenceIds.includes(item.id)) existing.evidenceIds.push(item.id);
      existing.sourceKinds.add(item.sourceType);
      // Prefer the cleaner surface form of the same concept.
      if (name.length < existing.name.length) existing.name = name;
      return;
    }
    byNormalized.set(normalized, {
      name,
      normalized,
      type: inferOfferingType(item, name),
      support: contribution,
      pageIds: new Set([item.crawlPageId ?? item.url]),
      evidenceIds: [item.id],
      sourceKinds: new Set([item.sourceType]),
      isInstance,
    });
  };

  for (const item of evidence) {
    if (item.fieldHint !== "offering") continue;
    // A customer-proof page lists the businesses that BUY from this one.
    // Its headings are logos and case-study titles, so "Northwind Logistics"
    // and "Carrefour Systems" were being reported as things Atlas RevOps
    // sells. Nothing on such a page names a line of business.
    if (item.pageType === "case_study") continue;

    // Structured data is the strongest offering signal available.
    if (item.sourceType === "jsonld" || item.sourceType === "microdata" || item.sourceType === "rdfa") {
      const value = item.text.includes(":") ? item.text.slice(item.text.indexOf(":") + 1).trim() : item.text;
      const isCategoryProperty = /\bcategory:/i.test(item.text);
      // `Product: Velocity 3 Men's Road Shoe` names one item; `Product
      // category: Running Shoes` names the line of business.
      const isItemName = !isCategoryProperty && /^(Product|ProductModel|IndividualProduct|Vehicle|Car|MenuItem)\b/i.test(item.text);
      add(value, item, isCategoryProperty ? 3.2 : 2.4, isItemName);
      continue;
    }
    if (item.sourceType === "breadcrumb") {
      const trail = item.text.replace(/^Breadcrumb:\s*/, "").split(">").map((s) => s.trim());
      // The middle of a breadcrumb is the category; the leaf is the item and
      // the root is "Home".
      for (const segment of trail.slice(1, -1)) add(segment, item, 3.0);
      continue;
    }
    if (item.sourceType === "navigation") {
      const label = item.text.replace(/^(Primary nav|Footer nav):\s*/, "");
      add(label, item, item.text.startsWith("Primary nav") ? 2.8 : 1.0);
      continue;
    }
    if (item.sourceType === "heading") {
      const value = item.text.replace(/^H\d:\s*/, "");
      const level = Number(item.text.match(/^H(\d):/)?.[1] ?? 2);
      const isIndex = item.pageType === "product_index" || item.pageType === "service_index" || item.pageType === "category";
      // On a listing page, H1/H2 are section headings ("Running Shoes") while
      // H3+ are the item cards inside them ("Velocity 3 Men's Road Shoe").
      // On an item page, the H1 is the item's own name.
      const isItemHeading =
        (isIndex && level >= 3) || (level === 1 && (item.pageType === "product" || item.pageType === "service"));
      add(value, item, isIndex ? 2.2 : 1.4, isItemHeading);
      continue;
    }
    if (item.sourceType === "list_item" || item.sourceType === "table") {
      const value = item.text.replace(/^(Listing item|List item|Table cell):\s*/, "");
      // Cards on a listing page are the individual items being listed.
      add(value, item, 1.1, item.text.startsWith("Listing item:"));
      continue;
    }
  }

  const candidates = markModelSeries([...byNormalized.values()]);
  candidates.sort((a, b) => b.support - a.support);
  return candidates.slice(0, options.maxCandidates ?? 220);
}

/**
 * Detects generated model series. When several candidates collapse to the same
 * shape once their numeric tokens are masked — "velocity # men s road shoe"
 * covering Velocity 1 through Velocity 40 — they are SKUs from one template,
 * not distinct lines of business. This generalizes across sites far better
 * than any list of model-name patterns could.
 */
export function markModelSeries(candidates: OfferingCandidate[]): OfferingCandidate[] {
  const byShape = new Map<string, OfferingCandidate[]>();
  for (const candidate of candidates) {
    const shape = candidate.normalized.replace(/\b\d+\b/g, "#").replace(/\s+/g, " ").trim();
    if (!/#/.test(shape)) continue;
    const siblings = byShape.get(shape) ?? [];
    siblings.push(candidate);
    byShape.set(shape, siblings);
  }
  for (const siblings of byShape.values()) {
    if (siblings.length < MIN_SIBLINGS_FOR_MODEL_SERIES) continue;
    for (const sibling of siblings) sibling.isInstance = true;
  }
  return candidates;
}

/**
 * Pass 2: consolidate. "Running Shoes", "Men's Running Shoes" and "Running
 * Shoe" are one concept; "Pegasus 41" folds into whichever category page it
 * appeared under, or is dropped if it is clearly a model name.
 */
export function consolidateOfferings(candidates: OfferingCandidate[]): OfferingCandidate[] {
  const kept: OfferingCandidate[] = [];

  const tokensOf = (value: string) => new Set(value.split(/\s+/).filter((t) => t.length > 2));

  for (const candidate of [...candidates].sort((a, b) => b.support - a.support)) {
    // A name that is clearly a model/SKU only survives if nothing else does.
    if (SKU_PATTERN.test(candidate.name) && candidate.pageIds.size < 2) continue;

    const candidateTokens = tokensOf(candidate.normalized);
    const parent = kept.find((k) => {
      const keptTokens = tokensOf(k.normalized);
      if (k.normalized === candidate.normalized) return true;
      // Subsumption: "men s running shoe" contains all of "running shoe".
      const smaller = keptTokens.size <= candidateTokens.size ? keptTokens : candidateTokens;
      const larger = keptTokens.size <= candidateTokens.size ? candidateTokens : keptTokens;
      if (smaller.size === 0) return false;
      let overlap = 0;
      for (const token of smaller) if (larger.has(token)) overlap++;
      return overlap === smaller.size;
    });

    if (parent) {
      parent.isInstance = parent.isInstance && candidate.isInstance;
      parent.support += candidate.support * 0.4;
      for (const pageId of candidate.pageIds) parent.pageIds.add(pageId);
      for (const id of candidate.evidenceIds) if (parent.evidenceIds.length < 8 && !parent.evidenceIds.includes(id)) parent.evidenceIds.push(id);
      for (const kind of candidate.sourceKinds) parent.sourceKinds.add(kind);
      // Prefer the shorter, more category-like surface form.
      if (candidate.normalized.split(/\s+/).length < parent.normalized.split(/\s+/).length) {
        parent.name = candidate.name;
        parent.normalized = candidate.normalized;
      }
      continue;
    }
    kept.push({ ...candidate, pageIds: new Set(candidate.pageIds), evidenceIds: [...candidate.evidenceIds], sourceKinds: new Set(candidate.sourceKinds) });
  }

  return kept;
}

export interface ResolveOfferingsResult {
  offerings: Offering[];
  candidates: OfferingCandidate[];
}

const TARGET_MIN = 5;
const TARGET_MAX = 12;
const MIN_CATEGORIES_BEFORE_DROPPING_INSTANCES = 3;
const MIN_SIBLINGS_FOR_MODEL_SERIES = 3;

export function resolveOfferings(evidence: EvidenceItem[], options: CollectOptions = {}): ResolveOfferingsResult {
  const raw = collectOfferingCandidates(evidence, options);
  const consolidated = consolidateOfferings(raw);
  const byId = new Map(evidence.map((e) => [e.id, e]));

  // Categories first. Individual items are held back entirely whenever the
  // site gave us enough real categories — showing a buyer "Velocity 3 Men's
  // Road Shoe" instead of "Running Shoes" is the specific failure this whole
  // resolver exists to prevent.
  const categories = consolidated.filter((c) => !c.isInstance);
  const pool = categories.length >= MIN_CATEGORIES_BEFORE_DROPPING_INSTANCES ? categories : consolidated;

  // Rank on cross-page support: an offering named on four pages is a real line
  // of business, one that appears once is probably a heading.
  const ranked = pool
    .map((candidate) => ({
      candidate,
      // Support says how LOUD a label is; the commercial-head test says whether
      // it names something a customer buys. Multiplying keeps the prior
      // scale-free — a category still has to be well-evidenced to win, it just
      // no longer loses to a campaign banner that appears on more pages.
      rank:
        (candidate.support * (1 + Math.min(1, (candidate.pageIds.size - 1) * 0.35)) +
          (candidate.sourceKinds.has("jsonld") ? 2 : 0) -
          (candidate.isInstance ? 1.5 : 0)) *
        (COMMERCIAL_HEAD.test(candidate.name) ? 1.7 : 1),
    }))
    .sort((a, b) => b.rank - a.rank);

  // Keep the strong ones; only reach past TARGET_MIN when support holds up.
  const cutoff = ranked.length > 0 ? Math.max(0.6, ranked[0]!.rank * 0.12) : 0;
  const selected = ranked
    .filter((entry, index) => index < TARGET_MIN || entry.rank >= cutoff)
    .slice(0, TARGET_MAX);

  const offerings: Offering[] = selected.map(({ candidate }) => {
    const items = candidate.evidenceIds.map((id) => byId.get(id)).filter((i): i is EvidenceItem => Boolean(i));
    return {
      name: titleCase(candidate.name).slice(0, 80),
      type: candidate.type,
      confidence: computeConfidence({ items, ceiling: candidate.pageIds.size >= 2 ? 95 : 72 }),
      evidenceIds: candidate.evidenceIds.slice(0, 6),
      pageCount: candidate.pageIds.size,
    };
  });

  return { offerings, candidates: consolidated };
}
