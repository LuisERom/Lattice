from __future__ import annotations

import json
import os
import random
import re
import urllib.error
import urllib.request
from typing import Any

from .common import load_dotenv


def extract_json(text: str) -> dict[str, Any]:
    text = text.strip()
    if text.startswith("```"):
        text = re.sub(r"^```[a-zA-Z]*\n?", "", text)
        text = re.sub(r"\n?```$", "", text).strip()
    return json.loads(text)


def fake_mode_enabled() -> bool:
    return os.environ.get("LATTICE_FAKE_LLM", "").strip() == "1"


def _fake_json_response(messages: list[dict[str, str]]) -> dict[str, Any]:
    # Deterministic-enough, offline-safe fallback to exercise orchestration/resume.
    joined = "\n".join(m.get("content", "") for m in messages[-3:])
    if '"type": "scope"' in joined or "Interview me to define the boundary" in joined:
        return {
            "type": "scope",
            "name": "Fake Subject",
            "scope_level": "deep",
            "scope_description": "Fake scoped boundary for offline pipeline verification.",
            "include": ["core concepts", "main workflows"],
            "exclude": ["niche edge cases", "obsolete details"],
            "summary": "Offline mock scope",
            "outline": [
                {"section": "Foundations", "in": "core terms", "out": "history"},
                {"section": "Workflows", "in": "main process", "out": "rare internals"},
            ],
        }
    if "PHASE_A_SCAFFOLD" in joined:
        return {
            "sections": [
                {"name": "Foundations", "in": "core concepts", "out": "deep internals"},
                {"name": "Workflows", "in": "main lifecycle", "out": "niche variants"},
            ]
        }
    if "PHASE_A_CRITIC" in joined:
        return {"status": "ok", "issues": []}
    if "PHASE_B_ENUMERATE" in joined:
        suffix = random.randint(1, 9)
        return {
            "candidates": [
                {
                    "name": f"Concept {suffix}A",
                    "description": "Atomic concept",
                    "tentative_type": "concept",
                },
                {
                    "name": f"Concept {suffix}B",
                    "description": "Atomic concept",
                    "tentative_type": "concept",
                },
                {
                    "name": f"Procedure {suffix}",
                    "description": "Procedure concept",
                    "tentative_type": "procedure",
                },
            ]
        }
    if "PHASE_B_GAP_CRITIC" in joined:
        return {"status": "ok", "missing": []}
    if "PHASE_C_ADJUDICATE" in joined:
        return {"merge": False}
    if "PHASE_D_DETAIL" in joined:
        return {"nodes": []}
    if "PHASE_D_AUDITOR" in joined:
        return {"flags": []}
    if "PHASE_E_SECTION" in joined or "PHASE_E_NODE" in joined:
        return {"edges": []}
    if "PHASE_E_CRITIC" in joined:
        return {"add": [], "remove": []}
    if "PHASE_F_PROCEDURE" in joined:
        return {"members": []}
    if "PHASE_G_ITEM" in joined:
        return {"questions": []}
    if "PHASE_H_CRITIC" in joined:
        return {"missing": []}
    return {}


def chat_json(
    messages: list[dict[str, str]],
    model: str,
    temperature: float = 0.2,
    timeout_s: int = 300,
    retries: int = 1,
) -> dict[str, Any]:
    load_dotenv()
    if fake_mode_enabled():
        return _fake_json_response(messages)

    api_key = os.environ.get("OPENAI_API_KEY")
    if not api_key:
        raise RuntimeError(
            "OPENAI_API_KEY is not set. Put it in .env (see .env.example), "
            "or set LATTICE_FAKE_LLM=1 for offline pipeline tests."
        )
    base_url = os.environ.get("OPENAI_BASE_URL", "https://api.openai.com/v1").rstrip("/")
    payload = {
        "model": model,
        "messages": messages,
        "temperature": temperature,
        "response_format": {"type": "json_object"},
    }
    req = urllib.request.Request(
        f"{base_url}/chat/completions",
        data=json.dumps(payload).encode("utf-8"),
        headers={
            "Authorization": f"Bearer {api_key}",
            "Content-Type": "application/json",
        },
        method="POST",
    )

    last_err: Exception | None = None
    for attempt in range(retries + 1):
        try:
            with urllib.request.urlopen(req, timeout=timeout_s) as resp:
                data = json.loads(resp.read().decode("utf-8"))
            content = data["choices"][0]["message"]["content"]
            return extract_json(content)
        except (urllib.error.HTTPError, urllib.error.URLError, json.JSONDecodeError) as exc:
            last_err = exc
            if attempt >= retries:
                break
    if isinstance(last_err, urllib.error.HTTPError):
        detail = last_err.read().decode("utf-8", "replace")
        raise RuntimeError(f"LLM API error {last_err.code}: {detail}") from last_err
    raise RuntimeError(f"LLM call failed: {last_err}") from last_err
