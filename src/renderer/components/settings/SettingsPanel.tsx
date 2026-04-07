import { useEffect, useState, type KeyboardEvent as ReactKeyboardEvent } from 'react'
import { AnimatePresence, motion } from 'framer-motion'
import { useSettingsStore } from '../../stores/settingsStore'
import { useServiceStore } from '../../stores/serviceStore'
import ApiKeyInput from './ApiKeyInput'
import ModelManager from '../models/ModelManager'
import AnalyticsPanel from '../cost/AnalyticsPanel'
import versionHistory from '../../data/versionHistory.json'
import type { PaiVoiceSection, PermissionPolicy } from '../../stores/types'
import { WORKSPACE_PANELS } from '../../workspace/presets'
import type { WorkspacePanelId } from '../../workspace/types'

type Tab = 'general' | 'response_tuner' | 'appearance' | 'connections' | 'models' | 'analytics' | 'about'

const TAB_LABELS: Array<{ id: Tab; label: string; kicker: string }> = [
  { id: 'general', label: 'General', kicker: 'Routing and defaults' },
  { id: 'response_tuner', label: 'Response Tuner', kicker: 'ARCOS identity and reply shaping' },
  { id: 'appearance', label: 'Appearance', kicker: 'Theme and typography' },
  { id: 'connections', label: 'Connections', kicker: 'Claude and budget' },
  { id: 'models', label: 'Models', kicker: 'Local runtime inventory' },
  { id: 'analytics', label: 'Analytics', kicker: 'Spend and usage' },
  { id: 'about', label: 'About', kicker: 'Version and reference' },
]

const PAI_VOICE_SECTIONS: Array<{ id: PaiVoiceSection; label: string; description: string }> = [
  { id: 'ANSWER', label: 'Answer', description: 'Full direct answer and details.' },
  { id: 'SUMMARY', label: 'Summary', description: 'High-level response overview.' },
  { id: 'ANALYSIS', label: 'Analysis', description: 'Reasoning and evaluation details.' },
  { id: 'ACTIONS', label: 'Actions', description: 'What ARCOS did or recommends doing.' },
  { id: 'RESULTS', label: 'Results', description: 'The concrete output or answer.' },
  { id: 'STATUS', label: 'Status', description: 'Current state after the response.' },
  { id: 'CAPTURE', label: 'Capture', description: 'What should be retained or noted.' },
  { id: 'NEXT', label: 'Next', description: 'Next steps and follow-up guidance.' },
  { id: 'COMPLETED', label: 'Completed', description: 'Completion summary.' },
]

const SHORTCUT_ROWS = [
  ['New Thread', '⌘K'],
  ['New Terminal', '⌘T'],
  ['Settings', '⌘,'],
  ['Error Log', '⌘⇧L'],
  ['History', '⌘⇧H'],
  ['Memory', '⌘⇧M'],
  ['Close current overlay', 'Esc'],
  ['Send Prompt', 'Enter'],
  ['New Line', '⇧Enter'],
  ['Terminal close: Save', '⌘S'],
  ['Terminal close: Archive', '⌘↩'],
  ['Terminal close: Don’t Save', '⌘⌫'],
  ['Menu navigation', '↑ ↓ ← →'],
  ['Activate focused button', 'Enter'],
] as const

const SHORTCUT_ASSIGNABLE_PANELS = WORKSPACE_PANELS.filter((panel) => panel.id !== 'chat')

function shortcutFromKeyboardEvent(event: ReactKeyboardEvent<HTMLInputElement>): string | null {
  const key = event.key.length === 1 ? event.key.toLowerCase() : event.key.toLowerCase().replace(/\s+/g, '')
  if (['meta', 'control', 'shift', 'alt', 'escape', 'tab'].includes(key)) return null
  if (!(event.metaKey || event.ctrlKey || event.altKey || event.shiftKey)) return null
  const parts = [
    event.metaKey || event.ctrlKey ? 'mod' : null,
    event.altKey ? 'alt' : null,
    event.shiftKey ? 'shift' : null,
    key,
  ].filter(Boolean)
  return parts.join('+')
}

