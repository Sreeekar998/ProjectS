import { runWebsiteIntelligence } from "@/lib/profile/orchestrator";
import { appendEvent } from "@/lib/events/bus";
import { release } from "@/lib/jobs/active";
import { getLatestCrawlRun } from "./repository";

export interface CrawlPipelineOptions {
  /** The operator's Search Console choice for this run; absent means "as last time". */
  searchConsole?: { enabled: boolean };
}

/** Job-registry key held while a project's crawl and profile run. */
export function crawlJobKey(projectId: string): string {
  return `crawl:${projectId}`;
}

type StartSequenceHolder = typeof globalThis & { __sunCrawlStartSequence?: Map<string, number> };

function startSequences(): Map<string, number> {
  const holder = globalThis as StartSequenceHolder;
  holder.__sunCrawlStartSequence ??= new Map<string, number>();
  return holder.__sunCrawlStartSequence;
}

/**
 * The event sequence a running crawl started after. A second "Analyse" click
 * while one is running gets this back, so the page scopes its progress rail to
 * the run that is actually going instead of to the moment of the click.
 */
export function crawlStartSequence(projectId: string): number | undefined {
  return startSequences().get(projectId);
}

export function noteCrawlStart(projectId: string, sequence: number): void {
  startSequences().set(projectId, sequence);
}

/**
 * A bodiless crawl ("Analyse again" after a stall or failure) keeps the Search
 * Console choice of the previous run. After a failure there is no profile to
 * read it from, so it is recorded on the crawl run row when the run starts.
 */
export async function previousRunRequestedSearchConsole(projectId: string): Promise<boolean> {
  const previous = await getLatestCrawlRun(projectId);
  return previous?.metrics?.searchConsoleRequested === "yes";
}

/**
 * Runs the Website Intelligence pipeline fire-and-forget from the API route so
 * the HTTP response returns immediately — progressive results are mandatory
 * (spec 10.2), so no long-running stage may block the request. Every step is
 * carried on the SSE stream; this function's only job is to keep going and
 * never throw into the void. It always frees the project's crawl job key,
 * which the crawl route claimed before calling it.
 */
export async function runCrawlAndProfilePipeline(projectId: string, options: CrawlPipelineOptions = {}): Promise<void> {
  try {
    const enabled = options.searchConsole?.enabled ?? (await previousRunRequestedSearchConsole(projectId));
    await runWebsiteIntelligence(projectId, { searchConsole: { enabled } });
  } catch (err) {
    const error = err instanceof Error ? err.message : "unknown_error";
    appendEvent(projectId, "profile.failed", { stage: "pipeline", reason: error });
    appendEvent(projectId, "policy.status", { stage: "crawl_pipeline", error });
  } finally {
    startSequences().delete(projectId);
    release(crawlJobKey(projectId));
  }
}
