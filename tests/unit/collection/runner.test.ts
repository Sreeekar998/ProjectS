import { beforeEach, describe, expect, it, vi } from "vitest";

const state = vi.hoisted(() => ({
  rows: [] as Array<Record<string, unknown>>,
  sections: new Map<string, string>(),
  calls: [] as string[],
  outcome: (() => ({})) as (id: string) => unknown,
  canary: (() => ({ ok: true })) as (route: string) => { ok: boolean; reason?: string | null },
  nextRoute: (() => null) as (engine: string, exclude: readonly string[]) => string | null,
  switches: [] as Array<{ from: string; to: string }>,
}));

vi.mock("@/lib/events/bus", () => ({ appendEvent: vi.fn() }));
vi.mock("@/lib/providers/credentials", () => ({ loadCredentials: vi.fn(async () => undefined) }));
vi.mock("@/lib/prompts/repository", () => ({
  listCandidates: vi.fn(async () => [...state.sections.entries()].map(([id, section]) => ({ id, section }))),
}));
vi.mock("@/lib/collection/repository", () => ({
  getCollectionRun: vi.fn(async (id: string) => ({ id, projectId: "prj_test", promptSetId: "pset_test" })),
  listPromptRuns: vi.fn(async () => state.rows.map((row) => ({ ...row }))),
  updatePromptRun: vi.fn(async () => undefined),
}));
vi.mock("@/lib/collection/orchestrator", () => ({
  automatedRouteAvailable: () => true,
  isPermanentFailure: (error: string | null) => /disabled|auth_failed|billing_required|schema_unrecognised/.test(error ?? ""),
  isTargetFailure: (error: string | null) => /^(target_blocked|empty_response|schema_unrecognised)/.test(error ?? ""),
  NO_RATE_SIGNAL: { limitTokens: null, remainingTokens: null, resetTokensMs: null, retryAfterMs: null },
  observationGeography: vi.fn(async () => ({ country: "AE", countrySource: "market", intendedMarket: "United Arab Emirates" })),
  retryPromptRun: vi.fn(async () => undefined),
  runAutomatedPromptRun: vi.fn(async (id: string) => {
    state.calls.push(id);
    return state.outcome(id);
  }),
  runVendorCanary: vi.fn(async (route: string) => ({ route, latencyMs: 5, model: null, searched: true, citations: 2, markers: null, credits: null, reason: null, ...state.canary(route) })),
  nextRouteForEngine: vi.fn((engine: string, exclude: readonly string[]) => state.nextRoute(engine, exclude)),
  switchAutomatedRoute: vi.fn(async (_runId: string, from: string, to: string) => {
    state.switches.push({ from, to });
    // Mirror the real switch: unfinished rows retire, the same prompts are planned on the new route.
    const moving = state.rows.filter((row) => row.providerExperience === from && row.state === "planned");
    for (const row of moving) row.state = "policy_disabled";
    for (const row of moving) {
      state.rows.push({ ...row, id: `${row.id}_${to}`, providerExperience: to, state: "planned", attempts: 0 });
    }
    return { id: _runId };
  }),
}));

import { getRunnerProgress, RequestWindowPacer, runCollectionToCompletion } from "@/lib/collection/runner";
import { resetVendorHealth, isRouteHealthy } from "@/lib/collection/vendor-health";

function rate(retryAfterMs: number | null = null) {
  return { limitTokens: null, remainingTokens: null, resetTokensMs: null, retryAfterMs };
}

function plan(provider: string, sections: string[]) {
  state.rows = sections.map((_, index) => ({
    id: `run_${index}`,
    providerExperience: provider,
    state: "planned",
    promptCandidateId: `cand_${index}`,
    attempts: 0,
    lastError: null,
    attemptHistory: [],
  }));
  state.sections = new Map(sections.map((section, index) => [`cand_${index}`, section]));
}

const ok = () => ({ state: "succeeded", error: null, permanent: false, latencyMs: 10, rate: rate(), credits: null });

beforeEach(() => {
  state.calls = [];
  state.switches = [];
  state.outcome = ok;
  state.canary = () => ({ ok: true });
  state.nextRoute = () => null;
  resetVendorHealth();
  delete process.env.SUN_COLLECTION_MAX_REQUESTS_PER_LANE;
});

