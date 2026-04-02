"""
server.py — FastAPI MCP server on port 8082.

Endpoints:
  GET  /status   — Index stats + last ingest time
  POST /query    — Hybrid search, returns ranked chunks
  POST /ingest   — Trigger ingestion pipeline as background task

Architecture mirrors Fabric on port 8080 — same pattern, easy to add to
ARC-Hub serviceStore.ts.
"""

from __future__ import annotations

import asyncio
import json
import logging
import os
import time
from contextlib import asynccontextmanager
from datetime import datetime, timezone
from pathlib import Path
from typing import Optional

from dotenv import load_dotenv
from fastapi import BackgroundTasks, FastAPI
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel, Field

load_dotenv()

from ingestion.embedder import verify_ollama
from ingestion.lancedb_writer import get_stats
from retrieval.hybrid_search import SearchResult, search

logger = logging.getLogger(__name__)

MCP_PORT = int(os.getenv("MCP_PORT", "8082"))
MANIFEST_PATH = Path("~/.noah-ai-hub/memory/last_ingest.json").expanduser()

# Track background ingest state
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
    yield
    logger.info("ARC-Memory MCP server shutting down")


app = FastAPI(
    title="ARC-Memory MCP Server",
    version="1.0.0",
    description="Local RAG memory layer for ARC-Hub",
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


# ── Models ────────────────────────────────────────────────────────────────────

class QueryRequest(BaseModel):
    query: str
    limit: int = Field(default=20, ge=1, le=100)
    date_after: Optional[str] = None      # ISO date string e.g. "2024-01-01"
    use_hyde: bool = False                # Phase 2 — placeholder for now


class QueryResponse(BaseModel):
    chunks: list[dict]
    citations: list[dict]
    query_time_ms: int
    total_results: int


class IngestRequest(BaseModel):
    force: bool = False


class IngestResponse(BaseModel):
    status: str
    message: str
    result: Optional[dict] = None


# ── Helpers ───────────────────────────────────────────────────────────────────

def _result_to_dict(r: SearchResult) -> dict:
    return {
        "conversation_id": r.conversation_id,
        "source_path": r.source_path,
        "title": r.title,
        "date": r.date,
        "source_type": r.source_type,
        "chunk_index": r.chunk_index,
        "chunk_type": r.chunk_type,
        "speaker": r.speaker,
        "text": r.text,
        "score": round(r.score, 4),
    }


def _result_to_citation(r: SearchResult) -> dict:
    """Minimal citation card data for ARC-Hub UI."""
    return {
        "title": r.title,
        "date": r.date,
        "source_type": r.source_type,
        "source_path": r.source_path,
        "excerpt": r.text[:200] + ("..." if len(r.text) > 200 else ""),
        "score": round(r.score, 4),
        "obsidian_uri": (
            "obsidian://open?vault=ArcVault&file="
            + r.source_path.replace("/Users/noahpowell/ArcVault/", "")
        ),
    }


def _last_ingest_time() -> Optional[str]:
    try:
        if MANIFEST_PATH.exists():
            manifest = json.loads(MANIFEST_PATH.read_text())
            return manifest.get("timestamp")
        return None
    except Exception:
        return None


async def _run_ingest_async(force: bool) -> None:
    global _ingest_running, _ingest_last_result
    _ingest_running = True
    try:
        # Run in thread pool to avoid blocking the event loop
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
    """Return index statistics and server health."""
    stats = get_stats()
    return {
        **stats,
        "last_indexed": _last_ingest_time(),
        "ingest_running": _ingest_running,
        "server": "arc-memory",
        "version": "1.0.0",
    }


@app.post("/query", response_model=QueryResponse)
async def query(req: QueryRequest) -> QueryResponse:
    """
    Hybrid semantic + keyword search over indexed conversations.

    Phase 2 note: when use_hyde=True is sent, it currently falls back to
    standard search. HyDE implementation is Phase 2.
    """
    t0 = time.perf_counter()

    if req.use_hyde:
        logger.debug("use_hyde=True requested but HyDE is Phase 2 — using standard search")

    results = search(
        query=req.query,
        limit=req.limit,
        date_after=req.date_after,
    )

    elapsed_ms = int((time.perf_counter() - t0) * 1000)

    return QueryResponse(
        chunks=[_result_to_dict(r) for r in results],
        citations=[_result_to_citation(r) for r in results[:5]],
        query_time_ms=elapsed_ms,
        total_results=len(results),
    )


@app.post("/ingest", response_model=IngestResponse)
async def ingest(req: IngestRequest, background_tasks: BackgroundTasks) -> IngestResponse:
    """
    Trigger ingestion pipeline as a background task.
    Returns immediately — poll /status to check progress.
    """
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
