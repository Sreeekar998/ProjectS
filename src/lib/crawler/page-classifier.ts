// Page-type classification.
//
// Classification runs twice per page: once cheaply on URL + anchor text
// (`classifyFromUrl`) so the planner can rank a frontier it has not fetched,
// and once with the fetched document's own signals (`classifyPage`) so
// evidence extraction can pick the right strategy.
//
// The taxonomy is deliberately finer than "products/other": an offering
// *index* and an individual offering warrant different extraction, and a
// store locator is a market signal while a contact page mostly is not.

export type PageType =
  | "home"
  | "about"
  | "product_index"
  | "product"
  | "service_index"
  | "service"
  | "category"
  | "solution"
  | "industry"
  | "pricing"
  | "location"
  | "store_locator"
  | "contact"
  | "case_study"
  | "faq"
  | "editorial"
  | "careers"
  | "legal"
  | "booking"
  | "menu"
  | "team"
  | "reviews"
  | "gallery"
  | "other";

/**
 * Information value of a page type for *business understanding*, 0-1.
 * These are starting weights, not universal truth — they are the single knob
 * the planner exposes for tuning and the benchmark measures.
 */
export const PAGE_TYPE_VALUE: Record<PageType, number> = {
  home: 1.0,
  product_index: 0.95,
  service_index: 0.95,
  about: 0.88,
  category: 0.82,
  solution: 0.8,
  industry: 0.78,
  store_locator: 0.76,
  pricing: 0.74,
  location: 0.66,
  product: 0.58,
  service: 0.62,
  contact: 0.5,
  case_study: 0.44,
  faq: 0.4,
  editorial: 0.16,
  careers: 0.06,
  legal: 0.0,
  // A menu or price list is the offering index of a restaurant, salon or
  // clinic; booking pages name services and hours; team pages name
  // specialities; reviews and galleries are weak but confirm the business kind.
  menu: 0.92,
  booking: 0.7,
  team: 0.5,
  reviews: 0.42,
  gallery: 0.2,
  other: 0.3,
};

interface UrlRule {
  type: PageType;
  // Matched against a normalized "/ a b c" form of the path plus anchor text.
  patterns: RegExp[];
  /** When set, the rule only applies at this path depth (segment count). */
  depth?: (segments: number) => boolean;
}

const INDEX_DEPTH = (n: number) => n <= 1;
const ITEM_DEPTH = (n: number) => n >= 2;

const URL_RULES: UrlRule[] = [
  { type: "legal", patterns: [/\b(privacy|terms|conditions|legal|cookie|cookies|gdpr|disclaimer|imprint|impressum|accessibility|compliance|sitemap)\b/] },
  { type: "careers", patterns: [/\b(careers?|jobs?|vacancies|hiring|work-with-us|join-us|life-at)\b/] },
  // Local-business page shapes the retail/SaaS-era rules had no name for. A
  // salon's /book-now, /menu and /our-team pages classified as `other` and
  // were starved by the `other` slot cap, while blog slugs won the budget.
  { type: "booking", patterns: [/\b(book|booking|bookings|book-now|book-online|book-appointment|appointments?|reserve|reservations?|schedule-appointment|schedule)\b/] },
  { type: "menu", patterns: [/\b(menus?|our-menu|food-menu|drinks?-menu|brunch-menu|breakfast-menu|lunch-menu|dinner-menu|price-?list|treatment-menu|service-menu|prices)\b/] },
  { type: "team", patterns: [/\b(team|our-team|meet-the-team|meet-our-team|staff|stylists?|artists?|therapists?|doctors?|our-doctors|dentists?|practitioners?|trainers?|instructors?|chefs?|leadership|management-team|our-people|founders?)\b/] },
  { type: "reviews", patterns: [/\b(reviews?|testimonials?|ratings?|what-clients-say|client-stories|guest-reviews)\b/] },
  { type: "gallery", patterns: [/\b(gallery|galleries|photos?|lookbook|before-and-after|before-after|our-space)\b/] },
  { type: "faq", patterns: [/\b(faq|faqs|help|support|knowledge-?base|questions)\b/] },
  { type: "contact", patterns: [/\b(contact|contact-us|get-in-touch|enquiry|enquiries|reach-us)\b/] },
  { type: "store_locator", patterns: [/\b(store-?locator|find-a-(store|dealer|branch|clinic|location)|locations?-near|dealer-?locator|branch-?locator|where-to-buy|our-(stores|locations|branches|showrooms|clinics|centres|centers))\b/] },
  { type: "location", patterns: [/\b(locations?|stores?|branches?|showrooms?|dealers?|clinics?|centres?|centers?|outlets?|restaurants?|hotels?|campus(es)?)\b/], depth: ITEM_DEPTH },
  { type: "store_locator", patterns: [/\b(locations?|stores?|branches?|showrooms?|dealers?|clinics?|centres?|centers?|outlets?)\b/], depth: INDEX_DEPTH },
  { type: "pricing", patterns: [/\b(pricing|price|plans?|packages?|tariffs?|rates?|fees?|subscriptions?|membership)\b/] },
  { type: "case_study", patterns: [/\b(case-stud(y|ies)|customers?|customer-stor(y|ies)|success-stor(y|ies)|our-work|portfolio|clients?|references?)\b/] },
  { type: "industry", patterns: [/\b(industries|industry|sectors?|verticals?|who-we-serve|for-(healthcare|retail|finance|education|manufacturing|government))\b/] },
  { type: "solution", patterns: [/\b(solutions?|use-?cases?|capabilities|platform|features?|how-it-works|why-us|why-)\b/] },
  { type: "about", patterns: [/\b(about|about-us|company|our-story|who-we-are|our-(mission|values|purpose|team|people|history)|overview|corporate|profile|brand)\b/] },
  { type: "product", patterns: [/\b(products?|shop|store|catalog(ue)?|collections?|models?|vehicles?|cars?|menu|items?|goods|merch|buy|p)\b/], depth: (n) => n >= 3 },
  { type: "category", patterns: [/\b(products?|shop|store|catalog(ue)?|collections?|categor(y|ies)|department|range|models?|menu|vehicles?)\b/], depth: (n) => n === 2 },
  { type: "product_index", patterns: [/\b(products?|shop|store|catalog(ue)?|collections?|categor(y|ies)|range|models?|menu|inventory|new-arrivals|all-products)\b/], depth: INDEX_DEPTH },
  { type: "service", patterns: [/\b(services?|treatments?|specialit(y|ies)|specialt(y|ies)|departments?|programs?|programmes?|courses?|procedures?|offerings?|expertise|practice-areas?)\b/], depth: ITEM_DEPTH },
  { type: "service_index", patterns: [/\b(services?|treatments?|specialit(y|ies)|specialt(y|ies)|departments?|programs?|programmes?|courses?|procedures?|offerings?|expertise|practice-areas?|what-we-do)\b/], depth: INDEX_DEPTH },
  { type: "editorial", patterns: [/\b(blog|news|articles?|insights?|resources?|press|press-releases?|media|events?|webinars?|podcasts?|stories|magazine|journal|updates?)\b/] },
];

