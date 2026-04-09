/**
 * HooksPanel.tsx — Automation module for managing hooks and viewing events.
 */

import { useEffect, useState } from 'react'
import { useHookStore } from '../../stores/hookStore'
import type { HookStage, HookEventStatus } from '../../stores/hookTypes'

// ── Styles ────────────────────────────────────────────────────────

const STAGE_COLORS: Record<HookStage, string> = {
  intake:    'bg-sky-900/40 text-sky-300 border-sky-700/40',
  context:   'bg-violet-900/40 text-violet-300 border-violet-700/40',
  routing:   'bg-indigo-900/40 text-indigo-300 border-indigo-700/40',
  fabric:    'bg-emerald-900/40 text-emerald-300 border-emerald-700/40',
  dispatch:  'bg-amber-900/40 text-amber-300 border-amber-700/40',
  tool:      'bg-orange-900/40 text-orange-300 border-orange-700/40',
  system:    'bg-red-900/40 text-red-300 border-red-700/40',
}

const STATUS_BADGE: Record<HookEventStatus, string> = {
  started:   'bg-sky-700 text-white',
  completed: 'bg-emerald-700 text-white',
  skipped:   'bg-slate-600 text-slate-200',
  failed:    'bg-red-700 text-white',
}

// ── Component ─────────────────────────────────────────────────────

export default function HooksPanel() {
  const events = useHookStore((s) => s.events)
  const registeredHooks = useHookStore((s) => s.registeredHooks)
  const stats = useHookStore((s) => s.stats)
  const clearEvents = useHookStore((s) => s.clearEvents)
  const startListening = useHookStore((s) => s.startListening)

  const [stageFilter, setStageFilter] = useState<HookStage | 'all'>('all')
  const [statusFilter, setStatusFilter] = useState<HookEventStatus | 'all'>('all')
  const [search, setSearch] = useState('')
  const [tab, setTab] = useState<'hooks' | 'log'>('hooks')

  // Start listening when panel mounts
  useEffect(() => {
    const stop = startListening()
    return stop
  }, [startListening])

  // Filtered events
  const filtered = events.filter((e) => {
    if (stageFilter !== 'all' && e.stage !== stageFilter) return false
    if (statusFilter !== 'all' && e.status !== statusFilter) return false
    if (search) {
      const q = search.toLowerCase()
      return (
        e.eventType.includes(q) ||
        e.summary.toLowerCase().includes(q) ||
        (e.details?.toLowerCase().includes(q) ?? false)
      )
    }
    return true
  })

  const stages: HookStage[] = ['intake', 'context', 'routing', 'fabric', 'dispatch', 'tool', 'system']
  const statuses: HookEventStatus[] = ['started', 'completed', 'skipped', 'failed']

  return (
    <div className="flex flex-col h-full bg-[#0f1117] text-slate-200 text-xs">

      {/* Header */}
      <div className="flex items-center gap-2 px-3 py-2 border-b border-slate-700/50 shrink-0">
        <span className="font-semibold text-sm text-slate-100">Automation</span>
        <span className="ml-1 px-1.5 py-0 rounded bg-slate-700 text-slate-300 text-[10px]">
          {stats.totalEvents} total
        </span>
        {stats.recentFailures > 0 && (
          <span className="px-1.5 py-0 rounded bg-red-700 text-white text-[10px]">
            {stats.recentFailures} recent failures
          </span>
        )}
        <div className="ml-auto flex gap-1.5">
          <button
            onClick={() => setTab('hooks')}
            className={`px-2 py-0.5 rounded text-[10px] transition-colors ${tab === 'hooks' ? 'bg-indigo-600 text-white' : 'bg-slate-800 text-slate-400 hover:text-slate-200'}`}
          >
            Hooks
          </button>
          <button
            onClick={() => setTab('log')}
            className={`px-2 py-0.5 rounded text-[10px] transition-colors ${tab === 'log' ? 'bg-indigo-600 text-white' : 'bg-slate-800 text-slate-400 hover:text-slate-200'}`}
          >
            Log
          </button>
        </div>
      </div>

      {tab === 'hooks' ? (
        <RegistryTab registeredHooks={registeredHooks} />
      ) : (
        <>
          {/* Filters */}
          <div className="flex flex-wrap items-center gap-1.5 px-3 py-2 border-b border-slate-700/40 shrink-0">
            {/* Stage filter */}
            <div className="flex gap-1">
              <button
                onClick={() => setStageFilter('all')}
                className={`px-2 py-0.5 rounded text-[10px] border transition-colors ${stageFilter === 'all' ? 'bg-slate-600 border-slate-500 text-white' : 'bg-slate-800 border-slate-600 text-slate-400 hover:text-slate-200'}`}
              >
                All
              </button>
              {stages.map((s) => (
                <button
                  key={s}
                  onClick={() => setStageFilter(s)}
                  className={`px-2 py-0.5 rounded text-[10px] border transition-colors ${stageFilter === s ? 'bg-slate-600 border-slate-500 text-white' : 'bg-slate-800 border-slate-600 text-slate-400 hover:text-slate-200'}`}
                >
                  {s}
                </button>
              ))}
            </div>
            {/* Status filter */}
            <div className="flex gap-1 ml-auto">
              {statuses.map((st) => (
                <button
                  key={st}
                  onClick={() => setStatusFilter(statusFilter === st ? 'all' : st)}
                  className={`px-2 py-0.5 rounded text-[10px] transition-colors ${statusFilter === st ? STATUS_BADGE[st] : 'bg-slate-800 text-slate-400 hover:text-slate-200'}`}
                >
                  {st}
                </button>
              ))}
            </div>
          </div>

          {/* Search + Clear */}
          <div className="flex items-center gap-2 px-3 py-1.5 border-b border-slate-700/40 shrink-0">
            <input
              type="text"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Search events…"
              className="flex-1 bg-slate-800 border border-slate-600 rounded px-2 py-0.5 text-[11px] text-slate-200 placeholder-slate-500 focus:outline-none focus:border-indigo-500"
            />
            <button
              onClick={clearEvents}
              className="text-[10px] px-2 py-0.5 rounded border border-red-800/50 bg-red-950/30 text-red-400 hover:text-red-200 transition-colors"
            >
              Clear
            </button>
          </div>

          {/* Events list */}
          <div className="flex-1 overflow-y-auto px-2 py-2 space-y-1">
            {filtered.length === 0 ? (
              <div className="flex items-center justify-center h-24 text-slate-500">
                {events.length === 0 ? 'No hook events yet. Fire a request to see events.' : 'No events match filter.'}
              </div>
            ) : (
              [...filtered].reverse().map((event) => (
                <HookEventRow key={event.id} event={event} />
              ))
            )}
          </div>
        </>
      )}
    </div>
  )
}

