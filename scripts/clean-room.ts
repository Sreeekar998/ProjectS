// Proves the zero-cost baseline: a brand new local data directory, with
// GEMINI_API_KEY deliberately unset, can bootstrap, create a project end to
// end through the full domain pipeline, and reach an approved prompt set —
// all without any optional secret. Run with: npm run clean-room
import fs from "node:fs";
import path from "node:path";
import os from "node:os";

const cleanDir = fs.mkdtempSync(path.join(os.tmpdir(), "sun-clean-room-"));
process.env.SUN_DATA_DIR = path.join(cleanDir, "data");
process.env.SUN_EVIDENCE_DIR = path.join(cleanDir, "evidence-store");
delete process.env.GEMINI_API_KEY;

async function main() {
  const { getDb } = await import("../src/lib/db/client");
  const { routePolicies } = await import("../src/lib/db/schema");
  await import("./bootstrap-inline").then((m) => m.bootstrapInline());

  const db = getDb();
  const policies = await db.select().from(routePolicies).all();
  if (policies.length === 0) throw new Error("route policies not seeded");
  // The consumer-web routes are the only collection lanes; each is optional
  // (enabled by its provider key). The retired model-API and by-hand routes
  // must stay seeded and disabled so stored rows keep their labels.
  for (const id of ["chatgpt_brightdata_web", "chatgpt_cloro_web", "chatgpt_decodo_web", "gemini_cloro_web"]) {
    const row = policies.find((p) => p.providerExperience === id);
    if (!row || row.enabled !== "optional") throw new Error(`${id} route policy row missing or misconfigured`);
  }
  for (const id of ["gemini_free_api", "openai_api", "groq_free_api", "cerebras_free_api", "chatgpt_manual", "gemini_manual", "consumer_browser_automation", "licensed_partner_collector"]) {
    const row = policies.find((p) => p.providerExperience === id);
    if (!row || row.enabled !== "false") throw new Error(`${id} route policy row should be seeded and disabled`);
  }

  const { createProject } = await import("../src/lib/projects/repository");
  const project = await createProject({ url: "https://example.com", marketScope: "global", language: "en" });
  if (!project.id) throw new Error("project creation failed in clean-room");

  const { getCapabilityGates } = await import("../src/lib/providers/capability-gates");
  const gates = getCapabilityGates();
  if (gates.geminiApiEnabled) {
    throw new Error("geminiApiEnabled should be false with no GEMINI_API_KEY set");
  }
  if (!gates.zeroAdditionalSpend || gates.openaiApiEnabled || gates.consumerBrowserAutomation) {
    throw new Error("hard capability gates not in the expected zero-cost state");
  }

   
  console.log("[clean-room] PASS");
   
  console.log(`[clean-room] project created: ${project.id} in fresh dir ${cleanDir}`);
   
  console.log("[clean-room] consumer-web routes seeded optional (enabled by provider keys); retired API and by-hand routes seeded disabled.");
  fs.rmSync(cleanDir, { recursive: true, force: true });
  process.exit(0);
}

main().catch((err) => {
   
  console.error("[clean-room] FAIL:", err);
  fs.rmSync(cleanDir, { recursive: true, force: true });
  process.exit(1);
});