/** Schema.org @type values that pin a page type regardless of its URL. */
const SCHEMA_TYPE_HINTS: Array<{ type: PageType; test: RegExp }> = [
  { type: "faq", test: /^(FAQPage|QAPage)$/i },
  { type: "product", test: /^(Product|ProductModel|Vehicle|Car|IndividualProduct|MenuItem)$/i },
  { type: "service", test: /^(Service|MedicalProcedure|MedicalTherapy|Course|FinancialProduct|LoanOrCredit|BankAccount|InsuranceAgency)$/i },
  { type: "location", test: /^(Store|Restaurant|Hotel|LocalBusiness|AutoDealer|MedicalClinic|Hospital|Pharmacy|Dentist|HealthClub|BankOrCreditUnion)$/i },
  { type: "editorial", test: /^(Article|BlogPosting|NewsArticle|Blog|LiveBlogPosting|Report)$/i },
  { type: "about", test: /^AboutPage$/i },
  { type: "contact", test: /^ContactPage$/i },
  { type: "case_study", test: /^(Review|CaseStudy)$/i },
  { type: "category", test: /^(CollectionPage|OfferCatalog|ItemList)$/i },
];

function normalizeHaystack(pathname: string, extra?: string): string {
  const combined = `${pathname} ${extra ?? ""}`.toLowerCase();
  // Keep hyphens (rules use them) but turn separators into spaces so `\b`
  // anchors work on `/about-us/team` as well as `/aboutUs`.
  return ` ${combined.replace(/[_/.]+/g, " ").replace(/\s+/g, " ").trim()} `;
}

function pathDepth(pathname: string): number {
  return pathname.split("/").filter(Boolean).length;
}

export interface UrlClassificationInput {
  url: string;
  anchorText?: string;
  breadcrumbTrail?: string[];
}

/** Cheap pre-fetch classification from URL shape + anchor text alone. */
export function classifyFromUrl(input: UrlClassificationInput): PageType {
  let pathname: string;
  try {
    pathname = new URL(input.url).pathname;
  } catch {
    pathname = input.url;
  }
  const depth = pathDepth(pathname);
  if (depth === 0) return "home";

  const haystack = normalizeHaystack(pathname, [input.anchorText, ...(input.breadcrumbTrail ?? [])].filter(Boolean).join(" "));
  const pathOnly = normalizeHaystack(pathname);

  for (const rule of URL_RULES) {
    if (rule.depth && !rule.depth(depth)) continue;
    // The path is authoritative; anchor text only breaks ties for rules that
    // did not match the path, so a "Careers" link inside a product card
    // cannot mislabel the product page.
    if (rule.patterns.some((p) => p.test(pathOnly))) return rule.type;
  }
  for (const rule of URL_RULES) {
    if (rule.depth && !rule.depth(depth)) continue;
    if (rule.patterns.some((p) => p.test(haystack))) return rule.type;
  }
  return "other";
}

