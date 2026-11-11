// In-process registry of background jobs that are running right now.
//
// Background work is fire-and-forget (`void job()` + 202) with no queue, so a
// second POST started a second crawl on the same project (its events leaked
// into the progress rail), and after a restart a `running` row looked alive
// forever. Routes acquire a key before starting a job and release it in the
// job's `finally`; GET routes report `inProgress` from `isActive`, so a page
// can tell a live job from a stranded row. The set lives on globalThis so
// Next.js dev-mode module reloads share one registry, and it empties on
// restart, which is exactly the "nothing is running any more" signal.
//
// Keys: `crawl:<projectId>` | `landscape:<projectId>` | `prompts:<projectId>` | `discovery-run:<runId>`.
//
// Server-only (process memory).

type JobRegistryHolder = typeof globalThis & { __sunActiveJobs?: Set<string> };

function registry(): Set<string> {
  const holder = globalThis as JobRegistryHolder;
  holder.__sunActiveJobs ??= new Set<string>();
  return holder.__sunActiveJobs;
}

/** Claims `key`. False when a job with the same key is already running in this process. */
export function tryAcquire(key: string): boolean {
  const jobs = registry();
  if (jobs.has(key)) return false;
  jobs.add(key);
  return true;
}

/** Frees `key`. Safe to call more than once. */
export function release(key: string): void {
  registry().delete(key);
}

/** True while a job holding `key` is running in this process. */
export function isActive(key: string): boolean {
  return registry().has(key);
}