function shortcutLabel(shortcut?: string): string {
  if (!shortcut || shortcut === 'none') return 'None'
  return shortcut
    .split('+')
    .map((part) => {
      if (part === 'mod') return '⌘'
      if (part === 'alt') return '⌥'
      if (part === 'shift') return '⇧'
      if (part === 'enter') return '↩'
      if (part === 'backspace') return '⌫'
      if (part === 'delete') return '⌦'
      if (part === 'arrowup') return '↑'
      if (part === 'arrowdown') return '↓'
      if (part === 'arrowleft') return '←'
      if (part === 'arrowright') return '→'
      return part.toUpperCase()
    })
    .join('')
}

export default function SettingsPanel() {
  const { settings, updateSettings, closeSettingsPanel, resetToDefaults } = useSettingsStore()
  const availableModels = useServiceStore((s) => s.availableOllamaModels)
  const fetchOllamaModels = useServiceStore((s) => s.fetchOllamaModels)
  const fetchOllamaModelDetails = useServiceStore((s) => s.fetchOllamaModelDetails)
  const [local, setLocal] = useState({ ...settings })
  const [activeTab, setActiveTab] = useState<Tab>('general')
  const [voiceStatus, setVoiceStatus] = useState<{
    healthy: boolean
    port: number
    apiKeyConfigured?: boolean
    defaultVoiceId?: string
    modelId?: string
    error?: string
  } | null>(null)

  useEffect(() => {
    setLocal({ ...settings })
  }, [settings])

  useEffect(() => {
    if (activeTab !== 'models') return
    fetchOllamaModels().catch(() => {})
    fetchOllamaModelDetails().catch(() => {})
  }, [activeTab, fetchOllamaModels, fetchOllamaModelDetails])

  useEffect(() => {
    if (activeTab !== 'connections') return
    window.electron.voiceStatus()
      .then((status) => setVoiceStatus(status))
      .catch(() => setVoiceStatus(null))
  }, [activeTab])

  const save = () => {
    updateSettings(local)
  }

  const revert = () => {
    setLocal({ ...settings })
  }

  const toggleVoiceSection = (section: PaiVoiceSection) => {
    setLocal((current) => {
      const selected = new Set(current.voiceReadSections)
      if (selected.has(section)) {
        selected.delete(section)
      } else {
        selected.add(section)
      }
      return {
        ...current,
        voiceReadSections: PAI_VOICE_SECTIONS
          .map((entry) => entry.id)
          .filter((entry) => selected.has(entry)),
      }
    })
  }

  const assignModuleShortcut = (panelId: WorkspacePanelId, shortcut: string) => {
    setLocal((current) => {
      const moduleShortcuts = { ...current.moduleShortcuts }
      for (const key of Object.keys(moduleShortcuts) as WorkspacePanelId[]) {
        if (key !== panelId && shortcut !== 'none' && moduleShortcuts[key] === shortcut) {
          delete moduleShortcuts[key]
        }
      }
      if (shortcut === 'none') {
        delete moduleShortcuts[panelId]
      } else {
        moduleShortcuts[panelId] = shortcut
      }
      return { ...current, moduleShortcuts }
    })
  }

  const captureModuleShortcut = (panelId: WorkspacePanelId, event: ReactKeyboardEvent<HTMLInputElement>) => {
    event.preventDefault()
    event.stopPropagation()
    if (event.key === 'Backspace' || event.key === 'Delete' || event.key === 'Escape') {
      assignModuleShortcut(panelId, 'none')
      return
    }
    const shortcut = shortcutFromKeyboardEvent(event)
    if (shortcut) assignModuleShortcut(panelId, shortcut)
  }

  return (
    <AnimatePresence>
      <motion.div
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        exit={{ opacity: 0 }}
        className="fixed inset-0 z-50 flex items-center justify-center"
      >
        <div className="absolute inset-0 bg-black/55" onClick={closeSettingsPanel} />
        <motion.div
          initial={{ scale: 0.98, opacity: 0 }}
          animate={{ scale: 1, opacity: 1 }}
          exit={{ scale: 0.98, opacity: 0 }}
          className="relative flex h-[680px] max-h-[90vh] w-[920px] max-w-[94vw] overflow-hidden rounded-2xl border border-border bg-surface shadow-2xl"
        >
          <aside className="flex w-[220px] shrink-0 flex-col border-r border-border bg-[#11161b]">
            <div className="border-b border-border px-5 py-4">
              <p className="arcos-kicker mb-1">Settings</p>
              <h2 className="text-base font-semibold text-text">ARCOS Configuration</h2>
            </div>

            <nav className="flex-1 overflow-y-auto px-3 py-3">
              <div className="space-y-1.5">
                {TAB_LABELS.map((tab) => (
                  <button
                    key={tab.id}
                    onClick={() => setActiveTab(tab.id)}
                    className={`w-full rounded-lg border px-3 py-2.5 text-left transition-colors ${
                      activeTab === tab.id
                        ? 'border-[#93a5b8]/35 bg-[#1b2128] text-text'
                        : 'border-transparent text-text-muted hover:border-border hover:bg-[#171c22] hover:text-text'
                    }`}
                  >
                    <p className="text-sm font-medium">{tab.label}</p>
                    <p className="mt-1 text-[11px] leading-5 opacity-80">{tab.kicker}</p>
                  </button>
                ))}
              </div>
            </nav>

            <div className="border-t border-border px-4 py-3">
              <button onClick={closeSettingsPanel} className="arcos-action w-full rounded-md px-3 py-2 text-sm">
                Close
              </button>
            </div>
          </aside>

          <div className="flex min-w-0 flex-1 flex-col">
            <div className="flex items-start justify-between gap-4 border-b border-border px-6 py-5">
              <div className="min-w-0">
                <p className="arcos-kicker mb-1">{TAB_LABELS.find((tab) => tab.id === activeTab)?.label}</p>
                <p className="text-sm font-semibold text-text">
                  {activeTab === 'general' && 'Routing, startup behavior, and default assistant controls'}
                  {activeTab === 'response_tuner' && 'Tune ARCOS-level identity and response shaping without editing PAI CORE or OpenClaw files'}
                  {activeTab === 'appearance' && 'Theme, font, and accent tuning for the ARCOS surface'}
                  {activeTab === 'connections' && 'Claude connection state and local budget policy'}
                  {activeTab === 'models' && 'Active Ollama model and local model inventory'}
                  {activeTab === 'analytics' && 'Cost and message tracking across the current ARCOS runtime'}
                  {activeTab === 'about' && 'Version history, shortcuts, and reset actions'}
                </p>
              </div>
              <button onClick={closeSettingsPanel} className="text-xl leading-none text-text-muted hover:text-text">
                ×
              </button>
            </div>

            <div className="min-h-0 flex-1 overflow-y-auto px-6 py-5">
              {activeTab === 'general' && (
                <div className="space-y-6">
                  <section className="rounded-xl border border-border bg-[#12161b] px-4 py-4">
                    <p className="arcos-kicker mb-3">Startup</p>
                    <div className="space-y-3">
                      <ToggleRow
                        label="Start Ollama automatically"
                        checked={local.autoStartOllama}
                        onChange={(value) => setLocal((s) => ({ ...s, autoStartOllama: value }))}
                      />
                      <ToggleRow
                        label="Start Fabric server automatically"
                        checked={local.autoStartFabric}
                        onChange={(value) => setLocal((s) => ({ ...s, autoStartFabric: value }))}
                      />
                    </div>
                  </section>

                  <section className="rounded-xl border border-border bg-[#12161b] px-4 py-4">
                    <p className="arcos-kicker mb-3">Routing Policy</p>
                    <div className="space-y-4">
                      <Field label="Mode">
                        <select
                          value={local.routingMode}
                          onChange={(e) => setLocal((s) => ({ ...s, routingMode: e.target.value as typeof s.routingMode }))}
                          className="input-base w-full"
                        >
                          <option value="ollama">Always Local (Ollama)</option>
                          <option value="auto">Auto</option>
                          <option value="arc-sonnet">Always Sonnet</option>
                        </select>
                      </Field>
                      <div className="rounded-lg border border-border bg-[#0f1318] px-4 py-3 text-xs leading-5 text-text-muted">
                        Auto uses ARCOS routing rules to choose a model path. Today that path is local-first when budgets or local availability make that the better choice. Future connection-aware routing can extend this list dynamically as more providers are added.
                      </div>
                    </div>
                  </section>

                  <section className="rounded-xl border border-border bg-[#12161b] px-4 py-4">
                    <p className="arcos-kicker mb-3">Keyboard Shortcuts</p>
                    <div className="grid grid-cols-1 gap-2 font-mono text-xs sm:grid-cols-2">
                      {SHORTCUT_ROWS.map(([label, shortcut]) => (
                        <div key={label} className="flex justify-between gap-4 rounded-lg border border-border bg-[#0f1318] px-3 py-2">
                          <span>{label}</span>
                          <kbd className="rounded bg-surface-elevated px-1.5 py-0.5 text-text">{shortcut}</kbd>
                        </div>
                      ))}
                    </div>
                  </section>

                  <section className="rounded-xl border border-border bg-[#12161b] px-4 py-4">
                    <p className="arcos-kicker mb-3">Module Shortcuts</p>
                    <div className="mb-3 rounded-lg border border-border bg-[#0f1318] px-4 py-3 text-xs leading-5 text-text-muted">
                      Click a field and press the shortcut you want. Backspace, Delete, or Escape clears it. Terminal uses Cmd+T because multiple Terminals can exist at once.
                    </div>
                    <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                      {SHORTCUT_ASSIGNABLE_PANELS.map((panel) => (
                        <Field key={panel.id} label={panel.title}>
                          <input
                            value={shortcutLabel(local.moduleShortcuts[panel.id])}
                            onKeyDown={(event) => captureModuleShortcut(panel.id, event)}
                            onChange={() => {}}
                            readOnly
                            className="input-base w-full cursor-pointer"
                            aria-label={`${panel.title} module shortcut`}
                          />
                        </Field>
                      ))}
                    </div>
                  </section>

                  <section className="rounded-xl border border-border bg-[#12161b] px-4 py-4">
                    <p className="arcos-kicker mb-3">Permission Policy</p>
                    <Field label="Current Mode">
                      <select
                        value={local.permissionPolicy}
                        onChange={(e) => setLocal((s) => ({ ...s, permissionPolicy: e.target.value as PermissionPolicy }))}
                        className="input-base w-full"
                      >
                        <option value="readonly">Read Only</option>
                        <option value="workspace-only">Workspace Only</option>
                        <option value="ask">Ask Each Time</option>
                        <option value="unrestricted">Unrestricted</option>
                      </select>
                    </Field>
                    <div className="mt-3 rounded-lg border border-border bg-[#0f1318] px-4 py-3 text-xs leading-5 text-text-muted">
                      Read Only blocks ARCOS write-back/export actions. Workspace Only allows managed writes inside ARCOS project, app data, and configured vault roots. Ask Each Time prompts before write/execute actions. Unrestricted allows user-selected export paths.
                    </div>
                  </section>
                </div>
              )}

              {activeTab === 'appearance' && (
                <div className="space-y-6">
                  <section className="rounded-xl border border-border bg-[#12161b] px-4 py-4">
                    <Field label="Theme">
                      <select
                        value={local.appearanceTheme}
                        onChange={(e) => setLocal((s) => ({ ...s, appearanceTheme: e.target.value as typeof s.appearanceTheme }))}
                        className="input-base w-full"
                      >
                        <option value="default">Default</option>
                        <option value="star-wars">Star Wars</option>
                        <option value="lord-of-the-rings">Lord of the Rings</option>
                        <option value="matrix">Matrix</option>
                        <option value="deep-sea">Deep Sea</option>
                        <option value="solar-forge">Solar Forge</option>
                        <option value="paper-trail">Paper Trail</option>
                        <option value="arctic-glass">Arctic Glass</option>
                      </select>
                    </Field>
                  </section>

                  <section className="rounded-xl border border-border bg-[#12161b] px-4 py-4">
                    <Field label="Surface Transparency">
                      <select
                        value={local.surfaceTransparency}
                        onChange={(e) => setLocal((s) => ({ ...s, surfaceTransparency: e.target.value as typeof s.surfaceTransparency }))}
                        className="input-base w-full"
                      >
                        <option value="solid">Solid</option>
                        <option value="glass">Glass</option>
                      </select>
                    </Field>
                    <p className="mt-3 text-xs leading-5 text-text-muted">
                      Glass mode applies the transparent Memory drawer feel across ARCOS panels and toolbars.
                    </p>
                  </section>

                  <section className="rounded-xl border border-border bg-[#12161b] px-4 py-4">
                    <Field label="Typeface">
                      <select
                        value={local.appearanceFont}
                        onChange={(e) => setLocal((s) => ({ ...s, appearanceFont: e.target.value }))}
                        className="input-base w-full"
                        style={{ fontFamily: local.appearanceFont }}
                      >
                        {['IBM Plex Sans', 'Arial', 'Menlo', 'Futura', 'Papyrus'].map((font) => (
                          <option key={font} value={font}>{font}</option>
                        ))}
                      </select>
                    </Field>
                  </section>

                  <section className="rounded-xl border border-border bg-[#12161b] px-4 py-4">
                    <p className="arcos-kicker mb-3">Color Controls</p>
                    <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
                      <ColorField
                        label="Text Color"
                        value={local.appearanceTextColor}
                        onChange={(value) => setLocal((s) => ({ ...s, appearanceTextColor: value }))}
                      />
                      <ColorField
                        label="Accent Color"
                        value={local.appearanceAccentColor}
                        onChange={(value) => setLocal((s) => ({ ...s, appearanceAccentColor: value }))}
                      />
                      <ColorField
                        label="Secondary Accent"
                        value={local.appearanceAccentSecondaryColor}
                        onChange={(value) => setLocal((s) => ({ ...s, appearanceAccentSecondaryColor: value }))}
                      />
                    </div>
                  </section>
                </div>
              )}

              {activeTab === 'response_tuner' && (
                <div className="space-y-6">
                  <div className="rounded-lg border border-border bg-[#0f1318] px-4 py-3 text-xs leading-5 text-text-muted">
                    Response Tuner sits at the ARCOS layer. It shapes how ARCOS presents and formats responses without replacing PAI CORE, OpenClaw rules, or Fabric patterns.
                  </div>

                  <section className="rounded-xl border border-border bg-[#12161b] px-4 py-4">
                    <Field label="ARCOS Identity">
                      <textarea
                        value={local.responseTunerIdentity}
                        onChange={(e) => setLocal((s) => ({ ...s, responseTunerIdentity: e.target.value }))}
                        className="input-base min-h-[110px] w-full resize-y"
                        placeholder="Describe how ARCOS should identify itself at the app layer."
                      />
                    </Field>
                  </section>

                  <section className="rounded-xl border border-border bg-[#12161b] px-4 py-4">
                    <Field label="Response Style">
                      <textarea
                        value={local.responseTunerStyle}
                        onChange={(e) => setLocal((s) => ({ ...s, responseTunerStyle: e.target.value }))}
                        className="input-base min-h-[110px] w-full resize-y"
                        placeholder="Describe tone, density, and response behavior."
                      />
                    </Field>
                  </section>

                  <section className="rounded-xl border border-border bg-[#12161b] px-4 py-4">
                    <Field label="Additional ARCOS Instructions">
                      <textarea
                        value={local.responseTunerInstructions}
                        onChange={(e) => setLocal((s) => ({ ...s, responseTunerInstructions: e.target.value }))}
                        className="input-base min-h-[140px] w-full resize-y"
                        placeholder="Optional ARCOS-specific instructions that should apply at the response-composition layer."
                      />
                    </Field>
                  </section>
                </div>
              )}

              {activeTab === 'connections' && (
                <div className="space-y-6">
                  <section className="rounded-xl border border-border bg-[#12161b] px-4 py-4">
                    <p className="arcos-kicker mb-3">Claude</p>
                    <ApiKeyInput />
                    <div className="mt-4 rounded-lg border border-border bg-[#0f1318] px-4 py-3 text-xs text-text-muted">
                      <p>Claude tiers require an API key.</p>
                      <button
                        onClick={() => window.electron.openExternal('https://console.anthropic.com/settings/keys')}
                        className="mt-2 text-accent underline hover:opacity-80"
                      >
                        Open Anthropic key page
                      </button>
                    </div>
                  </section>

                  <section className="rounded-xl border border-border bg-[#12161b] px-4 py-4">
                    <p className="arcos-kicker mb-3">ElevenLabs</p>
                    <div className="rounded-lg border border-border bg-[#0f1318] px-4 py-3 text-xs leading-5 text-text-muted">
                      <div className="flex items-center justify-between gap-3">
                        <span>ARCOS Playback</span>
                        <span className={voiceStatus?.apiKeyConfigured && voiceStatus.defaultVoiceId ? 'text-success' : 'text-danger'}>
                          {voiceStatus?.apiKeyConfigured && voiceStatus.defaultVoiceId ? 'Ready' : 'Not Ready'}
                        </span>
                      </div>
                      <div className="mt-3 space-y-1.5">
                        <div className="flex items-center justify-between gap-3">
                          <span>Legacy Voice Server</span>
                          <span className={voiceStatus?.healthy ? 'text-success' : 'text-text-muted'}>
                            {voiceStatus?.healthy ? `Connected on ${voiceStatus.port}` : 'Not Required'}
                          </span>
                        </div>
                        <div className="flex items-center justify-between gap-3">
                          <span>API Key</span>
                          <span className={voiceStatus?.apiKeyConfigured ? 'text-success' : 'text-danger'}>
                            {voiceStatus?.apiKeyConfigured ? 'Configured' : 'Missing'}
                          </span>
                        </div>
                        <div className="flex items-center justify-between gap-3">
                          <span>Default Voice ID</span>
                          <span className="max-w-[260px] truncate text-text">
                            {voiceStatus?.defaultVoiceId ?? 'Not reported'}
                          </span>
                        </div>
                        <div className="flex items-center justify-between gap-3">
                          <span>Model</span>
                          <span className="max-w-[260px] truncate text-text">
                            {voiceStatus?.modelId ?? 'Not reported'}
                          </span>
                        </div>
                      </div>
                      {voiceStatus?.error && (
                        <div className="mt-3 rounded border border-danger/30 bg-danger/10 px-3 py-2 text-danger">
                          {voiceStatus.error}
                        </div>
                      )}
                      <div className="mt-3">
                        <button
                          onClick={() => window.electron.openExternal('https://elevenlabs.io/app/settings/api-keys')}
                          className="text-accent underline hover:opacity-80"
                        >
                          Open ElevenLabs
                        </button>
                      </div>
                    </div>

                    <div className="mt-4 rounded-lg border border-border bg-[#0f1318] px-4 py-3">
                      <div className="flex flex-wrap items-start justify-between gap-3">
                        <div>
                          <p className="text-xs font-semibold uppercase tracking-wider text-text-muted">Read Aloud Sections</p>
                          <p className="mt-1 text-xs leading-5 text-text-muted">
                            Choose which PAI response sections ElevenLabs reads after the response is visible in Terminal.
                          </p>
                        </div>
                        <span className="rounded-full border border-success/30 bg-success/10 px-2 py-1 text-[10px] uppercase tracking-wider text-success">
                          {(local.voiceReadSections.length > 0 ? local.voiceReadSections : ['RESULTS', 'NEXT']).join(' + ')}
                        </span>
                      </div>
                      <div className="mt-3 grid grid-cols-1 gap-2 sm:grid-cols-2">
                        {PAI_VOICE_SECTIONS.map((section) => (
                          <label
                            key={section.id}
                            className={`flex cursor-pointer items-start gap-3 rounded-lg border px-3 py-2 transition-colors ${
                              local.voiceReadSections.includes(section.id)
                                ? 'border-success/40 bg-success/10'
                                : 'border-border bg-[#12161b] hover:border-[#8fa1b3]/35'
                            }`}
                          >
                            <input
                              type="checkbox"
                              checked={local.voiceReadSections.includes(section.id)}
                              onChange={() => toggleVoiceSection(section.id)}
                              className="mt-1 h-4 w-4 accent-[var(--accent)]"
                            />
                            <span className="min-w-0">
                              <span className="block text-xs font-semibold text-text">{section.label}</span>
                              <span className="mt-0.5 block text-[11px] leading-5 text-text-muted">{section.description}</span>
                            </span>
                          </label>
                        ))}
                      </div>
                      <p className="mt-3 text-[11px] leading-5 text-text-muted">
                        If every box is unchecked, ARCOS falls back to Results + Next.
                      </p>
                    </div>
                  </section>

                  <section className="rounded-xl border border-border bg-[#12161b] px-4 py-4">
                    <p className="arcos-kicker mb-3">Budget Policy</p>
                    <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
                      <Field label="Daily Limit ($)">
                        <input
                          type="number"
                          min={0}
                          step={0.5}
                          value={local.dailyBudgetLimit}
                          onChange={(e) => setLocal((s) => ({ ...s, dailyBudgetLimit: Number.parseFloat(e.target.value || '0') }))}
                          className="input-base w-full"
                        />
                      </Field>
                      <Field label="Monthly Limit ($)">
                        <input
                          type="number"
                          min={0}
                          step={1}
                          value={local.monthlyBudgetLimit}
                          onChange={(e) => setLocal((s) => ({ ...s, monthlyBudgetLimit: Number.parseFloat(e.target.value || '0') }))}
                          className="input-base w-full"
                        />
                      </Field>
                    </div>
                    <Field className="mt-4" label="Monthly Warning Threshold ($)">
                      <input
                        type="number"
                        min={0}
                        step={1}
                        value={local.budgetWarnLimit}
                        onChange={(e) => setLocal((s) => ({ ...s, budgetWarnLimit: Number.parseFloat(e.target.value || '0') }))}
                        className="input-base w-full"
                      />
                    </Field>
                    <div className="mt-4 rounded-lg border border-border bg-[#0f1318] px-4 py-3 text-xs leading-5 text-text-muted">
                      These limits are local ARCOS policy. They do not get sent to Claude. ARCOS uses them to bias routing and to raise warnings inside Analytics when tracked spend approaches or exceeds your configured thresholds.
                    </div>
                  </section>
                </div>
              )}

              {activeTab === 'models' && (
                <div className="space-y-6">
                  <section className="rounded-xl border border-border bg-[#12161b] px-4 py-4">
                    <Field label="Active Ollama Model">
                      <select
                        value={availableModels.includes(local.ollamaModel) ? local.ollamaModel : ''}
                        onChange={(e) => setLocal((s) => ({ ...s, ollamaModel: e.target.value }))}
                        className="input-base w-full"
                        disabled={availableModels.length === 0}
                      >
                        {availableModels.length === 0 ? (
                          <option value="">No installed models detected</option>
                        ) : (
                          availableModels.map((model) => (
                            <option key={model} value={model}>{model}</option>
                          ))
                        )}
                      </select>
                    </Field>
                  </section>
                  <ModelManager />
                </div>
              )}

              {activeTab === 'analytics' && (
                <div className="space-y-4">
                  <div className="rounded-lg border border-border bg-[#0f1318] px-4 py-3 text-xs leading-5 text-text-muted">
                    Analytics is driven by local conversation-store and spending-store data. If values are unexpectedly zero, the issue is in local hydration or event recording, not in the settings UI itself.
                  </div>
                  <AnalyticsPanel />
                </div>
              )}

              {activeTab === 'about' && (
                <div className="space-y-4 text-sm text-text-muted">
                  <div>
                    <p className="text-text font-semibold">ARCOS</p>
                    <p className="mt-0.5 text-xs">v{versionHistory.currentVersion} — PAI operating surface for routing, memory, services, and execution state</p>
                  </div>
                  <div className="rounded-lg border border-border bg-[#12161b] px-4 py-3 text-xs leading-5">
                    ARCOS is the desktop control surface for PAI. It is not a generic assistant shell; it is the place where services, orchestration, memory, and live task threads stay visible together.
                  </div>
                  <div className="space-y-2">
                    <p className="font-medium text-text-muted uppercase tracking-wider text-xs">Version History</p>
                    <div className="space-y-2">
                      {versionHistory.entries.map((entry) => (
                        <div key={entry.version} className="rounded-lg border border-border bg-[#12161b] px-4 py-3 text-xs leading-5">
                          <div className="flex items-start justify-between gap-3">
                            <div>
                              <p className="font-semibold text-text">v{entry.version} · {entry.title}</p>
                              <p className="mt-1 text-[11px] uppercase tracking-wider text-text-muted">{entry.date}</p>
                            </div>
                            <span className={`rounded-full px-2 py-1 text-[10px] uppercase tracking-wider ${
                              entry.status === 'current'
                                ? 'bg-success/10 text-success'
                                : entry.status === 'major'
                                  ? 'bg-accent/10 text-accent'
                                  : 'bg-surface-elevated text-text-muted'
                            }`}>
                              {entry.status}
                            </span>
                          </div>
                          <ul className="mt-3 space-y-1.5 text-text-muted">
                            {entry.highlights.map((highlight) => (
                              <li key={highlight}>• {highlight}</li>
                            ))}
                          </ul>
                        </div>
                      ))}
                    </div>
                  </div>
                  <div className="pt-2">
                    <button onClick={resetToDefaults} className="btn-danger text-xs">Reset all settings</button>
                  </div>
                </div>
              )}
            </div>

            <div className="flex items-center justify-between border-t border-border px-6 py-4">
              <button onClick={revert} className="btn-ghost">Cancel</button>
              <button onClick={save} className="btn-primary">Save Changes</button>
            </div>
          </div>
        </motion.div>
      </motion.div>
    </AnimatePresence>
  )
}

