import { useState, useRef, useEffect, useMemo, KeyboardEvent } from 'react'
import { useConversationStore } from '../stores/conversationStore'
import { useSettingsStore } from '../stores/settingsStore'
import { useServiceStore } from '../stores/serviceStore'
import { estimateCost, estimateTokens, useCostStore } from '../stores/costStore'
import { usePluginStore } from '../stores/pluginStore'
import { ModelTier } from '../stores/types'
import { useTraceStore } from '../stores/traceStore'
import { sendMessage } from '../services/chatService'
import { executeCanonicalChain } from '../services/canonicalChainService'
import { routeQuery, TIER_DISPLAY_LABELS } from '../utils/routing'
import { searchMemory, MemoryCitation, sourceLabel } from '../services/memoryService'
import { saveConversationToVault } from '../utils/exportConversation'

interface Props {
  conversationId: string | null
}
const TIER_COLORS: Record<ModelTier, string> = {
  ollama: 'text-success',
  haiku: 'text-haiku-accent',
  'arc-sonnet': 'text-arc-accent',
  'arc-opus': 'text-pink-400',
}

function modelIdForTier(tier: ModelTier, ollamaModel: string): string {
  if (tier === 'ollama') return ollamaModel
  if (tier === 'haiku') return 'claude-haiku-4-5-20251001'
  if (tier === 'arc-opus') return 'claude-opus-4-6'
  return 'claude-sonnet-4-6'
}

