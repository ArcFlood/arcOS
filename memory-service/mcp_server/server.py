"""
server.py — ARC-Memory MCP server (Phase 2).

Changes from Phase 1:
  - /query now supports use_hyde=true (HyDE expansion) and use_reranker=true
  - Context compressor applied after reranking when compress=true
  - File watcher started on lifespan startup
  - /status includes watcher state

Endpoints:
  GET  /status   — Index stats + last ingest time + watcher state
  POST /query    — Hybrid search with optional HyDE + reranking + compression
  POST /ingest   — Trigger ingestion pipeline as background task
"""

from __future__ import annotations

import asyncio
import json
import logging
import os
import time
from contextlib import asynccontextmanager
from pathlib import Path
from typing import Optional
from urllib.parse import quote

from dotenv import load_dotenv
from fastapi import BackgroundTasks, FastAPI
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel, Field

load_dotenv()

from ingestion.embedder import verify_ollama
from ingestion.lancedb_writer import get_stats
from retrieval.hybrid_search import SearchResult, search
from watcher.file_watcher import start_watcher, stop_watcher, is_running as watcher_running

logger = logging.getLogger(__name__)

MCP_PORT = int(os.getenv("MCP_PORT", "8082"))
MANIFEST_PATH = Path("~/.noah-ai-hub/memory/last_ingest.json").expanduser()
VAULT_PATH = Path(os.getenv("VAULT_PATH", "")).expanduser()

_ingest_running = False
_ingest_last_result: dict = {}


# ── Lifespan ──────────────────────────────────────────────────────────────────

@asynccontextmanager
async def lifespan(app: FastAPI):
    logging.basicConfig(
        level=logging.INFO,
        format="%(asctime)s [%(levelname)s] %(name)s: %(message)s",
    )
    logger.info("ARC-Memory MCP server starting on port %d", MCP_PORT)

    if not verify_ollama():
        logger.warning(
            "Ollama not reachable — queries will fail until Ollama is running "
            "and nomic-embed-text is available."
        )

    # Start file watcher in background
    try:
        start_watcher()
    except Exception as e:
        logger.warning("File watcher failed to start: %s", e)

    yield

    stop_watcher()
    logger.info("ARC-Memory MCP server shutting down")


app = FastAPI(
    title="ARC-Memory MCP Server",
    version="2.0.0",
    description="Local RAG memory layer for ARCOS — Phase 2 (HyDE + reranking)",
    lifespan=lifespan,
)

app.add_middleware(
    CORSMiddleware,
    allow_origins=[
        "http://localhost",
        "http://localhost:3000",
        "http://localhost:5173",
        "http://localhost:8082",
    ],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)


# ── Request / Response models ─────────────────────────────────────────────────

class QueryRequest(BaseModel):
    query: str
    limit: int = Field(default=20, ge=1, le=100)
    date_after: Optional[str] = None
    use_hyde: bool = True
    use_reranker: bool = True
    rerank_top_k: int = Field(default=5, ge=1, le=20)
    compress: bool = True
    token_budget: int = Field(default=2000, ge=200, le=8000)


class QueryResponse(BaseModel):
    chunks: list[dict]
    citations: list[dict]
    query_time_ms: int
    total_results: int
    hyde_used: bool
    reranker_used: bool
    compressed: bool


class IngestRequest(BaseModel):
    force: bool = False


class IngestResponse(BaseModel):
    status: str
    message: str
    result: Optional[dict] = None


# ── Helpers ───────────────────────────────────────────────────────────────────

def _chunk_to_dict(chunk) -> dict:
    return {
        "conversation_id": chunk.conversation_id,
        "source_path": chunk.source_path,
        "title": chunk.title,
        "date": chunk.date,
        "source_type": chunk.source_type,
        "chunk_index": chunk.chunk_index,
        "chunk_type": chunk.chunk_type,
        "speaker": chunk.speaker,
        "text": chunk.text,
        "score": round(getattr(chunk, "rerank_score", getattr(chunk, "score", 0.0)), 4),
        "compressed": getattr(chunk, "compressed", False),
    }


def _chunk_to_citation(chunk) -> dict:
    text = chunk.text
    vault_name = VAULT_PATH.name or "ArcVault"
    try:
        relative_path = (
            Path(chunk.source_path).resolve().relative_to(VAULT_PATH.resolve())
            if VAULT_PATH and VAULT_PATH.exists()
            else Path(chunk.source_path).name
        )
    except ValueError:
        relative_path = Path(chunk.source_path).name
    relative_path_str = relative_path.as_posix() if isinstance(relative_path, Path) else str(relative_path)
    return {
        "title": chunk.title,
        "date": chunk.date,
        "source_type": chunk.source_type,
        "source_path": chunk.source_path,
        "excerpt": text[:200] + ("..." if len(text) > 200 else ""),
        "score": round(getattr(chunk, "rerank_score", getattr(chunk, "score", 0.0)), 4),
        "compressed": getattr(chunk, "compressed", False),
        "obsidian_uri": (
            "obsidian://open?vault="
            + quote(vault_name, safe="")
            + "&file="
            + quote(relative_path_str, safe="/")
        ),
    }


def _is_meaningful_chunk(chunk) -> bool:
    title = (chunk.title or "").strip().lower()
    text = (chunk.text or "").strip()

    if not text:
        return False

    if title in {"untitled", "new note", "untitled.md"} and len(text) < 40:
        return False

    return True


