import { describe, expect, it } from "vitest";
import { buildLinkTargets, detectMentions } from "@/lib/analysis/mentions";
import type { Entity } from "@/lib/landscape/repository";

function entity(id: string, canonicalName: string, kind: "target" | "competitor"): Entity {
  return { id, canonicalName, domains: [], canonicalDomain: null, kind, status: "confirmed", parentEntityId: null, entityType: "company" } as unknown as Entity;
}

describe("plural brand mentions", () => {
  const targets = buildLinkTargets([entity("nike", "Nike", "target"), entity("asics", "Asics", "competitor")], new Map());

  it("credits a plural to the brand it names", () => {
    const found = detectMentions("Plenty of new runners swear by their Nikes.", targets);
    expect(found.map((mention) => mention.entityId)).toEqual(["nike"]);
    expect(found[0]!.span.text).toBe("Nikes");
  });

  it("leaves names that already end in s, and lower-case words, alone", () => {
    expect(detectMentions("Asics fit well, and nikes is not a word.", targets).map((mention) => mention.entityId)).toEqual(["asics"]);
  });
});
