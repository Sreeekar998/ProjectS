import * as cheerio from "cheerio";
import crypto from "node:crypto";
import {
  extractMicrodata,
  extractRdfa,
  flattenJsonLd,
  parseJsonLdBlocks,
  type SchemaEntity,
} from "./structured-data";

export interface ExtractedLink {
  href: string;
  text: string;
  inNav: boolean;
  inFooter: boolean;
}

export interface ExtractedImage {
  alt: string;
  src: string;
  isLogo: boolean;
}

export interface HeadingNode {
  level: 1 | 2 | 3;
  text: string;
}

export interface MapLink {
  url: string;
  lat?: number;
  lng?: number;
  /** The place text in a `q=` / `query=` / `/place/<name>` link when no coordinates are given. */
  query?: string;
  placeId?: string;
}

export interface LocationSignals {
  /** Numbers from `tel:` links — the most reliable phone signal a page has. */
  telLinks: string[];
  emailLinks: string[];
  /** Google/Apple/Waze/OSM map links and embeds, with any coordinates parsed out. */
  mapLinks: MapLink[];
  /** `geo.position` / `ICBM` / `geo.placename` / `geo.region` meta tags. */
  geoMeta: { lat?: number; lng?: number; placename?: string; region?: string } | null;
  /** Text of `<address>`-like blocks: contact/footer/location containers. */
  addressBlocks: string[];
  socialLinks: string[];
  /** Third-party booking, ordering or scheduling platforms linked from the page. */
  bookingLinks: Array<{ platform: string; url: string }>;
}

export interface ExtractedPage {
  title: string | null;
  metaDescription: string | null;
  canonicalUrl: string | null;
  htmlLang: string | null;
  ogTitle: string | null;
  ogDescription: string | null;
  ogSiteName: string | null;
  ogLocale: string | null;
  ogType: string | null;
  hreflang: Array<{ lang: string; href: string }>;
  headings: string[];
  headingNodes: HeadingNode[];
  h1: string | null;
  breadcrumb: string[];
  navLabels: string[];
  footerLabels: string[];
  listItems: string[];
  tableCells: string[];
  cardTitles: string[];
  mainText: string;
  /** Text of the whole body with boilerplate removed — the JS-shell detector. */
  visibleTextLength: number;
  jsonLd: unknown[];
  schemaEntities: SchemaEntity[];
  links: ExtractedLink[];
  images: ExtractedImage[];
  addresses: string[];
  phoneCountrySignals: string[];
  currencySignals: string[];
  /** Location, contact and platform signals that the profile layer resolves. */
  locationSignals: LocationSignals;
  hasArticleBody: boolean;
  publishedDate: string | null;
  itemCardCount: number;
  commerceAffordances: string[];
  contentHash: string;
}

const BOILERPLATE_SELECTORS = [
  "script",
  "style",
  "noscript",
  "svg",
  "iframe",
  "template",
  "[aria-hidden=true]",
  ".cookie-banner",
  ".cookie-consent",
  "#cookie-banner",
  "#onetrust-consent-sdk",
  ".skip-link",
];

const CHROME_SELECTORS = ["nav", "footer", "header", "[role=navigation]", "[role=banner]", "[role=contentinfo]"];

