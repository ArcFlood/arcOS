import { randomUUID } from 'crypto'
import { listFabricPatternsCli } from '../fabric/patterns'
import { getOpenClawGatewaySettings, runOpenClawGatewayCall } from './runtime'

export type OpenClawAnalysisRequest = {
  conversationId: string
  prompt: string
  conversationSection: string
  memorySection: string
  pluginSummary: string
}

export type OpenClawAnalysisPayload = {
  summary?: string
  intent?: string
  workflow?: string
  recommended_tier?: string
  recommended_model?: string
  should_use_fabric?: boolean
  fabric_pattern?: string | null
  fabric_intent?: string | null
  confidence?: number | null
  reasoning?: string
  notes?: string[]
}

async function listFabricPatternsForAnalysis(): Promise<string[]> {
  try {
    return await listFabricPatternsCli()
  } catch {
    return []
  }
}

function extractOpenClawMessageText(message: unknown): string {
  if (!message || typeof message !== 'object') return ''
  const record = message as { content?: unknown }
  if (typeof record.content === 'string') return record.content
  if (!Array.isArray(record.content)) return ''

  return record.content
    .map((part) => {
      if (!part || typeof part !== 'object') return ''
      const block = part as { type?: string; text?: string }
      return block.type === 'text' && typeof block.text === 'string' ? block.text : ''
    })
    .filter(Boolean)
    .join('\n')
}

function extractJsonObject(text: string): string | null {
  const fenced = text.match(/```(?:json)?\s*([\s\S]*?)```/i)
  if (fenced?.[1]) {
    const fencedContent = fenced[1].trim()
    if (fencedContent.startsWith('{') && fencedContent.endsWith('}')) return fencedContent
  }

  const firstBrace = text.indexOf('{')
  const lastBrace = text.lastIndexOf('}')
  if (firstBrace === -1 || lastBrace === -1 || lastBrace <= firstBrace) return null
  return text.slice(firstBrace, lastBrace + 1).trim()
}

function looksLikeOpenClawAnalysis(value: unknown): value is OpenClawAnalysisPayload {
  if (!value || typeof value !== 'object') return false
  const candidate = value as Record<string, unknown>
  return typeof candidate.summary === 'string'
    && typeof candidate.intent === 'string'
    && typeof candidate.workflow === 'string'
    && typeof candidate.reasoning === 'string'
}

function extractBalancedJsonObjects(text: string): string[] {
  const results: string[] = []
  let start = -1
  let depth = 0
  let inString = false
  let escaped = false

  for (let index = 0; index < text.length; index += 1) {
    const char = text[index]

    if (escaped) {
      escaped = false
      continue
    }

    if (char === '\\') {
      escaped = true
      continue
    }

    if (char === '"') {
      inString = !inString
      continue
    }

    if (inString) continue

    if (char === '{') {
      if (depth === 0) start = index
      depth += 1
    } else if (char === '}') {
      if (depth === 0) continue
      depth -= 1
      if (depth === 0 && start !== -1) {
        results.push(text.slice(start, index + 1).trim())
        start = -1
      }
    }
  }

  return results
}

function parseOpenClawAnalysis(text: string): { rawJson: string; analysis: OpenClawAnalysisPayload } | null {
  const candidates: string[] = []
  const direct = extractJsonObject(text)
  if (direct) candidates.push(direct)
  candidates.push(...extractBalancedJsonObjects(text))

  const uniqueCandidates = [...new Set(candidates.map((candidate) => candidate.trim()).filter(Boolean))]
  for (const candidate of uniqueCandidates) {
    try {
      const parsed = JSON.parse(candidate) as unknown
      if (looksLikeOpenClawAnalysis(parsed)) {
        return {
          rawJson: candidate,
          analysis: parsed,
        }
      }
    } catch {
      // Try the next candidate object.
    }
  }

  return null
}

export async function analyzeWithOpenClaw(request: OpenClawAnalysisRequest): Promise<{
  sessionKey: string
  runId: string
  raw: string
  analysis: OpenClawAnalysisPayload
}> {
  const settings = getOpenClawGatewaySettings()
  if (!settings.token && !settings.password) {
    throw new Error('OpenClaw gateway auth is not configured')
  }

  const sessionKey = `arcos-gateway:${request.conversationId}`
  const installedFabricPatterns = await listFabricPatternsForAnalysis()
  const message = [
    'You are the OpenClaw gateway stage for ARCOS.',
    'Analyze the request for orchestration only. Do not answer the user directly.',
    'Return strict JSON with these keys only:',
    '{',
    '  "summary": string,',
    '  "intent": string,',
    '  "workflow": string,',
    '  "recommended_tier": "ollama" | "haiku" | "arc-sonnet" | "arc-opus" | null,',
    '  "recommended_model": string | null,',
    '  "should_use_fabric": boolean,',
    '  "fabric_pattern": string | null,',
    '  "fabric_intent": string | null,',
    '  "confidence": number | null,',
    '  "reasoning": string,',
    '  "notes": string[]',
    '}',
    '',
    'Fabric selection rules:',
    '- Set "fabric_pattern" only to an exact value from the Installed Fabric Patterns list below.',
    '- If Fabric would help but no exact installed pattern fits, set "fabric_pattern" to null and set "fabric_intent" to a short conceptual skill name.',
    '- If Fabric should not be used, set both "fabric_pattern" and "fabric_intent" to null.',
    '',
    '## User Prompt',
    request.prompt,
    '',
    '## Recent Conversation Context',
    request.conversationSection,
    '',
    '## Memory Context',
    request.memorySection,
    '',
    '## Plugin Context',
    request.pluginSummary,
    '',
    '## Installed Fabric Patterns',
    installedFabricPatterns.length > 0 ? installedFabricPatterns.join('\n') : 'No installed Fabric patterns were detected.',
  ].join('\n')

  const send = await runOpenClawGatewayCall('chat.send', {
      sessionKey,
      message,
      deliver: false,
      idempotencyKey: randomUUID(),
      timeoutMs: 300000,
    }) as { runId?: string; status?: string }

  const runId = typeof send?.runId === 'string' ? send.runId : ''
  if (!runId) {
    throw new Error('OpenClaw did not return a runId for chat.send')
  }

  const wait = await runOpenClawGatewayCall('agent.wait', {
      runId,
      timeoutMs: 300000,
    }) as { status?: string; error?: string }

  if (wait?.status === 'error') {
    throw new Error(wait.error ?? 'OpenClaw run failed')
  }
  if (wait?.status === 'timeout') {
    throw new Error('OpenClaw run timed out')
  }

  const history = await runOpenClawGatewayCall('chat.history', {
      sessionKey,
      limit: 12,
      maxChars: 24000,
    }) as { messages?: unknown[] }

  const messages = Array.isArray(history?.messages) ? history.messages : []
  const lastAssistant = [...messages]
    .reverse()
    .find((entry) => (entry && typeof entry === 'object' && (entry as { role?: string }).role === 'assistant'))
  const raw = extractOpenClawMessageText(lastAssistant)
  const parsed = parseOpenClawAnalysis(raw)
  if (!parsed) {
    throw new Error('OpenClaw returned no parseable JSON analysis')
  }

  return {
    sessionKey,
    runId,
    raw,
    analysis: parsed.analysis,
  }
}
