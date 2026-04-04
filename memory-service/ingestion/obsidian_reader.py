"""
obsidian_reader.py — Parse Obsidian .md files with frontmatter validation.

Each valid file produces a ConversationDoc. Files without valid frontmatter
are skipped with a warning. SHA256 hash enables deduplication in LanceDB.
"""

from __future__ import annotations

import hashlib
import logging
import os
import uuid
from dataclasses import dataclass, field
from pathlib import Path
from typing import Optional

import frontmatter

logger = logging.getLogger(__name__)

VALID_SOURCE_TYPES = {"chatgpt", "claude", "arcos"}


@dataclass
class ConversationDoc:
    """Structured representation of a single Obsidian conversation file."""

    # File identity
    source_path: str           # Full path to .md file
    conversation_id: str       # UUID grouping all chunks from this file
    file_hash: str             # SHA256 of raw file content

    # Frontmatter fields
    title: str
    date: str                  # ISO date string (e.g. "2024-03-15")
    source_type: str           # "chatgpt" | "claude" | "arcos"

    # Body content
    body: str                  # Raw markdown body (no frontmatter)

    # Optional frontmatter extras
    tags: list[str] = field(default_factory=list)


def _compute_hash(content: bytes) -> str:
    return hashlib.sha256(content).hexdigest()


def _safe_str(value) -> str:
    """Coerce frontmatter values to string, handling None."""
    if value is None:
        return ""
    return str(value).strip()


def parse_file(path: Path) -> Optional[ConversationDoc]:
    """
    Parse a single .md file. Returns ConversationDoc or None if invalid.

    A file is invalid if:
    - It cannot be read
    - 'source' frontmatter field is missing or not in VALID_SOURCE_TYPES
    """
    raw_bytes: bytes
    try:
        raw_bytes = path.read_bytes()
    except OSError as e:
        logger.warning("Cannot read %s: %s", path, e)
        return None

    file_hash = _compute_hash(raw_bytes)

    try:
        post = frontmatter.loads(raw_bytes.decode("utf-8", errors="replace"))
    except Exception as e:
        logger.warning("Frontmatter parse failed for %s: %s", path, e)
        return None

    source_type = _safe_str(post.metadata.get("source", "")).lower()
    if source_type not in VALID_SOURCE_TYPES:
        logger.warning(
            "Skipping %s — 'source' field is %r (expected one of %s)",
            path.name,
            source_type or "(missing)",
            VALID_SOURCE_TYPES,
        )
        return None

    title = _safe_str(post.metadata.get("title", path.stem))
    date_raw = post.metadata.get("date", "")
    date = _safe_str(date_raw)

    tags_raw = post.metadata.get("tags", [])
    tags: list[str] = (
        tags_raw if isinstance(tags_raw, list) else [str(tags_raw)]
    )

    body = post.content.strip()

    return ConversationDoc(
        source_path=str(path.resolve()),
        conversation_id=str(uuid.uuid5(uuid.NAMESPACE_URL, str(path.resolve()))),
        file_hash=file_hash,
        title=title,
        date=date,
        source_type=source_type,
        body=body,
        tags=tags,
    )


def walk_vault(vault_path: str | Path) -> list[ConversationDoc]:
    """
    Recursively walk vault_path, parse all .md files, return valid docs.

    Invalid files are skipped and logged — they do not raise.
    """
    vault = Path(vault_path).expanduser().resolve()
    if not vault.exists():
        raise FileNotFoundError(f"Vault path does not exist: {vault}")

    docs: list[ConversationDoc] = []
    md_files = sorted(vault.rglob("*.md"))

    logger.info("Found %d .md files in %s", len(md_files), vault)

    for path in md_files:
        doc = parse_file(path)
        if doc is not None:
            docs.append(doc)

    logger.info(
        "Parsed %d valid / %d skipped from vault",
        len(docs),
        len(md_files) - len(docs),
    )
    return docs
