# Doc 2: v1 Scope

**Personal Knowledge Mastery System**

This doc draws the hard line for the first build. It takes Doc 1 and says exactly what v1 includes, what it defers, and how we know v1 is done and correct. Doc 3 (the Cursor build plan) is written only after this scope is locked, because the task list depends on where this line sits.

Note for the current repo: selective grounding/source attachment is being built as an additive post-v1 milestone. This document still defines strict v1 acceptance.

---

## 1. The v1 goal

Prove the daily loop is something you actually use.

The biggest risk in this whole project is not technical, it is motivational: if reviewing the graph does not feel worth opening every day, none of the advanced machinery matters. So v1 is deliberately one topic, end to end, with the smallest build that exercises the real loop: create a map, see it, review it under FSRS, watch a trustworthy mastery number move. Everything that only matters once you have many topics is deferred.

If v1 earns a daily habit on one topic, the rest of Doc 1 is worth building. If it does not, we learn that cheaply.

---

## 2. The cut, mapped to Doc 1

### In v1

- One topic, generated and frozen (Doc 1, Sections 4.1 and 4.2).
- Phase 1 generation only: the topic's own concepts, procedures, intra-topic edges, and items (Section 4.3, internal phase only).
- The assessment layer with three item kinds: atomic, connection, composition (Section 3.5).
- FSRS scheduling via ts-fsrs, item as card, method sampling per due item (Section 5).
- Three to four methods: cloze, free recall, application, relational (Section 6.1, minus MCQ).
- Self-grade for every method, typed answers stored (Section 6.2, v1 path).
- Item status, intra-topic prerequisite gating, mastery percentage, coverage status line (Sections 7.1, 7.2, 7.3, 7.4).
- What to learn next: due reviews, then frontier (Section 8).
- Graph view with status colors and node inspection (Section 10.1).
- Dashboard with the mastery number and the threshold settings (Sections 10.2, 7.1).
- The full Doc 1 SQLite schema, even the columns v1 does not yet use (Section 11).

### Deferred (schema stays compatible, so each is additive later)

- A second topic, appending, Phase 2 integration, cross-topic edges, the integration score (Sections 4.3 Phase 2, 7.5).
- Gap-search expansion (Section 4.5).
- Dedup and merge tooling (Section 4.4).
- Integration items, the three-plus-node kind (Section 3.5).
- Embeddings and retrieval (Section 9.4).
- Grounding and source attachment (Section 12).
- Hybrid and AI grading (Section 12). Typed answers are stored now so this is backfillable.
- Auto-grading of cloze and MCQ. v1 self-grades everything for simplicity.
- AI teaching content (Section 12). v1 points you at what to learn, it does not teach.
- Nicheness parameter.
- Compound-node cluster visuals. With one topic there is one cluster, so this is meaningless until there are several.

---

## 3. v1 data subset

The schema is the full Doc 1 schema. v1 simply leaves some columns unused:

- `nodes`: all columns used except `embedding` (stays null) and `verification` (always `unverified`). `grounding_sensitive` is still set by generation so the data is there when grounding ships.
- `edges`: `is_cross_topic` is always false in v1 (one topic).
- `items`: only `atomic`, `connection`, `composition` kinds. `edge_id` set for connection items, `ordering` set for composition items.
- `review_state`, `method_progress`, `test_questions`, `reviews`: fully used.
- Mastery, coverage, and the (empty) integration score computed at read time.

Building against the full schema now means none of the deferred features require a migration, only new code paths.

---

## 4. v1 item kinds and methods

Each item kind has a small set of available methods, which is what lets an item reach "mastered" across distinct methods:

- **Atomic item** (one concept): cloze, free recall, application.
- **Connection item** (two nodes plus their edge): relational, free recall (explain the link).
- **Composition item** (a procedure): relational (order the steps), free recall (walk through it), application (apply it).

MCQ is deferred. With these, every item kind has at least two methods available, so the mastered-across-2-methods rule (3 for high-centrality items) can actually be satisfied.

---

## 5. v1 generation

Phase 1 only, run as the separate local Python script from Doc 1, Section 9.2.

