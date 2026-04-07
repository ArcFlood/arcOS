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

const VERBOSITY_OPTIONS: Array<{ value: Verbosity; label: string }> = [
  { value: 'minimal', label: 'Minimal — successes, warnings, and errors' },
  { value: 'standard', label: 'Standard — useful checkpoints, less chat noise' },
  { value: 'detailed', label: 'Detailed — more service and orchestration activity' },
  { value: 'debug', label: 'Debug — every in-memory trace entry' },
]

export default function TracePanel() {
  const entries = useTraceStore((s) => s.entries)
  const clearEntries = useTraceStore((s) => s.clearEntries)
  const executionSummary = useTraceStore((s) => s.executionSummary)
  const showPanel = useWorkspaceStore((s) => s.showPanel)
  const [verbosity, setVerbosity] = useState<Verbosity>('standard')
  const summary = executionSummary()

  const filteredEntries = entries.filter((entry) => {
    if (verbosity === 'debug') return true
    if (verbosity === 'detailed') return entry.level !== 'info' || entry.source !== 'service'
    if (verbosity === 'standard') return entry.level !== 'info' || entry.source !== 'chat'
    return entry.level === 'success' || entry.level === 'warn' || entry.level === 'error'
  })

  const panelTitle = (panelId: string) => WORKSPACE_PANELS.find((panel) => panel.id === panelId)?.title ?? panelId
  const formatChainPath = (value: string) => value.replace(/-/g, ' ')
  const latestOpenClaw = entries.find((entry) => entry.stage === 'OpenClaw' && entry.level === 'success')
  const latestFabric = entries.find((entry) => entry.stage === 'Fabric' && (entry.level === 'success' || entry.level === 'error'))
  const latestComposer = entries.find((entry) => entry.stage === 'Response Composer')

  return (
    <div className="space-y-4 p-4">
      <div className="space-y-3">
        <div>
          <p className="arcos-kicker mb-1">Observability</p>
          <p className="text-sm font-semibold text-text">Transparency Feed</p>
          <p className="text-xs text-text-muted">
            Live request lifecycle, service actions, and routing checkpoints. Current Phase is the stage ARCOS believes the active request is in. Lifecycle is the current state, such as idle, routing, tool running, model dispatch, completed, or degraded.
          </p>
        </div>
        <div className="space-y-2">
          <select
            value={verbosity}
            onChange={(event) => setVerbosity(event.target.value as Verbosity)}
            className="arcos-input w-full rounded-md px-2 py-1 text-xs"
            title="Choose how much of the Transparency feed to show."
          >
            {VERBOSITY_OPTIONS.map((option) => (
              <option key={option.value} value={option.value}>{option.label}</option>
            ))}
          </select>
          <button
            onClick={clearEntries}
            title="Clears the in-memory Transparency feed. It does not erase persisted History, routing logs, or saved learnings."
            className="arcos-action w-full rounded-md px-2.5 py-1 text-xs"
          >
            Reset
          </button>
        </div>
      </div>

      <div className="space-y-2">
        <div className="rounded-xl border border-border bg-[#12161b] px-3 py-3">
          <p className="arcos-kicker mb-2">Execution Summary</p>
          <div className="grid gap-3 sm:grid-cols-2">
            <SummaryStat label="Current Phase" value={summary.currentPhase} />
            <SummaryStat label="Lifecycle" value={summary.lifecycleState} />
            <SummaryStat label="Last Good Checkpoint" value={summary.lastSuccessfulCheckpoint} />
            <SummaryStat label="Mode" value={summary.degradedMode ? 'Degraded' : 'Normal'} />
            <SummaryStat label="Chain Path" value={formatChainPath(summary.chainPath)} />
          </div>
          {(summary.activeBlocker || summary.recommendedRecoveryAction) && (
            <div className="mt-3 rounded-lg border border-amber-700/40 bg-amber-950/10 px-3 py-2">
              {summary.activeBlocker && <p className="text-xs font-medium text-amber-300">{summary.activeBlocker}</p>}
              {summary.recommendedRecoveryAction && (
                <p className="mt-1 text-[11px] leading-5 text-text-muted">{summary.recommendedRecoveryAction}</p>
              )}
            </div>
          )}
        </div>

        <div className="rounded-xl border border-border bg-[#12161b] px-3 py-3">
          <p className="arcos-kicker mb-2">Latest Chain Outputs</p>
          <div className="grid gap-3 lg:grid-cols-3">
            <ChainOutputCard
              label="OpenClaw"
              title={latestOpenClaw?.title ?? 'No successful OpenClaw analysis yet'}
              detail={latestOpenClaw?.detail}
            />
            <ChainOutputCard
              label="Fabric"
              title={latestFabric?.title ?? 'No Fabric execution recorded yet'}
              detail={latestFabric?.detail}
            />
            <ChainOutputCard
              label="Response Composer"
              title={latestComposer?.title ?? 'No Response Composer checkpoint yet'}
              detail={latestComposer?.detail}
            />
          </div>
        </div>

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
                <p className="min-w-0 break-words text-sm font-medium">{entry.title}</p>
                <span className="text-[11px] opacity-70">
                  {new Date(entry.timestamp).toLocaleTimeString()}
                </span>
              </div>
              <p className="mt-1 text-[11px] uppercase tracking-wider opacity-70">{entry.source}</p>
              {entry.detail && (
                <p className="mt-2 whitespace-pre-wrap break-words text-xs leading-5 opacity-90">{entry.detail}</p>
              )}
              {entry.stage && (
                <p className="mt-2 text-[11px] uppercase tracking-wider opacity-70">stage: {entry.stage}</p>
              )}
              {entry.executionState && (
                <p className="mt-2 text-[11px] uppercase tracking-wider opacity-70">state: {entry.executionState}</p>
              )}
              {entry.failureType && (
                <p className="mt-2 text-[11px] uppercase tracking-wider opacity-70">failure: {entry.failureType}</p>
              )}
              {entry.chainPath && (
                <p className="mt-2 text-[11px] uppercase tracking-wider opacity-70">path: {formatChainPath(entry.chainPath)}</p>
              )}
              {entry.entityLabel && (
                <p className="mt-2 text-[11px] uppercase tracking-wider opacity-70">{entry.entityLabel}</p>
              )}
              {entry.recoveryAction && (
                <p className="mt-2 text-xs leading-5 opacity-90">next: {entry.recoveryAction}</p>
              )}
              <div className="mt-3 flex flex-wrap gap-2">
                {(entry.relatedPanels ?? []).filter((panelId) => panelId !== 'transparency').map((panelId) => (
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

function SummaryStat({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-lg border border-border bg-[#0f1318] px-3 py-2">
      <p className="text-[10px] uppercase tracking-wider text-text-muted">{label}</p>
      <p className="mt-1 break-words text-xs font-medium text-text">{value}</p>
    </div>
  )
}

function ChainOutputCard({ label, title, detail }: { label: string; title: string; detail?: string }) {
  return (
    <div className="rounded-lg border border-border bg-[#0f1318] px-3 py-2">
      <p className="text-[10px] uppercase tracking-wider text-text-muted">{label}</p>
      <p className="mt-1 break-words text-xs font-medium text-text">{title}</p>
      <p className="mt-2 whitespace-pre-wrap break-words text-xs leading-5 text-text-muted">
        {detail ?? 'No detail recorded.'}
      </p>
    </div>
  )
}
