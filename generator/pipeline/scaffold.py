from __future__ import annotations

from typing import Any

from .llm import chat_json, fake_mode_enabled
from .stream import stream_write


def _normalize_sections(raw_sections: list[Any]) -> list[dict[str, Any]]:
    out: list[dict[str, Any]] = []
    for i, s in enumerate(raw_sections, start=1):
        if not isinstance(s, dict):
            s = {"name": str(s)}
        name = str(s.get("name") or s.get("section") or f"Section {i}").strip()
        out.append(
            {
                "ref": f"s{i}",
                "name": name,
                "in": str(s.get("in") or "In-scope material for this section."),
                "out": str(s.get("out") or "Out-of-scope nearby material."),
                "parent": s.get("parent"),
            }
        )
    return out


def run_scaffold(
    scope_payload: dict[str, Any],
    model: str,
    critic_cap: int = 3,
    slug: str | None = None,
) -> dict[str, Any]:
    scope = scope_payload["scope"]
    tentative_outline = scope_payload.get("outline") or []
    if fake_mode_enabled():
        sections = _normalize_sections(tentative_outline)
        payload = {"sections": sections}
        stream_write(slug, {"type": "scaffold", "sections": sections})
        return payload

    system = "Return JSON only."
    prompt = {
        "role": "user",
        "content": (
            "PHASE_A_SCAFFOLD\n"
            "Create a hierarchical section scaffold inside the frozen scope.\n"
            f"SCOPE NAME: {scope['name']}\n"
            f"SCOPE LEVEL: {scope['scope_level']}\n"
            f"SCOPE DESCRIPTION: {scope['scope_description']}\n"
            f"TENTATIVE OUTLINE: {tentative_outline}\n"
            'Return {"sections":[{"name":"...","in":"...","out":"...","parent":null}]}.'
        ),
    }
    first = chat_json([{"role": "system", "content": system}, prompt], model=model, temperature=0.2)
    sections = _normalize_sections(list(first.get("sections") or tentative_outline))

    for _ in range(critic_cap):
        critic = chat_json(
            [
                {"role": "system", "content": system},
                {
                    "role": "user",
                    "content": (
                        "PHASE_A_CRITIC\n"
                        "Review scaffold for missing/miscoped major areas.\n"
                        f"SCOPE: {scope}\nSECTIONS: {sections}\n"
                        'Return {"status":"ok","issues":[]} if good, else {"status":"revise","issues":["..."]}.'
                    ),
                },
            ],
            model=model,
            temperature=0.1,
        )
        if critic.get("status") == "ok" or not (critic.get("issues") or []):
            break
        revise = chat_json(
            [
                {"role": "system", "content": system},
                {
                    "role": "user",
                    "content": (
                        "PHASE_A_SCAFFOLD\n"
                        "Revise this scaffold using critic feedback.\n"
                        f"CURRENT SECTIONS: {sections}\n"
                        f"ISSUES: {critic.get('issues')}\n"
                        'Return {"sections":[...]}.'
                    ),
                },
            ],
            model=model,
            temperature=0.2,
        )
        sections = _normalize_sections(list(revise.get("sections") or sections))
    payload = {"sections": sections}
    stream_write(slug, {"type": "scaffold", "sections": sections})
    return payload
