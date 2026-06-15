from __future__ import annotations

import json
from pathlib import Path
from typing import Any

from .common import repo_root


def artifact_root(slug: str) -> Path:
    return repo_root() / "generator" / "artifacts" / slug


def phase_path(slug: str, phase: str) -> Path:
    return artifact_root(slug) / f"{phase}.json"


def phase_done(slug: str, phase: str) -> bool:
    return phase_path(slug, phase).exists()


def write_phase(slug: str, phase: str, data: Any) -> Path:
    path = phase_path(slug, phase)
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(data, indent=2, ensure_ascii=False), encoding="utf-8")
    return path


def read_phase(slug: str, phase: str) -> dict[str, Any]:
    path = phase_path(slug, phase)
    return json.loads(path.read_text(encoding="utf-8"))
