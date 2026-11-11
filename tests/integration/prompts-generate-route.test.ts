import { afterEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";

// The generation itself is replaced by a promise the test controls, so the
// route's job guard and sequence cursor are tested without generating prompts.
const generation = vi.hoisted(() => ({
  calls: [] as Array<{ projectId: string; force: boolean | undefined }>,
  settle: [] as Array<{ resolve: () => void; reject: (error: Error) => void }>,
}));

vi.mock("@/lib/prompts/orchestrator", () => ({
  generatePromptSet: (projectId: string, options: { force?: boolean } = {}) => {
    generation.calls.push({ projectId, force: options.force });
    return new Promise<void>((resolve, reject) => generation.settle.push({ resolve, reject }));
  },
}));

import { POST } from "@/app/api/projects/[id]/prompts/generate/route";
import { GET } from "@/app/api/projects/[id]/prompts/route";
import { appendEvent, getEventsSince, latestSequence } from "@/lib/events/bus";
import { isActive, release } from "@/lib/jobs/active";

const flush = () => new Promise((resolve) => setTimeout(resolve, 0));

function post(projectId: string, query = "") {
  return POST(new NextRequest(`http://localhost/api/projects/${projectId}/prompts/generate${query}`, { method: "POST" }), { params: Promise.resolve({ id: projectId }) });
}

function get(projectId: string) {
  return GET(new NextRequest(`http://localhost/api/projects/${projectId}/prompts`), { params: Promise.resolve({ id: projectId }) });
}

afterEach(() => {
  generation.calls.length = 0;
  generation.settle.length = 0;
});

describe("POST /api/projects/[id]/prompts/generate", () => {
  it("returns sinceSequence, refuses a second generation while one runs, and releases the job when it ends", async () => {
    const projectId = `prj_prompts_route_${Date.now()}`;
    appendEvent(projectId, "landscape.confirmed", { competitiveSetVersionId: "csv_1" });
    appendEvent(projectId, "prompt_set.ready", { promptSetId: "set_old" });
    const before = latestSequence(projectId);
    expect(before).toBe(2);

    const first = await post(projectId, "?force=1");
    expect(first.status).toBe(202);
    expect(await first.json()).toEqual({ status: "started", sinceSequence: before });
    expect(generation.calls).toEqual([{ projectId, force: true }]);
    expect(isActive(`prompts:${projectId}`)).toBe(true);

    const getWhileRunning = await get(projectId);
    expect(await getWhileRunning.json()).toMatchObject({ promptSet: null, candidates: [], inProgress: true });

    // A reload POSTs again: it joins the running job instead of starting another.
    appendEvent(projectId, "prompt.context.ready", { contextSnapshotId: "ctx_1" });
    const second = await post(projectId);
    expect(second.status).toBe(202);
    expect(await second.json()).toEqual({ status: "already_running", sinceSequence: before + 1 });
    expect(generation.calls).toHaveLength(1);

    generation.settle[0]!.resolve();
    await flush();
    expect(isActive(`prompts:${projectId}`)).toBe(false);
    expect(await (await get(projectId)).json()).toMatchObject({ inProgress: false });

    const third = await post(projectId);
    expect(await third.json()).toEqual({ status: "started", sinceSequence: before + 1 });
    expect(generation.calls).toHaveLength(2);
    generation.settle[1]!.resolve();
    await flush();
  });

  it("reports a background failure as policy.status {stage: prompt_generation} and still releases the job", async () => {
    const projectId = `prj_prompts_fail_${Date.now()}`;
    const response = await post(projectId);
    expect(await response.json()).toEqual({ status: "started", sinceSequence: 0 });

    generation.settle[0]!.reject(new Error("Confirm 4–6 topics first."));
    await flush();

    expect(isActive(`prompts:${projectId}`)).toBe(false);
    const events = await getEventsSince(projectId, 0);
    expect(events.map((event) => [event.type, event.payload])).toEqual([["policy.status", { stage: "prompt_generation", error: "Confirm 4–6 topics first." }]]);
  });

  it("starts again after a restart emptied the job registry", async () => {
    const projectId = `prj_prompts_restart_${Date.now()}`;
    release(`prompts:${projectId}`);
    const response = await post(projectId);
    expect((await response.json()).status).toBe("started");
    generation.settle[0]!.resolve();
    await flush();
  });
});
