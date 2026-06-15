from __future__ import annotations

from typing import Any

from .llm import chat_json, fake_mode_enabled
from .stream import stream_write


def run_detailing(
    scope_payload: dict[str, Any],
    nodes_payload: dict[str, Any],
    model: str,
    slug: str | None = None,
) -> dict[str, Any]:
    scope = scope_payload["scope"]
    nodes = list(nodes_payload.get("nodes") or [])
    if fake_mode_enabled():
        detailed = []
        for n in nodes:
            node = {
                **n,
                "description": n.get("description") or f"{n['name']} within {scope['name']}.",
                "type": n.get("type") if n.get("type") in {"concept", "procedure"} else "concept",
                "grounding_sensitive": False,
                "confidence": 0.8,
            }
            detailed.append(node)
            stream_write(
                slug,
                {
                    "type": "node_update",
                    "ref": node.get("ref"),
                    "description": node.get("description"),
                    "grounding_sensitive": node.get("grounding_sensitive", False),
                },
            )
        return {"nodes": detailed, "flags": []}

    detailed = list(nodes)
    batch_size = 25
    for start in range(0, len(detailed), batch_size):
        batch = detailed[start : start + batch_size]
        msg = chat_json(
            [
                {"role": "system", "content": "Return JSON only."},
                {
                    "role": "user",
                    "content": (
                        "PHASE_D_DETAIL\n"
                        "Detail these nodes with precise descriptions, type and sensitivity.\n"
                        f"SCOPE: {scope}\nNODES: {batch}\n"
                        'Return {"nodes":[{"ref":"n1","description":"...","type":"concept|procedure","grounding_sensitive":false,"confidence":0.0-1.0}]}.'
                    ),
                },
            ],
            model=model,
            temperature=0.2,
        )
        by_ref = {str(x.get("ref")): x for x in (msg.get("nodes") or []) if x.get("ref")}
        for n in batch:
            patch = by_ref.get(str(n.get("ref")), {})
            n["description"] = patch.get("description") or n.get("description") or n["name"]
            n["type"] = patch.get("type") if patch.get("type") in {"concept", "procedure"} else n.get("type", "concept")
            n["grounding_sensitive"] = bool(patch.get("grounding_sensitive", False))
            conf = patch.get("confidence", 0.7)
            try:
                n["confidence"] = max(0.0, min(1.0, float(conf)))
            except (TypeError, ValueError):
                n["confidence"] = 0.7
            stream_write(
                slug,
                {
                    "type": "node_update",
                    "ref": n.get("ref"),
                    "description": n.get("description"),
                    "grounding_sensitive": n.get("grounding_sensitive", False),
                },
            )

    # Audit in batches of 50 — sending all nodes at once creates prompts that
    # easily exceed 60k tokens and time out.
    audit_batch_size = 50
    all_flags: list[Any] = []
    for start in range(0, len(detailed), audit_batch_size):
        batch = detailed[start : start + audit_batch_size]
        audit = chat_json(
            [
                {"role": "system", "content": "Return JSON only."},
                {
                    "role": "user",
                    "content": (
                        "PHASE_D_AUDITOR\n"
                        "Audit detailed nodes for uncertainty or likely errors.\n"
                        f"SCOPE: {scope}\nNODES: {batch}\n"
                        'Return {"flags":[{"ref":"n1","reason":"...","severity":"low|medium|high"}]}.'
                    ),
                },
            ],
            model=model,
            temperature=0.1,
        )
        all_flags.extend(list(audit.get("flags") or []))
    return {"nodes": detailed, "flags": all_flags}
