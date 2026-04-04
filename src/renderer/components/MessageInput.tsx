import { useState, useRef, useEffect, useMemo, KeyboardEvent } from 'react'
import { useConversationStore } from '../stores/conversationStore'
import { useSettingsStore } from '../stores/settingsStore'
import { useServiceStore } from '../stores/serviceStore'
import { useCostStore } from '../stores/costStore'
import { usePluginStore } from '../stores/pluginStore'
import { ModelTier } from '../stores/types'
import { useTraceStore } from '../stores/traceStore'
import { sendMessage } from '../services/chatService'
import { routeQuery, TIER_DISPLAY_LABELS } from '../utils/routing'

interface Props {
  conversationId: string | null
}
const TIER_COLORS: Record<ModelTier, string> = {
  ollama: 'text-success',
  haiku: 'text-haiku-accent',
  'arc-sonnet': 'text-arc-accent',
  'arc-opus': 'text-pink-400',
}

export default function MessageInput({ conversationId }: Props) {
  const [text, setText] = useState('')
  const [sending, setSending] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const textareaRef = useRef<HTMLTextAreaElement>(null)
  const abortRef = useRef<AbortController | null>(null)

  const createConversation = useConversationStore((s) => s.createConversation)
  const addMessage = useConversationStore((s) => s.addMessage)
  const updateMessage = useConversationStore((s) => s.updateMessage)
  const activeConversation = useConversationStore((s) => s.activeConversation())

  const settings = useSettingsStore((s) => s.settings)
  const ollamaRunning = useServiceStore((s) => s.getService('ollama')?.running ?? false)
  const addRecord = useCostStore((s) => s.addRecord)
  const spendingToday = useCostStore((s) => s.getSummary().today)

  const activePlugin = usePluginStore((s) => s.activePlugin)
  const activatePlugin = usePluginStore((s) => s.activatePlugin)
  const findByCommand = usePluginStore((s) => s.findByCommand)
  const appendTraceEntry = useTraceStore((s) => s.appendEntry)

  // Auto-resize textarea
  useEffect(() => {
    const ta = textareaRef.current
    if (!ta) return
    ta.style.height = 'auto'
    ta.style.height = Math.min(ta.scrollHeight, 200) + 'px'
  }, [text])

  // Detect slash command in current text for preview (memoized — avoids re-running on every render)
  const slashCommandPlugin = useMemo(() => {
    const t = text.trim()
    if (!t.startsWith('/')) return null
    const firstWord = t.split(/\s+/)[0]
    return findByCommand(firstWord)
  }, [text, findByCommand])

  const route = useMemo(
    () => text.trim()
      ? routeQuery(text, settings.routingMode, settings.routingAggressiveness, ollamaRunning, spendingToday, settings.dailyBudgetLimit)
      : null,
    [text, settings.routingMode, settings.routingAggressiveness, ollamaRunning, spendingToday, settings.dailyBudgetLimit]
  )

  // What tier + reason to show in the preview
  const previewTier = slashCommandPlugin?.tier ?? activePlugin?.tier ?? route?.tier ?? null
  const previewReason = slashCommandPlugin
      ? `Plugin: ${slashCommandPlugin.name}`
      : activePlugin
      ? `Plugin: ${activePlugin.name} → ${TIER_DISPLAY_LABELS[activePlugin.tier]}`
      : route?.reason ?? ''

  const handleSend = async () => {
    const trimmed = text.trim()
    if (!trimmed || sending) return

    setError(null)
    setSending(true)
    setText('')

    // ── Slash command detection ────────────────────────────────
    // If the message starts with a known plugin command, auto-activate it
    // and strip the command prefix from the actual content.
    let resolvedContent = trimmed
    let resolvedPlugin = activePlugin

    if (trimmed.startsWith('/')) {
      const firstWord = trimmed.split(/\s+/)[0]
      const matched = findByCommand(firstWord)
      if (matched) {
        resolvedPlugin = matched
        activatePlugin(matched.id)
        // Strip the command token, keeping the rest as the actual message
        const rest = trimmed.slice(firstWord.length).trim()
        resolvedContent = rest || trimmed // fall back to full text if nothing after command
      }
    }
    // ──────────────────────────────────────────────────────────

    const convId = conversationId ?? createConversation()

    // Build history from current conversation (before adding new message)
    const history = (activeConversation?.messages ?? []).map((m) => ({
      role: m.role,
      content: m.content,
    }))

    // Add user message to store (show original text including command)
    addMessage(convId, {
      role: 'user',
      content: trimmed,
      model: null,
      cost: 0,
      timestamp: Date.now(),
    })

    // Route decision (may be overridden by plugin tier below)
    const { tier, reason } = routeQuery(resolvedContent, settings.routingMode, settings.routingAggressiveness, ollamaRunning, spendingToday, settings.dailyBudgetLimit)

    // Effective tier — plugin overrides router
    const effectiveTier = resolvedPlugin ? resolvedPlugin.tier : tier
    const effectiveReason = resolvedPlugin
      ? `Plugin: ${resolvedPlugin.name} → ${TIER_DISPLAY_LABELS[resolvedPlugin.tier]}`
      : reason

    appendTraceEntry({
      source: 'routing',
      level: 'info',
      title: `Routed to ${TIER_DISPLAY_LABELS[effectiveTier]}`,
      detail: effectiveReason,
      conversationId: convId,
      relatedPanels: ['routing', resolvedPlugin ? 'tools' : 'prompt_inspector', 'execution'],
      entityLabel: resolvedPlugin?.id ?? effectiveTier,
    })

    window.electron.routingAppend?.({
      timestamp: new Date().toISOString(),
      queryPreview: resolvedContent.slice(0, 80),
      chosenTier: effectiveTier,
      reason: effectiveReason,
      confidence: resolvedPlugin ? 1 : 0.72,
      wasOverridden: settings.routingMode !== 'auto' || Boolean(resolvedPlugin),
      conversationId: convId,
    }).catch?.(() => {})

    // Show routing decision
    if (settings.showRoutingReasons) {
      addMessage(convId, {
        role: 'system',
        content: `${TIER_DISPLAY_LABELS[effectiveTier]} — ${effectiveReason}`,
        model: null,
        cost: 0,
        timestamp: Date.now(),
      })
    }

    // Add placeholder assistant message
    const assistantMsg = addMessage(convId, {
      role: 'assistant',
      content: '',
      model: effectiveTier,
      cost: 0,
      timestamp: Date.now(),
      isStreaming: true,
      routingReason: effectiveReason,
    })

    // Stream the response
    abortRef.current = new AbortController()
    let accumulatedContent = ''

    appendTraceEntry({
      source: 'chat',
      level: 'info',
      title: 'Started assistant response',
      detail: `Conversation ${convId} is now streaming from ${TIER_DISPLAY_LABELS[effectiveTier]}.`,
      conversationId: convId,
      relatedPanels: ['chat', 'execution', 'prompt_inspector'],
      entityLabel: effectiveTier,
    })

    await sendMessage({
      content: resolvedContent,
      tier: effectiveTier,
      conversationHistory: [...history, { role: 'user', content: resolvedContent }],
      settings: {
        ollamaModel: settings.ollamaModel,
        extendedThinking: settings.extendedThinking,
      },
      signal: abortRef.current.signal,
      // Plugin system prompt override
      systemPromptOverride: resolvedPlugin?.systemPrompt,
      tierOverride: resolvedPlugin?.tier,
      onToken: (token) => {
        accumulatedContent += token
        updateMessage(convId, assistantMsg.id, {
          content: accumulatedContent,
          isStreaming: true,
        })
      },
      onComplete: (fullText, cost) => {
        updateMessage(convId, assistantMsg.id, {
          content: fullText,
          cost,
          isStreaming: false,
        })
        appendTraceEntry({
          source: 'chat',
          level: 'success',
          title: 'Completed assistant response',
          detail: `Received ${fullText.length} characters${cost > 0 ? ` at cost $${cost.toFixed(4)}` : ' with no cloud cost'}.`,
          conversationId: convId,
          relatedPanels: ['chat', 'execution', 'cost'],
          entityLabel: effectiveTier,
        })
        if (cost > 0) {
          addRecord({ id: crypto.randomUUID(), amount: cost, model: effectiveTier, conversationId: convId })
        }
        setSending(false)
      },
      onError: (err) => {
        updateMessage(convId, assistantMsg.id, {
          content: `⚠️ Error: ${err.message}`,
          isStreaming: false,
        })
        appendTraceEntry({
          source: 'chat',
          level: 'error',
          title: 'Assistant response failed',
          detail: err.message,
          conversationId: convId,
          relatedPanels: ['chat', 'execution', 'services'],
          entityLabel: effectiveTier,
        })
        setError(err.message)
        setSending(false)
      },
    })
  }

  const handleStop = () => {
    abortRef.current?.abort()
    setSending(false)
  }

  const handleKeyDown = (e: KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault()
      handleSend()
    }
  }

  return (
    <div className="space-y-2">
      {/* Routing preview */}
      {previewTier && text.trim() && !sending && (
        <div className="flex items-center gap-2 px-1 text-xs text-text-muted">
          <span>→</span>
          <span className={`font-medium ${TIER_COLORS[previewTier]}`}>{TIER_DISPLAY_LABELS[previewTier]}</span>
          <span className="opacity-60">{previewReason}</span>
        </div>
      )}

      {/* Error */}
      {error && (
        <div className="flex items-center justify-between px-3 py-2 bg-danger/10 border border-danger/30 rounded-lg text-xs text-danger">
          <span>{error}</span>
          <button onClick={() => setError(null)} className="ml-2 opacity-60 hover:opacity-100">✕</button>
        </div>
      )}

      {/* Input box */}
      <div className={`flex items-end gap-3 bg-surface border rounded-xl p-3 transition-colors ${sending ? 'border-accent/50' : 'border-border'}`}>
        <textarea
          ref={textareaRef}
          value={text}
          onChange={(e) => setText(e.target.value)}
          onKeyDown={handleKeyDown}
          placeholder={sending ? 'Generating...' : activePlugin ? `${activePlugin.icon} ${activePlugin.name} active — ask anything...` : 'Ask anything or type /command... (Enter to send)'}
          disabled={sending}
          rows={1}
          className="flex-1 bg-transparent resize-none text-sm text-text placeholder:text-text-muted focus:outline-none leading-relaxed disabled:opacity-50 selectable"
          style={{ maxHeight: '200px' }}
          autoFocus
        />
        {sending ? (
          <button
            onClick={handleStop}
            className="flex-shrink-0 w-9 h-9 flex items-center justify-center rounded-lg bg-surface-elevated hover:bg-border transition-colors text-text-muted border border-border text-xs"
            title="Stop generating"
          >
            ⏹
          </button>
        ) : (
          <button
            onClick={handleSend}
            disabled={!text.trim()}
            className="flex-shrink-0 w-9 h-9 flex items-center justify-center rounded-lg bg-accent hover:bg-accent-hover disabled:opacity-40 disabled:cursor-not-allowed transition-colors text-white text-sm"
          >
            ↑
          </button>
        )}
      </div>
    </div>
  )
}
