from __future__ import annotations

from concurrent.futures import ThreadPoolExecutor, as_completed
from typing import Any

from .llm import chat_json, fake_mode_enabled
from .stream import stream_write


def _coerce_candidate(c: Any) -> dict[str, Any]:
    """Accept either a dict or a plain string from the LLM."""
    if isinstance(c, str):
        return {"name": c, "description": "", "tentative_type": "concept"}
    if isinstance(c, dict):
        return c
    return {}


def _key(c: dict[str, Any]) -> str:
    return str(c.get("name") or "").strip().lower()


def _normalize(candidates: list[Any], section_ref: str) -> list[dict[str, Any]]:
    out: list[dict[str, Any]] = []
    for raw in candidates:
        c = _coerce_candidate(raw)
        name = str(c.get("name") or "").strip()
        if not name:
            continue
        tentative = str(c.get("tentative_type") or "concept").strip()
        if tentative not in {"concept", "procedure"}:
            tentative = "concept"
        out.append(
            {
                "section_ref": section_ref,
                "name": name,
                "description": str(c.get("description") or ""),
                "tentative_type": tentative,
            }
        )
    return out


def _enum_one(
    scope: dict[str, Any],
    section: dict[str, Any],
    siblings: list[str],
    model: str,
    saturation_cap: int,
    saturation_threshold: float,
) -> list[dict[str, Any]]:
    if fake_mode_enabled():
        return [
            {
                "section_ref": section["ref"],
                "name": f"{section['name']} concept A",
                "description": f"Core concept in {section['name']}.",
                "tentative_type": "concept",
            },
            {
                "section_ref": section["ref"],
                "name": f"{section['name']} concept B",
                "description": f"Another core concept in {section['name']}.",
                "tentative_type": "concept",
            },
            {
                "section_ref": section["ref"],
                "name": f"{section['name']} workflow",
                "description": f"Procedure in {section['name']}.",
                "tentative_type": "procedure",
            },
        ]

    base = chat_json(
        [
            {"role": "system", "content": "Return JSON only."},
            {
                "role": "user",
                "content": (
                    "PHASE_B_ENUMERATE\n"
                    "Enumerate atomic concepts and procedure candidates for ONE section only.\n"
                    f"SCOPE: {scope}\nSECTION: {section}\nSIBLINGS: {siblings}\n"
                    'Return {"candidates":[{"name":"...","description":"...","tentative_type":"concept|procedure"}]}.'
                ),
            },
        ],
        model=model,
        temperature=0.3,
    )
    current = _normalize(list(base.get("candidates") or []), section["ref"])
    seen = {_key(c) for c in current}

    critic = chat_json(
        [
            {"role": "system", "content": "Return JSON only."},
            {
                "role": "user",
                "content": (
                    "PHASE_B_GAP_CRITIC\n"
                    "List important missing concepts for this section if any.\n"
                    f"SCOPE: {scope}\nSECTION: {section}\nCURRENT: {current}\n"
                    'Return {"status":"ok","missing":[]} or {"status":"revise","missing":[...candidate objects...]}.'
                ),
            },
        ],
        model=model,
        temperature=0.1,
    )
    for c in _normalize(list(critic.get("missing") or []), section["ref"]):
        k = _key(c)
        if k and k not in seen:
            current.append(c)
            seen.add(k)

    for _ in range(saturation_cap):
        more = chat_json(
            [
                {"role": "system", "content": "Return JSON only."},
                {
                    "role": "user",
                    "content": (
                        "PHASE_B_ENUMERATE\n"
                        "Re-enumerate from a different angle, only adding truly new concepts.\n"
                        f"SCOPE: {scope}\nSECTION: {section}\nCURRENT NAMES: {[c['name'] for c in current]}\n"
                        'Return {"candidates":[...]} with only plausible additions.'
                    ),
                },
            ],
            model=model,
            temperature=0.7,
        )
        additions = 0
        for c in _normalize(list(more.get("candidates") or []), section["ref"]):
            k = _key(c)
            if k and k not in seen:
                current.append(c)
                seen.add(k)
                additions += 1
        ratio = additions / max(1, len(current))
        if ratio < saturation_threshold:
            break
    return current


def run_enumeration(
    scope_payload: dict[str, Any],
    scaffold_payload: dict[str, Any],
    model: str,
    concurrency: int = 4,
    saturation_cap: int = 3,
    saturation_threshold: float = 0.1,
    slug: str | None = None,
) -> dict[str, Any]:
    scope = scope_payload["scope"]
    sections = scaffold_payload["sections"]
    candidates: list[dict[str, Any]] = []
    with ThreadPoolExecutor(max_workers=max(1, concurrency)) as ex:
        futures = []
        for section in sections:
            siblings = [s["name"] for s in sections if s["ref"] != section["ref"]]
            futures.append(
                ex.submit(
                    _enum_one,
                    scope,
                    section,
                    siblings,
                    model,
                    saturation_cap,
                    saturation_threshold,
                )
            )
        for fut in as_completed(futures):
            candidates.extend(fut.result())
    stream_write(slug, {"type": "enumeration", "count": len(candidates)})
    return {"candidates": candidates}
