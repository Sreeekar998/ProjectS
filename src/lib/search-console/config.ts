// Environment for the optional Google Search Console integration.
//
// The feature is inert without GOOGLE_OAUTH_CLIENT_ID/SECRET: the status route
// reports `configured:false`, the intake switch renders disabled with setup
// steps, and the crawl pipeline gets `skipped: oauth_not_configured` without a
// single request to Google. Env is read at call time (never at module load) so
// tests and a restarted dev server see the current values.
//
// Server-only.

export const GSC_CALLBACK_PATH = "/api/integrations/search-console/callback";

const DEFAULT_LOOKBACK_DAYS = 90;
const MIN_LOOKBACK_DAYS = 7;
// Google keeps 16 months of Search Analytics data.
const MAX_LOOKBACK_DAYS = 480;
const DEFAULT_WAIT_MS = 20_000;

function env(name: string): string | null {
  const value = process.env[name];
  return value && value.trim().length > 0 ? value.trim() : null;
}

/** `SUN_GSC_DISABLED=1` hides the integration even when OAuth credentials exist. */
export function gscDisabled(): boolean {
  return env("SUN_GSC_DISABLED") === "1";
}

export function oauthClient(): { clientId: string; clientSecret: string } | null {
  const clientId = env("GOOGLE_OAUTH_CLIENT_ID");
  const clientSecret = env("GOOGLE_OAUTH_CLIENT_SECRET");
  return clientId && clientSecret ? { clientId, clientSecret } : null;
}

export function clampLookbackDays(value: number): number {
  if (!Number.isFinite(value)) return DEFAULT_LOOKBACK_DAYS;
  return Math.min(MAX_LOOKBACK_DAYS, Math.max(MIN_LOOKBACK_DAYS, Math.round(value)));
}

export function lookbackDays(): number {
  const raw = env("SUN_GSC_LOOKBACK_DAYS");
  return raw === null ? DEFAULT_LOOKBACK_DAYS : clampLookbackDays(Number(raw));
}

/** How long Understand waits for the pull before continuing without it. */
export function syncWaitMs(): number {
  const raw = Number(env("SUN_GSC_WAIT_MS"));
  return Number.isFinite(raw) && raw > 0 ? Math.min(raw, 120_000) : DEFAULT_WAIT_MS;
}

const LOOPBACK_HOSTS = new Set(["localhost", "127.0.0.1", "[::1]", "::1"]);

/**
 * The exact redirect URI Google must have registered.
 *
 * GOOGLE_OAUTH_REDIRECT_URI wins. Otherwise it is derived from the request
 * origin, but only for loopback hosts: a spoofed Host header on a non-loopback
 * address must never choose where Google sends the authorization code.
 */
export function resolveRedirectUri(origin?: string | null): string | null {
  const configured = env("GOOGLE_OAUTH_REDIRECT_URI");
  if (configured) return configured;
  if (!origin) return null;
  let parsed: URL;
  try {
    parsed = new URL(origin);
  } catch {
    return null;
  }
  if (parsed.protocol !== "http:" && parsed.protocol !== "https:") return null;
  if (!LOOPBACK_HOSTS.has(parsed.hostname.toLowerCase())) return null;
  return `${parsed.origin}${GSC_CALLBACK_PATH}`;
}

/** The parts of a route request `appOrigin` reads (a NextRequest satisfies it; a plain Request is read from `url`). */
export interface OriginRequest {
  headers: { get(name: string): string | null };
  nextUrl?: { protocol: string; host: string };
  url?: string;
}

function boundUrl(req: OriginRequest): { protocol: string; host: string } | null {
  if (req.nextUrl) return req.nextUrl;
  try {
    return req.url ? new URL(req.url) : null;
  } catch {
    return null;
  }
}

/**
 * The origin the browser actually used for this request, or null when it can't be trusted.
 *
 * `req.nextUrl` is not that origin: Next builds it from the address it bound to
 * (`localhost` unless started with -H), not from the Host header. On
 * http://127.0.0.1:3100 that sent Google back to localhost, where the state
 * cookie and the intake draft didn't exist, and Disconnect's Origin check
 * failed every time. The Host header is trusted only for loopback names; any
 * other host must be the one in GOOGLE_OAUTH_REDIRECT_URI. That also stops a
 * DNS-rebinding page, whose own name is in both Host and Origin, from passing
 * the Origin check.
 */
export function appOrigin(req: OriginRequest): string | null {
  const bound = boundUrl(req);
  const host = (req.headers.get("host") ?? bound?.host ?? "").trim().toLowerCase();
  if (!host || /[\s/\\@?#]/.test(host)) return null;
  const protocol = bound?.protocol === "https:" ? "https:" : "http:";
  let parsed: URL;
  try {
    parsed = new URL(`${protocol}//${host}`);
  } catch {
    return null;
  }
  const configured = env("GOOGLE_OAUTH_REDIRECT_URI");
  if (configured) {
    try {
      const registered = new URL(configured);
      if (registered.host === parsed.host) return registered.origin;
    } catch {
      // An unparseable configured URI falls through to the loopback rule.
    }
  }
  return LOOPBACK_HOSTS.has(parsed.hostname) ? parsed.origin : null;
}
