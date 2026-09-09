# Doc 1: Vision and Architecture

**Personal Knowledge Mastery System** (working name, rename freely)

This is the north-star spec. It defines what the system is, the data model, and every mechanic. Doc 2 (v1 scope) is a subset of this. Doc 3 (build plan) comes later. Treat this as a living document: we revise it as v1 teaches us things, we do not freeze it.

---

## 1. Purpose and philosophy

A personal tool that maps a subject into a structured knowledge graph, then drives genuine mastery of that graph through spaced repetition, and reports honestly how much of it you currently know.

The core bet is the combination of three things that usually exist separately:

1. A knowledge graph of atomic concepts and the typed connections between them.
2. A spaced-repetition memory model on top of that graph.
3. A mastery rollup that turns per-item memory into a trustworthy per-topic number.

What it is not: it is not a flashcard app (cards are an output, not the unit), it is not a course or a teacher (in v1 it tells you what to learn next, you learn elsewhere), and it is not a note-taking graph like Obsidian (the units are testable, with a memory state, not documents).

Two design values run through everything:

- **Honesty over false precision.** A number is shown only when it means something. Mastery is exact and reachable. Coverage is an estimate and is never dressed up as exact.
- **Don't reinvent solved problems.** Spaced repetition is solved (FSRS). We use it, we do not build our own decay math.

---

## 2. Vocabulary

- **Piece / Concept:** the atomic unit of knowledge. A single context-free fact or skill. Ohm's law. "Helicase unwinds the double helix." What a Django serializer does.
- **Procedure (schema):** an ordered composition of concepts. DNA replication. The lifecycle of a GET request through a DRF endpoint. Its mastery depends on knowing the parts AND knowing how they assemble.
- **Edge:** a typed, named relationship between two nodes. Sparse, never all-pairs.
- **Topic:** a named subject you chose to map (Django REST, Celery). Renders visually as a cluster, the "circle."
- **Global graph:** the one graph that accumulates all topics over time. Topics are not isolated maps, they are clusters inside one graph.
- **Item:** the unit that gets scheduled for review and contributes to mastery. An item covers one or more nodes: a single concept, a connection between two nodes, a procedure, or a small set of nodes. It is not a specific question (questions are sampled per item, per Section 5).
- **Method:** a way of testing an item (cloze, free recall, application, relational).

---

## 3. The knowledge graph (data model)

### 3.1 Node types

Two node types share one table, distinguished by a `type` field.

**Concept** is atomic and deduplicated. The same atomic fact is exactly one node, no matter how many procedures or topics reference it. You learn "helicase unwinds DNA" once and it counts everywhere it is used. What differs between contexts (the role the concept plays) lives in the procedure and the edges, never in a duplicated concept.

**Procedure** is a composition. It references its component concepts through `part_of` edges that carry an `order_index`. Mastering a procedure requires both knowing the components and knowing the assembly, so a procedure has its own test methods focused on ordering and flow.

### 3.2 Edges

Edges are sparse and typed. The AI only creates one where a real, named relationship exists. Starter edge types:

- `prerequisite_of` (A must be known before B)
- `part_of` (concept is a step in a procedure, carries `order_index`)
- `used_in` (concept is reused inside another procedure or topic)
- `causes`
- `contrasts_with`
- `analogous_to`

