import { describe, expect, it } from "vitest";
import { capDrinkTopics } from "@/lib/landscape/topic-generation";
import { applyClassificationEdit } from "@/lib/understanding/edits";
import { makeProfile } from "../../helpers/profile-fixtures";
import type { TopicCandidate } from "@/lib/landscape/topics";

const topic = (name: string): TopicCandidate => ({ name, description: name, evidenceIds: [], source: "system" });

describe("drink topics for a restaurant", () => {
  const names = ["Modern Indian fine dining", "Indian degustation menus", "Wine pairings and bottles", "Vegetarian fine dining", "Cocktails and non-alcoholic pairings"];

  it("keeps one drinks topic for a restaurant", () => {
    let profile = makeProfile({ brandName: "Studio", archetype: "restaurant_food_chain", industry: "Food" });
    profile = applyClassificationEdit(profile, { businessType: "Modern Indian fine dining restaurant", kind: "restaurant_food_beverage", physicalPresence: "single_location" });
    const kept = capDrinkTopics(names.map(topic), profile).map((t) => t.name);
    expect(kept).toEqual(["Modern Indian fine dining", "Indian degustation menus", "Wine pairings and bottles", "Vegetarian fine dining"]);
  });

  it("leaves a cocktail bar's drinks topics alone", () => {
    let profile = makeProfile({ brandName: "Bar", archetype: "restaurant_food_chain", industry: "Food" });
    profile = applyClassificationEdit(profile, { businessType: "Cocktail bar", kind: "restaurant_food_beverage", physicalPresence: "single_location" });
    expect(capDrinkTopics(names.map(topic), profile)).toHaveLength(5);
  });
});
