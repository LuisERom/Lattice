from __future__ import annotations

from pathlib import Path
from typing import Any

from .common import ensure_json_file
from .connectivity import prune_contract


def build_contract(
    scope_payload: dict[str, Any],
    detailed_payload: dict[str, Any],
    procedures_payload: dict[str, Any],
    items_payload: dict[str, Any],
) -> dict[str, Any]:
    scope = scope_payload["scope"]
    topic = {
        "name": scope["name"],
        "scope_description": scope["scope_description"],
        "scope_level": scope["scope_level"],
    }
    nodes = []
    for n in detailed_payload.get("nodes") or []:
        nodes.append(
            {
                "ref": n["ref"],
                "type": n["type"],
                "name": n["name"],
                "description": n.get("description", ""),
                "grounding_sensitive": bool(n.get("grounding_sensitive", False)),
            }
        )
    edges = list(procedures_payload.get("edges") or [])
    items = list(items_payload.get("items") or [])
    doc = {"topic": topic, "nodes": nodes, "edges": edges, "items": items}
    # Safety net: drop concepts that still have zero edges (and their items).
    doc, removed = prune_contract(doc)
    if removed:
        doc["_pruned_unlinked"] = removed
    return doc


def write_review_report(path: Path, audit_payload: dict[str, Any]) -> None:
    lines = ["# Generation Review Report", ""]
    errors = list(audit_payload.get("errors") or [])
    lines.append(f"- Structural errors: {len(errors)}")
    for e in errors[:50]:
        lines.append(f"  - {e}")
    lines.append("")
    pruned = list(audit_payload.get("pruned_unlinked") or [])
    lines.append(f"- Pruned unlinked concepts: {len(pruned)}")
    for ref in pruned[:50]:
        lines.append(f"  - {ref}")
    lines.append("")
    detail_flags = list(audit_payload.get("detail_flags") or [])
    lines.append(f"- Node audit flags: {len(detail_flags)}")
    for f in detail_flags[:50]:
        ref = f.get("ref", "?")
        reason = f.get("reason", "")
        sev = f.get("severity", "unknown")
        lines.append(f"  - {ref} [{sev}] {reason}")
    lines.append("")
    comp = list(audit_payload.get("completeness_flags") or [])
    lines.append(f"- Completeness critics sampled: {len(comp)}")
    for c in comp:
        lines.append(f"  - section {c.get('section_ref')}: {len(c.get('missing') or [])} potential gaps")
        for m in (c.get("missing") or [])[:10]:
            lines.append(f"    - {m}")
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text("\n".join(lines) + "\n", encoding="utf-8")


def write_generated_output(
    contract_doc: dict[str, Any],
    out_json: Path,
    out_review: Path,
    audit_payload: dict[str, Any],
) -> None:
    ensure_json_file(out_json, contract_doc)
    write_review_report(out_review, audit_payload)
