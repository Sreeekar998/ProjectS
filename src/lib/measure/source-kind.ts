// What kind of site a cited source is.
//
// Ownership ("yours", "rival") comes from the frozen competitive set and is a
// fact. Everything else is a GUESS from the address — a short rule table over
// well-known hosts and path words — and the UI labels it as one. The rules
// are deliberately small: a wrong guess mislabels a row, a big list pretends
// to a precision the product does not have.

import type { SourceKind } from "./types";

const MARKETPLACES = [
  "amazon", "flipkart", "ebay", "walmart", "etsy", "myntra", "ajio", "nykaa", "alibaba", "aliexpress", "target", "bestbuy", "noon",
  "namshi", "zalando", "asos", "decathlon", "shopee", "lazada", "mercadolibre", "rakuten", "snapdeal", "meesho", "tatacliq", "jiomart",
  "bigbasket", "blinkit", "zepto", "swiggy", "zomato", "ubereats", "doordash", "booking", "expedia", "agoda", "makemytrip", "tripadvisor",
  "yelp", "justdial", "sulekha", "indiamart", "g2", "capterra", "trustpilot",
];
const COMMUNITY = ["reddit", "quora", "stackexchange", "stackoverflow", "discord", "mumsnet", "flyertalk", "teamblind", "producthunt", "hackernews", "ycombinator"];
const REFERENCE = ["wikipedia", "wikidata", "britannica", "crunchbase", "wikihow", "investopedia", "nih", "who", "gov", "edu", "ac"];
const SOCIAL_VIDEO = ["youtube", "youtu", "tiktok", "instagram", "facebook", "x", "twitter", "linkedin", "pinterest", "medium", "substack", "threads", "vimeo", "snapchat"];

const EDITORIAL_HOST = /(review|magazine|news|times|post|guide|journal|gazette|herald|tribune|weekly|daily|blog|wired|verge|cnet|techradar|forbes|guardian|mint|economic|business|insider|digest|advisor|lab)/i;
const EDITORIAL_PATH = /\/(reviews?|best-|top-|guides?|blog|news|articles?|compare|comparison|vs-|rankings?)/i;
const MARKETPLACE_PATH = /\/(dp|gp\/product|products?|shop|store|item|listing|buy)\b/i;
const COMMUNITY_PATH = /\/(forum|forums|community|discussion|threads?|questions?|r\/)/i;

/** Registrable domain's first label ("runnersworld" for runnersworld.com). */
function firstLabel(domain: string): string {
  return domain.split(".")[0] ?? domain;
}

function tld(domain: string): string {
  return domain.split(".").pop() ?? "";
}

export function guessSourceKind(domain: string, urls: string[] = [], ownership: string = "THIRD_PARTY"): SourceKind {
  if (ownership === "TARGET_OWNED") return "yours";
  if (ownership === "COMPETITOR_OWNED") return "rival";
  const host = domain.toLowerCase();
  const label = firstLabel(host);
  const suffix = tld(host);
  const paths = urls.map((url) => {
    try {
      return new URL(url).pathname;
    } catch {
      return "";
    }
  });
  if (SOCIAL_VIDEO.includes(label)) return "social_video";
  if (COMMUNITY.includes(label) || paths.some((path) => COMMUNITY_PATH.test(path))) return "community";
  if (REFERENCE.includes(label) || ["gov", "edu"].includes(suffix) || /\.(gov|edu|ac)\./.test(`.${host}.`)) return "reference";
  if (MARKETPLACES.includes(label) || paths.some((path) => MARKETPLACE_PATH.test(path))) return "marketplace";
  if (EDITORIAL_HOST.test(label) || paths.some((path) => EDITORIAL_PATH.test(path))) return "editorial";
  return "other";
}
