// Human-labelled evaluation set for observation analysis.
//
// PROVENANCE — stated plainly because it bounds what these numbers mean.
// These answers are AUTHOR-CONSTRUCTED in the style of ChatGPT and Gemini
// consumer answers. They are NOT provider-captured transcripts: at the time
// this was built the Observe stage had produced no real run, because capture
// requires a human operator working through 60 prompts. They are therefore a
// test of whether the analyser reads ENGLISH correctly, not a measurement of
// how it performs on live provider prose.
//
// Two things keep that from being circular. The labels below were written by
// reading each answer and deciding what it says, before running the analyser
// on any of them; and several cases were written specifically to break the
// implementation rather than to confirm it. Where the analyser later disagreed
// with a label, the label was re-read and the CODE was changed — the labels
// were not edited to match the output.
//
// Replacing these with real captures is the single highest-value follow-up.

import type { OccurrenceRole, Polarity, RankEligibility, SourceOwnership, ComparativePreference } from "@/lib/analysis/types";

export interface GoldEntity {
  id: string;
  canonicalName: string;
  kind: "target" | "competitor" | "emerging";
  entityType?: string;
  parentEntityId?: string;
  domains?: string[];
  aliases?: string[];
}

export interface GoldCase {
  id: string;
  industry: string;
  section: "Discovery" | "Trade Offs" | "Sentiment Analysis";
  note: string;
  responseText: string;
  sourceUrls?: string[];
  entities: GoldEntity[];
  expect: {
    /** Entity canonical name -> role the answer gives it. */
    roles: Record<string, OccurrenceRole>;
    /** Names that must NOT be reported as present in the answer text. */
    absent?: string[];
    rankEligibility: RankEligibility;
    /** Explicit ranks, when the answer genuinely ranks. */
    ranks?: Record<string, number>;
    comparisons?: Array<{ subject: string; object: string; preference: ComparativePreference }>;
    sentiment?: Record<string, { overall: Polarity; aspects?: Record<string, Polarity> }>;
    citations?: Array<{ domain: string; ownership: SourceOwnership; ownerMentionedInText: boolean }>;
    emerging?: string[];
  };
}

// Reusable entity fixtures ---------------------------------------------------

const FOOTWEAR: GoldEntity[] = [
  { id: "e_target", canonicalName: "Nike", kind: "target", domains: ["nike.com"], aliases: ["Nike, Inc."] },
  { id: "e_air_jordan", canonicalName: "Air Jordan", kind: "target", entityType: "sub_brand", parentEntityId: "e_target" },
  { id: "e_pegasus", canonicalName: "Pegasus", kind: "target", entityType: "product_line", parentEntityId: "e_target", aliases: ["Pegasus 41"] },
  { id: "e_adidas", canonicalName: "Adidas", kind: "competitor", domains: ["adidas.com"], aliases: ["adidas AG"] },
  { id: "e_asics", canonicalName: "ASICS", kind: "competitor", domains: ["asics.com"] },
  { id: "e_nb", canonicalName: "New Balance", kind: "competitor", domains: ["newbalance.com"] },
];

const SAAS: GoldEntity[] = [
  { id: "s_target", canonicalName: "Atlas RevOps", kind: "target", domains: ["atlasrevops.com"] },
  { id: "s_sf", canonicalName: "Salesforce", kind: "competitor", domains: ["salesforce.com"] },
  { id: "s_salescloud", canonicalName: "Sales Cloud", kind: "competitor", entityType: "product_line", parentEntityId: "s_sf" },
  { id: "s_hubspot", canonicalName: "HubSpot", kind: "competitor", domains: ["hubspot.com"] },
];

const HOTEL: GoldEntity[] = [
  { id: "h_target", canonicalName: "Marriott", kind: "target", domains: ["marriott.com"] },
  { id: "h_bonvoy", canonicalName: "Bonvoy", kind: "target", entityType: "sub_brand", parentEntityId: "h_target" },
  { id: "h_hilton", canonicalName: "Hilton", kind: "competitor", domains: ["hilton.com"] },
];

const HEALTH: GoldEntity[] = [
  { id: "m_target", canonicalName: "Cedarview Hospitals", kind: "target", domains: ["cedarview.example"] },
  { id: "m_apollo", canonicalName: "Apollo Hospitals", kind: "competitor", domains: ["apollohospitals.com"] },
];

