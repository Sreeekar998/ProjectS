// Evidence artifacts: the vendor's raw payload and the rendered page kept next
// to an observation.
//
// The answer text goes through the content-addressed store (`rawHash` on the
// provider_responses row). The payload and page are larger, vendor-specific,
// and only ever read back through the observation that owns them, so they are
// filed by observation id under `<project>/artifacts/` instead — no schema
// change, and a drawer or a script can list them from the id alone.
//
// Writes never throw into collection: losing an artifact costs evidence, never
// a collected answer.

import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import { evidenceDir } from "@/lib/db/client";

export type ArtifactKind = "payload.json" | "page.html" | "screenshot.png";

export interface StoredArtifact {
  kind: ArtifactKind;
  relativePath: string;
  bytes: number;
  hash: string;
}

const KINDS: ArtifactKind[] = ["payload.json", "page.html", "screenshot.png"];

function artifactDir(projectId: string): string {
  return path.join(evidenceDir(), projectId, "artifacts");
}

function safeId(id: string): string {
  return id.replace(/[^A-Za-z0-9_-]/g, "_");
}

export function storeArtifact(projectId: string, responseId: string, kind: ArtifactKind, content: string | Uint8Array): StoredArtifact | null {
  try {
    const dir = artifactDir(projectId);
    fs.mkdirSync(dir, { recursive: true });
    const fileName = `${safeId(responseId)}.${kind}`;
    const fullPath = path.join(dir, fileName);
    const buffer = typeof content === "string" ? Buffer.from(content, "utf8") : Buffer.from(content);
    fs.writeFileSync(fullPath, buffer);
    return {
      kind,
      relativePath: path.join(projectId, "artifacts", fileName),
      bytes: buffer.byteLength,
      hash: crypto.createHash("sha256").update(buffer).digest("hex"),
    };
  } catch {
    return null;
  }
}

export function listArtifacts(projectId: string, responseId: string): Array<{ kind: ArtifactKind; relativePath: string; bytes: number }> {
  const dir = artifactDir(projectId);
  const out: Array<{ kind: ArtifactKind; relativePath: string; bytes: number }> = [];
  for (const kind of KINDS) {
    const fileName = `${safeId(responseId)}.${kind}`;
    const fullPath = path.join(dir, fileName);
    if (!fs.existsSync(fullPath)) continue;
    out.push({ kind, relativePath: path.join(projectId, "artifacts", fileName), bytes: fs.statSync(fullPath).size });
  }
  return out;
}

export function readArtifact(projectId: string, responseId: string, kind: ArtifactKind): Buffer | null {
  const fullPath = path.join(artifactDir(projectId), `${safeId(responseId)}.${kind}`);
  return fs.existsSync(fullPath) ? fs.readFileSync(fullPath) : null;
}
