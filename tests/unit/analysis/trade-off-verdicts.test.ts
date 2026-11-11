import { describe, expect, it } from "vitest";
import { analyzeObservation } from "@/lib/analysis/analyzer";
import { codedHeadForms } from "@/lib/analysis/mentions";
import { spokenName } from "@/lib/landscape/name-forms";

// observation-analysis@13/@14. Every case below is shaped on a real ChatGPT answer
// from a DIFC salon's run on 2026-09-18, where reading the answers showed all
// three recorded head-to-head "losses" were misreads and a tracked rival was
// counted as an untracked brand.

const entities = [
  { id: "t", projectId: "p", kind: "target", canonicalName: "Atelier 10 Salon", entityType: "company", parentEntityId: null, domains: ["atelier10.ae"], canonicalDomain: "atelier10.ae", status: "confirmed" },
  { id: "bp", projectId: "p", kind: "competitor", canonicalName: "Bobby Pin Ladies Salon", entityType: "company", parentEntityId: null, domains: ["bobbypin.ae"], canonicalDomain: "bobbypin.ae", status: "confirmed" },
  { id: "ms", projectId: "p", kind: "competitor", canonicalName: "Mokhtar Safadi Beauty Lounge", entityType: "company", parentEntityId: null, domains: [], canonicalDomain: null, status: "confirmed" },
  { id: "y12", projectId: "p", kind: "competitor", canonicalName: "Y12 Salon", entityType: "company", parentEntityId: null, domains: ["y12salons.com"], canonicalDomain: "y12salons.com", status: "confirmed" },
];
const aliases = new Map([["t", ["Atelier 10"]]]);

function analyse(text: string, section: "Discovery" | "Trade Offs", questionRivalEntityId: string | null = null) {
  return analyzeObservation({
    observationId: "o", promptCandidateId: "pc", section, providerExperience: "chatgpt_oxylabs_web",
    responseText: text, sourceUrls: [], captured: true, entities: entities as never, aliasesByEntity: aliases, questionRivalEntityId,
  });
}

function verdictFor(result: ReturnType<typeof analyse>, target = "t", rival: string) {
  const pair = result.comparisons.filter((c) => (c.subjectEntityId === target && c.objectEntityId === rival) || (c.subjectEntityId === rival && c.objectEntityId === target));
  if (pair.some((c) => (c.preference === "SUBJECT" && c.subjectEntityId === target) || (c.preference === "OBJECT" && c.objectEntityId === target))) return "target";
  if (pair.some((c) => (c.preference === "SUBJECT" && c.subjectEntityId === rival) || (c.preference === "OBJECT" && c.objectEntityId === rival))) return "rival";
  return "none";
}

describe("Trade Off verdicts that name one side", () => {
  it("reads 'I'd lean toward <target>' as the target preferred over the question's rival", () => {
    const text =
      "Both Atelier 10 and Bobby Pin Ladies Salon offer nail extensions in the area.\n\nBobby Pin Ladies Salon — a solid option with good reviews.\n\nIf your nails keep breaking, I'd lean toward Atelier 10 — but specifically ask for BIAB or a builder gel overlay.";
    expect(verdictFor(analyse(text, "Trade Offs", "bp"), "t", "bp")).toBe("target");
  });

  it("does not read the lean without the question's rival (a Discovery answer)", () => {
    const text = "For weak nails I'd lean toward Atelier 10.";
    expect(analyse(text, "Discovery").comparisons).toHaveLength(0);
  });

  it("keeps an explicit refusal to choose as no verdict", () => {
    const text = "Atelier 10 and Bobby Pin Ladies Salon both do good work. Honestly it comes down to which location suits you; I'd go with whichever is closer.";
    expect(verdictFor(analyse(text, "Trade Offs", "bp"), "t", "bp")).toBe("none");
  });
});

describe("Comparatives the answer declines to assert", () => {
  it("'there isn't enough evidence to say X lasts longer than Y' is no verdict", () => {
    const text = "So based on verifiable information, there isn't enough evidence to say Bobby Pin Ladies Salon lasts longer than Atelier 10.";
    expect(verdictFor(analyse(text, "Trade Offs", "bp"), "t", "bp")).toBe("none");
  });

  it("'I couldn't find enough … to compare them fairly' is no verdict", () => {
    const text = "Bobby Pin Ladies Salon looks like a solid salon option, but I couldn't find enough reliable current information to compare them fairly with Atelier 10.";
    expect(verdictFor(analyse(text, "Trade Offs", "bp"), "t", "bp")).toBe("none");
  });

  it("a noun ending in -er ('master hairstylist') is not a comparative", () => {
    const text = "Mokhtar Safadi Beauty Lounge is run by a Dubai-based master hairstylist with a 5.0 rating, while Atelier 10 is also listed with a 5.0 rating.";
    expect(verdictFor(analyse(text, "Trade Offs", "ms"), "t", "ms")).toBe("none");
  });
});

