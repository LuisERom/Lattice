import type Database from "better-sqlite3";
import { getDb } from "../db";
import { State } from "../fsrs";
import { computeTopicState, getPrimaryTopicId } from "../mastery";
import { memberNodeIds, type ItemRow, type NodeRow } from "../types";

export interface DueEntry {
  itemId: number;
  kind: string;
  status: string;
  nodeNames: string[];
  due: string;
}

export interface FrontierEntry {
  nodeId: number;
  name: string;
  type: string;
  centrality: number;
  difficulty: number;
}

export interface WhatToLearnNext {
  due: DueEntry[];
  frontier: FrontierEntry[];
}

/**
 * Doc 8 sequencing: due reviews first (previously learned items whose R has
 * dropped), then the frontier (unlearned concepts whose prerequisites are all
 * known, ordered by centrality). Locked items/nodes are never suggested.
 */
export function getWhatToLearnNext(
  db: Database.Database = getDb(),
  now: Date = new Date()
): WhatToLearnNext {
  const topicId = getPrimaryTopicId(db);
  if (topicId === null) return { due: [], frontier: [] };

  const state = computeTopicState(topicId, db, now);
  const nodes = db
    .prepare("SELECT * FROM nodes WHERE topic_id = ?")
    .all(topicId) as NodeRow[];
  const nodeById = new Map(nodes.map((n) => [n.id, n]));
  const items = db
    .prepare("SELECT * FROM items WHERE topic_id = ?")
    .all(topicId) as ItemRow[];
  const itemById = new Map(items.map((it) => [it.id, it]));

  const nameOf = (id: number) => nodeById.get(id)?.name ?? `#${id}`;

  // Due reviews: not locked, already reviewed at least once (not New), and due.
  const due: DueEntry[] = [...state.items.values()]
    .filter(
      (s) =>
        s.status !== "locked" &&
        s.reviewState.state !== State.New &&
        new Date(s.reviewState.due).getTime() <= now.getTime()
    )
    .sort(
      (a, b) =>
        new Date(a.reviewState.due).getTime() -
        new Date(b.reviewState.due).getTime()
    )
    .map((s) => {
      const item = itemById.get(s.itemId)!;
      return {
        itemId: s.itemId,
        kind: s.kind,
        status: s.status,
        nodeNames: memberNodeIds(item).map(nameOf),
        due: s.reviewState.due,
      };
    });

  // Frontier (Doc 8): unlocked concept nodes that aren't known yet and whose
  // prerequisites are all satisfied (unlocked => prereqs met), ordered by
  // centrality. "Unlearned" covers both never-reviewed (New) and in-progress
  // items; items already surfaced in the due list above are excluded so a node
  // never appears in both lists.
  const frontier: FrontierEntry[] = nodes
    .filter((n) => n.type === "concept")
    .filter((n) => {
      const ns = state.nodes.get(n.id);
      if (!ns || ns.locked || ns.known) return false;
      const atomicId = ns.atomicItemId;
      if (atomicId == null) return false;
      const itemState = state.items.get(atomicId);
      if (!itemState) return false;
      const isDue =
        itemState.reviewState.state !== State.New &&
        new Date(itemState.reviewState.due).getTime() <= now.getTime();
      return !isDue;
    })
    .sort((a, b) => b.centrality - a.centrality)
    .map((n) => ({
      nodeId: n.id,
      name: n.name,
      type: n.type,
      centrality: n.centrality,
      difficulty: n.difficulty,
    }));

  return { due, frontier };
}
