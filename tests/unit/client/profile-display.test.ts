import { describe, expect, it } from "vitest";
import { industryText } from "@/lib/client/profile-display";

describe("industryText", () => {
  it("keeps text industries", () => {
    expect(industryText("Hair salons")).toBe("Hair salons");
    expect(industryText("")).toBe("");
  });

  it("turns the early { primary, secondary } shape into text instead of an object child", () => {
    expect(industryText({ primary: "Retail", secondary: "Athletic footwear and apparel" })).toBe("Retail › Athletic footwear and apparel");
    expect(industryText({ primary: "Retail", secondary: null })).toBe("Retail");
  });

  it("returns empty text for anything unreadable", () => {
    expect(industryText(null)).toBe("");
    expect(industryText(42)).toBe("");
    expect(industryText({})).toBe("");
  });
});
