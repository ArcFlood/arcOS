/**
 * fabricService.ts
 * Wraps Fabric REST API calls via IPC (main process handles HTTP — no CORS).
 * Fabric server runs at http://localhost:8080 (fabric --serve).
 */

import { useSettingsStore } from '../stores/settingsStore'

export interface FabricStreamCallbacks {
  onMeta?: (meta: { mode: 'server' | 'cli'; stage?: string }) => void
  onToken: (token: string) => void
  onComplete: (fullText: string) => void
  onError: (err: Error) => void
}

export interface FabricChainResult {
  output: string
  mode?: 'server' | 'cli'
  stage?: string
}

export interface FabricPatternResolution {
  requestedPattern: string | null
  requestedIntent: string | null
  resolvedPattern: string | null
  strategy: 'exact' | 'alias' | 'keyword' | 'none' | 'unresolved'
  reason: string
}

// ── Pattern list ──────────────────────────────────────────────────

/** Fetch installed Fabric patterns from the REST server. Falls back to [] on failure. */
export async function listFabricPatterns(): Promise<string[]> {
  try {
    const result = await window.electron.fabricListPatterns()
    return result.success ? result.patterns : []
  } catch {
    return []
  }
}

function normalizePatternId(value: string | null | undefined): string {
  return (value ?? '')
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '')
}

const FABRIC_INTENT_ALIASES: Record<string, string[]> = {
  code_review: ['review_code', 'explain_code', 'coding_master'],
  review_code: ['review_code', 'explain_code', 'coding_master'],
  prompt_rebuilder: ['improve_prompt', 'summarize_prompt', 'create_pattern'],
  prompt_rebuild: ['improve_prompt', 'summarize_prompt', 'create_pattern'],
  improve_prompt: ['improve_prompt', 'summarize_prompt'],
  summarize_prompt: ['summarize_prompt', 'improve_prompt'],
  summarize: ['summarize', 'create_summary', 'create_micro_summary'],
  summary: ['summarize', 'create_summary', 'create_micro_summary'],
  extract_insights: ['extract_insights', 'extract_wisdom', 'extract_ideas'],
  extract_wisdom: ['extract_wisdom', 'extract_insights', 'extract_ideas'],
  design_review: ['review_design', 'refine_design_document', 'create_design_document'],
  prd: ['create_prd', 'create_design_document'],
  user_story: ['create_user_story', 'agility_story'],
  git_summary: ['summarize_git_diff', 'summarize_git_changes', 'create_git_diff_commit'],
}

function resolveByKeyword(candidates: string[], installedPatterns: string[]): string | null {
  const installedSet = new Set(installedPatterns.map((pattern) => normalizePatternId(pattern)))
  for (const candidate of candidates) {
    const normalizedCandidate = normalizePatternId(candidate)
    const tokens = normalizedCandidate.split('_').filter((token) => token.length > 2)
    const exactTokenMatch = installedPatterns.find((pattern) => {
      const normalizedInstalled = normalizePatternId(pattern)
      return tokens.every((token) => normalizedInstalled.includes(token))
    })
    if (exactTokenMatch && installedSet.has(normalizePatternId(exactTokenMatch))) {
      return exactTokenMatch
    }
  }
  return null
}

export function resolveFabricPatternSelection(
  requestedPattern: string | null | undefined,
  requestedIntent: string | null | undefined,
  installedPatterns: string[]
): FabricPatternResolution {
  const normalizedInstalled = new Map(
    installedPatterns.map((pattern) => [normalizePatternId(pattern), pattern] as const)
  )
  const normalizedRequestedPattern = normalizePatternId(requestedPattern)
  const normalizedRequestedIntent = normalizePatternId(requestedIntent)

  if (!requestedPattern && !requestedIntent) {
    return {
      requestedPattern: requestedPattern ?? null,
      requestedIntent: requestedIntent ?? null,
      resolvedPattern: null,
      strategy: 'none',
      reason: 'OpenClaw did not request a Fabric pattern for this prompt.',
    }
  }

  if (normalizedRequestedPattern && normalizedInstalled.has(normalizedRequestedPattern)) {
    return {
      requestedPattern: requestedPattern ?? null,
      requestedIntent: requestedIntent ?? null,
      resolvedPattern: normalizedInstalled.get(normalizedRequestedPattern) ?? null,
      strategy: 'exact',
      reason: 'OpenClaw selected an installed Fabric pattern directly.',
    }
  }

  const aliasCandidates = [
    ...(normalizedRequestedPattern ? FABRIC_INTENT_ALIASES[normalizedRequestedPattern] ?? [] : []),
    ...(normalizedRequestedIntent ? FABRIC_INTENT_ALIASES[normalizedRequestedIntent] ?? [] : []),
  ]
  for (const alias of aliasCandidates) {
    const resolved = normalizedInstalled.get(normalizePatternId(alias))
    if (resolved) {
      return {
        requestedPattern: requestedPattern ?? null,
        requestedIntent: requestedIntent ?? null,
        resolvedPattern: resolved,
        strategy: 'alias',
        reason: `Mapped the OpenClaw Fabric selection to installed pattern "${resolved}".`,
      }
    }
  }

  const keywordResolved = resolveByKeyword(
    [requestedPattern ?? '', requestedIntent ?? ''],
    installedPatterns
  )
  if (keywordResolved) {
    return {
      requestedPattern: requestedPattern ?? null,
      requestedIntent: requestedIntent ?? null,
      resolvedPattern: keywordResolved,
      strategy: 'keyword',
      reason: `Resolved the OpenClaw Fabric selection to "${keywordResolved}" by keyword overlap against installed patterns.`,
    }
  }

  return {
    requestedPattern: requestedPattern ?? null,
    requestedIntent: requestedIntent ?? null,
    resolvedPattern: null,
    strategy: 'unresolved',
    reason: 'No installed Fabric pattern matched the OpenClaw selection.',
  }
}

