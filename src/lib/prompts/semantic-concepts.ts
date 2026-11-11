// Semantic concept typing.
//
// This module exists because of one specific defect class. The previous
// generator treated every context string as interchangeable, so a Nike
// offering list of ["Running", "Basketball", "Jordan", "Sportswear"] was
// spliced into a `{category}` hole that grammatically expects a product noun
// phrase. That produced:
//
//   "Can you suggest a reliable running for a buyer?"
//   "Which running options are available for Jordan in India?"
//   "What kinds of running are best suited to Running in India?"
//
// "Running" is an ACTIVITY, not a purchasable category. "Jordan" is a
// PRODUCT_LINE, not a use case. Once a concept carries its kind, a renderer
// can refuse to put it in a slot it does not fit, and those sentences become
// unconstructible rather than merely unlikely.

export type MeasurementConceptKind =
  | "PRODUCT_CATEGORY"
  | "PRODUCT_LINE"
  | "SERVICE"
  | "SERVICE_CATEGORY"
  | "ACTIVITY"
  | "USE_CASE"
  | "JOB_TO_BE_DONE"
  | "PROBLEM"
  | "AUDIENCE"
  | "PERSONA"
  | "FEATURE"
  | "EVALUATION_CRITERION"
  | "PURCHASE_CONSTRAINT"
  | "LOCATION"
  | "INDUSTRY"
  | "BRAND"
  | "OTHER";

export interface MeasurementConcept {
  id: string;
  /** Surface form as the business writes it, e.g. "Running". */
  canonicalLabel: string;
  kind: MeasurementConceptKind;
  /**
   * A brand-neutral noun phrase safe to use in a `{category}` slot, e.g.
   * "running shoes". Null when no such phrase could be derived — the renderer
   * then refuses category frames for this concept rather than inventing one.
   */
  neutralLabel: string | null;
  /** Reads naturally after "for ..." / "best for ...", e.g. "running". */
  activityLabel: string | null;
  sourceEvidenceIds: string[];
  confidence: number;
  /** True when the label identifies the target and must never leak into Discovery. */
  isProprietary: boolean;
}

// --- Kind inference --------------------------------------------------------

/**
 * Activities are gerunds or well-known sports/practices. They answer "what is
 * the customer doing", never "what am I buying" — the exact confusion behind
 * "a reliable running".
 */
const ACTIVITY_PATTERNS: RegExp[] = [
  /^(running|walking|hiking|training|cycling|swimming|climbing|lifting|yoga|pilates|crossfit|gym|workout|jogging|sprinting|trekking)$/i,
  /^(football|soccer|basketball|cricket|tennis|badminton|golf|rugby|baseball|hockey|skateboarding|surfing|skiing|snowboarding|boxing|martial arts)$/i,
  /^(commuting|travelling|traveling|studying|cooking|baking|gaming|streaming|photography|gardening|camping|fishing)$/i,
  /\b(ing)\b.*\b(training|practice|session|routine)\b/i,
];

/** Nouns that are unambiguously things you buy. */
const PRODUCT_HEAD_NOUNS =
  /\b(shoes?|sneakers?|trainers?|boots?|footwear|apparel|clothing|wear|jackets?|shirts?|jerseys?|shorts?|leggings?|kits?|equipment|gear|accessor(y|ies)|bags?|watches?|laptops?|phones?|headphones?|furniture|mattress(es)?|sofas?|cameras?|tools?|machines?|vehicles?|cars?|suvs?|trucks?|bikes?|books?|cosmetics?|skincare|serums?|supplements?|foods?|snacks?|drinks?|beverages?)\b/i;

const SERVICE_HEAD_NOUNS =
  /\b(services?|consulting|support|maintenance|repairs?|installation|cleaning|delivery|shipping|training|coaching|advisory|management|treatments?|therapy|surgery|care|diagnostics?|imaging|insurance|loans?|mortgages?|accounts?|banking|booking|catering|dining|tours?|programs?|programmes?|courses?|degrees?|classes?)\b/i;

const CATEGORY_SUFFIXES =
  /\b(software|platform|tool|tools|suite|system|systems|solution|solutions|app|apps|service|services|shoes|footwear|apparel|clothing|equipment|gear|products?|brands?|providers?|agencies|firms?|companies|clinics?|hospitals?|hotels?|restaurants?|dealerships?|stores?|marketplaces?)\b/i;

const AUDIENCE_PATTERNS =
  /^(enterprises?|small businesses?|smbs?|startups?|developers?|engineers?|marketers?|designers?|students?|parents?|families|athletes?|runners?|patients?|homeowners?|travell?ers?|drivers?|investors?|retailers?|manufacturers?|clinicians?|professionals?|beginners?|teams?|agencies|sellers?|merchants?|readers?|guests?)$/i;

