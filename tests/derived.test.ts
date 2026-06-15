import { test } from "node:test";
import assert from "node:assert/strict";
import {
  computeCentrality,
  computeDifficulty,
  type SimpleEdge,
} from "../lib/import/derived";

// Graph: 1 -> 2 -> 3 (prereq chain) and 1 -> 4.
const nodeIds = [1, 2, 3, 4];
const edges: SimpleEdge[] = [
  { source: 1, target: 2, type: "prerequisite_of" },
  { source: 2, target: 3, type: "prerequisite_of" },
  { source: 1, target: 4, type: "prerequisite_of" },
];

test("difficulty = prerequisite depth", () => {
  const d = computeDifficulty(nodeIds, edges);
  assert.equal(d.get(1), 0);
  assert.equal(d.get(2), 1);
  assert.equal(d.get(3), 2);
  assert.equal(d.get(4), 1);
});

test("centrality = degree normalized to max", () => {
  const c = computeCentrality(nodeIds, edges);
  // degrees: 1->2, 2->2, 3->1, 4->1 ; max=2
  assert.equal(c.get(1), 1);
  assert.equal(c.get(2), 1);
  assert.equal(c.get(3), 0.5);
  assert.equal(c.get(4), 0.5);
});

test("difficulty cycle guard does not loop or inflate", () => {
  const cyc: SimpleEdge[] = [
    { source: 1, target: 2, type: "prerequisite_of" },
    { source: 2, target: 1, type: "prerequisite_of" },
  ];
  const d = computeDifficulty([1, 2], cyc);
  // Must terminate with finite, bounded depths (<= node count), not loop forever.
  assert.ok(Number.isFinite(d.get(1)) && (d.get(1) ?? 0) <= 2);
  assert.ok(Number.isFinite(d.get(2)) && (d.get(2) ?? 0) <= 2);
});

test("non-prerequisite edges do not affect difficulty", () => {
  const mixed: SimpleEdge[] = [
    { source: 1, target: 2, type: "used_in" },
    { source: 2, target: 3, type: "part_of" },
  ];
  const d = computeDifficulty([1, 2, 3], mixed);
  assert.equal(d.get(1), 0);
  assert.equal(d.get(2), 0);
  assert.equal(d.get(3), 0);
});
