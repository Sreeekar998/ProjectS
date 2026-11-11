// Provider-agnostic LLM contracts.
//
// Every model call in the business-understanding pipeline goes through this
// layer, for three reasons that each cost real debugging time before:
//   * a single hard-coded Gemini alias could not be swapped per stage, so an
//     extraction call and a prompt-writing call were forced onto one model;
//   * the Gemini `responseSchema` dialect and OpenAI's strict JSON Schema are
//     different enough (nullable vs type arrays, additionalProperties) that
//     callers were writing provider-specific schemas by hand;
//   * failures were silent `[]`s, indistinguishable from "no result".
//
// Stages name *what the call is for*; routing (`routing.ts`) decides which
// provider and model answer it. Callers never name a model.

export type LlmStage =
  | "extract" // long-evidence structured extraction (cheap, high volume)
  | "classify" // industry / business type / scope decisions
  | "synthesize" // adjudication over conflicting evidence (strong model)
  | "locate" // address parsing / location reconciliation
  | "competitors" // rival reasoning with world knowledge
  | "topics" // topic generation
  | "prompts" // natural-language prompt writing
  | "judge" // pass/fail quality judgements, reranking
  | "search"; // web search with sources

export type LlmProviderId = "openai" | "gemini" | "groq" | "cerebras";

export type ReasoningEffort = "minimal" | "low" | "medium" | "high";

export interface ModelRoute {
  provider: LlmProviderId;
  model: string;
}

export interface LlmUsage {
  inputTokens: number;
  outputTokens: number;
  reasoningTokens?: number;
  /** Extra tool invocations billed per call (web search). */
  toolCalls?: number;
}

export interface StructuredRequest<T> {
  stage: LlmStage;
  /** Short identifier for the schema; OpenAI requires one, and it labels telemetry. */
  schemaName: string;
  /** Standard JSON Schema (draft-07 style). Converted per provider. */
  schema: Record<string, unknown>;
  /** Instructions. Never contains website text. */
  systemInstruction: string;
  /** Untrusted data plus the task framing. */
  userContent: string;
  /** Used only by providers that honour it (Gemini, Groq, Cerebras). */
  temperature?: number;
  reasoningEffort?: ReasoningEffort;
  maxOutputTokens?: number;
  timeoutMs?: number;
  /** Attribution for the usage ledger. */
  projectId?: string;
  /** Optional post-parse validation; returning null means "try the next provider". */
  validate?: (data: unknown) => T | null;
  /** Override the routing chain (tests, experiments). */
  routes?: ModelRoute[];
}

export interface StructuredResult<T> {
  ok: boolean;
  data?: T;
  rawText?: string;
  error?: string;
  provider: LlmProviderId | "none";
  model: string;
  latencyMs: number;
  usage?: LlmUsage;
  costUsd?: number;
  /** Every provider attempted, in order, with the outcome of each. */
  attempts: Array<{ provider: LlmProviderId; model: string; ok: boolean; error?: string; latencyMs: number }>;
}

export interface WebSearchRequest {
  stage?: LlmStage;
  /** What to find, in plain language. The model decides the queries. */
  task: string;
  /** Approximate location to localise results (ISO country code, city, region). */
  userLocation?: { country?: string; city?: string; region?: string; timezone?: string };
  contextSize?: "low" | "medium" | "high";
  /** Optional strict schema for the answer; without it `text` is free-form. */
  schema?: Record<string, unknown>;
  schemaName?: string;
  timeoutMs?: number;
  projectId?: string;
  maxOutputTokens?: number;
}

export interface WebSearchSource {
  url: string;
  title: string | null;
}

export interface WebSearchResult {
  ok: boolean;
  text?: string;
  /** Parsed only when a schema was supplied. */
  data?: unknown;
  sources: WebSearchSource[];
  queries: string[];
  error?: string;
  provider: LlmProviderId | "none";
  model: string;
  latencyMs: number;
  usage?: LlmUsage;
  costUsd?: number;
}

export interface EmbeddingResult {
  ok: boolean;
  vectors: number[][];
  provider: LlmProviderId | "none";
  model: string;
  error?: string;
  latencyMs: number;
  costUsd?: number;
}
