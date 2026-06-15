from __future__ import annotations

import random
from typing import Any

from .llm import chat_json, fake_mode_enabled
from .stream import stream_write
from .validate import validate_contract


def run_global_audit(
    scope_payload: dict[str, Any],
    scaffold_payload: dict[str, Any],
    contract_doc: dict[str, Any],
    detail_flags: list[dict[str, Any]],
    model: str,
    sample_sections: int = 3,
    slug: str | None = None,
) -> dict[str, Any]:
    scope = scope_payload["scope"]
    sections = list(scaffold_payload.get("sections") or [])
    errors = validate_contract(contract_doc)
    critics: list[dict[str, Any]] = []
    if not fake_mode_enabled() and sections:
        picks = random.sample(sections, k=min(sample_sections, len(sections)))
        for s in picks:
            c = chat_json(
                [
                    {"role": "system", "content": "Return JSON only."},
                    {
                        "role": "user",
                        "content": (
                            "PHASE_H_CRITIC\n"
                            "Check completeness for this section only.\n"
                            f"SCOPE: {scope}\nSECTION: {s}\n"
                            f"NODES: {contract_doc.get('nodes')}\nEDGES: {contract_doc.get('edges')}\n"
                            'Return {"missing":[{"type":"node|edge","detail":"..."}]}'
                        ),
                    },
                ],
                model=model,
                temperature=0.1,
            )
            critics.append({"section_ref": s.get("ref"), "missing": list(c.get("missing") or [])})
    payload = {"errors": errors, "detail_flags": detail_flags, "completeness_flags": critics}
    stream_write(slug, {"type": "audit", "errors": len(errors)})
    return payload
