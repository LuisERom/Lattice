import { test } from "node:test";
import assert from "node:assert/strict";
import { DEFAULT_SETTINGS } from "../lib/settings";
import {
  itemStatus,
  itemWeight,
  topicMastery,
  type MasteryItem,
} from "../lib/mastery/compute";

const S = DEFAULT_SETTINGS; // knownR 0.7, masteredR 0.9, methods 2 / 3

test("locked dominates everything", () => {
  assert.equal(
    itemStatus({ locked: true, distinctMethodsPassed: 5, R: 0.99, isHighCentrality: true, settings: S }),
    "locked"
  );
});

test("never passed is learning even with high R", () => {
  assert.equal(
    itemStatus({ locked: false, distinctMethodsPassed: 0, R: 0.95, isHighCentrality: false, settings: S }),
    "learning"
  );
});

test("passed once with R above knownR is known", () => {
  assert.equal(
    itemStatus({ locked: false, distinctMethodsPassed: 1, R: 0.8, isHighCentrality: false, settings: S }),
    "known"
  );
});

test("2 distinct methods + R above masteredR is mastered", () => {
  assert.equal(
    itemStatus({ locked: false, distinctMethodsPassed: 2, R: 0.95, isHighCentrality: false, settings: S }),
    "mastered"
  );
});

test("2 methods but R below masteredR stays known", () => {
  assert.equal(
    itemStatus({ locked: false, distinctMethodsPassed: 2, R: 0.85, isHighCentrality: false, settings: S }),
    "known"
  );
});

test("high-centrality needs 3 methods to master", () => {
  assert.equal(
    itemStatus({ locked: false, distinctMethodsPassed: 2, R: 0.95, isHighCentrality: true, settings: S }),
    "known"
  );
  assert.equal(
    itemStatus({ locked: false, distinctMethodsPassed: 3, R: 0.95, isHighCentrality: true, settings: S }),
    "mastered"
  );
});

test("passed before but decayed below knownR falls back to learning", () => {
  assert.equal(
    itemStatus({ locked: false, distinctMethodsPassed: 2, R: 0.5, isHighCentrality: false, settings: S }),
    "learning"
  );
});

test("connection items are weighted down by the factor", () => {
  const atomic = itemWeight("atomic", 0.5, 0.5, S);
  const connection = itemWeight("connection", 0.5, 0.5, S);
  assert.equal(connection, atomic * S.connectionWeightFactor);
});

test("topic mastery is the weighted average of contributions", () => {
  const items: MasteryItem[] = [
    { status: "mastered", R: 0.9, weight: 2 }, // contributes 0.9
    { status: "known", R: 0.8, weight: 1 }, // contributes 0.8
    { status: "learning", R: 0.95, weight: 1 }, // contributes 0
    { status: "locked", R: 0.0, weight: 1 }, // contributes 0
  ];
  // (2*0.9 + 1*0.8 + 0 + 0) / (2+1+1+1) = 2.6 / 5 = 0.52
  assert.ok(Math.abs(topicMastery(items) - 0.52) < 1e-9);
});

test("empty topic mastery is 0, not NaN", () => {
  assert.equal(topicMastery([]), 0);
});

test("thresholds are honored from settings (live-tunable)", () => {
  const strict = { ...S, knownR: 0.95 };
  assert.equal(
    itemStatus({ locked: false, distinctMethodsPassed: 1, R: 0.8, isHighCentrality: false, settings: strict }),
    "learning" // 0.8 < 0.95 now
  );
});
