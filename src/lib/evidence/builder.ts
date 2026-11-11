// Turns one fetched page into typed EvidenceItems.
//
// Extraction strategy varies by page type on purpose. Running a Readability-
// style "main article" extractor over a category page throws away the card
// grid and navigation, which is where an ecommerce site actually states what
// it sells. Conversely, dumping every DOM node from an About page buries the
// two sentences that describe the business.

import type { ExtractedPage } from "@/lib/crawler/extractor";
import { classifyFromUrl, type PageType } from "@/lib/crawler/page-classifier";
import {
  OFFERING_TYPES,
  allStrings,
  firstString,
  hasAnyType,
  isLocalBusinessLike,
  isOrganizationLike,
  readAddresses,
  readGeo,
  readOpeningHours,
  type SchemaEntity,
} from "@/lib/crawler/structured-data";
import type { EvidenceFieldHint, EvidenceSourceType, NewEvidenceItem } from "./types";

interface BuildContext {
  runId: string;
  projectId: string;
  crawlPageId: string;
  url: string;
  canonicalUrl: string | null;
  pageType: PageType;
}

// Raised from 90: geography and contact evidence used to be emitted last and
// was cut on busy home pages. It is now emitted second (after structured
// data), and the cap leaves room for it.
const MAX_ITEMS_PER_PAGE = 110;
const MAX_TEXT = 600;

/** Page types where long-form prose is the point. */
const PROSE_PAGE_TYPES = new Set<PageType>(["about", "home", "solution", "industry", "service", "case_study", "editorial"]);
/** Page types where structure (cards, nav, breadcrumbs) beats prose. */
const LISTING_PAGE_TYPES = new Set<PageType>(["product_index", "service_index", "category", "store_locator", "pricing"]);

export function buildEvidenceForPage(ctx: BuildContext, page: ExtractedPage): NewEvidenceItem[] {
  const items: NewEvidenceItem[] = [];
  const seen = new Set<string>();

  const add = (
    sourceType: EvidenceSourceType,
    text: string,
    fieldHint?: EvidenceFieldHint,
    data?: Record<string, unknown>,
  ) => {
    if (items.length >= MAX_ITEMS_PER_PAGE) return;
    const trimmed = text.replace(/\s+/g, " ").trim().slice(0, MAX_TEXT);
    if (trimmed.length < 2) return;
    const key = `${sourceType}|${fieldHint ?? ""}|${trimmed.toLowerCase()}`;
    if (seen.has(key)) return;
    seen.add(key);
    items.push({
      runId: ctx.runId,
      projectId: ctx.projectId,
      crawlPageId: ctx.crawlPageId,
      url: ctx.url,
      canonicalUrl: ctx.canonicalUrl,
      pageType: ctx.pageType,
      sourceType,
      text: trimmed,
      fieldHint: fieldHint ?? null,
      data: data ?? null,
    });
  };

  addStructuredDataEvidence(add, page.schemaEntities);
  addGeographyEvidence(add, page);
  addMetaEvidence(add, page);
  addHeadingEvidence(add, page, ctx.pageType);
  addNavigationEvidence(add, page, ctx.pageType);
  addContentEvidence(add, page, ctx.pageType);

  return items;
}

type AddFn = (sourceType: EvidenceSourceType, text: string, fieldHint?: EvidenceFieldHint, data?: Record<string, unknown>) => void;

