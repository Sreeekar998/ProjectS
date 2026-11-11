import { afterEach, describe, expect, it } from "vitest";
import { appendEvent, latestSequence } from "@/lib/events/bus";
import { isActive, release, tryAcquire } from "@/lib/jobs/active";

describe("active job registry", () => {
  afterEach(() => {
    for (const key of ["crawl:prj_a", "crawl:prj_b", "landscape:prj_a"]) release(key);
  });

  it("lets only one job hold a key until it is released", () => {
    expect(isActive("crawl:prj_a")).toBe(false);
    expect(tryAcquire("crawl:prj_a")).toBe(true);
    expect(isActive("crawl:prj_a")).toBe(true);
    expect(tryAcquire("crawl:prj_a")).toBe(false);
    release("crawl:prj_a");
    expect(isActive("crawl:prj_a")).toBe(false);
    expect(tryAcquire("crawl:prj_a")).toBe(true);
  });

  it("keeps keys for different projects and stages independent", () => {
    expect(tryAcquire("crawl:prj_a")).toBe(true);
    expect(tryAcquire("crawl:prj_b")).toBe(true);
    expect(tryAcquire("landscape:prj_a")).toBe(true);
    release("crawl:prj_a");
    expect(isActive("crawl:prj_b")).toBe(true);
    expect(isActive("landscape:prj_a")).toBe(true);
  });

  it("tolerates releasing a key twice or one never acquired", () => {
    expect(() => release("crawl:prj_a")).not.toThrow();
    expect(tryAcquire("crawl:prj_a")).toBe(true);
    release("crawl:prj_a");
    release("crawl:prj_a");
    expect(isActive("crawl:prj_a")).toBe(false);
  });

  it("shares one registry across module reloads through globalThis", () => {
    expect(tryAcquire("crawl:prj_a")).toBe(true);
    const holder = globalThis as typeof globalThis & { __sunActiveJobs?: Set<string> };
    expect(holder.__sunActiveJobs?.has("crawl:prj_a")).toBe(true);
  });
});

describe("latestSequence", () => {
  it("is 0 for a project with no events and follows appends", () => {
    expect(latestSequence("prj_seq_test")).toBe(0);
    appendEvent("prj_seq_test", "policy.status", { note: "one" });
    appendEvent("prj_seq_test", "policy.status", { note: "two" });
    expect(latestSequence("prj_seq_test")).toBe(2);
    expect(latestSequence("prj_other_test")).toBe(0);
  });
});
