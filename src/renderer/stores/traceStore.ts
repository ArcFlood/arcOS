import { create } from 'zustand'
import { WorkspacePanelId } from '../workspace/types'

export type TraceLevel = 'info' | 'success' | 'warn' | 'error'
export type TraceSource = 'chat' | 'routing' | 'service' | 'system' | 'tool' | 'memory' | 'fabric'
export type ExecutionLifecycleState =
  | 'idle'
  | 'query_received'
  | 'context_loading'
  | 'routing'
  | 'model_dispatch'
  | 'tool_running'
  | 'service_action'
  | 'completed'
  | 'degraded'
  | 'failed'

export type FailureType =
  | 'startup'
  | 'routing'
  | 'tool_runtime'
  | 'memory'
  | 'service_health'
  | 'permission'
  | 'infra'
  | 'chat'

export type ChainPath =
  | 'direct-pass-through'
  | 'openclaw-only'
  | 'openclaw-plus-fabric'
  | 'degraded-fallback'

export type ProcessEventStatus =
  | 'queued'
  | 'running'
  | 'blocked'
  | 'completed'
  | 'failed'
  | 'degraded'

export interface ProcessEventEntity {
  id?: string
  type?: string
  label?: string
}

export interface RequestTokenBudget {
  used: number
  max: number
  remaining: number
  modelId?: string
}

export interface TraceEntry {
  id: string
  timestamp: number
  level: TraceLevel
  source: TraceSource
  title: string
  detail?: string
  eventType?: string
  status?: ProcessEventStatus
  entity?: ProcessEventEntity
  stage?: string
  executionState?: ExecutionLifecycleState
  failureType?: FailureType
  recoveryAction?: string
  degraded?: boolean
  conversationId?: string
  relatedPanels?: WorkspacePanelId[]
  entityLabel?: string
  chainPath?: ChainPath
  requestTokens?: RequestTokenBudget
}

export interface ExecutionSummary {
  currentPhase: string
  lifecycleState: ExecutionLifecycleState
  lastSuccessfulCheckpoint: string
  activeBlocker: string | null
  recommendedRecoveryAction: string | null
  degradedMode: boolean
  latestConversationId: string | null
  chainPath: ChainPath | 'unknown'
  requestTokens?: RequestTokenBudget
}

interface TraceStore {
  entries: TraceEntry[]
  appendEntry: (entry: Omit<TraceEntry, 'id' | 'timestamp'>) => void
  clearEntries: () => void
  executionSummary: (conversationId?: string | null) => ExecutionSummary
}

const MAX_TRACE_ENTRIES = 150

const DEFAULT_SUMMARY: ExecutionSummary = {
  currentPhase: 'Idle',
  lifecycleState: 'idle',
  lastSuccessfulCheckpoint: 'None yet',
  activeBlocker: null,
  recommendedRecoveryAction: null,
  degradedMode: false,
  latestConversationId: null,
  chainPath: 'unknown',
  requestTokens: undefined,
}

function inferExecutionState(entry: Omit<TraceEntry, 'id' | 'timestamp'>): ExecutionLifecycleState {
  if (entry.executionState) return entry.executionState
  if (entry.level === 'error') return 'failed'
  if (entry.level === 'warn') return 'degraded'
  if (entry.source === 'routing') return 'routing'
  if (entry.source === 'memory') return entry.title.toLowerCase().includes('search') ? 'context_loading' : 'service_action'
  if (entry.source === 'fabric' || entry.source === 'tool') return entry.level === 'success' ? 'completed' : 'tool_running'
  if (entry.source === 'service') return 'service_action'
  if (entry.source === 'chat') {
    if (entry.level === 'success') return 'completed'
    return 'model_dispatch'
  }
  return 'query_received'
}

function inferFailureType(entry: Omit<TraceEntry, 'id' | 'timestamp'>): FailureType | undefined {
  if (entry.failureType) return entry.failureType
  if (entry.level !== 'error' && !entry.degraded) return undefined
  if (entry.source === 'memory') return 'memory'
  if (entry.source === 'service') return 'service_health'
  if (entry.source === 'routing') return 'routing'
  if (entry.source === 'fabric' || entry.source === 'tool') return 'tool_runtime'
  if (entry.source === 'chat') return 'chat'
  return 'infra'
}

