import { create } from 'zustand'
import { listFabricPatterns, patternDescription, patternLabel, runFabricPattern } from '../services/fabricService'
import { useConversationStore } from './conversationStore'
import { useTraceStore } from './traceStore'

export interface ToolRun {
  id: string
  type: 'fabric'
  title: string
  toolId: string
  executionMode?: 'server' | 'cli'
  stageLabel?: string
  status: 'running' | 'completed' | 'error' | 'aborted'
  input: string
  output: string
  startedAt: number
  finishedAt?: number
  conversationId?: string
  error?: string
}

interface ToolExecutionStore {
  patterns: string[]
  loadingPatterns: boolean
  runs: ToolRun[]
  loadPatterns: () => Promise<void>
  runPattern: (pattern: string, input: string, conversationId?: string | null) => string | null
  abortRun: (runId: string) => void
  clearRuns: () => void
}

const FALLBACK_PATTERNS = [
  'extract_wisdom',
  'summarize',
  'explain_code',
  'improve_writing',
  'create_quiz',
  'analyze_claims',
  'create_summary',
]

const activeControllers = new Map<string, AbortController>()
const MAX_RUNS = 30

export const useToolExecutionStore = create<ToolExecutionStore>((set, get) => ({
  patterns: [],
  loadingPatterns: false,
  runs: [],

  loadPatterns: async () => {
    if (get().loadingPatterns) return
    set({ loadingPatterns: true })
    try {
      const patterns = await listFabricPatterns()
      set({ patterns: patterns.length > 0 ? patterns : FALLBACK_PATTERNS })
      useTraceStore.getState().appendEntry({
        source: 'fabric',
        level: 'info',
        title: 'Loaded Fabric patterns',
        detail: `${patterns.length > 0 ? patterns.length : FALLBACK_PATTERNS.length} patterns available to ARCOS.`,
        stage: 'Fabric',
        relatedPanels: ['tools', 'services'],
        entityLabel: 'fabric',
      })
    } catch (error) {
      set({ patterns: FALLBACK_PATTERNS })
      useTraceStore.getState().appendEntry({
        source: 'fabric',
        level: 'warn',
        title: 'Using fallback Fabric patterns',
        detail: String(error),
        stage: 'Fabric',
        relatedPanels: ['tools', 'services'],
        entityLabel: 'fabric',
      })
    } finally {
      set({ loadingPatterns: false })
    }
  },

  runPattern: (pattern, input, conversationId) => {
    const trimmed = input.trim()
    if (!trimmed) return null

    const runId = crypto.randomUUID()
    const controller = new AbortController()
    activeControllers.set(runId, controller)

    const convStore = useConversationStore.getState()
    const convId = conversationId ?? convStore.activeConversationId

    let assistantMessageId: string | null = null
    if (convId) {
      convStore.addMessage(convId, {
        role: 'user',
        content: `**Fabric: ${patternLabel(pattern)}**\n\n${trimmed}`,
        model: null,
        cost: 0,
        timestamp: Date.now(),
      })
      assistantMessageId = convStore.addMessage(convId, {
        role: 'assistant',
        content: '',
        model: 'ollama',
        cost: 0,
        timestamp: Date.now(),
        isStreaming: true,
        routingReason: `Fabric: ${pattern}`,
      }).id
    }

    const nextRun: ToolRun = {
      id: runId,
      type: 'fabric',
      title: patternLabel(pattern),
      toolId: pattern,
      status: 'running',
      input: trimmed,
      output: '',
      startedAt: Date.now(),
      conversationId: convId ?? undefined,
    }

    set((state) => ({ runs: [nextRun, ...state.runs].slice(0, MAX_RUNS) }))

    useTraceStore.getState().appendEntry({
      source: 'fabric',
      level: 'info',
      title: `Started ${patternLabel(pattern)}`,
      detail: `${patternDescription(pattern)} Fabric is being used as a workflow stage in the PAI chain.`,
      stage: 'Fabric',
      conversationId: convId ?? undefined,
        relatedPanels: ['tools', 'prompt_inspector', 'transparency'],
      entityLabel: pattern,
    })

    let accumulated = ''
    runFabricPattern(
      pattern,
      trimmed,
      {
        onMeta: (meta) => {
          set((state) => ({
            runs: state.runs.map((run) => run.id === runId ? {
              ...run,
              executionMode: meta.mode,
              stageLabel: meta.stage ?? 'Fabric',
            } : run),
          }))
          useTraceStore.getState().appendEntry({
            source: 'fabric',
            level: 'info',
            title: 'Fabric stage engaged',
            detail: `${patternLabel(pattern)} is running via ${meta.mode === 'server' ? 'Fabric server' : 'Fabric CLI fallback'}.`,
            stage: meta.stage ?? 'Fabric',
            conversationId: convId ?? undefined,
            relatedPanels: ['tools', 'prompt_inspector', 'services', 'transparency'],
            entityLabel: pattern,
          })
        },
        onToken: (token) => {
          accumulated += token
          set((state) => ({
            runs: state.runs.map((run) => run.id === runId ? { ...run, output: accumulated } : run),
          }))
          if (convId && assistantMessageId) {
            convStore.updateMessage(convId, assistantMessageId, { content: accumulated, isStreaming: true })
          }
        },
        onComplete: (fullText) => {
          activeControllers.delete(runId)
          const output = fullText || accumulated
          set((state) => ({
            runs: state.runs.map((run) => run.id === runId ? {
              ...run,
              status: 'completed',
              output,
              finishedAt: Date.now(),
            } : run),
          }))
          if (convId && assistantMessageId) {
            convStore.updateMessage(convId, assistantMessageId, {
              content: output,
              isStreaming: false,
            })
          }
          useTraceStore.getState().appendEntry({
            source: 'fabric',
            level: 'success',
            title: `Completed ${patternLabel(pattern)}`,
            detail: `${output.length} characters returned from Fabric${get().runs.find((run) => run.id === runId)?.executionMode === 'cli' ? ' via CLI fallback' : ''}.`,
            stage: get().runs.find((run) => run.id === runId)?.stageLabel ?? 'Fabric',
            conversationId: convId ?? undefined,
            relatedPanels: ['tools', 'chat', 'transparency'],
            entityLabel: pattern,
          })
        },
        onError: (error) => {
          activeControllers.delete(runId)
          set((state) => ({
            runs: state.runs.map((run) => run.id === runId ? {
              ...run,
              status: 'error',
              error: error.message,
              finishedAt: Date.now(),
            } : run),
          }))
          if (convId && assistantMessageId) {
            convStore.updateMessage(convId, assistantMessageId, {
              content: `⚠️ Fabric error: ${error.message}`,
              isStreaming: false,
            })
          }
          useTraceStore.getState().appendEntry({
            source: 'fabric',
            level: 'error',
            title: `${patternLabel(pattern)} failed`,
            detail: error.message,
            stage: get().runs.find((run) => run.id === runId)?.stageLabel ?? 'Fabric',
            conversationId: convId ?? undefined,
            relatedPanels: ['tools', 'services', 'transparency'],
            entityLabel: pattern,
          })
        },
      },
      controller.signal
    )

    return runId
  },

  abortRun: (runId) => {
    activeControllers.get(runId)?.abort()
    activeControllers.delete(runId)
    set((state) => ({
      runs: state.runs.map((run) => run.id === runId && run.status === 'running'
        ? { ...run, status: 'aborted', finishedAt: Date.now(), error: 'Aborted by user' }
        : run),
    }))
    useTraceStore.getState().appendEntry({
      source: 'fabric',
      level: 'warn',
      title: 'Aborted Fabric run',
      detail: `Run ${runId.slice(0, 8)} was stopped before completion.`,
      stage: 'Fabric',
      relatedPanels: ['tools', 'transparency'],
      entityLabel: 'fabric',
    })
  },

  clearRuns: () => set({ runs: [] }),
}))