// ── Pattern execution ─────────────────────────────────────────────

/**
 * Run a Fabric pattern on the given input text.
 * Streams tokens back via callbacks.
 * Returns a cleanup/abort function.
 */
export function runFabricPattern(
  pattern: string,
  input: string,
  callbacks: FabricStreamCallbacks,
  signal?: AbortSignal,
  model?: string
): void {
  const streamId = crypto.randomUUID()

  const cleanup = window.electron.onStreamEvent(streamId, (raw: unknown) => {
    const data = raw as { type: string; token?: string; fullText?: string; error?: string; mode?: 'server' | 'cli'; stage?: string }

    if (data.type === 'meta' && data.mode) {
      callbacks.onMeta?.({ mode: data.mode, stage: data.stage })
    } else if (data.type === 'token' && data.token) {
      callbacks.onToken(data.token)
    } else if (data.type === 'done') {
      cleanup()
      callbacks.onComplete(data.fullText ?? '')
    } else if (data.type === 'error') {
      cleanup()
      callbacks.onError(new Error(data.error ?? 'Fabric pattern failed'))
    }
  })

  // Abort support
  if (signal) {
    signal.addEventListener('abort', () => {
      cleanup()
      window.electron.streamAbort(streamId)
    })
  }

  // Fire the IPC call (non-blocking)
  const selectedModel = model ?? useSettingsStore.getState().settings.ollamaModel
  window.electron.fabricRunPattern({ streamId, pattern, input, model: selectedModel }).catch((e: unknown) => {
    cleanup()
    callbacks.onError(new Error(String(e)))
  })
}

export function runFabricPatternForChain(
  pattern: string,
  input: string,
  signal?: AbortSignal,
  model?: string
): Promise<FabricChainResult> {
  return new Promise((resolve, reject) => {
    let mode: 'server' | 'cli' | undefined
    let stage: string | undefined
    let accumulated = ''

    runFabricPattern(
      pattern,
      input,
      {
        onMeta: (meta) => {
          mode = meta.mode
          stage = meta.stage
        },
        onToken: (token) => {
          accumulated += token
        },
        onComplete: (fullText) => {
          resolve({
            output: fullText || accumulated,
            mode,
            stage,
          })
        },
        onError: (err) => {
          reject(err)
        },
      },
      signal,
      model
    )
  })
}

// ── Pattern metadata ─────────────────────────────────────────────

/** Human-readable label for a snake_case pattern id */
export function patternLabel(id: string): string {
  return id
    .split('_')
    .map((w) => w.charAt(0).toUpperCase() + w.slice(1))
    .join(' ')
}

/** Short description heuristics for common patterns */
const KNOWN_DESCRIPTIONS: Record<string, string> = {
  extract_wisdom: 'Pull insights, quotes, and key ideas',
  summarize: 'Concise summary of content',
  explain_code: 'Break down what code does',
  improve_writing: 'Enhance clarity and style',
  create_quiz: 'Generate questions from content',
  analyze_claims: 'Evaluate arguments and evidence',
  create_summary: 'Structured TLDR with key points',
  extract_ideas: 'Surface novel ideas from text',
  write_essay: 'Write a structured essay on a topic',
  create_markmap: 'Visual mind-map from content',
  rate_content: 'Rate quality and give feedback',
  create_keynote: 'Build a presentation outline',
  extract_sponsors: 'Find sponsored content and ads',
  find_logical_fallacies: 'Identify reasoning errors',
  ask_secure_by_design: 'Security review of a design',
  show_fabric_options_markmap: 'Mind-map of Fabric options',
}

export function patternDescription(id: string): string {
  return KNOWN_DESCRIPTIONS[id] ?? 'Apply AI pattern to your content'
}

/** Pick a display emoji for a pattern */
export function patternEmoji(id: string): string {
  if (id.includes('wisdom') || id.includes('idea')) return '💡'
  if (id.includes('summar') || id.includes('tldr')) return '📋'
  if (id.includes('code') || id.includes('debug')) return '🔍'
  if (id.includes('writ') || id.includes('essay')) return '✍️'
  if (id.includes('quiz') || id.includes('question')) return '❓'
  if (id.includes('claim') || id.includes('logic') || id.includes('fallac')) return '⚖️'
  if (id.includes('secur')) return '🔒'
  if (id.includes('rate') || id.includes('review')) return '⭐'
  if (id.includes('keynote') || id.includes('slide')) return '📊'
  if (id.includes('sponsor')) return '🏷️'
  return '◈'
}
