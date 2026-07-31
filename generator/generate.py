#!/usr/bin/env python3
"""Doc 4 staged generation pipeline orchestrator.

Generates a topic map through checkpointed phases:
0 scope, A scaffold, B enumerate, C dedup, D detail, E edges, F procedures,
G items, H global audit. Outputs the Doc 3 contract JSON + review report.
"""
from __future__ import annotations

import argparse
import datetime as _dt
import os
from pathlib import Path
from typing import Any

from pipeline.artifacts import phase_done, read_phase, write_phase
from pipeline.assemble import build_contract, write_generated_output
from pipeline.audit import run_global_audit
from pipeline.common import VALID_LEVELS, ask, generated_dir, repo_root, slugify
from pipeline.dedup import run_dedup
from pipeline.detail import run_detailing
from pipeline.edges import run_edges
from pipeline.enumerate_concepts import run_enumeration
from pipeline.grounding import run_grounding
from pipeline.items import run_items
from pipeline.procedures import run_procedures
from pipeline.scaffold import run_scaffold
from pipeline.scope import run_scope_interview, scope_from_args
from pipeline.stream import stream_write

PHASES = [
    "0_scope",
    "A_scaffold",
    "B_concepts",
    "C_nodes",
    "D_detailed",
    "D2_ground",
    "E_edges",
    "F_procedures",
    "G_items",
    "H_audit",
]
MAX_INTERVIEW_QUESTIONS_DEFAULT = 8


def _dry_run_prompts(subject: str, scope_level: str, scope_description: str | None) -> None:
    print("\nDoc 4 dry-run prompt map (no API calls):")
    print(" - 0_scope: AI interview returning frozen scope + include/exclude + tentative outline.")
    print(" - A_scaffold: expand scope+outline into section tree with in/out lines, gap critic.")
    print(" - B_concepts: per-section concept/procedure enumeration with per-section critic + saturation.")
    print(" - C_nodes: embed candidates, cluster by cosine, adjudicate ambiguous near-duplicates.")
    print(" - D_detailed: detail node descriptions/type/grounding/confidence + auditor flags.")
    print(" - D2_ground: selectively source risky claims, set verification, emit citations.")
    print(" - E_edges: intra-section + cross-section edge generation with missing/wrong critic.")
    print(" - F_procedures: ensure ordered part_of composition structure for procedures.")
    print(" - G_items: generate atomic/connection/composition items and per-method questions.")
    print(" - H_audit: structural validation, cycle/orphan checks, sampled completeness critics.")
    print("\nSample scope seed:")
    print(f" subject={subject!r} level={scope_level!r} description={scope_description!r}")


def _should_run_phase(slug: str, phase: str, phase_idx: int, from_idx: int | None) -> bool:
    if from_idx is not None:
        return phase_idx >= from_idx
    return not phase_done(slug, phase)


def _load_or_fail(slug: str, phase: str) -> dict[str, Any]:
    if not phase_done(slug, phase):
        raise RuntimeError(
            f"Missing required checkpoint artifacts/{slug}/{phase}.json. "
            "Run prior phases first or remove --from-phase."
        )
    return read_phase(slug, phase)


