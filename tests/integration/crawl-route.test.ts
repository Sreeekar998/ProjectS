import { beforeEach, describe, expect, it, vi } from "vitest";
import type { NextRequest } from "next/server";

// POST /api/projects/[id]/crawl: optional body, one crawl per project, and the
// event sequence the page scopes its progress rail from. The pipeline's real
// wrapper runs (it frees the job key); the crawl itself is a controllable fake.

const control = vi.hoisted(() => ({
  calls: [] as Array<{ projectId: string; options: unknown }>,
  gates: new Map<string, () => void>(),
}));

vi.mock("@/lib/profile/orchestrator", () => ({
  runWebsiteIntelligence: vi.fn((projectId: string, options: unknown) => {
    control.calls.push({ projectId, options });
    return new Promise<void>((resolve) => control.gates.set(projectId, resolve));
  }),
}));

const { POST } = await import("@/app/api/projects/[id]/crawl/route");
const { GET: getProfile, PATCH: patchProfile } = await import("@/app/api/projects/[id]/profile/route");
const { NextRequest: RealNextRequest } = await import("next/server");
const { createProject } = await import("@/lib/projects/repository");
const { appendEvent } = await import("@/lib/events/bus");
const { isActive } = await import("@/lib/jobs/active");
const { createCrawlRun } = await import("@/lib/crawler/repository");
const { createProfileVersion } = await import("@/lib/profile/repository");
const { emptyProfile } = await import("@/lib/profile/schema");

function post(projectId: string, body?: string, headers: Record<string, string> = {}) {
  const request = new Request(`http://localhost/api/projects/${projectId}/crawl`, { method: "POST", headers: { ...(body === undefined ? {} : { "content-type": "application/json" }), ...headers }, ...(body === undefined ? {} : { body }) }) as unknown as NextRequest;
  return POST(request, { params: Promise.resolve({ id: projectId }) });
}

// A DNS-rebinding page reaches the app under its own name, so that name is the Host.
const REBOUND = { host: "rebind.evil.test:3000", origin: "http://rebind.evil.test:3000" };

async function finish(projectId: string) {
  control.gates.get(projectId)?.();
  control.gates.delete(projectId);
  await vi.waitFor(() => expect(isActive(`crawl:${projectId}`)).toBe(false));
}

async function project(slug: string) {
  return createProject({ url: `https://${slug}.example/`, marketScope: "global", language: "en" });
}

beforeEach(() => {
  control.calls.length = 0;
});

