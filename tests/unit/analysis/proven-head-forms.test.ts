import { describe, expect, it } from "vitest";
import { buildLinkTargets, detectMentions, linkProvenHeadForms } from "@/lib/analysis/mentions";
import type { Entity } from "@/lib/landscape/repository";

// Answers about a Dubai gym wrote "Warehouse" seventeen times after naming
// "The Warehouse Gym" once; each was counted as an untracked brand.
const gym = { id: "ent_target", projectId: "p", canonicalName: "The Warehouse Gym", canonicalDomain: "whgym.com", domains: [], entityType: "target", status: "confirmed", parentEntityId: null } as unknown as Entity;
const rival = { id: "ent_rival", projectId: "p", canonicalName: "Gold's Gym", canonicalDomain: "goldsgym.ae", domains: [], entityType: "competitor", status: "confirmed", parentEntityId: null } as unknown as Entity;
const targets = buildLinkTargets([gym, rival], new Map());

describe("proven head forms", () => {
  it("links the one-word head once the same answer has named the business in full", () => {
    const text = "The Warehouse Gym has six branches. Warehouse says its Premium membership covers all of them, and Warehouse's PT offering is strong. Gold's Gym is cheaper; Gold's runs a day pass.";
    const mentions = linkProvenHeadForms(text, detectMentions(text, targets), targets, ["gym", "fitness"]);
    const gymSpans = mentions.filter((m) => m.entityId === "ent_target").map((m) => m.span.text);
    expect(gymSpans).toEqual(["The Warehouse Gym", "Warehouse", "Warehouse"]);
    expect(mentions.filter((m) => m.entityId === "ent_rival").map((m) => m.span.text)).toEqual(["Gold's Gym", "Gold's"]);
  });

  it("does not link the head in an answer that never names the business in full, or that writes the head as a word", () => {
    const alone = "A warehouse gym is a big box with racks; Warehouse spaces are cheap to rent.";
    expect(linkProvenHeadForms(alone, detectMentions(alone, targets), targets, ["gym"])).toEqual([]);
    const lower = "The Warehouse Gym is in a converted warehouse; the Warehouse layout suits lifters.";
    const mentions = linkProvenHeadForms(lower, detectMentions(lower, targets), targets, ["gym"]);
    expect(mentions.map((m) => m.span.text)).toEqual(["The Warehouse Gym"]);
  });

  it("links a recorded name written with a curly apostrophe", () => {
    const text = "Gold’s Gym is cheaper than The Warehouse Gym, and Gold’s has more branches.";
    const mentions = linkProvenHeadForms(text, detectMentions(text, targets), targets, ["gym"]);
    expect(mentions.filter((m) => m.entityId === "ent_rival").map((m) => m.span.text)).toEqual(["Gold’s Gym", "Gold’s"]);
  });

  it("links a recorded name written with a no-break space", () => {
    const nb = { id: "ent_nb", projectId: "p", canonicalName: "New Balance", canonicalDomain: "newbalance.com", domains: [], entityType: "competitor", status: "confirmed", parentEntityId: null } as unknown as Entity;
    const text = "Both Nike and New\u00a0Balance make good trainers; the New Balance 990 is a classic.";
    expect(detectMentions(text, buildLinkTargets([nb], new Map())).map((m) => m.span.start)).toHaveLength(2);
  });

  it("never links inside a URL", () => {
    const text = "The Warehouse Gym lists prices at https://whgym.com/Warehouse/prices and Warehouse confirms them.";
    const mentions = linkProvenHeadForms(text, detectMentions(text, targets), targets, ["gym"]);
    expect(mentions.map((m) => m.span.start)).toHaveLength(2);
  });
});
