import { useTraceStore } from '../../stores/traceStore'
import { useState } from 'react'
import { useWorkspaceStore } from '../../stores/workspaceStore'
import { WORKSPACE_PANELS } from '../../workspace/presets'

type Verbosity = 'minimal' | 'standard' | 'detailed' | 'debug'

export default function ExecutionTracePanel() {
  const entries = useTraceStore((s) => s.entries)
  const showPanel = useWorkspaceStore((s) => s.showPanel)
  const [verbosity, setVerbosity] = useState<Verbosity>('standard')

  const filteredEntries = entries.filter((entry) => {
    if (verbosity === 'debug') return true
    if (verbosity === 'detailed') return entry.source !== 'service' || entry.level !== 'info'
    if (verbosity === 'standard') return entry.level !== 'info' || entry.source !== 'chat'
    return entry.level === 'success' || entry.level === 'warn' || entry.level === 'error'
  })

  const panelTitle = (panelId: string) => WORKSPACE_PANELS.find((panel) => panel.id === panelId)?.title ?? panelId

  return (
    <div className="space-y-4 p-4">
      <div className="flex items-center justify-between gap-3">
        <div>
          <p className="arcos-kicker mb-1">Timeline</p>
          <p className="text-sm font-semibold text-text">Execution Trace</p>
          <p className="text-xs text-text-muted">Ordered checkpoints for requests, routing, and service actions.</p>
        </div>
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
      </div>

      <div className="space-y-3">
        {filteredEntries.length === 0 ? (
          <div className="arcos-subpanel rounded-xl px-4 py-6 text-xs text-text-muted">
            No execution checkpoints recorded yet.
          </div>
        ) : (
          filteredEntries.map((entry, index) => (
            <div key={entry.id} className="flex gap-3">
              <div className="flex w-10 flex-col items-center">
                <div className="mt-1 h-2.5 w-2.5 rounded-full bg-[#97aaba]" />
                {index < filteredEntries.length - 1 && <div className="mt-1 flex-1 w-px bg-border" />}
              </div>
              <div className="flex-1 rounded-xl border border-border bg-[#12161b] px-3 py-3">
                <div className="flex items-center justify-between gap-3">
                  <p className="text-sm font-medium text-text">{entry.title}</p>
                  <span className="text-[11px] text-text-muted">
                    {new Date(entry.timestamp).toLocaleTimeString()}
                  </span>
                </div>
                <p className="mt-1 text-[11px] uppercase tracking-wider text-text-muted">{entry.source}</p>
                {entry.detail && (
                  <p className="mt-2 text-xs leading-5 text-text-muted">{entry.detail}</p>
                )}
                {entry.stage && (
                  <p className="mt-2 text-[11px] uppercase tracking-wider text-text-muted">stage: {entry.stage}</p>
                )}
                {entry.executionState && (
                  <p className="mt-2 text-[11px] uppercase tracking-wider text-text-muted">state: {entry.executionState}</p>
                )}
                {entry.failureType && (
                  <p className="mt-2 text-[11px] uppercase tracking-wider text-text-muted">failure: {entry.failureType}</p>
                )}
                {entry.entityLabel && (
                  <p className="mt-2 text-[11px] uppercase tracking-wider text-text-muted">{entry.entityLabel}</p>
                )}
                {entry.recoveryAction && (
                  <p className="mt-2 text-xs leading-5 text-text-muted">next: {entry.recoveryAction}</p>
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
            </div>
          ))
        )}
      </div>
    </div>
  )
}
