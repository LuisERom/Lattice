import Database from "better-sqlite3";
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";

// Single-file SQLite database for local single-user use. All DB access happens
// in server code only (never in the browser).
export const DB_PATH =
  process.env.LATTICE_DB_PATH ?? path.join(process.cwd(), "data", "lattice.db");

export const SCHEMA_PATH = path.join(process.cwd(), "db", "schema.sql");

let _db: Database.Database | null = null;

export function getDb(): Database.Database {
  if (_db) return _db;
  const db = new Database(DB_PATH);
  db.pragma("journal_mode = WAL");
  db.pragma("foreign_keys = ON");
  _db = db;
  return db;
}

/** Create all tables from db/schema.sql. Idempotent (uses IF NOT EXISTS). */
export function applySchema(db: Database.Database): void {
  if (!existsSync(SCHEMA_PATH)) {
    throw new Error(`Schema file not found at ${SCHEMA_PATH}`);
  }
  const sql = readFileSync(SCHEMA_PATH, "utf8");
  db.exec(sql);
}
