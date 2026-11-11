// Mention detection and entity linking.
//
// Follows the standard two-step formulation from the entity-linking
// literature: detect candidate mentions, then disambiguate each to a known
// entity — rather than treating "the brand string occurs" as the finding.
//
// The link target set is the project's own confirmed entities plus their
// aliases and stored product/sub-brand children. Nothing is inferred from a
// hardcoded brand list, so the same code resolves "Sales Cloud" to Salesforce
// or "Bonvoy" to Marriott exactly when the project recorded that relationship,
// and declines to guess when it did not.

import { isBusinessTypeWord, shortNameForms } from "@/lib/landscape/name-forms";
import type { Entity } from "@/lib/landscape/repository";
import type { Confidence, EntityRelation, Span, SurfaceForm } from "./types";

export interface LinkTarget {
  entityId: string;
  /** Display name of the entity this surface resolves to. */
  canonicalName: string;
  relation: EntityRelation;
  /** The literal string to look for. */
  surface: string;
  surfaceForm: SurfaceForm;
  /** Set when `surface` is a product resolved up to a parent brand. */
  productSurface: string | null;
  /**
   * Set for a shorter name derived from the recorded one ("Brooks" for "Brooks
   * Sports"). It counts only when written as a proper noun, so "babbling
   * brooks" is not a mention of a shoe company.
   */
  requiresCapital?: boolean;
}

export interface DetectedMention {
  entityId: string | null;
  name: string;
  relation: EntityRelation;
  surfaceForm: SurfaceForm;
  productSurface: string | null;
  span: Span;
  confidence: Confidence;
}

/**
 * A coded name before business-type words stands for the business in answers:
 * "Y12 Salon" is written "Y12 Hair Salon" and "Y12", and the tracked rival
 * showed 0 of 10 Discovery answers while "Y12 Hair Salon" was listed as an
 * untracked brand in 4 of them (2026-09-18). Only a head that mixes letters
 * and digits qualifies ("Y12", "B612"), because such a token does not
 * occur as an ordinary word. Link-only: prompts keep the recorded name
 * (landscape/name-forms.ts `spokenName` is unchanged).
 */
export function codedHeadForms(canonicalName: string): string[] {
  const tokens = canonicalName.trim().split(/\s+/).filter(Boolean);
  if (tokens.length < 2) return [];
  const head = tokens[0]!;
  const coded = /^[A-Za-z0-9&]{3,}$/.test(head) && /\d/.test(head) && /[A-Za-z]/.test(head);
  const tail = tokens.slice(1).map((token) => token.replace(/[^A-Za-zé]/g, ""));
  if (!coded || !tail.every((token) => token && isBusinessTypeWord(token))) return [];
  return [head];
}

/**
 * Leading parts of a name that stand for the business inside a head-to-head
 * answer. A Trade Off question names the target and one rival, and the answer
 * writes them the short way: "1847" for "1847 Executive Grooming for Men DIFC",
 * "Chaps & Co" for "Chaps & Co DIFC". Neither is safe in every answer, but in
 * the answer to that question they can only mean that business (2026-10-15:
 * three of ten Trade Off answers read as "didn't compare them" because the
 * rival was never linked). One word stands alone only when it cannot be an
 * ordinary word: it carries a digit or has six letters ("Tips" for "Tips &
 * Toes" does not).
 */
export function headToHeadForms(canonicalName: string): string[] {
  const tokens = canonicalName.trim().split(/\s+/).filter(Boolean);
  const forms: string[] = [];
  for (let keep = tokens.length - 1; keep >= 1; keep -= 1) {
    const kept = tokens.slice(0, keep);
    while (kept.length > 0 && /^(?:&|and|of|for|the|a|an|[-–—|:])$/i.test(kept.at(-1)!)) kept.pop();
    const words = kept.filter((token) => !/^(?:the|a|an|&|and)$/i.test(token));
    if (words.length === 0 || words.every((token) => isBusinessTypeWord(token.replace(/[^A-Za-zé]/g, "")))) continue;
    if (words.length === 1 && !/\d/.test(words[0]!) && words[0]!.replace(/[^A-Za-z]/g, "").length < 6) continue;
    const head = kept.join(" ");
    if (head.replace(/[^A-Za-z0-9]/g, "").length < 3 || forms.includes(head)) continue;
    forms.push(head);
  }
  return forms;
}

function escapeRegex(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/**
 * Builds the link inventory from project entities.
 *
 * A product/sub-brand entity resolves to ITS PARENT for relation purposes,
 * while remembering the product string that was actually written — the two
 * facts are different evidence and Measure may want to weigh them differently.
 */
export function buildLinkTargets(entities: Entity[], aliasesByEntity: Map<string, string[]>, extraFormsByEntity: Map<string, string[]> = new Map()): LinkTarget[] {
  const byId = new Map(entities.map((e) => [e.id, e]));
  const targets: LinkTarget[] = [];

  const relationFor = (entity: Entity, parent: Entity | null): EntityRelation => {
    const root = parent ?? entity;
    if (root.kind === "target") return parent ? "target_product" : "target";
    if (root.kind === "competitor") return parent ? "competitor_product" : "confirmed_competitor";
    if (root.kind === "emerging") return "emerging";
    return "unknown";
  };

  for (const entity of entities) {
    const parent = entity.parentEntityId ? (byId.get(entity.parentEntityId) ?? null) : null;
    const isProduct = Boolean(parent) || ["sub_brand", "product_line"].includes(entity.entityType);
    const resolvesTo = parent ?? entity;
    const relation = relationFor(entity, parent);

    // Answers usually write a company by its shorter name ("Brooks" for
    // "Brooks Sports"); matching only the recorded name left five of sixty
    // Nike answers' Brooks mentions uncounted. Products keep their recorded names.
    const derived = isProduct ? [] : [...shortNameForms(entity.canonicalName, [entity.canonicalDomain, ...(entity.domains ?? [])]), ...codedHeadForms(entity.canonicalName), ...(extraFormsByEntity.get(entity.id) ?? [])];
    // "Nikes" and "Reeboks" name the brand as plainly as the singular, and an
    // answer that only says "swear by their Nikes" was missing the target.
    const name = entity.canonicalName.trim();
    const plural = !isProduct && !/\s/.test(name) && !/s$/i.test(name) && name.length >= 4 ? [`${name}s`] : [];
    // "Artistic Trendz Hair and Beauty Salon" is the tracked "Artistic Trendz
    // Hair & Beauty Salon": answers write the ampersand either way, and the
    // other spelling was counted as an untracked business (observation-analysis@18).
    const recorded = [entity.canonicalName, ...(aliasesByEntity.get(entity.id) ?? [])];
    const ampersand = isProduct
      ? []
      : recorded.flatMap((surface) => (/\s&\s/.test(surface) ? [surface.replace(/\s&\s/g, " and ")] : /\sand\s/.test(surface) ? [surface.replace(/\sand\s/g, " & ")] : []));
    const surfaces = [
      ...recorded.map((surface) => ({ surface, requiresCapital: false })),
      ...[...derived, ...plural, ...ampersand].map((surface) => ({ surface, requiresCapital: true })),
    ];
    const seen = new Set<string>();
    for (const { surface, requiresCapital } of surfaces) {
      const trimmed = surface.trim();
      // Two characters is too short to disambiguate anything; such a "brand"
      // matches inside ordinary words and poisons precision.
      if (trimmed.length < 3 || seen.has(trimmed.toLowerCase())) continue;
      seen.add(trimmed.toLowerCase());
      targets.push({
        entityId: resolvesTo.id,
        canonicalName: resolvesTo.canonicalName,
        relation,
        surface: trimmed,
        surfaceForm: isProduct ? "product_of" : trimmed.toLowerCase() === entity.canonicalName.toLowerCase() ? "exact_name" : "alias",
        productSurface: isProduct ? trimmed : null,
        requiresCapital,
      });
    }
  }

  // Longest surface first so "Nike Air Max" wins over the bare "Nike" at the
  // same offset, and the more specific evidence is the one recorded.
  return targets.sort((a, b) => b.surface.length - a.surface.length);
}

/**
 * Finds every linked mention, longest-match-wins, without overlaps.
 */
export function detectMentions(text: string, targets: LinkTarget[]): DetectedMention[] {
  const claimed: Array<[number, number]> = [];
  const mentions: DetectedMention[] = [];

  const overlaps = (start: number, end: number) => claimed.some(([s, e]) => start < e && end > s);

  for (const target of targets) {
    // Answers write "Gold’s Gym" with a curly apostrophe and "New Balance" with a
    // no-break space; the recorded name has a straight apostrophe and a plain space.
    const pattern = new RegExp(`\\b${escapeRegex(target.surface).replace(/['’]/g, "['’]").replace(/ +/g, "\\s+")}\\b`, "gi");
    for (const match of text.matchAll(pattern)) {
      const start = match.index!;
      const end = start + match[0].length;
      // A digit start ("1847") is never an ordinary lower-case word either.
      if (target.requiresCapital && !/^[A-Z0-9]/.test(match[0])) continue;
      if (overlaps(start, end)) continue;
      claimed.push([start, end]);

      mentions.push({
        entityId: target.entityId,
        name: target.canonicalName,
        relation: target.relation,
        surfaceForm: target.surfaceForm,
        productSurface: target.productSurface,
        span: { start, end, text: match[0] },
        confidence: confidenceForMatch(text, start, end, target),
      });
    }
  }

  return mentions.sort((a, b) => a.span.start - b.span.start);
}

/**
 * How much to trust one surface match.
 *
 * The risk case is a short brand name that is also a common word or the head
 * of a different company's name — "Puma" inside "Puma Energy", "Apollo" inside
 * "Apollo Tyres". When a matched brand token is immediately followed by
 * another capitalised token that is not part of the matched surface, the match
 * may belong to a different organisation, so it is recorded as weak rather
 * than dropped: suppressing it silently would cost recall with no trace.
 */
/**
 * Words that turn a brand token into a DIFFERENT organisation's name.
 *
 * These are the corporate and industry designators that actually create the
 * ambiguity: "Puma Energy" is an oil company, "Apollo Tyres" is not Apollo
 * Hospitals. A following capitalised word that is not one of these is
 * overwhelmingly the brand's own product ("Nike LeBron 19", "Adidas Dame 7",
 * "ASICS Gel-Kayano") — which is the STRONGEST evidence of brand presence
 * there is, not a reason to doubt it.
 */
const ORGANISATION_DESIGNATOR =
  /^(energy|motors?|tyres?|tires?|bank|banking|group|holdings?|systems?|technologies|technology|industries|industrial|pharma|pharmaceuticals?|foods?|airlines?|airways|hospital|hospitals|healthcare|capital|ventures?|partners?|labs?|laboratories|corp|corporation|inc|llc|ltd|limited|plc|gmbh|ag|sa|nv|bv|insurance|realty|properties|mining|steel|cement|chemicals?|logistics|shipping|freight|media|entertainment|studios?|records?|publishing|university|college|school|church|foundation|institute|society|association)$/i;

function confidenceForMatch(text: string, start: number, end: number, target: LinkTarget): Confidence {
  const base: Confidence = target.surfaceForm === "exact_name" ? "exact" : "strong";
  const following = text.slice(end, end + 24);
  const trailingProper = /^\s+([A-Z][A-Za-z]{2,})/.exec(following);
  const multiWordSurface = target.surface.includes(" ");
  if (!trailingProper || multiWordSurface) return base;

  const continuation = trailingProper[1]!;
  // Only a corporate/industry designator is evidence of a different company.
  // The previous rule treated EVERY following capitalised word as suspicious,
  // so in exactly the answers this product exists to measure — recommendation
  // answers, where brands appear as "Nike LeBron 19" — every mention was
  // downgraded, which then cascaded into whole observations being discarded.
  return ORGANISATION_DESIGNATOR.test(continuation) ? "weak" : base;
}

// ---------------------------------------------------------------------------
// Emerging entities
// ---------------------------------------------------------------------------

/**
 * Brand-like strings that resolved to nothing known.
 *
 * These never enter a denominator and never join the frozen competitive set.
 * They exist so a repeatedly-recommended untracked brand becomes visible as a
 * suggestion for the NEXT competitive-set version, which is a product decision
 * a person makes — not something an analysis run may do to a frozen run.
 */
const SENTENCE_START_STOPWORDS = new Set([
  "The", "These", "Those", "This", "That", "There", "They", "Their", "It", "Its", "If", "For", "But", "And", "Or", "So",
  "However", "Both", "Neither", "Either", "Many", "Most", "Some", "Several", "Other", "Overall", "According", "Consider",
  "Popular", "Sources", "Based", "While", "When", "Where", "What", "Which", "Who", "Why", "How", "You", "Your", "Here",
  "I", "My", "We", "Our", "In", "On", "At", "As", "Also", "Additionally", "Finally", "First", "Second", "Third", "Alternatively",
  // Sentence-initial imperatives and discourse verbs. "Look at ASICS instead"
  // proposed "Look" as an emerging brand.
  "Look", "Check", "Try", "Go", "Choose", "Pick", "Avoid", "Note", "Remember", "Keep", "Make", "Take", "See", "Read", "Ask",
  "Use", "Visit", "Compare", "Start", "Skip", "Stick", "Opt", "Aim", "Expect", "Depending", "Whether", "Given", "Unless",
  "Not", "No", "Yes", "Instead", "Otherwise", "Meanwhile", "Similarly", "Likewise", "Therefore", "Because", "Since", "Though",
]);

/** Capitalised token runs — a cheap, language-appropriate proper-noun proxy. */
const PROPER_RUN = /\b([A-Z][A-Za-z0-9&'’.-]*(?:[ \t\u00a0]+[A-Z][A-Za-z0-9&'’.-]*){0,3})\b/g;

