from __future__ import annotations

import json
from typing import Any

from .artifacts import artifact_root


def stream_write(slug: str | None, event: dict[str, Any]) -> None:
    if not slug:
        return
    path = artifact_root(slug) / "stream.ndjson"
    path.parent.mkdir(parents=True, exist_ok=True)
    with path.open("a", encoding="utf-8") as fh:
        fh.write(json.dumps(event, ensure_ascii=False) + "\n")
        fh.flush()
