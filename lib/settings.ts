import type Database from "better-sqlite3";
import { getDb } from "./db";

// Tunable defaults (Doc 1, Sections 7.1 / 7.3 / 13). These are editable live in
// the dashboard, never laws. Read from the settings table at runtime.
export interface Settings {
  /** R cutoff above which a passed item counts as "known". */
  knownR: number;
  /** R cutoff above which a passed item counts as "mastered". */
  masteredR: number;
  /** Distinct methods that must pass for a normal item to be mastered. */
  masteredMethods: number;
  /** Distinct methods that must pass for a high-centrality item to be mastered. */
  masteredMethodsHighCentrality: number;
  /** Centrality (normalized 0..1) at/above which an item is "high-centrality". */
  highCentralityThreshold: number;
  /** Weight exponent on centrality in topic-mastery weighting. */
  centralityWeight: number;
  /** Weight exponent on difficulty in topic-mastery weighting. */
  difficultyWeight: number;
  /** Multiplier applied to connection/integration item weights (kept modest). */
  connectionWeightFactor: number;
}

export const DEFAULT_SETTINGS: Settings = {
  knownR: 0.7,
  masteredR: 0.9,
  masteredMethods: 2,
  masteredMethodsHighCentrality: 3,
  highCentralityThreshold: 0.66,
  centralityWeight: 1,
  difficultyWeight: 1,
  connectionWeightFactor: 0.5,
};

export function getSettings(db: Database.Database = getDb()): Settings {
  const rows = db
    .prepare("SELECT key, value FROM settings")
    .all() as { key: string; value: string }[];
  const stored: Record<string, number> = {};
  for (const r of rows) {
    const n = Number(r.value);
    if (!Number.isNaN(n)) stored[r.key] = n;
  }
  return { ...DEFAULT_SETTINGS, ...(stored as Partial<Settings>) };
}

export function updateSettings(
  patch: Partial<Settings>,
  db: Database.Database = getDb()
): Settings {
  const stmt = db.prepare(
    "INSERT INTO settings (key, value) VALUES (?, ?) " +
      "ON CONFLICT(key) DO UPDATE SET value = excluded.value"
  );
  const tx = db.transaction((entries: [string, unknown][]) => {
    for (const [k, v] of entries) stmt.run(k, String(v));
  });
  tx(Object.entries(patch));
  return getSettings(db);
}

/** Seed defaults only for keys not already present. */
export function ensureDefaultSettings(db: Database.Database = getDb()): void {
  const stmt = db.prepare(
    "INSERT OR IGNORE INTO settings (key, value) VALUES (?, ?)"
  );
  const tx = db.transaction(() => {
    for (const [k, v] of Object.entries(DEFAULT_SETTINGS)) {
      stmt.run(k, String(v));
    }
  });
  tx();
}
