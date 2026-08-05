"""Phase C: grow nodes + prerequisite_of edges by BFS prerequisite expansion."""
from __future__ import annotations

from collections import deque
from typing import Any

from .embeddings import cosine, embed_texts
from .llm import chat_json, fake_mode_enabled
from .stream import stream_step, stream_write

LEVEL_CAPS = {
    "working": {"max_depth": 4, "max_nodes": 80},
    "deep": {"max_depth": 6, "max_nodes": 200},
    "exam-ready": {"max_depth": 8, "max_nodes": 350},
}
MERGE_THRESHOLD = 0.90


def _caps_for(level: str) -> dict[str, int]:
    return dict(LEVEL_CAPS.get(level, LEVEL_CAPS["deep"]))


def _norm_name(name: str) -> str:
    return " ".join(name.lower().strip().split())


def _find_merge_target(
    name: str,
    description: str,
    nodes: list[dict[str, Any]],
    vectors: list[list[float]],
) -> int | None:
    """Return index of an existing node to merge into, or None."""
    if not nodes:
        return None
    key = _norm_name(name)
    for i, n in enumerate(nodes):
        if _norm_name(str(n.get("name") or "")) == key:
            return i
    if fake_mode_enabled():
        return None
    try:
        query_vec = embed_texts([f"{name}\n{description}"])[0]
    except Exception:
        return None
    best_i, best_sim = None, 0.0
    for i, vec in enumerate(vectors):
        sim = cosine(query_vec, vec)
        if sim > best_sim:
            best_i, best_sim = i, sim
    if best_i is not None and best_sim >= MERGE_THRESHOLD:
        return best_i
    return None


def _fake_prereqs(node: dict[str, Any], depth: int, max_depth: int) -> list[dict[str, Any]]:
    if depth >= max_depth:
        return []
    base = str(node.get("name") or "Concept")
    # One synthetic prereq per level so the chain connects.
    return [
        {
            "name": f"Foundation for {base}",
            "description": f"Direct prerequisite of {base}.",
            "tentative_type": "concept",
            "foundational": depth + 1 >= max_depth,
        }
    ]


def _ask_prereqs(
    scope: dict[str, Any],
    node: dict[str, Any],
    nearby_names: list[str],
    model: str,
    depth: int,
    max_depth: int,
) -> list[dict[str, Any]]:
    if fake_mode_enabled():
        return _fake_prereqs(node, depth, max_depth)

    resp = chat_json(
        [
            {"role": "system", "content": "Return JSON only."},
            {
                "role": "user",
                "content": (
                    "PHASE_C_EXPAND\n"
                    "List DIRECT prerequisites for this node — what must be known immediately before it.\n"
                    "Rules:\n"
                    "- Stay inside SCOPE. Do not go outside include/exclude.\n"
                    "- Return 0 to 5 prerequisites. Prefer fewer, real dependencies.\n"
                    "- Do not invent weak or speculative links.\n"
                    "- Prefer reusing names from ALREADY_KNOWN when they are the real prereq.\n"
                    "- Set foundational=true when the prereq is a scope-floor foundation "
                    "(should not be expanded further).\n"
                    f"SCOPE: {scope}\n"
                    f"NODE: {node}\n"
                    f"ALREADY_KNOWN (sample): {nearby_names[:40]}\n"
                    'Return {"prerequisites":[{"name":"...","description":"...",'
                    '"tentative_type":"concept|procedure","foundational":false}]}.'
                ),
            },
        ],
        model=model,
        temperature=0.2,
    )
    out: list[dict[str, Any]] = []
    for raw in resp.get("prerequisites") or []:
        if not isinstance(raw, dict):
            continue
        name = str(raw.get("name") or "").strip()
        if not name:
            continue
        tentative = str(raw.get("tentative_type") or "concept").strip()
        if tentative not in {"concept", "procedure"}:
            tentative = "concept"
        out.append(
            {
                "name": name,
                "description": str(raw.get("description") or ""),
                "tentative_type": tentative,
                "foundational": bool(raw.get("foundational", False)),
            }
        )
    return out[:5]


