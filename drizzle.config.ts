import { defineConfig } from "drizzle-kit";

export default defineConfig({
  dialect: "sqlite",
  schema: "./src/lib/db/schema.ts",
  out: "./drizzle",
  dbCredentials: { url: process.env.SUN_DATA_DIR ? `${process.env.SUN_DATA_DIR}/sun.db` : "./data/sun.db" },
});
