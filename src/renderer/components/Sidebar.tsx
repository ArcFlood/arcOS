import { useSettingsStore } from '../stores/settingsStore'
import ConversationList from './conversations/ConversationList'
import { useWorkspaceStore } from '../stores/workspaceStore'

interface SidebarProps {
  onOpenHistory?: () => void
  onOpenMemory?: () => void
}

export default function Sidebar({ onOpenHistory, onOpenMemory }: SidebarProps) {
  const openSettings = useSettingsStore((s) => s.openSettingsPanel)
  const showPanel = useWorkspaceStore((s) => s.showPanel)

  return (
    <div className="flex flex-col h-full bg-transparent">
      {/* Titlebar drag region */}
      <div className="titlebar-drag arcos-panel-head h-10 min-h-10 flex items-center px-4 border-b border-border">
        <div className="titlebar-no-drag select-none">
          <p className="arcos-kicker">Navigator</p>
          <span className="text-xs text-text-muted font-medium">Threads, runtime cues, and workspace entry points</span>
        </div>
      </div>

      {/* Conversations (fills remaining space) */}
      <div className="flex-1 overflow-hidden">
        <ConversationList />
      </div>

      {/* Bottom buttons */}
      <div className="border-t border-border p-3 space-y-1.5">
        <button
          onClick={() => showPanel('memory')}
          className="arcos-action flex items-center gap-2 w-full rounded-md px-3 py-2 text-sm transition-colors"
        >
          <span>🧠</span>
          <span>Memory</span>
        </button>
        <button
          onClick={() => showPanel('history')}
          className="arcos-action flex items-center gap-2 w-full rounded-md px-3 py-2 text-sm transition-colors"
        >
          <span>🕘</span>
          <span>History</span>
        </button>
        <button
          onClick={() => showPanel('services')}
          className="arcos-action flex items-center gap-2 w-full rounded-md px-3 py-2 text-sm transition-colors"
        >
          <span>🧩</span>
          <span>Services</span>
        </button>
        {(onOpenMemory || onOpenHistory) && (
          <button
            onClick={() => showPanel('utilities')}
            className="arcos-action flex items-center gap-2 w-full rounded-md px-3 py-2 text-sm transition-colors"
          >
            <span>⌘</span>
            <span>Workspace Actions</span>
          </button>
        )}
        <button
          onClick={openSettings}
          className="arcos-action flex items-center gap-2 w-full rounded-md px-3 py-2 text-sm transition-colors"
        >
          <span>⚙️</span>
          <span>Settings</span>
        </button>
      </div>
    </div>
  )
}
