import { useEffect, useState } from 'react'
import SettingsPanel from './settings/SettingsPanel'
import ErrorLogPanel from './debug/ErrorLogPanel'
import SessionHistoryPanel from './history/SessionHistoryPanel'
import WeeklyDigest from './history/WeeklyDigest'
import MemoryPanel from './memory/MemoryPanel'
import BugReportDialog from './debug/BugReportDialog'
import WorkspaceShell from './workspace/WorkspaceShell'
import WorkspaceTopBar from './workspace/WorkspaceTopBar'
import StartupSequence from './StartupSequence'
import { useSettingsStore } from '../stores/settingsStore'
import { useConversationStore } from '../stores/conversationStore'
import { useWorkspaceStore } from '../stores/workspaceStore'
import { useTraceStore } from '../stores/traceStore'
import { WorkspacePanelId } from '../workspace/types'
import useAppBootstrap from '../hooks/useAppBootstrap'

const ARCOS_TOTAL_APP_SECONDS_KEY = 'arcos-total-app-seconds'

function matchesModuleShortcut(event: KeyboardEvent, shortcutId?: string): boolean {
  if (!shortcutId || shortcutId === 'none') return false
  const parts = shortcutId.split('+')
  const key = parts[parts.length - 1]
  if (!key) return false
  const wantsMod = parts.includes('mod')
  const wantsAlt = parts.includes('alt')
  const wantsShift = parts.includes('shift')
  return (
    (wantsMod ? event.metaKey || event.ctrlKey : !event.metaKey && !event.ctrlKey) &&
    event.altKey === wantsAlt &&
    event.shiftKey === wantsShift &&
    event.key.toLowerCase() === key
  )
}

function isEditableTarget(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false
  const tag = target.tagName.toLowerCase()
  return tag === 'input' || tag === 'textarea' || tag === 'select' || target.isContentEditable || Boolean(target.closest('[data-keyboard-menu="true"]'))
}

function getKeyboardFocusableElements(): HTMLElement[] {
  return Array.from(document.querySelectorAll<HTMLElement>(
    'button:not(:disabled), [role="button"]:not([aria-disabled="true"]), a[href], input:not(:disabled), textarea:not(:disabled), [tabindex]:not([tabindex="-1"])'
  )).filter((element) => {
    const rect = element.getBoundingClientRect()
    return (
      rect.width > 0 &&
      rect.height > 0 &&
      window.getComputedStyle(element).visibility !== 'hidden' &&
      !element.closest('[data-keyboard-menu="true"]')
    )
  })
}