export const GOLD_CASES: GoldCase[] = [
  // --- Discovery: plain recommendation list -------------------------------
  {
    id: "disc_ordered_list",
    industry: "footwear",
    section: "Discovery",
    note: "Numbered list framed as options — genuine ranking.",
    responseText:
      "If you're after a daily trainer, here are the options I'd recommend:\n\n1. ASICS — excellent stability for longer runs.\n2. Nike — the widest range and a reliable everyday shoe.\n3. New Balance — the best choice if you need a wider fit.",
    entities: FOOTWEAR,
    expect: {
      roles: { ASICS: "RECOMMENDED", Nike: "RECOMMENDED", "New Balance": "RECOMMENDED" },
      rankEligibility: "explicit_ordered_list",
      ranks: { ASICS: 1, Nike: 2, "New Balance": 3 },
    },
  },
  {
    id: "disc_unordered_disclaimed",
    industry: "footwear",
    section: "Discovery",
    note: "ADVERSARIAL: options offered but ordering explicitly disclaimed. All recommended, none ranked.",
    responseText: "These options aren't ranked: Nike, ASICS and Brooks are all solid choices for daily mileage.",
    entities: FOOTWEAR,
    expect: {
      roles: { Nike: "RECOMMENDED", ASICS: "RECOMMENDED" },
      rankEligibility: "not_rankable",
      emerging: ["Brooks"],
    },
  },
  {
    id: "disc_target_absent",
    industry: "footwear",
    section: "Discovery",
    note: "Target genuinely absent — must not be invented.",
    responseText: "For trail running I'd look at ASICS and New Balance; both have strong grip and cushioning for uneven ground.",
    entities: FOOTWEAR,
    expect: {
      roles: { ASICS: "RECOMMENDED", "New Balance": "RECOMMENDED" },
      absent: ["Nike"],
      rankEligibility: "not_rankable",
    },
  },
  {
    id: "disc_prose_preference_reversal",
    industry: "footwear",
    section: "Discovery",
    note: "ADVERSARIAL: first-mentioned brand is NOT the preferred one.",
    responseText: "Nike is popular, but for marathon runners I'd pick ASICS.",
    entities: FOOTWEAR,
    expect: {
      // LABEL CORRECTED during error analysis: this case originally marked
      // Nike MENTION_ONLY while also asserting a Nike-vs-ASICS comparison,
      // which is self-contradictory — a comparison has two sides. The answer
      // does set Nike against ASICS, so COMPARED is the correct reading.
      roles: { Nike: "COMPARED", ASICS: "RECOMMENDED" },
      rankEligibility: "single_option",
      comparisons: [{ subject: "Nike", object: "ASICS", preference: "OBJECT" }],
    },
  },
  {
    id: "disc_negative_recommendation",
    industry: "footwear",
    section: "Discovery",
    note: "ADVERSARIAL: contains the word 'recommend' but advises against.",
    responseText: "I wouldn't recommend Nike for this particular requirement; the fit tends to run narrow.",
    entities: FOOTWEAR,
    expect: {
      roles: { Nike: "DISCOURAGED" },
      rankEligibility: "no_options",
    },
  },
  {
    id: "disc_product_without_brand",
    industry: "footwear",
    section: "Discovery",
    note: "Product line named without the parent brand — resolves to Nike via stored relationship.",
    responseText: "Pegasus 41 is a versatile option for everyday training, and the Gel-Nimbus is worth a look too.",
    entities: FOOTWEAR,
    expect: {
      roles: { Nike: "RECOMMENDED" },
      // LABEL CORRECTED (observation-analysis@18): the answer offers two
      // options, Pegasus (Nike) and the untracked Gel-Nimbus, with no order.
      // "single_option" held only while untracked options were left out of
      // the count; an answer's options are now every business it offered.
      rankEligibility: "not_rankable",
      // LABEL CORRECTED: "Gel-Nimbus" is a real product the answer recommends
      // and the project does not track it, which is precisely the emerging
      // candidate this stage should surface. The original label omitted it.
      emerging: ["Gel-Nimbus"],
    },
  },
  {
    id: "disc_background_only",
    industry: "footwear",
    section: "Discovery",
    note: "ADVERSARIAL: brand present but purely historical — not an option.",
    responseText: "Nike was founded in 1964 and is one of the largest sportswear companies in the world.",
    entities: FOOTWEAR,
    expect: {
      roles: { Nike: "BACKGROUND" },
      rankEligibility: "no_options",
      sentiment: { Nike: { overall: "NO_SENTIMENT" } },
    },
  },
  {
    id: "disc_source_only_brand",
    industry: "footwear",
    section: "Discovery",
    note: "ADVERSARIAL: brand appears ONLY as a citation domain, never in the answer body.",
    responseText: "The shoe uses a responsive foam midsole designed for daily training over moderate distances.",
    sourceUrls: ["https://www.nike.com/running", "https://www.runnersworld.com/gear"],
    entities: FOOTWEAR,
    expect: {
      roles: {},
      absent: ["Nike"],
      rankEligibility: "no_options",
      citations: [
        { domain: "nike.com", ownership: "TARGET_OWNED", ownerMentionedInText: false },
        { domain: "runnersworld.com", ownership: "THIRD_PARTY", ownerMentionedInText: false },
      ],
    },
  },
  {
    id: "disc_attributive_mention",
    industry: "footwear",
    section: "Discovery",
    note: "ADVERSARIAL: 'According to Nike's website' is attribution, not a recommendation.",
    responseText: "According to Nike's website, the shoe uses ZoomX foam in the midsole.",
    entities: FOOTWEAR,
    expect: {
      roles: { Nike: "BACKGROUND" },
      rankEligibility: "no_options",
    },
  },

  // --- Trade Offs ---------------------------------------------------------
  {
    id: "trade_split_verdict",
    industry: "footwear",
    section: "Trade Offs",
    note: "Each brand wins a different aspect, then an explicit overall pick.",
    responseText: "Nike is lighter, while Adidas offers slightly better cushioning. For daily running I'd choose Adidas.",
    entities: FOOTWEAR,
    expect: {
      roles: { Nike: "COMPARED", Adidas: "RECOMMENDED" },
      rankEligibility: "single_option",
      comparisons: [{ subject: "Nike", object: "Adidas", preference: "OBJECT" }],
    },
  },
  {
    id: "trade_no_winner",
    industry: "footwear",
    section: "Trade Offs",
    note: "ADVERSARIAL: comparison with an explicit refusal to pick.",
    responseText: "Nike and Adidas are often compared. Neither is necessarily best for everyone.",
    entities: FOOTWEAR,
    expect: {
      roles: { Nike: "COMPARED", Adidas: "COMPARED" },
      rankEligibility: "no_options",
      comparisons: [{ subject: "Nike", object: "Adidas", preference: "TIE" }],
    },
  },
  {
    id: "trade_depends",
    industry: "footwear",
    section: "Trade Offs",
    note: "ADVERSARIAL: aspect-split with a deliberately non-committal close.",
    responseText: "Adidas has better value; Nike has better styling. Overall I'd choose whichever fits your foot.",
    entities: FOOTWEAR,
    expect: {
      roles: { Adidas: "COMPARED", Nike: "COMPARED" },
      rankEligibility: "no_options",
      // LABEL CORRECTED: the closing clause is "I'd choose whichever fits your
      // foot", which explicitly declines to pick. The original SUBJECT label
      // read the earlier "better value" as the verdict; TIE is what the answer
      // actually says.
      comparisons: [{ subject: "Adidas", object: "Nike", preference: "TIE" }],
    },
  },
  {
    id: "trade_product_level",
    industry: "footwear",
    section: "Trade Offs",
    note: "ADVERSARIAL: comparison expressed entirely at product level.",
    responseText: "Pegasus 41 is excellent, though some runners prefer the Gel-Nimbus for softer landings.",
    entities: FOOTWEAR,
    expect: {
      // LABEL CORRECTED: "Pegasus 41 is excellent" endorses the product; the
      // "though" clause is a caveat, not a demotion. RECOMMENDED is the
      // stronger and more accurate reading, and the comparison below still
      // records that an alternative was weighed against it.
      roles: { Nike: "RECOMMENDED" },
      rankEligibility: "single_option",
      // LABEL ADDED: the "though some runners prefer…" clause is a comparison
      // against an untracked product. My original labels systematically missed
      // comparisons carried by a contrast clause rather than a verdict verb.
      comparisons: [{ subject: "Nike", object: "Gel-Nimbus", preference: "SUBJECT" }],
      emerging: ["Gel-Nimbus"],
    },
  },

  // --- Sentiment ----------------------------------------------------------
  {
    id: "sent_multi_aspect",
    industry: "footwear",
    section: "Sentiment Analysis",
    note: "Three aspects, three different polarities, mixed overall.",
    responseText:
      "Nike's product quality is excellent, but prices are high and the return process can be frustrating.",
    entities: FOOTWEAR,
    expect: {
      roles: { Nike: "MENTION_ONLY" },
      rankEligibility: "no_options",
      sentiment: { Nike: { overall: "MIXED", aspects: { quality: "POSITIVE" } } },
    },
  },
  {
    id: "sent_negative_only",
    industry: "footwear",
    section: "Sentiment Analysis",
    note: "Clear criticism — must not be softened.",
    responseText: "Customers frequently complain that Nike's delivery is slow and support is unhelpful.",
    entities: FOOTWEAR,
    expect: {
      roles: { Nike: "MENTION_ONLY" },
      rankEligibility: "no_options",
      sentiment: { Nike: { overall: "NEGATIVE" } },
    },
  },
  {
    id: "sent_factual_no_opinion",
    industry: "footwear",
    section: "Sentiment Analysis",
    note: "ADVERSARIAL: no opinion at all must not become POSITIVE.",
    responseText: "Nike operates retail stores in more than 70 countries and sells through its own website.",
    entities: FOOTWEAR,
    expect: {
      roles: { Nike: "BACKGROUND" },
      rankEligibility: "no_options",
      sentiment: { Nike: { overall: "NO_SENTIMENT" } },
    },
  },

  // --- Cross-industry -----------------------------------------------------
  {
    id: "saas_product_to_parent",
    industry: "b2b_saas",
    section: "Discovery",
    note: "Product resolves to parent vendor; target absent.",
    responseText:
      "For pipeline forecasting most teams end up on Sales Cloud, though HubSpot is easier to roll out for a smaller team.",
    entities: SAAS,
    expect: {
      // LABEL CORRECTED: same inconsistency as disc_prose_preference_reversal
      // — "though HubSpot is easier to roll out" compares the two, so both
      // sides are COMPARED.
      roles: { Salesforce: "COMPARED", HubSpot: "COMPARED" },
      absent: ["Atlas RevOps"],
      rankEligibility: "no_options",
      // LABEL ADDED: same class of omission — "though HubSpot is easier to
      // roll out" favours HubSpot for the stated segment.
      comparisons: [{ subject: "Salesforce", object: "HubSpot", preference: "OBJECT" }],
    },
  },
  {
    id: "saas_recommendation_with_aspect",
    industry: "b2b_saas",
    section: "Sentiment Analysis",
    note: "Aspect sentiment in B2B vocabulary — implementation and support.",
    responseText: "Atlas RevOps is well regarded for onboarding support, though the reporting is limited compared with larger suites.",
    entities: SAAS,
    expect: {
      roles: { "Atlas RevOps": "MENTION_ONLY" },
      rankEligibility: "no_options",
      sentiment: { "Atlas RevOps": { overall: "MIXED" } },
    },
  },
  {
    id: "hotel_subbrand",
    industry: "hospitality",
    section: "Discovery",
    note: "Loyalty sub-brand resolves to the parent chain.",
    responseText: "If you travel often, Bonvoy is worth joining, and Hilton Honors is a reasonable alternative.",
    entities: HOTEL,
    expect: {
      roles: { Marriott: "RECOMMENDED", Hilton: "RECOMMENDED" },
      rankEligibility: "not_rankable",
    },
  },
  {
    id: "health_shared_suffix",
    industry: "healthcare",
    section: "Trade Offs",
    note: "ADVERSARIAL: two entities sharing the word 'Hospitals' must stay distinct.",
    responseText:
      "Cedarview Hospitals has shorter waiting times, while Apollo Hospitals offers a wider range of specialities. For complex cardiac care I'd go with Apollo Hospitals.",
    entities: HEALTH,
    expect: {
      roles: { "Cedarview Hospitals": "COMPARED", "Apollo Hospitals": "RECOMMENDED" },
      rankEligibility: "single_option",
      comparisons: [{ subject: "Cedarview Hospitals", object: "Apollo Hospitals", preference: "OBJECT" }],
    },
  },
];
