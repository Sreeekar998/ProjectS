// Local, dependency-free "semantic-ish" similarity: word-shingle Jaccard
// overlap plus a token-multiset cosine score. No embeddings API is required
// (the app must fully function with GEMINI_API_KEY unset), and this is
// deterministic, which matters for reproducible prompt-set tests.
import crypto from "node:crypto";

const STOPWORDS = new Set([
  "a", "an", "the", "and", "or", "of", "to", "in", "for", "on", "with", "is", "are",
  "what", "which", "who", "how", "do", "does", "i", "my", "me", "you", "your", "it",
  "this", "that", "be", "can", "should", "would", "at", "as", "by", "from", "about",
]);

export function normalizeForSimilarity(text: string): string {
  return text
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/[^a-z0-9\s]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

export function tokenize(text: string, dropStopwords = true): string[] {
  const normalized = normalizeForSimilarity(text);
  const tokens = normalized.split(" ").filter(Boolean);
  return dropStopwords ? tokens.filter((t) => !STOPWORDS.has(t)) : tokens;
}

export function shingles(text: string, n = 3): Set<string> {
  const tokens = tokenize(text, false);
  const result = new Set<string>();
  if (tokens.length < n) {
    if (tokens.length > 0) result.add(tokens.join(" "));
    return result;
  }
  for (let i = 0; i <= tokens.length - n; i++) {
    result.add(tokens.slice(i, i + n).join(" "));
  }
  return result;
}

export function jaccardSimilarity(a: Set<string>, b: Set<string>): number {
  if (a.size === 0 && b.size === 0) return 1;
  let intersection = 0;
  for (const item of a) if (b.has(item)) intersection++;
  const union = a.size + b.size - intersection;
  return union === 0 ? 0 : intersection / union;
}

export function bagOfWordsCosine(a: string, b: string): number {
  const tokensA = tokenize(a);
  const tokensB = tokenize(b);
  const counts = (tokens: string[]) => {
    const m = new Map<string, number>();
    for (const t of tokens) m.set(t, (m.get(t) ?? 0) + 1);
    return m;
  };
  const ca = counts(tokensA);
  const cb = counts(tokensB);
  let dot = 0;
  for (const [term, count] of ca) dot += count * (cb.get(term) ?? 0);
  const magA = Math.sqrt([...ca.values()].reduce((s, v) => s + v * v, 0));
  const magB = Math.sqrt([...cb.values()].reduce((s, v) => s + v * v, 0));
  if (magA === 0 || magB === 0) return 0;
  return dot / (magA * magB);
}

/** Combined similarity used for near-duplicate gates: text is judged similar
 * if EITHER the shingle overlap or the bag-of-words cosine crosses the bar,
 * since short buyer-question prompts don't always share long shingles. */
export function textSimilarity(a: string, b: string): number {
  const shingleSim = jaccardSimilarity(shingles(a, 3), shingles(b, 3));
  const cosineSim = bagOfWordsCosine(a, b);
  return Math.max(shingleSim, cosineSim);
}

export function sha256Hex(text: string): string {
  return crypto.createHash("sha256").update(text).digest("hex");
}
