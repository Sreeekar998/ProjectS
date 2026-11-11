import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { fetchRobotsPolicy } from "@/lib/crawler/robots";
import { discoverSitemap } from "@/lib/crawler/sitemap";
import { startNormalFixtureSite, startBlockedFixtureSite, type FixtureServer } from "../fixtures/fixture-server";

// robots.txt and sitemap.xml fetching happen before the SSRF-guarded page
// fetcher is ever invoked and use a plain fetch() with no loopback
// restriction (see crawler/robots.ts, crawler/sitemap.ts) — safe to point
// at a local fixture server for a real, deterministic HTTP round trip.
describe("fetchRobotsPolicy against a real local server", () => {
  let site: FixtureServer;
  let blocked: FixtureServer;
  beforeAll(async () => {
    site = await startNormalFixtureSite();
    blocked = await startBlockedFixtureSite();
  });
  afterAll(async () => {
    await site.close();
    await blocked.close();
  });

  it("parses an allow-all robots.txt and discovers the sitemap directive", async () => {
    const policy = await fetchRobotsPolicy(site.origin, AbortSignal.timeout(5000));
    expect(policy.fetched).toBe(true);
    expect(policy.isAllowed("/")).toBe(true);
    expect(policy.isAllowed("/pricing")).toBe(true);
    expect(policy.sitemaps.length).toBeGreaterThan(0);
  });

  it("parses a disallow-all robots.txt", async () => {
    const policy = await fetchRobotsPolicy(blocked.origin, AbortSignal.timeout(5000));
    expect(policy.fetched).toBe(true);
    expect(policy.isAllowed("/")).toBe(false);
  });

  it("treats a missing robots.txt as unrestricted", async () => {
    const policy = await fetchRobotsPolicy("http://127.0.0.1:1", AbortSignal.timeout(2000)); // nothing listening
    expect(policy.fetched).toBe(false);
    expect(policy.isAllowed("/anything")).toBe(true);
  });
});

describe("discoverSitemap against a real local server", () => {
  let site: FixtureServer;
  beforeAll(async () => {
    site = await startNormalFixtureSite();
  });
  afterAll(async () => {
    await site.close();
  });

  it("discovers URLs listed in the sitemap", async () => {
    const discovery = await discoverSitemap(site.origin, [`${site.origin}/sitemap.xml`], AbortSignal.timeout(5000));
    const urls = discovery.entries.map((e) => e.loc);
    expect(urls.length).toBeGreaterThanOrEqual(3);
    expect(urls.some((u) => u.endsWith("/pricing"))).toBe(true);
  });
});
