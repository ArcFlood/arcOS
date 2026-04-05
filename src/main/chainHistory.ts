import fs from 'fs'
import os from 'os'
import path from 'path'

const HISTORY_ROOT = path.join(os.homedir(), '.noah-ai-hub', 'history', 'chains')

export interface ChainArtifact {
  savedAt: string
  conversationId: string
  messageId: string
  userPrompt: string
  displayedUserPrompt?: string
  conversationHistoryCount: number
  memoryCitationCount: number
  activePlugin?: {
    id: string
    name: string
    tier: string
  } | null
  routing: {
    initialTier: string
    initialReason: string
    effectiveTier: string
    effectiveReason: string
    fallbackToLocal: boolean
    estimatedCost: number
  }
  chain: {
    path: string
    openClawTierOverride?: string
    openClawAnalysis?: unknown
    openClawRaw?: string
    openClawError?: string | null
    openClawContextFiles?: string[]
    fabric?: {
      requestedPattern: string | null
      requestedIntent: string | null
      resolvedPattern: string | null
      strategy: string
      reason: string
      executed: boolean
      mode?: string
      stage?: string
      output?: string
      error?: string | null
    }
    rebuiltSystemPrompt: string
    rebuiltUserPrompt: string
    routingPrompt: string
  }
  dispatch: {
    modelTier: string
    modelId: string
    status: 'completed' | 'failed'
    response?: string
    error?: string
    cost: number
  }
}

function ensureDir(dir: string): void {
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true })
}

export function writeChainArtifact(artifact: ChainArtifact): string {
  const date = artifact.savedAt.slice(0, 10)
  const month = artifact.savedAt.slice(0, 7)
  const dir = path.join(HISTORY_ROOT, month)
  ensureDir(dir)
  const filePath = path.join(dir, `${date}_${artifact.messageId}_chain.json`)
  fs.writeFileSync(filePath, `${JSON.stringify(artifact, null, 2)}\n`, 'utf8')
  return filePath
}
