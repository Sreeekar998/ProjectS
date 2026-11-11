// Idempotent local bootstrap: creates data/evidence directories, applies
// pending SQLite migrations, and seeds route policy rows. Runs automatically
// before `next dev` / `next build` (see package.json `predev`/`build`), and
// can also be run directly via `npm run db:init`.
import { bootstrapInline } from "./bootstrap-inline";

bootstrapInline().catch((err) => {
   
  console.error("[bootstrap] failed:", err);
  process.exit(1);
});
