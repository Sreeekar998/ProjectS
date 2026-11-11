import { shortNameForms } from "@/lib/landscape/name-forms";
import { parse as parseTld } from "tldts";
import type { BusinessProfile } from "@/lib/profile/schema";
import type { Location } from "@/lib/geography/repository";
import type { CandidatePromptDraft } from "./types";
import { inferRegister, KEYWORD_INTENT } from "./natural-validator";
import { countryCodesMentioned, countryName } from "@/lib/geo/countries";
import { placesMentioned } from "./geography";

export interface ForbiddenTerm {
  type: "canonical_name" | "alias" | "domain" | "sub_brand" | "product_line" | "identifying_phrase" | "competitor";
  value: string;
  normalized: string;
  confidence: number;
  source: string;
}

export interface ValidationResult {
  pass: boolean;
  code?: string;
  reason?: string;
}

function normalizeTerm(term: string): string {
  return term
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/[^a-z0-9\s]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

const GENERIC_CATEGORY_TERMS = new Set(["crm", "running shoes", "hotel", "cardiology", "mortgage", "restaurant", "software", "healthcare", "bank"]);

const LEGAL_SUFFIXES = new Set(["co", "corp", "corporation", "inc", "llc", "ltd", "limited", "plc", "llp", "pty", "gmbh", "fz", "fze", "fzco", "fzllc", "group", "company"]);

/** True when `rest` splits entirely into known words ("dentalclinic" → dental + clinic). */
function splitsInto(rest: string, words: Set<string>): boolean {
  const reachable = [true, ...Array.from({ length: rest.length }, () => false)];
  for (let end = 1; end <= rest.length; end += 1) {
    for (let start = 0; start < end && !reachable[end]; start += 1) {
      if (reachable[start] && words.has(rest.slice(start, end))) reachable[end] = true;
    }
  }
  return reachable[rest.length]!;
}

/** Words of the business's own category (salon, dental, clinic, plumbing) plus legal suffixes. */
function categoryWords(profile: BusinessProfile): Set<string> {
  const classification = profile.classification;
  const categoryText = [
    classification?.businessType,
    classification?.localCategory,
    ...(classification?.path ?? []),
    profile.industry.primary,
    profile.industry.secondary,
    typeof profile.industry.value === "string" ? profile.industry.value : null,
  ]
    .filter((value): value is string => typeof value === "string")
    .join(" ")
    .toLowerCase();
  const words = (categoryText.match(/[a-z]+/g) ?? []).filter((word) => word.length >= 3);
  return new Set([...LEGAL_SUFFIXES, ...words, ...words.map((word) => `${word}s`)]);
}

/**
 * The one word of a multi-word brand name that names the business on its own.
 *
 * "Laurance Hair & Beauty Salon" on laurancesalon.com is called "Laurance",
 * and a template Discovery prompt asking for "the laurance bridal brands"
 * passed the leakage gate because only the full name, aliases and the domain
 * label "laurancesalon" were forbidden. The first word counts when the
 * company's own domain is exactly that word plus generic words — words from
 * the business's own category (salon, dental clinic, plumbing) or a legal
 * suffix — and the word itself is not one of those category words. So
 * "Hair Boutique Salon" (hair is its category) and "The Quality Chop House"
 * (the domain starts with "the") give none, and no dictionary is needed.
 */
export function brandCoreWord(profile: BusinessProfile): string | null {
  const tokens = profile.identity.brandName.value.toLowerCase().split(/\s+/).map((token) => token.replace(/[^a-z0-9]/g, "")).filter(Boolean);
  const first = tokens[0];
  if (!first || tokens.length < 2 || first.length < 4 || /^\d+$/.test(first)) return null;
  const generic = categoryWords(profile);
  if (generic.has(first)) return null;
  for (const domain of profile.identity.domains) {
    const label = (parseTld(domain).domainWithoutSuffix ?? "").toLowerCase().replace(/[^a-z0-9]/g, "");
    if (!label.startsWith(first)) continue;
    const rest = label.slice(first.length);
    if (rest.length === 0 || splitsInto(rest, generic)) return first;
  }
  return null;
}

export function buildTargetLeakageLexicon(profile: BusinessProfile): ForbiddenTerm[] {
  const terms = new Map<string, ForbiddenTerm>();
  const addTerm = (t: string | undefined | null, type: ForbiddenTerm["type"], confidence: number, source: string) => {
    if (!t) return;
    const normalized = normalizeTerm(t);
    if (normalized.length < 2 || (type !== "canonical_name" && type !== "alias" && type !== "domain" && GENERIC_CATEGORY_TERMS.has(normalized))) return;
    const existing = terms.get(normalized);
    if (!existing || confidence > existing.confidence) terms.set(normalized, { type, value: t, normalized, confidence, source });
  };
  addTerm(profile.identity.brandName.value, "canonical_name", 100, "confirmed_profile");
  addTerm(`${profile.identity.brandName.value}s`, "canonical_name", 95, "derived_plural");
  for (const alias of profile.identity.aliases.values) addTerm(alias, "alias", profile.identity.aliases.confidence, "confirmed_profile");
  // Shorter forms people use ("Atelier 10" for "Atelier 10 Salon"), by the same
  // generic rule rival names use, and the brand's own core word (see above).
  // A form made only of category words ("Pizza" from "Pizza Kitchen") would
  // forbid the category itself, so those are skipped.
  const generic = categoryWords(profile);
  for (const form of shortNameForms(profile.identity.brandName.value, [profile.identity.canonicalDomain, ...profile.identity.domains])) {
    if (normalizeTerm(form).split(" ").every((word) => generic.has(word))) continue;
    addTerm(form, "alias", 90, "derived_short_name");
  }
  addTerm(brandCoreWord(profile), "alias", 85, "derived_core_word");
  for (const domain of profile.identity.domains) {
    addTerm(domain, "domain", 100, "confirmed_profile");
    const parsed = parseTld(domain);
    if (parsed.domainWithoutSuffix) addTerm(parsed.domainWithoutSuffix, "domain", 100, "derived_domain");
  }
  for (const offering of profile.offerings.items) {
    const looksProprietary = /[®™]/.test(offering.name) || offering.name.toLowerCase().includes(profile.identity.brandName.value.toLowerCase());
    if (looksProprietary && offering.confidence >= 70) addTerm(offering.name, "product_line", offering.confidence, "confirmed_offering");
  }
  return [...terms.values()];
}

export function buildForbiddenBrandTerms(profile: BusinessProfile): string[] {
  return buildTargetLeakageLexicon(profile).map((term) => term.normalized);
}

export function buildCompetitorForbiddenTerms(
  competitors: Array<{ canonicalName: string; aliases?: string[]; canonicalDomain?: string | null; domains?: string[] }>,
): string[] {
  const values = competitors.flatMap((competitor) => [
    competitor.canonicalName,
    ...(competitor.aliases ?? []),
    // The shorter name people use ("Pancheros" for "Pancheros Mexican Grill"):
    // a Trade Off prompt written that way does name the rival, and a Discovery
    // prompt written that way does leak it.
    ...shortNameForms(competitor.canonicalName, [competitor.canonicalDomain, ...(competitor.domains ?? [])]),
    competitor.canonicalDomain ?? "",
    ...(competitor.domains ?? []),
  ]);
  return [...new Set(values.map(normalizeTerm).filter((value) => value.length >= 2))];
}

/** Word-boundary scan for the target brand's canonical name, aliases, owned
 * domains, and possessive/plural forms. This is the single most important
 * gate in the whole pipeline: a neutral prompt that leaks the brand invalidates
 * the entire measurement, not just one row. */
export function scanForBrandLeakage(text: string, forbiddenTerms: string[]): { leaked: boolean; matchedTerm?: string } {
  const normalized = normalizeTerm(text);
  const tokens = normalized.split(" ");
  for (const term of forbiddenTerms) {
    if (term.includes(" ")) {
      if (normalized.includes(term)) return { leaked: true, matchedTerm: term };
    } else if (tokens.includes(term)) {
      return { leaked: true, matchedTerm: term };
    }
  }
  return { leaked: false };
}

const LEADING_PATTERNS = [
  /\bisn'?t\b.*\b(clearly|obviously|best|better)\b/i,
  /\bwhy is\b.*\b(best|better|superior|number one|#1)\b/i,
  /\bdon'?t you think\b/i,
  /\bwouldn'?t you agree\b/i,
  /\bobviously the best\b/i,
  /\bclearly superior\b/i,
];

const UNSTABLE_TEMPORAL_PATTERNS = [/\btoday\b/i, /\bthis week\b/i, /\byesterday\b/i, /\btomorrow\b/i, /\bright now\b/i, /\bcurrently trending\b/i];
// "Near my office" and "closer to my place" depend on where the asker is just as
// "near me" does: a Trade Off asking which rival is closer to the asker's
// office measures the observer's location, not the brands.
const UNCONTROLLED_NEAR_ME_PATTERN =
  /\b(near|nearby|close to|closer to|closest to|nearest to|around) (me|my (office|home|house|place|work|workplace|school|campus|hotel|apartment|flat))\b/i;

const REGULATED_ADVICE_PATTERNS: Record<"healthcare" | "finance" | "legal", RegExp[]> = {
  healthcare: [/\bwhat medication should i take\b/i, /\bdiagnose my\b/i, /\bam i (sick|dying)\b/i, /\bwhat'?s wrong with me\b/i, /\bshould i take\b.*\b(dose|dosage|medication|pill)\b/i],
  finance: [/\bshould i invest\b/i, /\bwhich stock should i buy\b/i, /\bhow should i invest my\b/i, /\bam i approved for\b/i],
  legal: [/\bshould i sue\b/i, /\bwhat'?s my legal liability\b/i, /\bdo i have a case\b/i],
};

/** Openings that make a non-interrogative text a real buyer query. */
const STATEMENT_QUERY_OPENING =
  /^(best|top|cheapest|affordable|leading|recommend|suggest|find|compare|list|show)\b|\b(vs|alternatives?|reviews?|near me)\b/i;

/**
 * A decision stated rather than asked — "Torn between Nike and Brooks for my
 * first marathon." People type comparisons this way at least as often as they
 * phrase a question, and it asks for a verdict just as plainly. The query guard
 * was rejecting seven of Nike's provider-written Trade Off prompts for it.
 */
const DECISION_STATEMENT =
  /\b(torn between|stuck between|deciding between|choosing between|trying to (decide|choose|pick|figure out)|can'?t decide|cannot decide|wondering (if|whether|which)|debating (between|whether))\b/i;

function escapePattern(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function questionMarkCount(text: string): number {
  return (text.match(/\?/g) ?? []).length;
}

function hasMultipleClauses(text: string): boolean {
  const andSplits = text.split(/\band\b/i).filter((s) => s.trim().split(" ").length > 2);
  return andSplits.length > 2 || questionMarkCount(text) > 1;
}

export function validateCandidate(
  draft: CandidatePromptDraft,
  ctx: {
    profile: BusinessProfile;
    forbiddenTerms: string[];
    approvedLocations: Location[];
    competitorForbiddenTerms?: string[];
    confirmedCompetitors?: Array<{ entityId?: string; id?: string; canonicalName: string; aliases?: string[]; canonicalDomain?: string | null; domains?: string[] }>;
    approvedTopicIds?: string[];
    /** Customers choose this business by place (from the frozen context). */
    placeBound?: boolean;
  },
): ValidationResult {
  const text = draft.text.trim();

  if (text.length < 8 || text.length > 300) {
    return { pass: false, code: "schema_length", reason: "Prompt text must be between 8 and 300 characters." };
  }
  // A tracked prompt is a typed query, not necessarily a sentence. The
  // reference products track bare shopping phrases ("best running shoes for
  // beginners") and imperatives ("Recommend the best running shoe brands in
  // India") alongside interrogatives, so requiring a trailing question mark
  // rejected two of the three registers outright. The natural-language
  // validator still enforces the shape appropriate to each register.
  // A non-question passes when it is a request ("Help me find…", "Looking
  // for…") or reads as shopping intent. The fixed opening list rejected the
  // phrasing people actually use.
  // A declarative sentence is not a query even when it contains a shopping
  // word: "The best running shoes are made of mesh." A typed keyword query is a
  // phrase with no finite verb ("Best places to find football boots and
  // jerseys."), and a request opens with the ask or the need.
  const register = inferRegister(text);
  const isRequest = register === "imperative" || DECISION_STATEMENT.test(text);
  // "what are the best nail salons in dubai." is a question typed without "?".
  const isQuestion = register === "question";
  const declarative = !isRequest && !isQuestion && /\.\s*$/.test(text) && /\b(is|are|was|were|has|have|had)\b/i.test(text);
  if (!text.endsWith("?") && (declarative || (!STATEMENT_QUERY_OPENING.test(text) && !isRequest && !isQuestion && !KEYWORD_INTENT.test(text)))) {
    return { pass: false, code: "schema_not_a_query", reason: "Prompt must read as a question or a buyer search query." };
  }

  if (draft.section === "Discovery" || draft.brandPolicy === "TARGET_FORBIDDEN" || draft.brandPolicy === "COMPETITOR_ALLOWED") {
    const leak = scanForBrandLeakage(text, ctx.forbiddenTerms);
    if (leak.leaked) {
      return { pass: false, code: "brand_leakage", reason: `Neutral prompt leaks target identity via "${leak.matchedTerm}".` };
    }
    const competitorLeak = scanForBrandLeakage(text, ctx.competitorForbiddenTerms ?? []);
    if (competitorLeak.leaked) {
      return { pass: false, code: "competitor_leakage", reason: `Discovery prompt plants a confirmed competitor via "${competitorLeak.matchedTerm}".` };
    }
  }

  if (draft.section === "Trade Offs" || draft.cohort === "target_comparison") {
    if (!draft.competitorEntityId) return { pass: false, code: "missing_required_competitor", reason: "Trade Off prompt is not bound to a confirmed competitor." };
    const competitor = ctx.confirmedCompetitors?.find((item) => (item.entityId ?? item.id) === draft.competitorEntityId);
    if (!competitor) return { pass: false, code: "invalid_competitor", reason: "Trade Off prompt references a competitor outside the frozen competitive set." };
    const terms = buildCompetitorForbiddenTerms([competitor]);
    if (!scanForBrandLeakage(text, terms).leaked) {
      return { pass: false, code: "missing_required_competitor", reason: `Trade Off prompt must name ${competitor.canonicalName}.` };
    }
    if (!draft.evaluationCriterion) return { pass: false, code: "unsupported_context", reason: "Trade Off prompt requires an evidence-grounded decision criterion." };
  }

  if ((draft.section === "Sentiment Analysis" || draft.cohort === "branded_accuracy") && !draft.sentimentTheme) {
    return { pass: false, code: "missing_sentiment_theme", reason: "Sentiment Analysis prompt requires a business-appropriate theme." };
  }

  if (draft.topicId && ctx.approvedTopicIds && !ctx.approvedTopicIds.includes(draft.topicId)) {
    return { pass: false, code: "invalid_topic", reason: "Prompt is bound to a topic outside the frozen topic set." };
  }
  if (draft.brandPolicy === "TARGET_REQUIRED") {
    // The recorded name or a supported short form of it ("Atelier 10" for
    // "Atelier 10 Salon" on atelier10.ae), the same forms analysis links.
    const brandName = ctx.profile.identity.brandName.value;
    const accepted = [ctx.forbiddenTerms[0] ?? normalizeTerm(brandName), ...shortNameForms(brandName, [ctx.profile.identity.canonicalDomain, ...ctx.profile.identity.domains]).map(normalizeTerm)];
    const leak = scanForBrandLeakage(text, accepted);
    if (!leak.leaked) {
      return { pass: false, code: "missing_required_brand", reason: "Branded/comparison prompt must reference the target brand." };
    }
  }

  if (draft.geographyScope !== "none") {
    if (!draft.geographyText) {
      return { pass: false, code: "geography_missing_binding", reason: "Cell required explicit geography but no location text was bound." };
    }
    const withinScope = ctx.approvedLocations.some((l) => l.level === draft.geographyScope && l.name.toLowerCase() === draft.geographyText!.toLowerCase());
    if (!withinScope) {
      return { pass: false, code: "geography_out_of_scope", reason: `"${draft.geographyText}" is not within the confirmed business geography.` };
    }
  }
  if (UNCONTROLLED_NEAR_ME_PATTERN.test(text) && draft.geographyScope === "none") {
    return { pass: false, code: "geography_uncontrolled_near_me", reason: `"near me" requires a controlled observer location, which this cell does not set.` };
  }

  // Place rules that need levelled, profile-bound places (prompts/geography.ts).
  const profilePlaces = ctx.approvedLocations.filter((location) => location.id.startsWith("place-"));
  if (profilePlaces.length > 0) {
    const mentioned = placesMentioned(text, profilePlaces);
    const finePlaces = mentioned.filter((location) => location.level !== "country" && location.level !== "region");
    // A city-state's city is also its country ("Singapore"): a country only
    // counts when it is not one of the places already named.
    const countries = countryCodesMentioned(text).filter((code) => !mentioned.some((location) => location.name.toLowerCase() === (countryName(code) ?? "").toLowerCase()));
    // "in DIFC, Dubai" is an address fragment; "in DIFC … from Business Bay" is two places in a real question.
    const adjacent = mentioned.some((a) => mentioned.some((b) => a !== b && new RegExp(`${escapePattern(a.name)}[\\s,]+${escapePattern(b.name)}`, "i").test(text)));
    if (mentioned.length >= 3 || adjacent || (finePlaces.length > 0 && countries.length > 0)) {
      return { pass: false, code: "geography_stacked", reason: "Name one place. A string like \"DIFC, Dubai, UAE\" reads like an address, not something a person asks." };
    }
    if (ctx.placeBound && draft.section === "Discovery" && finePlaces.length === 0 && countries.length > 0 && !profilePlaces.some((location) => location.level === "country")) {
      return { pass: false, code: "geography_too_broad", reason: "Customers of a local business ask about the area or city, not the whole country." };
    }
  }

  if (LEADING_PATTERNS.some((p) => p.test(text))) {
    return { pass: false, code: "leading_non_neutral", reason: "Prompt contains leading/biased phrasing that presupposes a positive conclusion." };
  }

  if (hasMultipleClauses(text)) {
    return { pass: false, code: "multi_intent", reason: "Prompt bundles more than one primary task/question." };
  }

  if (UNSTABLE_TEMPORAL_PATTERNS.some((p) => p.test(text))) {
    return { pass: false, code: "unstable_temporal_reference", reason: "Prompt uses a relative time reference that breaks reproducibility." };
  }

  if (ctx.profile.regulatedDomain.isRegulated) {
    for (const category of ctx.profile.regulatedDomain.categories) {
      const patterns = REGULATED_ADVICE_PATTERNS[category];
      if (patterns.some((p) => p.test(text))) {
        return { pass: false, code: "regulated_personalized_advice", reason: `Prompt requests personalized ${category} advice, which is out of scope for a regulated-domain business.` };
      }
    }
  }

  return { pass: true };
}