def _dedupe_chunks_by_source_path(chunks: list) -> list:
    best_by_path: dict[str, object] = {}

    for chunk in chunks:
        existing = best_by_path.get(chunk.source_path)
        chunk_score = getattr(chunk, "rerank_score", getattr(chunk, "score", 0.0))
        if existing is None:
            best_by_path[chunk.source_path] = chunk
            continue

        existing_score = getattr(existing, "rerank_score", getattr(existing, "score", 0.0))
        if chunk_score > existing_score:
            best_by_path[chunk.source_path] = chunk

    deduped = list(best_by_path.values())
    deduped.sort(
        key=lambda chunk: getattr(chunk, "rerank_score", getattr(chunk, "score", 0.0)),
        reverse=True,
    )
    return deduped


def _last_ingest_time() -> Optional[str]:
    try:
        if MANIFEST_PATH.exists():
            return json.loads(MANIFEST_PATH.read_text()).get("timestamp")
        return None
    except Exception:
        return None


async def _run_ingest_async(force: bool) -> None:
    global _ingest_running, _ingest_last_result
    _ingest_running = True
    try:
        loop = asyncio.get_event_loop()
        from ingestion.run_ingest import run_ingest
        result = await loop.run_in_executor(None, lambda: run_ingest(force=force))
        _ingest_last_result = result
        logger.info("Background ingest complete: %s", result)
    except Exception as e:
        logger.error("Background ingest failed: %s", e)
        _ingest_last_result = {"error": str(e)}
    finally:
        _ingest_running = False


# ── Endpoints ─────────────────────────────────────────────────────────────────

@app.get("/status")
async def status() -> dict:
    stats = get_stats()
    return {
        **stats,
        "last_indexed": _last_ingest_time(),
        "ingest_running": _ingest_running,
        "watcher_running": watcher_running(),
        "server": "arc-memory",
        "version": "2.0.0",
    }


@app.post("/query", response_model=QueryResponse)
async def query(req: QueryRequest) -> QueryResponse:
    """
    Hybrid search with optional HyDE, cross-encoder reranking, and compression.

    Pipeline:
      raw query
        → [HyDE] generate hypothetical answer, embed that instead
        → hybrid_search (vector + BM25)
        → [reranker] cross-encoder reranking → top_k
        → [compressor] summarize lower-ranked chunks to fit token budget
    """
    t0 = time.perf_counter()
    hyde_used = False
    reranker_used = False
    query_vector = None

    # ── Step 1: HyDE expansion ────────────────────────────────────────────────
    if req.use_hyde:
        try:
            loop = asyncio.get_event_loop()
            from retrieval.hyde import expand_query
            from ingestion.embedder import embed_batch

            expanded = await loop.run_in_executor(None, expand_query, req.query)
            if expanded != req.query:
                vecs = await loop.run_in_executor(None, embed_batch, [expanded])
                if vecs:
                    query_vector = vecs[0]
                    hyde_used = True
        except Exception as e:
            logger.warning("HyDE failed, falling back to raw query: %s", e)

    # ── Step 2: Hybrid search ─────────────────────────────────────────────────
    raw_results: list[SearchResult] = search(
        query=req.query,
        limit=req.limit,
        date_after=req.date_after,
        query_vector=query_vector,
    )

    # ── Step 3: Reranking ─────────────────────────────────────────────────────
    final_chunks: list = raw_results

    if req.use_reranker and raw_results:
        try:
            loop = asyncio.get_event_loop()
            from retrieval.reranker import rerank
            final_chunks = await loop.run_in_executor(
                None, rerank, req.query, raw_results, req.rerank_top_k
            )
            reranker_used = True
        except Exception as e:
            logger.warning("Reranker failed, using raw results: %s", e)
            final_chunks = raw_results[:req.rerank_top_k]

    # ── Step 4: Compression ───────────────────────────────────────────────────
    compressed = False
    if req.compress and final_chunks:
        try:
            loop = asyncio.get_event_loop()
            from prompting.compressor import compress
            final_chunks = await loop.run_in_executor(
                None, compress, final_chunks, req.token_budget
            )
            compressed = any(getattr(c, "compressed", False) for c in final_chunks)
        except Exception as e:
            logger.warning("Compressor failed, using uncompressed chunks: %s", e)

    final_chunks = [chunk for chunk in final_chunks if _is_meaningful_chunk(chunk)]
    final_chunks = _dedupe_chunks_by_source_path(final_chunks)

    elapsed_ms = int((time.perf_counter() - t0) * 1000)

    return QueryResponse(
        chunks=[_chunk_to_dict(c) for c in final_chunks],
        citations=[_chunk_to_citation(c) for c in final_chunks[:5]],
        query_time_ms=elapsed_ms,
        total_results=len(final_chunks),
        hyde_used=hyde_used,
        reranker_used=reranker_used,
        compressed=compressed,
    )


@app.post("/ingest", response_model=IngestResponse)
async def ingest(req: IngestRequest, background_tasks: BackgroundTasks) -> IngestResponse:
    global _ingest_running
    if _ingest_running:
        return IngestResponse(
            status="already_running",
            message="Ingestion is already in progress. Poll /status for updates.",
        )
    background_tasks.add_task(_run_ingest_async, req.force)
    return IngestResponse(
        status="started",
        message=f"Ingestion started (force={req.force}). Poll /status for progress.",
    )


# ── Entry point ───────────────────────────────────────────────────────────────

def main() -> None:
    import uvicorn
    uvicorn.run(
        "mcp_server.server:app",
        host="127.0.0.1",
        port=MCP_PORT,
        reload=False,
        log_level="info",
    )


if __name__ == "__main__":
    main()
