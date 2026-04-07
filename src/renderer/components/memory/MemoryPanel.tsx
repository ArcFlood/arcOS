import { useState, useEffect, useCallback, useRef } from 'react'
import {
  searchMemory, getMemoryStatus, triggerIngest,
  sourceLabel, sourceColor, formatMemoryRank,
  MemoryStatus, MemoryChunk, MemoryQueryResult,
} from '../../services/memoryService'

interface Props {
  open: boolean
  onClose: () => void
}

export default function MemoryPanel({ open, onClose }: Props) {
  const [query, setQuery] = useState('')
  const [results, setResults] = useState<MemoryQueryResult | null>(null)
  const [status, setStatus] = useState<MemoryStatus | null>(null)
  const [searching, setSearching] = useState(false)
  const [ingesting, setIngesting] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const inputRef = useRef<HTMLInputElement>(null)

  const loadStatus = useCallback(async () => {
    const s = await getMemoryStatus()
    setStatus(s)
  }, [])

  useEffect(() => {
    if (open) {
      loadStatus()
      setTimeout(() => inputRef.current?.focus(), 80)
    }
  }, [open, loadStatus])

  const handleSearch = async () => {
    const q = query.trim()
    if (!q) return
    setSearching(true)
    setError(null)
    setResults(null)
    const res = await searchMemory(q, { limit: 20 })
    setSearching(false)
    if (!res.success) {
      setError(res.error ?? 'Search failed')
    } else {
      setResults(res)
    }
  }

  const handleIngest = async (force: boolean) => {
    setIngesting(true)
    const res = await triggerIngest(force)
    setIngesting(false)
    if (!res.success) {
      setError(res.error ?? 'Ingest failed')
    } else {
      // Poll status after a moment so the UI reflects "ingest running"
      setTimeout(loadStatus, 1000)
    }
  }

  const handleKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Enter') handleSearch()
    if (e.key === 'Escape') onClose()
  }

  if (!open) return null

  return (
    <div className="fixed inset-0 z-50 flex" onClick={(e) => { if (e.target === e.currentTarget) onClose() }}>
      {/* Backdrop */}
      <div className="absolute inset-0 bg-black/60" onClick={onClose} />

      {/* Panel — right-side drawer */}
      <div
        className="relative ml-auto h-full w-[480px] bg-base-200 flex flex-col shadow-2xl border-l border-base-300"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="flex items-center justify-between px-4 py-3 border-b border-base-300 bg-base-300/50">
          <div className="flex items-center gap-2">
            <span className="text-lg">🧠</span>
            <span className="font-semibold text-base-content">ARC-Memory</span>
            {status && (
              <div className="flex items-center gap-1 ml-2">
                <span
                  className={`w-2 h-2 rounded-full ${status.running ? 'bg-success' : 'bg-error'}`}
                />
                <span className="text-xs text-base-content/50">
                  {status.running ? `${status.indexed_docs} docs` : 'offline'}
                </span>
              </div>
            )}
          </div>
          <button className="btn btn-ghost btn-xs" onClick={onClose}>✕</button>
        </div>

        {/* Search bar */}
        <div className="px-4 pt-3 pb-2 border-b border-base-300/50">
          <div className="flex gap-2">
            <input
              ref={inputRef}
              type="text"
              className="input input-bordered input-sm flex-1 bg-white text-sm text-slate-950 placeholder:text-slate-500"
              placeholder="Search past conversations..."
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              onKeyDown={handleKeyDown}
            />
            <button
              className="btn btn-primary btn-sm"
              onClick={handleSearch}
              disabled={searching || !query.trim()}
            >
              {searching ? <span className="loading loading-spinner loading-xs" /> : 'Search'}
            </button>
          </div>
          {results && !searching && (
            <p className="text-xs text-base-content/40 mt-1 pl-1">
              {results.total_results} results · {results.query_time_ms}ms
            </p>
          )}
        </div>

        {/* Content area */}
        <div className="flex-1 overflow-y-auto px-4 py-3 space-y-3">
          {error && (
            <div className="alert alert-error text-sm py-2 px-3">
              <span>{error}</span>
            </div>
          )}

          {searching && (
            <div className="flex items-center justify-center py-12">
              <span className="loading loading-dots loading-md text-primary" />
            </div>
          )}

          {results && results.chunks.length === 0 && !searching && (
            <div className="text-center py-10 text-base-content/40 text-sm">
              No results for "{query}"
            </div>
          )}

          {results && results.chunks.map((chunk: MemoryChunk, i: number) => {
            // Find matching citation for this chunk's source file (provides obsidian_uri)
            const citation = results.citations.find((c) => c.source_path === chunk.source_path)
            return (
              <ChunkCard
                key={`${chunk.conversation_id}-${chunk.chunk_index}-${i}`}
                chunk={chunk}
                obsidianUri={citation?.obsidian_uri}
              />
            )
          })}

          {/* Status section when no results yet */}
          {!results && !searching && status && (
            <StatusCard status={status} onIngest={handleIngest} ingesting={ingesting} />
          )}
        </div>

        {/* Footer */}
        <div className="px-4 py-2 border-t border-base-300/50 flex items-center justify-between">
          <span className="text-xs text-base-content/30">
            {status?.last_indexed
              ? `Last indexed: ${new Date(status.last_indexed).toLocaleDateString()}`
              : 'Not yet indexed'}
          </span>
          <div className="flex gap-2">
            {results && (
              <button className="btn btn-ghost btn-xs" onClick={() => setResults(null)}>Clear</button>
            )}
            <button
              className="btn btn-ghost btn-xs"
              onClick={() => handleIngest(false)}
              disabled={ingesting || !status?.running}
              title="Re-index changed files"
            >
              {ingesting ? <span className="loading loading-spinner loading-xs" /> : 'Re-index'}
            </button>
          </div>
        </div>
      </div>
    </div>
  )
}

