// In-process Search Console state: the short-lived access token, the
// "reconnect required" flag and the 12 h pull caches.
//
// Access tokens are never persisted (only the encrypted refresh token is), so
// they live here. The holder sits on globalThis so Next.js dev-mode module
// reloads share one copy instead of refreshing a token on every edit, and a
// restart simply starts from the stored refresh token again.
//
// Server-only (process memory).

import type { GscPropertyMatch, GscSnapshot } from "./types";

interface CachedEntry<T> {
  value: T;
  expiresAt: number;
}

export interface SearchConsoleMemory {
  accessToken: { token: string; expiresAt: number } | null;
  refreshInFlight: Promise<unknown> | null;
  /**
   * Bumped whenever the connection is replaced or forgotten (connect, disconnect,
   * invalid_grant). A refresh or pull that started under an older generation
   * drops its result: a refresh still waiting on Google re-inserted a
   * disconnected row, and swapped a new connection back to the previous account.
   */
  generation: number;
  /** Set when Google answered `invalid_grant` (row deleted); cleared by the next successful connect. */
  reconnectRequired: boolean;
  /** Property count from the last `sites.list`, shown on the intake switch. */
  propertyCount: number | null;
  matches: Map<string, CachedEntry<{ match: GscPropertyMatch; propertyCount: number }>>;
  snapshots: Map<string, CachedEntry<GscSnapshot>>;
}

type Holder = typeof globalThis & { __sunSearchConsole?: SearchConsoleMemory };

export function gscMemory(): SearchConsoleMemory {
  const holder = globalThis as Holder;
  holder.__sunSearchConsole ??= {
    accessToken: null,
    refreshInFlight: null,
    generation: 0,
    reconnectRequired: false,
    propertyCount: null,
    matches: new Map(),
    snapshots: new Map(),
  };
  // A holder created by code from before `generation` existed survives a dev-mode reload.
  holder.__sunSearchConsole.generation ??= 0;
  return holder.__sunSearchConsole;
}

/** Marks every refresh and pull already in flight as stale; returns the new generation. */
export function bumpConnectionGeneration(): number {
  const memory = gscMemory();
  memory.generation += 1;
  return memory.generation;
}

/** Forget pulled data and property matches (after connect or disconnect the account may see other properties). */
export function clearSearchConsoleCaches(): void {
  const memory = gscMemory();
  memory.matches.clear();
  memory.snapshots.clear();
  memory.propertyCount = null;
}

/** Drops every in-memory secret and cache. */
export function resetSearchConsoleMemory(): void {
  const memory = gscMemory();
  bumpConnectionGeneration();
  memory.accessToken = null;
  memory.refreshInFlight = null;
  memory.reconnectRequired = false;
  clearSearchConsoleCaches();
}

export function readCache<T>(map: Map<string, CachedEntry<T>>, key: string, now = Date.now()): T | null {
  const entry = map.get(key);
  if (!entry) return null;
  if (entry.expiresAt <= now) {
    map.delete(key);
    return null;
  }
  return entry.value;
}

export function writeCache<T>(map: Map<string, CachedEntry<T>>, key: string, value: T, ttlMs: number, now = Date.now()): void {
  map.set(key, { value, expiresAt: now + ttlMs });
}
