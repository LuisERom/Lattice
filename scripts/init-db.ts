// One-shot database creation from db/schema.sql.
//   npm run db:init     create the DB if missing, apply schema, seed settings
//   npm run db:reset    delete the existing DB file first, then recreate
import { existsSync, mkdirSync, rmSync } from "node:fs";
import path from "node:path";
import Database from "better-sqlite3";
import { DB_PATH, applySchema } from "../lib/db";
import { ensureDefaultSettings } from "../lib/settings";

const reset = process.argv.includes("--reset");

const dataDir = path.dirname(DB_PATH);
if (!existsSync(dataDir)) mkdirSync(dataDir, { recursive: true });

if (reset && existsSync(DB_PATH)) {
  for (const suffix of ["", "-shm", "-wal"]) {
    const f = DB_PATH + suffix;
    if (existsSync(f)) rmSync(f);
  }
  console.log(`Removed existing database at ${DB_PATH}`);
}

const db = new Database(DB_PATH);
db.pragma("journal_mode = WAL");
db.pragma("foreign_keys = ON");
applySchema(db);
ensureDefaultSettings(db);

const tables = db
  .prepare(
    "SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%' ORDER BY name"
  )
  .all() as { name: string }[];

console.log(`Database ready at ${DB_PATH}`);
console.log(`Tables (${tables.length}): ${tables.map((t) => t.name).join(", ")}`);
db.close();
