"""
reranker.py — Cross-encoder re-ranking using ms-marco-MiniLM-L-6-v2.

Takes the top-N hybrid search results and scores each (query, chunk) pair
with a cross-encoder. Much more accurate than bi-encoder similarity alone
because it attends to both texts jointly.

Model is loaded once at module import and cached in memory. First load
downloads ~80MB to ~/.cache/huggingface/. Subsequent runs are instant.

Target: < 500ms for 20 chunks on Apple Silicon CPU (M1/M2/M3).
"""

from __future__ import annotations

import logging
import time
from dataclasses import dataclass
from typing import TYPE_CHECKING

if TYPE_CHECKING:
    from retrieval.hybrid_search import SearchResult

logger = logging.getLogger(__name__)

MODEL_NAME = "cross-encoder/ms-marco-MiniLM-L-6-v2"

# Lazy-loaded — only imported when rerank() is first called
_model = None


def _load_model():
    global _model
    if _model is None:
        from sentence_transformers import CrossEncoder
        logger.info("Loading cross-encoder model: %s", MODEL_NAME)
        t0 = time.perf_counter()
        _model = CrossEncoder(MODEL_NAME, max_length=512)
        logger.info("Cross-encoder loaded in %.2fs", time.perf_counter() - t0)
    return _model


@dataclass
class RankedChunk:
    """A search result with a cross-encoder relevance score attached."""
    conversation_id: str
    source_path: str
    title: str
    date: str
    source_type: str
    chunk_index: int
    chunk_type: str
    speaker: str
    text: str
    vector_score: float    # Original hybrid search score
    rerank_score: float    # Cross-encoder score (higher = more relevant)


def rerank(
    query: str,
    results: list[SearchResult],
    top_k: int = 5,
) -> list[RankedChunk]:
    """
    Re-rank search results using a cross-encoder.

    Args:
        query: The original search query.
        results: Hybrid search results to re-rank.
        top_k: Number of top results to return after re-ranking.

    Returns:
        List of RankedChunk sorted by rerank_score descending, length <= top_k.
    """
    if not results:
        return []

    t0 = time.perf_counter()
    model = _load_model()

    # Build (query, passage) pairs for the cross-encoder
    pairs = [(query, r.text) for r in results]

    try:
        scores = model.predict(pairs, show_progress_bar=False)
    except Exception as e:
        logger.error("Cross-encoder inference failed: %s — returning unranked results", e)
        # Graceful fallback: return top_k by original score
        return [
            RankedChunk(
                conversation_id=r.conversation_id,
                source_path=r.source_path,
                title=r.title,
                date=r.date,
                source_type=r.source_type,
                chunk_index=r.chunk_index,
                chunk_type=r.chunk_type,
                speaker=r.speaker,
                text=r.text,
                vector_score=r.score,
                rerank_score=r.score,
            )
            for r in results[:top_k]
        ]

    # Pair scores with results
    scored = [
        RankedChunk(
            conversation_id=r.conversation_id,
            source_path=r.source_path,
            title=r.title,
            date=r.date,
            source_type=r.source_type,
            chunk_index=r.chunk_index,
            chunk_type=r.chunk_type,
            speaker=r.speaker,
            text=r.text,
            vector_score=r.score,
            rerank_score=float(score),
        )
        for r, score in zip(results, scores)
    ]

    scored.sort(key=lambda c: c.rerank_score, reverse=True)
    top = scored[:top_k]

    elapsed = (time.perf_counter() - t0) * 1000
    logger.debug(
        "Reranked %d → %d results in %.0fms (top score: %.4f)",
        len(results), len(top), elapsed, top[0].rerank_score if top else 0,
    )

    return top