const CURRENCY_PATTERN = /(US\$|USD|AED|EUR|€|GBP|£|INR|₹|SAR|QAR|KWD|CAD|AUD|SGD|JPY|¥|CHF|ZAR|BRL|MXN|Rs\.?)\s?[\d,]/g;
const PHONE_COUNTRY_PATTERN = /\+\d{1,3}[\s-]?\(?\d{1,4}\)?[\s-]?\d{3,4}[\s-]?\d{3,4}/g;
// Two shapes: "123 Congress Ave, Suite 400" (number first) and "6th Floor,
// Staybridge Suites, Sheikh Zayed Road, DIFC" (no house number, common in the
// Gulf, India and the UK). The match runs on to the next sentence break so the
// district and city after the street token are kept.
const ADDRESS_HINT_PATTERN =
  /(?:\b\d{1,5}[a-z]?[,]?\s+[A-Za-z0-9.,'\-\s]{3,60}\b(?:street|st\.|road|rd\.|avenue|ave\.|lane|drive|dr\.|blvd|boulevard|highway|suite|floor|building|tower|plaza|park|po box|p\.o\. box|marg|nagar|colony|sector|block|unit|shop)\b[A-Za-z0-9.,'\-\s]{0,80}|\b(?:floor|level|unit|shop|office|suite|villa|building|tower|plaza|mall|centre|center|complex)\s+[A-Za-z0-9.,'\-\s]{3,120}\b(?:road|street|st\.|rd\.|avenue|ave\.|boulevard|blvd|marina|bay|creek|district|downtown|city|town)\b[A-Za-z0-9.,'\-\s]{0,60})/gi;

/** Non-global: words that make a short block read like a postal address. */
const ADDRESS_WORD = /\b(street|st\.|road|rd\.|avenue|ave\.?|lane|drive|blvd|boulevard|highway|suite|floor|level|building|bldg|tower|plaza|p\.?\s?o\.?\s?box|unit|shop|office|villa|mall|centre|center|district|gate|marg|nagar|sector|block|postcode|zip)\b/i;

const COMMERCE_AFFORDANCES: Array<{ label: string; test: RegExp }> = [
  { label: "add_to_cart", test: /\b(add to (cart|bag|basket)|buy now|shop now|checkout)\b/i },
  { label: "book_appointment", test: /\b(book (a |an )?(appointment|table|room|test drive|consultation|class|demo)|make a reservation|reserve (a )?(table|room))\b/i },
  { label: "request_quote", test: /\b(get a (quote|estimate)|request a (quote|estimate|callback)|free consultation)\b/i },
  { label: "request_demo", test: /\b(request a demo|book a demo|schedule a demo|start free trial|free trial|get started free)\b/i },
  { label: "apply_enroll", test: /\b(apply (now|online|today)|enroll now|admissions? open|register now)\b/i },
  { label: "order_online", test: /\b(order online|order now|delivery|takeaway|takeout|pickup)\b/i },
  { label: "find_location", test: /\b(find a (store|dealer|branch|location|clinic)|store locator|near you|our locations)\b/i },
  { label: "contact_sales", test: /\b(contact sales|talk to (sales|an expert)|speak to (an? )?(advisor|specialist))\b/i },
];

