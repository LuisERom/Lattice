import type Database from "better-sqlite3";
import { getDb } from "../db";
import { getSettings } from "../settings";
import { retrievability, rowToCard } from "../fsrs";
import { isDueByDate } from "../review";
import {
  computeTopicState,
  getPrimaryTopicId,
  type ItemState,
  type ItemStatus,
} from "../mastery";
import {
  type EdgeRow,
  type MethodProgressRow,
  type NodeRow,
  type QuestionRow,
  type TopicRow,
} from "../types";

export interface GraphTopicOption {
  id: number;
  name: string;
  scopeLevel: string;
}

export interface GraphNode {
  id: number;
  name: string;
  type: string;
  status: ItemStatus;
  due: boolean;
  centrality: number;
  difficulty: number;
}

export interface GraphEdge {
  id: number;
  source: number;
  target: number;
  type: string;
}

export interface GraphView {
  topicId: number | null;
  topicName: string | null;
  topics: GraphTopicOption[];
  nodes: GraphNode[];
  edges: GraphEdge[];
}

export function listGraphTopics(
  db: Database.Database = getDb()
): GraphTopicOption[] {
  const rows = db
    .prepare(
      "SELECT id, name, scope_level FROM topics ORDER BY created_at DESC, id DESC"
    )
    .all() as Pick<TopicRow, "id" | "name" | "scope_level">[];
  return rows.map((r) => ({
    id: r.id,
    name: r.name,
    scopeLevel: r.scope_level,
  }));
}

const STATUS_RANK: Record<ItemStatus, number> = {
  locked: 0,
  learning: 1,
  known: 2,
  mastered: 3,
};

/** Items that cover a given node. */
function coveringItems(node: NodeRow, items: ItemState[]): ItemState[] {
  return items.filter((i) => i.memberNodeIds.includes(node.id));
}

/** Pick the structural item that best represents a node's status:
 *  the atomic item for a concept, the composition item for a procedure. */
function primaryItem(node: NodeRow, covering: ItemState[]): ItemState | undefined {
  if (node.type === "procedure") {
    return (
      covering.find((i) => i.kind === "composition") ??
      covering.find((i) => i.kind === "integration") ??
      covering[0]
    );
  }
  return (
    covering.find((i) => i.kind === "atomic") ?? covering[0]
  );
}

export function getGraphView(
  db: Database.Database = getDb(),
  now: Date = new Date(),
  topicIdParam?: number | null
): GraphView {
  const topics = listGraphTopics(db);
  let topicId =
    typeof topicIdParam === "number" && Number.isFinite(topicIdParam)
      ? topicIdParam
      : null;
  if (topicId != null && !topics.some((t) => t.id === topicId)) {
    topicId = null;
  }
  if (topicId == null) {
    topicId = getPrimaryTopicId(db);
  }
  if (topicId === null) {
    return { topicId: null, topicName: null, topics, nodes: [], edges: [] };
  }
  const topicName =
    topics.find((t) => t.id === topicId)?.name ??
    (db.prepare("SELECT name FROM topics WHERE id = ?").get(topicId) as
      | { name: string }
      | undefined)?.name ??
    null;

  const settings = getSettings(db);
  const state = computeTopicState(topicId, db, now, settings);
  const items = [...state.items.values()];

  const nodeRows = db
    .prepare("SELECT * FROM nodes WHERE topic_id = ?")
    .all(topicId) as NodeRow[];
  const nodeIds = new Set(nodeRows.map((n) => n.id));

  const nodes: GraphNode[] = nodeRows.map((n) => {
    const covering = coveringItems(n, items);
    const primary = primaryItem(n, covering);
    const status: ItemStatus =
      primary?.status ?? (state.nodes.get(n.id)?.locked ? "locked" : "learning");
    const due = covering.some((i) => isDueByDate(i.reviewState, now));
    return {
      id: n.id,
      name: n.name,
      type: n.type,
      status,
      due,
      centrality: n.centrality,
      difficulty: n.difficulty,
    };
  });

  const edges = (db.prepare("SELECT * FROM edges").all() as EdgeRow[])
    .filter(
      (e) => nodeIds.has(e.source_node_id) && nodeIds.has(e.target_node_id)
    )
    .map((e) => ({
      id: e.id,
      source: e.source_node_id,
      target: e.target_node_id,
      type: e.type,
    }));

  return { topicId, topicName, topics, nodes, edges };
}

