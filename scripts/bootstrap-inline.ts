import { eq } from "drizzle-orm";
import { getDb, dataDir, evidenceDir } from "../src/lib/db/client";
import { routePolicies } from "../src/lib/db/schema";
import { ROUTE_POLICY_SEED } from "../src/lib/providers/route-policy-seed";

export async function bootstrapInline(): Promise<void> {
  const db = getDb();
  const now = new Date();

  for (const policy of ROUTE_POLICY_SEED) {
    const mutable = { ...policy, permittedOperations: [...policy.permittedOperations] };
    const existing = await db
      .select({ id: routePolicies.id })
      .from(routePolicies)
      .where(eq(routePolicies.providerExperience, policy.providerExperience))
      .get();
    if (existing) {
      await db
        .update(routePolicies)
        .set({ ...mutable, lastCheckedAt: now })
        .where(eq(routePolicies.providerExperience, policy.providerExperience))
        .run();
    } else {
      await db
        .insert(routePolicies)
        .values({ id: crypto.randomUUID(), ...mutable, lastCheckedAt: now })
        .run();
    }
  }

   
  console.log(`[bootstrap] data dir: ${dataDir()}`);
   
  console.log(`[bootstrap] evidence dir: ${evidenceDir()}`);
   
  console.log(`[bootstrap] gemini api key present: ${Boolean(process.env.GEMINI_API_KEY)}`);
   
  console.log("[bootstrap] migrations applied, route policy seeded.");
}