const CRITERION_PATTERNS =
  /^(price|pricing|value|cost|quality|durability|comfort|cushioning|fit|sizing|performance|speed|reliability|security|support|ease of use|usability|scalability|integrations?|warranty|delivery|shipping|returns?|authenticity|cleanliness|service|availability|coverage|accuracy|transparency|fees?)$/i;

const LOCATION_HINT =
  /^(india|united states|usa|uk|united kingdom|canada|australia|germany|france|singapore|uae|dubai|mumbai|delhi|bengaluru|bangalore|chennai|hyderabad|london|new york|austin|manchester|leeds|hyderabad|stuttgart)$/i;

const JOB_PATTERNS = /^(how (to|do|can|does)|what (is|are|does)|why|where (can|do)|when (should|do)|can i|should i)\b/i;

/**
 * Commerce MECHANICS: how a purchase is transacted, not what is purchased.
 *
 * "Corporate Sales", "Gift Cards", "Bulk Orders" and "Wholesale" are real
 * offerings and belong in the business profile — but nobody shops for them the
 * way they shop for running shoes, and using one as the head of a Discovery
 * question produced "Suggest good corporate sales for athletes" and "Can you
 * suggest a reliable corporate sale for women?". They are typed OTHER so they
 * carry no neutral label and cannot head a category frame, while remaining
 * visible everywhere the profile is shown.
 */
const COMMERCE_MECHANIC =
  /^(corporate sales?|bulk orders?|bulk buying|wholesale|trade accounts?|business accounts?|gift cards?|gift vouchers?|e-?gift cards?|store credit|loyalty programm?e?|rewards? programm?e?|membership|affiliate programm?e?|student discounts?|military discounts?|price match|layaway|financing|instal?ments?|klarna|returns? polic(y|ies)|shipping polic(y|ies)|delivery options?|click and collect|curbside pickup|order tracking|size guide|newsletter)$/i;

const PROBLEM_HINTS = /\b(problem|issue|pain|struggle|difficulty|challenge|risk|delay|downtime|churn|waste|error)\b/i;

export interface ConceptInferenceInput {
  label: string;
  /** Offering type recorded by the Task 2 profile, when the label came from one. */
  offeringType?: "product" | "service" | "category" | "solution";
  /** Brand terms that mark a label as target-identifying. */
  proprietaryTerms?: string[];
  /** Industry sector, used to disambiguate a bare activity. */
  industrySector?: string;
}

export function inferConceptKind(input: ConceptInferenceInput): MeasurementConceptKind {
  const label = input.label.trim();
  const lower = label.toLowerCase();
  if (!label) return "OTHER";

  if (COMMERCE_MECHANIC.test(lower)) return "OTHER";
  if (JOB_PATTERNS.test(label)) return "JOB_TO_BE_DONE";
  if (LOCATION_HINT.test(lower)) return "LOCATION";
  if (AUDIENCE_PATTERNS.test(lower)) return "AUDIENCE";
  if (CRITERION_PATTERNS.test(lower)) return "EVALUATION_CRITERION";
  if (PROBLEM_HINTS.test(lower)) return "PROBLEM";

  // A proprietary term is a product line even when it looks like a category:
  // "Air Max" and "Jordan" are things only this brand sells.
  if (isProprietaryLabel(label, input.proprietaryTerms ?? [])) return "PRODUCT_LINE";

  if (ACTIVITY_PATTERNS.some((pattern) => pattern.test(lower))) return "ACTIVITY";

  if (SERVICE_HEAD_NOUNS.test(lower)) return input.offeringType === "service" ? "SERVICE" : "SERVICE_CATEGORY";
  if (PRODUCT_HEAD_NOUNS.test(lower) || CATEGORY_SUFFIXES.test(lower)) return "PRODUCT_CATEGORY";

  if (input.offeringType === "service") return "SERVICE_CATEGORY";
  if (input.offeringType === "solution") return "USE_CASE";
  if (input.offeringType === "category") return "PRODUCT_CATEGORY";

  // A single capitalized word that is none of the above is far more likely a
  // brand/product line than a category a buyer would search for.
  if (/^[A-Z][A-Za-z0-9]*$/.test(label) && label.split(/\s+/).length === 1) return "PRODUCT_LINE";

  return "OTHER";
}

export function isProprietaryLabel(label: string, proprietaryTerms: string[]): boolean {
  const normalized = normalizeConcept(label);
  if (!normalized) return false;
  return proprietaryTerms.some((term) => {
    const normalizedTerm = normalizeConcept(term);
    return normalizedTerm.length >= 3 && (normalized === normalizedTerm || normalized.includes(normalizedTerm));
  });
}

