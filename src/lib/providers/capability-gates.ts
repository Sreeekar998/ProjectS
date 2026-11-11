// Hard startup/policy invariants (spec section 2.2). These are read fresh on
// every call (not cached at module load) so tests can toggle GEMINI_API_KEY
// between cases; the values themselves must never vary based on UI state.
import { getCredential } from "./credentials";

export interface CapabilityGates {
  zeroAdditionalSpend: boolean;
  openaiApiEnabled: boolean;
  consumerBrowserAutomation: boolean;
  geminiGroundedSearchAnalytics: boolean;
  geminiApiEnabled: boolean; // true only when GEMINI_API_KEY is present
  groqApiEnabled: boolean; // true only when GROQ_API_KEY is present
  cloudDeploymentEnabled: boolean;
}

export function getCapabilityGates(): CapabilityGates {
  return Object.freeze({
    zeroAdditionalSpend: true,
    openaiApiEnabled: false,
    consumerBrowserAutomation: false,
    geminiGroundedSearchAnalytics: false,
    geminiApiEnabled: Boolean(getCredential("gemini")),
    groqApiEnabled: Boolean(getCredential("groq")),
    cloudDeploymentEnabled: false,
  });
}

export function isGroqApiAvailable(): boolean {
  return getCapabilityGates().groqApiEnabled;
}

export function isGeminiApiAvailable(): boolean {
  return getCapabilityGates().geminiApiEnabled;
}
