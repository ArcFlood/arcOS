import { loadArcPrompt } from './arcLoader'
import { FabricPatternResolution, listFabricPatterns, resolveFabricPatternSelection, runFabricPatternForChain } from './fabricService'
import { MemoryCitation, sourceLabel } from './memoryService'
import { ModelTier, Plugin } from '../stores/types'
import { ChainPath, TraceEntry, useTraceStore } from '../stores/traceStore'
import { useSettingsStore } from '../stores/settingsStore'

export interface CanonicalChainOptions {
  prompt: string
  conversationId: string
  conversationHistory: Array<{ role: string; content: string }>
  isConversationStart: boolean
  memoryCitations: MemoryCitation[]
  plugin: Plugin | null
  preferredLocalModel: string
  services: {
    openClawRunning: boolean
    fabricRunning: boolean
  }
}

export interface CanonicalChainResult {
  rebuiltUserPrompt: string
  rebuiltSystemPrompt: string
  usesPaiSystemPrompt: boolean
  routingPrompt: string
  composedUserPrompt: string
  composedSystemPrompt: string
  routingContextPrompt: string
  composerStage: {
    canonicalName: 'Response Composer'
    legacyName: 'prompt rebuilder'
  }
  openClawTierOverride?: ModelTier
  diagnostics: {
    chainPath: ChainPath
    openClawAnalysis?: unknown
    openClawRaw?: string
    openClawError?: string | null
    openClawContextFiles: string[]
    fabric: FabricPatternResolution & {
      executed: boolean
      mode?: 'server' | 'cli'
      stage?: string
      output?: string
      error?: string | null
    }
  }
}

const appendTrace = (entry: Omit<TraceEntry, 'id' | 'timestamp'>) => useTraceStore.getState().appendEntry(entry)

const LEGACY_DEFAULT_RESPONSE_TUNER_IDENTITY =
  'ARCOS is the operating surface for PAI. It should present itself as the visible control plane coordinating the execution chain, not as a generic assistant shell.'
const LEGACY_DEFAULT_RESPONSE_TUNER_STYLE =
  'Be direct, structured, and practical. Preserve the required PAI response format and keep the strongest validated upstream findings intact.'

function previewDetail(text: string, max = 280): string {
  if (text.length <= max) return text
  return `${text.slice(0, max)}…`
}

function summarizeInline(text: string, max = 280): string {
  const cleaned = text
    .replace(/```[\s\S]*?```/g, '[code block omitted]')
    .replace(/\s+/g, ' ')
    .trim()
  if (cleaned.length <= max) return cleaned
  return `${cleaned.slice(0, max)}…`
}

function buildResponseComposerInstruction(fabricExecuted: boolean): string {
  if (fabricExecuted) {
    return [
      'You are in the ARCOS Response Composer stage.',
      'Do not perform a fresh full analysis if Fabric output is already present.',
      'Treat the Fabric output as the authoritative intermediate result for this request.',
      'Preserve the substance, priorities, and concrete findings from Fabric.',
      'Your job is to translate that material into the required PAI response structure without weakening it.',
      'If you add anything beyond Fabric, it must be a minimal clarification and must not contradict or dilute Fabric findings.',
      'You must preserve corrected code blocks, concrete fixes, and prioritized recommendations from Fabric whenever they are present.',
      'Do not omit a corrected code example if Fabric already produced one.',
      'Every final response must include all required PAI sections exactly once: ANSWER, SUMMARY, ANALYSIS, ACTIONS, RESULTS, STATUS, CAPTURE, NEXT, COMPLETED.',
      'RESULTS should contain the corrected code block when the upstream Fabric output includes a corrected implementation.',
    ].join('\n')
  }

  return [
    'You are in the ARCOS Response Composer stage.',
    'Assemble the final answer from the available PAI core context, OpenClaw analysis, memory context, and user request.',
    'Produce the answer in the required PAI response structure.',
    'Every final response must include all required PAI sections exactly once: ANSWER, SUMMARY, ANALYSIS, ACTIONS, RESULTS, STATUS, CAPTURE, NEXT, COMPLETED.',
  ].join('\n')
}

