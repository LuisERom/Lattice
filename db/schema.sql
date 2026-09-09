-- Lattice — Personal Knowledge Mastery System
-- Full Doc 1 schema (Section 11). v1 leaves some columns unused on purpose
-- (embedding, verification, is_cross_topic, integration items) so that every
-- deferred feature is additive later with no migration. Do not trim to v1.

PRAGMA foreign_keys = ON;
PRAGMA journal_mode = WAL;

-- A named subject mapped into the graph. Renders as a cluster ("circle").
CREATE TABLE IF NOT EXISTS topics (
  id                INTEGER PRIMARY KEY,
  name              TEXT    NOT NULL,
  scope_description TEXT    NOT NULL DEFAULT '',
  scope_level       TEXT    NOT NULL DEFAULT 'working',   -- working | deep | exam-ready
  status            TEXT    NOT NULL DEFAULT 'frozen',    -- draft | frozen
  created_at        TEXT    NOT NULL DEFAULT (datetime('now'))
);

-- Concept (atomic, deduplicated) or Procedure (composition). One table, type field.
-- difficulty + centrality are computed by the app from graph structure after import,
-- never trusted from the generator.
CREATE TABLE IF NOT EXISTS nodes (
  id                  INTEGER PRIMARY KEY,
  topic_id            INTEGER NOT NULL REFERENCES topics(id) ON DELETE CASCADE,
  type                TEXT    NOT NULL,                   -- concept | procedure
  name                TEXT    NOT NULL,
  description         TEXT    NOT NULL DEFAULT '',
  difficulty          REAL    NOT NULL DEFAULT 0,         -- derived: prerequisite depth
  centrality          REAL    NOT NULL DEFAULT 0,         -- derived: connectivity
  verification        TEXT    NOT NULL DEFAULT 'unverified', -- unverified | grounded
  grounding_sensitive INTEGER NOT NULL DEFAULT 0,         -- bool (set by generation)
  embedding           BLOB,                               -- nullable; empty in v1
  created_at          TEXT    NOT NULL DEFAULT (datetime('now'))
);

-- Canonical source records for selective grounding. A source is a retrievable
-- citation target (URL + title + optional quote metadata).
CREATE TABLE IF NOT EXISTS sources (
  id          INTEGER PRIMARY KEY,
  url         TEXT    NOT NULL UNIQUE,
  title       TEXT    NOT NULL,
  publisher   TEXT    NOT NULL DEFAULT '',
  retrieved_at TEXT   NOT NULL DEFAULT (datetime('now')),
  quote       TEXT    NOT NULL DEFAULT '',
  created_at  TEXT    NOT NULL DEFAULT (datetime('now'))
);

-- Many-to-many node/source links with support labels.
CREATE TABLE IF NOT EXISTS node_sources (
  node_id     INTEGER NOT NULL REFERENCES nodes(id) ON DELETE CASCADE,
  source_id   INTEGER NOT NULL REFERENCES sources(id) ON DELETE CASCADE,
  support     TEXT    NOT NULL DEFAULT 'supports', -- supports | partial | related | contradicts
  created_at  TEXT    NOT NULL DEFAULT (datetime('now')),
  PRIMARY KEY (node_id, source_id)
);