// ── Event Row ─────────────────────────────────────────────────────

function HookEventRow({ event }: { event: import('../../stores/hookTypes').HookEvent }) {
  const [expanded, setExpanded] = useState(false)
  const stageStyle = STAGE_COLORS[event.stage] ?? 'bg-slate-800 text-slate-300 border-slate-600'

  return (
    <div
      className={`rounded border px-2.5 py-1.5 cursor-pointer hover:brightness-110 transition-all ${stageStyle}`}
      onClick={() => setExpanded((v) => !v)}
    >
      <div className="flex items-center gap-2 flex-wrap">
        <span className="text-slate-500 shrink-0 font-mono">
          {new Date(event.timestamp).toLocaleTimeString()}
        </span>
        <span className={`px-1.5 py-0 rounded text-[9px] font-bold shrink-0 ${STATUS_BADGE[event.status] ?? 'bg-slate-600 text-white'}`}>
          {event.status}
        </span>
        <span className="font-mono text-[11px] shrink-0">{event.eventType}</span>
        <span className="text-slate-300 text-[11px] truncate flex-1">{event.summary}</span>
      </div>
      {expanded && (
        <div className="mt-1.5 space-y-1 text-[10px]">
          {event.details && (
            <div className="text-slate-400 whitespace-pre-wrap">{event.details}</div>
          )}
          {event.modelTarget && <div className="text-slate-400">Model: <span className="text-slate-200">{event.modelTarget}</span></div>}
          {event.selectedFabricPattern && <div className="text-slate-400">Fabric: <span className="text-emerald-300">{event.selectedFabricPattern}</span></div>}
          {event.skipReason && <div className="text-slate-400">Skip reason: <span className="text-slate-200">{event.skipReason}</span></div>}
          {event.toolName && <div className="text-slate-400">Tool: <span className="text-orange-300">{event.toolName}</span></div>}
          {event.filePath && <div className="text-slate-400 truncate">File: <span className="text-slate-200">{event.filePath}</span></div>}
          {event.failureClass && <div className="text-slate-400">Failure: <span className="text-red-300">{event.failureClass}</span></div>}
          {event.recoveryHint && <div className="text-slate-400">Recovery: <span className="text-yellow-300">{event.recoveryHint}</span></div>}
          <div className="text-slate-600">Request: {event.requestId}</div>
        </div>
      )}
    </div>
  )
}

// ── Registry Tab ──────────────────────────────────────────────────

function RegistryTab({ registeredHooks }: { registeredHooks: import('../../stores/hookTypes').HookRegistryEntry[] }) {
  return (
    <div className="flex-1 overflow-y-auto px-3 py-3 space-y-2">
      {registeredHooks.length === 0 ? (
        <div className="text-slate-500">No hooks registered.</div>
      ) : (
        registeredHooks.map((hook) => (
          <button
            key={hook.name}
            type="button"
            onClick={() => {
              if (hook.sourceFile) void window.electron.openPath(hook.sourceFile)
            }}
            disabled={!hook.sourceFile}
            className="w-full rounded border border-slate-700/50 bg-slate-800/40 px-3 py-2 text-left transition-colors hover:border-indigo-500/70 disabled:cursor-default disabled:hover:border-slate-700/50"
            title={hook.sourceFile ? `Open ${hook.sourceFile}` : 'No source file registered for this hook'}
          >
            <div className="flex items-center gap-2">
              <span className={`w-1.5 h-1.5 rounded-full shrink-0 ${hook.active ? 'bg-emerald-400' : 'bg-slate-500'}`} />
              <span className="font-mono text-[11px] text-slate-100">{hook.name}</span>
              <span className={`ml-auto text-[9px] px-1.5 rounded ${hook.active ? 'bg-emerald-900/50 text-emerald-400' : 'bg-slate-700 text-slate-400'}`}>
                {hook.active ? 'active' : 'inactive'}
              </span>
            </div>
            <div className="mt-1 text-[10px] text-slate-400">{hook.description}</div>
            {hook.sourceFile && (
              <div className="mt-1 truncate text-[9px] text-indigo-300">Source: {hook.sourceFile}</div>
            )}
            <div className="mt-1 flex flex-wrap gap-1">
              {hook.subscribedEvents.map((ev) => (
                <span key={ev} className="px-1.5 py-0 rounded bg-slate-700 text-[9px] text-slate-300 font-mono">
                  {ev}
                </span>
              ))}
            </div>
          </button>
        ))
      )}
    </div>
  )
}