export function normalizeConcept(value: string): string {
  return value.toLowerCase().replace(/[^a-z0-9]+/g, "");
}

// --- Neutral label derivation ---------------------------------------------

/**
 * Turns an ACTIVITY into the category a buyer would actually shop for, using
 * the business's own product vocabulary. "Running" alone is not purchasable;
 * "running" + a footwear business is "running shoes".
 *
 * Returns null rather than guessing when the business's offerings give no
 * head noun — an honest gap beats "a reliable running".
 */
export function deriveNeutralCategory(concept: { label: string; kind: MeasurementConceptKind }, businessHeadNouns: string[]): string | null {
  const label = concept.label.trim().toLowerCase();

  if (concept.kind === "PRODUCT_CATEGORY" || concept.kind === "SERVICE_CATEGORY" || concept.kind === "SERVICE") {
    return label;
  }

  if (concept.kind === "ACTIVITY" || concept.kind === "USE_CASE") {
    // Skip any head that is itself an activity, and any that repeats the
    // label, before composing. "running" + "training" and "running" +
    // "running shoes" are both defects the first-usable head avoids.
    const head = businessHeadNouns.find(
      (candidate) => !ACTIVITY_PATTERNS.some((pattern) => pattern.test(candidate.toLowerCase())),
    );
    if (!head) return null;
    if (head.toLowerCase().includes(label)) return head.toLowerCase();
    return `${label} ${head.toLowerCase()}`;
  }

  if (concept.kind === "PRODUCT_LINE" || concept.kind === "BRAND") {
    // A product line's neutral form is its parent category, never its name.
    const head = businessHeadNouns[0];
    return head ? head.toLowerCase() : null;
  }

  return null;
}

/**
 * Extracts the purchasable head nouns a business actually sells, in
 * confidence order. These become the grammatical head of category frames.
 */
export function extractBusinessHeadNouns(offerings: string[], industryCategory?: string | null): string[] {
  // Priority tiers, not first-come order.
  //
  // The previous implementation scanned offerings in order and took the first
  // regex hit of either kind. For a footwear retailer whose crawled offerings
  // were ["Running", "Jordan", "Sportswear", "Football", "Basketball",
  // "Training"], the ONLY hit was "Training" — matched as a SERVICE noun — so
  // "training" became the head noun for the whole business and every activity
  // frame rendered as "running training", "football training", "basketball
  // training". A word that is simultaneously one of the business's activities
  // is the worst possible choice of head noun, and it was structurally
  // guaranteed to win.
  const products: string[] = [];
  const services: string[] = [];
  const fromIndustry: string[] = [];
  const push = (list: string[], value: string) => {
    const cleaned = value.trim().toLowerCase();
    if (!cleaned) return;
    // A head noun that is itself one of the business's activities cannot head
    // an activity frame: "running" + "training" is not a product.
    if (ACTIVITY_PATTERNS.some((pattern) => pattern.test(cleaned))) return;
    if (!list.includes(cleaned)) list.push(cleaned);
  };

  for (const offering of offerings) {
    const product = offering.match(PRODUCT_HEAD_NOUNS);
    if (product?.[0]) { push(products, product[0]); continue; }
    const service = offering.match(SERVICE_HEAD_NOUNS);
    if (service?.[0]) push(services, service[0]);
  }
  // The industry category is the reliable fallback head: "Apparel & Sporting
  // Goods" yields "apparel", "Hospitals & Clinical Care" yields "care".
  if (industryCategory) {
    const match = industryCategory.match(PRODUCT_HEAD_NOUNS) ?? industryCategory.match(SERVICE_HEAD_NOUNS);
    if (match?.[0]) push(fromIndustry, match[0]);
  }
  // Products first (what a retail buyer shops for), then the industry head,
  // then service nouns, which are the weakest evidence of a purchasable thing.
  return [...products, ...fromIndustry, ...services];
}

/**
 * Only these openings leave a VERB PHRASE behind when stripped.
 *
 * "How do I clean running shoes?" -> "clean running shoes", which slots into
 * "...if I need to ___". "How does shipping work?" -> "shipping work", which
 * does not, and produced "Which custom sneakers should I look at if I need to
 * shipping work?". The two cases are indistinguishable once the prefix is
 * gone, so they have to be told apart before it is stripped.
 */
const IMPERATIVE_JOB_OPENING = /^(how (?:to|do i|do you|can i|should i))\b/i;

