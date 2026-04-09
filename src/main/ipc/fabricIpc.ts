import { spawn } from 'child_process'
import type { IpcMain } from 'electron'
import { listFabricPatternsCli } from '../integrations/fabric/patterns'
import { log } from '../logger'
import { optionalString, requireObject, requireString } from './validation'

function buildFabricPatternUrlCandidates(pattern: string): Array<{ url: string; contentType: string; body: string }> {
  const encoded = encodeURIComponent(pattern)
  return [
    {
      url: `http://localhost:8080/api/pattern/${encoded}`,
      contentType: 'text/plain',
      body: '',
    },
    {
      url: `http://localhost:8080/pattern/${encoded}`,
      contentType: 'text/plain',
      body: '',
    },
    {
      url: 'http://localhost:8080/api/run',
      contentType: 'application/json',
      body: JSON.stringify({ pattern, input: '' }),
    },
  ]
}

export function registerFabricIpc(
  ipcMain: IpcMain,
  activeStreams: Map<string, AbortController>,
): void {
  ipcMain.handle('fabric-list-patterns', async () => {
    try {
      const res = await fetch('http://localhost:8080/api/patterns', {
        signal: AbortSignal.timeout(4000),
      })
      if (res.ok) {
        const data = await res.json() as unknown
        let patterns: string[] = []
        if (Array.isArray(data)) {
          patterns = data as string[]
        } else if (data && typeof data === 'object') {
          const obj = data as Record<string, unknown>
          if (Array.isArray(obj.patterns)) patterns = obj.patterns as string[]
          else if (Array.isArray(obj.data)) patterns = obj.data as string[]
        }
        return { success: true, patterns: patterns.sort() }
      }
    } catch {
      // Fall through to CLI fallback.
    }

    try {
      return { success: true, patterns: await listFabricPatternsCli() }
    } catch (error) {
      log.error('Fabric pattern list error', String(error))
      return { success: false, patterns: [] }
    }
  })

  ipcMain.handle('fabric-run-pattern', async (event, params: unknown) => {
    const payload = requireObject(params, 'Fabric run payload')
    const streamId = requireString(payload.streamId, 'stream id', 200)
    const pattern = requireString(payload.pattern, 'Fabric pattern', 200)
    const input = requireString(payload.input, 'Fabric input', 500_000)
    const model = optionalString(payload.model, 'Fabric model', 200)
    const controller = new AbortController()
    activeStreams.set(streamId, controller)

    const emit = (data: object) => {
      if (!event.sender.isDestroyed()) {
        event.sender.send(`stream-${streamId}`, data)
      }
    }

    const runViaCli = async () => {
      emit({ type: 'meta', mode: 'cli', stage: 'Fabric' })
      let fullText = ''
      let errText = ''
      const args = model
        ? ['-m', model, '--pattern', pattern, '--stream']
        : ['--pattern', pattern, '--stream']
      const child = spawn('fabric', args, {
        stdio: ['pipe', 'pipe', 'pipe'],
        env: {
          ...process.env,
          OLLAMA_HTTP_TIMEOUT: process.env.OLLAMA_HTTP_TIMEOUT ?? '300s',
        },
      })

      controller.signal.addEventListener('abort', () => {
        try {
          child.kill()
        } catch {
          // Best-effort process cleanup only.
        }
      })

      child.stdin.write(input)
      child.stdin.end()

      child.stdout.on('data', (chunk: Buffer | string) => {
        const token = chunk.toString()
        if (!token) return
        fullText += token
        emit({ type: 'token', token })
      })

      child.stderr.on('data', (chunk: Buffer | string) => {
        errText += chunk.toString()
      })

      await new Promise<void>((resolve, reject) => {
        child.on('error', reject)
        child.on('close', (code) => {
          if (controller.signal.aborted) {
            resolve()
            return
          }
          if (code === 0) {
            emit({ type: 'done', fullText })
            resolve()
            return
          }
          reject(new Error(errText.trim() || `Fabric exited with code ${code ?? 'unknown'}`))
        })
      })
    }

    const runViaServer = async () => {
      const candidates = buildFabricPatternUrlCandidates(pattern).map((candidate) => ({
        ...candidate,
        body: candidate.contentType === 'application/json' ? JSON.stringify({ pattern, input }) : input,
      }))

      for (const candidate of candidates) {
        try {
          const res = await fetch(candidate.url, {
            method: 'POST',
            headers: { 'Content-Type': candidate.contentType },
            body: candidate.body,
            signal: controller.signal,
          })

          if (!res.ok) {
            if (res.status === 404) continue

            let errText = `Fabric error ${res.status}`
            try {
              errText = await res.text()
            } catch {
              // Keep status-derived error text.
            }
            throw new Error(errText)
          }

          emit({ type: 'meta', mode: 'server', stage: 'Fabric' })
          const contentType = res.headers.get('content-type') ?? ''

          if (contentType.includes('text/event-stream') || contentType.includes('stream')) {
            if (!res.body) throw new Error('Fabric returned empty response body')
            const reader = res.body.getReader()
            const decoder = new TextDecoder()
            let buffer = ''
            let fullText = ''

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
                if (line.startsWith('data: ')) {
                  const raw = line.slice(6).trim()
                  if (raw === '[DONE]') {
                    emit({ type: 'done', fullText })
                    return
                  }
                  try {
                    const parsed = JSON.parse(raw) as Record<string, unknown>
                    const choices = parsed.choices as Array<{ delta?: { content?: string } }> | undefined
                    const token = choices?.[0]?.delta?.content
                      ?? (parsed.text as string | undefined)
                      ?? ''
                    if (token) {
                      fullText += token
                      emit({ type: 'token', token })
                    }
                  } catch {
                    if (raw) {
                      fullText += raw + '\n'
                      emit({ type: 'token', token: raw + '\n' })
                    }
                  }
                } else if (line.trim()) {
                  fullText += line + '\n'
                  emit({ type: 'token', token: line + '\n' })
                }
              }
            }
            emit({ type: 'done', fullText })
            return
          }

          const text = await res.text()
          emit({ type: 'token', token: text })
          emit({ type: 'done', fullText: text })
          return
        } catch (error) {
          if ((error as Error).name === 'AbortError') throw error
          log.warn('Fabric server execution attempt failed', `${candidate.url} :: ${String(error)}`)
        }
      }

      throw new Error('Fabric server routes unavailable')
    }

    try {
      await runViaServer()
    } catch (e) {
      if ((e as Error).name === 'AbortError') return
      try {
        await runViaCli()
      } catch (cliError) {
        emit({ type: 'error', error: String(cliError) })
      }
    } finally {
      activeStreams.delete(streamId)
    }
  })
}