def run_expand(
    scope_payload: dict[str, Any],
    seeds_payload: dict[str, Any],
    model: str,
    slug: str | None = None,
    max_depth: int | None = None,
    max_nodes: int | None = None,
) -> dict[str, Any]:
    scope = scope_payload["scope"]
    caps = _caps_for(str(scope.get("scope_level") or "deep"))
    depth_cap = max_depth if max_depth is not None else caps["max_depth"]
    node_cap = max_nodes if max_nodes is not None else caps["max_nodes"]

    seeds = list(seeds_payload.get("seeds") or seeds_payload.get("candidates") or [])
    nodes: list[dict[str, Any]] = []
    vectors: list[list[float]] = []
    edges: dict[tuple[str, str, str], dict[str, Any]] = {}
    # queue items: (node_index, depth)
    queue: deque[tuple[int, int]] = deque()
    expanded: set[int] = set()

    def add_node(
        name: str,
        description: str,
        ntype: str,
        section_ref: str | None,
        is_seed: bool,
        foundational: bool,
    ) -> int:
        merge_i = _find_merge_target(name, description, nodes, vectors)
        if merge_i is not None:
            # Prefer keeping richer description / seed flag.
            if is_seed:
                nodes[merge_i]["is_seed"] = True
            if description and len(description) > len(str(nodes[merge_i].get("description") or "")):
                nodes[merge_i]["description"] = description
            return merge_i

        ref = f"n{len(nodes) + 1}"
        node = {
            "ref": ref,
            "name": name,
            "description": description,
            "type": ntype if ntype in {"concept", "procedure"} else "concept",
            "section_ref": section_ref,
            "is_seed": is_seed,
            "foundational": foundational,
        }
        nodes.append(node)
        if fake_mode_enabled():
            vectors.append(embed_texts([f"{name}\n{description}"])[0])
        else:
            try:
                vectors.append(embed_texts([f"{name}\n{description}"])[0])
            except Exception:
                vectors.append([])
        stream_write(
            slug,
            {
                "type": "node",
                "ref": ref,
                "name": name,
                "node_type": node["type"],
                "section_ref": section_ref,
                "is_seed": is_seed,
            },
        )
        return len(nodes) - 1

    # Seed the graph.
    for s in seeds:
        if len(nodes) >= node_cap:
            break
        idx = add_node(
            str(s.get("name") or "").strip(),
            str(s.get("description") or ""),
            str(s.get("tentative_type") or "concept"),
            s.get("section_ref"),
            is_seed=True,
            foundational=False,
        )
        queue.append((idx, 0))

    while queue and len(nodes) < node_cap:
        idx, depth = queue.popleft()
        if idx in expanded:
            continue
        expanded.add(idx)
        node = nodes[idx]
        if node.get("foundational") or depth >= depth_cap:
            continue

        nearby = [n["name"] for n in nodes if n["ref"] != node["ref"]]
        stream_step(
            "C_expand",
            f"Asking prerequisites for '{node.get('name')}' (depth {depth}, "
            f"{len(expanded) + 1} expanded, {len(nodes)} nodes, queue {len(queue)})",
            kind="expand_node",
            node=node.get("name"),
            depth=depth,
        )
        prereqs = _ask_prereqs(scope, node, nearby, model, depth, depth_cap)

        for p in prereqs:
            if len(nodes) >= node_cap and _find_merge_target(
                p["name"], p["description"], nodes, vectors
            ) is None:
                break
            p_idx = add_node(
                p["name"],
                p["description"],
                p["tentative_type"],
                node.get("section_ref"),
                is_seed=False,
                foundational=bool(p.get("foundational")) or (depth + 1 >= depth_cap),
            )
            src_ref = nodes[p_idx]["ref"]
            tgt_ref = node["ref"]
            if src_ref == tgt_ref:
                continue
            key = (src_ref, tgt_ref, "prerequisite_of")
            if key not in edges:
                edge = {
                    "source_ref": src_ref,
                    "target_ref": tgt_ref,
                    "type": "prerequisite_of",
                    "order_index": None,
                }
                edges[key] = edge
                stream_write(
                    slug,
                    {
                        "type": "edge",
                        "source": src_ref,
                        "target": tgt_ref,
                        "edge_type": "prerequisite_of",
                    },
                )
            if p_idx not in expanded and not nodes[p_idx].get("foundational"):
                queue.append((p_idx, depth + 1))

    final_edges = []
    for i, e in enumerate(edges.values(), start=1):
        final_edges.append({"ref": f"e{i}", **e})

    stats = {
        "seed_count": sum(1 for n in nodes if n.get("is_seed")),
        "node_count": len(nodes),
        "prereq_edges": len(final_edges),
        "max_depth": depth_cap,
        "max_nodes": node_cap,
        "expanded": len(expanded),
    }
    stream_write(slug, {"type": "expand_stats", **stats})
    return {"nodes": nodes, "edges": final_edges, "stats": stats}
