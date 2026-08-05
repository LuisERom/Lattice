# Lattice — Personal Knowledge Mastery System (v1)

Maps a subject into a structured knowledge graph, drives genuine mastery of that
graph through spaced repetition (FSRS), and reports an honest per-topic mastery
number.

The design lives in four docs, which are the source of truth:

- `01-vision-and-architecture.md` — the full north-star spec ("why").
- `02-v1-scope.md` — exactly what v1 includes / defers, and the acceptance criteria.
- `03-build-plan.md` — the milestone build order.
- `04-generation-pipeline.md` — the staged map-generation architecture.
- `RULES.md` — the invariants that must never be violated.

## Stack

- **Next.js + TypeScript** (App Router) — one app, server-side DB access only.
- **SQLite** via `better-sqlite3` — single local file, full Doc 1 schema.
- **ts-fsrs** — all scheduling. Spaced-repetition math is never hand-rolled.
- **Cytoscape** — the graph view, colored by mastery status.
- **Python generator** — a separate script that emits the import JSON (no LLM in
  the daily runtime).

## Quick start

```bash
npm install
npm run db:init      # create data/lattice.db from db/schema.sql + seed settings
npm run import       # import the hand-authored data/seed-topic.json
npm run dev          # http://localhost:3000
```

Pages: Dashboard (`/`), Graph (`/graph`), Review (`/review`), What to learn next
(`/next`), Settings (`/settings`).

## Scripts

| Command | What it does |
| --- | --- |
| `npm run db:init` | Create the database and seed default settings |
| `npm run db:reset` | Delete and recreate the database |
| `npm run import [-- file.json]` | Import a contract JSON (default seed) |
| `npm run dev` / `build` / `start` | Next.js dev / production build / serve |
| `npm test` | Unit tests (derived params + mastery math) |

Verification scripts mapping to the Doc 2 acceptance criteria live in `scripts/`
(`verify-m2.ts`, `verify-m3.ts`, `verify-m5.ts`) and run on isolated temp DBs.

## Generating a real topic (Doc 4 pipeline)

The generator is a standalone Python script (standard library only; no pip
dependencies). It now follows the staged pipeline from `04-generation-pipeline.md`:

- `0_scope` interview -> frozen scope + tentative outline
- `A_scaffold` capability / learning-goal areas + gap critic
- `B_seeds` small per-section goal seeds (procedures + capstones)
- `C_expand` prerequisite BFS (nodes + `prerequisite_of`, embed-merge)
- `D_detailed` node detailing + auditor
- `E_edges` lateral edges on the prereq spine + critic/coverage
- `F_procedures` ordered compositions
- `G_items` per-item question generation (parallel)
- `H_audit` structural/completeness checks + review report

Each phase checkpoints under `LATTICE_DATA_DIR/artifacts/<slug>/` (or
`generator/artifacts/`), so runs are resumable. Final output is the import
contract in `generated/<slug>.json`, plus `<slug>.review.md`.

Older `B_concepts` / `C_nodes` checkpoints are from the previous enumerate-then-link
pipeline and are not compatible — start a new slug or `--from-phase B_seeds`.

A virtualenv isn't required (zero third-party deps) but is recommended hygiene:

```bash
py -m venv .venv
.\.venv\Scripts\python.exe generator/generate.py --dry-run --subject "Celery"
# (no pip install step — nothing to install)
```

```bash
# Inspect the prompt without calling any API:
python generator/generate.py --dry-run --subject "Celery"

# Real generation (interactive scope interview):
setx OPENAI_API_KEY "sk-..."      # or $env:OPENAI_API_KEY in PowerShell
setx VOYAGE_API_KEY "voyage-..."  # embeddings used in C_expand / E
python generator/generate.py      # interactive
# -> writes generated/<slug>.json and <slug>.review.md, then:
npm run import -- path/to/generated/<slug>.json
```

Useful flags:

```bash
# Scripted boundary (no interview)
python generator/generate.py --subject "Celery" --no-interview --scope-description "..." --yes

# Resume/checkpoint behavior
python generator/generate.py --subject "Celery" --slug "celery" --resume
python generator/generate.py --subject "Celery" --slug "celery" --from-phase C_expand
```

Config env vars:

- `OPENAI_API_KEY` (required for live LLM calls)
- `OPENAI_BASE_URL` (default `https://api.openai.com/v1`)
- `LATTICE_GEN_MODEL` (default `gpt-4o-mini`, reasoning-heavy phases)
- `LATTICE_GEN_MODEL_FAST` (default `gpt-4o-mini`, high-volume item generation)
- `VOYAGE_API_KEY` (required for embeddings in phases C/E2)
- `VOYAGE_BASE_URL` (default `https://api.voyageai.com/v1`)
- `VOYAGE_MODEL` (default `voyage-3-lite`)
- `LATTICE_FAKE_LLM=1` (optional offline mock harness for pipeline/resume testing)

## Project layout

```
app/                 Next.js routes, pages, and API handlers
lib/
  db/                connection + schema application
  fsrs/              ts-fsrs wrapper (the only scheduling code)
  import/            JSON import + derived difficulty/centrality
  mastery/           status, gating, topic-mastery computation
  review/            due query, method sampling, self-rate submit
  sequencing/        what-to-learn-next
  dashboard/         dashboard read model
  settings.ts        live-tunable thresholds + weighting
db/schema.sql        the full Doc 1 schema
data/seed-topic.json hand-authored topic for building and testing
generator/generate.py Doc 4 pipeline orchestrator
generator/pipeline/   phase modules + embeddings + validators + artifacts
scripts/             db init/import + acceptance verification
tests/               unit tests
```
