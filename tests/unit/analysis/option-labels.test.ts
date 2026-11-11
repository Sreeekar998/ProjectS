import { describe, expect, it } from "vitest";
import { analyzeObservation } from "@/lib/analysis/analyzer";

// observation-analysis@15. Shaped on real ChatGPT answers from a DIFC salon's
// run on 2026-09-19: the answers listed salons as map entries and as
// "* **Name** — Area." bullets. Five-word names and names with "&" were lost,
// and the area after the dash was counted as a business, so the "who ChatGPT
// names" list was led by a residential tower and a hotel.

const entities = [
  { id: "t", projectId: "p", kind: "target", canonicalName: "Atelier 10 Salon", entityType: "company", parentEntityId: null, domains: ["atelier10.ae"], canonicalDomain: "atelier10.ae", status: "confirmed" },
];
const aliases = new Map([["t", ["Atelier 10"]]]);
const emerging = {
  places: ["Dubai", "DIFC", "Dubai International Financial Centre", "Business Bay", "Trade Centre"],
  categoryTerms: ["salon", "salons", "beauty", "nail", "nails", "hair", "lash", "brow", "spa", "lounge", "studio", "restaurant", "pilates", "manicure"],
};

function names(text: string): string[] {
  const result = analyzeObservation({
    observationId: "o", promptCandidateId: "pc", section: "Discovery", providerExperience: "chatgpt_oxylabs_web",
    responseText: text, sourceUrls: [], captured: true, entities: entities as never, aliasesByEntity: aliases, emerging,
  });
  return result.emergingCandidates.map((candidate) => candidate.name).sort();
}

describe("Map entries", () => {
  it("keeps a whole listed name, however long and with '&'", () => {
    const text = "Nova Noir Russian Beauty Salon\n\n4.7•Beauty salon\n\nClosed\n\nELAN Lash & Brow Beauty Lounge\n\n4.9•Beauty salon\n\nOpen\n\nThese are well rated for lashes.";
    expect(names(text)).toEqual(["ELAN Lash & Brow Beauty Lounge", "Nova Noir Russian Beauty Salon"]);
  });

  it("reads a compact block, where the rating sits above the name", () => {
    const text = "4.9\n\nFoxy Lane Russian Nail Studio\n\n4.6\n\nOnly U nail salon | Russian\n\nUse two fingers to move the map\n\nThese salons do Russian manicures.";
    expect(names(text)).toEqual(["Foxy Lane Russian Nail Studio", "Only U nail salon"]);
  });

  it("counts two branches as one business", () => {
    const text = "N.Bar Nail Spa & Salon Emirates Towers\n\n4.9•Nail salon\n\nN.Bar Nail Spa & Salon Gate Avenue\n\n4.8•Nail salon\n\nBoth offer gel manicures.";
    expect(names(text)).toEqual(["N.Bar Nail Spa & Salon"]);
  });
});

describe("List labels before a dash", () => {
  it("counts the label, not the area written after the dash", () => {
    const text = "Salons I’d look at:\n\n* **Only U nail salon | Russian** — Azizi Riviera. Convenient if you're around Meydan.\n* Matryoshka Russian Beauty Salon – Nails, Lashes & Brows - DIFC, Dubai — Carlton Downtown Hotel. Offers lash services alongside brows and nails.";
    const found = names(text);
    expect(found).toContain("Only U nail salon");
    expect(found).toContain("Matryoshka Russian Beauty Salon");
    expect(found).not.toContain("Azizi Riviera");
    expect(found).not.toContain("Carlton Downtown Hotel");
  });

  it("never proposes where a tracked business is", () => {
    const text = "* **Atelier 10** — 6th floor, Staybridge Suites, DIFC. They offer natural lash sets.";
    expect(names(text)).not.toContain("Staybridge Suites");
  });

  it("keeps a name the description introduces", () => {
    const text = "* **Atelier 10** — or try Glow Beauty Salon if it is full. Both do lashes.";
    expect(names(text)).toContain("Glow Beauty Salon");
  });

  it("does not read a heading label as a business", () => {
    const text = "What to check:\n\n1. **Attribution/reporting** — can the salon show reviews for nail work?\n2. **Best for colour** — a salon with a colourist on staff.";
    expect(names(text)).toEqual([]);
  });

  it("keeps the whole label over its first word", () => {
    const text = "House of Burn\n\n5.0•Pilates studio\n\nOpen\n\n* **House of Burn — JLT**\n  A newer, design-conscious studio.";
    expect(names(text)).toEqual(["House of Burn"]);
  });

  it("reads a proven name the same way in the answer's sentences", () => {
    const text = "Riviera by Jean Imbert\n\n4.8•Mediterranean restaurant\n\nOpen\n\nIf this is an important client dinner, I’d narrow it to Riviera by Jean Imbert or Ancora.";
    const found = names(text);
    expect(found).toContain("Riviera by Jean Imbert");
    expect(found).not.toContain("Jean Imbert");
  });
});

