"""
chunker.py — Hierarchical chunking for conversation documents.

Strategy:
- Document-level: first 200 tokens as a summary chunk (chunk_type="summary")
- Section-level: 600-token windows with 100-token overlap (chunk_type="section")
- Speaker boundaries (** User:** / **Assistant:**) are respected when possible

Token estimation: characters / 4 (fast approximation, no tiktoken dependency)
"""

from __future__ import annotations

import re
from dataclasses import dataclass
from typing import Optional

from ingestion.obsidian_reader import ConversationDoc

# ── Constants ────────────────────────────────────────────────────────────────

CHARS_PER_TOKEN = 4          # rough approximation
SECTION_TOKENS = 600
OVERLAP_TOKENS = 100
SUMMARY_TOKENS = 200

SECTION_CHARS = SECTION_TOKENS * CHARS_PER_TOKEN    # 2400
OVERLAP_CHARS = OVERLAP_TOKENS * CHARS_PER_TOKEN    # 400
SUMMARY_CHARS = SUMMARY_TOKENS * CHARS_PER_TOKEN    # 800

# Speaker boundary pattern: "**User:**" or "**Assistant:**" at start of line
SPEAKER_RE = re.compile(r"^(\*\*(?:User|Assistant|Human|AI|Claude|You):\*\*)", re.MULTILINE | re.IGNORECASE)


@dataclass
class Chunk:
    """A single embeddable unit of text from a conversation."""

    conversation_id: str
    source_path: str
    title: str
    date: str
    source_type: str
    file_hash: str

    text: str                  # Content to embed
    chunk_index: int           # 0-indexed position within conversation
    total_chunks: int          # Set after all chunks are created (mutable placeholder)
    chunk_type: str            # "summary" | "section"
    speaker: str               # "user" | "ai" | "mixed"


def _estimate_tokens(text: str) -> int:
    return len(text) // CHARS_PER_TOKEN


def _detect_speaker(text: str) -> str:
    """Return dominant speaker in a text block."""
    has_user = bool(re.search(r"\*\*(?:User|Human|You):\*\*", text, re.IGNORECASE))
    has_ai = bool(re.search(r"\*\*(?:Assistant|AI|Claude):\*\*", text, re.IGNORECASE))
    if has_user and has_ai:
        return "mixed"
    if has_user:
        return "user"
    if has_ai:
        return "ai"
    return "mixed"


def _split_at_speaker_boundaries(text: str) -> list[str]:
    """
    Split text at speaker boundary markers where possible.
    Returns a list of segments (may be one segment if no boundaries found).
    """
    parts = SPEAKER_RE.split(text)
    if len(parts) <= 1:
        return [text]

    # SPEAKER_RE split interleaves: [pre, marker, content, marker, content, ...]
    # Recombine marker + following content into segments
    segments: list[str] = []
    i = 0
    if parts[0].strip():
        segments.append(parts[0])
    i = 1
    while i < len(parts) - 1:
        segment = parts[i] + parts[i + 1]
        if segment.strip():
            segments.append(segment)
        i += 2
    if i < len(parts) and parts[i].strip():
        segments.append(parts[i])
    return segments if segments else [text]


def _create_chunks_from_text(
    text: str,
    conversation_id: str,
    source_path: str,
    title: str,
    date: str,
    source_type: str,
    file_hash: str,
    start_index: int = 1,  # 0 is reserved for the summary chunk
) -> list[Chunk]:
    """
    Slide a window over text with SECTION_CHARS size and OVERLAP_CHARS overlap.
    Tries to break at speaker boundaries when a boundary falls within the window.
    """
    chunks: list[Chunk] = []

    # First attempt: split at speaker boundaries and pack into windows
    segments = _split_at_speaker_boundaries(text)

    current_block = ""
    idx = start_index

    for seg in segments:
        # If adding this segment would overflow, flush current_block first
        if current_block and len(current_block) + len(seg) > SECTION_CHARS:
            chunks.append(
                Chunk(
                    conversation_id=conversation_id,
                    source_path=source_path,
                    title=title,
                    date=date,
                    source_type=source_type,
                    file_hash=file_hash,
                    text=current_block.strip(),
                    chunk_index=idx,
                    total_chunks=0,  # filled in later
                    chunk_type="section",
                    speaker=_detect_speaker(current_block),
                )
            )
            idx += 1
            # Overlap: carry the tail of the current block forward
            current_block = current_block[-OVERLAP_CHARS:] + seg
        else:
            current_block += seg

        # If a single segment is larger than SECTION_CHARS, force-split it
        while len(current_block) > SECTION_CHARS:
            window = current_block[:SECTION_CHARS]
            chunks.append(
                Chunk(
                    conversation_id=conversation_id,
                    source_path=source_path,
                    title=title,
                    date=date,
                    source_type=source_type,
                    file_hash=file_hash,
                    text=window.strip(),
                    chunk_index=idx,
                    total_chunks=0,
                    chunk_type="section",
                    speaker=_detect_speaker(window),
                )
            )
            idx += 1
            current_block = current_block[SECTION_CHARS - OVERLAP_CHARS:]

    # Flush remainder
    if current_block.strip():
        chunks.append(
            Chunk(
                conversation_id=conversation_id,
                source_path=source_path,
                title=title,
                date=date,
                source_type=source_type,
                file_hash=file_hash,
                text=current_block.strip(),
                chunk_index=idx,
                total_chunks=0,
                chunk_type="section",
                speaker=_detect_speaker(current_block),
            )
        )

    return chunks


def chunk_document(doc: ConversationDoc) -> list[Chunk]:
    """
    Produce all chunks for a ConversationDoc.

    Returns:
        List where index 0 is the summary chunk, followed by section chunks.
        total_chunks is set on all chunks after the list is complete.
    """
    if not doc.body:
        return []

    chunks: list[Chunk] = []

    # ── Summary chunk (chunk_index = 0) ──────────────────────────────────────
    summary_text = doc.body[:SUMMARY_CHARS].strip()
    summary_chunk = Chunk(
        conversation_id=doc.conversation_id,
        source_path=doc.source_path,
        title=doc.title,
        date=doc.date,
        source_type=doc.source_type,
        file_hash=doc.file_hash,
        text=summary_text,
        chunk_index=0,
        total_chunks=0,
        chunk_type="summary",
        speaker=_detect_speaker(summary_text),
    )
    chunks.append(summary_chunk)

    # ── Section chunks ────────────────────────────────────────────────────────
    section_chunks = _create_chunks_from_text(
        text=doc.body,
        conversation_id=doc.conversation_id,
        source_path=doc.source_path,
        title=doc.title,
        date=doc.date,
        source_type=doc.source_type,
        file_hash=doc.file_hash,
        start_index=1,
    )
    chunks.extend(section_chunks)

    # ── Fill in total_chunks ──────────────────────────────────────────────────
    total = len(chunks)
    for c in chunks:
        c.total_chunks = total

    return chunks
