// Section 7.1 PromptRun state machine.
export type PromptRunState = "planned" | "claimed" | "awaiting_import" | "running" | "succeeded" | "rate_limited" | "incomplete" | "failed" | "policy_disabled";

const ALLOWED_TRANSITIONS: Record<PromptRunState, PromptRunState[]> = {
  planned: ["claimed", "policy_disabled", "running"],
  claimed: ["awaiting_import", "running", "failed", "planned"],
  awaiting_import: ["succeeded", "incomplete", "planned"],
  running: ["succeeded", "rate_limited", "failed"],
  succeeded: [], // terminal; regeneration creates a new sample (new prompt_run row) rather than reopening this one
  rate_limited: ["planned"],
  incomplete: ["planned"],
  failed: ["planned"],
  policy_disabled: [], // terminal until policy/config version changes (handled by re-creating the run)
};

export function canTransition(from: PromptRunState, to: PromptRunState): boolean {
  return ALLOWED_TRANSITIONS[from]?.includes(to) ?? false;
}

export class InvalidStateTransitionError extends Error {
  constructor(from: PromptRunState, to: PromptRunState) {
    super(`Cannot transition prompt_run from "${from}" to "${to}".`);
    this.name = "InvalidStateTransitionError";
  }
}
