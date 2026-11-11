import dns from "node:dns";
import { parse as parseTld } from "tldts";
import { classifyIp } from "./ip-guard";

const dnsLookup = dns.promises.lookup;

export class UnsafeUrlError extends Error {
  constructor(
    message: string,
    public readonly code:
      | "invalid_url"
      | "unsupported_scheme"
      | "blocked_hostname"
      | "dns_resolution_failed"
      | "private_address"
      | "no_registrable_domain"
      | "too_many_redirects",
  ) {
    super(message);
    this.name = "UnsafeUrlError";
  }
}

const BLOCKED_HOSTNAME_SUFFIXES = [".local", ".localhost", ".internal", ".localdomain"];
const BLOCKED_HOSTNAME_EXACT = new Set(["localhost", "metadata.google.internal"]);

/** Recognizes a bare IPv4/IPv6 literal hostname (IPv6 arrives bracketed). */
function parseLiteralIp(hostname: string): { address: string; family: 4 | 6 } | null {
  if (/^\d{1,3}(\.\d{1,3}){3}$/.test(hostname)) return { address: hostname, family: 4 };
  if (hostname.startsWith("[") && hostname.endsWith("]")) return { address: hostname.slice(1, -1), family: 6 };
  if (hostname.includes(":")) return { address: hostname, family: 6 };
  return null;
}

export interface NormalizedUrl {
  url: URL;
  registrableDomain: string;
  hostname: string;
}

/**
 * Syntactic + structural normalization: scheme allowlist, hostname denylist,
 * registrable-domain extraction, fragment/tracking-param stripping. Does NOT
 * touch the network — call `assertResolvesToPublicAddress` separately before
 * every actual fetch, including after each redirect hop.
 */
export function normalizeUrl(input: string): NormalizedUrl {
  const trimmed = input.trim();
  if (!trimmed) throw new UnsafeUrlError("No URL was supplied", "invalid_url");

  let url: URL;
  try {
    url = new URL(trimmed);
  } catch {
    // People type "example.com", not "https://example.com". Default the
    // scheme to HTTPS rather than rejecting — but only when the input has no
    // scheme at all, so "ftp://x" and "javascript:x" still fail the scheme
    // allowlist below instead of being silently rewritten to HTTPS.
    if (/^[a-z][a-z0-9+.-]*:/i.test(trimmed)) {
      throw new UnsafeUrlError(`"${input}" is not a valid URL`, "invalid_url");
    }
    try {
      url = new URL(`https://${trimmed}`);
    } catch {
      throw new UnsafeUrlError(`"${input}" is not a valid URL`, "invalid_url");
    }
  }
  if (url.protocol !== "http:" && url.protocol !== "https:") {
    throw new UnsafeUrlError(`Unsupported URL scheme "${url.protocol}"`, "unsupported_scheme");
  }
  const hostname = url.hostname.toLowerCase();
  if (BLOCKED_HOSTNAME_EXACT.has(hostname) || BLOCKED_HOSTNAME_SUFFIXES.some((s) => hostname.endsWith(s))) {
    throw new UnsafeUrlError(`Hostname "${hostname}" is not a permitted public target`, "blocked_hostname");
  }
  // A literal IP in the URL needs no DNS, so reject it here rather than
  // waiting for the fetch-time guard: the user gets an immediate, accurate
  // error instead of a project that fails a second later.
  const literalIp = parseLiteralIp(hostname);
  if (literalIp) {
    const verdict = classifyIp(literalIp.address, literalIp.family);
    if (verdict.blocked) {
      throw new UnsafeUrlError(`"${hostname}" is a ${verdict.label} address and cannot be analysed`, "private_address");
    }
  }

  const parsed = parseTld(hostname, { allowPrivateDomains: true });
  const registrableDomain = parsed.domain ?? hostname;
  if (!registrableDomain) {
    throw new UnsafeUrlError(`Could not determine a registrable domain for "${hostname}"`, "no_registrable_domain");
  }
  url.hash = "";
  stripTrackingParams(url);
  return { url, registrableDomain, hostname };
}

const TRACKING_PARAM_PREFIXES = ["utm_", "gclid", "fbclid", "mc_", "ref", "igshid"];

function stripTrackingParams(url: URL) {
  const toDelete: string[] = [];
  for (const key of url.searchParams.keys()) {
    const lower = key.toLowerCase();
    if (TRACKING_PARAM_PREFIXES.some((p) => lower === p || lower.startsWith(p))) toDelete.push(key);
  }
  for (const key of toDelete) url.searchParams.delete(key);
  url.searchParams.sort();
}

/**
 * Resolves the hostname and rejects if ANY returned address is private,
 * loopback, link-local, multicast, or otherwise non-public. Must be called
 * again after every redirect hop (SSRF via redirect is the common bypass).
 */
export async function assertResolvesToPublicAddress(hostname: string): Promise<void> {
  let addresses: dns.LookupAddress[];
  try {
    addresses = await dnsLookup(hostname, { all: true, verbatim: true });
  } catch (err) {
    throw new UnsafeUrlError(`DNS resolution failed for "${hostname}": ${(err as Error).message}`, "dns_resolution_failed");
  }
  if (addresses.length === 0) {
    throw new UnsafeUrlError(`DNS resolution returned no addresses for "${hostname}"`, "dns_resolution_failed");
  }
  for (const { address, family } of addresses) {
    const result = classifyIp(address, family as 4 | 6);
    if (result.blocked) {
      throw new UnsafeUrlError(
        `"${hostname}" resolves to a disallowed address ${address} (${result.label})`,
        "private_address",
      );
    }
  }
}
