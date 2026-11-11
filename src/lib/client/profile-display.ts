/**
 * Display text for profile values saved in older shapes. One early Nike
 * profile stored `industry.value` as `{ primary, secondary }`; rendering it
 * as a React child crashed the whole Understand page ("Objects are not valid
 * as a React child"). Anything that is not text becomes readable text or "".
 */
export function industryText(value: unknown): string {
  if (typeof value === "string") return value;
  if (!value || typeof value !== "object") return "";
  const record = value as Record<string, unknown>;
  const parts = [record.primary, record.secondary]
    .map((part) => (typeof part === "string" ? part.trim() : ""))
    .filter(Boolean);
  if (parts.length > 0) return parts.join(" › ");
  return typeof record.value === "string" ? record.value : "";
}
