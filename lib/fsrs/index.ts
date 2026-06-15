// The single home of all spaced-repetition logic. Never hand-roll decay math;
// everything routes through ts-fsrs (Invariant 4). An item maps 1:1 to a card.
import {
  createEmptyCard,
  fsrs,
  type Card,
  type Grade,
  Rating,
  State,
} from "ts-fsrs";

export { Rating, State };
export type { Card, Grade };

// One shared scheduler with default (FSRS-6) parameters.
const scheduler = fsrs();

/** Shape of a review_state table row (dates as ISO strings for SQLite). */
export interface ReviewStateRow {
  item_id: number;
  due: string;
  stability: number;
  difficulty: number;
  elapsed_days: number;
  scheduled_days: number;
  learning_steps: number;
  reps: number;
  lapses: number;
  state: number;
  last_review: string | null;
}

export function newCard(now: Date = new Date()): Card {
  return createEmptyCard(now);
}

export function cardToRow(card: Card, itemId: number): ReviewStateRow {
  return {
    item_id: itemId,
    due: toIso(card.due),
    stability: card.stability,
    difficulty: card.difficulty,
    elapsed_days: card.elapsed_days,
    scheduled_days: card.scheduled_days,
    learning_steps: card.learning_steps ?? 0,
    reps: card.reps,
    lapses: card.lapses,
    state: card.state,
    last_review: card.last_review ? toIso(card.last_review) : null,
  };
}

export function rowToCard(row: ReviewStateRow): Card {
  return {
    due: new Date(row.due),
    stability: row.stability,
    difficulty: row.difficulty,
    elapsed_days: row.elapsed_days,
    scheduled_days: row.scheduled_days,
    learning_steps: row.learning_steps,
    reps: row.reps,
    lapses: row.lapses,
    state: row.state as State,
    last_review: row.last_review ? new Date(row.last_review) : undefined,
  };
}

/** Apply a self-rating to a card and return the next card state. */
export function rate(card: Card, rating: Grade, now: Date = new Date()): Card {
  return scheduler.next(card, now, rating).card;
}

/** Probability of recall right now (0..1). Drives "due" and mastery decay. */
export function retrievability(card: Card, now: Date = new Date()): number {
  if (card.state === State.New) return 0;
  return scheduler.get_retrievability(card, now, false) as number;
}

function toIso(d: Date | string): string {
  return typeof d === "string" ? d : d.toISOString();
}
