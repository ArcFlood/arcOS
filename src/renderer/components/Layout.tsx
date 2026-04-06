import { useEffect, useState } from 'react'
import SettingsPanel from './settings/SettingsPanel'
import ErrorLogPanel from './debug/ErrorLogPanel'
import SessionHistoryPanel from './history/SessionHistoryPanel'
import WeeklyDigest from './history/WeeklyDigest'
import MemoryPanel from './memory/MemoryPanel'
import BugReportDialog from './debug/BugReportDialog'
import WorkspaceShell from './workspace/WorkspaceShell'
import WorkspaceTopBar from './workspace/WorkspaceTopBar'
import { useSettingsStore } from '../stores/settingsStore'
import { useConversationStore } from '../stores/conversationStore'
import { useWorkspaceStore } from '../stores/workspaceStore'
import useAppBootstrap from '../hooks/useAppBootstrap'

const ARCOS_TOTAL_APP_SECONDS_KEY = 'arcos-total-app-seconds'

function addAppTime(seconds: number) {
  const current = Number.parseInt(localStorage.getItem(ARCOS_TOTAL_APP_SECONDS_KEY) ?? '0', 10)
  const next = Number.isFinite(current) ? current + seconds : seconds
  localStorage.setItem(ARCOS_TOTAL_APP_SECONDS_KEY, String(next))
}

export default function Layout() {
  const settingsPanelOpen = useSettingsStore((s) => s.settingsPanelOpen)
  const openSettings = useSettingsStore((s) => s.openSettingsPanel)
  const closeSettings = useSettingsStore((s) => s.closeSettingsPanel)
  const createConversation = useConversationStore((s) => s.createConversation)
  const hydrateWorkspace = useWorkspaceStore((s) => s.hydrate)
  const detachedPanels = useWorkspaceStore((s) => s.layout.detachedPanels)
  const handleDetachedWindowClosed = useWorkspaceStore((s) => s.handleDetachedWindowClosed)

  const [logOpen, setLogOpen] = useState(false)
  const [historyOpen, setHistoryOpen] = useState(false)
  const [memoryOpen, setMemoryOpen] = useState(false)
  const [showDigest, setShowDigest] = useState(false)
  const [bugReportOpen, setBugReportOpen] = useState(false)

  useAppBootstrap()

  useEffect(() => {
    const startedAt = Date.now()
    const interval = window.setInterval(() => {
      addAppTime(30)
    }, 30_000)

    return () => {
      window.clearInterval(interval)
      const elapsedSeconds = Math.max(0, Math.round((Date.now() - startedAt) / 1000))
      addAppTime(elapsedSeconds % 30)
    }
  }, [])

  // ── Weekly digest gate ───────────────────────────────────────
  useEffect(() => {
    const loadDigest = async () => {
      const lastDigest = localStorage.getItem('arc-last-digest')
      const digestResult = await window.electron.sessionShouldShowDigest?.(lastDigest)
      if (digestResult?.show) {
        setShowDigest(true)
        localStorage.setItem('arc-last-digest', new Date().toISOString().slice(0, 10))
      }
    }
    loadDigest().catch(() => {})
  }, [])

  useEffect(() => {
    void window.electron.workspaceSyncDetachedPanels?.(detachedPanels)
  }, [detachedPanels])

  useEffect(() => {
    const onStorage = (event: StorageEvent) => {
      if (event.key === 'arcos-workspace-v2') {
        hydrateWorkspace()
      }
    }
    window.addEventListener('storage', onStorage)
    return () => window.removeEventListener('storage', onStorage)
  }, [hydrateWorkspace])

  // ── Global renderer error capture → log pipe ─────────────────
  useEffect(() => {
    const onError = (e: ErrorEvent) => {
      window.electron.logAppend?.('error', e.message, e.error?.stack ?? e.filename)?.catch?.(() => {})
    }
    const onUnhandled = (e: PromiseRejectionEvent) => {
      // Guard: skip IPC-related rejections to prevent a cascade where a failed
      // logAppend call itself becomes an unhandled rejection that re-triggers this.
      const reason = String(e.reason)
      if (reason.includes('No handler registered') || reason.includes('log:append')) return
      const detail = e.reason instanceof Error ? e.reason.stack : reason
      window.electron.logAppend?.('error', 'Unhandled promise rejection', detail)?.catch?.(() => {})
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
      cleanups.push(window.electron.onMenuEvent('menu:open-bug-report', () => setBugReportOpen(true)))
    }
    return () => cleanups.forEach((fn) => fn())
  // Stable refs — safe to omit
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  useEffect(() => {
    const cleanup = window.electron.onWorkspaceEvent?.('workspace:detached-panel-closed', (payload) => {
      if (typeof payload === 'string') {
        handleDetachedWindowClosed(payload as never)
      }
    })
    return () => cleanup?.()
  }, [handleDetachedWindowClosed])

  return (
    <div className="flex h-screen overflow-hidden bg-background text-text">
      <div className="flex flex-col flex-1 overflow-hidden">
        <WorkspaceTopBar onOpenSettings={() => openSettings()} />
        <WorkspaceShell
          onOpenHistory={() => setHistoryOpen(true)}
          onOpenMemory={() => setMemoryOpen(true)}
          onOpenLog={() => setLogOpen(true)}
          onOpenSettings={() => openSettings()}
        />
      </div>

      {/* Modals */}
      {settingsPanelOpen && <SettingsPanel />}
      <ErrorLogPanel open={logOpen} onClose={() => setLogOpen(false)} onOpenBugReport={() => { setLogOpen(false); setBugReportOpen(true) }} />
      <SessionHistoryPanel open={historyOpen} onClose={() => setHistoryOpen(false)} />
      <MemoryPanel open={memoryOpen} onClose={() => setMemoryOpen(false)} />
      {showDigest && <WeeklyDigest onDismiss={() => setShowDigest(false)} />}
      <BugReportDialog open={bugReportOpen} onClose={() => setBugReportOpen(false)} />
    </div>
  )
}
