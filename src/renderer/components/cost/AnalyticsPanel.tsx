import { useEffect, useMemo, useState } from 'react'
import { useConversationStore } from '../../stores/conversationStore'
import { useCostStore } from '../../stores/costStore'
import { useSettingsStore } from '../../stores/settingsStore'

const ARCOS_TOTAL_APP_SECONDS_KEY = 'arcos-total-app-seconds'

function fmt(n: number): string {
  if (n === 0) return '$0.00'
  if (n < 0.001) return `$${(n * 1000).toFixed(3)}m`
  return `$${n.toFixed(4)}`
}

function formatDuration(totalSeconds: number): string {
  if (totalSeconds <= 0) return '0m'
  const hours = Math.floor(totalSeconds / 3600)
  const minutes = Math.floor((totalSeconds % 3600) / 60)
  if (hours === 0) return `${minutes}m`
  return `${hours}h ${minutes}m`
}

export default function AnalyticsPanel() {
  const getSummary = useCostStore((s) => s.getSummary)
  const clearRecords = useCostStore((s) => s.clearRecords)
  const records = useCostStore((s) => s.records)
  const conversations = useConversationStore((s) => s.conversations)
  const budgetWarnLimit = useSettingsStore((s) => s.settings.budgetWarnLimit)
  const monthlyBudgetLimit = useSettingsStore((s) => s.settings.monthlyBudgetLimit)

  const [totalAppSeconds, setTotalAppSeconds] = useState(0)

  useEffect(() => {
    const load = () => {
      setTotalAppSeconds(Number.parseInt(localStorage.getItem(ARCOS_TOTAL_APP_SECONDS_KEY) ?? '0', 10) || 0)
    }
    load()
    const interval = window.setInterval(load, 15_000)
    return () => window.clearInterval(interval)
  }, [])

  const summary = getSummary()
  const totalSpend = summary.month

  const totalMessages = conversations.reduce((sum, conversation) => (
    sum + conversation.messages.filter((message) => message.role !== 'system').length
  ), 0)

  const localMessages = conversations.reduce((sum, conversation) => (
    sum + conversation.messages.filter((message) => message.role === 'assistant' && message.model === 'ollama').length
  ), 0)

  const paidMessages = records.length
  const fabricSkillsUsed = useMemo(() => (
    conversations.reduce((sum, conversation) => (
      sum + conversation.messages.filter((message) => (
        message.role === 'assistant' &&
        typeof message.routingReason === 'string' &&
        message.routingReason.startsWith('Fabric:')
      )).length
    ), 0)
  ), [conversations])

  const atWarnThreshold = totalSpend >= budgetWarnLimit
  const atHardLimit = totalSpend >= monthlyBudgetLimit

  const handleExportCsv = async () => {
    const rows = records.map((record) => ({
      id: record.id,
      date: record.date,
      model: record.model,
      amount: record.amount,
      conversationId: record.conversationId,
    }))
    await window.electron.spendingExportCsv?.({ records: rows })
  }

  return (
    <div className="space-y-6">
      {(atWarnThreshold || atHardLimit) && (
        <div className={`rounded-lg border px-3 py-2.5 text-xs ${
          atHardLimit
            ? 'border-danger/40 bg-danger/10 text-danger'
            : 'border-warning/40 bg-warning/10 text-warning'
        }`}>
          {atHardLimit
            ? `Monthly limit reached ($${monthlyBudgetLimit}). Consider switching to local models.`
            : `Approaching monthly budget ($${totalSpend.toFixed(2)} / $${monthlyBudgetLimit}).`}
        </div>
      )}

      <div className="grid grid-cols-3 gap-3">
        {[
          { label: 'Today', value: fmt(summary.today) },
          { label: '7 Days', value: fmt(summary.week) },
          { label: '30 Days', value: fmt(summary.month) },
        ].map(({ label, value }) => (
          <MetricCard key={label} label={label} value={value} emphasize />
        ))}
      </div>

      <div>
        <p className="mb-2 text-xs font-semibold uppercase tracking-wider text-text-muted">Message Stats</p>
        <div className="grid grid-cols-3 gap-3">
          <MetricCard label="Conversations" value={String(conversations.length)} />
          <MetricCard label="All Messages" value={String(totalMessages)} />
          <MetricCard label="Paid Messages" value={String(paidMessages)} />
        </div>
      </div>

      <div>
        <p className="mb-2 text-xs font-semibold uppercase tracking-wider text-text-muted">Operational Totals</p>
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
          <MetricCard label="Fabric Skills Used" value={String(fabricSkillsUsed)} />
          <MetricCard label="Total Time In App" value={formatDuration(totalAppSeconds)} />
          <MetricCard label="Local Model Runs" value={String(localMessages)} />
        </div>
      </div>

      {records.length > 0 && (
        <div className="flex gap-2">
          <button
            onClick={handleExportCsv}
            className="arcos-action flex-1 rounded px-3 py-2 text-xs"
          >
            Export CSV
          </button>
          <button
            onClick={() => {
              if (window.confirm('Clear all spending records? This cannot be undone.')) clearRecords()
            }}
            className="btn-danger flex-1 text-xs"
          >
            Clear Records
          </button>
        </div>
      )}
    </div>
  )
}

function MetricCard({
  label,
  value,
  emphasize = false,
}: {
  label: string
  value: string
  emphasize?: boolean
}) {
  return (
    <div className="rounded-lg border border-border bg-background px-3 py-2.5 text-center">
      <p className="text-xs text-text-muted">{label}</p>
      <p className={`mt-0.5 text-sm font-semibold ${emphasize ? 'text-danger' : 'text-text'}`}>{value}</p>
    </div>
  )
}
