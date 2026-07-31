from __future__ import annotations

import contextvars
import json
from typing import Any

from .artifacts import artifact_root

_CURRENT_STREAM_SLUG: contextvars.ContextVar[str | None] = contextvars.ContextVar(
    "current_stream_slug", default=None
)


def current_stream_slug() -> str | None:
    return _CURRENT_STREAM_SLUG.get()


def set_stream_slug(slug: str | None) -> contextvars.Token[str | None]:
    return _CURRENT_STREAM_SLUG.set(slug)


def reset_stream_slug(token: contextvars.Token[str | None]) -> None:
    _CURRENT_STREAM_SLUG.reset(token)


def stream_write(slug: str | None, event: dict[str, Any]) -> None:
    target_slug = slug or current_stream_slug()
    if not target_slug:
        return
    path = artifact_root(target_slug) / "stream.ndjson"
    path.parent.mkdir(parents=True, exist_ok=True)
    with path.open("a", encoding="utf-8") as fh:
        fh.write(json.dumps(event, ensure_ascii=False) + "\n")
        fh.flush()
