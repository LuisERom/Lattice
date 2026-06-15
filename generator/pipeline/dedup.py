from __future__ import annotations

from collections import Counter
from typing import Any

from .embeddings import cluster_by_threshold, cosine, embed_texts
from .llm import chat_json, fake_mode_enabled
from .stream import stream_write


def _cluster_members(candidates: list[dict[str, Any]], groups: list[list[int]]) -> list[dict[str, Any]]:
    clusters = []
    for ids in groups:
        members = [candidates[i] for i in ids]
        clusters.append({"ids": ids, "members": members})
    return clusters


def run_dedup(
    scope_payload: dict[str, Any],
    scaffold_payload: dict[str, Any],
    enumeration_payload: dict[str, Any],
    model: str,
    clear_threshold: float = 0.92,
    ambiguous_low: float = 0.83,
    ambiguous_high: float = 0.92,
    slug: str | None = None,
) -> dict[str, Any]:
    candidates = list(enumeration_payload.get("candidates") or [])
    if not candidates:
        return {"nodes": []}

    if fake_mode_enabled():
        nodes = []
        for i, c in enumerate(candidates, start=1):
            node = {
                "ref": f"n{i}",
                "name": c["name"],
                "description": c.get("description", ""),
                "type": c.get("tentative_type", "concept"),
                "section_ref": c.get("section_ref"),
            }
            nodes.append(node)
            stream_write(
                slug,
                {
                    "type": "node",
                    "ref": node["ref"],
                    "name": node["name"],
                    "node_type": node["type"],
                    "section_ref": node.get("section_ref"),
                },
            )
        return {"nodes": nodes}

    texts = [f"{c.get('name','')}\n{c.get('description','')}" for c in candidates]
    vectors = embed_texts(texts)
    groups = cluster_by_threshold(vectors, clear_threshold)
    clusters = _cluster_members(candidates, groups)

    # Ambiguous cross-cluster near-matches: adjudicate pairwise, then merge clusters.
    parent = list(range(len(clusters)))

    def find(x: int) -> int:
        while parent[x] != x:
            parent[x] = parent[parent[x]]
            x = parent[x]
        return x

    def union(a: int, b: int) -> None:
        ra, rb = find(a), find(b)
        if ra != rb:
            parent[rb] = ra

    for i in range(len(clusters)):
        for j in range(i + 1, len(clusters)):
            ai = clusters[i]["ids"][0]
            bj = clusters[j]["ids"][0]
            sim = cosine(vectors[ai], vectors[bj])
            if sim < ambiguous_low or sim >= ambiguous_high:
                continue
            decision = chat_json(
                [
                    {"role": "system", "content": "Return JSON only."},
                    {
                        "role": "user",
                        "content": (
                            "PHASE_C_ADJUDICATE\n"
                            "Decide if two concept clusters are duplicates.\n"
                            f"SCOPE: {scope_payload['scope']}\n"
                            f"CLUSTER_A: {clusters[i]['members']}\n"
                            f"CLUSTER_B: {clusters[j]['members']}\n"
                            'Return {"merge":true|false}.'
                        ),
                    },
                ],
                model=model,
                temperature=0.1,
            )
            if decision.get("merge") is True:
                union(i, j)

    merged: dict[int, list[dict[str, Any]]] = {}
    for idx, c in enumerate(clusters):
        merged.setdefault(find(idx), []).extend(c["members"])

    nodes: list[dict[str, Any]] = []
    for i, members in enumerate(merged.values(), start=1):
        canonical = sorted(members, key=lambda m: (len(str(m.get("name", ""))), str(m.get("name", ""))))[0]
        section_counts = Counter(str(m.get("section_ref") or "") for m in members)
        home_section = section_counts.most_common(1)[0][0] if section_counts else None
        types = Counter(str(m.get("tentative_type") or "concept") for m in members)
        node_type = "procedure" if types.get("procedure", 0) > types.get("concept", 0) else "concept"
        nodes.append(
            {
                "ref": f"n{i}",
                "name": canonical.get("name"),
                "description": canonical.get("description") or "",
                "type": node_type,
                "section_ref": home_section,
                "merged_from": [m.get("name") for m in members],
            }
        )
        stream_write(
            slug,
            {
                "type": "node",
                "ref": f"n{i}",
                "name": canonical.get("name"),
                "node_type": node_type,
                "section_ref": home_section,
            },
        )
    return {"nodes": nodes}
