import fs from 'fs'
import os from 'os'
import path from 'path'

export type VoiceServerStatus = {
  healthy: boolean
  port: number
  apiKeyConfigured?: boolean
  defaultVoiceId?: string
  modelId?: string
  error?: string
}

type ElevenLabsConfig = {
  apiKey?: string
  voiceId?: string
  modelId?: string
}

function parseEnvFile(filePath: string): Record<string, string> {
  if (!fs.existsSync(filePath)) return {}
  const entries: Record<string, string> = {}
  for (const rawLine of fs.readFileSync(filePath, 'utf8').split('\n')) {
    const line = rawLine.trim()
    if (!line || line.startsWith('#')) continue
    const separator = line.indexOf('=')
    if (separator <= 0) continue
    const key = line.slice(0, separator).trim()
    const value = line.slice(separator + 1).trim().replace(/^['"]|['"]$/g, '')
    entries[key] = value
  }
  return entries
}

function getElevenLabsConfig(): ElevenLabsConfig {
  const home = os.homedir()
  const candidates = [
    path.join(home, '.claude', '.env'),
    path.join(home, 'pai', '.claude', '.env'),
    path.join(home, 'PAI', '.claude', '.env'),
    path.join(home, '.env'),
  ]

  const envFiles = candidates.map(parseEnvFile)
  const findValue = (key: string): string | undefined => {
    for (const env of envFiles) {
      const value = env[key]?.trim()
      if (value && !value.includes('your_') && !value.includes('_here')) return value
    }
    return process.env[key]?.trim() || undefined
  }

  return {
    apiKey: findValue('ELEVENLABS_API_KEY'),
    voiceId: findValue('ELEVENLABS_VOICE_ID'),
    modelId: findValue('ELEVENLABS_MODEL') ?? 'eleven_multilingual_v2',
  }
}

function getVoiceServerPort(): number {
  const home = os.homedir()
  const candidates = [
    path.join(home, 'pai', '.claude', 'config', 'profile.json'),
    path.join(home, 'PAI', '.claude', 'config', 'profile.json'),
    path.join(home, '.claude', 'config', 'profile.json'),
  ]

  for (const candidate of candidates) {
    try {
      if (!fs.existsSync(candidate)) continue
      const parsed = JSON.parse(fs.readFileSync(candidate, 'utf8')) as { voice?: { port?: number } }
      const port = parsed.voice?.port
      if (typeof port === 'number' && Number.isFinite(port) && port > 0) return port
    } catch {
      continue
    }
  }

  return 8888
}

export async function getVoiceServerStatus(): Promise<VoiceServerStatus> {
  const port = getVoiceServerPort()
  const elevenLabs = getElevenLabsConfig()
  try {
    const response = await fetch(`http://localhost:${port}/health`, { signal: AbortSignal.timeout(2000) })
    if (!response.ok) {
      return {
        healthy: false,
        port,
        apiKeyConfigured: Boolean(elevenLabs.apiKey),
        defaultVoiceId: elevenLabs.voiceId,
        modelId: elevenLabs.modelId,
        error: `HTTP ${response.status}`,
      }
    }
    const data = await response.json() as {
      status?: string
      api_key_configured?: boolean
      default_voice_id?: string
    }
    return {
      healthy: data.status === 'healthy',
      port,
      apiKeyConfigured: data.api_key_configured ?? Boolean(elevenLabs.apiKey),
      defaultVoiceId: data.default_voice_id ?? elevenLabs.voiceId,
      modelId: elevenLabs.modelId,
    }
  } catch (error) {
    return {
      healthy: false,
      port,
      apiKeyConfigured: Boolean(elevenLabs.apiKey),
      defaultVoiceId: elevenLabs.voiceId,
      modelId: elevenLabs.modelId,
      error: String(error),
    }
  }
}

export async function synthesizeElevenLabsAudio(params: { message: string; voiceId?: string }): Promise<{
  success: boolean
  audioDataUrl?: string
  contentType?: string
  charCount?: number
  error?: string
}> {
  const config = getElevenLabsConfig()
  const apiKey = config.apiKey
  const voiceId = params.voiceId?.trim() || config.voiceId
  const modelId = config.modelId ?? 'eleven_multilingual_v2'
  const text = params.message.trim()

  if (!text) return { success: false, error: 'Voice playback skipped: no text to synthesize.' }
  if (!apiKey) return { success: false, error: 'ElevenLabs API key is not configured in the PAI voice environment.' }
  if (!voiceId) return { success: false, error: 'ElevenLabs voice ID is not configured in the PAI voice environment.' }

  try {
    const response = await fetch(
      `https://api.elevenlabs.io/v1/text-to-speech/${encodeURIComponent(voiceId)}?output_format=mp3_44100_128`,
      {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'xi-api-key': apiKey,
        },
        body: JSON.stringify({
          text,
          model_id: modelId,
        }),
        signal: AbortSignal.timeout(30000),
      }
    )

    if (!response.ok) {
      let detail = `ElevenLabs synthesis failed with HTTP ${response.status}`
      try {
        const data = await response.json() as { detail?: { message?: string } | string; message?: string; error?: string }
        const message = typeof data.detail === 'string'
          ? data.detail
          : data.detail?.message ?? data.message ?? data.error
        if (message) detail = `${detail}: ${message}`
      } catch {
        // Keep status-only error when body is not JSON.
      }
      return { success: false, error: detail }
    }

    const contentType = response.headers.get('content-type') ?? 'audio/mpeg'
    const bytes = Buffer.from(await response.arrayBuffer())
    return {
      success: true,
      audioDataUrl: `data:${contentType};base64,${bytes.toString('base64')}`,
      contentType,
      charCount: text.length,
    }
  } catch (error) {
    return { success: false, error: String(error) }
  }
}

export async function sendVoiceNotification(params: { message: string; title?: string; voiceId?: string }): Promise<{ success: boolean; error?: string }> {
  const status = await getVoiceServerStatus()
  if (!status.healthy) {
    return { success: false, error: status.error ?? `Voice server unavailable on port ${status.port}` }
  }

  try {
    const response = await fetch(`http://localhost:${status.port}/notify`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        title: params.title ?? 'ARCOS Voice',
        message: params.message,
        voice_enabled: true,
        ...(params.voiceId ? { voice_id: params.voiceId } : {}),
      }),
      signal: AbortSignal.timeout(5000),
    })
    if (!response.ok) {
      let detail = `Voice notify failed with HTTP ${response.status}`
      try {
        const data = await response.json() as { message?: string; error?: string; detail?: { message?: string } | string }
        const message = typeof data.detail === 'string'
          ? data.detail
          : data.detail?.message ?? data.message ?? data.error
        if (message) {
          detail = `${detail}: ${message}`
        }
      } catch {
        // Keep generic HTTP error if response body is not JSON.
      }
      return { success: false, error: detail }
    }
    return { success: true }
  } catch (error) {
    return { success: false, error: String(error) }
  }
}
