import { StreamCallbacks } from './ollamaService'

export interface ClaudeUsage {
  inputTokens: number
  outputTokens: number
  cacheRead: number
  cacheWrite: number
}

export async function streamClaudeChat(
  model: string,
  systemPrompt: string,
  messages: Array<{ role: string; content: string }>,
  callbacks: StreamCallbacks & { onUsage?: (usage: ClaudeUsage) => void }
): Promise<void> {
  const streamId = crypto.randomUUID()
  let fullText = ''

  return new Promise<void>((resolve) => {
    const cleanup = window.electron.onStreamEvent(streamId, (raw) => {
      const data = raw as {
        type: string
        token?: string
        fullText?: string
        usage?: ClaudeUsage
        error?: string
      }

      if (data.type === 'token' && data.token) {
        fullText += data.token
        callbacks.onToken(data.token)
      } else if (data.type === 'done') {
        cleanup()
        if (data.usage) callbacks.onUsage?.(data.usage)
        const totalTokens = data.usage
          ? (data.usage.inputTokens + data.usage.outputTokens)
          : undefined
        callbacks.onComplete(data.fullText ?? fullText, totalTokens)
        resolve()
      } else if (data.type === 'error') {
        cleanup()
        callbacks.onError(new Error(data.error ?? 'Unknown Claude API error'))
        resolve()
      }
    })

    // Note: apiKey is intentionally omitted — main process reads it directly from DB
    void window.electron.claudeStreamStart({ streamId, model, systemPrompt, messages })
  })
}
