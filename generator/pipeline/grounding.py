from __future__ import annotations

import datetime as dt
import json
import os
import urllib.error
import urllib.parse
import urllib.request
from typing import Any

from .llm import chat_json, fake_mode_enabled
from .stream import stream_write

SUPPORT_LABELS = {"supports", "partial", "related", "contradicts"}
SEVERITY_RANK = {"low": 1, "medium": 2, "high": 3}
SCHOLARLY_HINTS = (
    "study",
    "paper",
    "research",
    "doi",
    "arxiv",
    "benchmark",
    "trial",
    "meta-analysis",
    "frontier",
    "pubmed",
)


def _normalize_whitespace(text: str) -> str:
    return " ".join(str(text or "").split())


def _truncate(text: str, max_len: int) -> str:
    clean = _normalize_whitespace(text)
    if len(clean) <= max_len:
        return clean
    return clean[: max_len - 3].rstrip() + "..."


def _json_post(url: str, payload: dict[str, Any], timeout_s: int = 30) -> dict[str, Any]:
    req = urllib.request.Request(
        url,
        data=json.dumps(payload).encode("utf-8"),
        headers={"Content-Type": "application/json"},
        method="POST",
    )
    with urllib.request.urlopen(req, timeout=timeout_s) as resp:
        return json.loads(resp.read().decode("utf-8"))


def _json_get(url: str, timeout_s: int = 30) -> dict[str, Any]:
    req = urllib.request.Request(url, method="GET")
    with urllib.request.urlopen(req, timeout=timeout_s) as resp:
        return json.loads(resp.read().decode("utf-8"))


def _looks_scholarly(node: dict[str, Any]) -> bool:
    blob = f"{node.get('name', '')} {node.get('description', '')}".lower()
    return any(k in blob for k in SCHOLARLY_HINTS)


def _is_grounding_candidate(
    node: dict[str, Any], flag_severity: str | None, confidence_threshold: float
) -> bool:
    if bool(node.get("grounding_sensitive", False)):
        return True
    conf = node.get("confidence")
    try:
        if float(conf) < confidence_threshold:
            return True
    except (TypeError, ValueError):
        pass
    return flag_severity in {"medium", "high"}


def _flag_lookup(flags: list[dict[str, Any]]) -> dict[str, str]:
    out: dict[str, str] = {}
    for f in flags:
        ref = str(f.get("ref") or "")
        sev = str(f.get("severity") or "low").lower()
        if not ref:
            continue
        prev = out.get(ref)
        if not prev or SEVERITY_RANK.get(sev, 0) > SEVERITY_RANK.get(prev, 0):
            out[ref] = sev
    return out


def _openalex_abstract(index: Any) -> str:
    if not isinstance(index, dict):
        return ""
    words_by_pos: dict[int, str] = {}
    for token, positions in index.items():
        if not isinstance(token, str) or not isinstance(positions, list):
            continue
        for p in positions:
            if isinstance(p, int) and p >= 0 and p not in words_by_pos:
                words_by_pos[p] = token
    if not words_by_pos:
        return ""
    words = [words_by_pos[i] for i in sorted(words_by_pos.keys())]
    return " ".join(words)


def _search_openalex(query: str, max_results: int = 3) -> list[dict[str, Any]]:
    email = os.environ.get("OPENALEX_MAILTO", "").strip()
    params = {
        "search": query,
        "per-page": str(max(1, min(max_results, 10))),
        "select": "id,display_name,doi,abstract_inverted_index,primary_location",
    }
    if email:
        params["mailto"] = email
    url = "https://api.openalex.org/works?" + urllib.parse.urlencode(params)
    try:
        data = _json_get(url)
    except (urllib.error.HTTPError, urllib.error.URLError, json.JSONDecodeError):
        return []
    rows = list(data.get("results") or [])
    out: list[dict[str, Any]] = []
    for r in rows:
        if not isinstance(r, dict):
            continue
        title = str(r.get("display_name") or r.get("id") or "OpenAlex work")
        landing = (
            (((r.get("primary_location") or {}).get("landing_page_url")))
            or r.get("doi")
            or r.get("id")
        )
        url_str = str(landing or "").strip()
        if not url_str:
            continue
        source = ((r.get("primary_location") or {}).get("source") or {})
        publisher = str(source.get("display_name") or "OpenAlex")
        snippet = _truncate(_openalex_abstract(r.get("abstract_inverted_index")), 900)
        if not snippet:
            snippet = "No abstract available; use metadata + DOI."
        out.append(
            {
                "url": url_str,
                "title": title,
                "publisher": publisher,
                "snippet": snippet,
                "channel": "openalex",
            }
        )
    return out


