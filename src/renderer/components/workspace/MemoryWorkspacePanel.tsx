import { useCallback, useEffect, useRef, useState } from 'react'
import {
  searchMemory, getMemoryStatus, triggerIngest,
  sourceLabel, sourceColor, formatMemoryRank,
  MemoryChunk, MemoryQueryResult, MemoryStatus,
} from '../../services/memoryService'
import { useTraceStore } from '../../stores/traceStore'

export default function MemoryWorkspacePanel() {
  const [query, setQuery] = useState('')
  const [results, setResults] = useState<MemoryQueryResult | null>(null)
  const [status, setStatus] = useState<MemoryStatus | null>(null)
  const [searching, setSearching] = useState(false)
  const [ingesting, setIngesting] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const inputRef = useRef<HTMLInputElement>(null)
  const appendTraceEntry = useTraceStore((s) => s.appendEntry)

  const loadStatus = useCallback(async () => {
    const current = await getMemoryStatus()
    setStatus(current)
  }, [])

  useEffect(() => {
    loadStatus().catch(() => {})
    setTimeout(() => inputRef.current?.focus(), 80)
  }, [loadStatus])

  const handleSearch = async () => {
    const nextQuery = query.trim()
    if (!nextQuery) return
    setSearching(true)
    setError(null)
    const res = await searchMemory(nextQuery, { limit: 20 })
    setSearching(false)
    if (!res.success) {
      setResults(null)
      setError(res.error ?? 'Search failed')
      appendTraceEntry({
        source: 'memory',
        level: 'error',
        title: 'Memory search failed',
        detail: res.error ?? 'Search failed',
        relatedPanels: ['memory', 'transparency'],
        entityLabel: nextQuery,
      })
      return
    }
    setResults(res)
    appendTraceEntry({
      source: 'memory',
      level: 'success',
      title: `Memory search: ${nextQuery}`,
      detail: `${res.total_results} results in ${res.query_time_ms}ms.`,
      relatedPanels: ['memory', 'history'],
      entityLabel: nextQuery,
    })
  }

  const handleIngest = async (force: boolean) => {
    setIngesting(true)
    const res = await triggerIngest(force)
    setIngesting(false)
    if (!res.success) {
      setError(res.error ?? 'Ingest failed')
      appendTraceEntry({
        source: 'memory',
        level: 'error',
        title: 'Memory ingest failed',
        detail: res.error ?? 'Ingest failed',
        relatedPanels: ['memory', 'services'],
        entityLabel: 'ingest',
      })
      return
    }
    setTimeout(() => loadStatus(), 1000)
    appendTraceEntry({
      source: 'memory',
      level: 'info',
      title: force ? 'Forced memory ingest requested' : 'Memory re-index requested',
      detail: res.message ?? 'ARC-Memory ingest call completed.',
      relatedPanels: ['memory', 'services'],
      entityLabel: 'ingest',
    })
  }

  return (
    <div className="space-y-4 p-4">
      <section className="arcos-subpanel rounded-xl p-3">
        <div className="flex gap-2">
          <input
            ref={inputRef}
            type="text"
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            onKeyDown={(event) => { if (event.key === 'Enter') handleSearch() }}
            placeholder="Search prior sessions, solutions, and citations..."
            className="arcos-input flex-1 rounded-md px-3 py-2 text-sm"
          />
          <button
            onClick={handleSearch}
            disabled={searching || !query.trim()}
            className="arcos-action-primary rounded-md px-3 py-2 text-xs font-semibold uppercase tracking-wider disabled:opacity-40"
          >
            {searching ? 'Searching' : 'Search'}
          </button>
        </div>
        {results && (
          <p className="mt-2 text-[11px] text-text-muted">
            {results.total_results} results · {results.query_time_ms}ms
          </p>
        )}
      </section>

      {error && (
        <div className="rounded-xl border border-danger/40 bg-danger/10 px-3 py-3 text-xs text-danger">
          {error}
        </div>
      )}

      {!results && status && (
        <section className="arcos-subpanel rounded-xl p-3">
          <div className="flex items-center justify-between">
            <p className="arcos-kicker">Index Status</p>
            <button
              onClick={() => handleIngest(false)}
              disabled={ingesting || !status.running}
              className="arcos-action rounded px-2 py-1 text-[10px] uppercase tracking-wider disabled:opacity-40"
            >
              {ingesting ? 'Indexing' : 'Re-index'}
            </button>
          </div>
          <div className="mt-3 grid gap-3 sm:grid-cols-2">
            <MemoryStat label="Status" value={status.running ? 'Online' : 'Offline'} ok={status.running} />
            <MemoryStat label="Documents" value={String(status.indexed_docs)} />
            <MemoryStat label="Chunks" value={String(status.indexed_chunks)} />
            <MemoryStat label="DB Size" value={`${status.db_size_mb} MB`} />
          </div>
        </section>
      )}

      <div className="space-y-3">
        {searching && (
          <div className="arcos-subpanel rounded-xl px-4 py-6 text-xs text-text-muted">
            Searching memory index...
          </div>
        )}
        {results && results.chunks.length === 0 && !searching && (
          <div className="arcos-subpanel rounded-xl px-4 py-6 text-xs text-text-muted">
            No results for "{query}".
          </div>
        )}
        {results?.chunks.map((chunk, index) => {
          const citation = results.citations.find((item) => item.source_path === chunk.source_path)
          return (
            <MemoryChunkCard
              key={`${chunk.conversation_id}-${chunk.chunk_index}-${index}`}
              chunk={chunk}
              obsidianUri={citation?.obsidian_uri}
            />
          )
        })}
      </div>
    </div>
  )
}

