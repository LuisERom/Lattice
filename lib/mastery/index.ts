import type Database from "better-sqlite3";
import { getDb } from "../db";
import { retrievability, rowToCard, type ReviewStateRow } from "../fsrs";
import { getSettings, type Settings } from "../settings";
import {
  type EdgeRow,
  type ItemRow,
  type MethodProgressRow,
  type NodeRow,
  memberNodeIds,
} from "../types";
import {
  countsAsKnown,
  itemStatus,
  itemWeight,
  topicMastery,
  type ItemStatus,
  type MasteryItem,
} from "./compute";

export type { ItemStatus } from "./compute";

export interface ItemState {
  itemId: number;
  kind: ItemRow["kind"];
  memberNodeIds: number[];
  status: ItemStatus;
  R: number;
  weight: number;
  contribution: number;
  isHighCentrality: boolean;
  distinctMethodsPassed: number;
  due: string;
  reviewState: ReviewStateRow;
}

export interface NodeState {
  nodeId: number;
  locked: boolean;
  known: boolean;
  atomicItemId: number | null;
  atomicStatus: ItemStatus | null;
}

export interface TopicState {
  topicId: number;
  mastery: number; // 0..1
  items: Map<number, ItemState>;
  nodes: Map<number, NodeState>;
  counts: Record<ItemStatus, number>;
}

/** v1 has a single topic; return it (or null if none imported yet). */
export function getPrimaryTopicId(db: Database.Database = getDb()): number | null {
  const row = db.prepare("SELECT id FROM topics ORDER BY id LIMIT 1").get() as
    | { id: number }
    | undefined;
  return row?.id ?? null;
}

export function computeTopicState(
  topicId: number,
  db: Database.Database = getDb(),
  now: Date = new Date(),
  settings: Settings = getSettings(db)
): TopicState {
  const nodes = db
    .prepare("SELECT * FROM nodes WHERE topic_id = ?")
    .all(topicId) as NodeRow[];
  const items = db
    .prepare("SELECT * FROM items WHERE topic_id = ?")
    .all(topicId) as ItemRow[];
  const nodeIds = new Set(nodes.map((n) => n.id));
  const edges = (db.prepare("SELECT * FROM edges").all() as EdgeRow[]).filter(
    (e) => nodeIds.has(e.source_node_id) && nodeIds.has(e.target_node_id)
  );

  const nodeById = new Map(nodes.map((n) => [n.id, n]));
  const rsByItem = new Map<number, ReviewStateRow>();
  for (const it of items) {
    rsByItem.set(
      it.id,
      db.prepare("SELECT * FROM review_state WHERE item_id = ?").get(it.id) as
        ReviewStateRow
    );
  }
  const passedByItem = new Map<number, number>();
  for (const it of items) {
    const rows = db
      .prepare("SELECT * FROM method_progress WHERE item_id = ? AND passed = 1")
      .all(it.id) as MethodProgressRow[];
    passedByItem.set(it.id, rows.length);
  }

  // node -> its prerequisite node ids
  const prereqs = new Map<number, number[]>();
  for (const id of nodeIds) prereqs.set(id, []);
  for (const e of edges) {
    if (e.type === "prerequisite_of") {
      prereqs.get(e.target_node_id)!.push(e.source_node_id);
    }
  }

  // atomic item per node (one concept -> one atomic item)
  const atomicItemByNode = new Map<number, ItemRow>();
  for (const it of items) {
    if (it.kind === "atomic") {
      const m = memberNodeIds(it);
      if (m.length === 1) atomicItemByNode.set(m[0], it);
    }
  }

  const maxDifficulty = Math.max(1, ...nodes.map((n) => n.difficulty));

  const R = (itemId: number): number =>
    retrievability(rowToCard(rsByItem.get(itemId)!), now);

  const aggCentrality = (ids: number[]): number =>
    Math.max(0, ...ids.map((id) => nodeById.get(id)?.centrality ?? 0));
  const aggDifficultyNorm = (ids: number[]): number =>
    Math.max(0, ...ids.map((id) => (nodeById.get(id)?.difficulty ?? 0) / maxDifficulty));

  const itemStates = new Map<number, ItemState>();

  const buildItemState = (it: ItemRow, locked: boolean): ItemState => {
    const ids = memberNodeIds(it);
    const r = R(it.id);
    const centralityAgg = aggCentrality(ids);
    const isHigh = centralityAgg >= settings.highCentralityThreshold;
    const distinctMethodsPassed = passedByItem.get(it.id) ?? 0;
    const status = itemStatus({
      locked,
      distinctMethodsPassed,
      R: r,
      isHighCentrality: isHigh,
      settings,
    });
    const weight = itemWeight(it.kind, centralityAgg, aggDifficultyNorm(ids), settings);
    const contribution = countsAsKnown(status) ? r : 0;
    return {
      itemId: it.id,
      kind: it.kind,
      memberNodeIds: ids,
      status,
      R: r,
      weight,
      contribution,
      isHighCentrality: isHigh,
      distinctMethodsPassed,
      due: rsByItem.get(it.id)!.due,
      reviewState: rsByItem.get(it.id)!,
    };
  };

  // --- Pass A: node lock/known + atomic item status, in prerequisite order ---
  const nodeStates = new Map<number, NodeState>();
  const nodeKnown = new Map<number, boolean>();
  const sortedNodes = [...nodes].sort((a, b) => a.difficulty - b.difficulty);

  for (const node of sortedNodes) {
    const ps = prereqs.get(node.id) ?? [];
    const locked = ps.some((p) => !nodeKnown.get(p));
    const atomic = atomicItemByNode.get(node.id);
    let atomicStatus: ItemStatus | null = null;
    if (atomic) {
      const st = buildItemState(atomic, locked);
      itemStates.set(atomic.id, st);
      atomicStatus = st.status;
    }
    const known = atomicStatus ? countsAsKnown(atomicStatus) : false;
    nodeKnown.set(node.id, known);
    nodeStates.set(node.id, {
      nodeId: node.id,
      locked,
      known,
      atomicItemId: atomic?.id ?? null,
      atomicStatus,
    });
  }

  // --- Pass B: multi-node items (connection, composition, integration) ---
  for (const it of items) {
    if (itemStates.has(it.id)) continue; // atomic already handled
    const ids = memberNodeIds(it);
    const locked = ids.some((id) => nodeStates.get(id)?.locked ?? false);
    itemStates.set(it.id, buildItemState(it, locked));
  }

  const masteryItems: MasteryItem[] = [...itemStates.values()].map((s) => ({
    status: s.status,
    R: s.R,
    weight: s.weight,
  }));

  const counts: Record<ItemStatus, number> = {
    locked: 0,
    learning: 0,
    known: 0,
    mastered: 0,
  };
  for (const s of itemStates.values()) counts[s.status]++;

  return {
    topicId,
    mastery: topicMastery(masteryItems),
    items: itemStates,
    nodes: nodeStates,
    counts,
  };
}