describe("collection runner", () => {
  it("checks the provider first, then asks Discovery prompts so the headline metric fills in earliest", async () => {
    plan("chatgpt_brightdata_web", ["Sentiment Analysis", "Trade Offs", "Discovery", "Sentiment Analysis", "Discovery"]);
    await runCollectionToCompletion("crun_order");
    expect(state.calls).toEqual(["run_2", "run_4", "run_1", "run_0", "run_3"]);
    const lane = getRunnerProgress("crun_order")!.lanes[0]!;
    expect(lane.status).toBe("done");
    expect(lane.succeeded).toBe(5);
    // Five prompts plus the canary.
    expect(lane.requests).toBe(6);
  });

  it("does not ask a provider that fails its canary; the run continues on the next provider", async () => {
    plan("chatgpt_brightdata_web", ["Discovery", "Discovery", "Trade Offs"]);
    state.canary = (route) => (route === "chatgpt_brightdata_web" ? { ok: false, reason: "surface_unverified" } : { ok: true });
    state.nextRoute = (_engine, exclude) => (exclude.includes("chatgpt_cloro_web") ? null : "chatgpt_cloro_web");
    await runCollectionToCompletion("crun_canary");
    const progress = getRunnerProgress("crun_canary")!;
    const [first, second] = progress.lanes;
    expect(first!.status).toBe("paused");
    expect(first!.paceReason).toBe("vendor_unhealthy");
    expect(first!.continuedOn).toBe("chatgpt_cloro_web");
    expect(isRouteHealthy("chatgpt_brightdata_web")).toBe(false);
    expect(state.switches).toEqual([{ from: "chatgpt_brightdata_web", to: "chatgpt_cloro_web" }]);
    expect(second!.provider).toBe("chatgpt_cloro_web");
    expect(second!.status).toBe("done");
    expect(second!.succeeded).toBe(3);
    // Only the replacement lane asked the prompts.
    expect(state.calls.every((id) => id.endsWith("_chatgpt_cloro_web"))).toBe(true);
    expect(progress.recheckAt).toBeNull();
  });

  it("hands over after three blocked answers in a row, and pauses with a re-check when no provider is left", async () => {
    plan("chatgpt_cloro_web", Array.from({ length: 8 }, () => "Discovery"));
    state.outcome = () => ({ state: "failed", error: "target_blocked", permanent: false, latencyMs: 10, rate: rate(), credits: null });
    await runCollectionToCompletion("crun_breaker");
    const progress = getRunnerProgress("crun_breaker")!;
    const lane = progress.lanes[0]!;
    expect(state.calls.length).toBe(3);
    expect(lane.status).toBe("paused");
    expect(lane.paceReason).toBe("target_blocked");
    expect(lane.continuedOn).toBeNull();
    expect(isRouteHealthy("chatgpt_cloro_web")).toBe(false);
    expect(progress.status).toBe("completed");
    expect(progress.recheckAt).toBeGreaterThan(Date.now() + 25 * 60_000);
  });

  it("stops at the per-lane request cap instead of spending a free tier on retries", async () => {
    process.env.SUN_COLLECTION_MAX_REQUESTS_PER_LANE = "3";
    plan("chatgpt_decodo_web", Array.from({ length: 6 }, () => "Discovery"));
    await runCollectionToCompletion("crun_cap");
    const lane = getRunnerProgress("crun_cap")!.lanes[0]!;
    // Canary + two prompts = the cap of three.
    expect(state.calls).toHaveLength(2);
    expect(lane.status).toBe("paused");
    expect(lane.paceReason).toBe("budget_cap");
  });

  it("pauses when the provider reports the last credits, and keeps the rest for the next provider", async () => {
    plan("chatgpt_cloro_web", ["Discovery", "Discovery", "Discovery"]);
    state.outcome = () => ({ ...ok(), credits: { charged: 7, remaining: 3 } });
    state.nextRoute = (_engine, exclude) => (exclude.includes("chatgpt_decodo_web") ? null : "chatgpt_decodo_web");
    await runCollectionToCompletion("crun_credits");
    const progress = getRunnerProgress("crun_credits")!;
    expect(progress.lanes[0]!.paceReason).toBe("no_credits");
    expect(progress.lanes[0]!.continuedOn).toBe("chatgpt_decodo_web");
    expect(progress.lanes[1]!.provider).toBe("chatgpt_decodo_web");
  });

  it("pauses a lane whose quota is used up instead of waiting out a long retry-after", async () => {
    // cloro's lane runs one prompt at a time, so exactly one refusal is seen.
    plan("chatgpt_cloro_web", ["Discovery", "Discovery", "Trade Offs"]);
    state.outcome = () => ({ state: "rate_limited", error: "rate_limited", permanent: false, latencyMs: 10, rate: rate(20 * 60_000) });
    const started = Date.now();
    await runCollectionToCompletion("crun_quota");
    const progress = getRunnerProgress("crun_quota")!;
    expect(Date.now() - started).toBeLessThan(5_000);
    expect(state.calls).toHaveLength(1);
    expect(progress.lanes[0]!.status).toBe("paused");
    expect(progress.lanes[0]!.paceReason).toMatch(/quota/);
    expect(progress.lanes[0]!.resumesAt).toBeGreaterThan(Date.now() + 10 * 60_000);
  });

  // An empty balance used to fail every remaining prompt one by one.
  it("pauses a lane on an empty balance and keeps its prompts collectable", async () => {
    plan("chatgpt_brightdata_web", Array.from({ length: 12 }, () => "Discovery"));
    state.outcome = () => ({ state: "failed", error: "billing_required", permanent: true, latencyMs: 10, rate: rate() });
    await runCollectionToCompletion("crun_billing");
    const progress = getRunnerProgress("crun_billing")!;
    expect(state.calls.length).toBeLessThan(12);
    expect(progress.lanes[0]!.status).toBe("paused");
    expect(progress.lanes[0]!.paceReason).toBe("no_credits");
    const { retryPromptRun } = await import("@/lib/collection/orchestrator");
    expect(retryPromptRun).toHaveBeenCalledWith("run_0", { countAttempt: false });
  });

  it("holds a request until the per-minute window has room", async () => {
    vi.useFakeTimers();
    try {
      const pacer = new RequestWindowPacer(2);
      const reasons: string[] = [];
      await pacer.acquire(() => undefined);
      await pacer.acquire(() => undefined);
      let released = false;
      const third = pacer
        .acquire((_until, reason) => {
          reasons.push(reason);
        })
        .then(() => {
          released = true;
        });
      await vi.advanceTimersByTimeAsync(30_000);
      expect(released).toBe(false);
      await vi.advanceTimersByTimeAsync(31_000);
      await third;
      expect(released).toBe(true);
      expect(reasons[0]).toMatch(/request window full/);
    } finally {
      vi.useRealTimers();
    }
  });
});
