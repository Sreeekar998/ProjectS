import type { GeoPlace, GeoSuggestion } from "@/lib/geo/types";
import type { MarketScope } from "@/lib/profile/schema";
import type { MarketHintInput } from "@/lib/projects/market-hint";
import type { SearchConsoleStatus } from "@/lib/search-console/types";
import type { CredentialProviderId, CollectionVendor } from "@/lib/providers/catalog";
import type { MeasureResult } from "@/lib/measure/types";
import type { MeasurementComparison } from "@/lib/measure/compare";
import type { HistoryEntry } from "@/lib/measure/snapshots";
import type { ReadinessSummary } from "@/lib/measure/readiness";
import type { RunAnswer } from "@/lib/measure/answers";

export type { CredentialProviderId };

/** Which keys are present, and which collection routes that unlocks. */
export interface CredentialStatusResponse {
  status: Record<CredentialProviderId, boolean>;
  routes: Array<{ id: string; engine: "chatgpt" | "gemini"; vendor: CollectionVendor; keyed: boolean; healthy: boolean; enabled: boolean }>;
  /** Engines the product measures right now (SUN_ENGINES; default ChatGPT only). */
  engines: Array<"chatgpt" | "gemini">;
}

/** `GET /api/projects/[id]/measure`: one measurement with its definitions and its previous comparable run. */
export interface MeasureResponse {
  measure: MeasureResult;
  run: { id: string; createdAt: number; status: string; completedAt: number | null; finalisedBy: string | null; promptSetId: string };
  snapshot: { id: string; computedAt: number } | null;
  previous: { runId: string; createdAt: number; comparison: MeasurementComparison } | null;
  latestApprovedPromptSet: { id: string; version: number; newerThanRun: boolean } | null;
  definitions: Record<string, any>;
  brandColumns: Record<string, { label: string; plain: string; rule: string }>;
  sourceDefinitions: Record<string, string>;
  sourceKindLabels: Record<string, string>;
  opportunityDefinitions: Record<string, { label: string; plain: string; evidenceOf: string; notEvidenceOf: string; nextStep: string }>;
  comparabilityRules: { breaks: string[]; cautions: string[]; deltas: string };
  aggregation: { method: string; description: string };
  sampling: { label: string; samplesPerPromptProvider: number; caveat: string };
  lowN: number;
  readiness: ReadinessSummary | null;
}

export type MeasureHistoryEntry = HistoryEntry;
export type MeasureAnswer = RunAnswer;

export class ApiError extends Error {
  constructor(public status: number, public code: string, message: string) {
    super(message);
  }
}

async function request<T>(url: string, init?: RequestInit): Promise<T> {
  const res = await fetch(url, {
    ...init,
    headers: { "Content-Type": "application/json", ...(init?.headers ?? {}) },
  });
  const body = await res.json().catch(() => ({}));
  if (!res.ok) {
    throw new ApiError(res.status, body?.error?.code ?? "unknown_error", body?.error?.message ?? `Request to ${url} failed with ${res.status}`);
  }
  return body as T;
}

export interface EvidenceRecord {
  id: string;
  url: string;
  pageType: string;
  sourceType: string;
  text: string;
  fieldHint: string | null;
}

export interface IndustryOption {
  id: string;
  sector: string;
  category: string;
  label: string;
}

/** Classification correction accepted by `PATCH /api/projects/[id]/profile`. */
export interface ClassificationEditInput {
  businessType: string;
  industry?: string;
  subIndustry?: string | null;
  kind?: string;
  physicalPresence?: string;
}

/** Location correction accepted by `PATCH /api/projects/[id]/profile`. */
export interface LocationEditInput {
  primary: Partial<Record<"premise" | "street" | "neighborhood" | "district" | "city" | "region" | "country" | "countryCode" | "postalCode" | "formattedAddress" | "provider" | "providerId", string | null>> & {
    lat?: number | null;
    lng?: number | null;
  };
  marketScope?: MarketScope;
  nearbyAreas?: string[];
  countriesServed?: string[];
  /** Where customers are measured: the whole city, or one location's area. */
  marketArea?: { level: "neighborhood" | "district" | "city" | "region" | "country"; name: string } | null;
}

export interface ProfileEditsInput {
  brandName?: string;
  aliases?: string[];
  /** Every website of the business, its own site first. */
  domains?: string[];
  description?: string;
  industryTaxonomyId?: string;
  industryLabel?: string;
  archetype?: string;
  brandIdentity?: string[];
  offerings?: Array<string | { name: string; type?: "product" | "service" | "category" | "solution" }>;
  targetAudience?: string[];
  markets?: Array<string | { name: string; level?: string }>;
  marketScope?: MarketScope;
  classification?: ClassificationEditInput;
  location?: LocationEditInput;
}

