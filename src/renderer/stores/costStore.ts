import { create } from 'zustand'
import { CostSummary, ModelTier, SpendingRecord } from './types'

interface CostStore {
  records: SpendingRecord[]
  getSummary: () => CostSummary
  addRecord: (record: Omit<SpendingRecord, 'date'>) => void
  clearRecords: () => void
  loadFromDb: () => Promise<void>
  getRecordsByDay: (days: number) => Array<{ date: string; amount: number }>
  getRecordsByTier: () => Record<ModelTier, number>
}

function toDateStr(ts: number): string {
  return new Date(ts).toISOString().slice(0, 10)
}

export const useCostStore = create<CostStore>((set, get) => ({
  records: [],

  // ── Bootstrap ──────────────────────────────────────────────────
  loadFromDb: async () => {
    try {
      const result = await window.electron.db.spending.list()
      if (!result.success || !result.data) return
      const records: SpendingRecord[] = result.data.map((row) => {
        const r = row as Record<string, unknown>
        return {
          id: r.id as string,
          date: r.date as string,
          model: r.model as ModelTier,
          amount: r.amount as number,
          conversationId: (r.conversation_id as string | null) ?? undefined,
        }
      })
      // Prune anything older than 90 days
      const cutoff = toDateStr(Date.now() - 90 * 24 * 60 * 60 * 1000)
      set({ records: records.filter((r) => r.date >= cutoff) })
    } catch (e) {
      console.error('[CostStore] DB load failed:', e)
    }
  },

  getSummary: () => {
    const { records } = get()
    const now = Date.now()
    const todayStr = toDateStr(now)
    const weekAgo = now - 7 * 24 * 60 * 60 * 1000
    const monthAgo = now - 30 * 24 * 60 * 60 * 1000
    return {
      today: records.filter((r) => r.date === todayStr).reduce((s, r) => s + r.amount, 0),
      week: records.filter((r) => new Date(r.date).getTime() >= weekAgo).reduce((s, r) => s + r.amount, 0),
      month: records.filter((r) => new Date(r.date).getTime() >= monthAgo).reduce((s, r) => s + r.amount, 0),
    }
  },

  addRecord: (record) => {
    const full: SpendingRecord = {
      ...record,
      id: record.id ?? crypto.randomUUID(),
      date: toDateStr(Date.now()),
    }
    set((s) => ({ records: [...s.records, full] }))
    window.electron.db.spending.add({
      id: full.id,
      date: full.date,
      model: full.model,
      amount: full.amount,
      conversation_id: full.conversationId ?? null,
    }).catch(console.error)
  },

  clearRecords: () => {
    set({ records: [] })
    window.electron.db.spending.clear().catch(console.error)
  },

  getRecordsByDay: (days) => {
    const { records } = get()
    const result: Record<string, number> = {}
    for (let i = days - 1; i >= 0; i--) {
      const d = new Date(Date.now() - i * 24 * 60 * 60 * 1000)
      result[toDateStr(d.getTime())] = 0
    }
    for (const r of records) {
      if (r.date in result) result[r.date] += r.amount
    }
    return Object.entries(result).map(([date, amount]) => ({ date, amount }))
  },

  getRecordsByTier: () => {
    const { records } = get()
    const tiers: Record<ModelTier, number> = { ollama: 0, haiku: 0, 'arc-sonnet': 0, 'arc-opus': 0 }
    for (const r of records) {
      if (r.model in tiers) tiers[r.model as ModelTier] += r.amount
    }
    return tiers
  },
}))

// ── Helpers ───────────────────────────────────────────────────────

export function estimateCost(tier: ModelTier, inputTokens: number, outputTokens: number): number {
  const rates: Record<ModelTier, { in: number; out: number }> = {
    ollama: { in: 0, out: 0 },
    haiku: { in: 1.0 / 1_000_000, out: 5.0 / 1_000_000 },
    'arc-sonnet': { in: 3.0 / 1_000_000, out: 15.0 / 1_000_000 },
    'arc-opus': { in: 5.0 / 1_000_000, out: 25.0 / 1_000_000 },
  }
  const r = rates[tier]
  return r.in * inputTokens + r.out * outputTokens
}

export function estimateTokens(text: string): number {
  return Math.ceil(text.length / 4)
}