/**
 * What the answer is about, so an untracked name is proposed only when it is
 * a business of the measured kind. A Dubai gym's answers listed JVC, Dubai
 * Marina, Al Quoz and Nakheel Mall as "brands", along with "CrossFit-style",
 * "Motor City. A", "Wednesday" and "AED" (feedback 2026-09-16); a second pass
 * still showed landmarks in comma lists, cited source sites ("AE Profile",
 * "Iron Passport") and the gym's own short name "Warehouse". Across every
 * project a global brand's answers added product lines ("Pegasus 40", "Nike
 * Dri-FIT"), athletes, retailers and technologies, and restaurants added
 * neighbourhoods, cuisines and dishes.
 */
export interface EmergingContext {
  /** Places the project knows: its own areas, city, branches, nearby areas, countries, prompt places. */
  places: string[];
  /** Words that name the kind of business and what it sells ("gym", "fitness", "pilates", "restaurant"). */
  categoryTerms: string[];
  /** Recorded names of the tracked entities, so "Warehouse CrossFit" is not a new brand beside "The Warehouse Gym". */
  trackedNames?: string[];
  /** Product and line names learned across the run's answers ("Nike Pegasus 40" makes "Pegasus" a Nike product in every answer). */
  productForms?: string[];
}

/** Words no business is called, capitalised by convention: weekdays, months, currencies, holidays, sale days. */
const CALENDAR_AND_UNITS = /^(?:Monday|Tuesday|Wednesday|Thursday|Friday|Saturday|Sunday|January|February|March|April|May|June|July|August|September|October|November|December|Mon|Tue|Wed|Thu|Fri|Sat|Sun|Jan|Feb|Mar|Apr|Jun|Jul|Aug|Sep|Sept|Oct|Nov|Dec|AED|USD|EUR|GBP|SAR|INR|AM|PM|Q[1-4]|FAQ|FAQs|PS|TL;DR|U\.S\.?A?|U\.K\.?|U\.A\.E\.?|Black Friday|Cyber Monday|Prime Day|Christmas|Diwali|Ramadan|Eid|New Year|Boxing Day|Singles Day|Valentine['’]s Day|Mother['’]s Day|Father['’]s Day|Easter|Thanksgiving|Halloween)$/i;
/** Fragments of an ordinary sentence that the proper-noun run picks up ("Local Gyms And", "Another", "Dedicated"). */
const SENTENCE_FRAGMENT_WORDS = new Set(["a", "an", "the", "and", "or", "but", "there", "another", "multiple", "dedicated", "local", "various", "several", "best", "top", "new", "great", "good", "more", "less", "also", "plus", "with", "without", "near", "nearby", "across", "around", "olympic", "premium", "luxury", "budget", "affordable", "popular", "modern", "traditional", "authentic", "classic", "signature", "professional", "certified", "international", "convenient", "better", "cheap", "cheaper", "expensive", "open", "opens", "big", "small", "large", "huge", "easy", "hard", "fast", "clean", "friendly", "quiet", "busy", "central", "mixed", "monthly", "yearly", "daily", "weekly", "morning", "evening", "weekend", "private", "virtual", "hybrid", "flexible", "quick", "simple", "free", "only", "just", "own", "part", "end", "back", "are", "called", "used", "going", "select", "basic", "standard", "ultimate", "advantage", "beyond", "move", "zero", "everyday", "clear", "regular", "special", "original", "essential", "essentials", "extra", "limited", "exclusive", "official", "current", "latest", "upcoming", "pending", "during", "before", "after", "casual", "fine", "upscale", "upmarket", "for", "that", "which", "who", "what", "how", "why", "to", "of", "in", "at", "by", "on", "vs", "won", "lost", "closed", "contacted", "qualified", "sent", "automatic", "manual", "custom", "shared", "built", "native", "advanced", "partner", "example", "yes", "no"]);
/** Field labels, colours and attribute nouns an answer capitalises on their own ("**Price:**", "White", "Verdict"); never cut from a longer name ("Origin Fit", "Gold's Gym"). */
const LABEL_WORDS = new Set(["all", "unsure", "same", "made", "sites", "white", "black", "red", "blue", "green", "grey", "gray", "navy", "pink", "orange", "yellow", "brown", "beige", "purple", "silver", "gold", "pros", "cons", "verdict", "winner", "price", "prices", "pricing", "cost", "costs", "value", "quality", "durability", "consistency", "versatility", "longevity", "comfort", "fit", "sizing", "style", "variety", "availability", "convenience", "support", "service", "returns", "refunds", "shipping", "delivery", "overall", "summary", "conclusion", "note", "tip", "tips", "example", "examples", "option", "options", "features", "benefits", "drawbacks", "limitations", "highlights", "specs", "specifications", "technology", "materials", "status", "trends", "vibe", "condition", "structure", "medium", "arch", "degrees", "perform", "world", "innovation", "sustainability", "climate", "weight", "traction", "neutral", "setting", "feature", "category", "people", "watch", "pure", "sons", "adoption", "ownership", "exceptions", "mocking", "testing", "documentation", "security", "performance", "reliability", "scalability", "ecosystem", "community", "onboarding", "usability", "design", "speed", "accuracy", "coverage", "flexibility", "simplicity", "transparency", "trust", "safety", "privacy", "compliance", "governance", "reporting", "collaboration", "range", "ride", "philosophy", "control", "type", "types", "preference", "loyalty", "sensitivity", "presence", "use", "issue", "issues", "tennis", "golf", "cycling", "hiking", "yoga", "boxing", "swimming", "football", "basketball", "soccer", "cricket", "rugby", "baseball", "hockey", "skiing", "surfing", "climbing", "pilates", "gymnastics", "wrestling", "athletics", "walking", "lifting", "cardio", "strength", "conditioning", "coaching"]);
/** Function words and sentence adverbs that open a run but never a name; "New Balance" and "Best Buy" keep their adjectives. */
const LEADING_FRAGMENT_WORDS = new Set(["open", "closed", "same", "for", "that", "which", "who", "what", "how", "why", "to", "of", "in", "at", "by", "on", "a", "an", "the", "and", "or", "but", "there", "another", "multiple", "dedicated", "various", "several", "also", "plus", "with", "without", "near", "nearby", "across", "around", "more", "less", "only", "just", "called", "used", "going", "are", "during", "before", "after", "when", "while", "then", "because", "since", "although", "though", "however", "whether", "if", "so", "yet", "both", "either", "neither", "each", "every", "some", "any", "many", "most", "few", "other", "others", "such", "like", "unlike", "per", "via", "versus"]);
/** A qualifier glued to a name ("CrossFit-style", "Pilates-based") describes something else. */
const GLUED_QUALIFIER = /-(?:style|based|affiliated|friendly|approved|led|focused|inspired|level|only|like|type|specific|certified|era|series|line|collaboration|blend)$/i;
/** The shape of an area or landmark name rather than a business. */
const PLACE_SUFFIX = /\b(?:Marina|Bay|Park|Mall|Road|Rd|Street|St|Avenue|Ave|Towers?|Heights|Hills|Islands?|City|Oasis|Village|Creek|Harbou?r|Plaza|District|Gate|Walk|Boulevard|Blvd|Square|Beach|Lakes?|Downtown|Metro|Bridge|Lane|Gardens?|Residences?|Quarter|Corniche|Souk|Souq|Waterfront|Promenade|Port|Drive|Nagar|Halli|Layout|Colony|Extension|Phase|Sector|Block|Hobli|Taluk|Circle|Cross|Main|Stage|Enclave|Town|Cantonment|Junction|Station|Airport|Emirate|County|Borough|Suburb)$/i;
const ARABIC_PLACE_PREFIX = /^(?:Al|Umm|Ras|Bur|Ain|Deira|Abu|Sheikh|Wadi|Jebel|Jabal|Nad|Madinat|Souk|Souq|Bani|Dar)\s/i;
/** Indian and English toponym endings: "Indiranagar", "Marathahalli", "Whitefield", "Hyderabad". */
const TOPONYM_ENDING = /^[A-Z][a-z]{2,}(?:nagar|halli|sandra|palya|pura|puram|pete?|gudi|field|ville|burgh?|town|ford|bury|stan|abad|garh|pur|ganj|wadi|kere|kote|mangala|palli|pally|patnam|patam)$/;
/** Text just before a mention that makes it a place ("in Dubai Marina", "near JLT", "on Amazon"); "at X" is how one names a venue, so it is not here. */
const LOCATIVE_BEFORE = /\b(?:in|on|near|around|across|within|throughout|located in|based in)\s+(?:the\s+)?$/i;
/** A short all-capitals token is an area code (JVC, JLT, DIFC, DIP) far more often than a business. */
const AREA_CODE = /^[A-Z]{2,4}$/;
/** "APIs", "PRs", "OTPs", "DJs": a plural acronym is a thing. */
const ACRONYM_PLURAL = /^[A-Z]{2,5}s$/;
/** A file name or URL fragment ("EmpireMenu.pdf", "Tacos.html", "NB.com", "Restaurants-g297628-"). */
const URL_LIKE = /\.(?:pdf|html?|com|net|org|in|ae|co|io|uk|app|php|aspx?)\b|-g\d+|[A-Za-z]-[A-Za-z]*\d{3,}/i;
/** A word that follows a name when the name is a place ("Ibn Battuta Mall", "Koramangala branch"). */
const PLACE_WORD_AFTER = /^\s+(?:Mall|Towers?|Metro|Road|Street|Marina|Bay|Park|Island|Beach|Bridge|Hills|Heights|Village|Creek|Harbou?r|Plaza|Gate|Walk|Boulevard|District|Lakes?|Residences?|Souk|Souq|branch(?:es)?|outlets?|locations?|areas?|neighbou?rhoods?|suburbs?|locality|region|emirate|district|side|campus|store)\b/;
/** Separators of a written list: "Al Quoz, DIFC and Ibn Battuta", "Downtown/Burj Khalifa". */
const LIST_SEPARATOR = /\s*(?:,|\/|\band\b|\bor\b)\s*/;
const CAPITALISED_TAIL = /((?:[A-Z][A-Za-z0-9&'’.-]*\s+){0,2}[A-Z][A-Za-z0-9&'’.-]*)$/;
const CAPITALISED_HEAD = /^([A-Z][A-Za-z0-9&'’.-]*(?:\s+[A-Z][A-Za-z0-9&'’.-]*){0,2})/;
/** Nationalities, cuisines and regions used as adjectives: "Italian brands", "South Indian", "Middle Eastern". */
const DEMONYM = /^(?:[A-Z][a-z]{3,}(?:ian|ean|ese|ish)|American|Mexican|African|German|Dominican|Moroccan|Cuban|Jamaican|Korean|Asian|Russian|Roman|Venezuelan|Peruvian|Colombian|Australian|Canadian|Indian|Pakistani|Punjabi|Gujarati|Bengali|Rajasthani|Lahori|Mughlai|Marathi|Hyderabadi|Israeli|Iraqi|Emirati|Saudi|Kuwaiti|Omani|Qatari|Bahraini|Yemeni|Nepali|Thai|Iranian|Persian|French|Dutch|Greek|Swiss|Czech|Filipino|Latino|Malay|Tamil|Kashmiri|Afghani|Awadhi|Chettinad|Continental|Oriental|Nordic|Arabic|Arab|Levantine|Tex-Mex|Indo-Chinese|Anglo-Indian|Latin|Asian-fusion|Mediterranean|Telugu|Kannada|Malayali|Odia|Konkani|Sindhi|Parsi|Goan|Keralite|Andhra|Lucknowi|Bihari|Nawabi|Mughal|Malabari|Coorgi|Udupi|Tibetan|Peshawari|Texan|Cajun|Creole|Tuscan|Sichuan|Szechuan|Hunan|Hakka|Halal)$/;
/** Countries, continents and well-known regions and cities any answer may name as a style or a market ("Kerala food", "sold in Europe"). */
const WORLD_PLACE = /^(?:Europe|Asia|Africa|America|Americas|Australia|Oceania|Antarctica|Scandinavia|Caribbean|Middle East|Gulf|GCC|UAE|USA|UK|EU|India|China|Japan|Korea|Thailand|Vietnam|Malaysia|Indonesia|Singapore|Philippines|Pakistan|Bangladesh|Sri Lanka|Nepal|Bhutan|Tibet|Iran|Iraq|Turkey|Lebanon|Syria|Jordan|Israel|Egypt|Morocco|Tunisia|Ethiopia|Kenya|Nigeria|Ghana|South Africa|Saudi Arabia|Arabia|Persia|Oman|Qatar|Bahrain|Kuwait|Yemen|Mexico|Brazil|Argentina|Peru|Chile|Colombia|Cuba|Jamaica|Canada|Russia|Poland|Hungary|Sweden|Norway|Denmark|Finland|Iceland|Italy|Sicily|France|Spain|Portugal|Greece|Germany|Netherlands|Belgium|Switzerland|Austria|Britain|England|Scotland|Ireland|Wales|London|Paris|Rome|Milan|Berlin|Madrid|Barcelona|Lisbon|Amsterdam|Tokyo|Seoul|Bangkok|Beijing|Shanghai|Hong Kong|Sydney|Melbourne|New York|Los Angeles|Chicago|Toronto|Dubai|Abu Dhabi|Sharjah|Ajman|Fujairah|Umm Al Quwain|Ras Al Khaimah|Riyadh|Jeddah|Doha|Muscat|Manama|Kerala|Goa|Punjab|Bengal|Gujarat|Rajasthan|Kashmir|Awadh|Malabar|Mangalore|Hyderabad|Lucknow|Delhi|New Delhi|Bombay|Mumbai|Chennai|Madras|Kolkata|Calcutta|Bangalore|Bengaluru|Pune|Ahmedabad|Jaipur|Kochi|Cochin|Andhra|Karnataka|Maharashtra|Tamil Nadu|Konkan|Coorg|Sindh|Lahore|Karachi|Peshawar|Kabul)$/i;
const DIRECTION_WORDS = new Set(["coast", "north", "south", "east", "west", "northern", "southern", "eastern", "western", "central", "middle", "coastal", "old", "new", "modern", "pan", "fusion", "street", "home", "homestyle", "classic", "traditional", "authentic", "regional", "local", "style"]);
/** Words that describe a dish or a product rather than name who sells it. */
const MODIFIER_WORDS = new Set(["crispy", "spicy", "grilled", "fried", "roasted", "smoked", "creamy", "butter", "garlic", "cheese", "cheesy", "peri", "tandoori", "masala", "dum", "tikka", "keema", "veg", "non", "special", "double", "triple", "mini", "jumbo", "plain", "mixed", "hot", "cold", "sweet", "sour", "fresh", "whole", "half", "full", "combo", "set", "clear", "dry", "touch", "ultra", "matte", "gentle", "daily", "hydrating", "anti", "pro", "max", "plus", "lite", "light", "pocket", "high", "rise", "low", "mid", "long", "short", "sleeve", "regular", "slim", "fit", "men", "men's", "women", "women's", "kids", "ladies", "boys", "girls", "unisex", "adult", "junior", "senior", "pack", "pair", "size", "sizes", "growth", "care", "therapy", "scalp", "hair", "skin", "face", "body", "layer", "base", "performance", "training", "running", "everyday", "lightweight", "heavy", "premium", "signature", "classic", "custom", "limited", "edition", "chicken", "mutton", "lamb", "beef", "fish", "prawn", "prawns", "egg", "eggs", "paneer", "mushroom", "potato", "rice", "noodles", "fries", "wings", "steak", "curry", "gravy", "soup", "salad", "sandwich", "wrap", "roll", "rolls", "bowl", "platter", "thali", "biryani", "kebab", "burger", "pizza", "pasta", "cake", "cheesecake", "dessert", "shake", "shakes", "juice", "coffee", "tea", "lemon", "chili", "chilli", "honey", "mango", "chocolate", "vanilla", "caramel", "onion", "tomato", "mint", "rosemary", "tree", "oil", "serum", "shampoo", "cream", "lotion", "gel", "mist", "cleanser", "moisturizer", "moisturiser", "sunscreen", "balm", "wax", "spray", "mask", "scrub", "wash", "conditioner", "parotta", "paratha", "naan", "roti", "dosa", "idli", "vada", "kadai", "kadhai", "korma", "josh", "laal", "maas", "dal", "daal", "sambar", "rasam", "pulao", "pilaf", "momos", "manchurian", "fry", "roast", "bhaji", "pakora", "samosa", "chaat", "lassi", "kulfi", "halwa", "haleem", "nihari", "shawarma", "falafel", "hummus", "mezze", "kunafa", "baklava", "tacos", "burrito", "nachos", "quesadilla", "sushi", "ramen", "dumplings", "pho", "tandoor", "rogan", "gosht", "bhuna", "boti", "seekh", "malai", "kofta", "kulcha", "bhatura", "chole", "rajma", "sabzi", "aloo", "gobi", "palak", "methi", "makhani", "vindaloo", "phirni", "kheer", "jalebi", "rabri", "mithai", "tikki", "dahi", "puri", "bhel", "pav", "vada", "upma", "poha", "khichdi", "thepla", "dhokla", "undhiyu", "halal", "vegan", "vegetarian", "jain", "organic", "gluten", "keto", "sugar", "dairy", "t-shirt", "tee", "tees", "shirt", "shirts", "top", "tops", "hoodie", "jogger", "joggers", "pants", "trousers", "bra", "socks", "jacket", "vest", "cap", "hat", "bag", "backpack", "school", "after", "post", "pre", "hub", "cloud", "suite", "inbox", "marketplace", "console", "workspace", "desk", "dashboard", "module", "plugin", "widget", "ads", "analytics", "drive", "docs", "sheets", "forms", "calendar", "maps", "meet", "chat", "mail", "pay", "payments", "wallet", "marketing", "sales", "service", "support", "customer", "commerce", "enterprise", "business", "starter", "teams", "team", "engage", "engagement", "connect", "data", "insights", "intelligence", "automation", "campaigns", "campaign", "sequences", "outreach", "mobile", "desktop", "web", "smoky", "kothu", "flavour", "flavor", "taste", "biriyani", "cottage"]);
/** A run that starts with a title is a person. */
const PERSON_TITLE = /^(?:Chef|Coach|Dr\.?|Mr\.?|Mrs\.?|Ms\.?|Sir|Captain|Prof\.?|Professor|Founder|CEO|Owner)$/;
/** A sentence about a person: athletes, designers, endorsements, signature lines. */
const PERSON_CONTEXT = /\b(?:athletes?|players?|celebrit(?:y|ies)|designers?|founders?|founded by|chefs?|influencers?|ambassadors?|endorse[sd]?|endorsements?|collab(?:oration)?s?|wears?|wearing|wore|worn by|signature (?:shoe|line|model|sneaker|collection|series|dish|menu)|named after)\b/i;
/** A number right after a name is a model ("Pegasus 40", "Air Force 1"), unless it measures something. */
const MODEL_NUMBER_AFTER = /^[ \t]+v?\d{1,3}(?:\.\d)?(?![\d.,]*\s*(?:%|am|pm|aed|usd|inr|rs|km|kg|lbs?|min|mins|minutes|hours?|hrs|days?|months?|years?|people|members|branches|locations|reviews|stars?|\/|-|•))\b/i;
const MODEL_TOKEN = /^(?:[A-Za-z]{0,2}\d{1,4}[A-Za-z]{0,2}|\d{2,4}v\d)$/;
/** A word that follows a product line or a technology, never a business. */
const THING_WORD_AFTER = /^\s+(?:technology|technologies|tech|foam|cushioning|fabric|midsole|outsole|upper|sole|material|materials|mesh|knit|membrane|fibre|fiber|insulation|lining|coating|formula|extract|serum|shampoo|line|lineup|range|series|collection|edition|sneakers?|shoes?|trainers?|boots?|cleats?|jerseys?|kits?|shorts|leggings|tights|hoodies?|jackets?|socks|apparel|gear|programme|program)\b/i;
/** "from Zappos", "via Myntra" in a sentence about buying: a channel, not a rival. */
const CHANNEL_BEFORE = /\b(?:via|through|from)\s+$/i;
const SHOPPING_CONTEXT = /\b(?:buy|buying|bought|purchase[sd]?|order(?:ed|ing)?|shop|shopping|retailers?|stores?|available|sold|stock(?:ed|ists?)?|marketplace|delivery|deliver(?:ed|s)?|ships?|shipping|deals?|discounts?|coupons?|cashback|checkout|resale|resell)\b/i;
/** A sentence listing what something is made of. */
const INGREDIENT_CONTEXT = /\b(?:ingredients?|formulated|formulation|contains?|containing|infused|enriched|extracts?|actives?|concentration)\b|\d+\s*(?:%|mg|ml)\b/i;
/** A verb right after one word makes it the subject of the sentence: "Rajdhani serves", "Hoka offers". */
const SUBJECT_VERB_AFTER = /^\s+(?:serves?|offers?|runs?|specialises?|specializes?|opened|charges?|provides?|sells?|delivers?|caters?|operates?|competes?|stocks?|carries|carry|launched|positions?|targets?)\b/;
/** Text that introduces a list of places: "cities like Mumbai, Delhi and Pune". */
const PLACE_INTRODUCER = /\b(?:cit(?:y|ies)|towns?|areas?|neighbou?rhoods?|districts?|regions?|countries|country|markets?|emirates?|states?|suburbs?|locations?|branches)\s+(?:like|such as|including|of|in|across)\s+$/i;
/** A sports team named for its kit, fans or league, not a brand: "kits for Real Madrid", "Arsenal's home shirt". */
const TEAM_BEFORE = /\b(?:clubs?|teams?|sides?|fans of|supporters of|kits? (?:for|of)|jerseys? (?:for|of)|shirts? (?:for|of))\s+(?:like|such as|including)?\s*$/i;
const TEAM_AFTER = /^['’]s\s+(?:kit|kits|jersey|jerseys|shirt|shirts|home|away|squad|stadium|fans|players|season)\b/i;
/** Text that introduces a technology or tool something works with: "supports Java, Python and Go". */
const TECH_INTRODUCER = /\b(?:supports?|supporting|support for|written in|built (?:in|with|on)|integrates? with|integrations? (?:with|for)|works with|compatible with|plugins? for|extensions? for|import(?:s|ed)? from|export(?:s|ed)? to|sync(?:s|ed)? with)\s+$/i;
/** Text that introduces a brand by name: "brands like Hoka", "rather than Brooks", "vs Saucony". */
const BRAND_INTRODUCER = /\b(?:like|such as|including|include|includes|vs\.?|versus|than|prefer|choose|try|consider|recommend|alternatives?|competitors?|rivals?|brands?|from|by)\s+(?:the\s+)?$/i;

/** Abbreviations and jargon capitalised by convention: B2B, B2C, D2C, SaaS, PaaS. */
const JARGON = /^(?:[A-Z]\d[A-Z]|[A-Z][a-z]{1,2}[A-Z]{1,2})$/;
/** A compound adjective ("CRM-linked", "CRM-first", "Couch-to-5K") describes something else. */
const COMPOUND_QUALIFIER = /^[A-Z][A-Za-z0-9]*-[a-z]/;
/** A flow written with arrows ("New lead → Contacted → Demo → Won/Lost") lists steps, not businesses. */
const FLOW_ARROW = /(→|->|⇒|=>)/;
/** The answer asking for details or offering to narrow the choice: the examples it lists are not recommendations. */
const CLARIFYING = /\b(?:if you (?:tell|let|give|share|can share|could share)|tell me|let me know|share (?:your|the|a few)|i can (?:narrow|compare|map|recommend|suggest|tailor|point|shortlist|rank|match|help you)|to narrow (?:this|it)|so i can)\b/i;
/** Open-ended examples of a kind ("Google Ads, Facebook, referral, etc.", "e.g., Gmail, Outlook"), not the kind itself. */
const EXAMPLE_LIST = /\be\.g\.|\betc\b/i;
/** Where something comes from ("leads from Facebook", "bookings via Zomato") in a sentence about sources. */
const SOURCE_CONTEXT = /\b(?:leads?|enquir(?:y|ies)|inquir(?:y|ies)|traffic|messages?|contacts?|referrals?|forms?|ads?|campaigns?|sources?|channels?|bookings?|orders?|reviews?|visitors?|signups?|sign-ups?)\b/i;
/** A software feature or setting, not a product: "the Quick Help menu", "Lead Source field", "Proposal Sent stage". */
const FEATURE_WORD_AFTER = /^\s+(?:menu|features?|fields?|view|tab|tabs|button|settings?|module|section|stages?|status|page|screen|panel|reports?|dashboard|workflows?|templates?|rules?|options?|plans?|tiers?|add-on|integrations?|pipelines?|records?|objects?|ids?|columns?|filters?|labels?|tags?|ecosystem|family|stack)\b/i;
/** A product module named for its function ("Sales Hub", "Marketing Cloud", "Leads Inbox") rather than a maker. */
const MODULE_TAIL = /^(?:inbox|hub|cloud|suite|console|workspace|desk|marketplace|dashboard|module|add-on|plugin|widget|api|sdk|cli|ads|analytics|drive|docs|sheets|forms|calendar|maps|meet|chat|mail|pay|payments|wallet)$/i;

function normalizeName(value: string): string {
  return value.toLowerCase().replace(/[’']/g, "'").replace(/[^a-z0-9']+/g, " ").trim();
}

function lettersOnly(value: string): string {
  return value.toLowerCase().replace(/[^a-z0-9]/g, "");
}

/** Trims sentence punctuation, dangling function words and glued qualifiers off a proper-noun run. */
function cleanCandidate(raw: string): string {
  // "CrossFit-style classes" describe a style; the run is not a name at all.
  if (GLUED_QUALIFIER.test(raw)) return "";
  let name = raw.replace(/[.,;:]+$/, "").trim();
  // "Motor City. A" and "DIFC. There": everything after a sentence break is the next sentence.
  const cut = name.search(/[.!?]\s/);
  if (cut > 0) name = name.slice(0, cut).trim();
  // "Saucony’s" and "Hoka's" name Saucony and Hoka ("Gold's" becomes "Gold", which folds into "Gold's Gym" when both are written).
  name = name.replace(/^(.*\S)['’]s$/, (whole, base: string) => (base.length >= 3 ? base : whole));
  let tokens = name.split(/\s+/);
  while (tokens.length > 1 && SENTENCE_FRAGMENT_WORDS.has(tokens[tokens.length - 1]!.toLowerCase())) tokens = tokens.slice(0, -1);
  while (tokens.length > 1 && LEADING_FRAGMENT_WORDS.has(tokens[0]!.toLowerCase())) tokens = tokens.slice(1);
  return tokens.join(" ").replace(/[.,;:]+$/, "").trim();
}

function isKnownPlace(name: string, places: Set<string>): boolean {
  const key = normalizeName(name).replace(/'s$/, "");
  if (!key) return false;
  for (const place of places) {
    if (!place) continue;
    if (key === place || key.startsWith(`${place} `) || key.endsWith(` ${place}`) || (place.length >= 5 && key.includes(` ${place} `))) return true;
  }
  return false;
}

/** "SK Fitness Dubai", "Level Up DXB", "Kids Unlimited UAE" and "GymNation Bur Dubai" are the business, then where it is. */
function withoutTrailingPlace(name: string, places: Set<string>, categoryTerms: Set<string>): string {
  let tokens = name.split(/\s+/);
  let stripped = false;
  while (tokens.length > 1) {
    const last = tokens[tokens.length - 1]!;
    // "Close CRM" ends in the category, not an area code.
    if (places.has(normalizeName(last)) || (AREA_CODE.test(last) && !categoryTerms.has(normalizeName(last))) || (stripped && /^(?:Al|Umm|Ras|Bur|Ain|Abu|Wadi|Jebel|Jabal|Nad|Madinat|Bani|Dar)$/i.test(last))) {
      tokens = tokens.slice(0, -1);
      stripped = true;
    } else break;
  }
  return tokens.join(" ");
}

function looksLikeBusiness(name: string, categoryTerms: Set<string>): boolean {
  // "GymNation" and "ClassPass" carry their category inside a camel-case name.
  const spaced = name.replace(/([a-z])([A-Z])/g, "$1 $2");
  return normalizeName(spaced).split(" ").some((token) => categoryTerms.has(token));
}

/** A place by the project's list or by shape: suffix, Arabic prefix, area code, toponym ending. */
function placeLike(name: string, places: Set<string>): boolean {
  const last = name.split(/\s+/).pop() ?? "";
  return isKnownPlace(name, places) || WORLD_PLACE.test(name) || PLACE_SUFFIX.test(name) || ARABIC_PLACE_PREFIX.test(name) || AREA_CODE.test(name) || TOPONYM_ENDING.test(last);
}

/**
 * Every word is a category word, a nationality or cuisine, a compass word, a
 * dish or product modifier, or a sentence fragment — "South Indian", "Running
 * Apparel", "Chicken Biryani", "Rosemary Scalp Serum" — and none is a name.
 */
function isGenericPhrase(name: string, categoryTerms: Set<string>): boolean {
  const tokens = name.split(/\s+/);
  let anchored = false;
  const generic = (part: string) => {
    const key = normalizeName(part).replace(/'s?$/, "");
    if (categoryTerms.has(key) || DEMONYM.test(part) || MODIFIER_WORDS.has(key)) {
      anchored = true;
      return true;
    }
    return DIRECTION_WORDS.has(key) || SENTENCE_FRAGMENT_WORDS.has(key) || LEADING_FRAGMENT_WORDS.has(key) || WORLD_PLACE.test(part) || ACRONYM_PLURAL.test(part);
  };
  const foodWord = (part: string) => {
    const key = normalizeName(part).replace(/'s?$/, "");
    return MODIFIER_WORDS.has(key) || (categoryTerms.has(key) && !isBusinessTypeWord(key));
  };
  // "Mutton Rogan Josh": a dish opens and closes with food words whatever sits between.
  if (tokens.length >= 3 && foodWord(tokens[0]!) && foodWord(tokens[tokens.length - 1]!)) return true;
  for (const token of tokens) {
    if (!(generic(token) || (token.includes("-") && token.split("-").every(generic)))) return false;
  }
  return anchored;
}

/** Whether every word is a compass word, a modifier or a fragment: "Authentic North" once its place is cut. */
function isOnlyFiller(name: string, categoryTerms: Set<string>): boolean {
  return name.split(/\s+/).every((token) => {
    const key = normalizeName(token).replace(/'s?$/, "");
    return DIRECTION_WORDS.has(key) || MODIFIER_WORDS.has(key) || SENTENCE_FRAGMENT_WORDS.has(key) || LEADING_FRAGMENT_WORDS.has(key) || LABEL_WORDS.has(key) || categoryTerms.has(key) || DEMONYM.test(token) || ACRONYM_PLURAL.test(token);
  });
}

/**
 * Whether a markdown table lists options down its first column ("| Tool |
 * Best for |", "| CRM | Good fit for |") rather than attributes across brands
 * ("| Feature | Zoho CRM | Pipedrive |", "|  | Gold's Gym | The Warehouse
 * Gym |", "| Price Range | Nike: … |"). Decided from the header row.
 */
const ATTRIBUTE_HEADER = /^(?:feature|features|aspect|aspects|category|categories|criteria|criterion|factor|factors|attribute|attributes|area|areas|dimension|dimensions|metric|metrics|what|consideration|considerations|question|questions|need|needs|use case|use cases|scenario|scenarios|spec|specs|comparison|item|items|topic|topics|point|points|detail|details)$/i;
const OPTION_HEADER = /^(?:tools?|software|brands?|options?|names?|platforms?|providers?|vendors?|products?|apps?|services?|compan(?:y|ies)|alternatives?|competitors?|rivals?|solutions?|systems?|suppliers?|shops?|stores?|venues?|places?|picks?|choices?|candidates?)$/i;
function optionTable(text: string, lineStart: number, categoryTerms: Set<string>): boolean {
  // Walk up to the header: the row above the separator row.
  let cursor = lineStart;
  let header: string | null = null;
  for (let rows = 0; rows < 60 && cursor > 0; rows += 1) {
    const previousStart = text.lastIndexOf("\n", cursor - 2) + 1;
    const row = text.slice(previousStart, cursor - 1);
    if (!/^\s*\|/.test(row)) break;
    if (/^\s*\|\s*:?-{3,}/.test(row)) {
      const headerStart = text.lastIndexOf("\n", previousStart - 2) + 1;
      header = text.slice(headerStart, previousStart - 1);
      break;
    }
    cursor = previousStart;
  }
  if (header === null) return false;
  const cells = header.split("|").map((cell) => cell.replace(/\*\*/g, "").trim()).filter((cell, index, all) => !(index === 0 && cell === "") && !(index === all.length - 1 && cell === ""));
  const first = cells[0] ?? "";
  if (first === "" || ATTRIBUTE_HEADER.test(first)) return false;
  const firstKey = normalizeName(first);
  return OPTION_HEADER.test(first) || categoryTerms.has(firstKey) || firstKey.split(" ").some((word) => categoryTerms.has(word) || OPTION_HEADER.test(word));
}

interface OptionLabel {
  kind: "bold" | "plain" | "map" | "numbered";
  /** The label as written, markdown included: "Metanoia Beauty Salon | Russian Salon". */
  label: string;
  labelStart: number;
  labelEnd: number;
  /** Where the words after the dash stop describing the option: the first full stop, else the line end. */
  descriptorEnd: number;
  /** That description, for deciding whether the label names a business of the kind. */
  description: string;
  /** A map entry's kind from its rating line ("4.9•Nail salon"). */
  listingKind: string | null;
}

const RATING_LINE = /^\s*\d\.\d(?:\s*•\s*([^\n•]+))?\s*$/;

/**
 * Where an answer lists options by structure rather than by sentence: a list
 * label before a dash ("* **Nova Noir Russian Beauty Salon** — Business
 * Bay.", "* Matryoshka Russian Beauty Salon – Nails, Lashes & Brows — …")
 * and a map entry, a short line with a bare rating next to it ("4.8" above
 * or "4.9•Nail salon" below).
 */
function optionLabels(text: string): OptionLabel[] {
  const out: OptionLabel[] = [];
  const lines: Array<{ start: number; text: string }> = [];
  let offset = 0;
  for (const part of text.split("\n")) {
    lines.push({ start: offset, text: part });
    offset += part.length + 1;
  }
  const nonBlank = lines.filter((line) => line.text.trim() !== "");
  for (let index = 0; index < nonBlank.length; index += 1) {
    const line = nonBlank[index]!;
    const sentenceEnd = (from: number) => {
      const rest = line.text.slice(from - line.start);
      const stop = rest.search(/[.!?](?:\s|$)/);
      return stop === -1 ? line.start + line.text.length : from + stop;
    };
    const bold = line.text.match(/^(\s*(?:[-*•]|\d+[.)])\s+\*\*)([^*\n]{2,100}?)\*\*\s*(?:[–—]|-\s|:\s*[–—])/);
    if (bold) {
      const labelStart = line.start + bold[1]!.length;
      const labelEnd = labelStart + bold[2]!.length;
      const descriptorEnd = sentenceEnd(line.start + bold[0].length);
      out.push({ kind: "bold", label: bold[2]!, labelStart, labelEnd, descriptorEnd, description: line.text.slice(bold[0].length), listingKind: null });
      continue;
    }
    // "* **House of Burn — JLT**" with the description on the next line.
    const boldPair = line.text.match(/^(\s*(?:[-*•]|\d+[.)])\s+\*\*)([^*\n]{2,60}?\s[–—]\s[^*\n]{1,60})\*\*\s*$/);
    if (boldPair) {
      const labelStart = line.start + boldPair[1]!.length;
      const labelEnd = labelStart + boldPair[2]!.length;
      const description = nonBlank[index + 1]?.text ?? "";
      out.push({ kind: "bold", label: boldPair[2]!, labelStart, labelEnd, descriptorEnd: labelEnd, description, listingKind: null });
      continue;
    }
    const plain = line.text.match(/^(\s*(?:[-*•]|\d+[.)])\s+)([^*\n—–]{2,100}?)\s+[–—]\s/);
    if (plain) {
      const labelStart = line.start + plain[1]!.length;
      const labelEnd = labelStart + plain[2]!.length;
      const descriptorEnd = sentenceEnd(line.start + plain[0].length);
      out.push({ kind: "plain", label: plain[2]!, labelStart, labelEnd, descriptorEnd, description: line.text.slice(plain[0].length), listingKind: null });
      continue;
    }
    const named = numberedName(line, nonBlank, index);
    if (named) {
      out.push(named);
      continue;
    }
    const previous = nonBlank[index - 1];
    const next = nonBlank[index + 1];
    const trimmed = line.text.trim();
    if (RATING_LINE.test(trimmed) || /^\d/.test(trimmed) || trimmed.length > 100 || /^[#>|*-]/.test(trimmed) || /[.!?:]$/.test(trimmed)) continue;
    const ratedBelow = next !== undefined && RATING_LINE.test(next.text);
    const ratedAbove = previous !== undefined && RATING_LINE.test(previous.text);
    if (!ratedBelow && !ratedAbove) continue;
    const listingKind = ratedBelow ? next!.text.match(RATING_LINE)?.[1]?.trim() ?? null : null;
    const labelStart = line.start + (line.text.length - line.text.trimStart().length);
    out.push({ kind: "map", label: trimmed, labelStart, labelEnd: labelStart + trimmed.length, descriptorEnd: labelStart + trimmed.length, description: "", listingKind });
  }
  return out;
}

/**
 * What a listing writes under an option's name: a rating ("4.9/5 · 1,272
 * reviews", "★ 4.8"), a phone number, an "Area · kind" line or a link to the
 * place's own site. An advice list ("## 2. Check Reviews", "1. Book Early")
 * carries none of them.
 */
const LISTING_CUE = /\b\d\.\d\s*(?:\/\s*5|★|stars?\b)|★|\b\d[\d,]*\s+reviews?\b|\+\d{2,3}[\s\d-]{6,}|\b(?:Phone|Contact|Call|Tel)\b\s*:|\s·\s|\[(?:Official website|Website|Contact and booking|Book(?:ing)?|View [^\]]{2,30})\]\(/i;

/**
 * An option written as its name alone on a numbered line or heading, with
 * where it is, its rating and what it offers on the lines below: "1. Maria
 * Dowling", "## 1. ELAN Lash & Brow Beauty Lounge", "### 4. [The Nail Spa —
 * DIFC](…)", "2. **Pastels Salon**", or a bullet whose whole line is a bold
 * or linked name. ChatGPT answered a DIFC salon's questions this way from
 * October 2026, and six ranked salons read as an answer naming no business.
 */
function numberedName(line: { start: number; text: string }, nonBlank: Array<{ start: number; text: string }>, index: number): OptionLabel | null {
  const marker = line.text.match(/^(\s*(?:#{1,6}\s*)?(?:(\d{1,2})[.)]|[-*•])\s+)/);
  if (!marker) return null;
  const numberedMarker = marker[2] !== undefined;
  let rest = line.text.slice(marker[1]!.length).trimEnd();
  let offset = marker[1]!.length;
  const unwrap = (open: string, close: string) => {
    if (rest.startsWith(open) && rest.endsWith(close) && rest.length > open.length + close.length) {
      rest = rest.slice(open.length, rest.length - close.length);
      offset += open.length;
      return true;
    }
    return false;
  };
  const bold = unwrap("**", "**");
  // "[The Nail Spa — DIFC](https://…)": the link's words are the name.
  const link = rest.match(/^\[([^\]\n]{2,100})\]\([^)\s]*\)$/);
  if (link) rest = link[1]!;
  if (link) offset += 1;
  // A bullet counts only when its whole line is a bold or linked name; plain bullets list services and features.
  if (!numberedMarker && !bold && !link) return null;
  const label = rest.trim();
  if (label.length < 2 || label.length > 100 || /\*\*|[.!?:;,]$/.test(label)) return null;
  // The lines under the name, up to the next option or heading: where it is,
  // its rating, what it is. Bullets stay in: "- **Rating:** 4.8/5 from 1,738
  // reviews" sits under "### 1. [It's Beauty Ladies Salon — DIFC](…)".
  const below: Array<{ start: number; text: string }> = [];
  for (let next = index + 1; next < nonBlank.length && below.length < 4; next += 1) {
    const candidate = nonBlank[next]!;
    if (/^\s*(?:#{1,6}\s|\d{1,2}[.)]\s)/.test(candidate.text)) break;
    below.push(candidate);
  }
  const description = below.map((entry) => entry.text).join(" ");
  if (!LISTING_CUE.test(description)) return null;
  // The short lines straight under the name ("DIFC · Index Tower", "4.9/5 · 1,272 reviews", "Best overall") describe it; their capitals are not names.
  let descriptorEnd = line.start + offset + label.length;
  for (const entry of below) {
    if (entry.text.trim().length > 90 || /[.!?]\s/.test(entry.text)) break;
    descriptorEnd = entry.start + entry.text.length;
  }
  const labelStart = line.start + offset;
  // A rating under the name makes it a listing as surely as a map entry: "BRAU"
  // above "The Springs Souk · 4.9/5" is a brow studio, not an area code.
  const rated = /\b\d\.\d\s*(?:\/\s*5|★|stars?\b)|★|\b\d[\d,]*\s+reviews?\b|\bRating\b/i.test(description);
  return { kind: "numbered", label, labelStart, labelEnd: labelStart + label.length, descriptorEnd, description, listingKind: rated ? "rated" : null };
}

/** Where an answer writes an option's name as a list label, a numbered line or a map entry. */
export function optionLabelSpans(text: string): Array<[number, number]> {
  return optionLabels(text).map((label) => [label.labelStart, label.labelEnd] as [number, number]);
}

const LEGAL_TAIL = /\s+(?:Pvt\.?\s*Ltd\.?|Private\s+Limited|Ltd\.?|Limited|LLC|L\.L\.C\.?|FZ-?LLC|FZE|FZCO|DMCC|Inc\.?)$/i;

/**
 * The name part of an option label: "Metanoia Beauty Salon | Russian Salon"
 * → "Metanoia Beauty Salon", "Nails LAB (we moved to JLT…)" → "Nails LAB",
 * "HAIRPLAY® Hair Extensions Salon وصلات شعر" → "HAIRPLAY® Hair Extensions
 * Salon", "Maison du Brownie & Cheese Cake Pvt Ltd" → "Maison du Brownie &
 * Cheese Cake". A branch's place after the business word goes too: "N.Bar
 * Nail Spa & Salon Emirates Towers" and "… Gate Avenue" are one business,
 * as are "Le Michel Salons Downtown Dubai" and "Boho Salon. DXB".
 */
function cleanOptionName(label: string, places: Set<string>, categoryTerms: Set<string>): string {
  const plain = label.replace(/\[([^\]]+)\]\([^)]*\)/g, "$1").replace(/\*\*/g, "").trim();
  let name = plain.split(/\s*\|\s*|\s+[–—]\s*|\s+-\s+|\s*\(|\s*,\s*|:\s/)[0]!.split(/\s+(?=[\u0590-\u08FF])/)[0]!.trim();
  // "Otana Beauty By NAJI" loses "NAJI" as an area code; a dangling "By" goes with it.
  const tidy = (value: string) => value.replace(LEGAL_TAIL, "").replace(/[.,;:]+$/, "").trim().replace(/\s+(?:by|of|and|&|the|at|de)$/i, "").trim();
  name = tidy(withoutTrailingPlace(tidy(name), places, categoryTerms));
  const tokens = name.split(/\s+/);
  let lastBusinessWord = -1;
  tokens.forEach((token, index) => {
    const bare = token.replace(/[^A-Za-zé]/g, "");
    if (categoryTerms.has(normalizeName(bare)) || isBusinessTypeWord(bare)) lastBusinessWord = index;
  });
  const tail = tokens.slice(lastBusinessWord + 1);
  if (lastBusinessWord >= 1 && tail.length >= 1 && tail.length <= 3 && !tail.some((token) => /^(?:&|and|by|of|for)$/i.test(token)) && placeLike(tail.join(" "), places)) {
    name = tidy(tokens.slice(0, lastBusinessWord + 1).join(" "));
  }
  return name;
}

/** The items written either side of a run in a comma, slash, "and" or "or" list. */
function listNeighbours(text: string, start: number, end: number): { previous: string | null; beforePrevious: string | null; next: string | null; afterNext: string | null } {
  const before = text.slice(Math.max(0, start - 120), start);
  const after = text.slice(end, end + 80);
  let previous: string | null = null;
  let beforePrevious: string | null = null;
  let next: string | null = null;
  if (/(?:,|\/|\band\b|\bor\b)\s*$/.test(before)) {
    const parts = before.split(LIST_SEPARATOR);
    const item = parts.length >= 2 ? parts[parts.length - 2]!.trim() : "";
    previous = item.match(CAPITALISED_TAIL)?.[1] ?? (item ? item.split(/\s+/).pop()! : null);
    const earlier = parts.length >= 3 ? parts[parts.length - 3]!.trim() : "";
    beforePrevious = earlier ? earlier.match(CAPITALISED_TAIL)?.[1] ?? earlier.split(/\s+/).pop()! : null;
  }
  const following = after.match(/^\s*(?:,|\/|\band\b|\bor\b)\s*([^,;\/\n)]{1,60})/)?.[1]?.trim();
  if (following) next = following.match(CAPITALISED_HEAD)?.[1] ?? following.split(/\s+/)[0]!;
  let afterNext: string | null = null;
  const items = after.split(LIST_SEPARATOR);
  if (items.length >= 3 && /^\s*(?:,|\/|\band\b|\bor\b)/.test(after)) {
    const third = items[2]!.trim().split(/[;\n)]/)[0]!.trim();
    afterNext = third ? third.match(CAPITALISED_HEAD)?.[1] ?? third.split(/\s+/)[0]! : null;
  }
  return { previous, beforePrevious, next, afterNext };
}

/** The markdown link `[label](url)` a run sits inside, if any. */
function linkLabelAround(text: string, start: number, end: number): { host: string } | null {
  const open = text.lastIndexOf("[", start);
  if (open === -1 || /[\]\n]/.test(text.slice(open + 1, start))) return null;
  const close = text.indexOf("]", end);
  if (close === -1 || /\n/.test(text.slice(end, close)) || text.slice(close, close + 2) !== "](") return null;
  const url = text.slice(close + 2, text.indexOf(")", close + 2) === -1 ? undefined : text.indexOf(")", close + 2));
  const host = url.replace(/^[a-z][a-z0-9+.-]*:\/\//i, "").split(/[/?#]/)[0] ?? "";
  return { host };
}

/** Whether a cited page belongs to the name in its label: "[MH3 Gym](mh3gym.com)" yes, "[FitFit](gymfinder.ae)" no. */
function hostNamesLabel(host: string, label: string): boolean {
  const hostLetters = lettersOnly(host);
  const whole = lettersOnly(label);
  const first = lettersOnly(label.split(/\s+/)[0] ?? "");
  return (whole.length >= 4 && hostLetters.includes(whole)) || (first.length >= 5 && hostLetters.includes(first));
}

/**
 * Names written right after a tracked brand ("Nike Pegasus 40", "Adidas
 * Ultraboost", "Under Armour's HeatGear"), with every leading part, so
 * "Pegasus", "Air" and "Air Max" elsewhere in the answer are that brand's
 * products rather than new businesses.
 */
function productFormsOfTracked(text: string, linkedMentions: DetectedMention[]): Set<string> {
  return productFormsAfter(text, linkedMentions.map((mention) => mention.span.end));
}

function productFormsAfter(text: string, ends: number[]): Set<string> {
  const forms = new Set<string>();
  for (const end of ends) {
    const after = text.slice(end, end + 60);
    const match = after.match(/^(?:['’]s)?\s+([A-Z0-9][A-Za-z0-9&'’.-]*(?:\s+[A-Z0-9][A-Za-z0-9&'’.-]*){0,2})/);
    if (!match) continue;
    const tokens = normalizeName(cleanCandidate(match[1]!)).split(" ").filter(Boolean);
    for (let keep = 1; keep <= tokens.length; keep += 1) forms.add(tokens.slice(0, keep).join(" "));
  }
  return forms;
}

/**
 * Product and line names written after a brand's name anywhere in a set of
 * answers: "Nike Pegasus 40", "Adidas Ultraboost", "Under Armour's HeatGear".
 * Used across a run, so an answer that says only "the Pegasus" still counts
 * it as Nike's product.
 */
export function learnProductForms(texts: string[], surfaces: string[]): string[] {
  const forms = new Set<string>();
  const patterns = surfaces.filter((surface) => surface.trim().length >= 3).map((surface) => new RegExp(`\\b${escapeRegex(surface.trim()).replace(/['’]/g, "['’]").replace(/ +/g, "\\s+")}(?=(?:['’]s)?\\s+[A-Z0-9])`, "g"));
  for (const text of texts) {
    const ends: number[] = [];
    for (const pattern of patterns) for (const match of text.matchAll(pattern)) ends.push(match.index! + match[0].length);
    for (const form of productFormsAfter(text, ends)) forms.add(form);
  }
  return [...forms];
}

export interface EmergingCandidate {
  name: string;
  spans: Span[];
  /** Written as a listed option at least once: a list label, a table row, an own-site link opening a row, or a map listing. */
  listed: boolean;
}

export function detectEmergingCandidates(text: string, linkedMentions: DetectedMention[], context?: EmergingContext): EmergingCandidate[] {
  const places = new Set((context?.places ?? []).map(normalizeName).filter((place) => place.length >= 3));
  const categoryTerms = new Set((context?.categoryTerms ?? []).map(normalizeName).filter((term) => term.length >= 3));
  const contextual = categoryTerms.size > 0;
  const trackedHeads = new Set(
    (context?.trackedNames ?? [])
      .map((name) => normalizeName(name.replace(/^(?:the|a|an)\s+/i, "")).split(" "))
      .filter((tokens) => tokens.length >= 2 && tokens[0]!.length >= 5 && !categoryTerms.has(tokens[0]!))
      .map((tokens) => tokens[0]!.replace(/'s$/, "")),
  );
  const claimed = linkedMentions.map((m) => [m.span.start, m.span.end] as const);
  const overlaps = (start: number, end: number) => claimed.some(([s, e]) => start < e && end > s);
  const mentionStartsAt = (index: number) => linkedMentions.some((m) => m.span.start === index);
  const products = productFormsOfTracked(text, linkedMentions);
  for (const form of context?.productForms ?? []) products.add(form);
  const stem = (norm: string) => norm.replace(/s$/, "");
  const businessTypeTail = (token: string) => isBusinessTypeWord(token.replace(/[^A-Za-zé]/g, "")) || categoryTerms.has(normalizeName(token)) || /^(?:fit|house|store|shop|market|academy|school|centre|center|works|co)$/i.test(token);
  const shapedToken = (token: string) => /[a-z][A-Z]/.test(token) || /\d/.test(token) || /^[A-Z]{5,}$/.test(token);
  const lowercaseItem = (item: string | null) => item !== null && /^[a-z]/.test(item);

  interface Entry { name: string; spans: Span[]; midSentence: number; outsideLink: number; thing: number; cue: number; multiWord: boolean; listed: boolean; inCategory?: boolean; whole?: boolean }
  const byName = new Map<string, Entry>();

  // Whole option labels first. A DIFC salon's answers listed "Nova Noir
  // Russian Beauty Salon", "ELAN Lash & Brow Beauty Lounge" and "Only U nail
  // salon" as map entries and "* **Name** — Area." bullets; the proper-noun
  // run stops at four words and at "&", so those salons were lost, while the
  // area after the dash ("— Azizi Riviera.", "— Carlton Downtown Hotel.")
  // was counted as a business of its own.
  const descriptorZones: Array<[number, number]> = [];
  if (contextual) {
    const connector = (token: string) => /^(?:&|and|by|de|of|the|at|on)$/.test(token);
    const judged = optionLabels(text).map((label) => {
      const insideLinked = overlaps(label.labelStart, label.labelEnd);
      const name = cleanOptionName(label.label, places, categoryTerms);
      const nameAt = name.length >= 3 ? text.indexOf(name, label.labelStart) : -1;
      const tokens = name.split(/\s+/);
      const first = tokens[0] ?? "";
      const firstKey = first.toLowerCase();
      // A numbered line with a listing under it names one place of business,
      // even in category words ("1. Brow Studio", "### 3. Beauty Club London")
      // or with an area inside ("3. The Hair Palace Dubai by Ozzy").
      const listedOnNumberedLine = label.kind === "numbered";
      const readsAsName =
        nameAt !== -1 && nameAt + name.length <= label.labelEnd && tokens.length <= 8 && /^[A-Z0-9]/.test(name) && !name.includes("/") &&
        !categoryTerms.has(normalizeName(name)) &&
        (listedOnNumberedLine || !isGenericPhrase(name, categoryTerms)) &&
        !(isKnownPlace(name, places) && !(listedOnNumberedLine && looksLikeBusiness(name, categoryTerms))) &&
        !CALENDAR_AND_UNITS.test(name) && !URL_LIKE.test(name) && !JARGON.test(name) &&
        // A list label can be a heading ("**Best for colour** —", "**Budget pick** —",
        // "**Attribution/reporting** —"); a map entry is always a name.
        (label.kind === "map" ||
          // "**Only U nail salon** —" names its kind, so its first word is part of the name.
          // "### 1. The Extensionist Dubai" opens with "The" and is still a name.
          ((looksLikeBusiness(name, categoryTerms) || ((!SENTENCE_START_STOPWORDS.has(first) || first === "The") && ((listedOnNumberedLine && first === "The") || !SENTENCE_FRAGMENT_WORDS.has(firstKey)) && !LABEL_WORDS.has(firstKey) && (firstKey === "the" || !LEADING_FRAGMENT_WORDS.has(firstKey)))) &&
            !tokens.slice(1).some((token) => /^[a-z]/.test(token) && !connector(token) && !categoryTerms.has(normalizeName(token)) && !isBusinessTypeWord(token))));
      const business =
        looksLikeBusiness(name, categoryTerms) || shapedToken(first) ||
        (label.kind === "map" ? looksLikeBusiness(label.label, categoryTerms) || (label.listingKind !== null && looksLikeBusiness(label.listingKind, categoryTerms)) : looksLikeBusiness(label.description, categoryTerms));
      const placeOnly = placeLike(name, places) && !looksLikeBusiness(name, categoryTerms) && label.listingKind === null;
      return { label, insideLinked, name, nameAt, tokens, readsAsName, business, placeOnly };
    });
    // A name one label proves ("Riviera by Jean Imbert" above "4.8•Mediterranean
    // restaurant") is the same name in the answer's other labels and sentences.
    const proven = new Set(judged.filter((j) => !j.insideLinked && j.readsAsName && j.business && !j.placeOnly).map((j) => j.name));
    for (const j of judged) {
      const option = !j.insideLinked && j.readsAsName && !j.placeOnly && (j.business || proven.has(j.name));
      // A map entry is a listing whatever it turns out to be; its words are not separate names.
      if (option || j.label.kind === "map") claimed.push([j.label.labelStart, j.label.labelEnd] as const);
      if ((option || j.insideLinked) && j.label.descriptorEnd > j.label.labelEnd) descriptorZones.push([j.label.labelEnd, j.label.descriptorEnd]);
    }
    for (const name of proven) {
      const key = normalizeName(name);
      const entry = byName.get(key) ?? { name, spans: [], midSentence: 0, outsideLink: 0, thing: 0, cue: 0, multiWord: false, listed: true, whole: true, inCategory: true };
      for (const match of text.matchAll(new RegExp(`(?<![A-Za-z0-9])${escapeRegex(name)}(?![A-Za-z0-9])`, "g"))) {
        const at = match.index!;
        if (entry.spans.some((span) => span.start === at) || claimed.some(([s, e]) => at < e && at + name.length > s && !judged.some((j) => j.name === name && j.nameAt === at))) continue;
        entry.spans.push({ start: at, end: at + name.length, text: name });
        claimed.push([at, at + name.length] as const);
        entry.midSentence += 1;
        entry.outsideLink += 1;
        entry.cue += 1;
      }
      if (name.includes(" ")) entry.multiWord = true;
      byName.set(key, entry);
    }
  }
  // A name written as a place, a product or a person anywhere in the answer is one everywhere in it.
  const rejected = new Set<string>();
  const rejectedPlaces = new Set<string>();
  const rejectedThings = new Set<string>();
  const placeOrRejected = (item: string) => placeLike(item, places) || rejectedPlaces.has(normalizeName(item));
  for (const match of text.matchAll(PROPER_RUN)) {
    const raw = match[1]!;
    const start = match.index!;
    const end = start + raw.length;
    if (overlaps(start, end)) continue;

    // Strip contractions before the stopword test: the proper-noun run
    // matched "I'd" and "I'll", whose head token is not literally "I", so a
    // first-person contraction was proposed as an emerging brand six times.
    const head = raw.split(/\s+/)[0]!.replace(/['’](?:d|ll|ve|re|m|s|t)$/i, "");
    if (/^[A-Z]$/.test(head)) continue;
    // What follows an option's dash up to the full stop says where it is or
    // what it is ("— Azizi Riviera.", "— 6th floor, Staybridge Suites, DIFC."),
    // unless it introduces another name ("— or try Y12").
    if (descriptorZones.some(([zoneStart, zoneEnd]) => start >= zoneStart && start < zoneEnd) && !BRAND_INTRODUCER.test(text.slice(Math.max(0, start - 30), start))) continue;
    // Capitals at the start of a sentence, a line, a list item, a heading, a
    // table cell, a bold label or the description after a dash are grammar
    // and formatting, not evidence of a name. Answers use "Budget", "Fit",
    // "Quick", "— Convenient" and "— Opens 5:30 AM" that way.
    const before = text.slice(0, start);
    const precedingChar = before.trimEnd().slice(-1);
    const linePrefix = before.slice(before.lastIndexOf("\n") + 1);
    const sentenceInitial =
      start === 0 ||
      precedingChar === "" ||
      ".!?:|—–•".includes(precedingChar) ||
      /\s-\s*$/.test(before) ||
      /^[\s>*#+\-|\d.()]*$/.test(linePrefix) ||
      // A heading is title case throughout, and a sentence after a bold label
      // ("**Tip:** Even if…") starts fresh.
      /^\s*#/.test(linePrefix) ||
      before.trimEnd().endsWith("**");
    if (SENTENCE_START_STOPWORDS.has(head)) continue;
    if (SENTENCE_START_STOPWORDS.has(raw)) continue;
    if (raw.length < 3 || head.length < 2) continue;
    // "Click & Collect", "Mitchell & Ness": halves of a compound are not names
    // on their own; "Pipedrive + Slack" pairs an integration, not a rival;
    // "Zapier/automation platforms" and "Partner/referral" name a kind.
    const afterText = text.slice(end, end + 24);
    if (/[&+]\s*$/.test(before.slice(-3)) || /^\s*[&+]/.test(afterText)) continue;
    if (/^\/[a-z]/.test(afterText) || /[a-z]\/$/.test(before.slice(-2))) continue;
    // A quoted term (“Lead Source”, “ABC Inc.”) is an example or a field, not a business.
    if (/[“"]$/.test(before.slice(-1)) && /^[.,]?[”"]/.test(afterText)) continue;
    if (PERSON_TITLE.test(raw.split(/\s+/)[0]!)) continue;

    let key = cleanCandidate(raw);
    if (key.length < 3) continue;
    if (CALENDAR_AND_UNITS.test(key) || ACRONYM_PLURAL.test(key) || URL_LIKE.test(key) || JARGON.test(key)) continue;
    if (key.split(/\s+/).some((token) => COMPOUND_QUALIFIER.test(token))) continue;
    // One ordinary capitalised word ("Dedicated", "Another", "Olympic") is a
    // fragment of a sentence, not a name; single-word brands (Hoka, Nobu)
    // stay and, with a category in hand, must sit in a sentence about it.
    if (!key.includes(" ") && (SENTENCE_FRAGMENT_WORDS.has(key.toLowerCase()) || LABEL_WORDS.has(key.toLowerCase()) || DIRECTION_WORDS.has(key.toLowerCase()) || MODIFIER_WORDS.has(key.toLowerCase()))) continue;
    // The category itself ("CrossFit", "Trainers", "Pilates") is what is sold,
    // not who sells it; so is a phrase made only of category, cuisine and
    // dish words ("South Indian", "Running Apparel", "Chicken Biryani"), or of
    // compass and filler words alone ("West Coast").
    if (categoryTerms.has(normalizeName(key))) continue;
    if (contextual && isGenericPhrase(key, categoryTerms)) continue;
    if (contextual && key.includes(" ") && key.split(/\s+/).every((token) => { const k = token.toLowerCase(); return DIRECTION_WORDS.has(k) || SENTENCE_FRAGMENT_WORDS.has(k) || LABEL_WORDS.has(k) || LEADING_FRAGMENT_WORDS.has(k); })) continue;

    // Where the run sits: the line, the sentence, the paragraph, the list.
    const lineStart = before.lastIndexOf("\n") + 1;
    const lineEnd = text.indexOf("\n", end);
    const line = text.slice(lineStart, lineEnd === -1 ? text.length : lineEnd);
    const sentence = line.split(/(?<=[.!?])\s+/).find((part) => part.includes(raw)) ?? line;
    const neighbours = listNeighbours(text, start, end);
    const labelTail = text.slice(end, end + 8);
    const bulletHead = /^\s*(?:[-*•]|\d+[.)])\s+(?:\*\*)?$/.test(linePrefix);
    const dashAfter = /^(?:\*\*)?(?:\s*[–—]|\s+-\s)/.test(labelTail);
    // A bold colon label in a list ("* **Durability:** Nike…") is a field name, so only a dash counts.
    const restOfLine = text.slice(end, lineEnd === -1 ? text.length : lineEnd);
    // A one-word label followed by two or more other names ("**Tennis** —
    // Nike Court, Adidas Barricade, Asics Gel") heads a group, not an option.
    const otherNamesOnLine = (restOfLine.match(/\b[A-Z][A-Za-z0-9]+(?:[ \t]+[A-Z][A-Za-z0-9]+)*/g) ?? []).filter((name) => name.length >= 4 && !placeLike(name, places) && !WORLD_PLACE.test(name)).length;
    const listLabel = contextual && bulletHead && dashAfter && !(!raw.includes(" ") && otherNamesOnLine >= 2);
    // The whole first cell of a table row ("| Insightly | Professional services firms |") lists an option; a header row does not.
    const nextLine = lineEnd === -1 ? "" : text.slice(lineEnd + 1, text.indexOf("\n", lineEnd + 1) === -1 ? text.length : text.indexOf("\n", lineEnd + 1));
    const tableHead = contextual && /^\s*\|\s*(?:\*\*)?\[?$/.test(linePrefix) && /^(?:\]\([^)]*\))?\s*(?:\*\*)?\s*\|/.test(restOfLine) && !/^\s*\|\s*-{3,}/.test(nextLine) && optionTable(text, lineStart, categoryTerms);

    // The answer asking what the reader uses ("If you tell me what tools you
    // need to connect (e.g., Gmail, Outlook, QuickBooks…)", "whether you do
    // B2B/B2C") names examples, not recommendations; so does an open list
    // ending "etc." or a flow of steps written with arrows.
    if (contextual && !listLabel && !tableHead) {
      // A list item under "If you tell me:" belongs to the request, with or without a blank line between.
      const listItem = /^\s*(?:[-*•]|\d+[.)])\s/.test(linePrefix + raw);
      const lead = text.slice(Math.max(0, lineStart - 240), lineStart).replace(/\s+$/, "");
      const underClarifying = listItem && /:$/.test(lead) && CLARIFYING.test(lead.split(/\n\s*\n/).pop() ?? "");
      if (CLARIFYING.test(sentence) || underClarifying) continue;
      if (EXAMPLE_LIST.test(sentence) && (neighbours.previous !== null || neighbours.next !== null)) continue;
      if (FLOW_ARROW.test(line)) {
        let cursor = lineStart;
        let step = false;
        for (const segment of line.split(FLOW_ARROW)) {
          const segmentEnd = cursor + segment.length;
          if (start >= cursor && end <= segmentEnd && !/^(?:→|->|⇒|=>)$/.test(segment)) step = segment.trim().split(/\s+/).length <= 6;
          cursor = segmentEnd;
        }
        if (step) continue;
      }
    }

    // A cited source ("[AE Profile](ae-profile.com)", "[CRM Compared](crmcompared.com)")
    // is where a fact came from, not a business the answer recommends. A link
    // to the business's own site that opens a table row or list item is an
    // option the answer lists ("| [Mailchimp](mailchimp.com) | Beginners |").
    const link = linkLabelAround(text, start, end);
    const linkHead = link !== null && /^\s*\|?\s*(?:[-*•]|\d+[.)])?\s*(?:\*\*)?\s*\[$/.test(linePrefix);
    if (link && (!hostNamesLabel(link.host, key) || !linkHead)) continue;
    const linkOption = link !== null && linkHead;

    // Places: the project's own, the shape of one, an area code without any
    // brand cue, a name the same answer writes before a place word ("Ibn
    // Battuta Mall"), one written after "in", "near", "across", or one listed
    // beside places ("Al Quoz, DIFC, Ibn Battuta", "Downtown/Burj Khalifa").
    // A name that says what kind of business it is never counts as a place.
    const multiWord = key.includes(" ");
    const beforeStrip = key;
    key = withoutTrailingPlace(key, places, categoryTerms);
    if (key.length < 3 || isKnownPlace(key, places)) continue;
    // "Authentic North Karnataka" minus its place is nothing.
    if (contextual && key !== beforeStrip && isOnlyFiller(key, categoryTerms)) continue;
    const norm = normalizeName(key);
    const tokens = key.split(/\s+/);
    const named = looksLikeBusiness(key, categoryTerms);
    const capitalisedNeighbour = (item: string | null) => item !== null && /^[A-Z][a-z]/.test(item) && !placeLike(item, places);
    const brandCue = listLabel || tableHead || linkOption || BRAND_INTRODUCER.test(before.slice(-30)) || SUBJECT_VERB_AFTER.test(afterText) || capitalisedNeighbour(neighbours.previous) || capitalisedNeighbour(neighbours.next);
    const placeShaped =
      WORLD_PLACE.test(key) ||
      PLACE_SUFFIX.test(key) ||
      ARABIC_PLACE_PREFIX.test(key) ||
      (AREA_CODE.test(key) && !brandCue) ||
      (tokens.length <= 2 && TOPONYM_ENDING.test(tokens[tokens.length - 1]!)) ||
      PLACE_WORD_AFTER.test(afterText) ||
      LOCATIVE_BEFORE.test(before.slice(-24)) ||
      PLACE_INTRODUCER.test(before.slice(-40)) ||
      (neighbours.previous !== null && placeOrRejected(neighbours.previous)) ||
      (neighbours.next !== null && placeLike(neighbours.next, places));
    if (placeShaped && !named) {
      rejected.add(norm);
      rejectedPlaces.add(norm);
      continue;
    }
    // Products and technologies of the tracked brands ("Nike Pegasus 40" makes
    // "Pegasus" a product), model numbers ("Air Force 1", "Nano X3"), things
    // followed by "foam", "fabric", "line" or "shoes", ingredients, people,
    // shopping or lead-source channels, teams and technologies are not
    // businesses either; nor is a feature ("the Quick Help menu").
    if (FEATURE_WORD_AFTER.test(afterText) && !listLabel && !tableHead && !linkOption) continue;
    const byOrFrom = afterText.match(/^\s+(?:by|from)\s+/);
    const modelShaped = MODEL_NUMBER_AFTER.test(afterText) || (tokens.length >= 2 && MODEL_TOKEN.test(tokens[tokens.length - 1]!)) || (!named && THING_WORD_AFTER.test(afterText));
    const product =
      products.has(norm) ||
      products.has(stem(norm)) ||
      modelShaped ||
      (byOrFrom !== null && mentionStartsAt(end + byOrFrom[0].length)) ||
      (!named && contextual && INGREDIENT_CONTEXT.test(sentence));
    const person = !named && tokens.length >= 2 && tokens.length <= 3 && PERSON_CONTEXT.test(sentence);
    const channel = !named && CHANNEL_BEFORE.test(before.slice(-12)) && (SHOPPING_CONTEXT.test(sentence) || SOURCE_CONTEXT.test(sentence));
    const team = !named && (TEAM_BEFORE.test(before.slice(-30)) || TEAM_AFTER.test(afterText));
    const tech = !named && contextual && (TECH_INTRODUCER.test(before.slice(-30)) || (neighbours.previous !== null && rejectedThings.has(normalizeName(neighbours.previous))));
    if (product || person || channel || team || tech) {
      rejected.add(norm);
      if (tech || product) rejectedThings.add(norm);
      // "Vans Old Skool", "Cetaphil Moisturising Lotion", "Gymshark Performance T-Shirt": the
      // product is dropped but its maker is a brand the answer named.
      const maker = tokens[0]!;
      const restGeneric = tokens.length >= 2 && tokens.slice(1).every((token) => isOnlyFiller(token, categoryTerms) || MODEL_TOKEN.test(token) || /^\d/.test(token));
      if ((modelShaped || products.has(norm)) && restGeneric && lettersOnly(maker).length >= 4 && !isOnlyFiller(maker, categoryTerms) && !placeLike(maker, places) && !products.has(normalizeName(maker))) {
        key = maker;
      } else continue;
    }
    // A brand's product with generic words only ("Gymshark Performance
    // T-Shirt", "HubSpot Sales Hub", "Salesforce Marketing Cloud") is the brand.
    if (tokens.length >= 2 && !modelShaped && !rejected.has(norm) && tokens.slice(1).every((token) => isOnlyFiller(token, categoryTerms)) && !isOnlyFiller(tokens[0]!, categoryTerms) && lettersOnly(tokens[0]!).length >= 4 && (shapedToken(tokens[0]!) || !named) && !businessTypeTail(tokens[tokens.length - 1]!)) key = tokens[0]!;
    const finalNorm = normalizeName(key);
    const finalTokens = key.split(/\s+/);
    // "Leads Inbox", "Conversations Inbox", "Marketing Cloud": a module named for its function.
    if (finalTokens.length >= 2 && MODULE_TAIL.test(finalTokens[finalTokens.length - 1]!) && !shapedToken(finalTokens[0]!)) continue;

    const entry = byName.get(finalNorm) ?? { name: key, spans: [], midSentence: 0, outsideLink: 0, thing: 0, cue: 0, multiWord: false, listed: false };
    entry.spans.push({ start, end, text: raw });
    // "Athleaders UAE" was two words in the answer even once its place is cut.
    if (multiWord) entry.multiWord = true;
    if (!link || linkOption) entry.outsideLink += 1;
    // A list entry followed by a dash ("* **Origin Fit** – a boutique gym…",
    // "* Athleaders Global — offers a trainer"), a table row opening with the
    // name, an own-site link opening a row, and a map listing with the rating
    // on the next line ("4.8•Fitness center") are how answers list providers.
    // Each counts as evidence when a category is known to check against.
    const listingLine = /^\s*$/.test(linePrefix) && (/^\s*$/.test(restOfLine) || /^\s*\|/.test(restOfLine));
    const below = lineEnd === -1 ? "" : text.slice(lineEnd, lineEnd + 60);
    const ratingBelow = listingLine && /^\s*\n\s*\n?\s*\d\.\d\b/.test(below);
    const listingKind = ratingBelow ? below.match(/^\s*\n\s*\n?\s*\d\.\d\s*•\s*([^\n•]+)/)?.[1] ?? null : null;
    const listing = contextual && ratingBelow && (named || (listingKind !== null && looksLikeBusiness(listingKind, categoryTerms)));
    const listed = listLabel || tableHead || linkOption || listing;
    if (listed) entry.listed = true;
    // Two capitalised words opening a sentence that then continues in lower
    // case ("**Cost:** Under Armour undercuts…") are a name, not grammar; a
    // title-case heading has no lower-case continuation.
    const continuesLowercase = finalTokens.length >= 2 && /^\s+[a-z]/.test(afterText) && !/^\s*#/.test(linePrefix);
    if (!sentenceInitial || listed || continuesLowercase) entry.midSentence += 1;
    // "boxing, HYROX and performance training": one word listed among
    // lower-case things is a thing, not a business; "trainers, and Adidas or
    // New Balance" lists it among names.
    if (contextual && !listed && !named && !BRAND_INTRODUCER.test(before.slice(-30))) {
      const among = lowercaseItem(neighbours.previous) && (lowercaseItem(neighbours.next) || (neighbours.next === null && lowercaseItem(neighbours.beforePrevious)));
      const opens = neighbours.previous === null && lowercaseItem(neighbours.next) && lowercaseItem(neighbours.afterNext);
      if ((finalTokens.length === 1 && among) || opens) entry.thing += 1;
    }
    // One word on its own needs a reason to be a brand: the shape of one
    // (GymNation, NOBULL, F45), a list entry, an introduction ("brands like
    // Hoka", "vs Saucony"), a business verb, or a place in a list of names.
    if (shapedToken(key) || listed || brandCue) entry.cue += 1;
    // Was this occurrence in a sentence or line that names the kind of business?
    if (named || listed || looksLikeBusiness(sentence, categoryTerms)) entry.inCategory = true;
    byName.set(finalNorm, entry);
  }

  // What the answer writes after a name it kept is that name's product or
  // branch: "Lululemon Align", "Hoka Clifton", "Truffles Koramangala".
  {
    const ends: number[] = [];
    for (const entry of byName.values()) for (const span of entry.spans) ends.push(span.end);
    for (const form of productFormsAfter(text, ends)) {
      const entry = byName.get(form);
      if (entry && !looksLikeBusiness(entry.name, categoryTerms)) byName.delete(form);
    }
  }

  // "Gold's" beside "Gold's Gym", "MH3" beside "MH3 Gym", "Origin" beside
  // "Origin Fit": the short form is the same business. "Warehouse" and
  // "Warehouse CrossFit" beside a tracked "The Warehouse Gym" are that gym.
  const firstToken = (norm: string) => norm.split(" ")[0]!.replace(/'s$/, "");
  for (const [norm, entry] of [...byName.entries()]) {
    const tokens = norm.split(" ");
    const first = firstToken(norm);
    if (trackedHeads.has(first) && (tokens.length === 1 || tokens.length === 2 || tokens.slice(1).every((token) => categoryTerms.has(token)))) {
      byName.delete(norm);
      continue;
    }
    if (tokens.length !== 1) continue;
    const longer = [...byName.entries()].filter(([other]) => other !== norm && other.includes(" ") && firstToken(other) === first);
    if (longer.length === 0) continue;
    const [longerNorm, longerEntry] = longer.sort((a, b) => Number(looksLikeBusiness(b[1].name, categoryTerms)) - Number(looksLikeBusiness(a[1].name, categoryTerms)) || b[1].spans.length - a[1].spans.length)[0]!;
    // "GymNation" beside "GymNation Downtown" is the brand and its branch, and
    // "HubSpot" (nine times) beside "HubSpot Sales Hub" (twice) is the brand and
    // its module: the brand is the name to keep. "MH3" beside "MH3 Gym" is the reverse.
    const extra = longerEntry.name.split(/\s+/).slice(1);
    // A whole option label ("House of Burn", "Riviera by Jean Imbert") is the name as listed; its head alone is a short form.
    const keepShort =
      longerEntry.whole && !entry.whole
        ? false
        : looksLikeBusiness(entry.name, categoryTerms) || PLACE_SUFFIX.test(longerEntry.name) || entry.spans.length > longerEntry.spans.length || extra.some((token) => MODULE_TAIL.test(token)) || !extra.some(businessTypeTail);
    const [into, from, dropNorm] = keepShort ? [entry, longerEntry, longerNorm] : [longerEntry, entry, norm];
    into.spans.push(...from.spans);
    into.midSentence += from.midSentence;
    into.outsideLink += from.outsideLink;
    into.cue += from.cue;
    into.multiWord = into.multiWord || from.multiWord;
    into.listed = into.listed || from.listed;
    into.inCategory = into.inCategory || from.inCategory;
    byName.delete(dropNorm);
  }

  // "UB Grooming" beside a listed "UB Grooming Salon", "Eyelash Secret" beside
  // "Eyelash Secret Ladies Salon": the listed name is the business, and the
  // shorter run is how the answer refers back to it. One DIFC barber answer
  // counted UB Grooming twice (observation-analysis@18).
  for (const [norm, entry] of [...byName.entries()]) {
    if (entry.whole || !norm.includes(" ")) continue;
    const longer = [...byName.entries()].find(([other, otherEntry]) => {
      if (other === norm || !otherEntry.whole || !other.startsWith(`${norm} `)) return false;
      const extra = other.slice(norm.length + 1).split(" ");
      return extra.length <= 2 && businessTypeTail(extra[extra.length - 1]!);
    });
    if (!longer) continue;
    const into = longer[1];
    into.spans.push(...entry.spans);
    into.midSentence += entry.midSentence;
    into.outsideLink += entry.outsideLink;
    into.cue += entry.cue;
    into.listed = into.listed || entry.listed;
    into.inCategory = into.inCategory || entry.inCategory;
    byName.delete(norm);
  }

  // A name is written capitalised where grammar does not require it at least
  // once; a word only ever capitalised by position is not evidence of a brand.
  // A word the same answer also writes in lower case is an ordinary word
  // capitalised by position or emphasis ("Even", "Great", "the Right Pair").
  // A URL ("athleaders.ae/booking") is not the answer writing the name in lower case.
  const prose = text.replace(/https?:\/\/[^\s)]+/g, " ").replace(/\b[a-z0-9-]+\.(?:com|ae|in|co|io|net|org|uk|app)\b/g, " ");
  const writtenLowercase = (name: string) => new RegExp(`\\b${escapeRegex(name.toLowerCase())}\\b`).test(prose);
  return [...byName.entries()]
    .filter(([norm, entry]) => entry.midSentence > 0 && !writtenLowercase(entry.name) && !rejected.has(norm) && !rejected.has(stem(norm)) && entry.thing === 0)
    // Only ever inside trailing citations: a source site, not a business the answer names.
    .filter(([, entry]) => entry.outsideLink > 0)
    // With a category in hand, an untracked name must be a business of that
    // kind: named with a category word, listed as a provider, or in a
    // sentence that names the kind; and one word alone needs a cue or a
    // second mention.
    .filter(([, entry]) => !contextual || entry.inCategory === true)
    .filter(([, entry]) => !contextual || entry.multiWord || looksLikeBusiness(entry.name, categoryTerms) || entry.spans.length >= 2 || entry.cue > 0)
    .map(([, entry]) => ({ name: entry.name, spans: entry.spans.sort((a, b) => a.start - b.start), listed: entry.listed }));
}

/**
 * Links a tracked business by its one-word head ("Warehouse" for "The
 * Warehouse Gym", "Gold's" for "Gold's Gym") inside an answer that has
 * already named it in full. A one-word head is never a stored form, because
 * it would match ordinary text in other answers; here the same answer proves
 * it, the head is a proper noun of five or more letters, the words dropped
 * are business-type words, and the answer never writes the head in lower
 * case. Seventeen "Warehouse" mentions of a Dubai gym were being counted as
 * an untracked brand.
 */
export function linkProvenHeadForms(text: string, mentions: DetectedMention[], targets: LinkTarget[], categoryTerms: string[] = []): DetectedMention[] {
  const linkedIds = new Set(mentions.map((mention) => mention.entityId).filter((id): id is string => id !== null));
  if (linkedIds.size === 0) return mentions;
  const terms = new Set(categoryTerms.map(normalizeName));
  const surfaces = new Set(targets.map((target) => target.surface.toLowerCase()));
  const claimed: Array<[number, number]> = mentions.map((mention) => [mention.span.start, mention.span.end]);
  const overlaps = (start: number, end: number) => claimed.some(([s, e]) => start < e && end > s);
  const extra: DetectedMention[] = [];
  for (const target of targets) {
    if (target.surfaceForm !== "exact_name" || !linkedIds.has(target.entityId)) continue;
    const tokens = target.canonicalName.trim().replace(/^(?:the|a|an)\s+/i, "").split(/\s+/);
    if (tokens.length < 2) continue;
    const head = tokens[0]!;
    const headKey = normalizeName(head);
    if (lettersOnly(head).length < 5 || !/^[A-Z]/.test(head) || terms.has(headKey) || SENTENCE_FRAGMENT_WORDS.has(headKey) || surfaces.has(head.toLowerCase())) continue;
    if (!tokens.slice(1).every((token) => isBusinessTypeWord(token.replace(/[^A-Za-zé]/g, "")))) continue;
    const pattern = new RegExp(`(?<![A-Za-z0-9/.=_-])${escapeRegex(head).replace(/['’]/g, "['’]")}(?![A-Za-z0-9])`, "g");
    if (new RegExp(`\\b${escapeRegex(head.toLowerCase())}\\b`).test(text)) continue;
    for (const match of text.matchAll(pattern)) {
      const start = match.index!;
      const end = start + match[0].length;
      if (overlaps(start, end)) continue;
      claimed.push([start, end]);
      const surfaceTarget: LinkTarget = { ...target, surface: head, surfaceForm: "alias", requiresCapital: true };
      extra.push({
        entityId: target.entityId,
        name: target.canonicalName,
        relation: target.relation,
        surfaceForm: "alias",
        productSurface: null,
        span: { start, end, text: match[0] },
        confidence: confidenceForMatch(text, start, end, surfaceTarget),
      });
    }
  }
  return extra.length === 0 ? mentions : [...mentions, ...extra].sort((a, b) => a.span.start - b.span.start);
}
