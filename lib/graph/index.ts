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
} from "../types";

export interface GraphTopic {
  id: number;
  name: string;
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

/** A cross-topic edge as seen from the currently viewed topic. */
export interface GraphBridge {
  edgeId: number;
  edgeType: string;
  localNodeId: number;
  /** Direction relative to the local node. */
  direction: "in" | "out";
  remoteNodeId: number;
  remoteNodeName: string;
  remoteTopicId: number;
  remoteTopicName: string;
}

export interface GraphView {
  topics: GraphTopic[];
  topicId: number | null;
  topicName: string | null;
  nodes: GraphNode[];
  edges: GraphEdge[];
  bridges: GraphBridge[];
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

export function listTopics(db: Database.Database = getDb()): GraphTopic[] {
  return (
    db.prepare("SELECT id, name FROM topics ORDER BY id").all() as {
      id: number;
      name: string;
    }[]
  ).map((t) => ({ id: t.id, name: t.name }));
}

export function getGraphView(
  db: Database.Database = getDb(),
  now: Date = new Date(),
  topicId: number | null = getPrimaryTopicId(db)
): GraphView {
  const topics = listTopics(db);
  if (topicId === null || topics.length === 0) {
    return {
      topics,
      topicId: null,
      topicName: null,
      nodes: [],
      edges: [],
      bridges: [],
    };
  }

  // Fall back to primary if the requested topic was deleted.
  if (!topics.some((t) => t.id === topicId)) {
    topicId = topics[0]!.id;
  }

  const topicName = topics.find((t) => t.id === topicId)?.name ?? null;

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

  const allEdges = db.prepare("SELECT * FROM edges").all() as EdgeRow[];
  const topicByNodeId = new Map<number, number>();
  const nameByNodeId = new Map<number, string>();
  const nameByTopicId = new Map(topics.map((t) => [t.id, t.name]));
  for (const row of db
    .prepare("SELECT id, topic_id, name FROM nodes")
    .all() as Pick<NodeRow, "id" | "topic_id" | "name">[]) {
    topicByNodeId.set(row.id, row.topic_id);
    nameByNodeId.set(row.id, row.name);
  }

  const edges: GraphEdge[] = [];
  const bridges: GraphBridge[] = [];

  for (const e of allEdges) {
    const srcIn = nodeIds.has(e.source_node_id);
    const tgtIn = nodeIds.has(e.target_node_id);
    if (srcIn && tgtIn) {
      edges.push({
        id: e.id,
        source: e.source_node_id,
        target: e.target_node_id,
        type: e.type,
      });
      continue;
    }
    if (!srcIn && !tgtIn) continue;

    // Exactly one endpoint is in this topic → cross-topic bridge.
    const localNodeId = srcIn ? e.source_node_id : e.target_node_id;
    const remoteNodeId = srcIn ? e.target_node_id : e.source_node_id;
    const remoteTopicId = topicByNodeId.get(remoteNodeId);
    if (remoteTopicId == null || remoteTopicId === topicId) continue;

    bridges.push({
      edgeId: e.id,
      edgeType: e.type,
      localNodeId,
      direction: srcIn ? "out" : "in",
      remoteNodeId,
      remoteNodeName: nameByNodeId.get(remoteNodeId) ?? `#${remoteNodeId}`,
      remoteTopicId,
      remoteTopicName: nameByTopicId.get(remoteTopicId) ?? `Topic ${remoteTopicId}`,
    });
  }

  return { topics, topicId, topicName, nodes, edges, bridges };
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

export interface NodeSourceDetail {
  sourceId: number;
  url: string;
  title: string;
  publisher: string;
  retrievedAt: string;
  quote: string;
  support: string;
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
  sources: NodeSourceDetail[];
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
  const sourceRows = db
    .prepare(
      "SELECT s.id, s.url, s.title, s.publisher, s.retrieved_at, s.quote, ns.support " +
        "FROM node_sources ns JOIN sources s ON s.id = ns.source_id " +
        "WHERE ns.node_id = ? ORDER BY s.retrieved_at DESC, s.id DESC"
    )
    .all(nodeId) as {
    id: number;
    url: string;
    title: string;
    publisher: string;
    retrieved_at: string;
    quote: string;
    support: string;
  }[];
  const sources: NodeSourceDetail[] = sourceRows.map((r) => ({
    sourceId: r.id,
    url: r.url,
    title: r.title,
    publisher: r.publisher,
    retrievedAt: r.retrieved_at,
    quote: r.quote,
    support: r.support,
  }));
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
    sources,
    edges,
    items,
  };
}

export { STATUS_RANK };
