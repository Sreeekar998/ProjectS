import { EventEmitter } from "node:events";
import { eq, gt, and, asc } from "drizzle-orm";
import { getDb, getRawSqlite } from "@/lib/db/client";
import { events } from "@/lib/db/schema";
import { newId } from "@/lib/ids";

// Minimum event families per spec section 10.2: crawl.page.*, profile.field.*,
// landscape.topic.*, landscape.competitor.*, prompt.candidate.*,
// prompt.selection.*, prompt_set.ready, prompt_run.*, metric.snapshot.updated,
// and policy/route status events.
export type SunEventType =
  | "crawl.started"
  | "crawl.sitemap.discovered"
  | "crawl.page.discovered"
  | "crawl.page.fetched"
  | "crawl.page.selected"
  | "crawl.page.classified"
  | "crawl.page.skipped"
  | "crawl.evidence.extracted"
  | "crawl.blocked"
  | "crawl.failed"
  | "crawl.completed"
  | "profile.synthesis.started"
  | "profile.understanding.stage"
  | "profile.field.updated"
  | "profile.ready"
  | "profile.failed"
  | "profile.confirmed"
  | "profile.edited"
  // Optional Google Search Console pull during Understand. Payloads never carry
  // query text, tokens or account ids; the rail shows one status step from them.
  | "search_console.sync.started"
  | "search_console.sync.completed"
  | "search_console.sync.skipped"
  | "search_console.sync.failed"
  | "landscape.topic.candidate"
  | "landscape.competitor.discovery_started"
  | "landscape.competitor.candidate_found"
  | "landscape.competitor.verifying"
  | "landscape.competitor.suggestion_ready"
  | "landscape.competitor.rejected"
  | "landscape.competitor.discovery_completed"
  | "landscape.competitor.discovery_failed"
  | "landscape.ready"
  | "landscape.confirmed"
  | "prompt.generation.started"
  | "prompt.context.ready"
  | "prompt.generation.section_failed"
  | "prompt.coverage_plan.ready"
  | "prompt.candidate.validated"
  | "prompt.candidate.rejected"
  | "prompt.candidate.shortlisted"
  | "prompt.candidate.clustered"
  | "prompt.candidate.scored"
  | "prompt.shortlist.updated"
  | "prompt.custom.added"
  | "prompt.candidate.selected"
  | "prompt.counters.updated"
  | "prompt_set.ready"
  | "prompt_set.approved"
  | "prompt_run.state_changed"
  | "collection_run.progress"
  | "metric.snapshot.updated"
  | "policy.status";

export interface SunEvent {
  id: string;
  projectId: string;
  sequence: number;
  type: SunEventType;
  payload: Record<string, unknown>;
  createdAt: number;
}

const emitters = new Map<string, EventEmitter>();

function emitterFor(projectId: string): EventEmitter {
  let em = emitters.get(projectId);
  if (!em) {
    em = new EventEmitter();
    em.setMaxListeners(50);
    emitters.set(projectId, em);
  }
  return em;
}

/** Synchronous, atomic append using the raw sqlite handle so sequence
 * assignment can never race across concurrent async callers in-process. */
export function appendEvent(projectId: string, type: SunEventType, payload: Record<string, unknown>): SunEvent {
  const sqlite = getRawSqlite();
  const id = newId("evt");
  const createdAt = Date.now();
  const row = sqlite
    .prepare(
      `INSERT INTO events (id, project_id, sequence, type, payload, created_at)
       VALUES (?, ?, COALESCE((SELECT MAX(sequence) FROM events WHERE project_id = ?), 0) + 1, ?, ?, ?)
       RETURNING sequence`,
    )
    .get(id, projectId, projectId, type, JSON.stringify(payload), createdAt) as { sequence: number };

  const event: SunEvent = { id, projectId, sequence: row.sequence, type, payload, createdAt };
  emitterFor(projectId).emit("event", event);
  return event;
}

/**
 * Highest sequence written for a project so far (0 when none). Background-job
 * routes return it in their 202 as `sinceSequence`, so a page can tell events
 * of the job it just started from an earlier run's leftovers.
 */
export function latestSequence(projectId: string): number {
  const row = getRawSqlite().prepare(`SELECT COALESCE(MAX(sequence), 0) AS sequence FROM events WHERE project_id = ?`).get(projectId) as { sequence: number } | undefined;
  return row?.sequence ?? 0;
}

export async function getEventsSince(projectId: string, afterSequence: number): Promise<SunEvent[]> {
  const db = getDb();
  const rows = await db
    .select()
    .from(events)
    .where(and(eq(events.projectId, projectId), gt(events.sequence, afterSequence)))
    .orderBy(asc(events.sequence))
    .all();
  return rows.map((r) => ({
    id: r.id,
    projectId: r.projectId,
    sequence: r.sequence,
    type: r.type as SunEventType,
    payload: r.payload as Record<string, unknown>,
    createdAt: r.createdAt.getTime(),
  }));
}

export function subscribeLive(projectId: string, onEvent: (event: SunEvent) => void): () => void {
  const em = emitterFor(projectId);
  em.on("event", onEvent);
  return () => em.off("event", onEvent);
}
