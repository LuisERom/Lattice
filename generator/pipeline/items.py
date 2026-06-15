from __future__ import annotations

from concurrent.futures import ThreadPoolExecutor, as_completed
from typing import Any

from .common import METHODS_BY_KIND
from .llm import chat_json, fake_mode_enabled
from .stream import stream_write


def _atomic_specs(nodes: list[dict[str, Any]]) -> list[dict[str, Any]]:
    return [
        {"kind": "atomic", "member_node_refs": [n["ref"]], "edge_ref": None, "ordering": None}
        for n in nodes
        if n.get("type") == "concept"
    ]


def _connection_specs(edges: list[dict[str, Any]]) -> list[dict[str, Any]]:
    out = []
    for e in edges:
        if e.get("type") in {"prerequisite_of", "used_in", "causes", "contrasts_with", "analogous_to"}:
            out.append(
                {
                    "kind": "connection",
                    "member_node_refs": [e["source_ref"], e["target_ref"]],
                    "edge_ref": e.get("ref"),
                    "ordering": None,
                }
            )
    return out


def _composition_specs(
    nodes: list[dict[str, Any]], procedure_members: dict[str, list[str]]
) -> list[dict[str, Any]]:
    out = []
    for p in nodes:
        if p.get("type") != "procedure":
            continue
        members = procedure_members.get(str(p["ref"]), [])
        if not members:
            continue
        out.append(
            {
                "kind": "composition",
                "member_node_refs": [p["ref"], *members],
                "edge_ref": None,
                "ordering": members,
            }
        )
    return out


def _fallback_questions(spec: dict[str, Any], node_map: dict[str, dict[str, Any]]) -> list[dict[str, Any]]:
    kind = spec["kind"]
    methods = sorted(METHODS_BY_KIND[kind])
    title = " / ".join(node_map.get(r, {"name": r})["name"] for r in spec["member_node_refs"])
    questions = []
    for m in methods:
        prompt = f"[{m}] Explain: {title}"
        if m == "cloze":
            prompt = f"{title} includes ____."
        questions.append(
            {
                "method": m,
                "prompt": prompt,
                "expected_answer": f"Expected answer for {title} ({m})",
                "options": None,
            }
        )
    return questions


def _gen_item_questions(
    scope: dict[str, Any],
    spec: dict[str, Any],
    node_map: dict[str, dict[str, Any]],
    edge_map: dict[str, dict[str, Any]],
    model: str,
) -> list[dict[str, Any]]:
    if fake_mode_enabled():
        return _fallback_questions(spec, node_map)

    methods = sorted(METHODS_BY_KIND[spec["kind"]])
    context_nodes = [node_map.get(r, {"ref": r, "name": r}) for r in spec["member_node_refs"]]
    edge = edge_map.get(str(spec.get("edge_ref"))) if spec.get("edge_ref") else None
    resp = chat_json(
        [
            {"role": "system", "content": "Return JSON only."},
            {
                "role": "user",
                "content": (
                    "PHASE_G_ITEM\n"
                    "Generate one question per allowed method for this item.\n"
                    f"SCOPE: {scope}\nITEM SPEC: {spec}\nNODES: {context_nodes}\nEDGE: {edge}\n"
                    f"ALLOWED METHODS: {methods}\n"
                    'Return {"questions":[{"method":"...","prompt":"...","expected_answer":"...","options":null}]}.'
                ),
            },
        ],
        model=model,
        temperature=0.4,
    )
    out = []
    by_method: dict[str, dict[str, Any]] = {}
    for q in list(resp.get("questions") or []):
        m = str(q.get("method") or "")
        if m in methods and m not in by_method:
            by_method[m] = {
                "method": m,
                "prompt": str(q.get("prompt") or ""),
                "expected_answer": str(q.get("expected_answer") or ""),
                "options": q.get("options"),
            }
    for m in methods:
        if m in by_method:
            out.append(by_method[m])
        else:
            out.extend([q for q in _fallback_questions(spec, node_map) if q["method"] == m])
    return out


def run_items(
    scope_payload: dict[str, Any],
    detailed_payload: dict[str, Any],
    procedures_payload: dict[str, Any],
    model_fast: str,
    concurrency: int = 6,
    slug: str | None = None,
) -> dict[str, Any]:
    scope = scope_payload["scope"]
    nodes = list(detailed_payload.get("nodes") or [])
    edges = list(procedures_payload.get("edges") or [])
    proc_members = dict(procedures_payload.get("procedure_members") or {})

    node_map = {n["ref"]: n for n in nodes}
    edge_map = {e["ref"]: e for e in edges if e.get("ref")}
    specs = _atomic_specs(nodes) + _connection_specs(edges) + _composition_specs(nodes, proc_members)

    items: list[dict[str, Any]] = [None] * len(specs)  # type: ignore[list-item]
    with ThreadPoolExecutor(max_workers=max(1, concurrency)) as ex:
        future_map = {
            ex.submit(_gen_item_questions, scope, spec, node_map, edge_map, model_fast): i
            for i, spec in enumerate(specs)
        }
        for fut in as_completed(future_map):
            idx = future_map[fut]
            spec = specs[idx]
            questions = fut.result()
            items[idx] = {
                "ref": f"i{idx + 1}",
                "kind": spec["kind"],
                "member_node_refs": spec["member_node_refs"],
                "edge_ref": spec.get("edge_ref"),
                "ordering": spec.get("ordering"),
                "questions": questions,
            }
    stream_write(slug, {"type": "items", "count": len(items)})
    return {"items": items}
