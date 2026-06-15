from __future__ import annotations

from typing import Any

from .common import METHODS_BY_KIND, VALID_EDGE_TYPES, VALID_ITEM_KINDS, VALID_NODE_TYPES


def validate_contract(doc: dict[str, Any]) -> list[str]:
    errors: list[str] = []

    if not isinstance(doc.get("topic"), dict):
        errors.append("missing topic object")
    for key in ("nodes", "edges", "items"):
        if not isinstance(doc.get(key), list):
            errors.append(f"missing or invalid '{key}' array")
    if errors:
        return errors

    node_refs: set[str] = set()
    has_procedure = False
    for n in doc["nodes"]:
        ref = n.get("ref")
        if not ref or ref in node_refs:
            errors.append(f"node ref missing/duplicate: {ref!r}")
        node_refs.add(ref)
        if n.get("type") not in VALID_NODE_TYPES:
            errors.append(f"node {ref}: bad type {n.get('type')!r}")
        if n.get("type") == "procedure":
            has_procedure = True
        if not n.get("name"):
            errors.append(f"node {ref}: missing name")
    if not has_procedure:
        errors.append("no procedure node (at least one required)")

    edge_refs: set[str] = set()
    for e in doc["edges"]:
        for side in ("source_ref", "target_ref"):
            if e.get(side) not in node_refs:
                errors.append(f"edge references unknown node: {e.get(side)!r}")
        if e.get("type") not in VALID_EDGE_TYPES:
            errors.append(f"edge: bad type {e.get('type')!r}")
        if e.get("ref"):
            if e["ref"] in edge_refs:
                errors.append(f"duplicate edge ref: {e['ref']!r}")
            edge_refs.add(e["ref"])
        if e.get("type") == "part_of" and e.get("order_index") in (None, ""):
            errors.append("part_of edge missing order_index")

    item_refs: set[str] = set()
    for it in doc["items"]:
        ref = it.get("ref")
        if not ref or ref in item_refs:
            errors.append(f"item ref missing/duplicate: {ref!r}")
        item_refs.add(ref)
        kind = it.get("kind")
        if kind not in VALID_ITEM_KINDS:
            errors.append(f"item {ref}: bad kind {kind!r}")
            continue
        members = it.get("member_node_refs") or []
        for m in members:
            if m not in node_refs:
                errors.append(f"item {ref}: unknown member node {m!r}")
        if kind == "atomic" and len(members) != 1:
            errors.append(f"atomic item {ref}: must have exactly one member node")
        if kind == "connection":
            if it.get("edge_ref") not in edge_refs:
                errors.append(f"connection item {ref}: edge_ref must point to an edge with a ref")
        allowed = METHODS_BY_KIND.get(kind, set())
        methods = {q.get("method") for q in it.get("questions", [])}
        if not methods:
            errors.append(f"item {ref}: no questions")
        for m in methods:
            if m not in allowed:
                errors.append(f"item {ref}: method {m!r} not allowed for kind {kind}")
        if len(methods) < 2:
            errors.append(f"item {ref}: needs >=2 distinct methods so 'mastered' is reachable")

    errors.extend(detect_prerequisite_cycles(doc))
    errors.extend(find_orphan_nodes(doc))
    return errors


def detect_prerequisite_cycles(doc: dict[str, Any]) -> list[str]:
    edges = [e for e in doc.get("edges", []) if e.get("type") == "prerequisite_of"]
    graph: dict[str, list[str]] = {}
    for e in edges:
        s = e.get("source_ref")
        t = e.get("target_ref")
        if isinstance(s, str) and isinstance(t, str):
            graph.setdefault(s, []).append(t)

    visiting: set[str] = set()
    visited: set[str] = set()
    has_cycle = False

    def dfs(n: str) -> None:
        nonlocal has_cycle
        if n in visiting:
            has_cycle = True
            return
        if n in visited:
            return
        visiting.add(n)
        for nxt in graph.get(n, []):
            dfs(nxt)
        visiting.remove(n)
        visited.add(n)

    for node in list(graph):
        dfs(node)
    return ["prerequisite_of edges contain a cycle"] if has_cycle else []


def find_orphan_nodes(doc: dict[str, Any]) -> list[str]:
    node_refs = {n.get("ref") for n in doc.get("nodes", []) if n.get("ref")}
    connected: set[str] = set()
    for e in doc.get("edges", []):
        s = e.get("source_ref")
        t = e.get("target_ref")
        if s in node_refs:
            connected.add(s)
        if t in node_refs:
            connected.add(t)
    for it in doc.get("items", []):
        for m in it.get("member_node_refs") or []:
            if m in node_refs:
                connected.add(m)
    orphans = sorted(node_refs - connected)
    if not orphans:
        return []
    return [f"orphan nodes with no edge/item membership: {', '.join(orphans[:20])}"]
