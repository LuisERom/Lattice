from __future__ import annotations

from typing import Any

from .llm import chat_json, fake_mode_enabled
from .stream import stream_write


def run_procedures(
    scope_payload: dict[str, Any],
    scaffold_payload: dict[str, Any],
    detailed_payload: dict[str, Any],
    edges_payload: dict[str, Any],
    model: str,
    slug: str | None = None,
) -> dict[str, Any]:
    scope = scope_payload["scope"]
    nodes = list(detailed_payload.get("nodes") or [])
    edges = list(edges_payload.get("edges") or [])
    concepts = [n for n in nodes if n.get("type") == "concept"]
    procedures = [n for n in nodes if n.get("type") == "procedure"]

    part_of_by_proc: dict[str, list[dict[str, Any]]] = {}
    for p in procedures:
        pref = p["ref"]
        part_of_by_proc[pref] = [e for e in edges if e.get("type") == "part_of" and e.get("target_ref") == pref]

    additions: list[dict[str, Any]] = []
    if fake_mode_enabled():
        for p in procedures:
            if part_of_by_proc.get(p["ref"]):
                continue
            same_section = [c for c in concepts if c.get("section_ref") == p.get("section_ref")][:3]
            for idx, c in enumerate(same_section, start=1):
                additions.append(
                    {
                        "source_ref": c["ref"],
                        "target_ref": p["ref"],
                        "type": "part_of",
                        "order_index": idx,
                    }
                )
    else:
        for p in procedures:
            if part_of_by_proc.get(p["ref"]):
                continue
            candidate_members = [c for c in concepts if c.get("section_ref") == p.get("section_ref")] or concepts[:8]
            resp = chat_json(
                [
                    {"role": "system", "content": "Return JSON only."},
                    {
                        "role": "user",
                        "content": (
                            "PHASE_F_PROCEDURE\n"
                            "Pick ordered member concepts for this procedure.\n"
                            f"SCOPE: {scope}\nPROCEDURE: {p}\nCANDIDATES: {candidate_members}\n"
                            'Return {"members":["n1","n2","n3"]} in step order.'
                        ),
                    },
                ],
                model=model,
                temperature=0.2,
            )
            members = [m for m in (resp.get("members") or []) if isinstance(m, str)]
            for idx, m in enumerate(members, start=1):
                additions.append(
                    {
                        "source_ref": m,
                        "target_ref": p["ref"],
                        "type": "part_of",
                        "order_index": idx,
                    }
                )

    # Keep existing + additions; re-ref edges contiguously.
    keep = [{k: v for k, v in e.items() if k != "ref"} for e in edges]
    keep.extend(additions)
    dedup: dict[tuple[str, str, str], dict[str, Any]] = {}
    for e in keep:
        key = (str(e.get("source_ref")), str(e.get("target_ref")), str(e.get("type")))
        dedup[key] = e
    merged = []
    for i, e in enumerate(dedup.values(), start=1):
        merged.append({"ref": f"e{i}", **e})

    members_by_proc: dict[str, list[str]] = {}
    for e in merged:
        if e.get("type") != "part_of":
            continue
        members_by_proc.setdefault(str(e["target_ref"]), []).append(str(e["source_ref"]))

    for proc_ref, members in members_by_proc.items():
        ordered = sorted(
            [e for e in merged if e.get("type") == "part_of" and e.get("target_ref") == proc_ref],
            key=lambda x: int(x.get("order_index") or 0),
        )
        members_by_proc[proc_ref] = [str(e["source_ref"]) for e in ordered]

    stream_write(slug, {"type": "procedures", "count": len(members_by_proc)})
    return {"edges": merged, "procedure_members": members_by_proc}