// observation-analysis@18. Shaped on real ChatGPT answers from the same
// salon's runs on 2026-10-15: options written as a numbered name alone, on a
// line or a markdown heading, with the area, rating and description below.
// Six ranked salons read as an answer naming no business, and the salon's own
// #4 slot read as a bare mention.
// The salon's own offerings ("colour", "balayage") are category words in its
// real run context, as they are here.
const salonContext = { ...emerging, categoryTerms: [...emerging.categoryTerms, "colour", "balayage"] };
function analyse(text: string) {
  return analyzeObservation({
    observationId: "o", promptCandidateId: "pc", section: "Discovery", providerExperience: "chatgpt_cloro_web",
    responseText: text, sourceUrls: [], captured: true, entities: entities as never, aliasesByEntity: aliases, emerging: salonContext,
  });
}

describe("Numbered names with a listing below (@18)", () => {
  const headings =
    "## My top picks\n\n## 1. ELAN Lash & Brow Beauty Lounge\n\nBest overall\n\nDIFC · Index Tower\n\n4.9/5 · 1,272 reviews\n\nA strong first choice for detailed lash work.\n\n" +
    "## 2. Eyelash Secret Ladies Salon – Iris Bay\n\nBusiness Bay · Iris Bay Tower\n\n4.9/5 · 1,006 reviews\n\nA dedicated lash salon.\n\n" +
    "### 3. [The Nail Spa — DIFC](https://www.google.com/maps/search/?api=1&query=The+Nail+Spa)\n\n- **Location:** Gate Avenue, ground floor.\n- **Rating:** 4.8/5 from 293 reviews.";

  it("reads every listed salon and ranks them by their numbers", () => {
    const result = analyse(headings);
    expect(result.emergingCandidates.map((c) => c.name).sort()).toEqual(["ELAN Lash & Brow Beauty Lounge", "Eyelash Secret Ladies Salon", "The Nail Spa"]);
    expect(result.rankEligibility).toBe("explicit_ordered_list");
    expect(result.positions.find((p) => p.explicitRank === 1)?.name).toBe("ELAN Lash & Brow Beauty Lounge");
  });

  it("never reads the area or rating lines under a name as businesses", () => {
    const found = analyse(headings).emergingCandidates.map((c) => c.name);
    expect(found).not.toContain("Index Tower");
    expect(found).not.toContain("Iris Bay Tower");
    expect(found).not.toContain("Best");
  });

  it("recommends the tracked salon in its own numbered slot and records its rank", () => {
    const text =
      "Here are my top luxury-leaning picks.\n\n## Luxury salons in Dubai for a balayage refresh\n\n1. Maria Dowling\nAl Mina · Colour specialist\nKnown for bespoke balayage.\n[Official website](https://www.mariadowling.com)\n\n" +
      "2. Pastels Salon\nJumeirah · Al Wasl\nAn established premium salon.\n[Official website](https://www.pastels-salon.com)\n\n" +
      "3. Atelier 10\nDIFC · Master-stylist-led colour\nOffers hand-painted balayage.";
    const result = analyse(text);
    const target = result.occurrences.find((o) => o.entityId === "t")!;
    expect(target.role).toBe("RECOMMENDED");
    expect(result.positions.find((p) => p.entityId === "t")?.explicitRank).toBe(3);
    expect(result.emergingCandidates.map((c) => c.name).sort()).toEqual(["Maria Dowling", "Pastels Salon"]);
  });

  it("does not read an advice list as businesses", () => {
    const text =
      "## How to choose\n\n## 1. Check Reviews\n\nLook at recent reviews for lash work before booking.\n\n## 2. Ask About Products\n\nAsk which adhesive the salon uses.\n\n" +
      "1. Preferred area\n- Dubai Marina / JBR\n- Downtown Dubai / Business Bay";
    expect(analyse(text).emergingCandidates).toEqual([]);
  });

  it("does not rank salons listed in bullets beside numbered steps", () => {
    const text =
      "* **Glow Beauty Salon** — Business Bay. Good for lashes.\n* **Lash Lab Studio** — Jumeirah. Good for lifts.\n\nBefore you book:\n\n1. Ask for a patch test.\n2. Bring photos of the look you want.";
    expect(analyse(text).rankEligibility).toBe("not_rankable");
  });

  it("counts a shorter reference to a listed salon as the same salon", () => {
    const text = "## 1. UB Grooming Salon\n\nDAMAC Park Towers, DIFC\n\n4.9/5 · 175 reviews\n\nUB Grooming is good for fades and beard trims.";
    expect(analyse(text).emergingCandidates.map((c) => c.name)).toEqual(["UB Grooming Salon"]);
  });
});