function addStructuredDataEvidence(add: AddFn, entities: SchemaEntity[]): void {
  for (const entity of entities.slice(0, 60)) {
    const sourceType: EvidenceSourceType = entity.origin;
    const typeLabel = entity.types.join("/");

    // Any Organization or LocalBusiness subtype counts. The old 55-entry leaf
    // allowlist silently dropped a `HairSalon` entity, and with it the brand
    // name, address, phone and geo of the very business being analysed.
    if (isOrganizationLike(entity)) {
      const localBusiness = isLocalBusinessLike(entity);
      const name = firstString(entity.props.name);
      if (name) add(sourceType, `${typeLabel} name: ${name}`, "brand_name", { schemaType: typeLabel, name, localBusiness });
      for (const alias of allStrings(entity.props.alternateName, 6)) {
        add(sourceType, `${typeLabel} alternateName: ${alias}`, "brand_alias", { alias });
      }
      const legalName = firstString(entity.props.legalName);
      if (legalName && legalName !== name) add(sourceType, `${typeLabel} legalName: ${legalName}`, "brand_alias", { legalName });
      const description = firstString(entity.props.description);
      if (description) add(sourceType, `${typeLabel} description: ${description}`, "description", { schemaType: typeLabel });
      add(sourceType, `Declared schema type: ${typeLabel}`, "industry", { schemaTypes: entity.types, localBusiness });

      for (const address of readAddresses(entity.props.address ?? entity.props.location).slice(0, 12)) {
        const text = address.formatted ?? [address.street, address.locality, address.region, address.postalCode, address.country].filter(Boolean).join(", ");
        if (text) add("address", `${typeLabel} address: ${text}`, "market", { ...address, schemaType: typeLabel, structured: true });
      }
      const geo = readGeo(entity.props);
      if (geo) add(sourceType, `${typeLabel} geo: ${geo.lat}, ${geo.lng}`, "market", { lat: geo.lat, lng: geo.lng, schemaType: typeLabel });
      const hasMap = firstString(entity.props.hasMap);
      if (hasMap && /^https?:/i.test(hasMap)) add("url_signal", `${typeLabel} hasMap: ${hasMap}`, "market", { mapUrl: hasMap });
      for (const area of allStrings(entity.props.areaServed, 12)) {
        add(sourceType, `${typeLabel} areaServed: ${area}`, "market", { areaServed: area });
      }
      const telephone = firstString(entity.props.telephone);
      if (telephone) add("phone", `${typeLabel} telephone: ${telephone}`, "market", { telephone });
      const email = firstString(entity.props.email);
      if (email && /.+@.+\..+/.test(email)) add(sourceType, `${typeLabel} email: ${email}`, "contact", { email });
      const hours = readOpeningHours(entity.props.openingHoursSpecification ?? entity.props.openingHours);
      if (hours.length > 0) add(sourceType, `${typeLabel} openingHours: ${hours.join("; ")}`, "archetype", { openingHours: hours });
      const priceRange = firstString(entity.props.priceRange);
      if (priceRange) add(sourceType, `${typeLabel} priceRange: ${priceRange}`, "identity", { priceRange });
      const currencies = firstString(entity.props.currenciesAccepted);
      if (currencies) add("currency", `${typeLabel} currenciesAccepted: ${currencies}`, "market", { currency: currencies });
      for (const cuisine of allStrings(entity.props.servesCuisine, 6)) {
        add(sourceType, `${typeLabel} servesCuisine: ${cuisine}`, "offering", { cuisine });
      }
      for (const profile of allStrings(entity.props.sameAs, 10)) {
        if (/^https?:/i.test(profile)) add("url_signal", `${typeLabel} sameAs: ${profile}`, "contact", { sameAs: profile });
      }
      for (const offer of allStrings(entity.props.makesOffer, 12)) {
        add(sourceType, `${typeLabel} makesOffer: ${offer}`, "offering", { name: offer });
      }
      for (const audience of allStrings(entity.props.audience ?? entity.props.serviceAudience, 6)) {
        add(sourceType, `${typeLabel} audience: ${audience}`, "audience", { audience });
      }
      for (const knows of allStrings(entity.props.knowsAbout ?? entity.props.slogan, 6)) {
        add(sourceType, `${typeLabel} positioning: ${knows}`, "identity", {});
      }
      const parent = firstString(entity.props.parentOrganization);
      if (parent) add(sourceType, `${typeLabel} parentOrganization: ${parent}`, "brand_alias", { parent });
      const catalogue = entity.props.hasOfferCatalog;
      for (const offering of allStrings(catalogue, 12)) {
        add(sourceType, `Offer catalog entry: ${offering}`, "offering", { name: offering });
      }
    }

    if (hasAnyType(entity, OFFERING_TYPES)) {
      const name = firstString(entity.props.name);
      if (name) add(sourceType, `${typeLabel}: ${name}`, "offering", { schemaType: typeLabel, name });
      for (const category of allStrings(entity.props.category ?? entity.props.serviceType ?? entity.props.additionalType, 8)) {
        add(sourceType, `${typeLabel} category: ${category}`, "offering", { category, schemaType: typeLabel });
      }
      const brand = firstString(entity.props.brand);
      if (brand) add(sourceType, `${typeLabel} brand: ${brand}`, "brand_alias", { brand });
      const offers = entity.props.offers;
      if (offers && typeof offers === "object") {
        const currency = firstString((offers as Record<string, unknown>).priceCurrency);
        if (currency) add("currency", `Offer priceCurrency: ${currency}`, "market", { currency });
      }
      for (const area of allStrings(entity.props.areaServed, 8)) {
        add(sourceType, `${typeLabel} areaServed: ${area}`, "market", { areaServed: area });
      }
    }

    if (entity.types.includes("WebSite")) {
      const name = firstString(entity.props.name);
      if (name) add(sourceType, `WebSite name: ${name}`, "brand_name", { name });
    }
    if (entity.types.includes("BreadcrumbList")) {
      const trail = allStrings(entity.props.itemListElement, 10);
      if (trail.length >= 2) add("breadcrumb", `Breadcrumb: ${trail.join(" > ")}`, "offering", { trail });
    }
    if (entity.types.includes("FAQPage")) {
      for (const question of allStrings(entity.props.mainEntity, 8)) {
        add(sourceType, `FAQ: ${question}`, "audience", { question });
      }
    }
  }
}

