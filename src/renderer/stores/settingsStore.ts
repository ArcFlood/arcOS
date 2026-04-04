import { create } from 'zustand'
import { AppSettings, RoutingMode, RoutingAggressiveness } from './types'

const DEFAULT_SETTINGS: AppSettings = {
  ollamaModel: 'qwen3:14b',          // PRD v2: Qwen 3 14B replaces llama3.1 as primary
  dailyBudgetLimit: 3.0,             // PRD v2: $15-20/month target → ~$3/day
  monthlyBudgetLimit: 15.0,          // PRD v2: updated from $5 to $15
  budgetWarnLimit: 10.0,             // PRD v2: warn at $10/month
  autoStartOllama: false,
  autoStartFabric: false,
  routingMode: 'auto',
  routingAggressiveness: 'balanced',
  extendedThinking: false,
  showRoutingReasons: true,
  appearanceTheme: 'default',
  appearanceFont: 'IBM Plex Sans',
  appearanceTextColor: '#e6edf5',
  appearanceAccentColor: '#8fa1b3',
  appearanceAccentSecondaryColor: '#d4a25a',
}

interface SettingsStore {
  settings: AppSettings
  settingsPanelOpen: boolean
  hasApiKey: boolean
  checkApiKey: () => Promise<void>
  setApiKey: (key: string) => Promise<boolean>   // write-only — never stored in renderer state
  updateSettings: (updates: Partial<AppSettings>) => void
  setOllamaModel: (model: string) => void
  setRoutingMode: (mode: RoutingMode) => void
  setRoutingAggressiveness: (a: RoutingAggressiveness) => void
  toggleExtendedThinking: () => void
  openSettingsPanel: () => void
  closeSettingsPanel: () => void
  resetToDefaults: () => void
  autoFixOllamaModel: (availableModels: string[]) => void
  loadFromDb: () => Promise<void>
}

const DB_KEY = 'app-settings'

function persistSettings(settings: AppSettings): void {
  window.electron.db.settings
    .set(DB_KEY, JSON.stringify(settings))
    .catch(console.error)
}

export const useSettingsStore = create<SettingsStore>((set, get) => ({
  settings: { ...DEFAULT_SETTINGS },
  settingsPanelOpen: false,
  hasApiKey: false,

  loadFromDb: async () => {
    try {
      const result = await window.electron.db.settings.get(DB_KEY)
      if (result.success && result.value) {
        const saved = JSON.parse(result.value) as Partial<AppSettings>
        // Strip any legacy claudeApiKey that may have been stored in the blob.
        const rest = { ...(saved as Partial<AppSettings> & { claudeApiKey?: string }) }
        delete rest.claudeApiKey
        set({ settings: { ...DEFAULT_SETTINGS, ...rest } })
      }
      // Check key existence in main process
      const keyResult = await window.electron.apiKeyHas?.()
      set({ hasApiKey: keyResult?.hasKey ?? false })
    } catch (e) {
      console.error('[SettingsStore] DB load failed:', e)
    }
  },

  checkApiKey: async () => {
    const result = await window.electron.apiKeyHas?.()
    set({ hasApiKey: result?.hasKey ?? false })
  },

  // Sends key to main process for secure storage — raw key never stored in renderer
  setApiKey: async (key: string) => {
    const result = await window.electron.apiKeySet?.(key)
    const success = result?.success ?? false
    if (success) set({ hasApiKey: key.trim().length > 0 })
    return success
  },

  updateSettings: (updates) => {
    set((s) => {
      const settings = { ...s.settings, ...updates }
      persistSettings(settings)
      return { settings }
    })
  },

  setOllamaModel: (ollamaModel) => {
    set((s) => {
      const settings = { ...s.settings, ollamaModel }
      persistSettings(settings)
      return { settings }
    })
  },

  setRoutingMode: (routingMode) => {
    set((s) => {
      const settings = { ...s.settings, routingMode }
      persistSettings(settings)
      return { settings }
    })
  },

  setRoutingAggressiveness: (routingAggressiveness) => {
    set((s) => {
      const settings = { ...s.settings, routingAggressiveness }
      persistSettings(settings)
      return { settings }
    })
  },

  toggleExtendedThinking: () => {
    set((s) => {
      const settings = { ...s.settings, extendedThinking: !s.settings.extendedThinking }
      persistSettings(settings)
      return { settings }
    })
  },

  openSettingsPanel: () => set({ settingsPanelOpen: true }),
  closeSettingsPanel: () => set({ settingsPanelOpen: false }),

  resetToDefaults: () => {
    set({ settings: { ...DEFAULT_SETTINGS } })
    persistSettings({ ...DEFAULT_SETTINGS })
  },

  autoFixOllamaModel: (availableModels) => {
    if (availableModels.length === 0) return
    const { ollamaModel } = get().settings
    if (!availableModels.includes(ollamaModel)) {
      const picked = availableModels[0]
      console.log(`[Settings] Model "${ollamaModel}" not found — auto-selecting "${picked}"`)
      set((s) => {
        const settings = { ...s.settings, ollamaModel: picked }
        persistSettings(settings)
        return { settings }
      })
    }
  },
}))
