import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { runCrawl } from "@/lib/crawler/orchestrator";
import { getCrawlRun } from "@/lib/crawler/repository";
import { newId } from "@/lib/ids";
import { startNormalFixtureSite, type FixtureServer } from "../fixtures/fixture-server";

// A corpus of SSRF-attempt targets that must never be fetched. Each one is
// run through the FULL crawl orchestrator (not just the underlying guard
// functions, which unit tests already cover) so this proves the actual
// entry point a real trial submission goes through fails closed.
const SSRF_CORPUS: Array<{ label: string; url: string }> = [
  { label: "loopback IPv4 literal", url: "http://127.0.0.1/" },
  { label: "loopback hostname", url: "http://localhost/" },
  { label: "private 10.x", url: "http://10.0.0.5/" },
  { label: "private 192.168.x", url: "http://192.168.1.1/" },
  { label: "cloud metadata endpoint", url: "http://169.254.169.254/latest/meta-data/" },
  { label: "link-local", url: "http://169.254.1.1/" },
  { label: "IPv6 loopback", url: "http://[::1]/" },
  { label: ".local mDNS hostname", url: "http://myserver.local/" },
  { label: "non-http(s) scheme", url: "file:///etc/passwd" },
  { label: "unresolvable hostname", url: "http://this-does-not-exist-sun-ssrf-test.invalid/" },
];

describe("SSRF corpus — runCrawl must fail closed for every entry", () => {
  it.each(SSRF_CORPUS)("blocks $label ($url)", async ({ url }) => {
    const outcome = await runCrawl(newId("prj"), url, "en");
    expect(outcome.status).toBe("blocked");
    expect(outcome.blockReason).toBeTruthy();

    const run = await getCrawlRun(outcome.crawlRunId);
    expect(run?.status).toBe("blocked");
    // No page should ever have been fetched for a blocked target.
    expect(run?.fetchedCount).toBe(0);
  });
});

describe("SSRF corpus — a real reachable-but-forbidden local server is still rejected", () => {
  let site: FixtureServer;
  beforeAll(async () => {
    site = await startNormalFixtureSite();
  });
  afterAll(async () => {
    await site.close();
  });

  it("rejects the fixture site's own loopback origin even though it is live and responds normally", async () => {
    // Proves the guard isn't just failing on DNS resolution errors — a
    // server that is genuinely up and would happily serve content on
    // loopback must still be refused before any request reaches it.
    const outcome = await runCrawl(newId("prj"), site.origin, "en");
    expect(outcome.status).toBe("blocked");
    expect(outcome.blockReason).toBe("private_address");
  });
});