def main() -> int:
    parser = argparse.ArgumentParser(description="Generate a Lattice topic map (Doc 4 pipeline).")
    parser.add_argument("--subject")
    parser.add_argument("--model", default=os.environ.get("LATTICE_GEN_MODEL", "gpt-4o-mini"))
    parser.add_argument("--fast-model", default=os.environ.get("LATTICE_GEN_MODEL_FAST", "gpt-4o-mini"))
    parser.add_argument("--out", help="output path (default data/generated/<slug>.json)")
    parser.add_argument("--slug", help="artifact/output slug (default from subject)")
    parser.add_argument("--dry-run", action="store_true", help="print phase prompts and exit")
    parser.add_argument("--yes", action="store_true", help="skip scripted-scope confirmation")
    parser.add_argument("--resume", action="store_true", help="resume from checkpoints if present")
    parser.add_argument("--from-phase", choices=PHASES, help="re-run starting from this phase")
    parser.add_argument("--concurrency", type=int, default=4, help="parallelism for section/item phases")
    parser.add_argument(
        "--max-questions",
        type=int,
        default=MAX_INTERVIEW_QUESTIONS_DEFAULT,
        help="cap on interview questions before forcing finalization",
    )
    parser.add_argument("--no-interview", action="store_true", help="skip interview, use scripted scope")
    parser.add_argument("--scope-description", help="scope text when --no-interview is set")
    parser.add_argument(
        "--scope-level",
        choices=sorted(VALID_LEVELS),
        default="deep",
        help="scope level when --no-interview is set",
    )
    args = parser.parse_args()

    print("\nLattice - generation pipeline (Doc 4)")
    subject = args.subject or ask("Subject to map (e.g. 'Django REST Framework')")
    while not subject:
        subject = ask("Subject is required")

    if args.dry_run:
        _dry_run_prompts(subject, args.scope_level, args.scope_description)
        return 0

    slug = args.slug or slugify(subject)
    from_idx = PHASES.index(args.from_phase) if args.from_phase else None
    if args.resume:
        print(f"Resume mode enabled for slug '{slug}'.")

    artifacts: dict[str, dict[str, Any]] = {}

    try:
        return _run_phases(subject, slug, artifacts, args, from_idx)
    except Exception as exc:
        import traceback as _tb
        tb = _tb.format_exc()
        # Use ascii-safe print so Unicode arrows in tracebacks can't crash the handler on Windows.
        safe_msg = f"\n[FATAL] {exc}\n{tb}".encode("ascii", "replace").decode("ascii")
        print(safe_msg, flush=True)
        stream_write(slug, {"type": "error", "message": str(exc)})
        stream_write(slug, {"type": "done"})
        return 2


