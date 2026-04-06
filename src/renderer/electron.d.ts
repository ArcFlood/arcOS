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
      openClawAnalyze: (params: {
        conversationId: string
        prompt: string
        conversationSection: string
        memorySection: string
        pluginSummary: string
      }) => Promise<{
        success: boolean
        sessionKey?: string
        runId?: string
        raw?: string
        analysis?: {
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
        error?: string
      }>
      chainCaptureSave: (params: {
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
          composerStage?: {
            canonicalName: 'Response Composer'
            legacyName: 'prompt rebuilder'
          }
          usesPaiSystemPrompt?: boolean
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
          composedSystemPrompt?: string
          composedUserPrompt?: string
          routingContextPrompt?: string
        }
        dispatch: {
          modelTier: string
          modelId: string
          status: 'completed' | 'failed'
          response?: string
          error?: string
          cost: number
        }
      }) => Promise<{ success: boolean; filePath?: string; error?: string }>

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
      workspaceDetachPanel?: (payload: { moduleId: string; panelId: string; title?: string }) => Promise<{ success: boolean }>
      workspaceRedockPanel?: (moduleId: string) => Promise<{ success: boolean }>
      workspaceSyncDetachedPanels?: (modules: Array<{ moduleId: string; panelId: string; title?: string }>) => Promise<{ success: boolean }>
      onWorkspaceEvent?: (channel: string, callback: (payload: unknown) => void) => () => void
      codingRuntimeStatus: () => Promise<{ success: boolean; status?: CodingRuntimeStatus; error?: string }>
      openExternal: (url: string) => Promise<void>
      openPath: (targetPath: string) => Promise<{ success: boolean; error?: string }>

      fabricListPatterns: () => Promise<{ success: boolean; patterns: string[] }>
      fabricRunPattern: (params: {
        streamId: string
        pattern: string
        input: string
        model?: string
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

      // Discord integration (Item 6)
      discordConnect?: (token: string) => Promise<{ success: boolean; error?: string }>
      discordDisconnect?: () => Promise<{ success: boolean }>
      discordStatus?: () => Promise<{ success: boolean; status?: DiscordGatewayStatus }>
      discordChannelHistory?: (channelId: string, limit?: number) => Promise<{ success: boolean; messages?: DiscordMessage[]; error?: string }>
      discordSend?: (channelId: string, content: string) => Promise<{ success: boolean; error?: string }>
      discordSetMapping?: (mapping: Record<string, string>) => Promise<{ success: boolean; error?: string }>
      discordSetMonitored?: (channelIds: string[]) => Promise<{ success: boolean; error?: string }>
      discordSetAutoRespond?: (enabled: boolean) => Promise<{ success: boolean; error?: string }>
      discordSubscribe?: () => Promise<{ success: boolean }>
      discordUnsubscribe?: () => Promise<{ success: boolean }>
      discordOnStatus?: (callback: (status: DiscordGatewayStatus) => void) => () => void
      discordOnMessage?: (callback: (data: { message: DiscordMessage; projectName: string }) => void) => () => void

      // Audit engine (Item 9)
      auditRun?: () => Promise<{ success: boolean; report?: AuditReport; error?: string }>
      auditList?: (limit?: number) => Promise<{ success: boolean; reports?: AuditReportMeta[]; error?: string }>
      auditRead?: (filePath: string) => Promise<{ success: boolean; report?: AuditReport; error?: string }>
      auditOpenDir?: () => Promise<{ success: boolean }>

      // Service watchdog (Item 7)
      watchdogStatus?: () => Promise<{ success: boolean; status?: WatchdogStatus; error?: string }>
      watchdogSweep?: () => Promise<{ success: boolean; error?: string }>
      watchdogSubscribe?: () => Promise<{ success: boolean }>
      watchdogUnsubscribe?: () => Promise<{ success: boolean }>
      watchdogOnStatus?: (callback: (status: WatchdogStatus) => void) => () => void

      // Hook events (Item 5)
      hookEmit?: (event: HookEvent) => Promise<{ success: boolean; error?: string }>
      hookGetRecent?: (limit?: number) => Promise<{ success: boolean; events?: HookEvent[]; error?: string }>
      hookGetByType?: (eventType: string, limit?: number) => Promise<{ success: boolean; events?: HookEvent[]; error?: string }>
      hookGetRegistry?: () => Promise<{ success: boolean; hooks?: HookRegistryEntry[]; error?: string }>
      hookGetStats?: () => Promise<{ success: boolean; stats?: HookStats; error?: string }>
      hookListLogDates?: () => Promise<{ success: boolean; dates?: string[]; error?: string }>
      hookSubscribe?: () => Promise<{ success: boolean }>
      hookUnsubscribe?: () => Promise<{ success: boolean }>
      hookOnEvent?: (callback: (event: HookEvent) => void) => () => void

      // Bug reports (Item 11)
      bugReportSubmit: (params: { title: string; description: string }) => Promise<{
        success: boolean
        method: 'github' | 'file'
        filePath?: string
        issueUrl?: string
        error?: string
      }>
      bugReportOpenDir: () => Promise<{ success: boolean }>

      pluginsList: () => Promise<{ success: boolean; plugins: PluginManifest[]; error?: string }>
      pluginsInstallFile: () => Promise<{ success: boolean; error?: string }>
      pluginsOpenDir: () => Promise<{ success: boolean }>
      pluginRunHook: (params: {
        pluginId: string
        pluginName: string
        hookType: 'onActivate' | 'onDeactivate' | 'beforeMessage'
        hookValue?: string
      }) => Promise<{ success: boolean }>

      logAppend: (level: string, message: string, detail?: string, category?: string) => Promise<{ success: boolean }>
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

      // MCP general client framework (Item 20)
      mcpCheckHealth: (params: { id: string; url: string; transport: 'http' | 'stdio' }) => Promise<{
        healthy: boolean
        error?: string
      }>
      mcpListTools: (params: { id: string; url: string; transport: 'http' | 'stdio' }) => Promise<{
        tools: McpToolEntry[]
        error?: string
      }>
      mcpRegisterServer: (config: {
        id: string; name: string; url: string; transport: 'http' | 'stdio'; description?: string
      }) => Promise<{ success: boolean }>

      // Tool surface registry (Item 21)
      toolsList: () => Promise<{ tools: ArcToolEntry[] }>
    }
  }
}

