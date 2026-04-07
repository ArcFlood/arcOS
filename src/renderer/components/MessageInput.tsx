import { useState, useRef, useEffect, useMemo, useCallback, KeyboardEvent } from 'react'
import { useConversationStore } from '../stores/conversationStore'
import { useSettingsStore } from '../stores/settingsStore'
import { useServiceStore } from '../stores/serviceStore'
import { estimateCost, estimateTokens, useCostStore } from '../stores/costStore'
import { usePluginStore } from '../stores/pluginStore'
import { ModelTier, PaiVoiceSection } from '../stores/types'
import { useMessageQueueStore } from '../stores/messageQueueStore'
import { useTraceStore } from '../stores/traceStore'
import { sendMessage } from '../services/chatService'
import type { TaskPacket } from '../stores/types'
import { executeCanonicalChain } from '../services/canonicalChainService'
import { classifyTaskArea, modelForTaskArea, routeQuery, TIER_DISPLAY_LABELS } from '../utils/routing'
import { searchMemory, MemoryCitation, sourceLabel } from '../services/memoryService'
import { saveConversationToVault } from '../utils/exportConversation'

interface Props {
  conversationId: string | null
  disabled?: boolean
  onConversationCreated?: (conversationId: string) => void
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

function extractSection(text: string, heading: string, nextHeadings: string[]): string {
  const escape = (value: string) => value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
  const regex = new RegExp(`${escape(heading)}:\\s*([\\s\\S]*?)(?=\\n(?:${nextHeadings.map(escape).join('|')}):|$)`, 'i')
  const match = text.match(regex)
  if (!match) return ''
  return match[1]
    .replace(/```[\s\S]*?```/g, ' ')
    .replace(/`([^`]+)`/g, '$1')
    .replace(/\s+/g, ' ')
    .trim()
}

function firstSentences(text: string, maxSentences = 5): string {
  return text
    .split(/(?<=[.!?])\s+/)
    .map((entry) => entry.trim())
    .filter(Boolean)
    .slice(0, maxSentences)
    .join(' ')
}

const PAI_VOICE_SECTION_ORDER: PaiVoiceSection[] = ['ANSWER', 'SUMMARY', 'ANALYSIS', 'ACTIONS', 'RESULTS', 'STATUS', 'CAPTURE', 'NEXT', 'COMPLETED']

function extractPaiVoiceSection(text: string, section: PaiVoiceSection, nextHeadings: PaiVoiceSection[]): string {
  if (section !== 'ANSWER') return extractSection(text, section, nextHeadings)
  return extractSection(text, 'ANSWER', nextHeadings) || extractSection(text, 'ANSWERS', nextHeadings)
}

function buildVoiceSummaryFromPaiResponse(text: string, sections: PaiVoiceSection[]): string {
  const selectedSections: PaiVoiceSection[] = sections.length > 0 ? sections : ['RESULTS', 'NEXT']
  const fragments = selectedSections.flatMap((section) => {
    const index = PAI_VOICE_SECTION_ORDER.indexOf(section)
    const nextHeadings = index >= 0 ? PAI_VOICE_SECTION_ORDER.slice(index + 1) : []
    const content = extractPaiVoiceSection(text, section, nextHeadings)
    return content ? [`${section.toLowerCase().replace(/^\w/, (char) => char.toUpperCase())}. ${content}`] : []
  })
  return firstSentences(
    fragments.join(' '),
    5
  )
}

function sanitizeVoiceSummary(text: string): string {
  return text
    .normalize('NFKD')
    .replace(/[^\x20-\x7E]/g, ' ')
    .replace(/[;&|><`$(){}[\]\\]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 500)
}

function compactThinkingPreview(text: string, max = 900): string {
  const cleaned = text.replace(/\s+/g, ' ').trim()
  if (!cleaned) return 'No thinking text captured.'
  return cleaned.length <= max ? cleaned : `${cleaned.slice(0, max)}…`
}

const ARCOS_VOICE_PLAYBACK_ENABLED = true
let terminalSendQueue: Promise<void> = Promise.resolve()

