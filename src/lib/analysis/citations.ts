// Citation normalization and source ownership.
//
// A brand cited as a source has not necessarily been mentioned to the reader.
// "Sources: nike.com" with no "Nike" anywhere in the answer body is a citation
// fact, not a brand-presence fact, and the two are kept in separate records so
// a later metric cannot accidentally merge them.

import { parse as parseTld } from "tldts";
import type { Entity } from "@/lib/landscape/repository";
import type { DetectedMention } from "./mentions";
import type { NormalizedCitation, SourceOwnership } from "./types";

/** Registrable domain, lowercased, without "www.". Null when unparseable. */
export function registrableDomain(value: string): string | null {
  const raw = value.trim();
  if (!raw) return null;
  const withScheme = /^https?:\/\//i.test(raw) ? raw : `https://${raw}`;
  try {
    const host = new URL(withScheme).hostname;
    const parsed = parseTld(host);
    return parsed.domain?.toLowerCase() ?? (host.replace(/^www\./, "").toLowerCase() || null);
  } catch {
    return null;
  }
}

/**
 * Maps domains to owning entities.
 *
 * Ownership resolves through the parent chain, so a product micro-site
 * belonging to a sub-brand is attributed to the brand that owns it rather than
 * being counted as an unrelated third party.
 */
export function buildDomainOwnership(entities: Entity[]): Map<string, { entityId: string; ownership: SourceOwnership }> {
  const byId = new Map(entities.map((e) => [e.id, e]));
  const map = new Map<string, { entityId: string; ownership: SourceOwnership }>();

  for (const entity of entities) {
    let root = entity;
    const guard = new Set<string>([entity.id]);
    while (root.parentEntityId && byId.has(root.parentEntityId) && !guard.has(root.parentEntityId)) {
      guard.add(root.parentEntityId);
      root = byId.get(root.parentEntityId)!;
    }
    const ownership: SourceOwnership =
      root.kind === "target" ? "TARGET_OWNED" : root.kind === "competitor" ? "COMPETITOR_OWNED" : "UNKNOWN";

    const domains = [...((entity.domains as string[]) ?? []), entity.canonicalDomain ?? ""].filter(Boolean);
    for (const domain of domains) {
      const normalized = registrableDomain(domain);
      if (normalized) map.set(normalized, { entityId: root.id, ownership });
    }
  }
  return map;
}

export function normalizeCitations(
  urls: string[],
  entities: Entity[],
  mentions: DetectedMention[],
): NormalizedCitation[] {
  const ownership = buildDomainOwnership(entities);
  const mentionedEntityIds = new Set(mentions.map((m) => m.entityId).filter(Boolean) as string[]);

  const seen = new Set<string>();
  const out: NormalizedCitation[] = [];
  for (const url of urls) {
    const domain = registrableDomain(url);
    if (!domain) {
      out.push({ url, domain: "", ownership: "UNKNOWN", ownerEntityId: null, ownerMentionedInText: false });
      continue;
    }
    const key = `${url}|${domain}`;
    if (seen.has(key)) continue;
    seen.add(key);

    const owner = ownership.get(domain);
    out.push({
      url,
      domain,
      // A domain we cannot attribute is THIRD_PARTY only in the sense that it
      // is not ours or a tracked competitor's; that is all we actually know.
      ownership: owner?.ownership ?? "THIRD_PARTY",
      ownerEntityId: owner?.entityId ?? null,
      ownerMentionedInText: owner ? mentionedEntityIds.has(owner.entityId) : false,
    });
  }
  return out;
}
