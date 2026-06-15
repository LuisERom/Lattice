// Verify Doc 2 criterion 3: a Good rating pushes the next due date out and a
// later Again pulls it in, and stability moves sensibly. Uses an isolated temp
// DB so it never contends with a running dev server.
import { readFileSync, rmSync, existsSync } from "node:fs";
import path from "node:path";
import Database from "better-sqlite3";
import { applySchema } from "../lib/db";
import { ensureDefaultSettings } from "../lib/settings";
import { importMap } from "../lib/import";
import { submitReview } from "../lib/review";
import { Rating, type ReviewStateRow } from "../lib/fsrs";

const TEST_DB = path.join(process.cwd(), "data", "_verify-m2.db");
const cleanup = () => {
  for (const s of ["", "-shm", "-wal"]) if (existsSync(TEST_DB + s)) rmSync(TEST_DB + s);
};
cleanup();
const db = new Database(TEST_DB);
db.pragma("journal_mode = WAL");
db.pragma("foreign_keys = ON");
applySchema(db);
ensureDefaultSettings(db);
const map = JSON.parse(
  readFileSync(path.join(process.cwd(), "data", "seed-topic.json"), "utf8")
);
importMap(map, db);

const firstItem = (db.prepare("SELECT id FROM items ORDER BY id LIMIT 1").get() as { id: number }).id;
const before = db.prepare("SELECT * FROM review_state WHERE item_id=?").get(firstItem) as ReviewStateRow;

const now = new Date("2026-06-13T12:00:00Z");
const good = submitReview({ itemId: firstItem, method: "cloze", rating: Rating.Good, userAnswer: "body" }, db, now);
const afterGood = good.reviewStateAfter;

// Use a second fresh item for the Again comparison.
const secondItem = (db.prepare("SELECT id FROM items WHERE id<>? ORDER BY id LIMIT 1").get(firstItem) as { id: number }).id;
const again = submitReview({ itemId: secondItem, method: "free_recall", rating: Rating.Again, userAnswer: "" }, db, now);
const afterAgain = again.reviewStateAfter;

const goodInterval = new Date(afterGood.due).getTime() - now.getTime();
const againInterval = new Date(afterAgain.due).getTime() - now.getTime();

const stored = db.prepare("SELECT * FROM review_state WHERE item_id=?").get(firstItem) as ReviewStateRow;
const answerStored = (db.prepare("SELECT user_answer FROM reviews WHERE item_id=? ORDER BY id DESC LIMIT 1").get(firstItem) as { user_answer: string }).user_answer;
const mp = db.prepare("SELECT * FROM method_progress WHERE item_id=?").all(firstItem);

console.log("before:        state", before.state, "stability", before.stability, "reps", before.reps, "due", before.due);
console.log("after Good:    state", afterGood.state, "stability", afterGood.stability.toFixed(4), "reps", afterGood.reps, "due", afterGood.due);
console.log("after Again:   state", afterAgain.state, "stability", afterAgain.stability.toFixed(4), "reps", afterAgain.reps, "due", afterAgain.due);
console.log("Good interval (min):", (goodInterval / 60000).toFixed(2));
console.log("Again interval (min):", (againInterval / 60000).toFixed(2));
console.log("persisted matches in-memory:", stored.due === afterGood.due && stored.stability === afterGood.stability);
console.log("typed answer stored:", JSON.stringify(answerStored));
console.log("method_progress row:", JSON.stringify(mp));

const checks: [string, boolean][] = [
  ["Good pushes due out further than Again", goodInterval > againInterval],
  ["Good increases stability from 0", afterGood.stability > 0],
  ["reps incremented", afterGood.reps === 1],
  ["review_state persisted", stored.due === afterGood.due],
  ["typed answer stored", answerStored === "body"],
  ["method_progress created and passed", (mp as { passed: number }[])[0]?.passed === 1],
];
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
