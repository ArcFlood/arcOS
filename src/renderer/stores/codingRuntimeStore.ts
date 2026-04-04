import { create } from 'zustand'
import { CodingRuntimeStatus } from './types'
import { useTraceStore } from './traceStore'

interface CodingRuntimeStore {
  status: CodingRuntimeStatus | null
  loading: boolean
  error: string | null
  refresh: () => Promise<void>
}

export const useCodingRuntimeStore = create<CodingRuntimeStore>((set) => ({
  status: null,
  loading: false,
  error: null,

  refresh: async () => {
    set({ loading: true, error: null })
    try {
      const result = await window.electron.codingRuntimeStatus()
      if (!result.success || !result.status) {
        set({ loading: false, error: result.error ?? 'Runtime status unavailable.' })
        useTraceStore.getState().appendEntry({
          source: 'system',
          level: 'error',
          title: 'Coding runtime refresh failed',
          detail: result.error ?? 'Runtime status unavailable.',
          relatedPanels: ['runtime', 'transparency'],
          entityLabel: 'coding-runtime',
        })
        return
      }

      set({ status: result.status, loading: false, error: null })
      useTraceStore.getState().appendEntry({
        source: 'system',
        level: result.status.mergeReadiness === 'ready' ? 'success' : result.status.mergeReadiness === 'unknown' ? 'warn' : 'info',
        title: 'Coding runtime refreshed',
        detail: result.status.activeRepositoryPath
          ? `${result.status.branch ?? 'detached'} · ${result.status.worktreeCount} worktrees · ${result.status.verificationCommands.length} verification commands`
          : `No active repository detected. Linked workspace: ${result.status.linkedWorkspacePath}`,
        relatedPanels: ['runtime', 'transparency', 'history'],
        entityLabel: result.status.branch ?? 'runtime',
      })
    } catch (error) {
      const message = String(error)
      set({ loading: false, error: message })
      useTraceStore.getState().appendEntry({
        source: 'system',
        level: 'error',
        title: 'Coding runtime refresh threw an error',
        detail: message,
        relatedPanels: ['runtime', 'transparency'],
        entityLabel: 'coding-runtime',
      })
    }
  },
}))
