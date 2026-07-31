import type Database from "better-sqlite3";
import { getDb } from "../db";
import { computeTopicState, getPrimaryTopicId, type ItemStatus } from "../mastery";
import type { TopicRow } from "../types";

export interface DashboardData {
  topic: { id: number; name: string; scopeLevel: string } | null;
  mastery: number; // 0..1
  counts: Record<ItemStatus, number>;
  itemTotal: number;
  coverage: {
    scopeLevel: string;
    nodeCount: number;
    gapSearch: string; // honest status string; gap-search is deferred in v1
  };
  grounding: {
    sensitive: number;
    grounded: number;
    sensitiveUnverified: number;
  };
}

export function getDashboard(
  db: Database.Database = getDb(),
  now: Date = new Date()
): DashboardData {
  const topicId = getPrimaryTopicId(db);
  if (topicId === null) {
    return {
      topic: null,
      mastery: 0,
      counts: { locked: 0, learning: 0, known: 0, mastered: 0 },
      itemTotal: 0,
      coverage: { scopeLevel: "-", nodeCount: 0, gapSearch: "not run" },
      grounding: { sensitive: 0, grounded: 0, sensitiveUnverified: 0 },
    };
  }

  const topic = db.prepare("SELECT * FROM topics WHERE id = ?").get(topicId) as
    TopicRow;
  const nodeCount = (
    db.prepare("SELECT COUNT(*) c FROM nodes WHERE topic_id = ?").get(topicId) as
      { c: number }
  ).c;

  const state = computeTopicState(topicId, db, now);
  const itemTotal = state.items.size;
  const grounding = db
    .prepare(
      "SELECT " +
        "SUM(CASE WHEN grounding_sensitive = 1 THEN 1 ELSE 0 END) AS sensitive, " +
        "SUM(CASE WHEN verification = 'grounded' THEN 1 ELSE 0 END) AS grounded, " +
        "SUM(CASE WHEN grounding_sensitive = 1 AND verification != 'grounded' THEN 1 ELSE 0 END) AS sensitive_unverified " +
        "FROM nodes WHERE topic_id = ?"
    )
    .get(topicId) as
    | { sensitive: number | null; grounded: number | null; sensitive_unverified: number | null }
    | undefined;

  return {
    topic: { id: topic.id, name: topic.name, scopeLevel: topic.scope_level },
    mastery: state.mastery,
    counts: state.counts,
    itemTotal,
    coverage: {
      scopeLevel: topic.scope_level,
      nodeCount,
      // Coverage is never a fake percentage (Doc 7.4). Gap-search is deferred.
      gapSearch: "not run",
    },
    grounding: {
      sensitive: grounding?.sensitive ?? 0,
      grounded: grounding?.grounded ?? 0,
      sensitiveUnverified: grounding?.sensitive_unverified ?? 0,
    },
  };
}
