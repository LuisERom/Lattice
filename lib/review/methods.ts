// Which test methods are available per item kind (Doc 2, Section 4), and how a
// single method is sampled when an item comes due (Doc 1, Section 5.1). Pure so
// it is unit-testable. MCQ/recognition is deferred in v1.
import type { ItemKind, Method, MethodProgressRow } from "../types";

export const METHODS_BY_KIND: Record<ItemKind, Method[]> = {
  atomic: ["cloze", "free_recall", "application"],
  connection: ["relational", "free_recall"],
  composition: ["relational", "free_recall", "application"],
  // Integration is deferred in v1; defined for forward-compatibility only.
  integration: ["relational", "free_recall"],
};

// Rough hardness order. Its weight in method selection grows with item maturity
// so harder methods are favored as an item is mastered (Doc 1 Section 5.1).
// Lower = easier.
const HARDNESS: Record<Method, number> = {
  recognition: 0,
  cloze: 1,
  free_recall: 2,
  relational: 3,
  application: 4,
};

/**
 * Sample one method for a due item (Doc 1 Section 5.1):
 * - Methods rotate, so you prove the unit from different angles.
 * - Methods not yet passed are preferred, to drive the item toward
 *   mastered-across-distinct-methods.
 * - Harder methods are weighted up as the item's mastery grows: selection blends
 *   least-recently-seen rotation with hardness, where hardness' influence scales
 *   with the item's maturity (fraction of available methods already passed). A
 *   fresh item rotates by recency; a mature item favors its harder methods.
 *
 * `available` should be the methods that actually have a question for the item.
 */
export function sampleMethod(
  available: Method[],
  progress: MethodProgressRow[]
): Method {
  if (available.length === 0) {
    throw new Error("No available methods for item");
  }
  const byMethod = new Map<Method, MethodProgressRow>();
  for (const p of progress) byMethod.set(p.method, p);

  // Prefer methods not yet passed so the item can reach the distinct-method bar.
  const notPassed = available.filter((m) => !byMethod.get(m)?.passed);
  const pool = notPassed.length > 0 ? notPassed : available;

  // Maturity rises as more methods are passed (0 = none, 1 = all).
  const passedCount = available.filter((m) => byMethod.get(m)?.passed).length;
  const maturity = passedCount / available.length;

  // Recency rotation: oldest (or never-seen) scores highest.
  const seenAt = (m: Method): number => {
    const ls = byMethod.get(m)?.last_seen;
    return ls ? new Date(ls).getTime() : 0;
  };
  const bySeen = [...pool].sort((a, b) => seenAt(a) - seenAt(b));
  const denom = Math.max(1, pool.length - 1);
  const recencyScore = new Map<Method, number>();
  bySeen.forEach((m, i) => recencyScore.set(m, (pool.length - 1 - i) / denom));

  const maxHardness = Math.max(...pool.map((m) => HARDNESS[m])) || 1;
  const score = (m: Method): number =>
    (1 - maturity) * (recencyScore.get(m) ?? 0) +
    maturity * (HARDNESS[m] / maxHardness);

  return [...pool].sort((a, b) => {
    const d = score(b) - score(a);
    if (d !== 0) return d;
    return HARDNESS[b] - HARDNESS[a]; // prefer harder on exact ties
  })[0];
}

/** A self-rating counts as a recall success unless it was "Again" (1). */
export function isPass(rating: number): boolean {
  return rating >= 2;
}
