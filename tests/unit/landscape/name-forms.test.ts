import { describe, expect, it } from "vitest";
import { shortNameForms, spokenName } from "@/lib/landscape/name-forms";

describe("short name forms", () => {
  it("accepts a leading name the company's own domain uses", () => {
    expect(shortNameForms("Pancheros Mexican Grill", ["pancheros.com"])).toContain("Pancheros");
    expect(shortNameForms("Rubio's Coastal Grill", ["https://www.rubios.com/"])).toContain("Rubio's");
    // One short word is not a name: a Trade Off once read "Leon vs Truffles".
    expect(shortNameForms("Leon Grill")).not.toContain("Leon");
    expect(spokenName("Leon Grill")).toBe("Leon Grill");
    expect(spokenName("Leon Grill", ["leon.com"])).toBe("Leon");
    // "The Warehouse Gym" is written "Warehouse Gym"; its mentions were counted as untracked.
    expect(shortNameForms("The Warehouse Gym")).toContain("Warehouse Gym");
    expect(shortNameForms("The Warehouse Gym")).not.toContain("The Warehouse");
    expect(spokenName("Pancheros Mexican Grill", ["pancheros.com"])).toBe("Pancheros");
  });

  it("accepts a leading name when every dropped word is a generic descriptor", () => {
    expect(shortNameForms("Brooks Sports", ["brooksrunning.com"])).toEqual(["Brooks"]);
    expect(spokenName("Marriott International", [])).toBe("Marriott");
  });

  it("never shortens a name whose remaining words are part of the brand", () => {
    expect(shortNameForms("Taco Bell", ["tacobell.com"])).toEqual([]);
    expect(shortNameForms("Under Armour", ["underarmour.com"])).toEqual([]);
    expect(shortNameForms("Baja Fresh", ["bajafresh.com"])).toEqual([]);
    expect(shortNameForms("Bank of America", ["bankofamerica.com"])).toEqual([]);
  });

  it("never produces a form too short to disambiguate", () => {
    expect(shortNameForms("New Balance", ["newbalance.com"])).toEqual([]);
    expect(shortNameForms("Del Taco", ["deltaco.com"])).toEqual([]);
    expect(spokenName("Nike", ["nike.com"])).toBe("Nike");
  });
});
