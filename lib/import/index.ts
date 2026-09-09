import type Database from "better-sqlite3";
import { getDb } from "../db";
import { cardToRow, newCard } from "../fsrs";
import { computeCentrality, computeDifficulty, type SimpleEdge } from "./derived";
import type { ContractMap, SourceSupport, Verification } from "./contract";

export interface ImportResult {
  topicId: number;
  counts: {
    nodes: number;
    edges: number;
    items: number;
    questions: number;
    reviewStates: number;
    sources: number;
    nodeSources: number;
  };
}

function normalizeVerification(value: unknown): Verification {
  return value === "grounded" ? "grounded" : "unverified";
}

function normalizeSupport(value: unknown): SourceSupport {
  if (
    value === "supports" ||
    value === "partial" ||
    value === "related" ||
    value === "contradicts"
  ) {
    return value;
  }
  return "supports";
}

/**
 * Import a generation contract map into SQLite. Inserts topic, nodes, edges,
 * items, questions, and optional grounding sources; computes difficulty +
 * centrality from graph structure; and creates one ts-fsrs "new" review_state
 * per item. Runs in a single transaction. method_progress rows are created
 * lazily on first review.
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
        "VALUES (?, ?, ?, ?, ?, ?)"
    );
    const nodeIdByRef = new Map<string, number>();
    const nodeByRef = new Map<string, (typeof map.nodes)[number]>();
    for (const n of map.nodes) {
      if (nodeIdByRef.has(n.ref)) {
        throw new Error(`Duplicate node ref "${n.ref}"`);
      }
      const id = insNode.run(
        topicId,
        n.type,
        n.name,
        n.description ?? "",
        normalizeVerification(n.verification),
        n.grounding_sensitive ? 1 : 0
      ).lastInsertRowid as number;
      nodeIdByRef.set(n.ref, id);
      nodeByRef.set(n.ref, n);
    }

    const resolveNode = (ref: string): number => {
      const id = nodeIdByRef.get(ref);
      if (id === undefined) throw new Error(`Unknown node ref "${ref}"`);
      return id;
    };

    // --- sources + node_sources (optional; additive) ---
    const sourceIdByRef = new Map<string, number>();
    const mapSources = map.sources ?? [];
    const insSource = db.prepare(
      "INSERT OR IGNORE INTO sources (url, title, publisher, retrieved_at, quote) VALUES (?, ?, ?, ?, ?)"
    );
    const getSourceIdByUrl = db.prepare(
      "SELECT id FROM sources WHERE url = ?"
    );
    for (const s of mapSources) {
      if (sourceIdByRef.has(s.ref)) {
        throw new Error(`Duplicate source ref "${s.ref}"`);
      }
      const url = (s.url ?? "").trim();
      if (!url) {
        throw new Error(`Source "${s.ref}" is missing url`);
      }
      insSource.run(
        url,
        s.title ?? url,
        s.publisher ?? "",
        s.retrieved_at ?? new Date().toISOString(),
        s.quote ?? ""
      );
      const row = getSourceIdByUrl.get(url) as { id: number } | undefined;
      if (!row) {
        throw new Error(`Failed to resolve source id for "${url}"`);
      }
      sourceIdByRef.set(s.ref, row.id);
    }

    const explicitLinks = map.node_sources ?? [];
    const fallbackLinks = map.nodes.flatMap((n) =>
      (n.source_refs ?? []).map((source_ref) => ({
        node_ref: n.ref,
        source_ref,
        support: "supports" as SourceSupport,
      }))
    );
    const mergedLinks = [...explicitLinks, ...fallbackLinks];
    const insNodeSource = db.prepare(
      "INSERT INTO node_sources (node_id, source_id, support) VALUES (?, ?, ?) " +
        "ON CONFLICT(node_id, source_id) DO UPDATE SET support = excluded.support"
    );
    const nodeSourcePairs = new Set<string>();
    for (const link of mergedLinks) {
      const nodeId = resolveNode(link.node_ref);
      const sourceId = sourceIdByRef.get(link.source_ref);
      if (sourceId === undefined) {
        throw new Error(
          `Unknown source ref "${link.source_ref}" for node "${link.node_ref}"`
        );
      }
      insNodeSource.run(
        nodeId,
        sourceId,
        normalizeSupport(link.support)
      );
      nodeSourcePairs.add(`${nodeId}:${sourceId}`);
    }

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
        "VALUES (?, ?, ?, ?, ?, ?, ?)"
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
      const inheritedGrounding = it.member_node_refs.some(
        (ref) => !!nodeByRef.get(ref)?.grounding_sensitive
      );
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
          q.options ? JSON.stringify(q.options) : null,
          normalizeVerification(q.verification),
          q.grounding_sensitive != null
            ? (q.grounding_sensitive ? 1 : 0)
            : (inheritedGrounding ? 1 : 0)
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
        sources: sourceIdByRef.size,
        nodeSources: nodeSourcePairs.size,
      },
    };
  });

  return run();
}
