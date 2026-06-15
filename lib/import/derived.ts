// Derived node parameters, computed by the app from graph structure after import
// (Invariant 6 — never trusted from the generator). Pure functions so they are
// directly unit-testable (Doc 3, Section 7).

export interface SimpleEdge {
  source: number;
  target: number;
  type: string;
}

/**
 * Difficulty / advancedness = prerequisite depth: how deep in the prerequisite
 * chain a node sits. A node with no prerequisites has depth 0; otherwise it is
 * 1 + the max depth of its prerequisites.
 *
 * A `prerequisite_of` edge means source must be known before target, so source
 * is a prerequisite of target. Cycles (which should not occur) are guarded
 * against and contribute no extra depth.
 */
export function computeDifficulty(
  nodeIds: number[],
  edges: SimpleEdge[]
): Map<number, number> {
  // prereqs.get(x) = nodes that must be known before x
  const prereqs = new Map<number, number[]>();
  for (const id of nodeIds) prereqs.set(id, []);
  for (const e of edges) {
    if (e.type !== "prerequisite_of") continue;
    if (!prereqs.has(e.target)) prereqs.set(e.target, []);
    prereqs.get(e.target)!.push(e.source);
  }

  const depth = new Map<number, number>();
  const visiting = new Set<number>();

  const dfs = (id: number): number => {
    if (depth.has(id)) return depth.get(id)!;
    if (visiting.has(id)) return 0; // cycle guard
    visiting.add(id);
    let best = 0;
    for (const p of prereqs.get(id) ?? []) {
      best = Math.max(best, dfs(p) + 1);
    }
    visiting.delete(id);
    depth.set(id, best);
    return best;
  };

  for (const id of nodeIds) dfs(id);
  return depth;
}

/**
 * Centrality = connectivity (degree), normalized to 0..1 by the maximum degree
 * in the graph so the most connected node is 1.0. Degree counts every edge
 * touching the node, in or out. If there are no edges, all centralities are 0.
 */
export function computeCentrality(
  nodeIds: number[],
  edges: SimpleEdge[]
): Map<number, number> {
  const degree = new Map<number, number>();
  for (const id of nodeIds) degree.set(id, 0);
  for (const e of edges) {
    degree.set(e.source, (degree.get(e.source) ?? 0) + 1);
    degree.set(e.target, (degree.get(e.target) ?? 0) + 1);
  }
  let maxDegree = 0;
  for (const d of degree.values()) maxDegree = Math.max(maxDegree, d);

  const centrality = new Map<number, number>();
  for (const id of nodeIds) {
    centrality.set(id, maxDegree === 0 ? 0 : (degree.get(id) ?? 0) / maxDegree);
  }
  return centrality;
}
