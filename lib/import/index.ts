import type Database from "better-sqlite3";
import { getDb } from "../db";
import { cardToRow, newCard } from "../fsrs";
import { computeCentrality, computeDifficulty, type SimpleEdge } from "./derived";
import type { ContractMap } from "./contract";

export interface ImportResult {
  topicId: number;
  counts: {
    nodes: number;
    edges: number;
    items: number;
    questions: number;
    reviewStates: number;
  };
}

/**
 * Import a generation contract map into SQLite. Inserts topic, nodes, edges,
 * items, and questions; computes difficulty + centrality from graph structure;
 * and creates one ts-fsrs "new" review_state per item. Runs in a single
 * transaction. method_progress rows are created lazily on first review.
 */
export function importMap(
  map: ContractMap,
  db: Database.Database = getDb()
): ImportResult {
  const run = db.transaction((): ImportResult => {
    const now = new Date();

    const topicId = db
      .prepare(
        "INSERT INTO topics (name, scope_description, scope_level, status) VALUES (?, ?, ?, 'frozen')"
      )
      .run(
        map.topic.name,
        map.topic.scope_description ?? "",
        map.topic.scope_level ?? "working"
      ).lastInsertRowid as number;

    // --- nodes ---
    const insNode = db.prepare(
      "INSERT INTO nodes (topic_id, type, name, description, verification, grounding_sensitive) " +
        "VALUES (?, ?, ?, ?, 'unverified', ?)"
    );
    const nodeIdByRef = new Map<string, number>();
    for (const n of map.nodes) {
      if (nodeIdByRef.has(n.ref)) {
        throw new Error(`Duplicate node ref "${n.ref}"`);
      }
      const id = insNode.run(
        topicId,
        n.type,
        n.name,
        n.description ?? "",
        n.grounding_sensitive ? 1 : 0
      ).lastInsertRowid as number;
      nodeIdByRef.set(n.ref, id);
    }

    const resolveNode = (ref: string): number => {
      const id = nodeIdByRef.get(ref);
      if (id === undefined) throw new Error(`Unknown node ref "${ref}"`);
      return id;
    };

    // --- edges ---
    const insEdge = db.prepare(
      "INSERT INTO edges (source_node_id, target_node_id, type, order_index, is_cross_topic) " +
        "VALUES (?, ?, ?, ?, 0)"
    );
    const edgeIdByRef = new Map<string, number>();
    const simpleEdges: SimpleEdge[] = [];
    for (const e of map.edges) {
      const source = resolveNode(e.source_ref);
      const target = resolveNode(e.target_ref);
      const id = insEdge.run(
        source,
        target,
        e.type,
        e.order_index ?? null
      ).lastInsertRowid as number;
      if (e.ref) {
        if (edgeIdByRef.has(e.ref)) {
          throw new Error(`Duplicate edge ref "${e.ref}"`);
        }
        edgeIdByRef.set(e.ref, id);
      }
      simpleEdges.push({ source, target, type: e.type });
    }

    // --- items + questions ---
    const insItem = db.prepare(
      "INSERT INTO items (kind, topic_id, member_node_ids, edge_id, ordering) VALUES (?, ?, ?, ?, ?)"
    );
    const insQuestion = db.prepare(
      "INSERT INTO test_questions (item_id, method, prompt, expected_answer, options, verification, grounding_sensitive) " +
        "VALUES (?, ?, ?, ?, ?, 'unverified', 0)"
    );
    const insReviewState = db.prepare(
      "INSERT INTO review_state " +
        "(item_id, due, stability, difficulty, elapsed_days, scheduled_days, learning_steps, reps, lapses, state, last_review) " +
        "VALUES (@item_id, @due, @stability, @difficulty, @elapsed_days, @scheduled_days, @learning_steps, @reps, @lapses, @state, @last_review)"
    );

    let questionCount = 0;
    let reviewStateCount = 0;
    for (const it of map.items) {
      const memberIds = it.member_node_refs.map(resolveNode);
      let edgeId: number | null = null;
      if (it.edge_ref) {
        const eid = edgeIdByRef.get(it.edge_ref);
        if (eid === undefined) {
          throw new Error(
            `Item "${it.ref}" references unknown edge_ref "${it.edge_ref}"`
          );
        }
        edgeId = eid;
      }

      // ordering may contain node refs (strings) or plain numbers; map refs.
      let ordering: string | null = null;
      if (it.ordering && it.ordering.length > 0) {
        const mapped = (it.ordering as (string | number)[]).map((o) =>
          typeof o === "string" && nodeIdByRef.has(o) ? resolveNode(o) : o
        );
        ordering = JSON.stringify(mapped);
      }

      const itemId = insItem.run(
        it.kind,
        topicId,
        JSON.stringify(memberIds),
        edgeId,
        ordering
      ).lastInsertRowid as number;

      for (const q of it.questions ?? []) {
        insQuestion.run(
          itemId,
          q.method,
          q.prompt,
          q.expected_answer ?? "",
          q.options ? JSON.stringify(q.options) : null
        );
        questionCount++;
      }

      insReviewState.run(cardToRow(newCard(now), itemId));
      reviewStateCount++;
    }

    // --- derived parameters (computed by the app, not the generator) ---
    const allNodeIds = [...nodeIdByRef.values()];
    const difficulty = computeDifficulty(allNodeIds, simpleEdges);
    const centrality = computeCentrality(allNodeIds, simpleEdges);
    const updNode = db.prepare(
      "UPDATE nodes SET difficulty = ?, centrality = ? WHERE id = ?"
    );
    for (const id of allNodeIds) {
      updNode.run(difficulty.get(id) ?? 0, centrality.get(id) ?? 0, id);
    }

    return {
      topicId,
      counts: {
        nodes: map.nodes.length,
        edges: map.edges.length,
        items: map.items.length,
        questions: questionCount,
        reviewStates: reviewStateCount,
      },
    };
  });

  return run();
}
