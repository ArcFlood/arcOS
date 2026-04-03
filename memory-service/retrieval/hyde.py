"""
hyde.py — Hypothetical Document Embedding (HyDE) query expansion.

Instead of embedding the raw query, we ask qwen3:14b to generate a
hypothetical answer, then embed that. The resulting vector is closer
to real answer vectors in the embedding space → better recall.

SQLite cache at ~/.noah-ai-hub/memory/hyde_cache.db keyed by SHA256(query)
so repeated queries skip the Ollama call entirely.
"""

from __future__ import annotations

import hashlib
import logging
import os
import sqlite3
from pathlib import Path

import httpx

logger = logging.getLogger(__name__)

OLLAMA_URL = os.getenv("OLLAMA_URL", "http://localhost:11434")
HYDE_MODEL = os.getenv("HYDE_MODEL", "qwen3:14b")
CACHE_PATH = Path("~/.noah-ai-hub/memory/hyde_cache.db").expanduser()

HYDE_PROMPT = (
    "Answer the following question briefly and directly, "
    "as if you were an expert who has dealt with this exact problem before. "
    "Be concise — 2-4 sentences max. Do not say 'I' or 'As an AI'.\n\n"
    "Question: {query}\n\nAnswer:"
)


# ── Cache ─────────────────────────────────────────────────────────────────────

def _get_cache_conn() -> sqlite3.Connection:
    CACHE_PATH.parent.mkdir(parents=True, exist_ok=True)
    conn = sqlite3.connect(str(CACHE_PATH))
    conn.execute(
        "CREATE TABLE IF NOT EXISTS hyde_cache "
        "(query_hash TEXT PRIMARY KEY, expanded TEXT, created_at INTEGER)"
    )
    conn.commit()
    return conn


def _cache_get(query_hash: str) -> str | None:
    try:
        conn = _get_cache_conn()
        row = conn.execute(
            "SELECT expanded FROM hyde_cache WHERE query_hash = ?", (query_hash,)
        ).fetchone()
        conn.close()
        return row[0] if row else None
    except Exception as e:
        logger.debug("HyDE cache read error: %s", e)
        return None


def _cache_set(query_hash: str, expanded: str) -> None:
    try:
        import time
        conn = _get_cache_conn()
        conn.execute(
            "INSERT OR REPLACE INTO hyde_cache (query_hash, expanded, created_at) VALUES (?, ?, ?)",
            (query_hash, expanded, int(time.time())),
        )
        conn.commit()
        conn.close()
    except Exception as e:
        logger.debug("HyDE cache write error: %s", e)


# ── Core ──────────────────────────────────────────────────────────────────────

def _query_hash(query: str) -> str:
    return hashlib.sha256(query.strip().lower().encode()).hexdigest()


def expand_query(query: str, use_cache: bool = True) -> str:
    """
    Generate a hypothetical answer for the query using qwen3:14b.

    Returns the hypothetical answer text (to be embedded instead of raw query).
    Falls back to the original query on any error.

    Args:
        query: The user's search query.
        use_cache: If True, check SQLite cache before calling Ollama.
    """
    q_hash = _query_hash(query)

    if use_cache:
        cached = _cache_get(q_hash)
        if cached:
            logger.debug("HyDE cache hit for query: %s...", query[:40])
            return cached

    prompt = HYDE_PROMPT.format(query=query)

    try:
        with httpx.Client(timeout=15.0) as client:
            resp = client.post(
                f"{OLLAMA_URL}/api/generate",
                json={
                    "model": HYDE_MODEL,
                    "prompt": prompt,
                    "stream": False,
                    "options": {"temperature": 0.3, "num_predict": 120},
                },
            )
            resp.raise_for_status()
            expanded = resp.json().get("response", "").strip()

        if not expanded:
            logger.warning("HyDE returned empty response — falling back to raw query")
            return query

        if use_cache:
            _cache_set(q_hash, expanded)

        logger.debug("HyDE expanded '%s...' → '%s...'", query[:30], expanded[:60])
        return expanded

    except Exception as e:
        logger.warning("HyDE expansion failed (%s) — falling back to raw query", e)
        return query
