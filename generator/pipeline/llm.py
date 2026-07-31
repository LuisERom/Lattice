from __future__ import annotations

import json
import os
import random
import re
import time
import urllib.error
import urllib.request
import uuid
from typing import Any

from .common import load_dotenv
from .stream import current_stream_slug, stream_write

_PHASE_LABEL_RE = re.compile(r"\b(PHASE_[A-Z0-9_]+)\b")


def extract_json(text: str) -> dict[str, Any]:
    text = text.strip()
    if text.startswith("```"):
        text = re.sub(r"^```[a-zA-Z]*\n?", "", text)
        text = re.sub(r"\n?```$", "", text).strip()
    return json.loads(text)


def fake_mode_enabled() -> bool:
    return os.environ.get("LATTICE_FAKE_LLM", "").strip() == "1"


def _infer_label(messages: list[dict[str, str]]) -> str | None:
    for message in reversed(messages):
        content = message.get("content", "")
        match = _PHASE_LABEL_RE.search(content)
        if match:
            return match.group(1)
    return None


def _approx_tokens(chars: int) -> int:
    # Cheap estimator; good enough for ordering/debug visibility in logs.
    return max(1, chars // 4)


def _log_api_call(
    slug: str | None,
    *,
    call_id: str,
    model: str,
    status: str,
    label: str | None,
    n_messages: int,
    approx_chars: int,
    approx_tokens: int,
    messages: list[dict[str, str]] | None = None,
    response: dict[str, Any] | None = None,
    elapsed_ms: int | None = None,
    error_message: str | None = None,
) -> None:
    if not slug:
        return
    event: dict[str, Any] = {
        "type": "api_call",
        "api": "llm",
        "call_id": call_id,
        "model": model,
        "status": status,
        "n_messages": n_messages,
        "approx_chars": approx_chars,
        "approx_tokens": approx_tokens,
    }
    if label:
        event["label"] = label
    if messages is not None:
        event["messages"] = messages
    if response is not None:
        event["response"] = response
    if elapsed_ms is not None:
        event["elapsed_ms"] = elapsed_ms
    if error_message is not None:
        event["message"] = error_message
    stream_write(slug, event)


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
    label: str | None = None,
) -> dict[str, Any]:
    load_dotenv()
    slug = current_stream_slug()
    call_id = uuid.uuid4().hex[:12]
    resolved_label = label or _infer_label(messages)
    approx_chars = sum(len(m.get("content", "")) for m in messages)
    approx_tokens = _approx_tokens(approx_chars)
    started_at = time.perf_counter()
    _log_api_call(
        slug,
        call_id=call_id,
        model=model,
        status="start",
        label=resolved_label,
        n_messages=len(messages),
        approx_chars=approx_chars,
        approx_tokens=approx_tokens,
        messages=messages,
    )

    if fake_mode_enabled():
        fake_response = _fake_json_response(messages)
        _log_api_call(
            slug,
            call_id=call_id,
            model=model,
            status="done",
            label=resolved_label,
            n_messages=len(messages),
            approx_chars=approx_chars,
            approx_tokens=approx_tokens,
            response=fake_response,
            elapsed_ms=max(1, int((time.perf_counter() - started_at) * 1000)),
        )
        return fake_response

    api_key = os.environ.get("OPENAI_API_KEY")
    if not api_key:
        message = (
            "OPENAI_API_KEY is not set. Put it in .env (see .env.example), "
            "or set LATTICE_FAKE_LLM=1 for offline pipeline tests."
        )
        _log_api_call(
            slug,
            call_id=call_id,
            model=model,
            status="error",
            label=resolved_label,
            n_messages=len(messages),
            approx_chars=approx_chars,
            approx_tokens=approx_tokens,
            elapsed_ms=max(1, int((time.perf_counter() - started_at) * 1000)),
            error_message=message,
        )
        raise RuntimeError(message)
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
            parsed = extract_json(content)
            _log_api_call(
                slug,
                call_id=call_id,
                model=model,
                status="done",
                label=resolved_label,
                n_messages=len(messages),
                approx_chars=approx_chars,
                approx_tokens=approx_tokens,
                response=parsed,
                elapsed_ms=max(1, int((time.perf_counter() - started_at) * 1000)),
            )
            return parsed
        except (urllib.error.HTTPError, urllib.error.URLError, json.JSONDecodeError) as exc:
            last_err = exc
            if attempt >= retries:
                break
    if isinstance(last_err, urllib.error.HTTPError):
        detail = last_err.read().decode("utf-8", "replace")
        message = f"LLM API error {last_err.code}: {detail}"
    else:
        message = f"LLM call failed: {last_err}"

    _log_api_call(
        slug,
        call_id=call_id,
        model=model,
        status="error",
        label=resolved_label,
        n_messages=len(messages),
        approx_chars=approx_chars,
        approx_tokens=approx_tokens,
        elapsed_ms=max(1, int((time.perf_counter() - started_at) * 1000)),
        error_message=message,
    )
    raise RuntimeError(message) from last_err
