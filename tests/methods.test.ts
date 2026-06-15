import { test } from "node:test";
import assert from "node:assert/strict";
import { METHODS_BY_KIND, sampleMethod, isPass } from "../lib/review/methods";
import type { Method, MethodProgressRow } from "../lib/types";

function progress(
  partial: Partial<Record<Method, Partial<MethodProgressRow>>>
): MethodProgressRow[] {
  return Object.entries(partial).map(([method, p]) => ({
    item_id: 1,
    method: method as Method,
    times_correct: p?.times_correct ?? 0,
    last_seen: p?.last_seen ?? null,
    passed: p?.passed ?? 0,
  }));
}

const ATOMIC = METHODS_BY_KIND.atomic; // ["cloze", "free_recall", "application"]

test("fresh item with nothing passed/seen starts deterministically", () => {
  const m = sampleMethod(ATOMIC, []);
  assert.equal(ATOMIC.includes(m), true);
});

test("prefers a method not yet passed", () => {
  // cloze passed, others not -> must return a not-yet-passed method.
  const m = sampleMethod(
    ATOMIC,
    progress({ cloze: { passed: 1, last_seen: "2026-01-01T00:00:00.000Z" } })
  );
  assert.notEqual(m, "cloze");
  assert.equal(["free_recall", "application"].includes(m), true);
});

test("mature item (all methods passed) favors the hardest method", () => {
  // All passed with identical recency -> maturity = 1 -> hardness dominates.
  const seen = "2026-01-01T00:00:00.000Z";
  const m = sampleMethod(
    ATOMIC,
    progress({
      cloze: { passed: 1, last_seen: seen },
      free_recall: { passed: 1, last_seen: seen },
      application: { passed: 1, last_seen: seen },
    })
  );
  assert.equal(m, "application");
});

test("fresh, unpassed item rotates to the least-recently-seen method", () => {
  // None passed -> maturity 0 -> pure recency. application seen long ago.
  const m = sampleMethod(
    ATOMIC,
    progress({
      cloze: { last_seen: "2026-02-01T00:00:00.000Z" },
      free_recall: { last_seen: "2026-02-02T00:00:00.000Z" },
      application: { last_seen: "2026-01-01T00:00:00.000Z" },
    })
  );
  assert.equal(m, "application");
});

test("isPass: Again fails, Hard/Good/Easy pass", () => {
  assert.equal(isPass(1), false);
  assert.equal(isPass(2), true);
  assert.equal(isPass(3), true);
  assert.equal(isPass(4), true);
});
