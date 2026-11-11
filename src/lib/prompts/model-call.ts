// Model access for prompt generation.
//
// Prompt generation was pinned to one free Gemini alias through its own
// client, with OpenAI hard-gated off. It now goes through the routed LLM layer
// (stage "prompts"), which the operator approved for paid OpenAI calls on
// 2026-09-13 with "good quality but cost effective":
//   * planner calls (the customer intent model) use the cheaper model first;
//   * writer calls (the prompts themselves) use the stronger writer first,
//     because natural wording is the product.
// Gemini remains the no-spend fallback in both chains.

import { availableRoutes, generateStructured, routesForStage } from "@/lib/llm";
import type { ReasoningEffort } from "@/lib/llm/types";

export function promptModelAvailable(): boolean {
  return availableRoutes("prompts").length > 0;
}

export interface PromptModelResult<T> {
  ok: boolean;
  data?: T;
  error?: string;
  latencyMs: number;
  model: string;
}

export async function promptStructured<T>(request: {
  role: "planner" | "writer";
  schemaName: string;
  schema: Record<string, unknown>;
  systemInstruction: string;
  userContent: string;
  temperature?: number;
  timeoutMs?: number;
  projectId?: string;
  reasoningEffort?: ReasoningEffort;
  maxOutputTokens?: number;
}): Promise<PromptModelResult<T>> {
  const chain = routesForStage("prompts");
  // Planner: skip the premium writer; its structure needs no prose quality.
  const routes = request.role === "planner" ? chain.filter((route) => !/terra|sol|astra/.test(route.model)) : chain;
  const result = await generateStructured<T>({
    stage: "prompts",
    schemaName: request.schemaName,
    schema: request.schema,
    systemInstruction: request.systemInstruction,
    userContent: request.userContent,
    temperature: request.temperature,
    timeoutMs: request.timeoutMs,
    projectId: request.projectId,
    reasoningEffort: request.reasoningEffort ?? "low",
    maxOutputTokens: request.maxOutputTokens,
    routes: routes.length > 0 ? routes : chain,
  });
  return { ok: result.ok, data: result.data, error: result.error, latencyMs: result.latencyMs, model: result.ok ? `${result.provider}:${result.model}` : "" };
}