function buildResponseTunerSection(): string {
  const settings = useSettingsStore.getState().settings
  const responseTunerIdentity = settings.responseTunerIdentity?.trim() === LEGACY_DEFAULT_RESPONSE_TUNER_IDENTITY
    ? ''
    : settings.responseTunerIdentity?.trim()
  const responseTunerStyle = settings.responseTunerStyle?.trim() === LEGACY_DEFAULT_RESPONSE_TUNER_STYLE
    ? ''
    : settings.responseTunerStyle?.trim()
  const responseTunerInstructions = settings.responseTunerInstructions?.trim()
  const blocks = [
    responseTunerIdentity
      ? `ARCOS identity:\n${responseTunerIdentity}`
      : null,
    responseTunerStyle
      ? `Response style:\n${responseTunerStyle}`
      : null,
    responseTunerInstructions
      ? `Additional ARCOS instructions:\n${responseTunerInstructions}`
      : null,
  ].filter(Boolean)

  if (blocks.length === 0) {
    return 'No ARCOS response tuner overrides are configured.'
  }

  return [
    'These instructions apply at the ARCOS layer only.',
    'They refine how ARCOS presents and composes the response without replacing PAI CORE, OpenClaw rules, or Fabric output.',
    '',
    ...blocks,
  ].join('\n')
}

function buildMemorySection(memoryCitations: MemoryCitation[]): string {
  if (memoryCitations.length === 0) return 'No ARC-Memory citations staged for this request.'
  return memoryCitations
    .map((citation, index) => (
      `${index + 1}. ${citation.title} (${sourceLabel(citation.source_type)}, ${citation.date})\n${citation.excerpt}`
    ))
    .join('\n\n')
}

function buildMemorySummary(memoryCitations: MemoryCitation[]): string {
  if (memoryCitations.length === 0) return 'No staged memory.'
  return [
    `${memoryCitations.length} staged memory citation(s).`,
    ...memoryCitations.slice(0, 3).map((citation, index) => `${index + 1}. ${citation.title} (${sourceLabel(citation.source_type)})`),
  ].join('\n')
}

function buildConversationSection(history: Array<{ role: string; content: string }>): string {
  const recent = history
    .filter((message) => message.role === 'user' || message.role === 'assistant')
    .slice(-6)
  if (recent.length === 0) return 'No prior conversation history.'
  return recent
    .map((message) => `${message.role.toUpperCase()}: ${message.content}`)
    .join('\n\n')
}

function buildConversationSummary(history: Array<{ role: string; content: string }>, rawExchangeLimit = 10): string {
  const recent = history.filter((message) => message.role === 'user' || message.role === 'assistant')
  if (recent.length === 0) return 'No prior thread context.'

  const rawMessageLimit = Math.max(2, rawExchangeLimit * 2)
  const recentTurns = recent.slice(-rawMessageLimit)
  const compactedCount = Math.max(0, recent.length - recentTurns.length)
  const userCount = recent.filter((message) => message.role === 'user').length
  const assistantCount = recent.filter((message) => message.role === 'assistant').length

  return [
    `Recent thread summary: ${recent.length} prior message(s) (${userCount} user, ${assistantCount} assistant).`,
    compactedCount > 0
      ? `${compactedCount} older message(s) compacted out of the raw context window. Original saved thread content is preserved outside this prompt.`
      : 'No older messages were compacted for this request.',
    ...recentTurns.map((message) => `${message.role.toUpperCase()}: ${summarizeInline(message.content, 180)}`),
  ].join('\n')
}

