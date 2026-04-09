export interface StreamCallbacks {
  onToken: (token: string) => void
  onThinking?: (token: string) => void
  onComplete: (fullText: string, evalTokens?: number) => void
  onError: (error: Error) => void
}

export async function streamOllamaChat(
  model: string,
  messages: Array<{ role: string; content: string }>,
  callbacks: StreamCallbacks
): Promise<void> {
  const streamId = crypto.randomUUID()
  let fullText = ''
  let settled = false

  return new Promise<void>((resolve) => {
    const settle = () => {
      if (settled) return false
      settled = true
      return true
    }

    const timeout = window.setTimeout(() => {
      if (!settle()) return
      cleanup()
      callbacks.onError(new Error('Ollama stream timed out before ARCOS received a response.'))
      resolve()
    }, 90000)

    const cleanup = window.electron.onStreamEvent(streamId, (raw) => {
      const data = raw as { type: string; token?: string; fullText?: string; evalTokens?: number; error?: string }

      if (data.type === 'token' && data.token) {
        fullText += data.token
        callbacks.onToken(data.token)
      } else if (data.type === 'thinking' && data.token) {
        callbacks.onThinking?.(data.token)
      } else if (data.type === 'done') {
        if (!settle()) return
        window.clearTimeout(timeout)
        cleanup()
        callbacks.onComplete(data.fullText ?? fullText, data.evalTokens)
        resolve()
      } else if (data.type === 'error') {
        if (!settle()) return
        window.clearTimeout(timeout)
        cleanup()
        callbacks.onError(new Error(data.error ?? 'Unknown Ollama error'))
        resolve()
      }
    })

    void window.electron.ollamaStreamStart({ streamId, model, messages }).catch((error) => {
      if (!settle()) return
      window.clearTimeout(timeout)
      cleanup()
      callbacks.onError(error instanceof Error ? error : new Error(String(error)))
      resolve()
    })
  })
}

export async function listOllamaModels(): Promise<string[]> {
  const result = await window.electron.ollamaListModels()
  return result.models ?? []
}
