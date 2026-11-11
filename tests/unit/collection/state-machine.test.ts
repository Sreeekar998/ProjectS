import { describe, it, expect } from "vitest";
import { canTransition } from "@/lib/collection/state-machine";

describe("PromptRun state machine (spec 7.1)", () => {
  it("allows the manual-observation happy path: planned -> claimed -> awaiting_import -> succeeded", () => {
    expect(canTransition("planned", "claimed")).toBe(true);
    expect(canTransition("claimed", "awaiting_import")).toBe(true);
    expect(canTransition("awaiting_import", "succeeded")).toBe(true);
  });

  it("allows the automated-adapter happy path: planned -> claimed -> running -> succeeded", () => {
    expect(canTransition("claimed", "running")).toBe(true);
    expect(canTransition("running", "succeeded")).toBe(true);
  });

  it("allows typed non-success outcomes from their correct predecessor state", () => {
    expect(canTransition("running", "rate_limited")).toBe(true);
    expect(canTransition("running", "failed")).toBe(true);
    expect(canTransition("awaiting_import", "incomplete")).toBe(true);
    expect(canTransition("claimed", "failed")).toBe(true);
  });

  it("allows explicit retry back to planned from every typed non-success state", () => {
    expect(canTransition("rate_limited", "planned")).toBe(true);
    expect(canTransition("incomplete", "planned")).toBe(true);
    expect(canTransition("failed", "planned")).toBe(true);
  });

  it("treats succeeded as terminal", () => {
    expect(canTransition("succeeded", "planned")).toBe(false);
    expect(canTransition("succeeded", "failed")).toBe(false);
  });

  it("treats policy_disabled as terminal", () => {
    expect(canTransition("policy_disabled", "planned")).toBe(false);
  });

  it("rejects skipping straight from planned to succeeded", () => {
    expect(canTransition("planned", "succeeded")).toBe(false);
  });

  it("rejects rate_limited from a state that never ran (planned/claimed)", () => {
    expect(canTransition("planned", "rate_limited")).toBe(false);
    expect(canTransition("claimed", "rate_limited")).toBe(false);
  });
});
