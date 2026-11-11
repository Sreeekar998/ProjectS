// Provider credentials, stored locally.
//
// The keys are the operator's own, they never leave this machine except to the
// provider they belong to. An environment variable wins; otherwise the key
// saved from the console is used. Keys are read from an in-process cache that
// `loadCredentials()` fills (collection code and the credentials route call
// it), so pasting a key in the UI takes effect without a server restart.

import { eq } from "drizzle-orm";
import { getDb } from "@/lib/db/client";
import { providerCredentials } from "@/lib/db/schema";
import { newId } from "@/lib/ids";
import { clearProviderSuspension } from "@/lib/llm/suspension";
import { CREDENTIAL_PROVIDER_IDS, type CredentialProviderId } from "./catalog";

export type CredentialProvider = CredentialProviderId;

export const CREDENTIAL_PROVIDERS = CREDENTIAL_PROVIDER_IDS;

export function isCredentialProvider(value: unknown): value is CredentialProvider {
  return typeof value === "string" && (CREDENTIAL_PROVIDERS as readonly string[]).includes(value);
}

const ENV_KEY: Record<CredentialProvider, string> = {
  // Collection providers (consumer web routes).
  cloro: "CLORO_API_KEY",
  brightdata: "BRIGHTDATA_API_TOKEN",
  // A Web Scraper API user's "username:password".
  oxylabs: "OXYLABS_AUTH",
  decodo: "DECODO_AUTH_TOKEN",
  // Model APIs: onboarding stages still use them; collection no longer does.
  gemini: "GEMINI_API_KEY",
  groq: "GROQ_API_KEY",
  cerebras: "CEREBRAS_API_KEY",
  openai: "OPENAI_API_KEY",
};

/** In-process cache so a 60-observation run does not do 60 extra reads. */
const cache = new Map<CredentialProvider, string | null>();

export async function loadCredentials(): Promise<void> {
  const rows = await getDb().select().from(providerCredentials).all();
  cache.clear();
  for (const row of rows) {
    if (isCredentialProvider(row.provider)) cache.set(row.provider, row.apiKey);
  }
}

/**
 * The key for a provider: an environment variable wins, then a stored one.
 *
 * Env first so a deployment can inject keys the usual way, while a local
 * operator can just paste one into the app.
 */
export function getCredential(provider: CredentialProvider): string | null {
  const fromEnv = process.env[ENV_KEY[provider]];
  if (fromEnv && fromEnv.trim().length > 0) return fromEnv.trim();
  return cache.get(provider) ?? null;
}

export async function saveCredential(provider: CredentialProvider, apiKey: string): Promise<void> {
  const db = getDb();
  const now = new Date();
  const trimmed = apiKey.trim();
  await db
    .insert(providerCredentials)
    .values({ id: newId("cred"), provider, apiKey: trimmed, createdAt: now, updatedAt: now })
    .onConflictDoUpdate({ target: providerCredentials.provider, set: { apiKey: trimmed, updatedAt: now } })
    .run();
  cache.set(provider, trimmed);
  // A new key may have credits the old one lacked.
  clearProviderSuspension(provider);
}

export async function deleteCredential(provider: CredentialProvider): Promise<void> {
  await getDb().delete(providerCredentials).where(eq(providerCredentials.provider, provider)).run();
  cache.delete(provider);
}

/** Which providers are usable right now, without exposing the keys. */
export async function credentialStatus(): Promise<Record<CredentialProvider, boolean>> {
  await loadCredentials();
  const status = {} as Record<CredentialProvider, boolean>;
  for (const provider of CREDENTIAL_PROVIDERS) status[provider] = Boolean(getCredential(provider));
  return status;
}