describe("A coded name before business-type words", () => {
  it("links 'Y12 Hair Salon' to the tracked 'Y12 Salon'", () => {
    const result = analyse("Y12 Hair Salon — ICD Brookfield Place, DIFC. Convenient central option.", "Discovery");
    expect(result.occurrences.some((o) => o.entityId === "y12")).toBe(true);
    expect(result.emergingCandidates.map((c) => c.name)).not.toContain("Y12 Hair Salon");
  });

  it("is link-only: prompts still write the recorded name", () => {
    expect(codedHeadForms("Y12 Salon")).toEqual(["Y12"]);
    expect(spokenName("Y12 Salon", ["y12salons.com"])).toBe("Y12 Salon");
  });

  it("needs letters and digits, and only business-type words after it", () => {
    expect(codedHeadForms("Sisters Beauty Lounge")).toEqual([]);
    expect(codedHeadForms("1847 Executive Grooming")).toEqual([]);
    expect(codedHeadForms("B612 Studio")).toEqual(["B612"]);
    expect(codedHeadForms("Y12 Salon Group Holdings Ltd")).toEqual(["Y12"]);
  });
});

describe("The asker's own problem is not an opinion", () => {
  it("'if your main issue is frizz' does not make the salon negative", () => {
    const result = analyse("Yes, if your main issue is frizz from Dubai humidity, Atelier 10's keratin smoothing looks like a reasonable option.", "Discovery");
    const target = result.sentiment.find((s) => s.entityId === "t");
    expect(target?.overallPortrayal ?? "NO_SENTIMENT").not.toBe("NEGATIVE");
  });

  it("'the issues with the salon' is still negative", () => {
    const result = analyse("The main issues with Atelier 10 are slow booking replies and inconsistent results.", "Discovery");
    expect(result.sentiment.find((s) => s.entityId === "t")?.overallPortrayal).toBe("NEGATIVE");
  });
});

// observation-analysis@16 (2026-09-19): a second DIFC run's readings.
describe("Verdicts named before the choice, and conditions", () => {
  it("reads 'X has the stronger documented case' as X preferred", () => {
    const text =
      "* **Atelier 10 Salon** — Their lash lift is designed to lift your natural lashes.\n* **Y12 Salon** — more reviews, but less detail on lash lifts.\n\n**So, for a lash lift specifically, Atelier 10 has the stronger documented case.**\n\nOne caveat: Atelier 10 is in DIFC, so Y12 Salon may be much more convenient depending on where you are.";
    expect(verdictFor(analyse(text, "Trade Offs", "y12"), "t", "y12")).toBe("target");
  });

  it("'more convenient depending on where you are' alone is no verdict", () => {
    const text = "Atelier 10 is in DIFC, so Y12 Salon may be much more convenient depending on where you are.";
    expect(verdictFor(analyse(text, "Trade Offs", "y12"), "t", "y12")).toBe("none");
  });
});

describe("What the answer says about the asker, or offers to do", () => {
  it("'a better fit if your nails are weak' is not a negative opinion", () => {
    const result = analyse("Atelier 10 also offers builder gel, which can be a better fit if your nails are weak or prone to breaking.", "Discovery");
    expect(result.sentiment.find((s) => s.entityId === "t")?.overallPortrayal ?? "NO_SENTIMENT").not.toBe("NEGATIVE");
  });

  it("'if your main issues are frizz, puffiness, difficult styling' lists the asker's problems", () => {
    const result = analyse("Yes — Atelier 10’s keratin treatment can be suitable for thick hair, especially if your main issues are frizz, puffiness, difficult styling, or excessive volume.", "Discovery");
    expect(result.sentiment.find((s) => s.entityId === "t")?.overallPortrayal ?? "NO_SENTIMENT").not.toBe("NEGATIVE");
  });

  it("an offer to search for complaints is not a complaint", () => {
    const result = analyse("If you want, I can also dig through Google reviews specifically for complaints about lash hygiene at Atelier 10.", "Discovery");
    expect(result.sentiment.find((s) => s.entityId === "t")?.overallPortrayal ?? "NO_SENTIMENT").toBe("NO_SENTIMENT");
  });

  it("a condition does not hide the opinion after it", () => {
    const result = analyse("If your hair is damaged, Atelier 10 is a poor choice for bleaching.", "Discovery");
    expect(result.sentiment.find((s) => s.entityId === "t")?.overallPortrayal).toBe("NEGATIVE");
  });
});

describe("Each side chosen under its own condition", () => {
  it("is no verdict", () => {
    const text = "* Choose **Atelier 10** if you want a quiet studio near DIFC.\n* Choose **Bobby Pin Ladies Salon** if you need late appointments.";
    expect(verdictFor(analyse(text, "Trade Offs", "bp"), "t", "bp")).toBe("none");
  });
});