export default function MessageInput({ conversationId, disabled = false, onConversationCreated }: Props) {
  const [text, setText] = useState('')
  const [sending, setSending] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [voiceMode, setVoiceMode] = useState(false)
  const [fastTestMode, setFastTestMode] = useState(false)
  const [memorySearching, setMemorySearching] = useState(false)
  // Task Mode (Item 19)
  const [taskModeOpen, setTaskModeOpen] = useState(false)
  const [taskPacket, setTaskPacket] = useState<Partial<TaskPacket>>({
    objective: '', scope: '', expectedOutputFormat: 'prose', retryPolicy: 'none',
  })
  const [memoryError, setMemoryError] = useState<string | null>(null)
  const [stagedMemory, setStagedMemory] = useState<{
    query: string
    citations: MemoryCitation[]
    queryTimeMs: number
    totalResults: number
  } | null>(null)
  const textareaRef = useRef<HTMLTextAreaElement>(null)
  const abortRef = useRef<AbortController | null>(null)
  const voiceModeRef = useRef(false)
  const voiceAudioRef = useRef<HTMLAudioElement | null>(null)

  const createConversation = useConversationStore((s) => s.createConversation)
  const addMessage = useConversationStore((s) => s.addMessage)
  const updateMessage = useConversationStore((s) => s.updateMessage)
  const setConversationStatus = useConversationStore((s) => s.setConversationStatus)

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
  const queueActive = useMessageQueueStore((s) => s.active)
  const queuedMessages = useMessageQueueStore((s) => s.queued)
  const enqueueMessage = useMessageQueueStore((s) => s.enqueue)
  const startQueuedMessage = useMessageQueueStore((s) => s.start)
  const finishQueuedMessage = useMessageQueueStore((s) => s.finish)
  const appendTraceEntry = useTraceStore((s) => s.appendEntry)

  voiceModeRef.current = voiceMode

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

  const handleMemorySearch = useCallback(async () => {
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
  }, [memoryCommandQuery, memoryRunning, appendTraceEntry])

  const handleSendWithText = useCallback(async (rawText: string) => {
    const trimmed = rawText.trim()
    if (!trimmed || memorySearching || disabled) return

    if (trimmed.startsWith('/memory')) {
      await handleMemorySearch()
      return
    }

    const convId = conversationId ?? createConversation()
    onConversationCreated?.(convId)
    const queueId = crypto.randomUUID()
    enqueueMessage({
      id: queueId,
      conversationId: convId,
      preview: trimmed.slice(0, 96),
      enqueuedAt: Date.now(),
    })
    setText('')

    const runQueuedSend = async () => {
    startQueuedMessage(queueId)
    const draftToRestore = rawText
    setError(null)
    setSending(true)
    // Drive session state machine → sending
    setConversationStatus(convId, 'sending')

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

    try {
      // Build history from current conversation (before adding new message)
      const currentConversation = useConversationStore.getState().conversations.find((conversation) => conversation.id === convId)
      const history = (currentConversation?.messages ?? []).map((m) => ({
        role: m.role,
        content: m.content,
      }))

      // Add user message to store (show original text including command)
      // Build task packet if Task Mode is active (Item 19)
      const activeTaskPacket: TaskPacket | undefined =
        taskModeOpen && taskPacket.objective?.trim()
          ? {
              objective: taskPacket.objective!.trim(),
              scope: taskPacket.scope?.trim() || undefined,
              expectedOutputFormat: taskPacket.expectedOutputFormat ?? 'prose',
              retryPolicy: taskPacket.retryPolicy ?? 'none',
            }
          : undefined
      const taskArea = classifyTaskArea(resolvedContent)
      const assignedLocalModel = modelForTaskArea(settings.modelAssignments, taskArea, settings.ollamaModel)

      addMessage(convId, {
        role: 'user',
        content: displayContent,
        model: null,
        cost: 0,
        timestamp: Date.now(),
        taskPacket: activeTaskPacket,
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

      const canonicalChain = fastTestMode
        ? {
            rebuiltUserPrompt: resolvedContent,
            rebuiltSystemPrompt: '',
            usesPaiSystemPrompt: false,
            routingPrompt: resolvedContent,
            composedUserPrompt: resolvedContent,
            composedSystemPrompt: '',
            routingContextPrompt: resolvedContent,
            composerStage: {
              canonicalName: 'Response Composer' as const,
              legacyName: 'prompt rebuilder' as const,
            },
            openClawTierOverride: undefined,
            diagnostics: {
              chainPath: 'direct-pass-through' as const,
              openClawAnalysis: undefined,
              openClawRaw: undefined,
              openClawError: null,
              openClawContextFiles: [],
              fabric: {
                requestedPattern: null,
                requestedIntent: null,
                resolvedPattern: null,
                strategy: 'unresolved' as const,
                reason: 'Fast Terminal test bypass skips PAI, OpenClaw, Fabric, and required response format.',
                installedPatternCount: 0,
                executed: false,
                error: null,
              },
            },
          }
        : await executeCanonicalChain({
            prompt: resolvedContent,
            conversationId: convId,
            conversationHistory: history,
            isConversationStart: history.filter((message) => message.role === 'user' || message.role === 'assistant').length === 0,
            memoryCitations: stagedMemory?.citations ?? [],
            plugin: resolvedPlugin,
            preferredLocalModel: assignedLocalModel,
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
        ? `${routedReason} · Claude API key missing, falling back to ${TIER_DISPLAY_LABELS.ollama}. Task area: ${taskArea}.`
        : `${routedReason} Task area: ${taskArea}.`

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
        relatedPanels: ['routing', resolvedPlugin ? 'tools' : 'prompt_inspector', 'transparency'],
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

      const finalModelId = modelIdForTier(effectiveTier, assignedLocalModel)

      // Add placeholder assistant message
      const assistantMsg = addMessage(convId, {
        role: 'assistant',
        content: '',
        model: effectiveTier,
        modelLabel: finalModelId,
        cost: 0,
        timestamp: Date.now(),
        isStreaming: true,
        routingReason: effectiveReason,
      })

      // Stream the response
      abortRef.current = new AbortController()
      let accumulatedContent = ''
      let accumulatedThinking = ''
      let thinkingTraceStarted = false
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
            usesPaiSystemPrompt: canonicalChain.usesPaiSystemPrompt,
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
        title: fastTestMode ? 'Started fast Terminal test response' : 'Started assistant response',
        detail: fastTestMode
          ? `Thread ${convId} is bypassing PAI context, OpenClaw, Fabric, and required response format for debugging.`
          : `Conversation ${convId} is now streaming from ${TIER_DISPLAY_LABELS[effectiveTier]}.`,
        conversationId: convId,
        stage: 'local model',
        executionState: 'model_dispatch',
        relatedPanels: ['chat', 'prompt_inspector', 'transparency'],
        entityLabel: effectiveTier,
      })

      // Fire plugin beforeMessage hook if active plugin has one (Item 18)
      if (resolvedPlugin?.hooks?.beforeMessage) {
        window.electron.pluginRunHook({
          pluginId: resolvedPlugin.id,
          pluginName: resolvedPlugin.name,
          hookType: 'beforeMessage',
          hookValue: resolvedPlugin.hooks.beforeMessage,
        }).catch(console.error)
      }

      await sendMessage({
        content: canonicalChain.rebuiltUserPrompt,
        tier: effectiveTier,
        conversationHistory: [...history, { role: 'user', content: canonicalChain.rebuiltUserPrompt }],
        settings: {
          ollamaModel: assignedLocalModel,
          extendedThinking: settings.extendedThinking,
        },
        signal: abortRef.current.signal,
        // Plugin system prompt override
        prebuiltSystemPrompt: canonicalChain.usesPaiSystemPrompt ? canonicalChain.rebuiltSystemPrompt : undefined,
        systemPromptOverride: resolvedPlugin?.systemPrompt,
        tierOverride: resolvedPlugin?.tier,
        onToken: (token) => {
          accumulatedContent += token
          updateMessage(convId, assistantMsg.id, {
            content: accumulatedContent,
            isStreaming: true,
          })
          // Transition to streaming on first token
          if (accumulatedContent.length === token.length) {
            setConversationStatus(convId, 'streaming')
            window.electron.logAppend?.('info', `Ollama stream visible content started for thread ${convId}.`, undefined, 'prompt_delivery')
          }
        },
        onThinking: (token) => {
          accumulatedThinking += token
          if (!thinkingTraceStarted) {
            thinkingTraceStarted = true
            appendTraceEntry({
              source: 'chat',
              level: 'info',
              title: 'Model thinking started',
              detail: 'Ollama is emitting thinking chunks. ARCOS is capturing them in Transparency instead of the Terminal message.',
              conversationId: convId,
              stage: 'local model',
              executionState: 'model_dispatch',
              relatedPanels: ['transparency', 'services'],
              entityLabel: finalModelId,
            })
          }
          if (accumulatedContent.length === 0 && accumulatedThinking.length === token.length) {
            setConversationStatus(convId, 'streaming')
            window.electron.logAppend?.('info', `Ollama stream thinking content started for thread ${convId}.`, undefined, 'prompt_delivery')
          }
        },
        onComplete: (fullText, cost) => {
          const finalText = fullText || accumulatedContent
          updateMessage(convId, assistantMsg.id, {
            content: finalText,
            cost,
            isStreaming: false,
          })
          setConversationStatus(convId, 'finished')
          onConversationCreated?.(convId)
          window.electron.logAppend?.(
            'info',
            `Assistant response completed for thread ${convId}.`,
            `visibleChars=${finalText.length} thinkingChars=${accumulatedThinking.length}`,
            'prompt_delivery'
          )
          appendTraceEntry({
            source: 'chat',
            level: 'success',
            title: 'Completed assistant response',
            detail: `Received ${finalText.length} characters${cost > 0 ? ` at cost $${cost.toFixed(4)}` : ' with no cloud cost'}.`,
            conversationId: convId,
            stage: 'local model',
            executionState: 'completed',
            relatedPanels: ['chat', 'cost', 'transparency'],
            entityLabel: effectiveTier,
          })
          if (accumulatedThinking.trim()) {
            appendTraceEntry({
              source: 'chat',
              level: 'info',
              title: 'Model thinking captured',
              detail: compactThinkingPreview(accumulatedThinking),
              conversationId: convId,
              stage: 'local model',
              executionState: 'completed',
              relatedPanels: ['transparency', 'services'],
              entityLabel: finalModelId,
            })
          }
          if (cost > 0) {
            addRecord({ id: crypto.randomUUID(), amount: cost, model: effectiveTier, conversationId: convId })
          }
          saveChainArtifact({
            status: 'completed',
            response: finalText,
            cost,
          })
          if (ARCOS_VOICE_PLAYBACK_ENABLED && voiceModeRef.current) {
            const spokenSummary = sanitizeVoiceSummary(buildVoiceSummaryFromPaiResponse(finalText, settings.voiceReadSections))
            if (spokenSummary) {
              window.electron.voiceSynthesize({
                message: spokenSummary,
              }).then((result) => {
                if (!result.success && result.error) {
                  setError(result.error)
                  return
                }
                if (!result.audioDataUrl) return
                voiceAudioRef.current?.pause()
                const audio = new Audio(result.audioDataUrl)
                voiceAudioRef.current = audio
                audio.play().catch((error) => {
                  setError(`ARCOS voice playback failed: ${String(error)}`)
                })
              }).catch(() => {})
            }
          }
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
            relatedPanels: ['chat', 'services', 'transparency'],
            entityLabel: effectiveTier,
          })
          saveChainArtifact({
            status: 'failed',
            error: err.message,
            cost: 0,
          })
          setConversationStatus(convId, 'error')
          setError(err.message)
          setText(draftToRestore)
          setSending(false)
        },
      })
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err)
      setError(message)
      setText(draftToRestore)
      setConversationStatus(convId, 'error')
      setSending(false)
    } finally {
      finishQueuedMessage(queueId)
    }
    }

    terminalSendQueue = terminalSendQueue.then(runQueuedSend, runQueuedSend)
    void terminalSendQueue
  }, [
    memorySearching,
    disabled,
    handleMemorySearch,
    conversationId,
    createConversation,
    onConversationCreated,
    enqueueMessage,
    startQueuedMessage,
    finishQueuedMessage,
    taskModeOpen,
    taskPacket,
    stagedMemory,
    appendTraceEntry,
    openClawRunning,
    fabricRunning,
    settings.ollamaModel,
    settings.modelAssignments,
    settings.routingMode,
    settings.routingAggressiveness,
    settings.dailyBudgetLimit,
    settings.extendedThinking,
    settings.voiceReadSections,
    fastTestMode,
    activePlugin,
    findByCommand,
    activatePlugin,
    ollamaRunning,
    spendingToday,
    hasApiKey,
    updateMessage,
    addMessage,
    addRecord,
    setConversationStatus,
  ])

  const handleSend = async () => {
    await handleSendWithText(text)
  }

  const handleStop = () => {
    abortRef.current?.abort()
    setSending(false)
    if (conversationId) setConversationStatus(conversationId, 'idle')
  }

  const handleKeyDown = (e: KeyboardEvent<HTMLTextAreaElement>) => {
    if (disabled) return
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault()
      void handleSendWithText(text)
    }
  }

  const toggleVoiceMode = async () => {
    if (voiceMode) {
      setVoiceMode(false)
      return
    }

    if (!ARCOS_VOICE_PLAYBACK_ENABLED) {
      setError('Voice playback is temporarily disabled while Terminal generation is being debugged.')
      return
    }

    const status = await window.electron.voiceStatus()
    if (!status.apiKeyConfigured) {
      setError('ElevenLabs API key is not configured in the PAI voice environment.')
      return
    }
    if (!status.defaultVoiceId) {
      setError('ElevenLabs voice ID is not configured in the PAI voice environment.')
      return
    }

    setError(null)
    setVoiceMode(true)
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

      {voiceMode && (
        <div className="flex items-center gap-2 px-1 text-xs text-text-muted">
          <span className="text-success">●</span>
          <span>Voice playback active</span>
        </div>
      )}

      {fastTestMode && (
        <div className="flex items-center gap-2 px-1 text-xs text-warning">
          <span>●</span>
          <span>Fast test mode active: PAI, OpenClaw, Fabric, and required response format are bypassed.</span>
        </div>
      )}

      {(queueActive || queuedMessages.length > 0) && (
        <div className="flex flex-wrap items-center gap-2 px-1 text-xs text-text-muted">
          <span className={queueActive ? 'text-accent' : 'text-text-muted'}>●</span>
          <span>
            Queue {queueActive ? `running: "${queueActive.preview}"` : 'idle'}
            {queuedMessages.length > 0 ? ` · ${queuedMessages.length} waiting` : ''}
          </span>
        </div>
      )}

      {/* Task Mode panel (Item 19) */}
      {taskModeOpen && (
        <div className="rounded-lg border border-violet-700/40 bg-violet-950/20 px-3 py-2 space-y-1.5">
          <div className="flex items-center justify-between">
            <span className="text-[11px] font-semibold text-violet-300 uppercase tracking-wider">Task Mode</span>
            <button
              onClick={() => setTaskModeOpen(false)}
              className="text-[11px] text-slate-500 hover:text-slate-300"
            >
              ✕ Close
            </button>
          </div>
          <input
            type="text"
            placeholder="Objective (required for task packet)"
            value={taskPacket.objective ?? ''}
            onChange={(e) => setTaskPacket((p) => ({ ...p, objective: e.target.value }))}
            className="w-full bg-slate-800/60 border border-slate-600 rounded px-2 py-1 text-xs text-slate-200 placeholder-slate-500 focus:outline-none focus:border-violet-500"
          />
          <div className="flex gap-2">
            <input
              type="text"
              placeholder="Scope (optional)"
              value={taskPacket.scope ?? ''}
              onChange={(e) => setTaskPacket((p) => ({ ...p, scope: e.target.value }))}
              className="flex-1 bg-slate-800/60 border border-slate-600 rounded px-2 py-1 text-xs text-slate-200 placeholder-slate-500 focus:outline-none focus:border-violet-500"
            />
            <select
              value={taskPacket.expectedOutputFormat ?? 'prose'}
              onChange={(e) => setTaskPacket((p) => ({ ...p, expectedOutputFormat: e.target.value as TaskPacket['expectedOutputFormat'] }))}
              className="bg-slate-800/60 border border-slate-600 rounded px-2 py-1 text-xs text-slate-200 focus:outline-none focus:border-violet-500"
            >
              <option value="prose">Prose</option>
              <option value="json">JSON</option>
              <option value="code">Code</option>
              <option value="list">List</option>
              <option value="table">Table</option>
            </select>
            <select
              value={taskPacket.retryPolicy ?? 'none'}
              onChange={(e) => setTaskPacket((p) => ({ ...p, retryPolicy: e.target.value as TaskPacket['retryPolicy'] }))}
              className="bg-slate-800/60 border border-slate-600 rounded px-2 py-1 text-xs text-slate-200 focus:outline-none focus:border-violet-500"
            >
              <option value="none">No retry</option>
              <option value="once">Retry ×1</option>
              <option value="twice">Retry ×2</option>
            </select>
          </div>
        </div>
      )}

      {/* Input box */}
      <div className={`flex items-end gap-3 bg-surface border rounded-xl p-3 transition-colors ${sending ? 'border-accent/50' : taskModeOpen ? 'border-violet-700/60' : 'border-border'}`}>
        <div className="flex shrink-0 flex-col gap-2">
          <button
            onClick={() => void toggleVoiceMode()}
            title={voiceMode ? 'Disable voice playback' : 'Enable voice playback'}
            className={`flex h-7 w-7 items-center justify-center rounded text-xs transition-colors ${
              voiceMode
                ? 'border border-success/60 bg-success/15 text-success'
                : 'border border-transparent bg-transparent text-slate-600 hover:text-slate-400'
            }`}
          >
            🔊
          </button>
          <button
            onClick={() => setTaskModeOpen((v) => !v)}
            title="Toggle Task Mode — attach a structured task packet to this message"
            className={`flex h-7 w-7 items-center justify-center rounded text-xs transition-colors ${
              taskModeOpen
                ? 'bg-violet-700/40 text-violet-300 border border-violet-600/60'
                : 'bg-transparent text-slate-600 hover:text-slate-400 border border-transparent'
            }`}
          >
            ⊞
          </button>
          <button
            onClick={() => setFastTestMode((value) => !value)}
            title="Toggle Fast Test Mode — bypass PAI context and required response format"
            className={`flex h-7 w-7 items-center justify-center rounded text-[10px] font-semibold transition-colors ${
              fastTestMode
                ? 'border border-warning/60 bg-warning/15 text-warning'
                : 'border border-transparent bg-transparent text-slate-600 hover:text-slate-400'
            }`}
          >
            T
          </button>
        </div>
        <textarea
          ref={textareaRef}
          value={text}
          onChange={(e) => setText(e.target.value)}
          onKeyDown={handleKeyDown}
          placeholder={
            sending
              ? 'Queue another message...'
              : memoryCommandQuery
              ? 'Press Enter to search memory...'
              : disabled
              ? 'This terminal is idle.'
              : activePlugin
              ? `${activePlugin.icon} ${activePlugin.name} active — ask anything...`
              : stagedMemory
              ? 'Ask with staged memory context attached...'
              : 'Ask anything or type /command... (Enter to send)'
          }
          disabled={disabled || memorySearching}
          rows={1}
          className="flex-1 bg-transparent resize-none text-sm text-text placeholder:text-text-muted focus:outline-none leading-relaxed disabled:opacity-50 selectable"
          style={{ maxHeight: '200px' }}
          autoFocus
        />
        {sending ? (
          <div className="flex shrink-0 items-center gap-2">
            <button
              onClick={() => void handleSend()}
              disabled={disabled || !text.trim() || memorySearching}
              className="flex h-9 w-9 items-center justify-center rounded-lg border border-accent/50 bg-accent/15 text-xs text-accent transition-colors hover:bg-accent/25 disabled:cursor-not-allowed disabled:opacity-40"
              title="Queue message"
            >
              +
            </button>
            <button
              onClick={handleStop}
              className="flex h-9 w-9 items-center justify-center rounded-lg border border-border bg-surface-elevated text-xs text-text-muted transition-colors hover:bg-border"
              title="Stop generating"
            >
              ⏹
            </button>
          </div>
        ) : (
          <button
            onClick={() => void handleSend()}
            disabled={disabled || !text.trim() || memorySearching}
            className="flex-shrink-0 w-9 h-9 flex items-center justify-center rounded-lg bg-accent hover:bg-accent-hover disabled:opacity-40 disabled:cursor-not-allowed transition-colors text-white text-sm"
          >
            {memorySearching ? '…' : memoryCommandQuery ? '⌕' : '↑'}
          </button>
        )}
      </div>
    </div>
  )
}
