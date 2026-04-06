import { useEffect, useMemo, useState } from 'react'
import { usePluginStore } from '../../stores/pluginStore'
import { useToolExecutionStore } from '../../stores/toolExecutionStore'
import { patternDescription, patternEmoji, patternLabel } from '../../services/fabricService'
import { useConversationStore } from '../../stores/conversationStore'
import { useWorkspaceStore } from '../../stores/workspaceStore'
import { useServiceStore } from '../../stores/serviceStore'

export default function ToolsPanel() {
  const plugins = usePluginStore((s) => s.plugins)
  const activePlugin = usePluginStore((s) => s.activePlugin)
  const activatePlugin = usePluginStore((s) => s.activatePlugin)
  const deactivatePlugin = usePluginStore((s) => s.deactivatePlugin)
  const installFromFile = usePluginStore((s) => s.installFromFile)
  const openPluginsDir = usePluginStore((s) => s.openPluginsDir)

  const patterns = useToolExecutionStore((s) => s.patterns)
  const loadingPatterns = useToolExecutionStore((s) => s.loadingPatterns)
  const runs = useToolExecutionStore((s) => s.runs)
  const loadPatterns = useToolExecutionStore((s) => s.loadPatterns)
  const runPattern = useToolExecutionStore((s) => s.runPattern)
  const abortRun = useToolExecutionStore((s) => s.abortRun)
  const clearRuns = useToolExecutionStore((s) => s.clearRuns)

  const activeConversation = useConversationStore((s) => s.activeConversation())
  const fabricRunning = useServiceStore((s) => s.getService('fabric')?.running ?? false)
  const showPanel = useWorkspaceStore((s) => s.showPanel)

  const [selectedPattern, setSelectedPattern] = useState<string | null>(null)
  const [search, setSearch] = useState('')
  const [input, setInput] = useState('')
  const [installError, setInstallError] = useState<string | null>(null)

  useEffect(() => {
    loadPatterns().catch(() => {})
  }, [loadPatterns])

  useEffect(() => {
    if (!selectedPattern && patterns.length > 0) {
      setSelectedPattern(patterns[0])
    }
  }, [patterns, selectedPattern])

  const filteredPatterns = useMemo(() => {
    const q = search.trim().toLowerCase()
    if (!q) return patterns
    return patterns.filter((pattern) => (
      pattern.toLowerCase().includes(q) || patternDescription(pattern).toLowerCase().includes(q)
    ))
  }, [patterns, search])

  const runningRun = runs.find((run) => run.status === 'running')

  const handleInstall = async () => {
    setInstallError(null)
    const result = await installFromFile()
    if (!result.success) {
      setInstallError(result.error ?? 'Plugin install failed')
    }
  }

  const handleRun = () => {
    if (!selectedPattern || !input.trim()) return
    runPattern(selectedPattern, input, activeConversation?.id)
  }

  return (
    <div className="space-y-4 p-4">
      <section className="arcos-subpanel rounded-xl p-3">
        <div className="flex items-start justify-between gap-3">
          <div>
            <p className="arcos-kicker mb-1">PAI Tools</p>
            <p className="text-sm font-semibold text-text">Fabric, plugins, and execution history</p>
            <p className="text-xs text-text-muted">
              Run Fabric patterns, manage plugin contracts, and inspect recent tool output without leaving ARCOS.
            </p>
          </div>
          <div className="flex flex-wrap gap-2">
            <button onClick={() => showPanel('prompt_inspector')} className="arcos-action rounded px-2 py-1 text-[10px] uppercase tracking-wider">
              Prompt
            </button>
            <button onClick={() => showPanel('runtime')} className="arcos-action rounded px-2 py-1 text-[10px] uppercase tracking-wider">
              Runtime
            </button>
            <button onClick={() => showPanel('execution')} className="arcos-action rounded px-2 py-1 text-[10px] uppercase tracking-wider">
              Trace
            </button>
          </div>
        </div>
      </section>

      <section className="grid gap-4 xl:grid-cols-[1.2fr_0.9fr]">
        <div className="space-y-4">
          <div className="arcos-subpanel rounded-xl p-3">
            <div className="flex items-center justify-between gap-3">
              <div>
                <p className="arcos-kicker mb-1">Fabric Patterns</p>
            <p className="text-sm font-semibold text-text">Pattern execution surface</p>
            <p className="mt-1 text-xs text-text-muted">Fabric is treated as a workflow stage in the PAI chain, not just a utility button.</p>
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
                            ? 'border-[#93a5b8]/40 bg-[#1b2027]'
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
                <div className="rounded-lg border border-border bg-[#12161b] px-3 py-3">
                  <p className="break-words text-sm font-medium text-text">
                    {selectedPattern ? `${patternEmoji(selectedPattern)} ${patternLabel(selectedPattern)}` : 'Select a pattern'}
                  </p>
                  <p className="mt-1 break-words text-xs leading-5 text-text-muted">
                    {selectedPattern ? patternDescription(selectedPattern) : 'Choose a Fabric pattern to begin.'}
                  </p>
                  <p className="mt-2 break-words text-[11px] text-text-muted">
                    {activeConversation ? `Active conversation: ${activeConversation.title}` : 'No active conversation. Runs will still be tracked in Tools.'}
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
          </div>

          <div className="arcos-subpanel rounded-xl p-3">
            <div className="flex items-center justify-between gap-3">
              <div>
                <p className="arcos-kicker mb-1">Recent Tool Runs</p>
                <p className="text-sm font-semibold text-text">Execution status and output</p>
              </div>
              <button onClick={clearRuns} className="arcos-action rounded px-2 py-1 text-[10px] uppercase tracking-wider">
                Clear
              </button>
            </div>
            <div className="mt-3 space-y-3">
              {runs.length === 0 ? (
                <div className="rounded-lg border border-border bg-[#12161b] px-3 py-5 text-xs text-text-muted">
                  No tool runs yet. Execute a Fabric pattern to populate this panel.
                </div>
              ) : (
                runs.map((run) => (
                  <div key={run.id} className="rounded-lg border border-border bg-[#12161b] px-3 py-3">
                    <div className="flex items-start justify-between gap-3">
                      <div>
                        <p className="break-words text-sm font-medium text-text">{run.title}</p>
                        <p className="mt-1 text-[11px] uppercase tracking-wider text-text-muted">
                          {run.status} · {new Date(run.startedAt).toLocaleTimeString()}
                        </p>
                        <p className="mt-1 text-[11px] uppercase tracking-wider text-text-muted">
                          {run.stageLabel ?? 'Fabric'} · {run.executionMode === 'cli' ? 'CLI fallback' : run.executionMode === 'server' ? 'Server' : 'Resolving'}
                        </p>
                      </div>
                      {run.status === 'running' ? (
                        <button onClick={() => abortRun(run.id)} className="arcos-action rounded px-2 py-1 text-[10px] uppercase tracking-wider">
                          Stop
                        </button>
                      ) : null}
                    </div>
                    <p className="mt-2 whitespace-pre-wrap break-words text-xs leading-5 text-text-muted">
                      {run.output || run.error || 'Waiting for output...'}
                    </p>
                    <div className="mt-3 flex flex-wrap gap-2">
                      <button onClick={() => showPanel('execution')} className="arcos-action rounded px-2 py-1 text-[10px] uppercase tracking-wider">
                        Trace
                      </button>
                      <button onClick={() => showPanel('chat')} className="arcos-action rounded px-2 py-1 text-[10px] uppercase tracking-wider">
                        Chat
                      </button>
                    </div>
                  </div>
                ))
              )}
            </div>
          </div>
        </div>

        <div className="space-y-4">
          <div className="arcos-subpanel rounded-xl p-3">
            <div className="flex items-center justify-between gap-3">
              <div>
                <p className="arcos-kicker mb-1">Plugins</p>
                <p className="text-sm font-semibold text-text">Extension contracts and prompt overrides</p>
              </div>
              <div className="flex items-center gap-2">
                <button onClick={openPluginsDir} className="arcos-action rounded px-2 py-1 text-[10px] uppercase tracking-wider">
                  Open Folder
                </button>
                <button onClick={handleInstall} className="arcos-action-primary rounded px-2 py-1 text-[10px] uppercase tracking-wider">
                  Install
                </button>
              </div>
            </div>

            {installError && (
              <div className="mt-3 rounded-lg border border-danger/30 bg-danger/10 px-3 py-2 text-xs text-danger">
                {installError}
              </div>
            )}

            <div className="mt-3 space-y-2">
              {plugins.length === 0 ? (
                <div className="rounded-lg border border-border bg-[#12161b] px-3 py-5 text-xs text-text-muted">
                  No plugins installed yet.
                </div>
              ) : (
                plugins.map((plugin) => {
                  const isActive = activePlugin?.id === plugin.id
                  return (
                    <button
                      key={plugin.id}
                      onClick={() => isActive ? deactivatePlugin() : activatePlugin(plugin.id)}
                      className={`w-full rounded-lg border px-3 py-3 text-left transition-colors ${
                        isActive
                          ? 'border-[#93a5b8]/40 bg-[#1b2027]'
                          : 'border-border bg-[#12161b] hover:border-[#93a5b8]/30 hover:bg-[#171c22]'
                      }`}
                    >
                      <div className="flex items-start gap-3">
                        <span className="text-lg">{plugin.icon}</span>
                        <div className="min-w-0 flex-1">
                          <div className="flex items-center gap-2">
                            <p className="break-words text-sm font-medium text-text">{plugin.name}</p>
                            {isActive && (
                              <span className="rounded-full bg-success/10 px-2 py-0.5 text-[10px] uppercase tracking-wider text-success">
                                Active
                              </span>
                            )}
                            <span className="rounded-full border border-border px-2 py-0.5 text-[10px] uppercase tracking-wider text-text-muted">
                              {plugin.architectureRole}
                            </span>
                            <span className="rounded-full border border-border px-2 py-0.5 text-[10px] uppercase tracking-wider text-text-muted">
                              {plugin.executionBoundary}
                            </span>
                          </div>
                          <p className="mt-1 break-words text-xs leading-5 text-text-muted">{plugin.description}</p>
                          <div className="mt-2 flex flex-wrap gap-1">
                            {plugin.commands.map((command) => (
                              <span key={command} className="rounded border border-border px-1.5 py-0.5 text-[10px] text-text-muted">
                                {command}
                              </span>
                            ))}
                          </div>
                          <div className="mt-2 flex flex-wrap gap-1">
                            {plugin.targetStages.map((stage) => (
                              <span key={`${plugin.id}-${stage}`} className="rounded border border-border px-1.5 py-0.5 text-[10px] text-text-muted">
                                {stage}
                              </span>
                            ))}
                          </div>
                          <p className="mt-2 break-words text-[11px] leading-5 text-text-muted">
                            Entry surfaces: {plugin.entrySurfaces.join(', ')}. Stability: {plugin.stability}.
                          </p>
                        </div>
                      </div>
                    </button>
                  )
                })
              )}
            </div>

            <div className="mt-3 flex flex-wrap gap-2">
              <button onClick={() => showPanel('prompt_inspector')} className="arcos-action rounded px-2 py-1 text-[10px] uppercase tracking-wider">
                Open Prompt Inspector
              </button>
              <button onClick={() => showPanel('routing')} className="arcos-action rounded px-2 py-1 text-[10px] uppercase tracking-wider">
                Open Routing
              </button>
              <button onClick={() => showPanel('runtime')} className="arcos-action rounded px-2 py-1 text-[10px] uppercase tracking-wider">
                Open Runtime
              </button>
            </div>
          </div>
        </div>
      </section>
    </div>
  )
}
