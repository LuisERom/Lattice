from __future__ import annotations

from collections import defaultdict
from typing import Any

from .connectivity import degree_by_ref
from .embeddings import cosine, embed_texts
from .llm import chat_json, fake_mode_enabled
from .stream import stream_write

_EDGE_RULES = (
    "Prerequisite_of edges already exist from expansion — keep them unless clearly wrong. "
    "Prefer lateral types: used_in, causes, contrasts_with, analogous_to. "
    "Do not invent new nodes. Do not invent weak analogies just to fill degree. "
    "EVERY node must participate in at least one edge."
)


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


def _record_edges(
    collected: dict[tuple[str, str, str], dict[str, Any]],
    raw: list[Any],
    slug: str | None,
) -> int:
    added = 0
    for e in _normalize_edges(raw):
        key = _edge_key(e)
        if key in collected:
            continue
        collected[key] = e
        added += 1
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
    return added


def _top_candidates(
    node: dict[str, Any],
    nodes: list[dict[str, Any]],
    node_index: dict[str, int],
    vectors: list[Any],
    sections: list[dict[str, Any]],
    limit: int = 10,
) -> list[dict[str, Any]]:
    i = node_index[node["ref"]]
    local_adj = _adjacent_section_refs(sections, str(node.get("section_ref") or ""))
    sims: list[tuple[float, dict[str, Any]]] = []
    for other in nodes:
        if other["ref"] == node["ref"]:
            continue
        same_or_adj = str(other.get("section_ref") or "") in local_adj
        sim = cosine(vectors[i], vectors[node_index[other["ref"]]]) if vectors else 0.0
        if sim > 0.45 or same_or_adj:
            sims.append((sim + (0.15 if same_or_adj else 0.0), other))
    sims.sort(key=lambda x: x[0], reverse=True)
    return [o for _, o in sims[:limit]]


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
    prior_edges_payload: dict[str, Any] | None = None,
) -> dict[str, Any]:
    """Phase E: keep prerequisite spine from expansion; add lateral edges only."""
    scope = scope_payload["scope"]
    sections = list(scaffold_payload.get("sections") or [])
    nodes = list(detailed_payload.get("nodes") or [])
    by_section: dict[str, list[dict[str, Any]]] = defaultdict(list)
    for n in nodes:
        by_section[str(n.get("section_ref") or "")].append(n)

    collected: dict[tuple[str, str, str], dict[str, Any]] = {}
    prior = list((prior_edges_payload or {}).get("edges") or [])
    _record_edges(collected, prior, slug=None)  # seed without re-streaming

    if fake_mode_enabled():
        if not collected:
            concepts = [n for n in nodes if n.get("type") == "concept"]
            for i in range(len(concepts) - 1):
                e = {
                    "source_ref": concepts[i]["ref"],
                    "target_ref": concepts[i + 1]["ref"],
                    "type": "prerequisite_of",
                    "order_index": None,
                }
                collected[_edge_key(e)] = e
        final = [{"ref": f"e{i+1}", **e} for i, e in enumerate(collected.values())]
        return {"edges": final, "uncovered_refs": []}

    # E1: intra-section lateral links
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
                        "Propose LATERAL typed edges among these section-local nodes.\n"
                        f"{_EDGE_RULES}\n"
                        f"SCOPE: {scope}\nSECTION: {section}\nNODES: {s_nodes}\n"
                        'Return {"edges":[{"source_ref":"n1","target_ref":"n2","type":"used_in|causes|contrasts_with|analogous_to|prerequisite_of|part_of","order_index":null}]}.'
                    ),
                },
            ],
            model=model,
            temperature=0.2,
        )
        _record_edges(collected, list(resp.get("edges") or []), slug)

    # E2: cross-section candidate retrieval by embeddings + section adjacency.
    texts = [f"{n.get('name','')}\n{n.get('description','')}" for n in nodes]
    vectors = embed_texts(texts) if nodes else []
    node_index = {n["ref"]: i for i, n in enumerate(nodes)}

    for n in nodes:
        candidates = _top_candidates(n, nodes, node_index, vectors, sections, limit=10)
        if not candidates:
            continue
        resp = chat_json(
            [
                {"role": "system", "content": "Return JSON only."},
                {
                    "role": "user",
                    "content": (
                        "PHASE_E_NODE\n"
                        "Propose LATERAL edges for this node against retrieved candidates only.\n"
                        f"{_EDGE_RULES}\n"
                        f"SCOPE: {scope}\nNODE: {n}\nCANDIDATES: {candidates}\n"
                        'Return {"edges":[...]} in the same edge shape.'
                    ),
                },
            ],
            model=model,
            temperature=0.2,
        )
        _record_edges(collected, list(resp.get("edges") or []), slug)

    edges = list(collected.values())
    for _ in range(critic_cap):
        critique = chat_json(
            [
                {"role": "system", "content": "Return JSON only."},
                {
                    "role": "user",
                    "content": (
                        "PHASE_E_CRITIC\n"
                        "Review edges. Keep sound prerequisite_of links from expansion. "
                        "Remove wrong links. Add missing lateral or prerequisite links. "
                        "Do not leave isolates. Do not invent nodes.\n"
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
        _record_edges(collected, adds, slug)
        for r in removes:
            collected.pop(r, None)
        if not adds and not removes:
            break
        edges = list(collected.values())

    # E3: coverage pass — force at least one edge for every still-unlinked node.
    coverage_rounds = max(1, critic_cap)
    for _ in range(coverage_rounds):
        deg = degree_by_ref(nodes, list(collected.values()))
        uncovered = [n for n in nodes if deg.get(str(n.get("ref")), 0) == 0]
        if not uncovered:
            break
        by_sec: dict[str, list[dict[str, Any]]] = defaultdict(list)
        for n in uncovered:
            by_sec[str(n.get("section_ref") or "")].append(n)
        added_any = False
        for sref, group in by_sec.items():
            # Batch uncovered nodes so the model must cover each one.
            for start in range(0, len(group), 12):
                batch = group[start : start + 12]
                candidate_pool: dict[str, dict[str, Any]] = {}
                for n in batch:
                    for c in _top_candidates(n, nodes, node_index, vectors, sections, limit=8):
                        candidate_pool[str(c["ref"])] = c
                # Always include section-local peers as link targets.
                for peer in by_section.get(sref, []):
                    candidate_pool[str(peer["ref"])] = peer
                for n in batch:
                    candidate_pool.pop(str(n["ref"]), None)
                candidates = list(candidate_pool.values())[:24]
                if not candidates:
                    continue
                resp = chat_json(
                    [
                        {"role": "system", "content": "Return JSON only."},
                        {
                            "role": "user",
                            "content": (
                                "PHASE_E_COVERAGE\n"
                                "These nodes currently have ZERO edges. Propose at least one "
                                "correct typed edge for EACH of them to one of the candidates.\n"
                                f"{_EDGE_RULES}\n"
                                f"SCOPE: {scope}\nUNCOVERED: {batch}\nCANDIDATES: {candidates}\n"
                                'Return {"edges":[...]} in the same edge shape.'
                            ),
                        },
                    ],
                    model=model,
                    temperature=0.2,
                )
                if _record_edges(collected, list(resp.get("edges") or []), slug):
                    added_any = True
        if not added_any:
            break

    final_edges = []
    for i, e in enumerate(collected.values(), start=1):
        final_edges.append({"ref": f"e{i}", **e})
    final_deg = degree_by_ref(nodes, final_edges)
    uncovered_final = [n["ref"] for n in nodes if final_deg.get(str(n.get("ref")), 0) == 0]
    stream_write(
        slug,
        {
            "type": "edge_coverage",
            "uncovered": uncovered_final,
            "edge_count": len(final_edges),
        },
    )
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
    return {"edges": final_edges, "uncovered_refs": uncovered_final}
