import { newId } from "@/lib/ids";
import { listEntities, listAliasesForEntities } from "@/lib/landscape/repository";
import { getProviderResponse } from "@/lib/collection/repository";
import { parseMentions, parseCitations, PARSER_VERSION } from "./normalization";
import { insertMentions, insertCitations } from "./repository";
import { appendEvent } from "@/lib/events/bus";

/** Runs the deterministic parser (spec 8.2) over one committed observation
 * and persists derived mention/citation facts. Idempotent-ish in effect
 * since it's called exactly once, right after the observation is committed. */
export async function normalizeProviderResponse(providerResponseId: string, projectId: string): Promise<void> {
  const response = await getProviderResponse(providerResponseId);
  if (!response) throw new Error(`provider_response ${providerResponseId} not found`);

  const entities = await listEntities(projectId);
  const relevant = entities.filter((e) => e.kind === "target" || e.status === "confirmed");
  const aliasRows = await listAliasesForEntities(relevant.map((e) => e.id));
  const aliasesByEntity = new Map<string, string[]>();
  for (const row of aliasRows) {
    const list = aliasesByEntity.get(row.entityId) ?? [];
    list.push(row.alias);
    aliasesByEntity.set(row.entityId, list);
  }

  const mentionResults = parseMentions(response.responseText, relevant, aliasesByEntity);
  const citationResults = parseCitations(response.sourceUrls as string[], relevant);

  await insertMentions(
    mentionResults.map((m) => ({
      id: newId("mtn"),
      providerResponseId,
      entityId: m.entityId,
      aliasMatched: m.aliasMatched,
      charStart: m.charStart,
      charEnd: m.charEnd,
      isRecommendation: m.isRecommendation,
      rankPosition: m.rankPosition,
      confidence: m.confidence,
      parserVersion: PARSER_VERSION,
    })),
  );
  await insertCitations(
    citationResults.map((c) => ({
      id: newId("cit"),
      providerResponseId,
      url: c.url,
      domain: c.domain,
      matchedEntityId: c.matchedEntityId,
      isOwnedDomain: c.isOwnedDomain,
    })),
  );

  appendEvent(projectId, "metric.snapshot.updated", { reason: "new_observation_normalized", providerResponseId });
}
