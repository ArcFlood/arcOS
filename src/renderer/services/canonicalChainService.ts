import { loadArcPrompt } from './arcLoader'
import { FabricPatternResolution, listFabricPatterns, resolveFabricPatternSelection, runFabricPatternForChain } from './fabricService'
import { MemoryCitation, sourceLabel } from './memoryService'
import { ModelTier, Plugin } from '../stores/types'
import { ChainPath, TraceEntry, useTraceStore } from '../stores/traceStore'

export interface CanonicalChainOptions {
  prompt: string
  conversationId: string
  conversationHistory: Array<{ role: string; content: string }>
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

function previewDetail(text: string, max = 280): string {
  if (text.length <= max) return text
  return `${text.slice(0, max)}…`
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
      'Every final response must include all required PAI sections exactly once: SUMMARY, ANALYSIS, ACTIONS, RESULTS, STATUS, CAPTURE, NEXT, COMPLETED.',
      'RESULTS should contain the corrected code block when the upstream Fabric output includes a corrected implementation.',
    ].join('\n')
  }

  return [
    'You are in the ARCOS Response Composer stage.',
    'Assemble the final answer from the available PAI core context, OpenClaw analysis, memory context, and user request.',
    'Produce the answer in the required PAI response structure.',
    'Every final response must include all required PAI sections exactly once: SUMMARY, ANALYSIS, ACTIONS, RESULTS, STATUS, CAPTURE, NEXT, COMPLETED.',
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

function buildConversationSection(history: Array<{ role: string; content: string }>): string {
  const recent = history
    .filter((message) => message.role === 'user' || message.role === 'assistant')
    .slice(-6)
  if (recent.length === 0) return 'No prior conversation history.'
  return recent
    .map((message) => `${message.role.toUpperCase()}: ${message.content}`)
    .join('\n\n')
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
    relatedPanels: ['chat', 'transparency', 'execution'],
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
  const openClawContextBlock = openClawFiles.length === 0
    ? 'No OpenClaw workspace context files were available.'
    : openClawFiles.map((file) => `# ${file.name}\n${file.content}`).join('\n\n')

  let openClawAnalysisBlock = 'No live OpenClaw gateway analysis was available.'
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
      openClawAnalysisBlock = [
        `Summary: ${analysis.summary ?? 'n/a'}`,
        `Intent: ${analysis.intent ?? 'n/a'}`,
        `Workflow: ${analysis.workflow ?? 'n/a'}`,
        `Recommended tier: ${analysis.recommended_tier ?? 'none'}`,
        `Recommended model: ${analysis.recommended_model ?? 'none'}`,
        `Fabric: ${analysis.should_use_fabric ? `yes${analysis.fabric_pattern ? ` (${analysis.fabric_pattern})` : ''}` : 'no'}`,
        `Fabric intent: ${analysis.fabric_intent ?? 'none'}`,
        `Confidence: ${analysis.confidence ?? 'n/a'}`,
        `Reasoning: ${analysis.reasoning ?? 'n/a'}`,
        analysis.notes && analysis.notes.length > 0 ? `Notes: ${analysis.notes.join(' | ')}` : '',
      ].filter(Boolean).join('\n')

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
        relatedPanels: ['services', 'runtime', 'transparency', 'execution'],
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
      relatedPanels: ['tools', 'execution', 'transparency'],
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
      relatedPanels: ['tools', 'execution', 'transparency', 'prompt_inspector'],
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
        relatedPanels: ['tools', 'execution', 'prompt_inspector', 'transparency'],
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
        relatedPanels: ['tools', 'execution', 'services', 'transparency'],
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
    relatedPanels: ['transparency', 'execution', 'routing', 'prompt_inspector'],
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
    relatedPanels: ['prompt_inspector', 'transparency', 'execution'],
  })

  const responseComposerInstruction = buildResponseComposerInstruction(fabricDiagnostics.executed)
  const rebuiltSystemPrompt = [
    arcPrompt,
    '',
    '## PAI Core Context',
    '',
    `Active plugin: ${opts.plugin ? `${opts.plugin.name} (${opts.plugin.architectureRole})` : 'none'}`,
    `Plugin target stages: ${opts.plugin ? opts.plugin.targetStages.join(', ') : 'none'}`,
    '',
    '### Recent Thread Context',
    conversationSection,
    '',
    '### ARC-Memory Context',
    memorySection,
    '',
    '### OpenClaw Workspace Context',
    openClawContextBlock,
    '',
    '### OpenClaw Gateway Analysis',
    openClawAnalysisBlock,
    '',
    '### Fabric Output',
    fabricOutputBlock,
    '',
    '## Response Composer Instruction',
    responseComposerInstruction,
    '',
    '## Execution Requirement',
    'You are responding through the ARCOS canonical execution chain. Respect the PAI context above when producing the response.',
    opts.plugin ? `## Active Plugin Override\n${opts.plugin.systemPrompt}` : '',
  ]
    .filter(Boolean)
    .join('\n')

  const rebuiltUserPrompt = [
    opts.prompt,
    '',
    '## Response Format Requirement',
    'Return the final answer using the required PAI structure and preserve the strongest validated upstream findings.',
    'Use these section headers exactly once and in this order:',
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
    detail: `Final system prompt size: ${rebuiltSystemPrompt.length} chars. Final user payload size: ${rebuiltUserPrompt.length} chars. Required PAI sections enforced.${fabricDiagnostics.executed ? ' Fabric output preservation mode active.' : ''}`,
    conversationId: opts.conversationId,
    stage: 'Response Composer',
    executionState: 'model_dispatch',
    relatedPanels: ['prompt_inspector', 'transparency', 'execution'],
  })

  return {
    rebuiltUserPrompt,
    rebuiltSystemPrompt,
    composedUserPrompt: rebuiltUserPrompt,
    composedSystemPrompt: rebuiltSystemPrompt,
    routingPrompt: [
      opts.prompt,
      '',
      memorySection,
      '',
      openClawAnalysisBlock,
      '',
      fabricOutputBlock,
    ].join('\n'),
    routingContextPrompt: [
      opts.prompt,
      '',
      memorySection,
      '',
      openClawAnalysisBlock,
      '',
      fabricOutputBlock,
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
