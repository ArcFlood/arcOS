"""
compressor.py — Context window compression for RAG retrieval results.

When the total token count of returned chunks exceeds the budget (default 2000),
lower-ranked chunks are summarized via qwen3:14b to preserve their signal
without eating up context. The top-1 chunk is always kept verbatim.

Token estimation: len(text) // 4 (fast approximation, no tiktoken dependency).
"""

from __future__ import annotations

import logging
import os
from dataclasses import dataclass

import httpx

logger = logging.getLogger(__name__)

OLLAMA_URL = os.getenv("OLLAMA_URL", "http://localhost:11434")
COMPRESS_MODEL = os.getenv("COMPRESS_MODEL", "qwen3:14b")
TOKEN_BUDGET = 2000
CHARS_PER_TOKEN = 4

COMPRESS_PROMPT = (
    "Summarize the following conversation excerpt in 1-2 sentences. "
    "Keep the key technical details and preserve any specific names, commands, "
    "or code snippets mentioned. Be concise.\n\n"
    "Excerpt:\n{text}\n\nSummary:"
)


@dataclass
class CompressedChunk:
    """A chunk with its text possibly summarized to fit the token budget."""
    conversation_id: str
    source_path: str
    title: str
    date: str
    source_type: str
    chunk_index: int
    chunk_type: str
    speaker: str
    text: str               # May be a summary if compressed=True
    rerank_score: float
    compressed: bool        # True if text was summarized
    original_tokens: int    # Token estimate before compression


def _estimate_tokens(text: str) -> int:
    return len(text) // CHARS_PER_TOKEN


def _summarize(text: str) -> str:
    """
    Call qwen3:14b to summarize a chunk. Returns original text on failure.
    """
    try:
        with httpx.Client(timeout=20.0) as client:
            resp = client.post(
                f"{OLLAMA_URL}/api/generate",
                json={
                    "model": COMPRESS_MODEL,
                    "prompt": COMPRESS_PROMPT.format(text=text[:2000]),
                    "stream": False,
                    "options": {"temperature": 0.1, "num_predict": 80},
                },
            )
            resp.raise_for_status()
            summary = resp.json().get("response", "").strip()
            return summary if summary else text
    except Exception as e:
        logger.warning("Compression summarization failed: %s — keeping original", e)
        return text


def compress(
    chunks: list,       # list[RankedChunk] — avoid circular import
    token_budget: int = TOKEN_BUDGET,
) -> list[CompressedChunk]:
    """
    Compress a ranked chunk list to fit within token_budget.

    Strategy:
    - Walk chunks in rank order (best first).
    - Add full text while budget allows.
    - For remaining chunks: summarize via LLM, add summary if it fits.
    - Drop anything that still doesn't fit.

    Args:
        chunks: Re-ranked chunks (best first).
        token_budget: Max total tokens across all returned texts.

    Returns:
        List of CompressedChunk, best-first order, total tokens <= token_budget.
    """
    if not chunks:
        return []

    result: list[CompressedChunk] = []
    tokens_used = 0

    for i, chunk in enumerate(chunks):
        original_tokens = _estimate_tokens(chunk.text)

        # Top-1 always kept verbatim, even if it alone exceeds budget
        if i == 0:
            result.append(
                CompressedChunk(
                    conversation_id=chunk.conversation_id,
                    source_path=chunk.source_path,
                    title=chunk.title,
                    date=chunk.date,
                    source_type=chunk.source_type,
                    chunk_index=chunk.chunk_index,
                    chunk_type=chunk.chunk_type,
                    speaker=chunk.speaker,
                    text=chunk.text,
                    rerank_score=chunk.rerank_score,
                    compressed=False,
                    original_tokens=original_tokens,
                )
            )
            tokens_used += original_tokens
            continue

        remaining = token_budget - tokens_used
        if remaining <= 0:
            break

        if original_tokens <= remaining:
            # Fits as-is
            result.append(
                CompressedChunk(
                    conversation_id=chunk.conversation_id,
                    source_path=chunk.source_path,
                    title=chunk.title,
                    date=chunk.date,
                    source_type=chunk.source_type,
                    chunk_index=chunk.chunk_index,
                    chunk_type=chunk.chunk_type,
                    speaker=chunk.speaker,
                    text=chunk.text,
                    rerank_score=chunk.rerank_score,
                    compressed=False,
                    original_tokens=original_tokens,
                )
            )
            tokens_used += original_tokens
        else:
            # Summarize and check if summary fits
            summary = _summarize(chunk.text)
            summary_tokens = _estimate_tokens(summary)
            if summary_tokens <= remaining:
                result.append(
                    CompressedChunk(
                        conversation_id=chunk.conversation_id,
                        source_path=chunk.source_path,
                        title=chunk.title,
                        date=chunk.date,
                        source_type=chunk.source_type,
                        chunk_index=chunk.chunk_index,
                        chunk_type=chunk.chunk_type,
                        speaker=chunk.speaker,
                        text=summary,
                        rerank_score=chunk.rerank_score,
                        compressed=True,
                        original_tokens=original_tokens,
                    )
                )
                tokens_used += summary_tokens
            else:
                logger.debug(
                    "Dropping chunk %d ('%s') — summary still too large (%d tokens, %d remaining)",
                    i, chunk.title[:30], summary_tokens, remaining,
                )

    total_tokens = sum(c.original_tokens for c in result)
    logger.debug(
        "Compressed %d chunks → %d chunks, ~%d tokens used of %d budget",
        len(chunks), len(result), tokens_used, token_budget,
    )
    _ = total_tokens  # suppress unused warning

    return result