function Field({
  label,
  children,
  className = '',
}: {
  label: string
  children: React.ReactNode
  className?: string
}) {
  return (
    <div className={className}>
      <label className="mb-1.5 block text-xs text-text-muted">{label}</label>
      {children}
    </div>
  )
}

function ToggleRow({
  label,
  checked,
  onChange,
}: {
  label: string
  checked: boolean
  onChange: (value: boolean) => void
}) {
  return (
    <label className="flex items-center justify-between gap-4 cursor-pointer">
      <span className="text-sm text-text">{label}</span>
      <button
        type="button"
        onClick={() => onChange(!checked)}
        className={`relative h-6 w-11 shrink-0 rounded-full p-0.5 transition-colors ${
          checked ? 'bg-accent' : 'border border-border bg-surface-elevated'
        }`}
      >
        <span
          className={`absolute left-0.5 top-0.5 h-5 w-5 rounded-full bg-white shadow transition-transform ${
            checked ? 'translate-x-5' : 'translate-x-0'
          }`}
        />
      </button>
    </label>
  )
}

function ColorField({
  label,
  value,
  onChange,
}: {
  label: string
  value: string
  onChange: (value: string) => void
}) {
  return (
    <label className="space-y-1.5">
      <span className="text-xs text-text-muted">{label}</span>
      <div className="flex min-w-0 items-center gap-2 rounded-md border border-border bg-surface-elevated px-3 py-2">
        <input
          type="color"
          value={value}
          onChange={(e) => onChange(e.target.value)}
          className="h-8 w-10 shrink-0 border-0 bg-transparent p-0"
        />
        <input
          type="text"
          value={value}
          onChange={(e) => onChange(e.target.value)}
          className="min-w-0 flex-1 border-0 bg-transparent px-0 py-0 text-sm text-text focus:outline-none"
        />
      </div>
    </label>
  )
}
