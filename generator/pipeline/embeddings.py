from __future__ import annotations

import hashlib
import json
import math
import os
import urllib.request
from typing import Iterable

from .common import load_dotenv
from .llm import fake_mode_enabled


def _fake_embedding(text: str, dim: int = 64) -> list[float]:
    buf = hashlib.sha256(text.encode("utf-8")).digest()
    vals: list[float] = []
    while len(vals) < dim:
        for b in buf:
            vals.append((b / 255.0) * 2.0 - 1.0)
            if len(vals) >= dim:
                break
        buf = hashlib.sha256(buf).digest()
    return vals


_VOYAGE_BATCH = 128


def _embed_batch(texts: list[str], key: str, model: str, base: str) -> list[list[float]]:
    payload = {"model": model, "input": texts}
    req = urllib.request.Request(
        f"{base}/embeddings",
        data=json.dumps(payload).encode("utf-8"),
        headers={"Authorization": f"Bearer {key}", "Content-Type": "application/json"},
        method="POST",
    )
    with urllib.request.urlopen(req, timeout=180) as resp:
        data = json.loads(resp.read().decode("utf-8"))
    rows = data.get("data") or []
    vectors: list[list[float]] = []
    for row in rows:
        emb = row.get("embedding")
        if not isinstance(emb, list):
            raise RuntimeError("Voyage response missing embedding vector")
        vectors.append([float(x) for x in emb])
    if len(vectors) != len(texts):
        raise RuntimeError("Voyage response size mismatch")
    return vectors


def embed_texts(texts: list[str]) -> list[list[float]]:
    load_dotenv()
    if fake_mode_enabled():
        return [_fake_embedding(t) for t in texts]

    key = os.environ.get("VOYAGE_API_KEY")
    if not key:
        raise RuntimeError(
            "VOYAGE_API_KEY missing. Set it in .env, or set LATTICE_FAKE_LLM=1 for offline tests."
        )
    model = os.environ.get("VOYAGE_MODEL", "voyage-3-large")
    base = os.environ.get("VOYAGE_BASE_URL", "https://api.voyageai.com/v1").rstrip("/")

    vectors: list[list[float]] = []
    for i in range(0, len(texts), _VOYAGE_BATCH):
        vectors.extend(_embed_batch(texts[i : i + _VOYAGE_BATCH], key, model, base))
    return vectors


def cosine(a: Iterable[float], b: Iterable[float]) -> float:
    av = list(a)
    bv = list(b)
    if len(av) != len(bv):
        return 0.0
    dot = sum(x * y for x, y in zip(av, bv))
    na = math.sqrt(sum(x * x for x in av))
    nb = math.sqrt(sum(y * y for y in bv))
    if na == 0 or nb == 0:
        return 0.0
    return dot / (na * nb)


def cluster_by_threshold(vectors: list[list[float]], threshold: float) -> list[list[int]]:
    n = len(vectors)
    parent = list(range(n))

    def find(x: int) -> int:
        while parent[x] != x:
            parent[x] = parent[parent[x]]
            x = parent[x]
        return x

    def union(a: int, b: int) -> None:
        ra, rb = find(a), find(b)
        if ra != rb:
            parent[rb] = ra

    for i in range(n):
        for j in range(i + 1, n):
            if cosine(vectors[i], vectors[j]) >= threshold:
                union(i, j)

    grouped: dict[int, list[int]] = {}
    for i in range(n):
        grouped.setdefault(find(i), []).append(i)
    return list(grouped.values())
