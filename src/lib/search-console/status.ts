// What the intake switch needs to know, without secrets.
//
// Reads env and the token row only; it never calls Google, so opening the
// intake page costs nothing and works offline. The property count is whatever
// the last pull saw in this process (null until then).
//
// Server-only.

import { resolveRedirectUri } from "./config";
import { gscMemory } from "./memory";
import { gscConfig } from "./oauth";
import { readGoogleTokens } from "./token-store";
import type { SearchConsoleStatus } from "./types";

export async function searchConsoleStatus(origin?: string | null): Promise<SearchConsoleStatus> {
  const config = gscConfig(origin ?? undefined);
  if ("unavailable" in config) {
    return { configured: false, connected: false, reason: config.unavailable, redirectUri: resolveRedirectUri(origin) };
  }
  const memory = gscMemory();
  const stored = await readGoogleTokens();
  if (stored === "unreadable") return { configured: true, connected: false, reason: "reconnect_required", redirectUri: config.redirectUri };
  if (stored === null) {
    return { configured: true, connected: false, reason: memory.reconnectRequired ? "reconnect_required" : "not_connected", redirectUri: config.redirectUri };
  }
  return { configured: true, connected: true, connectedAt: stored.connectedAt, propertyCount: memory.propertyCount, redirectUri: config.redirectUri };
}
