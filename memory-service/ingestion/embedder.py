"""
embedder.py — Generate embeddings via Ollama /api/embeddings.

Uses nomic-embed-text by default (768-dim, local, free).
Batches requests at 50 texts each with exponential backoff on failure.
"""

from __future__ import annotations

import logging
import os
import time
from typing import Optional

import httpx

logger = logging.getLogger(__name__)

OLLAMA_URL = os.getenv("OLLAMA_URL", "http://localhost:11434")
EMBEDDING_MODEL = os.getenv("EMBEDDING_MODEL", "nomic-embed-text")
BATCH_SIZE = 50
MAX_RETRIES = 3
BASE_BACKOFF = 1.0   # seconds


def _embed_single(text: str, client: httpx.Client) -> list[float]:
    """
    Call Ollama /api/embeddings for a single text.
    Raises httpx.HTTPError on failure (caller handles retries).
    """
    resp = client.post(
        f"{OLLAMA_URL}/api/embeddings",
        json={"model": EMBEDDING_MODEL, "prompt": text},
        timeout=30.0,
    )
    resp.raise_for_status()
    return resp.json()["embedding"]


def embed_batch(texts: list[str]) -> list[list[float]]:
    """
    Embed a list of texts. Returns one 768-dim vector per text.

    Sends up to BATCH_SIZE sequential requests per call (Ollama's /api/embeddings
    is single-text; true batching is not supported by the endpoint).
    Retries with exponential backoff on transient errors.

    Raises:
        RuntimeError if Ollama is unreachable after MAX_RETRIES.
    """
    if not texts:
        return []

    embeddings: list[list[float]] = []

    with httpx.Client() as client:
        for i in range(0, len(texts), BATCH_SIZE):
            batch = texts[i : i + BATCH_SIZE]
            batch_start = time.perf_counter()

            for j, text in enumerate(batch):
                vector: Optional[list[float]] = None
                for attempt in range(1, MAX_RETRIES + 1):
                    try:
                        vector = _embed_single(text, client)
                        break
                    except (httpx.HTTPError, httpx.TimeoutException) as e:
                        if attempt == MAX_RETRIES:
                            raise RuntimeError(
                                f"Ollama embedding failed after {MAX_RETRIES} retries: {e}"
                            ) from e
                        wait = BASE_BACKOFF * (2 ** (attempt - 1))
                        logger.warning(
                            "Embed attempt %d/%d failed, retrying in %.1fs: %s",
                            attempt, MAX_RETRIES, wait, e,
                        )
                        time.sleep(wait)

                embeddings.append(vector)  # type: ignore[arg-type]

            elapsed = time.perf_counter() - batch_start
            logger.debug(
                "Embedded batch %d–%d (%d texts) in %.2fs",
                i, i + len(batch) - 1, len(batch), elapsed,
            )

    return embeddings


def verify_ollama() -> bool:
    """
    Check whether Ollama is reachable and nomic-embed-text is available.
    Returns True if OK, False otherwise (non-raising).
    """
    try:
        with httpx.Client(timeout=5.0) as client:
            resp = client.get(f"{OLLAMA_URL}/api/tags")
            resp.raise_for_status()
            models = [m["name"] for m in resp.json().get("models", [])]
            available = any(EMBEDDING_MODEL in m for m in models)
            if not available:
                logger.warning(
                    "Model '%s' not found in Ollama. Run: ollama pull %s",
                    EMBEDDING_MODEL, EMBEDDING_MODEL,
                )
            return available
    except Exception as e:
        logger.error("Ollama not reachable at %s: %s", OLLAMA_URL, e)
        return False
