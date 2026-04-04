import { useTraceStore } from '../../stores/traceStore'
import { useState } from 'react'
import { useWorkspaceStore } from '../../stores/workspaceStore'
import { WORKSPACE_PANELS } from '../../workspace/presets'

const LEVEL_STYLES = {
  info: 'border-slate-700/60 bg-slate-900/40 text-slate-200',
  success: 'border-emerald-700/50 bg-emerald-950/20 text-emerald-300',
  warn: 'border-amber-700/50 bg-amber-950/20 text-amber-300',
  error: 'border-red-700/50 bg-red-950/20 text-red-300',
} as const

type Verbosity = 'minimal' | 'standard' | 'detailed' | 'debug'

export default function TracePanel() {
  const entries = useTraceStore((s) => s.entries)
  const clearEntries = useTraceStore((s) => s.clearEntries)
  const showPanel = useWorkspaceStore((s) => s.showPanel)
  const [verbosity, setVerbosity] = useState<Verbosity>('standard')

  const filteredEntries = entries.filter((entry) => {
    if (verbosity === 'debug') return true
    if (verbosity === 'detailed') return entry.level !== 'info' || entry.source !== 'service'
    if (verbosity === 'standard') return entry.level !== 'info' || entry.source !== 'chat'
    return entry.level === 'success' || entry.level === 'warn' || entry.level === 'error'
  })

  const panelTitle = (panelId: string) => WORKSPACE_PANELS.find((panel) => panel.id === panelId)?.title ?? panelId

  return (
    <div className="space-y-4 p-4">
      <div className="flex items-center justify-between">
        <div>
          <p className="arcos-kicker mb-1">Observability</p>
          <p className="text-sm font-semibold text-text">Transparency Feed</p>
          <p className="text-xs text-text-muted">Live request lifecycle, service actions, and routing checkpoints.</p>
        </div>
        <div className="flex items-center gap-2">
          <select
            value={verbosity}
            onChange={(event) => setVerbosity(event.target.value as Verbosity)}
            className="arcos-input rounded-md px-2 py-1 text-xs"
          >
            <option value="minimal">Minimal</option>
            <option value="standard">Standard</option>
            <option value="detailed">Detailed</option>
            <option value="debug">Debug</option>
          </select>
          <button
            onClick={clearEntries}
            className="arcos-action rounded-md px-2.5 py-1 text-xs"
          >
            Clear
          </button>
        </div>
      </div>

      <div className="space-y-2">
        {filteredEntries.length === 0 ? (
          <div className="arcos-subpanel rounded-xl px-4 py-6 text-xs text-text-muted">
            No trace entries yet. Send a message or start/stop a service to populate the feed.
          </div>
        ) : (
          filteredEntries.map((entry) => (
            <div
              key={entry.id}
              className={`rounded-xl border px-3 py-3 ${LEVEL_STYLES[entry.level]}`}
            >
              <div className="flex items-center justify-between gap-3">
                <p className="text-sm font-medium">{entry.title}</p>
                <span className="text-[11px] opacity-70">
                  {new Date(entry.timestamp).toLocaleTimeString()}
                </span>
              </div>
              <p className="mt-1 text-[11px] uppercase tracking-wider opacity-70">{entry.source}</p>
              {entry.detail && (
                <p className="mt-2 text-xs leading-5 opacity-90">{entry.detail}</p>
              )}
              {entry.entityLabel && (
                <p className="mt-2 text-[11px] uppercase tracking-wider opacity-70">{entry.entityLabel}</p>
              )}
              <div className="mt-3 flex flex-wrap gap-2">
                {(entry.relatedPanels ?? []).map((panelId) => (
                  <button
                    key={`${entry.id}-${panelId}`}
                    onClick={() => showPanel(panelId)}
                    className="arcos-action rounded px-2 py-1 text-[10px] uppercase tracking-wider"
                  >
                    {panelTitle(panelId)}
                  </button>
                ))}
              </div>
            </div>
          ))
        )}
      </div>
    </div>
  )
}