describe("POST /api/projects/[id]/crawl", () => {
  it("accepts a bodiless request and returns the current event sequence", async () => {
    const p = await project("crawl-bodiless");
    appendEvent(p.id, "policy.status", { stage: "test" });
    appendEvent(p.id, "policy.status", { stage: "test" });
    const response = await post(p.id);
    expect(response.status).toBe(202);
    expect(await response.json()).toEqual({ status: "started", sinceSequence: 2 });
    await vi.waitFor(() => expect(control.calls).toHaveLength(1));
    // No previous run asked for Search Console, so a bodiless crawl keeps it off.
    expect(control.calls[0]).toEqual({ projectId: p.id, options: { searchConsole: { enabled: false } } });
    await finish(p.id);
  });

  it("passes an explicit Search Console choice to the pipeline", async () => {
    const p = await project("crawl-body");
    const response = await post(p.id, JSON.stringify({ searchConsole: { enabled: true } }));
    expect(response.status).toBe(202);
    await vi.waitFor(() => expect(control.calls).toHaveLength(1));
    expect(control.calls[0]!.options).toEqual({ searchConsole: { enabled: true } });
    await finish(p.id);
  });

  it("rejects malformed JSON and a wrong shape with 400 invalid_request, and starts nothing", async () => {
    const p = await project("crawl-malformed");
    for (const body of ["{not json", JSON.stringify({ searchConsole: { enabled: "yes" } })]) {
      const response = await post(p.id, body);
      expect(response.status).toBe(400);
      expect((await response.json()).error.code).toBe("invalid_request");
    }
    expect(isActive(`crawl:${p.id}`)).toBe(false);
    expect(control.calls).toHaveLength(0);
  });

  it("returns 404 for an unknown project", async () => {
    const response = await post("prj_does_not_exist");
    expect(response.status).toBe(404);
  });

  it("answers already_running while a crawl is in flight, with the running crawl's start sequence", async () => {
    const p = await project("crawl-twice");
    appendEvent(p.id, "policy.status", { stage: "test" });
    const first = await (await post(p.id)).json();
    expect(first).toEqual({ status: "started", sinceSequence: 1 });
    appendEvent(p.id, "profile.synthesis.started", { mode: "deterministic" });
    appendEvent(p.id, "crawl.started", { crawlRunId: "crw_x" });

    const second = await post(p.id, JSON.stringify({ searchConsole: { enabled: true } }));
    expect(second.status).toBe(202);
    expect(await second.json()).toEqual({ status: "already_running", sinceSequence: 1 });
    await vi.waitFor(() => expect(control.calls).toHaveLength(1));

    const profileVersion = await createProfileVersion(p.id, null, emptyProfile("crawl-twice.example"), { status: "partial" });
    expect(profileVersion.status).toBe("partial");
    const during = await (await getProfile(new Request("http://localhost") as unknown as NextRequest, { params: Promise.resolve({ id: p.id }) })).json();
    expect(during.inProgress).toBe(true);

    await finish(p.id);
    const after = await (await getProfile(new Request("http://localhost") as unknown as NextRequest, { params: Promise.resolve({ id: p.id }) })).json();
    expect(after.inProgress).toBe(false);

    const third = await post(p.id);
    expect(await third.json()).toEqual({ status: "started", sinceSequence: 3 });
    await finish(p.id);
  });

  it("keeps the previous run's Search Console choice for a bodiless retry, and an explicit off wins", async () => {
    const p = await project("crawl-retry");
    await createCrawlRun(p.id, { metrics: { searchConsoleRequested: "yes" } });
    await post(p.id);
    await vi.waitFor(() => expect(control.calls).toHaveLength(1));
    expect(control.calls[0]!.options).toEqual({ searchConsole: { enabled: true } });
    await finish(p.id);

    await post(p.id, JSON.stringify({ searchConsole: { enabled: false } }));
    await vi.waitFor(() => expect(control.calls).toHaveLength(2));
    expect(control.calls[1]!.options).toEqual({ searchConsole: { enabled: false } });
    await finish(p.id);
  });

  it("refuses Search Console from a host that isn't this app's own, explicit or inherited, and starts nothing", async () => {
    const p = await project("crawl-rebind");
    const explicit = await post(p.id, JSON.stringify({ searchConsole: { enabled: true } }), REBOUND);
    expect(explicit.status).toBe(403);
    expect((await explicit.json()).error.code).toBe("untrusted_host");

    // A bodiless retry would inherit the previous run's "on".
    await createCrawlRun(p.id, { metrics: { searchConsoleRequested: "yes" } });
    const inherited = await post(p.id, undefined, REBOUND);
    expect(inherited.status).toBe(403);
    expect((await inherited.json()).error.code).toBe("untrusted_host");
    expect(isActive(`crawl:${p.id}`)).toBe(false);
    expect(control.calls).toHaveLength(0);

    // The app's own loopback address still inherits it.
    expect((await post(p.id, undefined, { host: "127.0.0.1:3000" })).status).toBe(202);
    await vi.waitFor(() => expect(control.calls).toHaveLength(1));
    expect(control.calls[0]!.options).toEqual({ searchConsole: { enabled: true } });
    await finish(p.id);
  });

  it("still crawls from any host when Search Console stays off", async () => {
    const p = await project("crawl-rebind-off");
    expect((await post(p.id, undefined, REBOUND)).status).toBe(202);
    await vi.waitFor(() => expect(control.calls).toHaveLength(1));
    expect(control.calls[0]!.options).toEqual({ searchConsole: { enabled: false } });
    await finish(p.id);

    expect((await post(p.id, JSON.stringify({ searchConsole: { enabled: false } }), { host: "192.168.1.20:3000" })).status).toBe(202);
    await vi.waitFor(() => expect(control.calls).toHaveLength(2));
    expect(control.calls[1]!.options).toEqual({ searchConsole: { enabled: false } });
    await finish(p.id);
  });

  it("frees the job key when the pipeline throws", async () => {
    const { runWebsiteIntelligence } = await import("@/lib/profile/orchestrator");
    vi.mocked(runWebsiteIntelligence).mockImplementationOnce(async () => {
      throw new Error("boom");
    });
    const p = await project("crawl-throws");
    expect((await post(p.id)).status).toBe(202);
    await vi.waitFor(() => expect(isActive(`crawl:${p.id}`)).toBe(false));
    expect((await (await post(p.id)).json()).status).toBe("started");
    await vi.waitFor(() => expect(control.gates.has(p.id)).toBe(true));
    await finish(p.id);
  });
});

describe("GET and PATCH /api/projects/[id]/profile from an untrusted host", () => {
  const summary = { source: "google_search_console", siteUrl: "sc-domain:crawl-profile-gsc.example", topNonBrandQueries: [{ query: "private query", clicks: 9, impressions: 90 }] };

  function profileRequest(method: "GET" | "PATCH", headers: Record<string, string>, body?: unknown) {
    return new RealNextRequest("http://localhost/api/projects/x/profile", { method, headers: { ...headers, ...(body ? { "content-type": "application/json" } : {}) }, ...(body ? { body: JSON.stringify(body) } : {}) });
  }

  it("leaves profile.searchConsole out of the response, keeps it in storage, and keeps it for this app's own address", async () => {
    const p = await project("crawl-profile-gsc");
    await createProfileVersion(p.id, null, { ...emptyProfile("crawl-profile-gsc.example"), searchConsole: summary } as unknown as ReturnType<typeof emptyProfile>, { status: "complete" });
    const params = { params: Promise.resolve({ id: p.id }) };

    const rebound = await (await getProfile(profileRequest("GET", REBOUND), params)).json();
    expect(rebound.profileVersion.profile).not.toHaveProperty("searchConsole");
    expect(rebound.profileVersion.profile.identity).toBeDefined();
    expect(JSON.stringify(rebound)).not.toContain("private query");

    const edited = await (await patchProfile(profileRequest("PATCH", REBOUND, { action: "edit", edits: { brandName: "Renamed" } }), params)).json();
    expect(edited.profileVersion.profile.identity.brandName.value).toBe("Renamed");
    expect(edited.profileVersion.profile).not.toHaveProperty("searchConsole");
    const confirmed = await (await patchProfile(profileRequest("PATCH", REBOUND, { action: "confirm" }), params)).json();
    expect(confirmed.profileVersion.profile).not.toHaveProperty("searchConsole");

    const ownHosts: Array<Record<string, string>> = [{}, { host: "127.0.0.1:3000" }];
    for (const headers of ownHosts) {
      const own = await (await getProfile(profileRequest("GET", headers), params)).json();
      expect(own.profileVersion.profile.identity.brandName.value).toBe("Renamed");
      expect(own.profileVersion.profile.searchConsole).toEqual(summary);
    }
  });
});
