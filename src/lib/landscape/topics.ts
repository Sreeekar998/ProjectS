import { textSimilarity } from "@/lib/text/similarity";
import type { BusinessProfile } from "@/lib/profile/schema";
import { ARCHETYPE_TOPIC_TEMPLATES } from "./topic-templates";

export interface TopicCandidate {
  name: string;
  description: string;
  evidenceIds: string[];
  source: "system" | "template";
}

const MIN_TOPICS = 4;
const MAX_TOPICS = 6;
const CLUSTER_SIMILARITY_THRESHOLD = 0.35;

interface SeedItem {
  label: string;
  evidenceIds: string[];
  /**
   * An offering can NAME a topic; a customer job can only support one.
   *
   * Jobs are harvested from FAQ and support copy, so they arrive as whole
   * questions. Letting one head its own cluster produced topics called "Can i
   * Track Customer Interactions Across Multiple Touchpoint" and "How can
   * Hubspot Help Consumer Services Businesses Manage Cus" — a question, and a
   * question truncated mid-word. A topic is a noun phrase naming an area of
   * the market; a job is evidence that the area matters.
   */
  kind: "offering" | "job";
}

/**
 * Similarity between two offering names, ignoring a head noun they share.
 *
 * Raw string similarity collapses a whole product line into one topic whenever
 * the names share a category word: "Marketing Software", "Sales Software",
 * "Customer Service Software", "CMS Software" and "CRM Software" are ~50%
 * similar to each other purely because of the word "Software", so all five
 * merged into a single topic and the archetype template list had to pad the
 * rest. What distinguishes them is everything EXCEPT the shared head, so that
 * is what gets compared.
 */
function distinguishingSimilarity(a: string, b: string): number {
  const left = a.toLowerCase().trim().split(/\s+/);
  const right = b.toLowerCase().trim().split(/\s+/);
  // Strip the common suffix run ("... software", "... shoes", "... insurance").
  let shared = 0;
  while (
    shared < left.length - 1 &&
    shared < right.length - 1 &&
    left[left.length - 1 - shared] === right[right.length - 1 - shared]
  ) {
    shared += 1;
  }
  if (shared === 0) return textSimilarity(a, b);
  const leftRest = left.slice(0, left.length - shared).join(" ");
  const rightRest = right.slice(0, right.length - shared).join(" ");
  if (!leftRest || !rightRest) return textSimilarity(a, b);
  return textSimilarity(leftRest, rightRest);
}

/** Question-shaped copy, which can never be a topic name. */
const QUESTION_SHAPE = /(\?\s*$)|^(how|what|why|when|where|who|which|can|do|does|is|are|should|will|would|could)\b/i;

function clusterSeeds(seeds: SeedItem[]): Array<{ representative: string; members: SeedItem[] }> {
  const clusters: Array<{ representative: string; members: SeedItem[] }> = [];
  // Offerings first, so every cluster is founded on a nameable concept and a
  // job can only ever attach to one.
  for (const seed of [...seeds].sort((a, b) => (a.kind === b.kind ? 0 : a.kind === "offering" ? -1 : 1))) {
    const existing = clusters.find((c) => distinguishingSimilarity(c.representative, seed.label) >= CLUSTER_SIMILARITY_THRESHOLD);
    if (existing) {
      existing.members.push(seed);
      // Only an offering may rename a cluster, and only to something shorter.
      if (seed.kind === "offering" && !QUESTION_SHAPE.test(seed.label) && seed.label.length < existing.representative.length) {
        existing.representative = seed.label;
      }
      continue;
    }
    // A job that matches no offering is a support question, not a market area.
    if (seed.kind === "job" || QUESTION_SHAPE.test(seed.label)) continue;
    clusters.push({ representative: seed.label, members: [seed] });
  }
  return clusters;
}

function titleCase(s: string): string {
  return s
    .split(" ")
    .map((w) => (w.length > 3 ? w[0]!.toUpperCase() + w.slice(1) : w))
    .join(" ")
    .slice(0, 60);
}

export function discoverTopicCandidates(profile: BusinessProfile): TopicCandidate[] {
  // The site's own service groups ("Hair", "Nails", "Lashes & Brows") are
  // better topic names than clusters of individual service strings.
  const groups = (profile.offerings.groups ?? []).filter((group) => group.name.trim().length > 2 && group.items.length > 0);
  if (groups.length >= MIN_TOPICS) {
    return groups.slice(0, MAX_TOPICS).map((group) => ({
      name: titleCase(group.name.trim()),
      description: `Covers ${group.items.slice(0, 4).join("; ")}`,
      evidenceIds: [...new Set(profile.offerings.items.filter((item) => group.items.includes(item.name)).flatMap((item) => item.evidenceIds))].slice(0, 6),
      source: "system" as const,
    }));
  }
  const seeds: SeedItem[] = [];
  for (const value of profile.offerings.values) seeds.push({ label: value, evidenceIds: profile.offerings.evidenceIds, kind: "offering" });
  for (const value of profile.customerJobs.values) seeds.push({ label: value, evidenceIds: profile.customerJobs.evidenceIds, kind: "job" });

  const clusters = clusterSeeds(seeds)
    .filter((c) => c.representative.trim().length > 2)
    .sort((a, b) => b.members.length - a.members.length);

  const candidates: TopicCandidate[] = clusters.slice(0, MAX_TOPICS).map((c) => ({
    name: titleCase(c.representative),
    // Written for the operator reviewing the topic, not for a log line.
    description: `Covers ${c.members.map((m) => m.label).slice(0, 4).join("; ")}`,
    evidenceIds: [...new Set(c.members.flatMap((m) => m.evidenceIds))].slice(0, 6),
    source: "system" as const,
  }));

  if (candidates.length < MIN_TOPICS) {
    const templates = ARCHETYPE_TOPIC_TEMPLATES[profile.archetype.value] ?? ARCHETYPE_TOPIC_TEMPLATES.other;
    for (const templateName of templates) {
      if (candidates.length >= MIN_TOPICS) break;
      if (candidates.some((c) => textSimilarity(c.name, templateName) > 0.5)) continue;
      candidates.push({ name: templateName, description: "Archetype-standard topic used to reach minimum topic coverage; no direct on-site evidence found yet.", evidenceIds: [], source: "template" });
    }
  }

  return candidates.slice(0, MAX_TOPICS);
}