export default function MessageInput({ conversationId }: Props) {
  const [text, setText] = useState('')
  const [sending, setSending] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [memorySearching, setMemorySearching] = useState(false)
  const [memoryError, setMemoryError] = useState<string | null>(null)
  const [stagedMemory, setStagedMemory] = useState<{
    query: string
    citations: MemoryCitation[]
    queryTimeMs: number
    totalResults: number
  } | null>(null)
  const textareaRef = useRef<HTMLTextAreaElement>(null)
  const abortRef = useRef<AbortController | null>(null)

  const createConversation = useConversationStore((s) => s.createConversation)
  const addMessage = useConversationStore((s) => s.addMessage)
  const updateMessage = useConversationStore((s) => s.updateMessage)
  const activeConversation = useConversationStore((s) => s.activeConversation())

  const settings = useSettingsStore((s) => s.settings)
  const hasApiKey = useSettingsStore((s) => s.hasApiKey)
  const ollamaRunning = useServiceStore((s) => s.getService('ollama')?.running ?? false)
  const memoryRunning = useServiceStore((s) => s.getService('arc-memory')?.running ?? false)
  const openClawRunning = useServiceStore((s) => s.getService('openclaw')?.running ?? false)
  const fabricRunning = useServiceStore((s) => s.getService('fabric')?.running ?? false)
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
    if (firstWord === '/memory') return null
    return findByCommand(firstWord)
  }, [text, findByCommand])

  const memoryCommandQuery = useMemo(() => {
    const trimmed = text.trim()
    if (!trimmed.startsWith('/memory')) return null
    const query = trimmed.slice('/memory'.length).trim()
    return query || null
  }, [text])

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

  const handleMemorySearch = async () => {
    const query = memoryCommandQuery?.trim() ?? ''
    if (!query) {
      setMemoryError('Use /memory followed by a query.')
      return
    }
    if (!memoryRunning) {
      setMemoryError('ARC-Memory is offline.')
      return
    }

    setMemorySearching(true)
    setMemoryError(null)

    const result = await searchMemory(query, { limit: 6 })
    setMemorySearching(false)

    if (!result.success) {
      setStagedMemory(null)
      setMemoryError(result.error ?? 'Memory search failed')
      appendTraceEntry({
        source: 'memory',
        level: 'error',
        title: 'Composer memory search failed',
        detail: result.error ?? 'Memory search failed',
        relatedPanels: ['memory', 'chat', 'transparency'],
        entityLabel: query,
      })
      return
    }

    setStagedMemory({
      query,
      citations: result.citations,
      queryTimeMs: result.query_time_ms,
      totalResults: result.total_results,
    })
    setText('')
    appendTraceEntry({
      source: 'memory',
      level: 'success',
      title: `Composer memory search: ${query}`,
      detail: `${result.total_results} results in ${result.query_time_ms}ms.`,
      relatedPanels: ['memory', 'chat', 'prompt_inspector'],
      entityLabel: query,
    })
  }

  const handleSend = async () => {
    const trimmed = text.trim()
    if (!trimmed || sending || memorySearching) return

    if (trimmed.startsWith('/memory')) {
      await handleMemorySearch()
      return
    }

    setError(null)
    setSending(true)
    setText('')

    // ── Slash command detection ────────────────────────────────
    // If the message starts with a known plugin command, auto-activate it
    // and strip the command prefix from the actual content.
    const displayContent = trimmed
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
      content: displayContent,
      model: null,
      cost: 0,
      timestamp: Date.now(),
    })

    if (stagedMemory && stagedMemory.citations.length > 0) {
      appendTraceEntry({
        source: 'memory',
        level: 'info',
        title: 'Prepared staged memory for canonical chain',
        detail: `${stagedMemory.citations.length} citations from "${stagedMemory.query}" were queued for the PAI core context stage.`,
        conversationId: convId,
        relatedPanels: ['memory', 'chat', 'prompt_inspector'],
        entityLabel: stagedMemory.query,
      })
    }

    const canonicalChain = await executeCanonicalChain({
      prompt: resolvedContent,
      conversationId: convId,
      conversationHistory: history,
      memoryCitations: stagedMemory?.citations ?? [],
      plugin: resolvedPlugin,
      preferredLocalModel: settings.ollamaModel,
      services: {
        openClawRunning,
        fabricRunning,
      },
    })

    // Route decision (may be overridden by plugin tier below)
    const { tier, reason } = routeQuery(canonicalChain.routingPrompt, settings.routingMode, settings.routingAggressiveness, ollamaRunning, spendingToday, settings.dailyBudgetLimit)

    // Effective tier — plugin overrides router
    const routedTier = resolvedPlugin ? resolvedPlugin.tier : (canonicalChain.openClawTierOverride ?? tier)
    const routedReason = resolvedPlugin
      ? `Plugin: ${resolvedPlugin.name} → ${TIER_DISPLAY_LABELS[resolvedPlugin.tier]}`
      : canonicalChain.openClawTierOverride
      ? `OpenClaw gateway → ${TIER_DISPLAY_LABELS[canonicalChain.openClawTierOverride]}`
      : reason
    const shouldFallbackToLocal = routedTier !== 'ollama' && !hasApiKey && ollamaRunning
    const effectiveTier = shouldFallbackToLocal ? 'ollama' : routedTier
    const effectiveReason = shouldFallbackToLocal
      ? `${routedReason} · Claude API key missing, falling back to ${TIER_DISPLAY_LABELS.ollama}`
      : routedReason

    const estimatedInputTokens = estimateTokens(
      [
        ...history.map((message) => message.content),
        canonicalChain.routingPrompt,
      ].join('\n')
    )
    const estimatedOutputTokens = Math.max(estimateTokens(canonicalChain.rebuiltUserPrompt), 384)
    const estimatedCost = estimateCost(effectiveTier, estimatedInputTokens, estimatedOutputTokens)

    appendTraceEntry({
      source: 'routing',
      level: 'info',
      title: `Routed to ${TIER_DISPLAY_LABELS[effectiveTier]}`,
      detail: `${effectiveReason}${estimatedCost > 0 ? ` Estimated cost: $${estimatedCost.toFixed(4)}.` : ' Local path selected.'}`,
      conversationId: convId,
      relatedPanels: ['routing', resolvedPlugin ? 'tools' : 'prompt_inspector', 'execution'],
      entityLabel: resolvedPlugin?.id ?? effectiveTier,
    })

    window.electron.routingAppend?.({
      timestamp: new Date().toISOString(),
      queryPreview: canonicalChain.routingPrompt.slice(0, 80),
      chosenTier: effectiveTier,
      reason: effectiveReason,
      confidence: resolvedPlugin ? 1 : 0.72,
      wasOverridden: settings.routingMode !== 'auto' || Boolean(resolvedPlugin) || shouldFallbackToLocal,
      conversationId: convId,
      estimatedCost,
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
    const finalModelId = modelIdForTier(effectiveTier, settings.ollamaModel)
    const saveChainArtifact = (params: {
      status: 'completed' | 'failed'
      response?: string
      error?: string
      cost: number
    }) => {
      return window.electron.chainCaptureSave?.({
        savedAt: new Date().toISOString(),
        conversationId: convId,
        messageId: assistantMsg.id,
        userPrompt: resolvedContent,
        displayedUserPrompt: displayContent,
        conversationHistoryCount: history.length,
        memoryCitationCount: stagedMemory?.citations.length ?? 0,
        activePlugin: resolvedPlugin
          ? { id: resolvedPlugin.id, name: resolvedPlugin.name, tier: resolvedPlugin.tier }
          : null,
        routing: {
          initialTier: routedTier,
          initialReason: routedReason,
          effectiveTier,
          effectiveReason,
          fallbackToLocal: shouldFallbackToLocal,
          estimatedCost,
        },
        chain: {
          path: canonicalChain.diagnostics.chainPath,
          composerStage: canonicalChain.composerStage,
          openClawTierOverride: canonicalChain.openClawTierOverride,
          openClawAnalysis: canonicalChain.diagnostics.openClawAnalysis,
          openClawRaw: canonicalChain.diagnostics.openClawRaw,
          openClawError: canonicalChain.diagnostics.openClawError,
          openClawContextFiles: canonicalChain.diagnostics.openClawContextFiles,
          fabric: canonicalChain.diagnostics.fabric,
          rebuiltSystemPrompt: canonicalChain.rebuiltSystemPrompt,
          rebuiltUserPrompt: canonicalChain.rebuiltUserPrompt,
          routingPrompt: canonicalChain.routingPrompt,
          composedSystemPrompt: canonicalChain.composedSystemPrompt,
          composedUserPrompt: canonicalChain.composedUserPrompt,
          routingContextPrompt: canonicalChain.routingContextPrompt,
        },
        dispatch: {
          modelTier: effectiveTier,
          modelId: finalModelId,
          status: params.status,
          response: params.response,
          error: params.error,
          cost: params.cost,
        },
      }).catch?.(() => {})
    }

    appendTraceEntry({
      source: 'chat',
      level: 'info',
      title: 'Started assistant response',
      detail: `Conversation ${convId} is now streaming from ${TIER_DISPLAY_LABELS[effectiveTier]}.`,
      conversationId: convId,
      stage: 'local model',
      executionState: 'model_dispatch',
      relatedPanels: ['chat', 'execution', 'prompt_inspector', 'transparency'],
      entityLabel: effectiveTier,
    })

    await sendMessage({
      content: canonicalChain.rebuiltUserPrompt,
      tier: effectiveTier,
      conversationHistory: [...history, { role: 'user', content: canonicalChain.rebuiltUserPrompt }],
      settings: {
        ollamaModel: settings.ollamaModel,
        extendedThinking: settings.extendedThinking,
      },
      signal: abortRef.current.signal,
      // Plugin system prompt override
      prebuiltSystemPrompt: canonicalChain.rebuiltSystemPrompt,
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
          stage: 'local model',
          executionState: 'completed',
          relatedPanels: ['chat', 'execution', 'cost'],
          entityLabel: effectiveTier,
        })
        if (cost > 0) {
          addRecord({ id: crypto.randomUUID(), amount: cost, model: effectiveTier, conversationId: convId })
        }
        saveChainArtifact({
          status: 'completed',
          response: fullText,
          cost,
        })
        const conversationForVault = useConversationStore.getState().conversations.find((conversation) => conversation.id === convId)
        if (conversationForVault) {
          saveConversationToVault(conversationForVault)
            .then((result) => {
              appendTraceEntry({
                source: 'memory',
                level: result.success ? 'success' : 'warn',
                title: result.success ? 'Conversation written to ArcVault' : 'Conversation write-back failed',
                detail: result.success
                  ? result.filePath ?? 'ARCOS conversation exported to vault.'
                  : result.error ?? 'Vault write failed.',
                conversationId: convId,
                relatedPanels: ['memory', 'chat', 'history'],
                entityLabel: conversationForVault.id,
              })
            })
            .catch((vaultError) => {
              appendTraceEntry({
                source: 'memory',
                level: 'error',
                title: 'Conversation write-back threw an error',
                detail: String(vaultError),
                conversationId: convId,
                relatedPanels: ['memory', 'chat', 'history'],
                entityLabel: conversationForVault.id,
              })
            })
        }
        setStagedMemory(null)
        setMemoryError(null)
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
          stage: 'local model',
          executionState: 'failed',
          relatedPanels: ['chat', 'execution', 'services'],
          entityLabel: effectiveTier,
        })
        saveChainArtifact({
          status: 'failed',
          error: err.message,
          cost: 0,
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
      void handleSend()
    }
  }

  return (
    <div className="space-y-2">
      {stagedMemory && (
        <div className="rounded-xl border border-border bg-surface px-3 py-3">
          <div className="flex items-start justify-between gap-3">
            <div>
              <p className="text-xs font-semibold uppercase tracking-wider text-accent">Memory Staged</p>
              <p className="mt-1 text-xs text-text-muted">
                {stagedMemory.citations.length} citations from "{stagedMemory.query}" · {stagedMemory.queryTimeMs}ms
              </p>
            </div>
            <button
              onClick={() => {
                setStagedMemory(null)
                setMemoryError(null)
              }}
              className="text-[11px] text-text-muted transition-colors hover:text-text"
            >
              Clear
            </button>
          </div>
          <div className="mt-3 space-y-2">
            {stagedMemory.citations.map((citation, index) => (
              <div key={`${citation.source_path}-${index}`} className="flex items-start gap-2 rounded-lg border border-border bg-[#12161b] px-3 py-2">
                <div className="min-w-0 flex-1">
                  <p className="text-xs font-medium text-text">{citation.title}</p>
                  <p className="mt-0.5 text-[11px] text-text-muted">
                    {sourceLabel(citation.source_type)} · {citation.date}
                  </p>
                  <p className="mt-1 text-xs leading-5 text-text-muted">{citation.excerpt}</p>
                </div>
                <div className="flex shrink-0 items-center gap-1">
                  <button
                    onClick={() => window.electron.openExternal(citation.obsidian_uri)}
                    className="arcos-action rounded px-2 py-1 text-[10px] uppercase tracking-wider"
                  >
                    Obsidian
                  </button>
                  <button
                    onClick={() => {
                      setStagedMemory((current) => {
                        if (!current) return current
                        const citations = current.citations.filter((item) => item.source_path !== citation.source_path)
                        return citations.length > 0 ? { ...current, citations } : null
                      })
                    }}
                    className="rounded px-2 py-1 text-[10px] uppercase tracking-wider text-text-muted transition-colors hover:text-danger"
                  >
                    Remove
                  </button>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {memoryCommandQuery && !sending && (
        <div className="flex items-center gap-2 px-1 text-xs text-text-muted">
          <span>🧠</span>
          <span className="font-medium text-accent">Memory query</span>
          <span className="opacity-60">{memoryRunning ? `Enter runs search for "${memoryCommandQuery}"` : 'ARC-Memory offline'}</span>
        </div>
      )}

      {/* Routing preview */}
      {previewTier && text.trim() && !sending && !memoryCommandQuery && (
        <div className="flex items-center gap-2 px-1 text-xs text-text-muted">
          <span>→</span>
          <span className={`font-medium ${TIER_COLORS[previewTier]}`}>{TIER_DISPLAY_LABELS[previewTier]}</span>
          <span className="opacity-60">{previewReason}</span>
        </div>
      )}

      {memoryError && (
        <div className="flex items-center justify-between rounded-lg border border-danger/30 bg-danger/10 px-3 py-2 text-xs text-danger">
          <span>{memoryError}</span>
          <button onClick={() => setMemoryError(null)} className="ml-2 opacity-60 hover:opacity-100">✕</button>
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
          placeholder={
            sending
              ? 'Generating...'
              : memoryCommandQuery
              ? 'Press Enter to search memory...'
              : activePlugin
              ? `${activePlugin.icon} ${activePlugin.name} active — ask anything...`
              : stagedMemory
              ? 'Ask with staged memory context attached...'
              : 'Ask anything or type /command... (Enter to send)'
          }
          disabled={sending || memorySearching}
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
            onClick={() => void handleSend()}
            disabled={!text.trim() || memorySearching}
            className="flex-shrink-0 w-9 h-9 flex items-center justify-center rounded-lg bg-accent hover:bg-accent-hover disabled:opacity-40 disabled:cursor-not-allowed transition-colors text-white text-sm"
          >
            {memorySearching ? '…' : memoryCommandQuery ? '⌕' : '↑'}
          </button>
        )}
      </div>
    </div>
  )
}
