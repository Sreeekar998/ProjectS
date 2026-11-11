import fs from "node:fs";
import path from "node:path";
import Database from "better-sqlite3";
import { drizzle, type BetterSQLite3Database } from "drizzle-orm/better-sqlite3";
import { migrate } from "drizzle-orm/better-sqlite3/migrator";
import * as schema from "./schema";

export function dataDir(): string {
  return process.env.SUN_DATA_DIR ?? "./data";
}

export function evidenceDir(): string {
  return process.env.SUN_EVIDENCE_DIR ?? "./evidence-store";
}

function ensureDirs() {
  for (const dir of [dataDir(), evidenceDir()]) {
    fs.mkdirSync(dir, { recursive: true });
  }
}

type DB = BetterSQLite3Database<typeof schema>;

declare global {
   
  var __sunDb: DB | undefined;
   
  var __sunSqlite: Database.Database | undefined;
}

function createConnection(): DB {
  ensureDirs();
  const dbPath = path.join(dataDir(), "sun.db");
  const sqlite = new Database(dbPath);
  sqlite.pragma("journal_mode = WAL");
  sqlite.pragma("foreign_keys = ON");
  sqlite.pragma("busy_timeout = 5000");
  globalThis.__sunSqlite = sqlite;
  const db = drizzle(sqlite, { schema });
  const migrationsFolder = path.join(process.cwd(), "drizzle");
  if (fs.existsSync(migrationsFolder)) {
    migrate(db, { migrationsFolder });
  }
  return db;
}

// Cached on globalThis so Next.js dev-mode hot reload does not reopen the
// SQLite file (and re-run migrations) on every module re-evaluation.
export function getDb(): DB {
  if (!globalThis.__sunDb) {
    globalThis.__sunDb = createConnection();
  }
  return globalThis.__sunDb;
}

export function getRawSqlite(): Database.Database {
  getDb();
  if (!globalThis.__sunSqlite) throw new Error("sqlite connection not initialized");
  return globalThis.__sunSqlite;
}
