// Vendor health: which consumer-web routes are worth asking right now.
//
// A collection provider can stop working without any change on our side:
// the site adds a login wall in a region, the page format changes, the
// account runs out of credits. Asking thirty prompts into that costs thirty
// credits and thirty "not collected" rows. So the runner checks each vendor
// with one canary prompt before a run, and a lane that meets several blocked
// or blank answers in a row marks its vendor unhealthy and hands the rest of
// the run to the next vendor for the same engine.
//
// In-process, like runner progress: a restart forgets it, and the next Collect
// checks again. That is the right default — a vendor that was broken an hour
// ago may be fine now, and a canary costs one credit.

interface HealthEntry {
  unhealthyUntil: number;
  reason: string;
  /** When a canary last passed, so a healthy vendor is not re-checked before every run. */
  lastCanaryOkAt: number | null;
}

interface HealthRegistry {
  routes: Map<string, HealthEntry>;
}

const registry: HealthRegistry = ((globalThis as unknown as { __sunVendorHealth?: HealthRegistry }).__sunVendorHealth ??= { routes: new Map() });

/** Six hours: long enough to skip a broken vendor for the day's runs, short enough to try again tomorrow morning. */
export const UNHEALTHY_AFTER_CANARY_MS = 6 * 60 * 60_000;
/** Thirty minutes after a lane trips the breaker mid-run. */
export const UNHEALTHY_AFTER_BREAKER_MS = 30 * 60_000;
/** A passed canary is trusted for this long before a run asks again. */
export const CANARY_TTL_MS = 6 * 60 * 60_000;

function entry(route: string): HealthEntry {
  let value = registry.routes.get(route);
  if (!value) {
    value = { unhealthyUntil: 0, reason: "", lastCanaryOkAt: null };
    registry.routes.set(route, value);
  }
  return value;
}

export function isRouteHealthy(route: string, now = Date.now()): boolean {
  return entry(route).unhealthyUntil <= now;
}

export function unhealthyReason(route: string, now = Date.now()): string | null {
  const value = entry(route);
  return value.unhealthyUntil > now ? value.reason : null;
}

export function markUnhealthy(route: string, forMs: number, reason: string, now = Date.now()): void {
  const value = entry(route);
  value.unhealthyUntil = now + forMs;
  value.reason = reason;
  value.lastCanaryOkAt = null;
}

export function markCanaryPassed(route: string, now = Date.now()): void {
  const value = entry(route);
  value.unhealthyUntil = 0;
  value.reason = "";
  value.lastCanaryOkAt = now;
}

export function canaryDue(route: string, now = Date.now()): boolean {
  const value = entry(route);
  return value.lastCanaryOkAt === null || now - value.lastCanaryOkAt > CANARY_TTL_MS;
}

/** For the console: every route with a live health entry. */
export function healthSnapshot(now = Date.now()): Record<string, { healthy: boolean; reason: string | null; lastCanaryOkAt: number | null }> {
  const out: Record<string, { healthy: boolean; reason: string | null; lastCanaryOkAt: number | null }> = {};
  for (const [route, value] of registry.routes) {
    out[route] = { healthy: value.unhealthyUntil <= now, reason: value.unhealthyUntil > now ? value.reason : null, lastCanaryOkAt: value.lastCanaryOkAt };
  }
  return out;
}

/** Tests only. */
export function resetVendorHealth(): void {
  registry.routes.clear();
}
