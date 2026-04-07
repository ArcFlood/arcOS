import { useEffect, useState } from 'react'
import { useConversationStore } from '../../stores/conversationStore'
import { useCostStore } from '../../stores/costStore'
import { useServiceStore } from '../../stores/serviceStore'
import { useSettingsStore } from '../../stores/settingsStore'
import { useTraceStore } from '../../stores/traceStore'

type RoutingEntry = {
  timestamp: string
  queryPreview: string
  chosenTier: string
  reason: string
  confidence: number
  wasOverridden: boolean
  conversationId?: string
  estimatedCost?: number
}

export default function RoutingPanel() {
  const settings = useSettingsStore((s) => s.settings)
  const activeConversation = useConversationStore((s) => s.activeConversation())
  useCostStore((s) => s.getSummary())
  const ollamaRunning = useServiceStore((s) => s.getService('ollama')?.running ?? false)
  const executionSummary = useTraceStore((s) => s.executionSummary)
  const [entries, setEntries] = useState<RoutingEntry[]>([])
  const [hasClaudeKey, setHasClaudeKey] = useState(false)
  const [voiceStatus, setVoiceStatus] = useState<{
    healthy: boolean
    port: number
    apiKeyConfigured?: boolean
    defaultVoiceId?: string
    modelId?: string
  } | null>(null)
  const summary = executionSummary(activeConversation?.id ?? null)
  const chainPathLabel = summary.chainPath === 'unknown'
    ? 'unknown'
    : summary.chainPath.replace(/-/g, ' ')

  useEffect(() => {
    const load = async () => {
      const result = await window.electron.routingGetEntries()
      if (result.success) setEntries([...result.entries].sort((a, b) => b.timestamp.localeCompare(a.timestamp)))
    }
    load().catch(() => {})
  }, [activeConversation?.id])

  useEffect(() => {
    window.electron.apiKeyHas().then((result) => setHasClaudeKey(result.hasKey)).catch(() => setHasClaudeKey(false))
    window.electron.voiceStatus().then(setVoiceStatus).catch(() => setVoiceStatus(null))
  }, [])

  return (
    <div className="space-y-4 p-4">
      <section className="arcos-subpanel rounded-xl p-3">
        <p className="arcos-kicker">Current Policy</p>
        <div className="mt-3 grid gap-3 sm:grid-cols-2">
          <Stat label="Mode" value={settings.routingMode} />
          <Stat label="Monthly Budget" value={`$${settings.monthlyBudgetLimit.toFixed(2)}`} />
          <Stat label="Ollama" value={ollamaRunning ? 'Online' : 'Offline'} />
          <Stat label="Chain Path" value={chainPathLabel} />
        </div>
        <div className="mt-3 space-y-2 text-xs leading-5 text-text-muted">
          <p><span className="text-text">Chain Path:</span> the route the current request took through ARCOS. `unknown` means there is no completed chain summary yet for the active thread.</p>
        </div>
      </section>

      <section className="arcos-subpanel rounded-xl p-3">
        <p className="arcos-kicker">Connections</p>
        <div className="mt-3 grid gap-3 sm:grid-cols-3">
          <Stat label="Claude" value={hasClaudeKey ? 'Connected' : 'Not Connected'} />
          <Stat label="Ollama" value={ollamaRunning ? 'Connected' : 'Offline'} />
          <Stat label="ElevenLabs" value={voiceStatus?.apiKeyConfigured && voiceStatus.defaultVoiceId ? 'Ready' : 'Not Connected'} />
        </div>
      </section>

      <section className="arcos-subpanel rounded-xl p-3">
        <div className="flex items-center justify-between">
          <p className="arcos-kicker">Recent Decisions</p>
          <button
            onClick={async () => {
              const result = await window.electron.routingGetEntries()
              if (result.success) setEntries([...result.entries].sort((a, b) => b.timestamp.localeCompare(a.timestamp)))
            }}
            className="arcos-action rounded px-2 py-1 text-[10px] uppercase tracking-wider"
          >
            Refresh
          </button>
        </div>
        <div className="mt-3 space-y-2">
          <p className="text-[11px] leading-5 text-text-muted">
            Recent Decisions shows the last recorded routing choices. Confidence is ARCOS&apos;s internal certainty score for that decision, not a model quality score.
          </p>
          {entries.length === 0 ? (
            <p className="text-xs text-text-muted">No routing log entries yet.</p>
          ) : (
            [...entries].slice(0, 8).map((entry, index) => (
              <div key={`${entry.timestamp}-${index}`} className="rounded-lg border border-border bg-[#12161b] px-3 py-2.5">
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0 flex flex-wrap items-center gap-2">
                    <span className="break-words text-xs font-semibold tracking-wide text-text">{entry.chosenTier}</span>
                    <span className="rounded-full border border-border px-2 py-0.5 text-[10px] uppercase tracking-wider text-text-muted">
                      {Math.round(entry.confidence * 100)}% confidence
                    </span>
                    {entry.wasOverridden && (
                      <span className="rounded-full border border-amber-700/40 px-2 py-0.5 text-[10px] uppercase tracking-wider text-amber-300">
                        overridden
                      </span>
                    )}
                  </div>
                  <span className="text-[11px] text-text-muted">
                    {new Date(entry.timestamp).toLocaleTimeString()}
                  </span>
                </div>
                <p className="mt-1 break-words text-xs text-text-muted">{entry.queryPreview}</p>
                <p className="mt-1 break-words text-[11px] leading-5 text-text-muted">{entry.reason}</p>
                {entry.estimatedCost !== undefined && (
                  <p className="mt-2 text-[11px] uppercase tracking-wider text-text-muted">
                    est. cost: ${entry.estimatedCost.toFixed(4)}
                  </p>
                )}
              </div>
            ))
          )}
        </div>
      </section>
    </div>
  )
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-lg border border-border bg-[#12161b] px-3 py-2.5">
      <p className="arcos-kicker">{label}</p>
      <p className="mt-1 break-words text-sm font-medium text-text">{value}</p>
    </div>
  )
}