function addMetaEvidence(add: AddFn, page: ExtractedPage): void {
  if (page.ogSiteName) add("meta", `og:site_name: ${page.ogSiteName}`, "brand_name");
  if (page.title) add("meta", `Page title: ${page.title}`, "brand_name");
  if (page.metaDescription) add("meta", `Meta description: ${page.metaDescription}`, "description");
  if (page.ogDescription && page.ogDescription !== page.metaDescription) {
    add("meta", `og:description: ${page.ogDescription}`, "description");
  }
  if (page.ogTitle && page.ogTitle !== page.title) add("meta", `og:title: ${page.ogTitle}`, "brand_name");
  if (page.ogLocale) add("hreflang", `og:locale: ${page.ogLocale}`, "language", { locale: page.ogLocale });
  if (page.htmlLang) add("hreflang", `html lang: ${page.htmlLang}`, "language", { lang: page.htmlLang });
  for (const alt of page.hreflang.slice(0, 40)) {
    add("hreflang", `hreflang ${alt.lang} -> ${alt.href}`, "market", { lang: alt.lang, href: alt.href });
  }
  const logo = page.images.find((i) => i.isLogo && i.alt.length > 1);
  if (logo) add("image_alt", `Logo alt text: ${logo.alt}`, "brand_name", { src: logo.src });
}

