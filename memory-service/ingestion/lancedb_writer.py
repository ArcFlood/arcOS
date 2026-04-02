"""
lancedb_writer.py — Store and manage chunks in LanceDB.

Schema matches PRD metadata spec. Upsert by conversation_id:
  - If file_hash unchanged → skip entirely
  - If file_hash changed → delete old chunks, insert new ones
  - FTS index on 'text' column for hybrid search (BM25 + vector)
"""

from __future__ import annotations

import logging
import os
from pathlib import Path
from typing import Any

import lancedb
import pyarrow as pa

from ingestion.chunker import Chunk

logger = logging.getLogger(__name__)

LANCEDB_PATH = os.getenv("LANCEDB_PATH", "~/.noah-ai-hub/memory/lancedb")
EMBEDDING_MODEL = os.getenv("EMBEDDING_MODEL", "nomic-embed-text")
TABLE_NAME = "chunks"
VECTOR_DIM = 768


# ── Schema ────────────────────────────────────────────────────────────────────

def _build_schema() -> pa.Schema:
    return pa.schema([
        pa.field("conversation_id", pa.string()),
        pa.field("source_path", pa.string()),
        pa.field("title", pa.string()),
        pa.field("date", pa.string()),
        pa.field("source_type", pa.string()),
        pa.field("file_hash", pa.string()),
        pa.field("chunk_index", pa.int32()),
        pa.field("total_chunks", pa.int32()),
        pa.field("chunk_type", pa.string()),
        pa.field("speaker", pa.string()),
        pa.field("text", pa.string()),
        pa.field("embedding_model", pa.string()),
        pa.field("vector", pa.list_(pa.float32(), VECTOR_DIM)),
    ])


def _chunk_to_row(chunk: Chunk, vector: list[float]) -> dict[str, Any]:
    return {
        "conversation_id": chunk.conversation_id,
        "source_path": chunk.source_path,
        "title": chunk.title,
        "date": chunk.date,
        "source_type": chunk.source_type,
        "file_hash": chunk.file_hash,
        "chunk_index": chunk.chunk_index,
        "total_chunks": chunk.total_chunks,
        "chunk_type": chunk.chunk_type,
        "speaker": chunk.speaker,
        "text": chunk.text,
        "embedding_model": EMBEDDING_MODEL,
        "vector": [float(v) for v in vector],
    }


# ── DB connection ─────────────────────────────────────────────────────────────

def _get_db() -> lancedb.DBConnection:
    db_path = Path(LANCEDB_PATH).expanduser().resolve()
    db_path.mkdir(parents=True, exist_ok=True)
    return lancedb.connect(str(db_path))


def _get_or_create_table(db: lancedb.DBConnection) -> lancedb.table.Table:
    """Return existing table or create it with the correct schema."""
    if TABLE_NAME in db.table_names():
        return db.open_table(TABLE_NAME)

    logger.info("Creating LanceDB table '%s'", TABLE_NAME)
    schema = _build_schema()
    # Create with empty data using schema
    table = db.create_table(TABLE_NAME, schema=schema)
    return table


# ── Public API ────────────────────────────────────────────────────────────────

def get_stored_hash(conversation_id: str) -> str | None:
    """
    Return the stored file_hash for a conversation_id, or None if not indexed.
    Used to skip re-embedding unchanged files.
    """
    try:
        db = _get_db()
        if TABLE_NAME not in db.table_names():
            return None
        table = db.open_table(TABLE_NAME)
        results = (
            table.search()
            .where(f"conversation_id = '{conversation_id}' AND chunk_index = 0")
            .select(["file_hash"])
            .limit(1)
            .to_list()
        )
        if results:
            return results[0]["file_hash"]
        return None
    except Exception as e:
        logger.debug("get_stored_hash error for %s: %s", conversation_id, e)
        return None


def upsert_chunks(chunks: list[Chunk], vectors: list[list[float]]) -> None:
    """
    Insert chunks (with their vectors) into LanceDB.
    Old chunks for the same conversation_id are deleted first.

    Args:
        chunks: list of Chunk objects (all from the same conversation)
        vectors: parallel list of embedding vectors
    """
    if not chunks:
        return

    conversation_id = chunks[0].conversation_id
    db = _get_db()
    table = _get_or_create_table(db)

    # Delete old chunks for this conversation
    try:
        table.delete(f"conversation_id = '{conversation_id}'")
    except Exception as e:
        logger.debug("Delete pre-existing chunks: %s (ok if table was empty)", e)

    # Build rows
    rows = [_chunk_to_row(c, v) for c, v in zip(chunks, vectors)]
    table.add(rows)

    logger.debug(
        "Upserted %d chunks for conversation %s ('%s')",
        len(rows), conversation_id, chunks[0].title,
    )


def delete_conversation(source_path: str) -> int:
    """
    Remove all chunks whose source_path matches. Called by the file watcher
    when a file is deleted from the vault.

    Returns count of rows deleted (approximate — LanceDB doesn't expose this
    directly, so we query before deleting).
    """
    try:
        db = _get_db()
        if TABLE_NAME not in db.table_names():
            return 0
        table = db.open_table(TABLE_NAME)
        # Escape single quotes in path
        safe_path = source_path.replace("'", "''")
        results = (
            table.search()
            .where(f"source_path = '{safe_path}'")
            .select(["conversation_id"])
            .limit(10000)
            .to_list()
        )
        count = len(results)
        if count > 0:
            table.delete(f"source_path = '{safe_path}'")
            logger.info("Deleted %d chunks for path: %s", count, source_path)
        return count
    except Exception as e:
        logger.warning("delete_conversation error: %s", e)
        return 0


def create_fts_index() -> None:
    """
    Create (or replace) a full-text search index on the 'text' column.
    Required for hybrid search. Safe to call after initial bulk ingest.
    """
    try:
        db = _get_db()
        if TABLE_NAME not in db.table_names():
            logger.warning("Cannot create FTS index — table does not exist yet")
            return
        table = db.open_table(TABLE_NAME)
        table.create_fts_index("text", replace=True)
        logger.info("FTS index created/updated on 'text' column")
    except Exception as e:
        logger.error("FTS index creation failed: %s", e)


def get_stats() -> dict:
    """
    Return index statistics for the /status endpoint.
    """
    try:
        db = _get_db()
        if TABLE_NAME not in db.table_names():
            return {
                "indexed_docs": 0,
                "indexed_chunks": 0,
                "db_size_mb": 0.0,
                "embedding_model": EMBEDDING_MODEL,
            }
        table = db.open_table(TABLE_NAME)
        total_chunks = table.count_rows()

        # Count distinct conversations via summary chunks
        try:
            summaries = (
                table.search()
                .where("chunk_type = 'summary'")
                .select(["conversation_id"])
                .limit(1_000_000)
                .to_list()
            )
            unique_docs = len({r["conversation_id"] for r in summaries})
        except Exception:
            unique_docs = 0

        # DB size
        db_path = Path(LANCEDB_PATH).expanduser().resolve()
        size_bytes = sum(f.stat().st_size for f in db_path.rglob("*") if f.is_file())
        size_mb = round(size_bytes / (1024 * 1024), 2)

        return {
            "indexed_docs": unique_docs,
            "indexed_chunks": total_chunks,
            "db_size_mb": size_mb,
            "embedding_model": EMBEDDING_MODEL,
        }
    except Exception as e:
        logger.error("get_stats error: %s", e)
        return {
            "indexed_docs": 0,
            "indexed_chunks": 0,
            "db_size_mb": 0.0,
            "embedding_model": EMBEDDING_MODEL,
        }
