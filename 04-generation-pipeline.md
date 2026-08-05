# Doc 4: Generation Pipeline

**Lattice**

How a topic's map is generated. Generation is a staged pipeline of small focused passes. This is the internal design of the separate Python generator from Doc 1, Section 9.2. It emits the JSON contract from Doc 3, Section 4, and never touches the database.

This is the north-star design for generation. v1 builds the subset called out in Section 17: atomic, connection, and composition items, no integration items, no grounding.

---

## 1. Design principles

- **Separate concerns.** Each pass does one thing with only the context that one thing needs.
- **Goals first, then prerequisites.** A light top-down scaffold names *what mastery means* (capability areas and seed goals). The node set then grows by asking, for each goal, what must be known before it — recursively, inside the frozen scope.
- **Prerequisites are structure, not a labeling pass.** `prerequisite_of` edges are created as nodes are discovered. Inventory-then-link is rejected: a concept that nothing requires (and that requires nothing in-scope) should not enter the map.
- **Generate duplicates, then merge.** Parallel discovery and shared foundations create near-duplicates. Merge by embedding similarity as the graph grows.
- **Critics over brute force.** Targeted "what is missing" passes beat re-sampling everything.
- **Bounded context by retrieval.** Cross-links retrieve near neighbors, never the whole graph.
- **Bounded loops.** Every loop has a cap (depth, node budget, critic rounds) so cost stays finite.
- **Accuracy over cost.** Many small calls are the deliberate price of a connected, learnable map.

---

## 2. Pipeline overview

```
subject
  |
  v
[0] scope interview ........ frozen scope + tentative outline
  |
  v
[A] scaffold ............... capability / goal areas     (gap-critic loop)
  |
  v
[B] seed goals ............. per section: procedures + capstones (small)
  |
  v
[C] prereq expand .......... BFS: "what must be known before this?"
  |                          (+ embed-merge, depth + node caps)
  |                          emits nodes + prerequisite_of edges
  v
[D] detail nodes ........... descriptions + flags       (auditor)
  |
  v
[E] lateral edges .......... used_in / causes / contrasts / …
  |                          (prereqs already exist; critic + coverage)
  v
[F] procedures ............. ordered part_of compositions
  |
  v
[G] items + questions ...... per unit, parallel
  |
  v
[H] global audit ........... structural + completeness + confidence report
  |
  v
contract JSON --> npm run import --> topic in SQLite
```

Each phase writes a checkpoint to disk, so the pipeline is resumable and inspectable (Section 15).

**Why not enumerate-then-link?** That approach produced large concept inventories with many zero-edge nodes. The runtime gates learning on prerequisites; generation now grows the same spine.

---

## 3. Phase 0: Scope interview

- **Goal:** a frozen, unambiguous boundary that also seeds the outline.
- **Context in:** the running interview conversation only.
- **Output:** frozen scope (name, inferred scope_level, scope_description, include list, exclude list) **plus a tentative section outline**.
- **Loop:** question turns until the model is confident, capped by max-questions. The human confirms; a correction re-enters the loop.

---

## 4. Phase A: Scaffold (capability areas)

- **Goal:** a hierarchical outline of *capability / learning-goal areas* inside the boundary — not a dump of every concept.
- **Context in:** frozen scope, plus the tentative outline from Phase 0.
- **Output:** a tree of sections, each with a one-line in/out description (what mastery in this area includes / excludes).
- **Loop:** a gap critic ("what major capability inside this boundary is missing or miscoped"), revise, cap around 3.

---

## 5. Phase B: Seed goals (small)

- **Goal:** a small set of **seeds** per section — the things the learner is aiming at.
- **Per section, typically:** 1–2 procedures and 1–3 capstone concepts (not dozens of atoms).
- **Context in:** scope, one section, sibling section names.
- **Output:** seed candidates (`name`, `description`, `tentative_type`, `section_ref`).
- **Loop:** a light gap critic for missing *goals* (not a saturation dump of every related term).
- **Rule:** seeds are learning targets. Foundations appear later when expansion asks for prerequisites.

---

## 6. Phase C: Prerequisite expansion

- **Goal:** grow the canonical node set and the `prerequisite_of` spine together.
- **Method:**
  1. Start a queue with all seeds (depth 0).
  2. For each dequeued node, ask: *what are the direct in-scope prerequisites of this node?* (small set, typically 0–5).
  3. For each proposed prerequisite: embed-merge into an existing node if near-duplicate; otherwise create a new node, enqueue it at depth+1, and add `prerequisite_of` (prereq → dependent).
  4. Stop expanding a branch when depth hits the level cap, the model marks the node foundational within scope, or the global node budget is reached.