function focusNearestElement(direction: 'up' | 'down' | 'left' | 'right'): boolean {
  const current = document.activeElement instanceof HTMLElement ? document.activeElement : null
  const focusable = getKeyboardFocusableElements()
  if (focusable.length === 0) return false
  if (!current || !focusable.includes(current)) {
    focusable[0]?.focus()
    return true
  }

  const currentRect = current.getBoundingClientRect()
  const currentX = currentRect.left + currentRect.width / 2
  const currentY = currentRect.top + currentRect.height / 2
  const candidates = focusable
    .filter((element) => element !== current)
    .map((element) => {
      const rect = element.getBoundingClientRect()
      const x = rect.left + rect.width / 2
      const y = rect.top + rect.height / 2
      const dx = x - currentX
      const dy = y - currentY
      const inDirection =
        direction === 'right' ? dx > 4 :
        direction === 'left' ? dx < -4 :
        direction === 'down' ? dy > 4 :
        dy < -4
      if (!inDirection) return null
      const primary = direction === 'left' || direction === 'right' ? Math.abs(dx) : Math.abs(dy)
      const secondary = direction === 'left' || direction === 'right' ? Math.abs(dy) : Math.abs(dx)
      return { element, score: primary * 2 + secondary }
    })
    .filter((entry): entry is { element: HTMLElement; score: number } => Boolean(entry))
    .sort((a, b) => a.score - b.score)

  const next = candidates[0]?.element
  if (!next) return false
  next.focus()
  return true
}

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
  const detachedModules = useWorkspaceStore((s) => s.layout.modules.filter((module) => module.detached).map((module) => ({
    moduleId: module.id,
    panelId: module.panelId,
    title: module.title,
  })))
  const createTerminalInFirstAvailableSlot = useWorkspaceStore((s) => s.createTerminalInFirstAvailableSlot)
  const layout = useWorkspaceStore((s) => s.layout)
  const showPanel = useWorkspaceStore((s) => s.showPanel)
  const hidePanel = useWorkspaceStore((s) => s.hidePanel)
  const handleDetachedWindowClosed = useWorkspaceStore((s) => s.handleDetachedWindowClosed)
  const appendTraceEntry = useTraceStore((s) => s.appendEntry)
  const moduleShortcuts = useSettingsStore((s) => s.settings.moduleShortcuts)

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
    void window.electron.workspaceSyncDetachedPanels?.(detachedModules)
  }, [detachedModules])

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
      for (const [panelId, shortcutId] of Object.entries(moduleShortcuts) as Array<[WorkspacePanelId, string]>) {
        if (panelId === 'chat') continue
        if (matchesModuleShortcut(e, shortcutId)) {
          e.preventDefault()
          const isOpen = layout.modules.some((module) => module.panelId === panelId)
          if (isOpen) hidePanel(panelId)
          else showPanel(panelId)
          return
        }
      }

      if (meta && e.key.toLowerCase() === 'k') { e.preventDefault(); createConversation(); return }
      if (meta && e.key.toLowerCase() === 't') {
        e.preventDefault()
        const result = createTerminalInFirstAvailableSlot()
        if (!result.success) {
          window.alert('No 1x2 space is available. Make a 1x2 opening in the grid, then try again.')
        }
        return
      }
      if (meta && e.key === ',') { e.preventDefault(); settingsPanelOpen ? closeSettings() : openSettings(); return }
      if (meta && e.shiftKey && e.key.toLowerCase() === 'l') { e.preventDefault(); setLogOpen((v) => !v); return }
      if (meta && e.shiftKey && e.key.toLowerCase() === 'h') { e.preventDefault(); setHistoryOpen((v) => !v); return }
      if (meta && e.shiftKey && e.key.toLowerCase() === 'm') { e.preventDefault(); setMemoryOpen((v) => !v); return }
      if (e.key === 'Escape') {
        if (memoryOpen) { setMemoryOpen(false); return }
        if (logOpen) { setLogOpen(false); return }
        if (historyOpen) { setHistoryOpen(false); return }
        if (settingsPanelOpen) { closeSettings(); return }
      }
    }
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [settingsPanelOpen, logOpen, historyOpen, memoryOpen, openSettings, closeSettings, createConversation, createTerminalInFirstAvailableSlot, moduleShortcuts, layout.modules, showPanel, hidePanel])

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (!['ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight'].includes(event.key)) return
      if (isEditableTarget(event.target)) return
      const direction =
        event.key === 'ArrowUp' ? 'up' :
        event.key === 'ArrowDown' ? 'down' :
        event.key === 'ArrowLeft' ? 'left' :
        'right'
      if (focusNearestElement(direction)) event.preventDefault()
    }
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [])

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

  useEffect(() => {
    const cleanup = window.electron.onPermissionEvent?.((payload) => {
      appendTraceEntry({
        source: 'system',
        level: payload.outcome === 'approved' ? 'success' : 'warn',
        title: payload.outcome === 'approved' ? 'Permission approved' : 'Permission blocked',
        detail: `${payload.action}. ${payload.reason}${payload.targetPath ? ` Target: ${payload.targetPath}` : ''}`,
        stage: 'permission enforcement',
        executionState: payload.outcome === 'approved' ? 'service_action' : 'failed',
        failureType: payload.outcome === 'approved' ? undefined : 'permission',
        relatedPanels: ['transparency'],
        entityLabel: payload.activePolicy,
      })
    })
    return () => cleanup?.()
  }, [appendTraceEntry])

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
      <StartupSequence />
    </div>
  )
}