-- Typed, sparse relationships. is_cross_topic is derived (endpoints' topics differ).
CREATE TABLE IF NOT EXISTS edges (
  id             INTEGER PRIMARY KEY,
  source_node_id INTEGER NOT NULL REFERENCES nodes(id) ON DELETE CASCADE,
  target_node_id INTEGER NOT NULL REFERENCES nodes(id) ON DELETE CASCADE,
  type           TEXT    NOT NULL,  -- prerequisite_of | part_of | used_in | causes | contrasts_with | analogous_to
  order_index    INTEGER,           -- nullable; set for part_of
  is_cross_topic INTEGER NOT NULL DEFAULT 0, -- derived; always 0 in v1 (one topic)
  created_at     TEXT    NOT NULL DEFAULT (datetime('now'))
);

-- The assessment layer. An item is the schedulable unit and may span >1 node.
-- v1 uses atomic | connection | composition (integration is deferred).
CREATE TABLE IF NOT EXISTS items (
  id              INTEGER PRIMARY KEY,
  kind            TEXT    NOT NULL,  -- atomic | connection | composition | integration
  topic_id        INTEGER NOT NULL REFERENCES topics(id) ON DELETE CASCADE,
  member_node_ids TEXT    NOT NULL,  -- json array of node ids
  edge_id         INTEGER REFERENCES edges(id) ON DELETE SET NULL, -- set for connection items
  ordering        TEXT,              -- nullable json (composition step order)
  created_at      TEXT    NOT NULL DEFAULT (datetime('now'))
);

-- One ts-fsrs card per item. Keyed off item_id, never node_id.
CREATE TABLE IF NOT EXISTS review_state (
  item_id        INTEGER PRIMARY KEY REFERENCES items(id) ON DELETE CASCADE,
  due            TEXT    NOT NULL,
  stability      REAL    NOT NULL DEFAULT 0,
  difficulty     REAL    NOT NULL DEFAULT 0,
  elapsed_days   REAL    NOT NULL DEFAULT 0,
  scheduled_days REAL    NOT NULL DEFAULT 0,
  learning_steps INTEGER NOT NULL DEFAULT 0,  -- ts-fsrs v5 Card field
  reps           INTEGER NOT NULL DEFAULT 0,
  lapses         INTEGER NOT NULL DEFAULT 0,
  state          INTEGER NOT NULL DEFAULT 0,  -- 0 New, 1 Learning, 2 Review, 3 Relearning
  last_review    TEXT
);

-- Drives the mastered-across-N-distinct-methods rule. One row per (item, method).
CREATE TABLE IF NOT EXISTS method_progress (
  item_id       INTEGER NOT NULL REFERENCES items(id) ON DELETE CASCADE,
  method        TEXT    NOT NULL,  -- cloze | free_recall | application | relational | recognition
  times_correct INTEGER NOT NULL DEFAULT 0,
  last_seen     TEXT,
  passed        INTEGER NOT NULL DEFAULT 0,  -- bool
  PRIMARY KEY (item_id, method)
);

-- Generated questions. Multiple methods per item; sampled at review time.
CREATE TABLE IF NOT EXISTS test_questions (
  id                  INTEGER PRIMARY KEY,
  item_id             INTEGER NOT NULL REFERENCES items(id) ON DELETE CASCADE,
  method              TEXT    NOT NULL,
  prompt              TEXT    NOT NULL,
  expected_answer     TEXT    NOT NULL DEFAULT '',
  options             TEXT,                          -- nullable json (MCQ)
  verification        TEXT    NOT NULL DEFAULT 'unverified',
  grounding_sensitive INTEGER NOT NULL DEFAULT 0,
  created_at          TEXT    NOT NULL DEFAULT (datetime('now'))
);

-- Append-only review log. user_answer stored on every review (even empty) so
-- AI/hybrid grading can be switched on and backfilled later.
CREATE TABLE IF NOT EXISTS reviews (
  id          INTEGER PRIMARY KEY,
  item_id     INTEGER NOT NULL REFERENCES items(id) ON DELETE CASCADE,
  method      TEXT    NOT NULL,
  rating      INTEGER NOT NULL,             -- ts-fsrs Rating: 1 Again, 2 Hard, 3 Good, 4 Easy
  graded_by   TEXT    NOT NULL DEFAULT 'self', -- self | ai
  user_answer TEXT    NOT NULL DEFAULT '',
  ai_grade    TEXT,                         -- nullable; reserved for hybrid grading
  reviewed_at TEXT    NOT NULL DEFAULT (datetime('now'))
);

-- App-level tunables (thresholds + mastery weighting). Read at runtime, never
-- hardcoded. Keys defined in lib/settings.
CREATE TABLE IF NOT EXISTS settings (
  key   TEXT PRIMARY KEY,
  value TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_nodes_topic        ON nodes(topic_id);
CREATE INDEX IF NOT EXISTS idx_edges_source       ON edges(source_node_id);
CREATE INDEX IF NOT EXISTS idx_edges_target       ON edges(target_node_id);
CREATE INDEX IF NOT EXISTS idx_items_topic        ON items(topic_id);
CREATE INDEX IF NOT EXISTS idx_questions_item     ON test_questions(item_id);
CREATE INDEX IF NOT EXISTS idx_reviews_item       ON reviews(item_id);
CREATE INDEX IF NOT EXISTS idx_method_prog_item   ON method_progress(item_id);
CREATE INDEX IF NOT EXISTS idx_sources_url        ON sources(url);
CREATE INDEX IF NOT EXISTS idx_node_sources_node  ON node_sources(node_id);
CREATE INDEX IF NOT EXISTS idx_node_sources_src   ON node_sources(source_id);
