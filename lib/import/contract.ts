// The generation output contract (Doc 3, Section 4). Both the hand-authored seed
// and the Python generator emit this shape. The importer maps local `ref`
// strings to database ids.
//
// Note: edges may carry an optional `ref` so that connection items can point at
// a specific edge via `edge_ref`. This is an additive extension of the Doc 3
// example (which omitted it) and changes nothing else.

export type NodeType = "concept" | "procedure";

export type EdgeType =
  | "prerequisite_of"
  | "part_of"
  | "used_in"
  | "causes"
  | "contrasts_with"
  | "analogous_to";

export type ItemKind = "atomic" | "connection" | "composition" | "integration";

export type Method =
  | "cloze"
  | "free_recall"
  | "application"
  | "relational"
  | "recognition";

export interface ContractTopic {
  name: string;
  scope_description: string;
  scope_level: string;
}

export interface ContractNode {
  ref: string;
  type: NodeType;
  name: string;
  description: string;
  grounding_sensitive?: boolean;
}

export interface ContractEdge {
  ref?: string;
  source_ref: string;
  target_ref: string;
  type: EdgeType;
  order_index?: number | null;
}

export interface ContractQuestion {
  method: Method;
  prompt: string;
  expected_answer: string;
  options?: string[] | null;
}

export interface ContractItem {
  ref: string;
  kind: ItemKind;
  member_node_refs: string[];
  edge_ref?: string | null;
  ordering?: string[] | number[] | null;
  questions: ContractQuestion[];
}

export interface ContractMap {
  topic: ContractTopic;
  nodes: ContractNode[];
  edges: ContractEdge[];
  items: ContractItem[];
}
