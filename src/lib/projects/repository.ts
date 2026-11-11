import { eq } from "drizzle-orm";
import { getDb } from "@/lib/db/client";
import { projects } from "@/lib/db/schema";
import { newId } from "@/lib/ids";
import { normalizeUrl } from "@/lib/security/url-safety";
import { getCapabilityGates } from "@/lib/providers/capability-gates";
import { marketHintFromLegacy, serializeMarketHint, type MarketHint } from "@/lib/projects/market-hint";

export interface CreateProjectInput {
  url: string;
  /** The intake "Where are your customers?" answer. `null` = "Detect from my website"; wins over `marketScope` when given. */
  marketHint?: MarketHint | null;
  /** Legacy scripts and tests: an ISO alpha-2 code becomes a country hint; "global" or anything else means no hint. */
  marketScope?: string;
  language: string;
}

export type Project = typeof projects.$inferSelect;

export async function createProject(input: CreateProjectInput): Promise<Project> {
  const { url, registrableDomain } = normalizeUrl(input.url);
  const db = getDb();
  const now = new Date();
  // `market_scope` holds the serialized MarketHint ("auto" for none); see
  // market-hint.ts for the format and why the column was reused.
  const hint = input.marketHint !== undefined ? input.marketHint : marketHintFromLegacy(input.marketScope);
  const row = {
    id: newId("prj"),
    url: url.toString(),
    registrableDomain,
    marketScope: serializeMarketHint(hint),
    language: input.language.trim() || "en",
    status: "created",
    capabilityGates: getCapabilityGates() as unknown as Record<string, boolean>,
    createdAt: now,
    updatedAt: now,
  };
  await db.insert(projects).values(row).run();
  return row as unknown as Project;
}

export async function getProject(id: string): Promise<Project | undefined> {
  const db = getDb();
  return db.select().from(projects).where(eq(projects.id, id)).get();
}

export async function listProjects(): Promise<Project[]> {
  const db = getDb();
  return db.select().from(projects).all();
}