def _run_phases(
    subject: str,
    slug: str,
    artifacts: dict[str, Any],
    args: Any,
    from_idx: int | None,
) -> int:
    # 0_scope
    phase = "0_scope"
    if _should_run_phase(slug, phase, 0, from_idx):
        stream_write(slug, {"type": "phase", "name": phase})
        if args.no_interview:
            payload = scope_from_args(subject, args.scope_level, args.scope_description)
            if not args.yes:
                confirm = ask(f"Use scripted scope for '{payload['scope']['name']}'? (y/n)", "y")
                if confirm.strip().lower() not in ("y", "yes"):
                    print("Aborted.")
                    return 1
        else:
            payload = run_scope_interview(subject, args.model, args.max_questions)
        write_phase(slug, phase, payload)
        artifacts[phase] = payload
    else:
        artifacts[phase] = _load_or_fail(slug, phase)

    # A_scaffold
    phase = "A_scaffold"
    if _should_run_phase(slug, phase, 1, from_idx):
        stream_write(slug, {"type": "phase", "name": phase})
        payload = run_scaffold(artifacts["0_scope"], args.model, slug=slug)
        write_phase(slug, phase, payload)
        artifacts[phase] = payload
    else:
        artifacts[phase] = _load_or_fail(slug, phase)

    # B_concepts
    phase = "B_concepts"
    if _should_run_phase(slug, phase, 2, from_idx):
        stream_write(slug, {"type": "phase", "name": phase})
        payload = run_enumeration(
            artifacts["0_scope"],
            artifacts["A_scaffold"],
            model=args.model,
            concurrency=args.concurrency,
            slug=slug,
        )
        write_phase(slug, phase, payload)
        artifacts[phase] = payload
    else:
        artifacts[phase] = _load_or_fail(slug, phase)

    # C_nodes
    phase = "C_nodes"
    if _should_run_phase(slug, phase, 3, from_idx):
        stream_write(slug, {"type": "phase", "name": phase})
        payload = run_dedup(
            artifacts["0_scope"],
            artifacts["A_scaffold"],
            artifacts["B_concepts"],
            model=args.model,
            slug=slug,
        )
        write_phase(slug, phase, payload)
        artifacts[phase] = payload
    else:
        artifacts[phase] = _load_or_fail(slug, phase)

    # D_detailed
    phase = "D_detailed"
    if _should_run_phase(slug, phase, 4, from_idx):
        stream_write(slug, {"type": "phase", "name": phase})
        payload = run_detailing(
            artifacts["0_scope"], artifacts["C_nodes"], model=args.model, slug=slug
        )
        write_phase(slug, phase, payload)
        artifacts[phase] = payload
    else:
        artifacts[phase] = _load_or_fail(slug, phase)

    # D2_ground
    phase = "D2_ground"
    if _should_run_phase(slug, phase, 5, from_idx):
        stream_write(slug, {"type": "phase", "name": phase})
        payload = run_grounding(
            artifacts["0_scope"], artifacts["D_detailed"], model=args.model, slug=slug
        )
        write_phase(slug, phase, payload)
        artifacts[phase] = payload
    else:
        artifacts[phase] = _load_or_fail(slug, phase)

    # E_edges
    phase = "E_edges"
    if _should_run_phase(slug, phase, 6, from_idx):
        stream_write(slug, {"type": "phase", "name": phase})
        payload = run_edges(
            artifacts["0_scope"],
            artifacts["A_scaffold"],
            artifacts["D2_ground"],
            model=args.model,
            slug=slug,
        )
        write_phase(slug, phase, payload)
        artifacts[phase] = payload
    else:
        artifacts[phase] = _load_or_fail(slug, phase)

    # F_procedures
    phase = "F_procedures"
    if _should_run_phase(slug, phase, 7, from_idx):
        stream_write(slug, {"type": "phase", "name": phase})
        payload = run_procedures(
            artifacts["0_scope"],
            artifacts["A_scaffold"],
            artifacts["D2_ground"],
            artifacts["E_edges"],
            model=args.model,
            slug=slug,
        )
        write_phase(slug, phase, payload)
        artifacts[phase] = payload
    else:
        artifacts[phase] = _load_or_fail(slug, phase)

    # G_items
    phase = "G_items"
    if _should_run_phase(slug, phase, 8, from_idx):
        stream_write(slug, {"type": "phase", "name": phase})
        payload = run_items(
            artifacts["0_scope"],
            artifacts["D2_ground"],
            artifacts["F_procedures"],
            model_fast=args.fast_model,
            concurrency=args.concurrency,
            slug=slug,
        )
        write_phase(slug, phase, payload)
        artifacts[phase] = payload
    else:
        artifacts[phase] = _load_or_fail(slug, phase)

    # H_audit + assemble
    contract_doc = build_contract(
        artifacts["0_scope"],
        artifacts["D2_ground"],
        artifacts["F_procedures"],
        artifacts["G_items"],
    )
    if _should_run_phase(slug, "H_audit", 9, from_idx):
        stream_write(slug, {"type": "phase", "name": "H_audit"})
        audit_payload = run_global_audit(
            artifacts["0_scope"],
            artifacts["A_scaffold"],
            contract_doc,
            detail_flags=list(artifacts["D2_ground"].get("flags") or []),
            grounding_flags=list(artifacts["D2_ground"].get("grounding_flags") or []),
            model=args.model,
            slug=slug,
        )
        write_phase(slug, "H_audit", audit_payload)
    else:
        audit_payload = _load_or_fail(slug, "H_audit")

    root = repo_root()
    out_dir = generated_dir()
    out_dir.mkdir(parents=True, exist_ok=True)
    out_path = Path(args.out) if args.out else out_dir / f"{slug}.json"
    review_path = out_path.with_suffix(".review.md")
    write_generated_output(contract_doc, out_path, review_path, audit_payload)

    print(f"\nWrote {out_path}")
    print(f"  nodes: {len(contract_doc.get('nodes', []))}  edges: {len(contract_doc.get('edges', []))}  items: {len(contract_doc.get('items', []))}")
    print(f"  generated: {_dt.datetime.now().isoformat(timespec='seconds')}")
    print(f"  review: {review_path}")

    errors = list(audit_payload.get("errors") or [])
    if errors:
        print(f"\nWARNING: {len(errors)} validation issue(s) - review report before import.")
        for e in errors[:25]:
            print(f"   - {e}")
        stream_write(slug, {"type": "done"})
        return 3

    rel = os.path.relpath(out_path, root)
    print("\nValid. Import it with:")
    print(f"   npm run import -- {rel}")
    stream_write(slug, {"type": "done"})
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