export interface PageClassificationInput extends UrlClassificationInput {
  title?: string | null;
  h1?: string | null;
  schemaTypes?: string[];
  /** Count of product/offer-like cards found in the document. */
  itemCardCount?: number;
  hasArticleBody?: boolean;
  publishedDate?: string | null;
}

export interface PageClassification {
  pageType: PageType;
  signals: string[];
}

/** Full classification once the document itself is available. */
export function classifyPage(input: PageClassificationInput): PageClassification {
  const signals: string[] = [];
  let pathname = "/";
  try {
    pathname = new URL(input.url).pathname;
  } catch {
    /* keep default */
  }
  if (pathDepth(pathname) === 0) return { pageType: "home", signals: ["path:root"] };

  const urlType = classifyFromUrl(input);
  if (urlType !== "other") signals.push(`url:${urlType}`);

  for (const schemaType of input.schemaTypes ?? []) {
    const hint = SCHEMA_TYPE_HINTS.find((h) => h.test.test(schemaType));
    if (!hint) continue;
    // Site-wide LocalBusiness JSON-LD (Yoast, RankMath, Wix) repeats on every
    // page; it may only claim the page type when the URL says nothing.
    if (hint.type === "location" && urlType !== "other") continue;
    signals.push(`schema:${schemaType}`);
    // A single Product node on a page listing many items is a listing page,
    // not an item page — the card count breaks that tie.
    if (hint.type === "product" && (input.itemCardCount ?? 0) >= 6) {
      return { pageType: urlType === "product_index" ? "product_index" : "category", signals: [...signals, "cards:many"] };
    }
    if (hint.type === "editorial" && input.hasArticleBody === false && urlType !== "other") {
      continue;
    }
    return { pageType: hint.type, signals };
  }

  const heading = `${input.title ?? ""} ${input.h1 ?? ""}`.toLowerCase();
  if (urlType === "other") {
    if (/\b(about us|our story|who we are|our mission|company profile)\b/.test(heading)) return { pageType: "about", signals: [...signals, "heading:about"] };
    if (/\b(frequently asked|faq)\b/.test(heading)) return { pageType: "faq", signals: [...signals, "heading:faq"] };
    if (/\b(contact|get in touch)\b/.test(heading)) return { pageType: "contact", signals: [...signals, "heading:contact"] };
    if (/\b(pricing|plans|packages|price list)\b/.test(heading)) return { pageType: "pricing", signals: [...signals, "heading:pricing"] };
    if (/\b(menu|treatments?|services?|what we (do|offer)|our (services|treatments|work))\b/.test(heading)) return { pageType: "service_index", signals: [...signals, "heading:services"] };
    if (/\b(our team|meet the team|stylists|our doctors|our people)\b/.test(heading)) return { pageType: "team", signals: [...signals, "heading:team"] };
    if (/\b(reviews|testimonials)\b/.test(heading)) return { pageType: "reviews", signals: [...signals, "heading:reviews"] };
    if (/\b(book (now|online|an? appointment)|reservations?)\b/.test(heading)) return { pageType: "booking", signals: [...signals, "heading:booking"] };
    if (/\b(gallery|our space|photos)\b/.test(heading)) return { pageType: "gallery", signals: [...signals, "heading:gallery"] };
    if (input.publishedDate || input.hasArticleBody) return { pageType: "editorial", signals: [...signals, "article:body"] };
    if ((input.itemCardCount ?? 0) >= 8) return { pageType: "category", signals: [...signals, "cards:many"] };
  }

  return { pageType: urlType, signals };
}

/** Page types that should each be represented in a healthy crawl. */
export const DIVERSITY_SLOTS: Array<{ key: string; types: PageType[]; min: number; max: number }> = [
  { key: "home", types: ["home"], min: 1, max: 1 },
  { key: "about", types: ["about"], min: 1, max: 3 },
  { key: "offering_index", types: ["product_index", "service_index", "menu"], min: 1, max: 5 },
  { key: "category", types: ["category"], min: 0, max: 7 },
  { key: "offering_item", types: ["product", "service"], min: 0, max: 8 },
  { key: "positioning", types: ["solution", "industry"], min: 0, max: 5 },
  { key: "market", types: ["store_locator", "location"], min: 0, max: 4 },
  { key: "pricing", types: ["pricing"], min: 0, max: 2 },
  { key: "contact", types: ["contact", "booking"], min: 0, max: 2 },
  { key: "proof", types: ["case_study", "faq", "reviews", "team", "gallery"], min: 0, max: 3 },
  { key: "editorial", types: ["editorial"], min: 0, max: 1 },
  // Unknown slugs on a small site are usually the real service pages
  // (/hair, /nails); the cap only matters once a site is large.
  { key: "other", types: ["other", "careers", "legal"], min: 0, max: 4 },
];

export function slotKeyFor(pageType: PageType): string {
  return DIVERSITY_SLOTS.find((slot) => slot.types.includes(pageType))?.key ?? "other";
}
