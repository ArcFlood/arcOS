import { create } from 'zustand'
import { WorkspacePanelId } from '../workspace/types'

export type TraceLevel = 'info' | 'success' | 'warn' | 'error'
export type TraceSource = 'chat' | 'routing' | 'service' | 'system' | 'tool' | 'memory'

export interface TraceEntry {
  id: string
  timestamp: number
  level: TraceLevel
  source: TraceSource
  title: string
  detail?: string
  conversationId?: string
  relatedPanels?: WorkspacePanelId[]
  entityLabel?: string
}

interface TraceStore {
  entries: TraceEntry[]
  appendEntry: (entry: Omit<TraceEntry, 'id' | 'timestamp'>) => void
  clearEntries: () => void
}

const MAX_TRACE_ENTRIES = 150

export const useTraceStore = create<TraceStore>((set) => ({
  entries: [],

  appendEntry: (entry) =>
    set((state) => {
      const next: TraceEntry[] = [
        {
          id: crypto.randomUUID(),
          timestamp: Date.now(),
          ...entry,
        },
        ...state.entries,
      ].slice(0, MAX_TRACE_ENTRIES)
      return { entries: next }
    }),

  clearEntries: () => set({ entries: [] }),
}))
