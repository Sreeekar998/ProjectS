import { NextResponse } from "next/server";
import { ZodError } from "zod";
import { UnsafeUrlError } from "@/lib/security/url-safety";
import { ProfileNotConfirmedError } from "@/lib/landscape/orchestrator";
import { LandscapeNotConfirmedError, PromptReviewError, PromptSetIncompleteError } from "@/lib/prompts/orchestrator";
import { InvalidStateTransitionError } from "@/lib/collection/state-machine";
import { NoCollectionRouteError } from "@/lib/collection/orchestrator";
import { RunFinalisedError } from "@/lib/collection/finalise";
import { RunNotFoundError } from "@/lib/measure/service";

export function jsonError(status: number, code: string, message: string) {
  return NextResponse.json({ error: { code, message } }, { status });
}

/** Maps every domain-level guard error thrown deep in the pipeline to a
 * stable HTTP status + machine-readable code, so the UI can render a
 * specific blocked/error state instead of a generic 500. Logs and returns
 * a redacted message for anything unrecognized — never leaks stack traces
 * or provider payload internals to the client. */
export function handleApiError(err: unknown): NextResponse {
  if (err instanceof ZodError) {
    return jsonError(400, "invalid_request", err.issues.map((i) => `${i.path.join(".")}: ${i.message}`).join("; "));
  }
  if (err instanceof UnsafeUrlError) {
    return jsonError(400, `unsafe_url_${err.code}`, err.message);
  }
  if (err instanceof ProfileNotConfirmedError) {
    return jsonError(409, "profile_not_confirmed", err.message);
  }
  if (err instanceof LandscapeNotConfirmedError) {
    return jsonError(409, "landscape_not_confirmed", err.message);
  }
  if (err instanceof PromptReviewError) {
    return jsonError(409, "prompt_review_blocked", err.message);
  }
  if (err instanceof PromptSetIncompleteError) {
    return jsonError(409, "prompt_set_incomplete", err.message);
  }
  if (err instanceof NoCollectionRouteError) {
    return jsonError(409, "no_collection_route", err.message);
  }
  if (err instanceof InvalidStateTransitionError) {
    return jsonError(409, "invalid_state_transition", err.message);
  }
  if (err instanceof RunFinalisedError) {
    return jsonError(409, "run_finalised", err.message);
  }
  if (err instanceof RunNotFoundError) {
    return jsonError(404, "collection_run_not_found", err.message);
  }
  const message = err instanceof Error ? err.message : "Unknown error";
   
  console.error("[api]", message, err instanceof Error ? err.stack : "");
  return jsonError(500, "internal_error", "Something went wrong processing this request.");
}

export async function withErrorHandling(fn: () => Promise<NextResponse>): Promise<NextResponse> {
  try {
    return await fn();
  } catch (err) {
    return handleApiError(err);
  }
}
