// HELD-OUT adversarial set.
//
// Written after the analyser already scored 100% on the development set, and
// deliberately not used to tune anything before its first run. A parser that
// scores perfectly on cases its author iterated against has demonstrated
// nothing except that it memorised them; this set exists to find out what the
// development set was too easy to expose.
//
// New industries (restaurant, finance, dealership, ecommerce) and new
// linguistic patterns (double negation, negated comparatives, conditionals,
// brand-names-that-are-common-words, rhetorical questions).

import type { GoldCase, GoldEntity } from "./gold-cases";

const RESTAURANT: GoldEntity[] = [
  { id: "r_target", canonicalName: "Sage & Ember", kind: "target", domains: ["sageandember.example"] },
  { id: "r_rival", canonicalName: "The Copper Pot", kind: "competitor", domains: ["copperpot.example"] },
];

const FINANCE: GoldEntity[] = [
  { id: "f_target", canonicalName: "Northwind Bank", kind: "target", domains: ["northwind.example"] },
  { id: "f_card", canonicalName: "Northwind Flex", kind: "target", entityType: "product_line", parentEntityId: "f_target" },
  { id: "f_rival", canonicalName: "Meridian Financial", kind: "competitor", domains: ["meridian.example"] },
];

const DEALER: GoldEntity[] = [
  { id: "d_target", canonicalName: "Gap Motors", kind: "target", domains: ["gapmotors.example"] },
  { id: "d_rival", canonicalName: "Summit Auto", kind: "competitor", domains: ["summitauto.example"] },
];

const FOOTWEAR: GoldEntity[] = [
  { id: "e_target", canonicalName: "Nike", kind: "target", domains: ["nike.com"] },
  { id: "e_adidas", canonicalName: "Adidas", kind: "competitor", domains: ["adidas.com"] },
  { id: "e_asics", canonicalName: "ASICS", kind: "competitor", domains: ["asics.com"] },
];