/** Reads naturally after "for" / "best for": "running", "long-distance running". */
export function deriveActivityLabel(concept: { label: string; kind: MeasurementConceptKind }): string | null {
  if (concept.kind === "ACTIVITY" || concept.kind === "USE_CASE") return concept.label.trim().toLowerCase();
  if (concept.kind === "JOB_TO_BE_DONE") {
    if (!IMPERATIVE_JOB_OPENING.test(concept.label.trim())) return null;
    return concept.label
      .replace(IMPERATIVE_JOB_OPENING, "")
      .replace(/\?$/, "")
      .trim()
      .toLowerCase() || null;
  }
  return null;
}

/**
 * True when a label reads as a verb phrase — the slot type "if I need to ___"
 * requires. Checked structurally rather than trusting the concept kind,
 * because a job can arrive from several extractors.
 */
export function isVerbPhrase(label: string): boolean {
  const first = label.trim().toLowerCase().split(/\s+/)[0] ?? "";
  return /^(buy|find|choose|pick|get|replace|fix|repair|clean|wash|install|set|track|return|exchange|order|book|reserve|compare|upgrade|downgrade|cancel|renew|ship|send|store|size|fit|start|stop|switch|move|rent|lease|finance|insure|treat|manage|plan|build|design|make|prepare|schedule|hire|apply|open|close|transfer|pay|save|invest|train|run|improve|reduce|increase|automate|migrate|integrate|scale|monitor|test)\b/.test(first);
}

export interface BuildConceptsInput {
  offerings: Array<{ name: string; type?: "product" | "service" | "category" | "solution"; evidenceIds?: string[]; confidence?: number }>;
  audiences: string[];
  criteria: string[];
  jobs: string[];
  markets: string[];
  industryCategory?: string | null;
  industrySector?: string | null;
  proprietaryTerms: string[];
}

/** Builds the typed concept set the whole prompt pipeline reasons over. */
export function buildMeasurementConcepts(input: BuildConceptsInput): MeasurementConcept[] {
  const heads = extractBusinessHeadNouns(
    input.offerings.map((o) => o.name),
    input.industryCategory,
  );
  const concepts: MeasurementConcept[] = [];
  let counter = 0;

  const add = (label: string, kind: MeasurementConceptKind, evidenceIds: string[], confidence: number) => {
    const trimmed = label.trim();
    if (!trimmed) return;
    if (concepts.some((c) => normalizeConcept(c.canonicalLabel) === normalizeConcept(trimmed))) return;
    counter += 1;
    concepts.push({
      id: `mc_${counter}`,
      canonicalLabel: trimmed,
      kind,
      neutralLabel: deriveNeutralCategory({ label: trimmed, kind }, heads),
      activityLabel: deriveActivityLabel({ label: trimmed, kind }),
      sourceEvidenceIds: evidenceIds,
      confidence,
      isProprietary: isProprietaryLabel(trimmed, input.proprietaryTerms),
    });
  };

  for (const offering of input.offerings) {
    add(
      offering.name,
      inferConceptKind({
        label: offering.name,
        offeringType: offering.type,
        proprietaryTerms: input.proprietaryTerms,
        industrySector: input.industrySector ?? undefined,
      }),
      offering.evidenceIds ?? [],
      offering.confidence ?? 60,
    );
  }
  for (const audience of input.audiences) add(audience, "AUDIENCE", [], 60);
  for (const criterion of input.criteria) add(criterion, "EVALUATION_CRITERION", [], 55);
  for (const job of input.jobs) add(job, "JOB_TO_BE_DONE", [], 55);
  for (const market of input.markets) add(market, "LOCATION", [], 70);
  // A taxonomy label often joins two markets ("Apparel & Sporting Goods",
  // "Hospitals / Clinical Care"). As one string it is not a noun phrase anyone
  // shops for — it produced "What are the best apparel & sporting goods?" —
  // but each half is. Split, then let the normal concept typing run on each.
  if (input.industryCategory) {
    for (const part of input.industryCategory.split(/\s*(?:&|\/|,| and )\s*/i)) {
      const trimmed = part.trim();
      if (trimmed.length >= 3) add(trimmed, "PRODUCT_CATEGORY", [], 65);
    }
  }

  return concepts;
}

/** The category concepts safe to use as the grammatical head of a question. */
export function categoryConcepts(concepts: MeasurementConcept[]): MeasurementConcept[] {
  return concepts.filter((c) => c.neutralLabel !== null && !c.isProprietary);
}

export function conceptsOfKind(concepts: MeasurementConcept[], kinds: MeasurementConceptKind[]): MeasurementConcept[] {
  return concepts.filter((c) => kinds.includes(c.kind));
}
