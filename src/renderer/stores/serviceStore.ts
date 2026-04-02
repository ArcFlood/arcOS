import { create } from 'zustand'
import { ServiceStatus, ServiceName } from './types'

const INITIAL_SERVICES: ServiceStatus[] = [
  { name: 'ollama', displayName: 'Ollama', running: false, port: 11434, checking: false },
  { name: 'fabric', displayName: 'Fabric', running: false, port: 8080, checking: false },
  { name: 'arc-memory', displayName: 'ARC-Memory', running: false, port: 8082, checking: false },
]

interface ServiceStore {
  services: ServiceStatus[]
  availableOllamaModels: string[]
  getService: (name: ServiceName) => ServiceStatus | undefined
  setServiceStatus: (name: ServiceName, updates: Partial<ServiceStatus>) => void
  setAvailableModels: (models: string[]) => void
  checkAllServices: () => Promise<void>
  startService: (name: ServiceName) => Promise<void>
  stopService: (name: ServiceName) => Promise<void>
  fetchOllamaModels: () => Promise<string[]>
}

export const useServiceStore = create<ServiceStore>((set, get) => ({
  services: INITIAL_SERVICES,
  availableOllamaModels: [],

  getService: (name) => get().services.find((s) => s.name === name),

  setServiceStatus: (name, updates) =>
    set((s) => ({
      services: s.services.map((svc) => (svc.name === name ? { ...svc, ...updates } : svc)),
    })),

  setAvailableModels: (models) => set({ availableOllamaModels: models }),

  fetchOllamaModels: async () => {
    try {
      const result = await window.electron.ollamaListModels()
      if (result.success && result.models.length > 0) {
        set({ availableOllamaModels: result.models })
        return result.models
      }
    } catch (_) {}
    return []
  },

  checkAllServices: async () => {
    const { services, setServiceStatus, fetchOllamaModels } = get()
    await Promise.all(
      services.map(async (svc) => {
        setServiceStatus(svc.name, { checking: true })
        try {
          const result = await window.electron.serviceStatus(svc.name)
          setServiceStatus(svc.name, { running: result.running, pid: result.pid, checking: false })
          // If Ollama just came up, fetch its models
          if (svc.name === 'ollama' && result.running) {
            await fetchOllamaModels()
          }
        } catch {
          setServiceStatus(svc.name, { running: false, checking: false })
        }
      })
    )
  },

  startService: async (name) => {
    const { setServiceStatus, fetchOllamaModels } = get()
    setServiceStatus(name, { checking: true, error: undefined })
    try {
      const result = await window.electron.serviceStart(name)
      if (result.success) {
        await new Promise((r) => setTimeout(r, 1800))
        const status = await window.electron.serviceStatus(name)
        setServiceStatus(name, { running: status.running, checking: false })
        if (name === 'ollama' && status.running) {
          await fetchOllamaModels()
        }
      } else {
        setServiceStatus(name, { checking: false, error: result.error })
      }
    } catch (e) {
      setServiceStatus(name, { checking: false, error: String(e) })
    }
  },

  stopService: async (name) => {
    const { setServiceStatus } = get()
    setServiceStatus(name, { checking: true })
    try {
      await window.electron.serviceStop(name)
      setServiceStatus(name, { running: false, pid: undefined, checking: false })
    } catch (e) {
      setServiceStatus(name, { checking: false, error: String(e) })
    }
  },
}))
