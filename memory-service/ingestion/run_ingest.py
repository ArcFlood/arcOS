"""
run_ingest.py — Orchestration script for the full ingestion pipeline.

Pipeline per file:
  obsidian_reader → chunker → embedder → lancedb_writer

Features:
- Skips files whose SHA256 hash matches the stored hash (no re-embedding)
- Progress bar via tqdm
- Run manifest saved to ~/.noah-ai-hub/memory/last_ingest.json
- FTS index created/refreshed at the end of a full ingest
"""

from __future__ import annotations

import json
import logging
import os
import sys
import time
from datetime import datetime, timezone
from pathlib import Path

from dotenv import load_dotenv
from tqdm import tqdm

load_dotenv()

from ingestion.chunker import chunk_document
from ingestion.embedder import embed_batch, verify_ollama
from ingestion.lancedb_writer import (
    create_fts_index,
    get_stored_hash,
    upsert_chunks,
)
from ingestion.obsidian_reader import walk_vault

logger = logging.getLogger(__name__)

VAULT_PATH = os.getenv("VAULT_PATH", "~/ArcVault/AIChats")
MANIFEST_PATH = Path("~/.noah-ai-hub/memory/last_ingest.json").expanduser()


def _save_manifest(stats: dict) -> None:
    MANIFEST_PATH.parent.mkdir(parents=True, exist_ok=True)
    MANIFEST_PATH.write_text(json.dumps(stats, indent=2))


def run_ingest(vault_path: str | None = None, force: bool = False) -> dict:
    """
    Run the full ingestion pipeline.

    Args:
        vault_path: Override for VAULT_PATH env var.
        force: If True, re-embed all files regardless of hash.

    Returns:
        dict with docs_processed, docs_skipped, docs_failed, duration_ms
    """
    start = time.perf_counter()
    target_vault = vault_path or VAULT_PATH

    logging.basicConfig(
        level=logging.INFO,
        format="%(asctime)s [%(levelname)s] %(name)s: %(message)s",
    )

    # ── Verify Ollama ─────────────────────────────────────────────────────────
    logger.info("Checking Ollama availability...")
    if not verify_ollama():
        logger.error("Ollama not reachable. Ensure it is running and nomic-embed-text is pulled.")
        sys.exit(1)

    # ── Read vault ────────────────────────────────────────────────────────────
    logger.info("Walking vault: %s", target_vault)
    docs = walk_vault(target_vault)
    logger.info("Found %d valid documents", len(docs))

    processed = 0
    skipped = 0
    failed = 0

    # ── Ingest loop ───────────────────────────────────────────────────────────
    with tqdm(docs, desc="Indexing", unit="doc", ncols=80) as pbar:
        for doc in pbar:
            pbar.set_postfix_str(doc.title[:30])

            try:
                # Skip if unchanged
                if not force:
                    stored_hash = get_stored_hash(doc.conversation_id)
                    if stored_hash == doc.file_hash:
                        skipped += 1
                        continue

                # Chunk
                chunks = chunk_document(doc)
                if not chunks:
                    logger.debug("No chunks produced for %s — skipping", doc.title)
                    skipped += 1
                    continue

                # Embed
                texts = [c.text for c in chunks]
                vectors = embed_batch(texts)

                # Store
                upsert_chunks(chunks, vectors)
                processed += 1

            except Exception as e:
                logger.error("Failed to process '%s': %s", doc.title, e)
                failed += 1

    # ── Rebuild FTS index ─────────────────────────────────────────────────────
    if processed > 0:
        logger.info("Rebuilding FTS index...")
        create_fts_index()

    duration_ms = int((time.perf_counter() - start) * 1000)
    total = processed + skipped + failed

    stats = {
        "timestamp": datetime.now(timezone.utc).isoformat(),
        "vault_path": str(Path(target_vault).expanduser().resolve()),
        "docs_total": total,
        "docs_processed": processed,
        "docs_skipped": skipped,
        "docs_failed": failed,
        "duration_ms": duration_ms,
        "forced": force,
    }
    _save_manifest(stats)

    logger.info(
        "Ingest complete: %d processed / %d skipped / %d failed — %.1fs",
        processed, skipped, failed, duration_ms / 1000,
    )
    return stats


def main() -> None:
    import argparse

    parser = argparse.ArgumentParser(description="ARC-Memory ingestion pipeline")
    parser.add_argument("--vault", help="Override VAULT_PATH", default=None)
    parser.add_argument("--force", action="store_true", help="Re-embed all files, ignoring hash cache")
    args = parser.parse_args()

    stats = run_ingest(vault_path=args.vault, force=args.force)
    print(json.dumps(stats, indent=2))


if __name__ == "__main__":
    main()
