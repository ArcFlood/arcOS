/**
 * memoryService.ts
 * Thin wrapper around ARC-Memory MCP server IPC calls.
 * Server runs at http://localhost:8082 (arc-memory Python FastAPI).
 */

// ── Exported types ────────────────────────────────────────────────

export interface MemoryChunk {
  conversation_id: string
  source_path: string
  title: string
  date: string
  source_type: string
  chunk_index: number
  chunk_type: 'summary' | 'section'
  speaker: 'user' | 'ai' | 'mixed'
  text: string
  score: number
}

export interface MemoryCitation {
  title: string
  date: string
  source_type: string
  source_path: string
  excerpt: string
  score: number
  obsidian_uri: string
}

export interface MemoryQueryResult {
  success: boolean
  chunks: MemoryChunk[]
  citations: MemoryCitation[]
  query_time_ms: number
  total_results: number
  error?: string
}

export interface MemoryStatus {
  running: boolean
  indexed_docs: number
  indexed_chunks: number
  db_size_mb: number
  last_indexed: string | null
  ingest_running: boolean
}

// ── Query ─────────────────────────────────────────────────────────

export interface MemorySearchOptions {
  limit?: number
  dateAfter?: string
}

export async function searchMemory(
  query: string,
  opts: MemorySearchOptions = {}
): Promise<MemoryQueryResult> {
  try {
    const raw = await window.electron.memoryQuery({
      query,
      limit: opts.limit ?? 20,
      dateAfter: opts.dateAfter,
    })
    return raw as MemoryQueryResult
  } catch (e) {
    return {
      success: false,
      chunks: [],
      citations: [],
      query_time_ms: 0,
      total_results: 0,
      error: String(e),
    }
  }
}

// ── Status ────────────────────────────────────────────────────────

export async function getMemoryStatus(): Promise<MemoryStatus> {
  try {
    const result = await window.electron.memoryStatus()
    if (!result.success) {
      return { running: false, indexed_docs: 0, indexed_chunks: 0, db_size_mb: 0, last_indexed: null, ingest_running: false }
    }
    return {
      running: true,
      indexed_docs: result.indexed_docs ?? 0,
      indexed_chunks: result.indexed_chunks ?? 0,
      db_size_mb: result.db_size_mb ?? 0,
      last_indexed: result.last_indexed ?? null,
      ingest_running: result.ingest_running ?? false,
    }
  } catch {
    return { running: false, indexed_docs: 0, indexed_chunks: 0, db_size_mb: 0, last_indexed: null, ingest_running: false }
  }
}

// ── Ingest ────────────────────────────────────────────────────────

export async function triggerIngest(force = false): Promise<{ success: boolean; message?: string; error?: string }> {
  try {
    return await window.electron.memoryIngest(force)
  } catch (e) {
    return { success: false, error: String(e) }
  }
}

// ── Display helpers ───────────────────────────────────────────────

export function sourceLabel(sourceType: string): string {
  const map: Record<string, string> = {
    chatgpt: 'ChatGPT',
    claude: 'Claude',
    'arc-hub': 'ARC-Hub',
  }
  return map[sourceType] ?? sourceType
}

export function sourceColor(sourceType: string): string {
  const map: Record<string, string> = {
    chatgpt: '#10a37f',
    claude: '#d97706',
    'arc-hub': '#8b5cf6',
  }
  return map[sourceType] ?? '#6b7280'
}