export const HOLDOUT_CASES: GoldCase[] = [
  {
    id: "hold_negated_comparative",
    industry: "footwear",
    section: "Trade Offs",
    note: "HELD OUT: negated comparative — 'not as good as' reverses direction.",
    responseText: "Adidas is not as good as ASICS for long-distance work.",
    entities: FOOTWEAR,
    expect: {
      roles: { Adidas: "COMPARED", ASICS: "COMPARED" },
      rankEligibility: "no_options",
      comparisons: [{ subject: "Adidas", object: "ASICS", preference: "OBJECT" }],
      // Neither brand takes a standalone polarity here: one opinion word is
      // being used to rank two brands, and splitting it between them made the
      // FAVOURED brand come out negative.
      sentiment: { Adidas: { overall: "NO_SENTIMENT" }, ASICS: { overall: "NO_SENTIMENT" } },
    },
  },
  {
    id: "hold_double_negation",
    industry: "footwear",
    section: "Discovery",
    note: "HELD OUT: double negative resolves to a mild positive.",
    responseText: "It's not that Nike isn't worth considering — it remains a strong all-round choice.",
    entities: FOOTWEAR,
    expect: {
      roles: { Nike: "RECOMMENDED" },
      rankEligibility: "single_option",
    },
  },
  {
    id: "hold_conditional_split",
    industry: "footwear",
    section: "Discovery",
    note: "HELD OUT: conditional recommendation — both are genuinely offered.",
    responseText: "If you need stability, go with ASICS; if you want a wider range of styles, choose Nike.",
    entities: FOOTWEAR,
    expect: {
      roles: { ASICS: "RECOMMENDED", Nike: "RECOMMENDED" },
      rankEligibility: "not_rankable",
      // A conditional split IS a comparison — it weighs two options — but it
      // deliberately declines to prefer either, which is what TIE records.
      comparisons: [{ subject: "ASICS", object: "Nike", preference: "TIE" }],
    },
  },
  {
    id: "hold_rhetorical_dismissal",
    industry: "footwear",
    section: "Discovery",
    note: "HELD OUT: rhetorical question then dismissal.",
    responseText: "Nike? Not for this use case. Look at ASICS instead.",
    entities: FOOTWEAR,
    expect: {
      roles: { Nike: "DISCOURAGED", ASICS: "RECOMMENDED" },
      rankEligibility: "single_option",
    },
  },
  {
    id: "hold_brand_is_common_word",
    industry: "dealership",
    section: "Discovery",
    note: "HELD OUT: 'Gap Motors' contains a common word; bare 'gap' must not match.",
    responseText:
      "There is a real gap in the market for affordable servicing. Gap Motors covers that well, and Summit Auto is worth a look for newer models.",
    entities: DEALER,
    expect: {
      roles: { "Gap Motors": "RECOMMENDED", "Summit Auto": "RECOMMENDED" },
      rankEligibility: "not_rankable",
    },
  },
  {
    id: "hold_same_brand_both_ways",
    industry: "restaurant",
    section: "Sentiment Analysis",
    note: "HELD OUT: praise and criticism of the same brand in separate sentences.",
    responseText:
      "Sage & Ember has excellent food and the service is attentive. That said, Sage & Ember is expensive and bookings are difficult.",
    entities: RESTAURANT,
    expect: {
      roles: { "Sage & Ember": "MENTION_ONLY" },
      rankEligibility: "no_options",
      sentiment: { "Sage & Ember": { overall: "MIXED" } },
    },
  },
  {
    id: "hold_product_to_parent_finance",
    industry: "finance",
    section: "Discovery",
    note: "HELD OUT: financial product resolves to the issuing bank.",
    responseText: "For everyday spending the Northwind Flex is a solid pick, though Meridian Financial has lower fees.",
    entities: FINANCE,
    expect: {
      roles: { "Northwind Bank": "RECOMMENDED", "Meridian Financial": "COMPARED" },
      rankEligibility: "single_option",
      comparisons: [{ subject: "Northwind Bank", object: "Meridian Financial", preference: "OBJECT" }],
    },
  },
  {
    id: "hold_deep_position",
    industry: "restaurant",
    section: "Discovery",
    note: "HELD OUT: target appears only near the end — position bucket must be 'bottom'.",
    responseText:
      "There are a lot of options in this part of town, and the right one depends on what kind of evening you want. Several places do a good tasting menu, and a few are better suited to a quick meal before a show. Parking is easier on the north side, and most kitchens close by ten on weeknights. If you want something special, The Copper Pot is reliable. For a quieter room with a shorter menu, Sage & Ember is the one I'd book.",
    entities: RESTAURANT,
    expect: {
      roles: { "The Copper Pot": "RECOMMENDED", "Sage & Ember": "RECOMMENDED" },
      rankEligibility: "not_rankable",
    },
  },
  {
    id: "hold_possessive_and_plural",
    industry: "footwear",
    section: "Sentiment Analysis",
    note: "HELD OUT: possessive form must still link.",
    responseText: "Nike's returns process is frustrating, and Adidas' delivery is slow too.",
    entities: FOOTWEAR,
    expect: {
      roles: { Nike: "MENTION_ONLY", Adidas: "MENTION_ONLY" },
      rankEligibility: "no_options",
      sentiment: { Nike: { overall: "NEGATIVE" }, Adidas: { overall: "NEGATIVE" } },
    },
  },
  {
    id: "hold_mixed_list_non_brands",
    industry: "footwear",
    section: "Discovery",
    note: "HELD OUT: a list whose items are criteria, not brands — nothing should be ranked as a brand.",
    responseText:
      "When choosing a running shoe, consider:\n\n1. Your arch type and gait\n2. The surface you run on\n3. How many miles per week you cover\n\nNike and ASICS both have fitting guides that help with this.",
    entities: FOOTWEAR,
    expect: {
      roles: { Nike: "MENTION_ONLY", ASICS: "MENTION_ONLY" },
      rankEligibility: "no_options",
    },
  },
  {
    id: "hold_citation_owner_also_mentioned",
    industry: "footwear",
    section: "Discovery",
    note: "HELD OUT: cited domain owner IS also named in the body — ownerMentionedInText must be true.",
    responseText: "Nike publishes a detailed size guide that covers width fittings.",
    sourceUrls: ["https://www.nike.com/size-guide", "https://www.adidas.com/us/help"],
    entities: FOOTWEAR,
    expect: {
      roles: { Nike: "BACKGROUND" },
      rankEligibility: "no_options",
      citations: [
        { domain: "nike.com", ownership: "TARGET_OWNED", ownerMentionedInText: true },
        { domain: "adidas.com", ownership: "COMPETITOR_OWNED", ownerMentionedInText: false },
      ],
    },
  },
  {
    id: "hold_enumeration_frame",
    industry: "footwear",
    section: "Discovery",
    note: "HELD OUT: inline enumeration ('popular brands include X, Y, Z') offers options without a recommendation verb.",
    responseText: "Popular sportswear brands for athletes include Nike, Adidas and ASICS.",
    entities: FOOTWEAR,
    expect: {
      roles: { Nike: "RECOMMENDED", Adidas: "RECOMMENDED", ASICS: "RECOMMENDED" },
      rankEligibility: "not_rankable",
    },
  },
  {
    id: "hold_enumeration_negative_frame",
    industry: "footwear",
    section: "Discovery",
    note: "HELD OUT: an enumeration frame that is NOT an offer — must stay MENTION_ONLY.",
    responseText: "Its main competitors include Adidas and ASICS, according to industry filings.",
    entities: FOOTWEAR,
    expect: {
      roles: { Adidas: "BACKGROUND", ASICS: "BACKGROUND" },
      rankEligibility: "no_options",
    },
  },
  {
    id: "hold_hedged_recommendation",
    industry: "finance",
    section: "Discovery",
    note: "HELD OUT: heavily hedged suggestion is still a recommendation, but a weak one.",
    responseText: "Some people might consider Northwind Bank, though it really depends on your circumstances.",
    entities: FINANCE,
    expect: {
      roles: { "Northwind Bank": "RECOMMENDED" },
      rankEligibility: "single_option",
    },
  },
];
