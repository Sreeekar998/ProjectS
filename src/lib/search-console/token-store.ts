// Encrypted storage for the Google refresh token, with no migration.
//
// It lives in one `provider_credentials` row (`provider = "google_search_console"`,
// free unique text) but is reached only through this module, never through the
// `CredentialProvider` union, so `/api/providers/credentials` can't list,
// overwrite or delete it. `provider_credentials` otherwise stores keys in
// plaintext; this row holds an AES-256-GCM envelope keyed from the OAuth client
// secret, which lives only in `.env.local`. A copied `sun.db` alone yields
// nothing, and rotating the secret makes the row unreadable, which the status
// route reports as `reconnect_required`.
//
// Server-only.

import crypto from "node:crypto";
import { and, eq } from "drizzle-orm";
import { getDb } from "@/lib/db/client";
import { providerCredentials } from "@/lib/db/schema";
import { newId } from "@/lib/ids";
import { oauthClient } from "./config";
import { GSC_PROVIDER_ROW } from "./types";

export interface GoogleTokenEnvelope {
  v: 1;
  refreshToken: string;
  scope: string;
  connectedAt: number;
  lastRefreshedAt: number | null;
}

interface CipherEnvelope {
  v: 1;
  alg: "A256GCM";
  iv: string;
  tag: string;
  ct: string;
}

function tokenKey(clientSecret: string): Buffer {
  return Buffer.from(crypto.hkdfSync("sha256", clientSecret, "sun/gsc-token/v1", "provider_credentials", 32));
}

export function encryptEnvelope(plain: GoogleTokenEnvelope, clientSecret: string): string {
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv("aes-256-gcm", tokenKey(clientSecret), iv);
  const ct = Buffer.concat([cipher.update(JSON.stringify(plain), "utf8"), cipher.final()]);
  const envelope: CipherEnvelope = { v: 1, alg: "A256GCM", iv: iv.toString("base64url"), tag: cipher.getAuthTag().toString("base64url"), ct: ct.toString("base64url") };
  return JSON.stringify(envelope);
}

function isTokenEnvelope(value: unknown): value is GoogleTokenEnvelope {
  if (!value || typeof value !== "object") return false;
  const record = value as Record<string, unknown>;
  return record.v === 1 && typeof record.refreshToken === "string" && record.refreshToken.length > 0 && typeof record.scope === "string" && typeof record.connectedAt === "number";
}

/** The decrypted envelope, or null when the ciphertext is malformed or keyed by another secret. */
export function decryptEnvelope(stored: string, clientSecret: string): GoogleTokenEnvelope | null {
  try {
    const envelope = JSON.parse(stored) as Partial<CipherEnvelope>;
    if (envelope.v !== 1 || envelope.alg !== "A256GCM" || !envelope.iv || !envelope.tag || !envelope.ct) return null;
    const decipher = crypto.createDecipheriv("aes-256-gcm", tokenKey(clientSecret), Buffer.from(envelope.iv, "base64url"));
    decipher.setAuthTag(Buffer.from(envelope.tag, "base64url"));
    const plain = Buffer.concat([decipher.update(Buffer.from(envelope.ct, "base64url")), decipher.final()]).toString("utf8");
    const parsed: unknown = JSON.parse(plain);
    return isTokenEnvelope(parsed) ? { ...parsed, lastRefreshedAt: parsed.lastRefreshedAt ?? null } : null;
  } catch {
    return null;
  }
}

export async function saveGoogleTokens(envelope: GoogleTokenEnvelope): Promise<void> {
  const client = oauthClient();
  if (!client) throw new Error("Search Console OAuth client is not configured");
  const apiKey = encryptEnvelope(envelope, client.clientSecret);
  const now = new Date();
  await getDb()
    .insert(providerCredentials)
    .values({ id: newId("cred"), provider: GSC_PROVIDER_ROW, apiKey, createdAt: now, updatedAt: now })
    .onConflictDoUpdate({ target: providerCredentials.provider, set: { apiKey, updatedAt: now } })
    .run();
}

/**
 * Rewrites the stored connection only if its row still holds `expectedCiphertext`
 * (the one read before a token refresh). Never inserts: a refresh that landed
 * after Disconnect re-created the deleted row, and one that landed after a
 * reconnect overwrote the new account. False when the row is gone or replaced.
 */
export async function updateGoogleTokens(envelope: GoogleTokenEnvelope, expectedCiphertext: string): Promise<boolean> {
  const client = oauthClient();
  if (!client) throw new Error("Search Console OAuth client is not configured");
  const apiKey = encryptEnvelope(envelope, client.clientSecret);
  const result = getDb()
    .update(providerCredentials)
    .set({ apiKey, updatedAt: new Date() })
    .where(and(eq(providerCredentials.provider, GSC_PROVIDER_ROW), eq(providerCredentials.apiKey, expectedCiphertext)))
    .run();
  return result.changes > 0;
}

export type StoredGoogleTokens = { envelope: GoogleTokenEnvelope; ciphertext: string };

/** Like `readGoogleTokens`, plus the ciphertext a later `updateGoogleTokens`/`deleteGoogleTokens` is guarded by. */
export async function readGoogleTokenRow(): Promise<StoredGoogleTokens | null | "unreadable"> {
  const row = await getDb().select().from(providerCredentials).where(eq(providerCredentials.provider, GSC_PROVIDER_ROW)).get();
  if (!row) return null;
  const client = oauthClient();
  if (!client) return "unreadable";
  const envelope = decryptEnvelope(row.apiKey, client.clientSecret);
  return envelope ? { envelope, ciphertext: row.apiKey } : "unreadable";
}

/** null: never connected (or disconnected). "unreadable": a row exists but can't be decrypted with the current secret. */
export async function readGoogleTokens(): Promise<GoogleTokenEnvelope | null | "unreadable"> {
  const stored = await readGoogleTokenRow();
  return stored === null || stored === "unreadable" ? stored : stored.envelope;
}

/** With `expectedCiphertext`, deletes only that connection, never one saved since it was read. */
export async function deleteGoogleTokens(expectedCiphertext?: string): Promise<void> {
  const byProvider = eq(providerCredentials.provider, GSC_PROVIDER_ROW);
  const where = expectedCiphertext === undefined ? byProvider : and(byProvider, eq(providerCredentials.apiKey, expectedCiphertext));
  await getDb().delete(providerCredentials).where(where).run();
}
