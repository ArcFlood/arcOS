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
  result_rank?: number
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

export interface MemoryHygieneCandidate {
  id: string
  title: string
  filePath: string
  source: 'learnings' | 'vault'
  reason: string
  sizeBytes: number
  preview: string
  modifiedAt: string
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
    return normalizeMemoryQueryResult(raw as MemoryQueryResult)
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

function normalizeMemoryQueryResult(raw: MemoryQueryResult): MemoryQueryResult {
  const bestChunkByPath = new Map<string, MemoryChunk>()

  for (const chunk of raw.chunks) {
    if (!chunk.text.trim()) continue

    const existing = bestChunkByPath.get(chunk.source_path)
    if (!existing || chunk.score > existing.score) {
      bestChunkByPath.set(chunk.source_path, chunk)
    }
  }

  const chunks = Array.from(bestChunkByPath.values())
    .sort((a, b) => b.score - a.score)
    .map((chunk, index) => ({ ...chunk, result_rank: index + 1 }))

  const citationPaths = new Set(chunks.map((chunk) => chunk.source_path))
  const citations = raw.citations.filter((citation, index, all) => {
    if (!citationPaths.has(citation.source_path)) return false
    return all.findIndex((item) => item.source_path === citation.source_path) === index
  })

  return {
    ...raw,
    chunks,
    citations,
    total_results: chunks.length,
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

// ── Hygiene ──────────────────────────────────────────────────────

export async function scanMemoryHygiene(): Promise<{ success: boolean; candidates: MemoryHygieneCandidate[]; error?: string }> {
  try {
    return await window.electron.memoryHygieneScan()
  } catch (e) {
    return { success: false, candidates: [], error: String(e) }
  }
}

export async function deleteMemoryHygieneCandidates(filePaths: string[]): Promise<{ success: boolean; deleted: string[]; error?: string }> {
  try {
    return await window.electron.memoryHygieneDelete(filePaths)
  } catch (e) {
    return { success: false, deleted: [], error: String(e) }
  }
}

// ── Display helpers ───────────────────────────────────────────────

export function sourceLabel(sourceType: string): string {
  const map: Record<string, string> = {
    chatgpt: 'ChatGPT',
    claude: 'Claude',
    'arcos': 'ARCOS',
    obsidian: 'Obsidian',
  }
  return map[sourceType] ?? sourceType
}

export function sourceColor(sourceType: string): string {
  const map: Record<string, string> = {
    chatgpt: '#10a37f',
    claude: '#d97706',
    'arcos': '#8b5cf6',
    obsidian: '#60a5fa',
  }
  return map[sourceType] ?? '#6b7280'
}

export function formatMemoryRank(chunk: MemoryChunk): string {
  return chunk.result_rank ? `#${chunk.result_rank}` : ''
}