/**
 * 202 body of every background-job route (crawl, landscape, prompts).
 * `already_running` means the POST joined a job that was already in flight.
 * `sinceSequence` is the project's last event sequence before the job started,
 * so a page reads only this job's events.
 */
export interface StartJobResponse {
  status: "started" | "already_running";
  sinceSequence: number;
}

export interface GeoSearchParams {
  q: string;
  country?: string | null;
  lat?: number | null;
  lng?: number | null;
  session?: string | null;
}

export const api = {
  /** `market` null or absent = "Detect from my website". The response's `project.market` is the parsed MarketHint (or null). */
  createProject: (input: { url: string; market?: MarketHintInput | null; language?: string }) =>
    request<{ project: any }>("/api/projects", { method: "POST", body: JSON.stringify(input) }),
  /** The project row: the journey chrome shows its website next to the stages. */
  getProject: (id: string) => request<{ project: { id: string; url: string; registrableDomain: string | null; createdAt: number | string } }>(`/api/projects/${id}`),
  /** No body keeps the previous run's Search Console choice; an explicit `enabled` wins. */
  startCrawl: (id: string, body?: { searchConsole?: { enabled: boolean } }) =>
    request<StartJobResponse>(`/api/projects/${id}/crawl`, { method: "POST", ...(body ? { body: JSON.stringify(body) } : {}) }),
  /** `inProgress`: a crawl job for this project is running in the server process right now. */
  getProfile: (id: string) => request<{ profileVersion: any; inProgress?: boolean }>(`/api/projects/${id}/profile`),
  patchProfile: (id: string, body: { action: "confirm" | "edit"; edits?: ProfileEditsInput; confirm?: boolean; confirmedBy?: string }) =>
    request<{ profileVersion: any }>(`/api/projects/${id}/profile`, { method: "PATCH", body: JSON.stringify(body) }),
  getEvidence: (id: string, ids: string[]) =>
    request<{ evidence: EvidenceRecord[]; total: number }>(`/api/projects/${id}/evidence?ids=${encodeURIComponent(ids.join(","))}`),
  /** `strict` keeps only suggestions inside `country`. */
  geoSearch: (params: GeoSearchParams & { strict?: boolean }, init?: { signal?: AbortSignal }) => {
    const search = new URLSearchParams({ q: params.q });
    if (params.country) search.set("country", params.country);
    if (params.strict) search.set("strict", "1");
    if (typeof params.lat === "number" && typeof params.lng === "number") {
      search.set("lat", String(params.lat));
      search.set("lng", String(params.lng));
    }
    if (params.session) search.set("session", params.session);
    return request<{ suggestions: GeoSuggestion[]; provider?: "google" | "openstreetmap" }>(`/api/geo/search?${search.toString()}`, { signal: init?.signal });
  },
  geoPlace: (suggestion: GeoSuggestion, session?: string | null) =>
    request<{ place: GeoPlace }>(`/api/geo/place`, { method: "POST", body: JSON.stringify({ suggestion, session: session ?? null }) }),
  getIndustries: () => request<{ industries: IndustryOption[] }>(`/api/industries`),
  generateLandscape: (id: string) => request<StartJobResponse>(`/api/projects/${id}/landscape/generate`, { method: "POST" }),
  getLandscape: (id: string) => request<{ landscape: any }>(`/api/projects/${id}/landscape`),
  patchLandscape: (id: string, body: Record<string, unknown>) =>
    request<{ landscape: any }>(`/api/projects/${id}/landscape`, { method: "PATCH", body: JSON.stringify(body) }),
  /** `force` starts a new prompt-set version (`?force=1`). */
  generatePrompts: (id: string, opts?: { force?: boolean }) =>
    request<StartJobResponse>(`/api/projects/${id}/prompts/generate${opts?.force ? "?force=1" : ""}`, { method: "POST" }),
  getPrompts: (id: string) => request<{ promptSet: any | null; candidates: any[]; topics?: Array<{ id: string; name: string }>; inProgress?: boolean }>(`/api/projects/${id}/prompts`),
  patchPromptSet: (id: string, body: { candidateEdits?: Array<{ id: string; editedText: string }>; actions?: Array<{ id: string; action: "select" | "deselect" | "reject" | "replace" | "regenerate" }> }) =>
    request<{ promptSet: any; candidates: any[] }>(`/api/prompt-sets/${id}`, { method: "PATCH", body: JSON.stringify(body) }),
  addCustomPrompt: (id: string, body: { text: string; section: string; replacesCandidateId?: string | null }) =>
    request<{ candidateId: string; replacedId: string | null; candidates: any[] }>(`/api/prompt-sets/${id}/custom-prompts`, { method: "POST", body: JSON.stringify(body) }),
  approvePromptSet: (id: string, approvedBy: string) =>
    request<{ promptSet: any }>(`/api/prompt-sets/${id}/approve`, { method: "POST", body: JSON.stringify({ approvedBy }) }),
  getCredentialStatus: () => request<CredentialStatusResponse>(`/api/providers/credentials`),
  saveCredential: (provider: CredentialProviderId, apiKey: string) =>
    request<CredentialStatusResponse>(`/api/providers/credentials`, {
      method: "POST",
      body: JSON.stringify({ provider, apiKey }),
    }),
  deleteCredential: (provider: CredentialProviderId) =>
    request<CredentialStatusResponse>(`/api/providers/credentials?provider=${encodeURIComponent(provider)}`, { method: "DELETE" }),
  runCollection: (collectionRunId: string) =>
    request<{ runner: any }>(`/api/collection-runs/${collectionRunId}/collect`, { method: "POST" }),
  addCollectionRoutes: (collectionRunId: string, providerExperiences: string[], replaces?: string) =>
    request<{ collectionRun: any }>(`/api/collection-runs/${collectionRunId}/routes`, { method: "POST", body: JSON.stringify({ providerExperiences, replaces }) }),
  captureManualObservation: (promptRunId: string, body: Record<string, unknown>) =>
    request<{ providerResponseId: string }>(`/api/prompt-runs/${promptRunId}/manual-capture`, { method: "POST", body: JSON.stringify(body) }),
  createCollectionRun: (id: string, providerExperiences?: string[]) =>
    request<{ collectionRun: any }>(`/api/projects/${id}/collection-runs`, { method: "POST", body: JSON.stringify({ providerExperiences }) }),
  listCollectionRuns: (id: string) => request<{ collectionRuns: any[] }>(`/api/projects/${id}/collection-runs`),
  getCollectionRun: (id: string) =>
    request<{ collectionRun: any; promptRuns: any[]; runner?: any; analysisSummary?: { analysed: number; needsReview: number; missing: number; stale: number }; currentAnalysisVersion?: string }>(`/api/collection-runs/${id}`),
  markOutcome: (id: string, outcome: string, note?: string) =>
    request<{ promptRun: any }>(`/api/prompt-runs/${id}/outcome`, { method: "POST", body: JSON.stringify({ outcome, note }) }),
  getMeasureV2: (id: string, collectionRunId?: string | null) =>
    request<MeasureResponse>(`/api/projects/${id}/measure${collectionRunId ? `?run=${encodeURIComponent(collectionRunId)}` : ""}`),
  getMeasureHistory: (id: string, selectedRunId?: string | null) =>
    request<{ history: MeasureHistoryEntry[] }>(`/api/projects/${id}/measure/history${selectedRunId ? `?run=${encodeURIComponent(selectedRunId)}` : ""}`),
  /** Every collected answer of a run, with highlights and source ownership, for the printable answers report. */
  getMeasureAnswers: (id: string, collectionRunId?: string | null) =>
    request<{ runId: string; answers: MeasureAnswer[] }>(`/api/projects/${id}/measure/answers${collectionRunId ? `?run=${encodeURIComponent(collectionRunId)}` : ""}`),
  /** The export route for a run; fetched by `lib/client/download.ts`, which saves the file and surfaces errors in place. */
  measureExportUrl: (id: string, collectionRunId: string, format: "csv" | "json" | "brands-csv" | "sources-csv") =>
    `/api/projects/${id}/measure/export?run=${encodeURIComponent(collectionRunId)}&format=${format}`,
  finaliseCollectionRun: (collectionRunId: string) =>
    request<{ collectionRun: any }>(`/api/collection-runs/${collectionRunId}/finalise`, { method: "POST" }),
  reanalyseCollectionRun: (collectionRunId: string) =>
    request<{ analysed: number; skipped: number; failed: number; snapshotId: string | null }>(`/api/collection-runs/${collectionRunId}/reanalyse`, { method: "POST" }),
  getObservationEvidence: (responseId: string) =>
    request<{ response: any; promptRun: any; candidate: any; mentions: any[]; citations: any[]; artifacts: any[]; analysis: any | null; entities: Array<{ id: string; canonicalName: string; kind: string; parentEntityId: string | null }> }>(`/api/provider-responses/${responseId}`),
  retryPromptRun: (id: string) => request<{ promptRun: any }>(`/api/prompt-runs/${id}/retry`, { method: "POST" }),
  getSearchConsoleStatus: () => request<{ status: SearchConsoleStatus }>(`/api/integrations/search-console`),
  disconnectSearchConsole: () => request<{ status: SearchConsoleStatus }>(`/api/integrations/search-console/disconnect`, { method: "POST" }),
};
