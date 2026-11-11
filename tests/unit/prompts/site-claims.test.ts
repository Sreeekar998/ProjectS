import { describe, it, expect } from "vitest";
import { siteClaimsFor } from "@/lib/prompts/discovery";
import type { BusinessProfile } from "@/lib/profile/schema";
import type { PromptIntentModel } from "@/lib/prompts/intent-model";
import { makeProfile } from "../../helpers/profile-fixtures";

// The judge fails a Discovery prompt that "asks for the website's own claim".
// For a burger restaurant whose grounding notes read "The website highlights
// burgers and desserts in its title", every burger prompt failed and four
// template prompts were selected instead. Claims are distinctive specifics,
// never what the business sells or a note about the site.
describe("siteClaimsFor", () => {
  const model = {
    needs: [{ category: "burger restaurants", synonyms: ["burger places"] }],
    concerns: [],
    distinctiveClaims: ["Signature plum cake baked in-house since 1997"],
  } as unknown as PromptIntentModel;
  const profile = {
    ...makeProfile({ brandName: "Truffles", archetype: "restaurant_food_chain", industry: "restaurants", offerings: ["Burgers", "Desserts", "Plum Cake (500 gm)"], countries: ["India"], domain: "truffles.co.in" }),
    positioning: {
      differentiators: [
        "The website highlights burgers and desserts in its title.",
        "The site offers seasonal Christmas Specials, including Truffles Signature Plum Cake.",
        "Burgers and desserts restaurant",
        "Founder-led kitchen with a 25-year-old recipe",
      ],
    },
  } as unknown as BusinessProfile;

  it("keeps distinctive claims and drops what the business sells or notes about the site", () => {
    const claims = siteClaimsFor(profile, model);
    expect(claims).toContain("Founder-led kitchen with a 25-year-old recipe");
    expect(claims).toContain("Signature plum cake baked in-house since 1997");
    expect(claims.some((claim) => /website|the site/i.test(claim))).toBe(false);
    expect(claims).not.toContain("Burgers and desserts restaurant");
  });
});
