import { describe, expect, it } from "vitest";
import { scoreCompetitorCandidate } from "@/lib/landscape/competitor-scoring";
import { buildCompetitiveSearchProfile } from "@/lib/landscape/search-profile";
import { applyClassificationEdit, applyLocationEdit } from "@/lib/understanding/edits";
import { makeProfile } from "../../helpers/profile-fixtures";
import type { CompetitorCandidate } from "@/lib/landscape/competitor-types";

// Roles follow how a customer chooses (feedback 2026-09-16): a tasting-menu
// restaurant whose own rationale says it is chosen "rather than casual
// curries" is a substitute for a casual North Indian restaurant, however many
// category signals it shares.
function candidate(name: string, reason: string): CompetitorCandidate {
  return {
    canonicalName: name,
    likelyDomain: `${name.toLowerCase().replace(/[^a-z]/g, "")}.ae`,
    aliases: [],
    proposedType: "direct",
    entityType: "business",
    parentName: null,
    reason,
    confidence: 70,
    evidence: [{ source: "web_search", reason, evidenceIds: [], discoveredAt: 1 }],
    matchedDimensions: ["category", "audience", "geography"],
    structuralAffinity: 80,
    location: { area: null, city: "Dubai", country: "United Arab Emirates", distanceMeters: null },
  } as unknown as CompetitorCandidate;
}

describe("competitor role from the rationale", () => {
  let profile = makeProfile({ brandName: "Nawab", archetype: "restaurant_food_chain", industry: "Food", offerings: ["North Indian food", "Biryani", "Chaat"], domain: "nawab.ae" });
  profile = applyClassificationEdit(profile, { businessType: "North Indian restaurant", kind: "restaurant_food_beverage", physicalPresence: "multi_location" });
  profile = applyLocationEdit(profile, { primary: { neighborhood: "Jabel Ali", city: "Dubai", country: "United Arab Emirates" }, marketScope: "local" });
  const target = buildCompetitiveSearchProfile(profile, []);

  it("types an upmarket tasting-menu rival as a substitute despite strong overlap", () => {
    const ranked = scoreCompetitorCandidate(target, candidate("Tresind Studio", "A globally recognised Indian tasting-menu experience for customers seeking a special celebration or premium event meal rather than casual thalis, curries or delivery."), null);
    expect(ranked.role).toBe("substitute");
  });

  it("keeps a like-for-like North Indian restaurant direct", () => {
    const ranked = scoreCompetitorCandidate(target, candidate("Amritsr Restaurant", "A Punjabi and North Indian restaurant serving curries, tandoori dishes and chaat with Dubai branches, delivery and catering."), null);
    expect(ranked.role).toBe("direct");
  });
});