def _search_tavily(query: str, max_results: int = 5) -> list[dict[str, Any]]:
    api_key = os.environ.get("TAVILY_API_KEY", "").strip()
    if not api_key:
        return []
    include_domains_env = os.environ.get("LATTICE_GROUND_INCLUDE_DOMAINS", "").strip()
    include_domains = [x.strip() for x in include_domains_env.split(",") if x.strip()]
    payload: dict[str, Any] = {
        "api_key": api_key,
        "query": query,
        "search_depth": "basic",
        "max_results": max(1, min(max_results, 10)),
        "include_raw_content": True,
        "chunks_per_source": 3,
    }
    if include_domains:
        payload["include_domains"] = include_domains
    try:
        data = _json_post("https://api.tavily.com/search", payload, timeout_s=45)
    except (urllib.error.HTTPError, urllib.error.URLError, json.JSONDecodeError):
        return []
    out: list[dict[str, Any]] = []
    for r in list(data.get("results") or []):
        if not isinstance(r, dict):
            continue
        url = str(r.get("url") or "").strip()
        if not url:
            continue
        content = str(r.get("content") or "")
        raw = str(r.get("raw_content") or "")
        snippet = _truncate(raw or content, 900)
        out.append(
            {
                "url": url,
                "title": str(r.get("title") or url),
                "publisher": urllib.parse.urlparse(url).netloc,
                "snippet": snippet,
                "channel": "tavily",
            }
        )
    return out


def _dedupe_sources(rows: list[dict[str, Any]], cap: int) -> list[dict[str, Any]]:
    seen: set[str] = set()
    out: list[dict[str, Any]] = []
    for r in rows:
        url = str(r.get("url") or "").strip()
        if not url or url in seen:
            continue
        seen.add(url)
        out.append(r)
        if len(out) >= cap:
            break
    return out


def _ground_node_with_llm(
    scope: dict[str, Any],
    node: dict[str, Any],
    evidence: list[dict[str, Any]],
    model: str,
) -> dict[str, Any]:
    evidence_pack = [
        {
            "id": f"s{i + 1}",
            "url": e["url"],
            "title": e["title"],
            "publisher": e.get("publisher", ""),
            "snippet": _truncate(str(e.get("snippet") or ""), 700),
        }
        for i, e in enumerate(evidence)
    ]
    if not evidence_pack:
        return {
            "status": "not_found",
            "source_id": None,
            "quote": "",
            "reason": "no search evidence returned",
            "description": None,
        }

    msg = chat_json(
        [
            {"role": "system", "content": "Return JSON only."},
            {
                "role": "user",
                "content": (
                    "PHASE_D2_GROUND\n"
                    "Ground this node conservatively using evidence snippets only.\n"
                    "Rules:\n"
                    "- Mark status as supports|partial|related|contradicts|not_found.\n"
                    "- Choose source_id from provided ids only.\n"
                    "- Use grounded only when evidence directly supports the claim.\n"
                    "- If the node overclaims, provide a tighter description limited to supported facts.\n"
                    f"SCOPE: {scope}\nNODE: {node}\nEVIDENCE: {evidence_pack}\n"
                    'Return {"status":"supports|partial|related|contradicts|not_found","source_id":"s1|null","quote":"...","reason":"...","description":"...|null"}'
                ),
            },
        ],
        model=model,
        temperature=0.1,
    )
    status = str(msg.get("status") or "not_found").strip().lower()
    if status not in SUPPORT_LABELS and status != "not_found":
        status = "not_found"
    source_id = msg.get("source_id")
    if source_id is not None:
        source_id = str(source_id).strip()
        if source_id.lower() == "null" or not source_id:
            source_id = None
    quote = _truncate(str(msg.get("quote") or ""), 400)
    reason = _truncate(str(msg.get("reason") or ""), 280)
    desc = msg.get("description")
    description = _truncate(str(desc), 800) if isinstance(desc, str) and desc.strip() else None
    return {
        "status": status,
        "source_id": source_id,
        "quote": quote,
        "reason": reason,
        "description": description,
    }


