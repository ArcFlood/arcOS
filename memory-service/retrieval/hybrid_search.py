"""
hybrid_search.py — Hybrid (vector + BM25) search over LanceDB.

Uses LanceDB's native hybrid query_type to combine vector cosine similarity
and full-text search in a single query. Returns ranked Chunk-like result dicts.
"""

from __future__ import annotations

import logging
import os
from dataclasses import dataclass
from typing import Optional

import lancedb

from ingestion.embedder import embed_batch

logger = logging.getLogger(__name__)

LANCEDB_PATH = os.getenv("LANCEDB_PATH", "~/.noah-ai-hub/memory/lancedb")
TABLE_NAME = "chunks"


@dataclass
class SearchResult:
    """A single result from hybrid search."""

    conversation_id: str
    source_path: str
    title: str
    date: str
    source_type: str
    chunk_index: int
    chunk_type: str
    speaker: str
    text: str
    score: float           # Relevance score from LanceDB (higher = more relevant)


def _get_table() -> Optional[lancedb.table.Table]:
    from pathlib import Path

    db_path = Path(LANCEDB_PATH).expanduser().resolve()
    if not db_path.exists():
        logger.warning("LanceDB path does not exist: %s", db_path)
        return None
    db = lancedb.connect(str(db_path))
    if TABLE_NAME not in db.table_names():
        logger.warning("Table '%s' not found in LanceDB", TABLE_NAME)
        return None
    return db.open_table(TABLE_NAME)


def search(
    query: str,
    limit: int = 20,
    date_after: Optional[str] = None,
    query_vector: Optional[list[float]] = None,
) -> list[SearchResult]:
    """
    Run a hybrid (vector + BM25) search.

    Args:
        query: Natural language query string.
        limit: Max results to return (before re-ranking).
        date_after: Optional ISO date string — filters out results older than this.
        query_vector: Pre-computed embedding. If None, embeds `query` on the fly.

    Returns:
        List of SearchResult sorted by relevance (descending).
    """
    table = _get_table()
    if table is None:
        return []

    # Embed query if no pre-computed vector provided
    if query_vector is None:
        vectors = embed_batch([query])
        if not vectors:
            logger.error("Failed to embed query")
            return []
        query_vector = vectors[0]

    try:
        # LanceDB hybrid search: vector + FTS combined
        search_query = (
            table.search(
                query=query_vector,
                query_type="hybrid",
            )
            .text(query)                 # FTS component
            .limit(limit)
            .select([
                "conversation_id",
                "source_path",
                "title",
                "date",
                "source_type",
                "chunk_index",
                "chunk_type",
                "speaker",
                "text",
            ])
        )

        # Apply date filter if provided
        if date_after:
            search_query = search_query.where(f"date >= '{date_after}'")

        rows = search_query.to_list()

    except Exception as e:
        logger.error("LanceDB hybrid search failed: %s", e)
        # Fallback: pure vector search
        try:
            search_query = (
                table.search(query_vector)
                .limit(limit)
                .select([
                    "conversation_id",
                    "source_path",
                    "title",
                    "date",
                    "source_type",
                    "chunk_index",
                    "chunk_type",
                    "speaker",
                    "text",
                ])
            )
            if date_after:
                search_query = search_query.where(f"date >= '{date_after}'")
            rows = search_query.to_list()
        except Exception as e2:
            logger.error("Vector fallback also failed: %s", e2)
            return []

    results: list[SearchResult] = []
    for row in rows:
        score = float(row.get("_relevance_score", row.get("_distance", 0.0)))
        # LanceDB distance is inverse relevance for vector; convert
        if "_distance" in row and "_relevance_score" not in row:
            score = 1.0 - score  # cosine distance → similarity

        results.append(
            SearchResult(
                conversation_id=row["conversation_id"],
                source_path=row["source_path"],
                title=row["title"],
                date=row.get("date", ""),
                source_type=row.get("source_type", ""),
                chunk_index=row.get("chunk_index", 0),
                chunk_type=row.get("chunk_type", "section"),
                speaker=row.get("speaker", "mixed"),
                text=row["text"],
                score=score,
            )
        )

    # Sort descending by score
    results.sort(key=lambda r: r.score, reverse=True)
    logger.debug("Hybrid search for %r returned %d results", query[:50], len(results))
    return results
