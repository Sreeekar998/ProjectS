// Open-knowledge competitor retrieval.
//
// WHAT CHANGED AND WHY
//
// Every previous version of this module asked one question: "is this company
// filed in a category that also contains the target?" That is a TAXONOMIC
// relation, and a consideration set is a SUBSTITUTION relation. Wikipedia's
// "Sportswear brands" contains Nike, and it also contains Giorgio Armani,
// Dickies, Acerbis and Admiral Sportswear — so single-category membership put
// those four in front of a Nike operator while Adidas, Puma and ASICS had to
// be typed in by hand.
//
// The fix is to stop treating categories as a membership test and start
// treating the target's whole category set as a SIGNATURE, then measure how
// much of that signature a candidate reproduces, weighting each shared
// category by how specific it is. Sharing "Athletic shoe brands" (79 members)
// says far more than sharing "Shoe brands" (210), which is ordinary inverse
// document frequency applied to a category index.
//
// Measured on the target set the previous version failed (nike.com):
//
//   before  Armani, Dickies, Mizuno, Geox, 361 Degrees, Admiral Sportswear,
//           American Eagle Outfitters, Acerbis, J.Crew, Newell Brands
//   after   Reebok, New Balance, Adidas, Skechers, Under Armour, ASICS, Puma,
//           Brooks, Anta, K-Swiss, Vans, Foot Locker, Li-Ning, Hoka, Saucony
//
// Armani and Dickies share ZERO of Nike's categories; they were only ever
// admitted because one broad category contained both. Newell Brands shares
// one. The signature score separates them without a single hardcoded name.
//
// Three signals, all free and keyless:
//   1. signature  — IDF-weighted share of the target's market categories.
//   2. prominence — Wikipedia sitelink count. A consideration set is made of
//                   businesses the buyer has heard of.
//   3. textual    — CirrusSearch `morelike:`, a TF-IDF neighbour search over
//                   article text. It supplies recall for companies the
//                   category graph misses and corroborates the ones it finds.

import { sparql, wikipedia } from "./wiki-client";
import { alpha2FromAlpha3, isCountryCode } from "@/lib/geo/iso3166";
import { countryName } from "@/lib/geo/countries";
import type { CompetitiveSearchProfile, CompetitorCandidate, CompetitorCandidateSource } from "./competitor-types";
import { hasLocalTier, planFromSearchProfile, type TargetKnowledgeFacts } from "./competitor-tiers";

/** Retrieval bounds. Every one of these costs API calls, so they are explicit. */
const POOL_CAP = 220;
/** A category larger than this is a directory, not a competitive set. */
const MAX_CATEGORY_SIZE = 360;
const MORELIKE_LIMIT = 50;
const MAX_SUGGESTIONS = 24;

// --- Category vocabulary ----------------------------------------------------

/** Categories about incorporation, listing, dates, geography or people. */
const NON_MARKET_CATEGORY =
  /\b(\d{4}s?|establishment|disestablish|initial public offering|listed on|stock exchange|dow jones|nasdaq|s&p|companies based in|headquartered|people|founders?|history|controvers|lawsuits?|sponsorship|advertising|olympic|fashion|wikipedia|articles|pages|use \w+ dates|short description|commons category|webarchive|cs1|multinational|defunct|former|acquisitions?|mergers?|subsidiaries)\b/i;

/** Categories that name a market: a product, a trade, or a kind of provider. */
const MARKET_CATEGORY =
  /\b(brands?|manufacturers?|companies|corporations?|retailers?|producers?|makers?|suppliers?|chains?|banks?|airlines?|hotels?|resorts?|restaurants?|hospitals?|clinics?|universit\w*|colleges?|schools?|marketplaces?|platforms?|services?|stores?|firms?|studios?|agencies|publishers?|breweries|distilleries|dealerships?|insurers?|carriers?|operators?|providers?)\b/i;

/** Nationality adjectives that scope a category by country rather than market. */
const NATIONALITY =
  /^(american|british|english|scottish|irish|spanish|indian|german|japanese|chinese|french|italian|dutch|swedish|korean|canadian|australian|mexican|brazilian|swiss|danish|norwegian|finnish|polish|turkish|russian|belgian|austrian|portuguese|greek|israeli|singaporean|malaysian|indonesian|thai|vietnamese|filipino|emirati|saudi|egyptian|nigerian|kenyan|south african|new zealand|argentine|chilean|colombian|peruvian|czech|hungarian|romanian|ukrainian|taiwanese|hong kong)\s+/i;

/**
 * The MARKET a category names, with any geographic scoping removed.
 *
 * "Clothing retailers of Spain" and "Clothing retailers of Sweden" are the
 * same market seen from two countries, but as raw strings they share nothing —
 * which is why Zara's signature matched Desigual and Pepe Jeans and missed
 * H&M and Uniqlo entirely. Reducing both to "clothing retailers" makes the
 * market the thing being compared, and leaves geography to the scorer's own
 * geography dimension where it can be weighted per archetype.
 */
export function marketHead(category: string): string {
  return category
    .replace(/\s+(?:of|in|from|based in)\s+(?:the\s+)?.*$/i, "")
    .replace(/\s+established in\s+\d{4}.*$/i, "")
    .replace(NATIONALITY, "")
    .trim()
    .toLowerCase();
}