def run_grounding(
    scope_payload: dict[str, Any],
    detailed_payload: dict[str, Any],
    model: str,
    slug: str | None = None,
    confidence_threshold: float = 0.65,
    max_candidates: int = 80,
    max_sources_per_node: int = 3,
) -> dict[str, Any]:
    scope = scope_payload["scope"]
    nodes = [dict(n) for n in (detailed_payload.get("nodes") or [])]
    base_flags = [dict(f) for f in (detailed_payload.get("flags") or [])]
    ref_to_severity = _flag_lookup(base_flags)
    candidates = [
        n
        for n in nodes
        if _is_grounding_candidate(
            n, ref_to_severity.get(str(n.get("ref") or "")), confidence_threshold
        )
    ][: max(1, max_candidates)]

    sources: list[dict[str, Any]] = []
    node_sources: list[dict[str, Any]] = []
    grounding_flags: list[dict[str, Any]] = []
    source_ref_by_url: dict[str, str] = {}

    if fake_mode_enabled():
        for i, node in enumerate(candidates, start=1):
            ref = str(node.get("ref") or "")
            if not ref:
                continue
            source_ref = f"s{i}"
            source_url = f"https://example.com/{scope.get('name','topic').lower().replace(' ', '-')}/{ref}"
            node["verification"] = "grounded" if node.get("grounding_sensitive") else "unverified"
            sources.append(
                {
                    "ref": source_ref,
                    "url": source_url,
                    "title": f"Fake source for {node.get('name', ref)}",
                    "publisher": "example.com",
                    "retrieved_at": dt.datetime.utcnow().isoformat(timespec="seconds") + "Z",
                    "quote": "Offline fake evidence snippet.",
                }
            )
            node_sources.append(
                {"node_ref": ref, "source_ref": source_ref, "support": "supports"}
            )
            if node["verification"] != "grounded":
                grounding_flags.append(
                    {
                        "ref": ref,
                        "severity": "medium",
                        "reason": "needs_source: fake mode left node unverified",
                    }
                )
            stream_write(
                slug,
                {
                    "type": "grounding_node",
                    "ref": ref,
                    "verification": node["verification"],
                    "sources": 1,
                },
            )
        return {
            "nodes": nodes,
            "flags": [*base_flags, *grounding_flags],
            "sources": sources,
            "node_sources": node_sources,
            "grounding_flags": grounding_flags,
        }

    for node in candidates:
        ref = str(node.get("ref") or "")
        if not ref:
            continue
        query = (
            f"{scope.get('name', '')} {node.get('name', '')} "
            f"{_truncate(str(node.get('description') or ''), 120)}"
        )
        evidence_rows: list[dict[str, Any]] = []
        if _looks_scholarly(node):
            evidence_rows.extend(_search_openalex(query, max_results=max_sources_per_node))
        evidence_rows.extend(_search_tavily(query, max_results=5))
        evidence = _dedupe_sources(evidence_rows, cap=max_sources_per_node)

        judgment = _ground_node_with_llm(scope, node, evidence, model=model)
        status = str(judgment.get("status") or "not_found")
        source_id = judgment.get("source_id")
        chosen: dict[str, Any] | None = None
        if source_id:
            for i, candidate in enumerate(evidence, start=1):
                if f"s{i}" == source_id:
                    chosen = candidate
                    break

        if chosen:
            url = str(chosen.get("url") or "")
            source_ref = source_ref_by_url.get(url)
            if not source_ref:
                source_ref = f"s{len(sources) + 1}"
                source_ref_by_url[url] = source_ref
                sources.append(
                    {
                        "ref": source_ref,
                        "url": url,
                        "title": str(chosen.get("title") or url),
                        "publisher": str(chosen.get("publisher") or ""),
                        "retrieved_at": dt.datetime.utcnow().isoformat(timespec="seconds") + "Z",
                        "quote": judgment.get("quote")
                        or _truncate(str(chosen.get("snippet") or ""), 240),
                    }
                )
            support = status if status in SUPPORT_LABELS else "related"
            node_sources.append(
                {"node_ref": ref, "source_ref": source_ref, "support": support}
            )
            node["verification"] = "grounded" if support == "supports" else "unverified"
        else:
            node["verification"] = "unverified"

        tightened = judgment.get("description")
        if node.get("verification") == "grounded" and isinstance(tightened, str) and tightened:
            node["description"] = tightened

        if node.get("verification") != "grounded":
            reason = str(judgment.get("reason") or "needs_source")
            grounding_flags.append(
                {
                    "ref": ref,
                    "severity": "medium",
                    "reason": f"needs_source: {reason}",
                }
            )

        stream_write(
            slug,
            {
                "type": "grounding_node",
                "ref": ref,
                "verification": node.get("verification", "unverified"),
                "sources": sum(1 for link in node_sources if link["node_ref"] == ref),
            },
        )

    # Ensure every node has an explicit verification value for contract export.
    for node in nodes:
        node["verification"] = "grounded" if node.get("verification") == "grounded" else "unverified"

    return {
        "nodes": nodes,
        "flags": [*base_flags, *grounding_flags],
        "sources": sources,
        "node_sources": node_sources,
        "grounding_flags": grounding_flags,
    }