const AUDIENCE_HEADING = /^(for|built for|designed for|made for|ideal for|who (we serve|it'?s for))\b/i;

/** Page types whose headings describe the business, not its offerings. */
const NON_OFFERING_PAGE_TYPES = new Set<PageType>(["about", "contact", "careers", "legal", "editorial", "case_study", "store_locator", "location"]);

function addHeadingEvidence(add: AddFn, page: ExtractedPage, pageType: PageType): void {
  const headingHint: EvidenceFieldHint = NON_OFFERING_PAGE_TYPES.has(pageType)
    ? "identity"
    : pageType === "home"
      ? "description"
      : "offering";
  if (page.h1) add("heading", `H1: ${page.h1}`, headingHint);
  const limit = LISTING_PAGE_TYPES.has(pageType) ? 24 : 14;
  for (const node of page.headingNodes.filter((h) => h.level > 1).slice(0, limit)) {
    // "For enterprises" / "For revenue teams" names who the section is aimed
    // at, not what is being sold — a distinction a solutions page depends on.
    if (AUDIENCE_HEADING.test(node.text)) {
      add("heading", `H${node.level}: ${node.text}`, "audience");
      continue;
    }
    const hint: EvidenceFieldHint = NON_OFFERING_PAGE_TYPES.has(pageType) ? "identity" : "offering";
    add("heading", `H${node.level}: ${node.text}`, hint);
  }
  if (page.breadcrumb.length >= 2) {
    add("breadcrumb", `Breadcrumb: ${page.breadcrumb.join(" > ")}`, "offering", { trail: page.breadcrumb });
  }
}

/** Navigation labels that are account/utility affordances, not offerings. */
const UTILITY_NAV_LABEL =
  /^(log ?in|sign ?in|sign ?up|register|my ?account|account|profile|dashboard|portal|.*\bportal\b|cart|bag|basket|checkout|wishlist|search|help|support|contact|contact us|careers?|jobs?|press|investors?|newsletter|subscribe|privacy|terms|cookies?|sitemap|accessibility|language|currency|store locator|find a store|track order|order status|returns?|gift cards?|blog|news|events?|menu|close|skip to content|back|book (an? )?(appointment|table|demo|now)|reservations?|appointments?|locations?|branches?|stores?|showrooms?|our (locations|stores|branches)|areas? we (cover|serve)|service areas?|doctors?|our (doctors|team|people)|capabilities|overview|platform|specialit(y|ies)|specialt(y|ies)|departments?|financials?|investor relations?|governance|announcements?|annual reports?|shareholders?|corporate|sustainability|esg|csr|diversity|leadership|board|media|gallery|awards|partners?|affiliates?|suppliers?|send us feedback|feedback|give feedback|site ?map|cookie preferences|manage cookies|do not sell|gift ?cards?( balance)?|balance|promotions?( & discounts?)?|deals?|offers?|nearby store|find us|start now|get started|sign up now|join now|download|app|africa|americas|asia pacific|europe|middle east|oceania|north america|south america|latin america|global|worldwide|country|region|change (country|region|language)|membership|rewards?|loyalty|refer a friend|gift ?ideas?|best ?sellers?|new arrivals?|trending|shop all)$/i;

/**
 * A navigation label only names an offering when the link behind it goes to
 * offering content. "Specialities" pointing at a service index is a section
 * heading; "Cardiology" pointing at a service page is a line of business.
 * Classifying the href is what separates the two, and it generalizes across
 * sites in a way a label wordlist never could.
 */
/** Link targets that genuinely name an offering rather than a section. */
const OFFERING_TARGET_PAGE_TYPES = new Set<PageType>(["category", "product", "service", "solution", "industry"]);

const SECTION_TARGET_PAGE_TYPES = new Set<PageType>([
  "home",
  "about",
  "contact",
  "faq",
  "careers",
  "legal",
  "editorial",
  "case_study",
  "store_locator",
  "location",
  "pricing",
  "product_index",
  "service_index",
]);

function addNavigationEvidence(add: AddFn, page: ExtractedPage, pageType: PageType): void {
  // Primary navigation is the business's own taxonomy of what it offers, once
  // the account/utility links and the section-index links are filtered out.
  const navLimit = pageType === "home" ? 40 : 20;
  const seen = new Set<string>();

  const consider = (label: string, href: string, source: "Primary nav" | "Footer nav") => {
    const trimmed = label.trim();
    if (trimmed.length < 2 || trimmed.length > 60) return;
    if (seen.has(trimmed.toLowerCase())) return;
    seen.add(trimmed.toLowerCase());
    if (UTILITY_NAV_LABEL.test(trimmed)) return;
    const targetType = classifyFromUrl({ url: href, anchorText: trimmed });
    if (SECTION_TARGET_PAGE_TYPES.has(targetType)) return;
    add("navigation", `${source}: ${trimmed}`, "offering", { href, targetType });
  };

  let navCount = 0;
  let footerCount = 0;
  for (const link of page.links) {
    if (link.inNav && navCount < navLimit) {
      navCount++;
      consider(link.text, link.href, "Primary nav");
    } else if (link.inFooter && footerCount < 20) {
      footerCount++;
      // Footer links on a large site are corporate/utility navigation
      // (investor relations, region switchers, feedback forms). Only keep one
      // whose target is unambiguously offering content.
      const targetType = classifyFromUrl({ url: link.href, anchorText: link.text });
      if (OFFERING_TARGET_PAGE_TYPES.has(targetType)) consider(link.text, link.href, "Footer nav");
    }
  }

  for (const affordance of page.commerceAffordances) {
    add("url_signal", `Commerce affordance: ${affordance}`, "archetype", { affordance });
  }
}

function addContentEvidence(add: AddFn, page: ExtractedPage, pageType: PageType): void {
  if (LISTING_PAGE_TYPES.has(pageType)) {
    for (const card of page.cardTitles.slice(0, 40)) add("list_item", `Listing item: ${card}`, "offering");
    for (const item of page.listItems.slice(0, 20)) add("list_item", `List item: ${item}`, "offering");
    for (const cell of page.tableCells.slice(0, 24)) add("table", `Table cell: ${cell}`, "offering");
  } else {
    for (const card of page.cardTitles.slice(0, 12)) add("list_item", `Listing item: ${card}`, "offering");
    for (const item of page.listItems.slice(0, 10)) add("list_item", `List item: ${item}`, "offering");
  }

  const paragraphs = splitSentences(page.mainText);
  const proseBudget = PROSE_PAGE_TYPES.has(pageType) ? 14 : 6;
  for (const sentence of selectInformativeSentences(paragraphs, proseBudget)) {
    const hint: EvidenceFieldHint = pageType === "about" || pageType === "home" ? "description" : "offering";
    add("main_content", sentence, hint);
  }
  for (const sentence of selectPositioningSentences(paragraphs, 8)) {
    add("main_content", sentence, "identity");
  }
  for (const sentence of selectAudienceSentences(paragraphs, 6)) {
    add("main_content", sentence, "audience");
  }
  for (const sentence of selectMarketSentences(paragraphs, 6)) {
    add("main_content", sentence, "market");
  }
}

function addGeographyEvidence(add: AddFn, page: ExtractedPage): void {
  const signals = page.locationSignals;
  // Address blocks come from <address>/contact/footer containers and carry
  // the whole postal line, unlike the regex matches that stop at a keyword.
  for (const block of signals?.addressBlocks.slice(0, 6) ?? []) add("address", `Address block: ${block}`, "market", { addressBlock: true });
  for (const address of page.addresses.slice(0, 8)) add("address", `Address text: ${address}`, "market");
  for (const tel of signals?.telLinks.slice(0, 6) ?? []) add("phone", `Phone link: ${tel}`, "market", { telephone: tel, telLink: true });
  for (const phone of page.phoneCountrySignals.slice(0, 6)) add("phone", `Phone: ${phone}`, "market");
  for (const map of signals?.mapLinks.slice(0, 6) ?? []) {
    const where = map.lat !== undefined && map.lng !== undefined ? `${map.lat}, ${map.lng}` : (map.query ?? "");
    add("url_signal", `Map link: ${where ? `${where} ` : ""}${map.url}`.trim(), "market", { mapUrl: map.url, lat: map.lat, lng: map.lng, query: map.query, placeId: map.placeId });
  }
  if (signals?.geoMeta) {
    const g = signals.geoMeta;
    const text = [g.lat !== undefined && g.lng !== undefined ? `${g.lat}, ${g.lng}` : null, g.placename, g.region].filter(Boolean).join(" · ");
    if (text) add("meta", `Geo meta: ${text}`, "market", { lat: g.lat, lng: g.lng, placename: g.placename, region: g.region });
  }
  for (const currency of page.currencySignals.slice(0, 6)) add("currency", `Currency: ${currency}`, "market");
  for (const email of signals?.emailLinks.slice(0, 3) ?? []) add("url_signal", `Email link: ${email}`, "contact", { email });
  for (const social of signals?.socialLinks.slice(0, 8) ?? []) add("url_signal", `Social profile: ${social}`, "contact", { sameAs: social });
  for (const booking of signals?.bookingLinks.slice(0, 6) ?? []) {
    add("url_signal", `Booking platform: ${booking.platform} ${booking.url}`, "archetype", { bookingPlatform: booking.platform, url: booking.url });
  }
}

// --- Sentence selection ----------------------------------------------------

const BOILERPLATE_SENTENCE =
  /\b(cookie|cookies|privacy policy|terms of (use|service)|all rights reserved|copyright ©|sign up for (our )?newsletter|subscribe to|follow us on|skip to (main )?content|javascript|enable javascript)\b/i;

export function splitSentences(text: string): string[] {
  return text
    .split(/(?<=[.!?])\s+(?=[A-Z0-9"“'])/)
    .map((s) => s.trim())
    .filter((s) => s.length >= 30 && s.length <= 400 && !BOILERPLATE_SENTENCE.test(s));
}

const DESCRIPTIVE_HINT =
  /\b(we (are|provide|offer|deliver|design|build|manufacture|serve|specialis|specializ|help)|is (a|an|the) (leading )?[a-z]|our (mission|company|business|products?|services?|clients?|customers?)|founded in|established in|since \d{4}|provides?|offers?|delivers?|specialis|specializ|headquarter)\b/i;

function selectInformativeSentences(sentences: string[], limit: number): string[] {
  const scored = sentences.map((s) => ({ s, score: (DESCRIPTIVE_HINT.test(s) ? 2 : 0) + Math.min(1, s.length / 200) }));
  return scored
    .sort((a, b) => b.score - a.score)
    .slice(0, limit)
    .map((x) => x.s);
}

const POSITIONING_HINT =
  /\b(premium|luxury|affordable|budget|value for money|handcrafted|handmade|artisan|sustainab|eco-?friendly|recycled|organic|ethical|carbon|innovat|cutting-edge|advanced technology|performance|professional-grade|enterprise-grade|award-winning|certified|accredited|trusted by|family-(owned|run|friendly)|locally owned|independent|boutique|personalis|personaliz|bespoke|custom|fast|same-day|24\/7|round-the-clock|minimalist|design-led|clinically|evidence-based|secure|compliant)\b/i;

function selectPositioningSentences(sentences: string[], limit: number): string[] {
  return sentences.filter((s) => POSITIONING_HINT.test(s)).slice(0, limit);
}

const AUDIENCE_HINT =
  /\b(for (enterprises?|businesses?|teams?|developers?|marketers?|designers?|startups?|smbs?|small businesses?|agencies|athletes?|runners?|families|parents?|students?|professionals?|homeowners?|patients?|clinicians?|retailers?|manufacturers?|investors?|travellers?|travelers?|drivers?|women|men|kids|children)|built for|designed for|ideal for|trusted by|serving|our (clients?|customers?|patients?|students?|guests?) (are|include))\b/i;

function selectAudienceSentences(sentences: string[], limit: number): string[] {
  return sentences.filter((s) => AUDIENCE_HINT.test(s)).slice(0, limit);
}

const MARKET_HINT =
  /\b(serving|available in|ships? to|shipping (to|across|within)|delivery (to|across|in)|across (the )?[A-Z]|operating in|offices? in|locations? (in|across)|based in|headquartered in|nationwide|worldwide|globally|pan-india|throughout|branches? in|stores? (in|across)|clinics? in)\b/;

function selectMarketSentences(sentences: string[], limit: number): string[] {
  return sentences.filter((s) => MARKET_HINT.test(s)).slice(0, limit);
}