- Input: scope is established through an interactive, AI-driven clarifying conversation that runs in the terminal when you start the generation script. It asks about level, what you already know, and what to include or exclude, the same questions Doc 1 describes, just hosted in the terminal instead of the app UI. This keeps scope reliable (a real conversation, not a static guess) without the cost of building in-app chat. The polished in-app version is a fast-follow, not v1.
- Output: a JSON file with nodes, edges (with `order_index` on `part_of`), items of the three v1 kinds, and per-item test questions with expected answers, one per available method.
- Import: the app loads the JSON into SQLite and then computes the derived parameters (difficulty from prerequisite depth, centrality from connectivity) so those stay consistent and are not trusted from the generator.
- Review of the generated map in v1 is lightweight: the JSON is human-readable, you eyeball it or hand-edit it, and you regenerate if it is wrong. A polished in-app review and merge UI is deferred, since its main job is Phase 2 integration, which is also deferred.

---

## 6. v1 user flows

- **Create the topic:** run the generation script with your scope, import the JSON, see the graph populate.
- **See the map:** the Cytoscape graph shows concepts, procedures, and edges, colored by status (locked, learning, known, mastered, due). Click any node to inspect its description, edges, the items covering it, FSRS state, R, and method progress.
- **Review session:** the app serves due items, samples one method appropriate to the item kind, shows the question, you attempt it (typing is optional but encouraged so it can be AI-graded later), reveal the expected answer, self-rate Again / Hard / Good / Easy. FSRS updates the card.
- **What to learn next:** a list of due reviews first, then the frontier (unlearned concepts whose prerequisites are all known, ordered by centrality).
- **Dashboard:** the topic mastery percentage, the coverage status line (scope level and node count, gap-search reads "not run" since it is deferred), and a settings panel to tune the known and mastered thresholds live.

---

## 7. v1 grading

Self-grade for every method, exactly like Anki: attempt, reveal expected answer, rate yourself. Cloze and MCQ auto-grading is a small fast-follow, not v1. The typed answer is stored on every review whether or not you typed one, so hybrid grading (AI proposes a grade, you override) can be switched on later and even applied retroactively.

---

## 8. Acceptance criteria (definition of done)

v1 is correct when all of these hold, checked against a real generated topic (use Django REST so it is a subject you can judge):

1. **Generation and import.** Running the script on Django REST produces valid JSON, and importing it yields a graph with concept nodes, at least one procedure, sparse typed edges, and items of all three kinds. Difficulty and centrality are populated by the app after import.
2. **Graph view.** The graph renders, nodes are colored by status, and clicking a node shows its items, edges, and FSRS state.
3. **FSRS loop.** Completing a review changes the item's due date and stability in the expected direction (Good pushes the next due date out, Again pulls it in). Verify by inspecting one item's `review_state` before and after.
4. **Method sampling and mastery.** An item only reaches `mastered` after being answered correctly on the required number of distinct methods (2, or 3 for high-centrality). Verify by passing one method repeatedly and confirming the item does not flip to mastered until a second method is also passed.
5. **Mastery number behaves.** Topic mastery starts at 0, rises as items reach known and mastered, and falls when an item goes overdue and its R decays below threshold. Verify by passing several items, then advancing the clock (or waiting) and seeing the number drop.
6. **Gating.** A node with unmet prerequisites shows as locked, and becomes available once all its prerequisites reach known. Verify by checking a deep node is locked initially and unlocks after its prerequisites pass.
7. **What to learn next.** The list shows due items first, then frontier concepts in centrality order, and never suggests a locked node.
8. **Thresholds are live.** Changing a threshold in settings immediately changes which items count as known or mastered and updates the mastery number.

If all eight pass on a real topic, v1 is done and the daily loop is real.

---

## 9. Explicit non-goals for v1

- No second topic, no cross-topic anything.
- No AI in the daily loop. Generation uses AI, review does not.
- No grounding, no retrieval, no embeddings populated.
- No polished onboarding or conversational map review.
- No teaching content.

Stating these so scope does not creep during the build.

---

## 10. What v1 must not foreclose

Every deferred feature must remain additive, not a rewrite. The guarantees:

- Build against the full Doc 1 schema, including unused columns.
- Key every assessment table off `item_id`, never `node_id`, so connection, composition, and later integration items all fit.
- Store typed answers from day one (enables hybrid grading later).
- Keep generation in a separate script that emits JSON (enables Phase 2, gap-search, and grounding to be added as new generation modes, not surgery on the runtime).
- Keep `topic_id` and `is_cross_topic` real fields even though v1 has one topic (enables appending without migration).

If these hold, going from v1 to the full Doc 1 vision is adding code, never undoing it.