function inferRecoveryAction(entry: Omit<TraceEntry, 'id' | 'timestamp'>): string | undefined {
  if (entry.recoveryAction) return entry.recoveryAction
  const lowerTitle = entry.title.toLowerCase()
  if (entry.source === 'memory' && (entry.level === 'error' || entry.level === 'warn')) {
    return lowerTitle.includes('search')
      ? 'Restart ARC-Memory or trigger a re-index, then retry the query.'
      : 'Restart ARC-Memory and verify the vault/index path.'
  }
  if (entry.source === 'service' && (entry.level === 'error' || entry.level === 'warn')) {
    return 'Inspect the Services panel, restart the affected runtime, and confirm its expected port/path.'
  }
  if ((entry.source === 'fabric' || entry.source === 'tool') && (entry.level === 'error' || entry.level === 'warn')) {
    return 'Retry the tool run after checking Fabric or plugin runtime health.'
  }
  if (entry.source === 'chat' && entry.level === 'error') {
    return 'Check model availability and routing, then retry the request.'
  }
  if (entry.source === 'routing' && (entry.level === 'error' || entry.level === 'warn')) {
    return 'Review routing mode and the selected local/cloud model path.'
  }
  return undefined
}

function inferStage(entry: Omit<TraceEntry, 'id' | 'timestamp'>): string | undefined {
  if (entry.stage) return entry.stage
  switch (entry.source) {
    case 'memory':
      return 'PAI core context'
    case 'routing':
      return 'routing'
    case 'fabric':
      return 'Fabric'
    case 'chat':
      return 'local model'
    case 'service':
      return 'runtime services'
    case 'tool':
      return 'tool runtime'
    default:
      return undefined
  }
}

function lifecycleStateToProcessStatus(state: ExecutionLifecycleState, level: TraceLevel): ProcessEventStatus {
  if (level === 'error' || state === 'failed') return 'failed'
  if (level === 'warn' || state === 'degraded') return 'degraded'
  if (state === 'completed') return 'completed'
  if (state === 'idle') return 'queued'
  if (state === 'query_received') return 'queued'
  return 'running'
}

function summarize(entries: TraceEntry[], conversationId?: string | null): ExecutionSummary {
  const scoped = conversationId
    ? entries.filter((entry) => entry.conversationId === conversationId || !entry.conversationId)
    : entries
  if (scoped.length === 0) return DEFAULT_SUMMARY

  const latest = scoped[0]
  const lastSuccess = scoped.find((entry) => entry.level === 'success')
  const blocker = scoped.find((entry) => entry.level === 'error' || entry.degraded || entry.level === 'warn')

  return {
    currentPhase: latest.stage ?? latest.title,
    lifecycleState: latest.executionState ?? 'idle',
    lastSuccessfulCheckpoint: lastSuccess?.title ?? 'None yet',
    activeBlocker: blocker && blocker.id === latest.id ? blocker.title : (latest.level === 'error' ? latest.title : null),
    recommendedRecoveryAction: blocker?.recoveryAction ?? null,
    degradedMode: scoped.some((entry) => entry.degraded || entry.level === 'warn'),
    latestConversationId: latest.conversationId ?? null,
    chainPath: scoped.find((entry) => entry.chainPath)?.chainPath ?? 'unknown',
    requestTokens: scoped.find((entry) => entry.requestTokens)?.requestTokens,
  }
}

export const useTraceStore = create<TraceStore>((set, get) => ({
  entries: [],

  appendEntry: (entry) =>
    set((state) => {
      const inferredExecutionState = inferExecutionState(entry)
      const next: TraceEntry[] = [
        {
          id: crypto.randomUUID(),
          timestamp: Date.now(),
          stage: inferStage(entry),
          executionState: inferredExecutionState,
          failureType: inferFailureType(entry),
          recoveryAction: inferRecoveryAction(entry),
          degraded: entry.degraded ?? entry.level === 'warn',
          status: entry.status ?? lifecycleStateToProcessStatus(inferredExecutionState, entry.level),
          entity: entry.entity ?? (entry.entityLabel ? { label: entry.entityLabel } : undefined),
          ...entry,
        },
        ...state.entries,
      ].slice(0, MAX_TRACE_ENTRIES)
      return { entries: next }
    }),

  clearEntries: () => set({ entries: [] }),

  executionSummary: (conversationId) => summarize(get().entries, conversationId ?? null),
}))
