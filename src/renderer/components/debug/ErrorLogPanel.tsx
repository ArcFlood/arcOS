/**
 * ErrorLogPanel.tsx — In-app error/debug log viewer.
 *
 * Shows structured log entries from both main and renderer processes.
 * Accessible via Help menu → "Error Log" or keyboard shortcut Cmd+Shift+L.
 */

import { useEffect, useState, useCallback, useRef } from 'react'

type LogCategory =
  | 'prompt_delivery' | 'trust_gate' | 'compile' | 'plugin_startup'
  | 'mcp_startup' | 'mcp_handshake' | 'tool_runtime' | 'infra'

interface LogEntry {
  id: string
  level: 'info' | 'warn' | 'error'
  source: 'main' | 'renderer'
  message: string
  detail?: string
  timestamp: number
  category?: LogCategory
}

const CATEGORY_LABELS: Record<LogCategory, string> = {
  prompt_delivery: 'Prompt',
  trust_gate:      'Trust',
  compile:         'Compile',
  plugin_startup:  'Plugin',
  mcp_startup:     'MCP Boot',
  mcp_handshake:   'MCP Hand.',
  tool_runtime:    'Tool',
  infra:           'Infra',
}

const CATEGORY_RECOVERY: Record<LogCategory, string> = {
  prompt_delivery: 'Check the active model tier and API key. Try resending or switching to a local model.',
  trust_gate:      'Review budget limits in Settings or confirm the API key has adequate permissions.',
  compile:         'A schema or build error. Check recent plugin/manifest changes or restart ARCOS.',
  plugin_startup:  'Check the plugin JSON for invalid fields. Reinstall from the Tools panel.',
  mcp_startup:     'The MCP server process failed to start. Check its config and logs, then retry from Services.',
  mcp_handshake:   'The MCP server started but tool negotiation failed. Verify server version compatibility.',
  tool_runtime:    'A tool execution failed mid-call. Check argument types and service availability.',
  infra:           'Disk, network, or OS error. Check free space, file permissions, or restart the process.',
}

interface Props {
  open: boolean
  onClose: () => void
  onOpenBugReport?: () => void
}

const LEVEL_STYLES: Record<LogEntry['level'], string> = {
  error: 'text-red-400 bg-red-950/30 border-red-800/40',
  warn:  'text-yellow-400 bg-yellow-950/30 border-yellow-800/40',
  info:  'text-slate-300 bg-slate-900/40 border-slate-700/30',
}

const LEVEL_BADGE: Record<LogEntry['level'], string> = {
  error: 'bg-red-600 text-white',
  warn:  'bg-yellow-600 text-black',
  info:  'bg-slate-600 text-white',
}

const SOURCE_BADGE: Record<LogEntry['source'], string> = {
  main:     'bg-violet-700 text-white',
  renderer: 'bg-sky-700 text-white',
}

