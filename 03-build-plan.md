# Doc 3: Build Plan (for Cursor)

**Personal Knowledge Mastery System, v1**

This is the build plan for v1. It assumes Doc 1 (the spec), Doc 2 (the scope), and Doc 4 (the generation pipeline) sit alongside it. Build in the milestone order below. Each milestone is a slice you can verify before moving on.

---

## 1. How to use this with Cursor

- Keep all the docs in the repo. Doc 1 is the spec Cursor references for any "why," Doc 2 is the scope (what is in and out), Doc 4 is the internal design of the generator, and this doc is the task list.
- Put the invariants in Section 3 into a rules file Cursor always loads (`.cursor/rules/project.md` or a root `RULES.md` you paste into context). These are the things Cursor must never violate.
- Work one milestone at a time. Do not let Cursor jump ahead and scaffold deferred features.
- After each milestone, run its verify step (they map to Doc 2's acceptance criteria) and commit.
- When Cursor proposes something that contradicts the rules file, the rules file wins.

---

## 2. Stack and project setup

Locked choices (adjust only if you have a reason):

- **App:** Next.js with TypeScript.
- **Database:** SQLite via `better-sqlite3` (synchronous, simple, server-side only, ideal for a local single-user app). All DB access happens in server code (API routes or server actions), never in the browser.
- **Scheduling:** `ts-fsrs`.
- **Graph view:** `cytoscape` (optionally `react-cytoscapejs` as the React wrapper).
- **Generator:** a separate Python project, a multi-phase pipeline (see Doc 4), calls an LLM API across many small passes and may use embeddings internally, outputs the JSON contract. Lives in its own folder, not part of the Next.js build.

Suggested repo structure:

```
/app                 Next.js routes and pages
/lib
  /db                connection, schema, queries
  /fsrs              ts-fsrs wrapper, scheduling logic
  /mastery           status, gating, topic mastery computation
  /import            JSON import + derived-parameter computation
/db
  schema.sql         the full Doc 1 schema
/data
  seed-topic.json    hand-authored small topic for building and testing
  generated/         output from the Python generator
/generator           multi-phase pipeline (Doc 4)
  pipeline.py        orchestrator
  phases/            scope, scaffold, enumerate, dedup, detail, edges, procedures, items, audit
  artifacts/         checkpointed intermediate output per phase
RULES.md             invariants (Section 3)
```

---

## 3. Rules file (invariants, never violated)

Paste this into the Cursor rules file.

- Build against the full Doc 1 schema, including columns v1 does not use (`embedding`, `verification`, cross-topic fields). Do not trim the schema to v1.
- Every assessment table keys off `item_id`, never `node_id`. Items can cover one or many nodes.
- The schedulable unit is an item, mapped one-to-one to a ts-fsrs card. Never schedule raw nodes.
- Never implement spaced-repetition math by hand. All scheduling goes through `ts-fsrs`.
- Store the user's typed answer on every review, even when empty, so AI grading can be added later.
- `difficulty` and `centrality` are computed by the app after import from graph structure. Never trust them from the generator.
- Generation lives only in the Python script and only emits JSON. The runtime app never calls an LLM in v1 except a future "check me" path, which is not built yet.
- v1 is one topic. Do not build appending, cross-topic edges, integration items, gap-search, embeddings, grounding, or AI grading. Leave the schema room for them, write none of the code.
- Self-grade only. No auto-grading in v1.
- Thresholds (known and mastered R cutoffs, method counts) and the mastery weighting are read from settings at runtime, never hardcoded.

---

## 4. Generation output contract (the JSON the app imports)

Both the seed file and the generator produce this shape. The importer maps local `ref` strings to database ids.

```json
{
  "topic": { "name": "...", "scope_description": "...", "scope_level": "..." },
  "nodes": [
    { "ref": "n1", "type": "concept|procedure", "name": "...",
      "description": "...", "grounding_sensitive": false }
  ],
  "edges": [
    { "source_ref": "n1", "target_ref": "n2", "type": "prerequisite_of|part_of|used_in|causes|contrasts_with|analogous_to",
      "order_index": 1 }
  ],
  "items": [
    { "ref": "i1", "kind": "atomic|connection|composition",
      "member_node_refs": ["n1"], "edge_ref": null, "ordering": null,
      "questions": [
        { "method": "cloze|free_recall|application|relational",
          "prompt": "...", "expected_answer": "...", "options": null }
      ]
    }
  ]
}
```

Rules for the importer: set `verification` to `unverified` on all nodes, compute `difficulty` and `centrality` after insert, create one `review_state` row per item in the ts-fsrs "new" state, and create `method_progress` rows lazily on first review.

---

## 5. Build order (milestones)

### M0, project setup
Tasks: scaffold the Next.js + TS app, install `better-sqlite3`, `ts-fsrs`, `cytoscape`. Write `db/schema.sql` with the full Doc 1 schema. Write a one-shot script that creates the database from the schema. Add the rules file.
Verify: the database is created with all tables and columns, and the app boots.

### M1, seed data and import
Tasks: hand-author `data/seed-topic.json` (a small real slice, around 8 to 12 nodes, at least one procedure, a few typed edges, items of all three kinds, one or two questions per available method). Write the import function: parse the JSON, insert topic, nodes, edges, items, then compute `difficulty` (prerequisite depth) and `centrality` (degree) and write them back. Create `review_state` rows for each item.
Verify: importing the seed produces correct row counts, every item has a `review_state` row, and `difficulty` and `centrality` are populated and sane.

### M2, the review loop (the core)
Tasks: query due items (R below threshold, plus new items). For a served item, sample one method appropriate to its kind (Doc 2, Section 4). Show the prompt, accept an optional typed answer, reveal the expected answer, take a self-rating (Again, Hard, Good, Easy). Update the ts-fsrs card and write a `reviews` log row and update `method_progress`.
Verify: completing a review changes the item's due date and stability in the right direction (Good pushes due out, Again pulls it in), confirmed by inspecting `review_state` before and after. This is Doc 2 criterion 3.

### M3, status, mastery, gating
Tasks: compute item status (locked, learning, known, mastered) from `review_state` and `method_progress` against the live thresholds. Compute topic mastery as the centrality-and-difficulty-weighted average of item contributions (0 until known, then current R). Implement gating: a concept is locked until all prerequisites reach known.
Verify: an item flips to mastered only after the required number of distinct methods pass (criterion 4), mastery rises as items are learned and falls when items go overdue (criterion 5), and a deep node is locked until its prerequisites reach known (criterion 6).

### M4, graph view
Tasks: render the topic with Cytoscape, nodes colored by status with a due indicator, edges drawn by type. Clicking a node opens an inspector showing its description, edges, the items covering it, FSRS state, current R, and method progress.
Verify: the graph renders and the inspector shows correct data for a clicked node. This is Doc 2 criterion 2.

### M5, what to learn next, dashboard, settings
Tasks: build the "what to learn next" list (due items first, then frontier concepts whose prerequisites are all known, ordered by centrality, never locked nodes). Build the dashboard (topic mastery number, coverage status line showing scope level and node count with gap-search marked not run). Build the settings panel to edit thresholds and weighting, applied immediately.
Verify: the list never suggests a locked node and orders correctly (criterion 7), and changing a threshold immediately changes known/mastered counts and the mastery number (criterion 8).

### M6, the real generator (multi-phase pipeline, see Doc 4)
This is the largest milestone and is itself staged. Build it per Doc 4, checkpointing each phase's output to disk so the pipeline is resumable.

- **M6.1 Scope and scaffold:** the tightened scope interview (ending in an in/out list and a tentative outline), then the outline scaffold with its gap critic. Verify: the outline covers the boundary with no obvious missing area.
- **M6.2 Concepts and dedup:** parallel per-section concept enumeration with saturation or gap critics, then global embedding-based dedup and merge into canonical nodes. Verify: a hand-check of one section shows no obvious missing concepts, and no duplicate nodes survive the merge.
- **M6.3 Detailing and edges:** node detailing with the auditor flagging uncertain nodes, then intra-section and candidate-based cross-section edges with the missing-and-wrong-links critic, then procedures. Verify: edges are sparse and correct on a hand-check, and prerequisites form no cycles.
- **M6.4 Items and audit:** per-unit question generation for the three v1 item kinds, then the global audit and confidence report. Verify: the emitted JSON passes the importer's validate, and importing it satisfies Doc 2 criterion 1.

End-to-end verify: generating a real topic (Django REST) through the full pipeline and importing it makes the whole loop (review, see mastery move) work on real data. v1 generation covers atomic, connection, and composition items only. Integration items stay deferred.

---

## 6. Why this order

The app is fully built and verifiable on the hand-authored seed (M1 through M5) before the generator exists (M6). That removes the chicken-and-egg problem where you cannot test the app without generated data and cannot trust generated data without a working app. The riskiest, highest-value part (the FSRS loop and the mastery math, M2 and M3) is built early, on small data you fully control.

---

## 7. Testing (lightweight, matches v1 spirit)

No heavy test framework. Add small, targeted unit tests only for the two places where a silent bug would corrupt everything:

- The mastery and status computation (M3): given fixed `review_state` and `method_progress` inputs, assert the expected status and topic percentage.
- The import derived-parameter computation (M1): given a fixed graph, assert expected `difficulty` and `centrality`.

Everything else is verified by hand through the Doc 2 acceptance criteria.

---

## 8. Done

v1 is complete when all eight Doc 2 acceptance criteria pass on a real generated topic. At that point you have the daily loop running on one subject, and going to the full Doc 1 vision is adding code on top of this, never undoing it.
