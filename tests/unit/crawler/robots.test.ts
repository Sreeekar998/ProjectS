import { describe, it, expect } from "vitest";
import { parseRobotsTxt, pathAllowed, robotsPatternToRegex, selectAgentGroup } from "@/lib/crawler/robots";

function rulesFor(body: string) {
  const { groups } = parseRobotsTxt(body);
  return selectAgentGroup(groups).rules;
}

describe("parseRobotsTxt", () => {
  it("collects sitemap declarations regardless of group position", () => {
    const { sitemaps } = parseRobotsTxt(`Sitemap: https://a.test/sitemap.xml
User-agent: *
Disallow: /admin
Sitemap: https://a.test/sitemap-2.xml`);
    expect(sitemaps).toEqual(["https://a.test/sitemap.xml", "https://a.test/sitemap-2.xml"]);
  });

  it("treats consecutive User-agent lines as one group", () => {
    const { groups } = parseRobotsTxt(`User-agent: alpha
User-agent: beta
Disallow: /private`);
    expect(groups.get("alpha")).toEqual(groups.get("beta"));
    expect(groups.get("alpha")).toHaveLength(1);
  });

  it("starts a new group after a rule line", () => {
    const { groups } = parseRobotsTxt(`User-agent: alpha
Disallow: /a
User-agent: beta
Disallow: /b`);
    expect(groups.get("alpha")?.[0]?.pattern).toBe("/a");
    expect(groups.get("beta")?.[0]?.pattern).toBe("/b");
    expect(groups.get("beta")).toHaveLength(1);
  });

  it("ignores comments and blank lines", () => {
    const rules = rulesFor(`# a comment
User-agent: *   # trailing comment
Disallow: /admin

`);
    expect(rules).toHaveLength(1);
    expect(pathAllowed("/admin", rules)).toBe(false);
  });

  it("parses crawl-delay", () => {
    const { crawlDelays } = parseRobotsTxt(`User-agent: *
Crawl-delay: 2`);
    expect(crawlDelays.get("*")).toBe(2);
  });
});

describe("pathAllowed", () => {
  it("allows everything when there are no rules", () => {
    expect(pathAllowed("/anything", [])).toBe(true);
  });

  it("blocks a disallowed prefix", () => {
    const rules = rulesFor("User-agent: *\nDisallow: /admin");
    expect(pathAllowed("/admin", rules)).toBe(false);
    expect(pathAllowed("/admin/users", rules)).toBe(false);
    expect(pathAllowed("/about", rules)).toBe(true);
  });

  it("treats an empty Disallow as allow-all", () => {
    const rules = rulesFor("User-agent: *\nDisallow:");
    expect(pathAllowed("/anything", rules)).toBe(true);
  });

  it("lets a longer Allow override a shorter Disallow", () => {
    const rules = rulesFor(`User-agent: *
Disallow: /products
Allow: /products/featured`);
    expect(pathAllowed("/products/all", rules)).toBe(false);
    expect(pathAllowed("/products/featured", rules)).toBe(true);
  });

  it("resolves an equal-specificity tie in favour of Allow", () => {
    const rules = rulesFor(`User-agent: *
Disallow: /x
Allow: /x`);
    expect(pathAllowed("/x", rules)).toBe(true);
  });

  it("honours the * wildcard inside a pattern", () => {
    const rules = rulesFor("User-agent: *\nDisallow: /*.json");
    expect(pathAllowed("/data/config.json", rules)).toBe(false);
    expect(pathAllowed("/data/config.html", rules)).toBe(true);
  });

  it("honours the $ end-anchor", () => {
    const rules = rulesFor("User-agent: *\nDisallow: /page$");
    expect(pathAllowed("/page", rules)).toBe(false);
    expect(pathAllowed("/page/child", rules)).toBe(true);
  });

  it("matches percent-encoded paths against a decoded rule", () => {
    const rules = rulesFor("User-agent: *\nDisallow: /private area");
    expect(pathAllowed("/private%20area/file", rules)).toBe(false);
  });
});

describe("selectAgentGroup", () => {
  it("prefers our own token over the wildcard group", () => {
    const { groups } = parseRobotsTxt(`User-agent: *
Disallow: /

User-agent: projectsunbot
Disallow: /admin`);
    const { agent, rules } = selectAgentGroup(groups);
    expect(agent).toBe("projectsunbot");
    expect(pathAllowed("/about", rules)).toBe(true);
  });

  it("falls back to the wildcard group when no specific group exists", () => {
    const { groups } = parseRobotsTxt(`User-agent: googlebot
Disallow: /

User-agent: *
Disallow: /admin`);
    const { agent, rules } = selectAgentGroup(groups);
    expect(agent).toBe("*");
    expect(pathAllowed("/about", rules)).toBe(true);
    expect(pathAllowed("/admin", rules)).toBe(false);
  });

  it("blocks the whole site when the wildcard group disallows the root", () => {
    const rules = rulesFor("User-agent: *\nDisallow: /");
    expect(pathAllowed("/", rules)).toBe(false);
    expect(pathAllowed("/anything", rules)).toBe(false);
  });
});

describe("robotsPatternToRegex", () => {
  it("escapes regex metacharacters in literal path segments", () => {
    const regex = robotsPatternToRegex("/a+b(c)");
    expect(regex.test("/a+b(c)/d")).toBe(true);
    expect(regex.test("/aaab")).toBe(false);
  });
});
