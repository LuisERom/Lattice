"""Graph connectivity helpers: orphan detection and pruning of unlinked concepts.

Orphans are nodes with zero edges. Atomic items alone do not count as connected —
every node in the map must participate in the structural graph.
"""
from __future__ import annotations

from collections import defaultdict
from typing import Any


def degree_by_ref(nodes: list[dict[str, Any]], edges: list[dict[str, Any]]) -> dict[str, int]:
    deg = {str(n["ref"]): 0 for n in nodes if n.get("ref")}
    for e in edges:
        s = e.get("source_ref")
        t = e.get("target_ref")
        if isinstance(s, str) and s in deg:
            deg[s] += 1
        if isinstance(t, str) and t in deg:
            deg[t] += 1
    return deg


def unlinked_refs(nodes: list[dict[str, Any]], edges: list[dict[str, Any]]) -> list[str]:
    deg = degree_by_ref(nodes, edges)
    return sorted(ref for ref, d in deg.items() if d == 0)


def prune_unlinked_concepts(
    nodes: list[dict[str, Any]],
    edges: list[dict[str, Any]],
    procedure_members: dict[str, list[str]] | None = None,
) -> dict[str, Any]:
    """Drop concept nodes that still have no edges after edge/procedure phases.

    Procedures are never auto-removed (an unlinked procedure is a pipeline error).
    Returns updated nodes/edges/members plus the removed refs.
    """
    deg = degree_by_ref(nodes, edges)
    remove = {
        str(n["ref"])
        for n in nodes
        if n.get("type") == "concept" and deg.get(str(n.get("ref")), 0) == 0
    }
    if not remove:
        return {
            "nodes": list(nodes),
            "edges": list(edges),
            "procedure_members": dict(procedure_members or {}),
            "removed": [],
        }

    kept_nodes = [n for n in nodes if str(n.get("ref")) not in remove]
    kept_edges = [
        e
        for e in edges
        if str(e.get("source_ref")) not in remove and str(e.get("target_ref")) not in remove
    ]
    # Preserve existing edge refs when the edge set is unchanged (typical for
    # degree-0 concept pruning) so connection items' edge_ref stay valid.
    if len(kept_edges) == len(edges):
        renumbered = list(kept_edges)
    else:
        renumbered = []
        for i, e in enumerate(kept_edges, start=1):
            row = {k: v for k, v in e.items() if k != "ref"}
            row["ref"] = f"e{i}"
            renumbered.append(row)

    members_in = dict(procedure_members or {})
    members_out: dict[str, list[str]] = {}
    for pref, members in members_in.items():
        filtered = [m for m in members if m not in remove]
        if filtered:
            members_out[pref] = filtered

    return {
        "nodes": kept_nodes,
        "edges": renumbered,
        "procedure_members": members_out,
        "removed": sorted(remove),
    }


def prune_contract(doc: dict[str, Any]) -> tuple[dict[str, Any], list[str]]:
    """Prune unlinked concepts from a full contract and drop items that reference them."""
    nodes = list(doc.get("nodes") or [])
    edges = list(doc.get("edges") or [])
    items = list(doc.get("items") or [])

    members_by_proc: dict[str, list[str]] = defaultdict(list)
    for e in edges:
        if e.get("type") == "part_of":
            members_by_proc[str(e["target_ref"])].append(str(e["source_ref"]))

    pruned = prune_unlinked_concepts(nodes, edges, dict(members_by_proc))
    removed = list(pruned["removed"])
    if not removed:
        return doc, []

    remove_set = set(removed)
    kept_items = []
    for it in items:
        members = [str(m) for m in (it.get("member_node_refs") or [])]
        if any(m in remove_set for m in members):
            continue
        kept_items.append(it)

    # Drop connection items whose edge_ref vanished after re-numbering.
    edge_refs = {e.get("ref") for e in pruned["edges"] if e.get("ref")}
    final_items = []
    for it in kept_items:
        if it.get("kind") == "connection":
            eref = it.get("edge_ref")
            if eref not in edge_refs:
                continue
        final_items.append(it)

    out = {
        **doc,
        "nodes": pruned["nodes"],
        "edges": pruned["edges"],
        "items": final_items,
    }
    return out, removed
