import { useEffect, useState } from 'react'
import Sidebar from './Sidebar'
import TopBar from './TopBar'
import ChatArea from './ChatArea'
import SettingsPanel from './settings/SettingsPanel'
import ErrorLogPanel from './debug/ErrorLogPanel'
import SessionHistoryPanel from './history/SessionHistoryPanel'
import WeeklyDigest from './history/WeeklyDigest'
import MemoryPanel from './memory/MemoryPanel'
import { useServiceStore } from '../stores/serviceStore'
import { useSettingsStore } from '../stores/settingsStore'
import { useConversationStore } from '../stores/conversationStore'
import { useCostStore } from '../stores/costStore'
import { usePluginStore } from '../stores/pluginStore'

export default function Layout() {
  const checkAllServices = useServiceStore((s) => s.checkAllServices)
  const fetchOllamaModels = useServiceStore((s) => s.fetchOllamaModels)
  const settingsPanelOpen = useSettingsStore((s) => s.settingsPanelOpen)
  const openSettings = useSettingsStore((s) => s.openSettingsPanel)
  const closeSettings = useSettingsStore((s) => s.closeSettingsPanel)
  const loadSettings = useSettingsStore((s) => s.loadFromDb)
  const autoFixOllamaModel = useSettingsStore((s) => s.autoFixOllamaModel)
  const createConversation = useConversationStore((s) => s.createConversation)
  const loadConversations = useConversationStore((s) => s.loadFromDb)
  const loadCost = useCostStore((s) => s.loadFromDb)
  const loadPlugins = usePluginStore((s) => s.loadPlugins)

  const [logOpen, setLogOpen] = useState(false)
  const [historyOpen, setHistoryOpen] = useState(false)
  const [memoryOpen, setMemoryOpen] = useState(false)
  const [showDigest, setShowDigest] = useState(false)

  // ── DB bootstrap + service polling ───────────────────────────
  useEffect(() => {
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

      // Check weekly digest (Monday only)
      const lastDigest = localStorage.getItem('arc-last-digest')
      const digestResult = await window.electron.sessionShouldShowDigest?.(lastDigest)
      if (digestResult?.show) {
        setShowDigest(true)
        localStorage.setItem('arc-last-digest', new Date().toISOString().slice(0, 10))
      }
    }
    init().catch((err) => {
      window.electron.logAppend?.('error', 'Bootstrap failed', String(err))
    })

    const interval = setInterval(checkAllServices, 30_000)
    return () => clearInterval(interval)
  // Stable store-action refs — safe to omit from deps
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  // ── Global renderer error capture → log pipe ─────────────────
  useEffect(() => {
    const onError = (e: ErrorEvent) => {
      window.electron.logAppend?.('error', e.message, e.error?.stack ?? e.filename)
    }
    const onUnhandled = (e: PromiseRejectionEvent) => {
      const detail = e.reason instanceof Error ? e.reason.stack : String(e.reason)
      window.electron.logAppend?.('error', 'Unhandled promise rejection', detail)
    }
    window.addEventListener('error', onError)
    window.addEventListener('unhandledrejection', onUnhandled)
    return () => {
      window.removeEventListener('error', onError)
      window.removeEventListener('unhandledrejection', onUnhandled)
    }
  }, [])

  // ── Keyboard shortcuts ────────────────────────────────────────
  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      const meta = e.metaKey || e.ctrlKey
      if (meta && e.key === 'k') { e.preventDefault(); createConversation(); return }
      if (meta && e.key === ',') { e.preventDefault(); settingsPanelOpen ? closeSettings() : openSettings(); return }
      if (meta && e.shiftKey && e.key === 'L') { e.preventDefault(); setLogOpen((v) => !v); return }
      if (meta && e.shiftKey && e.key === 'H') { e.preventDefault(); setHistoryOpen((v) => !v); return }
      if (meta && e.shiftKey && e.key === 'M') { e.preventDefault(); setMemoryOpen((v) => !v); return }
      if (e.key === 'Escape') {
        if (memoryOpen) { setMemoryOpen(false); return }
        if (logOpen) { setLogOpen(false); return }
        if (historyOpen) { setHistoryOpen(false); return }
        if (settingsPanelOpen) { closeSettings(); return }
      }
    }
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [settingsPanelOpen, logOpen, historyOpen, memoryOpen, openSettings, closeSettings, createConversation])

  // ── Native menu event listeners ───────────────────────────────
  useEffect(() => {
    const cleanups: Array<() => void> = []
    if (window.electron.onMenuEvent) {
      cleanups.push(window.electron.onMenuEvent('menu:new-chat', () => createConversation()))
      cleanups.push(window.electron.onMenuEvent('menu:open-settings', () => openSettings()))
      cleanups.push(window.electron.onMenuEvent('menu:open-log', () => setLogOpen(true)))
      cleanups.push(window.electron.onMenuEvent('menu:open-history', () => setHistoryOpen(true)))
    }
    return () => cleanups.forEach((fn) => fn())
  // Stable refs — safe to omit
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  return (
    <div className="flex h-screen overflow-hidden bg-background text-text">
      <aside className="w-[280px] min-w-[280px] flex flex-col border-r border-border bg-surface overflow-hidden">
        <Sidebar onOpenHistory={() => setHistoryOpen(true)} onOpenMemory={() => setMemoryOpen(true)} />
      </aside>
      <div className="flex flex-col flex-1 overflow-hidden">
        <TopBar />
        <main className="flex-1 overflow-hidden">
          <ChatArea />
        </main>
      </div>

      {/* Modals */}
      {settingsPanelOpen && <SettingsPanel />}
      <ErrorLogPanel open={logOpen} onClose={() => setLogOpen(false)} />
      <SessionHistoryPanel open={historyOpen} onClose={() => setHistoryOpen(false)} />
      <MemoryPanel open={memoryOpen} onClose={() => setMemoryOpen(false)} />
      {showDigest && <WeeklyDigest onDismiss={() => setShowDigest(false)} />}
    </div>
  )
}
