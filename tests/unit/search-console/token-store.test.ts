import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { NextRequest } from "next/server";
import { eq } from "drizzle-orm";
import { getDb } from "@/lib/db/client";
import { providerCredentials } from "@/lib/db/schema";
import { credentialStatus } from "@/lib/providers/credentials";
import { decryptEnvelope, deleteGoogleTokens, encryptEnvelope, readGoogleTokenRow, readGoogleTokens, saveGoogleTokens, updateGoogleTokens, type GoogleTokenEnvelope } from "@/lib/search-console/token-store";
import { GSC_PROVIDER_ROW } from "@/lib/search-console/types";
import { DELETE as deleteCredentialRoute, GET as credentialsRoute } from "@/app/api/providers/credentials/route";
import { clearOAuthEnv, setFakeOAuthEnv } from "../../fixtures/search-console/google-stub";

const envelope: GoogleTokenEnvelope = { v: 1, refreshToken: "1//fixture-refresh-token", scope: "https://www.googleapis.com/auth/webmasters.readonly", connectedAt: 1_789_000_000_000, lastRefreshedAt: null };

async function storedRow() {
  return getDb().select().from(providerCredentials).where(eq(providerCredentials.provider, GSC_PROVIDER_ROW)).get();
}

describe("Search Console token store", () => {
  beforeEach(async () => {
    setFakeOAuthEnv();
    await deleteGoogleTokens();
  });
  afterEach(() => clearOAuthEnv());

  it("round-trips an AES-GCM envelope and never stores the refresh token in plaintext", async () => {
    await saveGoogleTokens(envelope);
    const row = await storedRow();
    expect(row).toBeTruthy();
    expect(row!.apiKey).not.toContain("1//");
    expect(JSON.parse(row!.apiKey)).toMatchObject({ v: 1, alg: "A256GCM" });
    expect(await readGoogleTokens()).toEqual(envelope);

    await saveGoogleTokens({ ...envelope, lastRefreshedAt: 5 });
    expect(await readGoogleTokens()).toMatchObject({ lastRefreshedAt: 5 });
    const rows = await getDb().select().from(providerCredentials).where(eq(providerCredentials.provider, GSC_PROVIDER_ROW)).all();
    expect(rows).toHaveLength(1);
  });

  it("reads as unreadable under another client secret or a corrupted row", async () => {
    await saveGoogleTokens(envelope);
    process.env.GOOGLE_OAUTH_CLIENT_SECRET = "rotated-secret";
    expect(await readGoogleTokens()).toBe("unreadable");
    delete process.env.GOOGLE_OAUTH_CLIENT_SECRET;
    expect(await readGoogleTokens()).toBe("unreadable");

    const sealed = encryptEnvelope(envelope, "secret-a");
    expect(decryptEnvelope(sealed, "secret-a")).toEqual(envelope);
    expect(decryptEnvelope(sealed, "secret-b")).toBeNull();
    expect(decryptEnvelope("not json", "secret-a")).toBeNull();
    const parsed = JSON.parse(sealed);
    expect(decryptEnvelope(JSON.stringify({ ...parsed, ct: `${parsed.ct.slice(0, -2)}AA` }), "secret-a")).toBeNull();
  });

  it("updates only the row it read, never inserting one and never overwriting a newer connection", async () => {
    await saveGoogleTokens(envelope);
    const read = await readGoogleTokenRow();
    if (read === null || read === "unreadable") throw new Error("expected a stored row");
    expect(read.envelope).toEqual(envelope);
    expect(read.ciphertext).toBe((await storedRow())!.apiKey);

    expect(await updateGoogleTokens({ ...envelope, lastRefreshedAt: 7 }, read.ciphertext)).toBe(true);
    expect(await readGoogleTokens()).toMatchObject({ lastRefreshedAt: 7 });
    // The ciphertext changed with that write, so the stale one no longer matches.
    expect(await updateGoogleTokens({ ...envelope, refreshToken: "1//stale" }, read.ciphertext)).toBe(false);
    expect(await readGoogleTokens()).toMatchObject({ refreshToken: "1//fixture-refresh-token", lastRefreshedAt: 7 });

    const current = (await storedRow())!.apiKey;
    await deleteGoogleTokens();
    expect(await updateGoogleTokens(envelope, current)).toBe(false);
    expect(await storedRow()).toBeUndefined();
  });

  it("deletes only the expected connection when given its ciphertext", async () => {
    await saveGoogleTokens(envelope);
    const first = (await storedRow())!.apiKey;
    await saveGoogleTokens({ ...envelope, refreshToken: "1//newer" });
    await deleteGoogleTokens(first);
    expect(await readGoogleTokens()).toMatchObject({ refreshToken: "1//newer" });
    await deleteGoogleTokens((await storedRow())!.apiKey);
    expect(await readGoogleTokens()).toBeNull();
  });

  it("reads null when never connected and after delete", async () => {
    expect(await readGoogleTokens()).toBeNull();
    await saveGoogleTokens(envelope);
    await deleteGoogleTokens();
    expect(await readGoogleTokens()).toBeNull();
  });

  it("is invisible to the provider credentials API and can't be deleted through it", async () => {
    await saveGoogleTokens(envelope);
    const status = await credentialStatus();
    expect(Object.keys(status).sort()).toEqual(["brightdata", "cerebras", "cloro", "decodo", "gemini", "groq", "openai", "oxylabs"]);

    const listed = await credentialsRoute();
    const body = await listed.text();
    expect(body).not.toContain("google_search_console");
    expect(body).not.toContain("A256GCM");

    const removed = await deleteCredentialRoute(new NextRequest("http://localhost/api/providers/credentials?provider=google_search_console", { method: "DELETE" }));
    expect(removed.status).toBe(200);
    expect(await readGoogleTokens()).toEqual(envelope);
  });
});
