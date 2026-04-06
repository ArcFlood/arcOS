import { useEffect, useMemo, useState } from 'react'
import { usePluginStore } from '../../stores/pluginStore'
import { useToolExecutionStore } from '../../stores/toolExecutionStore'
import { patternDescription, patternEmoji, patternLabel } from '../../services/fabricService'
import { useConversationStore } from '../../stores/conversationStore'
import { useServiceStore } from '../../stores/serviceStore'

export default function ToolsPanel() {
  const plugins = usePluginStore((s) => s.plugins)
  const activePlugin = usePluginStore((s) => s.activePlugin)
  const activatePlugin = usePluginStore((s) => s.activatePlugin)
  const deactivatePlugin = usePluginStore((s) => s.deactivatePlugin)
  const openPluginsDir = usePluginStore((s) => s.openPluginsDir)

  const patterns = useToolExecutionStore((s) => s.patterns)
  const loadingPatterns = useToolExecutionStore((s) => s.loadingPatterns)
  const loadPatterns = useToolExecutionStore((s) => s.loadPatterns)
  const runPattern = useToolExecutionStore((s) => s.runPattern)
  const abortRun = useToolExecutionStore((s) => s.abortRun)

  const activeConversation = useConversationStore((s) => s.activeConversation())
  const fabricRunning = useServiceStore((s) => s.getService('fabric')?.running ?? false)

  const [selectedPattern, setSelectedPattern] = useState<string | null>(null)
  const [selectedPluginId, setSelectedPluginId] = useState<string>('')
  const [search, setSearch] = useState('')
  const [input, setInput] = useState('')

  useEffect(() => {
    loadPatterns().catch(() => {})
  }, [loadPatterns])

  useEffect(() => {
    if (!selectedPattern && patterns.length > 0) {
      setSelectedPattern(patterns[0])
    }
  }, [patterns, selectedPattern])

  useEffect(() => {
    if (!selectedPluginId && plugins.length > 0) {
      setSelectedPluginId(plugins[0].id)
    }
    if (selectedPluginId && !plugins.some((plugin) => plugin.id === selectedPluginId)) {
      setSelectedPluginId(plugins[0]?.id ?? '')
    }
  }, [plugins, selectedPluginId])

  const filteredPatterns = useMemo(() => {
    const q = search.trim().toLowerCase()
    if (!q) return patterns
    return patterns.filter((pattern) => (
      pattern.toLowerCase().includes(q) || patternDescription(pattern).toLowerCase().includes(q)
    ))
  }, [patterns, search])

  const runningRun = useToolExecutionStore((s) => s.runs.find((run) => run.status === 'running'))
  const selectedPlugin = plugins.find((plugin) => plugin.id === selectedPluginId) ?? null

  const handleRun = () => {
    if (!selectedPattern || !input.trim()) return
    runPattern(selectedPattern, input, activeConversation?.id)
  }

  return (
    <div className="space-y-4 p-4">
      <div>
        <p className="text-sm font-semibold text-text">PAI Tools</p>
        <p className="mt-1 text-xs text-text-muted">
          Run Fabric patterns and manage plugin extensions from one control surface.
        </p>
      </div>

      <section className="arcos-subpanel rounded-xl p-3">
        <div className="flex items-center justify-between gap-3">
          <div>
            <p className="arcos-kicker mb-1">Fabric Patterns</p>
            <p className="text-sm font-semibold text-text">Pattern execution surface</p>
            <p className="mt-1 text-xs text-text-muted">
              Select a pattern, provide input, then run it here. Use Conversation Context when you want Fabric to analyze or transform the active thread instead of standalone pasted text. The left column is pattern selection; the right side is the currently loaded pattern you are about to run.
            </p>
          </div>
          <div className="flex items-center gap-2">
            <span className={`rounded-full px-2 py-1 text-[10px] uppercase tracking-wider ${
              fabricRunning ? 'bg-success/10 text-success' : 'bg-danger/10 text-danger'
            }`}>
              {fabricRunning ? 'Fabric Online' : 'Fabric Offline'}
            </span>
            <button onClick={() => loadPatterns()} className="arcos-action rounded px-2 py-1 text-[10px] uppercase tracking-wider">
              Refresh
            </button>
          </div>
        </div>

        <div className="mt-3 grid gap-3 lg:grid-cols-[0.95fr_1.25fr]">
          <div className="space-y-2">
            <input
              value={search}
              onChange={(event) => setSearch(event.target.value)}
              placeholder="Search patterns..."
              className="arcos-input w-full rounded-md px-3 py-2 text-sm"
            />
            <div className="max-h-[280px] space-y-2 overflow-y-auto pr-1">
              {loadingPatterns ? (
                <div className="rounded-lg border border-border bg-[#12161b] px-3 py-5 text-xs text-text-muted">
                  Loading Fabric patterns...
                </div>
              ) : (
                filteredPatterns.map((pattern) => (
                  <button
                    key={pattern}
                    onClick={() => setSelectedPattern(pattern)}
                    className={`w-full rounded-lg border px-3 py-3 text-left transition-colors ${
                      selectedPattern === pattern
                        ? 'border-success/60 bg-[#1b2027]'
                        : 'border-border bg-[#12161b] hover:border-[#93a5b8]/30 hover:bg-[#171c22]'
                    }`}
                  >
                    <div className="flex items-start gap-2">
                      <span className="text-base">{patternEmoji(pattern)}</span>
                      <div className="min-w-0">
                        <p className="break-words text-sm font-medium text-text">{patternLabel(pattern)}</p>
                        <p className="mt-1 break-words text-xs leading-5 text-text-muted">{patternDescription(pattern)}</p>
                      </div>
                    </div>
                  </button>
                ))
              )}
            </div>
          </div>

          <div className="space-y-3">
            <div className="rounded-lg border border-success/60 bg-[#12161b] px-3 py-3">
              <p className="break-words text-sm font-medium text-text">
                {selectedPattern ? `${patternEmoji(selectedPattern)} ${patternLabel(selectedPattern)}` : 'Select a pattern'}
              </p>
              <p className="mt-1 break-words text-xs leading-5 text-text-muted">
                {selectedPattern ? patternDescription(selectedPattern) : 'Choose a Fabric pattern to begin.'}
              </p>
              <p className="mt-2 break-words text-[11px] text-text-muted">
                {activeConversation ? `Active thread: ${activeConversation.title}` : 'No active thread. Runs will still be tracked in Tools.'}
              </p>
            </div>

            <textarea
              value={input}
              onChange={(event) => setInput(event.target.value)}
              placeholder="Paste or type content for the selected pattern..."
              rows={7}
              className="arcos-input min-h-[180px] w-full rounded-md px-3 py-3 text-sm"
            />

            <div className="flex flex-wrap gap-2">
              <button
                onClick={handleRun}
                disabled={!selectedPattern || !input.trim() || !fabricRunning || Boolean(runningRun)}
                className="arcos-action-primary rounded px-3 py-2 text-xs font-semibold uppercase tracking-wider disabled:opacity-40"
              >
                {runningRun ? 'Pattern Running' : 'Run Pattern'}
              </button>
              {runningRun && (
                <button
                  onClick={() => abortRun(runningRun.id)}
                  className="arcos-action rounded px-3 py-2 text-xs font-semibold uppercase tracking-wider"
                >
                  Stop Run
                </button>
              )}
              <button
                onClick={() => activeConversation && setInput(activeConversation.messages.slice(-6).map((message) => `${message.role}: ${message.content}`).join('\n\n'))}
                disabled={!activeConversation}
                className="arcos-action rounded px-3 py-2 text-xs font-semibold uppercase tracking-wider disabled:opacity-40"
              >
                Use Conversation Context
              </button>
            </div>
          </div>
        </div>
      </section>

      <section className="arcos-subpanel rounded-xl p-3">
        <div className="flex items-center justify-between gap-3">
          <div>
            <p className="arcos-kicker mb-1">Plugins</p>
            <p className="text-sm font-semibold text-text">Extension contracts and prompt overrides</p>
            <p className="mt-1 text-xs text-text-muted">
              Plugins are automatically discovered by ARCOS and stay available between launches. Use the dropdown to inspect one plugin at a time, then activate it when you want its commands, prompt override, or stage behavior to participate in the chain.
            </p>
          </div>
          <div className="flex items-center">
            <button onClick={openPluginsDir} className="arcos-action rounded px-2 py-1 text-[10px] uppercase tracking-wider">
              Open Folder
            </button>
          </div>
        </div>

        <div className="mt-3 space-y-3">
          {plugins.length === 0 ? (
            <div className="rounded-lg border border-border bg-[#12161b] px-3 py-5 text-xs text-text-muted">
              No plugins installed yet.
            </div>
          ) : (
            <>
              <select
                value={selectedPluginId}
                onChange={(event) => setSelectedPluginId(event.target.value)}
                className="arcos-input w-full rounded-md px-3 py-2 text-sm"
              >
                {plugins.map((plugin) => (
                  <option key={plugin.id} value={plugin.id}>
                    {plugin.name}
                  </option>
                ))}
              </select>

              {selectedPlugin && (
                <div className="rounded-lg border border-border bg-[#12161b] px-3 py-3">
                  <div className="flex items-start gap-3">
                    <span className="text-lg">{selectedPlugin.icon}</span>
                    <div className="min-w-0 flex-1">
                      <div className="flex flex-wrap items-center gap-2">
                        <p className="break-words text-sm font-medium text-text">{selectedPlugin.name}</p>
                        {activePlugin?.id === selectedPlugin.id && (
                          <span className="rounded-full bg-success/10 px-2 py-0.5 text-[10px] uppercase tracking-wider text-success">
                            Active
                          </span>
                        )}
                        <span className="rounded-full border border-border px-2 py-0.5 text-[10px] uppercase tracking-wider text-text-muted">
                          {selectedPlugin.architectureRole}
                        </span>
                        <span className="rounded-full border border-border px-2 py-0.5 text-[10px] uppercase tracking-wider text-text-muted">
                          {selectedPlugin.executionBoundary}
                        </span>
                      </div>
                      <p className="mt-1 break-words text-xs leading-5 text-text-muted">{selectedPlugin.description}</p>
                      <div className="mt-2 flex flex-wrap gap-1">
                        {selectedPlugin.commands.map((command) => (
                          <span key={command} className="rounded border border-border px-1.5 py-0.5 text-[10px] text-text-muted">
                            {command}
                          </span>
                        ))}
                      </div>
                      <div className="mt-2 flex flex-wrap gap-1">
                        {selectedPlugin.targetStages.map((stage) => (
                          <span key={`${selectedPlugin.id}-${stage}`} className="rounded border border-border px-1.5 py-0.5 text-[10px] text-text-muted">
                            {stage}
                          </span>
                        ))}
                      </div>
                      <p className="mt-2 break-words text-[11px] leading-5 text-text-muted">
                        Entry surfaces: {selectedPlugin.entrySurfaces.join(', ')}. Stability: {selectedPlugin.stability}.
                      </p>
                      <div className="mt-3">
                        {activePlugin?.id === selectedPlugin.id ? (
                          <button
                            onClick={() => deactivatePlugin()}
                            className="arcos-action rounded px-3 py-2 text-xs font-semibold uppercase tracking-wider"
                          >
                            Deactivate Plugin
                          </button>
                        ) : (
                          <button
                            onClick={() => activatePlugin(selectedPlugin.id)}
                            className="arcos-action-primary rounded px-3 py-2 text-xs font-semibold uppercase tracking-wider"
                          >
                            Activate Plugin
                          </button>
                        )}
                      </div>
                    </div>
                  </div>
                </div>
              )}
            </>
          )}
        </div>
      </section>
    </div>
  )
}
