from __future__ import annotations

import json
import os
import re
from pathlib import Path
from typing import Any

VALID_NODE_TYPES = {"concept", "procedure"}
VALID_EDGE_TYPES = {
    "prerequisite_of",
    "part_of",
    "used_in",
    "causes",
    "contrasts_with",
    "analogous_to",
}
VALID_ITEM_KINDS = {"atomic", "connection", "composition"}  # v1 only
METHODS_BY_KIND = {
    "atomic": {"cloze", "free_recall", "application"},
    "connection": {"relational", "free_recall"},
    "composition": {"relational", "free_recall", "application"},
}
VALID_LEVELS = {"working", "deep", "exam-ready"}


def ask(prompt: str, default: str = "") -> str:
    suffix = f" [{default}]" if default else ""
    try:
        value = input(f"{prompt}{suffix}: ").strip()
    except EOFError:
        value = ""
    return value or default


def repo_root() -> Path:
    return Path(__file__).resolve().parents[2]


def load_dotenv() -> None:
    env_path = repo_root() / ".env"
    if not env_path.exists():
        return
    for raw in env_path.read_text(encoding="utf-8").splitlines():
        line = raw.strip()
        if not line or line.startswith("#") or "=" not in line:
            continue
        key, _, value = line.partition("=")
        key = key.strip()
        value = value.strip().strip('"').strip("'")
        if key and key not in os.environ:
            os.environ[key] = value


def slugify(name: str) -> str:
    s = re.sub(r"[^a-zA-Z0-9]+", "-", name.lower()).strip("-")
    return s or "topic"


def ensure_json_file(path: Path, data: Any) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(data, indent=2, ensure_ascii=False), encoding="utf-8")
