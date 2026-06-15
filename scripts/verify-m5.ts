// Verify Doc 2 criteria 7 (what-to-learn-next: never locked, correct order) and
// 8 (live thresholds change known/mastered counts and mastery). Temp DB.
import { readFileSync, existsSync, rmSync } from "node:fs";
import path from "node:path";
import Database from "better-sqlite3";
import { applySchema } from "../lib/db";
import { DEFAULT_SETTINGS, ensureDefaultSettings } from "../lib/settings";
import { importMap } from "../lib/import";
import { submitReview } from "../lib/review";
import { getWhatToLearnNext } from "../lib/sequencing";
import { computeTopicState, getPrimaryTopicId } from "../lib/mastery";
import { Rating } from "../lib/fsrs";

const TEST_DB = path.join(process.cwd(), "data", "_verify-m5.db");
const cleanup = () => {
  for (const s of ["", "-shm", "-wal"]) if (existsSync(TEST_DB + s)) rmSync(TEST_DB + s);
};
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
const t = getPrimaryTopicId(db)!;
const now = new Date("2026-06-13T12:00:00Z");
const checks: [string, boolean][] = [];

// ---------- Criterion 7 ----------
{
  const { due, frontier } = getWhatToLearnNext(db, now);
  const state = computeTopicState(t, db, now, DEFAULT_SETTINGS);

  // No frontier node is locked.
  const anyLockedInFrontier = frontier.some(
    (f) => state.nodes.get(f.nodeId)?.locked
  );
  // Frontier ordered by centrality desc.
  const ordered = frontier.every(
    (f, i) => i === 0 || frontier[i - 1].centrality >= f.centrality
  );
  console.log(
    "frontier (initial):",
    frontier.map((f) => `${f.name}(${f.centrality.toFixed(2)})`).join(", ")
  );
  console.log("due (initial):", due.length);
  checks.push(["C7: frontier never includes a locked node", !anyLockedInFrontier]);
  checks.push(["C7: frontier ordered by centrality desc", ordered]);
  checks.push([
    "C7: only prereq-free concepts are on the initial frontier",
    frontier.every((f) => ["HTTP request/response cycle", "Django Model"].includes(f.name)),
  ]);

  // Learn HTTP so a previously-new item becomes a real due review later, and
  // confirm a deep locked node never appears.
  const validation = frontier.find((f) => f.name === "Serializer validation");
  checks.push(["C7: deep locked node is absent from frontier", validation === undefined]);
}

// ---------- Criterion 8: live thresholds ----------
{
  const atomic = (name: string) =>
    (db.prepare("SELECT id FROM items WHERE kind='atomic' AND member_node_ids = ?").get(
      JSON.stringify([(db.prepare("SELECT id FROM nodes WHERE name=?").get(name) as { id: number }).id])
    ) as { id: number }).id;
  // Two unlocked items mastered across 2 methods.
  for (const name of ["HTTP request/response cycle", "Django Model"]) {
    submitReview({ itemId: atomic(name), method: "cloze", rating: Rating.Good, userAnswer: "x" }, db, now);
    submitReview({ itemId: atomic(name), method: "free_recall", rating: Rating.Good, userAnswer: "x" }, db, now);
  }

  // At review time R~1.0: both mastered. Requiring more methods demotes them.
  const atNow = computeTopicState(t, db, now, DEFAULT_SETTINGS);
  const moreMethods = computeTopicState(t, db, now, {
    ...DEFAULT_SETTINGS,
    masteredMethods: 5,
    masteredMethodsHighCentrality: 5,
  });

  // Later, R has decayed into the 0.7..0.9 band: known under default, but a
  // stricter knownR pushes them back to learning.
  const later = new Date(now.getTime() + 9 * 24 * 3600 * 1000);
  const lenient = computeTopicState(t, db, later, DEFAULT_SETTINGS);
  const strictKnown = computeTopicState(t, db, later, { ...DEFAULT_SETTINGS, knownR: 0.9 });

  const sampleR = lenient.items.get(atomic("HTTP request/response cycle"))!.R;
  console.log("now      counts:", JSON.stringify(atNow.counts), "mastery", (atNow.mastery * 100).toFixed(1) + "%");
  console.log("methods=5:", JSON.stringify(moreMethods.counts), "mastery", (moreMethods.mastery * 100).toFixed(1) + "%");
  console.log(`+9d R~${sampleR.toFixed(3)} default:`, JSON.stringify(lenient.counts), "mastery", (lenient.mastery * 100).toFixed(1) + "%");
  console.log("+9d knownR=.9:", JSON.stringify(strictKnown.counts), "mastery", (strictKnown.mastery * 100).toFixed(1) + "%");

  checks.push([
    "C8: requiring more methods reduces mastered count",
    moreMethods.counts.mastered < atNow.counts.mastered,
  ]);
  checks.push([
    "C8: raising knownR reduces known+mastered count",
    strictKnown.counts.known + strictKnown.counts.mastered <
      lenient.counts.known + lenient.counts.mastered,
  ]);
  checks.push([
    "C8: raising knownR lowers topic mastery",
    strictKnown.mastery < lenient.mastery,
  ]);
}

let ok = true;
console.log("\n--- checks ---");
for (const [name, pass] of checks) {
  console.log(pass ? "PASS" : "FAIL", name);
  if (!pass) ok = false;
}
db.close();
cleanup();
console.log("\nTemp verify DB cleaned up.");
process.exit(ok ? 0 : 1);