// observation-analysis@17 (2026-10-15): a third DIFC run, where five of ten
// Trade Off answers read as "didn't compare them" although every one compared.
describe("Head-to-head answers written the short way", () => {
  const rivals = [
    ...entities,
    { id: "x1847", projectId: "p", kind: "competitor", canonicalName: "1847 Executive Grooming for Men DIFC", entityType: "company", parentEntityId: null, domains: [], canonicalDomain: null, status: "confirmed" },
    { id: "chaps", projectId: "p", kind: "competitor", canonicalName: "Chaps & Co DIFC", entityType: "company", parentEntityId: null, domains: [], canonicalDomain: null, status: "confirmed" },
    { id: "nb", projectId: "p", kind: "competitor", canonicalName: "Nooshes Beauty Salon", entityType: "company", parentEntityId: null, domains: [], canonicalDomain: null, status: "confirmed" },
    { id: "tt", projectId: "p", kind: "competitor", canonicalName: "Tips & Toes", entityType: "company", parentEntityId: null, domains: [], canonicalDomain: null, status: "confirmed" },
  ];
  const run = (text: string, rival: string, section: "Trade Offs" | "Discovery" = "Trade Offs") =>
    analyzeObservation({
      observationId: "o", promptCandidateId: "pc", section, providerExperience: "chatgpt_oxylabs_web",
      responseText: text, sourceUrls: [], captured: true, entities: rivals as never, aliasesByEntity: aliases, questionRivalEntityId: section === "Trade Offs" ? rival : null,
    });

  it("links the question's rival by its leading words ('1847', 'Chaps & Co')", () => {
    expect(run("1847 has several branches across Dubai.", "x1847").occurrences.some((o) => o.entityId === "x1847")).toBe(true);
    expect(run("Chaps & Co is a traditional barbershop.", "chaps").occurrences.some((o) => o.entityId === "chaps")).toBe(true);
  });

  it("links those short forms only in the answer to that head-to-head question", () => {
    expect(run("1847 has several branches across Dubai.", "x1847", "Discovery").occurrences.some((o) => o.entityId === "x1847")).toBe(false);
  });

  it("never links one short ordinary word ('Tips' for 'Tips & Toes')", () => {
    expect(run("Tips: book early on weekends.", "tt").occurrences.some((o) => o.entityId === "tt")).toBe(false);
  });

  it("reads 'I’d lean towards X' with a curly apostrophe", () => {
    const text = "Honestly, **I’d lean towards Nooshes Beauty for nail extensions**, based on the reviews.\n\nAtelier 10 Salon\n\nA premium option with a smaller review sample.";
    expect(verdictFor(run(text, "nb"), "t", "nb")).toBe("rival");
  });

  it("reads 'My initial pick would be X' and 'My verdict: X'", () => {
    expect(verdictFor(run("My initial pick would be **Atelier 10 for a precision haircut**, while **Bobby Pin is a strong option if you want a ladies’ salon experience** in Dubai.", "bp"), "t", "bp")).toBe("target");
    expect(verdictFor(run("**My verdict:** Atelier 10 for the technique advertised; Nooshes Beauty is still worth considering if you find a technician you love.", "nb"), "t", "nb")).toBe("target");
  });

  it("keeps a lean whose caveat follows ', but'", () => {
    const text = "**My verdict:** I’d lean toward Atelier 10 for a customised set, but I couldn’t verify enough comparable, lash-specific reviews to confidently say its application is better than Tips & Toes.";
    expect(verdictFor(run(text, "tt"), "t", "tt")).toBe("target");
  });

  it("does not count 'if you're choosing between A and B' as one of the answer's conditions", () => {
    const text = "If you're choosing between **Atelier 10 and Tips & Toes for balayage in Dubai**, I'd lean toward **Atelier 10 for a more personalised service** — especially if you're after a seamless result.";
    expect(verdictFor(run(text, "tt"), "t", "tt")).toBe("target");
  });

  it("reads 'A if you want X, and B if you want Y' as no winner, even with a later 'A would be my first choice'", () => {
    const text = "For a men’s haircut in Dubai, I’d lean towards **Atelier 10 if you want a more personalised cut, and 1847 if you want a premium men’s grooming experience.**\n\n- **For a modern haircut:** Atelier 10 would be my first choice to try.";
    const result = run(text, "x1847");
    expect(verdictFor(result, "t", "x1847")).toBe("none");
    expect(result.comparisons.some((c) => c.preference === "TIE" && c.split)).toBe(true);
  });

  it("reads 'Choose A for X; choose B if Y' as no winner, and lets that final verdict stand over an earlier lean", () => {
    const text =
      "For a haircut and beard trim in Dubai, **I’d lean towards 1847 if you want a polished, traditional grooming experience.** But Atelier 10 is a strong alternative if you prefer a stylist-led haircut.\n\n**My final verdict:** Choose 1847 for the overall grooming experience; choose Atelier 10 if you want a more personalised approach to your hairstyle.";
    expect(verdictFor(run(text, "x1847"), "t", "x1847")).toBe("none");
  });
});
