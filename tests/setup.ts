import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { beforeAll, afterAll } from "vitest";

let testDir: string;

beforeAll(async () => {
  testDir = fs.mkdtempSync(path.join(os.tmpdir(), "sun-test-"));
  process.env.SUN_DATA_DIR = path.join(testDir, "data");
  process.env.SUN_EVIDENCE_DIR = path.join(testDir, "evidence-store");
  process.env.SUN_PLAYWRIGHT_FALLBACK_ENABLED = "false";
  delete process.env.GEMINI_API_KEY;
  // Tests never reach a paid or quota-bound model or a geocoder, even when the
  // shell exports keys: live AI paths are validated on an isolated server.
  delete process.env.OPENAI_API_KEY;
  delete process.env.GROQ_API_KEY;
  delete process.env.CEREBRAS_API_KEY;
  delete process.env.GOOGLE_MAPS_API_KEY;
  // Collection providers: a test opts in with a fake key and a stubbed fetch,
  // so a shell with real vendor keys never spends a credit.
  delete process.env.BRIGHTDATA_API_TOKEN;
  delete process.env.CLORO_API_KEY;
  delete process.env.DECODO_AUTH_TOKEN;
  delete process.env.OXYLABS_AUTH;
  delete process.env.SUN_ENGINES;
  delete process.env.SUN_PREFERRED_ROUTES;
  // Search Console stays inert unless a test opts in with fake credentials and a
  // stubbed fetch, so a shell with real OAuth env never reaches Google.
  delete process.env.GOOGLE_OAUTH_CLIENT_ID;
  delete process.env.GOOGLE_OAUTH_CLIENT_SECRET;
  delete process.env.GOOGLE_OAUTH_REDIRECT_URI;
  delete process.env.GOOGLE_SEARCH_CONSOLE_SERVICE_ACCOUNT_FILE;
  for (const name of Object.keys(process.env)) {
    if (name.startsWith("SUN_GSC_")) delete process.env[name];
  }

  // Mirrors what `npm run predev` does for a real launch: apply migrations
  // (getDb() does this on first access) and seed route_policies. Without
  // this, every prompt_run in a test DB would default to policy_disabled
  // (route_policies row missing => "enabled" defaults to false) even though
  // production always runs bootstrap before the app starts.
  const { bootstrapInline } = await import("../scripts/bootstrap-inline");
  await bootstrapInline();
});

afterAll(() => {
  if (testDir) fs.rmSync(testDir, { recursive: true, force: true });
});
