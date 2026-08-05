from __future__ import annotations

import json
from typing import Any

from .artifacts import artifact_root

_current_slug: str | None = None


def set_stream_slug(slug: str | None) -> None:
    """Set the active artifact slug for contextual status events (LLM/embed waits)."""
    global _current_slug
    _current_slug = slug


def get_stream_slug() -> str | None:
    return _current_slug


def stream_write(slug: str | None, event: dict[str, Any]) -> None:
    """Append one NDJSON event. Pass slug=None to skip (caller intentionally silent)."""
    if not slug:
        return
    path = artifact_root(slug) / "stream.ndjson"
    path.parent.mkdir(parents=True, exist_ok=True)
    with path.open("a", encoding="utf-8") as fh:
        fh.write(json.dumps(event, ensure_ascii=False) + "\n")
        fh.flush()


def stream_status(event: dict[str, Any]) -> None:
    """Write a status/step event to the active run (if any)."""
    if _current_slug:
        stream_write(_current_slug, event)


def stream_step(label: str, detail: str | None = None, **extra: Any) -> None:
    payload: dict[str, Any] = {"type": "step", "label": label}
    if detail:
        payload["detail"] = detail
    payload.update(extra)
    stream_status(payload)
