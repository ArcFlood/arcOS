import { ModelTier, RoutingAggressiveness, RoutingMode, TaskArea } from '../stores/types'

export type RoutingDecision = {
  tier: ModelTier
  reason: string
}

export function classifyTaskArea(text: string): TaskArea {
  const normalized = text.toLowerCase()
  const hasCodeSignal = /```|function |const |let |class |import |export |def |interface |type |tsx|jsx|typescript|javascript|python|react|component|hook|lint|tsc|bug|debug|refactor|stack trace|compile|runtime error/.test(normalized)
  return hasCodeSignal ? 'coding' : 'general'
}

export function modelForTaskArea(assignments: Partial<Record<TaskArea, string>> | undefined, taskArea: TaskArea, fallbackModel: string): string {
  return assignments?.[taskArea]?.trim() || fallbackModel
}

export function routeQuery(
  text: string,
  mode: RoutingMode,
  aggressiveness: RoutingAggressiveness,
  ollamaRunning: boolean,
  spendingToday: number,
  dailyLimit: number
): RoutingDecision {
  if (spendingToday >= dailyLimit && ollamaRunning) {
    return { tier: 'ollama', reason: `Daily budget ($${dailyLimit}) reached — local model` }
  }

  if (mode !== 'auto') return { tier: mode as ModelTier, reason: 'Manual override' }

  const words = text.trim().split(/\s+/).length
  const hasCode = /```|function |const |let |class |import |def |debug|error|refactor/.test(text)
  const isComplex = /analyze|research|synthesize|multi.?step|orchestrat|architecture|evaluate|comprehensive/.test(text.toLowerCase())
  const isSimple = words < 50 && !hasCode && !isComplex
  const isMid = words >= 50 && words < 300 && !hasCode && !isComplex

  if (aggressiveness === 'cost-first') {
    if (isSimple && ollamaRunning) return { tier: 'ollama', reason: 'Simple query → local (cost-first)' }
    if (isMid && ollamaRunning) return { tier: 'ollama', reason: 'Moderate query → local (cost-first)' }
    return { tier: 'haiku', reason: 'Cost-first → Haiku' }
  }

  if (aggressiveness === 'quality-first') {
    if (isSimple && ollamaRunning) return { tier: 'ollama', reason: 'Simple → local' }
    return { tier: 'arc-sonnet', reason: 'Quality-first → A.R.C.' }
  }

  if (isSimple && ollamaRunning) return { tier: 'ollama', reason: 'Short & simple → local model' }
  if (hasCode || isComplex) return { tier: 'arc-sonnet', reason: hasCode ? 'Code detected → A.R.C.' : 'Complex reasoning → A.R.C.' }
  if (isMid) return { tier: 'haiku', reason: 'Moderate complexity → Haiku' }
  if (!ollamaRunning) return { tier: 'haiku', reason: 'Ollama offline → Haiku' }
  return { tier: 'arc-sonnet', reason: 'Long query → A.R.C.' }
}

export const TIER_LABELS: Record<ModelTier, string> = {
  ollama: 'Local',
  haiku: 'Haiku',
  'arc-sonnet': 'A.R.C.',
  'arc-opus': 'Opus',
}

export const TIER_DISPLAY_LABELS: Record<ModelTier, string> = {
  ollama: '💻 Local',
  haiku: '⚡ Haiku',
  'arc-sonnet': '🧠 A.R.C.',
  'arc-opus': '🔮 Opus',
}
