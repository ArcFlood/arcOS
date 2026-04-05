import { loadArcPrompt } from './arcLoader'
import { MemoryCitation, sourceLabel } from './memoryService'
import { Plugin } from '../stores/types'
import { TraceEntry, useTraceStore } from '../stores/traceStore'

export interface CanonicalChainOptions {
  prompt: string
  conversationId: string
  conversationHistory: Array<{ role: string; content: string }>
  memoryCitations: MemoryCitation[]
  plugin: Plugin | null
  services: {
    openClawRunning: boolean
    fabricRunning: boolean
  }
}

export interface CanonicalChainResult {
  rebuiltUserPrompt: string
  rebuiltSystemPrompt: string
  routingPrompt: string
}

const appendTrace = (entry: Omit<TraceEntry, 'id' | 'timestamp'>) => useTraceStore.getState().appendEntry(entry)

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

  appendTrace({
    source: 'fabric',
    level: opts.services.fabricRunning ? 'info' : 'warn',
    title: opts.services.fabricRunning ? 'Fabric stage evaluated' : 'Fabric stage degraded',
    detail: opts.services.fabricRunning
      ? 'Fabric is participating in the chain as a shaping checkpoint for this request. No default transformation pattern is configured yet, so this message passes through unchanged.'
      : 'Fabric is offline. The chain continues with a direct pass-through at the Fabric stage.',
    conversationId: opts.conversationId,
    stage: 'Fabric',
    executionState: 'tool_running',
    relatedPanels: ['tools', 'services', 'transparency'],
    degraded: !opts.services.fabricRunning,
  })

  appendTrace({
    source: 'chat',
    level: 'info',
    title: 'Rebuilding final prompt',
    detail: 'ARCOS is merging PAI core context, OpenClaw context, memory citations, and the user request into a final model-ready prompt.',
    conversationId: opts.conversationId,
    stage: 'prompt rebuilder',
    executionState: 'model_dispatch',
    relatedPanels: ['prompt_inspector', 'transparency', 'execution'],
  })

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
    '## Execution Requirement',
    'You are responding through the ARCOS canonical execution chain. Respect the PAI context above when producing the response.',
    opts.plugin ? `## Active Plugin Override\n${opts.plugin.systemPrompt}` : '',
  ]
    .filter(Boolean)
    .join('\n')

  const rebuiltUserPrompt = [
    opts.prompt,
    '',
    '## Request Handling Note',
    'The response must remain consistent with the PAI core context, OpenClaw workspace context, and any staged memory supplied above.',
  ].join('\n')

  appendTrace({
    source: 'chat',
    level: 'success',
    title: 'Prompt rebuilt',
    detail: `Final system prompt size: ${rebuiltSystemPrompt.length} chars. Final user payload size: ${rebuiltUserPrompt.length} chars.`,
    conversationId: opts.conversationId,
    stage: 'prompt rebuilder',
    executionState: 'model_dispatch',
    relatedPanels: ['prompt_inspector', 'transparency', 'execution'],
  })

  return {
    rebuiltUserPrompt,
    rebuiltSystemPrompt,
    routingPrompt: `${opts.prompt}\n\n${memorySection}`,
  }
}
