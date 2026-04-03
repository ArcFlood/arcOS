"""
file_watcher.py — Incremental vault indexing via watchdog.

Watches VAULT_PATH recursively for .md file changes. Debounces rapid
Obsidian saves (300ms window) before triggering the ingest pipeline.
Runs as a background thread inside the FastAPI lifespan.

Events handled:
  FileCreated / FileModified → single-file ingest
  FileDeleted               → remove all chunks for that path from LanceDB
  FileMovedEvent            → delete old path chunks, ingest new path

Lock file at ~/.noah-ai-hub/memory/ingest.lock prevents concurrent runs
with the bulk ingest triggered via POST /ingest.
"""

from __future__ import annotations

import logging
import os
import threading
import time
from pathlib import Path

from watchdog.events import (
    FileCreatedEvent,
    FileDeletedEvent,
    FileModifiedEvent,
    FileMovedEvent,
    FileSystemEventHandler,
)
from watchdog.observers import Observer

logger = logging.getLogger(__name__)

VAULT_PATH = os.getenv("VAULT_PATH", "~/ArcVault/AIChats")
DEBOUNCE_SECONDS = 0.3
LOCK_PATH = Path("~/.noah-ai-hub/memory/ingest.lock").expanduser()


# ── Lock helpers ──────────────────────────────────────────────────────────────

def _acquire_lock() -> bool:
    """Return True if lock was acquired, False if already held."""
    try:
        LOCK_PATH.parent.mkdir(parents=True, exist_ok=True)
        if LOCK_PATH.exists():
            return False
        LOCK_PATH.touch()
        return True
    except Exception:
        return False


def _release_lock() -> None:
    try:
        LOCK_PATH.unlink(missing_ok=True)
    except Exception:
        pass


# ── Ingest single file ────────────────────────────────────────────────────────

def _ingest_file(path: str) -> None:
    """Run the full pipeline for a single .md file."""
    if not _acquire_lock():
        logger.debug("Watcher: bulk ingest running — skipping %s", path)
        return
    try:
        from ingestion.obsidian_reader import parse_file
        from ingestion.chunker import chunk_document
        from ingestion.embedder import embed_batch
        from ingestion.lancedb_writer import get_stored_hash, upsert_chunks

        p = Path(path)
        doc = parse_file(p)
        if doc is None:
            logger.debug("Watcher: skipping %s — invalid frontmatter", p.name)
            return

        stored_hash = get_stored_hash(doc.conversation_id)
        if stored_hash == doc.file_hash:
            logger.debug("Watcher: %s unchanged — skipping", p.name)
            return

        chunks = chunk_document(doc)
        if not chunks:
            return

        vectors = embed_batch([c.text for c in chunks])
        upsert_chunks(chunks, vectors)
        logger.info("Watcher: indexed %s (%d chunks)", p.name, len(chunks))

    except Exception as e:
        logger.error("Watcher: failed to index %s: %s", path, e)
    finally:
        _release_lock()


def _delete_file(path: str) -> None:
    """Remove all LanceDB chunks for a deleted file."""
    try:
        from ingestion.lancedb_writer import delete_conversation
        count = delete_conversation(path)
        if count > 0:
            logger.info("Watcher: removed %d chunks for deleted file %s", count, path)
    except Exception as e:
        logger.error("Watcher: failed to delete chunks for %s: %s", path, e)


# ── Event handler ─────────────────────────────────────────────────────────────

class VaultEventHandler(FileSystemEventHandler):
    """
    Debounced handler for vault file system events.
    Uses a per-path timer dict to collapse rapid saves into one ingest call.
    """

    def __init__(self) -> None:
        super().__init__()
        self._timers: dict[str, threading.Timer] = {}
        self._lock = threading.Lock()

    def _schedule(self, action: str, path: str) -> None:
        """Cancel any pending timer for path and schedule a new one."""
        with self._lock:
            existing = self._timers.pop(path, None)
            if existing:
                existing.cancel()

            if action == "ingest":
                t = threading.Timer(DEBOUNCE_SECONDS, _ingest_file, args=(path,))
            else:
                t = threading.Timer(DEBOUNCE_SECONDS, _delete_file, args=(path,))

            self._timers[path] = t
            t.daemon = True
            t.start()

    def on_created(self, event: FileCreatedEvent) -> None:
        if not event.is_directory and str(event.src_path).endswith(".md"):
            logger.debug("Watcher: created %s", event.src_path)
            self._schedule("ingest", str(event.src_path))

    def on_modified(self, event: FileModifiedEvent) -> None:
        if not event.is_directory and str(event.src_path).endswith(".md"):
            logger.debug("Watcher: modified %s", event.src_path)
            self._schedule("ingest", str(event.src_path))

    def on_deleted(self, event: FileDeletedEvent) -> None:
        if not event.is_directory and str(event.src_path).endswith(".md"):
            logger.debug("Watcher: deleted %s", event.src_path)
            self._schedule("delete", str(event.src_path))

    def on_moved(self, event: FileMovedEvent) -> None:
        if not event.is_directory:
            src, dest = str(event.src_path), str(event.dest_path)
            if src.endswith(".md"):
                logger.debug("Watcher: moved %s → %s", src, dest)
                self._schedule("delete", src)
            if dest.endswith(".md"):
                self._schedule("ingest", dest)


# ── Public API ────────────────────────────────────────────────────────────────

_observer: Observer | None = None


def start_watcher(vault_path: str | None = None) -> None:
    """
    Start the watchdog observer in a background daemon thread.
    Safe to call multiple times — subsequent calls are no-ops.
    """
    global _observer
    if _observer is not None and _observer.is_alive():
        logger.debug("Watcher already running")
        return

    target = Path(vault_path or VAULT_PATH).expanduser().resolve()
    if not target.exists():
        logger.warning("Watcher: vault path does not exist: %s — not starting", target)
        return

    handler = VaultEventHandler()
    _observer = Observer()
    _observer.schedule(handler, str(target), recursive=True)
    _observer.daemon = True
    _observer.start()
    logger.info("Watcher started on %s", target)


def stop_watcher() -> None:
    """Stop the watchdog observer gracefully."""
    global _observer
    if _observer is not None:
        _observer.stop()
        _observer.join(timeout=3.0)
        _observer = None
        logger.info("Watcher stopped")


def is_running() -> bool:
    return _observer is not None and _observer.is_alive()
