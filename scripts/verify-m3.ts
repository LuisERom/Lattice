// Verify Doc 2 criteria 4 (mastery across distinct methods), 5 (mastery number
// rises then decays), and 6 (prerequisite gating). Uses a dedicated temp DB so
// it never contends with a running dev server.
import { readFileSync, existsSync, rmSync } from "node:fs";
import path from "node:path";
import Database from "better-sqlite3";
import { applySchema } from "../lib/db";
import { DEFAULT_SETTINGS, ensureDefaultSettings } from "../lib/settings";
import { importMap } from "../lib/import";
import { submitReview } from "../lib/review";
import { computeTopicState, getPrimaryTopicId } from "../lib/mastery";
import { Rating } from "../lib/fsrs";

const TEST_DB = path.join(process.cwd(), "data", "_verify-m3.db");

function cleanup() {
  for (const s of ["", "-shm", "-wal"]) if (existsSync(TEST_DB + s)) rmSync(TEST_DB + s);
}

function freshDb(): Database.Database {
  cleanup();
  const db = new Database(TEST_DB);
  db.pragma("journal_mode = WAL");
  db.pragma("foreign_keys = ON");
  applySchema(db);
  ensureDefaultSettings(db);
  importMap(
    JSON.parse(readFileSync(path.join(process.cwd(), "data", "seed-topic.json"), "utf8")),
    db
  );
  return db;
}

const now = new Date("2026-06-13T12:00:00Z");
const settings = DEFAULT_SETTINGS;
const nodeId = (db: Database.Database, name: string) =>
  (db.prepare("SELECT id FROM nodes WHERE name = ?").get(name) as { id: number }).id;
const atomicItem = (db: Database.Database, name: string) =>
  (db
    .prepare("SELECT id FROM items WHERE kind='atomic' AND member_node_ids = ?")
    .get(JSON.stringify([nodeId(db, name)])) as { id: number }).id;

const checks: [string, boolean][] = [];

// ---------- Criterion 6: gating ----------
{
  const db = freshDb();
  const t = getPrimaryTopicId(db)!;
  const validationNode = nodeId(db, "Serializer validation");
  const httpNode = nodeId(db, "HTTP request/response cycle");

  const s0 = computeTopicState(t, db, now, settings);
  const httpLocked = s0.nodes.get(httpNode)!.locked;
  const validationLocked = s0.nodes.get(validationNode)!.locked;
  console.log("gating(initial): HTTP locked?", httpLocked, "| validation locked?", validationLocked);
  checks.push(["C6: depth-0 node (HTTP) NOT locked initially", httpLocked === false]);
  checks.push(["C6: deep node (validation) IS locked initially", validationLocked === true]);

  for (const name of ["Django Model", "QuerySet", "Serializer"]) {
    submitReview({ itemId: atomicItem(db, name), method: "cloze", rating: Rating.Good, userAnswer: "x" }, db, now);
  }
  const s1 = computeTopicState(t, db, now, settings);
  const validationLockedAfter = s1.nodes.get(validationNode)!.locked;
  console.log("gating(after prereqs known): validation locked?", validationLockedAfter);
  checks.push(["C6: deep node unlocks once prerequisites reach known", validationLockedAfter === false]);
  db.close();
}

// ---------- Criterion 4: mastered only across distinct methods ----------
{
  const db = freshDb();
  const t = getPrimaryTopicId(db)!;
  const httpItem = atomicItem(db, "HTTP request/response cycle");

  for (let i = 0; i < 3; i++) {
    submitReview({ itemId: httpItem, method: "cloze", rating: Rating.Good, userAnswer: "x" }, db, now);
  }
  const s1 = computeTopicState(t, db, now, settings).items.get(httpItem)!;
  console.log(`C4: after 3x cloze -> status=${s1.status}, methods=${s1.distinctMethodsPassed}, R=${s1.R.toFixed(3)}`);
  checks.push(["C4: one method repeated does NOT reach mastered", s1.status !== "mastered"]);

  submitReview({ itemId: httpItem, method: "free_recall", rating: Rating.Good, userAnswer: "x" }, db, now);
  const s2 = computeTopicState(t, db, now, settings).items.get(httpItem)!;
  console.log(`C4: after +1 free_recall -> status=${s2.status}, methods=${s2.distinctMethodsPassed}, R=${s2.R.toFixed(3)}`);
  checks.push(["C4: two distinct methods (+R) reaches mastered", s2.status === "mastered"]);
  db.close();
}

// ---------- Criterion 5: mastery rises, then decays when overdue ----------
{
  const db = freshDb();
  const t = getPrimaryTopicId(db)!;
  const m0 = computeTopicState(t, db, now, settings).mastery;
  console.log(`C5: mastery at import = ${(m0 * 100).toFixed(1)}%`);

  for (const name of [
    "HTTP request/response cycle",
    "Django Model",
    "QuerySet",
    "URL routing / dispatch",
    "Response object",
    "APIView",
  ]) {
    const it = atomicItem(db, name);
    submitReview({ itemId: it, method: "cloze", rating: Rating.Good, userAnswer: "x" }, db, now);
    submitReview({ itemId: it, method: "free_recall", rating: Rating.Good, userAnswer: "x" }, db, now);
  }
  const mLearned = computeTopicState(t, db, now, settings).mastery;
  console.log(`C5: mastery after learning 6 items = ${(mLearned * 100).toFixed(1)}%`);

  const later = new Date(now.getTime() + 90 * 24 * 3600 * 1000);
  const mDecayed = computeTopicState(t, db, later, settings).mastery;
  console.log(`C5: mastery after +90 days (no review) = ${(mDecayed * 100).toFixed(1)}%`);

  checks.push(["C5: mastery starts at 0", m0 === 0]);
  checks.push(["C5: mastery rises after learning", mLearned > m0]);
  checks.push(["C5: mastery decays when items go overdue", mDecayed < mLearned]);
  db.close();
}

let ok = true;
console.log("\n--- checks ---");
for (const [name, pass] of checks) {
  console.log(pass ? "PASS" : "FAIL", name);
  if (!pass) ok = false;
}

cleanup();
console.log("\nTemp verify DB cleaned up.");
process.exit(ok ? 0 : 1);
