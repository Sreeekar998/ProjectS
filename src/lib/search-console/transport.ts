// The only way this integration talks to Google.
//
// Every URL is a fixed Google API host built in code, never user input, so the
// crawler's SSRF-guarded `safeFetchHtml` does not apply. Instead the host is
// allowlisted here, redirects are refused (a redirect off Google would carry
// the bearer token elsewhere), and each request has a hard timeout so a hung
// socket can't stall Understand.
//
// Server-only.

const GOOGLE_HOSTS = new Set(["www.googleapis.com", "searchconsole.googleapis.com", "oauth2.googleapis.com", "accounts.google.com"]);

export const DEFAULT_GOOGLE_TIMEOUT_MS = 10_000;

export type GoogleFetchResult =
  | { ok: true; response: Response }
  | { ok: false; error: "network_error" | "timeout" };

export function isGoogleApiUrl(url: string): boolean {
  try {
    const parsed = new URL(url);
    return parsed.protocol === "https:" && GOOGLE_HOSTS.has(parsed.hostname);
  } catch {
    return false;
  }
}

export async function googleFetch(url: string, init: RequestInit, timeoutMs = DEFAULT_GOOGLE_TIMEOUT_MS): Promise<GoogleFetchResult> {
  if (!isGoogleApiUrl(url)) throw new Error("search-console transport only calls fixed Google API hosts");
  try {
    const response = await fetch(url, { ...init, redirect: "error", cache: "no-store", signal: AbortSignal.timeout(timeoutMs) });
    return { ok: true, response };
  } catch (err) {
    const name = err instanceof Error ? err.name : "";
    return { ok: false, error: name === "TimeoutError" || name === "AbortError" ? "timeout" : "network_error" };
  }
}

/** Parses a JSON body; null when it isn't JSON. */
export async function readJson(response: Response): Promise<unknown> {
  try {
    return await response.json();
  } catch {
    return null;
  }
}
