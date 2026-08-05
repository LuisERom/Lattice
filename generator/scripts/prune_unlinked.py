#!/usr/bin/env python3
"""Prune concept nodes with zero edges from a generated contract JSON.

Usage:
  python generator/scripts/prune_unlinked.py path/to/topic.json
  python generator/scripts/prune_unlinked.py path/to/topic.json --in-place
"""
from __future__ import annotations

import argparse
import json
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from pipeline.connectivity import prune_contract, unlinked_refs
from pipeline.validate import find_orphan_nodes


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("path", type=Path, help="contract JSON path")
    parser.add_argument(
        "--in-place",
        action="store_true",
        help="overwrite the input file (writes <stem>.pre-prune.json backup)",
    )
    parser.add_argument(
        "--out",
        type=Path,
        help="output path (default: <stem>.pruned.json unless --in-place)",
    )
    args = parser.parse_args()

    doc = json.loads(args.path.read_text(encoding="utf-8"))
    before = unlinked_refs(doc.get("nodes") or [], doc.get("edges") or [])
    print(f"Before: {len(doc.get('nodes') or [])} nodes, {len(before)} unlinked")

    pruned, removed = prune_contract(doc)
    after = unlinked_refs(pruned.get("nodes") or [], pruned.get("edges") or [])
    print(f"Removed {len(removed)} unlinked concept(s)")
    print(f"After:  {len(pruned.get('nodes') or [])} nodes, {len(after)} unlinked")
    for ref in removed[:30]:
        print(f"  - {ref}")
    if len(removed) > 30:
        print(f"  … +{len(removed) - 30} more")

    orphans = find_orphan_nodes(pruned)
    if orphans:
        print("WARNING: remaining orphans (likely unlinked procedures):")
        for e in orphans:
            print(f"  - {e}")

    if args.in_place:
        backup = args.path.with_suffix(".pre-prune.json")
        backup.write_text(args.path.read_text(encoding="utf-8"), encoding="utf-8")
        out = args.path
        print(f"Backup: {backup}")
    else:
        out = args.out or args.path.with_name(args.path.stem + ".pruned.json")

    out.write_text(json.dumps(pruned, indent=2, ensure_ascii=False) + "\n", encoding="utf-8")
    print(f"Wrote {out}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