export interface NodeEdgeDetail {
  id: number;
  type: string;
  direction: "in" | "out";
  otherId: number;
  otherName: string;
  order_index: number | null;
}

export interface NodeItemDetail {
  itemId: number;
  kind: string;
  status: ItemStatus;
  R: number;
  due: string;
  isDue: boolean;
  distinctMethodsPassed: number;
  reviewState: ItemState["reviewState"];
  methodProgress: MethodProgressRow[];
  methods: string[];
}

export interface NodeDetail {
  id: number;
  name: string;
  type: string;
  description: string;
  difficulty: number;
  centrality: number;
  verification: string;
  grounding_sensitive: boolean;
  locked: boolean;
  known: boolean;
  edges: NodeEdgeDetail[];
  items: NodeItemDetail[];
}

export function getNodeDetail(
  nodeId: number,
  db: Database.Database = getDb(),
  now: Date = new Date()
): NodeDetail | null {
  const node = db.prepare("SELECT * FROM nodes WHERE id = ?").get(nodeId) as
    | NodeRow
    | undefined;
  if (!node) return null;

  const topicId = node.topic_id;
  const settings = getSettings(db);
  const state = computeTopicState(topicId, db, now, settings);
  const nodeState = state.nodes.get(nodeId);

  const edgeRows = db
    .prepare(
      "SELECT * FROM edges WHERE source_node_id = ? OR target_node_id = ?"
    )
    .all(nodeId, nodeId) as EdgeRow[];
  const nameOf = (id: number) =>
    (db.prepare("SELECT name FROM nodes WHERE id = ?").get(id) as
      | { name: string }
      | undefined)?.name ?? `#${id}`;
  const edges: NodeEdgeDetail[] = edgeRows.map((e) => {
    const out = e.source_node_id === nodeId;
    const otherId = out ? e.target_node_id : e.source_node_id;
    return {
      id: e.id,
      type: e.type,
      direction: out ? "out" : "in",
      otherId,
      otherName: nameOf(otherId),
      order_index: e.order_index,
    };
  });

  const covering = [...state.items.values()].filter((i) =>
    i.memberNodeIds.includes(nodeId)
  );
  const items: NodeItemDetail[] = covering.map((i) => {
    const mp = db
      .prepare("SELECT * FROM method_progress WHERE item_id = ?")
      .all(i.itemId) as MethodProgressRow[];
    const methods = (
      db
        .prepare("SELECT DISTINCT method FROM test_questions WHERE item_id = ?")
        .all(i.itemId) as Pick<QuestionRow, "method">[]
    ).map((q) => q.method);
    return {
      itemId: i.itemId,
      kind: i.kind,
      status: i.status,
      R: retrievability(rowToCard(i.reviewState), now),
      due: i.reviewState.due,
      isDue: isDueByDate(i.reviewState, now),
      distinctMethodsPassed: i.distinctMethodsPassed,
      reviewState: i.reviewState,
      methodProgress: mp,
      methods,
    };
  });

  return {
    id: node.id,
    name: node.name,
    type: node.type,
    description: node.description,
    difficulty: node.difficulty,
    centrality: node.centrality,
    verification: node.verification,
    grounding_sensitive: !!node.grounding_sensitive,
    locked: nodeState?.locked ?? false,
    known: nodeState?.known ?? false,
    edges,
    items,
  };
}

export { STATUS_RANK };
