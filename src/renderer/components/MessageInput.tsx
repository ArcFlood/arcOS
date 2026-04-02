import { useState, useRef, useEffect, useMemo, KeyboardEvent } from 'react'
import { useConversationStore } from '../stores/conversationStore'
import { useSettingsStore } from '../stores/settingsStore'
import { useServiceStore } from '../stores/serviceStore'
import { useCostStore } from '../stores/costStore'
import { usePluginStore } from '../stores/pluginStore'
import { ModelTier } from '../stores/types'
import { sendMessage } from '../services/chatService'

interface Props {
  conversationId: string | null
}

type RoutingTier = { tier: ModelTier; reason: string }

function routeQuery(
  text: string,
  mode: string,
  aggressiveness: string,
  ollamaRunning: boolean,
  spendingToday: number,
  dailyLimit: number
): RoutingTier {
  // Budget guard
  if (spendingToday >= dailyLimit && ollamaRunning) {
    return { tier: 'ollama', reason: `Daily budget ($${dailyLimit}) reached — local model` }
  }

  if (mode !== 'auto') return { tier: mode as ModelTier, reason: 'Manual override' }

  const words = text.trim().split(/\s+/).length
  const hasCode = /```|function |const |let |class |import |def |debug|error|refactor/.test(text)
  const isComplex = /analyze|research|synthesize|multi.?step|orchestrat|architecture|evaluate|comprehensive/.test(text.toLowerCase())
  const isSimple = words < 50 && !hasCode && !isComplex
  const isMid = words >= 50 && words < 300 && !hasCode && !isComplex

  if (aggressiveness === 'cost-first') {
    if (isSimple && ollamaRunning) return { tier: 'ollama', reason: 'Simple query → local (cost-first)' }
    if (isMid && ollamaRunning) return { tier: 'ollama', reason: 'Moderate query → local (cost-first)' }
    return { tier: 'haiku', reason: 'Cost-first → Haiku' }
  }

  if (aggressiveness === 'quality-first') {
    if (isSimple && ollamaRunning) return { tier: 'ollama', reason: 'Simple → local' }
    return { tier: 'arc-sonnet', reason: 'Quality-first → A.R.C.' }
  }

  // Balanced
  if (isSimple && ollamaRunning) return { tier: 'ollama', reason: 'Short & simple → local model' }
  if (hasCode || isComplex) return { tier: 'arc-sonnet', reason: hasCode ? 'Code detected → A.R.C.' : 'Complex reasoning → A.R.C.' }
  if (isMid) return { tier: 'haiku', reason: 'Moderate complexity → Haiku' }
  if (!ollamaRunning) return { tier: 'haiku', reason: 'Ollama offline → Haiku' }
  return { tier: 'arc-sonnet', reason: 'Long query → A.R.C.' }
}

const TIER_LABELS: Record<ModelTier, string> = {
  ollama: '💻 Local',
  haiku: '⚡ Haiku',
  'arc-sonnet': '🧠 A.R.C.',
  'arc-opus': '🔮 Opus',
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
      ? `Plugin: ${activePlugin.name} → ${TIER_LABELS[activePlugin.tier]}`
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
      ? `Plugin: ${resolvedPlugin.name} → ${TIER_LABELS[resolvedPlugin.tier]}`
      : reason

    // Show routing decision
    if (settings.showRoutingReasons) {
      addMessage(convId, {
        role: 'system',
        content: `${TIER_LABELS[effectiveTier]} — ${effectiveReason}`,
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
          <span className={`font-medium ${TIER_COLORS[previewTier]}`}>{TIER_LABELS[previewTier]}</span>
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
