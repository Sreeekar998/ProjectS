import { describe, expect, it } from "vitest";
import { matchProperty, pageFilterFor } from "@/lib/search-console/property-match";
import type { GscSite } from "@/lib/search-console/types";

const project = { url: "https://www.lumenstudio.test/", registrableDomain: "lumenstudio.test" };

describe("matchProperty", () => {
  it("prefers the Domain property over URL-prefix properties of the same site", () => {
    const sites: GscSite[] = [
      { siteUrl: "https://www.lumenstudio.test/", permissionLevel: "siteOwner" },
      { siteUrl: "sc-domain:lumenstudio.test", permissionLevel: "siteRestrictedUser" },
    ];
    const match = matchProperty(sites, project);
    expect(match).toMatchObject({ siteUrl: "sc-domain:lumenstudio.test", kind: "domain", matchReason: "domain_property", pageFilter: null });
    expect(match?.alternatives).toEqual(["https://www.lumenstudio.test/"]);
  });

  it("ranks exact origin above the other scheme and the www variant", () => {
    const sites: GscSite[] = [
      { siteUrl: "https://lumenstudio.test/", permissionLevel: "siteOwner" },
      { siteUrl: "http://www.lumenstudio.test/", permissionLevel: "siteOwner" },
      { siteUrl: "https://www.lumenstudio.test/", permissionLevel: "siteRestrictedUser" },
    ];
    expect(matchProperty(sites, project)).toMatchObject({ siteUrl: "https://www.lumenstudio.test/", matchReason: "exact_origin" });
    expect(matchProperty(sites.slice(0, 2), project)).toMatchObject({ siteUrl: "http://www.lumenstudio.test/", matchReason: "same_host_other_scheme" });
    expect(matchProperty(sites.slice(0, 1), project)).toMatchObject({ siteUrl: "https://lumenstudio.test/", matchReason: "www_variant" });
  });

  it("never matches a URL-prefix property on another port", () => {
    // Another port is another origin in Search Console, so its data is another site's.
    const plain = { url: "https://lumenstudio.test/", registrableDomain: "lumenstudio.test" };
    expect(matchProperty([{ siteUrl: "https://lumenstudio.test:8443/", permissionLevel: "siteOwner" }], plain)).toBeNull();
    expect(matchProperty([{ siteUrl: "http://www.lumenstudio.test:8080/", permissionLevel: "siteOwner" }], plain)).toBeNull();
    expect(matchProperty([{ siteUrl: "https://lumenstudio.test:443/", permissionLevel: "siteOwner" }], plain)).toMatchObject({ matchReason: "exact_origin", pageFilter: null });
    expect(matchProperty([{ siteUrl: "https://lumenstudio.test:8443/", permissionLevel: "siteOwner" }], { url: "https://lumenstudio.test:8443/", registrableDomain: "lumenstudio.test" })).toMatchObject({ matchReason: "exact_origin" });
  });

  it("gives a subdomain project an escaped, anchored page filter on the parent Domain property", () => {
    const match = matchProperty([{ siteUrl: "sc-domain:lumenstudio.test", permissionLevel: "siteFullUser" }], { url: "https://shop.lumenstudio.test/", registrableDomain: "lumenstudio.test" });
    expect(match).toMatchObject({ matchReason: "parent_domain_property", pageFilter: "^https?://(www\\.)?shop\\.lumenstudio\\.test(/|$)" });
    const regex = new RegExp(match!.pageFilter!);
    expect(regex.test("https://shop.lumenstudio.test/cart")).toBe(true);
    expect(regex.test("https://shop.lumenstudio.test")).toBe(true);
    expect(regex.test("https://shopXlumenstudio.test/")).toBe(false);
    expect(regex.test("https://blog.lumenstudio.test/")).toBe(false);
    expect(regex.test("https://shop.lumenstudio.test.evil.test/")).toBe(false);
  });

  it("narrows a root property to a project URL with a path, and accepts a deeper path prefix only as a last resort", () => {
    const pathProject = { url: "https://lumenstudio.test/en/", registrableDomain: "lumenstudio.test" };
    expect(matchProperty([{ siteUrl: "https://lumenstudio.test/", permissionLevel: "siteOwner" }], pathProject)).toMatchObject({
      matchReason: "exact_origin",
      pageFilter: pageFilterFor("lumenstudio.test", "/en/"),
    });
    const sites: GscSite[] = [
      { siteUrl: "https://www.lumenstudio.test/blog/", permissionLevel: "siteOwner" },
      { siteUrl: "https://www.lumenstudio.test/", permissionLevel: "siteRestrictedUser" },
    ];
    expect(matchProperty(sites, project)?.siteUrl).toBe("https://www.lumenstudio.test/");
    expect(matchProperty(sites.slice(0, 1), project)).toMatchObject({ matchReason: "path_prefix", pageFilter: null });
  });

  it("breaks ties by permission level", () => {
    const sites: GscSite[] = [
      { siteUrl: "sc-domain:lumenstudio.test", permissionLevel: "siteRestrictedUser" },
      { siteUrl: "sc-domain:LUMENSTUDIO.test", permissionLevel: "siteOwner" },
    ];
    expect(matchProperty(sites, project)?.permissionLevel).toBe("siteOwner");
  });

  it("ignores unverified properties, other domains and public-suffix parents", () => {
    const sites: GscSite[] = [
      { siteUrl: "sc-domain:lumenstudio.test", permissionLevel: "siteUnverifiedUser" },
      { siteUrl: "sc-domain:other.test", permissionLevel: "siteOwner" },
      { siteUrl: "sc-domain:test", permissionLevel: "siteOwner" },
      { siteUrl: "https://lumenstudio.test.evil.test/", permissionLevel: "siteOwner" },
    ];
    expect(matchProperty(sites, project)).toBeNull();
  });

  it("uses a requested property only when the account can read it", () => {
    const sites: GscSite[] = [
      { siteUrl: "sc-domain:lumenstudio.test", permissionLevel: "siteOwner" },
      { siteUrl: "https://www.lumenstudio.test/", permissionLevel: "siteUnverifiedUser" },
    ];
    expect(matchProperty(sites, project, "sc-domain:lumenstudio.test")).toMatchObject({ matchReason: "user_selected", siteUrl: "sc-domain:lumenstudio.test" });
    expect(matchProperty(sites, project, "https://www.lumenstudio.test/")).toBeNull();
    expect(matchProperty(sites, project, "sc-domain:nobody.test")).toBeNull();
  });
});
