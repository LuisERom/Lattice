# Doc 4: Generation Pipeline

**Lattice**

How a topic's map is generated. This replaces the single-call generation step, because a single prompt cannot produce a complete, correct, connected map. Generation is a staged pipeline of small focused passes. This is the internal design of the separate Python generator from Doc 1, Section 9.2. It emits the JSON contract from Doc 3, Section 4, and never touches the database.

This is the north-star design for generation. v1 builds the subset called out in Section 17: atomic, connection, and composition items, no integration items, no grounding.

---

## 1. Design principles

- **Separate concerns.** Each pass does one thing (outline, or enumerate, or connect) with only the context that one thing needs. Small focused tasks hallucinate far less and can be verified independently.
- **Top-down for coverage, bottom-up for structure.** An outline first guarantees no whole branch is missed. Prerequisite ordering is resolved later, inside that structure.
- **Generate duplicates, then merge.** Preventing duplicates across parallel passes is futile. Let them happen and reconcile globally.
- **Critics over brute force.** A targeted "what is missing here" pass finds gaps far cheaper than re-sampling everything. Saturation is kept only as a backstop.
- **Bounded context by retrieval.** When a pass needs related nodes (dedup, cross-section edges), retrieve only the near ones, never the whole graph.
- **Bounded loops.** Every loop has a cap so cost stays finite.
- **Accuracy over cost.** The pipeline is many calls. That is the deliberate price of a complete, correct map.

---

## 2. Pipeline overview