An edge is **cross-topic** when its two endpoints live in different topics. Cross-topic edges are the integration layer. They are computed, not hand-declared (derived from whether the endpoints' home topics differ).

### 3.3 Node parameters

Per node, two parameters are **derived from graph structure**, not hand-assigned:

- **Difficulty / advancedness:** derived from prerequisite depth (how deep in the prerequisite chain the node sits).
- **Centrality:** derived from connectivity (degree, optionally PageRank-style). High-centrality nodes unlock the most and are worth more, so they are weighted higher in mastery and surfaced earlier in sequencing.

One parameter is **deferred**: nicheness. Interesting metadata, not load-bearing, not in v1.

Two parameters exist from day one to support future grounding:

- `verification`: `unverified` or `grounded`.
- `grounding_sensitive`: boolean. The AI sets this true when the node is version-specific, recency-sensitive, or research-frontier.

In strict v1 every node is generated `unverified`. The first grounding pass is an additive post-v1 generation feature: it grounds only riskier claims and leaves stable textbook concepts ungrounded. The right axis for grounding is stability and ubiquity, not advancedness: an established textbook concept can be generated ungrounded safely, while a version-specific API detail or a contested frontier claim should be grounded.

### 3.4 Embeddings

Every node has a nullable `embedding` field from day one. It stays empty in v1. It exists so that retrieval can be switched on later (Section 9) without a migration.

### 3.5 The assessment layer: items

The graph in 3.1 to 3.4 is the structure you see and navigate. On top of it sits the assessment layer: **items**. An item is the unit that gets scheduled, tracked, and rolled up into mastery, and an item can span more than one node. This is what makes connections themselves testable and trackable, not just isolated concepts.

Item kinds:

- **Atomic item:** covers a single concept node. ("State Ohm's law.")
- **Connection item:** covers two nodes and the edge between them. ("How does a serializer relate to a queryset?") Tied to a specific edge.
- **Composition item:** covers a procedure node and its member concepts. ("Walk through DNA replication in order.")
- **Integration item:** covers a small set of three or more nodes whose joint relationship is worth testing but is not a single named procedure. Created sparingly by the AI, only where a genuine multi-way relationship exists.

Each item carries its own FSRS state, its own method progress, and its own mastery contribution. So a connection between two concepts decays, comes due, and is mastered on its own schedule, exactly like a concept does. Items stay sparse: connection items follow the already-sparse edges, composition items follow procedures, and integration items are created only where a real multi-way relationship earns the cost. The structural graph stays clean, and the assessment layer is where multi-node knowledge becomes first-class.

Most structural elements map to one item: a concept to an atomic item, a procedure to a composition item, an edge worth testing to a connection item. Integration items are the exception, created deliberately on top of a set of nodes.

---

## 4. Map lifecycle

### 4.1 Creation

You pick a subject and a target scope. The AI runs a short clarifying-question flow before generating anything: what level (working knowledge, deep, exam-ready), what you already know, what you specifically want included or excluded, and what the intended use is. The answers define the scope, which becomes the frozen boundary for that topic.

The AI then generates the topic's full internal map (concepts, procedures, intra-topic edges, and the items over them) following the declared scope and the rules in Section 3. You review the proposed map and approve it.

### 4.2 Freezing

Once approved, the map is frozen. It does not grow on its own. This is what makes the mastery percentage trustworthy: the denominator only changes through deliberate, reviewed events you control.

### 4.3 Two-phase generation when appending a topic

The global graph accumulates topics. Adding a new topic is two phases:

**Phase 1, internal.** The AI generates the new topic's own nodes, edges, and items in isolation. This does not need the rest of your graph in context.

**Phase 2, integration.** The AI is shown the existing graph (the full lightweight node index in v1, retrieved candidates later) and proposes:
- Cross-topic edges (and the connection items over them) from new nodes to existing nodes.
- Merges or edits where a new node duplicates or refines a node that already exists.

You review both, then merge. Integration is allowed to merge into existing nodes, not only add new ones.

### 4.4 Dedup discipline

The main health risk of a growing multi-topic graph is duplication, not missing connections. The same concept (message broker, idempotency, async task) gets regenerated under several topics with slightly different names and the graph rots into near-duplicates. Phase 2 must actively propose merges. Later, embeddings make this a similarity pre-check before any node is added.

### 4.5 Gap-search expansion (the only growth path)

A "search for gaps" button is the single deliberate way a frozen map grows. The AI compares the current map against the declared scope and proposes essential concepts that fit the parameters and are not already present. You review, you merge. Each merge is a conscious denominator-growth event, so the mastery percentage stays stable between merges.

---

## 5. Memory and scheduling

The engine is **FSRS** via the `ts-fsrs` library. We do not implement the algorithm.

- The scheduled unit is an **item** (Section 3.5), which may cover one node or several. Each item maps one-to-one to an FSRS card.
- Each item carries an FSRS state: stability, difficulty, due date, reps, lapses, last review, state.
- **Retrievability R** (the probability you would recall the item right now, 0 to 1) is computed from the card at any moment. R decays over time on its own. This decay IS the mechanism behind a topic percentage drifting down when you stay away. There is no separate decay system.
- An item is **due** when R drops below the review threshold (FSRS default behavior).

### 5.1 Method sampling

The item is the schedulable unit, not a specific question. Each time an item comes due, the system samples one test method appropriate to that item kind (relational and ordering methods for connection, composition, and integration items, recall and application methods for atomic items) and generates or pulls a question in that method. Methods rotate so you prove the unit from different angles instead of memorizing one card. Harder methods are weighted up as the item's mastery grows. An item only reaches "mastered" after being answered correctly across several distinct methods (Section 7), which is the defense against memorizing the card rather than the knowledge.

---

## 6. Test methods

### 6.1 v1 method set

- **Cloze:** fill in the missing piece. Auto-graded. Mostly atomic items.
- **Free recall:** "explain X" in your own words. Self-graded in v1, hybrid later.
- **Application / problem:** compute, derive, or debug. Mostly self or hybrid graded.
- **Relational:** "order these steps," or "how does A relate to B." Targets connection, composition, and integration items.
- **Recognition (MCQ):** optional, auto-graded, lower weight.

### 6.2 Grading

- Objective formats (cloze, MCQ) auto-grade with no AI.
- Free recall and application: **self-grade in v1** (Again / Hard / Good / Easy after seeing the expected answer), moving to **hybrid soon** (AI proposes a grade, you can override).
- The typed answer is stored on every review from day one, so hybrid grading can be switched on later and even backfilled without losing history.

---

## 7. Mastery and coverage

### 7.1 Item status

Status is a property of items.

- **locked:** at least one prerequisite is not yet `known`.
- **learning:** unlocked, not yet passed once.
- **known:** passed at least once on at least one method, and current R above ~0.7. Enough to unlock dependents.
- **mastered:** passed on at least 2 distinct methods (3 for high-centrality items), and current R above ~0.9.

These thresholds (the R cutoffs and the method counts) are tunable defaults, editable at any time in the dashboard, not laws.

### 7.2 Gating

A concept node stays effectively `locked` until all of its prerequisites are at least `known`, where "known" means the prerequisite concept's atomic item has reached known status. Note: known, not mastered. You can move forward once the foundation is solid, you do not have to perfect it first.

### 7.3 Topic mastery (the real number)

For each item, its contribution is:
- 0 if status is `locked` or `learning`.
- its current R (from FSRS) once status is `known` or `mastered`.

Topic mastery = the weighted average of item contributions across all of the topic's items (atomic, connection, composition, integration), where each item's weight is a tunable function of the centrality and difficulty of its member nodes (multi-node items take the max or mean of their members). High-centrality, high-difficulty units count more. Connection and integration items carry a modest weight so they enrich the score without dominating it.

Properties this gives us, by design:
- It can reach 100% honestly, because the denominator (items over the frozen map) is known exactly.
- It drifts down on its own when you stay away, because R decays. That is the decay you asked for, with no extra machinery.
- It only jumps when you deliberately merge new nodes, never as a surprise.

### 7.4 Coverage (a status, not a headline number)

Coverage answers "how complete is my map versus the true full subject," whose denominator is unknowable. So coverage is never shown as a precise percentage. It is shown as three honest things:
- the scope level you declared for the topic,
- the current node count,
- the result of your last gap-search ("found 4 candidate concepts not in your map").

The number of gaps a fresh search turns up is a more honest and more actionable signal than a fake coverage percentage.

### 7.5 Integration score (kept separate)

Cross-topic connection items are not counted inside a topic's intra-topic mastery. If they were, "100% on Django" would require mastering connections into Celery and Gunicorn, making 100% unreachable. Cross-topic mastery is tracked in a separate integration score for the pair or region of topics involved. Intra-topic connection and integration items do count toward their topic's mastery.

---

## 8. Sequencing: what to learn next

The system recommends, you learn elsewhere (v1). The recommendation rule:

1. **Due reviews first.** Any item whose R has dropped below threshold.
2. **Then the frontier.** Unlearned concepts whose prerequisites are all already `known`, ordered by centrality (highest first, since those unlock the most).

This is a pure read off the graph plus the FSRS due dates. No AI call is needed for it.

---

## 9. Architecture and tech stack

### 9.1 Runtime app

- **Next.js + TypeScript.** One language, one process.
- **SQLite** for storage, single file, zero-config, bulletproof for single-user local use.
- **ts-fsrs** for all scheduling. Never hand-rolled.
- **Cytoscape.js** for the graph view. Compound (parent) nodes render the "circles" as clusters, with concepts inside them and cross-topic edges visibly bridging clusters.

### 9.2 Map generation (separate)

Map generation is a **separate local Python script** that outputs graph JSON (nodes, edges, and items) the app imports. This is where GnoRA-style multi-agent generation patterns can be reused. It keeps all the messy AI orchestration out of the daily-use runtime. Clean split: Python generates the map occasionally, the TypeScript app runs the map every day.

A useful consequence: the daily runtime is cheap (scheduling and self-grade, no AI calls unless you press "check me"). The expensive AI work happens only when you create or expand a topic.

### 9.3 Storage and traversal

The graph is stored as `nodes` and `edges` tables in SQLite, with items in their own table. Traversals you need (prerequisites, frontier, neighbors) are shallow. Load the graph into memory as an adjacency map and walk it in TypeScript, or use recursive CTEs. Both are instant at personal scale (hundreds to low thousands of nodes).

**No graph database.** Neo4j and its kin earn their place at millions of nodes with deep variable-length traversals and heavy concurrent writes. None of that applies here. SQLite plus in-memory adjacency wins on reliability and simplicity.

### 9.4 Retrieval (deferred, designed-for)

You never need every node in context, only the relevant ones, and at personal scale the relevant subset (often the whole lightweight index) fits in a generation prompt for a long time. Rough math: a lightweight node entry is about 40 tokens, so 1,000 nodes is about 40K tokens and 5,000 nodes is about 200K (the point where it stops fitting comfortably).

- **v1:** inject the full lightweight node index into the Phase 2 integration prompt. No embeddings, no retrieval.
- **Trigger to turn on retrieval:** when the node index gets too large to inject reliably (a few thousand nodes), likely year two or three of real use, if ever.
- **What retrieval buys, when on:** a duplicate pre-check (cosine-search for a near-match before adding a node) and connection-candidate retrieval (embed the new topic's seeds, pull top-K existing nodes plus their local neighborhood, feed only those to integration).
- **Where it lives:** still inside SQLite. Store embeddings as blobs and brute-force cosine in memory (milliseconds for thousands of vectors), or use the `sqlite-vec` extension. **No separate vector DB** (no Chroma, no Qdrant) for a single-user local tool.
- **Embedding source:** Voyage API (consistent with GnoRA, trivial volume and cost) or a small local model. Decide when you turn it on.

Turning retrieval on is a feature flag, not a migration, because the `embedding` field already exists. Adding it prematurely would introduce a new failure mode (connections silently never made because the relevant node was not retrieved) to solve a problem you do not yet have.

---

## 10. UI and interaction model

### 10.1 Graph view (Cytoscape)

- Clusters render as the circles. Concepts and procedures are nodes inside them.
- Cross-topic edges visibly bridge clusters.
- Node appearance encodes status: locked, learning, known, mastered, and a due indicator.
- Click a node to inspect it: description, type, parameters, edges, the items that cover it, FSRS state, R, method progress, verification flags.

### 10.2 Core flows

- **Add topic:** clarifying-question flow, scope declaration, Phase 1 generation, review and approve.
- **Append and integrate:** Phase 2 proposes cross-topic edges, connection items, and merges, you review and merge.
- **Gap-search:** button on a topic, AI proposes additions within scope, you review and merge.
- **Review session:** the system serves due items, samples a method per item, you answer, grade (self in v1), FSRS updates.
- **What to learn next:** a view that lists due reviews, then the frontier.
- **Dashboards:** per-topic mastery percentage, coverage status line, integration score.
- **Settings:** tune the known and mastered thresholds (R cutoffs and method counts) and the mastery weighting, applied immediately.

---

## 11. Concrete data schema (SQLite)

Indicative, to anchor the build. Exact column types finalized in Doc 3.

**topics**
`id, name, scope_description, scope_level, status, created_at`

**nodes**
`id, topic_id, type (concept|procedure), name, description, difficulty, centrality, verification (unverified|grounded), grounding_sensitive (bool), embedding (blob, nullable), created_at`

**edges**
`id, source_node_id, target_node_id, type, order_index (nullable, for part_of), is_cross_topic (derived), created_at`

**items** (the assessment layer, the schedulable units)
`id, kind (atomic|connection|composition|integration), topic_id, member_node_ids (json array), edge_id (nullable), ordering (nullable json, for composition), created_at`

**review_state** (FSRS card, one per item)
`item_id, due, stability, difficulty, elapsed_days, scheduled_days, reps, lapses, state, last_review`

**method_progress** (drives the mastered-across-N-methods rule, one row per item and method)
`item_id, method, times_correct, last_seen, passed (bool)`

**test_questions** (generated questions)
`id, item_id, method, prompt, expected_answer, options (nullable), verification, grounding_sensitive, created_at`

**sources** (canonical citations)
`id, url (unique), title, publisher (nullable), retrieved_at, quote (nullable), created_at`

**node_sources** (node-to-citation links)
`node_id, source_id, support (supports|partial|related|contradicts), created_at`

**reviews** (log)
`id, item_id, method, rating, graded_by (self|ai), user_answer (text), ai_grade (nullable), reviewed_at`

Topic mastery, coverage, and integration scores are computed from `items`, `review_state`, and `method_progress` at read time (optionally cached), not stored as source of truth.

---

## 12. Deferred and next features (named so nothing is lost)

- **Hybrid grading.** AI proposes a grade on free-recall and application answers, you override. Schema already stores typed answers and an `ai_grade` slot.
- **Question-level grounding.** Grounding for questions can come after node-level grounding; v1-style review still works with node-level citations only.
- **Retrieval / RAG.** Embeddings for dedup pre-check and connection-candidate retrieval. Schema already carries `embedding`.
- **Nicheness** parameter.
- **AI teaching content.** In v1 the system points you to what to learn, it does not teach. Generated teaching content is the highest hallucination-risk surface, so it waits until grounding exists.

---

## 13. Open questions to validate in v1

- Are the known and mastered thresholds (0.7 / 0.9, 2 / 3 methods) right in practice, or do they need tuning once you are reviewing daily? (Tunable in the dashboard so you can adjust live.)
- Is the centrality-and-difficulty weighting function for topic mastery satisfying, or does it over-reward hub nodes?
- Does method sampling per due item feel right, or do certain item kinds want a fixed method?
- Does the frozen-map plus gap-search loop actually keep the graph clean, or does dedup need more tooling sooner than expected?
- Do integration items (the 3-plus-node relationships) get created at a useful rate, or too rarely or too often?

These are the things v1 exists to answer.
