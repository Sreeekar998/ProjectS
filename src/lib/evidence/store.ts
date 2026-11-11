import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import { evidenceDir } from "@/lib/db/client";

function projectDir(projectId: string): string {
  const dir = path.join(evidenceDir(), projectId);
  fs.mkdirSync(dir, { recursive: true });
  return dir;
}

export interface StoredEvidence {
  hash: string;
  relativePath: string;
  bytes: number;
  storedAt: number;
}

/** Content-addressed write: identical content always lands at the same path,
 * so repeated crawls/imports of the same page/response never duplicate
 * storage and the hash alone is enough to prove provenance later. */
export function storeEvidence(projectId: string, content: string): StoredEvidence {
  const hash = crypto.createHash("sha256").update(content).digest("hex");
  const dir = projectDir(projectId);
  const relativePath = `${hash}.txt`;
  const fullPath = path.join(dir, relativePath);
  if (!fs.existsSync(fullPath)) {
    fs.writeFileSync(fullPath, content, "utf-8");
  }
  const stat = fs.statSync(fullPath);
  return { hash, relativePath: path.join(projectId, relativePath), bytes: stat.size, storedAt: stat.mtimeMs };
}

export function readEvidence(projectId: string, hash: string): string | null {
  const fullPath = path.join(evidenceDir(), projectId, `${hash}.txt`);
  if (!fs.existsSync(fullPath)) return null;
  return fs.readFileSync(fullPath, "utf-8");
}

export function listProjectEvidence(projectId: string): string[] {
  const dir = path.join(evidenceDir(), projectId);
  if (!fs.existsSync(dir)) return [];
  return fs.readdirSync(dir).filter((f) => f.endsWith(".txt")).map((f) => f.replace(/\.txt$/, ""));
}

/** Deletes all raw evidence for a project (right-to-delete / manual purge).
 * Normalized derived facts already persisted in SQLite are untouched — only
 * the raw content-addressed blobs are removed. */
export function deleteProjectEvidence(projectId: string): void {
  const dir = path.join(evidenceDir(), projectId);
  if (fs.existsSync(dir)) fs.rmSync(dir, { recursive: true, force: true });
}

/** TTL sweep: deletes raw evidence blobs older than the configured retention
 * window. Call periodically (e.g. from the background job lane). */
export function purgeExpiredEvidence(projectId: string, ttlDays: number): number {
  const dir = path.join(evidenceDir(), projectId);
  if (!fs.existsSync(dir)) return 0;
  const cutoff = Date.now() - ttlDays * 24 * 60 * 60 * 1000;
  let purged = 0;
  for (const file of fs.readdirSync(dir)) {
    const fullPath = path.join(dir, file);
    const stat = fs.statSync(fullPath);
    if (stat.mtimeMs < cutoff) {
      fs.rmSync(fullPath);
      purged++;
    }
  }
  return purged;
}

export function exportProjectEvidence(projectId: string): Array<{ hash: string; content: string }> {
  return listProjectEvidence(projectId).map((hash) => ({ hash, content: readEvidence(projectId, hash) ?? "" }));
}
