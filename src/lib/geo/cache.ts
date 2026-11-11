// Small persistent cache for geocoding responses.
//
// OpenStreetMap's Nominatim usage policy requires clients to cache results,
// and repeated onboardings of the same city should not re-ask. The cache is a
// JSON file in the data directory rather than a table, so adding it needs no
// migration against a database a running server holds open.

import fs from "node:fs";
import path from "node:path";
import { dataDir } from "@/lib/db/client";

interface Entry {
  at: number;
  value: unknown;
}

const MAX_ENTRIES = 5000;
const TTL_MS = 30 * 24 * 60 * 60 * 1000;

let memory: Map<string, Entry> | null = null;
let writeTimer: NodeJS.Timeout | null = null;

function filePath(): string {
  return path.join(dataDir(), "geo-cache.json");
}

function load(): Map<string, Entry> {
  if (memory) return memory;
  memory = new Map();
  try {
    const raw = fs.readFileSync(filePath(), "utf8");
    const parsed = JSON.parse(raw) as Record<string, Entry>;
    for (const [key, entry] of Object.entries(parsed)) {
      if (entry && typeof entry.at === "number" && Date.now() - entry.at < TTL_MS) memory.set(key, entry);
    }
  } catch {
    // Missing or unreadable cache: start empty.
  }
  return memory;
}

function scheduleWrite(): void {
  if (writeTimer) return;
  writeTimer = setTimeout(() => {
    writeTimer = null;
    try {
      const entries = [...load().entries()].sort((a, b) => b[1].at - a[1].at).slice(0, MAX_ENTRIES);
      fs.mkdirSync(dataDir(), { recursive: true });
      const tmp = `${filePath()}.tmp`;
      fs.writeFileSync(tmp, JSON.stringify(Object.fromEntries(entries)));
      fs.renameSync(tmp, filePath());
    } catch {
      // A cache that cannot be written is only a performance loss.
    }
  }, 1000);
  writeTimer.unref?.();
}

export function geoCacheGet<T>(key: string): T | undefined {
  const entry = load().get(key);
  if (!entry) return undefined;
  if (Date.now() - entry.at > TTL_MS) {
    load().delete(key);
    return undefined;
  }
  return entry.value as T;
}

export function geoCacheSet(key: string, value: unknown): void {
  load().set(key, { at: Date.now(), value });
  scheduleWrite();
}