/** True when the category name scopes a market to a country or region. */
export function isGeoScoped(category: string): boolean {
  return /\s+(?:of|in|from|based in)\s+/i.test(category) || NATIONALITY.test(category);
}

// --- Wikidata / Wikipedia access -------------------------------------------

interface EntityFacts {
  qid: string | null;
  /** English labels of P31 "instance of". */
  types: string[];
  website: string | null;
  /** Language editions carrying an article — a prominence proxy. */
  sitelinks: number;
  /** English labels of P127 "owned by" / P749 "parent organization". */
  owners: string[];
  /** ISO alpha-2 codes of P17 "country" (via P297). */
  countryCodes: string[];
}

/**
 * Comparable form of an entity name.
 *
 * Exclusion lists arrive as Wikidata LABELS ("OYSHO", "Pull&Bear") while the
 * candidate pool holds Wikipedia ARTICLE TITLES ("Oysho", "Stradivarius
 * (fashion retailer)"). Comparing those two directly is a case-and-punctuation
 * mismatch that silently matched nothing, which is why every Inditex sibling
 * survived a sibling filter that was working correctly.
 */
function normalizeName(value: string): string {
  return value
    .replace(/\s*\([^)]*\)\s*$/, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "");
}

function hostOf(value: string): string | null {
  const raw = value.trim().toLowerCase();
  if (!raw) return null;
  try {
    return new URL(/^https?:\/\//.test(raw) ? raw : `https://${raw}`).hostname.replace(/^www\./, "") || null;
  } catch {
    return null;
  }
}

/**
 * The name part of a host: "nike" for nike.in, zara.co.uk and shop.nike.com.
 * A two-letter country code after a short second-level label ("co.uk",
 * "com.au") is read as one public suffix.
 */
export function registrableLabel(host: string): string {
  const labels = host.toLowerCase().replace(/^www\./, "").split(".").filter(Boolean);
  if (labels.length < 2) return labels[0] ?? "";
  const last = labels[labels.length - 1]!;
  const second = labels[labels.length - 2]!;
  const compoundSuffix = labels.length >= 3 && last.length === 2 && second.length <= 3;
  return compoundSuffix ? labels[labels.length - 3]! : second;
}

export interface DomainResolution {
  entity: { id: string; label: string; description: string } | null;
  /** Every other entity published on this domain: the target's own brands. */
  ownedLabels: Set<string>;
  /** "url" when the official-website property matched the host exactly; "name" via the name-search fallback. */
  matchedBy?: "url" | "name" | null;
}

/**
 * Resolves a business from its own website rather than its name.
 *
 * Name search is unusable as a primary key — `wbsearchentities` for "Zara"
 * returns a given name, a Spanish municipality and eleven Belarusian villages
 * before the retailer. The official-website property (P856) is an identifier,
 * so it disambiguates exactly and works for any site, not only famous ones.
 *
 * The same query pays twice: every OTHER entity on the target's domain is one
 * of the target's own product lines (nike.com yields Air Jordan, Air Force 1,
 * Nike Air Max), giving a sub-brand exclusion list that needs no heuristics.
 */
export async function resolveByDomain(domain: string): Promise<DomainResolution> {
  const host = hostOf(domain);
  if (!host) return { entity: null, ownedLabels: new Set(), matchedBy: null };

  // Exact-URL lookup first. The previous implementation filtered every P856
  // statement in Wikidata with CONTAINS(), which is an unindexed scan of tens
  // of millions of rows: it timed out, returned [], and discovery reported
  // "no candidates" as though the business simply had no market. Matching
  // against the handful of forms a canonical URL actually takes is an index
  // hit instead, and it completes in well under a second.
  const bare = host.replace(/^www\./, "");
  const urlForms = [
    `https://${bare}/`, `https://${bare}`, `https://www.${bare}/`, `https://www.${bare}`,
    `http://${bare}/`, `http://${bare}`, `http://www.${bare}/`, `http://www.${bare}`,
  ];
  const byUrl = await sparql(`
    SELECT ?item ?itemLabel ?itemDescription ?site WHERE {
      VALUES ?site { ${urlForms.map((form) => `<${form}>`).join(" ")} }
      ?item wdt:P856 ?site.
      SERVICE wikibase:label { bd:serviceParam wikibase:language "en". }
    } LIMIT 30
  `);

  // Fallback: retrieve by NAME (cheap and indexed), then verify each hit's own
  // P856 against the target host. Retrieval by name alone is what resolved
  // "Zara" to a Spanish municipality; verifying the website afterwards keeps
  // the disambiguation exact while making the lookup affordable.
  let rows = byUrl;
  const viaName = rows.length === 0;
  if (viaName) {
    const search = await wikipedia<{ query?: { search?: Array<{ title?: string }> } }>({
      action: "query", list: "search", srsearch: bare.split(".")[0]!, srlimit: "8", srnamespace: "0", srprop: "",
    });
    const titles = (search?.query?.search ?? []).map((row) => row.title ?? "").filter(Boolean);
    if (titles.length > 0) {
      const props = await wikipedia<{ query?: { pages?: Array<{ title?: string; pageprops?: { wikibase_item?: string } }> } }>({
        action: "query", titles: titles.join("|"), prop: "pageprops", ppprop: "wikibase_item",
      });
      const qids = (props?.query?.pages ?? []).map((page) => page.pageprops?.wikibase_item).filter(Boolean) as string[];
      if (qids.length > 0) {
        rows = await sparql(`
          SELECT ?item ?itemLabel ?itemDescription ?site WHERE {
            VALUES ?item { ${qids.map((qid) => `wd:${qid}`).join(" ")} }
            ?item wdt:P856 ?site.
            SERVICE wikibase:label { bd:serviceParam wikibase:language "en". }
          } LIMIT 30
        `);
      }
    }
  }

  const ownedLabels = new Set<string>();
  const matches: Array<{ id: string; label: string; description: string; depth: number; host: string }> = [];
  for (const row of rows) {
    const id = row.item?.value?.split("/").pop();
    const label = row.itemLabel?.value ?? "";
    const site = row.site?.value ?? "";
    const siteHost = hostOf(site);
    // A country site ("nike.in") is not the recorded website of its brand
    // ("nike.com"), so exact matching resolved no entity and this source
    // returned nothing: a nike.in project got 8 candidates, all model guesses,
    // against 24 knowledge-graph rivals for nike.com. A name-search hit whose
    // own website has the same registrable name is the same business.
    const sameBusiness = siteHost === host || (viaName && siteHost !== null && registrableLabel(siteHost) === registrableLabel(host));
    if (!id || !label || !siteHost || !sameBusiness || /^Q\d+$/.test(label)) continue;
    ownedLabels.add(label.toLowerCase());
    let depth = 9;
    try {
      depth = new URL(/^https?:/.test(site) ? site : `https://${site}`).pathname.replace(/\/$/, "").split("/").filter(Boolean).length;
    } catch {
      depth = 9;
    }
    matches.push({ id, label, description: row.itemDescription?.value ?? "", depth, host: siteHost });
  }

  const orgish = (row: { description: string }) =>
    /compan|corporat|manufactur|retail|brand|business|enterprise|firm|bank|group|chain|airline|hotel|hospital|software|platform|agency|studio|clinic|restaurant/i.test(row.description)
      ? 0
      : 1;
  const organisation = matches.slice().sort((a, b) => orgish(a) - orgish(b) || a.depth - b.depth || a.label.length - b.label.length)[0];
  if (organisation) ownedLabels.delete(organisation.label.toLowerCase());

  // Sub-brands published on the target's own domain are found by the CONTAINS
  // form of the query, which is only affordable once we already have a host to
  // anchor it. It is optional: failure costs an exclusion list, not the run.
  if (organisation) {
    // Anchor on the organisation's own recorded site, which for a country
    // domain is the global one where its product lines are published.
    const anchor = organisation.host;
    const owned = await sparql(`
      SELECT ?itemLabel WHERE {
        ?item wdt:P856 ?site.
        FILTER(STRSTARTS(STR(?site), "https://www.${anchor}") || STRSTARTS(STR(?site), "https://${anchor}"))
        SERVICE wikibase:label { bd:serviceParam wikibase:language "en". }
      } LIMIT 40
    `);
    for (const row of owned) {
      const label = row.itemLabel?.value;
      if (label && !/^Q\d+$/.test(label) && label.toLowerCase() !== organisation.label.toLowerCase()) ownedLabels.add(label.toLowerCase());
    }
  }

  return {
    entity: organisation ? { id: organisation.id, label: organisation.label, description: organisation.description } : null,
    ownedLabels,
    matchedBy: organisation ? (viaName ? "name" : "url") : null,
  };
}

/** The English Wikipedia article an entity is linked to, if any. */
async function articleTitleForEntity(entityId: string): Promise<string | null> {
  const rows = await sparql(`
    SELECT ?article WHERE {
      ?article schema:about wd:${entityId} ; schema:isPartOf <https://en.wikipedia.org/> .
    } LIMIT 1
  `);
  const url = rows[0]?.article?.value;
  if (!url) return null;
  try {
    return decodeURIComponent(new URL(url).pathname.replace("/wiki/", "")).replace(/_/g, " ") || null;
  } catch {
    return null;
  }
}

/** Brands under the same corporate parent as the target — siblings, not rivals. */
async function siblingBrands(entityId: string): Promise<Set<string>> {
  const rows = await sparql(`
    SELECT ?siblingLabel WHERE {
      { wd:${entityId} wdt:P749 ?parent. } UNION { wd:${entityId} wdt:P127 ?parent. }
      { ?sibling wdt:P749 ?parent. } UNION { ?sibling wdt:P127 ?parent. }
      FILTER(?sibling != wd:${entityId})
      SERVICE wikibase:label { bd:serviceParam wikibase:language "en". }
    } LIMIT 120
  `);
  const out = new Set<string>();
  for (const row of rows) {
    const label = row.siblingLabel?.value;
    if (label && !/^Q\d+$/.test(label)) out.add(label.toLowerCase());
  }
  return out;
}

interface CategoriesResponse {
  query?: { pages?: Array<{ title?: string; categories?: Array<{ title?: string }> }> };
  continue?: Record<string, string>;
}

/** Category sets for a batch of article titles. Batched 40 at a time. */
async function categoriesOf(titles: string[]): Promise<Map<string, Set<string>>> {
  const out = new Map<string, Set<string>>();
  for (const title of titles) out.set(title, new Set());
  for (let i = 0; i < titles.length; i += 40) {
    const batch = titles.slice(i, i + 40);
    let cont: Record<string, string> = {};
    // A 40-title batch can exceed the category page size, so follow
    // continuation or the tail titles silently lose their categories and
    // score zero — which reads identically to "unrelated".
    for (let page = 0; page < 6; page++) {
      const body = await wikipedia<CategoriesResponse>({
        action: "query",
        titles: batch.join("|"),
        prop: "categories",
        cllimit: "max",
        clshow: "!hidden",
        ...cont,
      });
      if (!body) break;
      for (const entry of body.query?.pages ?? []) {
        if (!entry.title) continue;
        const set = out.get(entry.title) ?? new Set<string>();
        for (const category of entry.categories ?? []) {
          if (category.title) set.add(category.title.replace(/^Category:/, ""));
        }
        out.set(entry.title, set);
      }
      if (body.continue) cont = body.continue;
      else break;
    }
  }
  return out;
}

interface CategoryInfoResponse {
  query?: { pages?: Array<{ title?: string; categoryinfo?: { pages?: number; subcats?: number } }> };
}

/**
 * How many companies a category really covers, following one level of
 * subcategories.
 *
 * Wikipedia files international markets as CONTAINER categories: "Clothing
 * retailers" holds five pages directly and delegates the rest to "Clothing
 * retailers of Spain", "... of Sweden", "... of Japan" and so on. Counting
 * only the direct pages makes the broadest market in the taxonomy look like
 * the narrowest, and inverse-document-frequency then treats "clothing
 * retailers" as a razor-sharp signal — which is how an Israeli and a Canadian
 * apparel chain outranked H&M for Zara.
 */
async function categoryPopulation(name: string): Promise<number> {
  const info = await wikipedia<CategoryInfoResponse>({ action: "query", titles: `Category:${name}`, prop: "categoryinfo" });
  const own = info?.query?.pages?.[0]?.categoryinfo;
  let total = own?.pages ?? 0;
  if ((own?.subcats ?? 0) > 0) {
    const subs = await wikipedia<{ query?: { categorymembers?: Array<{ title?: string }> } }>({
      action: "query", list: "categorymembers", cmtitle: `Category:${name}`, cmtype: "subcat", cmlimit: "50",
    });
    const titles = (subs?.query?.categorymembers ?? []).map((row) => row.title ?? "").filter(Boolean);
    if (titles.length > 0) {
      const infos = await wikipedia<CategoryInfoResponse>({ action: "query", titles: titles.join("|"), prop: "categoryinfo" });
      for (const page of infos?.query?.pages ?? []) total += page.categoryinfo?.pages ?? 0;
    }
  }
  return Math.max(total, own?.pages ?? 0);
}

/** Article titles filed directly in a category. */
async function categoryMembers(category: string): Promise<string[]> {
  const body = await wikipedia<{ query?: { categorymembers?: Array<{ title?: string }> } }>({
    action: "query",
    list: "categorymembers",
    cmtitle: `Category:${category}`,
    cmlimit: "500",
    cmtype: "page",
    cmnamespace: "0",
  });
  return (body?.query?.categorymembers ?? []).map((member) => member.title ?? "").filter(Boolean);
}

/** Immediate subcategories of a category. */
async function subcategoriesOf(category: string): Promise<string[]> {
  const body = await wikipedia<{ query?: { categorymembers?: Array<{ title?: string }> } }>({
    action: "query", list: "categorymembers", cmtitle: `Category:${category}`, cmtype: "subcat", cmlimit: "50",
  });
  return (body?.query?.categorymembers ?? []).map((row) => (row.title ?? "").replace(/^Category:/, "")).filter(Boolean);
}

/** How many subcategories of a container category to descend into. */
const MAX_SUBCATEGORIES = 8;

/**
 * Members of a category INCLUDING one level of subcategories.
 *
 * Wikipedia files international markets as containers: "Clothing retailers"
 * holds five pages directly and delegates the rest to per-country
 * subcategories. Reading only the direct members is why a Spanish retailer's
 * candidate pool contained Spanish retailers and nothing else — Uniqlo,
 * Primark, Gap and Next were each one subcategory away and unreachable.
 */
async function expandedMembers(category: string): Promise<string[]> {
  const direct = await categoryMembers(category);
  const subcats = await subcategoriesOf(category);
  if (subcats.length === 0) return direct;
  const out = new Set(direct);
  // Descend into the subcategories that name the same market in another
  // place, not into "People associated with ..." style offshoots.
  const relevant = subcats.filter((name) => marketHead(name) === marketHead(category)).slice(0, MAX_SUBCATEGORIES);
  for (const name of relevant) {
    for (const title of await categoryMembers(name)) out.add(title);
  }
  return [...out];
}

/**
 * CirrusSearch `morelike:` — articles whose text is most similar to the
 * target's, by TF-IDF over the article index.
 *
 * This is the recall half of the design. Category membership is precise but
 * incomplete (Puma and New Balance carry almost no Wikidata classification),
 * while text similarity reaches any company written about in the same terms.
 */
async function morelike(title: string): Promise<string[]> {
  const body = await wikipedia<{ query?: { search?: Array<{ title?: string }> } }>({
    action: "query",
    list: "search",
    srsearch: `morelike:${title}`,
    srlimit: String(MORELIKE_LIMIT),
    srnamespace: "0",
    srprop: "",
  });
  return (body?.query?.search ?? []).map((row) => row.title ?? "").filter(Boolean);
}

/** Wikidata facts for a batch of article titles, joined via page properties. */
async function factsFor(titles: string[]): Promise<Map<string, EntityFacts>> {
  const out = new Map<string, EntityFacts>();
  for (let i = 0; i < titles.length; i += 45) {
    const batch = titles.slice(i, i + 45);
    const body = await wikipedia<{ query?: { pages?: Array<{ title?: string; pageprops?: { wikibase_item?: string } }> } }>({
      action: "query",
      titles: batch.join("|"),
      prop: "pageprops",
      ppprop: "wikibase_item",
    });
    const titleByQid = new Map<string, string>();
    for (const page of body?.query?.pages ?? []) {
      if (page.title && page.pageprops?.wikibase_item) titleByQid.set(page.pageprops.wikibase_item, page.title);
    }
    const qids = [...titleByQid.keys()];
    if (qids.length === 0) continue;
    const rows = await sparql(`
      SELECT ?item
             (GROUP_CONCAT(DISTINCT ?typeLabel; separator="|") AS ?types)
             (SAMPLE(?site) AS ?website)
             (COUNT(DISTINCT ?sitelink) AS ?sitelinks)
             (GROUP_CONCAT(DISTINCT ?ownerLabel; separator="|") AS ?owners)
             (GROUP_CONCAT(DISTINCT ?cc; separator="|") AS ?countries) WHERE {
        VALUES ?item { ${qids.map((qid) => `wd:${qid}`).join(" ")} }
        OPTIONAL { ?item wdt:P31 ?type. ?type rdfs:label ?typeLabel. FILTER(LANG(?typeLabel) = "en") }
        OPTIONAL { ?item wdt:P856 ?site. }
        OPTIONAL { ?sitelink schema:about ?item. }
        OPTIONAL { ?item wdt:P17/wdt:P297 ?cc. }
        OPTIONAL {
          { ?item wdt:P127 ?owner. } UNION { ?item wdt:P749 ?owner. }
          ?owner rdfs:label ?ownerLabel. FILTER(LANG(?ownerLabel) = "en")
        }
      } GROUP BY ?item
    `);
    for (const row of rows) {
      const qid = row.item?.value?.split("/").pop();
      const title = qid ? titleByQid.get(qid) : undefined;
      if (!qid || !title) continue;
      let website: string | null = null;
      if (row.website?.value) website = hostOf(row.website.value);
      out.set(title, {
        qid,
        types: (row.types?.value ?? "").split("|").filter(Boolean),
        website,
        sitelinks: Number(row.sitelinks?.value ?? 0),
        owners: (row.owners?.value ?? "").split("|").filter(Boolean),
        countryCodes: countryCodesOf(row.countries?.value),
      });
    }
  }
  return out;
}

/** P297 values are alpha-2 already; tolerate alpha-3 and junk. */
function countryCodesOf(value: string | undefined): string[] {
  const out: string[] = [];
  for (const raw of (value ?? "").split("|")) {
    const trimmed = raw.trim();
    const code = isCountryCode(trimmed) ? trimmed.toUpperCase() : trimmed.length === 3 ? alpha2FromAlpha3(trimmed) : null;
    if (code && !out.includes(code)) out.push(code);
  }
  return out;
}

// --- Target knowledge (shared per discovery run) -----------------------------

export interface TargetKnowledge extends TargetKnowledgeFacts {
  articleTitle: string | null;
  owners: string[];
  ownedLabels: Set<string>;
}

const NO_KNOWLEDGE: TargetKnowledge = { entity: null, matchedBy: null, sitelinks: 0, countryCodes: [], articleTitle: null, owners: [], ownedLabels: new Set() };

/**
 * The target's own encyclopedic entity, article and facts.
 *
 * The known-brand signal and this source need the same lookups. Resolving it
 * once per run and sharing the promise keeps Wikimedia calls where they were
 * (they are throttled and rate-limited) instead of doubling them.
 */
export async function resolveTargetKnowledge(domain: string): Promise<TargetKnowledge> {
  const resolution = await resolveByDomain(domain).catch(() => ({ entity: null, ownedLabels: new Set<string>(), matchedBy: null }) as DomainResolution);
  if (!resolution.entity) return { ...NO_KNOWLEDGE, ownedLabels: resolution.ownedLabels };
  const articleTitle = await articleTitleForEntity(resolution.entity.id).catch(() => null);
  const facts = articleTitle ? (await factsFor([articleTitle]).catch(() => new Map<string, EntityFacts>())).get(articleTitle) ?? null : null;
  return {
    entity: resolution.entity,
    matchedBy: resolution.matchedBy ?? null,
    sitelinks: facts?.sitelinks ?? 0,
    countryCodes: facts?.countryCodes ?? [],
    articleTitle,
    owners: facts?.owners ?? [],
    ownedLabels: resolution.ownedLabels,
  };
}

export interface TargetKnowledgeResolver {
  resolve(domain: string): Promise<TargetKnowledge>;
}

/** One lookup per domain for the lifetime of the returned resolver (one discovery run). */
export function createTargetKnowledgeMemo(resolver: (domain: string) => Promise<TargetKnowledge> = resolveTargetKnowledge): TargetKnowledgeResolver {
  const cache = new Map<string, Promise<TargetKnowledge>>();
  return {
    resolve(domain: string) {
      const key = domain.trim().toLowerCase();
      let pending = cache.get(key);
      if (!pending) {
        pending = resolver(domain).catch(() => NO_KNOWLEDGE);
        cache.set(key, pending);
      }
      return pending;
    },
  };
}

// --- Gates ------------------------------------------------------------------

/** Things that are classifications or works, never tradeable businesses. */
const NON_BUSINESS_HINT =
  /\b(list of|category|wikimedia|disambiguation|index of|timeline|history of|association|federation|regulator|ministry|government|museum|award|championship|league|tournament|stadium)\b/i;

/** P31 values that mark a product rather than the company that sells it. */
const PRODUCT_TYPE = /\b(shoe model|product|model|logo|slogan|trademark|advertising|campaign|film|album|song|video game|book|magazine|website)\b/i;

/** P31 values that mark an organisation. */
const ORG_TYPE =
  /\b(business|company|enterprise|corporation|organization|organisation|retail chain|manufacturer|brand|public company|conglomerate|subsidiary|holding|cooperative|partnership|bank|airline|hospital|university|restaurant|hotel|chain)\b/i;

/** P31 values that mark a retailer/marketplace rather than a maker. */
const RETAILER_TYPE = /\b(retail chain|retailer|e-commerce|online marketplace|marketplace|department store|supermarket|chain store)\b/i;

// --- The source -------------------------------------------------------------

export class OpenKnowledgeCandidateSource implements CompetitorCandidateSource {
  readonly sourceType = "open_knowledge" as const;

  private readonly knowledge: TargetKnowledgeResolver;

  constructor(options: { knowledge?: TargetKnowledgeResolver } = {}) {
    this.knowledge = options.knowledge ?? createTargetKnowledgeMemo();
  }

  async discover(profile: CompetitiveSearchProfile): Promise<CompetitorCandidate[]> {
    // Encyclopedic category neighbours are worldwide and country-level by
    // nature, so this source only feeds a country tier. A neighbourhood salon
    // has no entity anyway.
    const plan = planFromSearchProfile(profile);
    const countryTier = plan.tiers.find((spec) => spec.tier === "country") ?? null;
    if (plan.tiers.length > 0 && !countryTier) return [];
    // A known local brand's worldwide category neighbours are not its rivals:
    // a famous restaurant's Wikidata category holds restaurants on every
    // continent. Those plans keep only candidates in the target's country.
    const countryFilter = countryTier && countryTier.level !== "global" && hasLocalTier(plan) ? countryTier.countryCodes : null;
    const planCountryCodes = countryTier?.countryCodes ?? [];

    const knowledge = await this.knowledge.resolve(profile.canonicalDomain).catch(() => NO_KNOWLEDGE);
    // No encyclopedic entity means this source has nothing to say. It returns
    // [] rather than guessing, and the other sources carry the run.
    if (!knowledge.entity) return [];
    const resolution: DomainResolution = { entity: knowledge.entity, ownedLabels: knowledge.ownedLabels, matchedBy: knowledge.matchedBy };

    const articleTitle = knowledge.articleTitle;
    if (!articleTitle) return [];
    const siblings = await siblingBrands(knowledge.entity.id).catch(() => new Set<string>());

    const brandWord = new RegExp(`\\b${profile.targetBrand.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\b`, "i");

    // The corporate family the target belongs to. A sibling brand under the
    // same parent is not an alternative to the target — recommending Bershka
    // as a competitor of Zara reports Inditex competing with itself.
    const targetFacts = { owners: knowledge.owners };
    const familyOwners = new Set((targetFacts?.owners ?? []).map(normalizeName));

    const excluded = new Set<string>(
      [...resolution.ownedLabels, ...siblings, profile.targetBrand, articleTitle, ...(targetFacts?.owners ?? [])].map(normalizeName),
    );

    // 1. The target's own category signature.
    const targetCategories = [...((await categoriesOf([articleTitle])).get(articleTitle) ?? [])];
    // A category named after the target OR after its corporate parent lists
    // the family, not the market: "Inditex brands" contains only Zara's own
    // siblings, and using it as a market signature made every sibling look
    // like a perfect competitor.
    const familyWords = [profile.targetBrand, ...(targetFacts?.owners ?? [])].filter(Boolean);
    const isFamilyCategory = (name: string) =>
      familyWords.some((word) => new RegExp(`\\b${word.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\b`, "i").test(name));
    const marketCategories = targetCategories.filter(
      (name) => MARKET_CATEGORY.test(name) && !NON_MARKET_CATEGORY.test(name) && !brandWord.test(name) && !isFamilyCategory(name),
    );
    if (marketCategories.length === 0) return [];

    // 2. Category sizes, which are both the IDF weights and the pool budget.
    const sized: Array<{ name: string; size: number; members: string[] }> = [];
    for (const name of marketCategories) {
      const members = await categoryMembers(name);
      sized.push({ name, size: members.length, members });
    }
    // Tightest first: a small category is a sharper market definition, and it
    // is also the one whose members are worth spending the pool budget on.
    sized.sort((a, b) => a.size - b.size);

    // Recall repair: for a geographically-scoped category, the unscoped head
    // ("Clothing retailers") is where the target's international rivals are
    // filed. Without this the pool for a Spanish retailer contains only
    // Spanish retailers, and H&M is unreachable no matter how it is scored.
    const headTitles = [...new Set(sized.filter((row) => isGeoScoped(row.name)).map((row) => marketHead(row.name)))]
      .map((head) => head.charAt(0).toUpperCase() + head.slice(1))
      .filter((title) => !sized.some((row) => row.name === title));
    for (const title of headTitles) {
      const members = await expandedMembers(title);
      if (members.length > 0) sized.push({ name: title, size: members.length, members });
    }
    sized.sort((a, b) => a.size - b.size);

    // Round-robin the pool budget across the signature instead of filling it
    // from the tightest category down. Filling greedily let one large category
    // consume the whole budget — for a fashion retailer "Shoe brands" [210]
    // crowded out every apparel category, so the pool was footwear and the
    // apparel rivals were never scored at all.
    const contributing = sized.filter((row) => row.size > 0 && row.size <= MAX_CATEGORY_SIZE * 2);
    const pool = new Set<string>();
    for (let index = 0; pool.size < POOL_CAP; index++) {
      let added = false;
      for (const category of contributing) {
        const member = category.members[index];
        if (member === undefined) continue;
        pool.add(member);
        added = true;
        if (pool.size >= POOL_CAP) break;
      }
      if (!added) break;
    }

    // 3. Text-similarity neighbours, for recall the category graph misses.
    const textual = await morelike(articleTitle);
    for (const title of textual) pool.add(title);
    const textualRank = new Map(textual.map((title, index) => [title, index]));

    const candidates = [...pool]
      .filter((title) => !excluded.has(normalizeName(title)) && !brandWord.test(title) && !NON_BUSINESS_HINT.test(title))
      .slice(0, POOL_CAP + MORELIKE_LIMIT);
    if (candidates.length === 0) return [];

    // 4. Enrich in two passes, cheapest-discriminator first.
    //
    //    Wikidata facts settle "is this a tradeable business at all", which
    //    removes roughly a third of any category listing (product articles,
    //    stubs, defunct names). Fetching categories only for the survivors is
    //    the single biggest cost saving in this module, because the category
    //    endpoint is the one that has to paginate.
    const facts = await factsFor(candidates);
    const viable = candidates.filter((title) => {
      const fact = facts.get(title);
      if (!fact?.qid || !fact.website) return false;
      const typeText = fact.types.join(" ").toLowerCase();
      if (PRODUCT_TYPE.test(typeText) && !ORG_TYPE.test(typeText)) return false;
      if (NON_BUSINESS_HINT.test(typeText)) return false;
      if (fact.owners.some((owner) => brandWord.test(owner) || excluded.has(normalizeName(owner)))) return false;
      // Shares a corporate parent with the target: a sibling, not a rival.
      if (familyOwners.size > 0 && fact.owners.some((owner) => familyOwners.has(normalizeName(owner)))) return false;
      if (countryFilter && fact.countryCodes.length > 0 && !fact.countryCodes.some((code) => countryFilter.includes(code))) return false;
      return true;
    });
    if (viable.length === 0) return [];
    const categoryMap = await categoriesOf(viable);

    // 5. Score.
    //
    //    The signature is a weighted set of MARKET HEADS, not raw category
    //    strings. Each head's weight is inverse-log of how many companies are
    //    filed under it — sharing "Athletic shoe brands" (79 members) is much
    //    stronger evidence than sharing "Shoe brands" (210) — and a
    //    geographically scoped category is damped, because being Spanish
    //    narrows the population without narrowing the buying decision.
    const GEO_DAMPING = 0.55;
    const signatureNames = [...marketCategories, ...headTitles];
    // Population is measured on the HEAD, because that is what candidates are
    // matched on. Measuring it on the national variant would score "clothing
    // retailers" as a 12-company market.
    const headNames = [...new Set(signatureNames.map(marketHead))];
    const populations = new Map<string, number>();
    for (const head of headNames) {
      const title = head.charAt(0).toUpperCase() + head.slice(1);
      populations.set(head, await categoryPopulation(title).catch(() => 300));
    }
    const headWeights = new Map<string, number>();
    // Heads the target holds through an UNSCOPED category. A head reached only
    // through a geographic variant ("Software companies of the United States")
    // carries almost no market information: every software company on earth
    // sits in some national software-companies category, so matching on it
    // says only "also makes software somewhere". Tracking the two separately
    // lets a candidate be required to share real market vocabulary.
    const specificHeads = new Set<string>();
    for (const name of signatureNames) {
      const head = marketHead(name);
      const population = Math.max(populations.get(head) ?? 300, sized.find((row) => row.name === name)?.size ?? 0);
      const weight = (1 / Math.log(2 + population)) * (isGeoScoped(name) ? GEO_DAMPING : 1);
      headWeights.set(head, Math.max(headWeights.get(head) ?? 0, weight));
      // Only the target's OWN unscoped categories name its market. The recall
      // repair adds the unscoped head of every scoped category ("Software
      // companies" from "Software companies of the United States"), and that
      // head counted as specific, so every software company on Wikipedia was a
      // "market neighbour" of an API platform (UiPath, Notion, ClickUp, F5 at
      // confidence 80+). A head the size of a directory says nothing either.
      if (!isGeoScoped(name) && marketCategories.includes(name) && population <= MAX_CATEGORY_SIZE) specificHeads.add(head);
    }
    // With no market category of its own the target has no encyclopedic
    // market to read; text similarity alone lists companies that merely write
    // about software. The other sources carry the run.
    if (specificHeads.size === 0) return [];
    const signatureDenominator = [...headWeights.values()].reduce((sum, weight) => sum + weight, 0) || 1;
    

    const rows: Array<{ candidate: CompetitorCandidate; total: number }> = [];
    const maxSitelinksViable = Math.max(1, ...viable.map((title) => facts.get(title)?.sitelinks ?? 0));
    for (const title of viable) {
      const fact = facts.get(title)!;
      const typeText = fact.types.join(" ").toLowerCase();
      if (hostOf(profile.canonicalDomain) && fact.website === hostOf(profile.canonicalDomain)) continue;

      const candidateCategories = categoryMap.get(title) ?? new Set<string>();
      const candidateHeads = new Set([...candidateCategories].map(marketHead));
      const sharedHeads = [...headWeights.keys()].filter((head) => candidateHeads.has(head));
      const signature = sharedHeads.reduce((sum, head) => sum + (headWeights.get(head) ?? 0), 0) / signatureDenominator;
      const shared = [...candidateCategories].filter((name) => headWeights.has(marketHead(name)));
      const prominence = Math.log1p(fact.sitelinks) / Math.log1p(maxSitelinksViable);
      const textualScore = textualRank.has(title) ? 1 - textualRank.get(title)! / MORELIKE_LIMIT : 0;
      // A candidate with neither a shared category nor a text-similarity hit
      // has no evidence at all behind it, only a website.
      if (signature === 0 && textualScore === 0) continue;
      // Geography alone is not a market. A candidate whose entire overlap with
      // the target runs through nationally-scoped categories is weak evidence:
      // an Israeli security vendor and an Oregon messaging company are not
      // competitors of a CRM merely because all three are filed as software
      // companies somewhere.
      //
      // This is a PENALTY rather than a hard drop. Dropping them outright also
      // removed real rivals in markets where the national category IS the
      // market — a UK bank's peers are filed under "Banks of the United
      // Kingdom" — costing more recall than the precision was worth.
      const sharesSpecificHead = sharedHeads.some((head) => specificHeads.has(head));
      const GEO_ONLY_PENALTY = 0.62;
      const total = (signature * 0.45 + prominence * 0.2 + textualScore * 0.35) * (sharesSpecificHead ? 1 : GEO_ONLY_PENALTY);
      // "Software companies based in Seattle" plus a weak text-similarity rank
      // is how F5, Sauce Labs, UiPath and Notion reached an API platform's
      // candidate pool at confidence 57–87. Without a real market category in
      // common, only a strong text neighbour (top ten) is worth proposing, and
      // it is proposed as a hypothesis (capped confidence), not a finding.
      if (!sharesSpecificHead && textualScore < 0.8) continue;

      const displayName = title.replace(/\s*\([^)]*\)\s*$/, "").trim();
      if (!displayName || brandWord.test(displayName)) continue;

      const isRetailer = RETAILER_TYPE.test(typeText);
      // The plan's country when the entity lists it. Wikidata's country order
      // is arbitrary, so a [US, AE] entity kept by the country filter was
      // located in the United States and then rejected as outside Dubai.
      const locationCode = fact.countryCodes.find((code) => planCountryCodes.includes(code)) ?? fact.countryCodes[0] ?? null;
      const reasonParts: string[] = [];
      if (shared.length > 0) reasonParts.push(`shares ${shared.length} of ${profile.targetBrand}'s market categories (${shared.slice(0, 3).join("; ")})`);
      if (textualScore > 0) reasonParts.push(`ranked #${(textualRank.get(title) ?? 0) + 1} by article text similarity to ${profile.targetBrand}`);
      if (fact.sitelinks > 0) reasonParts.push(`covered in ${fact.sitelinks} language editions`);

      rows.push({
        total,
        candidate: {
          canonicalName: displayName,
          likelyDomain: fact.website,
          // A retailer competes for the same purchase but is not a peer maker;
          // the role model already distinguishes the two, so say which it is
          // rather than proposing everything as "direct".
          proposedType: isRetailer ? "marketplace" : "direct",
          entityType: "company",
          parentName: fact.owners[0] ?? null,
          reason: `${reasonParts.join(", ")}.`,
          matchedDimensions: shared.length > 0 ? shared.slice(0, 4) : ["article text similarity"],
          // Confidence is the structural score expressed on the 0-100 scale
          // the rest of the pipeline speaks, floored so a real hit is never
          // indistinguishable from noise and capped because this is still a
          // suggestion awaiting operator confirmation.
          // Capped below a verified search result (72 minus rank): an
          // encyclopedic neighbour is a hypothesis about the market, and it
          // must not outrank the rivals a buyer's own searches return.
          confidence: Math.max(30, Math.min(sharesSpecificHead ? 68 : 46, Math.round(30 + total * 62))),
          structuralAffinity: Math.round(Math.min(1, total) * 100),
          evidence: [
            {
              source: "open_knowledge" as const,
              reason: `${reasonParts.join(", ")}.`,
              evidenceIds: [],
              discoveredAt: Date.now(),
            },
          ],
          aliases: [],
          ...(locationCode ? { location: { area: null, city: null, country: countryName(locationCode) ?? locationCode } } : {}),
          tierHint: [{ tier: "country", source: "open_knowledge" }],
        },
      });
    }

    rows.sort((a, b) => b.total - a.total);
    const top = rows.slice(0, MAX_SUGGESTIONS);
    return top.map((row) => row.candidate);
  }
}