export function extractPage(html: string, baseUrl: string): ExtractedPage {
  const $ = cheerio.load(html);
  // Map embeds live in <iframe>, which the boilerplate pass removes, and geo
  // meta tags sit in <head>; both are read before anything is stripped.
  const locationSignals = extractLocationSignals($, baseUrl);
  $(BOILERPLATE_SELECTORS.join(",")).remove();

  const title = text($("title").first()) || null;
  const metaDescription = attr($, 'meta[name="description"]', "content");
  const canonicalUrl = attr($, 'link[rel="canonical"]', "href");
  const htmlLang = $("html").attr("lang")?.trim() || null;
  const ogTitle = attr($, 'meta[property="og:title"]', "content");
  const ogDescription = attr($, 'meta[property="og:description"]', "content");
  const ogSiteName = attr($, 'meta[property="og:site_name"]', "content");
  const ogLocale = attr($, 'meta[property="og:locale"]', "content");
  const ogType = attr($, 'meta[property="og:type"]', "content");

  const hreflang: Array<{ lang: string; href: string }> = [];
  $('link[rel="alternate"][hreflang]').each((_, el) => {
    const lang = $(el).attr("hreflang")?.trim();
    const href = $(el).attr("href")?.trim();
    if (lang && href && hreflang.length < 60) hreflang.push({ lang: lang.toLowerCase(), href });
  });

  const headingNodes: HeadingNode[] = [];
  $("h1, h2, h3").each((_, el) => {
    if (headingNodes.length >= 60) return;
    const value = text($(el));
    if (!value || value.length > 160) return;
    const level = Number(el.tagName.slice(1)) as 1 | 2 | 3;
    headingNodes.push({ level, text: value });
  });
  const h1 = headingNodes.find((h) => h.level === 1)?.text ?? null;

  const breadcrumb = extractBreadcrumb($);
  const navLabels = collectAnchorLabels($, "nav a, [role=navigation] a, header a", 60);
  const footerLabels = collectAnchorLabels($, "footer a, [role=contentinfo] a", 40);

  const jsonLdBlocks: string[] = [];
  $('script[type="application/ld+json"]').each((_, el) => {
    jsonLdBlocks.push($(el).contents().text());
  });
  // The removal pass above strips <script>, so re-read from the original HTML
  // when the first pass found nothing (some sites put JSON-LD inside <noscript>).
  const rawBlocks = jsonLdBlocks.length > 0 ? jsonLdBlocks : readJsonLdFromRaw(html);
  const jsonLd = parseJsonLdBlocks(rawBlocks);
  const schemaEntities = [...flattenJsonLd(jsonLd), ...extractMicrodata($), ...extractRdfa($)];

  const links: ExtractedLink[] = [];
  $("a[href]").each((_, el) => {
    if (links.length >= 500) return;
    const href = $(el).attr("href");
    if (!href) return;
    const label = text($(el)).slice(0, 140);
    try {
      links.push({
        href: new URL(href, baseUrl).toString(),
        text: label,
        inNav: $(el).parents("nav, header, [role=navigation]").length > 0,
        inFooter: $(el).parents("footer, [role=contentinfo]").length > 0,
      });
    } catch {
      // mailto:, tel:, javascript: and malformed hrefs are not crawl targets
    }
  });

  const images: ExtractedImage[] = [];
  $("img[alt]").each((_, el) => {
    if (images.length >= 60) return;
    const alt = ($(el).attr("alt") ?? "").trim();
    if (!alt || alt.length > 120) return;
    const src = $(el).attr("src") ?? "";
    const cls = `${$(el).attr("class") ?? ""} ${$(el).parents("[class]").first().attr("class") ?? ""}`.toLowerCase();
    images.push({ alt, src, isLogo: /logo|brand|wordmark/.test(cls) || /logo/i.test(src) || /logo/i.test(alt) });
  });

  const listItems = uniqueTexts($, "main li, article li, section li, [class*=list] li", 80, 120);
  const tableCells = uniqueTexts($, "table th, table td", 60, 90);
  const cardTitles = extractCardTitles($);
  const itemCardCount = countItemCards($);

  const bodyClone = $("body").clone();
  bodyClone.find(CHROME_SELECTORS.join(",")).remove();
  const mainCandidate = bodyClone.find("main, article, [role=main], #main, #content, .main-content").first();
  const mainText = normalizeWhitespace((mainCandidate.length > 0 ? mainCandidate : bodyClone).text());
  const visibleTextLength = normalizeWhitespace($("body").text()).length;

  // The header top bar ("Call +971 4 …", "Visit us at …") was excluded by the
  // chrome strip, which is exactly where a local business puts its phone.
  const addressPool = `${mainText} ${footerLabels.join(" ")} ${normalizeWhitespace($("footer").text())} ${normalizeWhitespace($("header").text()).slice(0, 2000)} ${locationSignals.addressBlocks.join(" ")}`;
  const addresses = uniqueMatches(addressPool, ADDRESS_HINT_PATTERN).slice(0, 12);
  const phoneCountrySignals = uniqueMatches(addressPool, PHONE_COUNTRY_PATTERN).slice(0, 12);
  const currencySignals = uniqueMatches(`${mainText} ${tableCells.join(" ")} ${cardTitles.join(" ")}`, CURRENCY_PATTERN).slice(0, 12);

  const affordanceHaystack = `${mainText.slice(0, 20_000)} ${navLabels.join(" ")} ${cardTitles.join(" ")}`;
  const commerceAffordances = COMMERCE_AFFORDANCES.filter((a) => a.test.test(affordanceHaystack)).map((a) => a.label);

  const articleEl = $("article, [itemprop=articleBody], .post-content, .entry-content").first();
  const hasArticleBody = articleEl.length > 0 && normalizeWhitespace(articleEl.text()).length > 600;
  const publishedDate =
    attr($, 'meta[property="article:published_time"]', "content") ?? attr($, "time[datetime]", "datetime") ?? null;

  return {
    title,
    metaDescription,
    canonicalUrl,
    htmlLang,
    ogTitle,
    ogDescription,
    ogSiteName,
    ogLocale,
    ogType,
    hreflang,
    headings: headingNodes.map((h) => h.text),
    headingNodes,
    h1,
    breadcrumb,
    navLabels,
    footerLabels,
    listItems,
    tableCells,
    cardTitles,
    mainText: mainText.slice(0, 60_000),
    visibleTextLength,
    jsonLd,
    schemaEntities,
    links,
    images,
    addresses,
    phoneCountrySignals: [...new Set([...phoneCountrySignals, ...locationSignals.telLinks.filter((t) => t.startsWith("+"))])].slice(0, 12),
    currencySignals,
    locationSignals,
    hasArticleBody,
    publishedDate,
    itemCardCount,
    commerceAffordances,
    contentHash: crypto.createHash("sha256").update(mainText).digest("hex"),
  };
}

