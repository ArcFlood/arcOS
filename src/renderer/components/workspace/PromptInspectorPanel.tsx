import { useEffect, useMemo, useState } from 'react'
import { useConversationStore } from '../../stores/conversationStore'
import { loadArcPrompt } from '../../services/arcLoader'
import { usePluginStore } from '../../stores/pluginStore'
import { useSettingsStore } from '../../stores/settingsStore'

function estimateTokens(text: string): number {
  return Math.ceil(text.length / 4)
}

export default function PromptInspectorPanel() {
  const activeConversation = useConversationStore((s) => s.activeConversation())
  const activePlugin = usePluginStore((s) => s.activePlugin)
  const settings = useSettingsStore((s) => s.settings)
  const [systemPrompt, setSystemPrompt] = useState('')
  const [promptSource, setPromptSource] = useState('loading')
  const [expanded, setExpanded] = useState(false)

  useEffect(() => {
    const load = async () => {
      const { prompt, source } = await loadArcPrompt()
      setSystemPrompt(prompt)
      setPromptSource(source)
    }
    load().catch(() => {
      setPromptSource('fallback')
    })
  }, [])

  const chatMessages = useMemo(
    () => (activeConversation?.messages ?? []).filter((message) => message.role === 'user' || message.role === 'assistant'),
    [activeConversation?.messages]
  )

  const latestUserMessage = [...chatMessages].reverse().find((message) => message.role === 'user')
  const recentContextWindow = chatMessages.slice(-6)
  const recentUserCount = recentContextWindow.filter((message) => message.role === 'user').length
  const recentAssistantCount = recentContextWindow.filter((message) => message.role === 'assistant').length
  const currentUserPromptTokens = estimateTokens(latestUserMessage?.content ?? '')
  const recentConversationTokens = estimateTokens(
    recentContextWindow.map((message) => message.content).join('\n\n')
  )
  const contextWindowTokens = currentUserPromptTokens + recentConversationTokens

  const activeSystemPrompt = activePlugin?.systemPrompt ?? systemPrompt
  const activeSystemSource = activePlugin ? `plugin:${activePlugin.name}` : promptSource

  return (
    <div className="space-y-4 p-4">
      <section className="arcos-subpanel rounded-xl p-3">
        <div className="flex items-center justify-between">
          <p className="arcos-kicker">Stats</p>
          <span className="text-[11px] text-text-muted">{contextWindowTokens} tokens est.</span>
        </div>
        <div className="mt-3 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
          <InspectorStat label="Latest User Prompt Tokens" value={String(currentUserPromptTokens)} />
          <InspectorStat label="Recent Context Tokens" value={String(recentConversationTokens)} />
          <InspectorStat label="Recent User Messages" value={String(recentUserCount)} />
          <InspectorStat label="Recent Assistant Messages" value={String(recentAssistantCount)} />
        </div>
      </section>

      <section className="arcos-subpanel rounded-xl p-3">
        <p className="arcos-kicker">Prompt Composition</p>
        <div className="mt-3 grid gap-3 sm:grid-cols-2">
          <InspectorStat label="System Source" value={activeSystemSource} />
          <InspectorStat label="System Tokens" value={String(estimateTokens(activeSystemPrompt))} />
          <InspectorStat label="Context Messages" value={String(chatMessages.length)} />
          <InspectorStat label="Extended Thinking" value={settings.extendedThinking ? 'Enabled' : 'Disabled'} />
        </div>
        <p className="mt-3 text-xs leading-5 text-text-muted">
          System tokens are the estimated size of the currently loaded system prompt stack. In the current build that is mostly the ARCOS / PAI core prompt loaded from the configured source, plus any active plugin override. It does not include the user prompt or recent thread context.
        </p>
      </section>

      <section className="arcos-subpanel rounded-xl p-3">
        <div className="flex items-center justify-between">
          <p className="arcos-kicker">System Prompt</p>
          <button
            onClick={() => setExpanded((value) => !value)}
            className="arcos-action rounded px-2 py-1 text-[10px] uppercase tracking-wider"
          >
            {expanded ? 'Collapse' : 'Expand'}
          </button>
        </div>
        <div
          className={`mt-3 rounded-lg border border-border bg-[#12161b] px-3 py-3 whitespace-pre-wrap break-words text-xs leading-6 text-text-muted ${expanded ? '' : 'overflow-hidden'}`}
          style={!expanded ? {
            display: '-webkit-box',
            WebkitLineClamp: 7,
            WebkitBoxOrient: 'vertical',
          } : undefined}
        >
          {activeSystemPrompt}
        </div>
      </section>
    </div>
  )
}

function InspectorStat({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-lg border border-border bg-[#12161b] px-3 py-2.5">
      <p className="arcos-kicker">{label}</p>
      <p className="mt-1 break-words text-sm font-medium text-text">{value}</p>
    </div>
  )
}