```
subject
  |
  v
[0] scope interview ........ frozen scope + tentative outline
  |
  v
[A] scaffold ............... section tree              (gap-critic loop)
  |
  v
[B] enumerate concepts ..... per section, parallel     (saturation/critic loop)
  |
  v
[C] dedup + merge .......... canonical node set         (embeddings)
  |
  v
[D] detail nodes ........... descriptions + flags       (auditor)
  |
  v
[E] edges .................. intra + cross-section       (missing/wrong critic, embeddings)
  |
  v
[F] procedures ............. ordered compositions
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

Each phase writes a checkpoint to disk, so the pipeline is resumable and inspectable, and a failure does not lose prior work (Section 15).

---

## 3. Phase 0: Scope interview (tightened)

- **Goal:** a frozen, unambiguous boundary that also seeds the outline.
- **Context in:** the running interview conversation only.
- **Output:** frozen scope (name, inferred scope_level, scope_description, include list, exclude list) **plus a tentative section outline**. Ending with the in/out lists and the outline is the tightening: you confirm the shape of the topic, not just a paragraph.
- **Loop:** question turns until the model is confident, capped by max-questions. The human confirms; a correction re-enters the loop.

---

## 4. Phase A: Scaffold

- **Goal:** a hierarchical outline of sections and subsections within the boundary.
- **Context in:** frozen scope, plus the tentative outline from Phase 0 as a starting point.
- **Output:** a tree of sections, each with a one-line in/out description.
- **Loop:** a gap critic ("what major area inside this boundary is missing or miscoped"), revise, cap around 3.

---

## 5. Phase B: Concept enumeration (parallel)

- **Goal:** enumerate atomic concepts and candidate procedures, per section.
- **Context in (per call):** scope, one section's description, and the sibling section names so the call stays in its lane.
- **Output:** per-section lists of concept candidates (name, short description, tentative type).
- **Loop:** a per-section gap critic, and optional saturation (re-enumerate at non-zero temperature, stop when consecutive passes add under a small percent of new concepts). Runs in parallel across sections.

---

## 6. Phase C: Dedup and merge

- **Goal:** one canonical node set with no near-duplicates.
- **Method:** embed every concept candidate, cluster by cosine similarity, auto-merge clear duplicates, send only ambiguous clusters to an LLM adjudicator. Assign canonical refs and a home section.
- **Context in:** candidate names, descriptions, and their embeddings, computed locally. No whole-graph prompt.
- **Output:** the canonical concept set with stable refs.

---

## 7. Phase D: Node detailing and audit

- **Goal:** full node records.
- **Context in (batched):** scope, the concept, and its section.
- **Output, per node:** precise description, type (concept or procedure), grounding_sensitive flag, confidence.
- **Audit sub-pass:** an auditor reviews descriptions and flags uncertain or likely-wrong nodes for the human review step.
- Note: difficulty and centrality are not set here. The app computes them on import.

---

## 8. Phase E: Edges

- **Goal:** sparse, correct, typed edges.
- **E1, intra-section:** per section, given only that section's nodes, propose prerequisite_of, part_of, used_in, and the rest.
- **E2, cross-section:** per node, retrieve candidate related nodes (embedding similarity plus outline adjacency) and ask only about those candidates.
- **Critic:** "what obvious links are missing" and "are any asserted links wrong."
- **Context in:** one section's nodes for E1, or a node plus its retrieved candidates for E2. Never the whole graph.
- **Output:** the typed edge set, with order_index on part_of edges.

This is the part a single prompt served worst. It gets its own phase precisely because connections are first-class in Lattice.

---

## 9. Phase F: Procedures

- **Goal:** well-formed procedures and their composition items.
- **Context in:** each procedure node plus its candidate member concepts.
- **Output:** procedures with ordered part_of members, and the composition items over them.

---

## 10. Phase G: Items and questions (parallel)

- **Goal:** items and per-method questions.
- **Mapping:** each atomic node becomes an atomic item, each tested edge a connection item, each procedure a composition item.
- **Per item:** generate questions for that kind's available methods (Doc 2, Section 4), each with an expected answer.
- **Context in (per item):** scope and the item's node or nodes.
- **Output:** items with questions. Parallel across items.
- **v1:** atomic, connection, and composition only. Integration items deferred.

---

## 11. Phase H: Global audit and review report

- **Structural checks:** mirror the importer's validate, plus no prerequisite cycles, no orphan nodes, every item has its required number of methods.
- **Completeness critics:** run on a sample of sections.
- **Confidence report:** list the flagged nodes and edges for the human review step before import.
- **Output:** the final contract JSON, plus a sibling review report.

---

## 12. Loops and caps (consolidated)

- Scope interview: capped by max-questions (default 8, typical 3 to 6).
- Scaffold gap critic: cap around 3 iterations.
- Section enumeration: stop at the saturation threshold (consecutive passes adding under a small percent of new concepts), with a hard per-section cap.
- Edge critic: stop when the missing-links critic returns empty, with a hard cap.

Every loop has a hard cap so a runaway pass cannot spend without bound.

---

## 13. Embeddings in the generator

Used in Phase C (dedup) and Phase E2 (edge candidates). They live entirely inside the generator. The runtime app's embedding field stays empty in v1, so this does not contradict Doc 1's deferral. The generator is separate, so it can use embeddings internally now. Source is Voyage API (consistent with GnoRA, trivial volume) or a local model, decided at build time.

---

## 14. Models, temperature, and cost

- Use the strongest available model for the reasoning-heavy phases: scaffold, dedup adjudication, edges, and all critics.
- A faster, cheaper model is allowed for the high-volume per-item question generation in Phase G.
- Low temperature for structural phases. Non-zero temperature for enumeration saturation, so repeated passes explore different concepts rather than repeating themselves.
- Expect dozens to a few hundred calls for a large topic. Parallelism keeps wall-clock time reasonable. This call count is the intended cost of completeness, which is the stated priority.

---

## 15. Intermediate artifacts and resumability

Each phase writes to `generator/artifacts/<slug>/<phase>.json`. The orchestrator can resume from the last completed phase, which matters for a long pipeline. Final assembly stitches the canonical nodes, edges, items, and questions into the Doc 3 contract and writes `data/generated/<slug>.json`.

---

## 16. Output

The same JSON contract as Doc 3, Section 4, consumed by the unchanged importer (`npm run import`). Difficulty and centrality are left for the importer to compute. Alongside it, a review report lists the flagged nodes and edges for your eyes before import.

---

## 17. Generation invariants

- JSON only. The generator never touches the database.
- Difficulty and centrality are computed by the app on import, never trusted from the generator.
- All nodes start `unverified`.
- v1 emits atomic, connection, and composition items only. Integration items and grounding are deferred, but the pipeline is designed to accommodate them as additional passes later.
- Every loop is capped.
