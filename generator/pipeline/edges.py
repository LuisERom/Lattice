from __future__ import annotations

from collections import defaultdict
from typing import Any

from .embeddings import cosine, embed_texts
from .llm import chat_json, fake_mode_enabled
from .stream import stream_write


def _edge_key(e: dict[str, Any]) -> tuple[str, str, str]:
    return (str(e.get("source_ref")), str(e.get("target_ref")), str(e.get("type")))


def _normalize_edges(raw_edges: list[Any]) -> list[dict[str, Any]]:
    out: list[dict[str, Any]] = []
    for e in raw_edges:
        if not isinstance(e, dict):
            continue
        et = str(e.get("type") or "").strip()
        if et not in {"prerequisite_of", "part_of", "used_in", "causes", "contrasts_with", "analogous_to"}:
            continue
        src = str(e.get("source_ref") or "").strip()
        tgt = str(e.get("target_ref") or "").strip()
        if not src or not tgt or src == tgt:
            continue
        edge = {"source_ref": src, "target_ref": tgt, "type": et, "order_index": e.get("order_index")}
        out.append(edge)
    return out


def _adjacent_section_refs(sections: list[dict[str, Any]], ref: str) -> set[str]:
    adjacent = {ref}
    by_parent: dict[str, list[str]] = defaultdict(list)
    parent_of: dict[str, str] = {}
    for s in sections:
        r = str(s["ref"])
        p = str(s.get("parent") or "")
        if p:
            by_parent[p].append(r)
            parent_of[r] = p
    p = parent_of.get(ref)
    if p:
        adjacent.add(p)
        adjacent.update(by_parent.get(p, []))
    adjacent.update(by_parent.get(ref, []))
    return adjacent


def run_edges(
    scope_payload: dict[str, Any],
    scaffold_payload: dict[str, Any],
    detailed_payload: dict[str, Any],
    model: str,
    critic_cap: int = 3,
    slug: str | None = None,
) -> dict[str, Any]:
    scope = scope_payload["scope"]
    sections = list(scaffold_payload.get("sections") or [])
    nodes = list(detailed_payload.get("nodes") or [])
    by_section: dict[str, list[dict[str, Any]]] = defaultdict(list)
    for n in nodes:
        by_section[str(n.get("section_ref") or "")].append(n)

    collected: dict[tuple[str, str, str], dict[str, Any]] = {}

    if fake_mode_enabled():
        # Minimal deterministic structure for offline flow.
        concepts = [n for n in nodes if n.get("type") == "concept"]
        for i in range(len(concepts) - 1):
            e = {"source_ref": concepts[i]["ref"], "target_ref": concepts[i + 1]["ref"], "type": "prerequisite_of", "order_index": None}
            collected[_edge_key(e)] = e
            stream_write(
                slug,
                {
                    "type": "edge",
                    "ref": f"e{i + 1}",
                    "source": e["source_ref"],
                    "target": e["target_ref"],
                    "edge_type": e["type"],
                    "order_index": e.get("order_index"),
                },
            )
        return {"edges": [{"ref": f"e{i+1}", **e} for i, e in enumerate(collected.values())]}

    # E1: intra-section
    for section in sections:
        sref = str(section["ref"])
        s_nodes = by_section.get(sref, [])
        if len(s_nodes) < 2:
            continue
        resp = chat_json(
            [
                {"role": "system", "content": "Return JSON only."},
                {
                    "role": "user",
                    "content": (
                        "PHASE_E_SECTION\n"
                        "Propose sparse typed edges among these section-local nodes.\n"
                        f"SCOPE: {scope}\nSECTION: {section}\nNODES: {s_nodes}\n"
                        'Return {"edges":[{"source_ref":"n1","target_ref":"n2","type":"prerequisite_of|part_of|used_in|causes|contrasts_with|analogous_to","order_index":null}]}.'
                    ),
                },
            ],
            model=model,
            temperature=0.2,
        )
        for e in _normalize_edges(list(resp.get("edges") or [])):
            collected[_edge_key(e)] = e
            stream_write(
                slug,
                {
                    "type": "edge",
                    "source": e["source_ref"],
                    "target": e["target_ref"],
                    "edge_type": e["type"],
                    "order_index": e.get("order_index"),
                },
            )

    # E2: cross-section candidate retrieval by embeddings + section adjacency.
    texts = [f"{n.get('name','')}\n{n.get('description','')}" for n in nodes]
    vectors = embed_texts(texts) if nodes else []
    node_index = {n["ref"]: i for i, n in enumerate(nodes)}

    for n in nodes:
        i = node_index[n["ref"]]
        sims: list[tuple[float, dict[str, Any]]] = []
        local_adj = _adjacent_section_refs(sections, str(n.get("section_ref") or ""))
        for other in nodes:
            if other["ref"] == n["ref"]:
                continue
            same_or_adj = str(other.get("section_ref") or "") in local_adj
            sim = cosine(vectors[i], vectors[node_index[other["ref"]]]) if vectors else 0.0
            if sim > 0.55 or same_or_adj:
                sims.append((sim, other))
        sims.sort(key=lambda x: x[0], reverse=True)
        candidates = [o for _, o in sims[:8]]
        if not candidates:
            continue
        resp = chat_json(
            [
                {"role": "system", "content": "Return JSON only."},
                {
                    "role": "user",
                    "content": (
                        "PHASE_E_NODE\n"
                        "Propose cross-section edges for this node against retrieved candidates only.\n"
                        f"SCOPE: {scope}\nNODE: {n}\nCANDIDATES: {candidates}\n"
                        'Return {"edges":[...]} in the same edge shape.'
                    ),
                },
            ],
            model=model,
            temperature=0.2,
        )
        for e in _normalize_edges(list(resp.get("edges") or [])):
            collected[_edge_key(e)] = e
            stream_write(
                slug,
                {
                    "type": "edge",
                    "source": e["source_ref"],
                    "target": e["target_ref"],
                    "edge_type": e["type"],
                    "order_index": e.get("order_index"),
                },
            )

    edges = list(collected.values())
    for _ in range(critic_cap):
        critique = chat_json(
            [
                {"role": "system", "content": "Return JSON only."},
                {
                    "role": "user",
                    "content": (
                        "PHASE_E_CRITIC\n"
                        "Review edge set for obvious missing links or wrong links.\n"
                        f"SCOPE: {scope}\nNODES: {nodes}\nEDGES: {edges}\n"
                        'Return {"add":[...edges...],"remove":[{"source_ref":"...","target_ref":"...","type":"..."}]}.'
                    ),
                },
            ],
            model=model,
            temperature=0.1,
        )
        adds = _normalize_edges(list(critique.get("add") or []))
        removes = {_edge_key(x) for x in _normalize_edges(list(critique.get("remove") or []))}
        for e in adds:
            collected[_edge_key(e)] = e
            stream_write(
                slug,
                {
                    "type": "edge",
                    "source": e["source_ref"],
                    "target": e["target_ref"],
                    "edge_type": e["type"],
                    "order_index": e.get("order_index"),
                },
            )
        for r in removes:
            collected.pop(r, None)
        if not adds and not removes:
            break
        edges = list(collected.values())

    final_edges = []
    for i, e in enumerate(collected.values(), start=1):
        final_edges.append({"ref": f"e{i}", **e})
    for e in final_edges:
        stream_write(
            slug,
            {
                "type": "edge",
                "ref": e["ref"],
                "source": e["source_ref"],
                "target": e["target_ref"],
                "edge_type": e["type"],
                "order_index": e.get("order_index"),
            },
        )
    return {"edges": final_edges}
