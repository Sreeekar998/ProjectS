// Fake Google for Search Console tests: a `fetch` stub that routes on URL,
// records every call and fails loudly on any non-Google host. No network.

import fs from "node:fs";
import path from "node:path";
import { vi } from "vitest";

export const FAKE_CLIENT_ID = "fixture-client-id.apps.googleusercontent.test";
export const FAKE_CLIENT_SECRET = "GOCSPX-fixture-client-secret";

export function fixture<T = any>(name: string): T {
  return JSON.parse(fs.readFileSync(path.join(__dirname, name), "utf8")) as T;
}

export function json(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });
}

export interface GoogleCall {
  url: string;
  host: string;
  method: string;
  authorization: string | null;
  body: string | null;
  json: any;
}

export interface GoogleHandlers {
  token?: (form: URLSearchParams, call: GoogleCall) => Response | Promise<Response>;
  revoke?: (form: URLSearchParams, call: GoogleCall) => Response | Promise<Response>;
  sites?: (call: GoogleCall) => Response | Promise<Response>;
  /** `siteUrl` is decoded from the path; `body` is the parsed request body. */
  query?: (siteUrl: string, body: any, call: GoogleCall) => Response | Promise<Response>;
}

/** Answers each Search Analytics query from the fixtures by its dimensions. */
export function fixtureQuery(overrides: { countries?: string } = {}): NonNullable<GoogleHandlers["query"]> {
  return (_siteUrl, body) => {
    const dimensions: string[] = body.dimensions ?? [];
    if (dimensions.length === 0) return json(200, fixture("query-totals.json"));
    if (dimensions.join(",") === "query") return json(200, fixture("query-queries.json"));
    if (dimensions.join(",") === "page") return json(200, fixture("query-pages.json"));
    if (dimensions.join(",") === "country") return json(200, fixture(overrides.countries ?? "query-countries.json"));
    if (dimensions.join(",") === "query,country") return json(200, fixture("query-query-country.json"));
    return json(400, { error: { code: 400, message: "unexpected dimensions" } });
  };
}

export function stubGoogle(handlers: GoogleHandlers): { calls: GoogleCall[]; googleCalls: () => GoogleCall[] } {
  const calls: GoogleCall[] = [];
  vi.stubGlobal("fetch", async (input: string | URL | Request, init: RequestInit = {}) => {
    const url = typeof input === "string" ? input : input instanceof URL ? input.toString() : input.url;
    const parsed = new URL(url);
    const body = typeof init.body === "string" ? init.body : null;
    let parsedBody: any = null;
    try {
      parsedBody = body ? JSON.parse(body) : null;
    } catch {
      parsedBody = null;
    }
    const call: GoogleCall = {
      url,
      host: parsed.hostname,
      method: (init.method ?? "GET").toUpperCase(),
      authorization: new Headers(init.headers).get("authorization"),
      body,
      json: parsedBody,
    };
    calls.push(call);
    if (init.redirect !== "error") throw new Error(`Google call without redirect:"error": ${url}`);
    if (parsed.hostname === "oauth2.googleapis.com" && parsed.pathname === "/token") {
      if (!handlers.token) throw new Error("unexpected token call");
      return handlers.token(new URLSearchParams(body ?? ""), call);
    }
    if (parsed.hostname === "oauth2.googleapis.com" && parsed.pathname === "/revoke") {
      return handlers.revoke ? handlers.revoke(new URLSearchParams(body ?? ""), call) : json(200, {});
    }
    if (parsed.hostname === "www.googleapis.com" && parsed.pathname === "/webmasters/v3/sites") {
      if (!handlers.sites) throw new Error("unexpected sites call");
      return handlers.sites(call);
    }
    const query = /^\/webmasters\/v3\/sites\/([^/]+)\/searchAnalytics\/query$/.exec(parsed.pathname);
    if (parsed.hostname === "www.googleapis.com" && query) {
      if (!handlers.query) throw new Error("unexpected query call");
      return handlers.query(decodeURIComponent(query[1]!), parsedBody, call);
    }
    throw new Error(`fetch to an unexpected host in a Search Console test: ${url}`);
  });
  return { calls, googleCalls: () => calls.filter((call) => call.host.endsWith("googleapis.com") || call.host === "accounts.google.com") };
}

export function setFakeOAuthEnv(extra: Record<string, string> = {}): void {
  process.env.GOOGLE_OAUTH_CLIENT_ID = FAKE_CLIENT_ID;
  process.env.GOOGLE_OAUTH_CLIENT_SECRET = FAKE_CLIENT_SECRET;
  for (const [key, value] of Object.entries(extra)) process.env[key] = value;
}

export function clearOAuthEnv(): void {
  for (const key of ["GOOGLE_OAUTH_CLIENT_ID", "GOOGLE_OAUTH_CLIENT_SECRET", "GOOGLE_OAUTH_REDIRECT_URI", "SUN_GSC_DISABLED", "SUN_GSC_LOOKBACK_DAYS", "SUN_GSC_WAIT_MS"]) delete process.env[key];
}