function buildOpenClawDecisionEnvelope(
  analysis?: Record<string, unknown>,
  error?: string | null,
): string {
  if (!analysis) {
    return `OpenClaw decision unavailable.${error ? ` Reason: ${error}` : ''}`
  }

  const notes = Array.isArray(analysis.notes)
    ? analysis.notes.map((entry) => String(entry)).filter(Boolean).slice(0, 2)
    : []

  return [
    `Intent: ${String(analysis.intent ?? 'n/a')}`,
    `Summary: ${String(analysis.summary ?? 'n/a')}`,
    `Tier: ${String(analysis.recommended_tier ?? 'none')}`,
    `Fabric: ${analysis.should_use_fabric ? (analysis.fabric_pattern ?? analysis.fabric_intent ?? 'yes') : 'skip'}`,
    `Confidence: ${String(analysis.confidence ?? 'n/a')}`,
    notes.length > 0 ? `Notes: ${notes.join(' | ')}` : null,
  ].filter(Boolean).join('\n')
}

function buildFabricComposerBlock(
  fabric: CanonicalChainResult['diagnostics']['fabric'],
  fallbackBlock: string,
): string {
  if (!fabric.executed) {
    return fallbackBlock
  }

  const output = fabric.output ?? ''
  const trimmedOutput = output.length > 2200
    ? `${output.slice(0, 2200)}\n\n[Fabric output truncated for local model efficiency]`
    : output

  return [
    `Resolved pattern: ${fabric.resolvedPattern ?? 'unknown'}`,
    `Resolution strategy: ${fabric.strategy}`,
    `Mode: ${fabric.mode ?? 'unknown'}`,
    '',
    trimmedOutput,
  ].join('\n')
}

function mapOpenClawTier(value?: string): ModelTier | undefined {
  if (value === 'ollama' || value === 'haiku' || value === 'arc-sonnet' || value === 'arc-opus') {
    return value
  }
  return undefined
}