// MCP types (Item 20)
type McpToolEntry = {
  name: string
  description?: string
  inputSchema?: Record<string, unknown>
}

// Tool surface registry types (Item 21)
type ArcToolPermission = 'none' | 'read' | 'write' | 'execute' | 'network'
type ArcToolSource = 'builtin' | 'mcp' | 'plugin'
type ArcToolCategory = 'filesystem' | 'memory' | 'ai' | 'system' | 'fabric' | 'runtime'
type ArcToolEntry = {
  id: string
  name: string
  description: string
  permissions: ArcToolPermission[]
  active: boolean
  source: ArcToolSource
  category: ArcToolCategory
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

// Discord types (Item 6)
type DiscordConnectionState = 'disconnected' | 'connecting' | 'connected' | 'error'
type DiscordMessage = {
  id: string
  channelId: string
  authorId: string
  authorName: string
  content: string
  timestamp: string
  isBot: boolean
}
type DiscordChannel = {
  id: string
  name: string
  type: number
  guildId: string
}
type DiscordGuild = {
  id: string
  name: string
}
type DiscordGatewayStatus = {
  state: DiscordConnectionState
  botUserId: string | null
  guilds: DiscordGuild[]
  channels: DiscordChannel[]
  projectMapping: Record<string, string>
  monitoredChannels: string[]
  autoRespond: boolean
  error: string | null
}

// Audit types (Item 9)
type AuditStatus = 'pass' | 'warn' | 'fail' | 'skip'
type AuditCheckResult = {
  name: string
  status: AuditStatus
  summary: string
  details?: string
  recommendation?: string
}
type AuditReport = {
  id: string
  date: string
  runAt: string
  durationMs: number
  overall: AuditStatus
  checks: AuditCheckResult[]
}
type AuditReportMeta = {
  date: string
  filePath: string
  overall?: AuditStatus
}

// Watchdog types (Item 7)
type WatchdogServiceState = 'unknown' | 'healthy' | 'degraded' | 'failed' | 'recovering'
type WatchdogServiceEntry = {
  name: string
  displayName: string
  probeUrl: string
  state: WatchdogServiceState
  consecutiveFailures: number
  recoveryAttempts: number
  lastChecked: string | null
  lastHealthy: string | null
  hint: string
}
type WatchdogStatus = {
  running: boolean
  lastSweep: string | null
  services: WatchdogServiceEntry[]
}

// Hook event types (Item 5 — mirrors src/renderer/stores/hookTypes.ts)
type HookEventType =
  | 'request.accepted' | 'pai_context.loaded' | 'openclaw.started' | 'openclaw.completed'
  | 'fabric.considered' | 'fabric.selected' | 'fabric.skipped' | 'prompt.rebuilt'
  | 'model.dispatch.started' | 'model.dispatch.completed'
  | 'tool.action' | 'file.action' | 'runtime.degraded' | 'runtime.failed'

type HookStage = 'intake' | 'context' | 'routing' | 'fabric' | 'dispatch' | 'tool' | 'system'
type HookEventStatus = 'started' | 'completed' | 'skipped' | 'failed'

type HookEvent = {
  id: string
  eventType: HookEventType
  stage: HookStage
  status: HookEventStatus
  timestamp: string
  requestId: string
  summary: string
  details?: string
  selectedFabricPattern?: string
  skipReason?: string
  modelTarget?: string
  toolName?: string
  filePath?: string
  failureClass?: string
  recoveryHint?: string
}

type HookRegistryEntry = {
  name: string
  description: string
  subscribedEvents: HookEventType[]
  active: boolean
}

type HookStats = {
  totalEvents: number
  byType: Record<string, number>
  byStatus: Record<string, number>
  recentFailures: number
}
