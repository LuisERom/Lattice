// Shared row shapes mirroring the SQLite schema.
import type { ItemKind, Method, NodeType } from "./import/contract";

export type { ItemKind, Method, NodeType };

export interface TopicRow {
  id: number;
  name: string;
  scope_description: string;
  scope_level: string;
  status: string;
  created_at: string;
}

export interface NodeRow {
  id: number;
  topic_id: number;
  type: NodeType;
  name: string;
  description: string;
  difficulty: number;
  centrality: number;
  verification: string;
  grounding_sensitive: number;
  created_at: string;
}

export interface EdgeRow {
  id: number;
  source_node_id: number;
  target_node_id: number;
  type: string;
  order_index: number | null;
  is_cross_topic: number;
  created_at: string;
}

export interface ItemRow {
  id: number;
  kind: ItemKind;
  topic_id: number;
  member_node_ids: string; // json array
  edge_id: number | null;
  ordering: string | null; // json
  created_at: string;
}

export interface QuestionRow {
  id: number;
  item_id: number;
  method: Method;
  prompt: string;
  expected_answer: string;
  options: string | null;
  verification: string;
  grounding_sensitive: number;
  created_at: string;
}

export interface MethodProgressRow {
  item_id: number;
  method: Method;
  times_correct: number;
  last_seen: string | null;
  passed: number;
}

export function memberNodeIds(item: ItemRow): number[] {
  return JSON.parse(item.member_node_ids) as number[];
}
