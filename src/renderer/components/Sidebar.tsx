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
    <div className="flex flex-col h-full bg-transparent">
      {/* Titlebar drag region */}
      <div className="titlebar-drag arcos-panel-head h-10 min-h-10 flex items-center px-4 border-b border-border">
        <div className="titlebar-no-drag select-none">
          <p className="arcos-kicker">Navigator</p>
          <span className="text-xs text-text-muted font-medium">Threads, runtime cues, and workspace entry points</span>
        </div>
      </div>

      {/* Services section */}
      <div className="px-3 pb-3 pt-3">
        <button
          onClick={() => setServicesExpanded((v) => !v)}
          className="arcos-action flex items-center justify-between w-full rounded-md px-2 py-1.5 text-[11px] uppercase tracking-wider transition-colors"
        >
          <span className="font-semibold">Services</span>
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

      <div className="border-t border-border mx-3 my-1 opacity-60" />

      {/* Conversations (fills remaining space) */}
      <div className="flex-1 overflow-hidden">
        <ConversationList />
      </div>

      {/* Bottom buttons */}
      <div className="border-t border-border p-3 space-y-1.5">
        {onOpenMemory && (
          <button
            onClick={onOpenMemory}
            className="arcos-action flex items-center gap-2 w-full rounded-md px-3 py-2 text-sm transition-colors"
          >
            <span>🧠</span>
            <span>Memory Search</span>
          </button>
        )}
        {onOpenHistory && (
          <button
            onClick={onOpenHistory}
            className="arcos-action flex items-center gap-2 w-full rounded-md px-3 py-2 text-sm transition-colors"
          >
            <span>📋</span>
            <span>Session History</span>
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
