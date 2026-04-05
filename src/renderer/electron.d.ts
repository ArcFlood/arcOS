export {}

declare global {
  interface Window {
    electron: {
      platform: string
      getPlatform: () => Promise<string>

      loadArcPrompts: () => Promise<{ success: boolean; content?: string; source?: string; error?: string }>
      openClawContext: () => Promise<{
        success: boolean
        workspacePath?: string
        files?: Array<{ name: string; path: string; content: string }>
        error?: string
      }>

      ollamaListModels: () => Promise<{ success: boolean; models: string[] }>
      ollamaListModelDetails: () => Promise<{ success: boolean; models: LocalModelInfo[] }>
      ollamaStreamStart: (params: {
        streamId: string; model: string
        messages: Array<{ role: string; content: string }>
      }) => Promise<void>

      claudeStreamStart: (params: {
        streamId: string; model: string
        systemPrompt: string; messages: Array<{ role: string; content: string }>
      }) => Promise<void>

      // API key — write-only from renderer; main reads from DB when calling Claude
      apiKeySet: (key: string) => Promise<{ success: boolean; error?: string }>
      apiKeyHas: () => Promise<{ hasKey: boolean }>

      streamAbort: (streamId: string) => Promise<void>
      onStreamEvent: (streamId: string, callback: (data: unknown) => void) => () => void

      serviceStatus: (name: string) => Promise<{
        running: boolean
        pid?: number
        port?: number
        displayName?: string
        manageable?: boolean
        managementNote?: string
        detailLines?: string[]
        links?: Array<{ label: string; target: string; kind: 'url' | 'path' }>
      }>
      serviceStart: (name: string) => Promise<{ success: boolean; error?: string }>
      serviceStop: (name: string) => Promise<{ success: boolean; error?: string }>
      workspaceDetachPanel?: (panelId: string) => Promise<{ success: boolean }>
      workspaceRedockPanel?: (panelId: string) => Promise<{ success: boolean }>
      workspaceSyncDetachedPanels?: (panelIds: string[]) => Promise<{ success: boolean }>
      onWorkspaceEvent?: (channel: string, callback: (payload: unknown) => void) => () => void
      codingRuntimeStatus: () => Promise<{ success: boolean; status?: CodingRuntimeStatus; error?: string }>
      openExternal: (url: string) => Promise<void>
      openPath: (targetPath: string) => Promise<{ success: boolean; error?: string }>

      fabricListPatterns: () => Promise<{ success: boolean; patterns: string[] }>
      fabricRunPattern: (params: {
        streamId: string
        pattern: string
        input: string
      }) => Promise<void>

      saveConversationMd: (params: {
        title: string
        content: string
      }) => Promise<{ success: boolean; filePath?: string; error?: string }>
      layoutExport: (params: {
        label: string
        layout: unknown
        exportedAt: string
        product: string
        version: number
      }) => Promise<{ success: boolean; filePath?: string; error?: string }>
      layoutImport: () => Promise<{
        success: boolean
        filePath?: string
        payload?: {
          label: string
          layout: unknown
          exportedAt: string
          product: string
          version: number
        }
        error?: string
      }>

      ollamaPullModel: (params: { streamId: string; modelName: string }) => Promise<void>
      ollamaDeleteModel: (modelName: string) => Promise<{ success: boolean; error?: string }>

      onMenuEvent: (channel: string, callback: () => void) => () => void

      pluginsList: () => Promise<{ success: boolean; plugins: PluginManifest[]; error?: string }>
      pluginsInstallFile: () => Promise<{ success: boolean; error?: string }>
      pluginsOpenDir: () => Promise<{ success: boolean }>

      logAppend: (level: string, message: string, detail?: string) => Promise<{ success: boolean }>
      logGetEntries: () => Promise<{ success: boolean; entries: LogEntry[] }>
      logClear: () => Promise<{ success: boolean }>
      logOpenFile: () => Promise<{ success: boolean }>

      // Routing log (FR-11)
      routingAppend: (entry: RoutingEntry) => Promise<{ success: boolean; error?: string }>
      routingGetEntries: (dateStr?: string) => Promise<{ success: boolean; entries: RoutingEntry[]; error?: string }>
      routingGetDates: () => Promise<{ success: boolean; dates: string[]; error?: string }>

      // Session history (FR-11)
      sessionList: (limit?: number) => Promise<{ success: boolean; sessions: SessionFile[]; error?: string }>
      sessionRead: (filePath: string) => Promise<{ success: boolean; content: string; error?: string }>
      sessionWriteSummary: (params: {
        data: SessionSummaryData
        apiKey?: string
      }) => Promise<{ success: boolean; filePath?: string; error?: string }>
      sessionShouldShowDigest: (lastDate: string | null) => Promise<{ show: boolean }>

      // Learnings / bookmarks (FR-11)
      learningsSave: (entry: {
        content: string
        model: string
        conversationTitle: string
        userTags: string[]
      }) => Promise<{ success: boolean; filePath?: string; error?: string }>
      learningsList: (limit?: number) => Promise<{ success: boolean; files: SessionFile[]; error?: string }>
      learningsRead: (filePath: string) => Promise<{ success: boolean; content: string; error?: string }>
      learningsOpenDir: () => Promise<{ success: boolean }>

      // Spending CSV export (FR-11)
      spendingExportCsv: (params: {
        records: Array<{ id: string; date: string; model: string; amount: number; conversationId?: string }>
        month?: string
      }) => Promise<{ success: boolean; filePath?: string; error?: string }>

      // ARC-Memory
      memoryQuery: (params: {
        query: string
        limit?: number
        dateAfter?: string
      }) => Promise<MemoryQueryResponse>
      memoryIngest: (force?: boolean) => Promise<{ success: boolean; status?: string; message?: string; error?: string }>
      memoryStatus: () => Promise<{ success: boolean; indexed_docs?: number; indexed_chunks?: number; db_size_mb?: number; last_indexed?: string; ingest_running?: boolean }>
      memoryVaultWrite: (params: {
        conversationId: string
        title: string
        createdAt: number
        updatedAt?: number
        messages: Array<{ role: string; content: string; model?: string }>
        tags: string[]
        totalCost: number
      }) => Promise<{ success: boolean; filePath?: string; error?: string }>
      memoryVaultPath: () => Promise<{ success: boolean; vaultPath: string }>

      db: {
        conversations: {
          list: () => Promise<{ success: boolean; data?: DbRow[]; error?: string }>
          save: (conv: DbRow) => Promise<{ success: boolean; error?: string }>
          delete: (id: string) => Promise<{ success: boolean; error?: string }>
        }
        messages: {
          list: (conversationId: string) => Promise<{ success: boolean; data?: DbRow[]; error?: string }>
          save: (msg: DbRow) => Promise<{ success: boolean; error?: string }>
        }
        spending: {
          list: () => Promise<{ success: boolean; data?: DbRow[]; error?: string }>
          add: (record: DbRow) => Promise<{ success: boolean; error?: string }>
          clear: () => Promise<{ success: boolean; error?: string }>
        }
        settings: {
          get: (key: string) => Promise<{ success: boolean; value: string | null; error?: string }>
          set: (key: string, value: string) => Promise<{ success: boolean; error?: string }>
        }
      }
    }
  }
}

