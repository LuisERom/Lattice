"""Phase B: small per-section seed goals (procedures + capstones), not a concept dump."""
from __future__ import annotations

from concurrent.futures import ThreadPoolExecutor, as_completed
from typing import Any

from .llm import chat_json, fake_mode_enabled
from .stream import stream_write


def _coerce(c: Any) -> dict[str, Any]:
    if isinstance(c, str):
        return {"name": c, "description": "", "tentative_type": "concept"}
    if isinstance(c, dict):
        return c
    return {}


def _normalize(raw: list[Any], section_ref: str) -> list[dict[str, Any]]:
    out: list[dict[str, Any]] = []
    seen: set[str] = set()
    for item in raw:
        c = _coerce(item)
        name = str(c.get("name") or "").strip()
        if not name:
            continue
        key = name.lower()
        if key in seen:
            continue
        seen.add(key)
        tentative = str(c.get("tentative_type") or "concept").strip()
        if tentative not in {"concept", "procedure"}:
            tentative = "concept"
        out.append(
            {
                "section_ref": section_ref,
                "name": name,
                "description": str(c.get("description") or ""),
                "tentative_type": tentative,
                "is_seed": True,
            }
        )
    return out


def _seed_one(
    scope: dict[str, Any],
    section: dict[str, Any],
    siblings: list[str],
    model: str,
) -> list[dict[str, Any]]:
    sref = str(section["ref"])
    if fake_mode_enabled():
        return _normalize(
            [
                {
                    "name": f"{section['name']} core workflow",
                    "description": f"Primary procedure for {section['name']}.",
                    "tentative_type": "procedure",
                },
                {
                    "name": f"{section['name']} capstone",
                    "description": f"Key learning target in {section['name']}.",
                    "tentative_type": "concept",
                },
            ],
            sref,
        )

    base = chat_json(
        [
            {"role": "system", "content": "Return JSON only."},
            {
                "role": "user",
                "content": (
                    "PHASE_B_SEEDS\n"
                    "Propose a SMALL set of learning-goal seeds for ONE section only.\n"
                    "Seeds are targets the learner aims at — not a dump of every related term.\n"
                    "Prefer 1-2 procedures and 1-3 capstone concepts. Max 5 seeds total.\n"
                    "Foundations will be discovered later via prerequisite expansion — do NOT list basics here.\n"
                    f"SCOPE: {scope}\nSECTION: {section}\nSIBLINGS: {siblings}\n"
                    'Return {"seeds":[{"name":"...","description":"...","tentative_type":"concept|procedure"}]}.'
                ),
            },
        ],
        model=model,
        temperature=0.3,
    )
    current = _normalize(list(base.get("seeds") or base.get("candidates") or []), sref)

    critic = chat_json(
        [
            {"role": "system", "content": "Return JSON only."},
            {
                "role": "user",
                "content": (
                    "PHASE_B_SEED_CRITIC\n"
                    "Are any important LEARNING GOALS missing for this section? "
                    "Do not add foundational prerequisites or peripheral trivia.\n"
                    f"SCOPE: {scope}\nSECTION: {section}\nCURRENT SEEDS: {current}\n"
                    'Return {"status":"ok","missing":[]} or {"status":"revise","missing":[...seed objects...]}.'
                ),
            },
        ],
        model=model,
        temperature=0.1,
    )
    for c in _normalize(list(critic.get("missing") or []), sref):
        if len(current) >= 5:
            break
        current.append(c)
    return current[:5]


def run_seeds(
    scope_payload: dict[str, Any],
    scaffold_payload: dict[str, Any],
    model: str,
    concurrency: int = 4,
    slug: str | None = None,
) -> dict[str, Any]:
    scope = scope_payload["scope"]
    sections = list(scaffold_payload.get("sections") or [])
    seeds: list[dict[str, Any]] = []
    with ThreadPoolExecutor(max_workers=max(1, concurrency)) as ex:
        futures = []
        for section in sections:
            siblings = [s["name"] for s in sections if s["ref"] != section["ref"]]
            futures.append(ex.submit(_seed_one, scope, section, siblings, model))
        for fut in as_completed(futures):
            batch = fut.result()
            seeds.extend(batch)
            for s in batch:
                stream_write(
                    slug,
                    {
                        "type": "seed",
                        "name": s["name"],
                        "node_type": s["tentative_type"],
                        "section_ref": s.get("section_ref"),
                    },
                )
    return {"seeds": seeds, "candidates": seeds}  # candidates alias for older tooling
