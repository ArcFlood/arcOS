import { useState, useRef, useEffect } from 'react'
import { usePluginStore } from '../../stores/pluginStore'
import { Plugin } from '../../stores/types'

const TIER_LABEL: Record<Plugin['tier'], string> = {
  ollama: 'Local',
  haiku: 'Haiku',
  'arc-sonnet': 'A.R.C.',
  'arc-opus': 'Opus',
}

const TIER_COLOR: Record<Plugin['tier'], string> = {
  ollama: 'text-success',
  haiku: 'text-haiku-accent',
  'arc-sonnet': 'text-arc-accent',
  'arc-opus': 'text-pink-400',
}

export default function PluginPicker() {
  const [open, setOpen] = useState(false)
  const [installError, setInstallError] = useState<string | null>(null)
  const dropdownRef = useRef<HTMLDivElement>(null)

  const plugins = usePluginStore((s) => s.plugins)
  const activePlugin = usePluginStore((s) => s.activePlugin)
  const activatePlugin = usePluginStore((s) => s.activatePlugin)
  const deactivatePlugin = usePluginStore((s) => s.deactivatePlugin)
  const installFromFile = usePluginStore((s) => s.installFromFile)
  const openPluginsDir = usePluginStore((s) => s.openPluginsDir)

  // Close on outside click
  useEffect(() => {
    if (!open) return
    const handler = (e: MouseEvent) => {
      if (!dropdownRef.current?.contains(e.target as Node)) setOpen(false)
    }
    document.addEventListener('mousedown', handler)
    return () => document.removeEventListener('mousedown', handler)
  }, [open])

  const handleTogglePlugin = (id: string) => {
    if (activePlugin?.id === id) {
      deactivatePlugin()
    } else {
      activatePlugin(id)
    }
    setOpen(false)
  }

  const handleInstall = async () => {
    setInstallError(null)
    const res = await installFromFile()
    if (!res.success && res.error) {
      setInstallError(res.error)
    }
  }

  const hasActive = activePlugin !== null

  return (
    <div className="relative" ref={dropdownRef}>
      {/* Trigger button */}
      <button
        onClick={() => setOpen((v) => !v)}
        className={`flex items-center gap-1.5 px-2.5 py-1 rounded-lg text-xs font-medium transition-colors border ${
          hasActive
            ? 'bg-accent/15 border-accent/40 text-accent hover:bg-accent/25'
            : 'bg-surface-elevated border-border text-text-muted hover:text-text hover:border-border-hover'
        }`}
        title={hasActive ? `Plugin: ${activePlugin!.name}` : 'Plugins'}
      >
        <span>{hasActive ? activePlugin!.icon : '🔌'}</span>
        <span className="max-w-[90px] truncate">
          {hasActive ? activePlugin!.name : 'Plugins'}
        </span>
        {hasActive && (
          <span
            className="text-text-muted hover:text-danger ml-0.5"
            onClick={(e) => { e.stopPropagation(); deactivatePlugin() }}
            title="Deactivate plugin"
          >
            ✕
          </span>
        )}
        {!hasActive && <span className="opacity-50">▾</span>}
      </button>

      {/* Dropdown */}
      {open && (
        <div className="absolute right-0 top-full mt-1.5 w-72 bg-surface border border-border rounded-xl shadow-xl z-50 overflow-hidden">
          {/* Header */}
          <div className="flex items-center justify-between px-3 py-2 border-b border-border">
            <span className="text-xs font-semibold text-text-muted uppercase tracking-wide">Plugins</span>
            <div className="flex items-center gap-2">
              <button
                onClick={openPluginsDir}
                className="text-xs text-text-muted hover:text-text transition-colors"
                title="Open plugins folder"
              >
                📁
              </button>
              <button
                onClick={handleInstall}
                className="text-xs text-text-muted hover:text-accent transition-colors"
                title="Install plugin from .json file"
              >
                + Install
              </button>
            </div>
          </div>

          {/* Error */}
          {installError && (
            <div className="px-3 py-2 bg-danger/10 border-b border-danger/20 text-xs text-danger">
              {installError}
            </div>
          )}

          {/* Plugin list */}
          <div className="max-h-72 overflow-y-auto">
            {plugins.length === 0 ? (
              <div className="px-3 py-4 text-xs text-text-muted text-center">
                No plugins installed
              </div>
            ) : (
              plugins.map((plugin) => {
                const isActive = activePlugin?.id === plugin.id
                return (
                  <button
                    key={plugin.id}
                    onClick={() => handleTogglePlugin(plugin.id)}
                    className={`w-full flex items-start gap-2.5 px-3 py-2.5 text-left transition-colors hover:bg-surface-elevated ${
                      isActive ? 'bg-accent/10' : ''
                    }`}
                  >
                    {/* Icon */}
                    <span className="text-base mt-0.5 flex-shrink-0">{plugin.icon}</span>

                    {/* Info */}
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2">
                        <span className={`text-xs font-medium ${isActive ? 'text-accent' : 'text-text'}`}>
                          {plugin.name}
                        </span>
                        <span className={`text-[10px] font-medium ${TIER_COLOR[plugin.tier]}`}>
                          {TIER_LABEL[plugin.tier]}
                        </span>
                        {isActive && (
                          <span className="text-[10px] bg-accent/20 text-accent px-1 rounded">active</span>
                        )}
                      </div>
                      <div className="text-[11px] text-text-muted truncate mt-0.5">
                        {plugin.description}
                      </div>
                      {plugin.commands.length > 0 && (
                        <div className="flex gap-1 mt-1 flex-wrap">
                          {plugin.commands.map((cmd) => (
                            <span
                              key={cmd}
                              className="text-[10px] font-mono bg-surface-elevated border border-border rounded px-1 text-text-muted"
                            >
                              {cmd}
                            </span>
                          ))}
                        </div>
                      )}
                    </div>
                  </button>
                )
              })
            )}
          </div>

          {/* Footer hint */}
          <div className="px-3 py-2 border-t border-border text-[10px] text-text-muted">
            Type a slash command (e.g. <span className="font-mono">/review</span>) to auto-activate its plugin.
          </div>
        </div>
      )}
    </div>
  )
}
