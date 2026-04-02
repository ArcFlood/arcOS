# arc-memory — ARC-Hub Memory System

Local RAG pipeline for semantic search over 1000+ past AI conversations.
Runs entirely on-device via Ollama. No API calls, no cost, no data leaving your machine.

## Quick Start

### Prerequisites

- Python 3.11+
- [uv](https://docs.astral.sh/uv/) installed
- Ollama running locally with nomic-embed-text pulled:
  ```bash
  ollama pull nomic-embed-text
  ```

### Setup

```bash
# 1. Copy this folder to ~/Projects/arc-memory
# 2. Install dependencies
cd ~/Projects/arc-memory
uv sync

# 3. Configure environment
cp .env.example .env
# Edit .env — set VAULT_PATH to your Obsidian AIChats folder

# 4. Run initial ingest (indexes all .md files)
uv run python -m ingestion.run_ingest

# 5. Start the MCP server
uv run python -m mcp_server.server
```

### Verify it works

```bash
curl -X POST http://localhost:8082/query \
  -H "Content-Type: application/json" \
  -d '{"query": "python async patterns", "limit": 5}'

curl http://localhost:8082/status
```

## Architecture

```
arc-memory/
├── ingestion/
│   ├── obsidian_reader.py   # Parse .md + frontmatter, SHA256 hash
│   ├── chunker.py           # Hierarchical chunking (600 tok, 100 overlap)
│   ├── embedder.py          # nomic-embed-text via Ollama, batch=50
│   ├── lancedb_writer.py    # Upsert + FTS index
│   └── run_ingest.py        # Orchestrator with tqdm + manifest
├── retrieval/
│   └── hybrid_search.py     # LanceDB vector + BM25 hybrid query
├── mcp_server/
│   └── server.py            # FastAPI on :8082 (/query, /status, /ingest)
└── prompting/               # Phase 2: compressor, HyDE
```

## Frontmatter Requirements

Files must have `source: chatgpt`, `source: claude`, or `source: arc-hub` in frontmatter:

```yaml
---
title: "My Conversation"
date: "2024-03-15"
source: claude
---
```

Files without valid `source` frontmatter are skipped (logged, not errors).

## Environment Variables

| Variable | Default | Description |
|---|---|---|
| `VAULT_PATH` | `~/ArcVault/AIChats` | Obsidian vault path |
| `LANCEDB_PATH` | `~/.noah-ai-hub/memory/lancedb` | Vector DB location |
| `OLLAMA_URL` | `http://localhost:11434` | Ollama base URL |
| `EMBEDDING_MODEL` | `nomic-embed-text` | Embedding model name |
| `MCP_PORT` | `8082` | FastAPI server port |

## Phase Roadmap

- **Phase 1 (current):** Working CLI retrieval + MCP server
- **Phase 2:** HyDE query expansion + cross-encoder reranking + file watcher
- **Phase 3:** ARC-Hub `/memory` slash command integration
- **Phase 4:** Bidirectional write-back (ARC-Hub → Obsidian → Memory)
