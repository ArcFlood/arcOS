/**
 * hookStore.ts — Renderer-side Zustand store for hook events.
 *
 * Receives real-time HookEvent pushes from main via IPC ('hook:event'),
 * maintains a rolling buffer, and exposes query helpers for the HooksPanel UI.
 */

import { create } from 'zustand'
import type { HookEvent, HookEventType, HookStage, HookRegistryEntry } from './hookTypes'

// ── State shape ───────────────────────────────────────────────────

interface HookStoreState {
  events: HookEvent[]
  registeredHooks: HookRegistryEntry[]
  stats: {
    totalEvents: number
    byType: Record<string, number>
    byStatus: Record<string, number>
    recentFailures: number
  }
  isListening: boolean

  // Actions
  appendEvent: (event: HookEvent) => void
  setRegisteredHooks: (hooks: HookRegistryEntry[]) => void
  setStats: (stats: HookStoreState['stats']) => void
  clearEvents: () => void
  startListening: () => () => void

  // Derived queries
  getEventsByType: (type: HookEventType) => HookEvent[]
  getEventsByRequest: (requestId: string) => HookEvent[]
  getEventsByStage: (stage: HookStage) => HookEvent[]
}

const MAX_EVENTS = 200

// ── Store ─────────────────────────────────────────────────────────

export const useHookStore = create<HookStoreState>((set, get) => ({
  events: [],
  registeredHooks: [],
  stats: { totalEvents: 0, byType: {}, byStatus: {}, recentFailures: 0 },
  isListening: false,

  appendEvent: (event: HookEvent) => {
    set((state) => {
      const next = [...state.events, event]
      if (next.length > MAX_EVENTS) next.splice(0, next.length - MAX_EVENTS)
      return { events: next }
    })
  },

  setRegisteredHooks: (hooks) => set({ registeredHooks: hooks }),

  setStats: (stats) => set({ stats }),

  clearEvents: () => set({ events: [] }),

  startListening: () => {
    if (get().isListening) return () => {}

    // Subscribe to live push events from main
    const cleanup = window.electron.hookOnEvent?.((event: HookEvent) => {
      get().appendEvent(event)
    }) ?? (() => {})

    // Load existing events + registry from main
    void window.electron.hookGetRecent?.().then((result) => {
      if (result.success && result.events) {
        set({ events: result.events.slice(-MAX_EVENTS) })
      }
    })
    void window.electron.hookGetRegistry?.().then((result) => {
      if (result.success && result.hooks) {
        set({ registeredHooks: result.hooks })
      }
    })
    void window.electron.hookGetStats?.().then((result) => {
      if (result.success && result.stats) {
        set({ stats: result.stats })
      }
    })

    set({ isListening: true })

    return () => {
      cleanup()
      set({ isListening: false })
    }
  },

  getEventsByType: (type) => get().events.filter((e) => e.eventType === type),
  getEventsByRequest: (requestId) => get().events.filter((e) => e.requestId === requestId),
  getEventsByStage: (stage) => get().events.filter((e) => e.stage === stage),
}))

// ── Hook event emitter (used by canonicalChainService) ────────────

let requestIdCounter = 0

export function newRequestId(): string {
  return `req-${Date.now()}-${++requestIdCounter}`
}

export function emitHookEvent(event: Omit<HookEvent, 'id' | 'timestamp'>): void {
  const full: HookEvent = {
    ...event,
    id: `hook-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
    timestamp: new Date().toISOString(),
  }

  // Forward to main process for persistence + relay
  void window.electron.hookEmit?.(full)

  // Also update local store immediately (optimistic)
  useHookStore.getState().appendEvent(full)
}