- **Caps by scope_level (defaults):**

  | level | max depth | max nodes |
  |-------|-----------|-----------|
  | working | 4 | 80 |
  | deep | 6 | 200 |
  | exam-ready | 8 | 350 |

- **Context in (per expand call):** scope, the node, a short list of already-known nearby node names (retrieval), never the whole graph.
- **Output:** canonical nodes with stable refs, plus the `prerequisite_of` edge set.
- **Invariant:** every non-seed node is introduced by at least one prerequisite edge. Seeds with no prereqs are allowed as roots; later phases attach procedures / lateral links. Concepts that remain degree-0 after procedures are pruned (safety net).

---

## 7. Phase D: Node detailing and audit

- **Goal:** full node records.
- **Context in (batched):** scope, the concept, and its section.
- **Output, per node:** precise description, type (concept or procedure), grounding_sensitive flag, confidence.
- **Audit sub-pass:** an auditor flags uncertain or likely-wrong nodes for human review.
- Note: difficulty and centrality are not set here. The app computes them on import.

---

## 8. Phase E: Lateral edges

- **Goal:** sparse, correct *non-prerequisite* structure on the already-grown graph.
- **Starts from:** Phase C's `prerequisite_of` edges (kept).
- **Adds:** `used_in`, `causes`, `contrasts_with`, `analogous_to` (and `part_of` only when obvious; Phase F owns procedure composition).
- **E1 / E2:** intra-section and retrieval-based cross-section proposals among existing nodes only — **do not invent new nodes**.
- **Critic:** wrong links and nodes still missing an obvious lateral or prerequisite link.
- **Coverage:** every node must participate in at least one edge before items are generated; remaining isolates are pruned after Phase F.

---

## 9. Phase F: Procedures

- **Goal:** well-formed procedures and their composition structure.
- **Context in:** each procedure node plus candidate member concepts (prefer nodes already on its prerequisite cone).
- **Output:** ordered `part_of` members; composition items are created in Phase G.

---

## 10. Phase G: Items and questions (parallel)

- **Goal:** items and per-method questions.
- **Mapping:** each atomic node → atomic item; each tested non-`part_of` edge → connection item; each procedure → composition item.
- **Per item:** questions for that kind's methods (Doc 2, Section 4), each with an expected answer.
- **v1:** atomic, connection, and composition only. Integration items deferred.

---

## 11. Phase H: Global audit and review report

- **Structural checks:** no prerequisite cycles, no orphan nodes (zero edges), required methods per item.
- **Completeness critics:** sample sections / seed goals — is each goal reachable via prerequisite paths from foundations?
- **Confidence report:** flagged nodes and edges for human review before import.
- **Output:** final contract JSON plus sibling review report.

---

## 12. Loops and caps (consolidated)

- Scope interview: capped by max-questions (default 8).
- Scaffold gap critic: cap around 3 iterations.
- Seed gap critic: one revise pass for missing goals (no concept-saturation loop).
- Prerequisite expansion: per-level depth + node budget; per-node prereq ask bounded.
- Edge critic / coverage: hard cap on rounds.

---

## 13. Embeddings in the generator

Used in Phase C (merge while expanding) and Phase E (lateral-edge candidates). They live entirely inside the generator. The runtime app's `embedding` field stays empty in v1.

---

## 14. Models, temperature, and cost

- Strongest available model for scaffold, expansion, edges, and critics.
- Faster model allowed for Phase G question generation.
- Low temperature for structural phases.
- Expect dozens to a few hundred calls for a large topic. Parallelism where safe (seeds per section, items). Call count is the intended cost of a connected map.

---

## 15. Intermediate artifacts and resumability

Each phase writes to `artifacts/<slug>/<phase>.json` (under `LATTICE_DATA_DIR` when set). The orchestrator can resume from the last completed phase. Final assembly writes `generated/<slug>.json`.

Phase ids: `0_scope`, `A_scaffold`, `B_seeds`, `C_expand`, `D_detailed`, `E_edges`, `F_procedures`, `G_items`, `H_audit`.

Older checkpoints named `B_concepts` / `C_nodes` are from the previous enumerate-then-link pipeline and are not compatible — re-run from `B_seeds` or start a new slug.

---

## 16. Output

The same JSON contract as Doc 3, Section 4, consumed by the importer (`npm run import`). Difficulty and centrality are left for the importer. A review report lists flags and any pruned unlinked concepts.

---

## 17. Generation invariants

- JSON only. The generator never touches the database.
- Difficulty and centrality are computed by the app on import, never trusted from the generator.
- All nodes start `unverified`.
- v1 emits atomic, connection, and composition items only.
- Every loop is capped.
- Nodes are grown for goals and prerequisites; they are not brainstormed as an unconnected inventory.
