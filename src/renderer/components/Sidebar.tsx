import { useState } from 'react'
import { useSettingsStore } from '../stores/settingsStore'
import ServiceCard from './services/ServiceCard'
import ConversationList from './conversations/ConversationList'
import { useServiceStore } from '../stores/serviceStore'

interface SidebarProps {
  onOpenHistory?: () => void
  onOpenMemory?: () => void
}

export default function Sidebar({ onOpenHistory, onOpenMemory }: SidebarProps) {
  const [servicesExpanded, setServicesExpanded] = useState(true)
  const openSettings = useSettingsStore((s) => s.openSettingsPanel)
  const services = useServiceStore((s) => s.services)

  return (
    <div className="flex flex-col h-full">
      {/* Titlebar drag region */}
      <div className="titlebar-drag h-8 min-h-8 flex items-center px-4">
        <span className="text-xs text-text-muted font-medium titlebar-no-drag select-none">
          A.R.C. Hub
        </span>
      </div>

      {/* Services section */}
      <div className="px-3 pb-2">
        <button
          onClick={() => setServicesExpanded((v) => !v)}
          className="flex items-center justify-between w-full px-2 py-1.5 rounded text-xs text-text-muted hover:text-text hover:bg-surface-elevated transition-colors"
        >
          <span className="font-semibold uppercase tracking-wider">Services</span>
          <span className="text-xs">{servicesExpanded ? '▾' : '▸'}</span>
        </button>
        {servicesExpanded && (
          <div className="mt-1 space-y-2">
            {services.map((svc) => (
              <ServiceCard key={svc.name} service={svc} />
            ))}
          </div>
        )}
      </div>

      <div className="border-t border-border mx-3 my-1" />

      {/* Conversations (fills remaining space) */}
      <div className="flex-1 overflow-hidden">
        <ConversationList />
      </div>

      {/* Bottom buttons */}
      <div className="border-t border-border p-3 space-y-1">
        {onOpenMemory && (
          <button
            onClick={onOpenMemory}
            className="flex items-center gap-2 w-full px-3 py-2 rounded-md text-sm text-text-muted hover:text-text hover:bg-surface-elevated transition-colors"
          >
            <span>🧠</span>
            <span>Memory Search</span>
          </button>
        )}
        {onOpenHistory && (
          <button
            onClick={onOpenHistory}
            className="flex items-center gap-2 w-full px-3 py-2 rounded-md text-sm text-text-muted hover:text-text hover:bg-surface-elevated transition-colors"
          >
            <span>📋</span>
            <span>Session History</span>
          </button>
        )}
        <button
          onClick={openSettings}
          className="flex items-center gap-2 w-full px-3 py-2 rounded-md text-sm text-text-muted hover:text-text hover:bg-surface-elevated transition-colors"
        >
          <span>⚙️</span>
          <span>Settings</span>
        </button>
      </div>
    </div>
  )
}