const MAP_HOST_PATTERN = /(google\.[a-z.]+\/maps|maps\.google\.|maps\.app\.goo\.gl|goo\.gl\/maps|maps\.apple\.com|waze\.com|openstreetmap\.org|bing\.com\/maps|2gis\.|yandex\.[a-z]+\/maps)/i;
const SOCIAL_HOST_PATTERN = /^(?:www\.)?(instagram\.com|facebook\.com|fb\.com|tiktok\.com|linkedin\.com|x\.com|twitter\.com|youtube\.com|youtu\.be|pinterest\.com|threads\.net|snapchat\.com|wa\.me|api\.whatsapp\.com)$/i;
const BOOKING_PLATFORMS: Array<{ platform: string; test: RegExp }> = [
  { platform: "fresha", test: /fresha\.com/i },
  { platform: "booksy", test: /booksy\.com/i },
  { platform: "vagaro", test: /vagaro\.com/i },
  { platform: "zenoti", test: /zenoti\.com|\.zenoti\./i },
  { platform: "phorest", test: /phorest\./i },
  { platform: "mindbody", test: /mindbodyonline\.com|mindbody\.io/i },
  { platform: "treatwell", test: /treatwell\./i },
  { platform: "opentable", test: /opentable\./i },
  { platform: "resy", test: /resy\.com/i },
  { platform: "sevenrooms", test: /sevenrooms\.com/i },
  { platform: "zomato", test: /zomato\.com/i },
  { platform: "talabat", test: /talabat\.com/i },
  { platform: "deliveroo", test: /deliveroo\./i },
  { platform: "ubereats", test: /ubereats\.com/i },
  { platform: "doordash", test: /doordash\.com/i },
  { platform: "swiggy", test: /swiggy\.com/i },
  { platform: "calendly", test: /calendly\.com/i },
  { platform: "cal.com", test: /cal\.com\//i },
  { platform: "acuity", test: /acuityscheduling\.com|squarespace\.com\/schedule/i },
  { platform: "square", test: /squareup\.com\/appointments|square\.site/i },
  { platform: "hubspot_meetings", test: /meetings\.hubspot\.com/i },
  { platform: "practo", test: /practo\.com/i },
  { platform: "zocdoc", test: /zocdoc\.com/i },
  { platform: "booking.com", test: /booking\.com/i },
  { platform: "airbnb", test: /airbnb\./i },
  { platform: "shopify_checkout", test: /myshopify\.com/i },
];

function parseMapLink(url: string): MapLink | null {
  if (!MAP_HOST_PATTERN.test(url)) return null;
  const link: MapLink = { url: url.slice(0, 500) };
  // "/@25.2118,55.2739,17z" and "!3d25.2118!4d55.2739" (place pins), "ll=" / "q=lat,lng" / "center=".
  const at = /@(-?\d{1,2}\.\d+),(-?\d{1,3}\.\d+)/.exec(url);
  const pin = /!3d(-?\d{1,2}\.\d+)!4d(-?\d{1,3}\.\d+)/.exec(url);
  // Embed `pb=` strings carry the map centre as `!1m3!1d<size>!2d<lng>!3d<lat>`
  // (longitude first), unlike place links where `!3d` is latitude.
  const embed = /!1m3!1d[\d.e+-]+!2d(-?\d{1,3}\.\d+)!3d(-?\d{1,2}\.\d+)/.exec(url);
  const pair = /[?&](?:q|ll|center|query|destination|sll|daddr)=(-?\d{1,2}\.\d+),\s*(-?\d{1,3}\.\d+)/.exec(url);
  if (pin) {
    link.lat = Number(pin[1]);
    link.lng = Number(pin[2]);
  } else if (embed) {
    link.lat = Number(embed[2]);
    link.lng = Number(embed[1]);
  } else if (pair) {
    link.lat = Number(pair[1]);
    link.lng = Number(pair[2]);
  } else if (at) {
    link.lat = Number(at[1]);
    link.lng = Number(at[2]);
  }
  const placeId = /[?&](?:place_id|query_place_id)=([A-Za-z0-9_-]{10,})/.exec(url) ?? /!1s(0x[0-9a-f]+:0x[0-9a-f]+)/i.exec(url);
  if (placeId) link.placeId = placeId[1];
  const query = /[?&](?:q|query|destination)=([^&]+)/.exec(url) ?? /\/maps\/place\/([^/@?]+)/.exec(url) ?? /\/maps\/search\/([^/@?]+)/.exec(url) ?? /!2s([^!]{3,})/.exec(url);
  if (query && !/^-?\d/.test(decodeURIComponent(query[1] ?? ""))) {
    try {
      link.query = decodeURIComponent(query[1]!.replace(/\+/g, " ")).slice(0, 200);
    } catch {
      link.query = query[1]!.slice(0, 200);
    }
  }
  return link;
}

function extractLocationSignals($: cheerio.CheerioAPI, baseUrl: string): LocationSignals {
  const telLinks = new Set<string>();
  const emailLinks = new Set<string>();
  const mapLinks: MapLink[] = [];
  const seenMaps = new Set<string>();
  const socialLinks = new Set<string>();
  const bookingLinks: Array<{ platform: string; url: string }> = [];
  const seenBooking = new Set<string>();

  const considerUrl = (raw: string | undefined) => {
    if (!raw) return;
    const href = raw.trim();
    if (/^tel:/i.test(href)) {
      const number = href.replace(/^tel:/i, "").replace(/[^\d+]/g, "");
      if (number.replace(/\D/g, "").length >= 6 && telLinks.size < 12) telLinks.add(number);
      return;
    }
    if (/^mailto:/i.test(href)) {
      const email = href.replace(/^mailto:/i, "").split("?")[0]?.trim().toLowerCase();
      if (email && /.+@.+\..+/.test(email) && emailLinks.size < 6) emailLinks.add(email);
      return;
    }
    let absolute: URL;
    try {
      absolute = new URL(href, baseUrl);
    } catch {
      return;
    }
    if (absolute.protocol !== "http:" && absolute.protocol !== "https:") return;
    const full = absolute.toString();
    const map = parseMapLink(full);
    if (map && mapLinks.length < 12 && !seenMaps.has(full)) {
      seenMaps.add(full);
      mapLinks.push(map);
      return;
    }
    if (SOCIAL_HOST_PATTERN.test(absolute.hostname) && socialLinks.size < 12) {
      // Share links ("/sharer", "/intent/tweet") are not profiles.
      if (!/share|sharer|intent\/|\/dialog\//i.test(full)) socialLinks.add(full.split("?")[0]!.slice(0, 200));
      return;
    }
    const booking = BOOKING_PLATFORMS.find((b) => b.test.test(full));
    if (booking && bookingLinks.length < 8 && !seenBooking.has(booking.platform)) {
      seenBooking.add(booking.platform);
      bookingLinks.push({ platform: booking.platform, url: full.slice(0, 300) });
    }
  };

  $("a[href]").each((_, el) => considerUrl($(el).attr("href")));
  $("iframe[src], iframe[data-src]").each((_, el) => considerUrl($(el).attr("src") ?? $(el).attr("data-src")));
  $("link[rel=me][href]").each((_, el) => considerUrl($(el).attr("href")));

  let geoMeta: LocationSignals["geoMeta"] = null;
  const position = $('meta[name="geo.position"]').attr("content") ?? $('meta[name="ICBM"]').attr("content");
  const placename = $('meta[name="geo.placename"]').attr("content")?.trim();
  const region = $('meta[name="geo.region"]').attr("content")?.trim();
  if (position || placename || region) {
    geoMeta = {};
    const pair = position ? /(-?\d{1,2}\.\d+)[;,\s]+(-?\d{1,3}\.\d+)/.exec(position) : null;
    if (pair) {
      geoMeta.lat = Number(pair[1]);
      geoMeta.lng = Number(pair[2]);
    }
    if (placename) geoMeta.placename = placename.slice(0, 120);
    if (region) geoMeta.region = region.slice(0, 40);
  }

  // Address blocks: explicit <address>, microdata addresses, and containers
  // whose class/id says contact/location/address. Footer lines that look
  // like a postal line (digits or several comma-separated parts) are kept too.
  const blocks = new Set<string>();
  const pushBlock = (raw: string, semantic = false) => {
    const text = normalizeWhitespace(raw);
    if (text.length < 8 || text.length > 320) return;
    if (!/\d/.test(text) && text.split(",").length < 3) return;
    // A `location` or `address` class wraps marketing copy as often as an
    // address: "Every visit to Atelier 10 begins with 1 consultation" passed
    // the old digit test. Outside semantic markup, a block must read like an
    // address: an address word or at least two commas, and not a paragraph.
    if (!semantic) {
      if (text.split(/\s+/).length > 40) return;
      if (!ADDRESS_WORD.test(text) && text.split(",").length < 3) return;
    }
    if (blocks.size < 8) blocks.add(text);
  };
  $("address, [itemprop=address], [itemtype*=PostalAddress]").each((_, el) => pushBlock($(el).text(), true));
  $("[class*=address], [id*=address], [class*=location], [id*=location], [class*=contact-info], [class*=find-us], [class*=visit-us], [class*=our-location]").each((_, el) => {
    const text = normalizeWhitespace($(el).text());
    if (text.length <= 320) pushBlock(text);
    else {
      for (const line of $(el).text().split(/\n{1,}/)) pushBlock(line);
    }
  });
  for (const line of $("footer").text().split(/\n+/)) {
    const text = normalizeWhitespace(line);
    if (/\d/.test(text) && text.split(",").length >= 2) pushBlock(text);
  }

  return {
    telLinks: [...telLinks],
    emailLinks: [...emailLinks],
    mapLinks,
    geoMeta,
    addressBlocks: [...blocks],
    socialLinks: [...socialLinks],
    bookingLinks,
  };
}

function readJsonLdFromRaw(html: string): string[] {
  const out: string[] = [];
  const pattern = /<script[^>]+type=["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/gi;
  for (const match of html.matchAll(pattern)) {
    if (out.length >= 30) break;
    out.push(match[1] ?? "");
  }
  return out;
}

function extractBreadcrumb($: cheerio.CheerioAPI): string[] {
  const selectors = ["[itemtype*=BreadcrumbList] [itemprop=name]", "nav[aria-label*=readcrumb] a", ".breadcrumb a", ".breadcrumbs a", "[class*=breadcrumb] a", "[class*=Breadcrumb] a"];
  for (const selector of selectors) {
    const values = $(selector)
      .map((_, el) => text($(el)))
      .get()
      .filter((v) => v.length > 0 && v.length < 80);
    if (values.length >= 2) return [...new Set(values)].slice(0, 8);
  }
  return [];
}

function collectAnchorLabels($: cheerio.CheerioAPI, selector: string, limit: number): string[] {
  const seen = new Set<string>();
  $(selector).each((_, el) => {
    if (seen.size >= limit) return;
    const value = text($(el));
    if (value.length >= 2 && value.length <= 60) seen.add(value);
  });
  return [...seen];
}

/**
 * Card titles carry the offering vocabulary on category/listing pages, which
 * is exactly where Readability-style main-content extraction throws the most
 * useful signal away.
 */
function extractCardTitles($: cheerio.CheerioAPI): string[] {
  const selectors = [
    "[class*=card] h2, [class*=card] h3, [class*=card] h4",
    "[class*=tile] h2, [class*=tile] h3",
    "[class*=product] h2, [class*=product] h3, [class*=product] h4",
    "[class*=item] h3, [class*=item] h4",
    "li h3, li h4",
    "[class*=grid] a[href] span, [class*=grid] a[href] h3",
  ];
  const seen = new Set<string>();
  for (const selector of selectors) {
    $(selector).each((_, el) => {
      if (seen.size >= 80) return;
      const value = text($(el));
      if (value.length >= 2 && value.length <= 90) seen.add(value);
    });
  }
  return [...seen];
}

function countItemCards($: cheerio.CheerioAPI): number {
  const counts = [
    $("[class*=product-card], [class*=productCard], [data-product-id], [itemtype*=Product]").length,
    $("[class*=card]").length,
    $("[class*=grid] > li, [class*=grid] > div > a[href]").length,
  ];
  return Math.max(...counts, 0);
}

function uniqueTexts($: cheerio.CheerioAPI, selector: string, limit: number, maxLen: number): string[] {
  const seen = new Set<string>();
  $(selector).each((_, el) => {
    if (seen.size >= limit) return;
    const value = text($(el));
    if (value.length >= 2 && value.length <= maxLen) seen.add(value);
  });
  return [...seen];
}

/** Structural type: works for every Cheerio node flavour without a generic. */
function text(node: { text(): string }): string {
  return normalizeWhitespace(node.text());
}

function attr($: cheerio.CheerioAPI, selector: string, name: string): string | null {
  return $(selector).first().attr(name)?.trim() || null;
}

function normalizeWhitespace(value: string): string {
  return value.replace(/\s+/g, " ").trim();
}

function uniqueMatches(value: string, pattern: RegExp): string[] {
  const matches = value.match(pattern) ?? [];
  return [...new Set(matches.map((m) => m.trim()))];
}

/**
 * A page is a JS shell when the server sent markup but almost no readable
 * content — the only case where the expensive browser fallback earns its cost.
 */
export function essentialContentMissing(page: Pick<ExtractedPage, "mainText" | "headingNodes" | "visibleTextLength" | "schemaEntities">, options: { isSeed?: boolean } = {}): boolean {
  const words = page.mainText.split(/\s+/).filter(Boolean).length;
  if (words >= 180) return false;
  // The home page is the one page a render always pays for: it is where the
  // business describes itself. Postman's static home page carried 70 words
  // of copy plus Organization JSON-LD, so the schema shortcut below declared
  // it complete and the profile was built from those 70 words.
  if (options.isSeed) return true;
  if (page.schemaEntities.length > 0 && words >= 60) return false;
  return page.visibleTextLength < 900 || page.headingNodes.length === 0;
}