export default function ErrorLogPanel({ open, onClose, onOpenBugReport }: Props) {
  const [entries, setEntries] = useState<LogEntry[]>([])
  const [filter, setFilter] = useState<'all' | 'error' | 'warn' | 'info'>('all')
  const [categoryFilter, setCategoryFilter] = useState<LogCategory | 'all'>('all')
  const [search, setSearch] = useState('')
  const [autoRefresh, setAutoRefresh] = useState(true)
  const [copying, setCopying] = useState(false)
  const bottomRef = useRef<HTMLDivElement>(null)
  const intervalRef = useRef<ReturnType<typeof setInterval> | null>(null)

  const fetchEntries = useCallback(async () => {
    try {
      const result = await window.electron.logGetEntries()
      if (result.success) setEntries(result.entries as LogEntry[])
    } catch {
      // Keep the existing entries if refresh fails.
    }
  }, [])

  // Initial fetch + auto-refresh every 2s when panel is open
  useEffect(() => {
    if (!open) return
    fetchEntries()
    if (autoRefresh) {
      intervalRef.current = setInterval(fetchEntries, 2000)
    }
    return () => {
      if (intervalRef.current) clearInterval(intervalRef.current)
    }
  }, [open, autoRefresh, fetchEntries])

  // Scroll to bottom on new entries
  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' })
  }, [entries.length])

  const handleClear = async () => {
    await window.electron.logClear()
    setEntries([])
  }

  const handleOpenFile = () => {
    window.electron.logOpenFile()
  }

  const handleCopyAll = async () => {
    const text = filtered
      .map((e) => {
        const ts = new Date(e.timestamp).toISOString()
        const detail = e.detail ? `\n  ${e.detail}` : ''
        return `[${ts}] [${e.level.toUpperCase()}] [${e.source}] ${e.message}${detail}`
      })
      .join('\n')
    await navigator.clipboard.writeText(text)
    setCopying(true)
    setTimeout(() => setCopying(false), 1500)
  }

  const filtered = entries.filter((e) => {
    if (filter !== 'all' && e.level !== filter) return false
    if (categoryFilter !== 'all' && e.category !== categoryFilter) return false
    if (search) {
      const q = search.toLowerCase()
      return (
        e.message.toLowerCase().includes(q) ||
        (e.detail?.toLowerCase().includes(q) ?? false) ||
        (e.category?.toLowerCase().includes(q) ?? false)
      )
    }
    return true
  })

  // Recovery hints: unique categories present in the current filtered error/warn entries
  const activeErrorCategories = Array.from(
    new Set(filtered.filter((e) => e.level !== 'info' && e.category).map((e) => e.category!))
  )

  const counts = {
    error: entries.filter((e) => e.level === 'error').length,
    warn:  entries.filter((e) => e.level === 'warn').length,
    info:  entries.filter((e) => e.level === 'info').length,
  }

  if (!open) return null

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm">
      <div className="relative flex flex-col bg-[#111318] border border-slate-700/60 rounded-xl shadow-2xl w-[760px] max-w-[95vw] h-[600px] max-h-[90vh]">

        {/* Header */}
        <div className="flex items-center gap-3 px-4 py-3 border-b border-slate-700/50 shrink-0">
          <span className="text-base font-semibold text-slate-100">Error Log</span>
          <div className="flex gap-1.5 ml-1">
            {counts.error > 0 && (
              <span className="px-1.5 py-0.5 rounded text-xs font-bold bg-red-600 text-white">{counts.error} ERR</span>
            )}
            {counts.warn > 0 && (
              <span className="px-1.5 py-0.5 rounded text-xs font-bold bg-yellow-600 text-black">{counts.warn} WARN</span>
            )}
            <span className="px-1.5 py-0.5 rounded text-xs font-medium bg-slate-700 text-slate-300">{counts.info} INFO</span>
          </div>
          <div className="ml-auto flex items-center gap-2">
            <button
              onClick={() => setAutoRefresh((v) => !v)}
              className={`text-xs px-2 py-1 rounded border transition-colors ${
                autoRefresh
                  ? 'bg-emerald-900/40 border-emerald-700 text-emerald-400'
                  : 'bg-slate-800 border-slate-600 text-slate-400 hover:text-slate-200'
              }`}
              title="Toggle auto-refresh every 2s"
            >
              {autoRefresh ? '● Live' : '○ Paused'}
            </button>
            <button
              onClick={handleCopyAll}
              className="text-xs px-2 py-1 rounded border border-slate-600 bg-slate-800 text-slate-300 hover:text-white transition-colors"
            >
              {copying ? 'Copied!' : 'Copy all'}
            </button>
            <button
              onClick={handleOpenFile}
              className="text-xs px-2 py-1 rounded border border-slate-600 bg-slate-800 text-slate-300 hover:text-white transition-colors"
              title="Open log file in default text editor"
            >
              Open file
            </button>
            {onOpenBugReport && (
              <button
                onClick={onOpenBugReport}
                className="text-xs px-2 py-1 rounded border border-orange-800/50 bg-orange-950/30 text-orange-400 hover:text-orange-200 transition-colors"
                title="Report a bug to the team"
              >
                Report Bug
              </button>
            )}
            <button
              onClick={handleClear}
              className="text-xs px-2 py-1 rounded border border-red-800/50 bg-red-950/30 text-red-400 hover:text-red-200 transition-colors"
            >
              Clear
            </button>
            <button
              onClick={onClose}
              className="ml-1 text-slate-400 hover:text-slate-100 text-lg leading-none transition-colors"
              aria-label="Close"
            >
              ×
            </button>
          </div>
        </div>

        {/* Filter bar — level */}
        <div className="flex items-center gap-2 px-4 py-2 border-b border-slate-700/40 shrink-0">
          {(['all', 'error', 'warn', 'info'] as const).map((lvl) => (
            <button
              key={lvl}
              onClick={() => setFilter(lvl)}
              className={`text-xs px-2.5 py-1 rounded-full border transition-colors ${
                filter === lvl
                  ? 'bg-indigo-600 border-indigo-500 text-white'
                  : 'bg-slate-800 border-slate-600 text-slate-400 hover:text-slate-200'
              }`}
            >
              {lvl === 'all' ? `All (${entries.length})` : lvl.toUpperCase()}
            </button>
          ))}
          <input
            type="text"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search messages…"
            className="ml-auto w-48 text-xs bg-slate-800 border border-slate-600 rounded px-2 py-1 text-slate-200 placeholder-slate-500 focus:outline-none focus:border-indigo-500"
          />
        </div>

        {/* Filter bar — category */}
        <div className="flex items-center gap-1.5 px-4 py-1.5 border-b border-slate-700/30 shrink-0 flex-wrap">
          <span className="text-[10px] text-slate-500 mr-1 shrink-0">Category:</span>
          {(['all', 'prompt_delivery', 'trust_gate', 'compile', 'plugin_startup', 'mcp_startup', 'mcp_handshake', 'tool_runtime', 'infra'] as const).map((cat) => (
            <button
              key={cat}
              onClick={() => setCategoryFilter(cat)}
              className={`text-[10px] px-2 py-0.5 rounded border transition-colors ${
                categoryFilter === cat
                  ? 'bg-violet-700 border-violet-500 text-white'
                  : 'bg-slate-800 border-slate-700 text-slate-500 hover:text-slate-300'
              }`}
            >
              {cat === 'all' ? 'All' : CATEGORY_LABELS[cat]}
            </button>
          ))}
        </div>

        {/* Recovery hints */}
        {activeErrorCategories.length > 0 && (
          <div className="px-4 py-2 border-b border-slate-700/30 shrink-0 space-y-1">
            {activeErrorCategories.map((cat) => (
              <div key={cat} className="flex items-start gap-2 text-[11px]">
                <span className="shrink-0 px-1.5 py-0 rounded bg-amber-900/40 border border-amber-700/40 text-amber-400 font-medium">
                  {CATEGORY_LABELS[cat]}
                </span>
                <span className="text-slate-400">{CATEGORY_RECOVERY[cat]}</span>
              </div>
            ))}
          </div>
        )}

        {/* Log entries */}
        <div className="flex-1 overflow-y-auto font-mono text-xs px-2 py-2 space-y-1">
          {filtered.length === 0 ? (
            <div className="flex items-center justify-center h-full text-slate-500">
              {entries.length === 0 ? 'No log entries yet.' : 'No entries match the current filter.'}
            </div>
          ) : (
            filtered.map((entry) => (
              <div
                key={entry.id}
                className={`flex flex-col gap-0.5 rounded px-2.5 py-1.5 border ${LEVEL_STYLES[entry.level]}`}
              >
                <div className="flex items-center gap-2 flex-wrap">
                  <span className="text-slate-500 shrink-0">
                    {new Date(entry.timestamp).toLocaleTimeString()}
                  </span>
                  <span className={`px-1.5 py-0 rounded text-[10px] font-bold shrink-0 ${LEVEL_BADGE[entry.level]}`}>
                    {entry.level.toUpperCase()}
                  </span>
                  <span className={`px-1.5 py-0 rounded text-[10px] font-medium shrink-0 ${SOURCE_BADGE[entry.source]}`}>
                    {entry.source}
                  </span>
                  {entry.category && (
                    <span className="px-1.5 py-0 rounded text-[10px] font-medium shrink-0 bg-slate-700/60 text-slate-400 border border-slate-600/40">
                      {CATEGORY_LABELS[entry.category]}
                    </span>
                  )}
                  <span className="text-slate-200 break-all">{entry.message}</span>
                </div>
                {entry.detail && (
                  <div className="ml-[72px] text-slate-400 break-all whitespace-pre-wrap">
                    {entry.detail}
                  </div>
                )}
              </div>
            ))
          )}
          <div ref={bottomRef} />
        </div>

        {/* Footer */}
        <div className="px-4 py-2 border-t border-slate-700/40 shrink-0 flex items-center justify-between">
          <span className="text-xs text-slate-500">
            Showing {filtered.length} of {entries.length} entries
          </span>
          <span className="text-xs text-slate-600">
            Log file: ~/.noah-ai-hub/logs/arcos.log
          </span>
        </div>
      </div>
    </div>
  )
}
