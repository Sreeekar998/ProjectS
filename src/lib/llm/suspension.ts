// Providers that cannot answer for a while.
//
// An empty prepaid balance or a rejected key fails every call the same way.
// The routed layer used to try such a provider first on each call, retry it,
// and only then fall back, so a Boldin run with an exhausted OpenAI balance
// spent most of its prompt-generation time on refusals (and the Discovery
// judge waited 76 s for nothing). Once a provider says so, it is skipped for a
// while. The skip is short and lifts on any success: after credits are
// added (same key), the next run must use the paid model again, not keep
// quietly using a weaker fallback. Saving a key, starting a run and any
// successful call to the provider all lift it.
//
// Server-only, in-process.

import type { LlmProviderId } from "./types";

const SUSPEND_MS = 2 * 60_000;
const suspended = new Map<string, { until: number; reason: string }>();

/** The reason a provider is skipped right now, or null. */
export function providerSuspension(provider: LlmProviderId | string, now = Date.now()): string | null {
  const entry = suspended.get(provider);
  if (!entry) return null;
  if (now >= entry.until) {
    suspended.delete(provider);
    return null;
  }
  return entry.reason;
}

/** Suspends a provider when an error means no call to it can succeed. Returns whether it did. */
export function suspendProviderOn(provider: LlmProviderId | string, error: string | null | undefined, now = Date.now()): boolean {
  const reason = /^(billing_required|auth_failed)/.exec(error ?? "")?.[1];
  if (!reason) return false;
  if (!suspended.has(provider)) console.warn(`[llm] ${provider} is unavailable (${reason}); other routes are used for the next 2 minutes`);
  suspended.set(provider, { until: now + SUSPEND_MS, reason });
  return true;
}

/** Lifts a suspension (a new key, a successful call, a new run); with no provider, lifts all. */
export function clearProviderSuspension(provider?: LlmProviderId | string): void {
  if (provider) suspended.delete(provider);
  else suspended.clear();
}
