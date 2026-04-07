import { streamOllamaChat } from './ollamaService'
import { streamClaudeChat } from './claudeService'
import { loadArcPrompt } from './arcLoader'
import { ModelTier } from '../stores/types'
import { estimateCost, estimateTokens } from '../stores/costStore'
import { filterChatCapableOllamaModels, isChatCapableOllamaModel, useSettingsStore } from '../stores/settingsStore'

export interface ChatMessage {
  role: 'user' | 'assistant' | 'system'
  content: string
}

export interface SendOptions {
  content: string
  tier: ModelTier
  conversationHistory: ChatMessage[]
  settings: {
    ollamaModel: string
    extendedThinking: boolean
  }
  onToken: (token: string) => void
  onThinking?: (token: string) => void
  onComplete: (fullText: string, cost: number) => void
  onError: (error: Error) => void
  signal?: AbortSignal
  // Plugin overrides — when a plugin is active, these replace the defaults
  systemPromptOverride?: string
  prebuiltSystemPrompt?: string
  tierOverride?: ModelTier
}

export async function sendMessage(opts: SendOptions): Promise<void> {
  const {
    conversationHistory, settings,
    onToken, onThinking, onComplete, onError, signal,
    systemPromptOverride, prebuiltSystemPrompt, tierOverride,
  } = opts

  // Plugin overrides take precedence over router's tier decision
  const tier = tierOverride ?? opts.tier

  // Build chat messages (filter out system routing messages, keep user/assistant only)
  const chatHistory = conversationHistory
    .filter((m) => m.role === 'user' || m.role === 'assistant')
    .map((m) => ({ role: m.role as 'user' | 'assistant', content: m.content }))

  // ── Local: Ollama ─────────────────────────────────────────────
  if (tier === 'ollama') {
    let chatModel = settings.ollamaModel
    const installedModels = filterChatCapableOllamaModels(
      await window.electron.ollamaListModels().then((result) => result.models ?? []).catch(() => [])
    )

    if (installedModels.length === 0) {
      throw new Error('No chat-capable Ollama models are currently available.')
    }

    const configuredModelMissing = !installedModels.includes(chatModel)
    if (!isChatCapableOllamaModel(chatModel) || configuredModelMissing) {
      const fallbackModel = installedModels[0]
      const reason = !isChatCapableOllamaModel(chatModel)
        ? `Configured Ollama model "${chatModel}" is embedding-only.`
        : `Configured Ollama model "${chatModel}" is not installed.`
      window.electron.logAppend?.('warn', `${reason} Falling back to "${fallbackModel}".`)
      chatModel = fallbackModel
      useSettingsStore.getState().setOllamaModel(chatModel)
    }

    const ollamaMessages = prebuiltSystemPrompt
      ? [{ role: 'system', content: prebuiltSystemPrompt }, ...chatHistory]
      : chatHistory

    await streamOllamaChat(
      chatModel,
      ollamaMessages,
      {
        onToken,
        onThinking,
        onComplete: (text) => onComplete(text, 0),
        onError,
      },
      signal
    )
    return
  }

  // ── Cloud: Haiku, A.R.C. Sonnet, or A.R.C. Opus ─────────────
  // Note: API key check is deferred to main process — it will emit an error event
  // if the key is missing, which onError handles via the stream event listener.

  // Use plugin systemPrompt if provided, otherwise load A.R.C. prompt
  let systemPrompt: string
  if (prebuiltSystemPrompt) {
    systemPrompt = prebuiltSystemPrompt
    console.log('[Chat] Using prebuilt canonical chain prompt')
  } else if (systemPromptOverride) {
    systemPrompt = systemPromptOverride
    console.log('[Chat] Using plugin system prompt override')
  } else {
    const { prompt: arcPrompt, source } = await loadArcPrompt()
    console.log(`[Chat] Using A.R.C. prompt from: ${source}`)
    systemPrompt = arcPrompt
  }

  const model =
    tier === 'haiku' ? 'claude-haiku-4-5-20251001' :
    tier === 'arc-opus' ? 'claude-opus-4-6' :
    'claude-sonnet-4-6'

  // Capture exact token counts from the usage event (emitted before onComplete)
  let exactInputTokens: number | null = null
  let exactOutputTokens: number | null = null

  await streamClaudeChat(
    model,
    systemPrompt,
    chatHistory,
    {
      onToken,
      onComplete: (text) => {
        // Prefer exact API-reported counts; fall back to text-length estimates only if missing
        const inputTokens = exactInputTokens ?? estimateTokens(chatHistory.map((m) => m.content).join(' '))
        const outputTokens = exactOutputTokens ?? estimateTokens(text)
        const cost = estimateCost(tier, inputTokens, outputTokens)
        onComplete(text, cost)
      },
      onError,
      onUsage: (usage) => {
        exactInputTokens = usage.inputTokens
        exactOutputTokens = usage.outputTokens
        const cacheHit = usage.cacheRead > 0
        window.electron.logAppend?.('info',
          `Claude tokens — model=${model} in=${usage.inputTokens} out=${usage.outputTokens}` +
          (cacheHit ? ` cacheHit=${usage.cacheRead}` : '')
        )
      },
    },
    signal
  )
}
