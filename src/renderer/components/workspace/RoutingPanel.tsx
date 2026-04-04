import { useEffect, useMemo, useState } from 'react'
import { useConversationStore } from '../../stores/conversationStore'
import { useCostStore } from '../../stores/costStore'
import { useServiceStore } from '../../stores/serviceStore'
import { useSettingsStore } from '../../stores/settingsStore'
import { routeQuery, TIER_DISPLAY_LABELS } from '../../utils/routing'

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
  const spendingToday = useCostStore((s) => s.getSummary().today)
  const ollamaRunning = useServiceStore((s) => s.getService('ollama')?.running ?? false)
  const [entries, setEntries] = useState<RoutingEntry[]>([])

  useEffect(() => {
    const load = async () => {
      const result = await window.electron.routingGetEntries()
      if (result.success) setEntries(result.entries)
    }
    load().catch(() => {})
  }, [activeConversation?.id])

  const preview = useMemo(() => {
    const lastUserMessage = [...(activeConversation?.messages ?? [])]
      .reverse()
      .find((message) => message.role === 'user')

    if (!lastUserMessage) return null

    return routeQuery(
      lastUserMessage.content,
      settings.routingMode,
      settings.routingAggressiveness,
      ollamaRunning,
      spendingToday,
      settings.dailyBudgetLimit
    )
  }, [
    activeConversation?.messages,
    settings.routingMode,
    settings.routingAggressiveness,
    settings.dailyBudgetLimit,
    ollamaRunning,
    spendingToday,
  ])

  return (
    <div className="space-y-4 p-4">
      <section className="arcos-subpanel rounded-xl p-3">
        <p className="arcos-kicker">Current Policy</p>
        <div className="mt-3 grid gap-3 sm:grid-cols-2">
          <Stat label="Mode" value={settings.routingMode} />
          <Stat label="Aggressiveness" value={settings.routingAggressiveness} />
          <Stat label="Daily Budget" value={`$${settings.dailyBudgetLimit.toFixed(2)}`} />
          <Stat label="Ollama" value={ollamaRunning ? 'Online' : 'Offline'} />
        </div>
      </section>

      <section className="arcos-subpanel rounded-xl p-3">
        <p className="arcos-kicker">Preview</p>
        {preview ? (
          <div className="mt-3 space-y-2">
            <div className="text-sm font-medium text-text">{TIER_DISPLAY_LABELS[preview.tier]}</div>
            <p className="text-xs leading-5 text-text-muted">{preview.reason}</p>
          </div>
        ) : (
          <p className="mt-3 text-xs text-text-muted">Send a message to start collecting routing context.</p>
        )}
      </section>

      <section className="arcos-subpanel rounded-xl p-3">
        <div className="flex items-center justify-between">
          <p className="arcos-kicker">Recent Decisions</p>
          <button
            onClick={async () => {
              const result = await window.electron.routingGetEntries()
              if (result.success) setEntries(result.entries)
            }}
            className="arcos-action rounded px-2 py-1 text-[10px] uppercase tracking-wider"
          >
            Refresh
          </button>
        </div>
        <div className="mt-3 space-y-2">
          {entries.length === 0 ? (
            <p className="text-xs text-text-muted">No routing log entries yet.</p>
          ) : (
            entries.slice(0, 8).map((entry, index) => (
              <div key={`${entry.timestamp}-${index}`} className="rounded-lg border border-border bg-[#12161b] px-3 py-2.5">
                <div className="flex items-center justify-between gap-3">
                  <div className="flex items-center gap-2">
                    <span className="text-xs font-semibold tracking-wide text-text">{entry.chosenTier}</span>
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
                <p className="mt-1 text-xs text-text-muted">{entry.queryPreview}</p>
                <p className="mt-1 text-[11px] leading-5 text-text-muted">{entry.reason}</p>
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
      <p className="mt-1 text-sm font-medium text-text">{value}</p>
    </div>
  )
}
