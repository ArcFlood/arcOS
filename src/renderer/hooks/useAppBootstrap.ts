import { useEffect } from 'react'
import { useServiceStore } from '../stores/serviceStore'
import { useSettingsStore } from '../stores/settingsStore'
import { useConversationStore } from '../stores/conversationStore'
import { useCostStore } from '../stores/costStore'
import { usePluginStore } from '../stores/pluginStore'
import { useWorkspaceStore } from '../stores/workspaceStore'

export default function useAppBootstrap() {
  const checkAllServices = useServiceStore((s) => s.checkAllServices)
  const fetchOllamaModels = useServiceStore((s) => s.fetchOllamaModels)
  const loadSettings = useSettingsStore((s) => s.loadFromDb)
  const autoFixOllamaModel = useSettingsStore((s) => s.autoFixOllamaModel)
  const loadConversations = useConversationStore((s) => s.loadFromDb)
  const loadCost = useCostStore((s) => s.loadFromDb)
  const loadPlugins = usePluginStore((s) => s.loadPlugins)
  const hydrateWorkspace = useWorkspaceStore((s) => s.hydrate)

  useEffect(() => {
    hydrateWorkspace()

    const init = async () => {
      await Promise.all([
        loadSettings(),
        loadConversations(),
        loadCost(),
        loadPlugins(),
      ])
      await checkAllServices()
      const models = await fetchOllamaModels()
      if (models.length > 0) autoFixOllamaModel(models)
    }

    init().catch((err) => {
      window.electron.logAppend?.('error', 'Bootstrap failed', String(err))?.catch?.(() => {})
    })

    const interval = setInterval(checkAllServices, 30_000)
    return () => clearInterval(interval)
  // Stable store-action refs — safe to omit from deps
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])
}