function MemoryChunkCard({ chunk, obsidianUri }: { chunk: MemoryChunk; obsidianUri?: string }) {
  const [expanded, setExpanded] = useState(false)
  const appendTraceEntry = useTraceStore((s) => s.appendEntry)
  const color = sourceColor(chunk.source_type)
  const label = sourceLabel(chunk.source_type)
  const excerpt = chunk.text.length > 240 ? `${chunk.text.slice(0, 240)}…` : chunk.text

  return (
    <div className="rounded-xl border border-border bg-[#12161b] px-3 py-3">
      <div className="flex items-start gap-2">
        <span
          className="mt-0.5 rounded px-1.5 py-0.5 text-[10px] font-bold"
          style={{ backgroundColor: `${color}20`, color }}
        >
          {label}
        </span>
        <div className="min-w-0 flex-1">
          <p className="break-words text-sm font-medium text-text">{chunk.title}</p>
          <p className="break-words text-[11px] text-text-muted">{chunk.date} · chunk {chunk.chunk_index + 1}</p>
        </div>
        <div className="flex items-center gap-2">
          <span className="text-[11px] text-text-muted">{formatMemoryRank(chunk)}</span>
          {obsidianUri && (
            <button
              onClick={() => {
                window.electron.openExternal(obsidianUri)
                appendTraceEntry({
                  source: 'memory',
                  level: 'info',
                  title: `Opened citation for ${chunk.title}`,
                  detail: 'Citation opened in Obsidian.',
                  relatedPanels: ['memory', 'history'],
                  entityLabel: chunk.source_path,
                })
              }}
              className="arcos-action rounded px-2 py-1 text-[10px] uppercase tracking-wider"
            >
              Obsidian
            </button>
          )}
        </div>
      </div>
      <div className="mt-3 whitespace-pre-wrap break-words text-xs leading-6 text-text-muted">
        {expanded ? chunk.text : excerpt}
      </div>
      {chunk.text.length > 240 && (
        <button
          onClick={() => setExpanded((value) => !value)}
          className="mt-2 text-[11px] text-text-muted hover:text-text"
        >
          {expanded ? 'Show less' : 'Show more'}
        </button>
      )}
    </div>
  )
}

function MemoryStat({ label, value, ok }: { label: string; value: string; ok?: boolean }) {
  return (
    <div className="rounded-lg border border-border bg-[#12161b] px-3 py-2.5">
      <p className="arcos-kicker">{label}</p>
      <p className={`mt-1 break-words text-sm font-medium ${ok === undefined ? 'text-text' : ok ? 'text-success' : 'text-danger'}`}>{value}</p>
    </div>
  )
}
