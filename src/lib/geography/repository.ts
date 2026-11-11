import { eq } from "drizzle-orm";
import { getDb } from "@/lib/db/client";
import { locations } from "@/lib/db/schema";

export type Location = typeof locations.$inferSelect;

export async function listLocations(projectId: string): Promise<Location[]> {
  const db = getDb();
  return db.select().from(locations).where(eq(locations.projectId, projectId)).all();
}
