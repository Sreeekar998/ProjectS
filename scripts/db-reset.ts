// Deletes the local SQLite database and evidence store, then re-bootstraps.
// Local-only destructive operation, scoped to SUN_DATA_DIR / SUN_EVIDENCE_DIR.
import fs from "node:fs";
import path from "node:path";

const dataDir = process.env.SUN_DATA_DIR ?? "./data";
const evidenceDir = process.env.SUN_EVIDENCE_DIR ?? "./evidence-store";

for (const file of ["sun.db", "sun.db-wal", "sun.db-shm"]) {
  const p = path.join(dataDir, file);
  if (fs.existsSync(p)) fs.rmSync(p);
}
if (fs.existsSync(evidenceDir)) {
  fs.rmSync(evidenceDir, { recursive: true, force: true });
}

 
console.log("[db-reset] local database and evidence store cleared.");
