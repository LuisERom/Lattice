import type Database from "better-sqlite3";
import { getDb } from "../db";
import {
  type Grade,
  type ReviewStateRow,
  cardToRow,
  rate,
  retrievability,
  rowToCard,
} from "../fsrs";
import { State } from "../fsrs";
import type {
  ItemRow,
  Method,
  MethodProgressRow,
  QuestionRow,
} from "../types";
import { computeTopicState, getPrimaryTopicId } from "../mastery";
import { METHODS_BY_KIND, isPass, sampleMethod } from "./methods";

/** An item is due when it is New (never reviewed) or its due date has passed. */
export function isDueByDate(row: ReviewStateRow, now: Date): boolean {
  if (row.state === State.New) return true;
  return new Date(row.due).getTime() <= now.getTime();
}

interface ItemWithState extends ItemRow {
  rs: ReviewStateRow;
}

function loadItemsWithState(db: Database.Database): ItemWithState[] {
  const items = db.prepare("SELECT * FROM items").all() as ItemRow[];
  const getRs = db.prepare("SELECT * FROM review_state WHERE item_id = ?");
  return items.map((it) => ({
    ...it,
    rs: getRs.get(it.id) as ReviewStateRow,
  }));
}

/** Item ids of currently-locked items (any member node gated). */
function lockedItemIds(db: Database.Database, now: Date): Set<number> {
  const topicId = getPrimaryTopicId(db);
  if (topicId === null) return new Set();
  const state = computeTopicState(topicId, db, now);
  const locked = new Set<number>();
  for (const it of state.items.values()) {
    if (it.status === "locked") locked.add(it.itemId);
  }
  return locked;
}

/** Item ids that are currently due and not locked, earliest-due first, New last.
 *  Locked items are never served for review (gating, Doc 7.2). */
export function getDueItemIds(
  db: Database.Database = getDb(),
  now: Date = new Date()
): number[] {
  const locked = lockedItemIds(db, now);
  return loadItemsWithState(db)
    .filter((it) => !locked.has(it.id) && isDueByDate(it.rs, now))
    .sort((a, b) => {
      const aNew = a.rs.state === State.New ? 1 : 0;
      const bNew = b.rs.state === State.New ? 1 : 0;
      if (aNew !== bNew) return aNew - bNew; // overdue before brand-new
      return new Date(a.rs.due).getTime() - new Date(b.rs.due).getTime();
    })
    .map((it) => it.id);
}

export interface ReviewCard {
  item: ItemRow;
  question: QuestionRow;
  method: Method;
  reviewStateBefore: ReviewStateRow;
  retrievabilityBefore: number;
  remainingDue: number;
}

function methodProgressFor(
  db: Database.Database,
  itemId: number
): MethodProgressRow[] {
  return db
    .prepare("SELECT * FROM method_progress WHERE item_id = ?")
    .all(itemId) as MethodProgressRow[];
}

/** Build the next review card: pick the next due item, sample a method that has
 *  a question, and return that question with the pre-review state. */
export function nextReviewCard(
  db: Database.Database = getDb(),
  now: Date = new Date(),
  preferItemId?: number
): ReviewCard | null {
  const dueIds = getDueItemIds(db, now);
  if (dueIds.length === 0) return null;

  const itemId =
    preferItemId && dueIds.includes(preferItemId) ? preferItemId : dueIds[0];

  const item = db.prepare("SELECT * FROM items WHERE id = ?").get(itemId) as
    | ItemRow
    | undefined;
  if (!item) return null;

  const questions = db
    .prepare("SELECT * FROM test_questions WHERE item_id = ?")
    .all(itemId) as QuestionRow[];

  // Methods that both fit the kind and actually have a question authored.
  const authored = new Set(questions.map((q) => q.method));
  const available = METHODS_BY_KIND[item.kind].filter((m) => authored.has(m));
  if (available.length === 0) {
    // No usable question; skip this item to avoid a dead end.
    const next = dueIds.find((id) => id !== itemId);
    return next ? nextReviewCard(db, now, next) : null;
  }

  const method = sampleMethod(available, methodProgressFor(db, itemId));
  const pool = questions.filter((q) => q.method === method);
  const question = pool[Math.floor(Math.random() * pool.length)];

  const rs = db
    .prepare("SELECT * FROM review_state WHERE item_id = ?")
    .get(itemId) as ReviewStateRow;

  return {
    item,
    question,
    method,
    reviewStateBefore: rs,
    retrievabilityBefore: retrievability(rowToCard(rs), now),
    remainingDue: dueIds.length,
  };
}

export interface SubmitReviewInput {
  itemId: number;
  method: Method;
  rating: Grade; // 1 Again, 2 Hard, 3 Good, 4 Easy
  userAnswer: string;
}

export interface SubmitReviewResult {
  reviewStateBefore: ReviewStateRow;
  reviewStateAfter: ReviewStateRow;
  retrievabilityBefore: number;
}

/** Apply a self-rating: advance the ts-fsrs card, log the review (always storing
 *  the typed answer), and update method_progress. */
export function submitReview(
  input: SubmitReviewInput,
  db: Database.Database = getDb(),
  now: Date = new Date()
): SubmitReviewResult {
  const tx = db.transaction((): SubmitReviewResult => {
    const before = db
      .prepare("SELECT * FROM review_state WHERE item_id = ?")
      .get(input.itemId) as ReviewStateRow | undefined;
    if (!before) throw new Error(`No review_state for item ${input.itemId}`);

    const retrievabilityBefore = retrievability(rowToCard(before), now);

    const nextCard = rate(rowToCard(before), input.rating, now);
    const after = cardToRow(nextCard, input.itemId);

    db.prepare(
      "UPDATE review_state SET due=@due, stability=@stability, difficulty=@difficulty, " +
        "elapsed_days=@elapsed_days, scheduled_days=@scheduled_days, learning_steps=@learning_steps, " +
        "reps=@reps, lapses=@lapses, state=@state, last_review=@last_review WHERE item_id=@item_id"
    ).run(after);

    // Always store the user's answer, even when empty (enables AI grading later).
    db.prepare(
      "INSERT INTO reviews (item_id, method, rating, graded_by, user_answer, ai_grade, reviewed_at) " +
        "VALUES (?, ?, ?, 'self', ?, NULL, ?)"
    ).run(
      input.itemId,
      input.method,
      input.rating,
      input.userAnswer ?? "",
      now.toISOString()
    );

    const pass = isPass(input.rating) ? 1 : 0;
    db.prepare(
      "INSERT INTO method_progress (item_id, method, times_correct, last_seen, passed) " +
        "VALUES (?, ?, ?, ?, ?) " +
        "ON CONFLICT(item_id, method) DO UPDATE SET " +
        "times_correct = times_correct + excluded.times_correct, " +
        "last_seen = excluded.last_seen, " +
        "passed = MAX(method_progress.passed, excluded.passed)"
    ).run(input.itemId, input.method, pass, now.toISOString(), pass);

    return {
      reviewStateBefore: before,
      reviewStateAfter: after,
      retrievabilityBefore,
    };
  });

  return tx();
}
