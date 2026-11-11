// Picks the Search Console property that describes a project's website.
//
// An account usually holds several forms of the same site (a Domain property
// plus http/https/www URL-prefix properties), and some hold only a parent
// domain. The ranking prefers the property that covers exactly the project:
// Domain property for the host, then the exact origin, then scheme and www
// variants, then a parent domain, and a path-scoped property only when nothing
// else exists. When the chosen property covers more than the project (a parent
// domain, or a project URL with a path), `pageFilter` narrows every query to the
// project's pages, so a sibling subdomain's traffic is never counted as this
// business's demand.
//
// Pure and client-safe.

import type { GscMatchReason, GscPermissionLevel, GscPropertyMatch, GscSite } from "./types";

const REASON_RANK: Record<GscMatchReason, number> = {
  user_selected: 0,
  domain_property: 1,
  exact_origin: 2,
  same_host_other_scheme: 3,
  www_variant: 4,
  parent_domain_property: 5,
  path_prefix: 6,
};

const PERMISSION_RANK: Record<GscPermissionLevel, number> = { siteOwner: 0, siteFullUser: 1, siteRestrictedUser: 2, siteUnverifiedUser: 3 };

const MAX_ALTERNATIVES = 5;

function escapeRegex(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function bareHost(host: string): string {
  return host.toLowerCase().replace(/^www\./, "");
}

function pathPrefix(pathname: string): string {
  if (!pathname || pathname === "/") return "/";
  return pathname.endsWith("/") ? pathname : `${pathname}/`;
}

/** `^https?://(www\.)?host(/|$)`, optionally narrowed to a path. */
export function pageFilterFor(host: string, path = "/"): string {
  const hostPart = `(www\\.)?${escapeRegex(bareHost(host))}`;
  if (path === "/") return `^https?://${hostPart}(/|$)`;
  return `^https?://${hostPart}${escapeRegex(path)}`;
}

interface Candidate {
  site: GscSite;
  reason: GscMatchReason;
  pageFilter: string | null;
  /** Longer URL-prefix paths rank below the root of the same origin. */
  pathDepth: number;
}

function classify(site: GscSite, project: URL, projectPath: string, registrableDomain: string): Candidate | null {
  const projectHost = project.hostname.toLowerCase();
  const projectBare = bareHost(projectHost);
  const narrowed = projectPath !== "/" ? pageFilterFor(projectHost, projectPath) : null;

  if (site.siteUrl.startsWith("sc-domain:")) {
    const domain = site.siteUrl.slice("sc-domain:".length).trim().toLowerCase().replace(/\.$/, "");
    if (!domain) return null;
    if (domain === projectBare) return { site, reason: "domain_property", pageFilter: narrowed, pathDepth: 0 };
    const registrable = registrableDomain.toLowerCase();
    // Only parents up to the registrable domain: `sc-domain:co.uk` is not this business.
    if (projectBare.endsWith(`.${domain}`) && (domain === registrable || domain.endsWith(`.${registrable}`))) {
      return { site, reason: "parent_domain_property", pageFilter: pageFilterFor(projectHost, projectPath), pathDepth: 0 };
    }
    return null;
  }

  let property: URL;
  try {
    property = new URL(site.siteUrl);
  } catch {
    return null;
  }
  if (property.protocol !== "http:" && property.protocol !== "https:") return null;
  // A URL-prefix property on another port is another origin in Search Console:
  // `https://host:8443/` must not be read as `https://host/`. The URL parser
  // already drops default ports, so `http://host/` and `https://host/` both read "".
  if (property.port !== project.port) return null;
  const propertyHost = property.hostname.toLowerCase();
  if (bareHost(propertyHost) !== projectBare) return null;

  const propertyPath = pathPrefix(property.pathname);
  const pathDepth = propertyPath.split("/").filter(Boolean).length;
  // The property is scoped below the project URL: it sees only part of the site.
  if (!projectPath.startsWith(propertyPath)) {
    return propertyPath.startsWith(projectPath) ? { site, reason: "path_prefix", pageFilter: null, pathDepth } : null;
  }
  const pageFilter = propertyPath !== projectPath ? pageFilterFor(projectHost, projectPath) : null;
  let reason: GscMatchReason;
  if (propertyHost === projectHost) reason = property.protocol === project.protocol ? "exact_origin" : "same_host_other_scheme";
  else reason = "www_variant";
  return { site, reason, pageFilter, pathDepth };
}

function compare(a: Candidate, b: Candidate): number {
  return (
    REASON_RANK[a.reason] - REASON_RANK[b.reason] ||
    // A root property of the same origin beats a longer path prefix.
    a.pathDepth - b.pathDepth ||
    PERMISSION_RANK[a.site.permissionLevel] - PERMISSION_RANK[b.site.permissionLevel] ||
    a.site.siteUrl.localeCompare(b.site.siteUrl)
  );
}

/**
 * The best readable property for the project, or null.
 * `requested` (a property the operator picked) must be one of the readable
 * `sites`; otherwise the result is null, and the caller reports
 * `property_not_accessible` rather than silently reading another property.
 */
export function matchProperty(sites: GscSite[], project: { url: string; registrableDomain: string }, requested?: string): GscPropertyMatch | null {
  let projectUrl: URL;
  try {
    projectUrl = new URL(project.url);
  } catch {
    return null;
  }
  const projectPath = pathPrefix(projectUrl.pathname);
  const readable = sites.filter((site) => site.permissionLevel !== "siteUnverifiedUser");

  if (requested) {
    const picked = readable.find((site) => site.siteUrl === requested);
    if (!picked) return null;
    const classified = classify(picked, projectUrl, projectPath, project.registrableDomain);
    return {
      siteUrl: picked.siteUrl,
      kind: picked.siteUrl.startsWith("sc-domain:") ? "domain" : "url_prefix",
      permissionLevel: picked.permissionLevel,
      matchReason: "user_selected",
      pageFilter: classified?.pageFilter ?? null,
      alternatives: [],
    };
  }

  const candidates = readable
    .map((site) => classify(site, projectUrl, projectPath, project.registrableDomain))
    .filter((candidate): candidate is Candidate => candidate !== null)
    .sort(compare);
  const best = candidates[0];
  if (!best) return null;
  return {
    siteUrl: best.site.siteUrl,
    kind: best.site.siteUrl.startsWith("sc-domain:") ? "domain" : "url_prefix",
    permissionLevel: best.site.permissionLevel,
    matchReason: best.reason,
    pageFilter: best.pageFilter,
    alternatives: candidates.slice(1, 1 + MAX_ALTERNATIVES).map((candidate) => candidate.site.siteUrl),
  };
}