export async function executeCanonicalChain(opts: CanonicalChainOptions): Promise<CanonicalChainResult> {
  appendTrace({
    source: 'chat',
    level: 'info',
    title: 'Received user prompt',
    detail: 'ARCOS has started the canonical execution chain for this request.',
    conversationId: opts.conversationId,
    stage: 'user prompt',
    executionState: 'query_received',
    relatedPanels: ['chat', 'transparency'],
  })

  appendTrace({
    source: 'memory',
    level: 'info',
    title: 'Assembling PAI core context',
    detail: 'Loading baseline ARC prompt, recent thread context, plugin contract, and staged memory for the request.',
    conversationId: opts.conversationId,
    stage: 'PAI core context',
    executionState: 'context_loading',
    relatedPanels: ['prompt_inspector', 'memory', 'transparency'],
  })

  const { prompt: arcPrompt, source } = await loadArcPrompt()
  const memorySection = buildMemorySection(opts.memoryCitations)
  const conversationSection = buildConversationSection(opts.conversationHistory)
  const pluginSummary = opts.plugin
    ? `${opts.plugin.name} (${opts.plugin.architectureRole}) targeting ${opts.plugin.targetStages.join(', ')}`
    : 'No active plugin.'

  appendTrace({
    source: 'memory',
    level: 'success',
    title: 'PAI core context ready',
    detail: `${opts.memoryCitations.length} memory citations and ${Math.min(opts.conversationHistory.length, 6)} recent conversation items were prepared. ARC prompt source: ${source}.`,
    conversationId: opts.conversationId,
    stage: 'PAI core context',
    executionState: 'context_loading',
    relatedPanels: ['prompt_inspector', 'memory', 'transparency'],
  })

  appendTrace({
    source: 'service',
    level: opts.services.openClawRunning ? 'info' : 'warn',
    title: opts.services.openClawRunning ? 'OpenClaw stage engaged' : 'OpenClaw stage degraded',
    detail: opts.services.openClawRunning
      ? 'Loading linked OpenClaw workspace context before downstream prompt shaping.'
      : 'OpenClaw service is not running. ARCOS will still load workspace context files, but live OpenClaw orchestration is unavailable.',
    conversationId: opts.conversationId,
    stage: 'OpenClaw',
    executionState: 'service_action',
    relatedPanels: ['services', 'runtime', 'transparency'],
    degraded: !opts.services.openClawRunning,
  })

  const openClawContext = await window.electron.openClawContext()
  const openClawFiles = openClawContext.success ? (openClawContext.files ?? []) : []
  let openClawRaw = ''
  let openClawAnalysis: Record<string, unknown> | undefined
  let openClawError: string | null = null
  let openClawTierOverride: ModelTier | undefined
  let fabricPatternSuggestion: string | null = null
  let fabricIntentSuggestion: string | null = null
  let fabricOutputBlock = 'No Fabric transformation was applied.'
  let chainPath: ChainPath = 'direct-pass-through'
  const installedFabricPatterns = opts.services.fabricRunning ? await listFabricPatterns() : []

  if (opts.services.openClawRunning) {
    const analysisResult = await window.electron.openClawAnalyze({
      conversationId: opts.conversationId,
      prompt: opts.prompt,
      conversationSection,
      memorySection,
      pluginSummary,
    })

    if (analysisResult.success && analysisResult.analysis) {
      chainPath = 'openclaw-only'
      const analysis = analysisResult.analysis
      openClawRaw = analysisResult.raw ?? ''
      openClawAnalysis = analysis as Record<string, unknown>
      openClawTierOverride = mapOpenClawTier(analysis.recommended_tier)
      fabricPatternSuggestion = analysis.should_use_fabric ? (analysis.fabric_pattern ?? null) : null
      fabricIntentSuggestion = analysis.should_use_fabric ? (analysis.fabric_intent ?? null) : null
      appendTrace({
        source: 'service',
        level: 'success',
        title: 'OpenClaw gateway analysis completed',
        detail: [
          analysis.summary ?? 'No summary returned.',
          openClawTierOverride ? `Tier recommendation: ${openClawTierOverride}.` : '',
          fabricPatternSuggestion ? `Fabric suggestion: ${fabricPatternSuggestion}.` : '',
          !fabricPatternSuggestion && fabricIntentSuggestion ? `Fabric intent: ${fabricIntentSuggestion}.` : '',
        ].filter(Boolean).join(' '),
        conversationId: opts.conversationId,
        stage: 'OpenClaw',
        executionState: 'service_action',
        relatedPanels: ['services', 'runtime', 'transparency'],
      })
    } else {
      chainPath = 'degraded-fallback'
      openClawError = analysisResult.error ?? 'OpenClaw did not return a usable orchestration result.'
      appendTrace({
        source: 'service',
        level: 'warn',
        title: 'OpenClaw gateway analysis failed',
        detail: analysisResult.error ?? 'OpenClaw did not return a usable orchestration result.',
        conversationId: opts.conversationId,
        stage: 'OpenClaw',
        executionState: 'degraded',
        relatedPanels: ['services', 'runtime', 'transparency'],
        degraded: true,
        failureType: 'service_health',
        chainPath: 'degraded-fallback',
      })
    }
  } else {
    chainPath = 'degraded-fallback'
    openClawError = 'OpenClaw service is not running.'
  }

  appendTrace({
    source: 'service',
    level: openClawContext.success ? 'success' : 'warn',
    title: openClawContext.success ? 'OpenClaw context loaded' : 'OpenClaw context unavailable',
    detail: openClawContext.success
      ? `${openClawFiles.length} workspace files loaded from ${openClawContext.workspacePath ?? 'OpenClaw workspace'}.`
      : openClawContext.error ?? 'OpenClaw workspace context was unavailable.',
    conversationId: opts.conversationId,
    stage: 'OpenClaw',
    executionState: 'service_action',
    relatedPanels: ['services', 'runtime', 'prompt_inspector'],
    degraded: !openClawContext.success,
  })

  const fabricResolution = resolveFabricPatternSelection(
    fabricPatternSuggestion,
    fabricIntentSuggestion,
    installedFabricPatterns
  )
  const fabricDiagnostics: CanonicalChainResult['diagnostics']['fabric'] = {
    ...fabricResolution,
    executed: false,
    error: null,
  }

  appendTrace({
    source: 'fabric',
    level: opts.services.fabricRunning
      ? (fabricResolution.strategy === 'unresolved' ? 'warn' : fabricResolution.resolvedPattern ? 'success' : 'info')
      : 'warn',
    title: opts.services.fabricRunning
      ? (fabricResolution.resolvedPattern ? 'Fabric skill resolved' : fabricPatternSuggestion || fabricIntentSuggestion ? 'Fabric skill unresolved' : 'Fabric stage evaluated')
      : 'Fabric stage degraded',
    detail: opts.services.fabricRunning
      ? (fabricResolution.resolvedPattern
          ? `OpenClaw suggested ${fabricPatternSuggestion ? `"${fabricPatternSuggestion}"` : `"${fabricIntentSuggestion}"`} and ARCOS resolved it to installed Fabric pattern "${fabricResolution.resolvedPattern}" via ${fabricResolution.strategy} matching.`
          : fabricResolution.strategy === 'unresolved'
          ? `${fabricResolution.reason} Requested pattern: ${fabricPatternSuggestion ?? 'none'}. Requested intent: ${fabricIntentSuggestion ?? 'none'}.`
          : 'Fabric is participating in the chain as a shaping checkpoint for this request. No Fabric pattern was selected.')
      : 'Fabric is offline. The chain continues with a direct pass-through at the Fabric stage.',
    conversationId: opts.conversationId,
    stage: 'Fabric',
    executionState: 'tool_running',
    relatedPanels: ['tools', 'services', 'transparency'],
    degraded: !opts.services.fabricRunning || fabricResolution.strategy === 'unresolved',
  })

  if (opts.services.fabricRunning && (fabricPatternSuggestion || fabricIntentSuggestion) && !fabricResolution.resolvedPattern) {
    chainPath = 'degraded-fallback'
    fabricOutputBlock = [
      'Fabric selection could not be resolved to an installed pattern.',
      `Requested pattern: ${fabricResolution.requestedPattern ?? 'none'}`,
      `Requested intent: ${fabricResolution.requestedIntent ?? 'none'}`,
      `Reason: ${fabricResolution.reason}`,
    ].join('\n')

    appendTrace({
      source: 'fabric',
      level: 'warn',
      title: 'Fabric selection could not be resolved',
      detail: fabricResolution.reason,
      conversationId: opts.conversationId,
      stage: 'Fabric',
      executionState: 'degraded',
      relatedPanels: ['tools', 'transparency'],
      entityLabel: fabricPatternSuggestion ?? fabricIntentSuggestion ?? 'fabric',
      failureType: 'tool_runtime',
      chainPath,
      degraded: true,
    })
  }

  if (opts.services.fabricRunning && fabricResolution.resolvedPattern) {
    chainPath = 'openclaw-plus-fabric'
    appendTrace({
      source: 'fabric',
      level: 'info',
      title: `Running Fabric pattern ${fabricResolution.resolvedPattern}`,
      detail: `Executing the Fabric stage during normal chat after resolving the OpenClaw selection via ${fabricResolution.strategy} matching.`,
      conversationId: opts.conversationId,
      stage: 'Fabric',
      executionState: 'tool_running',
      relatedPanels: ['tools', 'transparency', 'prompt_inspector'],
      entityLabel: fabricResolution.resolvedPattern,
      chainPath,
    })

    try {
      const fabricInput = [
        opts.prompt,
        '',
        '## Recent Conversation Context',
        conversationSection,
        '',
        '## Memory Context',
        memorySection,
      ].join('\n')

      const fabricResult = await runFabricPatternForChain(
        fabricResolution.resolvedPattern,
        fabricInput,
        undefined,
        opts.preferredLocalModel
      )
      fabricOutputBlock = [
        `Requested pattern: ${fabricResolution.requestedPattern ?? 'none'}`,
        `Requested intent: ${fabricResolution.requestedIntent ?? 'none'}`,
        `Resolved pattern: ${fabricResolution.resolvedPattern}`,
        `Resolution strategy: ${fabricResolution.strategy}`,
        `Mode: ${fabricResult.mode ?? 'unknown'}`,
        `Stage: ${fabricResult.stage ?? 'Fabric'}`,
        '',
        fabricResult.output,
      ].join('\n')

      appendTrace({
        source: 'fabric',
        level: 'success',
        title: `Fabric pattern ${fabricResolution.resolvedPattern} completed`,
        detail: `${fabricResult.output.length} characters returned via ${fabricResult.mode ?? 'unknown'} execution.\n${previewDetail(fabricResult.output)}`,
        conversationId: opts.conversationId,
        stage: fabricResult.stage ?? 'Fabric',
        executionState: 'completed',
        relatedPanels: ['tools', 'prompt_inspector', 'transparency'],
        entityLabel: fabricResolution.resolvedPattern,
        chainPath,
      })
      fabricDiagnostics.executed = true
      fabricDiagnostics.mode = fabricResult.mode
      fabricDiagnostics.stage = fabricResult.stage
      fabricDiagnostics.output = fabricResult.output
    } catch (error) {
      chainPath = 'degraded-fallback'
      appendTrace({
        source: 'fabric',
        level: 'error',
        title: `Fabric pattern ${fabricResolution.resolvedPattern} failed`,
        detail: String(error),
        conversationId: opts.conversationId,
        stage: 'Fabric',
        executionState: 'failed',
        relatedPanels: ['tools', 'services', 'transparency'],
        entityLabel: fabricResolution.resolvedPattern,
        failureType: 'tool_runtime',
        chainPath,
      })
      fabricOutputBlock = `Pattern ${fabricResolution.resolvedPattern} failed: ${String(error)}`
      fabricDiagnostics.error = String(error)
    }
  }

  appendTrace({
    source: 'system',
    level: chainPath === 'degraded-fallback' ? 'warn' : 'info',
    title: 'Execution path resolved',
    detail:
      chainPath === 'openclaw-plus-fabric'
        ? 'Request path: PAI core context -> OpenClaw runtime -> Fabric execution -> Response Composer -> model.'
        : chainPath === 'openclaw-only'
        ? 'Request path: PAI core context -> OpenClaw runtime -> Response Composer -> model.'
        : chainPath === 'degraded-fallback'
        ? 'Request path degraded: ARCOS continued without the full intended OpenClaw/Fabric runtime path.'
        : 'Request path: PAI core context -> Response Composer -> model.',
    conversationId: opts.conversationId,
    stage: 'execution path',
    executionState: chainPath === 'degraded-fallback' ? 'degraded' : 'routing',
    relatedPanels: ['transparency', 'routing', 'prompt_inspector'],
    chainPath,
  })

  appendTrace({
    source: 'chat',
    level: 'info',
    title: 'Composing final response package',
    detail: 'ARCOS is assembling the final response package from PAI core context, OpenClaw context, memory citations, Fabric output, and the user request.',
    conversationId: opts.conversationId,
    stage: 'Response Composer',
    executionState: 'model_dispatch',
    relatedPanels: ['prompt_inspector', 'transparency'],
  })

  const responseComposerInstruction = buildResponseComposerInstruction(fabricDiagnostics.executed)
  const responseTunerSection = buildResponseTunerSection()
  const compactConversationSummary = buildConversationSummary(opts.conversationHistory)
  const compactMemorySummary = buildMemorySummary(opts.memoryCitations)
  const openClawDecisionEnvelope = buildOpenClawDecisionEnvelope(openClawAnalysis, openClawError)
  const compactFabricBlock = buildFabricComposerBlock(fabricDiagnostics, fabricOutputBlock)
  const usesPaiSystemPrompt = opts.isConversationStart
  const rebuiltSystemPrompt = usesPaiSystemPrompt
    ? [
        arcPrompt,
        '',
        '## Execution Requirement',
        'You are responding through the ARCOS canonical execution chain. Preserve the PAI operating contract across the thread.',
      ]
        .filter(Boolean)
        .join('\n')
    : ''

  const rebuiltUserPrompt = [
    opts.prompt,
    '',
    '## Per-Message Chain Context',
    `This is ${usesPaiSystemPrompt ? 'the first message in the thread' : 'a follow-up message in an existing thread'}.`,
    `Active plugin: ${opts.plugin ? `${opts.plugin.name} (${opts.plugin.architectureRole})` : 'none'}`,
    `Plugin target stages: ${opts.plugin ? opts.plugin.targetStages.join(', ') : 'none'}`,
    '',
    '### Thread Summary',
    compactConversationSummary,
    '',
    '### Memory Summary',
    compactMemorySummary,
    '',
    '### OpenClaw Decision Envelope',
    openClawDecisionEnvelope,
    '',
    '### Fabric Output',
    compactFabricBlock,
    '',
    '### ARCOS Response Tuner',
    responseTunerSection,
    '',
    '## Response Composer Instruction',
    responseComposerInstruction,
    '',
    '## Active Plugin Override',
    opts.plugin ? opts.plugin.systemPrompt : 'No active plugin override.',
    '',
    '## Response Format Requirement',
    'Return the final answer using the required PAI structure and preserve the strongest validated upstream findings.',
    'Use these section headers exactly once and in this order:',
    'ANSWER:',
    'SUMMARY:',
    'ANALYSIS:',
    'ACTIONS:',
    'RESULTS:',
    'STATUS:',
    'CAPTURE:',
    'NEXT:',
    'COMPLETED:',
    'If a corrected code block exists in the upstream material, include it under RESULTS.',
  ].join('\n')

  appendTrace({
    source: 'chat',
    level: 'success',
    title: 'Response package composed',
    detail: `PAI system prompt ${usesPaiSystemPrompt ? 'attached for thread start' : 'not attached for this follow-up message'}. Final system prompt size: ${rebuiltSystemPrompt.length} chars. Final user payload size: ${rebuiltUserPrompt.length} chars. OpenClaw runtime files remain internal to the OpenClaw stage. Required PAI sections enforced.${fabricDiagnostics.executed ? ' Fabric output preservation mode active.' : ''}`,
    conversationId: opts.conversationId,
    stage: 'Response Composer',
    executionState: 'model_dispatch',
    relatedPanels: ['prompt_inspector', 'transparency'],
  })

  return {
    rebuiltUserPrompt,
    rebuiltSystemPrompt,
    usesPaiSystemPrompt,
    composedUserPrompt: rebuiltUserPrompt,
    composedSystemPrompt: rebuiltSystemPrompt,
    routingPrompt: [
      opts.prompt,
      '',
      compactMemorySummary,
      '',
      openClawDecisionEnvelope,
      '',
      compactFabricBlock,
    ].join('\n'),
    routingContextPrompt: [
      opts.prompt,
      '',
      compactMemorySummary,
      '',
      openClawDecisionEnvelope,
      '',
      compactFabricBlock,
    ].join('\n'),
    composerStage: {
      canonicalName: 'Response Composer',
      legacyName: 'prompt rebuilder',
    },
    openClawTierOverride,
    diagnostics: {
      chainPath,
      openClawAnalysis,
      openClawRaw,
      openClawError,
      openClawContextFiles: openClawFiles.map((file) => file.name),
      fabric: {
        ...fabricDiagnostics,
        output: fabricDiagnostics.output ?? fabricOutputBlock,
      },
    },
  }
}