// ── Sub-components ────────────────────────────────────────────────

function ChunkCard({ chunk, obsidianUri }: { chunk: MemoryChunk; obsidianUri?: string }) {
  const [expanded, setExpanded] = useState(false)
  const color = sourceColor(chunk.source_type)
  const label = sourceLabel(chunk.source_type)
  const excerpt = chunk.text.length > 200 ? chunk.text.slice(0, 200) + '…' : chunk.text

  const handleOpenObsidian = (e: React.MouseEvent) => {
    e.stopPropagation()
    if (obsidianUri) window.electron.openExternal(obsidianUri)
  }

  return (
    <div className="bg-base-100 rounded-lg border border-base-300/60 overflow-hidden hover:border-primary/40 transition-colors">
      {/* Card header */}
      <div className="flex items-start gap-2 px-3 pt-3 pb-1">
        <span
          className="text-[10px] font-bold px-1.5 py-0.5 rounded mt-0.5 shrink-0"
          style={{ backgroundColor: color + '20', color }}
        >
          {label}
        </span>
        <div className="flex-1 min-w-0">
          <p className="text-sm font-medium text-base-content truncate">{chunk.title}</p>
          <p className="text-xs text-base-content/40">{chunk.date} · chunk {chunk.chunk_index + 1}</p>
        </div>
        <div className="flex items-center gap-1.5 shrink-0">
          <span className="text-xs text-base-content/30">{formatMemoryRank(chunk)}</span>
          {obsidianUri && (
            <button
              onClick={handleOpenObsidian}
              className="text-[10px] px-1.5 py-0.5 rounded border border-purple-500/30 text-purple-400 hover:bg-purple-500/10 transition-colors"
              title="Open in Obsidian"
            >
              Obsidian
            </button>
          )}
        </div>
      </div>

      {/* Text preview */}
      <div
        className="px-3 pb-3 cursor-pointer"
        onClick={() => setExpanded((v) => !v)}
      >
        <p className="text-sm text-base-content/70 leading-relaxed whitespace-pre-wrap break-words">
          {expanded ? chunk.text : excerpt}
        </p>
        {chunk.text.length > 200 && (
          <button className="text-xs text-primary mt-1 hover:underline">
            {expanded ? 'Show less' : 'Show more'}
          </button>
        )}
      </div>
    </div>
  )
}

function StatusCard({
  status,
  onIngest,
  ingesting,
}: {
  status: MemoryStatus
  onIngest: (force: boolean) => void
  ingesting: boolean
}) {
  return (
    <div className="bg-base-100 rounded-lg border border-base-300/60 p-4 space-y-3">
      <h3 className="text-sm font-semibold text-base-content/70">Memory Index</h3>
      <div className="grid grid-cols-2 gap-2 text-sm">
        <StatRow label="Status" value={status.running ? 'Online' : 'Offline'} ok={status.running} />
        <StatRow label="Documents" value={String(status.indexed_docs)} />
        <StatRow label="Chunks" value={String(status.indexed_chunks)} />
        <StatRow label="DB Size" value={`${status.db_size_mb} MB`} />
      </div>

      {!status.running && (
        <div className="alert alert-warning text-xs py-1.5 px-2">
          <span>ARC-Memory server is offline. Start it from Services.</span>
        </div>
      )}

      {status.ingest_running && (
        <div className="flex items-center gap-2 text-xs text-primary">
          <span className="loading loading-spinner loading-xs" />
          <span>Indexing in progress...</span>
        </div>
      )}

      {status.running && status.indexed_docs === 0 && !status.ingest_running && (
        <div className="space-y-2">
          <p className="text-xs text-base-content/50">No documents indexed yet.</p>
          <button
            className="btn btn-primary btn-sm w-full"
            onClick={() => onIngest(false)}
            disabled={ingesting}
          >
            {ingesting ? <span className="loading loading-spinner loading-xs" /> : 'Run Initial Index'}
          </button>
        </div>
      )}
    </div>
  )
}

function StatRow({ label, value, ok }: { label: string; value: string; ok?: boolean }) {
  return (
    <div className="flex justify-between">
      <span className="text-base-content/50">{label}</span>
      <span className={ok !== undefined ? (ok ? 'text-success' : 'text-error') : 'text-base-content'}>
        {value}
      </span>
    </div>
  )
}
