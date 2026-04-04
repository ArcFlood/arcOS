import { create } from 'zustand'
import { Plugin } from './types'
import { useTraceStore } from './traceStore'

interface PluginState {
  plugins: Plugin[]
  activePlugin: Plugin | null
  loading: boolean

  loadPlugins: () => Promise<void>
  activatePlugin: (id: string) => void
  deactivatePlugin: () => void
  installFromFile: () => Promise<{ success: boolean; error?: string }>
  openPluginsDir: () => void

  // Helper: find a plugin by slash command (e.g. "/review")
  findByCommand: (command: string) => Plugin | null
}

export const usePluginStore = create<PluginState>((set, get) => ({
  plugins: [],
  activePlugin: null,
  loading: false,

  loadPlugins: async () => {
    set({ loading: true })
    try {
      const res = await window.electron.pluginsList()
      if (res.success) {
        // Cast PluginManifest[] (from IPC) to Plugin[] — shapes are identical
        set({ plugins: res.plugins as unknown as Plugin[] })
      }
    } catch (e) {
      console.error('[PluginStore] Failed to load plugins:', e)
    } finally {
      set({ loading: false })
    }
  },

  activatePlugin: (id: string) => {
    const plugin = get().plugins.find((p) => p.id === id) ?? null
    set({ activePlugin: plugin })
    if (plugin) {
      useTraceStore.getState().appendEntry({
        source: 'tool',
        level: 'info',
        title: `Activated plugin ${plugin.name}`,
        detail: plugin.description,
        relatedPanels: ['tools', 'prompt_inspector'],
        entityLabel: plugin.id,
      })
    }
  },

  deactivatePlugin: () => {
    const active = get().activePlugin
    set({ activePlugin: null })
    if (active) {
      useTraceStore.getState().appendEntry({
        source: 'tool',
        level: 'warn',
        title: `Deactivated plugin ${active.name}`,
        detail: 'Plugin override removed from the active ARCOS prompt stack.',
        relatedPanels: ['tools', 'prompt_inspector'],
        entityLabel: active.id,
      })
    }
  },

  installFromFile: async () => {
    const res = await window.electron.pluginsInstallFile()
    if (res.success) {
      // Reload the list to pick up the newly installed plugin
      await get().loadPlugins()
      useTraceStore.getState().appendEntry({
        source: 'tool',
        level: 'success',
        title: 'Installed plugin from file',
        detail: 'Plugin registry reloaded successfully.',
        relatedPanels: ['tools'],
        entityLabel: 'plugin-install',
      })
    } else if (res.error) {
      useTraceStore.getState().appendEntry({
        source: 'tool',
        level: 'error',
        title: 'Plugin install failed',
        detail: res.error,
        relatedPanels: ['tools'],
        entityLabel: 'plugin-install',
      })
    }
    return res
  },

  openPluginsDir: () => {
    window.electron.pluginsOpenDir()
    useTraceStore.getState().appendEntry({
      source: 'tool',
      level: 'info',
      title: 'Opened plugins directory',
      detail: 'Plugin folder opened from the PAI tools surface.',
      relatedPanels: ['tools'],
      entityLabel: 'plugins-folder',
    })
  },

  findByCommand: (command: string) => {
    const lower = command.toLowerCase()
    return get().plugins.find((p) =>
      p.commands.some((cmd) => cmd.toLowerCase() === lower)
    ) ?? null
  },
}))
