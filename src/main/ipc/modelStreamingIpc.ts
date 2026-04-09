import type { IpcMain } from 'electron'
import { log } from '../logger'

function makeEmitter(event: Electron.IpcMainInvokeEvent, streamId: string) {
  return (data: object) => {
    if (!event.sender.isDestroyed()) {
      event.sender.send(`stream-${streamId}`, data)
    }
  }
}

export function registerModelStreamingIpc(
  ipcMain: IpcMain,
  activeStreams: Map<string, AbortController>,
  getApiKeyFromDb: () => string,
  enforceExecutePermission: (action: string) => unknown,
): void {
  ipcMain.handle('ollama-stream-start', async (event, params: {
    streamId: string
    model: string
    messages: Array<{ role: string; content: string }>
  }) => {
    const { streamId, model, messages } = params
    const controller = new AbortController()
    activeStreams.set(streamId, controller)
    const emit = makeEmitter(event, streamId)

    try {
      const res = await fetch('http://localhost:11434/api/chat', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ model, messages, stream: true, think: true }),
        signal: controller.signal,
      })

      if (!res.ok) {
        const txt = await res.text()
        const msg = `Ollama error ${res.status}: ${txt}`
        log.error('Ollama stream error', msg)
        emit({ type: 'error', error: msg })
        return
      }

      if (!res.body) {
        log.error('Ollama stream: response body is null')
        emit({ type: 'error', error: 'Ollama returned empty response body' })
        return
      }
      const reader = res.body.getReader()
      const decoder = new TextDecoder()
      let fullText = ''
      let sawDoneEvent = false
      let buffer = ''

      let doneReading = false
      while (!doneReading) {
        const { done, value } = await reader.read()
        if (done) {
          doneReading = true
          break
        }
        buffer += decoder.decode(value, { stream: true })
        const lines = buffer.split('\n')
        buffer = lines.pop() ?? ''

        for (const line of lines.map((entry) => entry.trim()).filter(Boolean)) {
          try {
            const data = JSON.parse(line) as { message?: { content?: string; thinking?: string }; done?: boolean; eval_count?: number }
            if (data.message?.thinking) emit({ type: 'thinking', token: data.message.thinking })
            if (data.message?.content) {
              fullText += data.message.content
              emit({ type: 'token', token: data.message.content })
            }
            if (data.done) {
              sawDoneEvent = true
              emit({ type: 'done', fullText, evalTokens: data.eval_count })
              return
            }
          } catch {
            // Ignore malformed incremental stream lines.
          }
        }
      }

      const finalLine = buffer.trim()
      if (finalLine) {
        try {
          const data = JSON.parse(finalLine) as { message?: { content?: string; thinking?: string }; done?: boolean; eval_count?: number }
          if (data.message?.thinking) emit({ type: 'thinking', token: data.message.thinking })
          if (data.message?.content) {
            fullText += data.message.content
            emit({ type: 'token', token: data.message.content })
          }
          if (data.done) {
            sawDoneEvent = true
            emit({ type: 'done', fullText, evalTokens: data.eval_count })
            return
          }
        } catch {
          // Ignore trailing malformed buffer.
        }
      }
      if (!sawDoneEvent && !fullText.trim()) {
        const msg = 'Ollama ended the stream without returning any tokens.'
        log.error('Ollama stream error', msg)
        emit({ type: 'error', error: msg })
        return
      }
      emit({ type: 'done', fullText })
    } catch (e) {
      if ((e as Error).name !== 'AbortError') {
        emit({ type: 'error', error: String(e) })
      }
    } finally {
      activeStreams.delete(streamId)
    }
  })

  ipcMain.handle('claude-stream-start', async (event, params: {
    streamId: string
    model: string
    systemPrompt: string
    messages: Array<{ role: string; content: string }>
  }) => {
    const apiKey = getApiKeyFromDb()
    const { streamId, model, systemPrompt, messages } = params
    const controller = new AbortController()
    activeStreams.set(streamId, controller)
    const emit = makeEmitter(event, streamId)

    if (!apiKey) {
      emit({ type: 'error', error: 'Claude API key not set. Go to Settings -> API Keys to add it.' })
      activeStreams.delete(streamId)
      return
    }

    try {
      const res = await fetch('https://api.anthropic.com/v1/messages', {
        method: 'POST',
        headers: {
          'x-api-key': apiKey,
          'anthropic-version': '2023-06-01',
          'content-type': 'application/json',
          'anthropic-beta': 'prompt-caching-2024-07-31',
        },
        body: JSON.stringify({
          model,
          max_tokens: 8096,
          system: [{ type: 'text', text: systemPrompt, cache_control: { type: 'ephemeral' } }],
          messages,
          stream: true,
        }),
        signal: controller.signal,
      })

      if (!res.ok) {
        let errMsg = `Claude API error ${res.status}`
        try {
          const e = await res.json() as { error?: { message?: string } }
          errMsg = e.error?.message ?? errMsg
        } catch {
          // Fallback to status-based error message.
        }
        log.error('Claude API error', `model=${model} status=${res.status} ${errMsg}`)
        emit({ type: 'error', error: errMsg })
        return
      }

      if (!res.body) {
        log.error('Claude stream: response body is null')
        emit({ type: 'error', error: 'Claude returned empty response body' })
        return
      }
      const reader = res.body.getReader()
      const decoder = new TextDecoder()
      let buffer = ''
      let fullText = ''
      const usage = { inputTokens: 0, outputTokens: 0, cacheRead: 0, cacheWrite: 0 }

      let doneReading = false
      while (!doneReading) {
        const { done, value } = await reader.read()
        if (done) {
          doneReading = true
          break
        }
        buffer += decoder.decode(value, { stream: true })
        const lines = buffer.split('\n')
        buffer = lines.pop() ?? ''

        for (const line of lines) {
          if (!line.startsWith('data: ')) continue
          const raw = line.slice(6).trim()
          if (raw === '[DONE]') continue
          try {
            const evt = JSON.parse(raw) as {
              type: string
              delta?: { type?: string; text?: string }
              message?: { usage?: { input_tokens?: number; cache_read_input_tokens?: number; cache_creation_input_tokens?: number } }
              usage?: { output_tokens?: number }
            }

            if (evt.type === 'message_start' && evt.message?.usage) {
              usage.inputTokens = evt.message.usage.input_tokens ?? 0
              usage.cacheRead = evt.message.usage.cache_read_input_tokens ?? 0
              usage.cacheWrite = evt.message.usage.cache_creation_input_tokens ?? 0
            }
            if (evt.type === 'content_block_delta' && evt.delta?.type === 'text_delta') {
              const token = evt.delta.text ?? ''
              fullText += token
              emit({ type: 'token', token })
            }
            if (evt.type === 'message_delta' && evt.usage) {
              usage.outputTokens = evt.usage.output_tokens ?? 0
            }
            if (evt.type === 'message_stop') {
              emit({ type: 'done', fullText, usage })
              return
            }
          } catch {
            // Ignore malformed SSE frames and continue streaming.
          }
        }
      }
      emit({ type: 'done', fullText, usage })
    } catch (e) {
      if ((e as Error).name !== 'AbortError') {
        emit({ type: 'error', error: String(e) })
      }
    } finally {
      activeStreams.delete(streamId)
    }
  })

  ipcMain.handle('ollama-pull-model', async (event, params: {
    streamId: string
    modelName: string
  }) => {
    const denied = enforceExecutePermission(`pulling Ollama model ${params.modelName}`)
    if (denied) return denied
    const { streamId, modelName } = params
    const controller = new AbortController()
    activeStreams.set(streamId, controller)
    const emit = makeEmitter(event, streamId)

    try {
      const res = await fetch('http://localhost:11434/api/pull', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: modelName, stream: true }),
        signal: controller.signal,
      })

      if (!res.ok) {
        const txt = await res.text()
        emit({ type: 'error', error: `Ollama pull error ${res.status}: ${txt}` })
        return
      }
      if (!res.body) {
        emit({ type: 'error', error: 'Ollama returned empty pull response body' })
        return
      }

      const reader = res.body.getReader()
      const decoder = new TextDecoder()
      let doneReading = false
      while (!doneReading) {
        const { done, value } = await reader.read()
        if (done) {
          doneReading = true
          break
        }
        const chunk = decoder.decode(value, { stream: true })
        for (const line of chunk.split('\n').filter(Boolean)) {
          try {
            const data = JSON.parse(line) as {
              status?: string
              digest?: string
              total?: number
              completed?: number
            }
            if (data.status === 'success') {
              emit({ type: 'done' })
              return
            }
            emit({
              type: 'progress',
              status: data.status ?? '',
              total: data.total,
              completed: data.completed,
            })
          } catch {
            // Ignore malformed model-pull progress lines.
          }
        }
      }
      emit({ type: 'done' })
    } catch (e) {
      if ((e as Error).name !== 'AbortError') {
        emit({ type: 'error', error: String(e) })
      }
    } finally {
      activeStreams.delete(streamId)
    }
  })

  ipcMain.handle('stream-abort', (_event, streamId: string) => {
    const controller = activeStreams.get(streamId)
    controller?.abort()
    activeStreams.delete(streamId)
    return { abortedCount: controller ? 1 : 0 }
  })
}
