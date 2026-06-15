from __future__ import annotations

from typing import Any

from .common import VALID_LEVELS, ask
from .llm import chat_json, fake_mode_enabled

SCOPE_SYSTEM_PROMPT = """You are a scoping interviewer for a personal knowledge mastery system.
Define a PRECISE, FROZEN boundary for a subject so a finite knowledge graph can be generated.

Ask one focused question at a time. Build on prior answers. Propose concrete in/out lines.
If the user is unsure, choose a reasonable default and state it.
Stop once boundary is precise.

Respond ONLY as one JSON object:
Question:
{"type":"question","question":"...","rationale":"..."}

Finalize:
{
  "type":"scope",
  "name":"...",
  "scope_level":"working|deep|exam-ready",
  "scope_description":"...",
  "include":["..."],
  "exclude":["..."],
  "summary":"...",
  "outline":[
    {"section":"...","in":"...","out":"...","subsections":["..."]}
  ]
}

Infer scope_level. Do not ask for it directly."""


def normalize_scope(msg: dict[str, Any], subject: str) -> dict[str, Any]:
    level = msg.get("scope_level")
    if level not in VALID_LEVELS:
        level = "deep"
    include = [str(x) for x in (msg.get("include") or [])]
    exclude = [str(x) for x in (msg.get("exclude") or [])]
    description = str(msg.get("scope_description") or "").strip()
    if include:
        description += ("\n" if description else "") + "IN SCOPE: " + "; ".join(include)
    if exclude:
        description += ("\n" if description else "") + "OUT OF SCOPE: " + "; ".join(exclude)
    outline = msg.get("outline") or []
    if not isinstance(outline, list):
        outline = []
    if not outline:
        outline = [{"section": "Core", "in": "Core subject areas", "out": "Peripheral history", "subsections": []}]
    return {
        "scope": {
            "name": msg.get("name") or subject,
            "scope_level": level,
            "scope_description": description.strip(),
            "include": include,
            "exclude": exclude,
            "summary": msg.get("summary") or description[:160],
        },
        "outline": outline,
    }


def _confirm_scope(payload: dict[str, Any], messages: list[dict[str, str]]) -> bool:
    scope = payload["scope"]
    print("\n" + "=" * 64)
    print("Proposed scope")
    print("=" * 64)
    print(f"  Name:    {scope['name']}")
    print(f"  Level:   {scope['scope_level']} (inferred)")
    print(f"  Summary: {scope['summary']}")
    if scope["include"]:
        print("  Include: " + ", ".join(scope["include"]))
    if scope["exclude"]:
        print("  Exclude: " + ", ".join(scope["exclude"]))
    print("  Outline sections: " + ", ".join(str(s.get("section", "?")) for s in payload["outline"]))
    print("=" * 64)
    reply = ask(
        "Generate from this scope? (y to generate / n to abort / correction text to refine)",
        "y",
    ).strip()
    low = reply.lower()
    if low in ("y", "yes"):
        return True
    if low in ("n", "no"):
        raise SystemExit("Aborted.")
    messages.append(
        {
            "role": "user",
            "content": f"Adjust the scoped boundary and outline based on this correction: {reply}",
        }
    )
    return False


def run_scope_interview(subject: str, model: str, max_questions: int) -> dict[str, Any]:
    if fake_mode_enabled():
        return normalize_scope(
            {
                "type": "scope",
                "name": subject,
                "scope_level": "deep",
                "scope_description": f"Core concepts and workflows for {subject}.",
                "include": ["foundations", "main workflows"],
                "exclude": ["legacy obsolete details"],
                "summary": f"Deep practical+structural scope for {subject}.",
                "outline": [
                    {"section": "Foundations", "in": "key terms and primitives", "out": "history", "subsections": []},
                    {"section": "Workflows", "in": "main end-to-end flow", "out": "rare edge internals", "subsections": []},
                ],
            },
            subject,
        )

    print("\nScoping interview - answering a few focused questions to freeze boundaries.\n")
    messages: list[dict[str, str]] = [
        {"role": "system", "content": SCOPE_SYSTEM_PROMPT},
        {
            "role": "user",
            "content": (
                f"The subject to scope is: {subject}\n"
                "Interview me, then finalize as type:scope JSON with include/exclude and outline."
            ),
        },
    ]
    asked = 0
    while True:
        if asked >= max_questions:
            messages.append(
                {"role": "user", "content": "Finalize now with type:scope JSON and include a tentative outline."}
            )
        msg = chat_json(messages, model=model, temperature=0.2, retries=1)
        messages.append({"role": "assistant", "content": str(msg)})
        if msg.get("type") == "scope":
            payload = normalize_scope(msg, subject)
            if _confirm_scope(payload, messages):
                return payload
            asked = 0
            continue
        question = msg.get("question") or "Any scope constraints to add?"
        rationale = msg.get("rationale")
        if rationale:
            print(f"  ({rationale})")
        answer = ask(str(question))
        if answer.strip().lower() in ("/done", "done", "finalize", "go"):
            messages.append({"role": "user", "content": "Finalize now as type:scope JSON with outline."})
        else:
            messages.append({"role": "user", "content": answer or "(no preference, choose sensible defaults)"})
        asked += 1


def scope_from_args(subject: str, scope_level: str, scope_description: str | None) -> dict[str, Any]:
    return normalize_scope(
        {
            "type": "scope",
            "name": subject,
            "scope_level": scope_level,
            "scope_description": scope_description or f"All core concepts of {subject}.",
            "include": [],
            "exclude": [],
            "summary": f"Scripted scope for {subject}.",
            "outline": [{"section": "Core", "in": "all core subject areas", "out": "obscure historical trivia", "subsections": []}],
        },
        subject,
    )
