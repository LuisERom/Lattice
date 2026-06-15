# Lattice — Invariants (never violated)

These are the load-bearing rules from Doc 3, Section 3. When any proposal
contradicts this file, this file wins. Doc 1 (`01-vision-and-architecture.md`)
is the spec for "why"; Doc 2 (`02-v1-scope.md`) is what is in/out of v1.

1. Build against the full Doc 1 schema, including columns v1 does not use
   (`embedding`, `verification`, cross-topic fields). Do not trim the schema to v1.
2. Every assessment table keys off `item_id`, never `node_id`. Items can cover
   one or many nodes.
3. The schedulable unit is an item, mapped one-to-one to a `ts-fsrs` card. Never
   schedule raw nodes.
4. Never implement spaced-repetition math by hand. All scheduling goes through
   `ts-fsrs`.
5. Store the user's typed answer on every review, even when empty, so AI grading
   can be added later.
6. `difficulty` and `centrality` are computed by the app after import from graph
   structure. Never trust them from the generator.
7. Generation lives only in the Python script and only emits JSON. The runtime
   app never calls an LLM in v1 (a future "check me" path is not built yet).
8. v1 is one topic. Do not build appending, cross-topic edges, integration
   items, gap-search, embeddings, grounding, or AI grading. Leave schema room,
   write none of the code.
9. Self-grade only. No auto-grading in v1.
10. Thresholds (known/mastered R cutoffs, method counts) and the mastery
    weighting are read from settings at runtime, never hardcoded.

## Architecture guardrails

- All DB access is server-side only (API routes / server actions). Never import
  `better-sqlite3` into client components.
- Database access goes through `lib/db`. Scheduling goes through `lib/fsrs`.
  Mastery/status/gating goes through `lib/mastery`. Import goes through
  `lib/import`.