// Loose row type — actual shapes defined in database/operations.ts
type DbRow = Record<string, unknown>

// Log entry shape (mirrors src/main/logger.ts)
type LogEntry = {
  id: string
  level: 'info' | 'warn' | 'error'
  source: 'main' | 'renderer'
  message: string
  detail?: string
  timestamp: number
}

// Routing entry shape (mirrors src/main/routingLog.ts)
type RoutingEntry = {
  timestamp: string
  queryPreview: string
  chosenTier: string
  reason: string
  confidence: number
  wasOverridden: boolean
  conversationId?: string
  estimatedCost?: number
}

// Session file listing entry
type SessionFile = {
  date: string
  path: string
  filename: string
}

// Session summary data (mirrors src/main/sessionHistory.ts)
type SessionSummaryData = {
  startedAt: number
  endedAt: number
  messages: Array<{ role: string; content: string; model?: string; cost?: number }>
  modelBreakdown: { ollama: number; haiku: number; sonnet: number; opus: number }
  totalCost: number
  fabricPatternsUsed: string[]
  arcCalls: number
  notes?: string
}

// ARC-Memory types
type MemoryChunk = {
  conversation_id: string
  source_path: string
  title: string
  date: string
  source_type: string
  chunk_index: number
  chunk_type: 'summary' | 'section'
  speaker: 'user' | 'ai' | 'mixed'
  text: string
  score: number
}

type MemoryCitation = {
  title: string
  date: string
  source_type: string
  source_path: string
  excerpt: string
  score: number
  obsidian_uri: string
}

type MemoryQueryResponse = {
  success: boolean
  chunks: MemoryChunk[]
  citations: MemoryCitation[]
  query_time_ms: number
  total_results: number
  error?: string
}

// Plugin manifest shape (mirrors src/main/plugins/loader.ts)
type PluginManifest = {
  id: string
  name: string
  description: string
  version: string
  icon: string
  tier: 'ollama' | 'haiku' | 'arc-sonnet'
  commands: string[]
  systemPrompt: string
  architectureRole?: 'prompt-shaper' | 'tool-surface' | 'service-integration' | 'workspace-module'
  targetStages?: string[]
  entrySurfaces?: string[]
  opensPanels?: string[]
  executionBoundary?: 'renderer' | 'main' | 'external-service'
  stability?: 'experimental' | 'stable'
}

type CodingRuntimeStatus = {
  linkedWorkspacePath: string
  activeRepositoryPath: string | null
  branch: string | null
  headShortSha: string | null
  upstream: string | null
  aheadCount: number
  behindCount: number
  worktreeCount: number
  stagedChanges: number
  unstagedChanges: number
  untrackedFiles: number
  conflictCount: number
  dirty: boolean
  staleBranch: boolean
  mergeReadiness: 'ready' | 'needs_sync' | 'pending_local_changes' | 'conflicted' | 'unknown'
  verificationCommands: string[]
  openClawControlUrl: string | null
  environment: 'development' | 'packaged'
}
